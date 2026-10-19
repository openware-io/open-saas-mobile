# Kind 局域网联调

本项目的浏览器请求始终使用同源相对路径 `/api/` 和 `/oauth/`。Kind 中由 saas-mobile 的 Nginx 代理到集群内 `gateway:3002`；局域网客户端只访问统一 Ingress，不需要也不应该把 API 地址改成客户端自己的 `localhost`。

## 访问已部署的 Kind 环境

一键部署完成后，Ingress 默认监听 `30080`。假设部署机地址为 `<Kind主机IP>`：

```text
C 端：http://<Kind主机IP>:30080/a380/
B 端：http://<Kind主机IP>:30080/b/
```

普通 HTTP 局域网 IP 不是 PKCE 需要的浏览器安全上下文，正常 OAuth 链路可能无法完成；本地 Kind 因此提供“调试放权”：仅当来源是回环/内网地址时，页面可调用 `POST /api/v1/dev/saas/session` 换取调试会话，跳过 PKCE（实现见 `platform-identity-service` 的 `DevSaasSessionController`）。

调试放权由部署机显式开启，默认关闭：

- `k8s/local/saas.yaml` 为 platform-identity-service 设置 `SAAS_DEV_SESSION_ENABLED=true`，并配置调试账号 `SAAS_DEV_SESSION_CONSUMER_ACCOUNT_ID=101` / `SAAS_DEV_SESSION_OPERATOR_ACCOUNT_ID=100`；
- 只在本地 Kind 清单开启，生产不设置这些变量；
- 服务端限制来源为回环/内网地址，并校验 appId 白名单。

局域网设备可直接使用：

- C 端：`http://<Kind主机IP>:30080/a380/`
- B 端：`http://<Kind主机IP>:30080/b/`；首次进入按账号可访问门店选择运营门店。

未开启放权的环境（例如正式包）会静默回退正常 OAuth；普通 HTTP 内网地址下页面会提示需要 HTTPS 或从 IM App 进入。不要直接访问集群内部端口。

Windows 防火墙只需允许受信任局域网访问 TCP `30080`。以管理员 PowerShell 执行：

```powershell
& '<open-im-server>\scripts\deploy\enable-kind-lan-access.ps1' -RemoteSubnet '<受信任网段>'
```

## 访问本地 Vite 开发服务

`npm run dev:c` 监听 `0.0.0.0:5175`，`npm run dev:b` 监听 `0.0.0.0:5176`。Vite 运行在部署机上时，默认 API 代理目标 `http://127.0.0.1:30080` 是正确的：请求由部署机的 Vite 进程转发，而不是由局域网客户端发往自己的回环地址。

例如开发机与 Kind 部署机分离时，在开发机执行：

```powershell
$env:VITE_DEV_API_TARGET = 'http://<Kind主机IP>:30080'
npm run dev:c
```

浏览器访问 `http://localhost:5175/` 或 `http://localhost:5176/index.b.html`。Vite 会把 `/api` 和 `/oauth` 转发到 Kind；浏览器仍只连接本机。`localhost` 是 PKCE 可用的安全上下文；若 Kind 已开启调试放权，这两条路径同样可用放权进入。Kind 的 OIDC 注册表默认登记 `localhost`/`127.0.0.1` 的开发端口；若需从其他设备走正常 OAuth，应配置 HTTPS 和对应回调地址，而不是使用普通 HTTP 局域网 IP。
