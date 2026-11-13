import yauzl from "yauzl";
import { archiveCrc32, archiveFormatError, zipCommentPatch, ZIP_TAIL_BYTES } from "./archiveCommentFormat.js";

const MAX_DIRECTORY_BYTES = 2 * 1024 * 1024;
const MAX_EXTRA_BYTES = 64 * 1024;
const UINT32_MAX = 0xffffffff;
const UINT16_MAX = 0xffff;

function requireZip(condition, message) {
  if (!condition) throw archiveFormatError(message);
}

function safeSum(...values) {
  const sum = values.reduce((total, value) => total + value, 0);
  requireZip(Number.isSafeInteger(sum), "ZIP offsets exceed safe integer bounds.");
  return sum;
}

function uint64(buffer, offset) {
  const value = buffer.readBigUInt64LE(offset);
  requireZip(value <= BigInt(Number.MAX_SAFE_INTEGER), "ZIP64 integer exceeds safe bounds.");
  return Number(value);
}

function collisionKey(name) {
  return name.replaceAll("\\", "/").split("/").filter((part) => part && part !== ".")
    .map((part) => part.replace(/[ .]+$/g, "").toLowerCase()).join("/");
}

// All yauzl reads are cache-only: it must never fetch payload or issue a request per entry.
class MetadataReader extends yauzl.RandomAccessReader {
  constructor(ranges) {
    super();
    this.ranges = ranges;
  }

  read(buffer, offset, length, position, callback) {
    let error;
    try {
      const end = safeSum(position, length);
      let cursor = position;
      while (cursor < end) {
        const range = this.ranges.find((item) => item.start <= cursor && cursor < item.start + item.bytes.length);
        requireZip(range, "ZIP parser requested uncached metadata.");
        const size = Math.min(end - cursor, range.start + range.bytes.length - cursor);
        range.bytes.copy(buffer, offset + cursor - position, cursor - range.start, cursor - range.start + size);
        cursor += size;
      }
    } catch (caught) {
      error = caught;
    }
    setImmediate(() => callback(error, error ? 0 : length));
  }
}

function prepareFiles(files) {
  requireZip(Array.isArray(files) && files.length === 2, "ZIP extras require two small files.");
  const names = new Set();
  let size = 0;
  return files.map((file) => {
    requireZip(file && typeof file.name === "string" && file.name.length <= 255
      && /^[a-z0-9][a-z0-9 _().-]*$/i.test(file.name), "Invalid ZIP extra filename.");
    const key = collisionKey(file.name);
    requireZip(!names.has(key), "Duplicate ZIP extra filenames.");
    names.add(key);
    requireZip(typeof file.text === "string" || Buffer.isBuffer(file.text), "Invalid ZIP extra text.");
    size = safeSum(size, Buffer.byteLength(file.text));
    requireZip(size <= MAX_EXTRA_BYTES, "ZIP extra files exceed the safe size limit.");
    return { name: Buffer.from(file.name, "ascii"), data: Buffer.from(file.text), key };
  });
}

async function trailerMetadata(tail, total, comment, load) {
  // yauzl's EOCD scan includes the locator's 20 bytes as well as the standard tail.
  const scanStart = Math.max(0, total - ZIP_TAIL_BYTES - 20);
  const scan = scanStart === total - tail.length ? tail
    : Buffer.concat([await load(scanStart, total - tail.length - scanStart), tail]);
  const patch = zipCommentPatch(scan, total, comment);
  const eocd = scan.subarray(patch.start - scanStart, patch.start - scanStart + 22);
  const metadata = {
    directoryOffset: eocd.readUInt32LE(16), directorySize: eocd.readUInt32LE(12),
    count: eocd.readUInt16LE(10), trailerStart: patch.start, zip64: null,
  };
  const locatorAt = patch.start - scanStart - 20;
  if (locatorAt >= 0 && scan.readUInt32LE(locatorAt) === 0x07064b50) {
    const locator = scan.subarray(locatorAt, locatorAt + 20);
    requireZip(locator.readUInt32LE(4) === 0 && locator.readUInt32LE(16) === 1, "Split ZIP64 archives are not supported.");
    const start = uint64(locator, 8);
    requireZip(safeSum(start, 56) === patch.start - 20, "Unsupported ZIP64 trailer bounds.");
    const record = await load(start, 56);
    requireZip(record.readUInt32LE(0) === 0x06064b50 && uint64(record, 4) === 44
      && record.readUInt16LE(14) === 45, "Extended or encrypted ZIP64 trailers are not supported.");
    requireZip(record.readUInt32LE(16) === 0 && record.readUInt32LE(20) === 0
      && uint64(record, 24) === uint64(record, 32), "Split ZIP64 directory metadata.");
    const count = uint64(record, 32);
    const directorySize = uint64(record, 40);
    const directoryOffset = uint64(record, 48);
    requireZip((metadata.count === UINT16_MAX || metadata.count === count)
      && (metadata.directorySize === UINT32_MAX || metadata.directorySize === directorySize)
      && (metadata.directoryOffset === UINT32_MAX || metadata.directoryOffset === directoryOffset), "Conflicting ZIP and ZIP64 metadata.");
    Object.assign(metadata, { directoryOffset, directorySize, count, trailerStart: start, zip64: record });
  }
  requireZip(metadata.directorySize <= MAX_DIRECTORY_BYTES, "ZIP central directory exceeds the safe inspection limit.");
  requireZip(safeSum(metadata.directoryOffset, metadata.directorySize) === metadata.trailerStart,
    "Signed, gapped or malformed ZIP trailers are not supported.");
  requireZip(metadata.count <= Math.floor(metadata.directorySize / 46)
    && (metadata.count !== 0 || metadata.directorySize === 0), "Invalid ZIP directory count.");
  return { ...metadata, scan, scanStart };
}

function validateEntry(entry, header, metadata, names, offsets, generatedNames) {
  requireZip(!(entry.generalPurposeBitFlag & ~0x081e) && entry.compressionMethod !== 99,
    "Encrypted, patched or unsupported ZIP entry flags.");
  const extraIds = new Set();
  let extraSize = 0;
  let zip64;
  for (const field of entry.extraFields) {
    requireZip(!extraIds.has(field.id), "Duplicate ZIP extra metadata.");
    requireZip(!(field.id >= 0x0014 && field.id <= 0x0019) && field.id !== 0x9901,
      "Signed or encrypted ZIP entries are not supported.");
    extraIds.add(field.id);
    extraSize += 4 + field.data.length;
    if (field.id === 1) zip64 = field.data;
  }
  requireZip(extraSize === entry.extraFieldLength, "Truncated ZIP extra metadata.");

  // Validate ZIP64 ourselves too: yauzl tolerates missing fields and rounds unsafe integers.
  let cursor = 0;
  const value = (original, sentinel, width) => {
    if (original !== sentinel) return original;
    requireZip(zip64 && cursor + width <= zip64.length, "Missing ZIP64 entry metadata.");
    const result = width === 8 ? uint64(zip64, cursor) : zip64.readUInt32LE(cursor);
    cursor += width;
    return result;
  };
  const uncompressedSize = value(header.readUInt32LE(24), UINT32_MAX, 8);
  const compressedSize = value(header.readUInt32LE(20), UINT32_MAX, 8);
  const offset = value(header.readUInt32LE(42), UINT32_MAX, 8);
  const disk = value(header.readUInt16LE(34), UINT16_MAX, 4);
  requireZip(!zip64 || (cursor > 0 && cursor === zip64.length), "Ambiguous ZIP64 entry metadata.");
  requireZip(disk === 0, "Split ZIP entry metadata.");
  requireZip(uncompressedSize === entry.uncompressedSize && compressedSize === entry.compressedSize
    && offset === entry.relativeOffsetOfLocalHeader, "Conflicting ZIP64 entry fields.");
  const end = safeSum(offset, 30, entry.fileNameLength, compressedSize);
  requireZip(end <= metadata.directoryOffset,
    "ZIP local file exceeds payload bounds.");
  requireZip(!offsets.has(offset), "Duplicate ZIP local file offsets.");
  offsets.add(offset);

  const key = collisionKey(entry.fileName);
  const rawName = yauzl.getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, [], true);
  requireZip(!generatedNames.has(key) && !generatedNames.has(collisionKey(rawName)), "ZIP extra filename collides with an existing entry.");
  requireZip(!names.has(key), "Duplicate ZIP filenames.");
  names.add(key);
  return { start: offset, end };
}

async function validateDirectory(reader, total, metadata, directory, files) {
  let zip;
  try {
    zip = await yauzl.fromRandomAccessReaderPromise(reader, total, {
      autoClose: false, decodeStrings: true, strictFileNames: false, validateEntrySizes: true,
    });
    requireZip(zip.entryCount === metadata.count && zip.readEntryCursor === metadata.directoryOffset,
      "Conflicting ZIP directory metadata.");
    const names = new Set();
    const offsets = new Set();
    const generatedNames = new Set(files.map((file) => file.key));
    const localBounds = [];
    let consumed = 0;
    for await (const entry of zip.eachEntry()) {
      const length = safeSum(46, entry.fileNameLength, entry.extraFieldLength, entry.fileCommentLength);
      requireZip(consumed + length <= directory.length, "ZIP entry exceeds directory bounds.");
      localBounds.push(validateEntry(entry, directory.subarray(consumed, consumed + 46), metadata, names, offsets, generatedNames));
      consumed += length;
    }
    requireZip(consumed === metadata.directorySize, "ZIP directory contains signatures or unsupported trailing records.");
    localBounds.sort((left, right) => left.start - right.start);
    requireZip(localBounds.every((bounds, index) => index === 0 || localBounds[index - 1].end <= bounds.start),
      "Overlapping ZIP local file bounds.");
  } catch (error) {
    if (error.code === "ARCHIVE_COMMENT_UNSUPPORTED") throw error;
    throw archiveFormatError("Invalid or unsupported ZIP central directory.");
  } finally {
    zip?.close();
  }
}

function newEntry(file, offset) {
  const zip64 = offset >= UINT32_MAX;
  const version = zip64 ? 45 : 20;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(version, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(archiveCrc32(file.data), 14);
  local.writeUInt32LE(file.data.length, 18);
  local.writeUInt32LE(file.data.length, 22);
  local.writeUInt16LE(file.name.length, 26);

  const extra = Buffer.alloc(zip64 ? 12 : 0);
  if (zip64) {
    extra.writeUInt16LE(1);
    extra.writeUInt16LE(8, 2);
    extra.writeBigUInt64LE(BigInt(offset), 4);
  }
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(0x300 | version, 4);
  central.writeUInt16LE(version, 6);
  central.writeUInt16LE(0x800, 8);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(local.readUInt32LE(14), 16);
  central.writeUInt32LE(file.data.length, 20);
  central.writeUInt32LE(file.data.length, 24);
  central.writeUInt16LE(file.name.length, 28);
  central.writeUInt16LE(extra.length, 30);
  central.writeUInt32LE(0x81a40020, 38);
  central.writeUInt32LE(zip64 ? UINT32_MAX : offset, 42);
  return { local: Buffer.concat([local, file.name, file.data]), central: Buffer.concat([central, file.name, extra]) };
}

function newTrailer(metadata, directoryOffset, directorySize, count, comment) {
  const zip64 = metadata.zip64 || directoryOffset >= UINT32_MAX || directorySize >= UINT32_MAX || count >= UINT16_MAX;
  const parts = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(metadata.zip64 ? metadata.zip64.readUInt16LE(12) : 0x32d, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directorySize), 40);
    record.writeBigUInt64LE(BigInt(directoryOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50);
    locator.writeBigUInt64LE(BigInt(safeSum(directoryOffset, directorySize)), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(record, locator);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50);
  eocd.writeUInt16LE(Math.min(count, UINT16_MAX), 8);
  eocd.writeUInt16LE(Math.min(count, UINT16_MAX), 10);
  eocd.writeUInt32LE(Math.min(directorySize, UINT32_MAX), 12);
  eocd.writeUInt32LE(Math.min(directoryOffset, UINT32_MAX), 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...parts, eocd, comment]);
}

export async function prepareZipExtraFiles({ tail, total, comment, files, read }) {
  requireZip(Number.isSafeInteger(total) && total >= 22 && Buffer.isBuffer(tail)
    && tail.length === Math.min(total, ZIP_TAIL_BYTES), "Invalid ZIP inspection window.");
  requireZip(Buffer.isBuffer(comment) && comment.length <= UINT16_MAX && typeof read === "function", "Invalid ZIP extra inputs.");
  const additions = prepareFiles(files);
  const ranges = [{ start: total - tail.length, bytes: tail }];
  const load = async (start, length) => {
    requireZip(Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(length) && length >= 0
      && length <= MAX_DIRECTORY_BYTES && safeSum(start, length) <= total, "Invalid ZIP metadata read bounds.");
    if (!length) return Buffer.alloc(0);
    const cached = ranges.find((range) => start >= range.start && start + length <= range.start + range.bytes.length);
    if (cached) return cached.bytes.subarray(start - cached.start, start - cached.start + length);
    const bytes = await read(start, start + length - 1);
    requireZip(Buffer.isBuffer(bytes) && bytes.length === length, "Truncated ZIP metadata range.");
    ranges.push({ start, bytes });
    return bytes;
  };
  const metadata = await trailerMetadata(tail, total, comment, load);
  ranges.push({ start: metadata.scanStart, bytes: metadata.scan });
  const directory = await load(metadata.directoryOffset, metadata.directorySize);
  await validateDirectory(new MetadataReader(ranges), total, metadata, directory, additions);

  const locals = [];
  const centrals = [];
  let offset = metadata.directoryOffset;
  for (const file of additions) {
    const entry = newEntry(file, offset);
    locals.push(entry.local);
    centrals.push(entry.central);
    offset = safeSum(offset, entry.local.length);
  }
  const central = Buffer.concat(centrals);
  const directorySize = safeSum(metadata.directorySize, central.length);
  const trailer = newTrailer(metadata, offset, directorySize, metadata.count + additions.length, comment);
  safeSum(offset, directorySize, trailer.length);
  return { patches: [
    { start: metadata.directoryOffset, end: metadata.directoryOffset, bytes: Buffer.concat(locals) },
    { start: metadata.trailerStart, end: total, bytes: Buffer.concat([central, trailer]) },
  ], format: "zip" };
}
