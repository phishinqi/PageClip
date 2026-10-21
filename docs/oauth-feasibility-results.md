# OAuth 最小可行性实测记录

## 验证方法

使用仓库已有 Playwright，启动实际安装浏览器、隔离临时配置和最小 MV3 探针扩展。探针监听真实 chrome.tabs.onUpdated，记录完整诊断 URL 到扩展存储。未读取用户日常浏览器配置或令牌。临时配置完成后清理。

可复现命令：

```
node scripts/probe-oauth-loopback.mjs "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
node scripts/probe-oauth-loopback.mjs "C:/Program Files/Citro Labs/ego lite/Application/ego.exe"
```

43821 端口无监听器；若端口被占用探针会退出。HTTP 302 测试只在另一个随机本地端口提供诊断重定向，不在回调端口启动监听器。所有 code/state 都是诊断字符串，不是 Google 授权信息。

## 实际观察

| 场景 | Edge 155.0.4283.62 | Ego lite 154.0.8037.44 |
|---|---|---|
| 直接到无监听器 loopback | 收到完整 tabs.onUpdated URL，导航 ERR_CONNECTION_REFUSED | 同左 |
| HTTP 302 到无监听器 loopback | 收到完整诊断 code/state | 同左 |
| CDP 关闭 service_worker target 后再导航 | worker 可用且记录新回调 | 同左 |
| 回调前关闭标签页 | 无新回调，不可能凭空恢复授权码 | 同左 |
| 回调后关闭标签页 | 已保存的诊断记录保留 | 同左 |
| 重启同一隔离浏览器配置 | 历史记录保留，收到新回调 | 同左 |

导航失败后 Playwright 观察到 page.url 为 chrome-error://chromewebdata/。**不能将稍后读取 tab.url 当成可靠恢复机制。** 本次据此修正 js/google-pkce.js：先持久保存经验证的回调再换码；启动优先恢复已保存回调；关闭未完成授权标签页时标记取消。代码兑换成功但令牌响应丢失仍需重新授权，不能保证一次性授权码可重用。

## 严格验收状态

- Edge：仅上述版本的回调传输实测通过，Google OAuth 未验证。
- Ego lite：仅上述版本的回调传输实测通过，不代表所有 Ego 产品，Google OAuth 未验证。
- Brave：未在本机常见路径发现安装，未实测。
- Firefox：未在本机常见路径发现安装，未实测；主 Manifest 仍为 Chromium 版。

**没有浏览器被标为完整“已验证支持”。** 以上没有使用真实 Google 客户端，不能证明 Google 接受 127.0.0.1:43821/pageclip/oauth2，不能证明无 secret 换码、refresh token 颁发或刷新有效。Desktop client IP/端口/路径格式、客户端类型和授权约束必须用用户自有公开 Client ID 配合真实授权逐项确认。

真实 Google 尝试：用户提供公开 Client ID 后，在 Playwright 启动的 Edge 155 隔离环境发起授权。用户报告 Google 登录页拒绝：“此浏览器或应用可能不安全”。未完成授权；不能据此判断正常 Edge 不受支持，也不能确认具体拒绝原因。未验证 redirect_uri 被 Google 接受、无 secret 换码、refresh token 颁发及重启后刷新。已停止自动化测试，不隐藏自动化特征、不绕过检查。结果见 oauth-live-result.json。

下一步：在用户正常启动、非 Playwright 启动的浏览器中加载当前 PageClip，从设置页配置公开 Desktop Client ID 并发起交互授权。需逐项记录是否通过登录、同意、回调、换码和刷新。不要提供 secret 或令牌。官方文档支持 Desktop PKCE/loopback，并不等同于当前具体配置已验收。

自动化回归：本次修改后 28 个 test-*.mjs 通过。它们仅证明模拟逻辑；真实浏览器诊断结果见上表，两类证据不混同。同步协议、AES-GCM、设备密钥和 outbox 未重置。
