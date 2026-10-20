# PageClip（Chrome 扩展）

### AI 默认网关与模型选择

AI 设置默认填入本机 Magpie 网关 `http://127.0.0.1:3425/v1`，不会覆盖已保存的自定义地址。点击「获取可用模型」读取当前网关的 `/models` 列表，然后下拉选择并保存；也可手动填写模型 ID。获取模型不发送书签、不要求先选模型。默认 Magpie 地址在密钥留空时使用其占位认证值；切换到其他服务商时不会自动沿用旧地址的密钥。网关未启动、列表接口不兼容或请求失败时仍可手动输入模型名。


在浏览器侧边栏中浏览、搜索、**完整管理** Chrome 自带书签，同时拥有一套独立的收藏体系（标签 / 备注 / 文件夹 / 置顶 / 时间）。纯原生 JS（Manifest V3），无需构建，加载即用。

## 1.8.0 更新说明

- 新增 AI 整理：先分析、预览，再确认应用分类与标签；支持保持原样、取消、失败重试与字段级撤销。
- 真实进度卡显示成功、失败、待处理、本批条数、等待时间和基于实际吞吐的剩余时间；预览编辑不会被进度刷新打断。
- 用户确认后本地持久去重，默认跳过已整理项；内容变化重新待整理，也可主动包含已整理项重跑。
- 新增默认关闭的本地隐私词表脱敏和主题类目化，仅处理发送副本；规则随任务冻结，请求可预览，原收藏保持不变。
- AI 设置支持默认本机网关、获取模型列表和自定义服务；补齐模型、事务、服务、设置页和浏览器 UI 回归覆盖。
- 发布包已包含 AI 整理页面和全部运行模块。自动验证使用 mock 请求，未进行真实上游 API 或嵌入质量验证。

## 1.7.2 更新说明

- 设置卡片统一使用等宽单列布局，不再交错显示半宽和整行卡片；概览的 8 项统计在桌面端采用 4 列、窄屏采用 2 列。
- 修复设置页脚本加载失败导致只显示标题的问题，补齐中英文设置文案，避免出现内部翻译键名。
- 增加设置页语法和双语文案回归检查，发布前按 ES 模块模式校验脚本。

## 1.7.1 更新说明

- 设置页改为带分类导航和搜索的紧凑工作台，新增 About 信息区，集中展示版本、项目链接、隐私和权限说明。
- 域名标签规则支持逐条选择“仅此主机”或“包含所有子域名”；旧规则继续按包含子域名处理。

## 1.7.0 更新说明

- 批量编辑标签：「收藏」和「Chrome 书签」的选择工具栏、多选右键菜单、文件夹右键菜单都能打开批量编辑窗口，一次完成添加、移除、补齐和整体替换；每条书签最多 12 个标签，超出的跳过并提示；完成后可以撤销。
- 搜索结果批量加标签：全局搜索结果可以多选（Ctrl 切换、Shift 连选、全选），选择工具栏的「标签」按钮对收藏和 Chrome 书签一起批量编辑；Chrome 书签搜索结果不再限制为 50 条。
- Chrome 书签也能加标签：标签保存在 PageClip 数据里，按网址与收藏共享，不写进 Chrome 书签。书签行会显示标签，点击标签即搜索 `#标签`；全局搜索的 `#标签` 同时过滤收藏和 Chrome 书签。
- 全局标签管理：设置页新增「标签管理」，「收藏」顶部标签条右键也能改名、合并、删除标签；执行前会确认影响范围，完成后可以撤销，规则里的同名标签会一起更新。
- 标签规则：按域名（含子域名）、标题或网址关键词、所在文件夹（最近一层）自动加标签。新增书签时自动执行，也可以在设置里对现有书签手动执行；规则只加不删，移动书签不会触发。
- 域名标签规则可逐条选择“仅此主机”或“包含所有子域名”；未指定范围的旧规则继续按包含子域名处理。
- 修复：多选收藏后拖到左侧文件夹，现在会移动全部选中项；提示框里的「撤销」按钮现在可以点击；编辑窗口中点击「标签」文字不会再误删第一个标签。

## 1.6.13 更新说明

- 收藏和 Chrome 书签列表新增多选删除；Chrome 书签列表支持选择模式和批量操作。
- 删除 PageClip 收藏或收藏文件夹时，会按完整 URL 清理当前浏览器中匹配的 Chrome 书签（包括重复项和旧导入数据）；如果 Chrome 清理失败，会保留 PageClip 收藏供重试。此操作会影响浏览器同步的书签，确认删除前请留意。

## 1.6.12 更新说明

- Google Drive 自动备份遇到需要重新授权时会暂停，并仅发送一条通知引导用户到设置页重新连接，避免后台反复失败或弹出意外登录窗口。
- Brave 会在有效期内本机复用短期 Web OAuth Access Token；不会保存 Google Refresh Token 或 OAuth client secret。

## 1.6.10 更新说明

- 自动备份改为数据变更驱动：用户启用后，PageClip 内容变更约 10 秒后会执行一次加密 Google Drive 备份，连续修改会合并处理。
- 自动 Chrome 书签导入开关现在严格控制后台工作；新增、修改、移动、删除及导入完成事件都会触发一次只增不减的合并检查。

## 1.6.9 更新说明

- 新增可选的 Chrome 书签自动导入、导入状态和故障重试。
- 通过跨扩展上下文的存储写入锁，避免并发保存导致数据丢失。

## 1.6.8 更新说明

- 修复 Chrome 书签长文件夹展开后内容被裁切的问题；长目录按层级自动分批加载。
- 修复 Brave Web OAuth 重复授权时可能同时打开多个认证流程的问题。

## 1.6.7 更新说明

- 切换到新的 Chrome Extension OAuth Client，并同步固定 Extension ID。

## 1.6.6 更新说明

- 更新 Chrome Extension OAuth Client ID，保持固定 Extension ID 的 Google Drive 授权配置一致。

## 1.6.5 热修说明

- 修复收藏编辑窗口在已有标签或新增标签时可能触发 `Failed to execute 'insertBefore' on 'Node'` 的崩溃。
- 保留 Enter、英文逗号、中文逗号添加标签，以及标签删除、去重和最多 12 个标签限制。

## 安装（加载已解压的扩展程序）

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录（包含 `manifest.json` 的文件夹）
4. 点击工具栏中的 PageClip Logo 即可打开 / 关闭侧边栏
5. 在普通网页中，点击页面边缘的 PageClip 胶囊可打开 / 关闭网页侧栏；右键胶囊可打开 PageClip 页面操作菜单

> Chrome 114+ 使用原生 Side Panel；Brave 等未提供 `chrome.sidePanel` 的 Chromium 浏览器会在点击扩展图标时打开独立的 PageClip 管理页。v1.2.2 起，普通 `http/https` 网页还会注入一个 Shadow DOM + iframe 网页侧栏，可用 `Ctrl+Shift+P` 或页面右侧 PageClip 胶囊打开；打开后可点击 PageClip 顶栏的关闭图标或按 `Escape` 收起。

## 功能速览

| 区域 | 说明 |
| --- | --- |
| 收藏当前页 | 点击侧边栏右上角 **＋**，或全局快捷键 **Ctrl+Shift+S**（可在 `chrome://extensions/shortcuts` 修改）；静默保存到「未分类」，不打断浏览 |
| 收藏页签 | 插件自建收藏：标签、备注、嵌套文件夹、时间记录、置顶；文件夹可单击或按 Space 展开/收起，点击条目选中，双击在新标签页打开；多选或右键文件夹可批量编辑标签，右键顶部标签可全局改名 / 合并 / 删除 |
| 快捷页签 | 单页快捷访问 + 当前窗口多标签页集合快照；可置顶、删除、拖拽排序、恢复到当前窗口 |
| Inbox 页签 | PageClip 临时暂存：完成阅读后立即移除；同时可按需同步 Chrome Reading List（Chrome Reading List 标记已读但保留） |
| Chrome 书签页签 | 浏览器书签全功能管理：新建书签 / 文件夹、重命名、改网址、删除、移动（拖拽或「移动到…」），与 Chrome 自带管理器实时同步；可给书签加标签（只保存在 PageClip，按网址与收藏共享） |
| 全局搜索 | 顶部搜索框同时搜永久收藏、快捷收藏、Inbox 和 Chrome 书签；结果分组显示、关键字高亮；输入 `#标签名` 可按标签过滤收藏和 Chrome 书签；结果可多选后批量编辑标签 |
| 拖拽 | 条目拖到文件夹上移动；拖到条目上/下边缘插入排序；文件夹可互相嵌套（禁止移入自身子文件夹） |
| 排序 | 收藏列表支持「按时间」/「手动排序」（拖拽后自动切换）两种模式，置顶条目始终在前 |
| AI 设置（可选） | 自选 OpenAI 兼容服务商、API 根地址与模型；可选本机持久保存密钥、手动连接测试与清除密钥；中英文文案，支持设置搜索 |
| 设置 ⚙ | 分类导航和搜索、等宽单列设置卡片、收藏统计、JSON / HTML / CSV 导入导出、可选的自动 Chrome 书签导入、标签管理与标签规则、Google Drive 加密云备份、自动备份、备份历史、回收站与快捷键说明 |

## AI 设置（可选）

设置页的「AI 设置 / AI settings」分类支持配置自选的 OpenAI 兼容服务商，无需依赖或构建：

1. 填写 **Base URL**（API 根地址，例如 `https://api.example.com/v1`，不要填写完整的聊天接口路径）和模型 ID。
2. 按需输入 API 密钥并点击「保存 AI 设置」。密钥留空会保留已保存的密钥；页面只显示是否已保存，绝不读取或回显已存密钥。
3. 点击「测试已保存的连接」可手动验证。请先保存修改；测试只使用已保存配置，发送极小请求，可能产生少量费用，**不发送任何书签**。
4. 不再需要时点击「清除已存 API 密钥」。此操作只清除密钥，保留地址和模型。

保存配置本身不会发送书签或自动启用后台 AI 调用。AI 是主动选择的功能；主动使用 AI 时，书签元数据（例如标题、网址和已有标签）会发送给你选择的服务商，其数据处理受该服务商隐私政策约束。标签按网址在 PageClip 收藏和 Chrome 书签间共享。

**English:** Optional AI settings support your own OpenAI-compatible API root (including `/v1`), model, and API key. Save before testing; a blank key preserves the saved key. Connection tests are manual, may incur a small charge, and send no bookmarks. Explicit AI use sends bookmark metadata to your selected provider. The saved key is never fetched or displayed by the settings page; use “Clear saved API key” to remove it.

AI 整理继续采用「分析 → 预览 → 确认整理并应用所选修改」。进度卡只统计实际处理结果，分别显示成功、失败、待处理、实际批次大小及等待时间；首批完成后按本轮吞吐估算剩余时间。100% 表示已处理，失败项仍可重试。完成确认后保留只读摘要，确认保持原样也能标记完成。

确认记录独立保存在本机 `pageclip_ai_confirmations`，与数据及撤销记录在数据锁内一起提交。默认排除内容指纹匹配的已确认收藏，可选择「包含已整理」主动重跑；标题、完整 URL、备注、分类或有效共享标签变化会重新进入待整理，排序与更新时间不影响确认。分析成功本身不代表完成。撤销会同时恢复该操作的确认记录，并跳过后来改动或重新确认的状态。

AI 设置还提供默认关闭的本地敏感词脱敏。每行一词，最多 500 词、每词 100 字符；词表仅留在当前浏览器，不参与同步、导出和模型请求。任务启动时冻结规则，文本发送副本采用字面匹配、忽略英文大小写、长词优先并使用稳定的 `[已脱敏_1]` 占位符；URL 先移除登录信息、查询参数和片段，仍命中则整字段脱敏。批次按脱敏后的实际字节数限制，折叠预览不显示原词对照。含占位符的新增分类、标签或理由须人工修正或明确保持原样，避免占位符落库。原收藏、ID、配置、密钥与原始冲突快照不参与替换。

**English:** Organization uses analysis, editable preview, and explicit confirmation. Progress counts actual results, with separate failures and retry controls. Confirmations persist locally by bookmark ID and content fingerprint; unchanged confirmed items are skipped by default, while edits make them eligible again. Confirming unchanged items and guarded undo are supported. Optional local redaction is off by default, uses only your word list (500 terms, 100 characters each), freezes rules per task, and sends neutral placeholders in text values. Rules are never sent or synced. Requests are batched using their redacted byte size, and placeholder-bearing suggestions need correction or an explicit choice to keep the bookmark unchanged.

本地主题类目化是独立的默认关闭选项（AI 设置 → 本地主题类目化），与隐私占位符脱敏分别控制。启用后先按软件、游戏、二进制、App、网络等上下文把主题短语归一到类目，再执行用户的隐私词表。例如 `Android逆向教程` → `Android程序分析教程`，`iOS逆向工程笔记` → `iOS程序分析笔记`，`XX游戏鉴权缺陷验证热补丁 PoC下载` → `XX游戏授权机制分析补丁下载`；对象名、平台、教程/笔记/补丁/下载/源码等资源信号保留，`逆向思维` 保持原意。规则表在 `js/ai-topics.js`，按上下文选择程序分析、二进制分析、授权机制分析、软件修改研究或运行时分析等类目；同样的输入和上下文产生相同结果，不调用模型判断。

已类目化条目在请求中附带 `topicHints: { platforms, topics, resourceTypes }`，标题就是处理后的发送副本，不另发原始标题或映射字典。结构化提示也经过隐私词表脱敏。URL、ID、关联关系和原始分析快照保持原有语义；预算按最终请求字节计算。任务冻结本机 `pageclip_ai_topics` 的版本和开关，旧任务默认关闭该功能；请求预览显示本批处理条目、替换次数和命中字段。确认与撤销仍使用原收藏快照，模型产生的新类目须按原有流程人工预览确认。

**English:** Optional local topic categorization preserves platform/product/resource signals and adds `topicHints` to the outgoing bookmark copy. Technical context selects neutral categories; ordinary expressions such as reverse thinking remain unchanged. Privacy word redaction runs after categorization, including hint values. Rules are local, versioned, frozen per task and off by default. Original bookmarks and conflict snapshots remain intact.

离线质量评估可运行 `node scripts/ai-topic-metrics.mjs <本地评估文件.json>`。输入是非空数组，每条包含 `category`、同一嵌入模型生成的 `originalEmbedding` / `normalizedEmbedding`，以及使用相同聚类流程得到的 `originalCluster` / `normalizedCluster`。脚本只读取本地向量和标签，输出整体与各类目的平均/最低余弦相似度、ARI 和采用算术平均熵归一化的 NMI。先检查相似度较低的类目，再调整本地规则；ARI/NMI 衡量前后分组的一致程度，不能单独证明分类正确。当前测试只验证规则、请求边界和使用合成向量的指标公式，未生成真实嵌入或测量真实聚类质量。

## 数据与隐私

- 插件收藏默认保存在本机浏览器（`chrome.storage.local`）；Google Drive 云备份支持手动触发，或在用户启用后于 PageClip 数据变更约 10 秒后自动触发，上传前使用客户端 AES-GCM 加密，云端仅保存密文；自动备份默认使用本机密钥。备份密码不保存，启用本机密钥模式时请另行保管加密恢复密钥。恢复密钥现在导出为加密二进制 `.pckey` 文件；二进制只隐藏文件结构，安全性仍由恢复密钥密码、PBKDF2 和 AES-GCM 提供。旧版 JSON 恢复密钥仍可导入。
- 「Chrome 书签」页签的所有操作直接作用于浏览器书签，与 Chrome 同步机制一致。设置中的浏览器书签导入（手动或用户启用的自动导入）会将可用条目复制到 PageClip；Chrome 中的删除、移动和编辑不会删除或覆盖 PageClip 副本，而删除 PageClip 收藏（包括文件夹内条目）时，会按完整 URL 删除当前浏览器中所有匹配的 Chrome 书签，包含未通过导入建立关联的重复项；若清理失败，PageClip 条目会保留以供重试。重复 URL 在整个 PageClip 收藏中仅保留一条，复制后的条目会随常规 JSON 导出和已启用的加密云备份处理。
- AI 配置使用独立的本机存储项 `pageclip_ai_config`。选择保存 API 密钥即选择在当前浏览器中持久保存；密钥不包含在 JSON / HTML / CSV 导出或 Google Drive 云备份中，不通过 Chrome 同步。该本机存储不是加密密钥保险库；不再需要时请在 AI 设置中清除。密钥仅用于向用户选择的 AI 服务商认证，不会发送到 PageClip 云端。AI 调用是可选的，普通收藏与标签规则仍在本机运行。
- 给 Chrome 书签加的标签只保存在 PageClip 数据（`chrome.storage.local`）里，按网址与收藏共享，不会写入 Chrome 书签，因此不会随 Chrome 同步到其他设备；这些标签包含在 JSON 导出和加密云备份中。同一网址的多个 Chrome 书签共用一组标签；在 PageClip 里改书签网址时标签会跟过去，在 Chrome 自带的书签管理器里改网址则不会。标签规则只在本机运行。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `bookmarks` | 读取与管理 Chrome 书签 |
| `storage` | 保存插件收藏数据 |
| `tabs` | 读取当前标签页地址 / 标题以实现一键收藏、在当前页打开链接 |
| `favicon` | 显示网站图标（加载失败时回退为域名首字母色块） |
| `contextMenus` | 在网页/标签页右键菜单中加入快捷收藏、Inbox 和 Reading List 入口 |
| `tabGroups` | 读取快捷标签集合中的标签组信息 |
| `readingList`（可选） | 首次同步 Chrome Reading List 时动态申请；拒绝后 PageClip Inbox 仍可独立使用 |
| `scripting` | 在当前普通网页中补充注入网页侧栏入口 |

## 页面胶囊右键菜单

在普通网页中右键 PageClip 胶囊，可以执行：永久收藏当前页、加入快捷收藏夹、加入 Inbox、同步 Chrome Reading List、复制页面 URL、打开 PageClip 管理页、打开设置，以及打开/关闭网页侧栏。工具栏 Logo 的右键菜单仍由 Chrome/Brave 浏览器管理。

## 快捷键

- `Ctrl+Shift+P`：打开/关闭网页内嵌侧栏
- `Ctrl+Shift+S`：永久收藏当前页面
- `Ctrl+Shift+Q`：加入快捷收藏夹
- `Ctrl+Shift+R`：加入 PageClip Inbox

## 常见问题

- **快捷键没反应？** 可能与其他软件 / 扩展冲突，到 `chrome://extensions/shortcuts` 重新设置。
- **`chrome://` 等系统页能收藏吗？** 插件收藏仅支持 http/https/file 页面；这类页面按快捷键会显示红色 `!` 角标提示。
- **重复收藏同一网址？** 不会产生重复条目，只会更新收藏时间与标题。
- **自动导入会同步删除或修改吗？** 自动导入本身不会。它是设置中可选的添加式导入：Chrome 新增书签后 PageClip 会合并复制，Chrome 的删除、移动、重命名和改网址均不会改动 PageClip；删除通过 Chrome 导入的 PageClip 收藏时，应用会按保存的 Chrome 书签 ID 删除对应书签。
- **标签规则会删掉标签吗？** 不会。规则只在新增书签时（或在设置里手动执行时）添加标签，从不删除；移动书签不会触发规则。想批量去掉标签，可以用批量编辑或「标签管理」。

## Google Drive OAuth 配置

Google Drive 备份在 Chrome 使用 `chrome.identity.getAuthToken()`，在 Brave 回退到 `chrome.identity.launchWebAuthFlow()`；不要把 Desktop/Native App 的 custom URI 流程直接交给 Chrome 的 `getAuthToken()`。首次配置时：

1. 先在 `chrome://extensions` 加载本目录，复制页面显示的 **Extension ID**。当前仓库的固定 `key` 对应 ID 为 `mnapcpmijebakicgdflohgnjmndhlneg`。
2. 在 Google Cloud 的 OAuth Client 页面创建 **Chrome Extension** 类型 client。
3. 将上一步的 Extension ID 填入 **Item ID**，启用 Google Drive API，并将生成的 client ID 填入 `manifest.json` 的 `oauth2.client_id`。
4. 修改 `manifest.json` 后，在 `chrome://extensions` 点击 PageClip 的「重新加载」，再回到设置页连接 Google。

如果 Chrome 报错 `Custom URI scheme is not supported on Chrome apps` 或错误 400 `invalid_request`，先确认扩展 ID 和 Chrome Extension Client 的 Item ID。Chrome 正常、Brave 失败时，这是 Brave 的 `getAuthToken()` 兼容问题；PageClip 会回退到 Web OAuth 流程。Brave 使用的 Web OAuth Client（与 `manifest.json` 的 Chrome Extension Client 不同）必须额外允许回调地址 `https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/`。

自动备份只会在 PageClip 内容变更约 10 秒后执行，并且始终使用无交互授权；它不会也不能在后台弹出 Google 登录或同意权限页面。Brave 会在 Access Token 尚未到期时短暂地仅在本机复用它，以避免 Service Worker 重启后重复认证；PageClip 不会保存 Google Refresh Token 或 OAuth client secret。如果 Google 返回 `interaction_required`、`login_required` 或 `consent_required`，PageClip 会暂停自动备份并仅发出一条系统通知。点击通知会打开设置页；再点击「重新连接 Google Drive」并完成可见授权，最后执行一次手动备份确认成功。自动备份开关会保留，并将在下一次内容变更时恢复执行。

OAuth client secret 不能放入 Chrome 扩展或提交到 GitHub；扩展内只能使用公开的 client ID。如果 secret 曾经出现在聊天、日志或仓库中，应立即在 Google Cloud 撤销并重新生成。

## 开发者

- 目录结构见 `manifest.json` / `js/`（store 数据层、tag-model 标签纯计算、tag-editor 标签界面、collection 收藏页签、bookmarks 书签页签、tree 拖拽、search 搜索、ui 基建）。
- 本地预览 UI：起一个静态服务器（如 `python -m http.server`）后访问 `dev/preview.html`，会自动注入 chrome API mock，无需安装扩展即可调试界面。
- 重新生成图标：`powershell -File make-icons.ps1`。
- 固定开发 / 发布 Extension ID：将匹配的私钥放在仓库根目录 `v1.pem`（该文件已被 `.gitignore` 忽略），运行 `powershell -ExecutionPolicy Bypass -File scripts/package-release.ps1`。脚本会从 PEM 校验并恢复开发用 `manifest.json` 的公开 `key`，然后在发布暂存目录删除 `key`，生成 `release/PageClip-v<version>.zip` 和使用同一私钥签名的 `release/PageClip-v<version>.crx`。若 PEM 与 manifest 的固定 key 不匹配，脚本会直接失败，不会生成错误的发布包。
