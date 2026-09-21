// App 桥只提供一次性 OAuth 授权码。业务身份与租户上下文由同源服务端会话推导。
export function readConfig() {
  return {
    apiBase: '/',
    contract: 'business-v1',
  }
}

export function tenantInfo() {
  return {}
}

export function isLive() {
  return true
}

export function clearLegacyCredentials() {
  const keys = [
    'saas_b_token', 'saas_b_tenant_context', 'saas_b_account_id', 'saas_b_im_token',
    'saas_c_token', 'saas_c_tenant_context', 'saas_c_account_id', 'saas_c_im_token',
  ]
  try {
    keys.forEach((key) => localStorage.removeItem(key))
  } catch {
    // Storage can be disabled in embedded WebViews.
  }
}
