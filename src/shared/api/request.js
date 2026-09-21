import axios from 'axios'
import { clearLegacyCredentials, readConfig } from '../bridge'
import { applyResponseCurrency } from '../utils/money'
import { resolveApiErrorMessage } from '../utils/api-errors'

const cfg = readConfig()
const SAFE_METHODS = new Set(['get', 'head', 'options'])
let csrfToken = null

const request = axios.create({
  baseURL: cfg.apiBase || '/',
  timeout: 15000,
  withCredentials: true,
})

async function loadCsrfToken() {
  if (csrfToken) return csrfToken
  const response = await axios.get('/api/v1/auth/csrf?appId=saas-a380-h5', {
    baseURL: cfg.apiBase,
    withCredentials: true,
    timeout: 15000,
  })
  csrfToken = response.data?.csrfToken
  if (!csrfToken) throw new Error('服务端未返回 CSRF token')
  return csrfToken
}

request.interceptors.request.use(async (config) => {
  const c = readConfig()
  config.headers = config.headers || {}
  config.headers['Accept'] = 'application/json'
  config.headers['Accept-Language'] = 'zh'
  // 声明所处应用族：网关据此选用 B 端（运营后台）会话，避免与同浏览器内的 C 端会话串号，
  // 否则运营动作会拿消费端会话鉴权而全部 403（真机实测）。
  config.headers['X-Saas-App'] = 'saas-a380-h5'
  if (c.contract) config.headers['X-Client-Contract'] = c.contract
  if (!SAFE_METHODS.has((config.method || 'get').toLowerCase())) {
    config.headers['X-CSRF-Token'] = await loadCsrfToken()
  }
  return config
})

request.interceptors.response.use(
  (res) => {
    // 网关 X-Currency 兜底：响应体不带 currencyCode 的旧接口也能让全站符号保持同一来源
    applyResponseCurrency(res.data, res)
    return res.data
  },
  (err) => {
    // 统一中文提示：币种/渠道类错误码（收款币种 ≠ 订单币种、USD 租户不支持微信/支付宝）
    // 在这里就翻成中文，页面 reasonOf(friendlyMessage) 直接展示，不泄露错误码与英文原文。
    const msg = resolveApiErrorMessage(err)
    return Promise.reject(Object.assign(err, { friendlyMessage: msg }))
  }
)

clearLegacyCredentials()

export default request
