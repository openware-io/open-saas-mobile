/**
 * 储值（钱包）展示相关常量。
 *
 * 规则：储值是品牌展示名，真实值一律取租户配置 `tnt_tenant_config.wallet_brand_name`，
 * 不得在页面里硬编码；本常量只是「配置读不到时」的唯一回退值（后端默认 A380币）。
 */
export const DEFAULT_WALLET_BRAND = 'A380币'
