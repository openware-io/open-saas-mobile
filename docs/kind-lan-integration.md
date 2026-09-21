# Kind 局域网联调

此项目的浏览器请求始终使用相对路径 `/api/` 和 `/oauth/`。在 Kind 中，SaaS mobile 的 Nginx 容器将这两个路径代理到集群内 `gateway:3002`，因此局域网客户端只需要访问 mobile 页面端口，不能把 API 地址改成客户端自身的 `localhost`。

## 访问已部署的 Kind 环境

部署机运行 `D:\projects\cnb\gv_im_server\scripts\deploy\k8s.ps1` 后，Docker 的 `gv-im-k8s-saas-mobile-proxy` 会将本机 `30082` 转发到 Kind 的 `saas-mobile` NodePort。

若部署机的局域网地址为 `192.168.31.91`，另一台电脑可查看静态页面：

```text
http://192.168.31.91:30082/a380/
```

商户端使用 `http://192.168.31.91:30082/b/`。**普通 HTTP 局域网 IP 不是 PKCE 所需的浏览器安全上下文**，正常 OAuth 链路在这里跑不通；本地 Kind 因此提供「调试放权」：内网地址 + 调试端口（5175/5176/30082）下，页面改为调用 `POST /api/v1/dev/saas/session` 换取调试会话，跳过 PKCE（实现见 gv_im_server 的 `DevSaasSessionController`）。

调试放权由部署机显式开启，默认关闭：

- `k8s/local/saas.yaml` 给 platform-identity-service 配了 `SAAS_DEV_SESSION_ENABLED=true`（以及调试账号 `SAAS_DEV_SESSION_CONSUMER_ACCOUNT_ID=101` / `SAAS_DEV_SESSION_OPERATOR_ACCOUNT_ID=100`）；
- 仅在本地 Kind 清单里开启，生产不设置这三个变量；
- 服务端还限制来源必须是回环/内网地址、appId 必须在白名单内。

所以现在局域网设备可直接用 `http://192.168.31.91:30082/a380/`（C 端）与 `http://192.168.31.91:30082/b/`（B 端）联调；B 端首次进入会要求选择运营门店（账号可访问多门店时的既有交互）。未开启放权的环境（例如打正式包）会静默回退正常 OAuth，普通 HTTP 内网地址下页面会提示需要 HTTPS / 从 IM App 进入。不要直接访问 `30002`。

Windows 防火墙只需允许受信任局域网 `192.168.31.0/24` 访问 TCP `30082`。以管理员 PowerShell 执行：

```powershell
& 'D:\projects\cnb\gv_im_server\scripts\deploy\enable-kind-lan-access.ps1' -RemoteSubnet '192.168.31.0/24'
```

## 访问本地 Vite 开发服务

`npm run dev:c` 监听 `0.0.0.0:5175`，`npm run dev:b` 监听 `0.0.0.0:5176`。Vite 运行在部署机上时，默认 API 代理目标 `127.0.0.1:30002` 是正确的：请求由部署机的 Vite 进程转发，而不是由局域网客户端发往自己的回环地址。

例如在 `192.168.31.112` 本地开发、Kind 在 `192.168.31.91` 时，在 `.112` 执行。不要把部署机 IP 写入版本库：

```powershell
$env:VITE_DEV_API_TARGET = 'http://192.168.31.91:30002'
npm run dev:c
```

`.112` 浏览器访问 `http://localhost:5175/` 或 `http://localhost:5176/index.b.html`。尽管 Vite 会代理到 `.91` 的 Kind 网关，浏览器仍只连接 `.112` 本机；`localhost` 是 PKCE 可用的安全上下文，若 Kind 已开启调试放权，这两条路径同样可用放权进入。Kind 的 OIDC 注册表默认登记这两个回调地址；若需走**正常 OAuth**（不开放权）从其他设备打开 `.112` 的 Vite，则需要配置 HTTPS 和对应的 OIDC 回调地址，而不是使用普通 HTTP 局域网 IP。
