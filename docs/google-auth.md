# Google OAuth：原生认证与 Desktop PKCE 替代路径

## 根因与本次修正

上一轮 `js/google-auth.js` 的 `supportedIdentity()` 将 Brave、Edge、Firefox 拒绝为 native_unavailable，并且移除了全部替代路径。这是功能回退，不能作为跨浏览器修复。现在原生不可用会进入 `js/google-pkce.js`，使用单独配置的 Google Desktop app 公开 Client ID；不会使用现有 Web client ID 冒充 Desktop 客户端，不包含 client secret，不启用 implicit flow。

当前仓库仍是 Chromium Manifest V3，`background.service_worker`、side_panel 等不能直接视为 Firefox 可安装包。认证模块包含 Firefox 回调路径，但完整 Firefox 扩展移植/打包未完成。

## 官方约束与能力矩阵

参考：
- https://developers.google.com/identity/protocols/oauth2/native-app ：Desktop 公共客户端 PKCE、loopback、访问和刷新令牌。
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity ：Firefox 86+ 专用 `http://127.0.0.1/mozoauth2/<getRedirectURL 子域>` 回调，无需本地监听器。
- https://developer.chrome.com/docs/extensions/reference/api/identity ：原生令牌缓存及过期由浏览器管理；launchWebAuthFlow 的 chromiumapp.org 约束。
- https://developers.google.com/identity/oauth2/web/guides/use-code-model ：Web code model 的后端交换边界，不能把 Web client secret 放入扩展。

| 浏览器 | 实现路径 | 验证边界 |
|---|---|---|
| Chrome | 优先原生 getAuthToken；配置 Desktop ID 后可选 PKCE | 原生逻辑 mock 通过，真实账号未测试 |
| Brave / Ego / Edge | Desktop PKCE + 专用授权标签页，监听同一 tab 的 loopback URL | 仅代码及 mock；真实 Google 回调路径、错误页 URL 事件尚未验证 |
| Firefox | Desktop PKCE + identity.launchWebAuthFlow 的 mozoauth2 回调 | 官方 API 有依据；模块 mock 通过，当前 Manifest 尚未适配 Firefox |

**不能据此宣称所有浏览器已经可用。** Chromium 替代路径依赖 tab URL 事件观察 `http://127.0.0.1:43821/pageclip/oauth2`，不启动监听服务器。Google 对具体客户端的接受情况、浏览器是否在连接失败前/后提供回调 URL，必须真实验证。若不成立，需要研究对应浏览器受支持的回调机制或由用户选择本机辅助应用；不能用 Web secret 或 implicit 降级。

## 配置

1. 在自己的 Google Cloud 项目启用 Drive API，配置同意屏幕与测试用户。
2. 创建 **Desktop app** 类型 OAuth 客户端。
3. 在 PageClip 设置的双向同步卡片填写公开 Client ID 并保存。不要填写 secret；不要填写 Web application ID。
4. 点击连接。非原生 Chromium 路径打开专用 Google 授权标签页；完成后后台验证实际账号、密钥并恢复同步。
5. 第二台设备仍需相同恢复密钥和账号。不得删除 `_sync` 来处理授权错误。

代码不能仅凭 ID 字符串判断 Google Cloud 客户端类型。若 token endpoint 返回 invalid_client/unauthorized_client，停止并提示核对 Desktop 类型，不自动加入 secret。

## 生命周期与安全

- PKCE 使用 32 字节随机 verifier/state、SHA-256 S256 challenge、authorization_code 交换。
- 校验回调 origin、路径、state、code 唯一性，Chromium 额外绑定授权 tab ID。
- 待授权事务持久化，背景脚本恢复时尝试处理仍在标签页上的回调。授权码已经兑换但结果未落盘时不能保证恢复，需要重新授权。
- `pageclipGooglePkce` 保存访问令牌有效期、refresh token 和轮换结果。有效期前 60 秒刷新。单进程共享请求，Web Locks 跨上下文串行刷新。
- transient/429/5xx 保留刷新凭据；invalid_grant 清失效凭据并要求重新授权。不会自动反复弹窗。未获得 refresh token 时只有短期授权，过期后重新授权，不伪称长期续期。
- 不使用 prompt=none。真正续期仅指 refresh_token grant，或 Chrome 原生缓存管理。
- `chrome.storage.local` 设置 TRUSTED_CONTEXTS；凭据不进入业务导出或普通日志。存储不是硬件保险库，本机配置目录被攻破不在安全边界内。
- 同步会话验证实际 userinfo 邮箱与绑定账号；仍保留密钥指纹检查。失败不确认 outbox，不清业务数据。
- 断开清本机凭据，保留业务数据与云操作日志。Google 端撤销需用户在 Google 账号权限页面执行。

## 测试与尚未完成

新增 `scripts/test-google-pkce.mjs` 使用 mock token endpoint 验证 Firefox 首次回调、错误 state、S256、访问令牌有效期、刷新和 refresh token 轮换、断网保留、invalid_grant、重新授权、断开及 Chromium transport 选择。

本次执行 28 个测试脚本通过；同步引擎 16 场景；语法/JSON 103 文件、国际化 417 键通过。Mock 不证明真实跨浏览器认证完成。

待真实验收：各浏览器安装/Manifest 适配；Desktop ID 配置；授权及拒绝回调；Google token endpoint 无 secret 交换；真实 refresh token 颁发/轮换/撤销；后台中止、重启与回调补处理；授权失效期间新增数据在重授权后上传；错误账号/密钥拒绝。当前没有用户 Desktop client ID，也没有真实 Google 账号交互授权，因此这些仍是阻塞项。
