# gv_saas_mobile

SaaS 接入 App 的前端工程（**Vue3 + Vite 双入口**），承载两个对接移动端的 H5：

| 端 | 入口 | 部署路径 | 职责 |
| --- | --- | --- | --- |
| **C 端**「A380 更多服务」 | `index.c.html` | `/a380/` | 顾客任选包厢预约、查账单/钱包 |
| **B 端**「A380 商户端」 | `index.b.html` | `/b/` | 门店现场操作（预约管理/开台/结算/收银/门店） |

> 与 Web B 端后台（`gv_saas_admin`，/saas/）区分：本仓库只放「对接移动端」的 H5；Web 桌面后台是 SaaS 本身提供的完整管理台，留在 `gv_saas_admin`。

## 目录

```
package.json               vue3 + vite + vue-router + pinia + axios
vite.config.c.js / .b.js   两个构建目标（dist-c → /a380/，dist-b → /b/）
index.c.html / index.b.html
src/
  shared/                  两端共用：bridge(App注入配置) + api/request(axios) + api/saas(业务) + utils(金额分/状态)
  c-end/                   C 端 Vue app（views/Home 包厢预约 + views/Mine 我的）
  b-end/                   B 端 Vue app（views/Reservations + Orders + Stores）
nginx.conf                 /api/ 反代到 gateway
Dockerfile                 一次 build 产出两个 H5 静态资源
VERSION                    语义版本（发版 bump）
```

## 宿主授权契约（IM App WebView → H5）

宿主只通过 `GVBridge.login` 提供一次性 OAuth 授权码。H5 使用授权码 + PKCE 交换同源 `HttpOnly` 会话 Cookie；不会接受或持久化 URL、JavaScript 注入或 localStorage 中的 token、租户、会员和 API 地址。

- API 固定经同源 nginx `/api/` 与 `/oauth/` 反代。
- 当前租户/门店上下文由服务端会话保存；浏览器不发送权限快照。
- 完整后端契约见 `docs/backend-security-contract.md`。

## KTV 业务（已前后台打通）

金额在接口里统一是最小货币单位（CNY 分 / USD cent，long/整数），**不做汇率换算**；展示统一走
`formatMoney(minor, currencyCode?)`，缺省用全局当前租户币种（`context select` 响应 `currencyCode`，缺省 USD）。

- 币种唯一来源与字典：C 端 `c-end/money.js`、B 端 `src/shared/utils/money.js`（两侧字典必须一致，
  `currency-contract.test.js` 守卫）；`src/shared/utils/amount.js` 只做转发。
- 切币种后全站符号同步变化（C 端 `currency-changed` 事件重渲染，B 端 Vue store 响应式）；
  已结算单据/钱包流水自带币种快照时**以记录为准**。
- 禁止散落货币符号、展示用「元」、手写 `/100`、`*100` 与裸币种码：守卫测试全仓扫描清零。

- 包厢列表：`GET /api/v1/business/resources?resourceType=KTV_ROOM`
- 预约：`POST /api/v1/business/reservations` + 确认/到店/取消
- 订单：`POST /api/v1/business/orders`（开台）+ 会话 open/close + 加项 + 结算 + 组合收款 `collect`
- 门店：`GET /api/v1/admin/tenant/stores`
- C 端钱包/积分：`GET /api/v1/me/wallet|points`

## 构建与发布

本地启动 B 端时，Vite 默认把 `/api/` 和 `/oauth/` 代理到
`http://127.0.0.1:30002`，从而保留 OAuth、HttpOnly Cookie 和 CSRF 的同源会话模型：

```bash
npm run dev:b
```

如网关不在本机（例如用 Kind 部署机 `192.168.31.91`），用 `VITE_DEV_API_TARGET` 覆盖代理目标，
C 端同理：

```bash
$env:VITE_DEV_API_TARGET='http://192.168.31.91:30002'; npm run dev:b
```

仅调整 B 端页面样式时，可启动纯 UI 预览模式。该模式只在 Vite 开发服务器中生效，
使用本地模拟数据，不发起 OAuth 或真实 API 请求：

```bash
npm run dev:b -- --mode preview
```

浏览器打开 `http://127.0.0.1:5176/b/`，通过底部导航预览预约、订单等页面。
生产构建不会启用预览模块。

```bash
npm ci
npm test
npm run build        # 产出 dist-c + dist-b
```

## 本地联调 H5

`dev:c`（预约/顾客端）和 `dev:b`（商户端）都已内置 Vite 同源代理：`/api` 和 `/oauth` 默认转发到本地 Kubernetes 网关 `http://127.0.0.1:30002`。当 Vite 在另一台局域网开发机运行时，将代理目标设置为运行 Kind 的机器地址；浏览器仍只访问本机 Vite，不直接调用网关：

```powershell
npm ci
$env:VITE_DEV_API_TARGET = 'http://127.0.0.1:30002' # Kind/Kubernetes NodePort
# 例如在 192.168.31.112 开发，Kind 在 192.168.31.91：
# $env:VITE_DEV_API_TARGET = 'http://192.168.31.91:30002'
# $env:VITE_DEV_API_TARGET = 'http://127.0.0.1:3002' # 直接运行网关
npm run dev:c # C 端预约 H5，端口 5175
# npm run dev:b # B 端商户 H5，端口 5176
```

浏览器打开 `http://localhost:5175/`（C 端）或 `http://localhost:5176/index.b.html`（B 端）。也可以直接打开 Kind 部署的页面 `http://<部署机>:30082/a380/` 与 `/b/`：普通 `http://192.168.x.x` 不是 PKCE 需要的浏览器安全上下文，此时页面会走「调试放权」——调用 `POST /api/v1/dev/saas/session` 直接换调试会话（端口 5175/5176/30082 + 内网/回环地址才触发，服务端默认关闭，仅本地 Kind 清单开启，详见 docs/kind-lan-integration.md）。未开启放权的环境会静默回退正常 OAuth。代理会把后端会话 Cookie 保持为本地联调可用的形式，前端仍只使用服务端 HttpOnly 会话，不读取或保存 token。

首次使用 OAuth 登录时，回调地址必须与浏览器实际打开的地址完全一致。Kind 的回调同步脚本默认登记 `localhost` 和 `127.0.0.1` 的 Vite 开发端口；因此 `.112` 本地运行 Vite 时无需额外登记 IP。若必须从另一台机器打开开发服务，应配置 HTTPS 后再通过 `-AdditionalViteCOrigins` 和 `-AdditionalViteBOrigins` 登记该 HTTPS 源站。

```powershell
& 'D:\projects\cnb\gv_im_server\scripts\deploy\sync-oidc-client-registry.ps1' `
  -Environment kind -Context kind-gv-im-local -Namespace gv-im-local `
  -DatabaseSecret gv-im-env -RootDatabaseSecretKey DB_PASSWORD `
  -H5Base 'http://192.168.31.91:30082' `
  -AdditionalViteCOrigins 'http://192.168.31.112:5175' `
  -AdditionalViteBOrigins 'http://192.168.31.112:5176'
```

C 端使用已授权的 IM 用户，B 端使用已在 SaaS 租户中配置为运营人员的 IM 账号。
