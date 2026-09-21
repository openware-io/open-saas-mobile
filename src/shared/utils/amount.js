// B 端（A380后台）金额工具：展示与换算的**唯一实现**在同目录 ./money.js。
// 本文件只保留既有函数名的转发，禁止在这里再建第二份币种字典，也禁止再做 /100、*100
// （换算只允许在 money.js 内部与后端；硬编码符号由 currency-contract.test.js 守卫清零）。
// 储值币（代币）/ 积分是**数量**口径（不是货币），展示一律走 formatTokens / formatPoints。
export {
  CURRENCY_DEFINITIONS,
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY,
  normalize,
  isSupported,
  getCurrency,
  setCurrency,
  resolveCurrency,
  currencyLabel,
  symbolOf,
  digitsOf,
  minorToYuan,
  yuanToFen,
  minorToText,
  formatMajor,
  formatMoney,
  formatYuan,
  applyResponseCurrency,
  // 代币（储值币）/ 积分：数量口径的唯一展示与换算入口（与币种无关，绝不带货币符号）
  DEFAULT_TOKEN_BRAND,
  DEFAULT_TOKEN_RATIO,
  TOKEN_METHODS,
  POINT_UNIT,
  tokenBrand,
  tokenRatio,
  tokenCountFromMinor,
  formatCount,
  formatTokens,
  formatPoints,
  isTokenMethod,
  paymentTotals,
  // 组合支付分腿输入口径：数量腿（储值币 / 积分）<-> 最小货币单位金额的唯一换算入口
  countOf,
  tokensToMajor,
  tokensToMinor,
  legInputPrecision,
  legInputStep,
  legInputToMinor,
  legMinorToInput,
  legInputExceedsAvailable,
} from './money'

import { minorToText } from './money'

/** 分 -> 元（保留两位小数的字符串，不含货币符号；无效值 '—'）。 */
export function fenToYuan(v) {
  return minorToText(v)
}

export function fmtTime(v) {
  if (!v) return '—'
  return String(v).replace('T', ' ').slice(0, 16)
}
