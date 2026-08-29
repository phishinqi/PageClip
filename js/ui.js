import { translateText } from './i18n.js';
// UI 基建：DOM 构建、图标、toast、模态框、右键菜单、favicon 兜底链、搜索高亮。

// ———— DOM 构建 ————
// children 中的字符串按纯文本处理（textContent），杜绝 HTML 注入；
// 确需 HTML 的位置使用 html 属性，调用方必须先 escapeHtml。
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = translateText(v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else if (k === 'title' || k === 'placeholder' || k === 'aria-label') el.setAttribute(k, translateText(v));
    else el.setAttribute(k, String(v));
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.append(c);
    else el.append(document.createTextNode(translateText(c))); 
  }
}

// ———— 图标（Material 风格实心 path，currentColor） ————
const PATHS = {
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z',
  search: 'M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1114 9.5 4.5 4.5 0 019.5 14z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  chevron: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  pin: 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  folder: 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  folderPlus: 'M20 6h-8l-2-2H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z',
  bookmark: 'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z',
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  upload: 'M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z',
  open: 'M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  alert: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z',
  swap: 'M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z',
  keyboard: 'M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z',
  inbox: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12h-4c0 1.66-1.34 3-3 3s-3-1.34-3-3H5V5h14v10z',
  star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
};

export function icon(name, size = 16) {
  const d = PATHS[name] || PATHS.info;
  const el = h('span', {
    class: 'ico',
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`,
  });
  el.dataset.ico = name;
  return el;
}

// ———— 基础工具 ————

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 搜索关键字高亮：先整体 HTML 转义，再用合并正则一次性包 <mark>（避免嵌套包裹）。
// 输入是纯文本，输出可安全 innerHTML。
export function highlight(text, tokens = []) {
  const esc = escapeHtml(text);
  const parts = tokens
    .filter(Boolean)
    .map((t) => escapeRegExp(escapeHtml(t)))
    .sort((a, b) => b.length - a.length);
  if (!parts.length) return h('span', { text: String(text ?? '') });
  const re = new RegExp(`(${parts.join('|')})`, 'gi');
  return h('span', { html: esc.replace(re, '<mark>$1</mark>') });
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return sameYear ? md : `${d.getFullYear()}年${md}`;
}

// 点击 = 当前页打开；Ctrl/⌘+点击 或 中键 = 新标签页
export async function openUrl(url, e) {
  const newTab = !!(e && (e.newTab || e.ctrlKey || e.metaKey || e.button === 1));
  try {
    if (newTab) {
      await chrome.tabs.create({ url });
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      await chrome.tabs.create({ url });
      return;
    }
    try {
      await chrome.tabs.update(tab.id, { url });
    } catch {
      // 某些浏览器上下文无法更新当前页时，回退到新标签页，避免静默失败。
      await chrome.tabs.create({ url });
    }
  } catch (err) {
    toast('打开失败：' + (err.message || err), 'error');
  }
}

// ———— favicon：_favicon → 域名首字母色块 兜底链 ————

export function faviconUrl(pageUrl, size = 32) {
  return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
}

export function faviconEl(url, size = 16) {
  const box = h('span', { class: 'fav', style: `width:${size}px;height:${size}px` });
  const img = h('img', { src: faviconUrl(url, Math.max(size, 32)), alt: '', draggable: 'false' });
  img.addEventListener('error', () => {
    img.remove();
    box.append(letterAvatar(url, size));
  });
  box.append(img);
  return box;
}

function letterAvatar(url, size) {
  const host = hostOf(url) || url || '?';
  let hash = 0;
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const letter = (host.match(/[a-z0-9]/i) || ['?'])[0].toUpperCase();
  return h('span', {
    class: 'fav-letter',
    text: letter,
    style: `width:${size}px;height:${size}px;background:hsl(${hue},58%,46%);font-size:${Math.round(size * 0.58)}px`,
  });
}

// ———— toast ————

let toastRoot = null;
export function toast(msg, kind = 'ok') {
  showToastContent(h('span', { class: `toast toast-${kind}` }, icon(kind === 'error' ? 'alert' : 'check'), h('span', { text: msg })));
}

export function toastAction(msg, label, onClick, kind = 'ok') {
  const action = h('button', { class: 'toast-action', text: label });
  action.addEventListener('click', () => { clearTimeout(toast._t); toastRoot?.replaceChildren(); onClick(); });
  showToastContent(h('div', { class: `toast toast-${kind}` }, icon(kind === 'error' ? 'alert' : 'check'), h('span', { text: msg }), action));
}

function showToastContent(content) {
  if (!toastRoot) {
    toastRoot = h('div', { id: 'toast-root' });
    document.body.append(toastRoot);
  }
  toastRoot.replaceChildren(content);
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastRoot && toastRoot.replaceChildren(), 3500);
}

// ———— 模态框 ————

const modalStack = [];

export function showModal({ title, body, buttons = [], onClose }) {
  const card = h('div', { class: 'modal' });
  const closeBtn = h('button', { class: 'icon-btn', title: '关闭' }, icon('close'));
  const head = h('div', { class: 'modal-head' }, h('div', { class: 'modal-title', text: title }), closeBtn);
  const bodyWrap = h('div', { class: 'modal-body' });
  if (body) bodyWrap.append(body);
  const foot = h('div', { class: 'modal-foot' });
  card.append(head, bodyWrap);
  if (buttons.length) {
    // DOM 顺序与传入顺序一致：主按钮（最后传入）显示在最右侧
    for (const b of buttons) {
      const btn = h('button', { class: `btn btn-${b.kind || 'ghost'}` }, b.label);
      btn.addEventListener('click', async () => {
        if (b.onClick) await b.onClick(close);
        else close();
      });
      foot.append(btn);
    }
    card.append(foot);
  }
  const backdrop = h('div', { class: 'modal-backdrop' }, card);

  function close() {
    backdrop.remove();
    const i = modalStack.indexOf(api);
    if (i >= 0) modalStack.splice(i, 1);
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
  }
  function onKey(e) {
    if (e.key === 'Escape' && modalStack[modalStack.length - 1] === api) {
      e.stopPropagation();
      close();
    }
  }
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  const api = { close, card, bodyWrap };
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  modalStack.push(api);
  const first = bodyWrap.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 30);
  return api;
}

export function confirmDialog({ title = '确认操作', message, okLabel = '删除', danger = true }) {
  return new Promise((resolve) => {
    let done = false;
    const settle = (v) => { if (!done) { done = true; resolve(v); } };
    showModal({
      title,
      body: h('div', { class: 'confirm-msg', text: message }),
      buttons: [
        { label: '取消', kind: 'ghost', onClick: (close) => { settle(false); close(); } },
        {
          label: okLabel,
          kind: danger ? 'danger' : 'primary',
          onClick: (close) => { settle(true); close(); },
        },
      ],
      onClose: () => settle(false),
    });
  });
}

// 小表单弹窗：fields: {key,label,type:'text'|'url'|'textarea'|'select',value,placeholder,options,hint,required}
export function formDialog({ title, fields, okLabel = '确定', validate }) {
  return new Promise((resolve) => {
    let settled = false;
    const inputs = {};
    const body = h('div', { class: 'form' });
    for (const f of fields) {
      const field = h('label', { class: 'form-field' }, h('span', { class: 'form-label', text: f.label }));
      let input;
      if (f.type === 'textarea') {
        input = h('textarea', { rows: f.rows || 4, placeholder: f.placeholder || '' });
        input.value = f.value ?? '';
      } else if (f.type === 'select') {
        input = h('select', {});
        for (const opt of f.options || []) {
          const o = h('option', { value: opt.value }, opt.label);
          if (opt.value === f.value) o.selected = true;
          input.append(o);
        }
      } else {
        input = h('input', { type: f.type === 'url' ? 'text' : 'text', placeholder: f.placeholder || '', spellcheck: 'false' });
        input.value = f.value ?? '';
      }
      inputs[f.key] = input;
      field.append(input);
      if (f.hint) field.append(h('span', { class: 'form-hint', text: f.hint }));
      body.append(field);
    }
    const m = showModal({
      title,
      body,
      buttons: [
        { label: '取消', kind: 'ghost' },
        {
          label: okLabel,
          kind: 'primary',
          onClick: (close) => {
            const values = {};
            for (const [k, el] of Object.entries(inputs)) values[k] = el.value.trim();
            if (validate) {
              const err = validate(values);
              if (err) { toast(err, 'error'); return; }
            }
            settled = true;
            resolve(values);
            close();
          },
        },
      ],
      onClose: () => setTimeout(() => { if (!settled) resolve(null); }, 0),
    });
    const submit = (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        m.card.querySelector('.btn-primary').click();
      }
    };
    m.bodyWrap.addEventListener('keydown', submit);
  });
}

// ———— 右键菜单 ————

let ctxMenuEl = null;
let ctxDocListener = null;
let ctxKeyListener = null;

export function contextMenu(x, y, items) {
  closeContextMenu();
  const menu = h('div', { class: 'ctx-menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) {
      menu.append(h('div', { class: 'ctx-sep' }));
      continue;
    }
    const row = h(
      'div',
      { class: `ctx-item${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}` },
      it.icon ? icon(it.icon) : h('span', { class: 'ico ph' }),
      h('span', { text: it.label })
    );
    if (!it.disabled) {
      row.addEventListener('click', () => {
        closeContextMenu();
        it.onClick();
      });
    }
    menu.append(row);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
  ctxMenuEl = menu;

  ctxDocListener = (e) => {
    if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeContextMenu();
  };
  ctxKeyListener = (e) => {
    if (e.key === 'Escape') closeContextMenu();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', ctxDocListener, true);
    document.addEventListener('keydown', ctxKeyListener, true);
  });
  window.addEventListener('blur', closeContextMenu);
  document.addEventListener('scroll', closeContextMenu, true);
}

export function closeContextMenu() {
  if (ctxMenuEl) {
    ctxMenuEl.remove();
    ctxMenuEl = null;
  }
  if (ctxDocListener) document.removeEventListener('mousedown', ctxDocListener, true);
  if (ctxKeyListener) document.removeEventListener('keydown', ctxKeyListener, true);
  ctxDocListener = null;
  ctxKeyListener = null;
  window.removeEventListener('blur', closeContextMenu);
  document.removeEventListener('scroll', closeContextMenu, true);
}
