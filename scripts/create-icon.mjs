import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const size = 256;
const pixels = Buffer.alloc(size * (1 + size * 4));
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(name, data) {
  const type = Buffer.from(name);
  const body = Buffer.concat([type, data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length);
  body.copy(output, 4);
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4);
  return output;
}
function segment(x, y, ax, ay, bx, by, width) {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) <= width;
}
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const offset = y * (1 + size * 4) + 1 + x * 4;
    const inside = Math.hypot(Math.max(0, Math.abs(x - 127.5) - 76), Math.max(0, Math.abs(y - 127.5) - 76)) <= 46;
    const mark = segment(x, y, 68, 79, 103, 177, 13) || segment(x, y, 138, 79, 103, 177, 13) || Math.hypot(x - 187, y - 83) < 14;
    pixels.set(inside ? (mark ? [225, 236, 200, 255] : [37, 79, 64, 255]) : [0, 0, 0, 0], offset);
  }
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
mkdirSync(new URL("../desktop/assets/", import.meta.url), { recursive: true });
writeFileSync(new URL("../desktop/assets/icon.png", import.meta.url), png);
writeFileSync(new URL("../desktop/assets/icon.ico", import.meta.url), Buffer.concat([ico, png]));
console.log("Desktop icons generated.");
