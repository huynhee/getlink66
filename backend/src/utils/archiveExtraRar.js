import { archiveCrc32, archiveFormatError, rar5Block, rarVint } from "./archiveCommentFormat.js";

export const RAR_END_INSPECTION_BYTES = 32;

function rar4File({ name, text }) {
  const filename = Buffer.from(name, "ascii");
  const data = Buffer.from(text, "utf8");
  const header = Buffer.alloc(32 + filename.length);
  header[2] = 0x74;
  header.writeUInt16LE(0x8000, 3);
  header.writeUInt16LE(header.length, 5);
  header.writeUInt32LE(data.length, 7);
  header.writeUInt32LE(data.length, 11);
  header[15] = 2;
  header.writeUInt32LE(archiveCrc32(data), 16);
  header.writeUInt32LE(0x00210000, 20);
  header[24] = 29;
  header[25] = 0x30;
  header.writeUInt16LE(filename.length, 26);
  header.writeUInt32LE(0x20, 28);
  filename.copy(header, 32);
  header.writeUInt16LE(archiveCrc32(header.subarray(2)) & 0xffff);
  return Buffer.concat([header, data]);
}

function rar5File({ name, text }) {
  const filename = Buffer.from(name, "utf8");
  const data = Buffer.from(text, "utf8");
  const timeAndCrc = Buffer.alloc(8);
  timeAndCrc.writeUInt32LE(315532800);
  timeAndCrc.writeUInt32LE(archiveCrc32(data), 4);
  return Buffer.concat([rar5Block(Buffer.concat([
    rarVint(2), rarVint(2), rarVint(data.length), rarVint(6), rarVint(data.length), rarVint(0x20),
    timeAndCrc, rarVint(0), rarVint(0), rarVint(filename.length), filename,
  ])), data]);
}

function rar5EndStart(tail) {
  const candidates = [];
  for (let i = 0; i <= tail.length - 8; i += 1) {
    // Plain RAR5 end records have no extra/data areas, volume flags or variable fields.
    const record = tail.subarray(i);
    if (record.length === 8 && record[4] === 3 && record[5] === 5
      && (record[6] === 0 || record[6] === 4) && record[7] === 0
      && archiveCrc32(record.subarray(4)) === record.readUInt32LE(0)) candidates.push(i);
  }
  if (candidates.length !== 1) throw archiveFormatError("RAR5 needs a plain single-volume end record to add information files.");
  return candidates[0];
}

export function rarExtraFilesPatch(format, tail, total, files) {
  let start;
  if (format === "rar4") {
    const end = tail.subarray(-7);
    if (end.length !== 7 || end[2] !== 0x7b || end.readUInt16LE(5) !== 7 || end.readUInt16LE(3) & ~0x4000
      || (archiveCrc32(end.subarray(2)) & 0xffff) !== end.readUInt16LE(0)) throw archiveFormatError("Invalid RAR4 end record.");
    start = total - 7;
  } else if (format === "rar5") start = total - tail.length + rar5EndStart(tail);
  else throw archiveFormatError("Unsupported RAR information file format.");
  // Append before the end record, after all original files, so solid dictionaries stay untouched.
  return { start, end: start, bytes: Buffer.concat(files.map(format === "rar4" ? rar4File : rar5File)) };
}
