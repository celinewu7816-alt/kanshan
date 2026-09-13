/* ==========================================================================
   看山 · 会饿的知乎代理  —  前端
   设计原则：
     1) 一屏一态、不滚动。看山在屋子里，出门，回来，说话。
     2) 数据全部来自 /data/story.json（离线用 zhihu-cli 抓真实数据生成）。
     3) CSP 是 style-src 'self' / script-src 'self'：
        不用内联 style 属性，也不用内联事件处理器，全部走 addEventListener。
     4) 网址后加 ?grid=1 会叠一层 10% 调试网格，用来报坐标调看山站位。
   ========================================================================== */

const PET_IMG = {
  sleepy:  '/ks-sleepy.gif',
  standby: '/ks-standby.gif',
  wander:  '/ks-wander.gif',
  greet:   '/ks-greet.gif',
};

const stage = document.getElementById('stage');
const dock = document.getElementById('dock');
const whoBtn = document.getElementById('who');
const panelToggle = document.getElementById('panel-toggle');
const panel = document.getElementById('panel');
const panelSummary = document.getElementById('panel-summary');
const panelGrid = document.getElementById('panel-grid');

const showGrid = new URLSearchParams(window.location.search).get('grid') === '1';
// ?demo=1 预览模式：跳过登录直接看明信片。用于本地调视觉、录演示视频，
// 以及没有知乎账号的访客也能看到产品长什么样（会标注是示例账号的收藏）。
const demoMode = new URLSearchParams(window.location.search).get('demo') === '1';

let story = null;
let oauth = { status: null, profile: null };
let view = 'loading';
let groupIndex = 0;
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

function button(label, className, onClick) {
  const btn = el('button', className, label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

function say(lines, hush) {
  const box = el('div', 'say');
  for (const line of lines) box.append(el('p', null, line));
  if (hush) box.append(el('p', 'hush', hush));
  return box;
}

function clearStage() { stage.replaceChildren(); }

/* ---------- 屋子 ---------- */
// petKind: 'sleepy' | 'standby' | 'wander' | null（null = 屋子空着）
function room(petKind, extraClass, note) {
  const box = el('div', 'room');

  const bg = el('img', 'room-bg');
  bg.src = story?.room?.image || '/room.jpg';
  bg.alt = '';
  box.append(bg);

  if (petKind) {
    const pet = el('img', `pet ${extraClass || ''}`);
    pet.src = PET_IMG[petKind];
    pet.alt = '看山';
    pet.addEventListener('error', () => pet.remove());
    box.append(pet);
  }
  if (note) box.append(el('div', 'room-empty-note', note));

  if (showGrid) {
    box.append(el('div', 'grid-overlay'));
    box.append(el('div', 'grid-hint', '调试网格：每格 10%。看山双脚默认在 (50%, 76%)'));
  }
  return box;
}

/* ---------- 视图：加载中 ---------- */
function renderLoading() {
  clearStage();
  stage.append(room('sleepy'), el('p', 'caption', '……'));
}

/* ---------- 视图：还没登录 ---------- */
function renderGate() {
  clearStage();
  const ready = Boolean(oauth.status?.callbackConfigured);

  stage.append(room('sleepy'));
  stage.append(say(['我还不认识你。'], ready ? '用知乎账号登录，我才翻得到你的收藏。' : '我还出不了门。'));

  const login = button('用知乎账号登录', 'btn', () => {
    if (ready) window.location.assign('/api/oauth/start');
  });
  if (!ready) {
    login.disabled = true;
    stage.append(say([], '部署到公网、配好回调地址之后，这里才会亮起来。'));
  }
  stage.append(login);

  if (oauth.status?.error) {
    stage.append(el('p', 'caption', `上次有点问题：${oauth.status.error.message}`));
  }
}

/* ---------- 视图：在家 ---------- */
function renderHome() {
  clearStage();
  const name = oauth.profile?.name;
  stage.append(room('standby'));
  stage.append(say(story?.pet?.wake ?? ['我认得你。'], name ? `${name}，我翻了你的收藏。` : null));
  stage.append(button('让它出门', 'btn', goOut));
}

/* ---------- 视图：出门中 ---------- */
function renderOut() {
  clearStage();
  stage.append(room('wander', 'walking'));
  stage.append(el('p', 'caption', '出门了'));

  window.setTimeout(() => {
    clearStage();
    stage.append(room(null, null, '屋子里空着'));
    window.setTimeout(() => { view = 'cards'; render(); }, 2000);
  }, 1500);
}

/* ---------- 视图：明信片（两组） ---------- */
function currentGroup() { return story?.groups?.[groupIndex]; }

function renderCards() {
  clearStage();
  const group = currentGroup();
  const cards = group?.cards ?? [];
  const card = cards[cardIndex];
  if (!card) return renderDone();

  stage.append(room('standby'));

  if (demoMode && !oauth.status?.authorized) {
    stage.append(el('p', 'caption', '预览模式 · 下面是示例账号的真实收藏'));
  }
  if ((story?.groups?.length ?? 0) > 1) stage.append(tabs());
  if (group?.note) stage.append(el('p', 'group-note', group.note));

  const deck = el('div', 'deck');
  deck.append(postcard(card));
  deck.append(nav(cards.length));
  stage.append(deck);
}

function tabs() {
  const box = el('div', 'tabs');
  story.groups.forEach((group, index) => {
    box.append(button(group.label, `tab${index === groupIndex ? ' on' : ''}`, () => {
      groupIndex = index;
      cardIndex = 0;
      openDetail = false;
      render();
    }));
  });
  return box;
}

function postcard(card) {
  const node = el('article', 'postcard');

  /* 抬头 */
  const face = el('div', 'face');
  face.append(el('div', 'mark', card.name.slice(0, 1)));
  const who = el('div');
  const nameLine = el('div', 'name');
  const link = el('a', null, card.name);
  link.href = `https://www.zhihu.com/people/${card.urlToken}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  nameLine.append(link);
  who.append(nameLine);
  if (card.headline) who.append(el('div', 'note', card.headline));
  face.append(who);
  node.append(face);

  /* 看山的一句话 —— 卡片唯一的正文 */
  node.append(el('div', 'line', `「${card.line}」`));

  /* 推荐依据（为什么给你看这张） */
  if (card.basis) {
    const basis = el('div', 'basis');
    basis.append(el('b', null, '为什么给你看这张'));
    basis.append(el('div', null, card.basis));
    node.append(basis);
  }

  /* 操作 */
  const acts = el('div', 'acts');
  acts.append(button(openDetail ? '收起来' : '展开', 'btn quiet', () => {
    openDetail = !openDetail;
    render();
  }));

  const isInvited = invited.has(card.urlToken);
  acts.append(button(isInvited ? '已经记下了' : '想认识', 'btn', () => {
    invited.add(card.urlToken);
    localStorage.setItem('kanshan.invited', JSON.stringify([...invited]));
    render();
  }));
  node.append(acts);

  if (openDetail) node.append(detail(card));
  if (isInvited) node.append(letter(card));

  return node;
}

function detail(card) {
  const box = el('div', 'detail');
  const dl = el('dl');

  const addRow = (label, node) => {
    dl.append(el('dt', null, label));
    const dd = el('dd');
    dd.append(node);
    dl.append(dd);
  };

  if (card.then) {
    const then = el('div');
    const a = el('a', null, card.then.title);
    a.href = card.then.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    then.append(a);
    then.append(el('div', 'meta', `${card.then.date} 收藏 · ${Number(card.then.likes).toLocaleString('zh-CN')} 赞`));
    addRow('当年', then);
  }

  const now = el('div');
  if (card.now) {
    const a = el('a', null, card.now.title);
    a.href = card.now.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    now.append(a);
    const meta = [card.now.date,
                  card.now.authority ? `权威等级 ${card.now.authority}` : null,
                  card.now.likes != null ? `${Number(card.now.likes).toLocaleString('zh-CN')} 赞` : null]
      .filter(Boolean).join(' · ');
    now.append(el('div', 'meta', meta));
  } else {
    now.append(el('span', null, '搜索召回 0 条'));
  }
  addRow(card.then ? '现在' : 'TA 写过', now);

  box.append(dl);

  if (card.verdict) {
    const v = el('div', 'verdict');
    v.append(el('b', null, '看山的判断'));
    v.append(el('div', null, card.verdict));
    box.append(v);
  }
  if (card.caveat) box.append(el('div', 'caveat', `※ ${card.caveat}`));
  return box;
}

function letter(card) {
  const box = el('div', 'detail');
  box.append(el('div', 'line', '「信我压在门口了。没有敲门 —— 你说你不好意思。」'));
  if (card.invite) {
    box.append(el('pre', 'pre', card.invite));
    box.append(button('复制这封信', 'btn quiet', async (event) => {
      try {
        await navigator.clipboard.writeText(card.invite);
        event.target.textContent = '已复制';
      } catch {
        event.target.textContent = '请手动选中复制';
      }
    }));
  }
  return box;
}

function nav(total) {
  const bar = el('div', 'deck-nav');
  bar.append(button('←', 'ghost', () => {
    cardIndex = (cardIndex - 1 + total) % total; openDetail = false; render();
  }));
  const dots = el('div', 'dots');
  for (let i = 0; i < total; i += 1) {
    dots.append(button('', `dot${i === cardIndex ? ' on' : ''}`, () => {
      cardIndex = i; openDetail = false; render();
    }));
  }
  bar.append(dots);
  bar.append(button('→', 'ghost', () => {
    cardIndex = (cardIndex + 1) % total; openDetail = false; render();
  }));
  return bar;
}

function renderDone() {
  clearStage();
  stage.append(room('standby'));
  stage.append(say(story?.summary ?? ['看完了。']));
  stage.append(button('再看一遍', 'btn', () => {
    groupIndex = 0; cardIndex = 0; openDetail = false; view = 'cards'; render();
  }));
}

function goOut() { view = 'out'; render(); }

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
  row.append(el('b', 'state', '未运行'));
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
    const response = await fetch('/api/oauth/run-all', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
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
      whoBtn.textContent = status.profile?.name || '已授权的知乎账号';
      whoBtn.hidden = false;
      panelToggle.hidden = false;
      dock.hidden = false;
      await runAll();
    }
    view = demoMode ? 'cards' : 'home';
    render();
  } catch (error) {
    clearStage();
    stage.append(el('p', 'caption', `启动失败：${error.message}`));
  }
}

boot();
