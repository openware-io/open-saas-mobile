/**
 * 页面加载守卫（window.A380PageLoad）——C 端「加载型页面」的唯一出口。
 *
 * 背景（线上缺陷）：`renderOrderItems` 先渲染「加载中…」，再 `await` 两个接口，最后整页替换。
 * 只要其中任意一次 await 抛错（例如 C 端会话缺 `order.view` 时接口回 403、网关 503、
 * 网络断开），或者接口**永不返回**，页面就永远停在「加载中…」——用户看到的就是「一直加载中」。
 *
 * 这里把「先加载中、再 await、失败必须出错误态」收敛成一份实现：
 *   1) 加载态只有 {@link loadingHtml} 一个出口，页面不再手写「加载中…」；
 *   2) 任何 reject（403 / 503 / 网络错误）与**超时**都会渲染可重试的错误态，绝不停在加载中；
 *   3) 错误文案统一走 api-errors.js（中文、不外泄错误码），重试按钮带 `data-retry="<route>"`，
 *      由 app.js 的事件委托接管（同一路由也能重新渲染，不依赖 hashchange）；
 *   4) 已经渲染过的页面再取一次数据走 {@link refreshPage}（静默刷新：不闪加载态、失败保留屏上数据），
 *      并可用 `isCurrent` 做路由守卫：请求回来晚就整批丢弃，绝不画到别的页面上。
 */
(function (root) {
  'use strict';

  /** 页面级超时默认值（毫秒）：网络层另有请求超时，两层都可用同一个注入开关覆盖。 */
  var DEFAULT_TIMEOUT_MS = 15000;

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/[&<>'"]/g, function (char) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char];
      });
  }

  /**
   * 超时毫秒数：`window.SAAS_REQUEST_TIMEOUT_MS` 可注入（测试与联调同一开关），
   * 缺失/非法/非正数一律回退默认值——超时兜底不能被一个坏配置关掉。
   */
  function timeoutMs(override) {
    var raw = override === undefined || override === null ? root.SAAS_REQUEST_TIMEOUT_MS : override;
    var value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
  }

  /** 超时错误：状态码取 504，交给 api-errors.js 翻成中文「服务响应超时」。 */
  function timeoutError(ms) {
    var error = new Error('请求超时（' + ms + 'ms 未响应）');
    error.code = 'REQUEST_TIMEOUT';
    error.status = 504;
    return error;
  }

  /**
   * 给任意 promise 加超时。
   * 运行环境没有 setTimeout（如极简 vm/嵌入式环境）时退化为原 promise：
   * 宁可少一层兜底，也不能因为缺能力就把整页钉在错误态。
   */
  function withTimeout(promise, override) {
    var limit = timeoutMs(override);
    if (typeof setTimeout !== 'function') return Promise.resolve(promise);
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(timeoutError(limit)); }, limit);
      var clear = function () { if (typeof clearTimeout === 'function') clearTimeout(timer); };
      Promise.resolve(promise).then(function (value) { clear(); resolve(value); },
        function (error) { clear(); reject(error); });
    });
  }

  /** 加载态 HTML（唯一出口）。 */
  function loadingHtml(text) {
    return '<section class="item-list"><p class="mock-notice">' + escapeHtml(text || '加载中…') + '</p></section>';
  }

  /** 后端错误 -> 中文可执行提示；api-errors.js 未加载时也不返回空串。 */
  function errorText(error, fallback) {
    if (root.A380ApiErrors && typeof root.A380ApiErrors.describe === 'function') {
      return root.A380ApiErrors.describe(error, fallback);
    }
    return fallback || '操作未完成，请稍后重试。';
  }

  /**
   * 失败态 HTML：中文原因 + 「重试」按钮（结构与 emptyState 一致，直接复用 .empty 样式）。
   * retryRoute 为空时只出文案不出按钮（例如没有可重试的入口）。
   */
  function errorHtml(title, error, retryRoute, retryText) {
    var retry = retryRoute
      ? '<button class="primary-button" data-retry="' + escapeHtml(retryRoute) + '">'
        + escapeHtml(retryText || '重试') + '</button>'
      : '';
    return '<section class="empty"><span>⚠️</span><h2>' + escapeHtml(title || '加载失败')
      + '</h2><p>' + escapeHtml(errorText(error, '请检查网络后重试')) + '</p>' + retry + '</section>';
  }

  /**
   * 路由守卫的取用口径：调用方没给 `isCurrent` 时恒为「当前」（保持原有行为不变）。
   * 给了就必须在**落屏前**校验一次：请求回来晚（用户已经点走）时不能把旧页画到新页上。
   */
  function currentCheck(options) {
    return typeof options.isCurrent === 'function' ? options.isCurrent : function () { return true; };
  }

  /**
   * 页面渲染守卫：mount(加载态) → await load() → render(value)；
   * 任何 reject / 超时都 mount(错误态) 并返回 `{ ok: false, error }`，调用方不再需要写 try/catch，
   * 也不可能出现「渲染了加载态却没人替换它」的路径。
   *
   * `isCurrent` 是可选的路由守卫：请求发出后用户换了页，成功结果与错误态都直接丢弃
   * （返回 `{ ok: false, stale: true }`），绝不画到当前页上。
   *
   * @param {object} options
   * @param {function(string):void} options.mount     把一段 HTML 挂到页面上（加载态与错误态共用）
   * @param {function():Promise} options.load          页面数据加载
   * @param {function(*):void} options.render          成功渲染
   * @param {string} [options.retryRoute]              重试按钮路由（`data-retry`）
   * @param {string} [options.errorTitle]              错误态标题
   * @param {string} [options.loadingHtml]             自定义加载态（缺省 loadingHtml()）
   * @param {number} [options.timeoutMs]               页面级超时覆盖
   * @param {string} [options.name]                    日志用页面名
   * @param {function():boolean} [options.isCurrent]   路由守卫：仍是同一页才允许落屏
   * @returns {Promise<{ok:boolean, value?:*, error?:*, stale?:boolean}>}
   */
  async function renderPage(options) {
    var mount = options.mount;
    var isCurrent = currentCheck(options);
    mount(options.loadingHtml || loadingHtml(options.loadingText));
    try {
      var value = await withTimeout(options.load(), options.timeoutMs);
      if (!isCurrent()) return { ok: false, stale: true, value: value };
      options.render(value);
      return { ok: true, value: value };
    } catch (error) {
      // 失败必须可在控制台定位：页面已经出了错误态，日志补上原始错误与页面名。
      if (root.console && typeof root.console.error === 'function') {
        root.console.error('[a380] page load failed:', options.name || '', error);
      }
      // 用户已经换页：错误态同样不能落到别的页面上（否则「点了走开」会看到上一页的报错）。
      if (!isCurrent()) return { ok: false, stale: true, error: error };
      mount(options.errorHtml
        ? options.errorHtml(error)
        : errorHtml(options.errorTitle, error, options.retryRoute));
      return { ok: false, error: error };
    }
  }

  /**
   * 静默刷新守卫（多端数据一致性的刷新策略唯一出口）：
   * 屏上已经有数据时**不挂加载态**（不闪白、不整页替换），await load() 成功后只画一次结果；
   * 失败**保留屏上数据**（默认只记日志，需要提示时用 onError），绝不把页面替换成错误页；
   * `isCurrent()` 为假（用户已经换页）时连请求都不发 / 结果整批丢弃 —— 幂等且不串页。
   *
   * 与 {@link renderPage} 的分工：首次进入页面（屏上还没有这一页的数据）走 renderPage，
   * 已经渲染过的当前页再取一次数据走 refreshPage。两者共用同一份 load/render，不存在第二条数据路径。
   *
   * @param {object} options
   * @param {function():Promise} options.load          数据加载（与首屏同一份）
   * @param {function(*):void} options.render          成功绘制（与首屏同一份）
   * @param {function():boolean} [options.isCurrent]   路由守卫
   * @param {number} [options.timeoutMs]               页面级超时覆盖
   * @param {function(*):void} [options.onError]       失败提示（默认只在控制台留痕，不动屏上数据）
   * @param {string} [options.name]                    日志用页面名
   * @returns {Promise<{ok:boolean, value?:*, error?:*, stale?:boolean, skipped?:boolean}>}
   */
  async function refreshPage(options) {
    var isCurrent = currentCheck(options);
    if (!isCurrent()) return { ok: false, skipped: true };
    try {
      var value = await withTimeout(options.load(), options.timeoutMs);
      if (!isCurrent()) return { ok: false, stale: true, value: value };
      options.render(value);
      return { ok: true, value: value };
    } catch (error) {
      if (root.console && typeof root.console.error === 'function') {
        root.console.error('[a380] page refresh failed:', options.name || '', error);
      }
      if (isCurrent() && typeof options.onError === 'function') options.onError(error);
      return { ok: false, error: error };
    }
  }

  root.A380PageLoad = {
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
    timeoutMs: timeoutMs,
    timeoutError: timeoutError,
    withTimeout: withTimeout,
    loadingHtml: loadingHtml,
    errorText: errorText,
    errorHtml: errorHtml,
    renderPage: renderPage,
    refreshPage: refreshPage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
