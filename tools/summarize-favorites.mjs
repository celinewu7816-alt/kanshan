// 把 `me favorites` 的原始输出摘要成一张紧凑表，方便挑候选作者、写卡片。
// 与 extract-search.mjs / list-authors.mjs 同一套：原文几百字的 ContentText
// 直接读会淹没上下文，这里只留判据需要的字段。
//
// 用法: node tools/summarize-favorites.mjs <favorites.json>

import { readFile } from 'node:fs/promises';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('用法: node tools/summarize-favorites.mjs <favorites.json>');
  process.exit(2);
}

const raw = JSON.parse(await readFile(file, 'utf8'));
const items = raw?.Data?.Items ?? [];
const flat = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const day = (seconds) => (seconds ? new Date(Number(seconds) * 1000).toISOString().slice(0, 10) : '?');

console.log(`file=${file}`);
console.log(`条数=${items.length}`);
if (items[0]) console.log(`字段=${Object.keys(items[0]).join(', ')}`);
if (items[0]?.Author) console.log(`Author字段=${Object.keys(items[0].Author).join(', ')}`);
console.log('');

items.forEach((item, index) => {
  const author = item.Author ?? {};
  const name = author.Name ?? author.Fullname ?? item.AuthorName ?? '?';
  const token = author.UrlToken ?? item.AuthorSignature ?? '?';
  const likes = item.LikeCount ?? item.VoteUpCount ?? '?';
  console.log(`${index + 1}. [${day(item.FavTime ?? item.CreatedAt)}] ${flat(name)} (${token}) 赞=${likes} ${flat(item.ContentType)}`);
  console.log(`   ${flat(item.Title).slice(0, 70)}`);
  console.log(`   ${String(item.Url ?? '').split('?')[0]}`);
});
