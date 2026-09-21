/**
 * C 端错误提示解析（window.A380ApiErrors）。
 *
 * 后端统一错误体 `{ code, message }`；币种相关错误（收款币种 ≠ 订单币种、USD 租户不支持
 * 微信/支付宝等渠道）必须在**进入渠道下单之前**就翻译成中文可执行提示，绝不把错误码或英文原文
 * 弹给用户。解析顺序与后台一致：业务错误码 → 中文服务端 message → HTTP 状态码兜底 → 页面兜底。
 */
(function (root) {
  'use strict';

  var CODE_MESSAGES = {
    // 请求/页面超时（saas.js 的 REQUEST_TIMEOUT）：接口挂住时给「稍后重试」的可执行提示。
    REQUEST_TIMEOUT: '请求超时，请检查网络后重试。',
    // 权限类：服务端 message 形如「缺少权限: order.view」，会把内部权限码漏给顾客，一律换成中文提示。
    PERMISSION_DENIED: '没有操作权限，请联系门店服务人员协助。',
    ORDER_SCOPE_DENIED: '只能查看和服务本人订单，如需帮助请联系门店服务人员。',
    CURRENCY_REQUIRED: '当前租户未配置币种，请联系门店管理员在后台设置租户币种后重试。',
    CURRENCY_UNSUPPORTED: '当前租户币种不受支持，请联系门店管理员在后台改为人民币或美元。',
    CURRENCY_MISMATCH: '收款币种与订单币种不一致（订单为历史币种），请刷新订单后按订单币种收款。',
    CURRENCY_CORRIDOR_DISABLED: '该单据币种与当前租户币种不一致，已禁止跨币种收款。',
    // 预约按房型（包厢类型）创建：具体包厢到店后由门店分配，前端不得传具体包厢号。
    ROOM_TYPE_REQUIRED: '请先选择包厢类型后再提交预约。',
    ROOM_TYPE_INVALID: '所选包厢类型不可用，请返回重新选择包厢类型。',
    ROOM_TYPE_DISABLED: '所选包厢类型已停用，请改选其它包厢类型。',
    RESOURCE_ID_NOT_ALLOWED: '预约按包厢类型创建，不能指定具体包厢号；具体包厢到店后由门店分配。',
    ROOM_TYPE_NO_ROOM_AVAILABLE: '该包厢类型暂无可分配包厢，请改选其它包厢类型或时段。',
    ROOM_TYPE_FULL: '该包厢类型已满，请改选其它包厢类型或时段。',
  };

  /** 渠道能力类错误码（USD 租户不支持微信/支付宝）：必须**先于**通用 CURRENCY 判断，否则会被币种码吃掉。 */
  var METHOD_PATTERNS = [
    [/(PAY(?:MENT)?[_-]?(?:METHOD|CHANNEL)|METHOD|CHANNEL)[_-](?:CURRENCY[_-]?)?(?:UNSUPPORTED|UNAVAILABLE|DISABLED|INVALID|NOT_AVAILABLE)/,
      '当前币种不支持该支付方式（微信 / 支付宝仅支持人民币收款），请改用现金或储值支付。'],
  ];

  /** 其余币种类错误码的兜底文案。 */
  var CURRENCY_FALLBACK = '该操作的币种与当前租户币种不一致，请刷新后重试。';

  var STATUS_MESSAGES = {
    400: '请求参数有误，请检查后重试。',
    401: '登录状态已失效，请重新登录。',
    403: '没有操作权限，请联系门店管理员。',
    404: '接口或数据不存在，请刷新后重试。',
    409: '数据已被其他操作更新，请刷新后重试。',
    422: '该操作与当前单据币种或状态不一致，请刷新后重试。',
    429: '操作过于频繁，请稍后再试。',
    500: '服务端异常，请稍后重试。',
    502: '服务暂时不可用（502），请稍后重试。',
    503: '服务暂时不可用（503），请稍后重试。',
    504: '服务响应超时（504），请稍后重试。',
  };

  /** 框架默认英文短语：命中即视为无业务 message，一律走状态码兜底中文。 */
  var GENERIC_SERVER_MESSAGES = [
    'Internal Server Error', 'Bad Request', 'Unauthorized', 'Forbidden', 'Not Found',
    'Method Not Allowed', 'Bad Gateway', 'Service Unavailable', 'Gateway Timeout',
    'No message available', 'Validation failed',
  ];

  var CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

  function serverMessageOf(error) {
    if (!error) return '';
    if (typeof error.serverMessage === 'string') return error.serverMessage.trim();
    var payload = error.payload;
    if (payload && typeof payload.message === 'string') return payload.message.trim();
    // saas.js 在 HTTP 非 2xx 时把响应体拼进 message：'HTTP 400 {"code":"X","message":"Y"}'
    var text = typeof error.message === 'string' ? error.message : '';
    var hit = text.match(/"message"\s*:\s*"([^"]*)"/);
    return hit ? hit[1].trim() : '';
  }

  function codeOf(error) {
    if (!error) return '';
    if (typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{2,}$/.test(error.code.trim())) return error.code.trim();
    var payload = error.payload;
    if (payload && typeof payload.code === 'string') return payload.code.trim();
    var text = typeof error.message === 'string' ? error.message : '';
    var hit = text.match(/"code"\s*:\s*"([A-Za-z0-9_]+)"/);
    return hit ? hit[1] : '';
  }

  function prefixSuffixMatch(code, known) {
    return code === known || code.indexOf(known + '_') === 0 || code.indexOf('_' + known) >= 0;
  }

  /**
   * 解析可展示的中文错误提示：永不返回空串，也永不返回错误码 / 英文原文。
   * @param {unknown} error 捕获到的异常（带 code / status / payload 或 'HTTP 400 {...}' message）
   * @param {string} [fallback] 页面语义兜底（如「支付失败」）
   */
  function describe(error, fallback) {
    var code = codeOf(error);
    if (code) {
      for (var i = 0; i < METHOD_PATTERNS.length; i++) {
        if (METHOD_PATTERNS[i][0].test(code)) return METHOD_PATTERNS[i][1];
      }
      for (var known in CODE_MESSAGES) {
        if (Object.prototype.hasOwnProperty.call(CODE_MESSAGES, known) && prefixSuffixMatch(code, known)) {
          return CODE_MESSAGES[known];
        }
      }
      if (/CURRENCY/.test(code)) return CURRENCY_FALLBACK;
    }

    var serverMessage = serverMessageOf(error);
    if (serverMessage && CJK_PATTERN.test(serverMessage)
        && GENERIC_SERVER_MESSAGES.indexOf(serverMessage) < 0) {
      return serverMessage;
    }

    var status = Number(error && (error.status || (error.payload && error.payload.status)));
    if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
    return fallback || '操作未完成，请稍后重试。';
  }

  root.A380ApiErrors = {
    describe: describe,
    codeOf: codeOf,
    messages: CODE_MESSAGES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
