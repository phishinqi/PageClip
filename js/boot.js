// 环境引导：仅在无 chrome 扩展 API 的本地预览环境加载 mock（扩展内为空操作）。
// 放在所有脚本之前，保证模块代码运行时 chrome.* 已就绪。
if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
  document.write('<script src="dev/mock.js"><\/script>');
}
