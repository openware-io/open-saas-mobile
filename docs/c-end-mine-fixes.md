# C 端「我的」页本轮修复说明（现有业务修复，统一订单/预约信息架构）

> 状态：`current`（2026-11-02，IA 修正版）
> 范围：`open-saas-mobile/c-end`（H5 消费者端）；后端读模型按 ADR-0025 统一
> 依据：`.outputs/architecture/c-end-mine-menu-audit.md`（现状审计与逐条证据）、`SAAS_STORE_MINE_SOLUTION.md` §4、[ADR-0025](../../open-im-server/docs/20-architecture/adr/0025-unified-c-end-order-reservation-read-model.md)（C 端统一「我的订单 / 我的预约」读模型，禁止按业态拆菜单）
> 边界：不新增业务菜单/业务页面；只把既有「我的」信息架构收敛为 **2 个业务入口 + 2 个资产入口**；不改登录/游客态策略；后端只做 `/me/reservations` 统一读模型（ADR-0025），不改写路径
> 落地说明：按 ADR-0025 的实现已落到当前工作区（前端 + `/me/reservations` 统一读模型，未提交）；测试结果见 §5.1。

## 1. 本轮目标与口径修正

修掉「我的」页现存的可感知缺陷，并纠正**按业态拆 C 端菜单**的错误信息架构：

- **订单是共享聚合**：`ord_order` 带 `businessType`，C 端只有一个「我的订单」，`GET /me/orders` 返回**全部业态**订单（KTV/酒店…），前端只用 `businessType` 标注类型，**不按业态过滤/拆入口**；酒店订单展示状态由 `displayStatus`（`htl_booking.status` 投影）决定。
- **酒店预订是预约**：`htl_booking` 是专用 reservation 记录并关联 `ord_order`，C 端只有一个「我的预约」；后端 `GET /me/reservations` 用统一读模型聚合 KTV 预约与酒店预订：`[{type:"KTV",ktv:{...}}, {type:"HOTEL",hotel:{...}}]`，按创建时间倒序；前端按 `type` 渲染两类卡片，**不再有独立的「我的酒店订单」页面/菜单**。
- 修完后信息架构为 **2 个业务入口（我的预约 / 我的订单）+ 2 个资产入口（储值币 / 积分及明细）**，全部复用现有页面与后端资源。

## 2. 修后信息架构（2 业务入口 + 2 资产入口，零按业态拆分）

| 位置 | 内容 | `data-route` | 说明 |
| --- | --- | --- | --- |
| 资产卡 | 储值币数量（整卡可点） | `ledger/coin` | 明细的**唯一入口** |
| 资产卡 | 积分数量（整卡可点） | `ledger/points` | 明细的**唯一入口** |
| 入口 1 | 我的预约（KTV 预约 + 酒店预订，统一读模型 `type=KTV/HOTEL`） | `my-reservations` | 预约类业务**唯一入口**；酒店预订不再单独成页 |
| 入口 2 | 我的订单（全部业态，`businessType` 标注类型） | `my-orders` | 订单类业务**唯一入口**；`/me/orders` 不按业态过滤 |

净效果：可点业务入口 2 个 + 资产入口 2 个、**零重复 `data-route`**、**零按业态拆分的菜单/页面**。历史深链 `#/my-hotel-orders` 重定向到 `#/my-reservations`（在统一预约页按 `type=HOTEL` 展示）。

## 3. 修复项清单

### 3.1 P0（本轮必须）

| 编号 | 问题 | 修复 | 涉及文件 |
| --- | --- | --- | --- |
| P0-1 | 资产卡与菜单第 4/5 项重复指向 `ledger/*` | 删除菜单中的两个明细项；资产卡保留为唯一入口 | `c-end/app.js`（`renderMy`） |
| P0-2 | 「我的预约」把酒店预订排除在外（原按业态拆分：酒店预订被迫走独立页面） | **口径修正**：酒店预订属于预约，统一进「我的预约」；`loadMyReservations` 只调 `GET /me/reservations`（统一读模型），不再单独请求 `/business/hotel/bookings` 拼数据 | `c-end/app.js` |
| P0-3 | 「我的订单」曾把酒店行过滤掉（原「酒店只在独立页」的错误口径） | **口径修正**：`/me/orders` 返回全部业态，**不过滤酒店行**；按 `businessType` 中文标注类型；`createdAt` 缺失不渲染「下单」行；删除 footer 重复裸状态 | `c-end/app.js` |
| P0-4 | 酒店预订状态显示英文；取消按钮条件 `PENDING_PAYMENT` 永不成立 | 状态字典按服务端闭集重写（`PENDING_CONFIRM/CONFIRMED/CHECKED_IN/CHECKED_OUT/DUE_OUT/CANCELLED/NO_SHOW`）；`orderBadge` 补 `DUE_OUT`；取消条件改为「未取消/未退房即可取消」；该卡片在「我的预约」内按 `type=HOTEL` 渲染 | `c-end/app.js`、`c-end/hotel-real.js` |
| P0-5 | 酒店相关页面裸 `fetch` 无超时/无重试，可永久「加载中…」 | 「我的预约」统一页走 `SaasPageLoad.renderPage`（加载/超时/失败统一、错误态可重试）；`hotelApi` 统一包 `SaasPageLoad.withTimeout` 并走 `api-errors` 中文文案；酒店列表/详情页仍手写加载/错误态（已加超时与中文错误），不整体改走 `SaasPageLoad` | `c-end/hotel-real.js`、`c-end/app.js` |
| P0-6 | 资产卡只有 `.then`，失败永久「—」 | 资产加载收敛为结构化成功/失败；失败保留上次值并显示可重试提示（`data-retry="my"`）；无 unhandled rejection | `c-end/app.js` |
| P0-7 | 两套订单页并存（真实 `my-orders` + demo `orders`） | `orders` 路由保留为**到「我的订单」的重定向**（`go('my-orders')`），不再渲染 demo 页；删除 `renderOrders`/`renderSuccess`/`addOrder` 死代码；`renderPay` 参数缺失兜底回「我的订单」 | `c-end/app.js` |
| P0-8 | 身份区伪造（昵称恒「SaaS 会员」、头像恒「A」） | 接已有 `GET /business/members/me`（`SAAS.getMember`）显示真实会员号；失败/无档案时保持中性文案，不回退伪值；头像改中性占位 | `c-end/app.js`、`c-end/saas.js` |
| P0-9 | **信息架构按业态拆分**（「我的订单 / 我的酒店订单」双入口、预约排除酒店） | 按 ADR-0025 收敛：订单只留「我的订单」（全业态），预约只留「我的预约」（统一读模型）；删除独立「我的酒店订单」菜单/页面；`#/my-hotel-orders` 重定向 `#/my-reservations`；不再前端双接口合并。**滚动发布兼容**：`/me/reservations` 若返回旧格式（无 `type` 的 ReservationView），前端按 `KTV` 归一，避免白屏 | `c-end/app.js`、`c-end/hotel-real.js`、`c-end/saas.js` |

### 3.2 P1（本轮应修）

| 编号 | 问题 | 修复 |
| --- | --- | --- |
| P1-1 | 同一目的多种叫法（酒店订单/我的酒店订单/订单/我的消费） | 统一「我的预约 / 我的订单」两个入口名；页面标题一致；不再出现独立「我的酒店订单」标题（历史深链重定向） |
| P1-2 | 生产页出现开发态文案（「已连接 SaaS 后端…」「前端演示」） | 删除/改写我的页与首页提示；`index.html` meta description 去掉「演示」 |
| P1-3 | 我的预约曾把酒店接口失败暴露成整页告警 | 统一读模型后不再有独立酒店请求；预约页失败统一走 `SaasPageLoad` 错误态，不再出现「酒店订单加载失败」 |
| P1-4 | 菜单 emoji 与底部 tab 线性 SVG 混用、无按压反馈 | 菜单改为与 tab 同源的内联 SVG；补 `.me-menu button:active`；删死样式 |
| P1-5 | WebView 83 下 `.me-hero` / `.tab-item` 的 `flex gap` 无兜底（违反标准 32） | 兼容类 `html.compat-webview83` 下改为 margin 兜底，加入兼容组 |
| P1-6 | 明细页手写加载/失败态、无重试、只取第一页（20 条截断） | 明细页走 `SaasPageLoad`（错误态可重试）；保留 `total/pages`，底部「加载更多」 |
| P1-7 | 积分流水 `EARN` 英文 | 类型字典补「获得积分」等中文 |
| P1-8 | 入离日期与其它页日期格式不一致 | 统一走 `SaasDateTime` 格式化（酒店预订卡片在「我的预约」内） |
| P1-9 | 「我的订单」状态重复渲染（胶囊 + 裸文本）；「我的预约」内两类卡片状态口径不一 | 订单 footer 只保留金额；预约页按 `type` 使用各自状态映射，同一状态只出现一次 |
| P1-10 | 深链/返回缺陷：未知路由回落首页、子页返回可能退出应用、首访 `MEMBER_NOT_FOUND` 显示错误态、boot 期间白屏 | 「我的」相关子页返回固定回 `my`；未知路由渲染 404 错误视图（`renderNotFound`）；**`#/my-hotel-orders` 重定向 `#/my-reservations`**；`MEMBER_NOT_FOUND` 按空态处理；boot 期间给中性「加载中…」 |
| P1-11 | 储值品牌名两套兜底（`SaaS 币` vs `储值币`） | **C 端页面统一取 `SAAS.DEFAULT_WALLET_BRAND`**（`saas.js`，租户配置读取失败时的唯一回退）；`money.js` 的 `DEFAULT_TOKEN_BRAND` **保留为 C/B 两端共享契约值**（跨端契约测试要求 C/B `money.js` 逐字一致，不能合并/改写），C 端页面不得读取它。原「统一引用同一常量」的审计建议已被跨端契约测试否决 |
| P1-12 | 业态可见性 | 统一 IA 后**不再按业态拆入口**，无需业态过滤；本期仍不做按租户/业态隐藏入口 |

## 4. 明确不做（边界）

1. 不新增业务菜单/业务页面（仅新增 404 错误视图）；不新增设置/客服/协议/关于/退出登录/优惠券/权益/发票/消息/注销。
2. 不改登录/OAuth/游客态流程（`oauth.js` 的 `ensureAuth`/`loginWithPassword`/`isUiPreview`/GVBridge 不动）。
3. 后端契约变更**只限 `GET /me/reservations` 统一读模型**（`type` + `ktv`/`hotel`，按创建时间倒序；见 ADR-0025）；`GET /me/orders` 保持全业态返回、写路径（`POST /me/reservations`、酒店预订接口）不变。
4. 不做按业态/租户配置的菜单可见性过滤（统一 IA 已消除按业态入口）。
5. 不重构 `me-*` 布局体系、不改设计 token、不引入图标库（SVG 与底部 tab 同源）。

## 5. 测试与验收

### 5.1 自动化

> 结果口径：**本地实测**（2026-11-02 10:39，`npx vitest run`，`open-saas-mobile`）：
> **31 个测试文件 / 202 条用例全部通过**（Duration 2.27s）；其中新增/重写的
> `c-end/mine-fixes.test.js` 12 条、`c-end/mine-behavior.test.js` 9 条。

- 新增/重写：
  - `c-end/mine-fixes.test.js`（源码守卫，12 条）：菜单为 `['my-reservations','my-orders']`、不存在
    `myMenuItem('my-hotel-orders')`、资产失败可重试、`/me/orders` 不过滤酒店行、统一预约 wrapper、
    `#/my-hotel-orders` 深链重定向 `#/my-reservations`、身份区不伪造、`EARN` 中文、品牌兜底唯一出口等；
  - `c-end/mine-behavior.test.js`（行为回归，9 条）：统一预约列表（新 wrapper `KTV+HOTEL` 混排、旧格式按 KTV
    兼容、`#/my-hotel-orders` 重定向）、`/me/orders` 全业态、资产 503 保留值+重试、明细加载更多、
    `#/orders` 重定向等。
- 同步更新的既有用例：`c-end/my-orders-visibility.test.js`、`c-end/hotel-orders.test.js`、
  `c-end/ktv-room-type-booking.test.js`；`c-end/order-items.test.js`、`c-end/refresh-policy.test.js` 等
  保持既有口径（统一 IA 已不再有 `my-hotel-orders` 独立页）。

### 5.2 手工验收（逐条可测）

- [ ] 「我的」页只有 2 个业务入口（我的预约 / 我的订单）+ 2 个资产卡入口；不存在 `my-hotel-orders` 菜单/页面。
- [ ] 我的预约：同一页按 `type` 展示 KTV 预约与酒店预订；酒店预订显示入离日期、中文状态、可按规则取消；无预约时为空态。
- [ ] 我的订单：包含全部业态（KTV/酒店）并用中文/`businessType` 标注类型；`createdAt` 为空时不显示「下单：」行；状态只出现一次（header 胶囊）。
- [ ] 历史深链 `#/my-hotel-orders` 自动重定向到 `#/my-reservations` 并正常渲染；`#/orders` 重定向 `#/my-orders`。
- [ ] 资产卡：正常显示数量；接口 401/503 时保留上次值并出现「重试」，控制台无 unhandled rejection。
- [ ] 身份区：显示真实会员号（或中性文案），不再出现「SaaS 会员」/「A」硬编码。
- [ ] 明细页：失败可重试；`EARN` 显示「获得积分」；超过 20 条可加载更多。
- [ ] 360×800 / 393×851 / 412×915 三档行高/点击区/无 emoji 跳动；`html.compat-webview83` 下 hero 与 tab 间距正确。
- [ ] 全部入口（`#/my`、`#/my-reservations`、`#/my-orders`、`#/ledger/coin`、`#/ledger/points`，以及历史 `#/my-hotel-orders` → `#/my-reservations` 重定向）首屏无 4xx/5xx、无白屏；深链返回不退出应用。
- [ ] 支付成功跳转仍进「我的订单」；账单页「去支付」仍进支付页。

## 6. 回归与风险

| 风险 | 缓解 |
| --- | --- |
| 历史深链 `#/my-hotel-orders` 失效 | 重定向到 `#/my-reservations`；`isMySectionRoute` 保留该路由判定并重定向，不 404 |
| 统一预约页内两类卡片语义混淆（KTV 预约取消 vs 酒店预订取消） | 按 `type` 分支渲染状态/动作，禁止用同一套取消逻辑；沿用各自既有状态映射 |
| `/me/reservations` 统一读模型改动影响既有 C 端页面 | 读模型只做聚合（不改写路径）；前端只消费 `type`+对应字段；OpenAPI 快照与契约测试同步更新 |
| 删除 demo 订单页影响历史深链 | `orders` 路由保留为到「我的订单」的重定向（`go('my-orders')`），不 404 |
| 会员档案未初始化（新用户） | `MEMBER_NOT_FOUND` 按空态处理，不显示错误态、不无限重试 |
| 状态字典与服务端闭集漂移 | 字典以 `HotelBookingApplicationService` 状态闭集为准；「我的预约」内酒店卡片与订单 `displayStatus` 共用同一映射口径 |
| WebView 兼容 | 复用既有 `html.compat-webview83` 机制，不引入新 polyfill |

## 7. 关联文档

- **决策**：[ADR-0025 C 端统一「我的订单 / 我的预约」读模型，禁止按业态拆菜单](../../open-im-server/docs/20-architecture/adr/0025-unified-c-end-order-reservation-read-model.md)
- 现状审计（工作区）：`.outputs/architecture/c-end-mine-menu-audit.md`
- 方案（rev2，C 端 §4）：`.outputs/architecture/SAAS_STORE_MINE_SOLUTION.md`
- 订单治理（现行）：`../../open-im-server/docs/40-domain/order/C_END_ORDER_GOVERNANCE_PLAN.md`（单订单入口方向）
- 前端规范：`../../open-im-server/docs/80-development/standards/32_FRONTEND_UI_STYLE.md`（B/C token、页面骨架、WebView 兼容）
- 后端契约：`../../open-im-server/docs/50-services/platform/platform-order-service/README.md`（`/me/orders`、`/me/reservations` 统一读模型）、`platform-customer-service` 的 `/me/wallet`、`/me/points`
- 门店生命周期（与本轮无接口依赖，仅状态影响 C 端可见性）：`../../open-im-server/docs/40-domain/identity/STORE_LIFECYCLE_DESIGN.md`
