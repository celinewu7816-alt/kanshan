/* ==========================================================================
   看山 · 会饿的知乎代理  —  前端
   设计原则：
     1) 屋子（#stage）就是整个界面：尺寸按房间图（1408:768）锁定并收进视口，
        所有零件都绝对定位在它之内，不会有东西跑到屋子外面，也不出现滚动。
     2) 一屏一态：在屋 → 出门 → 收信笺。看山说话用对话框（像 AVG）。
     3) 数据来自 /data/story.json（离线用 zhihu-cli 抓真实数据生成）。
     4) CSP 是 style-src 'self' / script-src 'self'：不用内联 style 属性，
        也不用内联事件处理器，全部 addEventListener。
     5) 网址后加 ?grid=1 叠 10% 调试网格。
   ========================================================================== */

const PET_IMG = {
  sleepy:  '/ks-sleepy.gif',
  standby: '/ks-standby.gif',
  wander:  '/ks-wander.gif',
  greet:   '/ks-greet.gif',
};

const stage = document.getElementById('stage');
const view = document.getElementById('view');       // 屋子框架里放内容的那一层
const dock = document.getElementById('dock');
const whoBtn = document.getElementById('who');
const loginBtn = document.getElementById('login');
const panelToggle = document.getElementById('panel-toggle');
const panel = document.getElementById('panel');
const panelSummary = document.getElementById('panel-summary');
const panelGrid = document.getElementById('panel-grid');

const showGrid = new URLSearchParams(window.location.search).get('grid') === '1';

let story = null;
let oauth = { status: null, profile: null };
let screen = 'loading';                              // 当前是哪一屏
let groupIndex = 0;
let cardIndex = 0;
// 信笺上展开的是哪一块：null（收起）| 'detail'（当年/后来）| 'letter'（邀请信）。
// 两者互斥 —— 同时展开会叠得很高，撑破屋子。
let open = null;
// 两个集合分开记：invited = 看山已经替你写好邀请信（先给你看）；
// sent = 你确认过、已经把信寄出去。演示环境里没有发布/私信接口，
// 所以「寄出」只落在这个本地记录上 —— 这件事在信里与计划书中都如实写明。
let invited = new Set(JSON.parse(localStorage.getItem('kanshan.invited') || '[]'));
let sent = new Set(JSON.parse(localStorage.getItem('kanshan.sent') || '[]'));
// 点完之后新出现的信在卡片底部，而卡片是会内部滚动的 —— 不滚到底就看不见，
// 反馈就"消失"了。用这个标记让这次渲染后自动滚到底。
let scrollCardToEnd = false;

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
  // 统一阻止冒泡：信笺整张卡是可点的（轻点翻下一张），
  // 里面的按钮和链接不该把点击传到卡片上。
  btn.addEventListener('click', (event) => { event.stopPropagation(); onClick(event); });
  return btn;
}

function say(lines, hush) {
  const box = el('div', 'say');
  for (const line of lines) box.append(el('p', null, line));
  if (hush) box.append(el('p', 'hush', hush));
  return box;
}

function clearView() { view.replaceChildren(); }

/* ---------- 在屋子里摆看山 ---------- */
// petKind: 'sleepy' | 'standby' | 'wander' | null（null = 屋子空着）
// 房间图由 index.html 铺在底层，这里只追加角色与叠加层。
function paintRoom(petKind, extraClass, note) {
  if (petKind) {
    const pet = el('img', `pet ${extraClass || ''}`);
    pet.src = PET_IMG[petKind];
    pet.alt = '看山';
    pet.addEventListener('error', () => pet.remove());
    view.append(pet);
  }
  if (note) view.append(el('div', 'room-empty-note', note));

  if (showGrid) {
    view.append(el('div', 'grid-overlay'));
    view.append(el('div', 'grid-hint', '调试网格：每格 10%。看山站着 (30%, 80%)，门在 (80%, 80%)'));
  }
}

/* ---------- 视图：加载中 ---------- */
function renderLoading() {
  clearView();
  paintRoom('sleepy');
  view.append(el('p', 'say', '……'));
}

/* ---------- 视图：在家 ---------- */
function renderHome() {
  clearView();
  // 进门这一屏只留「让它出门」，看山的开场白和 demo 提示都撤掉
  paintRoom('standby');
  view.append(button('让它出门', 'btn', goOut));
}

/* ---------- 视图：出门中 ---------- */
function renderOut() {
  clearView();
  paintRoom('wander', 'walking');
  view.append(el('p', 'say', '出门了'));

  window.setTimeout(() => {
    clearView();
    paintRoom(null, null, '屋子里空着');
    window.setTimeout(() => { screen = 'cards'; render(); }, 2000);
  }, 1500);
}

/* ---------- 视图：信笺（两组） ---------- */
// 每一趟出门都带回来「每组各 PER_TRIP 封」；批次每趟往后挪 PER_TRIP 张，
// 走到末尾就绕回开头 —— 于是每趟恰好是「一封新的 + 上一趟的前两封」。
const PER_TRIP = 3;
let trip = -1;                       // 第几趟（每次 goOut +1；-1 = 还没出过门）

// 某一组这一趟带回来的卡片：从 (trip * PER_TRIP) 起连拿 PER_TRIP 张，绕圈取
function tripCardsOf(group) {
  const all = group?.cards ?? [];
  if (all.length <= PER_TRIP) return all;          // 不够一批就全带上，不重复
  const start = (trip * PER_TRIP) % all.length;
  const cards = [];
  for (let i = 0; i < PER_TRIP; i += 1) cards.push(all[(start + i) % all.length]);
  return cards;
}

// 这一趟每一组带回来的卡片；这一批没有卡片的组直接不列出来
function tripGroups() {
  const list = [];
  for (const group of story?.groups ?? []) {
    const cards = tripCardsOf(group);
    if (cards.length) list.push({ group, cards });
  }
  return list;
}

function currentTripCards() { return tripGroups()[groupIndex]?.cards ?? []; }

function renderCards() {
  clearView();
  const list = tripGroups();
  const entry = list[groupIndex];
  if (!entry) return renderDone();
  const cards = entry.cards;
  const card = cards[cardIndex];
  if (!card) return renderDone();

  paintRoom('standby');

  /* 分组标签压在画面顶部 */
  if (list.length > 1) view.append(tabs());

  /* 信笺浮在画面上，后面垫两张叠牌暗示"还有下一张"。
     叠牌要和卡片同一个盒子，这样卡片长高时叠牌跟着走。 */
  const layer = el('div', 'postcard-layer');
  const stack = el('div', 'stack');
  if (cards.length > 1) {
    stack.append(el('div', 'ghost-card g2'));
    stack.append(el('div', 'ghost-card g1'));
  }
  stack.append(postcard(card));
  layer.append(stack);
  view.append(layer);
  view.append(againDock());

  /* 说明文字不再堆在画面底部，改成看山说的话（挂在它头顶的气泡里） */
  const bubble = el('div', 'pet-bubble');
  if (entry.group.note) bubble.append(el('p', null, entry.group.note));
  if (cards.length > 1 && !open) bubble.append(el('p', 'small', '轻点信笺，翻下一张'));
  if (!oauth.status?.authorized) bubble.append(el('p', 'small', '示例账号的真实收藏'));
  // 气泡里如实回报进展：累计写好了几封、寄出了几封（跨趟不清零）
  if (sent.size > 0) {
    bubble.append(el('p', 'small', `已寄出 ${sent.size} 封，等回音。`));
  } else if (invited.size > 0) {
    bubble.append(el('p', 'small', `信我写好了 ${invited.size} 封。你看看，行就发。`));
  }
  view.append(bubble);

  // 刚点了「想认识」，把卡片滚到底，让新出现的信真的被看见
  if (scrollCardToEnd) {
    scrollCardToEnd = false;
    const sheet = view.querySelector('.postcard');
    if (sheet) sheet.scrollTop = sheet.scrollHeight;
  }
}

function tabs() {
  const box = el('div', 'tabs');
  tripGroups().forEach((entry, index) => {
    box.append(button(entry.group.label, `tab${index === groupIndex ? ' on' : ''}`, () => {
      groupIndex = index;
      cardIndex = 0;
      open = null;
      render();
    }));
  });
  return box;
}

function postcard(card) {
  const node = el('article', 'postcard');
  const total = Math.max(1, currentTripCards().length);

  if (open) node.classList.add('expanded');
  if (total > 1 && !open) {
    node.classList.add('can-flip');
    node.addEventListener('click', () => {
      cardIndex = (cardIndex + 1) % total;
      open = null;
      render();
    });
  }

  /* 右上角邮票：盖的是这条内容的时间（月-日） */
  const stampText = String(card.now?.date || card.then?.date || '').slice(5);
  if (stampText) {
    const stamp = el('div', 'stamp');
    stamp.append(el('span', null, stampText));
    node.append(stamp);
  }

  /* 抬头 */
  const face = el('div', 'face');
  const who = el('div');
  const nameLine = el('div', 'name');
  const link = el('a', null, card.name);
  link.href = `https://www.zhihu.com/people/${card.urlToken}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.addEventListener('click', (event) => event.stopPropagation());
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

  /* 操作：展开与想认识互斥，同一时刻只展开一块 */
  const acts = el('div', 'acts');
  acts.append(button(open === 'detail' ? '收起来' : '展开', 'btn quiet', () => {
    open = open === 'detail' ? null : 'detail';
    render();
  }));

  const isInvited = invited.has(card.urlToken);
  // 按钮始终是「想认识」：点开就是看信（信展开时变成「收起信」）
  const inviteLabel = open === 'letter' ? '收起信' : '想认识';
  acts.append(button(inviteLabel, isInvited ? 'btn quiet' : 'btn', () => {
    if (!isInvited) {
      invited.add(card.urlToken);
      localStorage.setItem('kanshan.invited', JSON.stringify([...invited]));
      open = 'letter';
      scrollCardToEnd = true;
      render();
      return;
    }
    open = open === 'letter' ? null : 'letter';
    render();
  }));
  node.append(acts);

  if (open === 'detail') node.append(detail(card));
  if (isInvited && open === 'letter') node.append(letter(card));

  return node;
}

function detail(card) {
  const box = el('div', 'detail');
  const cols = el('div', 'cols');

  const col = (label, child) => {
    const c = el('div', 'col');
    c.append(el('div', 'col-label', label));
    c.append(child);
    return c;
  };

  const linkTo = (title, url) => {
    const a = el('a', null, title);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.addEventListener('click', (event) => event.stopPropagation());
    return a;
  };

  if (card.then) {
    const then = el('div');
    then.append(linkTo(card.then.title, card.then.url));
    then.append(el('div', 'meta', `${card.then.date} 收藏 · ${Number(card.then.likes).toLocaleString('zh-CN')} 赞`));
    cols.append(col('当年', then));
  }

  const now = el('div');
  if (card.now) {
    now.append(linkTo(card.now.title, card.now.url));
    const meta = [card.now.date,
                  card.now.authority ? `权威等级 ${card.now.authority}` : null,
                  card.now.likes != null ? `${Number(card.now.likes).toLocaleString('zh-CN')} 赞` : null]
      .filter(Boolean).join(' · ');
    now.append(el('div', 'meta', meta));
  } else {
    now.append(el('span', null, '搜索召回 0 条'));
  }
  cols.append(col(card.then ? '后来' : 'TA 写过', now));

  if (card.verdict) cols.append(col('看山的判断', el('div', null, card.verdict)));

  box.append(cols);
  if (card.caveat) box.append(el('div', 'caveat', `※ ${card.caveat}`));
  return box;
}

function letter(card) {
  const box = el('div', 'detail');
  const isSent = sent.has(card.urlToken);

  if (isSent) {
    box.append(el('div', 'line', '「信我压在门口了。没有敲门 —— 你说你不好意思。」'));
    box.append(el('div', 'caveat',
      '※ 演示环境的「发送」没有接通（开放平台只读，没有私信接口）。这封信已经为你准备好，可以直接复制去发。在真实生态里，它由看山送到对方门口，对方的主人同意之后才会继续。'));
  } else {
    box.append(el('div', 'line', '「信我替你写好了。你看看，觉得行就发出去。」'));
  }

  if (card.invite) {
    box.append(el('pre', 'pre', card.invite));
    const row = el('div', 'letter-acts');
    if (!isSent) {
      row.append(button('发送邀请', 'btn', () => {
        sent.add(card.urlToken);
        localStorage.setItem('kanshan.sent', JSON.stringify([...sent]));
        scrollCardToEnd = true;
        render();
      }));
    }
    row.append(button('复制这封信', 'btn quiet', async (event) => {
      try {
        await navigator.clipboard.writeText(card.invite);
        event.target.textContent = '已复制';
      } catch {
        event.target.textContent = '请手动选中复制';
      }
    }));
    box.append(row);
  }
  return box;
}

/* 收完信之后随时可以再派它出门 —— 不重开页面也有下一步 */
function againDock() {
  const box = el('div', 'again-dock');
  box.append(button('让它再出门一次', 'ghost', () => {
    groupIndex = 0; cardIndex = 0; open = null; goOut();
  }));
  return box;
}

function renderDone() {
  clearView();
  paintRoom('standby');
  view.append(say(tripSummary()));
  view.append(button('再让它出门', 'btn', () => {
    groupIndex = 0; cardIndex = 0; open = null; goOut();
  }));
}

// 这一趟带回来几张、分别来自哪一组
function tripSummary() {
  const list = tripGroups();
  const total = list.reduce((sum, entry) => sum + entry.cards.length, 0);
  const parts = list.map((entry) => `${entry.cards.length} 张来自${entry.group.label}`);
  return [`这次带回来 ${total} 张明信片。`, `${parts.join('，')}。`];
}

function goOut() {
  // 每出一趟门换一批信：一趟一组各 PER_TRIP 封，绕完一圈接着从头转
  trip += 1;
  screen = 'out';
  render();
}

function render() {
  if (screen === 'loading') return renderLoading();
  if (screen === 'out') return renderOut();
  if (screen === 'cards') return renderCards();
  return renderHome();
}

/* ---------- 运行记录面板（OAuth 五项接口验收） ---------- */
function panelCard(definition) {
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
  const node = panelCard(result);
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
loginBtn.addEventListener('click', () => { window.location.assign('/api/oauth/start'); });
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
    if (status.interfaces) status.interfaces.forEach(panelCard);

    // 右上角那撮小药丸：登录入口不挡路，谁都能看到；登录成功后才多出
    // 「谁」和「运行记录」。这样评委不登录也能把产品从头走完。
    const canLogin = Boolean(status.callbackConfigured) && !status.authorized;
    whoBtn.hidden = !status.authorized;
    panelToggle.hidden = !status.authorized;
    loginBtn.hidden = !canLogin;
    if (status.error && canLogin) loginBtn.textContent = '登录失败，重试';
    dock.hidden = !(status.authorized || canLogin);

    if (status.authorized) {
      whoBtn.textContent = status.profile?.name || '已授权的知乎账号';
      await runAll();
    }
    screen = 'home';
    render();
  } catch (error) {
    clearView();
    view.append(el('p', 'say', `启动失败：${error.message}`));
  }
}

boot();
