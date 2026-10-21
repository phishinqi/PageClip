# Google Drive 发布授权结论

## 产品要求

发布者统一维护 OAuth 应用和公开 Client ID；普通用户仅点击连接，不创建 Cloud 项目、不导入开发凭据。保留纯客户端、不分发/暴露 client_secret、不使用第三方认证服务器、不恢复 implicit 的约束。

## 当前证据

- 真实 Google Desktop 客户端已由控制台截图确认类型；用户实际登录与 loopback 返回 code 成功；换码明确要求 client_secret。refresh token 未取得。
- Edge 155 与 Ego lite 154 隔离扩展捕获 loopback URL 的诊断实测成功，但不是完整 OAuth 验收。Brave/Firefox 未实测。
- 原生 Chrome identity 是正式 API 路径；不能据此覆盖所有 Chromium 衍生浏览器，也未完成本项目真实账号验收。
- 官方 GIS Web 授权概览明确区分浏览器 access-token 模式和发送 code 到后端获取 refresh token 的模式：https://developers.google.com/identity/oauth2/web/guides/overview 。把 GIS token 模式改名为安全长期续期并不能解决要求。
- 官方 Desktop 文档说明公共客户端/PKCE，但本次具体无 secret 换码失败：https://developers.google.com/identity/protocols/oauth2/native-app 。不能用泛化推断否定实测。
- Google Python 库历史安装应用说明将 Desktop secret 描述为非保密配置，但该页也有已废弃 OOB 示例。它不是自动允许以该类型分发浏览器扩展的证明，也不是用户同意放宽约束：https://googleapis.github.io/google-api-python-client/docs/oauth-installed.html 。

## 已作代码修正

新增 js/google-auth-policy.js。开发版保留 Desktop 实验用于复现；scripts/package-release.ps1 在发布暂存目录将 desktopExperiment 改为 false 并校验。正式包隐藏普通用户的 Desktop ID 配置入口，并拒绝配置或启动该实验路径。即便本机残留实验配置，正式版也不进行失败授权。没有删除凭据、_sync、设备身份或业务数据。

没有浏览器被标记为已通过真实账号发布验收。该隔离不等于实现了非 Chrome 授权；它只防止把已知失败实验当成产品发布。

## 仍未解决的阻塞

目前没有证据证明存在同时满足“所有目标浏览器、Google Drive、可靠后台刷新、无后端、零 client_secret、禁止 implicit”的可发布路径。不能声称不存在任何可能，但当前不能交付为完成状态。

若要求继续实现可用产品，需要明确接受某项架构变化，并先验证：

1. 发布者自有、受控的最小 OAuth 服务：Web client secret 仅在服务端，成本、部署与安全需要单独决策；这违反当前无后端约束，尚未添加。
2. 发布者统一注册 Desktop 公共客户端、分发其客户端配置：先向 Google 核实扩展用例适用性；需要允许 client_secret 字段出现在公开客户端中，违反当前零字段约束，尚未添加。
3. 保持全部约束：将非 Chrome Google Drive 连接明确保留为未完成，不冒充已支持；同步引擎和本地功能继续可用。

以上均不将自建用户项目、换浏览器、implicit、第三方代理或 TV device-flow 类型冒充视为已完成方案。
