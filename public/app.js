/* ==========================================================================
   看山 · 会饿的知乎代理  —  前端
   设计原则：
     1) 一屏一态，不滚动。看山说一句话，其余藏进「看看」。
     2) 所有数据来自 /data/story.json（离线用 zhihu-cli 抓真实数据生成）。
     3) CSP 是 style-src 'self' / script-src 'self' → 不用内联 style，也不用内联事件。
   ========================================================================== */

const PET = {
  sleepy:  '/ks-sleepy.gif',
  greet:   '/ks-greet.gif',
  standby: '/ks-standby.gif',
  wander:  '/ks-wander.gif',
};

const stage = document.getElementById('stage');
const dock = document.getElementById('dock');
const whoBtn = document.getElementById('who');
const panelToggle = document.getElementById('panel-toggle');
const panel = document.getElementById('panel');
const panelSummary = document.getElementById('panel-summary');
const panelGrid = document.getElementById('panel-grid');

let story = null;
let oauth = { status: null, profile: null };
let view = 'loading';
let cardIndex = 0;
let openDetail = false;
let invited = new Set(JSON.parse(localStorage.getItem('kanshan.invited') || '[]'));

/* ---------- 小工具 ---------- */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function pet(kind) {
  const img = el('img', `pet ${kind}`);
  img.src = PET[kind === 'leave' ? 'greet' : kind === 'back' ? 'standby' : kind];
  img.alt = '看山';
  img.addEventListener('error', () => {
    const box = el('div', 'pet-fallback');
    img.replaceWith(box);
  });
  return img;
}

function say(lines, hush) {
  const box = el('div', 'say');
  for (const line of lines) box.append(el('p', null, line));
  if (hush) box.append(el('p', 'hush', hush));
  return box;
}

function button(label, className, onClick) {
  const btn = el('button', className, label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

function clearStage() {
  stage.replaceChildren();
}

/* ---------- 视图：加载中 ---------- */
function renderLoading() {
  clearStage();
  stage.append(pet('sleepy'), el('p', 'caption', '……'));
}

/* ---------- 视图：还没登录 ---------- */
function renderGate() {
  clearStage();
  const ready = Boolean(oauth.status?.callbackConfigured);

  stage.append(pet('sleepy'));
  stage.append(say(
    ['我还不认识你。'],
    ready ? '用知乎账号登录，我才翻得到你的收藏。' : '我还住在你电脑里，出不了门。',
  ));

  if (ready) {
    stage.append(button('用知乎账号登录', 'btn', () => window.location.assign('/api/oauth/start')));
  } else {
    stage.append(say([], '部署到公网、配好回调地址之后，这里才会亮起来。'));
    const btn = button('用知乎账号登录', 'btn', () => {});
    btn.disabled = true;
    stage.append(btn);
  }

  if (oauth.status?.error) {
    stage.append(el('p', 'caption', `上次有点问题：${oauth.status.error.message}`));
  }
}

/* ---------- 视图：在家 ---------- */
function renderHome() {
  clearStage();
  const name = oauth.profile?.name;

  stage.append(pet('sleepy'));
  stage.append(say(
    story?.pet?.wake ?? ['我认得你。'],
    name ? `${name}，我翻了你的收藏。` : null,
  ));
  stage.append(button('让它出门', 'btn', goOut));
}

/* ---------- 视图：出门中 ---------- */
function renderOut() {
  clearStage();
  const walking = pet('leave');
  stage.append(walking);
  stage.append(el('p', 'caption', '出门了'));

  const dots = el('p', 'ellipsis');
  for (let i = 0; i < 3; i += 1) dots.append(el('i', null, '·'));
  stage.append(dots);

  window.setTimeout(() => {
    clearStage();
    const back = pet('back');
    stage.append(back);
    const count = story?.visits?.length ?? 0;
    stage.append(el('p', 'caption', `带回来 ${count} 张明信片`));
    window.setTimeout(() => { view = 'cards'; render(); }, 1100);
  }, 1500);
}

/* ---------- 视图：明信片 ---------- */
function renderCards() {
  clearStage();
  const visits = story?.visits ?? [];
  const visit = visits[cardIndex];
  if (!visit) return renderDone();

  stage.append(pet('standby'));

  const deck = el('div', 'deck');
  deck.append(postcard(visit));
  deck.append(nav(visits.length));
  stage.append(deck);

  if (cardIndex === visits.length - 1) {
    stage.append(el('p', 'caption', story?.summary?.[0] ?? ''));
  }
}

function postcard(visit) {
  const card = el('article', 'postcard');

  /* 抬头 */
  const face = el('div', 'face');
  face.append(el('div', 'mark', visit.name.slice(0, 1)));
  const who = el('div');
  const nameLine = el('div', 'name');
  const link = el('a', null, visit.name);
  link.href = `https://www.zhihu.com/people/${visit.urlToken}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  nameLine.append(link);
  who.append(nameLine);
  who.append(el('div', 'note', visit.headline || ''));
  face.append(who);
  card.append(face);

  /* 看山的一句话 —— 卡片唯一的正文 */
  card.append(el('div', 'line', `「${visit.line}」`));
  card.append(el('div', 'rel', visit.relation));

  /* 操作 */
  const acts = el('div', 'acts');
  acts.append(button(openDetail ? '收起来' : '看看', 'btn quiet', () => {
    openDetail = !openDetail;
    render();
  }));

  const isInvited = invited.has(visit.urlToken);
  acts.append(button(isInvited ? '已经记下了' : '想认识', 'btn', () => {
    invited.add(visit.urlToken);
    localStorage.setItem('kanshan.invited', JSON.stringify([...invited]));
    render();
  }));
  card.append(acts);

  /* 展开区 */
  if (openDetail) card.append(detail(visit));
  if (isInvited) card.append(letter(visit));

  return card;
}

function detail(visit) {
  const box = el('div', 'detail');
  const dl = el('dl');

  const addRow = (label, node) => {
    dl.append(el('dt', null, label));
    const dd = el('dd');
    dd.append(node);
    dl.append(dd);
    return dd;
  };

  /* 当年 */
  const then = el('div');
  const thenLink = el('a', null, visit.then.title);
  thenLink.href = visit.then.url;
  thenLink.target = '_blank';
  thenLink.rel = 'noopener noreferrer';
  then.append(thenLink);
  then.append(el('div', 'meta', `${visit.then.date} 收藏 · ${Number(visit.then.likes).toLocaleString('zh-CN')} 赞`));
  addRow('当年', then);

  /* 现在 */
  const now = el('div');
  if (visit.now) {
    const nowLink = el('a', null, visit.now.title);
    nowLink.href = visit.now.url;
    nowLink.target = '_blank';
    nowLink.rel = 'noopener noreferrer';
    now.append(nowLink);
    const meta = [visit.now.date, visit.now.authority ? `权威等级 ${visit.now.authority}` : null,
                  visit.now.likes != null ? `${Number(visit.now.likes).toLocaleString('zh-CN')} 赞` : null]
      .filter(Boolean).join(' · ');
    now.append(el('div', 'meta', meta));
  } else {
    now.append(el('span', null, '搜索召回 0 条'));
  }
  addRow('现在', now);

  box.append(dl);

  if (visit.verdict) {
    const v = el('div', 'verdict');
    v.append(el('b', null, '看山的判断'));
    v.append(el('div', null, visit.verdict));
    box.append(v);
  }
  if (visit.caveat) box.append(el('div', 'caveat', `※ ${visit.caveat}`));
  return box;
}

function letter(visit) {
  const box = el('div', 'detail');
  box.append(el('div', 'line', `「信我压在门口了。没有敲门 —— 你说你不好意思。」`));
  const pre = el('pre', 'meta', visit.invite || '');
  pre.classList.add('pre');
  box.append(pre);
  box.append(button('复制这封信', 'btn quiet', async (event) => {
    try {
      await navigator.clipboard.writeText(visit.invite || '');
      event.target.textContent = '已复制';
    } catch {
      event.target.textContent = '请手动选中复制';
    }
  }));
  return box;
}

function nav(total) {
  const nav = el('div', 'deck-nav');
  nav.append(button('←', 'ghost', () => {
    cardIndex = (cardIndex - 1 + total) % total; openDetail = false; render();
  }));
  const dots = el('div', 'dots');
  for (let i = 0; i < total; i += 1) {
    const dot = button('', `dot${i === cardIndex ? ' on' : ''}`, () => {
      cardIndex = i; openDetail = false; render();
    });
    dots.append(dot);
  }
  nav.append(dots);
  nav.append(button('→', 'ghost', () => {
    cardIndex = (cardIndex + 1) % total; openDetail = false; render();
  }));
  return nav;
}

function renderDone() {
  clearStage();
  stage.append(pet('standby'));
  stage.append(say(story?.summary ?? ['看完了。']));
  stage.append(button('再看一遍', 'btn', () => {
    cardIndex = 0; openDetail = false; view = 'cards'; render();
  }));
}

/* ---------- 出门 ---------- */
function goOut() {
  view = 'out';
  render();
}

/* ---------- 渲染分发 ---------- */
function render() {
  if (view === 'loading') return renderLoading();
  if (view === 'out') return renderOut();
  if (view === 'cards') return renderCards();
  if (oauth.status?.authorized) return renderHome();
  return renderGate();
}

/* ---------- 运行记录面板（OAuth 五项接口验收） ---------- */
function card(definition) {
  let node = panelGrid.querySelector(`[data-id="${definition.id}"]`);
  if (node) return node;
  node = el('article');
  node.dataset.id = definition.id;
  const row = el('div', 'row');
  row.append(el('span', null, 'OAuth 用户数据'));
  const state = el('b', 'state', '未运行');
  row.append(state);
  node.append(row);
  node.append(el('h3', null, definition.name));
  node.append(el('code', null, definition.endpoint));
  node.append(el('div', 'preview', '授权后自动请求一条数据'));
  panelGrid.append(node);
  return node;
}

function renderResult(result) {
  const node = card(result);
  const state = node.querySelector('.state');
  state.textContent = result.status === 'success' ? '成功' : result.status === 'empty' ? '空数据' : '失败';
  state.className = `state ${result.status}`;
  const preview = node.querySelector('.preview');
  preview.replaceChildren();
  if (result.status === 'success') {
    const item = result.item || {};
    preview.textContent = item.Title || item.Fullname || item.Description || '已返回结构化数据';
  } else {
    preview.textContent = result.message || '没有可展示的数据';
  }
}

async function runAll() {
  panelSummary.textContent = '正在请求…';
  try {
    const response = await fetch('/api/oauth/run-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.error?.message || '请求失败');
    payload.results.forEach(renderResult);
    const count = (status) => payload.results.filter((r) => r.status === status).length;
    panelSummary.textContent = `${count('success')} 成功 · ${count('empty')} 空数据 · ${count('error')} 失败`;
  } catch (error) {
    panelSummary.textContent = error.message;
  }
}

/* ---------- 事件接线 ---------- */
panelToggle.addEventListener('click', () => { panel.hidden = false; });
document.getElementById('panel-close').addEventListener('click', () => { panel.hidden = true; });
document.getElementById('run-all').addEventListener('click', runAll);
document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/oauth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  window.location.assign('/');
});
whoBtn.addEventListener('click', () => { panel.hidden = false; });

/* ---------- 启动 ---------- */
async function boot() {
  try {
    const [storyResponse, statusResponse] = await Promise.all([
      fetch('/data/story.json'),
      fetch('/api/oauth/status'),
    ]);
    story = await storyResponse.json();
    const status = await statusResponse.json();
    oauth.status = status;
    oauth.profile = status.profile ?? null;
    if (status.interfaces) status.interfaces.forEach(card);

    if (status.authorized) {
      const name = status.profile?.name || '已授权的知乎账号';
      whoBtn.textContent = name;
      whoBtn.hidden = false;
      panelToggle.hidden = false;
      dock.hidden = false;
      await runAll();
    }
    view = 'home';
    render();
  } catch (error) {
    clearStage();
    stage.append(el('p', 'caption', `启动失败：${error.message}`));
  }
}

boot();
