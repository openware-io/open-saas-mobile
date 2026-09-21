/**
 * B 端错误提示解析（与 C 端 `c-end/api-errors.js` 同一份口径）。
 *
 * 后端统一错误体 `{ code, message }`；币种相关错误（收款币种 ≠ 订单币种、USD 租户不支持
 * 微信/支付宝等渠道）必须翻译成中文可执行提示，绝不把错误码或英文原文弹给运营人员。
 * 解析顺序：业务错误码 → 中文服务端 message → HTTP 状态码兜底 → 页面兜底。
 */

const CODE_MESSAGES = Object.freeze({
  CURRENCY_REQUIRED: '当前租户未配置币种，请联系平台运营在后台设置租户币种后重试。',
  CURRENCY_UNSUPPORTED: '当前租户币种不受支持，请先在后台把租户币种改为人民币或美元。',
  CURRENCY_MISMATCH: '收款币种与订单币种不一致（订单为历史币种），请刷新订单后按订单币种收款。',
  CURRENCY_CORRIDOR_DISABLED: '该单据币种与当前租户币种不一致，已禁止跨币种收款。',
  // 预约按房型（包厢类型）创建：具体包厢到店后由门店分配，创建/调整预约都不得传具体包厢号。
  ROOM_TYPE_REQUIRED: '请先选择包厢类型后再提交预约。',
  ROOM_TYPE_INVALID: '所选包厢类型不可用，请重新选择包厢类型。',
  ROOM_TYPE_DISABLED: '所选包厢类型已停用，请改选其它包厢类型。',
  RESOURCE_ID_NOT_ALLOWED: '预约按包厢类型创建，不能指定具体包厢号；具体包厢到店后由门店分配。',
  ROOM_TYPE_NO_ROOM_AVAILABLE: '该包厢类型暂无可分配包厢，请改选其它包厢类型或时段。',
  ROOM_TYPE_FULL: '该包厢类型已满，请改选其它包厢类型或时段。',
})

/** 渠道能力类错误码（USD 租户不支持微信/支付宝）：必须**先于**通用 CURRENCY 判断，否则会被币种码吃掉。 */
const METHOD_PATTERNS = [
  [/(PAY(?:MENT)?[_-]?(?:METHOD|CHANNEL)|METHOD|CHANNEL)[_-](?:CURRENCY[_-]?)?(?:UNSUPPORTED|UNAVAILABLE|DISABLED|INVALID|NOT_AVAILABLE)/,
    '当前币种不支持该支付方式（微信 / 支付宝仅支持人民币收款），请改用现金或储值支付。'],
]

/** 其余币种类错误码的兜底文案。 */
const CURRENCY_FALLBACK = '该操作的币种与当前租户币种不一致，请刷新后重试。'

const STATUS_MESSAGES = Object.freeze({
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
})

const GENERIC_SERVER_MESSAGES = new Set([
  'Internal Server Error', 'Bad Request', 'Unauthorized', 'Forbidden', 'Not Found',
  'Method Not Allowed', 'Bad Gateway', 'Service Unavailable', 'Gateway Timeout',
  'No message available', 'Validation failed',
])

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

function payloadOf(error) {
  return error?.response?.data && typeof error.response.data === 'object' ? error.response.data : null
}

function serverMessageOf(error) {
  const payload = payloadOf(error)
  if (typeof payload?.message === 'string') return payload.message.trim()
  return typeof error?.serverMessage === 'string' ? error.serverMessage.trim() : ''
}

export function codeOf(error) {
  const payload = payloadOf(error)
  const raw = (typeof payload?.code === 'string' && payload.code) || (typeof error?.code === 'string' && error.code) || ''
  const code = String(raw).trim()
  return /^[A-Z][A-Z0-9_]{2,}$/.test(code) ? code : ''
}

function matchesKnownCode(code, known) {
  return code === known || code.startsWith(known + '_') || code.includes('_' + known)
}

/**
 * 解析可展示的中文错误提示：永不返回空串，也永不返回错误码 / 英文原文。
 * @param {unknown} error 捕获到的异常（axios error 或带 code/status 的普通 Error）
 * @param {string} [fallback] 页面语义兜底（如「收款失败」）
 */
export function resolveApiErrorMessage(error, fallback = '操作未完成，请稍后重试。') {
  const code = codeOf(error)
  if (code) {
    for (const [pattern, message] of METHOD_PATTERNS) {
      if (pattern.test(code)) return message
    }
    for (const [known, message] of Object.entries(CODE_MESSAGES)) {
      if (matchesKnownCode(code, known)) return message
    }
    if (/CURRENCY/.test(code)) return CURRENCY_FALLBACK
  }

  const serverMessage = serverMessageOf(error)
  if (serverMessage && CJK_PATTERN.test(serverMessage) && !GENERIC_SERVER_MESSAGES.has(serverMessage)) {
    return serverMessage
  }

  const status = Number(error?.response?.status ?? error?.status)
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status]
  return fallback || '操作未完成，请稍后重试。'
}

export { CODE_MESSAGES }
