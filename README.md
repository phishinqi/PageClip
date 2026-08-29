# PageClip（Chrome 扩展）

在浏览器侧边栏中浏览、搜索、**完整管理** Chrome 自带书签，同时拥有一套独立的收藏体系（标签 / 备注 / 文件夹 / 置顶 / 时间）。纯原生 JS（Manifest V3），无需构建，加载即用。

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
| 收藏页签 | 插件自建收藏：标签、备注、嵌套文件夹、时间记录、置顶；点击条目选中，双击在新标签页打开 |
| 快捷页签 | 单页快捷访问 + 当前窗口多标签页集合快照；可置顶、删除、拖拽排序、恢复到当前窗口 |
| Inbox 页签 | PageClip 临时暂存：完成阅读后立即移除；同时可按需同步 Chrome Reading List（Chrome Reading List 标记已读但保留） |
| Chrome 书签页签 | 浏览器书签全功能管理：新建书签 / 文件夹、重命名、改网址、删除、移动（拖拽或「移动到…」），与 Chrome 自带管理器实时同步 |
| 全局搜索 | 顶部搜索框同时搜永久收藏、快捷收藏、Inbox 和 Chrome 书签；结果分组显示、关键字高亮；输入 `#标签名` 可按标签过滤收藏 |
| 拖拽 | 条目拖到文件夹上移动；拖到条目上/下边缘插入排序；文件夹可互相嵌套（禁止移入自身子文件夹） |
| 排序 | 收藏列表支持「按时间」/「自定义」（拖拽后自动切换）两种模式，置顶条目始终在前 |
| 设置 ⚙ | 收藏统计、JSON / HTML / CSV 导入导出、Google Drive 加密云备份、回收站与快捷键说明 |

## 数据与隐私

- 插件收藏默认保存在本机浏览器（`chrome.storage.local`）；Google Drive 云备份为手动触发，上传前使用客户端 AES-GCM 加密，云端仅保存密文。备份密码不保存，启用本机密钥模式时请另行保管加密恢复密钥。
- 「Chrome 书签」页签的所有操作直接作用于浏览器书签，与 Chrome 同步机制一致。

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

## 开发者

- 目录结构见 `manifest.json` / `js/`（store 数据层、collection 收藏页签、bookmarks 书签页签、tree 拖拽、search 搜索、ui 基建）。
- 本地预览 UI：起一个静态服务器（如 `python -m http.server`）后访问 `dev/preview.html`，会自动注入 chrome API mock，无需安装扩展即可调试界面。
- 重新生成图标：`powershell -File make-icons.ps1`。
