export const ZIP_TAIL_BYTES = 65557;
export const RAR_PREFIX_BYTES = 128 * 1024;
const RAR5_MAGIC = Buffer.from("526172211a070100", "hex");

export function archiveFormatError(message = "This archive cannot safely receive a comment.") {
  return Object.assign(new Error(message), { status: 422, code: "ARCHIVE_COMMENT_UNSUPPORTED" });
}

export function zipCommentPatch(tail, total, comment) {
  const candidates = [];
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) candidates.push(i);
  }
  if (candidates.length !== 1) throw archiveFormatError("ZIP end record is missing or ambiguous.");
  const offset = candidates[0];
  const start = total - tail.length + offset;
  const eocd = Buffer.from(tail.subarray(offset, offset + 22));
  if (eocd.readUInt16LE(4) || eocd.readUInt16LE(6) || eocd.readUInt16LE(8) !== eocd.readUInt16LE(10)) {
    throw archiveFormatError("Split ZIP archives are not supported.");
  }
  const directorySize = eocd.readUInt32LE(12);
  const directoryOffset = eocd.readUInt32LE(16);
  if (directorySize === 0xffffffff || directoryOffset === 0xffffffff || eocd.readUInt16LE(10) === 0xffff) {
    if (offset < 20 || tail.readUInt32LE(offset - 20) !== 0x07064b50
      || tail.readUInt32LE(offset - 16) !== 0 || tail.readUInt32LE(offset - 4) !== 1) throw archiveFormatError("Invalid ZIP64 locator.");
  } else if (directoryOffset + directorySize > start) throw archiveFormatError("Invalid ZIP directory bounds.");
  if (comment.length > 65535) throw archiveFormatError("ZIP comment is too long.");
  eocd.writeUInt16LE(comment.length, 20);
  return { start, end: total, bytes: Buffer.concat([eocd, comment]), format: "zip" };
}

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let crc = i;
  for (let j = 0; j < 8; j += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

export function archiveCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function rarVint(number) {
  const bytes = [];
  do {
    const byte = number % 128;
    number = Math.floor(number / 128);
    bytes.push(byte | (number ? 128 : 0));
  } while (number);
  return Buffer.from(bytes);
}

function vint(buffer, cursor, end = buffer.length) {
  let value = 0;
  let multiplier = 1;
  for (let count = 0; count < 8; count += 1) {
    if (cursor.at >= end) throw archiveFormatError("Truncated RAR header.");
    const byte = buffer[cursor.at++];
    value += (byte & 127) * multiplier;
    if (!Number.isSafeInteger(value)) throw archiveFormatError("Oversized RAR integer.");
    if (!(byte & 128)) return value;
    multiplier *= 128;
  }
  throw archiveFormatError("Invalid RAR integer.");
}

export function rar5Block(body) {
  const data = Buffer.concat([rarVint(body.length), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32LE(archiveCrc32(data));
  return Buffer.concat([crc, data]);
}

function rarHeader(buffer, start) {
  const cursor = { at: start + 4 };
  const size = vint(buffer, cursor);
  const end = cursor.at + size;
  if (size > RAR_PREFIX_BYTES || end > buffer.length || cursor.at - start - 4 > 3) throw archiveFormatError("RAR header exceeds the safe inspection window.");
  if (archiveCrc32(buffer.subarray(start + 4, end)) !== buffer.readUInt32LE(start)) throw archiveFormatError("RAR header checksum failed.");
  const type = vint(buffer, cursor, end);
  const flags = vint(buffer, cursor, end);
  const extraSize = flags & 1 ? vint(buffer, cursor, end) : 0;
  const dataSize = flags & 2 ? vint(buffer, cursor, end) : 0;
  const extraStart = end - extraSize;
  if (extraStart < cursor.at) throw archiveFormatError("Invalid RAR extra area.");
  return { type, flags, dataSize, cursor, end, extraStart };
}

function rarCommentBlock(comment) {
  const crc = Buffer.alloc(4);
  crc.writeUInt32LE(archiveCrc32(comment));
  // CMT is an uncompressed UTF-8 service block, not a file entry.
  return Buffer.concat([rar5Block(Buffer.concat([
    rarVint(3), rarVint(2), rarVint(comment.length), rarVint(4), rarVint(comment.length),
    rarVint(0), crc, rarVint(0), rarVint(0), rarVint(3), Buffer.from("CMT"),
  ])), comment]);
}

export function rar5CommentPatch(prefix, total, comment) {
  if (!prefix.subarray(0, 8).equals(RAR5_MAGIC)) throw archiveFormatError("Only plain RAR5 archives are supported; RAR4 and SFX are unchanged on Drive.");
  const main = rarHeader(prefix, 8);
  if (main.type !== 1 || main.flags & ~5) throw archiveFormatError("Encrypted or unsupported RAR main header.");
  const archiveFlags = vint(prefix, main.cursor, main.extraStart);
  if (archiveFlags & ~4) throw archiveFormatError("RAR volumes, recovery records and locked archives are not supported.");
  if (main.cursor.at !== main.extraStart) throw archiveFormatError("Unknown RAR main fields.");
  const extras = [];
  const cursor = { at: main.extraStart };
  while (cursor.at < main.end) {
    const start = cursor.at;
    const size = vint(prefix, cursor, main.end);
    const end = cursor.at + size;
    if (!size || end > main.end) throw archiveFormatError("Invalid RAR extra record.");
    const type = vint(prefix, cursor, end);
    // Locator offsets would become stale after insertion. RAR permits sequential discovery.
    if (type !== 1) extras.push(prefix.subarray(start, end));
    cursor.at = end;
  }
  const extra = Buffer.concat(extras);
  const newMain = rar5Block(Buffer.concat([rarVint(1), rarVint((main.flags & 4) | (extra.length ? 1 : 0)),
    ...(extra.length ? [rarVint(extra.length)] : []), rarVint(archiveFlags), extra]));
  let end = main.end;
  const next = rarHeader(prefix, end);
  if (next.type === 3) {
    const c = next.cursor;
    const fileFlags = vint(prefix, c, next.extraStart);
    vint(prefix, c, next.extraStart);
    vint(prefix, c, next.extraStart);
    if (fileFlags & 2) c.at += 4;
    if (fileFlags & 4) c.at += 4;
    vint(prefix, c, next.extraStart);
    vint(prefix, c, next.extraStart);
    const nameLength = vint(prefix, c, next.extraStart);
    if (c.at + nameLength > next.extraStart || prefix.subarray(c.at, c.at + nameLength).toString("ascii") !== "CMT"
      || next.flags & ~3 || next.end + next.dataSize > prefix.length) throw archiveFormatError("Unsupported RAR comment block.");
    end = next.end + next.dataSize;
  } else if (next.type !== 2 && next.type !== 5) throw archiveFormatError("Unexpected RAR archive layout.");
  if (end > total) throw archiveFormatError("Invalid RAR bounds.");
  return { start: 8, end, bytes: Buffer.concat([newMain, rarCommentBlock(comment)]), format: "rar5" };
}
