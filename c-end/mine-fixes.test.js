import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

const read = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8')

/**
 * 取「某个函数声明」到「下一段块注释 / 下一个顶层声明」之间的正文。
 * 与 order-items.test.js / refresh-policy.test.js 的取法一致（纯源码守卫，不启动浏览器）。
 */
function bodyOf(source, marker) {
  const at = source.indexOf(marker)
  expect(at, marker + ' 未找到').toBeGreaterThan(-1)
  const rest = source.slice(at)
  const cuts = [rest.indexOf('\n/**'), rest.indexOf('\nfunction '), rest.indexOf('\nasync function '), rest.indexOf('\nvar ')]
    .filter((index) => index > 0)
  return cuts.length ? rest.slice(0, Math.min(...cuts)) : rest
}

// —— P0-1 信息架构：菜单 2 项（我的预约/我的订单），明细只由资产卡进入，页面内无重复 data-route ——

test('「我的」菜单只保留 2 个业务入口：可点目标 4 个且零重复，明细只由资产卡进入', async () => {
  const app = await read('app.js')
  const my = bodyOf(app, 'function renderMy()')
  // 资产卡 2 个明细入口（整卡可点）
  expect(my).toContain('data-route="ledger/coin"')
  expect(my).toContain('data-route="ledger/points"')
  // 菜单 2 项：共享订单/预约不再按业态拆菜单（酒店并入我的预约/我的订单）
  const menuCalls = [...my.matchAll(/myMenuItem\('([^']+)'/g)].map((hit) => hit[1])
  expect(menuCalls).toEqual(['my-reservations', 'my-orders'])
  expect(new Set(menuCalls).size).toBe(2)
  expect(app).not.toContain("myMenuItem('my-hotel-orders'")
  const menuStart = my.indexOf('<section class="me-menu">')
  expect(menuStart).toBeGreaterThan(-1)
  const menu = my.slice(menuStart, my.indexOf('</section>', menuStart))
  expect(menu).not.toContain('ledger/')   // 明细不再在菜单里重复出现
  const menuItemBody = bodyOf(app, 'function myMenuItem(route, label, iconKey)')
  expect(menuItemBody).toContain("data-route=\"' + route + '\"")
  // 整页可点目标 = 资产 2 + 菜单 2，且互不重复
  expect(new Set(['ledger/coin', 'ledger/points', ...menuCalls]).size).toBe(4)
})

// —— P0-8 身份区：不再伪造「SaaS 会员 / A」，接线会员号并中性回退 ——

test('身份区不再伪造 SaaS 会员 / A：接线 resolveMember 展示会员号，失败保持中性文案', async () => {
  const app = await read('app.js')
  expect(app).not.toContain("'SaaS 会员'")
  expect(app).not.toContain('会员 \' + memberId')
  const my = bodyOf(app, 'function renderMy()')
  expect(my).toContain('my-identity-sub')
  expect(my).toContain('myAvatarHtml()')
  expect(my).toContain('<h2>我的</h2>')
  // 会员号来自已有的 GET /api/v1/business/members/me（SAAS.getMember ← resolveMember）
  expect(app).toContain('SAAS.getMember()')
  expect(app).toContain('paintMyIdentity')
  expect(bodyOf(app, 'function paintMyIdentity()')).toContain("'会员号 '")
})

// —— P0-6 资产：失败不再静默「—」，保留上次成功值 + 内联重试 ——

test('资产失败可重试：refreshMyBalances 有 catch，失败保留上次成功值并展示内联重试', async () => {
  const app = await read('app.js')
  const refresh = bodyOf(app, 'function refreshMyBalances()')
  expect(refresh).toContain('.catch(')
  expect(refresh).toContain('paintMyBalances(result)')
  const paint = bodyOf(app, 'function paintMyBalances(result)')
  expect(paint).toContain('myBalances.coin')
  expect(paint).toContain('myBalances.points')
  expect(paint).toContain('#my-balance-notice')
  const my = bodyOf(app, 'function renderMy()')
  expect(my).toContain('data-retry="my"')
  expect(my).toContain('notice-retry')
  expect(my).toContain('id="my-balance-notice"')
})

// —— P0-3 我的订单：展示全部业态、createdAt 守卫、业态中文化、footer 去重复状态 ——

test('我的订单：展示全部业态（不再过滤 HOTEL）、下单行带 createdAt 守卫、业态中文、footer 不重复裸状态', async () => {
  const app = await read('app.js')
  const load = bodyOf(app, 'async function loadMyOrders()')
  // 共享订单不按业态过滤：HOTEL 行由卡片标签中文化，不再从列表里剔除
  expect(load).not.toContain("!== 'HOTEL'")
  expect(load).not.toContain('businessType')
  expect(app).toContain("HOTEL: '酒店'")

  const card = bodyOf(app, 'function orderCard(o)')
  expect(card).toContain("(o.createdAt ? '<p>下单：'")
  expect(card).toContain('orderBusinessLabel(o.businessType)')
  expect(card).not.toContain('orderBadge(displayStatus).replace')
  expect(card).not.toContain('replace(/<[^>]+>/g')
})

test('「我的消费」重命名为「我的订单」：标题、错误态与空态一致', async () => {
  const app = await read('app.js')
  expect(app).not.toContain('我的消费')
  expect(bodyOf(app, 'function paintMyOrders(items)')).toContain("pageHead('我的订单'")
  expect(bodyOf(app, 'async function renderMyOrders()')).toContain("errorTitle: '订单加载失败'")
  expect(bodyOf(app, 'async function renderMyOrders()')).toContain("pageHead('我的订单'")
})

// —— 酒店预订并入「我的预约」统一列表：状态闭集、取消条件、卡片可复用、接口有超时 ——

test('酒店预订状态闭集/取消条件对齐服务端，酒店卡由「我的预约」统一列表复用（无独立页面）', async () => {
  const hotel = await read('hotel-real.js')
  expect(hotel).not.toContain('PENDING_PAYMENT')
  expect(hotel).toContain('SaasPageLoad.withTimeout')
  expect(hotel).toContain('SaasDateTime.formatStoreDate')
  expect(hotel).toContain('function hotelOrderCard(order)')
  // 独立「我的酒店订单」页已删除：不再有 renderRealHotelOrders / 只读列表封装
  expect(hotel).not.toContain('function renderRealHotelOrders')
  expect(hotel).not.toContain('function paintHotelOrderList')
  expect(hotel).not.toContain('SaasHotelBookings')

  const app = await read('app.js')
  const paintReservations = bodyOf(app, 'function paintMyReservations(items)')
  expect(paintReservations).toContain('hotelOrderCard(row.hotel)')
  expect(paintReservations).toContain('reservationCard')
})

// —— P0-7 demo 订单页清理 + P1 状态/明细/返回/空态 ——

test('demo「orders」页与死代码已删除：#/orders→我的订单、#/my-hotel-orders→我的预约', async () => {
  const app = await read('app.js')
  expect(app).not.toContain('function renderOrders()')
  expect(app).not.toContain('function renderSuccess(')
  expect(app).not.toContain('function addOrder(')
  expect(app).toContain("if (route === 'orders')")
  // 重定向（go）而不是用规范 route 直接渲染：否则 isCurrent 守卫会把结果丢掉、页面停在骨架
  expect(app).toContain("go('my-orders')")
  // 「我的酒店订单」并入「我的预约」：旧深链保留可用（重定向，不再独立渲染）
  expect(app).toContain("if (route === 'my-hotel-orders') { go('my-reservations'); return; }")
  expect(app).not.toContain('return renderRealHotelOrders()')
  // 深链规范化：ledger 类型段 / order-bill、order-items 的 id 段 / real-hotel 的 id 段
  expect(app).toContain("if (parts[0] === 'ledger'")
  expect(app).toContain("parts[0] === 'order-bill' || parts[0] === 'order-items'")
  expect(app).toContain("parts[0] === 'real-hotel'")
})

test('酒店接口超时只套读请求（写请求不因客户端超时误报失败）', async () => {
  const hotel = await read('hotel-real.js')
  expect(hotel).toContain("method === 'GET'")
  expect(hotel).toContain('写请求（提交预订 / 取消）')
})

test('订单状态补 DUE_OUT；积分明细补 EARN；明细页走 SaasPageLoad 并可加载更多', async () => {
  const app = await read('app.js')
  expect(bodyOf(app, 'function orderBadge(status)')).toContain('DUE_OUT')
  expect(bodyOf(app, 'function ledgerTypeText(t)')).toContain("EARN: '获得积分'")

  const ledger = bodyOf(app, 'async function renderLedger(type)')
  expect(ledger).toContain('SaasPageLoad.renderPage')
  expect(ledger).toContain('retryRoute: route')
  expect(app).toContain('LEDGER_PAGE_SIZE')
  expect(app).toContain('data-ledger-more')
  expect(app).toContain('getWalletLedgerPage')
  expect(app).toContain('getPointsLedgerPage')
})

test('「我的」子页返回固定回「我的」；未知路由与会员未初始化用空态', async () => {
  const app = await read('app.js')
  expect(app).toContain('function isMySectionRoute(route)')
  expect(app).toContain("if (isMySectionRoute(currentRoute())) { go('my'); return; }")
  expect(app).toContain('renderNotFound();')
  expect(bodyOf(app, 'function renderNotFound()')).toContain('data-route="home"')
  expect(bodyOf(app, 'async function loadMyReservations()')).toContain('isMemberNotInitialized(error)')
  expect(bodyOf(app, 'async function loadMyOrders()')).toContain('isMemberNotInitialized(error)')
})

test('开发态文案与演示描述清理：生产页不出现「已连接 SaaS 后端」与「前端演示」提示', async () => {
  const app = await read('app.js')
  const html = await read('index.html')
  expect(app).not.toContain('已连接 SaaS 后端')
  expect(app).not.toContain('页面内数据、价格和订单均为前端演示')
  expect(html).not.toContain('演示')
  // 日期统一出口
  const datetime = await read('datetime.js')
  expect(datetime).toContain('formatStoreDate')
})

test('支撑改造：品牌兜底唯一出口、会员号可读、明细分页接口已导出', async () => {
  // 品牌兜底：C 端页面只允许用 SAAS.DEFAULT_WALLET_BRAND（租户配置失败时的唯一回退）；
  // money.js 的 DEFAULT_TOKEN_BRAND 是 C/B 两端共享契约值（token-display-contract.test.js 要求逐字一致），
  // C 端页面不得读取它，否则同一个配置失败会出现第二个品牌名。
  const app = await read('app.js')
  expect(app).not.toContain('SAAS.tokenBrand(')
  const saas = await read('saas.js')
  expect(saas).toContain("DEFAULT_WALLET_BRAND = 'SaaS 币'")
  expect(saas).toContain('getMember: resolveMember')
  expect(saas).toContain('memberNo:')
  expect(saas).toContain('getWalletLedgerPage')
  expect(saas).toContain('getPointsLedgerPage')
})
