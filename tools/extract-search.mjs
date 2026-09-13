// 从 `zhihu-cli search zhihu` 的原始输出里，抽出指定作者的条目。
//
// 存在的理由：
//   1) 搜索是按相关性召回的，会混入同名文本命中的无关内容 → 必须按 AuthorSignature 精确过滤；
//   2) 原始 JSON 每条都带几百字 ContentText，直接读进来会淹没上下文 → 这里只摘要点。
//
// 用法:
//   node tools/extract-search.mjs <search.json> <作者UrlToken>
//
// AuthorSignature 就是作者的 UrlToken（已在收藏接口里交叉验证过）。

import { readFile } from 'node:fs/promises';

const [file, token] = process.argv.slice(2);
if (!file || !token) {
  console.error('用法: node tools/extract-search.mjs <search.json> <作者UrlToken>');
  process.exit(2);
}

const raw = JSON.parse(await readFile(file, 'utf8'));
const items = raw?.Data?.Items ?? [];
const hits = items.filter((item) => item.AuthorSignature === token);

const day = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);
const flat = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

console.log(`file=${file}`);
console.log(`token=${token}  召回=${items.length}  精确命中=${hits.length}`);
console.log('');

for (const item of hits) {
  console.log(`[${day(item.EditTime)}] 权威=${item.AuthorityLevel} 赞=${item.VoteUpCount} 评=${item.CommentCount} ${item.ContentType}`);
  console.log(`  标题: ${flat(item.Title)}`);
  console.log(`  链接: ${item.Url.split('?')[0]}`);
  console.log(`  摘要: ${flat(item.ContentText).slice(0, 120)}`);
  console.log('');
}

if (hits.length === 0) {
  console.log('⚠️ 该查询召回 0 条该作者的内容。');
  console.log('   注意：这只能说明「搜索不到」，不能推断为「已停更」——');
  console.log('   无法区分「作者停更」与「搜索索引未覆盖」。');
}
