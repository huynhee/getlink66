import { archiveCrc32, archiveFormatError } from "./archiveCommentFormat.js";

export const RAR4_MAGIC = Buffer.from("526172211a0700", "hex");

function header(prefix, start) {
  if (start + 7 > prefix.length) throw archiveFormatError("Truncated RAR4 header.");
  const size = prefix.readUInt16LE(start + 5);
  const end = start + size;
  if (size < 7 || end > prefix.length) throw archiveFormatError("RAR4 header exceeds the safe inspection window.");
  if ((archiveCrc32(prefix.subarray(start + 2, end)) & 0xffff) !== prefix.readUInt16LE(start)) {
    throw archiveFormatError("RAR4 header checksum failed.");
  }
  return { type: prefix[start + 2], flags: prefix.readUInt16LE(start + 3), size, end };
}

function commentBlock(comment) {
  const data = Buffer.from(comment.toString("utf8"), "utf16le");
  const block = Buffer.alloc(35);
  block[2] = 0x7a;
  block.writeUInt16LE(0x8000, 3);
  block.writeUInt16LE(block.length, 5);
  block.writeUInt32LE(data.length, 7);
  block.writeUInt32LE(data.length, 11);
  block[15] = 2;
  block.writeUInt32LE(archiveCrc32(data), 16);
  block[24] = 29;
  block[25] = 0x30;
  block.writeUInt16LE(3, 26);
  // RAR3/4 CMT service headers use FileAttr as SubFlags; bit 0 denotes UTF-16LE.
  block.writeUInt32LE(1, 28);
  block.write("CMT", 32, "ascii");
  block.writeUInt16LE(archiveCrc32(block.subarray(2)) & 0xffff);
  return Buffer.concat([block, data]);
}

export function rar4CommentPatch(prefix, total, comment, tail) {
  if (!prefix.subarray(0, 7).equals(RAR4_MAGIC)) throw archiveFormatError("Not a plain RAR4 archive.");
  const main = header(prefix, 7);
  if (main.type !== 0x73 || main.size !== 13 || main.flags & ~0x18
    || prefix.readUInt16LE(14) || prefix.readUInt32LE(16)) {
    throw archiveFormatError("RAR4 volumes, encrypted headers, recovery records, signatures and legacy main comments are not supported.");
  }
  // Do not invalidate archive-wide CRCs or volume/recovery offsets by inserting bytes.
  if (!tail || tail.length !== 7) throw archiveFormatError("RAR4 end record is missing.");
  const endRecord = header(tail, 0);
  if (endRecord.type !== 0x7b || endRecord.size !== 7 || endRecord.flags & ~0x4000) {
    throw archiveFormatError("RAR4 requires a plain single-volume end record without an archive-wide checksum.");
  }
  let end = main.end;
  let next = header(prefix, end);
  if (next.type === 0x7a) {
    if (next.flags & ~0xc000 || !(next.flags & 0x8000) || next.size < 35
      || prefix.readUInt16LE(end + 26) !== 3 || prefix.toString("ascii", end + 32, end + 35) !== "CMT") {
      throw archiveFormatError("Unsupported RAR4 service header before the first file.");
    }
    const commentEnd = next.end + prefix.readUInt32LE(end + 7);
    if (commentEnd > prefix.length || commentEnd > total - 7) throw archiveFormatError("RAR4 comment exceeds the safe inspection window.");
    end = commentEnd;
    next = header(prefix, end);
  }
  if (next.type === 0x74) {
    if (next.size < 32 || !(next.flags & 0x8000) || next.flags & 3) throw archiveFormatError("Invalid or split RAR4 file header.");
    const large = Boolean(next.flags & 0x100);
    const nameSize = prefix.readUInt16LE(end + 26);
    if (next.size < 32 + (large ? 8 : 0) + nameSize) throw archiveFormatError("Invalid RAR4 file name bounds.");
    const packedSize = prefix.readUInt32LE(end + 7) + (large ? prefix.readUInt32LE(end + 32) * 0x100000000 : 0);
    if (!Number.isSafeInteger(packedSize) || next.end + packedSize > total - 7) throw archiveFormatError("Invalid RAR4 file bounds.");
  } else if (next.type !== 0x7b || end !== total - 7) {
    throw archiveFormatError("Unexpected RAR4 archive layout.");
  }
  return { start: 7, end, bytes: Buffer.concat([prefix.subarray(7, main.end), commentBlock(comment)]), format: "rar4" };
}
