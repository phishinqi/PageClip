(() => {
  if (window.top !== window) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  if (document.querySelector('pageclip-host')) return;

  const host = document.createElement('pageclip-host');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .pc-shell { position: absolute; inset: 0; z-index: 2147483646; pointer-events: none; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .pc-panel { position: absolute; top: 0; bottom: 0; right: 0; width: 380px; min-width: 300px; max-width: min(80vw, 680px); background: #fff; box-shadow: -16px 0 38px rgba(20,24,32,.16); transform: translateX(104%); transition: transform 150ms cubic-bezier(.2,.8,.2,1); pointer-events: auto; }
    .pc-panel.left { right: auto; left: 0; transform: translateX(-104%); box-shadow: 16px 0 38px rgba(20,24,32,.16); }
    .pc-shell.open .pc-panel { transform: translateX(0); }
    .pc-iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
    .pc-toggle { position: fixed; right: 10px; top: 50%; width: 42px; height: 78px; transform: translateY(-50%); border: 0; border-radius: 13px; background: #386bc6; color: #fff; box-shadow: 0 7px 18px rgba(30,60,120,.28); cursor: pointer; pointer-events: auto; transition: width 150ms cubic-bezier(.2,.8,.2,1), background 150ms ease, transform 150ms cubic-bezier(.2,.8,.2,1); }
    .pc-shell.left .pc-toggle { right: auto; left: 10px; }
    .pc-toggle:hover { width: 104px; background: #2f5eaf; transform: translateY(-50%) translateX(-2px); }
    .pc-toggle::before { content: ''; display: none; }
    .pc-toggle-logo { display: block; width: 26px; height: 26px; margin: 0 auto 3px; }
    .pc-toggle::after { content: 'PageClip'; display: block; opacity: 0; font: 600 10px/14px system-ui,sans-serif; transition: opacity 150ms ease; }
    .pc-toggle:hover::after { opacity: 1; }
    .pc-shell.open .pc-toggle { opacity: 0; pointer-events: none; }
    .pc-mask { position: fixed; inset: 0; background: rgba(15,20,30,.22); opacity: 0; pointer-events: none; transition: opacity 150ms ease; }
    .pc-shell.mask-open .pc-mask { opacity: 1; pointer-events: auto; }
    .pc-resize { position: absolute; top: 0; bottom: 0; left: -5px; width: 10px; cursor: ew-resize; }
    .pc-panel.left .pc-resize { left: auto; right: -5px; }
    .pc-context-menu { position: fixed; z-index: 3; width: 218px; padding: 5px; border: 1px solid rgba(0,0,0,.1); border-radius: 9px; background: #fff; box-shadow: 0 14px 34px rgba(20,24,32,.18); color: #252525; opacity: 0; transform: translateY(-4px) scale(.98); pointer-events: none; transition: opacity 150ms cubic-bezier(.2,.8,.2,1), transform 150ms cubic-bezier(.2,.8,.2,1); }
    .pc-context-menu.open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
    .pc-menu-item { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 31px; padding: 0 9px; border: 0; border-radius: 6px; background: transparent; color: inherit; text-align: left; font: 13px/1.2 system-ui,sans-serif; cursor: pointer; }
    .pc-menu-item:hover { background: #f0f2f5; }
    .pc-menu-item .pc-menu-icon { width: 18px; color: #68707b; text-align: center; font-size: 14px; }
    .pc-menu-item.danger { color: #b63b35; }
    .pc-menu-item.danger .pc-menu-icon { color: #b63b35; }
    .pc-menu-separator { height: 1px; margin: 5px 6px; background: #e8e8e5; }
    .pc-menu-toast { position: fixed; z-index: 4; left: 50%; bottom: 22px; padding: 7px 12px; border-radius: 16px; background: rgba(35,37,40,.92); color: #fff; font: 12px/1.2 system-ui,sans-serif; transform: translateX(-50%) translateY(6px); opacity: 0; transition: opacity 150ms ease, transform 150ms ease; pointer-events: none; }
    .pc-menu-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    @media (prefers-reduced-motion: reduce) { .pc-panel, .pc-toggle, .pc-mask, .pc-toggle::after, .pc-context-menu, .pc-menu-toast { transition: none !important; } }
  `;
  shadow.append(style);

  const shell = document.createElement('div');
  shell.className = 'pc-shell';
  const mask = document.createElement('div');
  mask.className = 'pc-mask';
  const panel = document.createElement('section');
  panel.className = 'pc-panel';
  const resize = document.createElement('div');
  resize.className = 'pc-resize';
  const iframe = document.createElement('iframe');
  iframe.className = 'pc-iframe';
  iframe.title = 'PageClip 网页侧栏';
  iframe.src = chrome.runtime.getURL('sidepanel.html?embedded=1');
  const toggle = document.createElement('button');
  toggle.className = 'pc-toggle';
  toggle.type = 'button';
  toggle.title = 'PageClip';
  const toggleLogo = document.createElement('img');
  toggleLogo.className = 'pc-toggle-logo';
  toggleLogo.src = chrome.runtime.getURL('logo.svg');
  toggleLogo.alt = 'PageClip';
  toggle.append(toggleLogo);
  const menu = document.createElement('div');
  menu.className = 'pc-context-menu';
  const menuToast = document.createElement('div');
  menuToast.className = 'pc-menu-toast';
  panel.append(resize, iframe);
  shell.append(mask, panel, toggle, menu, menuToast);
  shadow.append(shell);
  document.documentElement.append(host);

  let i18nLocale = 'zh_CN';
  let i18nMessages = {};
  function ct(key, variables = {}) { return String(i18nMessages[key] || key).replace(/\$([A-Z0-9_]+)\$/g, (_, name) => variables[name] ?? ''); }
  async function loadContentI18n() {
    try {
      const stored = await chrome.storage.local.get('bc_data');
      const preference = stored.bc_data?.settings?.uiLocale;
      i18nLocale = preference === 'en' ? 'en' : preference === 'zh_CN' ? 'zh_CN' : /^zh/i.test(chrome.i18n?.getUILanguage?.() || navigator.language || '') ? 'zh_CN' : 'en';
      const response = await chrome.runtime.sendMessage({ type: 'get-i18n-messages', locale: i18nLocale });
      if (response?.ok) { i18nMessages = response.messages || {}; toggleLogo.alt = ct('app.name'); toggle.title = ct('content.toggleTitle'); iframe.title = ct('content.iframeTitle'); }
    } catch {}
  }
  void loadContentI18n();
  let settings = { overlayOpen: false, overlayPosition: 'right', overlayMode: 'overlay', overlayWidth: 380, overlayMask: false };
  let dragStart = null;
  const originalPadding = {
    left: document.documentElement.style.paddingLeft,
    right: document.documentElement.style.paddingRight,
  };

  function applySettings(next) {
    settings = { ...settings, ...(next || {}) };
    panel.classList.toggle('left', settings.overlayPosition === 'left');
    shell.classList.toggle('left', settings.overlayPosition === 'left');
    panel.style.width = `${Math.max(300, Math.min(Number(settings.overlayWidth) || 380, Math.round(window.innerWidth * 0.8)))}px`;
    shell.classList.toggle('open', !!settings.overlayOpen);
    shell.classList.toggle('mask-open', !!settings.overlayMask && !!settings.overlayOpen);
    if (settings.overlayMode === 'push') {
      document.documentElement.style.setProperty('--pageclip-push-size', `${panel.offsetWidth}px`);
      document.documentElement.style.setProperty(settings.overlayPosition === 'left' ? 'padding-left' : 'padding-right', `${panel.offsetWidth}px`);
    } else {
      clearPush();
    }
  }

  function clearPush() {
    document.documentElement.style.paddingLeft = originalPadding.left;
    document.documentElement.style.paddingRight = originalPadding.right;
    document.documentElement.style.removeProperty('--pageclip-push-size');
  }

  function setOpen(open) {
    applySettings({ overlayOpen: !!open });
    chrome.storage.local.set({ pageclipOverlay: { ...settings, overlayOpen: !!open } }).catch(() => {});
  }

  function showMenu(x, y) {
    const items = [
      ['★', ct('content.capture'), 'capture-current'],
      ['☆', ct('content.quick'), 'capture-quick'],
      ['□', ct('content.inbox'), 'capture-inbox'],
      ['▣', ct('content.reading'), 'sync-reading'],
      ['---', '', 'separator'],
      ['⧉', ct('content.copy'), 'copy-url'],
      ['↗', ct('content.openManagerTab'), 'open-manager'],
      ['⚙', ct('content.openSettings'), 'open-settings'],
      ['◧', settings.overlayOpen ? ct('content.close') : ct('content.toggle'), 'toggle-overlay'],
    ];
    menu.replaceChildren();
    for (const [glyph, label, action] of items) {
      if (action === 'separator') {
        const divider = document.createElement('div');
        divider.className = 'pc-menu-separator';
        menu.append(divider);
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pc-menu-item';
      button.innerHTML = `<span class="pc-menu-icon">${glyph}</span><span>${label}</span>`;
      button.addEventListener('click', () => {
        closeMenu();
        handleMenuAction(action);
      });
      menu.append(button);
    }
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 226))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 320))}px`;
    menu.classList.add('open');
  }

  function closeMenu() { menu.classList.remove('open'); }

  function showMenuToast(text) {
    menuToast.textContent = text;
    menuToast.classList.add('show');
    clearTimeout(showMenuToast.timer);
    showMenuToast.timer = setTimeout(() => menuToast.classList.remove('show'), 1800);
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(location.href);
    } catch {
      const input = document.createElement('textarea');
      input.value = location.href;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    showMenuToast(ct('content.copied'));
  }

  function handleMenuAction(action) {
    if (action === 'toggle-overlay') return setOpen(!settings.overlayOpen);
    if (action === 'copy-url') return copyUrl();
    const payload = { url: location.href, title: document.title, favIconUrl: '' };
    if (action === 'open-manager' || action === 'open-settings') {
      chrome.runtime.sendMessage({ type: action, payload }).then(() => showMenuToast(ct('toast.opened'))).catch(() => showMenuToast(ct('error.open')));
      return;
    }
    chrome.runtime.sendMessage({ type: action, payload }).then((reply) => {
      showMenuToast(reply?.message || ct('toast.operationDone'));
    }).catch(() => showMenuToast(ct('error.retry')));
  }

  window.addEventListener('message', (event) => {
    if (event.source === iframe.contentWindow && event.data?.type === 'pageclip:close-overlay') {
      setOpen(false);
    }
  });
  toggle.addEventListener('click', () => setOpen(!settings.overlayOpen));
  toggle.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showMenu(event.clientX, event.clientY);
  });
  mask.addEventListener('click', () => setOpen(false));
  window.addEventListener('resize', () => { closeMenu(); applySettings(settings); });
  shadow.addEventListener('mousedown', (event) => {
    if (!menu.contains(event.target) && event.target !== toggle) closeMenu();
  }, true);
  document.addEventListener('mousedown', (event) => {
    if (!event.composedPath().includes(host)) closeMenu();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      if (settings.overlayOpen) setOpen(false);
    }
  }, true);

  resize.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragStart = { x: event.clientX, width: panel.offsetWidth, position: settings.overlayPosition };
    resize.setPointerCapture(event.pointerId);
  });
  resize.addEventListener('pointermove', (event) => {
    if (!dragStart) return;
    const delta = settings.overlayPosition === 'left' ? event.clientX - dragStart.x : dragStart.x - event.clientX;
    applySettings({ overlayWidth: Math.max(300, Math.min(680, dragStart.width + delta)) });
  });
  resize.addEventListener('pointerup', () => {
    if (!dragStart) return;
    dragStart = null;
    chrome.storage.local.set({ pageclipOverlay: settings }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'pageclip:toggle') setOpen(!settings.overlayOpen);
    if (message?.type === 'pageclip:open') setOpen(true);
    if (message?.type === 'pageclip:close') setOpen(false);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.bc_data?.newValue?.settings?.uiLocale !== changes.bc_data?.oldValue?.settings?.uiLocale) void loadContentI18n();
    if (area === 'local' && changes.pageclipOverlay) applySettings(changes.pageclipOverlay.newValue);
  });
  chrome.storage.local.get('pageclipOverlay').then((result) => applySettings(result.pageclipOverlay || settings)).catch(() => applySettings(settings));
})();
