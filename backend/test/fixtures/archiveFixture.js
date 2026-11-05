import { archiveCrc32 } from "../../src/utils/archiveCommentFormat.js";

export function zipFixture(data = Buffer.from("fixture 3ds Max content"), comment = "old comment") {
  const name = Buffer.from("fixture.max");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(archiveCrc32(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(archiveCrc32(data), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(local.length + name.length + data.length, 16);
  eocd.writeUInt16LE(Buffer.byteLength(comment), 20);
  return Buffer.concat([local, name, data, central, name, eocd, Buffer.from(comment)]);
}

export function rar4Header(type, flags, body = Buffer.alloc(0)) {
  const block = Buffer.alloc(7 + body.length);
  block[2] = type;
  block.writeUInt16LE(flags, 3);
  block.writeUInt16LE(block.length, 5);
  body.copy(block, 7);
  block.writeUInt16LE(archiveCrc32(block.subarray(2)) & 0xffff);
  return block;
}

export function rar4Fixture(data = Buffer.from("fixture 3ds Max content"), comment = "") {
  const name = Buffer.from("fixture.max");
  const fields = Buffer.alloc(25);
  fields.writeUInt32LE(data.length);
  fields.writeUInt32LE(data.length, 4);
  fields[8] = 2;
  fields.writeUInt32LE(archiveCrc32(data), 9);
  fields[17] = 29;
  fields[18] = 0x30;
  fields.writeUInt16LE(name.length, 19);
  fields.writeUInt32LE(0x20, 21);
  const cmt = Buffer.from(comment);
  const cmtFields = Buffer.from(fields);
  cmtFields.writeUInt32LE(cmt.length);
  cmtFields.writeUInt32LE(cmt.length, 4);
  cmtFields.writeUInt32LE(archiveCrc32(cmt), 9);
  cmtFields.writeUInt16LE(3, 19);
  cmtFields.writeUInt32LE(0, 21);
  return Buffer.concat([
    Buffer.from("526172211a0700", "hex"), rar4Header(0x73, 0, Buffer.alloc(6)),
    ...(comment ? [rar4Header(0x7a, 0x8000, Buffer.concat([cmtFields, Buffer.from("CMT")])), cmt] : []),
    rar4Header(0x74, 0x8000, Buffer.concat([fields, name])), data, rar4Header(0x7b, 0x4000),
  ]);
}
