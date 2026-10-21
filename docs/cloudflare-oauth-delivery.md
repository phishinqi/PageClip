---
title: PageClip Worker OAuth 交付
subtitle: 代码与离线回归已落地，服务尚未部署
lang: zh
template: doc
---
## A 结论
发布者统一维护 Google Web OAuth 客户端。
client secret 只配置为 Worker Secret。
普通用户仅点击连接，不填写开发者凭据。
真实账号换码、刷新与浏览器验收仍未完成。

## B 授权与数据边界
```flow
扩展 -> Worker: 创建会话与随机证明
Worker -> Google: state、PKCE、固定 HTTPS 回调
Google -> Worker: 授权码
Worker -> 加密D1: 验证账号并保存刷新令牌
扩展 -> Worker: 持久证明领取与后台续期
Worker -> 扩展: JSON 短期访问令牌
扩展 -> Drive: 直接同步加密业务数据
```
Worker 不接收收藏、同步日志或恢复密钥。
完成页、URL 和应用日志不包含访问或刷新令牌。
回调授权码查询参数仍需部署层日志脱敏。

## C 文件与配置
| 路径 | 内容 |
| --- | --- |
| oauth-worker/src/worker.js | OAuth、领取、刷新、撤销、限流 |
| oauth-worker/migrations/0001_initial.sql | 会话、连接、撤销锁与限流表 |
| oauth-worker/wrangler.example.toml | 域名、D1、定时任务配置模板 |
| oauth-worker/README.md | Secrets、部署与安全边界 |
| js/google-worker-auth.js | 持久交接、续期、撤销恢复 |
| js/google-worker-config.js | 公开服务地址，默认未配置 |
| scripts/configure-worker-auth.mjs | 发布者地址与权限配置 |
| docs/cloudflare-oauth.md | 协议、配置与真实验收范围 |

Secrets 包含 Google client secret、AES 密钥和限流盐。
公开配置包含域名、client ID、扩展 Origin 白名单。
D1 保存加密 token 和凭据哈希，不保存原始设备凭据。

## D 恢复与撤销
| 情况 | 行为 |
| --- | --- |
| 领取响应丢失 | 相同证明重试；过期后用候选凭据恢复 |
| access token 到期 | Worker 使用加密 refresh token 续期 |
| Google 返回轮换 token | 保存新值；未返回则保留旧值 |
| refresh invalid_grant | 阻止继续取令牌，等待重新授权 |
| 用户断开 | 撤销账号应用授权，删除已知账号凭据 |
| 撤销网络失败 | 保留持久撤销任务，后台重试 |
| 仅连接备份 | 不自动启用双向同步 |

账号级撤销可能使其他设备需要重新连接。
认证失败不删除本地数据、密钥或 outbox。
Google 与 D1 之间不能保证跨系统原子事务。
极端轮换确认中断可能需要重新授权。

## E 实际测试与浏览器范围
| 项目 | 实际结果 |
| --- | --- |
| 扩展测试脚本 | 29 个通过 |
| Worker 实际 SQLite 与模拟 Google | 15 个测试通过 |
| 语法 / JSON | 114 个 JavaScript 文件通过 |
| 国际化 | 417 个键通过 |
| Edge / Ego | 已探测扩展请求 Origin，未完成真实 OAuth |
| Brave | 本机未实际运行 |
| Firefox | 未实测，当前扩展仍需平台移植 |
| Cloudflare 部署 / 真实 Google | 尚未执行 |

## F 发布前必要步骤
1. 配置发布者 HTTPS 域名。
2. 创建 Google Web 应用客户端。
3. 登记精确的 /oauth/callback 地址。
4. 在 Worker Secrets 设置机密。
5. 创建 D1 并应用迁移。
6. 配置精确扩展 Origin 白名单。
7. 部署 Worker 并配置扩展公开地址。
8. 验证真实换码、刷新、撤销和重启恢复。

Google 测试模式下刷新令牌可能七天过期。
正式发布也不承诺永久授权。
不要在聊天中提供 client secret 或刷新令牌。
