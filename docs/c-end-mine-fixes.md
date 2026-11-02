# C 端「我的」页本轮修复说明（现有业务修复，不加新功能）

> 状态：`current`（2026-11-02）
> 范围：`open-saas-mobile/c-end`（H5 消费者端）；后端只消费既有接口，不改契约
> 依据：`.outputs/architecture/c-end-mine-menu-audit.md`（现状审计与逐条证据）、`SAAS_STORE_MINE_SOLUTION.md` §4（rev2，C 端部分不受 rev3 门店审批替代）
> 边界：只修现有菜单/子页/资产/身份/加载错误态；**不新增业务菜单、业务页面、后端接口**（仅新增一个 404 错误视图，非业务页面），不改登录/游客态策略

## 1. 本轮目标

修掉「我的」页现存的可感知缺陷，使 5 个入口不再重复、订单/预约不再一单三处、状态不再外泄英文、失败不再永久「加载中」或「—」、身份区不再显示伪造值。修完后信息架构为 **3 个菜单 + 2 个资产入口**，全部复用现有路由与后端接口。

## 2. 修后信息架构（5 项菜单 → 3 项 + 2 资产入口）

| 位置 | 内容 | `data-route` | 说明 |
| --- | --- | --- | --- |
| 资产卡 | 储值币数量（整卡可点） | `ledger/coin` | 明细的**唯一入口** |
| 资产卡 | 积分数量（整卡可点） | `ledger/points` | 明细的**唯一入口** |
| 菜单 1 | 我的预约（仅 KTV 预约） | `my-reservations` | 酒店预订不再混入 |
| 菜单 2 | 我的订单 | `my-orders` | 原「我的消费」页；过滤酒店行（酒店只在菜单 3） |
| 菜单 3 | 我的酒店订单 | `my-hotel-orders` | 酒店预订的唯一管理页（状态/取消） |

净效果：可点目标 5 个、**零重复 `data-route`**；不新增任何业务菜单/业务页面/后端接口，仅新增一个 404 错误视图（`renderNotFound`，用于失效深链的可感知回退，不属于业务页面）。

## 3. 修复项清单

### 3.1 P0（本轮必须）

| 编号 | 问题 | 修复 | 涉及文件 |
| --- | --- | --- | --- |
| P0-1 | 资产卡与菜单第 4/5 项重复指向 `ledger/*` | 删除菜单中的两个明细项；资产卡保留为唯一入口 | `c-end/app.js`（`renderMy`） |
| P0-2 | 「我的预约」混入酒店预订（且酒店恒排在 KTV 前、两套取消过滤口径） | `loadMyReservations` 只取 `/me/reservations`（KTV），删除酒店加载/分支；空态保持 KTV 语义 | `c-end/app.js` |
| P0-3 | 「我的订单」重复展示酒店订单、英文业态（`HOTEL · 消费`）、恒显示「下单：—」 | 过滤 `businessType=HOTEL` 行（酒店只在「我的酒店订单」）；业态中文化；`createdAt` 缺失不渲染「下单」行；删除 footer 重复裸状态 | `c-end/app.js` |
| P0-4 | 酒店订单状态显示英文；取消按钮条件 `PENDING_PAYMENT` 永不成立 → C 端 100% 无法取消 | 状态字典按服务端闭集重写（`PENDING_CONFIRM/CONFIRMED/CHECKED_IN/CHECKED_OUT/DUE_OUT/CANCELLED/NO_SHOW`）；`orderBadge` 补 `DUE_OUT`；取消条件改为「未取消/未退房即可取消」 | `c-end/hotel-real.js`、`c-end/app.js` |
| P0-5 | 酒店订单页裸 `fetch` 无超时/无重试，可永久「订单加载中…」 | 「我的酒店订单」**列表页**改走 `SaasPageLoad.renderPage`（加载/超时/失败统一、错误态可重试）；`hotelApi` 统一包 `SaasPageLoad.withTimeout` 并走 `api-errors` 中文文案。酒店**列表/详情页**仍是手写加载/错误态（已加超时与中文错误文案；列表错误态带「重新加载」按钮，详情失败渲染空态），未整体改走 `SaasPageLoad` | `c-end/hotel-real.js` |
| P0-6 | 资产卡只有 `.then`，失败永久「—」 | 资产加载收敛为结构化成功/失败；失败保留上次值并显示可重试提示（`data-retry="my"`）；无 unhandled rejection | `c-end/app.js` |
| P0-7 | 两套订单页并存（真实 `my-orders` + demo `orders`） | `orders` 路由保留为**到「我的订单」的重定向**（`go('my-orders')`），不再渲染 demo 页；删除 `renderOrders`/`renderSuccess`/`addOrder` 死代码；`renderPay` 参数缺失兜底回「我的订单」 | `c-end/app.js` |
| P0-8 | 身份区伪造（昵称恒「SaaS 会员」、头像恒「A」） | 接已有 `GET /business/members/me`（`SAAS.getMember`）显示真实会员号；失败/无档案时保持中性文案，不回退伪值；头像改中性占位 | `c-end/app.js`、`c-end/saas.js` |

### 3.2 P1（本轮应修）

| 编号 | 问题 | 修复 |
| --- | --- | --- |
| P1-1 | 同一目的 4 种叫法（酒店订单/我的酒店订单/订单/我的消费） | 菜单、页面标题、`pageHead` 默认按钮统一「我的订单 / 我的酒店订单」 |
| P1-2 | 生产页出现开发态文案（「已连接 SaaS 后端…」「前端演示」） | 删除/改写我的页与首页提示；`index.html` meta description 去掉「演示」 |
| P1-3 | 我的预约把酒店接口失败暴露成整页告警 | 随 P0-2 移除该请求与告警 |
| P1-4 | 菜单 emoji 与底部 tab 线性 SVG 混用、无按压反馈 | 菜单改为与 tab 同源的内联 SVG；补 `.me-menu button:active`；删死样式 |
| P1-5 | WebView 83 下 `.me-hero` / `.tab-item` 的 `flex gap` 无兜底（违反标准 32） | 兼容类 `html.compat-webview83` 下改为 margin 兜底，加入兼容组 |
| P1-6 | 明细页手写加载/失败态、无重试、只取第一页（20 条截断） | 明细页走 `SaasPageLoad`（错误态可重试）；保留 `total/pages`，底部「加载更多」 |
| P1-7 | 积分流水 `EARN` 英文 | 类型字典补「获得积分」等中文 |
| P1-8 | 入离日期与其它页日期格式不一致 | 统一走 `SaasDateTime` 格式化 |
| P1-9 | 「我的订单」状态重复渲染（胶囊 + 裸文本） | footer 只保留金额，删除裸状态 |
| P1-10 | 深链/返回缺陷：未知路由回落首页、子页返回可能退出应用、首访 `MEMBER_NOT_FOUND` 显示错误态、boot 期间白屏 | 「我的」相关子页返回固定回 `my`；未知路由渲染 **404 错误视图**（`renderNotFound`：标题「页面不存在」+ 返回首页，不再静默回落）；`MEMBER_NOT_FOUND` 按空态处理；boot 期间 `#app` 给中性「加载中…」占位 |
| P1-11 | 储值品牌名两套兜底（`SaaS 币` vs `储值币`） | **C 端页面统一取 `SAAS.DEFAULT_WALLET_BRAND`**（`saas.js`，租户配置读取失败时的唯一回退；`app.js` 只从 `SAAS.DEFAULT_WALLET_BRAND` 起值、再用配置 `brandName` 覆盖）；`money.js` 的 `DEFAULT_TOKEN_BRAND` **保留为 C/B 两端共享契约值**（跨端契约测试要求 C/B `money.js` 逐字一致，不能合并/改写），C 端页面不得读取它。原「统一引用同一常量」的审计建议已被跨端契约测试否决 |
| P1-12 | 业态可见性 | **本轮不做**（C 端上下文 `businessType` 不可靠，首页入口也未过滤；用去重解决可感知问题） |

## 4. 明确不做（边界）

1. 不新增业务菜单/业务页面/后端接口（仅新增 404 错误视图）；不新增设置/客服/协议/关于/退出登录/优惠券/权益/发票/消息/注销。
2. 不改登录/OAuth/游客态流程（`oauth.js` 的 `ensureAuth`/`loginWithPassword`/`isUiPreview`/GVBridge 不动）。
3. 不改后端契约：`OrderView.createdAt` 恒空、`/me/orders` 含酒店行、酒店取消按门店校验等后端口径问题只在前端做守卫/过滤，不在本轮修后端。
4. 不做按业态/租户配置的菜单可见性过滤（现有 C 端接口拿不到可靠业态；详见审计 §3）。
5. 不做 ADR-0009 的单订单入口收敛（保留「我的订单 / 我的酒店订单」两个业务视图，只消除重复展示）。
6. 不重构 `me-*` 布局体系、不改设计 token、不引入图标库（SVG 与底部 tab 同源）。

## 5. 测试与验收

### 5.1 自动化

> 结果口径：**本地实测**（2026-11-02 08:51，`npx vitest run`，`open-saas-mobile`）：
> **31 个测试文件 / 200 条用例全部通过**（Duration 2.52s）。若 C 端实现方最终报告另有数字，以最终报告为准。

- 本轮新增：
  - `c-end/mine-fixes.test.js`（12 条，源码守卫）：菜单 5→3 且零重复 `data-route`、身份区不再伪造「SaaS 会员/A」、
    资产失败可重试、我的预约不再混酒店、我的订单过滤酒店行且 `createdAt` 守卫、酒店状态闭集中文化与取消条件、
    `EARN` 中文映射、深链返回不退出应用、品牌兜底唯一出口等；
  - `c-end/mine-behavior.test.js`（6 条，行为回归，真实 c-end 脚本 + 受控 fetch/DOM 桩）：
    ① 我的订单 `KTV+HOTEL` 只渲染 1 张 KTV 卡且不请求酒店接口；② `createdAt` 缺失不渲染「下单：—」；
    ③ 资产先成功后 503 保留上次值 + 可重试提示；④ 储值明细 `pages=2` 点「加载更多」请求 page=2 且行数增加；
    ⑤ `#/orders` 深链重定向 `#/my-orders` 并渲染；⑥ 深链规范化（ledger/order-bill/order-items/real-hotel 缺省段）。
- 已同步更新的既有用例：`c-end/my-orders-visibility.test.js`、`c-end/hotel-orders.test.js`、
  `c-end/order-items.test.js`（错误态断言改为「订单加载失败」）、`c-end/datetime.test.js`；
  `c-end/refresh-policy.test.js` 断言不变，仅注释/文案从「我的消费」改为「我的订单」。
- 「我的预约酒店告警」相关断言已改为对「我的酒店订单」页错误态的断言（不是删除断言）。

### 5.2 手工验收（逐条可测）

- [ ] 「我的」页菜单 3 项 + 资产卡 2 个入口；页面上不存在两个元素指向同一 `data-route`。
- [ ] 我的预约：仅 KTV 卡片；无 KTV 预约时为空态；不再出现「酒店订单加载失败」告警。
- [ ] 我的订单：无酒店行；业态显示中文；`createdAt` 为空时不显示「下单：」行；状态只出现一次（header 胶囊）。
- [ ] 我的酒店订单：7 个状态全部中文；`PENDING_CONFIRM/CONFIRMED/CHECKED_IN/DUE_OUT` 可取消，`CHECKED_OUT/CANCELLED` 不可取消；接口挂起 15s 内出现可重试错误态。
- [ ] 资产卡：正常显示数量；接口 401/503 时保留上次值并出现「重试」，控制台无 unhandled rejection。
- [ ] 身份区：显示真实会员号（或中性文案），不再出现「SaaS 会员」/「A」硬编码。
- [ ] 明细页：失败可重试；`EARN` 显示「获得积分」；超过 20 条可加载更多。
- [ ] 360×800 / 393×851 / 412×915 三档行高/点击区/无 emoji 跳动；`html.compat-webview83` 下 hero 与 tab 间距正确。
- [ ] 六个入口（`#/my`、`#/my-reservations`、`#/my-orders`、`#/my-hotel-orders`、`#/ledger/coin`、`#/ledger/points`）首屏无 4xx/5xx、无白屏；深链返回不退出应用。
- [ ] 失效深链（如 `#/order-items/abc`）显示「页面不存在」404 视图并可返回首页，不停在加载骨架；`#/orders` 重定向到 `#/my-orders`。
- [ ] 支付成功跳转仍进「我的订单」；账单页「去支付」仍进支付页。

## 6. 回归与风险

| 风险 | 缓解 |
| --- | --- |
| 删除 demo 订单页影响历史深链 | `orders` 路由保留为到「我的订单」的重定向（`go('my-orders')`），不 404；`renderPay` 参数缺失同样回「我的订单」 |
| 过滤酒店行后用户找不到酒店订单 | 「我的酒店订单」菜单保留且为唯一入口；酒店列表页/预订成功页仍可跳转 |
| 会员档案未初始化（新用户） | `MEMBER_NOT_FOUND` 按空态处理，不显示错误态、不无限重试 |
| 状态字典与服务端闭集漂移 | 字典以 `HotelBookingApplicationService` 状态闭集为准；`app.js` 与 `hotel-real.js` 共用同一套映射口径 |
| WebView 兼容 | 复用既有 `html.compat-webview83` 机制，不引入新 polyfill |

## 7. 关联文档

- 现状审计（工作区）：`.outputs/architecture/c-end-mine-menu-audit.md`
- 方案（rev2，C 端 §4）：`.outputs/architecture/SAAS_STORE_MINE_SOLUTION.md`
- 前端规范：`../../open-im-server/docs/80-development/standards/32_FRONTEND_UI_STYLE.md`（B/C token、页面骨架、WebView 兼容）
- 后端契约（只消费不改）：`../../open-im-server/docs/30-reference/API_DOCUMENTATION.md`、`../../open-im-server/docs/50-services/platform/platform-order-service/README.md`、`platform-customer-service` 的 `/me/wallet`、`/me/points`
- 门店生命周期（与本轮无接口依赖，仅状态影响 C 端可见性）：`../../open-im-server/docs/40-domain/identity/STORE_LIFECYCLE_DESIGN.md`
