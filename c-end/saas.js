/**
 * gv_saas_mini_service — SaaS 后端 API 客户端（C 端 H5）。
 *
 * OAuth 成功后服务端写入同源 HttpOnly Cookie。本文件不读取 URL、桥配置或本地存储中的凭证。
 * mock 仅可由 5175 本地开发地址显式设置 preview=1 启用，生产请求失败必须显式失败。
 */
(function () {
  'use strict';

  var apiBase = window.location.origin;
  var memberId = '';
  var contract = 'business-v1';
  var live = false;
  var isLocalPreviewHost = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    || /^192\.168\./.test(window.location.hostname)) && window.location.port === '5175';
  var demoMode = isLocalPreviewHost && new URLSearchParams(window.location.search).get('preview') === '1'
    && window.SAAS_DEMO_MODE === true;
  var csrfToken = null;

  /** 请求超时默认值（毫秒）：接口永不返回时不能把页面钉在「加载中…」。 */
  var DEFAULT_REQUEST_TIMEOUT_MS = 15000;

  function basePath() {
    return apiBase.replace(/\/+$/, '');
  }

  /**
   * 请求超时毫秒数：`window.SAAS_REQUEST_TIMEOUT_MS` 可注入（测试与联调同一开关），
   * 缺失/非法/非正数一律回退默认值——超时兜底不能被一个坏配置关掉。
   */
  function requestTimeoutMs() {
    var raw = window.SAAS_REQUEST_TIMEOUT_MS;
    var value = Number(raw);
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(value) || value <= 0) {
      return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    return value;
  }

  /** 请求超时错误：错误码 REQUEST_TIMEOUT + 状态 504，交给 api-errors.js 翻中文。 */
  function requestTimeoutError(ms) {
    var error = new Error('请求超时（' + ms + 'ms 未响应）');
    error.code = 'REQUEST_TIMEOUT';
    error.status = 504;
    return error;
  }

  /**
   * 带超时的 fetch：AbortController 可用时同时**中止**底层请求（不留下悬挂连接），
   * 并保证超时后一定 reject——接口挂住时页面能走错误态而不是永远等待。
   * 运行环境缺少 AbortController/setTimeout（如极简 vm）时退化为普通 fetch，行为不变。
   */
  function fetchWithTimeout(url, init, ms) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var options = Object.assign({}, init);
    if (controller) options.signal = controller.signal;
    var pending = fetch(url, options);
    if (!(ms > 0) || typeof setTimeout !== 'function') return pending;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (controller) { try { controller.abort(); } catch (e) { /* 已结束的请求 abort 会抛错，忽略 */ } }
        reject(requestTimeoutError(ms));
      }, ms);
      var settle = function (fn) {
        return function (value) {
          if (typeof clearTimeout === 'function') clearTimeout(timer);
          fn(value);
        };
      };
      pending.then(settle(resolve), settle(reject));
    });
  }

  function buildHeaders(write, idempotencyKey) {
    var h = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': 'zh',
      // 声明所处应用族：网关据此选用 C 端会话；否则同浏览器内与运营后台的 B 端会话可能串号。
      'X-Saas-App': 'saas-a380-c'
    };
    if (contract) h['X-Client-Contract'] = contract;
    if (write) {
      h['Idempotency-Key'] = idempotencyKey;
      h['X-CSRF-Token'] = csrfToken;
    }
    return h;
  }

  async function ensureCsrfToken() {
    if (csrfToken) return csrfToken;
    var response = await fetchWithTimeout('/api/v1/auth/csrf?appId=saas-a380-c',
      { credentials: 'same-origin' }, requestTimeoutMs());
    if (!response.ok) throw new Error('无法获取 CSRF token');
    var payload = await response.json();
    csrfToken = payload && payload.csrfToken;
    if (!csrfToken) throw new Error('服务端未返回 CSRF token');
    return csrfToken;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /** HTTP 非 2xx：保留状态码与后端错误码/中文 message，交给 api-errors.js 翻译成中文提示。 */
  function httpError(status, text) {
    var error = new Error('HTTP ' + status + ' ' + text.slice(0, 200));
    error.status = status;
    try { error.payload = JSON.parse(text); } catch (e) { /* 非 JSON 响应体 */ }
    if (error.payload && typeof error.payload.code === 'string') error.code = error.payload.code;
    return error;
  }

  async function request(method, path, body) {
    var retriedAfterContextRefresh = false;
    var idempotencyKey = method === 'GET' ? null : uuid();
    while (true) {
      if (method !== 'GET') await ensureCsrfToken();
      // 每次尝试各带一份超时（401 刷新上下文后的重试不会共用上一轮的计时器）。
      var resp = await fetchWithTimeout(basePath() + path, {
        method: method,
        headers: buildHeaders(method !== 'GET', idempotencyKey),
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined
      }, requestTimeoutMs());
      // 网关 X-Currency 兜底：老接口响应体不带 currencyCode 时也能对齐全站符号（不覆盖已选币种）
      if (window.A380Money && typeof window.A380Money.applyResponseCurrency === 'function') {
        window.A380Money.applyResponseCurrency(null, resp);
      }
      if (resp.status === 401 && !retriedAfterContextRefresh
          && window.A380OAuth && typeof window.A380OAuth.refreshContext === 'function') {
        retriedAfterContextRefresh = true;
        await window.A380OAuth.refreshContext();
        continue;
      }
      if (!resp.ok) {
        var text = '';
        try { text = await resp.text(); } catch (e) {}
        throw httpError(resp.status, text);
      }
      if (resp.status === 204) return null;
      return resp.json();
    }
  }

  function unwrap(data) {
    if (data && typeof data === 'object' && !Array.isArray(data) && ('data' in data)) return data.data;
    return data;
  }

  function toList(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') return data.items || data.list || data.rows || data.records || [];
    return [];
  }

  function asString(v, fallback) {
    if (v === null || v === undefined) return fallback;
    return String(v);
  }

  function fallbackOrThrow(value, error) {
    if (demoMode) return typeof value === 'function' ? value() : value;
    throw error || new Error('登录会话尚未建立');
  }

  /** 默认营业时间（18:00–次日 05:00）的新副本：唯一口径在 business-hours.js，这里只做转发。 */
  function defaultBusinessHours() {
    var api = window.A380BusinessHours;
    // business-hours.js 未加载时也绝不返回 null：预约时间的默认值必须有可用的开门时刻
    if (!api || typeof api.parseBusinessHours !== 'function') return { openTime: '18:00', closeTime: '05:00' };
    return api.parseBusinessHours(api.DEFAULT_BUSINESS_HOURS);
  }

  // —— 金额口径：后端金额一律最小货币单位（cst_wallet_account.available_amount / ord_*_item.amount 等），
  //    展示唯一入口是 window.A380Money（c-end/money.js）。本文件只做转发：币种字典、÷/× 最小单位
  //    的换算都只允许在 money.js 内部，页面与接口层都不得再散落 /100、*100 或自建符号表。——
  function money() {
    var api = window.A380Money;
    if (!api) throw new Error('money.js 未加载：C 端金额展示唯一入口缺失');
    return api;
  }

  /** 当前租户币种（context select 响应 currencyCode，缺省 USD）。 */
  function getCurrency() {
    return money().getCurrency();
  }

  /** 落地当前租户币种；未知值回退当前币种并 warn，切换后触发页面重渲染。 */
  function setCurrency(currencyCode) {
    return money().setCurrency(currencyCode);
  }

  /** 币种名称（人民币 / 美元）；不向用户展示裸 'CNY' 码。 */
  function currencyLabel(currencyCode) {
    return money().currencyLabel(currencyCode);
  }

  // 分 -> 元（数值）：C 端历史契约返回数字，实现统一在 money.js。
  function fenToYuan(v) {
    return money().minorToYuan(v);
  }

  // 元 -> 分（数值，四舍五入）
  function yuanToFen(v, currencyCode) {
    return money().yuanToFen(v, currencyCode);
  }

  /** 最小货币单位 -> 展示金额「¥12.00」；currencyCode 缺省用当前租户币种，单据快照可显式传。 */
  function formatFen(v, currencyCode) {
    return money().formatMoney(v, currencyCode);
  }

  /** 元 -> 展示金额（仅前端演示数据使用；后端金额必须走 formatFen）。 */
  function formatYuan(v, currencyCode) {
    return money().formatYuan(v, currencyCode);
  }

  // —— 储值币（代币）/ 积分：**数量**口径，与币种无关 ——
  // 它们是组合支付里的一种支付工具，界面只显示数量：不带货币符号、币种，也不带品牌名 /
  // 「积分」/「个」这类单位（名字由支付方式、列头、标签承担）；
  // 展示与换算的唯一实现都在 money.js（本文件只转发，页面不得自己写 ÷100 × 比例）。
  /** 储值币数量 -> 「1,000」（只出数字）。 */
  function formatTokens(tokenCount) {
    return money().formatTokens(tokenCount);
  }

  /** 积分 -> 「300」（积分就是个数，1:1 不换算，只出数字）。 */
  function formatPoints(count) {
    return money().formatPoints(count);
  }

  /** 储值余额（最小货币单位）-> 代币数量：余额 ÷ 100 × 租户比例（默认 100）。 */
  function tokenCountFromMinor(minor, ratio) {
    return money().tokenCountFromMinor(minor, ratio);
  }

  /** 租户代币比例归一化：非法/缺失回退默认 100，不抛错。 */
  function tokenRatio(ratio) {
    return money().tokenRatio(ratio);
  }

  /** 是否是代币支付方式（WALLET / POINT）：数量口径，不参与金额合计。 */
  function isTokenMethod(method) {
    return money().isTokenMethod(method);
  }

  /** 组合支付分腿汇总：金额合计只由现金类分腿构成，代币/积分数量不计入。 */
  function paymentTotals(legs) {
    return money().paymentTotals(legs);
  }

  // —— 组合支付分腿输入口径（与后台 gv_saas_admin 的 payment-methods 同一份口径）——
  // 现金 / 线上腿是金额，储值币 / 积分腿是**数量**；提交给服务端的 amount 恒为最小货币单位整数。
  /** 代币数量 -> 最小货币单位整数（数量腿折回金额的唯一入口）。 */
  function tokensToMinor(tokens, ratio) {
    return money().tokensToMinor(tokens, ratio);
  }

  /** 分腿输入 -> 最小货币单位整数（页内合计与提交的唯一换算入口）。 */
  function legInputToMinor(method, value, ratio) {
    return money().legInputToMinor(method, value, ratio);
  }

  /** legInputToMinor 的逆运算：可用金额/数量 -> 分腿输入值（自动抵扣回填用）。 */
  function legMinorToInput(method, minor, ratio) {
    return money().legMinorToInput(method, minor, ratio);
  }

  /** 分腿输入是否超过可用（数量腿按比例折算成金额后比较）；true 表示应拒绝。 */
  function legInputExceedsAvailable(method, value, availableMinor, ratio) {
    return money().legInputExceedsAvailable(method, value, availableMinor, ratio);
  }

  /** 数量腿（储值币 / 积分）输入精度：个数无小数；金额腿两位小数。 */
  function legInputPrecision(method) {
    return money().legInputPrecision(method);
  }

  /** 数量腿按「个」递增，金额腿按最小展示步长递增。 */
  function legInputStep(method) {
    return money().legInputStep(method);
  }

  // C 端资产：懒解析当前账号的会员（+钱包/积分账户），并缓存。
  var memberCache = null;
  async function resolveMember() {
    if (memberCache) return memberCache;
    var s = unwrap(await request('GET', '/api/v1/business/members/me'));
    if (s && s.memberId != null) {
      memberId = s.memberId;
      window.SAAS.config.memberId = memberId;
    }
    memberCache = {
      memberId: memberId,
      wallet: s && s.wallet ? {
        availableAmount: asString(s.wallet.availableAmount !== undefined ? s.wallet.availableAmount : s.wallet.available_amount, '0'),
        frozenAmount: asString(s.wallet.frozenAmount !== undefined ? s.wallet.frozenAmount : s.wallet.frozen_amount, '0'),
        // 钱包是**按币种隔离**的账户（cst_wallet_account 唯一键含 currency_code）：currencyCode 只描述
        // `availableAmount` 这笔钱（对账用），页面展示的是代币数量、不带币种
        currencyCode: s.wallet.currencyCode || s.wallet.currency || null
      } : null,
      points: s && s.points ? {
        balance: asString(s.points.availablePoints !== undefined ? s.points.availablePoints : s.points.available_points, '0')
      } : null
    };
    return memberCache;
  }

  // ---- mock 数据（后端不可达时兜底，字段对齐 SaaS 契约） ----
  var MOCK_KTV_ROOMS = [
    { id: 101, resourceType: 'KTV_ROOM', resourceCode: 'K01', name: '小包 K01', capacity: 4, areaName: '一楼 A 区', status: 'ENABLED', available: true,
      imageUrls: ['./assets/images/ktv-1.png'], mainImageUrl: './assets/images/ktv-1.png', description: '星空顶小包，适合朋友小聚' },
    { id: 102, resourceType: 'KTV_ROOM', resourceCode: 'K02', name: '小包 K02', capacity: 4, areaName: '一楼 A 区', status: 'ENABLED', available: true,
      imageUrls: ['./assets/images/ktv-2.png'], mainImageUrl: './assets/images/ktv-2.png', description: '带独立音响的精致小包' },
    { id: 103, resourceType: 'KTV_ROOM', resourceCode: 'K08', name: '中包 K08', capacity: 8, areaName: '二楼 B 区', status: 'ENABLED', available: true,
      imageUrls: ['./assets/images/ktv-3.png'], mainImageUrl: './assets/images/ktv-3.png', description: '适合部门聚会的中包' },
    { id: 104, resourceType: 'KTV_ROOM', resourceCode: 'K12', name: '大包 K12', capacity: 15, areaName: '二楼 B 区', status: 'ENABLED', available: true,
      imageUrls: ['./assets/images/ktv-4.png'], mainImageUrl: './assets/images/ktv-4.png', description: '大屏投影，适合生日派对' },
    { id: 105, resourceType: 'KTV_ROOM', resourceCode: 'K15', name: '派对包 K15', capacity: 20, areaName: '三楼派对区', status: 'ENABLED', available: true,
      imageUrls: [], mainImageUrl: null, description: '可容纳 20 人的派对包（图片待补）' },
    { id: 106, resourceType: 'KTV_ROOM', resourceCode: 'V01', name: 'VIP V01', capacity: 12, areaName: '三楼 VIP 区', status: 'ENABLED', available: true,
      imageUrls: [], mainImageUrl: null, description: 'VIP 尊享包厢' }
  ];
  // 演示房型（包厢类型）：预约按房型创建，具体包厢到店后由门店分配。
  // 每类房型带一张**样板包厢**的展示图（真实环境由 /business/resources 的包厢主图归并而来）。
  var MOCK_KTV_ROOM_TYPES = [
    { id: 201, code: 'SMALL', name: '小包', capacity: 4, status: 'ACTIVE', mainImageUrl: './assets/images/ktv-1.png' },
    { id: 202, code: 'MID', name: '中包', capacity: 8, status: 'ACTIVE', mainImageUrl: './assets/images/ktv-2.png' },
    { id: 203, code: 'BIG', name: '大包', capacity: 15, status: 'ACTIVE', mainImageUrl: './assets/images/ktv-3.png' },
    { id: 204, code: 'VIP', name: 'VIP 尊享包', capacity: 12, status: 'ACTIVE', mainImageUrl: './assets/images/ktv-4.png' }
  ];
  // 演示钱包：金额字段与真实契约同口径（最小货币单位，只用于对账），币种不写死；
  // 代币**数量**由余额 ÷ 100 × 租户比例算出（见 withWalletTokens），页面只展示数量。
  var MOCK_WALLET = { availableAmount: '888000', frozenAmount: '0', currencyCode: null };
  var MOCK_POINTS = { balance: '12680' };

  /** 储值品牌展示名的默认值；真实展示名一律取租户配置 tnt_tenant_config.wallet_brand_name。 */
  var DEFAULT_WALLET_BRAND = 'A380币';

  /** 租户储值配置（品牌名 + 代币比例）全站只读一次：钱包、账本与页面共用同一份，避免同页多次请求。 */
  var walletTokenConfigRequest = null;

  /** 配置读取失败时的唯一回退：默认品牌名 + 默认比例（不抛错，页面照常按数量展示）。 */
  function defaultWalletTokenConfig() {
    return { brandName: DEFAULT_WALLET_BRAND, ratio: money().DEFAULT_TOKEN_RATIO };
  }

  /** 租户储值配置归一化：品牌名缺失回退默认展示名，比例非法/缺失回退 100（不抛错）。 */
  function normalizeWalletTokenConfig(data) {
    var d = data && typeof data === 'object' ? data : {};
    var ratio = d.ratio === undefined || d.ratio === null ? d.walletRatio : d.ratio;
    return {
      brandName: d.brandName || d.walletBrandName || d.wallet_brand_name || DEFAULT_WALLET_BRAND,
      ratio: tokenRatio(ratio)
    };
  }

  /**
   * 租户储值配置（品牌名 + 代币比例），全站只读一次并缓存。
   * 读不到时回退默认值且**不抛错**：一个配置接口失败不能让数量口径整页挂掉。
   */
  function ensureWalletTokenConfig() {
    if (!walletTokenConfigRequest) {
      var loading = live
        ? request('GET', '/api/v1/admin/tenant/config').then(function (data) {
            return normalizeWalletTokenConfig(unwrap(data));
          })
        : Promise.resolve(defaultWalletTokenConfig());
      walletTokenConfigRequest = loading.catch(function (e) {
        console.warn('[saas] 租户储值配置不可读，按默认品牌名/比例展示：', e && e.message);
        return defaultWalletTokenConfig();
      });
    }
    return walletTokenConfigRequest;
  }

  /**
   * 储值余额 -> 数量口径：服务端 `tokenAmount` 优先（已按余额 × 比例算好并取整）；
   * 服务端尚未发布该字段时，用租户配置比例在前端按**同一公式**换算
   * （唯一换算入口 money.js#tokenCountFromMinor），字段存在时一律以服务端值为准。
   * 代币数量与币种无关：`availableAmount` / `frozenAmount` / `currencyCode` 原样保留
   * （那仍是「这笔钱」的最小单位与币种，用于对账），只是页面不再当钱渲染。
   */
  async function withWalletTokens(wallet) {
    if (!wallet) return wallet;
    var config = await ensureWalletTokenConfig();
    var direct = wallet.tokenAmount;
    var count = direct === undefined || direct === null || direct === ''
      ? money().tokenCountFromMinor(wallet.availableAmount, config.ratio)
      : Number(direct);
    if (!Number.isFinite(count)) count = 0;
    wallet.tokenAmount = String(count);
    wallet.tokenBrandName = wallet.tokenBrandName || config.brandName;
    return wallet;
  }

  /** 储值账本行同样按数量口径补齐 tokenAmount：服务端给了就以服务端值为准，缺失才按比例换算。 */
  async function withLedgerTokens(rows) {
    var list = Array.isArray(rows) ? rows : [];
    if (!list.length) return list;
    var config = await ensureWalletTokenConfig();
    return list.map(function (row) {
      if (!row || typeof row !== 'object') return row;
      var direct = row.tokenAmount;
      if (direct === undefined || direct === null || direct === '') {
        var minor = row.amount !== undefined ? row.amount : row.amountMinor;
        row.tokenAmount = String(money().tokenCountFromMinor(minor, config.ratio));
      }
      if (!row.tokenBrandName) row.tokenBrandName = config.brandName;
      return row;
    });
  }

  // —— KTV 生效价：与后台「按房型定价」同源，C 端只展示、不自己算价 ——
  // 后端取值顺序：res_room_type.unit_price（房型字典单价）> 计价方案 unitPriceByRoomType[roomTypeCode] > 门店级 roomUnitPrice，
  // 计价单位 billingUnit 恒来自门店计价方案（房型只覆盖单价，见 KtvPricingPlan.forRoomType）。
  // 预约按**房型**创建（具体包厢到店后由门店分配），因此取价有三个维度，优先级与后端一致：
  // roomTypeId（新契约首选）> resourceId（房型字典价要按包厢取的旧契约 / 历史预约）> roomTypeCode（同房型共用）。
  var ktvPricingByResourceId = {};   // 包厢 id -> 生效价（按包厢取价后缓存）
  var ktvPricingByRoomTypeId = {};   // 房型 id -> 生效价（房型列表 / 预约按房型取价后缓存）
  var ktvPricingByRoomTypeCode = {}; // 房型编码 -> 生效价（同房型共用一份）
  var ktvPricingStore = null;        // 门店级方案：未设房型包厢的生效价，也是 billingUnit 的口径来源
  var ktvPricingStoreRequest = null; // 门店级请求去重
  var ktvPricingGroupRequests = {};  // 房型归并键 -> 进行中的请求（并发渲染不会重复发请求）

  /** GET /business/ktv/pricing：不传参=门店级；roomTypeId=该房型生效价（新契约）；resourceId=该包厢实际房型的生效价；roomTypeCode=仅计价方案按房型价。 */
  async function requestKtvPricing(params) {
    var qs = [];
    if (params && params.storeId != null) qs.push('storeId=' + encodeURIComponent(params.storeId));
    if (params && params.roomTypeId != null) qs.push('roomTypeId=' + encodeURIComponent(params.roomTypeId));
    if (params && params.resourceId != null) qs.push('resourceId=' + encodeURIComponent(params.resourceId));
    if (params && params.roomTypeCode) qs.push('roomTypeCode=' + encodeURIComponent(params.roomTypeCode));
    return unwrap(await request('GET', '/api/v1/business/ktv/pricing' + (qs.length ? '?' + qs.join('&') : '')));
  }

  /** 计费单位展示名，与后端 displayText 的 /小时、/半小时、/套餐 同一口径。 */
  function ktvBillingUnitLabel(billingUnit) {
    if (billingUnit === 'HALF_HOUR') return '半小时';
    if (billingUnit === 'PACKAGE') return '套餐';
    return '小时';
  }

  /**
   * 对客结算单价（分）：后端 combinedUnitPrice = roomUnitPrice + serverUnitPrice（C 端口径「包厢价格 =
   * 房型单价 + 服务单价」）；旧接口/服务单价为 0 时退回 roomUnitPrice（此时合计本就等于房型价）。
   */
  function ktvCombinedUnitPrice(pricing) {
    if (!pricing) return 0;
    var combined = Number(pricing.combinedUnitPrice || 0);
    if (Number.isFinite(combined) && combined > 0) return combined;
    return Number(pricing.roomUnitPrice || 0);
  }

  /** 生效价（分）→ 「¥128.00/小时」；无有效单价（0/缺失）返回空串，由页面退回「免支付」文案。 */
  function formatKtvRoomPrice(pricing) {
    var unitPrice = ktvCombinedUnitPrice(pricing);
    if (!(unitPrice > 0)) return '';
    return formatFen(unitPrice) + '/' + ktvBillingUnitLabel(pricing.billingUnit);
  }

  /**
   * 列表/卡片口径：房型未定价（或包厢未设置房型）回退门店价时补「门店统一价」，
   * 判断依据与后端 displayText 的「未定价，回退门店单价」一致（roomTypePriceApplied）。
   */
  function formatKtvRoomPriceLabel(pricing) {
    var text = formatKtvRoomPrice(pricing);
    if (!text) return '';
    return pricing.roomTypePriceApplied === false ? text + ' · 门店统一价' : text;
  }

  /**
   * 预约确认页「分项 + 合计」口径：`房型 ¥188.00/小时 + 服务 ¥50.00/小时 = ¥238.00/小时（含 1 名服务人员）`。
   * 服务单价为 0（或后端未返回分项）时返回空串：页面不得出现「+ ¥0.00」，直接展示合计文案。
   * 「含 1 名服务人员」与结台口径一致：包厢费基数已含 1 名标准服务人员，第 2 名起另计。
   */
  function formatKtvRoomPriceBreakdown(pricing) {
    if (!pricing) return '';
    var room = positivePrice(pricing.roomUnitPrice);
    var server = positivePrice(pricing.serverUnitPrice);
    var combined = ktvCombinedUnitPrice(pricing);
    if (!room || !server || !(combined > 0)) return '';
    var unit = '/' + ktvBillingUnitLabel(pricing.billingUnit);
    return '房型 ' + formatFen(room) + unit + ' + 服务 ' + formatFen(server) + unit
      + ' = ' + formatFen(combined) + unit + '（含 1 名服务人员）';
  }

  /**
   * 预估费用（分）= 合计单价 × 时长，四舍五入到分。
   * 预估必须与页面展示的「合计单价」同源（不能再用房型单价，否则预估比展示价低一截）。
   */
  function estimateKtvRoomFee(pricing, hours) {
    var unitPrice = ktvCombinedUnitPrice(pricing);
    var duration = Number(hours);
    if (!(unitPrice > 0) || !Number.isFinite(duration) || duration <= 0) return 0;
    return Math.round(unitPrice * duration);
  }

  /**
   * 只保留展示所需字段，避免把后端整包结构透传到页面。
   * 后端 `displayText` 是按**当时币种**拼好的成串文案，一律不落地：否则切币种后同一页会出现两种符号。
   */
  function normalizeKtvPricing(data) {
    if (!data) return null;
    return {
      billingUnit: data.billingUnit || 'HOUR',
      roomUnitPrice: Number(data.roomUnitPrice || 0),
      serverUnitPrice: Number(data.serverUnitPrice || 0),
      combinedUnitPrice: Number(data.combinedUnitPrice || 0),
      roomTypeId: data.appliedRoomTypeId == null ? null : Number(data.appliedRoomTypeId),
      roomTypeCode: data.appliedRoomTypeCode || null,
      roomTypeName: data.appliedRoomTypeName || null,
      roomTypePriceApplied: data.roomTypePriceApplied === true
    };
  }

  function positivePrice(value) {
    var n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * /business/resources 已回传房型字典单价时零额外请求；计价单位取门店方案的 billingUnit
   * （后端只让房型覆盖单价，不改计价单位）。当前资源视图不返回该字段，命中时为纯收益。
   */
  function ktvPricingFromRoomTypeDictionary(room, billingUnit) {
    var price = positivePrice(room && room.roomTypeUnitPrice);
    if (!price) return null;
    // 房型字典同时给了服务单价时一并带上：合计 = 房型 + 服务，与后端 combinedUnitPrice 同口径。
    var serverPrice = positivePrice(room && room.roomTypeServerUnitPrice);
    return {
      billingUnit: billingUnit || 'HOUR',
      roomUnitPrice: price,
      serverUnitPrice: serverPrice,
      combinedUnitPrice: price + serverPrice,
      roomTypeCode: room.roomTypeCode || null,
      roomTypeName: room.roomTypeName || null,
      roomTypePriceApplied: true
    };
  }

  /**
   * 缓存命中：房型 id 优先（房型列表 / 预约按房型），其次包厢 id，再其次房型编码。
   * **不做门店价兜底**：门店统一价会让所有房型显示成同一个价（线上缺陷的根因），
   * 只有确实没设房型的包厢才由 resolveKtvRoomPricing 显式回退。
   */
  function cachedKtvRoomPricing(room) {
    if (!room) return null;
    if (room.roomTypeId != null && ktvPricingByRoomTypeId[room.roomTypeId]) return ktvPricingByRoomTypeId[room.roomTypeId];
    if (room.id != null && ktvPricingByResourceId[room.id]) return ktvPricingByResourceId[room.id];
    var code = room.roomTypeCode ? String(room.roomTypeCode) : '';
    if (code && ktvPricingByRoomTypeCode[code]) return ktvPricingByRoomTypeCode[code];
    return null;
  }

  /** 是否已设房型：设了房型就不允许回退门店统一价（宁可无价，也不显示成统一价）。 */
  function isRoomTyped(room) {
    return !!(room && (room.roomTypeId != null || room.roomTypeCode));
  }

  /** 一份取价结果落到房型 id / 包厢 id / 房型编码三个缓存键上（同房型共用，键空间不串味）。 */
  function rememberKtvRoomPricing(room, pricing) {
    if (!pricing) return null;
    if (room && room.roomTypeId != null) ktvPricingByRoomTypeId[room.roomTypeId] = pricing;
    else if (room && room.id != null) ktvPricingByResourceId[room.id] = pricing;
    var code = room && room.roomTypeCode ? String(room.roomTypeCode) : '';
    if (code) ktvPricingByRoomTypeCode[code] = pricing;
    return pricing;
  }

  /** 取价缓存的读入口：页面按 { roomTypeId } / { id } / { roomTypeCode } 任一维度取已解析的生效价。 */
  function ktvPricingFor(room) {
    if (!room) return null;
    var hit = cachedKtvRoomPricing(room);
    if (hit) return hit;
    if (isRoomTyped(room)) return null;
    // 未设房型的包厢 / 历史预约：生效价就是门店统一价（与 resolveKtvRoomPricing 同一口径）。
    return room.id != null ? ktvPricingStore : null;
  }

  /** 结果映射的键：包厢 id 优先（历史调用方按包厢 id 取值），其次房型 id / 房型编码。 */
  function pricingResultKey(room) {
    if (!room) return null;
    if (room.id != null) return room.id;
    if (room.roomTypeId != null) return 'type:' + room.roomTypeId;
    if (room.roomTypeCode) return 'code:' + String(room.roomTypeCode);
    return null;
  }

  /** 房型归并键：有房型才归并（未设房型的包厢不取价，走门店统一价）。 */
  function roomTypeGroupKey(room) {
    if (!room) return null;
    if (room.roomTypeId != null) return 'id:' + room.roomTypeId;
    if (room.roomTypeCode) return 'code:' + String(room.roomTypeCode);
    return null;
  }

  /** 门店级方案（无房型包厢的生效价 + billingUnit 口径）：全店共用一次请求。 */
  function ensureStoreKtvPricing() {
    if (ktvPricingStore) return Promise.resolve(ktvPricingStore);
    if (!ktvPricingStoreRequest) {
      ktvPricingStoreRequest = requestKtvPricing({}).then(function (data) {
        ktvPricingStore = normalizeKtvPricing(data);
        return ktvPricingStore;
      }).catch(function () { return null; });
    }
    return ktvPricingStoreRequest;
  }

  /** 取价入参：有房型 id 就按房型取（预约/房型列表的新契约），否则退回代表包厢的 resourceId。 */
  function pricingRequestParams(room) {
    if (!room) return null;
    if (room.roomTypeId != null) return { roomTypeId: room.roomTypeId };
    if (room.id != null) return { resourceId: room.id };
    return null;
  }

  /** 一个房型只取一次价：优先按 roomTypeId 取（新契约），退回代表包厢的 resourceId 取房型字典价。 */
  function fetchKtvRoomTypePricing(groupKey, representative) {
    if (ktvPricingGroupRequests[groupKey]) return ktvPricingGroupRequests[groupKey];
    var params = pricingRequestParams(representative);
    if (!params) return Promise.resolve(null);
    ktvPricingGroupRequests[groupKey] = requestKtvPricing(params).then(function (data) {
      return rememberKtvRoomPricing(representative, normalizeKtvPricing(data));
    }).catch(function () { return null; });
    return ktvPricingGroupRequests[groupKey];
  }

  /**
   * 批量解析生效价：返回 { [包厢id / 房型键]: pricing }，并写入内部缓存供 ktvPricingFor 读取。
   * 同房型只请求一次（有 roomTypeId 按房型取，否则用代表包厢的 resourceId）；
   * 未设房型的包厢回退门店级方案；已缓存的房型/包厢不再发请求。
   * 单个房型取价失败只影响该房型（不展示价格），不影响整张列表。
   */
  async function resolveKtvRoomPricing(rooms) {
    var list = Array.isArray(rooms) ? rooms.filter(Boolean) : [];
    var result = {};
    if (!list.length) return result;

    var unresolved = [];
    list.forEach(function (room) {
      var hit = cachedKtvRoomPricing(room);
      var key = pricingResultKey(room);
      if (hit) { if (key !== null) result[key] = hit; }
      else unresolved.push(room);
    });
    if (!unresolved.length) return result;

    // 需要门店级方案的两种情况：有包厢未设房型；或列表已带房型字典单价（计价单位取自门店方案）。
    var needStore = unresolved.some(function (room) {
      return !isRoomTyped(room) || ktvPricingFromRoomTypeDictionary(room) !== null;
    });
    if (needStore) await ensureStoreKtvPricing();

    var groups = {};
    var groupKeys = [];
    unresolved.forEach(function (room) {
      var key = roomTypeGroupKey(room);
      if (!key || groups[key]) return;
      groups[key] = room;
      groupKeys.push(key);
    });
    await Promise.all(groupKeys.map(function (key) {
      var representative = groups[key];
      var fromDictionary = ktvPricingFromRoomTypeDictionary(representative,
        ktvPricingStore ? ktvPricingStore.billingUnit : null);
      if (fromDictionary) {
        rememberKtvRoomPricing(representative, fromDictionary);
        return null;
      }
      return fetchKtvRoomTypePricing(key, representative);
    }));

    list.forEach(function (room) {
      var key = pricingResultKey(room);
      if (key === null) return;
      // 只有确实未设房型的包厢才回退门店统一价；设了房型但取价失败就保持无价。
      var pricing = cachedKtvRoomPricing(room) || (isRoomTyped(room) ? null : ktvPricingStore);
      if (pricing) result[key] = pricing;
    });
    return result;
  }

  // —— KTV 包厢类型（房型）：预约预约的是**房型**，具体包厢到店后由门店分配 ——
  // 一个门店的包厢可能几十上百个，房型却只有几个，所以 C 端只让用户选房型。
  /** 房型字典 status：ACTIVE/ENABLED/缺省视为可预约（未知枚举不拦，避免把整页卡死）。 */
  function isBookableRoomTypeStatus(status) {
    var value = status ? String(status).toUpperCase() : '';
    return !value || value === 'ACTIVE' || value === 'ENABLED' || value === '1';
  }

  /**
   * 资源/房型的首图：主图优先，缺失/不合法时退回图片列表第一张（与后端「mainImageUrl 必属于 imageUrls」同规则）。
   * 只做 trim，不拼域名（网关同源相对路径 /api/v1/media-public/...），无图返回空串。
   */
  function roomFirstImage(room) {
    if (!room) return '';
    var main = typeof room.mainImageUrl === 'string' ? room.mainImageUrl.trim() : '';
    if (main) return main;
    var urls = Array.isArray(room.imageUrls) ? room.imageUrls : [];
    for (var i = 0; i < urls.length; i += 1) {
      if (typeof urls[i] === 'string' && urls[i].trim()) return urls[i].trim();
    }
    return '';
  }

  /**
   * 房型展示图：优先房型自带的主图 `imageUrl`（后台「房型管理」上传，主图优先）；
   * 取不到时退回 `fallbackUrl`（门店 KTV 占位图），保证卡片**不出现破图、不出现空 src**。
   * 这是房型展示图，不代表已锁定某个包厢号。
   */
  function ktvRoomTypeImageUrl(roomType, fallbackUrl) {
    var own = roomType && typeof roomType.imageUrl === 'string' ? roomType.imageUrl.trim() : '';
    return own || roomFirstImage(roomType) || (fallbackUrl || '');
  }

  /**
   * 房型图片全集（主图在首位、去重去空）：后台可为房型上传多图（最多 9 张，见 V8__res_room_type_media.sql），
   * 预约确认页据此渲染画廊；无图返回空数组（页面退门店占位图，不抛错）。
   */
  function ktvRoomTypeImageUrls(roomType) {
    var urls = [];
    var candidates = [];
    if (roomType && typeof roomType.imageUrl === 'string') candidates.push(roomType.imageUrl);
    var list = roomType && Array.isArray(roomType.imageUrls) ? roomType.imageUrls : [];
    candidates.concat(list).forEach(function (url) {
      var value = typeof url === 'string' ? url.trim() : '';
      if (value && urls.indexOf(value) < 0) urls.push(value);
    });
    // 兼容只给列表不给主图的响应：按「主图必须属于列表」规则取第一张。
    if (!urls.length) {
      var first = roomFirstImage(roomType);
      if (first) urls.push(first);
    }
    return urls;
  }

  /** 房型字典条目（/admin/resources/types 或资源列表）-> 展示与取价所需字段。 */
  function normalizeKtvRoomType(type) {
    if (!type) return null;
    var id = type.id == null ? type.roomTypeId : type.id;
    var status = type.status || '';
    // 房型样板图：房型字典自带（后台「房型管理」上传的主图）；缺图时由 attachKtvRoomTypeImages
    // 按包厢归并补一张样板图（老数据/未配图的房型）。
    var mainImage = roomFirstImage(type);
    return {
      roomTypeId: id == null ? null : Number(id),
      roomTypeCode: type.code || type.roomTypeCode || '',
      name: type.name || type.roomTypeName || type.code || '',
      capacity: Number(type.capacity || 0),
      status: status,
      storeId: type.storeId == null ? null : Number(type.storeId),
      imageUrl: mainImage,
      // 房型图片全集（主图在首位）：预约确认页的画廊用；缺图为空数组，页面退占位图。
      imageUrls: ktvRoomTypeImageUrls({ imageUrl: mainImage, imageUrls: type.imageUrls }),
      // 位置：房型字典不带，按包厢归并补齐（该房型的包厢所在区域，如「三楼 KTV」）。
      areaName: String(type.areaName || type.area || '').trim(),
      // 房型字典路径：可用性取 status；资源归并路径由调用方按房态覆盖。
      available: isBookableRoomTypeStatus(status)
    };
  }

  /** 可预约判定（页面与提交校验共用同一口径）。 */
  function isKtvRoomTypeBookable(type) {
    return !!(type && type.roomTypeId != null && type.available !== false);
  }

  /** 不可预约的中文原因（房型字典停用 / 当下没有可分配包厢 / 兜底）。 */
  function ktvRoomTypeUnavailableReason(type) {
    if (type && type.status && !isBookableRoomTypeStatus(type.status)) return '该包厢类型已停用';
    if (type && type.available === false) return '暂无可分配包厢';
    return '暂不可预约';
  }

  /**
   * 降级归并：/business/resources 已回传 roomTypeId / roomTypeCode / roomTypeName，
   * 按房型归并出一份房型列表。**没有设房型的包厢不参与**，否则会拿包厢号冒充房型。
   */
  function groupKtvRoomTypes(rooms) {
    var order = [];
    var byKey = {};
    (Array.isArray(rooms) ? rooms : []).forEach(function (room) {
      if (!room) return;
      var key = roomTypeGroupKey(room);
      if (!key) return;
      if (!byKey[key]) {
        byKey[key] = {
          roomTypeId: room.roomTypeId == null ? null : Number(room.roomTypeId),
          roomTypeCode: room.roomTypeCode || '',
          name: room.roomTypeName || room.roomTypeCode || '',
          capacity: Number(room.capacity || 0),
          status: '',
          storeId: room.storeId == null ? null : Number(room.storeId),
          // 房型展示图：该房型首个带图包厢的主图（样板图，不锁定包厢号）。
          imageUrl: roomFirstImage(room),
          // 该房型包厢所在区域（去重，最多展示 3 个），供 C 端卡片显示「位置」。
          areaNames: [],
          available: false
        };
        order.push(byKey[key]);
      }
      var type = byKey[key];
      if (!type.capacity && room.capacity) type.capacity = Number(room.capacity);
      if (!type.imageUrl) type.imageUrl = roomFirstImage(room);
      var roomArea = String(room.areaName || '').trim();
      if (roomArea && type.areaNames.indexOf(roomArea) < 0) type.areaNames.push(roomArea);
      if (room.available !== false) type.available = true;
    });
    // 新契约创建预约必须带 roomTypeId：归并不出 id 的房型不可下单，直接剔除。
    return order.filter(function (type) { return type.roomTypeId != null; }).map(function (type) {
      type.areaName = type.areaNames.slice(0, 3).join(' / ');
      delete type.areaNames;
      return type;
    });
  }

  /**
   * 房型展示图补齐（**降级路径**）：房型字典已可自带图片（后台「房型管理」上传），
   * 只有老数据/未配图的房型才按 /business/resources 的包厢归并取该房型**首个带图包厢**的主图
   * 作为样板图（不暗示锁定某个包厢号）。房型自带图时必须原样保留，不得被包厢图覆盖。
   * 资源列表读不到时保持空串，由页面退回门店占位图——绝不能因为缺图让整页报错。
   */
  async function attachKtvRoomTypeImages(types) {
    if (!types.length) return types;
    var rooms = [];
    try {
      rooms = await window.SAAS.listKtvRooms();
    } catch (e) {
      console.warn('[saas] 包厢资源不可读，房型展示图退回门店占位图：', e && e.message);
      return types;
    }
    var imageByKey = {};
    var areaByKey = {};
    (rooms || []).forEach(function (room) {
      var key = roomTypeGroupKey(room);
      if (!key) return;
      // 位置与图片都从包厢归并：同一房型的包厢可能分布在多个区域，按出现顺序去重。
      var area = String(room.areaName || '').trim();
      if (area) {
        if (!areaByKey[key]) areaByKey[key] = [];
        if (areaByKey[key].indexOf(area) < 0) areaByKey[key].push(area);
      }
      if (imageByKey[key]) return;
      var url = roomFirstImage(room);
      if (url) imageByKey[key] = url;
    });
    types.forEach(function (type) {
      var key = roomTypeGroupKey({ roomTypeId: type.roomTypeId, roomTypeCode: type.roomTypeCode });
      if (!type.imageUrl && key && imageByKey[key]) type.imageUrl = imageByKey[key];
      if (!type.areaName && key && areaByKey[key]) type.areaName = areaByKey[key].slice(0, 3).join(' / ');
    });
    return types;
  }

  /**
   * 房型列表 = 后台房型字典 GET /api/v1/admin/resources/types（字段 id / code / name / capacity / status）。
   * 该接口虽是后台路径，C 端会话（appId=saas-a380-c）已可直接读取（联调实测 200，见提交说明）；
   * 读不到时按既有降级：用 /business/resources 的资源列表按房型归并（绝不拿包厢号当房型）。
   */
  async function listKtvRoomTypes() {
    try {
      if (!live) return fallbackOrThrow(function () { return MOCK_KTV_ROOM_TYPES.map(normalizeKtvRoomType); });
      var data = await request('GET', '/api/v1/admin/resources/types');
      var types = toList(unwrap(data)).map(normalizeKtvRoomType).filter(function (type) {
        return type && type.roomTypeId != null;
      });
      // 房型自带图优先；只有未配图的房型才用包厢归并出的样板图补齐（缺图不报错）。
      return await attachKtvRoomTypeImages(types);
    } catch (e) {
      console.warn('[saas] 房型字典不可读，回退按资源列表归并房型：', e && e.message);
      var rooms = await window.SAAS.listKtvRooms();
      return groupKtvRoomTypes(rooms);
    }
  }

  window.SAAS = {
    mode: live ? 'live' : (demoMode ? 'demo' : 'loading'),
    live: live,
    config: { apiBase: apiBase, memberId: memberId },

    /** 请求超时（毫秒）：window.SAAS_REQUEST_TIMEOUT_MS 可注入；页面加载守卫读同一开关。 */
    DEFAULT_REQUEST_TIMEOUT_MS: DEFAULT_REQUEST_TIMEOUT_MS,
    requestTimeoutMs: requestTimeoutMs,

    /** 储值品牌展示名默认值（各页面取租户配置失败时的唯一回退，不得再散落硬编码）。 */
    DEFAULT_WALLET_BRAND: DEFAULT_WALLET_BRAND,

    /**
     * 币种：全局唯一来源 = context select 响应 currencyCode（缺省 USD），切换后全站符号同步变化。
     * 金额展示一律走 formatFen/formatYuan（内部转发 c-end/money.js），不得自建符号表。
     */
    getCurrency: getCurrency,
    setCurrency: setCurrency,
    currencyLabel: currencyLabel,

    /** 金额口径：后端一律最小货币单位，展示唯一入口是 formatFen/formatYuan（转发 money.js）。 */
    formatMoney: formatFen,
    fenToYuan: fenToYuan,
    yuanToFen: yuanToFen,
    formatFen: formatFen,
    formatYuan: formatYuan,

    /**
     * 储值币（代币）/ 积分是**数量**口径，不是货币：展示一律走 formatTokens / formatPoints，
     * **禁止**对它们调用 formatFen/formatMoney（否则会渲染成「$100.00」这种货币样式）。
     */
    formatTokens: formatTokens,
    formatPoints: formatPoints,
    tokenCountFromMinor: tokenCountFromMinor,
    tokenRatio: tokenRatio,
    isTokenMethod: isTokenMethod,
    paymentTotals: paymentTotals,

    /**
     * 组合支付分腿输入口径：现金 / 线上腿是金额，储值币 / 积分腿是**数量**；
     * 提交给服务端的 `payments[].amount` 恒为最小货币单位整数（收款 wire contract 不变）。
     */
    tokensToMinor: tokensToMinor,
    legInputToMinor: legInputToMinor,
    legMinorToInput: legMinorToInput,
    legInputExceedsAvailable: legInputExceedsAvailable,
    legInputPrecision: legInputPrecision,
    legInputStep: legInputStep,

    /** 包厢价展示口径：最小单位 + 计费单位（「¥128.00/小时」），未定价回退门店价时标注「门店统一价」。 */
    formatKtvRoomPrice: formatKtvRoomPrice,
    formatKtvRoomPriceLabel: formatKtvRoomPriceLabel,

    /** 预约确认页分项 + 合计文案（服务单价为 0 时返回空串，不出现「+ ¥0.00」）。 */
    formatKtvRoomPriceBreakdown: formatKtvRoomPriceBreakdown,

    /** 预估费用（分）= 合计单价 × 时长：与展示的合计同源。 */
    estimateKtvRoomFee: estimateKtvRoomFee,

    /** 对客结算单价（分）：优先 combinedUnitPrice，缺失时退回 roomUnitPrice。 */
    ktvCombinedUnitPrice: ktvCombinedUnitPrice,

    /** 批量取包厢生效价（按房型归并 + roomTypeId/resourceId/roomTypeCode 三键缓存），房型列表、预约页与预约列表共用。 */
    resolveKtvRoomPricing: resolveKtvRoomPricing,

    /** 已解析生效价的读入口：按 { roomTypeId } / { id } / { roomTypeCode } 取（未命中返回 null，不回退门店价）。 */
    ktvPricingFor: ktvPricingFor,

    /** 计价方案/房型单价变更后清空取价缓存，下一次渲染重新取价。 */
    resetKtvRoomPricingCache: function () {
      ktvPricingByResourceId = {};
      ktvPricingByRoomTypeId = {};
      ktvPricingByRoomTypeCode = {};
      ktvPricingStore = null;
      ktvPricingStoreRequest = null;
      ktvPricingGroupRequests = {};
    },

    /** OAuth 完成后由服务端 Cookie 会话激活。 */
    activate: function () {
      live = true;
      window.SAAS.mode = 'live';
      window.SAAS.live = live;
      window.SAAS.config = { apiBase: apiBase, memberId: memberId };
    },

    /** 任选包厢：GET /api/v1/business/resources?resourceType=KTV_ROOM（历史预约关联图片/描述仍用它） */
    async listKtvRooms() {
      try {
        if (!live) return fallbackOrThrow(function () { return MOCK_KTV_ROOMS.slice(); });
        var data = await request('GET', '/api/v1/business/resources?resourceType=KTV_ROOM');
        return toList(unwrap(data)).map(function (r) {
          return {
            id: r.id,
            resourceType: r.resourceType || 'KTV_ROOM',
            resourceCode: r.resourceCode || '',
            name: r.name || r.resourceCode || '',
            capacity: r.capacity || 0,
            areaName: r.areaName || '',
            status: r.status || 'ENABLED',
            available: r.available,
            state: r.state || '',
            unavailableReason: r.unavailableReason || '',
            // 图片是网关同源相对路径（/api/v1/media-public/...），原样透传，前端不拼域名
            imageUrls: Array.isArray(r.imageUrls) ? r.imageUrls : [],
            mainImageUrl: r.mainImageUrl || null,
            description: r.description || '',
            // 房型：C 端据此按包厢取「该房型的生效价」，丢掉它会让所有包厢退回门店统一价。
            roomTypeId: r.roomTypeId == null ? null : r.roomTypeId,
            roomTypeCode: r.roomTypeCode || '',
            roomTypeName: r.roomTypeName || '',
            // 房型字典单价：后端目前不在资源视图里返回（缺失即按 resourceId 逐个取价）。
            roomTypeUnitPrice: r.roomTypeUnitPrice == null ? null : Number(r.roomTypeUnitPrice),
            // 房型字典服务单价（同一口径）：资源视图补上后即可与房型单价一起算「合计」，缺失时不影响取价。
            roomTypeServerUnitPrice: r.roomTypeServerUnitPrice == null ? null : Number(r.roomTypeServerUnitPrice)
          };
        });
      } catch (e) {
        return fallbackOrThrow(function () { return MOCK_KTV_ROOMS.slice(); }, e);
      }
    },

    /**
     * 包厢类型（房型）列表：GET /api/v1/admin/resources/types（id / code / name / capacity / status）。
     * 预约预约的是房型、不是具体包厢号；读不到房型字典时按 /business/resources 归并降级。
     */
    listKtvRoomTypes: listKtvRoomTypes,

    /** 房型是否可预约（房型 id 存在且未被标记为不可用），页面与提交校验同一口径。 */
    isKtvRoomTypeBookable: isKtvRoomTypeBookable,

    /** 房型不可预约时的中文原因（房型停用 / 暂无可分配包厢），页面不得展示裸枚举。 */
    ktvRoomTypeUnavailableReason: ktvRoomTypeUnavailableReason,

    /**
     * 房型展示图：该房型样板包厢的主图，取不到时用传入的占位图（门店 KTV 图），
     * 保证卡片永远有 src、不出现破图；这是房型展示图，不代表锁定某个包厢号。
     */
    ktvRoomTypeImageUrl: ktvRoomTypeImageUrl,
    /** 房型图片全集（主图在前）：预约确认页画廊用；无图返回空数组。 */
    ktvRoomTypeImageUrls: ktvRoomTypeImageUrls,

    /**
     * 营业时间（只读）：GET /api/v1/business/reservations/business-hours?storeId=…
     * → { storeId, openTime, closeTime, source, crossesMidnight, allDay, displayText }。
     *
     * 这是「准入规则」而不是「业务数据」：读不到时**返回默认营业时间**而不是抛错，
     * 否则门店级配置抖动会让整个预约页打不开；归一化与判定都走 business-hours.js（页面不得自行实现）。
     */
    async getBusinessHours(storeId) {
      try {
        if (!live) return fallbackOrThrow(function () { return defaultBusinessHours(); });
        var path = '/api/v1/business/reservations/business-hours';
        if (storeId) path += '?storeId=' + encodeURIComponent(storeId);
        return unwrap(await request('GET', path));
      } catch (e) {
        console.warn('[saas] getBusinessHours failed:', e && e.message);
        // 默认营业时间不是 mock 演示数据，线上也要兜底：预约页保持可用，最终准入仍由服务端 422 把关
        return defaultBusinessHours();
      }
    },

    /** 创建预约：预约按房型（roomTypeId）创建，**不得传具体包厢 resourceId**（服务端 400 拒绝）。 */
    async createReservation(payload) {
      try {
        if (!live) return fallbackOrThrow(function () { return { id: Date.now(), reservationNo: 'A380' + String(Date.now()).slice(-10), status: 'PENDING' }; });
        return unwrap(await request('POST', '/api/v1/business/reservations', payload));
      } catch (e) {
        return fallbackOrThrow(function () { return { id: Date.now(), reservationNo: 'A380' + String(Date.now()).slice(-10), status: 'PENDING' }; }, e);
      }
    },

    /**
     * 钱包余额（储值）：GET /api/v1/me/wallet。
     * 返回**数量口径**的 `tokenAmount`（代币个数）与 `tokenBrandName`（品牌名）；
     * `availableAmount` / `frozenAmount` / `currencyCode` 原样保留（对账用，页面不再当钱渲染）。
     */
    async getWallet() {
      try {
        if (!live) return await withWalletTokens(fallbackOrThrow(MOCK_WALLET));
        var d = unwrap(await request('GET', '/api/v1/me/wallet'));
        return await withWalletTokens({
          availableAmount: asString(d.availableAmount !== undefined ? d.availableAmount : d.available_amount, '0'),
          frozenAmount: asString(d.frozenAmount !== undefined ? d.frozenAmount : d.frozen_amount, '0'),
          // 钱包是**按币种隔离**的账户（cst_wallet_account 唯一键含 currency_code）：currencyCode 只描述
          // `availableAmount` 这笔钱（对账用），页面展示的是代币数量、不带币种
          currencyCode: d.currencyCode || d.currency || null,
          // 服务端新增字段（未发布时不传，由 withWalletTokens 按租户比例换算）
          tokenAmount: d.tokenAmount === undefined ? d.token_amount : d.tokenAmount,
          tokenBrandName: d.tokenBrandName || d.token_brand_name || null
        });
      } catch (e) {
        return await withWalletTokens(fallbackOrThrow(MOCK_WALLET, e));
      }
    },

    /**
     * 积分：GET /api/v1/me/points。
     * 积分就是**个数**（1:1，不换算、不带货币符号），与币种解耦。
     */
    async getPoints() {
      try {
        if (!live) return fallbackOrThrow(MOCK_POINTS);
        var d = unwrap(await request('GET', '/api/v1/me/points'));
        var acct = d && d.account ? d.account : d;
        return { balance: asString(acct.availablePoints !== undefined ? acct.availablePoints : acct.available_points, '0') };
      } catch (e) {
        return fallbackOrThrow(MOCK_POINTS, e);
      }
    },

    /**
     * 钱包账本（A380币明细）：GET /api/v1/me/wallet/ledger。
     * 每行按数量口径补齐 `tokenAmount`；行内 amount / currencyCode 保留用于对账。
     */
    async getWalletLedger() {
      try {
        if (!live) return fallbackOrThrow([]);
        return await withLedgerTokens(toList(unwrap(await request('GET', '/api/v1/me/wallet/ledger'))));
      } catch (e) {
        return fallbackOrThrow([], e);
      }
    },

    /** 积分账本（积分明细）：GET /api/v1/me/points */
    async getPointsLedger() {
      try {
        if (!live) return fallbackOrThrow([]);
        var d = unwrap(await request('GET', '/api/v1/me/points'));
        var ledger = d && d.ledger ? d.ledger : d;
        return toList(ledger);
      } catch (e) {
        return fallbackOrThrow([], e);
      }
    },

    /** 消费账单：GET /api/v1/business/orders/{id}/bill */
    async getBill(orderId) {
      try {
        if (!live) return fallbackOrThrow(null);
        return unwrap(await request('GET', '/api/v1/business/orders/' + orderId + '/bill'));
      } catch (e) {
        return fallbackOrThrow(null, e);
      }
    },

    /** 商品/服务目录（C 端点服务/点商品）。 */
    async listCatalog(params) {
      try {
        if (!live) return fallbackOrThrow([]);
        var qs = [];
        if (params) {
          if (params.category) qs.push('category=' + encodeURIComponent(params.category));
          if (params.storeId) qs.push('storeId=' + encodeURIComponent(params.storeId));
        }
        var path = '/api/v1/business/catalog/items' + (qs.length ? '?' + qs.join('&') : '');
        return toList(unwrap(await request('GET', path)));
      } catch (e) {
        return fallbackOrThrow([], e);
      }
    },

    /** 提交加服务项：C 端自助加项，需服务人员确认后生效（source=CUSTOMER → PENDING_APPROVAL）。 */
    async addOrderItem(orderId, item) {
      try {
        if (!live) return fallbackOrThrow(function () { return { id: Date.now(), status: 'PENDING_APPROVAL', source: 'CUSTOMER' }; });
        var body = {
          itemType: item.itemType || 'ADD_ON',
          name: item.name,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          source: 'CUSTOMER',
        };
        // 从目录点单：传 catalogItemId，由服务端按目录价目快照回填名称/单价。
        if (item.catalogItemId != null) {
          body.catalogItemId = item.catalogItemId;
          delete body.name;
          delete body.unitPrice;
        }
        return unwrap(await request('POST', '/api/v1/business/orders/' + orderId + '/items', body));
      } catch (e) {
        console.warn('[saas] addOrderItem failed:', e && e.message);
        throw e;
      }
    },

    /** 订单加项列表（查看加项状态：ACTIVE 已生效 / PENDING_APPROVAL 待确认 / REJECTED 已拒绝）。 */
    async listOrderItems(orderId) {
      try {
        if (!live) return fallbackOrThrow([]);
        return toList(unwrap(await request('GET', '/api/v1/business/orders/' + orderId + '/items')));
      } catch (e) {
        return fallbackOrThrow([], e);
      }
    },

    /** 我的预约：GET /api/v1/me/reservations */
    async listReservations() {
      try {
        if (!live) return fallbackOrThrow([]);
        return toList(unwrap(await request('GET', '/api/v1/me/reservations')));
      } catch (e) {
        return fallbackOrThrow([], e);
      }
    },

    /** 取消预约：POST /api/v1/business/reservations/{id}/cancel */
    async cancelReservation(id) {
      try {
        if (!live) throw new Error('未连接后端');
        return unwrap(await request('POST', '/api/v1/business/reservations/' + id + '/cancel', {}));
      } catch (e) {
        console.warn('[saas] cancelReservation failed:', e && e.message);
        throw e;
      }
    },

    /** 我的消费/订单：GET /api/v1/me/orders */
    async listOrders() {
      try {
        if (!live) return fallbackOrThrow([]);
        return toList(unwrap(await request('GET', '/api/v1/me/orders')));
      } catch (e) {
        return fallbackOrThrow([], e);
      }
    },

    /** 支付方式可用性（C 端 view=user：平台授权 且 租户已向用户开放） */
    async getPaymentMethods() {
      try {
        if (!live) return fallbackOrThrow([]);
        return toList(unwrap(await request('GET', '/api/v1/business/payment-methods?view=user')));
      } catch (e) {
        return fallbackOrThrow([], e);
      }
    },

    /**
     * KTV 计价方案（包厢价格，最小货币单位 + 计费单位/递增粒度/展示文案）。
     * 与后台「计价方案」同源，预约页用它展示包厢价格，不硬编码价格。
     * 不带参数=门店级方案；带 resourceId=该包厢实际房型的**生效单价**（房型价命中即房型价，否则门店价）。
     * 批量场景请用 resolveKtvRoomPricing（按房型归并，避免 N+1）。
     */
    async getKtvPricing(params) {
      try {
        if (!live) return fallbackOrThrow({ roomUnitPrice: 0 });
        return await requestKtvPricing(params);
      } catch (e) {
        return fallbackOrThrow({ roomUnitPrice: 0 }, e);
      }
    },

    /**
     * 租户储值展示名与比例（wallet_brand_name / wallet_ratio，默认 A380币 / 100）。
     * 服务端按签名上下文取租户，客户端不传 tenantId，也不硬编码品牌名；全站只读一次并缓存。
     */
    async getWalletTokenConfig() {
      if (!live) return fallbackOrThrow(defaultWalletTokenConfig());
      return ensureWalletTokenConfig();
    },

    /**
     * 组合支付：POST /business/orders/{orderId}/collect（关联当前会员，支持多支付方式拆分）。
     * 收款币种 = 全局当前租户币种：后端会校验「收款币种 = 订单币种」与渠道能力
     * （USD 租户下微信/支付宝不可用），错误码由 api-errors.js 翻成中文提示。
     */
    async collectPayment(orderId, payable, payments, currencyCode) {
      if (!live) throw new Error('未连接后端');
      return unwrap(await request('POST', '/api/v1/business/orders/' + orderId + '/collect', {
        currencyCode: currencyCode || getCurrency(),
        payable: payable,
        payments: payments
      }));
    }
  };
})();
