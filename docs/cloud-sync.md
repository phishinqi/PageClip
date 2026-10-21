> 授权更新：本页原生-only 描述已被后续 Desktop PKCE 实现修正。最新实现、浏览器限制和真实验收阻塞以 [Google 授权说明](google-auth.md) 为准；尚未证明所有浏览器可用。

# PageClip 双向云同步（协议 v1）

## 实现范围与运行环境

PageClip 是无构建步骤的原生 JavaScript Chrome Manifest V3 扩展（最低 Chrome 114）。业务数据保存在 `chrome.storage.local.bc_data`（schema 3）；写入通过现有 Web Locks 存储事务串行化。后台是可被随时终止的 service worker，不依靠页面计时器维持同步。

第一阶段仅支持 **Google Drive appDataFolder**，使用统一的原生 Google 认证管理器 `js/google-auth.js`、AES-GCM 加密和 IndexedDB 设备密钥。无需自建服务器，也没有新增订阅服务；需要 Google 账号、Drive 可用配额及正确配置的 OAuth 客户端。Drive 配额、OAuth 发布审核和服务条款仍适用。

同步范围：收藏 `items`、用户文件夹 `folders`、快捷访问 `quickAccess`、收件箱 `inbox`、网址标签 `urlTags` 和标签规则 `settings.tagRules`。系统“未分类”文件夹由客户端生成。Chrome 原生书签树、Chrome bookmark ID、回收站、AI 凭据、界面偏好、云授权设置不跨设备同步。同步删除不直接调用另一设备的 Chrome 书签删除 API。

## 架构和数据流

```text
本地业务修改 → Web Lock → bc_data + _sync.outbox 原子保存
                                  ↓ storage 事件
                   chrome.alarms / 启动 / 手动同步
                                  ↓
          sync-runtime → sync-model（因果合并、冲突、关系修复）
                 ↓               ↑
          DriveSyncAdapter → 加密不可变操作文件 → Drive appDataFolder
```

- `js/store.js`：原有本地存储；参与同步后在同一次保存中捕获业务差异。未参与同步时不创建历史日志。导出不携带同步身份，导入不会覆盖现有同步状态。
- `js/sync-model.js`：供应商无关的投影、规范 JSON 比较、因果 DAG、tombstone、冲突及物化视图。
- `js/google-auth.js`：统一原生 Google 授权和持久化授权状态（不持久化 access token）；`js/cloud-backup.js` 的 `getToken`、`clearToken`、`getAuthenticatedAccount`、`connectGoogle` 委托给该管理器，备份与同步共用认证边界。
- `js/sync-drive.js`：分页列表、读取、幂等追加、20 秒请求/响应体截止时间、401 单次静默重取令牌、错误分类和 Retry-After。构造器支持注入 HTTP、认证及加解密 codec。
- `js/sync-runtime.js`：持久队列、下载检查点、账号/密钥绑定、上传确认、退避和后台消息。
- `background.js`：启动、安装、alarm、本地修改事件；同步消息仅接受本扩展设置页/侧栏。
- `js/sync-settings.js`、`options.html`：沿用设置卡片样式；连接、暂停、手动同步、状态、冲突查看/选择/导出。页面轮询仅更新显示，不承担后台任务。

## 协议、身份与并发

本地 `_sync` 含 `protocol`、设备 UUID、单调 `sequence`、`ops`、`outbox`、规范化 `view`、`conflicts`、已验证远端文件 `files`、下载暂存 `downloads`、绑定账号/密钥指纹、重试状态和最后成功时间。对象沿用现有稳定 ID，不使用名称或数组位置；新业务对象由现有 UUID 生成机制分配。网址标签以完整 URL 为自然键，规则使用固定逻辑键 `rules/default`。

每个操作示例（加密前）：

```json
{"protocol":1,"id":"operation-uuid","device":"device-uuid","sequence":12,"key":"items/object-uuid","parents":["base-operation-uuid"],"value":{"id":"object-uuid","title":"Example","url":"https://example.com"},"modifiedAt":1700000000000}
```

`value: null` 是删除标记。`modifiedAt` 只展示，不决定胜负。`parents` 是本次修改基于的版本，取代服务器可变 revision/ETag；规范内容比较忽略 JSON 属性顺序及设备书签关联。没有用设备时钟实现最后写入胜出。

远端文件名为 `PageClip-sync-v1-<operation-id>.json`，内容是已有 AES-GCM device-key 密文包，业务操作位于解密包的 `syncOperation`。每文件用一次 multipart 请求同时提交元数据与内容，不需要另一个可变 manifest。Drive 分页文件列表就是索引，避免“对象成功、索引写入失败”的双写漏洞；零字节遗留文件跳过，父版本缺失时不导入、不确认成功，等待下次完整校准。

Drive 不保证文件名唯一。追加前按操作 ID 文件名定位并解密比较内容；成功后崩溃未确认，重试发现相同操作后仅补确认。极端并行发布可留下相同操作的重复物理文件，模型按 ID 去重，不产生重复业务对象。相同 ID 不同内容、未来协议、非法 URL 或循环依赖会停止自动同步，而非覆盖原数据。

## 双向同步与一致性边界

1. 捕获当前本地差异，队列与数据一起持久保存。
2. 验证实际令牌所属账号及密钥指纹；分页取远端列表。
3. 跳过已处理文件，最多 4 个并发下载，每批检查后持久暂存；worker 中止后复用已下载批次。
4. 验证完整依赖图后，在存储事务中合并和物化，再确认远端文件。远端变更不回声上传。
5. 按因果顺序上传最多 100 个操作，每 20 个持久确认；只有远端确认才移出 outbox。剩余操作由 alarm 续跑。
6. 清空本次错误和退避；仅在无待上传、无冲突时更新最近成功时间。同步成功表示已观察到的远端快照和已捕获本地修改完成，不保证之后其他设备没有新写入。

不变对象不上传；已验证远端文件不重复下载。列表仍需分页全量校准，未使用 Drive Changes API。下载/上传失败不会回滚已保存的用户修改。恢复暂存、重试写入和重复导入均通过稳定操作 ID 去重。

## 冲突、删除及恢复

同一对象多个不同内容的因果末端形成冲突，保留两边操作；本设备原视图暂时保留，不按时间覆盖。界面展示完整版本、设备和时间；明确选择后创建同时引用所有分支的新版本。可先导出未加密冲突 JSON 留档（界面有隐私提示）。这不是自动字段级合并，也没有自动生成重名副本。

跨对象结构冲突（并发移动形成文件夹环、文件夹删除与另一设备新增子项）创建确定性的安全替代分支：文件夹回到根、收藏回到未分类；原关系保留成可见冲突，不悄悄丢失子项。选择失效关系仍可能需要再次处理，建议选择安全关系后再移动到有效目录。

**删除标记与历史不自动清理，保守无限保留。** 当前没有设备注册、离线设备水位证明，因此不能安全按天数清理。恢复原 ID 是 tombstone 后的新因果版本，重新导入已有 ID 会捕获成新修改而非篡改同步身份。不同 ID 的相似内容不保证语义去重。

已有云备份恢复和恢复密钥导入入口保持可用。本地恢复的数据通过同一保存路径排队。新设备必须先导入同一恢复密钥；已验证参与的设备禁止替换成不同密钥，防止混合密钥日志。未成功参与的设备可暂停后修正密钥再连接。没有自动密钥轮换或跨账号迁移；不要手工删除 `_sync` 来切账号或重置日志。

## 授权、安全与配置

1. Google Cloud 项目启用 Drive API；配置与扩展固定 ID 相符的 Chrome Extension OAuth 客户端。原生认证使用 `manifest.json` 的公开 client ID。权限为 `drive.appdata`、`openid`、`userinfo.email`；邮箱权限用于验证真实 token 账号，不能用浏览器个人资料代替。
2. 仅使用浏览器原生 `chrome.identity.getAuthToken`；无已验证原生 Google 能力的 Brave、Ego、Firefox、Edge 按不支持处理，fail closed，不回退网页 implicit flow，也不假定支持 PKCE。**这是兼容性回退**：此前依靠网页授权的设备不再能连接云备份/同步，本地功能和数据保留。公开 client ID 不是秘密；扩展不包含 client secret，也不新增后端。完整浏览器矩阵、官方依据及配置见 [Google 授权说明](google-auth.md)。
3. 第一台设备在设置中导出恢复密钥并安全保存，再连接双向同步；第二台设备在启用前导入相同密钥，连接同一 Google 账号。连接会上传本地已有业务数据，也会合并远端，不清空本地。
4. 新增 `unlimitedStorage` 防止同步历史受到默认扩展存储配额限制；它不是无限磁盘，仍需监控磁盘容量。已有 host 权限没有扩大。
5. 统一管理器只持久化授权状态，不在扩展存储中保存 access token、refresh token 或 client secret；历史版本的令牌缓存不再作为授权来源。不得让内容脚本获得存储访问。初始化设置 `chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})`。密钥沿用现有 IndexedDB 存储，非操作系统硬件密钥库；拥有本机配置目录或扩展执行权限的攻击者不在安全边界内。

Chrome `identity.getAuthToken` 的缓存、获取和续期由浏览器负责；API 不报告可靠的 `expiresAt`，管理器不伪造到期时间，每次需要令牌时调用该 API。Drive 返回 401 时仅移除被拒绝的 token，再静默获取并重试一次；再次失败即停止，不无限重试。持久化“已连接”状态不是令牌有效性证明。后台任务始终使用无交互授权；会话、同意或浏览器登录失效则暂停并要求用户在设置页重新连接。

Google 原生应用文档支持 Desktop 应用的 PKCE 配合 loopback listener/custom URI，但明确不支持 Chrome apps 的 custom URI；MV3 扩展不能监听 TCP 来接收 loopback 回调。Web GIS code-model 文档要求后端兑换授权码，不能在扩展中嵌入 Web client secret 替代后端。本项目不新增后端，不把这些流程描述为已实现的扩展 PKCE，也不承诺 refresh-token 轮换或永久登录。

每个实际同步会话/新 token 都验证 userinfo 邮箱与绑定账号一致，账号错配或邮箱无法验证则 fail closed。已验证密钥指纹绑定同步空间，防止缓存掩盖换钥。暂停保留授权/队列；在现有备份卡片退出账号会清授权并暂停双向同步，不删除本地业务或云日志。

## 调度与故障策略

启动检查；本地修改安排约 10 秒后 alarm（连续修改不无限推迟）；每 15 分钟远端校准；授权后立即同步；设置页收到 online 事件后请求恢复。没有打开页面时依靠 alarm 发现网络恢复，不声称 MV3 离线期间有持续网络监视器。

网络/超时/408/429/5xx/Drive 限流使用从 30 秒起、50%–100% 抖动、最多 6 小时的退避，并遵守更长 Retry-After。自动任务不绕过退避；手动同步是用户主动重试。网络故障可长期以封顶间隔继续恢复；权限、认证和格式问题停止无意义自动重试，保留明确状态，待人工处理。没有自动删除坏文件。

## 验证与限制

自动化命令：`node scripts/test-sync-engine.mjs`、`node scripts/test-sync-drive.mjs`、`node scripts/test-oauth.mjs`、`node scripts/test-cloud-backup.mjs`；完整回归执行所有 `scripts/test-*.mjs`。另执行 `powershell -ExecutionPolicy Bypass -File scripts/check-syntax.ps1` 和 `scripts/check-i18n.ps1`。项目无需编译，发布脚本自动带上整个 `js/`。

历史同步实现曾记录：27 个 `scripts/test-*.mjs` 脚本全部通过；同步引擎 15 个场景通过；语法/JSON 检查通过（100 个 JavaScript 文件）；国际化检查通过（417 个键）。这些是此前版本的结果，不是本次原生 OAuth 迁移的验收；本次仅更新文档，未运行测试。`git -c core.whitespace=cr-at-eol diff --check` 通过；普通 diff 检查会将仓库现有 CRLF 行尾报告为尾随空白。

核心测试涵盖首次导入/新增、独立修改、同时修改、离线 tombstone、恢复、重复操作、重启 outbox、远端成功本地确认失败、下载检查点、部分日志缺父版本、时钟偏差、3,000 对象、并发循环和上传中本地编辑、结构冲突。Drive mock HTTP 测试覆盖分页、multipart、去重、401、超时、限流、权限和格式；历史 OAuth 测试涉及失效、静默获取、重启缓存、拒绝授权及并发请求，以及真实 token 所属账号 fail-closed 的 mock 回归；其中旧网页回退/缓存场景不代表新管理器的支持范围。原生迁移仍需重新执行适配后的回归和 [手动 QA 清单](google-auth.md#手动-qa-清单待执行)。

**未使用真实 Google 凭据验证多设备端到端、真实限流、实际 OAuth 控制台设置、浏览器关闭/OS 重启及真实密钥丢失恢复。** mock 协议测试不能替代真实账号验收，也没有声称真实 refresh-token 流程通过。

长期局限：不可变日志/删除标记线性增长；没有安全压缩协议，初次下载和本地 bc_data 整体序列化成本随历史增长。批量确认、增量物化与 unlimitedStorage 缓解但不消除无限历史问题。单个超大对象、长时间首次导入可能超过 MV3 生命周期，后续 alarm 检查点可恢复；不提供无限规模 SLA。没有数据大小/磁盘配额可视化、自动历史归档、远端日志损坏修复按钮、端到端浏览器 UI 回归或同步文案完整双语化。这些限制意味着上线前仍需真实账号压力与长跑测试，不能把当前实现称为已完成生产长期稳定性证明。
