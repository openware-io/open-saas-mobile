const B_OPERATOR_ROLES = ['tenant.owner', 'store.manager', 'store.cashier', 'store.finance']

async function ensureOperatorAuth() {
  return {
    contextId: 'preview:a380:store-001',
    tenantName: 'A380 租户',
    organizationName: '华东运营中心',
    storeName: 'UI 预览门店',
    roles: B_OPERATOR_ROLES,
  }
}

async function startOAuth() {
  return null
}

export { ensureOperatorAuth, startOAuth, B_OPERATOR_ROLES }
