// 读取 JPEG 的宽高，用于前端布局（aspect-ratio / max-width）。
//
// 为什么需要它：当前模型没有视觉能力，看不到图片内容，但布局必须知道
// 图片的宽高比，否则会拉伸变形。JPEG 的尺寸在 SOF 标记里，直接解析即可。

import { readFile } from 'node:fs/promises';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('用法: node tools/image-size.mjs <图片文件>');
  process.exit(2);
}

const buf = await readFile(file);

// JPEG: 逐段扫描，找 SOF0/SOF1/SOF2 等（0xFFC0~0xFFCF，排除 C4/DHT、C8/JPG、CC/DAC）
let offset = 2;
while (offset < buf.length - 9) {
  if (buf[offset] !== 0xff) { offset += 1; continue; }
  const marker = buf[offset + 1];
  if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
    const height = buf.readUInt16BE(offset + 5);
    const width = buf.readUInt16BE(offset + 7);
    const ratio = width / height;
    console.log(`文件: ${file}`);
    console.log(`字节: ${buf.length}`);
    console.log(`尺寸: ${width} x ${height}`);
    console.log(`比例: ${ratio.toFixed(4)}`);
    console.log(`建议: width:100%; aspect-ratio: ${ratio.toFixed(4)}`);
    process.exit(0);
  }
  if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
  const segmentLength = buf.readUInt16BE(offset + 2);
  if (!segmentLength) break;
  offset += 2 + segmentLength;
}

console.log('未能解析出 JPEG 尺寸（可能不是标准 JPEG）。');
process.exit(1);
