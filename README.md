# PageClip（Chrome 扩展）

在浏览器侧边栏中浏览、搜索、**完整管理** Chrome 自带书签，同时拥有一套独立的收藏体系（标签 / 备注 / 文件夹 / 置顶 / 时间）。纯原生 JS（Manifest V3），无需构建，加载即用。

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
| 收藏页签 | 插件自建收藏：标签、备注、嵌套文件夹、时间记录、置顶；文件夹可单击或按 Space 展开/收起，点击条目选中，双击在新标签页打开 |
| 快捷页签 | 单页快捷访问 + 当前窗口多标签页集合快照；可置顶、删除、拖拽排序、恢复到当前窗口 |
| Inbox 页签 | PageClip 临时暂存：完成阅读后立即移除；同时可按需同步 Chrome Reading List（Chrome Reading List 标记已读但保留） |
| Chrome 书签页签 | 浏览器书签全功能管理：新建书签 / 文件夹、重命名、改网址、删除、移动（拖拽或「移动到…」），与 Chrome 自带管理器实时同步 |
| 全局搜索 | 顶部搜索框同时搜永久收藏、快捷收藏、Inbox 和 Chrome 书签；结果分组显示、关键字高亮；输入 `#标签名` 可按标签过滤收藏 |
| 拖拽 | 条目拖到文件夹上移动；拖到条目上/下边缘插入排序；文件夹可互相嵌套（禁止移入自身子文件夹） |
| 排序 | 收藏列表支持「按时间」/「手动排序」（拖拽后自动切换）两种模式，置顶条目始终在前 |
| 设置 ⚙ | 收藏统计、JSON / HTML / CSV 导入导出、可选的自动 Chrome 书签导入、Google Drive 加密云备份、自动备份、备份历史、回收站与快捷键说明 |

## 数据与隐私

- 插件收藏默认保存在本机浏览器（`chrome.storage.local`）；Google Drive 云备份支持手动触发，或在用户启用后于 PageClip 数据变更约 10 秒后自动触发，上传前使用客户端 AES-GCM 加密，云端仅保存密文；自动备份默认使用本机密钥。备份密码不保存，启用本机密钥模式时请另行保管加密恢复密钥。恢复密钥现在导出为加密二进制 `.pckey` 文件；二进制只隐藏文件结构，安全性仍由恢复密钥密码、PBKDF2 和 AES-GCM 提供。旧版 JSON 恢复密钥仍可导入。
- 「Chrome 书签」页签的所有操作直接作用于浏览器书签，与 Chrome 同步机制一致。设置中的浏览器书签导入（手动或用户启用的自动导入）仅将可用条目复制到 PageClip，绝不反向修改 Chrome；Chrome 中的删除、移动和编辑不会删除或覆盖 PageClip 副本。重复 URL 在整个 PageClip 收藏中仅保留一条，复制后的条目会随常规 JSON 导出和已启用的加密云备份处理。

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
- **自动导入会同步删除或修改吗？** 不会。它是设置中可选的单向添加式导入：Chrome 新增书签后 PageClip 会合并复制，Chrome 的删除、移动、重命名和改网址均不会改动 PageClip；已存在的 PageClip URL 也不会被 Chrome 覆盖。

## Google Drive OAuth 配置

Google Drive 备份在 Chrome 使用 `chrome.identity.getAuthToken()`，在 Brave 回退到 `chrome.identity.launchWebAuthFlow()`；不要把 Desktop/Native App 的 custom URI 流程直接交给 Chrome 的 `getAuthToken()`。首次配置时：

1. 先在 `chrome://extensions` 加载本目录，复制页面显示的 **Extension ID**。当前仓库的固定 `key` 对应 ID 为 `mnapcpmijebakicgdflohgnjmndhlneg`。
2. 在 Google Cloud 的 OAuth Client 页面创建 **Chrome Extension** 类型 client。
3. 将上一步的 Extension ID 填入 **Item ID**，启用 Google Drive API，并将生成的 client ID 填入 `manifest.json` 的 `oauth2.client_id`。
4. 修改 `manifest.json` 后，在 `chrome://extensions` 点击 PageClip 的「重新加载」，再回到设置页连接 Google。

如果 Chrome 报错 `Custom URI scheme is not supported on Chrome apps` 或错误 400 `invalid_request`，先确认扩展 ID 和 Chrome Extension Client 的 Item ID。Chrome 正常、Brave 失败时，这是 Brave 的 `getAuthToken()` 兼容问题；PageClip 会回退到 Web OAuth 流程。Brave 使用的 Web OAuth Client 必须额外允许回调地址 `https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/`。

OAuth client secret 不能放入 Chrome 扩展或提交到 GitHub；扩展内只能使用公开的 client ID。如果 secret 曾经出现在聊天、日志或仓库中，应立即在 Google Cloud 撤销并重新生成。

## 开发者

- 目录结构见 `manifest.json` / `js/`（store 数据层、collection 收藏页签、bookmarks 书签页签、tree 拖拽、search 搜索、ui 基建）。
- 本地预览 UI：起一个静态服务器（如 `python -m http.server`）后访问 `dev/preview.html`，会自动注入 chrome API mock，无需安装扩展即可调试界面。
- 重新生成图标：`powershell -File make-icons.ps1`。
- 固定开发 / 发布 Extension ID：将匹配的私钥放在仓库根目录 `v1.pem`（该文件已被 `.gitignore` 忽略），运行 `powershell -ExecutionPolicy Bypass -File scripts/package-release.ps1`。脚本会从 PEM 校验并恢复开发用 `manifest.json` 的公开 `key`，然后在发布暂存目录删除 `key`，生成 `release/PageClip-v<version>.zip` 和使用同一私钥签名的 `release/PageClip-v<version>.crx`。若 PEM 与 manifest 的固定 key 不匹配，脚本会直接失败，不会生成错误的发布包。
