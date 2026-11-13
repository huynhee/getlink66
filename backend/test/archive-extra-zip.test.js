import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { crc32, deflateRawSync } from "node:zlib";
import yauzl from "yauzl";
import { prepareZipExtraFiles } from "../src/utils/archiveExtraZip.js";

const TAIL_BYTES = 65557;
const MAX_DIRECTORY_BYTES = 2 * 1024 * 1024;
const UINT32_MAX = 0xffffffff;
const unsupported = { status: 422, code: "ARCHIVE_COMMENT_UNSUPPORTED" };
const files = [
  { name: "license_a0b1c2d3e4f56789a0b1c2d3e4f56789.txt", text: "Licensed asset\r\nOpaque reference: test-session\r\n" },
  { name: "license_a0b1c2d3e4f56789a0b1c2d3e4f56789.url", text: "[InternetShortcut]\r\nURL=https://3dipl.org/\r\n" },
];

function extra(id, data) {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id);
  header.writeUInt16LE(data.length, 2);
  return Buffer.concat([header, data]);
}

function unicodePath(rawName, name) {
  const header = Buffer.alloc(5);
  header[0] = 1;
  header.writeUInt32LE(crc32(Buffer.from(rawName)), 1);
  return extra(0x7075, Buffer.concat([header, Buffer.from(name)]));
}

// Independent ZIP writer; sparse gaps allow real 64-bit offsets without large buffers.
function fixture(entries = [{ name: "original.max", data: Buffer.from("original asset") }], options = {}) {
  const locals = [];
  const centrals = [];
  const offsets = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = entry.data || Buffer.alloc(0);
    const compressed = entry.method === 8 ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    const central = Buffer.alloc(46);
    const version = entry.zip64 ? 45 : 20;
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(version, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(entry.method || 0, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    let fields = entry.extra || Buffer.alloc(0);
    if (entry.zip64) {
      const sizes = Buffer.alloc(24);
      sizes.writeBigUInt64LE(BigInt(data.length));
      sizes.writeBigUInt64LE(BigInt(compressed.length), 8);
      sizes.writeBigUInt64LE(BigInt(localOffset), 16);
      fields = Buffer.concat([extra(1, sizes), fields]);
    }
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x300 | version, 4);
    central.writeUInt16LE(version, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(entry.method || 0, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(entry.zip64 ? UINT32_MAX : compressed.length, 20);
    central.writeUInt32LE(entry.zip64 ? UINT32_MAX : data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(fields.length, 30);
    central.writeUInt32LE(0x81a40020, 38);
    central.writeUInt32LE(entry.zip64 ? UINT32_MAX : localOffset, 42);
    offsets.push(localOffset);
    locals.push(local, name, compressed);
    centrals.push(Buffer.concat([central, name, fields]));
    localOffset += local.length + name.length + compressed.length;
  }
  const payload = Buffer.concat(locals);
  const directory = Buffer.concat(centrals);
  const directoryOffset = options.directoryOffset ?? payload.length;
  const directoryEnd = directoryOffset + directory.length;
  const trailer = [];
  const zip64 = options.zip64 || entries.some((entry) => entry.zip64) || directoryOffset >= UINT32_MAX;
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(0x32d, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(entries.length), 24);
    record.writeBigUInt64LE(BigInt(entries.length), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40);
    record.writeBigUInt64LE(BigInt(directoryOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50);
    locator.writeBigUInt64LE(BigInt(directoryEnd), 8);
    locator.writeUInt32LE(1, 16);
    trailer.push(record, locator);
  }
  const eocd = Buffer.alloc(22);
  const saturated = zip64 && !options.unsaturated;
  const comment = Buffer.from(options.comment || "old archive comment");
  eocd.writeUInt32LE(0x06054b50);
  eocd.writeUInt16LE(saturated ? 0xffff : entries.length, 8);
  eocd.writeUInt16LE(saturated ? 0xffff : entries.length, 10);
  eocd.writeUInt32LE(saturated ? UINT32_MAX : directory.length, 12);
  eocd.writeUInt32LE(saturated ? UINT32_MAX : directoryOffset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  const end = Buffer.concat([directory, ...trailer, eocd, comment]);
  const total = directoryOffset + end.length;
  const segments = [{ start: 0, bytes: payload }, { start: directoryOffset, bytes: end }];
  return { total, segments, directoryOffset, directorySize: directory.length, directoryEnd,
    eocdAt: directoryEnd + (zip64 ? 76 : 0), centrals, offsets, entries };
}

function range(source, start, end) {
  const bytes = Buffer.alloc(end - start);
  for (const segment of source.segments) {
    const from = Math.max(start, segment.start);
    const to = Math.min(end, segment.start + segment.bytes.length);
    if (to > from) segment.bytes.copy(bytes, from - start, from - segment.start, to - segment.start);
  }
  return bytes;
}

function bytes(source) {
  return range(source, 0, source.total);
}

function fromBytes(buffer) {
  return { total: buffer.length, segments: [{ start: 0, bytes: buffer }] };
}

function splice(source, patches) {
  const segments = [];
  let cursor = 0;
  let total = 0;
  const appendSource = (end) => {
    for (const segment of source.segments) {
      const from = Math.max(cursor, segment.start);
      const to = Math.min(end, segment.start + segment.bytes.length);
      if (to > from) segments.push({ start: total + from - cursor, bytes: segment.bytes.subarray(from - segment.start, to - segment.start) });
    }
    total += end - cursor;
    cursor = end;
  };
  for (const patch of patches) {
    assert.ok(patch.start >= cursor && patch.end >= patch.start && patch.end <= source.total);
    appendSource(patch.start);
    segments.push({ start: total, bytes: patch.bytes });
    total += patch.bytes.length;
    cursor = patch.end;
  }
  appendSource(source.total);
  return { segments, total };
}

async function plan(source, options = {}) {
  const requests = [];
  const tail = range(source, Math.max(0, source.total - TAIL_BYTES), source.total);
  const read = async (start, end) => {
    assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end));
    assert.ok(start >= 0 && start <= end && end < source.total);
    assert.ok(end - start + 1 <= MAX_DIRECTORY_BYTES);
    assert.ok(start !== 0 || end !== source.total - 1, "No complete archive read");
    requests.push({ start, end });
    return range(source, start, end + 1);
  };
  const result = await prepareZipExtraFiles({ tail, total: source.total, comment: Buffer.from("ipl1.encrypted-opaque-comment"), files, read, ...options });
  assert.equal(result.format, "zip");
  assert.equal(result.patches.length, 2);
  assert.ok(result.patches[0].end <= result.patches[1].start);
  return { ...result, requests, output: splice(source, result.patches) };
}

class SparseReader extends yauzl.RandomAccessReader {
  constructor(source) {
    super();
    this.source = source;
  }

  _readStreamForRange(start, end) {
    assert.ok(end - start < MAX_DIRECTORY_BYTES);
    return Readable.from([range(this.source, start, end)]);
  }
}

async function extract(source) {
  const zip = await yauzl.fromRandomAccessReaderPromise(new SparseReader(source), source.total, { decodeStrings: false });
  const entries = [];
  try {
    for await (const entry of zip.eachEntry()) {
      const chunks = [];
      const stream = await zip.openReadStreamPromise(entry);
      for await (const chunk of stream) chunks.push(chunk);
      const data = Buffer.concat(chunks);
      assert.equal(crc32(data), entry.crc32);
      entries.push({ entry, data, name: yauzl.getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, false) });
    }
    return { entries, comment: zip.comment };
  } finally {
    zip.close();
  }
}

function assertAdditions(decoded, expected = files) {
  for (const file of expected) {
    const found = decoded.entries.find((item) => item.name === file.name);
    assert.ok(found, `Missing ${file.name}`);
    assert.deepEqual(found.data, Buffer.from(file.text));
    assert.equal(found.entry.compressionMethod, 0);
    assert.equal(found.entry.generalPurposeBitFlag, 0x800);
    assert.equal(found.entry.lastModFileDate, 0x21);
    assert.equal(found.entry.lastModFileTime, 0);
    assert.equal((found.entry.externalFileAttributes >>> 16) & 0o777, 0o644);
    assert.equal((found.entry.externalFileAttributes >>> 16) & 0o170000, 0o100000);
  }
}

test("ZIP splices preserve original bytes, compressed data, Unicode names, comments and offsets", async () => {
  const entries = [
    { name: "scenes/\u0111\u00e8n.max", data: Buffer.from("Unicode scene contents"), method: 8 },
    { name: "texture.bin", data: Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 256)) },
    { name: "legacy.max", data: Buffer.from("legacy path data"), extra: unicodePath("legacy.max", "\u5bb6\u5177.max") },
  ];
  const original = fixture(entries);
  const snapshot = bytes(original);
  const comment = Buffer.from([0, 255, 128, 10, 97]);
  const result = await plan(original, { comment });
  const repeated = await plan(original, { comment });
  assert.deepEqual(result.patches, repeated.patches, "Deterministic headers and timestamps");
  assert.equal(result.requests.length, 0, "Small archives are already in the supplied tail");
  assert.deepEqual(bytes(original), snapshot, "Input buffers remain unchanged");
  const [insertion, trailer] = result.patches;
  assert.equal(insertion.start, original.directoryOffset);
  assert.equal(insertion.end, insertion.start);
  assert.equal(trailer.start, original.directoryEnd);
  assert.equal(trailer.end, original.total);
  const output = bytes(result.output);
  assert.deepEqual(output.subarray(0, insertion.start), snapshot.subarray(0, insertion.start));
  const newDirectory = insertion.start + insertion.bytes.length;
  assert.deepEqual(output.subarray(newDirectory, newDirectory + original.directorySize),
    snapshot.subarray(original.directoryOffset, original.directoryEnd), "Original central directory streams unchanged");
  const decoded = await extract(result.output);
  assert.deepEqual(decoded.comment, comment);
  assert.deepEqual(decoded.entries.slice(0, entries.length).map((item) => item.data), entries.map((item) => item.data));
  assert.deepEqual(decoded.entries.slice(0, entries.length).map((item) => item.entry.relativeOffsetOfLocalHeader), original.offsets);
  assert.deepEqual(decoded.entries.slice(0, entries.length).map((item) => item.name), [entries[0].name, entries[1].name, "\u5bb6\u5177.max"]);
  assertAdditions(decoded);
});

test("empty ZIP keeps two stable same-coordinate patches and extracts both extras", async () => {
  const original = fixture([]);
  const result = await plan(original);
  assert.deepEqual(result.patches.map(({ start, end }) => [start, end]), [[0, 0], [0, original.total]]);
  const decoded = await extract(result.output);
  assert.equal(decoded.entries.length, 2);
  assertAdditions(decoded);
});

test("main-validated names with spaces and parentheses accept UTF-8 TXT data", async () => {
  const additions = files.map((file, index) => ({ ...file,
    name: file.name.replace("license_", "Asset notes (2026)-"),
    text: index === 0 ? "B\u1ea3n quy\u1ec1n \u0111\u00e3 x\u00e1c th\u1ef1c\r\n" : file.text,
  }));
  const result = await plan(fixture(), { files: additions });
  assertAdditions(await extract(result.output), additions);
});

test("safe legacy backslash paths normalize for inspection without rewriting the source CD", async () => {
  const name = "models\\furniture\\chair.max";
  const data = Buffer.from("untouched legacy archive data");
  const original = fixture([{ name, data, method: 8 }]);
  const result = await plan(original);
  const directoryStart = original.directoryOffset + result.patches[0].bytes.length;
  assert.deepEqual(range(result.output, directoryStart, directoryStart + original.directorySize),
    range(original, original.directoryOffset, original.directoryEnd));
  const decoded = await extract(result.output);
  assert.equal(decoded.entries[0].name, "models/furniture/chair.max");
  assert.deepEqual(decoded.entries[0].entry.fileNameRaw, Buffer.from(name));
  assert.deepEqual(decoded.entries[0].data, data);
  assert.equal(decoded.entries[0].entry.relativeOffsetOfLocalHeader, 0);
  assertAdditions(decoded);
});

test("unsafe legacy backslash paths and normalized extra-name collisions still fail closed", async (t) => {
  for (const name of ["..\\escape.max", "assets\\..\\escape.max", "\\absolute.max", "C:\\drive.max", `.\\${files[0].name}`]) {
    await t.test(name, async () => {
      await assert.rejects(plan(fixture([{ name, data: Buffer.alloc(0) }])), unsupported);
    });
  }
});

test("small ZIP64 preserves ZIP64 records and existing ZIP64 entries", async () => {
  for (const unsaturated of [false, true]) {
    const original = fixture([{ name: "zip64.max", data: Buffer.from("small ZIP64 data"), zip64: true }], { unsaturated });
    const result = await plan(original);
    const decoded = await extract(result.output);
    assert.deepEqual(decoded.entries[0].data, original.entries[0].data);
    assert.equal(decoded.entries[0].entry.relativeOffsetOfLocalHeader, 0);
    assertAdditions(decoded);
    const output = bytes(result.output);
    const eocdAt = output.length - decoded.comment.length - 22;
    assert.equal(output.readUInt32LE(eocdAt - 20), 0x07064b50);
    const recordAt = Number(output.readBigUInt64LE(eocdAt - 12));
    assert.equal(output.readUInt32LE(recordAt), 0x06064b50);
    assert.equal(output.readBigUInt64LE(recordAt + 32), 3n);
    assert.equal(output.readBigUInt64LE(recordAt + 48), BigInt(original.directoryOffset + result.patches[0].bytes.length));
  }
});

test("ZIP64 maximum comments fetch only bounded locator, record and directory metadata", async () => {
  const original = fixture(undefined, { zip64: true, comment: Buffer.alloc(65535, 97) });
  const comment = Buffer.alloc(65535, 98);
  const result = await plan(original, { comment });
  assert.equal(result.requests.length, 3);
  assert.deepEqual(result.requests[0], { start: original.eocdAt - 20, end: original.eocdAt - 1 });
  assert.deepEqual(result.requests[1], { start: original.directoryEnd, end: original.directoryEnd + 55 });
  assert.deepEqual(result.requests[2], { start: original.directoryOffset, end: original.directoryEnd - 1 });
  const decoded = await extract(result.output);
  assert.deepEqual(decoded.comment, comment);
  assertAdditions(decoded);
});

test("large directories are cached once, never stored in patches, with no read per entry", async () => {
  const entries = Array.from({ length: 1800 }, (_, index) => ({ name: `models/model-${index}.max`, data: Buffer.alloc(0) }));
  entries.unshift({ name: "payload.bin", data: Buffer.alloc(128 * 1024, 42) });
  const original = fixture(entries);
  assert.ok(original.directorySize > TAIL_BYTES);
  const result = await plan(original);
  assert.equal(result.requests.length, 2);
  assert.equal(result.requests[0].end - result.requests[0].start + 1, 20);
  assert.deepEqual(result.requests[1], { start: original.directoryOffset, end: original.directoryEnd - 1 });
  assert.ok(result.patches.reduce((size, patch) => size + patch.bytes.length, 0) < 1024);
  const decoded = await extract(result.output);
  assert.equal(decoded.entries.length, entries.length + 2);
  assert.deepEqual(decoded.entries[0].data, entries[0].data);
  assertAdditions(decoded);
});

test("virtual large classic ZIP promotes CD and only overflowing new local offsets to ZIP64", async () => {
  const original = fixture(undefined, { directoryOffset: UINT32_MAX - 60 });
  const result = await plan(original);
  assert.ok(result.requests.every((request) => request.end - request.start < TAIL_BYTES));
  const decoded = await extract(result.output);
  assert.deepEqual(decoded.entries[0].data, original.entries[0].data);
  assert.equal(decoded.entries[0].entry.relativeOffsetOfLocalHeader, 0);
  assertAdditions(decoded);
  const first = decoded.entries[1].entry;
  const second = decoded.entries[2].entry;
  assert.equal(first.relativeOffsetOfLocalHeader, original.directoryOffset);
  assert.equal(first.versionNeededToExtract, 20);
  assert.equal(first.extraFields.length, 0);
  assert.ok(second.relativeOffsetOfLocalHeader > UINT32_MAX);
  assert.equal(second.versionNeededToExtract, 45);
  assert.equal(second.extraFields.length, 1);
  assert.equal(second.extraFields[0].id, 1);
  assert.equal(second.extraFields[0].data.length, 8);
  const end = range(result.output, result.output.total - decoded.comment.length - 98, result.output.total - decoded.comment.length);
  assert.equal(end.readUInt32LE(0), 0x06064b50);
  assert.equal(end.readBigUInt64LE(48), BigInt(original.directoryOffset + result.patches[0].bytes.length));
  assert.equal(end.readUInt32LE(76 + 16), UINT32_MAX);
});

test("virtual large ZIP64 preserves source offsets and uses offset extras for both additions", async () => {
  const original = fixture(undefined, { directoryOffset: UINT32_MAX + 1234 });
  const result = await plan(original);
  const decoded = await extract(result.output);
  assert.deepEqual(decoded.entries[0].data, original.entries[0].data);
  assertAdditions(decoded);
  for (const { entry } of decoded.entries.slice(1)) {
    assert.ok(entry.relativeOffsetOfLocalHeader >= UINT32_MAX);
    assert.equal(entry.versionNeededToExtract, 45);
    assert.equal(entry.extraFields[0].data.readBigUInt64LE(0), BigInt(entry.relativeOffsetOfLocalHeader));
  }
});

test("unsafe output arithmetic is rejected for virtual near-limit ZIP64 sources", async () => {
  const original = fixture(undefined, { directoryOffset: Number.MAX_SAFE_INTEGER - 512 });
  const largeFiles = files.map((file) => ({ ...file, text: "x".repeat(1024) }));
  await assert.rejects(plan(original, { files: largeFiles }), unsupported);
});

test("malformed, split, encrypted and signed classic metadata fails closed", async (t) => {
  const original = fixture();
  const cases = [
    ["EOCD disk", (buffer) => buffer.writeUInt16LE(1, original.eocdAt + 4)],
    ["CD disk", (buffer) => buffer.writeUInt16LE(1, original.eocdAt + 6)],
    ["disk entry count", (buffer) => buffer.writeUInt16LE(2, original.eocdAt + 8)],
    ["count too large", (buffer) => { buffer.writeUInt16LE(2, original.eocdAt + 8); buffer.writeUInt16LE(2, original.eocdAt + 10); }],
    ["zero count with directory", (buffer) => { buffer.writeUInt16LE(0, original.eocdAt + 8); buffer.writeUInt16LE(0, original.eocdAt + 10); }],
    ["bad directory size", (buffer) => buffer.writeUInt32LE(original.directorySize + 1, original.eocdAt + 12)],
    ["bad directory offset", (buffer) => buffer.writeUInt32LE(original.directoryOffset - 1, original.eocdAt + 16)],
    ["missing ZIP64 locator", (buffer) => buffer.writeUInt32LE(UINT32_MAX, original.eocdAt + 16)],
    ["central signature", (buffer) => buffer.writeUInt32LE(0x08064b50, original.directoryOffset)],
    ["entry disk", (buffer) => buffer.writeUInt16LE(1, original.directoryOffset + 34)],
    ["local offset inside CD", (buffer) => buffer.writeUInt32LE(original.directoryOffset, original.directoryOffset + 42)],
    ["unbounded local data", (buffer) => { buffer.writeUInt32LE(100000, original.directoryOffset + 20); buffer.writeUInt32LE(100000, original.directoryOffset + 24); }],
    ["stored size mismatch", (buffer) => buffer.writeUInt32LE(1, original.directoryOffset + 24)],
    ["entry name extends beyond CD", (buffer) => buffer.writeUInt16LE(65535, original.directoryOffset + 28)],
    ["truncated EOCD comment", (buffer) => buffer.writeUInt16LE(1, original.eocdAt + 20)],
    ...[1, 0x20, 0x40, 0x2000, 0x4000].map((flag) => [`entry flag ${flag}`, (buffer) => buffer.writeUInt16LE(flag, original.directoryOffset + 8)]),
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const buffer = bytes(original);
      mutate(buffer);
      await assert.rejects(plan(fromBytes(buffer)), unsupported);
    });
  }
});

test("directory signatures, trailing records and gapped trailers are never dropped", async () => {
  const original = fixture();
  for (const withinSize of [false, true]) {
    const buffer = bytes(original);
    const signature = Buffer.from("504b05050000", "hex");
    const eocd = Buffer.from(buffer.subarray(original.eocdAt));
    if (withinSize) eocd.writeUInt32LE(original.directorySize + signature.length, 12);
    const signed = Buffer.concat([buffer.subarray(0, original.directoryEnd), signature, eocd]);
    await assert.rejects(plan(fromBytes(signed)), unsupported);
  }
  const garbage = Buffer.concat([bytes(original), Buffer.from("trailing garbage")]);
  await assert.rejects(plan(fromBytes(garbage)), unsupported);
  const fakeEocd = Buffer.alloc(22);
  fakeEocd.writeUInt32LE(0x06054b50);
  const ambiguous = fixture(undefined, { comment: fakeEocd });
  await assert.rejects(plan(ambiguous), unsupported);
});

test("generated-name collisions, Unicode aliases and existing duplicate metadata are rejected", async (t) => {
  for (const name of [files[0].name, files[1].name.toUpperCase(), `${files[0].name}. `, `./${files[0].name}`, `${files[1].name}/`]) {
    await t.test(name, async () => {
      await assert.rejects(plan(fixture([{ name, data: Buffer.alloc(0) }])), unsupported);
    });
  }
  const unicodeAlias = fixture([{ name: "alias.max", extra: unicodePath("alias.max", files[0].name) }]);
  await assert.rejects(plan(unicodeAlias), unsupported);
  const rawAlias = fixture([{ name: files[1].name, extra: unicodePath(files[1].name, "hidden.max") }]);
  await assert.rejects(plan(rawAlias), unsupported);
  const duplicate = fixture([{ name: "same.max" }, { name: "SAME.max" }]);
  await assert.rejects(plan(duplicate), unsupported);
  const overlapping = fixture([{ name: "first.max" }, { name: "other.max" }]);
  const buffer = bytes(overlapping);
  buffer.writeUInt32LE(0, overlapping.directoryOffset + overlapping.centrals[0].length + 42);
  await assert.rejects(plan(fromBytes(buffer)), unsupported);
  buffer.writeUInt32LE(1, overlapping.directoryOffset + overlapping.centrals[0].length + 42);
  await assert.rejects(plan(fromBytes(buffer)), unsupported);
});

test("malformed, duplicate, signed and encrypted entry extras are rejected", async (t) => {
  const cases = [
    ["duplicate extra ID", Buffer.concat([extra(0x5455, Buffer.alloc(1)), extra(0x5455, Buffer.alloc(1))])],
    ["duplicate ZIP64", Buffer.concat([extra(1, Buffer.alloc(0)), extra(1, Buffer.alloc(0))])],
    ["unused ZIP64 values", extra(1, Buffer.alloc(8))],
    ["dangling extra bytes", Buffer.from([1, 2, 3])],
    ["extra field length overrun", Buffer.from([1, 0, 255, 255])],
    ...[0x0014, 0x0015, 0x0016, 0x0017, 0x0018, 0x0019, 0x9901].map((id) => [`signed/encrypted ID ${id}`, extra(id, Buffer.alloc(0))]),
  ];
  for (const [name, field] of cases) {
    await t.test(name, async () => {
      await assert.rejects(plan(fixture([{ name: "entry.max", extra: field }])), unsupported);
    });
  }
  const missing = fixture();
  for (const offset of [20, 24, 42]) {
    const buffer = bytes(missing);
    buffer.writeUInt32LE(UINT32_MAX, missing.directoryOffset + offset);
    await assert.rejects(plan(fromBytes(buffer)), unsupported);
  }
  const large = fixture([{ name: "unsafe.max", zip64: true }]);
  const unsafe = bytes(large);
  unsafe.writeBigUInt64LE(2n ** 53n, large.directoryOffset + 46 + Buffer.byteLength("unsafe.max") + 4);
  await assert.rejects(plan(fromBytes(unsafe)), unsupported);
  const split = fixture([{ name: "split.max", extra: extra(1, Buffer.from([1, 0, 0, 0])) }]);
  const splitBytes = bytes(split);
  splitBytes.writeUInt16LE(0xffff, split.directoryOffset + 34);
  await assert.rejects(plan(fromBytes(splitBytes)), unsupported);
});

test("conflicting, unsafe, extended and multi-volume ZIP64 trailers are rejected", async (t) => {
  const original = fixture(undefined, { zip64: true, unsaturated: true });
  const record = original.directoryEnd;
  const locator = record + 56;
  const cases = [
    ["locator disk", (buffer) => buffer.writeUInt32LE(1, locator + 4)],
    ["locator volume count", (buffer) => buffer.writeUInt32LE(2, locator + 16)],
    ["locator out of bounds", (buffer) => buffer.writeBigUInt64LE(BigInt(original.total), locator + 8)],
    ["unsafe locator", (buffer) => buffer.writeBigUInt64LE(2n ** 53n, locator + 8)],
    ["ZIP64 signature", (buffer) => buffer.writeUInt32LE(0, record)],
    ["ZIP64 record length", (buffer) => buffer.writeBigUInt64LE(45n, record + 4)],
    ["version 2 encrypted metadata", (buffer) => buffer.writeUInt16LE(62, record + 14)],
    ["ZIP64 disk", (buffer) => buffer.writeUInt32LE(1, record + 16)],
    ["ZIP64 directory disk", (buffer) => buffer.writeUInt32LE(1, record + 20)],
    ["ZIP64 count mismatch", (buffer) => buffer.writeBigUInt64LE(2n, record + 24)],
    ["EOCD count conflict", (buffer) => { buffer.writeUInt16LE(2, original.eocdAt + 8); buffer.writeUInt16LE(2, original.eocdAt + 10); }],
    ["EOCD size conflict", (buffer) => buffer.writeUInt32LE(original.directorySize - 1, original.eocdAt + 12)],
    ["EOCD offset conflict", (buffer) => buffer.writeUInt32LE(original.directoryOffset - 1, original.eocdAt + 16)],
    ["unsafe count", (buffer) => { buffer.writeBigUInt64LE(2n ** 53n, record + 24); buffer.writeBigUInt64LE(2n ** 53n, record + 32); }],
    ["unsafe directory size", (buffer) => buffer.writeBigUInt64LE(2n ** 53n, record + 40)],
    ["unsafe directory offset", (buffer) => buffer.writeBigUInt64LE(2n ** 53n, record + 48)],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const buffer = bytes(original);
      mutate(buffer);
      await assert.rejects(plan(fromBytes(buffer)), unsupported);
    });
  }
});

test("directory cap and input bounds fail before unbounded metadata reads", async () => {
  const original = fixture();
  const buffer = bytes(original);
  buffer.writeUInt32LE(MAX_DIRECTORY_BYTES + 1, original.eocdAt + 12);
  let calls = 0;
  const read = async () => { calls += 1; throw new Error("Unexpected read"); };
  await assert.rejects(plan(fromBytes(buffer), { read }), unsupported);
  assert.equal(calls, 0);
  for (const options of [
    { total: Number.MAX_SAFE_INTEGER + 1 }, { total: -1 }, { total: 1.5 }, { tail: Buffer.alloc(21) },
    { comment: "not a buffer" }, { comment: Buffer.alloc(65536) },
    { files: [] }, { files: [files[0], files[0]] },
    { files: [{ ...files[0], name: "../unsafe.txt" }, files[1]] },
    { files: [{ ...files[0], text: "x".repeat(65537) }, files[1]] },
  ]) await assert.rejects(plan(original, options), unsupported);
});

test("bounded read errors, short buffers and source-validator failures abort planning", async () => {
  const original = fixture(undefined, { comment: Buffer.alloc(65535, 97) });
  await assert.rejects(plan(original, { read: async () => Buffer.alloc(0) }), unsupported);
  await assert.rejects(plan(original, { read: async () => new Uint8Array(20) }), unsupported);
  const changed = Object.assign(new Error("Pinned source changed"), { status: 409, code: "ARCHIVE_SOURCE_CHANGED" });
  await assert.rejects(plan(original, { read: async () => { throw changed; } }), (error) => error === changed);
});
