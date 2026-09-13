// 从 `zhihu-cli search zhihu` 的原始输出里，列出命中的所有作者。
//
// 与 extract-search.mjs 的区别：
//   extract-search.mjs —— 已知某个作者，验证"搜索能不能召回他"（按 AuthorSignature 过滤）
//   list-authors.mjs   —— 不知道有谁，反查"这个话题下有哪些作者"（用于找同好）
//
// 用法:
//   node tools/list-authors.mjs <search.json> [要排除的UrlToken ...]
//
// 排除项用来剔掉"你已经收藏/关注过的人"和"收藏内容的原作者"——
// 那些属于「你认识的人」，不该出现在「你可能想认识的人」里。

import { readFile } from 'node:fs/promises';

const [file, ...exclude] = process.argv.slice(2);
if (!file) {
  console.error('用法: node tools/list-authors.mjs <search.json> [要排除的UrlToken ...]');
  process.exit(2);
}

const raw = JSON.parse(await readFile(file, 'utf8'));
const items = raw?.Data?.Items ?? [];
const excludeSet = new Set(exclude);

const byAuthor = new Map();
for (const item of items) {
  const token = item.AuthorSignature;
  if (!token || excludeSet.has(token)) continue;
  const entry = byAuthor.get(token) ?? { token, name: item.AuthorName, items: [] };
  entry.items.push(item);
  byAuthor.set(token, entry);
}

const num = (value) => Number(value) || 0;
const rows = [...byAuthor.values()]
  .map((entry) => ({
    ...entry,
    bestAuth: entry.items.reduce((a, b) => (num(b.AuthorityLevel) > num(a.AuthorityLevel) ? b : a)),
    topVote: entry.items.reduce((a, b) => (num(b.VoteUpCount) > num(a.VoteUpCount) ? b : a)),
  }))
  .sort((a, b) => num(b.bestAuth.AuthorityLevel) - num(a.bestAuth.AuthorityLevel)
               || num(b.topVote.VoteUpCount) - num(a.topVote.VoteUpCount));

console.log(`file=${file}`);
console.log(`召回=${items.length}  作者=${rows.length}  已排除=${excludeSet.size}`);
console.log('');

for (const row of rows) {
  const flat = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  const day = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);
  console.log(`[权威${row.bestAuth.AuthorityLevel}] ${flat(row.name)}  (${row.token})  命中 ${row.items.length} 篇`);
  console.log(`   ${flat(row.topVote.Title).slice(0, 56)}`);
  console.log(`   ${day(row.topVote.EditTime)} · ${row.topVote.VoteUpCount} 赞 · ${row.topVote.Url.split('?')[0]}`);
  console.log(`   主页 https://www.zhihu.com/people/${row.token}`);
}

if (rows.length === 0) {
  console.log('⚠️ 没有可用的作者（全部被排除，或该查询召回为空）。');
}
