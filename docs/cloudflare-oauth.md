# 发布者托管的 Google OAuth（Cloudflare Workers）

## 状态与前提

本轮实现以 **Google OAuth Web application 客户端**为前提，机密只在 Worker；不再尝试将 Web client secret 放进扩展，也不使用 Desktop loopback 或 implicit。Google 官方文档已核对：

- https://developers.google.com/identity/protocols/oauth2/web-server ：Web server Authorization Code、固定 redirect URI、`access_type=offline`、刷新及撤销。
- https://developers.google.com/identity/protocols/oauth2 ：refresh token 失效原因与测试模式限制。
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background ：Firefox 与 Chrome 后台模型差异。

**没有发布者域名、Cloudflare 账号部署授权或 Google Web 客户端真实配置，故尚未部署或验证真实换码/刷新。** 文档核对不是“Refresh Token 实际行为验证”。发布前必须用自有测试账号验证收到 refresh token、到期刷新、重新授权及撤销。

Google Web client 的回调必须登记为精确的 `https://<发布者域名>/oauth/callback`，不能任意匹配扩展设备回调。不在 Google 注册 Brave/Edge/Ego 专用回调。Worker 发送 state 和 S256 PKCE，换码同时带 `code_verifier` 与 Worker Secret；实际客户端/Google 配置接受 PKCE 仍须真实换码确认。Google Testing 发布状态下，包含 Drive scope 的 refresh token 通常在 7 天后失效；正式发布也不保证永久有效，撤销、长期不用、账号策略、客户端 token 数量限制都会影响授权。

## 最小架构与安全交接

```text
扩展持久保存随机 verifier + 待领取凭据
  → POST Worker /v1/start（只发 S256 challenge 和绑定账号）
  ← 会话 ID + 发布者 /authorize URL
  → tabs.create 打开 /authorize
Worker 设置 HttpOnly Secure SameSite cookie → Google consent（state + PKCE）
Google → 发布者 HTTPS callback
Worker 校验 cookie + state 并单次 claim → Google token endpoint
Worker 验证 scope / userinfo sub / verified email → 加密 token 保存 D1
扩展 alarm → POST /v1/redeem（verifier + 预生成 credential）
  ← JSON 短期 access token、过期时间、账号
扩展 → Drive API（业务/密文/恢复密钥不经过 Worker）
扩展 → POST /v1/token（设备 Bearer credential）→ Worker 刷新
```

没有扩展 redirect URI、剪贴板 code、URL token 或内容脚本桥。普通用户只点击连接、完成 Google 同意并返回 PageClip；最多约一分钟 alarm 后领取。前台再次连接也可尝试领取，不必等待 alarm。关闭授权标签页不会被误认为撤销；会话到期提示重新连接。Worker 完成页只有普通说明，没有令牌或凭据。

设备凭据是高熵长期 bearer：不是 Google refresh token，但持有者可以取 Google access token，必须同等保护。只保存在扩展 TRUSTED_CONTEXTS 存储中，不向普通日志或诊断返回。刷新令牌/短期令牌由 Worker AES-GCM 加密保存 D1，凭据本身只保存 SHA-256；加密 AAD 绑定记录 ID。部署说明、schema、Secrets 与旧密钥迁移详见 `oauth-worker/README.md`。

## 接口

所有 API 使用 JSON、`Cache-Control: no-store`、精确 Origin 白名单；不接受业务对象。

| 接口 | 请求 | 响应/职责 |
| --- | --- | --- |
| POST /v1/start | `{challenge, account?}` | `{id, authorizeUrl, expiresAt}`；创建有时限会话 |
| GET /authorize | `?id=<session>` | 设置同浏览器绑定 cookie，跳转 Google |
| GET /oauth/callback | Google `code/state` | state、cookie、PKCE、换码、账号绑定；无 token 展示 |
| POST /v1/redeem | `{id, verifier, credential}` | token、expiresAt、email、subject；相同证明幂等领取 |
| POST /v1/token | Bearer credential，`{force?}` | 缓存或刷新后的短期 token |
| POST /v1/cancel | `{id,verifier}` | 取消未领取授权并清理凭据 |
| DELETE /v1/connection | Bearer credential | 撤销账号级应用授权，删除同 subject 的已知认证记录；失败则持久保留撤销任务 |

重新授权 `/v1/start` 携带旧设备 Bearer 凭据，绑定原 subject/email；新连接领取成功后原子替换旧记录，不撤销整个 Google grant。确认 `invalid_credential` 后允许重新发起，不因网络错误丢弃凭据。领取回执过期不删除候选凭据，而通过 `/v1/token` 恢复已提交的连接。

设置页断开操作明确警告：Google 撤销可能影响同账号其他设备。服务端按账号删除已知凭据和个人会话元数据；不会删除 Drive 文件。撤销错误保留加密凭据以便重试；D1 备份的物理清除受发布者保留政策约束。

状态码/错误为固定白名单，不回显 Google 原始响应。429/503 按 Retry-After 重试；401/403 要求重新授权或修正权限。D1 CAS/lease 防止刷新并发和重复消费；刷新响应不含新 refresh token 时保留原 token，返回新 token 时加密保存轮换结果。Google 返回成功但网络/存储确认中断的窗口无法用 D1 与 Google 构造跨系统事务；再次刷新失败时必须重新授权，不能声称永久无感恢复。

## 扩展配置与发布

只有发布者执行以下配置，用户无需开发者凭据：

1. 部署 Worker/D1 和正式 HTTPS 域名（见 Worker README）。
2. 配置 Google Web 客户端、回调与用户同意页；Secrets 不写入 git。
3. 执行 `node scripts/configure-worker-auth.mjs https://<实际域名>`，写入公开 origin 和精确 host permission。
4. 在 Worker 白名单填入实际商店/开发包扩展 Origin；固定 Chrome ID 不能替代 Firefox 动态 UUID。
5. 运行测试并按真实浏览器验收表逐项验收。

仓库默认 `GOOGLE_WORKER_ORIGIN = ''`，缺少部署配置时不会请求虚构域名。配置后 Worker 路径优先于原生及 Desktop 实验路径，普通用户看不到 Desktop 开发凭据入口。发布脚本仍关闭旧 Desktop 实验。不删除现有 `_sync`、AES-GCM 密钥、冲突、操作日志或 outbox。断开认证不等于删除本地数据、Drive 文件或恢复密钥；删除 Drive 数据是另一项显式授权操作，不由认证 Worker 执行。

## 浏览器验证（不能混同 OAuth 成功）

| 浏览器 | 本轮实际检查 | 真实 Google 授权 |
| --- | --- | --- |
| Edge 155.0.4283.62 | 隔离 headed MV3 worker 发出真实 POST；服务端观察到 chrome-extension Origin | 未部署、未执行 |
| Ego 154.0.8037.44 | 隔离 headed MV3 worker 发出真实 POST；服务端观察到 chrome-extension Origin | 未部署、未执行 |
| Brave | 常用安装路径未发现可执行文件，未实际运行 | 未执行 |
| Firefox | 未安装；当前项目 Chrome MV3 service_worker、sidePanel、setAccessLevel 仍需移植 | 不支持声明；未执行 |

探针：`node scripts/probe-oauth-origin.mjs <browser-exe>`。它只访问本机临时 HTTP 服务，不打开真实账号、不修改正常用户配置。Edge/Ego 已观察到 JSON POST 带 `Origin: chrome-extension://...`；HTTPS Worker CORS、cookie 同意页跳转与真实 token 仍未验证。Firefox 的 moz-extension UUID 和 TRUSTED_CONTEXTS 等安全隔离需要单独发布包方案，不能宽泛允许任意 moz-extension Origin 冒充支持。

## 验收与未完成事项

本轮最终结果：29 个扩展/业务测试脚本全部通过；`node --test oauth-worker/test/worker.test.js` 的 15 个 Worker 测试全部通过。Worker 测试运行实际 SQL 迁移、事务和 Web Crypto，Google HTTP 为模拟响应。语法/JSON 检查通过（114 个 JavaScript 文件），国际化检查通过（417 个键）；CRLF 感知 diff 检查通过。未运行 Wrangler 部署、真实 Cloudflare D1 集成或正式发布打包。

扩展测试：`node scripts/test-google-worker-auth.mjs`；Worker Node/SQLite 测试及命令见 Worker README。模拟测试覆盖持久交接、重启、短期缓存、强制刷新、网络保留、账号错配及撤销重试；不冒充真实 Google 测试。

必须补做：部署后的四浏览器支持决策与账号 E2E、真实 refresh token 发放/到期/撤销/轮换、扩展升级重启恢复、Cloudflare WAF/日志隐私设置、备份保留删除政策、负载/成本/告警。D1/Workers 免费额度有上限，发布者负责成本评估；没有擅自开通付费服务。
