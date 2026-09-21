/**
 * C 端金额展示唯一入口（window.A380Money）。
 *
 * 币种是**租户级唯一来源**：`POST /api/v1/auth/context/select` 响应体的 `currencyCode`（缺省 USD）；
 * 网关 `X-Currency` 头只作旧接口兜底（见 oauth.js / saas.js）。切币种**不做汇率换算**：
 * 金额数字不变，只改符号与语义（16_CURRENCY_CONVENTIONS §1/§4）。
 *
 * 规则：
 *  - 币种字典**只允许出现在本文件**（与 B 端 `src/shared/utils/money.js` 同一份，两侧由
 *    `currency-contract.test.js` 守卫必须逐字一致）；其它模块不得再写 '¥' / '元' / 'CNY' / 'RMB'
 *    字面量，也不得散落 /100、*100（换算只允许在本文件内部与后端）。
 *  - 金额一律最小货币单位（CNY 分 / USD cent）；展示统一「符号紧跟金额」（无空格，与后台 / App 三端一致），不再拼「元」；
 *    货币名称取 label（人民币 / 美元），不向用户展示裸 'CNY' 码。
 *  - 未知币种回退**当前**币种并 console.warn，不抛错（不得整页报错）；
 *    已结算单据自带 currencyCode 时以记录为准（快照优先，§5）。
 *  - **储值币（A380币）与积分不是货币**：它们是组合支付里的一种支付工具，界面只显示**数量**，
 *    不带货币符号与币种；`formatTokens` / `formatPoints` 是唯一展示入口，禁止对它们调用 formatMoney。
 */
(function (root) {
  'use strict';

  /** 唯一币种字典：新增币种只改这里（两侧同改后跑 currency-contract.test.js）。 */
  var CURRENCY_DEFINITIONS = {
    CNY: { symbol: '¥', digits: 2, label: '人民币' },
    USD: { symbol: '$', digits: 2, label: '美元' }
  };
  var SUPPORTED_CURRENCIES = ['CNY', 'USD'];
  /** 租户未配置时的默认币种：规范 §1 定为 USD。 */
  var DEFAULT_CURRENCY = 'USD';
  var STORAGE_KEY = 'a380-c-currency';
  var CHANGE_EVENT = 'currency-changed';

  function storage() {
    try {
      return root.sessionStorage || null;
    } catch (e) {
      return null; // WebView 隐私模式等场景下 storage 不可用
    }
  }

  function readStored() {
    try {
      var store = storage();
      return store ? store.getItem(STORAGE_KEY) : null;
    } catch (e) {
      return null;
    }
  }

  function writeStored(code) {
    try {
      var store = storage();
      if (store) store.setItem(STORAGE_KEY, code);
    } catch (e) {
      /* storage 不可用时只保留内存态 */
    }
  }

  function warn(message) {
    if (root.console && typeof root.console.warn === 'function') root.console.warn('[currency] ' + message);
  }

  /** 归一化币种码：仅返回受支持的 'CNY' / 'USD'，其余返回 null。 */
  function normalize(code) {
    if (code === null || code === undefined || code === '') return null;
    var key = String(code).trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(CURRENCY_DEFINITIONS, key) ? key : null;
  }

  function isSupported(code) {
    return normalize(code) !== null;
  }

  var currentCurrency = normalize(readStored()) || DEFAULT_CURRENCY;

  /** 当前租户币种（全局唯一来源；缺省 USD）。 */
  function getCurrency() {
    return currentCurrency;
  }

  /**
   * 落地当前币种（来自 context select 响应体 currencyCode，或 X-Currency 兜底）。
   * 未知值回退当前币种并 warn；仅当取值真的变化时通知页面重渲染。
   */
  function setCurrency(code) {
    var next = normalize(code);
    if (next === null) {
      warn('未知币种 ' + code + '，回退当前币种 ' + currentCurrency);
      return currentCurrency;
    }
    if (next === currentCurrency) return currentCurrency;
    currentCurrency = next;
    writeStored(next);
    if (typeof root.dispatchEvent === 'function' && typeof root.Event === 'function') {
      root.dispatchEvent(new root.Event(CHANGE_EVENT));
    }
    return currentCurrency;
  }

  /** 展示用币种码：显式取值优先（单据快照），未知值回退当前币种并 warn。 */
  function resolveCurrency(code) {
    if (code === null || code === undefined || code === '') return currentCurrency;
    var hit = normalize(code);
    if (hit) return hit;
    warn('未知币种 ' + code + '，回退当前币种 ' + currentCurrency);
    return currentCurrency;
  }

  /** 币种名称（人民币 / 美元）；不向用户展示裸币种码。 */
  function currencyLabel(code) {
    return CURRENCY_DEFINITIONS[resolveCurrency(code)].label;
  }

  function digitsOf(code) {
    return CURRENCY_DEFINITIONS[resolveCurrency(code)].digits;
  }

  function symbolOf(code) {
    return CURRENCY_DEFINITIONS[resolveCurrency(code)].symbol;
  }

  function hasAmount(value) {
    return !(value === null || value === undefined || value === '');
  }

  /** 最小货币单位 -> 主单位（数值）。 */
  function minorToYuan(minor, code) {
    var n = Number(minor);
    if (!Number.isFinite(n)) return 0;
    return n / Math.pow(10, digitsOf(code));
  }

  /** 主单位 -> 最小货币单位（数值，四舍五入）。 */
  function yuanToFen(major, code) {
    var n = Number(major);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * Math.pow(10, digitsOf(code)));
  }

  /** 千分位分组（大额金额展示）。 */
  function group(text) {
    return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** 主单位数值 -> 展示金额（符号**紧跟**数字、无空格，与后台 / App 三端口径一致；负数符号在最前）。 */
  function formatMajor(value, code) {
    if (!hasAmount(value)) return '—';
    var n = Number(value);
    if (!Number.isFinite(n)) return '—';
    var cur = resolveCurrency(code);
    var fixed = Math.abs(n).toFixed(CURRENCY_DEFINITIONS[cur].digits);
    var parts = fixed.split('.');
    var body = group(parts[0]) + (parts[1] ? '.' + parts[1] : '');
    return (n < 0 ? '-' : '') + CURRENCY_DEFINITIONS[cur].symbol + body;
  }

  /**
   * **唯一格式化入口**：最小货币单位 -> 展示金额。
   * @param {number|string|null} minor 最小货币单位金额（CNY 分 / USD cent）
   * @param {'CNY'|'USD'} [code] 币种；缺省 = 当前 store 币种（默认 USD），单据快照可显式传入
   * @returns {string} 例如 `¥1,234.56` / `$1,234.56` / `-¥5.00` / `—`（符号紧跟数字，金额内无空格）
   */
  function formatMoney(minor, code) {
    if (!hasAmount(minor)) return '—';
    var n = Number(minor);
    if (!Number.isFinite(n)) return '—';
    return formatMajor(minorToYuan(n, code), code);
  }

  /** 主单位入参的同一格式（仅前端演示数据使用；后端金额必须走 formatMoney）。 */
  function formatYuan(value, code) {
    return formatMajor(value, code);
  }

  // —— 储值币（代币）与积分：**数量**口径，与币种完全解耦 ——
  // 储值币与积分是组合支付里的一种支付工具（储值币 / 营销币），界面只显示**数量**，
  // **不得出现货币符号或币种**（只有现金与价格才带货币单位，现金默认 USD）。
  // 数量换算只允许在本文件内部：数量 = 余额（最小货币单位）÷ 100 × 租户比例（wallet_ratio，默认 100，语义「1 主单位 = N 代币」）；
  // 积分就是个数（1:1，不换算）。禁止对代币/积分调用 formatMoney。
  /** 品牌名缺失时的唯一回退（租户未配置 wallet_brand_name）；页面不得再硬编码。 */
  var DEFAULT_TOKEN_BRAND = '储值币';
  /** 租户未配置比例时的默认「1 主单位 = N 代币」（缺失即按 100 处理且不报错）。 */
  var DEFAULT_TOKEN_RATIO = 100;
  var POINT_UNIT = '积分';
  /** 组合支付里属于「代币」的支付方式：数量口径，不参与金额合计。 */
  var TOKEN_METHODS = ['WALLET', 'POINT'];

  /** 品牌名归一化：空/缺失回退「储值币」（只在本文件回退，任何页面都不得自带品牌兜底）。 */
  function tokenBrand(brandName) {
    var name = brandName === null || brandName === undefined ? '' : String(brandName).trim();
    return name || DEFAULT_TOKEN_BRAND;
  }

  /** 租户比例归一化：非法/缺失回退默认 100（不抛错，页面照常展示数量）。 */
  function tokenRatio(ratio) {
    var n = Number(ratio);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TOKEN_RATIO;
  }

  /** 储值余额（最小货币单位）-> 代币数量（取整）：余额 ÷ 100 × 比例（主单位换算复用 minorToYuan）。 */
  function tokenCountFromMinor(minor, ratio) {
    var n = Number(minor);
    if (!Number.isFinite(n)) return 0;
    return Math.round(minorToYuan(n) * tokenRatio(ratio));
  }

  /** 数量文本：千分位、无货币符号、无小数（代币与积分都是整数个数）；无效值返回 '—'。 */
  function formatCount(value) {
    if (value === null || value === undefined || value === '') return '—';
    var n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return (n < 0 ? '-' : '') + group(String(Math.round(Math.abs(n))));
  }

  /**
   * **储值币唯一展示入口**：只出数量，例如 `1,000`。
   *
   * 储值币/积分都是**数量**，值里不拼任何单位：既不出现 ¥ / $ / 元 / 币种码，
   * 也不拼品牌名或「积分」——名字由支付方式、列头、卡片标题与字段标签承担。
   * @param {number|string} tokenCount 代币数量（服务端 tokenAmount 优先，缺失时用 tokenCountFromMinor 换算）
   */
  function formatTokens(tokenCount) {
    return formatCount(tokenCount);
  }

  /** **积分唯一展示入口**：`300`（积分就是个数，1:1 不换算、不带任何单位）。 */
  function formatPoints(count) {
    return formatCount(count);
  }

  /** 是否是「代币」支付方式（储值币 / 积分）：数量口径。 */
  function isTokenMethod(method) {
    return TOKEN_METHODS.indexOf(method === null || method === undefined ? '' : String(method).toUpperCase()) >= 0;
  }

  /** 代币腿的数量：服务端 tokenAmount 优先（已按比例算好），缺失时退回该腿金额。 */
  function tokenLegQuantity(leg, fallback) {
    var direct = Number(leg.tokenAmount);
    return Number.isFinite(direct) ? direct : fallback;
  }

  /**
   * 组合支付分腿汇总：**金额合计只由现金类分腿构成**，代币/积分数量单独返回、绝不计入 moneyMinor。
   * 代币腿的数量取 `tokenAmount`（服务端算好的数量）优先，缺失时退回该腿 amount。
   * 支付方式缺失（老接口）按现金类处理，避免把金额漏算进合计。
   */
  function paymentTotals(legs) {
    var moneyMinor = 0;
    var tokenCount = 0;
    var pointCount = 0;
    (Array.isArray(legs) ? legs : []).forEach(function (leg) {
      if (!leg) return;
      var amount = Number(leg.amount);
      if (!Number.isFinite(amount)) amount = 0;
      var method = leg.method === null || leg.method === undefined ? '' : String(leg.method).toUpperCase();
      if (method === 'POINT') { pointCount += tokenLegQuantity(leg, amount); return; }
      if (method === 'WALLET') { tokenCount += tokenLegQuantity(leg, amount); return; }
      moneyMinor += amount;
    });
    return { moneyMinor: moneyMinor, tokenCount: tokenCount, pointCount: pointCount };
  }

  // —— 组合支付分腿的输入口径（代币 / 积分不是货币）——
  // 与后台 gv_saas_admin `src/constants/payment-methods.js` 同一口径：
  //  - 现金 / 线上分腿是**金额**（主单位输入，提交最小货币单位）；
  //  - 储值币分腿是**数量**（按租户比例折回金额），积分分腿是**数量**（就是个 1:1 的个数）；
  //  - 提交给服务端的 `payments[].amount` 恒为最小货币单位整数（POINT 腿服务端按同一个数核销积分），
  //    因此「合计 = 应收」的校验按**折算后的金额**做，代币 / 积分数量绝不进入任何货币合计。
  /** 个数取整（空值/非法值按 0，避免把 NaN 填进输入框）。 */
  function countOf(value) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }

  /** 代币数量 -> 主单位金额（tokenCountFromMinor 的逆运算），用于把数量折回金额。 */
  function tokensToMajor(tokens, ratio) {
    var n = Number(tokens);
    if (!Number.isFinite(n)) return 0;
    return n / tokenRatio(ratio);
  }

  /** 代币数量 -> 最小货币单位整数（四舍五入）；提交服务端的 amount 仍是最小货币单位整数。 */
  function tokensToMinor(tokens, ratio) {
    return yuanToFen(tokensToMajor(tokens, ratio));
  }

  /** 数量腿（储值币 / 积分）输入精度：个数无小数；金额腿保留两位小数。 */
  function legInputPrecision(method) {
    return isTokenMethod(method) ? 0 : 2;
  }

  /** 数量腿按「个」递增，金额腿按最小展示步长递增。 */
  function legInputStep(method) {
    return isTokenMethod(method) ? 1 : 0.01;
  }

  /**
   * 组合支付分腿输入 -> 最小货币单位整数（页内合计与提交的**唯一换算入口**）。
   *  - WALLET：数量按租户比例折回金额（tokensToMinor）；
   *  - POINT：积分就是个 1:1 的个数，服务端按同一个数核销积分（不乘比例）；
   *  - 现金 / 线上：输入即主单位金额。
   */
  function legInputToMinor(method, value, ratio) {
    var m = method === null || method === undefined ? '' : String(method).toUpperCase();
    if (m === 'WALLET') return tokensToMinor(value, ratio);
    if (m === 'POINT') return countOf(value);
    return yuanToFen(value);
  }

  /** legInputToMinor 的逆运算：可用金额 / 可用数量 -> 分腿输入值（自动抵扣回填用）。 */
  function legMinorToInput(method, minor, ratio) {
    var m = method === null || method === undefined ? '' : String(method).toUpperCase();
    if (m === 'WALLET') return tokenCountFromMinor(minor, ratio);
    if (m === 'POINT') return countOf(minor);
    return minorToYuan(minor);
  }

  /**
   * 分腿输入是否超过**可用**（数量腿按比例折成金额后比较）：true 表示应收银端拒绝。
   * `availableMinor` 是该支付方式的可用额度——WALLET 传储值余额（最小货币单位）、
   * POINT 传可用积分个数（服务端按同一个数核销积分）；缺失/非法按 0，不允许超用。
   */
  function legInputExceedsAvailable(method, value, availableMinor, ratio) {
    var available = Number(availableMinor);
    if (!Number.isFinite(available) || available < 0) available = 0;
    return legInputToMinor(method, value, ratio) > available;
  }

  /**
   * 从 context select 响应解析并落地币种：响应体 currencyCode > `X-Currency` 头 > 保持当前。
   * 响应体与头都缺省时**不覆盖**当前币种（老接口无币种字段不得把已选币种打回默认）。
   */
  function applyResponseCurrency(payload, response) {
    var body = payload && typeof payload === 'object' ? payload : null;
    var nested = body && body.data && typeof body.data === 'object' ? body.data : null;
    var code = (body && body.currencyCode) || (nested && nested.currencyCode) || headerValue(response, 'X-Currency');
    if (code) setCurrency(code);
    return currentCurrency;
  }

  /** 读响应头：兼容 fetch `Headers` 与普通对象（大小写不敏感）。 */
  function headerValue(response, name) {
    var headers = response && response.headers;
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);
    var key = null;
    Object.keys(headers).forEach(function (item) {
      if (key === null && item.toLowerCase() === name.toLowerCase()) key = item;
    });
    return key ? headers[key] : null;
  }

  root.A380Money = {
    CURRENCY_DEFINITIONS: CURRENCY_DEFINITIONS,
    SUPPORTED_CURRENCIES: SUPPORTED_CURRENCIES,
    DEFAULT_CURRENCY: DEFAULT_CURRENCY,
    CHANGE_EVENT: CHANGE_EVENT,
    normalize: normalize,
    isSupported: isSupported,
    setCurrency: setCurrency,
    getCurrency: getCurrency,
    currencyLabel: currencyLabel,
    symbolOf: symbolOf,
    digitsOf: digitsOf,
    minorToYuan: minorToYuan,
    yuanToFen: yuanToFen,
    formatMoney: formatMoney,
    formatYuan: formatYuan,
    // 代币（储值币）/ 积分：数量口径的唯一展示与换算入口（与币种无关，绝不带货币符号）
    DEFAULT_TOKEN_BRAND: DEFAULT_TOKEN_BRAND,
    DEFAULT_TOKEN_RATIO: DEFAULT_TOKEN_RATIO,
    TOKEN_METHODS: TOKEN_METHODS,
    POINT_UNIT: POINT_UNIT,
    tokenBrand: tokenBrand,
    tokenRatio: tokenRatio,
    tokenCountFromMinor: tokenCountFromMinor,
    formatCount: formatCount,
    formatTokens: formatTokens,
    formatPoints: formatPoints,
    isTokenMethod: isTokenMethod,
    paymentTotals: paymentTotals,
    // 组合支付分腿输入口径：数量腿（储值币 / 积分）<-> 最小货币单位金额的唯一换算入口
    countOf: countOf,
    tokensToMajor: tokensToMajor,
    tokensToMinor: tokensToMinor,
    legInputPrecision: legInputPrecision,
    legInputStep: legInputStep,
    legInputToMinor: legInputToMinor,
    legMinorToInput: legMinorToInput,
    legInputExceedsAvailable: legInputExceedsAvailable,
    applyResponseCurrency: applyResponseCurrency
  };
})(typeof window !== 'undefined' ? window : globalThis);
