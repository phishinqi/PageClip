// 临时暂存：PageClip Inbox（完成即移除）+ Chrome Reading List（标记已读但保留）。
import { h, icon, faviconEl, toast, toastAction, openUrl, confirmDialog } from './ui.js';
import { addInboxItem, markInboxRead, completeInboxItem, removeInboxItem, removeInboxItems, completeInboxItems, restoreRecycleEntry } from './store.js';

export function createInboxTab(ctx) {
  const root = ctx.rootEl;
  let readingItems = [];
  let readingSupported = false;
  const selected = new Set();

  async function render() {
    const data = ctx.getData();
    const liveIds = new Set((data.inbox || []).map((item) => item.id));
    for (const id of selected) if (!liveIds.has(id)) selected.delete(id);
    await loadReadingList();
    root.replaceChildren();
    const toolbar = h('div', { class: 'feature-toolbar' },
      h('span', { class: 'feature-title' }, icon('inbox', 15), 'Inbox / 稍后阅读'),
      h('span', { class: 'flex1' }),
      h('button', { class: 'btn btn-ghost sm', title: '暂存当前网页', onclick: addCurrent }, icon('plus', 14), '当前页'),
      h('button', { class: 'btn btn-ghost sm', title: '同步到 Chrome Reading List', onclick: syncCurrent }, icon('bookmark', 14), 'Reading List')
    );
    root.append(toolbar);

    const inbox = h('section', { class: 'inbox-section' });
    const inboxTitle = h('div', { class: 'feature-section-title' }, icon('inbox', 14), 'PageClip Inbox', h('span', { class: 'section-count', text: String(data.inbox?.length || 0) }));
    if ((data.inbox || []).length) {
      inboxTitle.append(
        h('button', { class: 'text-btn', onclick: () => { data.inbox.forEach((item) => selected.add(item.id)); render(); } }, '全选'),
        h('button', { class: 'text-btn', onclick: () => { selected.clear(); render(); } }, '清除')
      );
      if (selected.size) inboxTitle.append(
        h('button', { class: 'text-btn danger-text', onclick: () => batchRemove() }, `删除已选 (${selected.size})`),
        h('button', { class: 'text-btn', onclick: () => batchComplete() }, '完成并移除')
      );
    }
    inbox.append(inboxTitle);
    const inboxItems = [...(data.inbox || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!inboxItems.length) inbox.append(h('div', { class: 'feature-empty-inline', text: '还没有暂存内容' }));
    else inboxItems.forEach((item) => inbox.append(renderInboxItem(item)));
    root.append(inbox);

    const reading = h('section', { class: 'inbox-section' });
    reading.append(h('div', { class: 'feature-section-title' }, icon('bookmark', 14), 'Chrome Reading List', h('span', { class: 'section-count', text: readingSupported ? String(readingItems.length) : '未授权' })));
    if (!readingSupported) {
      reading.append(h('div', { class: 'feature-empty-inline' }, '首次使用时点击“Reading List”按钮授权；PageClip Inbox 不受影响。'));
    } else if (!readingItems.length) {
      reading.append(h('div', { class: 'feature-empty-inline', text: 'Chrome Reading List 暂无条目' }));
    } else {
      readingItems.forEach((item) => reading.append(renderReadingItem(item)));
    }
    root.append(reading);
  }

  async function loadReadingList() {
    if (!chrome.readingList?.query || !chrome.permissions?.contains) return;
    try {
      readingSupported = await chrome.permissions.contains({ permissions: ['readingList'] });
      if (readingSupported) readingItems = await chrome.readingList.query({});
    } catch {
      readingSupported = false;
    }
  }

  function renderInboxItem(item) {
    const row = h('div', { class: `feature-card inbox-card${item.readAt ? ' is-read' : ''}${selected.has(item.id) ? ' is-selected' : ''}`, tabindex: '0', role: 'button', 'aria-pressed': String(selected.has(item.id)), 'aria-label': item.title || item.url });
    const actions = h('span', { class: 'row-actions card-actions' },
      action(item.readAt ? 'check' : 'clock', item.readAt ? '标为未读' : '标记已读', async () => { await markInboxRead(item.id, !item.readAt); await ctx.refresh(); }),
      action('check', '完成并移除', async () => { const recycle = await completeInboxItem(item.id); await ctx.refresh(); toastAction('已移入回收站 · 撤销', '撤销', async () => { await restoreRecycleEntry(recycle.id); await ctx.refresh(); }); }),
      action('trash', '删除', async () => { if (await confirmDialog({ title: '删除暂存内容', message: `删除「${item.title}」？`, okLabel: '删除' })) { const recycle = await removeInboxItem(item.id); await ctx.refresh(); toastAction('已移入回收站 · 撤销', '撤销', async () => { await restoreRecycleEntry(recycle.id); await ctx.refresh(); }); } })
    );
    row.append(h('div', { class: 'feature-card-top' }, faviconEl(item.url, 18), h('span', { class: 'feature-card-title', text: item.title || item.url }), actions));
    row.append(h('div', { class: 'feature-card-meta', text: `${host(item.url)} · ${item.readAt ? '已读' : '未读'} · ${formatTime(item.createdAt)}` }));
    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions')) return;
      if (e.detail > 1) return;
      selected.has(item.id) ? selected.delete(item.id) : selected.add(item.id);
      row.classList.toggle('is-selected', selected.has(item.id));
      row.setAttribute('aria-pressed', String(selected.has(item.id)));
    });
    row.addEventListener('dblclick', (e) => { if (!e.target.closest('.row-actions')) openUrl(item.url, { newTab: true }); });
    row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.row-actions')) { e.preventDefault(); openUrl(item.url, { newTab: true }); } });
    return row;
  }

  function renderReadingItem(item) {
    const url = item.url;
    const row = h('div', { class: `feature-card reading-card${item.hasBeenRead ? ' is-read' : ''}`, tabindex: '0', role: 'button', 'aria-label': item.title || url });
    const actions = h('span', { class: 'row-actions card-actions' },
      action(item.hasBeenRead ? 'clock' : 'check', item.hasBeenRead ? '标为未读' : '标记已读', async () => { await chrome.readingList.updateEntry({ url }, { hasBeenRead: !item.hasBeenRead }); await render(); }),
      action('trash', '删除 Reading List 条目', async () => { if (await confirmDialog({ title: '删除 Reading List 条目', message: `删除「${item.title || url}」？`, okLabel: '删除' })) { await chrome.readingList.removeEntry({ url }); await render(); } })
    );
    row.append(h('div', { class: 'feature-card-top' }, faviconEl(url, 18), h('span', { class: 'feature-card-title', text: item.title || url }), actions));
    row.append(h('div', { class: 'feature-card-meta', text: `${host(url)} · ${item.hasBeenRead ? '已读' : '未读'}` }));
    row.addEventListener('click', (e) => { if (e.target.closest('.row-actions')) return; if (e.detail > 1) return; row.classList.toggle('is-selected'); });
    row.addEventListener('dblclick', (e) => { if (!e.target.closest('.row-actions')) openUrl(url, { newTab: true }); });
    row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.row-actions')) { e.preventDefault(); openUrl(url, { newTab: true }); } });
    return row;
  }

  function action(name, title, fn) { return h('button', { class: 'act-btn', title, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(name, 14)); }

  async function batchRemove() {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await confirmDialog({ title: '删除 Inbox 条目', message: `将 ${ids.length} 条内容移入回收站？`, okLabel: '删除' });
    if (!ok) return;
    try {
      const result = await removeInboxItems(ids);
      selected.clear();
      await ctx.refresh();
      toastAction(`${result.count} 条内容已移入回收站`, '撤销', async () => {
        await restoreRecycleEntry(result.batch.id);
        await ctx.refresh();
      });
    } catch (err) { toast(err.message || String(err), 'error'); }
  }

  async function batchComplete() {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await confirmDialog({ title: '完成 Inbox 条目', message: `将 ${ids.length} 条内容完成并移入回收站？`, okLabel: '完成并移除' });
    if (!ok) return;
    try {
      const result = await completeInboxItems(ids);
      selected.clear();
      await ctx.refresh();
      toastAction(`${result.count} 条内容已移入回收站`, '撤销', async () => {
        await restoreRecycleEntry(result.batch.id);
        await ctx.refresh();
      });
    } catch (err) { toast(err.message || String(err), 'error'); }
  }

  async function addCurrent() {
    const tab = await ctx.getActiveTab();
    if (!tab?.url) return toast('无法读取当前页面', 'error');
    try { const result = await addInboxItem({ url: tab.url, title: tab.title || tab.url, favIconUrl: tab.favIconUrl || '' }); await ctx.refresh(); toast(result.duplicate ? '已更新 Inbox 条目' : '已加入 PageClip Inbox'); }
    catch (err) { toast(err.message || String(err), 'error'); }
  }

  async function syncCurrent() {
    const tab = await ctx.getActiveTab();
    if (!tab?.url) return toast('无法读取当前页面', 'error');
    if (!chrome.permissions?.request || !chrome.readingList?.addEntry) return toast('当前浏览器不支持 Chrome Reading List', 'error');
    try {
      const has = await chrome.permissions.contains({ permissions: ['readingList'] });
      if (!has && !(await chrome.permissions.request({ permissions: ['readingList'] }))) return toast('未授予 Reading List 权限', 'error');
      await chrome.readingList.addEntry({ url: tab.url, title: tab.title || tab.url, hasBeenRead: false });
      await render();
      toast('已同步到 Chrome Reading List');
    } catch (err) { toast('同步失败：' + (err.message || err), 'error'); }
  }

  function host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url || ''; } }
  function formatTime(ts) { return ts ? new Date(ts).toLocaleDateString() : ''; }

  return { render, addCurrent, syncCurrent };
}
