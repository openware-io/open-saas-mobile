/**
 * C 端（A380 更多服务）OAuth 客户端：标准接入流程（PKCE + 授权码 + 服务端会话 + 上下文选择）。
 * 链路：未授权 -> IM /oauth/authorize -> 回调 ?code -> POST /identity/oauth/im/callback（服务端换 token+绑定）
 *        -> GET /auth/contexts -> POST /auth/context/select -> 激活同源 Cookie 会话。
 * 不改 gv_chat_app：入口由 IM 后台「服务板块」登记服务项(link 指向 /a380/)，跳转+授权走 IM 开放平台。
 * C 端为消费者身份，不做运营角色校验（B 端 /b/ 才校验 B_OPERATOR_ROLES）。
 */
(function () {
  'use strict';

  var APP_ID = 'saas-a380-c';
  var REDIRECT_URI = window.location.origin + window.location.pathname;

  var PKCE_KEY = 'saas_c_pkce_verifier';
  var STATE_KEY = 'saas_c_oauth_state';
  var NONCE_KEY = 'saas_c_oauth_nonce';
  var csrfToken = null;

  (function clearLegacyQueryParameters() {
    var qs = new URLSearchParams(window.location.search);
    var changed = false;
    ['apiBase', 'token', 'tenant', 'storeId', 'memberId', 'im_token', 'appId'].forEach(function (key) {
      if (qs.has(key)) { qs.delete(key); changed = true; }
    });
    if (changed) history.replaceState(null, '', window.location.pathname + (qs.toString() ? '?' + qs.toString() : '') + window.location.hash);
  })();

  function b64url(buf) {
    var s = '';
    var bytes = new Uint8Array(buf);
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randomString(len) {
    ensurePkceSupport();
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    var s = '';
    var a = new Uint8Array(len);
    crypto.getRandomValues(a);
    for (var i = 0; i < len; i++) s += chars[a[i] % chars.length];
    return s;
  }
  function sha256(str) {
    ensurePkceSupport();
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  }
  function oauthError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }
  function ensurePkceSupport() {
    if (typeof crypto !== 'undefined' && crypto &&
        typeof crypto.getRandomValues === 'function' && crypto.subtle &&
        typeof crypto.subtle.digest === 'function') return;
    throw oauthError('PKCE_UNAVAILABLE', '当前页面不支持安全的 PKCE 授权');
  }

  async function req(url, options, onResponse) {
    var r = await fetch(url, options);
    if (!r.ok) {
      var payload = null;
      try { payload = await r.json(); } catch (e) {}
      var error = new Error(payload && payload.message ? payload.message : 'HTTP ' + r.status);
      error.status = r.status;
      error.code = payload && payload.code;
      throw error;
    }
    var data = await r.json();
    // 响应头兜底（网关 X-Currency）：与响应体 currencyCode 同一来源，缺字段的接口也能对齐全站符号
    if (typeof onResponse === 'function') onResponse(data, r);
    return data;
  }
  async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    var response = await fetch('/api/v1/auth/csrf?appId=' + APP_ID + '&refresh=' + Date.now(), {
      credentials: 'same-origin', cache: 'no-store',
    });
    if (!response.ok) throw new Error('无法获取 CSRF token');
    var payload = await response.json();
    csrfToken = payload && payload.csrfToken;
    if (!csrfToken) throw new Error('服务端未返回 CSRF token');
    return csrfToken;
  }
  function clearCsrfToken() { csrfToken = null; }
  function isCsrfError(error) {
    return error && (error.code === 'CSRF_TOKEN_INVALID'
      || (error.status === 403 && /csrf/i.test(error.message || '')));
  }
  async function post(url, body, onResponse) {
    var retried = false;
    while (true) {
      var csrf = await getCsrfToken();
      try {
        return await req(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify(body),
        }, onResponse);
      } catch (error) {
        if (retried || !isCsrfError(error)) throw error;
        retried = true;
        clearCsrfToken();
      }
    }
  }
  function get(url) {
    return req(url, { credentials: 'same-origin' });
  }
  async function getSession() {
    try { return await get('/api/v1/auth/session?appId=' + APP_ID); } catch (e) { return null; }
  }

  // 调试放权端口：5175/5176 为本地 Vite 开发服务；Kind 统一 Ingress 使用
  // 30080（旧版独立 H5 代理曾使用 30082）。
  var LOCAL_DEV_PORTS = ['5175', '5176', '30080', '30082'];

  function isPrivateHostname(host) {
    return host === 'localhost' || host === '127.0.0.1'
      || /^192\.168\./.test(host) || /^10\./.test(host)
      || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);
  }

  function isLocalDev() {
    return isPrivateHostname(window.location.hostname)
      && LOCAL_DEV_PORTS.indexOf(window.location.port) >= 0;
  }

  function isUiPreview() {
    return isLocalDev() && new URLSearchParams(window.location.search).get('preview') === '1';
  }

  async function ensureLocalDevSession() {
    if (!isLocalDev()) return false;
    try {
      await req('/api/v1/dev/saas/session?appId=' + APP_ID, {
        method: 'POST', credentials: 'same-origin',
      });
      return true;
    } catch (e) {
      // 服务端未开启调试放权（生产/未配置）时必须静默回退正常 OAuth，不能因此中断进入流程。
      console.warn('[a380-oauth] dev session unavailable, fallback to oauth:', e && e.message);
      return false;
    }
  }

  function takeCode() {
    var qs = new URLSearchParams(window.location.search);
    var code = qs.get('code');
    if (!code) return null;
    var state = qs.get('state');
    var expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    qs.delete('code'); qs.delete('state');
    var next = window.location.pathname + (qs.toString() ? '?' + qs.toString() : '');
    history.replaceState(null, '', next);
    // 防登录 CSRF：回调 state 必须与发起授权时保存的 state 一致
    if (!expected || state !== expected) throw new Error('OAuth state mismatch');
    return code;
  }

  async function startOAuth() {
    var verifier = randomString(64);
    sessionStorage.setItem(PKCE_KEY, verifier);
    var state = randomString(32);
    var nonce = randomString(32);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(NONCE_KEY, nonce);
    var challenge = b64url(await sha256(verifier));
    var qs = new URLSearchParams({
      appId: APP_ID, response_type: 'code', redirect_uri: REDIRECT_URI, scope: 'profile.basic',
      code_challenge: challenge, code_challenge_method: 'S256', state: state, nonce: nonce,
    });
    window.location.href = '/oauth/authorize?' + qs.toString();
  }

  async function exchangeAndBind(code) {
    var verifier = sessionStorage.getItem(PKCE_KEY);
    sessionStorage.removeItem(PKCE_KEY);
    if (!verifier) throw new Error('missing pkce verifier');
    // 授权码交换在服务端完成（H5 无 appSecret）：SaaS 后端换 token -> 绑定
    var bind = await req('/api/v1/identity/oauth/im/callback', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      code: code, code_verifier: verifier, redirect_uri: REDIRECT_URI, app_id: APP_ID,
      }),
    });
    if (!bind.authenticated) throw new Error('bind failed');
    clearCsrfToken();
    return bind;
  }

  /**
   * 租户币种的唯一来源：context select 响应体的 currencyCode；
   * 响应体不带该字段时用网关 X-Currency 头兜底（money.js 内部落地并触发页面重渲染）。
   */
  function applyCurrency(payload, response) {
    if (window.A380Money && typeof window.A380Money.applyResponseCurrency === 'function') {
      window.A380Money.applyResponseCurrency(payload, response);
    }
  }

  // 选择上下文后由服务端写入会话；前端不构造或发送租户权限快照。
  async function selectContext() {
    var lastError = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var suffix = attempt === 0 ? '' : '&refresh=' + Date.now();
        var ctx = await get('/api/v1/auth/contexts?appId=' + APP_ID + suffix);
        var list = Array.isArray(ctx) ? ctx : (ctx && ctx.items) || [];
        var first = window.A380Context && window.A380Context.chooseSingle(list);
        if (!first) {
          var noContext = new Error(list.length > 1 ? 'CONTEXT_SELECTION_REQUIRED' : 'NO_CONSUMER_ACCESS');
          noContext.code = list.length > 1 ? 'CONTEXT_SELECTION_REQUIRED' : 'NO_CONSUMER_ACCESS';
          throw noContext;
        }
        await post('/api/v1/auth/context/select?appId=' + APP_ID, { contextId: first.contextId }, applyCurrency);
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 0) continue;
      }
    }
    throw lastError || new Error('NO_CONSUMER_ACCESS');
  }

  function activateLive() {
    if (window.SAAS && window.SAAS.activate) window.SAAS.activate();
    window.dispatchEvent(new Event('saas-activated'));
  }

  // 等 App 注入桥（onPageFinished 注入晚于 defer 脚本，这里轮询兜底）
  function waitForBridge(timeoutMs) {
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      (function check() {
        if (window.GVBridge && window.GVBridge.login) { resolve(); return; }
        if (Date.now() - started > (timeoutMs || 6000)) { reject(new Error('GVBridge 未注入')); return; }
        setTimeout(check, 100);
      })();
    });
  }

  // 通过 App 原生桥（GVBridge.login）拿授权码换 SaaS 登录态（对齐微信小程序模型）
  async function authorizeViaBridge() {
    await waitForBridge(6000);
    var auth = await window.GVBridge.login({ appId: APP_ID, scope: 'profile.basic', redirectUri: REDIRECT_URI,
      state: randomString(32), nonce: randomString(32) });
    if (!auth || !auth.code) throw new Error('授权码为空');
    var bind = await req('/api/v1/identity/oauth/im/callback', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      code: auth.code, code_verifier: auth.code_verifier, state: auth.state, nonce: auth.nonce,
      redirect_uri: auth.redirect_uri || REDIRECT_URI, app_id: APP_ID,
      }),
    });
    if (!bind.authenticated) throw new Error('bind failed');
    clearCsrfToken();
    return bind;
  }

  function hasNativeBridge() {
    return !!(window.GVBridge && typeof window.GVBridge.login === 'function');
  }

  function nativeBridgeAuthorizationError(error) {
    if (error && error.code === 'im_session_expired') {
      return oauthError('IM_SESSION_EXPIRED', 'IM login session has expired');
    }
    return oauthError('IM_BRIDGE_AUTH_FAILED', 'IM bridge authorization failed');
  }

  async function ensureAuth() {
    if (isUiPreview()) {
      window.SAAS_DEMO_MODE = true;
      return;
    }
    var session = await getSession();
    if (!session || session.appId !== APP_ID) clearCsrfToken();
    if (session && session.authenticated && session.appId === APP_ID) {
      await selectContext();
      activateLive();
      return;
    }

    if (await ensureLocalDevSession()) {
      session = await getSession();
      if (session && session.authenticated && session.appId === APP_ID) {
        await selectContext();
        activateLive();
        return;
      }
    }

    // 首选：App 原生桥出授权码
    try { await authorizeViaBridge(); }
    catch (e) {
      // App 容器已提供桥时，裸跳 /oauth/authorize 不会携带 IM JWT，
      // 只能得到网关的 401 JSON。保留错误给页面展示并让用户重新登录 IM。
      if (hasNativeBridge()) throw nativeBridgeAuthorizationError(e);
      console.warn('[a380-oauth] bridge unavailable, fallback redirect:', e && e.message);
    }

    session = await getSession();
    if (session && session.authenticated && session.appId === APP_ID) {
      await selectContext();
      activateLive();
      return;
    }

    // 回退：非 IM App 环境（如浏览器）走 URL 重定向授权
    var code = takeCode();
    if (code) {
      try {
        await exchangeAndBind(code);
        session = await getSession();
        if (!session || !session.authenticated) throw new Error('session not established');
        await selectContext();
        activateLive();
      } catch (e) {
        if (e && (e.code === 'NO_CONSUMER_ACCESS' || e.code === 'CONTEXT_SELECTION_REQUIRED'
            || e.code === 'IAM_CONTEXT_UNAVAILABLE')) throw e;
        await startOAuth();
      }
      return;
    }
    await startOAuth();
  }

  async function refreshContext() {
    var session = await getSession();
    if (!session || !session.authenticated) throw new Error('session not established');
    await selectContext();
    activateLive();
  }

  var ready = ensureAuth();

  window.A380OAuth = {
    APP_ID: APP_ID, REDIRECT_URI: REDIRECT_URI,
    ready: ready, startOAuth: startOAuth, ensureAuth: ensureAuth, refreshContext: refreshContext,
  };
})();
