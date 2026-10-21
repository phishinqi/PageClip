# Desktop 客户端密钥语义与本次真实结果

## 已确认

用户提供 Google 控制台截图确认 Client ID 类型为“桌面设备”。正常浏览器登录后 Google 返回 loopback code；扩展换码得到经本地分类的 client_secret_required。没有取得 refresh token，也没有完成刷新验证。不是 Web client 类型配错，不能要求用户反复新建或登录。

## 官方依据的边界

- https://developers.google.com/identity/protocols/oauth2/native-app ：Desktop 是不能保密的公共客户端，推荐 PKCE；不能据此断言每个客户端都允许省略名为 client_secret 的字段。
- https://googleapis.github.io/google-api-python-client/docs/oauth-installed.html ：Google 官方客户端库文档明确说 installed-app client secret 在此语境不被当作真正秘密；同时建议下载配置放在源码树之外，不公开客户端配置。该页还包含已废弃的 OOB 示例，仅引用凭据语义，不采纳其旧授权流程。

“不是保密凭据”不代表可以擅自改变用户禁止在扩展中放置 client secret 的约束。纯扩展不能让本机配置对扩展执行权限或本机配置目录攻击者保密。PKCE 保护授权码交换，refresh token 仍然是真实敏感凭据。

## 当前代码处理

js/google-pkce.js 遇到已持久记录的 client_secret_required 后停止重复打开同一无 secret 流程。没有加入 client_secret，没有改 implicit flow，没有重置设备、队列、业务数据或远端历史。

## 需要明确决策

若用户允许仅在本机导入其自有 Desktop 配置（不硬编码、不入仓库、不随扩展分发），可实现本机配置入口，继续真实换码和刷新测试。这仍然意味着扩展读取并发送 client_secret 字段，不符合“扩展绝不接触任何 client_secret”的严格解释，必须先获明确同意。

若坚持零 client_secret，则当前客户端已实测不能完成目标流程，不能假装有可用修复。需要证明另一个受支持的客户端流程确实省略该字段；尚无可交付证据。自建认证服务器、第三方代理、退回 implicit、设备流冒充 TV 类型、绕过 Google 检查均不是本次允许的替代方案。
