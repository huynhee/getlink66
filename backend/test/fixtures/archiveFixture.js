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
