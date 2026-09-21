import { applyResponseCurrency } from '../shared/utils/money'

// B 端（A380后台）OAuth 客户端：标准接入流程（PKCE + 授权码 + token + bind + 运营角色校验 + 上下文选择）
// 链路：未授权 -> IM /oauth/authorize -> 回调 ?code -> /identity/oauth/im/callback -> 服务端会话 -> /auth/contexts 校验运营角色 -> /auth/context/select 选上下文
// 不改 gv_chat_app：入口由 IM 后台「小程序·服务管理」登记服务项(link 指向本 H5)，跳转+授权走 IM 开放平台。

const APP_ID = import.meta.env.VITE_IM_APP_ID || 'saas-a380-h5'
const REDIRECT_URI = window.location.origin + window.location.pathname

const B_OPERATOR_ROLES = ['tenant.owner', 'store.manager', 'store.cashier', 'store.finance']

const PKCE_KEY = 'saas_b_pkce_verifier'
const STATE_KEY = 'saas_b_oauth_state'
const NONCE_KEY = 'saas_b_oauth_nonce'
let csrfToken = null

function clearLegacyQueryParameters() {
  const qs = new URLSearchParams(window.location.search)
  let changed = false
  for (const key of ['apiBase', 'token', 'tenant', 'storeId', 'memberId', 'im_token', 'appId']) {
    if (qs.has(key)) { qs.delete(key); changed = true }
  }
  if (changed) history.replaceState(null, '', window.location.pathname + (qs.toString() ? '?' + qs.toString() : '') + window.location.hash)
}
clearLegacyQueryParameters()

function b64url(buf) {
  let s = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function ensurePkceSupport() {
  if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function'
    && crypto.subtle && typeof crypto.subtle.digest === 'function') return
  // 普通 http 内网地址不是安全上下文，crypto.subtle 不可用；这里给出可诊断的错误码，
  // 不能把 "Cannot read properties of undefined (reading 'digest')" 直接抛给页面。
  throw authError('PKCE_UNAVAILABLE', '当前页面不支持安全的 PKCE 授权')
}
function randomString(len) {
  ensurePkceSupport()
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  let s = ''
  const a = new Uint8Array(len)
  crypto.getRandomValues(a)
  for (let i = 0; i < len; i++) s += chars[a[i] % chars.length]
  return s
}
async function sha256(str) {
  ensurePkceSupport()
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
}

async function req(url, options = {}, onResponse) {
  const r = await fetch(url, options)
  if (!r.ok) {
    let payload = null
    try { payload = await r.json() } catch {}
    const error = new Error(payload?.message || ('HTTP ' + r.status))
    error.status = r.status
    error.code = payload?.code
    throw error
  }
  const data = await r.json()
  // 响应头兜底（网关 X-Currency）：与响应体 currencyCode 同一来源，落地到全局币种 store
  if (typeof onResponse === 'function') onResponse(data, r)
  return data
}
async function getCsrfToken() {
  if (csrfToken) return csrfToken
  const response = await fetch('/api/v1/auth/csrf?appId=' + APP_ID + '&refresh=' + Date.now(), {
    credentials: 'same-origin', cache: 'no-store',
  })
  if (!response.ok) throw new Error('无法获取 CSRF token')
  const payload = await response.json()
  csrfToken = payload?.csrfToken
  if (!csrfToken) throw new Error('服务端未返回 CSRF token')
  return csrfToken
}
function clearCsrfToken() { csrfToken = null }
function isCsrfError(error) {
  return error && (error.code === 'CSRF_TOKEN_INVALID'
    || (error.status === 403 && /csrf/i.test(error.message || '')))
}
async function post(url, body, onResponse) {
  let retried = false
  while (true) {
    const csrf = await getCsrfToken()
    try {
      return await req(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(body),
      }, onResponse)
    } catch (error) {
      if (retried || !isCsrfError(error)) throw error
      retried = true
      clearCsrfToken()
    }
  }
}
function get(url) {
  return req(url, { credentials: 'same-origin' })
}

async function getSession() {
  try {
    return await get('/api/v1/auth/session?appId=' + APP_ID)
  } catch {
    return null
  }
}

// 调试放权端口：5175/5176 为本地 Vite 开发服务，30082 为 Kind 部署的 H5（内网调试用）。
const LOCAL_DEV_PORTS = ['5175', '5176', '30082']

function isPrivateHostname(host) {
  return host === 'localhost' || host === '127.0.0.1'
    || /^192\.168\./.test(host) || /^10\./.test(host)
    || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)
}

function isLocalDev() {
  return isPrivateHostname(window.location.hostname) && LOCAL_DEV_PORTS.includes(window.location.port)
}

async function ensureLocalDevSession() {
  if (!isLocalDev()) return false
  try {
    await req('/api/v1/dev/saas/session?appId=' + APP_ID, {
      method: 'POST', credentials: 'same-origin',
    })
    return true
  } catch (e) {
    // 服务端未开启调试放权（生产/未配置）时必须静默回退正常 OAuth，不能因此中断进入流程。
    console.warn('[a380-b-oauth] dev session unavailable, fallback to oauth:', e && e.message)
    return false
  }
}

function takeCode() {
  const qs = new URLSearchParams(window.location.search)
  const code = qs.get('code')
  if (!code) return null
  const state = qs.get('state')
  const expected = sessionStorage.getItem(STATE_KEY)
  sessionStorage.removeItem(STATE_KEY)
  qs.delete('code'); qs.delete('state')
  const next = window.location.pathname + (qs.toString() ? '?' + qs.toString() : '')
  history.replaceState(null, '', next)
  // 防登录 CSRF：回调 state 必须与发起授权时保存的 state 一致
  if (!expected || state !== expected) throw new Error('OAuth state mismatch')
  return code
}

async function startOAuth() {
  const verifier = randomString(64)
  sessionStorage.setItem(PKCE_KEY, verifier)
  const state = randomString(32)
  const nonce = randomString(32)
  sessionStorage.setItem(STATE_KEY, state)
  sessionStorage.setItem(NONCE_KEY, nonce)
  const challenge = b64url(await sha256(verifier))
  const qs = new URLSearchParams({
    appId: APP_ID, response_type: 'code', redirect_uri: REDIRECT_URI, scope: 'profile.basic',
    code_challenge: challenge, code_challenge_method: 'S256', state, nonce,
  })
  window.location.href = '/oauth/authorize?' + qs.toString()
}

async function exchangeAndBind(code) {
  const verifier = sessionStorage.getItem(PKCE_KEY)
  sessionStorage.removeItem(PKCE_KEY)
  if (!verifier) throw new Error('missing pkce verifier')
  // 授权码交换在服务端完成（H5 无 appSecret）：SaaS 后端换 token -> 绑定
  const bind = await req('/api/v1/identity/oauth/im/callback', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    code, code_verifier: verifier, redirect_uri: REDIRECT_URI,
    app_id: APP_ID,
    }),
  })
  if (!bind.authenticated) throw new Error('bind failed')
  clearCsrfToken()
  return bind
}

function isOperator(items) {
  const list = Array.isArray(items) ? items : (items && items.items) || []
  return list.some((c) => (c.roles || []).some((r) => B_OPERATOR_ROLES.includes(r)))
}

function authError(code, message) {
  const error = new Error(message || code)
  error.code = code
  return error
}

// 选定运营上下文后由服务端写入会话。B 端只展示可运营的上下文。
async function selectContext(items, selectedContextId) {
  const list = Array.isArray(items) ? items : (items && items.items) || []
  const operatorContexts = list.filter((item) => (item.roles || []).some((role) => B_OPERATOR_ROLES.includes(role)))
  const selected = selectedContextId
    ? operatorContexts.find((item) => item.contextId === selectedContextId)
    : operatorContexts.length === 1 ? operatorContexts[0] : null
  if (!selected) {
    const error = authError(operatorContexts.length > 1 ? 'CONTEXT_SELECTION_REQUIRED' : 'NO_CONTEXT')
    error.contexts = operatorContexts
    throw error
  }
  await post('/api/v1/auth/context/select?appId=' + APP_ID, { contextId: selected.contextId }, applyCurrency)
  return selected
}

/**
 * 租户币种的唯一来源：context select 响应体的 currencyCode；
 * 响应体不带该字段时用网关 X-Currency 头兜底（money.js 内部落地，模板响应式更新）。
 */
function applyCurrency(payload, response) {
  applyResponseCurrency(payload, response)
}

// 等 App 注入桥（onPageFinished 注入晚于 defer 脚本，这里轮询兜底）
function waitForBridge(timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const check = () => {
      if (window.GVBridge && window.GVBridge.login) { resolve(); return }
      if (Date.now() - started > (timeoutMs || 6000)) { reject(new Error('GVBridge 未注入')); return }
      setTimeout(check, 100)
    }
    check()
  })
}

// 通过 App 原生桥（GVBridge.login）拿授权码换 SaaS 登录态（对齐微信小程序模型）
async function authorizeViaBridge() {
  await waitForBridge(6000)
  const auth = await window.GVBridge.login({ appId: APP_ID, scope: 'profile.basic', redirectUri: REDIRECT_URI,
    state: randomString(32), nonce: randomString(32) })
  if (!auth || !auth.code) throw new Error('授权码为空')
  const bind = await req('/api/v1/identity/oauth/im/callback', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    code: auth.code, code_verifier: auth.code_verifier, state: auth.state, nonce: auth.nonce,
    redirect_uri: auth.redirect_uri || REDIRECT_URI,
    app_id: APP_ID,
    }),
  })
  if (!bind.authenticated) throw new Error('bind failed')
  clearCsrfToken()
  return bind
}

function hasNativeBridge() {
  return !!(window.GVBridge && typeof window.GVBridge.login === 'function')
}

function nativeBridgeAuthorizationError(error) {
  if (error?.code === 'im_session_expired') {
    return authError('IM_SESSION_EXPIRED', 'IM 登录已失效，请返回 IM 重新登录后再进入 A380后台。')
  }
  return authError('IM_BRIDGE_AUTH_FAILED', '无法完成 IM 授权，请返回 IM 后重新进入 A380后台。')
}

async function ensureOperatorAuth(options = {}) {
  let session = await getSession()

  if (options.force || !session || session.appId !== APP_ID) clearCsrfToken()

  // A session is scoped to one SaaS client. Never reuse a C端/legacy session for B端.
  if (options.force || (session?.authenticated && session.appId !== APP_ID)) session = null

  if (!session?.authenticated) {
    if (await ensureLocalDevSession()) {
      session = await getSession()
    }
  }

  if (!session?.authenticated) {
    try {
      await authorizeViaBridge()
      session = await getSession()
    } catch (e) {
      // App 容器已有桥时，浏览器式 OAuth 跳转不带 IM JWT，不能作为失败回退。
      if (hasNativeBridge()) throw nativeBridgeAuthorizationError(e)
      console.warn('[a380-b-oauth] bridge unavailable, fallback redirect:', e && e.message)
    }
  }

  if (!session?.authenticated) {
    const code = takeCode()
    if (code) {
      try {
        await exchangeAndBind(code)
        session = await getSession()
      } catch (e) {
        throw e
      }
    }
  }

  if (!session?.authenticated) { await startOAuth(); return null }

  const ctx = await get('/api/v1/auth/contexts?appId=' + APP_ID + '&refresh=' + Date.now())
  if (!isOperator(ctx)) throw authError('NO_OPERATOR_ROLE')
  const selectedContextId = options.contextId
  return selectContext(ctx, selectedContextId)
}

export { ensureOperatorAuth, startOAuth, B_OPERATOR_ROLES }
