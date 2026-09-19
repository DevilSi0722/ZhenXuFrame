import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../public/', import.meta.url));
const frame = 'M14 14H46V22H22V30H34V38H22V50H14Z';
const play = 'M38 34L50 42L38 50Z';
function artwork({ rounded = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"${rounded ? ' rx="14"' : ''} fill="#117b54"/><path d="${frame}" fill="#fff"/><path d="${play}" fill="#b9f4d1"/></svg>\n`;
}
await mkdir(output, { recursive: true });
await writeFile(`${output}/favicon.svg`, artwork({ rounded: true }));
// Safari pinned tabs require a single black layer on transparency, viewBox 0 0 16 16.
await writeFile(`${output}/safari-pinned-tab.svg`, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#000" d="M3.5 3.5H11.5V5.5H5.5V7.5H8.5V9.5H5.5V12.5H3.5ZM9.5 8.5L12.5 10.5L9.5 12.5Z"/></svg>\n');
await writeFile(`${output}/logo.svg`, artwork());
// Opaque square PNGs: Apple applies its own corner mask, so don't bake in rounded corners.
for (const [name, size] of [
  ['apple-touch-icon.png', 180], ['apple-touch-icon-167x167.png', 167],
  ['apple-touch-icon-152x152.png', 152], ['icon-192.png', 192],
  ['icon-512.png', 512], ['logo-1024.png', 1024],
]) {
  await sharp(Buffer.from(artwork())).resize(size, size).removeAlpha().png().toFile(`${output}/${name}`);
}
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(size => sharp(Buffer.from(artwork({ rounded: true }))).resize(size, size).png().toBuffer()));
for (let i = 0; i < sizes.length; i++) await writeFile(`${output}/favicon-${sizes[i]}x${sizes[i]}.png`, images[i]);
// ICO directory with PNG payloads for modern browsers and legacy favicon discovery.
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16;
  header[entry] = header[entry + 1] = sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
}
await writeFile(`${output}/favicon.ico`, Buffer.concat([header, ...images]));
console.log('Generated FRAME logo, favicon, Apple touch icons and Safari pinned-tab mask.');
