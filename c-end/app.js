const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const data = window.Saas_DATA;

try { localStorage.removeItem('saas-orders'); } catch (_) {}

const state = {
  cart: readLocal('saas-cart', {}),
  venueSort: {},
  ktvRooms: [
    ['K01 小包', '空闲', '绿色'], ['K02 小包', '占用', '蓝色'], ['K03 小包', '预定', '橙色'],
    ['K06 中包', '占用', '蓝色'], ['K08 中包', '清理中', '紫色'], ['K09 中包', '空闲', '绿色'],
    ['K12 大包', '占用', '蓝色'], ['K15 大包', '维护', '灰色'], ['VIP 01', '预定', '橙色'],
  ],
  travel: {
    from: '深圳', to: '重庆',
    fromDetail: '深圳宝安国际机场 T3', toDetail: '重庆江北国际机场 T3',
    date: dateOffset(1), people: '1成人',
    pickup: '深圳宝安国际机场 T3', dropoff: '深圳湾科技生态园',
  },
};

function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
}
function saveLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* WebView private mode fallback */ }
}
/** 今天 + days 的设备本地日期（走 SaasDateTime，禁止 toISOString 的 UTC 平移）。 */
function dateOffset(days) { return SaasDateTime.dateOffset(days); }
/** 日期（YYYY-MM-DD）展示：统一走 SaasDateTime 的唯一日期出口（M月D日，不按设备时区平移）。 */
function formatDate(value) { return SaasDateTime.formatStoreDate(value); }
/** 前端演示数据金额（主单位）→ 统一展示「符号紧跟金额」。后端真实金额一律走 minorMoney，不得混用。 */
function mockMoney(value) { return SAAS.formatYuan(value); }
/** 后端金额（最小货币单位）→ 统一展示；currencyCode 缺省用当前租户币种，单据快照可显式传。 */
function minorMoney(amount, currencyCode) { return SAAS.formatFen(amount, currencyCode); }
/** 币种名称（人民币 / 美元）：需要中文名称时取它，不向用户展示裸币种码。 */
function currencyLabel(code) { return SAAS.currencyLabel(code); }
/** 后端错误 -> 中文可执行提示（币种/渠道类错误码统一在 api-errors.js 翻译，不外泄错误码与英文原文）。 */
function apiErrorText(error, fallback) {
  return window.SaasApiErrors ? window.SaasApiErrors.describe(error, fallback) : (fallback || '操作失败，请稍后重试');
}
function image(name) { return `./assets/images/${name}`; }
/**
 * 点单目录/商品缩略图：后端返回的是同源相对路径（/api/v1/media-public/...），直接用，不拼域名。
 * 无图或加载失败一律退回占位块（见 bindThumbFallback），避免破版。
 */
function catalogThumb(item) {
  if (!item) return '';
  const main = item.mainImageUrl || (Array.isArray(item.imageUrls) && item.imageUrls.length ? item.imageUrls[0] : '');
  return typeof main === 'string' && main.trim() ? main.trim() : '';
}
/** 包厢主图：与目录项同一契约（主图优先，缺失时按后端规则退回第一张）。 */
function roomThumb(room) {
  if (!room) return '';
  const main = room.mainImageUrl || (Array.isArray(room.imageUrls) && room.imageUrls.length ? room.imageUrls[0] : '');
  return typeof main === 'string' && main.trim() ? main.trim() : '';
}
function thumbHtml(url, alt, emptyIcon) {
  const icon = emptyIcon || '🧾';
  if (!url) return '<span class="cc-thumb cc-thumb-empty" aria-hidden="true">' + icon + '</span>';
  return '<img class="cc-thumb" src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt || '') +
    '" loading="lazy" data-thumb-empty="' + escapeHtml(icon) + '">';
}
/** 图片加载失败的兜底：换成占位块（相对路径 404 / 历史无图都不会出现破图）。 */
function bindThumbFallback(root) {
  (root || app).querySelectorAll('img.cc-thumb').forEach(function (img) {
    img.addEventListener('error', function () {
      const placeholder = document.createElement('span');
      placeholder.className = 'cc-thumb cc-thumb-empty';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = img.getAttribute('data-thumb-empty') || '🧾';
      img.replaceWith(placeholder);
    });
  });
}
/** 包厢实景图加载失败：回退到门店默认图，再失败就隐藏，保证不出现破图。 */
function bindRoomImageFallback(root) {
  (root || app).querySelectorAll('img[data-room-fallback]').forEach(function (img) {
    img.addEventListener('error', function () {
      const fallback = img.getAttribute('data-room-fallback');
      if (fallback && img.getAttribute('src') !== fallback) { img.setAttribute('src', fallback); return; }
      img.style.visibility = 'hidden';
    });
  });
}
/**
 * 预约确认页的房型画廊：点缩略图切换上方主图（只切 src，不发请求；失败仍退门店占位图）。
 * 多图来自后台「房型管理」，这里只做展示，不代表已锁定某个包厢号。
 */
function bindRoomTypeGallery(root) {
  const scope = root || app;
  const gallery = scope.querySelector('[data-room-gallery]');
  if (!gallery) return;
  gallery.addEventListener('click', function (event) {
    const button = event.target && event.target.closest ? event.target.closest('[data-room-photo]') : null;
    if (!button) return;
    const hero = scope.querySelector('.booking-summary img');
    const photo = button.getAttribute('data-room-photo');
    if (!hero || !photo) return;
    hero.style.visibility = '';
    hero.setAttribute('src', photo);
    gallery.querySelectorAll('[data-room-photo]').forEach(function (item) {
      item.classList.toggle('is-active', item === button);
    });
  });
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}
function orderNo() { return `SaaS${Date.now().toString().slice(-10)}`; }
function go(route) { location.hash = `#/${route}`; }
/**
 * 当前路由：`#/my-orders` → `my-orders`（空 hash 视作 home）。
 * 渲染与「路由守卫」共用这一份解析口径（重试按钮那处历史写法保持不变）。
 */
function currentRoute() { return location.hash.replace(/^#\/?/, '') || 'home'; }
/**
 * 路由守卫：只有「发起请求时的路由」仍是当前路由，才允许把结果画到屏上。
 * 请求回来晚（用户已经点走 / 按了返回）就整批丢弃，绝不把上一页的金额、状态或错误页画到当前页。
 */
// WebView 83 (MI 9) lacks aspect-ratio, inset and flex gap.
// Add a compatibility class so CSS can use margin/fixed-height fallbacks.
(function () {
  if (typeof document === 'undefined' || !document.documentElement) return;
  try {
    if (!window.CSS || !window.CSS.supports || !window.CSS.supports('aspect-ratio', '1 / 1')) {
      document.documentElement.classList.add('compat-webview83');
    }
  } catch (error) {
    document.documentElement.classList.add('compat-webview83');
  }
})();
function routeIsCurrent(route) { return currentRoute() === route; }

/** 会员档案尚未初始化（后端 404 MEMBER_NOT_FOUND）：按空态处理，不当成加载失败。 */
function isMemberNotInitialized(error) {
  if (!error) return false;
  if (error.code === 'MEMBER_NOT_FOUND') return true;
  return /MEMBER_NOT_FOUND/.test(String(error.message || ''));
}

/** 「我的」分区路由：返回键固定回「我的」，避免从 App 外深链进入时 history.back() 退出应用。 */
function isMySectionRoute(route) {
  var value = String(route || '');
  return value === 'my-reservations' || value === 'my-orders' || value === 'my-hotel-orders'
    || value === 'orders' || value.indexOf('ledger/') === 0
    || value.indexOf('order-bill/') === 0 || value.indexOf('order-items/') === 0;
}

/** 未知路由：渲染现有空态 + 返回首页，不再静默回落首页（深链失效时用户可感知）。 */
function renderNotFound() {
  // 不渲染 emoji 图标；右槽显式传空，避免出现与「页面不存在」无关的默认「我的订单」按钮。
  app.innerHTML = pageHead('页面不存在', '<span></span>') +
    '<section class="empty"><h2>页面不存在</h2><p>链接可能已失效，返回首页继续浏览。</p>' +
    '<button class="primary-button" type="button" data-route="home">返回首页</button></section>';
}
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}
function showConfirm(title, message, options = {}) {
  const confirmText = options.confirmText || '确认';
  const cancelText = options.cancelText || '取消';
  const danger = options.danger !== false;
  let modal = document.querySelector('#confirm-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'modal-mask';
    modal.innerHTML = `
      <div class="modal-sheet" role="dialog" aria-modal="true">
        <h3 class="modal-title"></h3>
        <p class="modal-body"></p>
        <div class="modal-actions">
          <button type="button" class="modal-btn ghost" data-modal-cancel></button>
          <button type="button" class="modal-btn" data-modal-ok></button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  const okBtn = modal.querySelector('[data-modal-ok]');
  const cancelBtn = modal.querySelector('[data-modal-cancel]');
  modal.querySelector('.modal-title').textContent = title;
  modal.querySelector('.modal-body').textContent = message;
  okBtn.textContent = confirmText;
  okBtn.className = 'modal-btn ' + (danger ? 'danger' : 'ghost');
  cancelBtn.textContent = cancelText;
  return new Promise(resolve => {
    const done = value => {
      modal.classList.remove('show');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.onclick = null;
      resolve(value);
    };
    okBtn.onclick = () => done(true);
    cancelBtn.onclick = () => done(false);
    modal.onclick = event => { if (event.target === modal) done(false); };
    modal.classList.add('show');
  });
}
function pageHead(title, right = '<button class="head-action" data-route="my-orders">我的订单</button>') {
  return `<header class="page-head"><button class="icon-button" data-back aria-label="返回">‹</button><h1>${escapeHtml(title)}</h1>${right}</header>`;
}

function syncEmbeddedHost() {
  document.body.classList.toggle('embedded-host', !!(window.GVBridge || window.GV_SDK));
}
syncEmbeddedHost();
let embeddedHostChecks = 0;
const embeddedHostTimer = setInterval(function () {
  syncEmbeddedHost();
  embeddedHostChecks += 1;
  if (document.body.classList.contains('embedded-host') || embeddedHostChecks >= 24) clearInterval(embeddedHostTimer);
}, 250);
function emptyState(icon, title, copy) {
  return `<section class="empty"><span>${icon}</span><h2>${title}</h2><p>${copy}</p></section>`;
}
function serviceById(id) { return data.services.find(item => item.id === id); }

// 储值品牌展示名与代币比例：取租户配置 wallet_brand_name 与 wallet_ratio（默认「SaaS 币」、比例 100），
// 各页面统一使用，不硬编码。储值币与积分是**数量**，不是货币：展示只走 SAAS.formatTokens / formatPoints。
var walletBrand = SAAS.DEFAULT_WALLET_BRAND;
var walletRatio = 100;
var walletTokenConfigRequest = null;
function loadWalletTokenConfig() {
  if (!walletTokenConfigRequest) {
    walletTokenConfigRequest = SAAS.getWalletTokenConfig().then(function (cfg) {
      if (cfg && cfg.brandName) walletBrand = cfg.brandName;
      // 比例非法/缺失就保持默认 100（不抛错，页面照常按数量展示）
      if (cfg && Number(cfg.ratio) > 0) walletRatio = Number(cfg.ratio);
      return { brandName: walletBrand, ratio: walletRatio };
    }).catch(function () { return { brandName: walletBrand, ratio: walletRatio }; });
  }
  return walletTokenConfigRequest;
}

/**
 * 钱包余额的**数量**文本（如「1,000」）：服务端 tokenAmount 优先；
 * 服务端未发布该字段时按租户比例在前端换算（唯一换算入口 SAAS.tokenCountFromMinor）。
 * 储值币不是货币：既不出现货币符号 / 币种，也不拼品牌名（名字由卡片标签承担）。
 */
function walletTokenText(wallet) {
  if (!wallet) return SAAS.formatTokens(0);
  var direct = wallet.tokenAmount;
  var count = direct === undefined || direct === null || direct === ''
    ? SAAS.tokenCountFromMinor(wallet.availableAmount, walletRatio)
    : direct;
  return SAAS.formatTokens(count);
}

/** 支付页可用的储值币 / 积分**数量**（渲染支付页时取一次，提交时按数量校验不超过可用）。 */
var payLegAvailable = {};

/**
 * 某支付方式可用的分腿**输入值**（数量腿是个数，金额腿是主单位金额）；
 * 可用数量未知（余额读不到 / 服务端未回该字段）返回 null，此时不本地拦截、交给服务端校验。
 */
function payLegAvailableInput(method) {
  var key = method === null || method === undefined ? '' : String(method).toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(payLegAvailable, key)) return null;
  var count = Number(payLegAvailable[key]);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function renderHome() {
  app.innerHTML = `
    <section class="wallet">
      <h1 class="brand">SaaS</h1>
      <div class="balances">
        <button class="balance" data-route="ledger/coin"><span class="balance-label">${walletBrand}：</span><strong id="wallet-coin">—</strong></button>
        <button class="balance" data-route="ledger/points"><span class="balance-label">积分：</span><strong id="wallet-points">—</strong></button>
      </div>
      <nav class="service-grid" aria-label="更多服务">
        ${data.services.map(item => `<button class="service-button" data-route="service/${item.id}"><span class="service-icon">${item.icon}</span><span class="service-name">${item.name}</span></button>`).join('')}
      </nav>
    </section>
    <div class="section-head"><h2>热门服务</h2><button data-toast="更多服务持续更新中">查看全部 ›</button></div>
    <section class="mini-grid">
      ${[
        ['hotel', 'SaaS酒店', 'hotel-1.jpg', '豪华房低至 ' + mockMoney(368)],
        ['bar', 'SaaS酒吧', 'bar-1.jpg', '散台 / 卡座在线预约'],
        ['billiards', 'SaaS台球厅', 'billiards-1.png', '专业球台 · 到店即玩'],
        ['foot', 'SaaS足浴', 'foot-1.png', '放松身心 · 预约免排队'],
      ].map(([id, title, pic, note]) => `<button class="mini-card" data-route="service/${id}"><img src="${image(pic)}" alt="${title}"><span class="mini-card-copy"><strong>${title}</strong><small>${note}</small></span></button>`).join('')}
    </section>
    <section class="home-notice"><span>ⓘ</span><p>服务内容与价格以门店实际为准，如有疑问请联系门店。</p></section>`;
  refreshBalances();
}

/**
 * 首页余额（储值币 / 积分**数量**）：首屏渲染后单独补一次，也是回到前台时的静默刷新入口。
 * 余额是后台充值时点会改的数，落地前先过一次路由守卫（用户已经点走就不动屏）。
 */
function refreshBalances() {
  SAAS.getWallet().then(function (w) {
    if (!routeIsCurrent('home')) return;
    const el = document.querySelector('#wallet-coin');
    // 储值币是**代币数量**（不是钱）：服务端 tokenAmount 优先，缺失时按租户比例换算，不带货币符号。
    if (el) el.textContent = walletTokenText(w);
  });
  SAAS.getPoints().then(function (p) {
    if (!routeIsCurrent('home')) return;
    const el = document.querySelector('#wallet-points');
    if (el) el.textContent = SAAS.formatPoints(p.balance);
  });
}

/** 账本路由：`ledger/coin` / `ledger/points`（与 render 的分支同一口径，守卫与刷新都用它）。 */
function ledgerRoute(type) { return type === 'points' ? 'ledger/points' : 'ledger/coin'; }

/** 明细页每页条数（与后端默认 pageSize=20 一致；超过一页必须能「加载更多」，不能静默截断）。 */
var LEDGER_PAGE_SIZE = 20;

/** 明细视图状态：首屏/静默刷新重置为第一页；「加载更多」只在当前视图基础上追加。 */
var ledgerView = { isCoin: true, records: [], page: 1, pages: 0 };
var ledgerMoreLoading = false;

/**
 * 账本数据（余额 + 第一页明细）：首屏与静默刷新共用同一份加载，不存在第二条数据路径。
 * 储值币 / 积分都是**数量**：展示只走 walletTokenText / formatPoints。
 */
async function loadLedgerData(type) {
  const isCoin = type !== 'points';
  if (isCoin) {
    var wallet = await SAAS.getWallet();
    var coinPage = await SAAS.getWalletLedgerPage(1, LEDGER_PAGE_SIZE);
    return {
      isCoin: true,
      balanceText: walletTokenText(wallet),
      records: coinPage.items || [],
      page: coinPage.current || 1,
      pages: coinPage.pages || 0,
      total: coinPage.total || 0
    };
  }
  var points = await SAAS.getPoints();
  var pointPage = await SAAS.getPointsLedgerPage(1, LEDGER_PAGE_SIZE);
  return {
    isCoin: false,
    balanceText: SAAS.formatPoints(points.balance),
    records: pointPage.items || [],
    page: pointPage.current || 1,
    pages: pointPage.pages || 0,
    total: pointPage.total || 0
  };
}

/** 明细列表 HTML（第一页与「加载更多」共用同一份行渲染）。 */
function ledgerListHtml(isCoin, records, page, pages) {
  if (!records.length) return '<p class="mock-notice">暂无' + (isCoin ? escapeHtml(walletBrand) : '积分') + '明细</p>';
  var html = records.map(function (r) { return ledgerRow(r, isCoin); }).join('');
  if (Number(pages) > Number(page)) {
    html += '<button class="retry-button" type="button" data-ledger-more="' + (isCoin ? 'coin' : 'points') + '">加载更多</button>';
  }
  return html;
}

/** 账本绘制：只更新余额与明细两个节点（静默刷新不动骨架，页面不会闪回加载态）。 */
function paintLedger(data) {
  ledgerView = {
    isCoin: !!data.isCoin,
    records: Array.isArray(data.records) ? data.records.slice() : [],
    page: Number(data.page || 1),
    pages: Number(data.pages || 0),
  };
  var balEl = document.querySelector('#ledger-balance');
  if (balEl) balEl.textContent = data.balanceText;
  var listEl = document.querySelector('#ledger-list');
  if (listEl) listEl.innerHTML = ledgerListHtml(ledgerView.isCoin, ledgerView.records, ledgerView.page, ledgerView.pages);
}

/** 明细骨架（renderPage 的 loadingHtml 出口）：保留 #ledger-balance / #ledger-list 两个锚点供落屏更新。 */
function ledgerSkeletonHtml(title) {
  return '<section class="ledger-hero"><span>可用' + escapeHtml(title) + '</span><strong id="ledger-balance">—</strong></section>' +
    '<div class="section-head"><h2>收支明细</h2></div>' +
    '<section class="plain-card ledger-list" id="ledger-list"><p class="mock-notice">明细加载中…</p></section>';
}

/**
 * 明细页：加载/超时/失败统一走 SaasPageLoad（错误态带 data-retry 可重试），
 * 不再手写「加载失败」；路由守卫由 renderPage 的 isCurrent 承担。
 */
async function renderLedger(type) {
  const isCoin = type !== 'points';
  const title = isCoin ? walletBrand : '积分';
  const route = ledgerRoute(type);
  await SaasPageLoad.renderPage({
    name: 'ledger',
    retryRoute: route,
    errorTitle: title + '明细加载失败',
    isCurrent: function () { return routeIsCurrent(route); },
    mount: function (html) { app.innerHTML = pageHead(title + '明细', '<span></span>') + html; },
    loadingHtml: ledgerSkeletonHtml(title),
    load: function () { return loadLedgerData(type); },
    render: paintLedger,
  });
}

/** 「加载更多」下一页（用户主动触发；失败只提示，不清空已加载的行）。 */
async function loadLedgerMore(type) {
  if (ledgerMoreLoading) return;
  var isCoin = type !== 'points';
  var route = ledgerRoute(type);
  var nextPage = Number(ledgerView.page || 1) + 1;
  ledgerMoreLoading = true;
  try {
    var page = isCoin
      ? await SAAS.getWalletLedgerPage(nextPage, LEDGER_PAGE_SIZE)
      : await SAAS.getPointsLedgerPage(nextPage, LEDGER_PAGE_SIZE);
    // 路由守卫：翻页期间用户已经点走，这一页直接丢弃。
    if (!routeIsCurrent(route)) return;
    ledgerView.records = ledgerView.records.concat(Array.isArray(page.items) ? page.items : []);
    ledgerView.page = Number(page.current || nextPage);
    ledgerView.pages = Number(page.pages || ledgerView.pages || 0);
    var listEl = document.querySelector('#ledger-list');
    if (listEl) listEl.innerHTML = ledgerListHtml(ledgerView.isCoin, ledgerView.records, ledgerView.page, ledgerView.pages);
  } catch (error) {
    if (routeIsCurrent(route)) showToast(apiErrorText(error, '加载更多失败，请稍后重试'));
  } finally {
    ledgerMoreLoading = false;
  }
}

/** 静默刷新账本：后台充值 / 抵扣会改余额与明细，回到前台或长时间停留时重取一次（重置回第一页）。 */
function refreshLedger(type) {
  var route = ledgerRoute(type);
  return SaasPageLoad.refreshPage({
    name: 'ledger',
    isCurrent: function () { return routeIsCurrent(route); },
    load: function () { return loadLedgerData(type); },
    render: paintLedger,
  });
}

function ledgerTypeText(t) {
  return {
    RECHARGE: '充值', CONSUME: '消费', REFUND: '退款', RELEASE: '释放',
    ADJUST: '调整', REDEEM: '抵扣', REVERSE: '退回', EARN: '获得积分', EXPIRE: '积分过期'
  }[t] || t || '—';
}

/**
 * 账本行数量文本：储值账本与积分账本展示的都是**数量**（储值币个数 / 积分个数），
 * 一律不带货币符号与币种（只有现金才带货币单位）。储值行优先用服务端 tokenAmount，
 * 缺失时按租户比例换算（唯一换算入口 SAAS.tokenCountFromMinor）。
 * 行内 amount / currencyCode 仍原样保留用于对账，只是不再当钱渲染。
 */
function ledgerAmountText(value, isCoin, row) {
  var n = Number(value || 0);
  var record = row && typeof row === 'object' ? row : {};
  var direct = record.tokenAmount;
  var count = direct === undefined || direct === null || direct === ''
    ? SAAS.tokenCountFromMinor(n, walletRatio)
    : Number(direct);
  // 服务端可能只给数量不给符号：符号以账本行的金额方向为准
  if (Number.isFinite(count) && n < 0 && count > 0) count = -count;
  var text = isCoin ? SAAS.formatTokens(count) : SAAS.formatPoints(count);
  return (n > 0 ? '+' : '') + text;
}

function ledgerRow(r, isCoin) {
  var label = ledgerTypeText(r.entryType);
  var amount = isCoin ? (r.amount !== undefined ? r.amount : 0) : (r.points !== undefined ? r.points : 0);
  var signed = ledgerAmountText(amount, isCoin, r);
  var cls = Number(amount) >= 0 ? 'income' : '';
  return '<div><span><strong>' + escapeHtml(label) + '</strong><small>' + escapeHtml(formatDateTime(r.occurredAt)) + '</small></span><b class="' + cls + '">' + signed + '</b></div>';
}


function renderKtvBusiness() {
  const counts = state.ktvRooms.reduce((result, room) => ({ ...result, [room[1]]: (result[room[1]] || 0) + 1 }), {});
  app.innerHTML = `${pageHead('KTV 业务')}
    <section class="business-hero"><img src="${image('ktv-1.png')}" alt="SaaS KTV"><div><small>今日营业额</small><strong>${mockMoney(8680)}</strong><p>较昨日 +12.6%</p></div></section>
    <section class="metric-grid"><button data-toast="显示今日全部订单"><strong>18</strong><span>今日订单</span></button><button data-toast="显示使用中包厢"><strong>${counts['占用'] || 0}</strong><span>使用中</span></button><button data-toast="显示预约客户"><strong>${counts['预定'] || 0}</strong><span>待到店</span></button><button data-toast="显示待处理包厢"><strong>${(counts['清理中'] || 0)+(counts['维护'] || 0)}</strong><span>待处理</span></button></section>
    <div class="section-head"><h2>快捷操作</h2><span></span></div>
    <section class="quick-grid"><button data-toast="已打开预约登记（mock）"><span>📅</span>预约登记</button><button data-toast="已打开组合收银（mock）"><span>💳</span>前台收银</button><button data-toast="交接班数据已生成（mock）"><span>🔁</span>交接班</button><button data-toast="今日业绩 ${mockMoney(8680)}，套餐销售12份"><span>📊</span>经营报表</button></section>
    <div class="section-head"><h2>包厢状态</h2><button data-toast="状态数据已刷新">刷新 ›</button></div>
    <div class="status-legend"><span>● 空闲</span><span>● 预定</span><span>● 占用</span><span>● 清理中</span><span>● 维护</span></div>
    <section class="room-grid">${state.ktvRooms.map((room,index) => `<button class="room-card status-${room[2]}" data-route="business-room/${index}"><span>${room[0]}</span><strong>${room[1]}</strong><small>${room[1] === '占用' ? '已用 01:36' : room[1] === '预定' ? '20:30到店' : '点击处理'}</small></button>`).join('')}</section>`;
}

function renderKtvRoom(index = 0) {
  const room = state.ktvRooms[index] || state.ktvRooms[0];
  const actions = {
    '空闲': [['open','开台']], '预定': [['arrive','确认到店'],['cancel','取消预留']],
    '占用': [['renew','续台'],['transfer','转台'],['settle','结账']],
    '清理中': [['clean','完成清理']], '维护': [['repair','完成维护']],
  }[room[1]] || [];
  app.innerHTML = `${pageHead(room[0], '<span></span>')}
    <section class="room-detail"><img src="${image(`ktv-${(index % 4) + 1}.png`)}" alt="${room[0]}"><div><span class="room-status status-${room[2]}">${room[1]}</span><h2>${room[0]}</h2><p>容纳 4-6 人 · 包厢低消 ${mockMoney(298)}</p></div></section>
    ${room[1] === '占用' ? '<section class="detail-card session-info"><div><span>客户</span><strong>王先生 · 138****6688</strong></div><div><span>开台时间</span><strong>19:20</strong></div><div><span>已用时长</span><strong>01:36</strong></div><div><span>当前消费</span><strong class="price">' + mockMoney(468) + '</strong></div></section>' : ''}
    <section class="detail-card"><h3>包厢备注</h3><p>${room[1] === '预定' ? '客户预约生日聚会套餐，前台需提前电话确认到店时间。' : '设备检查正常，酒水库存充足。'}</p></section>
    <div class="room-actions">${actions.map(([action,label]) => `<button class="primary-button" data-room-action="${action}" data-room-index="${index}">${label}</button>`).join('')}</div>`;
}

const ktvRoomCache = {};
const ktvRoomTypeCache = {};

/** 选包厢类型页：只列房型（包厢可能几十上百个，房型不多），不出现任何具体包厢号。 */
async function renderKtvBooking() {
  app.innerHTML = `${pageHead('KTV 预约 · 选择包厢类型', '<span></span>')}
    <section class="detail-card merchant"><h2>SaaS KTV</h2><p class="address">📍 ${data.venues.ktv.address}</p><div class="tag-row">${data.venues.ktv.tags.map(tag => `<span>${tag}</span>`).join('')}</div></section>
    <div class="section-head"><h2>选择包厢类型</h2><span></span></div>
    <p class="form-hint">本店包厢数量较多，线上只需选择包厢类型；具体包厢到店后由门店分配。</p>
    <section class="package-list"><p class="form-hint">包厢类型加载中…</p></section>`;
  let roomTypes;
  try {
    roomTypes = await SAAS.listKtvRoomTypes();
  } catch (error) {
    const listEl = app.querySelector('.package-list');
    if (listEl) listEl.innerHTML = emptyState('⚠️', '包厢类型加载失败', '请检查网络后点击返回重试');
    console.error('[saas] KTV room types load failed', error);
    return;
  }
  Object.keys(ktvRoomTypeCache).forEach(function (k) { delete ktvRoomTypeCache[k]; });
  roomTypes.forEach(function (t) { if (t && t.roomTypeId != null) ktvRoomTypeCache[t.roomTypeId] = t; });
  // 每个房型按自己的生效价取价（合计 = 房型 + 服务，同房型只请求一次）；失败只让该卡片不显示价格。
  await loadKtvRoomPricing(roomTypes);
  const list = roomTypes.length
    ? `<section class="package-list">${roomTypes.map(roomType => {
        const usable = SAAS.isKtvRoomTypeBookable(roomType)
        const reason = SAAS.ktvRoomTypeUnavailableReason(roomType)
        const priceText = ktvRoomTypePriceShort(roomType)
        // 位置来自该房型包厢所在区域（后台资源归并），没有就整行不渲染，不显示假数据。
        const areaName = String(roomType.areaName || '').trim()
        return `
      <article class="package-card${usable ? '' : ' package-card-disabled'}">${roomTypeThumb(roomType)}<div><h3>${escapeHtml(roomType.name)}</h3><p>${roomType.capacity ? '可容纳 ' + roomType.capacity + ' 人' : '包厢类型'} · ${usable ? '到店登记后开台' : escapeHtml(reason)}</p>${areaName ? `<p class="package-area">位置 ${escapeHtml(areaName)}</p>` : ''}<small>${priceText ? escapeHtml(priceText) + ' · ' : ''}${usable ? '具体包厢到店后由门店分配' : escapeHtml(reason)}</small></div><aside>${usable ? `<button class="primary-button" data-route="book-ktv/type/${roomType.roomTypeId}">预约</button>` : `<button class="primary-button" disabled>${escapeHtml(reason)}</button>`}</aside></article>`
      }).join('')}</section>`
    : emptyState('🎤', '暂无可预约包厢类型', '请稍后再试或联系门店');
  const listEl = app.querySelector('.package-list');
  if (listEl) listEl.outerHTML = list;
  bindRoomImageFallback(app);
}

/**
 * 门店 KTV 占位图：房型没有样板图（或样板图加载失败）时用它，保证卡片永远有图、不出现破图。
 * 「按房型 id 稳定取一张」与预约确认页同一口径。
 */
function roomTypePlaceholder(roomType) {
  var id = Number(roomType && roomType.roomTypeId);
  var index = Number.isFinite(id) && id > 0 ? (id % 4) : 0;
  return image('ktv-' + (index + 1) + '.png');
}

/**
 * 房型卡片展示图：优先该房型**样板包厢**的照片（SAAS.ktvRoomTypeImageUrl，来自包厢主图归并），
 * 取不到时用门店 KTV 占位图；加载失败再退占位图（见 bindRoomImageFallback）。
 * 这是房型展示图，不代表已锁定某个包厢号，因此不出现任何包厢号文案。
 */
function roomTypeThumb(roomType) {
  var fallback = roomTypePlaceholder(roomType);
  var src = SAAS.ktvRoomTypeImageUrl(roomType, fallback) || fallback;
  return '<img class="package-thumb" src="' + escapeHtml(src) + '" alt="' + escapeHtml(roomType.name) +
    '" loading="lazy" data-room-type-image data-room-fallback="' + escapeHtml(fallback) + '">';
}

/**
 * 预约时间入参：后端 CreateReservationRequest.startAt/endAt 是 OffsetDateTime，
 * 且 ReservationApplicationService.toBusinessLocal 会把入参换算到门店营业时区（+08:00）后落库，
 * 所以这里按「门店营业本地时间 + +08:00 偏移」序列化；不得再用 UTC 的 toISOString。
 */
function storeTimeAfter(dateStr, timeStr, hours) {
  return SaasDateTime.storeOffsetDateTime(dateStr, timeStr, Number(hours) || 0);
}

/**
 * 营业时间（18:00–次日 05:00 这类跨自然日区间）的唯一实现是 business-hours.js：
 * 页面只做转发，禁止在这里内联重写「跨天 / 左闭右开」的时段判断（服务端仍会 422 强制校验）。
 */
function businessHoursText(hours) { return SaasBusinessHours.businessHoursText(hours); }
function isWithinBusinessHours(timeStr, hours) { return SaasBusinessHours.isWithinBusinessHours(timeStr, hours); }
/** 渲染预约页时取到的当前营业时段；未取到（或加载失败）按默认营业时间兜底，时段选择与提交校验共用同一份。 */
let bookingBusinessHours = SaasBusinessHours.parseBusinessHours(SaasBusinessHours.DEFAULT_BUSINESS_HOURS);
/** 打开预约页取一次营业时间：失败按默认值兜底（读路径不抛异常），可选带门店 id。 */
async function loadBookingBusinessHours(storeId) {
  try {
    bookingBusinessHours = SaasBusinessHours.parseBusinessHours(await SAAS.getBusinessHours(storeId));
  } catch (error) {
    console.warn('[saas] business hours load failed', error);
    bookingBusinessHours = SaasBusinessHours.parseBusinessHours(SaasBusinessHours.DEFAULT_BUSINESS_HOURS);
  }
  return bookingBusinessHours;
}

/** 当前预约页的房型容量/可约时段；服务端计算，页面只展示，不自行推算容量。 */
let ktvAvailability = null;
let ktvAvailabilityKey = '';
function ktvAvailabilityKeyFor(roomTypeId, date, duration) {
  return String(roomTypeId) + '|' + String(date) + '|' + String(duration);
}
async function loadKtvAvailability(roomTypeId, date, duration) {
  const key = ktvAvailabilityKeyFor(roomTypeId, date, duration);
  try {
    const data = await SAAS.getKtvAvailability(roomTypeId, date, duration);
    ktvAvailability = data && Array.isArray(data.slots) ? data : null;
    ktvAvailabilityKey = key;
  } catch (error) {
    console.warn('[saas] KTV availability load failed', error);
    ktvAvailability = null;
    ktvAvailabilityKey = '';
  }
  return ktvAvailability;
}
function ktvAvailableSlot(time) {
  if (!ktvAvailability || !Array.isArray(ktvAvailability.slots)) return null;
  return ktvAvailability.slots.find(function (slot) { return slot.startTime === time; }) || null;
}
function ktvAvailabilityHint() {
  if (!ktvAvailability) return '';
  const available = ktvAvailability.slots.filter(function (slot) { return slot.available; }).map(function (slot) { return slot.startTime; });
  if (!available.length) return '所选日期已无可约时段，请更换日期或房型';
  return '可约时段：' + available.slice(0, 6).join('、') + (available.length > 6 ? ' 等' : '');
}
/** 日期/时长变化后刷新容量；当前时间满时自动切到下一个可约时段，避免用户提交后才看到 409。 */
async function refreshKtvAvailability(form) {
  if (!form || form.id !== 'ktv-order-form') return;
  const roomTypeId = Number(form.dataset.roomTypeId);
  const date = (form.querySelector('[name="date"]') || {}).value;
  const duration = Number((form.querySelector('[name="duration"]') || {}).value || 3);
  const timeInput = form.querySelector('[name="time"]');
  if (!(roomTypeId > 0) || !date || !timeInput) return;
  await loadKtvAvailability(roomTypeId, date, duration);
  const hint = form.querySelector('[data-ktv-availability]');
  if (hint) hint.textContent = ktvAvailabilityHint();
  const current = ktvAvailableSlot(timeInput.value);
  if (current && current.available) { updateBookingEstimate(form); return; }
  const next = ktvAvailability && ktvAvailability.slots.find(function (slot) { return slot.available; });
  if (next) {
    timeInput.value = next.startTime;
    const display = form.querySelector('[data-picker-display="time"]');
    if (display) display.textContent = next.startTime;
    showToast('原时段已满，已改选 ' + next.startTime);
  } else if (ktvAvailability) {
    showToast('该日期已无可约时段，请更换日期或房型');
  }
  updateBookingEstimate(form);
}

function bookingDateLabel(value, offset) {
  const date = new Date(value + 'T00:00:00');
  const prefix = offset === 0 ? '今天' : offset === 1 ? '明天' : offset === 2 ? '后天' : ['周日','周一','周二','周三','周四','周五','周六'][date.getDay()];
  return prefix + ' · ' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

function bookingPickerRow(name, label, value, display, icon) {
  return '<input type="hidden" name="' + name + '" value="' + value + '">' +
    '<button type="button" class="booking-picker-row" data-booking-picker="' + name + '">' +
      '<span class="booking-field-icon">' + icon + '</span>' +
      '<span class="booking-field-copy"><small>' + label + '</small><strong data-picker-display="' + name + '">' + display + '</strong></span>' +
      '<span class="booking-chevron">›</span>' +
    '</button>';
}

function bookingPickerOptions(name) {
  if (name === 'date') {
    return Array.from({ length: 14 }, function (_, index) {
      const value = dateOffset(index);
      return { value: value, label: bookingDateLabel(value, index), hint: value.replace(/-/g, '/') };
    });
  }
  if (name === 'time') {
    const options = [];
    for (let hour = 0; hour <= 23; hour++) {
      [0, 30].forEach(function (minute) {
        const value = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
        options.push({ value: value, label: value, hint: hour < 6 ? '凌晨' : hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上' });
      });
    }
    // 营业时段左闭右开（18:00–05:00 覆盖到次日 05:00，但不含 05:00）：选项先过一遍时段判断，
    // 客人点不出必然被服务端拒绝的时刻；判断走 business-hours.js，页面不内联重写时段逻辑。
    const hours = bookingBusinessHours;
    if (!hours) return options;
    const allowed = options.filter(function (option) { return isWithinBusinessHours(option.value, hours); });
    // 有服务端可约时段时只展示仍可约的到店时段；当前已选时间即使刚好满也保留，避免输入框变成空值。
    const form = document.querySelector('#ktv-order-form');
    if (!form) return allowed;
    const roomTypeId = Number(form.dataset.roomTypeId);
    const dateInput = form.querySelector('[name="date"]');
    const durationInput = form.querySelector('[name="duration"]');
    const timeInput = form.querySelector('[name="time"]');
    const date = dateInput ? dateInput.value : '';
    const duration = Number(durationInput ? durationInput.value : 3) || 3;
    const current = timeInput ? timeInput.value : '';
    if (!ktvAvailability || ktvAvailabilityKey !== ktvAvailabilityKeyFor(roomTypeId, date, duration)) return allowed;
    return allowed.filter(function (option) {
      const slot = ktvAvailableSlot(option.value);
      return option.value === current || !slot || slot.available;
    });
  }
  if (name === 'duration') return [2,3,4,6].map(function (value) { return { value: String(value), label: value + ' 小时', hint: value === 3 ? '推荐' : '' }; });
  return [2,3,4,5,6,8,10,12,15,20].map(function (value) { return { value: String(value), label: value + ' 人', hint: value <= 6 ? '小聚' : value <= 12 ? '聚会' : '团建' }; });
}

function bookingPickerTitle(name) {
  return { date: '选择到店日期', time: '选择到店时间', duration: '选择预计时长', partySize: '选择到店人数' }[name] || '请选择';
}

function openBookingPicker(name) {
  openBookingPickerFor('#ktv-order-form', name, bookingPickerTitle(name), bookingPickerOptions(name));
}

function openBookingPickerFor(formSelector, name, title, options) {
  const form = document.querySelector(formSelector);
  const input = form && form.querySelector('[name="' + name + '"]');
  if (!input) return;
  let picker = document.querySelector('#booking-picker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'booking-picker';
    picker.className = 'booking-picker-mask';
    picker.innerHTML = '<section class="booking-picker-sheet" role="dialog" aria-modal="true"><div class="booking-picker-handle"></div><header><button type="button" data-picker-cancel>取消</button><h3></h3><button type="button" data-picker-confirm>确定</button></header><div class="booking-picker-options"></div></section>';
    document.body.appendChild(picker);
  }
  picker.hidden = false;
  picker.setAttribute('aria-hidden', 'false');
  picker.dataset.name = name;
  picker.dataset.formSelector = formSelector;
  picker.dataset.value = input.value;
  picker.querySelector('h3').textContent = title;
  picker.querySelector('.booking-picker-options').className = 'booking-picker-options picker-' + name;
  picker.querySelector('.booking-picker-options').innerHTML = options.map(function (option) {
    return '<button type="button" class="booking-picker-option' + (option.value === input.value ? ' active' : '') + '" data-picker-value="' + option.value + '" data-picker-label="' + escapeHtml(option.label) + '"><strong>' + escapeHtml(option.label) + '</strong>' + (option.hint ? '<small>' + escapeHtml(option.hint) + '</small>' : '') + '<i>✓</i></button>';
  }).join('');
  picker.classList.add('show');
  document.body.classList.add('picker-open');
}

function closeBookingPicker() {
  const picker = document.querySelector('#booking-picker');
  if (picker) {
    picker.classList.remove('show');
    picker.setAttribute('aria-hidden', 'true');
    picker.hidden = true;
  }
  document.body.classList.remove('picker-open');
}

function confirmBookingPicker() {
  const picker = document.querySelector('#booking-picker');
  const form = document.querySelector(picker.dataset.formSelector || '#ktv-order-form');
  if (!picker || !form) return closeBookingPicker();
  const name = picker.dataset.name;
  const input = form.querySelector('[name="' + name + '"]');
  const selected = picker.querySelector('.booking-picker-option.active');
  if (input && selected) {
    input.value = selected.dataset.pickerValue;
    const display = form.querySelector('[data-picker-display="' + name + '"]');
    if (display) display.textContent = selected.dataset.pickerLabel;
    if (name === 'duration') updateBookingEstimate(form);
    if (name === 'date' || name === 'duration') refreshKtvAvailability(form);
  }
  closeBookingPicker();
}

window.SaasPicker = { open: openBookingPickerFor };

// —— KTV 报价：与后台「按房型定价」同源（/business/ktv/pricing）。
//    预约按**包厢类型**创建（具体包厢到店后由门店分配），所以房型列表 / 预约确认页 /
//    我的预约三处一律按房型取价，金额口径统一走后端 combinedUnitPrice（房型 + 服务）——
/** 批量取价：房型列表与我的预约共用同一份口径；同房型只请求一次，失败不影响列表渲染。 */
async function loadKtvRoomPricing(rooms) {
  try {
    await SAAS.resolveKtvRoomPricing(rooms);
  } catch (error) {
    console.warn('[saas] KTV room pricing load failed', error);
  }
}
/** 已解析的生效价：按房型 id / 包厢 id / 房型编码任一维度命中（未命中返回 null，不回退门店价）。 */
function ktvRoomPricing(room) { return SAAS.ktvPricingFor(room); }
/** 卡片口径（后端 combinedUnitPrice = 房型 + 服务，最小货币单位「分」）→ 「¥238.00/小时」；回退门店价时带「门店统一价」。 */
function ktvRoomPriceShort(room) {
  return SAAS.formatKtvRoomPriceLabel(ktvRoomPricing(room));
}
/**
 * 详情口径：一律用本地格式化的**结构化单价**（按当前币种渲染，未定价回退门店价时带标注）。
 * 不使用后端 displayText：它是后端按当时币种拼好的成串文案，直接展示会让同一页出现两种符号，
 * 而且切币种后不会跟着变——结构化字段才是唯一数据源。
 */
function ktvRoomPriceText(room) {
  return SAAS.formatKtvRoomPriceLabel(ktvRoomPricing(room));
}
/** 分项 + 合计口径（预约确认页）：「房型 <符号> 188.00/小时 + 服务 <符号> 50.00/小时 = 合计」；服务为 0 时返回空串。 */
function ktvRoomPriceBreakdown(room) {
  return SAAS.formatKtvRoomPriceBreakdown(ktvRoomPricing(room));
}
/** 房型卡片价格：明确标注「合计」（后端 combinedUnitPrice = 房型 + 服务），避免被读成房型单价。 */
function ktvRoomTypePriceShort(roomType) {
  var text = ktvRoomPriceShort(roomType);
  return text ? '合计 ' + text : '';
}
/** 预估费用 = 预计时长 × 该房型生效**合计**单价（房型 + 服务，与页面展示同一口径；到店按实际时长计费，仅作参考）。 */
function updateBookingEstimate(form) {
  var target = form && form.querySelector('[data-booking-estimate]');
  if (!target) return;
  var roomType = ktvRoomTypeCache[Number(form.dataset.roomTypeId)];
  var pricing = ktvRoomPricing(roomType);
  var priceText = ktvRoomPriceShort(roomType);
  var hours = Number((form.querySelector('[name="duration"]') || {}).value || 0);
  var estimate = SAAS.estimateKtvRoomFee(pricing, hours);
  if (!(estimate > 0) || !priceText) { target.innerHTML = ''; return; }
  target.innerHTML = '预估 <strong>' + minorMoney(estimate) + '</strong><small>' + hours + ' 小时 × ' + priceText + '（到店按实际时长计费）</small>';
}

/** 兼容历史链接 #/book-ktv/<包厢id>：按包厢反查它所属的房型，再进入房型预约页。 */
async function renderKtvBookFormFromRoom(roomId) {
  if (!ktvRoomCache[roomId]) await ensureRoomCache();
  const room = ktvRoomCache[roomId];
  return renderKtvBookForm(room && room.roomTypeId != null ? Number(room.roomTypeId) : 0);
}

/** 预约确认页：预约的是**房型**（包厢类型），具体包厢到店后由门店分配。 */
async function renderKtvBookForm(roomTypeId) {
  if (!(roomTypeId > 0)) {
    app.innerHTML = pageHead('KTV 预约', '<span></span>') + emptyState('🎤', '未选择包厢类型', '请返回上一页选择包厢类型后再提交预约');
    return;
  }
  let roomType = ktvRoomTypeCache[roomTypeId];
  // 深链/刷新直接落在预约页时房型缓存为空：先补一次房型字典，否则取不到该房型的生效价。
  if (!roomType) {
    await ensureRoomTypeCache();
    roomType = ktvRoomTypeCache[roomTypeId];
  }
  if (!roomType) {
    app.innerHTML = pageHead('KTV 预约', '<span></span>') + emptyState('⚠️', '包厢类型加载失败', '请检查网络后点击返回重试');
    return;
  }
  await loadKtvRoomPricing([roomType]);
  const priceShort = ktvRoomPriceShort(roomType);
  const priceDetail = ktvRoomPriceText(roomType);
  // 预约确认页按「房型 + 服务 = 合计」展示分项（服务单价为 0 时只展示合计单价，不出现「+ 0.00」分项）。
  const priceBreakdown = ktvRoomPriceBreakdown(roomType);
  const priceHeadline = priceBreakdown || priceDetail;
  const roomTypeName = roomType.name || ('包厢类型 #' + roomTypeId);
  // 房型图片：后台「房型管理」给房型上传的多图（主图在前）优先；没有配图才回落门店 KTV 占位图。
  // 图片是房型样板图，不代表已锁定某个包厢号，因此文案里不出现任何包厢号。
  const roomTypeFallback = image('ktv-' + ((Number(roomTypeId) % 4) + 1) + '.png');
  const roomTypePhotos = SAAS.ktvRoomTypeImageUrls(roomType);
  const roomTypePhoto = roomTypePhotos[0] || roomTypeFallback;
  // 多图时才出画廊：单图/无图保持原来的「主图 + 文案」结构，不引入多余空白。
  const roomTypeGallery = roomTypePhotos.length > 1
    ? `<section class="booking-gallery" data-room-gallery aria-label="房型图片">${roomTypePhotos.map((url, index) => `<button type="button" class="booking-gallery__item${index === 0 ? ' is-active' : ''}" data-room-photo="${escapeHtml(url)}" aria-label="查看第 ${index + 1} 张图片"><img src="${escapeHtml(url)}" alt="${escapeHtml(roomTypeName)}" loading="lazy" data-room-fallback="${escapeHtml(roomTypeFallback)}"></button>`).join('')}</section>`
    : '';
  const defaultDate = dateOffset(1);
  // 打开预约页取一次营业时间（失败回退默认 18:00–次日 05:00），时段选择与提交校验共用同一份。
  // 不传 storeId：C 端门店由服务端按签名上下文取，客户端不猜门店号。
  const hours = await loadBookingBusinessHours();
  const hoursText = businessHoursText(hours);
  // 默认时段必须来自服务端可约时段：不能把固定 18:00 写死，否则已有预约会把用户直接撞到 409。
  await loadKtvAvailability(roomTypeId, defaultDate, 3);
  const defaultTime = (ktvAvailability && ktvAvailability.slots.find(function (slot) { return slot.available; }) || {}).startTime
    || hours.openTime;
  const availabilityHint = ktvAvailabilityHint();
  app.innerHTML = `${pageHead('KTV 预约', '<span></span>')}
    <section class="booking-intro"><span>KTV RESERVATION</span><h1>填写预约信息</h1><p>选择到店时间并留下联系方式，门店确认后即可到店开台。</p></section>
    <section class="booking-summary"><img src="${escapeHtml(roomTypePhoto)}" alt="${escapeHtml(roomTypeName)}" data-room-fallback="${escapeHtml(roomTypeFallback)}" data-room-type-photo><div><small>已选包厢类型</small><h2>${escapeHtml(roomTypeName)}</h2><p>${roomType.capacity ? '建议 ' + roomType.capacity + ' 人以内' : '到店登记后开台'}</p><p class="booking-desc">具体包厢到店后由门店分配</p><strong>${escapeHtml(priceShort) || '无需在线支付'}</strong></div></section>
    ${roomTypeGallery}
    <form id="ktv-order-form" class="form-stack" data-room-type-id="${roomTypeId}">
      <section class="form-card booking-card"><header><span>01</span><div><h2>到店信息</h2><p>请按实际计划选择，方便门店留台</p></div></header>
        ${bookingPickerRow('date', '到店日期', defaultDate, bookingDateLabel(defaultDate, 1), '日')}
        ${bookingPickerRow('time', '到店时间', defaultTime, defaultTime, '时')}
        ${bookingPickerRow('duration', '预计时长', '3', '3 小时', '长')}
        ${bookingPickerRow('partySize', '到店人数', '2', '2 人', '人')}
        <p class="booking-hours" data-business-hours>营业时间：${escapeHtml(hoursText)}</p>
        ${availabilityHint ? `<p class="booking-hours" data-ktv-availability>${escapeHtml(availabilityHint)}</p>` : ''}
      </section>
      ${priceShort ? `<section class="form-card booking-card"><header><span>02</span><div><h2>包厢类型价格</h2><p>${escapeHtml(priceHeadline)}</p>${priceBreakdown && priceDetail ? `<p class="booking-price-detail">${escapeHtml(priceDetail)}</p>` : ''}</div></header><p class="booking-price-estimate" data-booking-estimate></p></section>` : ''}
      <section class="form-card booking-card contact-card"><header><span>${priceShort ? '03' : '02'}</span><div><h2>预约人信息</h2><p>仅用于本次预约联系与提醒</p></div></header>
        <label><span>姓名</span><input required name="name" autocomplete="name" placeholder="请输入预约人姓名"></label>
        <label><span>手机号码</span><input required name="phone" autocomplete="tel" inputmode="tel" pattern="1[0-9]{10}" placeholder="请输入 11 位手机号"></label>
        <label class="remark-row"><span>备注</span><textarea name="remark" rows="2" placeholder="生日布置、设备或其他需求（选填）"></textarea></label>
      </section>
      <div class="submit-spacer"></div><footer class="action-bar booking-action"><div><strong>${escapeHtml(priceShort) || '免支付'}</strong><small>提交后由门店确认具体包厢</small></div><button class="primary-button" type="submit">提交预约</button></footer>
    </form>`;
  updateBookingEstimate(app.querySelector('#ktv-order-form'));
  bindRoomImageFallback(app);
  bindRoomTypeGallery(app);
}

function renderVenueReservationSuccess(saved, fields, venue) {
  app.innerHTML = `${pageHead('提交成功', '<span></span>')}
    <section class="success"><div>✓</div><h1>预约已提交</h1><p>门店将电话与您确认到店。</p></section>
    <section class="plain-card success-summary"><div><span>预约编号</span><strong>${escapeHtml(saved.reservationNo || ('SaaS' + saved.id))}</strong></div><div><span>预约项目</span><strong>${escapeHtml(venue.title)}</strong></div><div><span>预约人</span><strong>${escapeHtml(fields.name || '')}</strong></div><div><span>到店时间</span><strong>${escapeHtml(fields.date + ' ' + fields.time)}</strong></div><div><span>状态</span><strong class="income">${escapeHtml(saved.status || 'PENDING')}</strong></div></section>`;
}

function renderKtvReservationSuccess(saved, fields, roomType) {
  const roomTypeName = roomType && roomType.name ? roomType.name : '包厢类型';
  app.innerHTML = `${pageHead('提交成功', '<span></span>')}
    <section class="success"><div>✓</div><h1>预约已提交</h1><p>门店将电话与您确认到店；具体包厢到店后由门店分配。</p></section>
    <section class="plain-card success-summary"><div><span>预约编号</span><strong>${escapeHtml(saved.reservationNo || ('SaaS' + saved.id))}</strong></div><div><span>预约包厢类型</span><strong>${escapeHtml(roomTypeName)}</strong></div><div><span>预约人</span><strong>${escapeHtml(fields.name)}</strong></div><div><span>到店时间</span><strong>${fields.date} ${fields.time}</strong></div><div><span>状态</span><strong class="income">${escapeHtml(saved.status || 'PENDING')}</strong></div></section>
    <div class="success-actions"><button class="primary-button" data-route="home">返回服务首页</button></div>`;
}

function venueCards(category) {
  const venue = data.venues[category];
  const sort = state.venueSort[category] || 'smart';
  let rows = venue.names.map((name, index) => ({
    index, name, image: venue.images[index % venue.images.length], rating: 4.9 - index * .1,
    sold: 1286 - index * 172, distance: .8 + index * .6,
    price: venue.packages[0].price + index * 20,
  }));
  if (sort === 'near') rows.sort((a,b) => a.distance - b.distance);
  if (sort === 'rating') rows.sort((a,b) => b.rating - a.rating);
  if (sort === 'price') rows.sort((a,b) => a.price - b.price);
  return rows;
}

function renderVenueList(category) {
  const venue = data.venues[category];
  if (!venue) return renderHome();
  const sort = state.venueSort[category] || 'smart';
  const chips = [['smart','智能排序'],['near','附近优先'],['rating','评分最高'],['price','价格最低']];
  app.innerHTML = `${pageHead(venue.title)}
    <input class="search" id="venue-search" placeholder="${venue.search}" aria-label="${venue.search}" />
    <div class="chips">${chips.map(([id,label]) => `<button class="chip ${sort === id ? 'active' : ''}" data-venue-sort="${id}" data-category="${category}">${label}</button>`).join('')}</div>
    <section class="list" id="venue-list">${venueCards(category).map(item => `
      <article class="venue-card" data-route="venue/${category}/${item.index}">
        <img src="${image(item.image)}" alt="${item.name}">
        <div class="venue-copy"><h3>${item.name}</h3><p><span class="rating">★ ${item.rating.toFixed(1)}</span> · 已售 ${item.sold}</p><p class="ellipsis">${venue.tags.join(' · ')}</p><p><span class="price">${mockMoney(item.price)}起</span> · 距离 ${item.distance.toFixed(1)}km</p></div>
      </article>`).join('')}</section>`;
  document.querySelector('#venue-search').addEventListener('input', event => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('.venue-card').forEach(card => card.hidden = query && !card.textContent.toLowerCase().includes(query));
  });
}

function renderVenueDetail(category, venueIndex = 0) {
  const venue = data.venues[category];
  const name = venue.names[venueIndex] || venue.names[0];
  app.innerHTML = `${pageHead(venue.title)}
    <section class="gallery"><img id="gallery-main" src="${image(venue.images[venueIndex % venue.images.length])}" alt="${name}"><div class="gallery-count">${venue.images.length}张</div></section>
    <section class="detail-card merchant"><h2>${name}</h2><p><span class="rating">★ 4.9</span>　环境4.9　服务4.8</p><div class="tag-row">${venue.tags.map(tag => `<span>${tag}</span>`).join('')}</div><p class="address">📍 ${venue.address}<button data-toast="已复制地址">复制</button></p></section>
    <div class="section-head"><h2>优惠套餐</h2><button data-toast="价格均为前端模拟">价格说明 ›</button></div>
    <section class="package-list">${venue.packages.map((pkg, index) => `<article class="package-card"><div><h3>${pkg.name}</h3><p>${pkg.desc}</p><small>随时退 · 过期自动退 · 剩余${pkg.stock}份</small></div><aside><strong>${mockMoney(pkg.price)}</strong><button data-route="book/${category}/${venueIndex}/${index}">预约</button></aside></article>`).join('')}</section>
    <div class="section-head"><h2>环境照片</h2><span></span></div>
    <div class="photo-strip">${venue.images.map(pic => `<button data-gallery="${image(pic)}"><img src="${image(pic)}" alt="${name}环境"></button>`).join('')}</div>
    <section class="detail-card"><h3>购买须知</h3><p>本页面为前端 mock 演示；请按预约时间到店，实际服务内容以门店确认为准。</p></section>`;
}

var venuePickerOptions = {};

function venuePickerField(formSelector, name, label, value, display) {
  return '<label>' + label +
    '<input type="hidden" name="' + name + '" value="' + escapeHtml(String(value)) + '">' +
    '<button type="button" class="booking-picker-row" data-venue-picker="' + name + '" data-form="' + formSelector + '">' +
      '<span class="booking-field-copy"><strong data-picker-display="' + name + '">' + escapeHtml(display) + '</strong></span>' +
      '<span class="booking-chevron">›</span>' +
    '</button></label>';
}

function venuePickerTitle(name) {
  return { date: '选择日期', time: '选择时间', slot: '选择台位/包厢' }[name] || '请选择';
}

function renderBooking(category, venueIndex = 0, packageIndex = 0) {
  const venue = data.venues[category];
  const pkg = venue.packages[packageIndex];
  const name = venue.names[venueIndex] || venue.names[0];
  const venueDate = dateOffset(1);
  venuePickerOptions.date = Array.from({ length: 14 }, function (_, index) {
    const value = dateOffset(index);
    return { value: value, label: bookingDateLabel(value, index), hint: value.replace(/-/g, '/') };
  });
  venuePickerOptions.time = bookingPickerOptions('time');
  venuePickerOptions.slot = venue.slots.map(function (slot) { return { value: slot, label: slot, hint: '' }; });
  app.innerHTML = `${pageHead('填写预约信息', '<span></span>')}
    <section class="summary-card"><img src="${image(venue.images[venueIndex % venue.images.length])}" alt="${name}"><div><h2>${name}</h2><p>${pkg.name}</p><strong>${mockMoney(pkg.price)}</strong></div></section>
    <form id="venue-order-form" class="form-stack" data-category="${category}" data-venue="${venueIndex}" data-package="${packageIndex}">
      <section class="form-card"><h2>到店信息</h2>
        ${venuePickerField('#venue-order-form', 'date', venue.dateLabel, venueDate, bookingDateLabel(venueDate, 1))}
        ${venuePickerField('#venue-order-form', 'time', venue.arrivalLabel, '19:30', '19:30')}
        ${venuePickerField('#venue-order-form', 'slot', category === 'hotel' ? '房间数量' : '选择台位/包厢', venue.slots[0], venue.slots[0])}
      </section>
      <section class="form-card"><h2>预约人信息</h2>
        <label>姓名<input required name="name" autocomplete="name" placeholder="请输入预约人姓名"></label>
        <label>手机号码<input required name="phone" autocomplete="tel" inputmode="tel" pattern="1[0-9]{10}" placeholder="用于接收预约提醒"></label>
        <label>备注<textarea name="remark" rows="2" placeholder="如有特殊需求请填写"></textarea></label>
      </section>
      <div class="submit-spacer"></div><footer class="action-bar"><span>合计 <strong>${mockMoney(pkg.price)}</strong></span><button class="primary-button" type="submit">提交订单</button></footer>
    </form>`;
}

function renderCatalog(category) {
  const catalog = data.catalogs[category];
  if (!catalog) return renderHome();
  app.innerHTML = `${pageHead(catalog.title, `<button class="head-action" data-route="cart">购物车 ${cartCount() ? `<b>${cartCount()}</b>` : ''}</button>`)}
    <input class="search" id="catalog-search" placeholder="搜索${catalog.title}商品" aria-label="搜索${catalog.title}商品">
    <div class="chips">${catalog.tags.map((tag,index) => `<button class="chip ${index === 0 ? 'active' : ''}" data-toast="已选择：${tag}">${tag}</button>`).join('')}</div>
    <section class="product-grid" id="product-list">${catalog.items.map((item,index) => `
      <article class="product-card"><button class="product-main" data-route="product/${category}/${index}"><img src="${image(item[3])}" alt="${item[0]}"><span><h3>${item[0]}</h3><p>${item[1]}</p><small>月售 ${item[4]} · 好评98%</small></span></button><footer><strong>${mockMoney(item[2])}</strong><button data-add="${category}/${index}">${catalog.action}</button></footer></article>`).join('')}</section>
    ${cartCount() ? `<button class="floating-cart" data-route="cart">🛒 已选 ${cartCount()} 件　去结算 ›</button>` : ''}`;
  document.querySelector('#catalog-search').addEventListener('input', event => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('.product-card').forEach(card => card.hidden = query && !card.textContent.toLowerCase().includes(query));
  });
}

function productFromKey(key) {
  const [category, rawIndex] = key.split('/');
  const catalog = data.catalogs[category];
  const index = Number(rawIndex);
  return { category, index, catalog, item: catalog?.items[index] };
}
function cartCount() { return Object.values(state.cart).reduce((sum, count) => sum + count, 0); }
function cartTotal() {
  return Object.entries(state.cart).reduce((sum, [key, count]) => {
    const product = productFromKey(key);
    return sum + (product.item?.[2] || 0) * count;
  }, 0);
}
function addCart(key, count = 1) {
  state.cart[key] = (state.cart[key] || 0) + count;
  saveLocal('saas-cart', state.cart);
  showToast('已加入购物车');
}

function renderProduct(category, index = 0) {
  const catalog = data.catalogs[category];
  const item = catalog.items[index];
  app.innerHTML = `${pageHead('商品详情', `<button class="head-action" data-route="cart">购物车 ${cartCount() || ''}</button>`)}
    <section class="product-hero"><img src="${image(item[3])}" alt="${item[0]}"></section>
    <section class="detail-card product-detail"><h1>${item[0]}</h1><strong>${mockMoney(item[2])}</strong><p>${item[1]}</p><div class="tag-row"><span>随时退</span><span>到店即用</span><span>过期自动退</span></div></section>
    <section class="detail-card"><h3>套餐内容</h3><ul><li>精选主商品 1 份</li><li>专属服务及配套 1 份</li><li>前端 mock 优惠权益</li></ul></section>
    <div class="submit-spacer"></div><footer class="action-bar"><span><small>优惠价</small> <strong>${mockMoney(item[2])}</strong></span><div><button class="secondary-button" data-add="${category}/${index}">加入购物车</button><button class="primary-button" data-buy="${category}/${index}">立即购买</button></div></footer>`;
}

function renderCart() {
  const entries = Object.entries(state.cart).filter(([,count]) => count > 0);
  app.innerHTML = `${pageHead('购物车', '<button class="head-action" data-clear-cart>清空</button>')}
    ${entries.length ? `<section class="cart-list">${entries.map(([key,count]) => {
      const product = productFromKey(key); const item = product.item;
      return `<article class="cart-card"><img src="${image(item[3])}" alt="${item[0]}"><div><h3>${item[0]}</h3><p>${mockMoney(item[2])}</p><div class="stepper"><button data-cart-step="${key}" data-delta="-1">−</button><span>${count}</span><button data-cart-step="${key}" data-delta="1">＋</button></div></div></article>`;
    }).join('')}</section><div class="submit-spacer"></div><footer class="action-bar"><span>合计 <strong>${mockMoney(cartTotal())}</strong></span><button class="primary-button" data-route="checkout">去结算</button></footer>` : emptyState('🛒','购物车还是空的','去服务首页挑选喜欢的商品吧')}`;
}

function renderCheckout() {
  if (!cartCount()) return renderCart();
  app.innerHTML = `${pageHead('确认订单', '<span></span>')}
    <form id="catalog-order-form" class="form-stack">
      <section class="form-card"><h2>预约人信息</h2><label>姓名<input required name="name" autocomplete="name" placeholder="请输入预约人姓名"></label><label>手机号码<input required name="phone" inputmode="tel" pattern="1[0-9]{10}" placeholder="用于接收订单提醒"></label><label>备注<textarea name="remark" rows="2" placeholder="口味、配送或到店需求"></textarea></label></section>
      <section class="form-card"><h2>商品明细</h2>${Object.entries(state.cart).map(([key,count]) => { const p = productFromKey(key); return `<div class="summary-row"><span>${p.item[0]} × ${count}</span><strong>${mockMoney(p.item[2] * count)}</strong></div>`; }).join('')}</section>
      <div class="submit-spacer"></div><footer class="action-bar"><span>合计 <strong>${mockMoney(cartTotal())}</strong></span><button class="primary-button" type="submit">提交订单</button></footer>
    </form>`;
}

async function renderPay(orderId, payable) {
  // 参数缺失（历史深链 / 异常跳转）统一回「我的订单」，不再落到已删除的 demo 订单页。
  if (!orderId || !payable) { go('my-orders'); return; }
  var methods = [];
  try { methods = await SAAS.getPaymentMethods(); } catch (e) {}
  var currency = SAAS.getCurrency();
  // 渠道能力先过滤一遍（后端返回能力字段时）：USD 租户下的微信/支付宝不进入支付页，
  // 避免用户填完金额、走到渠道下单才失败（后端仍会二次校验并返回错误码）。
  var usable = methods.filter(function (m) {
    if (!m.userVisible) return false;
    var supported = m.supportedCurrencies || m.currencies;
    if (Array.isArray(supported) && supported.length && supported.indexOf(currency) < 0) return false;
    if (m.currencyCode && m.currencyCode !== currency) return false;
    return true;
  });
  var NAME = { CASH: '现金', WALLET: walletBrand, POINT: '积分', ALIPAY: '支付宝', WECHAT: '微信支付', STRIPE: 'Stripe' };
  if (!usable.length) {
    var noMethod = methods.length
      ? '当前币种（' + currencyLabel() + '）没有可用的支付方式，请改用其他支付方式或联系门店'
      : '请联系门店开通支付方式';
    app.innerHTML = pageHead('订单支付', '<span></span>') + emptyState('💳', '暂无可用的支付方式', noMethod);
    return;
  }
  // 储值币 / 积分是**数量**口径（与后台收银台同一口径）：输入框填数量（个数），
  // 提交时按租户比例折回金额；现金 / 线上腿仍填金额。这里只展示可用数量，不带货币符号。
  var tokenHint = {};
  payLegAvailable = {};
  if (usable.some(function (m) { return m.method === 'WALLET'; })) {
    try {
      var wallet = await SAAS.getWallet();
      var walletCount = Number(wallet.tokenAmount);
      if (Number.isFinite(walletCount)) payLegAvailable.WALLET = Math.max(0, walletCount);
      tokenHint.WALLET = walletTokenText(wallet);
    } catch (e) { /* 余额读不到就不显示可用数量、也不本地拦截，提交时由服务端校验 */ }
  }
  if (usable.some(function (m) { return m.method === 'POINT'; })) {
    try {
      var points = await SAAS.getPoints();
      var pointCount = Number(points.balance);
      if (Number.isFinite(pointCount)) payLegAvailable.POINT = Math.max(0, pointCount);
      tokenHint.POINT = SAAS.formatPoints(points.balance);
    } catch (e) { /* 同上 */ }
  }
  var labels = usable.map(function (m) {
    var isToken = SAAS.isTokenMethod(m.method);
    var available = tokenHint[m.method];
    var hint = available ? '<small class="pay-available">可用 ' + escapeHtml(available) + '</small>' : '';
    var input = '<input name="pay_' + m.method + '" type="number" min="0" step="' + SAAS.legInputStep(m.method) +
      '" inputmode="' + (isToken ? 'numeric' : 'decimal') + '" placeholder="' + (isToken ? '0' : '0.00') + '" value="0">';
    // 数量腿不挂单位（既不是「个」也不是品牌名 / 「积分」）：只提示填数量、不带货币符号
    var note = isToken ? '<small class="pay-available">按数量填写，不带货币符号与单位</small>' : '';
    return '<label>' + (NAME[m.method] || m.method) + hint + input + note + '</label>';
  }).join('');
  app.innerHTML = pageHead('订单支付', '<span></span>') +
    '<form id="pay-form" class="form-stack" data-order-id="' + orderId + '" data-payable="' + payable + '">' +
    '<section class="form-card"><h2>应收金额</h2><p class="pay-amount">' + minorMoney(payable) + '</p></section>' +
    '<section class="form-card"><h2>组合支付</h2>' + labels +
    '<p class="mock-notice">各方式折算后的金额合计需等于应收金额（储值币 / 积分填数量，现金类填金额）</p></section>' +
    '<div class="submit-spacer"></div><footer class="action-bar"><button class="primary-button" type="submit">确认支付</button></footer></form>';
}

function travelDateShort(value, offset) {
  var prefix = offset === 0 ? '今天' : offset === 1 ? '明天' : offset === 2 ? '后天' : '周' + ['日','一','二','三','四','五','六'][new Date(value + 'T00:00:00').getDay()];
  return prefix + ' ' + value.slice(5).replace('-', '/');
}

var travelPickerOptions = {};

function travelPickerField(name, label, value, display) {
  return '<label>' + label +
    '<input type="hidden" name="' + name + '" value="' + escapeHtml(String(value)) + '">' +
    '<button type="button" class="booking-picker-row" data-travel-picker="' + name + '">' +
      '<span class="booking-field-copy"><strong data-picker-display="' + name + '">' + escapeHtml(display) + '</strong></span>' +
      '<span class="booking-chevron">›</span>' +
    '</button></label>';
}

function travelPickerTitle(name) {
  return { date: '选择出发日期', people: '选择乘机人数', dateTime: '选择用车时间' }[name] || '请选择';
}

function renderTravelSearch(kind) {
  const isFlight = kind === 'flights';
  const service = serviceById(kind);
  const travelDate = dateOffset(1);
  const travelDateTime = travelDate + 'T09:30';
  travelPickerOptions.date = Array.from({ length: 14 }, function (_, index) {
    const value = dateOffset(index);
    return { value: value, label: bookingDateLabel(value, index), hint: value.replace(/-/g, '/') };
  });
  travelPickerOptions.people = [
    { value: '1成人', label: '1 成人', hint: '' },
    { value: '2成人', label: '2 成人', hint: '' },
    { value: '2成人 1儿童', label: '2 成人 1 儿童', hint: '' }
  ];
  travelPickerOptions.dateTime = [];
  for (let day = 1; day <= 7; day++) {
    const date = dateOffset(day);
    ['09:30', '14:00', '18:00'].forEach(function (time) {
      travelPickerOptions.dateTime.push({
        value: date + 'T' + time,
        label: bookingDateLabel(date, day) + ' ' + time,
        hint: date.replace(/-/g, '/')
      });
    });
  }
  app.innerHTML = `${pageHead(service.name)}
    <section class="travel-hero"><span>${service.icon}</span><div><h2>${isFlight ? '国内机票预订' : '安心出行 · 快速叫车'}</h2><p>${isFlight ? '机场及航班信息均为前端 mock' : '车型、司机和价格均为前端 mock'}</p></div></section>
    <form id="travel-search-form" class="travel-search-form" data-kind="${kind}">
      ${isFlight ? `<div class="route-fields"><label>出发城市<input required name="from" value="${escapeHtml(state.travel.from)}"></label><button type="button" data-swap-route aria-label="交换出发和到达">⇄</button><label>到达城市<input required name="to" value="${escapeHtml(state.travel.to)}"></label></div>${travelPickerField('date', '出发日期', travelDate, travelDateShort(travelDate, 1))}${travelPickerField('people', '乘机人数', '1成人', '1 成人')}` : `<label>上车地点<input required name="pickup" value="${escapeHtml(state.travel.pickup)}"></label><button class="location-button" type="button" data-toast="已使用 mock 定位：深圳宝安国际机场 T3">◎ 使用当前位置</button><label>目的地<input required name="dropoff" value="${escapeHtml(state.travel.dropoff)}"></label>${travelPickerField('dateTime', '用车时间', travelDateTime, travelDateShort(travelDate, 1) + ' 09:30')}`}
      <button class="primary-button search-submit" type="submit">${isFlight ? '查询机票' : '立即叫车'}</button>
    </form>
    <section class="travel-benefits"><span>✓ 价格透明</span><span>✓ 服务接入中</span><span>✓ 不会产生订单</span></section>`;
}

function renderTravelResults(kind) {
  const isFlight = kind === 'flights';
  if (isFlight) {
    app.innerHTML = `${pageHead(`${state.travel.from}-${state.travel.to}`)}
      <div class="date-strip">${[-1,0,1,2].map(offset => { const value = new Date(`${state.travel.date}T00:00:00`); value.setDate(value.getDate()+offset); const date = SaasDateTime.localDateString(value); return `<button class="${offset===0?'active':''}" data-flight-date="${date}"><span>${offset===0?'出发':'可选'}</span><strong>${formatDate(date)}</strong><small>${mockMoney(558+Math.abs(offset)*22)}起</small></button>`; }).join('')}</div>
      <div class="chips"><button class="chip active">智能排序</button><button class="chip">价格最低</button><button class="chip">出发最早</button><button class="chip">仅看直飞</button></div>
      <section class="flight-list">${data.flights.map((flight,index) => `<article class="flight-card" data-route="travel-detail/flights/${index}"><div class="flight-times"><span><strong>${flight.start}</strong><small>${flight.from}</small></span><i>${flight.duration}${flight.direct?' · 直飞':' · 中转'}</i><span><strong>${flight.end}</strong><small>${flight.to}</small></span></div><footer><span>${flight.airline} ${flight.id} · ${flight.model}</span><strong>${mockMoney(flight.price)}</strong></footer></article>`).join('')}</section>`;
  } else {
    app.innerHTML = `${pageHead('选择车型')}
      <section class="route-summary"><span>●</span><div><strong>${escapeHtml(state.travel.pickup)}</strong><i></i><strong>${escapeHtml(state.travel.dropoff)}</strong></div><button data-route="service/taxi">修改</button></section>
      <section class="ride-list">${data.rides.map((ride,index) => `<article class="ride-card"><span class="ride-icon">${ride.icon}</span><div><h3>${ride.name}</h3><p>${ride.car} · ${ride.seats}</p><small>${ride.wait}</small></div><aside><strong>${mockMoney(ride.price)}</strong><button data-route="travel-detail/taxi/${index}">选择</button></aside></article>`).join('')}</section>`;
  }
}

function renderTravelDetail(kind, index = 0) {
  const isFlight = kind === 'flights';
  if (!isFlight) {
    const ride = data.rides[index];
    app.innerHTML = `${pageHead('行程详情')}
      <section class="detail-card ride-detail"><span>${ride.icon}</span><h2>${ride.name}</h2><p>${ride.car} · ${ride.seats} · ${ride.wait}</p><div class="tag-row"><span>专业司机</span><span>免费取消</span><span>行程保障</span></div></section>
      <section class="route-summary large"><span>●</span><div><strong>${escapeHtml(state.travel.pickup)}</strong><i></i><strong>${escapeHtml(state.travel.dropoff)}</strong></div></section>
      <section class="detail-card"><h3>服务包含</h3><ul><li>专业司机接驾服务</li><li>基础高速费与平台服务费</li><li>行程取消及延误保障</li></ul></section>
      <div class="submit-spacer"></div><footer class="action-bar"><span>预估 <strong>${mockMoney(ride.price)}</strong></span><button class="primary-button" data-route="travel-order/taxi/${index}/0">填写预订人</button></footer>`;
    return;
  }
  const flight = data.flights[index];
  const fares = [['经济舱优选', flight.price],['经济舱灵活', flight.price+65],['公务舱', flight.price+860]];
  app.innerHTML = `${pageHead('航班详情')}
    <section class="flight-detail"><h2>${escapeHtml(state.travel.from)} → ${escapeHtml(state.travel.to)}</h2><div class="flight-times"><span><strong>${flight.start}</strong><small>${flight.from}</small></span><i>${flight.duration}${flight.direct?' · 直飞':' · 经停'}</i><span><strong>${flight.end}</strong><small>${flight.to}</small></span></div><p>${flight.airline} ${flight.id} · ${flight.model}</p></section>
    <div class="section-head"><h2>选择舱位</h2><span></span></div>
    <section class="fare-list">${fares.map(([name,price],fareIndex) => `<article><div><h3>${name}</h3><p>行李额20KG · 可开发票 · 退改${fareIndex?'灵活':'有条件'}</p></div><aside><strong>${mockMoney(price)}</strong><button data-route="travel-order/flights/${index}/${fareIndex}">订</button></aside></article>`).join('')}</section>`;
}

function renderTravelOrder(kind, index = 0, fareIndex = 0) {
  const isFlight = kind === 'flights';
  const option = isFlight ? data.flights[index] : data.rides[index];
  const price = isFlight ? option.price + [0,65,860][fareIndex] : option.price;
  app.innerHTML = `${pageHead('填写订单', '<span></span>')}
    <section class="trip-summary"><strong>${isFlight ? `${escapeHtml(state.travel.from)} → ${escapeHtml(state.travel.to)}` : `${escapeHtml(state.travel.pickup)} → ${escapeHtml(state.travel.dropoff)}`}</strong><p>${isFlight ? `${option.airline} ${option.id} · ${option.start}-${option.end}` : `${option.name} · ${option.car}`}</p><span>${mockMoney(price)}</span></section>
    <form id="travel-order-form" class="form-stack" data-kind="${kind}" data-index="${index}" data-fare="${fareIndex}" data-price="${price}">
      <section class="form-card"><h2>${isFlight ? '乘机人信息' : '预订人信息'}</h2><label>姓名<input required name="name" autocomplete="name" placeholder="请填写真实姓名"></label>${isFlight ? '<label>身份证号<input required name="idNumber" inputmode="text" minlength="15" maxlength="18" placeholder="用于乘机实名认证"></label>' : ''}<label>手机号码<input required name="phone" inputmode="tel" pattern="1[0-9]{10}" placeholder="用于接收订单信息"></label><label>备注<textarea name="remark" rows="2" placeholder="选填"></textarea></label></section>
      <div class="submit-spacer"></div><footer class="action-bar"><span>合计 <strong>${mockMoney(price)}</strong></span><button class="primary-button" type="submit">提交订单</button></footer>
    </form>`;
}

// 后端时间统一是 LocalDateTime（无时区，即门店营业本地时间），展示按字面量取用，不按设备时区平移。
function formatDateTime(value) { return SaasDateTime.formatStoreDateTime(value); }

function reservationBadge(status) {
  var map = {
    PENDING: ['待确认', 'orange'], CONFIRMED: ['已确认', 'blue'], ARRIVED: ['已到店', 'green'],
    CONVERTED: ['已开台', 'green'], NO_SHOW: ['未到店', 'gray'],
    CANCELLED: ['已取消', 'gray'], COMPLETED: ['已完成', 'green']
  };
  var hit = map[status] || [status || '未知', 'gray'];
  return '<span class="badge ' + hit[1] + '">' + escapeHtml(hit[0]) + '</span>';
}

function orderBadge(status) {
  var map = {
    DRAFT: ['待确认', 'orange'], SERVING: ['服务中', 'blue'], WAITING_SETTLEMENT: ['待结算', 'orange'],
    WAITING_PAYMENT: ['待支付', 'orange'], COMPLETED: ['已完成', 'green'], VOIDED: ['已作废', 'gray'],
    PENDING_CONFIRM: ['待确认', 'orange'], CONFIRMED: ['已确认', 'blue'],
    CHECKED_IN: ['已入住', 'green'], CHECKED_OUT: ['已退房', 'gray'],
    DUE_OUT: ['待退房', 'orange'],
    CANCELLED: ['已取消', 'gray'], NO_SHOW: ['未到店', 'gray']
  };
  var hit = map[status] || [status || '未知', 'gray'];
  return '<span class="badge ' + hit[1] + '">' + escapeHtml(hit[0]) + '</span>';
}

/**
 * 「我的」页身份与资产（储值币/积分**数量**）：
 *  - 身份：接线已有 GET /api/v1/business/members/me（SAAS.getMember，懒解析并缓存）展示会员号；
 *    读取失败/无档案时保持中性文案（不再出现「SaaS 会员 / A」伪身份）。
 *  - 资产：首屏补一次，也是回到前台时的静默刷新入口；两个接口各自收敛失败，
 *    失败时保留上次成功值并给内联「重试」（data-retry="my"，复用全局委托），绝不留静默「—」。
 */
var myBalances = { coin: null, points: null };
var myIdentity = { memberNo: '', loading: false, loaded: false };

function myAvatarHtml() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/></svg>';
}

/** 身份副行：会员号拿不到时保持模板里的中性文案，不伪造姓名/头像。 */
function paintMyIdentity() {
  var el = document.querySelector('#my-identity-sub');
  if (!el || !myIdentity.memberNo) return;
  el.textContent = '会员号 ' + myIdentity.memberNo;
}

/** 会员号懒加载：成功一次即缓存；失败保持中性文案，下次进入「我的」再试（不阻塞首屏、不重复请求）。 */
function refreshMyIdentity() {
  if (!SAAS.live) return Promise.resolve();
  if (myIdentity.loaded || myIdentity.loading || typeof SAAS.getMember !== 'function') return Promise.resolve();
  myIdentity.loading = true;
  return SAAS.getMember().then(function (member) {
    myIdentity.loading = false;
    myIdentity.loaded = true;
    myIdentity.memberNo = member && member.memberNo ? String(member.memberNo) : '';
    if (routeIsCurrent('my')) paintMyIdentity();
  }, function (error) {
    myIdentity.loading = false;
    if (typeof console !== 'undefined' && console.warn) console.warn('[saas] member profile unavailable', error && error.message);
  });
}

/** 资产读取：两个接口各自成功/失败，返回结构化结果（不 throw，避免 unhandled rejection）。 */
function loadMyBalances() {
  var walletTask = SAAS.getWallet().then(
    function (wallet) { return { ok: true, text: walletTokenText(wallet) }; },
    function () { return { ok: false }; }
  );
  var pointsTask = SAAS.getPoints().then(
    function (points) { return { ok: true, text: SAAS.formatPoints(points.balance) }; },
    function () { return { ok: false }; }
  );
  return Promise.all([walletTask, pointsTask]).then(function (results) {
    return { wallet: results[0], points: results[1] };
  });
}

/** 落屏资产：成功值写缓存并更新节点；失败保留上次成功值（首次失败保留「—」），同时给可重试提示。 */
function paintMyBalances(result) {
  var failed = 0;
  if (result.wallet.ok) myBalances.coin = result.wallet.text;
  else failed += 1;
  if (result.points.ok) myBalances.points = result.points.text;
  else failed += 1;
  var coinEl = document.querySelector('#my-wallet-coin');
  if (coinEl) coinEl.textContent = myBalances.coin === null ? '—' : myBalances.coin;
  var pointsEl = document.querySelector('#my-wallet-points');
  if (pointsEl) pointsEl.textContent = myBalances.points === null ? '—' : myBalances.points;
  var notice = document.querySelector('#my-balance-notice');
  if (!notice) return;
  if (!failed) { notice.hidden = true; return; }
  notice.hidden = false;
  var text = document.querySelector('#my-balance-notice-text');
  if (text) text.textContent = failed === 2 ? '资产加载失败，请检查网络后重试。' : '部分资产加载失败，请检查网络后重试。';
}

function refreshMyBalances() {
  return loadMyBalances().then(function (result) {
    if (!routeIsCurrent('my')) return;
    paintMyBalances(result);
  }).catch(function (error) {
    // loadMyBalances 已把接口失败收敛成结构化结果；这里只做最后一道兜底，绝不留 unhandledrejection。
    if (typeof console !== 'undefined' && console.warn) console.warn('[saas] my balances failed', error && error.message);
  });
}

/** 「我的」菜单行：图标与底部 tab 同一套线性 SVG（不再用 emoji，避免各 ROM 尺寸/彩色位图差异）。 */
var MY_MENU_ICONS = {
  reservations: '<rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h3M8 17.5h5"/>',
  orders: '<path d="M6.5 3.5h11V21l-2-1.4-1.5 1.4-1.5-1.4L11 21l-1.5-1.4L8 21l-1.5-1.5z"/><path d="M9.5 8h5M9.5 12h5"/>',
  hotel: '<path d="M3 20V7M3 12h18v8M21 20v-4"/><path d="M7 9h4.5a2 2 0 0 1 2 2v1H7z"/>'
};

function myMenuItem(route, label, iconKey) {
  return '<button type="button" data-route="' + route + '">' +
    '<span class="me-item"><svg viewBox="0 0 24 24" aria-hidden="true">' + MY_MENU_ICONS[iconKey] + '</svg><span>' + escapeHtml(label) + '</span></span>' +
    '<span class="arrow">›</span></button>';
}

function renderMy() {
  // 重绘（回前台/重试）时先用上次成功值兜底，避免资产数字从「—」闪一下再回填。
  var coinText = myBalances.coin === null ? '—' : myBalances.coin;
  var pointsText = myBalances.points === null ? '—' : myBalances.points;
  var identityText = myIdentity.memberNo ? '会员号 ' + myIdentity.memberNo : '查看我的预约、订单与资产';
  app.innerHTML =
    '<section class="me-hero">' +
      '<div class="me-avatar" aria-hidden="true">' + myAvatarHtml() + '</div>' +
      '<div class="me-identity"><h2>我的</h2><p id="my-identity-sub">' + escapeHtml(identityText) + '</p></div>' +
    '</section>' +
    '<div class="me-stats">' +
      '<button class="me-stat" data-route="ledger/coin"><span>' + escapeHtml(walletBrand) + '</span><strong id="my-wallet-coin">' + escapeHtml(coinText) + '</strong></button>' +
      '<button class="me-stat" data-route="ledger/points"><span>积分</span><strong id="my-wallet-points">' + escapeHtml(pointsText) + '</strong></button>' +
    '</div>' +
    '<section class="me-menu">' +
      myMenuItem('my-reservations', '我的预约', 'reservations') +
      myMenuItem('my-orders', '我的订单', 'orders') +
    '</section>' +
    '<section class="home-notice" id="my-balance-notice" hidden><span>⚠️</span><p id="my-balance-notice-text">资产加载失败，请检查网络后重试。</p>' +
      '<button class="notice-retry" type="button" data-retry="my">重试</button></section>';
  refreshMyBalances();
  refreshMyIdentity();
}

/**
 * 历史预约的包厢图片/描述：用 /business/resources 的同一份数据按 resourceId 关联（失败不影响列表）。
 * 新预约只带房型、不带包厢，图片走房型占位，不依赖这份房态。
 */
async function ensureRoomCache() {
  try {
    var rooms = await SAAS.listKtvRooms();
    (rooms || []).forEach(function (room) {
      if (room && room.id != null) ktvRoomCache[room.id] = room;
    });
  } catch (e) {
    console.warn('[saas] KTV room media load failed', e);
  }
}

/** 房型缓存：预约确认页按房型 id 取房型名与生效价（深链/刷新时补一次房型字典）。 */
async function ensureRoomTypeCache() {
  try {
    var roomTypes = await SAAS.listKtvRoomTypes();
    (roomTypes || []).forEach(function (roomType) {
      if (roomType && roomType.roomTypeId != null) ktvRoomTypeCache[roomType.roomTypeId] = roomType;
    });
  } catch (e) {
    console.warn('[saas] KTV room types load failed', e);
  }
}

/**
 * 预约取价入参：新预约按房型（roomTypeId / roomTypeCode）；
 * 历史行只有 resourceId，能从房态反查到房型时也按房型取价（否则按包厢取价 + 门店统一价兜底）。
 */
function reservationPricingRef(r) {
  // 只给仍需到店/进行中的预约取实时房价；已取消/未到店/已完成的行不再触发 KTV 取价，
  // 避免当前门店没有 KTV 业务时产生 403。列表仍展示这些历史行。
  if (r.status === 'CANCELLED' || r.status === 'NO_SHOW' || r.status === 'COMPLETED') return null;
  var room = ktvRoomCache[r.resourceId];
  return {
    roomTypeId: r.roomTypeId != null ? r.roomTypeId : (room && room.roomTypeId != null ? room.roomTypeId : null),
    roomTypeCode: r.roomTypeCode || (room && room.roomTypeCode ? room.roomTypeCode : ''),
    id: r.resourceId == null || r.resourceId === '' ? null : Number(r.resourceId),
  };
}

function reservationCard(r) {
  var canCancel = r.status === 'PENDING' || r.status === 'CONFIRMED';
  var orderId = r.orderId == null || r.orderId === '' ? null : Number(r.orderId);
  var cancelBtn = canCancel
    ? '<button class="cancel-btn" data-cancel-reservation="' + r.id + '">取消预约</button>'
    : '';
  var orderBtn = Number.isFinite(orderId) && orderId > 0
    ? '<button class="secondary-button" data-order-bill="' + orderId + '">查看关联消费</button>'
    : '';
  var room = ktvRoomCache[r.resourceId];
  // 房型优先（roomTypeName → roomTypeCode）；历史行（迁移前只有 resourceId）回退旧包厢名并标注「历史预约」。
  var label = SaasReservationRoom.roomTypeLabel(r, room);
  var allocation = SaasReservationRoom.allocationText(r, room);
  var desc = label.historical && room && typeof room.description === 'string' ? room.description.trim() : '';
  // 与房型列表/预约确认页同一份取价结果（同房型只请求一次），口径保持一致。
  var priceText = ktvRoomPriceShort(reservationPricingRef(r));
  return '<article><header><span>预约 ' + escapeHtml(r.reservationNo || ('#' + r.id)) + '</span>' + reservationBadge(r.status) + '</header>' +
    '<div class="reservation-room">' + thumbHtml(label.historical ? roomThumb(room) : '', label.text, '🎤') +
      '<div class="reservation-room-copy"><h3>' + escapeHtml(label.text) +
        (label.historical ? ' <span class="badge gray">' + SaasReservationRoom.HISTORICAL_TEXT + '</span>' : '') + '</h3>' +
      (desc ? '<p class="reservation-desc">' + escapeHtml(desc) + '</p>' : '') +
      '<p class="reservation-desc">' + escapeHtml(allocation) + '</p></div></div>' +
    (priceText ? '<p>' + (label.historical ? '包厢价格：' : '包厢类型价格：') + escapeHtml(priceText) + '</p>' : '') +
    // 下单时间（预约单创建时间）：与「到店」区分，顾客据此核对提交时间
    (r.createdAt ? '<p>下单：' + escapeHtml(formatDateTime(r.createdAt)) + '</p>' : '') +
    '<p>到店：' + escapeHtml(formatDateTime(r.startAt)) + ' · ' + (r.partySize ? r.partySize + ' 人' : '人数待定') + '</p>' +
    '<footer><span>' + escapeHtml(r.contact || '') + '</span>' + orderBtn + cancelBtn + '</footer></article>';
}

/**
 * 订单展示金额：优先服务端给的**实时合计** `liveTotalAmount`（开台中＝明细 − 房费明细 + 实时房费，
 * 与账单/结账抽屉同口径；结台后即最终值），旧后端没有该字段时退回 `totalAmount`（已含上一次刷新的房费明细）。
 * 客户端**不得**自己把房费估算再加上去——那会把包厢费算两遍（后台收银台卡片就踩过：账单 6150 / 卡片 10150）。
 */
function orderLiveAmount(o) {
  if (!o) return 0;
  if (o.liveTotalAmount !== undefined && o.liveTotalAmount !== null) return o.liveTotalAmount;
  return o.totalAmount || 0;
}

/** 订单业态中文名：后端返回枚举（KTV / HOTEL），页面不直接展示英文；未知值原样保留、空值显示「消费」。 */
var ORDER_BUSINESS_LABELS = { KTV: 'KTV', HOTEL: '酒店' };
function orderBusinessLabel(type) {
  var key = String(type === null || type === undefined ? '' : type).toUpperCase();
  if (ORDER_BUSINESS_LABELS[key]) return ORDER_BUSINESS_LABELS[key];
  return key || '消费';
}

function orderCard(o) {
  // 酒店订单的展示状态以 booking 状态为准；ord_order.trade_status 可能仍是 DRAFT
  // （酒店预订确认不等于支付订单已结算），不能把 DRAFT 当成用户在“已确认”时看到的状态。
  var displayStatus = o.displayStatus || o.bookingStatus || o.status;
  var typeLabel = orderBusinessLabel(o.businessType);
  var itemBtn = o.status === 'SERVING'
    ? '<button class="primary-button" data-order-items="' + o.id + '">加服务项</button>'
    : '';
  var payBtn = o.status === 'WAITING_PAYMENT'
    ? '<button class="primary-button" data-route="order-bill/' + o.id + '">去支付</button>'
    : '';
  var billBtn = o.status !== 'SERVING' && o.status !== 'WAITING_PAYMENT'
    ? '<button class="secondary-button" data-route="order-bill/' + o.id + '">查看账单</button>'
    : '';
  // 「下单」时间：/me/orders 的持久化投影可能不带 createdAt（后端契约恒 null），
  // 缺失时整行不渲染，绝不出现「下单：—」。
  return '<article><header><span>' + escapeHtml(o.orderNo || ('#' + o.id)) + '</span>' + orderBadge(displayStatus) + '</header>' +
    '<h3>' + escapeHtml(typeLabel) + (typeLabel === '消费' ? '' : ' · 消费') + '</h3>' +
    (o.createdAt ? '<p>下单：' + escapeHtml(formatDateTime(o.createdAt)) + '</p>' : '') +
    '<footer><span>合计</span><b>' + minorMoney(orderLiveAmount(o), o.currencyCode) + '</b></footer>' + itemBtn + payBtn + billBtn + '</article>';
}

/**
 * 「我的预约」统一列表归一化（后端新契约 + 旧格式兼容）。
 *
 * 新契约：`[{ type:'KTV', ktv: ReservationView }, { type:'HOTEL', hotel: HotelBookingPo }]`；
 * 旧格式（滚动发布期）：数组项没有 `type`，就是 ReservationView → 按 KTV 归一，避免白屏。
 * 列表顺序保持接口顺序（后端已倒序），前端不再自己重排。
 */
function normalizeReservationItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(function (item) {
    if (!item || typeof item !== 'object') return null;
    var type = String(item.type || '').toUpperCase();
    if (type === 'HOTEL') return { type: 'HOTEL', hotel: item.hotel || item.booking || item };
    if (type === 'KTV') return { type: 'KTV', ktv: item.ktv || item.reservation || item };
    // 旧格式：没有 type 的 ReservationView
    return { type: 'KTV', ktv: item };
  }).filter(Boolean);
}

/**
 * 「我的预约」：统一展示 KTV 预约与酒店预订（同一接口返回两组 wrapper）。
 * 加载失败仍走 SaasPageLoad 错误态；会员档案未创建（404 MEMBER_NOT_FOUND）按空态处理。
 * KTV 项继续走 reservationCard（需要房型取价），酒店项复用 hotel-real.js 的 hotelOrderCard。
 */
async function loadMyReservations() {
  await ensureRoomCache();
  var items;
  try {
    items = await SAAS.listReservations();
  } catch (error) {
    if (isMemberNotInitialized(error)) return [];
    throw error;
  }
  var rows = normalizeReservationItems(items);
  var ktvItems = rows
    .filter(function (row) { return row.type === 'KTV'; })
    .map(function (row) { return row.ktv; })
    .filter(Boolean);
  // 只为 KTV 行取房型价（历史行按旧包厢取价），与房型列表/预约确认页口径一致。
  if (ktvItems.length) await loadKtvRoomPricing(ktvItems.map(reservationPricingRef));
  return rows;
}

/** 预约列表绘制：首屏与静默刷新共用同一份渲染（按接口顺序混排 KTV 卡与酒店卡）。 */
function paintMyReservations(items) {
  var rows = Array.isArray(items) ? items : ((items && items.rows) || []);
  var cards = rows.map(function (row) {
    if (row && row.type === 'HOTEL') {
      // hotelOrderCard 定义在 hotel-real.js（defer 加载顺序保证页面渲染时已就绪）；测试桩缺失时跳过该卡。
      return typeof hotelOrderCard === 'function' ? hotelOrderCard(row.hotel) : '';
    }
    return reservationCard(row && row.ktv ? row.ktv : row);
  }).filter(Boolean);
  var html = cards.length
    ? '<section class="item-list">' + cards.join('') + '</section>'
    : emptyState('📅', '还没有预约', '从服务首页预约后，会显示在这里');
  app.innerHTML = pageHead('我的预约', '<span></span>') + html;
  bindThumbFallback(app);
}

/**
 * 「我的预约」：加载态 → 接口 → 列表；任何失败/超时都渲染可重试的错误态（绝不停在「加载中…」）。
 * 统一走 SaasPageLoad.renderPage（加载态与错误态的唯一出口），并带路由守卫：
 * 请求期间用户已经点走，结果与错误态都直接丢弃，不落到别的页面上。
 */
async function renderMyReservations() {
  var route = 'my-reservations';
  await SaasPageLoad.renderPage({
    name: 'my-reservations',
    retryRoute: route,
    errorTitle: '预约加载失败',
    isCurrent: function () { return routeIsCurrent(route); },
    mount: function (html) { app.innerHTML = pageHead('我的预约', '<span></span>') + html; },
    load: loadMyReservations,
    render: paintMyReservations,
  });
}

/** 静默刷新「我的预约」：后台确认 / 到店 / 取消会改预约状态，回到前台时重取一次，不闪加载态。 */
function refreshMyReservations() {
  var route = 'my-reservations';
  return SaasPageLoad.refreshPage({
    name: 'my-reservations',
    isCurrent: function () { return routeIsCurrent(route); },
    load: loadMyReservations,
    render: paintMyReservations,
  });
}

/**
 * 「我的订单」列表数据：首屏与静默刷新共用同一份加载。
 * 展示**全部业态**（KTV / 酒店 / …）：`/me/orders` 返回什么就展示什么，业态由卡片标签中文化（orderCard）。
 * 订单行保留 `displayStatus || bookingStatus || status` 兜底，兼容旧数据/旧会话里的投影字段。
 * 首次进入且会员档案未创建（404 MEMBER_NOT_FOUND）按空列表处理，避免新用户「点了必然报错」。
 */
async function loadMyOrders() {
  var orders;
  try {
    orders = await SAAS.listOrders();
  } catch (error) {
    if (isMemberNotInitialized(error)) return [];
    throw error;
  }
  return Array.isArray(orders) ? orders : [];
}

/**
 * 「我的订单」绘制：首屏与静默刷新共用同一份渲染（金额只走 orderCard → orderLiveAmount）。
 * 内容没变就不动屏（避免无谓的整块重绘）：静默刷新时屏上不闪、不丢焦点。
 */
function paintMyOrders(items) {
  var list = Array.isArray(items) ? items : [];
  var html = pageHead('我的订单', '<span></span>') + (list.length
    ? '<section class="item-list">' + list.map(orderCard).join('') + '</section>'
    : emptyState('🧾', '还没有订单', '到店消费后，账单会显示在这里'));
  if (app.innerHTML === html) return;
  app.innerHTML = html;
}

/** 「我的订单」：接口失败/超时出可重试的错误态，不再把页面留在「加载中…」；带路由守卫。 */
async function renderMyOrders() {
  var route = 'my-orders';
  await SaasPageLoad.renderPage({
    name: 'my-orders',
    retryRoute: route,
    errorTitle: '订单加载失败',
    isCurrent: function () { return routeIsCurrent(route); },
    mount: function (html) { app.innerHTML = pageHead('我的订单', '<span></span>') + html; },
    load: loadMyOrders,
    render: paintMyOrders,
  });
}

/**
 * 静默刷新「我的订单」：后台确认自助加项 / 结台 / 收款都会改金额与状态，
 * 回到前台或长时间停留时重取一次服务端口径的列表（不自己算金额、不闪加载态、失败保留屏上数据）。
 */
function refreshMyOrders() {
  var route = 'my-orders';
  return SaasPageLoad.refreshPage({
    name: 'my-orders',
    isCurrent: function () { return routeIsCurrent(route); },
    load: loadMyOrders,
    render: paintMyOrders,
  });
}

function itemStatusText(s) {
  return { ACTIVE: '已生效', PENDING_APPROVAL: '待服务人员确认', REJECTED: '已拒绝' }[s] || s || '—';
}
function itemBadge(s) {
  var map = { ACTIVE: ['已生效', 'green'], PENDING_APPROVAL: ['待确认', 'orange'], REJECTED: ['已拒绝', 'gray'] };
  var hit = map[s] || [s || '未知', 'gray'];
  return '<span class="badge ' + hit[1] + '">' + escapeHtml(hit[0]) + '</span>';
}

/**
 * 「加服务项」页面：加载态 → 订单加项 + 目录两个接口 → 整页渲染。
 *
 * 线上缺陷（一直加载中）：这里原来直接 `await SAAS.listOrderItems(orderId)` / `listCatalog({})`，
 * 没有 try/catch、没有超时——C 端会话的权限快照不含 `order.view`（消费者应用只被授予
 * reservation.view / reservation.create），`GET /api/v1/business/orders/{id}/items` 直接回
 * 403 PERMISSION_DENIED，异常一路冒泡出 async 函数，页面就永远停在「加载中…」。
 * 现在两个 await 都放进 SaasPageLoad.renderPage：失败或超时一律渲染「加载失败 + 重试」。
 */
async function renderOrderItems(orderId) {
  var route = 'order-items/' + orderId;
  await SaasPageLoad.renderPage({
    name: 'order-items',
    retryRoute: route,
    errorTitle: '加项列表加载失败',
    mount: function (html) { app.innerHTML = pageHead('加服务项', '<span></span>') + html; },
    load: async function () {
      var orderItems = await SAAS.listOrderItems(orderId);
      var catalog = await SAAS.listCatalog({});
      return {
        orderItems: Array.isArray(orderItems) ? orderItems : [],
        catalog: Array.isArray(catalog) ? catalog : [],
      };
    },
    render: function (data) { paintOrderItems(orderId, data.orderItems, data.catalog); },
  });
}

function paintOrderItems(orderId, orderItems, catalog) {
  // 已加项按 catalogItemId 关联目录，复用目录里的主图（服务端目录项图片是商品/物料的镜像）。
  var catalogById = {};
  catalog.forEach(function (c) { catalogById[c.id] = c; });
  var listHtml = orderItems.length
    ? '<section class="item-list">' + orderItems.map(function (it) {
        var itemThumb = thumbHtml(catalogThumb(catalogById[it.catalogItemId]), it.nameSnapshot);
        return '<article class="order-item-card">' + itemThumb +
          '<div class="order-item-body"><header><span>' + escapeHtml(it.nameSnapshot || '加项') + ' × ' + it.quantity + '</span>' + itemBadge(it.status) + '</header>' +
          '<p>金额：' + minorMoney(it.totalAmount || 0, it.currencyCode) + '</p><footer><span>' + escapeHtml(itemStatusText(it.status)) + '</span></footer></div></article>';
      }).join('') + '</section>'
    : emptyState('➕', '暂无加项', '从下方目录点服务/点商品，服务人员确认后生效');

  // 目录：按分类分组，卡片带主图缩略图（无图显示占位），点卡片直接加 1 件。
  // 服务类目录项（item_type=SERVICE）没有实物字段：unitPrice 一定有（目录自身定价），
  // availableQuantity/unit/imageUrls 可能为空——缺失时展示「—」/空串，绝不因缺字段抛错。
  var categories = [];
  var byCat = {};
  catalog.forEach(function (c) {
    var cat = c.category || '其他';
    if (!byCat[cat]) { byCat[cat] = []; categories.push(cat); }
    byCat[cat].push(c);
  });
  var catalogHtml = categories.length
    ? categories.map(function (cat) {
        var cards = byCat[cat].map(function (c) {
          var soldOut = c.available === false;
          return '<button class="catalog-chip' + (soldOut ? ' catalog-chip-soldout' : '') + '" data-catalog-id="' + c.id + '"' + (soldOut ? ' disabled' : '') + '>' +
            thumbHtml(catalogThumb(c), c.name) +
            '<span class="cc-name">' + escapeHtml(c.name) + '</span>' +
            '<span class="cc-price">' + minorMoney(c.unitPrice) + '</span>' +
            '<span class="cc-unit">' + escapeHtml(soldOut ? (c.unavailableReason || '已售罄') : (c.unit || '')) + '</span>' +
            '</button>';
        }).join('');
        return '<section class="catalog-group"><h3>' + escapeHtml(cat) + '</h3><div class="catalog-grid">' + cards + '</div></section>';
      }).join('')
    : '<section class="form-card"><h2>目录暂无可用项目</h2><p class="form-hint">请联系门店服务人员补充目录后重试</p></section>';

  app.innerHTML = pageHead('加服务项', '<span></span>') +
    '<section class="form-card"><h2>点服务 / 点商品</h2></section>' +
    catalogHtml + listHtml;
  bindThumbFallback(app);

  app.querySelectorAll('[data-catalog-id]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var id = Number(btn.getAttribute('data-catalog-id'));
      try {
        await SAAS.addOrderItem(orderId, { catalogItemId: id, quantity: 1 });
        showToast('已提交，待服务人员确认');
        renderOrderItems(orderId);
      } catch (e) { showToast(apiErrorText(e, '提交失败，请稍后重试')); }
    });
  });
}

function billLine(label, amount, currencyCode) {
  return '<div><span>' + escapeHtml(label) + '</span><strong>' + minorMoney(amount, currencyCode) + '</strong></div>';
}

/** 秒 → 「X 小时 Y 分钟」文案（只做单位换算，不参与金额计算）。 */
function billDurationText(seconds) {
  var total = Math.max(0, Math.floor(Number(seconds || 0)));
  if (total <= 0) return '0 分钟';
  var hours = Math.floor(total / 3600);
  var minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return minutes > 0 ? hours + ' 小时 ' + minutes + ' 分钟' : hours + ' 小时';
  if (minutes <= 0) return '不足 1 分钟';
  return minutes + ' 分钟';
}

/**
 * 包厢费金额来源（后端 {@code roomFee.source}）：顾客必须知道这笔钱是实时值还是固化值。
 * HISTORICAL = 会话已取消/未结台、没有结台时刻 → 明说「时长未记录」，绝不用「0 分钟」冒充。
 */
function billRoomFeeSourceText(roomFee) {
  if (roomFee.source === 'LIVE') return '开台中实时值，结台后按结台时间固化';
  if (roomFee.source === 'CLOSED') return '结台固化值';
  if (roomFee.source === 'HISTORICAL') return '会话已取消/未结台，金额为历史固化值（不再随时间变化）';
  return '金额来自服务端账单';
}

/**
 * 包厢费「怎么算出来的」解释行（纯展示）：计价方案 / 计费时长（扣暂停）/ 每递增粒度单价 × 块数 /
 * 超时部分（标准时长与倍率）/ 是否已含 1 名标准服务人员 / 金额固化时刻。
 * 金额、块数、时长全部取后端账单字段，C 端不做任何金额或块数运算。
 */
function roomFeeExplainHtml(roomFee) {
  var parts = [];
  if (roomFee.planName) parts.push('计费方案 ' + escapeHtml(roomFee.planName));
  if (roomFee.durationKnown === false) {
    parts.push('时长未记录（' + escapeHtml(billRoomFeeSourceText(roomFee)) + '）');
  } else {
    var duration = '计费 ' + billDurationText(roomFee.durationSeconds);
    if (Number(roomFee.pausedSeconds || 0) > 0) duration += '（已扣暂停 ' + billDurationText(roomFee.pausedSeconds) + '）';
    parts.push(escapeHtml(duration));
  }
  var formula = minorMoney(roomFee.unitPrice) + ' × ' + escapeHtml(String(roomFee.quantity)) + ' 个计费单位';
  if (Number(roomFee.incrementMinutes || 0) > 0) {
    formula += '（每 ' + escapeHtml(String(roomFee.incrementMinutes)) + ' 分钟一档，不足一档让利不计）';
  }
  parts.push(formula);
  if (Number(roomFee.overSeconds || 0) > 0) {
    parts.push('其中超时 ' + billDurationText(roomFee.overSeconds) + '（标准 '
      + billDurationText(roomFee.standardSeconds) + '，按 ' + escapeHtml(String(roomFee.overtimeRate)) + ' 倍计）');
  }
  if (roomFee.roomFeeIncludesServer) parts.push('已含 1 名标准服务人员');
  if (roomFee.snapshotAt) parts.push('金额固化于 ' + escapeHtml(formatDateTime(roomFee.snapshotAt)));
  return '<p class="form-hint">' + parts.join(' · ') + '</p>';
}

/** 账单数据：首屏与静默刷新共用同一份加载（金额口径全部来自后端账单字段）。 */
function loadOrderBill(orderId) { return SAAS.getBill(orderId); }

/**
 * 账单绘制（唯一出口）：首屏 renderOrderBill 与静默刷新 refreshOrderBill 共用。
 * 金额一律取后端账单字段（totalAmount / paidAmount / payableAmount，均为分），客户端不做金额运算——
 * 与订单卡片同一套差额法，避免 C 端与后台收银台各算一遍（包厢费算两遍的历史缺陷）。
 * 内容没变就不动屏：静默刷新时屏上不闪、不丢焦点。
 */
function paintOrderBill(orderId, bill) {
  if (!bill || typeof bill !== 'object') throw new Error('账单暂不可用');
  // 已结算单据锁定币种快照：账单自带 currencyCode 时以记录为准；缺失才回退当前租户币种。
  var currencyCode = bill.currencyCode || bill.currency || null;
  // 包厢费明细名由后端账单给出（新口径「包厢费（含 1 名服务人员）」，历史账单保持原名），前端不硬编码两套。
  var roomFee = bill.roomFee
    ? billLine(bill.roomFee.name || '包厢费', bill.roomFee.amount, currencyCode)
    : '';
  // 包厢费「怎么算出来的」紧跟在这一行下面：计费时长（扣暂停）/ 每递增粒度单价 × 块数 / 超时部分 /
  // 计价方案 / 金额固化时刻。全部取后端账单字段，C 端不自己算块数、不自己加总。
  var roomFeeExplain = bill.roomFee ? roomFeeExplainHtml(bill.roomFee) : '';
  var items = (bill.items || []).map(function (item) {
    return billLine((item.name || '消费项目') + ' × ' + (item.quantity || 1), item.amount, currencyCode);
  }).join('');
  var servers = (bill.servers || []).map(function (server) {
    return billLine(server.serverName || '服务费', server.amount, currencyCode);
  }).join('');
  var promotions = (bill.promotions || []).map(function (promotion) {
    return billLine('优惠', -Math.abs(Number(promotion.amount || 0)), currencyCode);
  }).join('');
  var details = roomFee || items || servers || promotions
    ? roomFee + roomFeeExplain + items + servers + promotions
    : '<p class="form-hint">消费明细将在结台后生成。</p>';
  // 金额口径以后端账单为准：totalAmount 账单合计 / paidAmount 已收 / payableAmount 应收（均为分）。
  var paidAmount = Number(bill.paidAmount || 0);
  var payable = bill.payableAmount === undefined || bill.payableAmount === null
    ? Math.max(0, Number(bill.totalAmount || 0) - paidAmount)
    : Math.max(0, Number(bill.payableAmount));
  var settlement = (paidAmount > 0 ? billLine('已收', paidAmount, currencyCode) : '')
    + (payable > 0 ? billLine('应收', payable, currencyCode) : '');
  var payAction = bill.status === 'WAITING_PAYMENT' && payable > 0
    ? '<button class="primary-button" data-route="pay/' + orderId + '/' + payable + '">去支付</button>'
    : '';
  var html = pageHead('消费账单', '<span></span>') +
    '<section class="item-list bill-detail"><article><header><span>订单 #' + escapeHtml(orderId) + '</span></header>' +
    details + settlement + '<footer><span>账单合计</span><b>' + minorMoney(bill.totalAmount, currencyCode) + '</b></footer>' + payAction + '</article></section>';
  if (app.innerHTML === html) return;
  app.innerHTML = html;
}

async function renderOrderBill(orderId) {
  var route = 'order-bill/' + orderId;
  app.innerHTML = pageHead('消费账单', '<span></span>') + SaasPageLoad.loadingHtml('账单加载中…');
  try {
    var bill = await loadOrderBill(orderId);
    // 路由守卫：请求期间用户已经点走，这一批数据直接丢弃，不画到别的页面上。
    if (!routeIsCurrent(route)) return;
    paintOrderBill(orderId, bill);
  } catch (error) {
    console.error('[saas] order bill load failed', error);
    // 失败态整页替换（不再依赖 document.querySelector('.item-list') 一定存在），并给重试入口。
    if (!routeIsCurrent(route)) return;
    app.innerHTML = pageHead('消费账单', '<span></span>')
      + SaasPageLoad.errorHtml('账单加载失败', error, route);
  }
}

/** 静默刷新账单：后台结台 / 收款会改已收与应收，顾客盯着账单页时也要跟上（不闪加载态、失败保留屏上数据）。 */
function refreshOrderBill(orderId) {
  var route = 'order-bill/' + orderId;
  return SaasPageLoad.refreshPage({
    name: 'order-bill',
    isCurrent: function () { return routeIsCurrent(route); },
    load: function () { return loadOrderBill(orderId); },
    render: function (bill) { paintOrderBill(orderId, bill); },
  });
}

function render() {
  document.body.classList.remove('login-mode');
  const route = currentRoute();
  const parts = route.split('/');
  // 深链规范化：带 id / 类型段的路由缺失、非法或多出段时，先跳到规范路由再交给渲染函数。
  // 渲染函数用「规范化后的 route」做 isCurrent 守卫，hash 不先对齐会让结果被守卫丢弃，
  // 页面就永远停在加载骨架 /「加载中…」上（#/orders、#/ledger、#/order-bill/abc 等）。
  if (parts[0] === 'ledger' && (parts.length > 2 || (parts[1] !== 'coin' && parts[1] !== 'points'))) {
    go('ledger/' + (parts[1] === 'points' ? 'points' : 'coin'));
    return;
  }
  if ((parts[0] === 'order-bill' || parts[0] === 'order-items') && (parts.length > 2 || !(Number(parts[1]) > 0))) {
    go('my-orders');
    return;
  }
  if (parts[0] === 'real-hotel' && (parts.length > 2 || !(Number(parts[1]) > 0))) { go('service/hotel'); return; }
  const showTabs = route === 'home' || route === 'my';
  document.body.classList.toggle('has-tabs', showTabs);
  document.body.classList.toggle('booking-page', parts[0] === 'book-ktv');
  closeBookingPicker();
  syncEmbeddedHost();
  const tabBar = document.querySelector('#tab-bar');
  if (tabBar) {
    tabBar.querySelectorAll('.tab-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === (route === 'my' ? 'my' : 'home'));
    });
  }
  window.scrollTo(0, 0);
  if (route === 'home') return renderHome();
  if (route === 'my') return renderMy();
  if (route === 'my-reservations') return renderMyReservations();
  if (route === 'my-orders') return renderMyOrders();
  if (parts[0] === 'order-bill') return renderOrderBill(Number(parts[1] || 0));
  if (parts[0] === 'order-items') return renderOrderItems(Number(parts[1] || 0));
  // 历史深链 #/orders 先重定向到 #/my-orders 再渲染：renderMyOrders 用规范路由 'my-orders'
  // 做 isCurrent 守卫，hash 若仍是 orders 结果会被守卫丢弃、页面停在加载骨架。
  if (route === 'orders') { go('my-orders'); return; }
  // 「我的酒店订单」已并入「我的预约」统一列表：旧链接保留可用（重定向，不再有独立页面/菜单）。
  if (route === 'my-hotel-orders') { go('my-reservations'); return; }
  if (route === 'cart') return renderCart();
  if (route === 'checkout') return renderCheckout();
  if (parts[0] === 'pay') return renderPay(parts[1], Number(parts[2] || 0));
  if (parts[0] === 'ledger') return renderLedger(parts[1]);
  if (parts[0] === 'venue') return renderVenueDetail(parts[1], Number(parts[2] || 0));
  if (parts[0] === 'book') return renderBooking(parts[1], Number(parts[2] || 0), Number(parts[3] || 0));
  if (parts[0] === 'product') return renderProduct(parts[1], Number(parts[2] || 0));
  if (parts[0] === 'travel-results') return renderTravelResults(parts[1]);
  if (parts[0] === 'travel-detail') return renderTravelDetail(parts[1], Number(parts[2] || 0));
  if (parts[0] === 'travel-order') return renderTravelOrder(parts[1], Number(parts[2] || 0), Number(parts[3] || 0));
  // 预约路由：#/book-ktv/type/<房型id>（新）；#/book-ktv/<包厢id> 为历史链接，按包厢反查房型后进入。
  if (parts[0] === 'book-ktv') {
    return parts[1] === 'type'
      ? renderKtvBookForm(Number(parts[2] || 0))
      : renderKtvBookFormFromRoom(Number(parts[1] || 0));
  }
  if (parts[0] === 'real-hotel') return renderRealHotelDetail(Number(parts[1] || 0));
  if (parts[0] === 'service') {
    const service = serviceById(parts[1]);
    if (!service) return renderHome();
    if (service.id === 'hotel') return renderRealHotelList();
    if (service.kind === 'venue') return renderVenueList(service.id);
    if (service.kind === 'catalog') return renderCatalog(service.id);
    if (service.kind === 'business') return renderKtvBooking();
    return renderTravelSearch(service.id);
  }
  renderNotFound();
}

document.addEventListener('click', event => {
  const travelField = event.target.closest('[data-travel-picker]');
  if (travelField) {
    const fieldName = travelField.getAttribute('data-travel-picker');
    const options = travelPickerOptions[fieldName] || [];
    if (options.length && window.SaasPicker) {
      window.SaasPicker.open('#travel-search-form', fieldName, travelPickerTitle(fieldName), options);
    }
    return;
  }
  const venueField = event.target.closest('[data-venue-picker]');
  if (venueField) {
    const formSelector = venueField.getAttribute('data-form') || '#venue-order-form';
    const fieldName = venueField.getAttribute('data-venue-picker');
    const options = venuePickerOptions[fieldName] || [];
    if (options.length && window.SaasPicker) {
      window.SaasPicker.open(formSelector, fieldName, venuePickerTitle(fieldName), options);
    }
    return;
  }
  const pickerField = event.target.closest('[data-booking-picker]');
  if (pickerField) { openBookingPicker(pickerField.dataset.bookingPicker); return; }
  const pickerOption = event.target.closest('[data-picker-value]');
  if (pickerOption) {
    const picker = pickerOption.closest('#booking-picker');
    picker.querySelectorAll('.booking-picker-option').forEach(function (option) { option.classList.toggle('active', option === pickerOption); });
    picker.dataset.value = pickerOption.dataset.pickerValue;
    return;
  }
  if (event.target.closest('[data-picker-confirm]')) { confirmBookingPicker(); return; }
  if (event.target.closest('[data-picker-cancel]')) { closeBookingPicker(); return; }
  if (event.target.classList.contains('booking-picker-mask')) { closeBookingPicker(); return; }
  // 加载失败态的重试：同一路由重试不会触发 hashchange，必须显式重新渲染，否则「点了没反应」。
  const retryButton = event.target.closest('[data-retry]');
  if (retryButton) {
    const retryRoute = retryButton.dataset.retry;
    if (location.hash.replace(/^#\/?/, '') === retryRoute) render();
    else go(retryRoute);
    return;
  }
  // 明细页「加载更多」：用户主动翻页（不重置已加载行，失败只 toast 提示）。
  const ledgerMore = event.target.closest('[data-ledger-more]');
  if (ledgerMore) { loadLedgerMore(ledgerMore.dataset.ledgerMore); return; }
  const realHotel = event.target.closest('[data-real-hotel]');
  if (realHotel) { go('real-hotel/' + realHotel.dataset.realHotel); return; }
  if (event.target.closest('[data-hotel-quote]')) { quoteRealHotel(Number(currentRoute().split('/').pop())); return; }
  if (event.target.closest('[data-hotel-book]')) { bookRealHotel(Number(currentRoute().split('/').pop())); return; }
  const route = event.target.closest('[data-route]')?.dataset.route;
  if (route) return go(route);
  const tab = event.target.closest('[data-tab]');
  if (tab) { go(tab.dataset.tab); return; }
  if (event.target.closest('[data-back]')) {
    // 「我的」子页返回固定回「我的」：从 App 外深链进入时 history.back() 会直接退出应用。
    if (isMySectionRoute(currentRoute())) { go('my'); return; }
    if (location.hash && location.hash !== '#/home' && history.length > 1) history.back();
    else go('home');
    return;
  }
  const message = event.target.closest('[data-toast]')?.dataset.toast;
  if (message) return showToast(message);
  const orderItemsBtn = event.target.closest('[data-order-items]');
  if (orderItemsBtn) {
    go('order-items/' + orderItemsBtn.dataset.orderItems);
    return;
  }
  const orderBillBtn = event.target.closest('[data-order-bill]');
  if (orderBillBtn) {
    go('order-bill/' + orderBillBtn.dataset.orderBill);
    return;
  }
  const cancelResv = event.target.closest('[data-cancel-reservation]');
  if (cancelResv) {
    const id = cancelResv.dataset.cancelReservation;
    showConfirm('取消预约', '确认取消该预约？取消后不可恢复。', { confirmText: '确认取消', cancelText: '再想想' })
      .then(ok => {
        if (!ok) return;
        return SAAS.cancelReservation(id).then(function () {
          showToast('已取消预约');
          render();
        }).catch(function (e) {
          showToast(apiErrorText(e, '取消失败，请稍后重试'));
        });
      });
    return;
  }
  const sortButton = event.target.closest('[data-venue-sort]');
  if (sortButton) {
    state.venueSort[sortButton.dataset.category] = sortButton.dataset.venueSort;
    return renderVenueList(sortButton.dataset.category);
  }
  const gallery = event.target.closest('[data-gallery]');
  if (gallery) document.querySelector('#gallery-main').src = gallery.dataset.gallery;
  const addButton = event.target.closest('[data-add]');
  if (addButton) {
    addCart(addButton.dataset.add);
    const routeParts = location.hash.split('/');
    if (routeParts[1] === 'service') renderCatalog(routeParts[2]);
    return;
  }
  const buyButton = event.target.closest('[data-buy]');
  if (buyButton) { addCart(buyButton.dataset.buy); return go('cart'); }
  const step = event.target.closest('[data-cart-step]');
  if (step) {
    const key = step.dataset.cartStep;
    state.cart[key] = Math.max(0, (state.cart[key] || 0) + Number(step.dataset.delta));
    if (!state.cart[key]) delete state.cart[key];
    saveLocal('saas-cart', state.cart); return renderCart();
  }
  if (event.target.closest('[data-clear-cart]')) {
    state.cart = {}; saveLocal('saas-cart', state.cart); return renderCart();
  }
  if (event.target.closest('[data-swap-route]')) {
    const from = document.querySelector('[name="from"]'); const to = document.querySelector('[name="to"]');
    [from.value, to.value] = [to.value, from.value];
  }
  const dateButton = event.target.closest('[data-flight-date]');
  if (dateButton) { state.travel.date = dateButton.dataset.flightDate; renderTravelResults('flights'); }
  const roomAction = event.target.closest('[data-room-action]');
  if (roomAction) {
    const room = state.ktvRooms[Number(roomAction.dataset.roomIndex)];
    const next = { open: ['占用','蓝色'], arrive: ['占用','蓝色'], cancel: ['空闲','绿色'], settle: ['清理中','紫色'], clean: ['空闲','绿色'], repair: ['空闲','绿色'] }[roomAction.dataset.roomAction];
    if (next) { room[1] = next[0]; room[2] = next[1]; showToast('包厢状态已更新'); }
    else showToast(roomAction.dataset.roomAction === 'renew' ? '已续台1小时' : '转台功能已完成（mock）');
    renderKtvRoom(Number(roomAction.dataset.roomIndex));
  }
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  if (!form.reportValidity()) return;
  const fields = Object.fromEntries(new FormData(form));
  if (form.id === 'ktv-order-form') {
    const submitButton = form.querySelector('button[type="submit"]');
    const roomTypeId = Number(form.dataset.roomTypeId);
    const roomType = ktvRoomTypeCache[roomTypeId];
    // 预约预约的是房型：未选房型不提交（服务端同样会以 ROOM_TYPE_REQUIRED 拒绝）。
    if (!(roomTypeId > 0)) { showToast('请先选择包厢类型'); return; }
    // 到店时刻必须落在营业时段内（左闭右开）：判断只走 business-hours.js，服务端越界仍会 422 兜底。
    if (!isWithinBusinessHours(fields.time, bookingBusinessHours)) {
      showToast('到店时间需在营业时间内（' + businessHoursText(bookingBusinessHours) + '）');
      return;
    }
    const startAt = storeTimeAfter(fields.date, fields.time, 0);
    const endAt = storeTimeAfter(fields.date, fields.time, Number(fields.duration || 3));
    const payload = {
      businessType: 'KTV',
      roomTypeId: roomTypeId,
      startAt: startAt,
      endAt: endAt,
      partySize: Number(fields.partySize || 4),
      contact: fields.name + ' ' + fields.phone,
    };
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.dataset.originalText = submitButton.textContent;
      submitButton.textContent = '提交中…';
    }
    try {
      const saved = await SAAS.createReservation(payload);
      renderKtvReservationSuccess(saved, fields, roomType);
    } catch (error) {
      console.error('[saas] KTV reservation create failed', error);
      showToast(apiErrorText(error, '预约提交失败，请稍后重试'));
    } finally {
      if (submitButton && document.body.contains(submitButton)) {
        submitButton.disabled = false;
        submitButton.textContent = submitButton.dataset.originalText || '提交预约';
      }
    }
    return;
  }
  if (form.id === 'travel-search-form') {
    const kind = form.dataset.kind;
    Object.assign(state.travel, fields);
    return go(`travel-results/${kind}`);
  }
  if (form.id === 'venue-order-form') {
    showToast('该服务尚未接入交易后端，暂不能提交预约');
    return;
  }
  if (form.id === 'catalog-order-form') {
    showToast('商品服务尚未接入交易后端，暂不能提交订单');
    return;
  }
  if (form.id === 'pay-form') {
    const orderId = form.dataset.orderId;
    const payable = Number(form.dataset.payable);
    const legs = [];
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      if (key.startsWith('pay_')) {
        const method = key.slice(4);
        // 分腿输入口径唯一入口：数量腿（储值币 / 积分）按比例折回最小货币单位，现金 / 线上填的就是金额。
        const amount = SAAS.legInputToMinor(method, value, walletRatio);
        if (amount > 0) legs.push({ method: method, input: value, amount: amount });
      }
    }
    const payments = legs.map(function (leg) { return { method: leg.method, amount: leg.amount }; });
    const total = payments.reduce(function (s, p) { return s + p.amount; }, 0);
    if (total !== payable) { showToast('各方式折算后的金额合计需等于应收金额'); return; }
    // 数量不得超过可用：WALLET 折回金额后与储值余额比，POINT 的金额就是积分个数本身。
    // 可用数量未知（余额读不到）时不本地拦截，交给服务端校验。
    const over = legs.find(function (leg) {
      if (!SAAS.isTokenMethod(leg.method)) return false;
      const available = payLegAvailableInput(leg.method);
      if (available === null) return false;
      return SAAS.legInputExceedsAvailable(leg.method, leg.input, SAAS.legInputToMinor(leg.method, available, walletRatio), walletRatio);
    });
    if (over) {
      const available = payLegAvailableInput(over.method);
      const availableText = over.method === 'POINT'
        ? SAAS.formatPoints(available)
        : SAAS.formatTokens(available);
      showToast('数量超过可用（可用 ' + availableText + '）');
      return;
    }
    try {
      await SAAS.collectPayment(orderId, payable, payments);
      showToast('支付成功');
      go('my-orders');
    } catch (e) {
      showToast(apiErrorText(e, '支付失败，请稍后重试'));
    }
    return;
  }
  if (form.id === 'travel-order-form') {
    showToast('出行服务尚未接入交易后端，暂不能提交订单');
  }
});

function renderLogin() {
  document.body.classList.add('login-mode');
  app.innerHTML = '<section class="login-page">' +
    '<div class="login-brand"><span>SaaS</span><small>生活服务</small></div>' +
    '<h1>登录 C 端</h1>' +
    '<p class="login-lead">使用 SaaS 账号登录，或从 OpenChat 直接进入。</p>' +
    '<form id="c-login-form" class="login-form">' +
      '<label>手机号 / 登录账号<input name="identifier" autocomplete="username" required placeholder="请输入手机号或账号"></label>' +
      '<label>密码<input name="password" type="password" autocomplete="current-password" required placeholder="请输入密码"></label>' +
      '<p class="login-error" id="c-login-error" role="alert"></p>' +
      '<button class="primary-button" type="submit">登录</button>' +
    '</form>' +
    '<button class="secondary-button login-im-button" type="button" id="c-login-im">使用 OpenChat 登录</button>' +
    '<p class="login-foot">首次使用请先在 OpenChat 内完成手机号绑定。</p>' +
  '</section>';
  const form = document.querySelector('#c-login-form');
  const errorBox = document.querySelector('#c-login-error');
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const identifier = String(form.identifier.value || '').trim();
    const password = String(form.password.value || '');
    if (!identifier || !password) { errorBox.textContent = '请填写账号和密码'; return; }
    errorBox.textContent = '';
    button.disabled = true;
    button.textContent = '登录中…';
    try {
      const loginType = identifier.indexOf('@') >= 0 ? 'email' : 'phone';
      await window.SaasOAuth.loginWithPassword(loginType, identifier, password);
      document.body.classList.remove('login-mode');
      await loadWalletTokenConfig();
      booted = true;
      render();
    } catch (error) {
      if (error && (error.status === 401 || error.code === 'AUTH_INVALID_CREDENTIAL' || error.code === 'LOGIN_FAILED')) {
        errorBox.textContent = '账号或密码错误，请重试';
      } else if (error && (error.code === 'MEMBERSHIP_INACTIVE' || error.code === 'NO_CONSUMER_ACCESS'
          || error.code === 'CUSTOMER_NOT_BOUND' || error.code === 'IAM_CONTEXT_UNAVAILABLE')) {
        errorBox.textContent = '该账号还没有 C 端客户身份，请联系门店或在 SaaS 完成绑定';
      } else {
        errorBox.textContent = '登录失败，请检查网络后重试';
      }
      button.disabled = false;
      button.textContent = '登录';
    }
  });
  document.querySelector('#c-login-im').addEventListener('click', function () {
    window.SaasOAuth.startOAuth();
  });
}

function renderAuthError(error) {
  const detail = window.SaasAuthErrors ? window.SaasAuthErrors.describe(error) : {
    title: '暂时无法进入服务', description: '网络或授权服务异常，请稍后重试。', retryable: true
  };
  app.innerHTML = '<section class="empty"><span>🔐</span><h2>' + escapeHtml(detail.title)
    + '</h2><p id="auth-error-detail">' + escapeHtml(detail.description) + '</p><button class="primary-button" id="retry-auth">'
    + (detail.retryable ? '重新连接' : '重新检查') + '</button><button class="secondary-button" id="back-im">返回 IM</button></section>';
  document.querySelector('#retry-auth').addEventListener('click', async function (event) {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '检查中…';
    try {
      await window.SaasOAuth.ensureAuth();
      render();
    } catch (nextError) {
      if (nextError && nextError.code === 'LOGIN_REQUIRED') { renderLogin(); return; }
      renderAuthError(nextError);
    }
  });
  document.querySelector('#back-im').addEventListener('click', function () {
    if (window.GVBridge && typeof window.GVBridge.exitApp === 'function') {
      window.GVBridge.exitApp().catch(function () {});
      return;
    }
    if (window.GV_SDK && typeof window.GV_SDK.exitApp === 'function') {
      window.GV_SDK.exitApp();
      return;
    }
    if (history.length > 1) {
      history.back();
      return;
    }
    window.close();
  });
  console.error('[saas] auth failed', error);
}

window.addEventListener('hashchange', render);
// WebView 从 bfcache 恢复时 hashchange 不会再触发；酒店相关页面主动重渲染，避免停在旧错误态。
window.addEventListener('pageshow', function (event) {
  if (!event.persisted) return;
  var route = location.hash.replace(/^#\/?/, '');
  if (route === 'service/hotel' || route === 'my-hotel-orders' || route.indexOf('real-hotel/') === 0) render();
});
window.addEventListener('saas-activated', render);
// 币种落地/切换（context select 响应或 X-Currency 兜底）后整页重渲染：全站金额符号统一变化。
// 首屏渲染前不抢跑，避免页面先闪一次「品牌名未取到」的中间态（boot 收尾那次渲染已用上新币种）。
var booted = false;
window.addEventListener('currency-changed', function () { if (booted) render(); });

/**
 * 多端数据一致性 —— C 端的刷新策略（唯一入口）。
 *
 * 背景：后台「确认客户自助加项 / 结台 / 收款」后，C 端页面如果是停在原地的（用户没切页），
 * 屏上金额与状态会一直是旧的。这里补上**自然触发**的重取：
 *   1) visibilitychange → visible：切回标签页 / WebView 从后台唤起，静默重取当前页；
 *   2) 导航回到这些页面：仍走原有的 `hashchange → render()`（同一套 renderPage + 同一份 load/render），
 *      不新增第二条数据路径；
 *   3) 长时间停在前台（例如顾客盯着账单等结台）：45s 兜底一次（≥30s，不做轮询式刷新）。
 *
 * 三条铁律（与 SaasPageLoad.refreshPage 的分工）：
 *   · 静默：屏上已有数据时不挂加载态（不闪白），失败保留屏上数据（不整页替换成错误页）；
 *   · 幂等：同一路由已有刷新在途就不再叠一次请求；
 *   · 不串页：所有刷新都带路由守卫（routeIsCurrent），请求回来晚就整批丢弃。
 */
var REFRESH_INTERVAL_MS = 45000;
var refreshInFlight = {};

/** 路由 → 静默刷新函数：只登记「会被后台改动影响、且屏上常驻」的钱 / 状态视图。 */
function silentRefreshFor(route) {
  var parts = String(route).split('/');
  if (route === 'home') return refreshBalances;
  if (route === 'my') return refreshMyBalances;
  if (route === 'my-orders') return refreshMyOrders;
  if (route === 'my-reservations') return refreshMyReservations;
  if (parts[0] === 'ledger') return function () { return refreshLedger(parts[1]); };
  if (parts[0] === 'order-bill') return function () { return refreshOrderBill(Number(parts[1] || 0)); };
  return null;
}

/**
 * 静默刷新当前路由：visibilitychange（回到前台）与刷新定时器共用的**唯一入口**。
 * @returns {boolean} 是否真的发起了一次刷新
 */
function refreshVisibleView() {
  // 后台不刷：文档隐藏时一跳都不发（定时器在后台完全静默，切回来那次由 visibilitychange 触发）。
  if (document.hidden === true || document.visibilityState === 'hidden') return false;
  // 未激活（OAuth 未完成 / 本地演示模式）不刷：此时接口只会回 mock，刷了反而把演示数据盖到真数据上。
  if (!SAAS.live) return false;
  var route = currentRoute();
  var run = silentRefreshFor(route);
  if (!run) return false;
  // 幂等：同一路由已有刷新在途就不再叠一次（先到的那次会把最新数据落屏）。
  if (refreshInFlight[route]) return false;
  refreshInFlight[route] = true;
  var done = function () { refreshInFlight[route] = false; };
  Promise.resolve().then(run).then(done, done);
  return true;
}

document.addEventListener('visibilitychange', function () {
  if (document.hidden === true || document.visibilityState === 'hidden') return;
  refreshVisibleView();
});
// 长时间停留前台时的兜底（≥30s）：隐藏时由 refreshVisibleView 直接返回，不在后台空转。
setInterval(function () { refreshVisibleView(); }, REFRESH_INTERVAL_MS);

(async function boot() {
  try {
    await window.SaasOAuth.ready;
    // 先取租户储值配置（品牌名 + 代币比例）再首屏渲染，避免页面先闪一次硬编码品牌名
    await loadWalletTokenConfig();
    booted = true;
    render();
  } catch (error) {
    if (error && error.code === 'LOGIN_REQUIRED') {
      renderLogin();
      return;
    }
    renderAuthError(error);
  }
})();
