(() => {
  const key = 'pageclip-site-language';
  const saved = localStorage.getItem(key);
  const browserLang = (navigator.language || '').toLowerCase();
  let lang = saved === 'en' || saved === 'zh' ? saved : (browserLang.startsWith('zh') ? 'zh' : 'en');
  const apply = () => {
    document.documentElement.dataset.lang = lang;
    document.querySelectorAll('[data-lang-toggle]').forEach((button) => {
      button.textContent = lang === 'zh' ? 'English' : '中文';
      button.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换为中文');
      button.title = lang === 'zh' ? 'Switch to English' : '切换为中文';
    });
    document.querySelectorAll('[data-lang-label]').forEach((node) => { node.textContent = lang === 'zh' ? '中文' : 'English'; });
  };
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-lang-toggle]');
    if (!button) return;
    lang = lang === 'zh' ? 'en' : 'zh';
    localStorage.setItem(key, lang);
    apply();
  });
  apply();
})();
