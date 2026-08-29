// 快捷收藏夹：单页快捷访问 + 当前窗口标签页快照。
import {
  h,
  icon,
  faviconEl,
  formDialog,
  showModal,
  confirmDialog,
  toast,
  toastAction,
  openUrl,
} from './ui.js';
import {
  addQuickItem,
  addQuickGroup,
  removeQuickItem,
  removeQuickGroupTab,
  renameQuickGroup,
  reorderQuickGroupTabs,
  toggleQuickPinned,
  moveQuickItem,
  isCollectableUrl,
} from './store.js';

export function createQuickAccessTab(ctx) {
  const root = ctx.rootEl;

  function render() {
    const data = ctx.getData();
    root.replaceChildren();
    const toolbar = h('div', { class: 'feature-toolbar' },
      h('span', { class: 'feature-title' }, icon('star', 15), '快捷收藏夹'),
      h('span', { class: 'flex1' }),
      h('button', { class: 'btn btn-ghost sm', title: '保存当前网页', onclick: addCurrent }, icon('plus', 14), '当前页'),
      h('button', { class: 'btn btn-ghost sm', title: '保存当前窗口的多个标签页', onclick: addWindowGroup }, icon('folderPlus', 14), '标签集合')
    );
    root.append(toolbar);

    const items = [...(data.quickAccess || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!items.length) {
      root.append(empty('还没有快捷收藏', '把常用网页或当前窗口标签页保存到这里，之后一键恢复。'));
      return;
    }
    for (const item of items) root.append(renderItem(item));
  }

  function renderItem(item) {
    const isGroup = item.type === 'group';
    const first = isGroup ? item.tabs?.[0] : item;
    const row = h('div', {
      class: `feature-card${item.pinned ? ' is-pinned' : ''}`,
      tabindex: '0',
      role: 'button',
      'aria-label': isGroup ? `${item.title}，${item.tabs?.length || 0} 个标签页` : `${item.title}，${item.url}`,
    });
    const actions = h('span', { class: 'row-actions card-actions' },
      actionButton('pin', item.pinned ? '取消置顶' : '置顶', async () => { await toggleQuickPinned(item.id); await ctx.refresh(); }),
      actionButton('open', isGroup ? '恢复标签集合' : '打开快捷收藏', async () => { await restore(item); }),
      isGroup ? actionButton('edit', '编辑标签集合', () => openGroupEditor(item)) : null,
      actionButton('trash', '删除快捷收藏', async () => {
        if (await confirmDialog({ title: '删除快捷收藏', message: `删除「${item.title}」？`, okLabel: '删除' })) {
          const recycle = await removeQuickItem(item.id);
          await ctx.refresh();
          toastAction('已移入回收站 · 撤销', '撤销', async () => { const { restoreRecycleEntry } = await import('./store.js'); await restoreRecycleEntry(recycle.id); await ctx.refresh(); });
        }
      })
    );
    const title = h('span', { class: 'feature-card-title', text: item.title || first?.title || first?.url || '未命名' });
    const meta = isGroup
      ? `${item.tabs?.length || 0} 个标签页 · ${formatTime(item.updatedAt || item.createdAt)}`
      : `${host(item.url)} · ${formatTime(item.updatedAt || item.createdAt)}`;
    row.append(h('div', { class: 'feature-card-top' }, first?.url ? faviconEl(first.url, 18) : icon('folder', 18), title, actions));
    row.append(h('div', { class: 'feature-card-meta', text: meta }));
    if (isGroup && item.tabs?.length) {
      row.append(h('div', { class: 'feature-card-tabs' }, item.tabs.slice(0, 4).map((tab) => h('span', { class: 'quick-tab-chip', text: tab.title || tab.url }))));
    } else if (isGroup) {
      row.append(h('div', { class: 'feature-empty-inline', text: '空集合 · 点击编辑或删除' }));
    }
    if (isGroup) {
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); openGroupEditor(item); });
    }
    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions')) return;
      if (isGroup) { openGroupEditor(item); return; }
      if (e.detail > 1) return;
      row.classList.toggle('is-selected');
    });
    row.addEventListener('dblclick', async (e) => {
      if (e.target.closest('.row-actions')) return;
      await restore(item);
    });
    row.addEventListener('keydown', async (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.row-actions')) {
        e.preventDefault();
        await restore(item);
      }
    });
    return row;
  }

  function actionButton(name, title, action) {
    return h('button', { class: 'act-btn', title, onclick: (e) => { e.stopPropagation(); action(); } }, icon(name, 14));
  }

  function openGroupEditor(group) {
    const list = h('div', { class: 'group-editor-list' });
    const currentTabs = [...(group.tabs || [])];
    const renderTabs = () => {
      list.replaceChildren();
      currentTabs.forEach((tab, index) => {
        const row = h('div', { class: 'group-editor-row' },
          h('span', { class: 'drag-handle', text: '⋮⋮' }),
          faviconEl(tab.url, 16),
          h('span', { class: 'row-title', text: tab.title || tab.url }),
          actionButton('trash', '从集合移除', async () => {
            try {
              const recycle = await removeQuickGroupTab(group.id, index);
              currentTabs.splice(index, 1);
              renderTabs();
              await ctx.refresh();
              toastAction('已移入回收站 · 集合仍保留', '撤销', async () => {
                const { restoreRecycleEntry } = await import('./store.js');
                await restoreRecycleEntry(recycle.id);
                await ctx.refresh();
              });
            } catch (err) { toast(err.message || String(err), 'error'); }
          })
        );
        row.draggable = true;
        row.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', String(index)));
        row.addEventListener('dragover', (event) => event.preventDefault());
        row.addEventListener('drop', async (event) => {
          event.preventDefault();
          const from = Number(event.dataTransfer.getData('text/plain'));
          if (!Number.isInteger(from) || from === index) return;
          const [moved] = currentTabs.splice(from, 1);
          currentTabs.splice(index, 0, moved);
          await reorderQuickGroupTabs(group.id, currentTabs.map((tab) => group.tabs.indexOf(tab)));
          renderTabs();
        });
        list.append(row);
      });
    };
    renderTabs();
    const titleInput = h('input', { type: 'text', value: group.title, placeholder: '集合名称' });
    showModal({
      title: '编辑标签集合',
      body: h('div', { class: 'form' },
        h('label', { class: 'form-field' }, h('span', { class: 'form-label', text: '名称' }), titleInput),
        list
      ),
      buttons: [
        { label: '取消', kind: 'ghost' },
        { label: '保存', kind: 'primary', onClick: async (close) => { await renameQuickGroup(group.id, titleInput.value); await ctx.refresh(); close(); toast('集合已保存'); } },
      ],
    });
  }

  async function addCurrent() {
    const tab = await ctx.getActiveTab();
    if (!tab?.url || !isCollectableUrl(tab.url)) return toast('当前页面不支持快捷收藏', 'error');
    const result = await addQuickItem({ url: tab.url, title: tab.title || tab.url, favIconUrl: tab.favIconUrl || '' });
    await ctx.refresh();
    toast(result.duplicate ? '已更新快捷收藏' : '已加入快捷收藏夹');
  }

  async function addWindowGroup() {
    const tabs = (await chrome.tabs.query({ currentWindow: true }))
      .filter((tab) => tab.url && isCollectableUrl(tab.url));
    if (!tabs.length) return toast('当前窗口没有可保存的网页标签', 'error');
    const selected = new Set(tabs.map((tab) => tab.id));
    const titleInput = h('input', { type: 'text', placeholder: '标签集合名称', value: `标签集合 · ${new Date().toLocaleDateString()}` });
    const list = h('div', { class: 'tab-picker' });
    const refreshChecks = () => {
      list.replaceChildren();
      for (const tab of tabs) {
        const checkbox = h('input', { type: 'checkbox', checked: selected.has(tab.id) });
        checkbox.addEventListener('change', () => checkbox.checked ? selected.add(tab.id) : selected.delete(tab.id));
        list.append(h('label', { class: 'tab-picker-row' }, checkbox, tab.favIconUrl ? faviconEl(tab.url, 16) : icon('open', 15), h('span', { class: 'row-title', text: tab.title || tab.url })));
      }
    };
    refreshChecks();
    const body = h('div', { class: 'form' },
      h('label', { class: 'form-field' }, h('span', { class: 'form-label', text: '集合名称' }), titleInput),
      h('div', { class: 'picker-caption', text: `当前窗口 ${tabs.length} 个可保存标签页（原标签页不会关闭）` }),
      h('div', { class: 'actions' },
        h('button', { class: 'text-btn', onclick: () => { tabs.forEach((tab) => selected.add(tab.id)); refreshChecks(); } }, '全选'),
        h('button', { class: 'text-btn', onclick: () => { tabs.forEach((tab) => selected.delete(tab.id)); refreshChecks(); } }, '清除'),
        h('button', { class: 'text-btn', onclick: () => { tabs.forEach((tab) => selected.has(tab.id) ? selected.delete(tab.id) : selected.add(tab.id)); refreshChecks(); } }, '反选')
      ),
      list
    );
    const modal = await new Promise((resolve) => {
      const api = showQuickModal('保存标签集合', body, [
        { label: '取消', kind: 'ghost', onClick: (close) => { close(); resolve(null); } },
        { label: '保存', kind: 'primary', onClick: async (close) => {
          const chosen = tabs.filter((tab) => selected.has(tab.id));
          if (!chosen.length) return toast('至少选择一个标签页', 'error');
          const group = await addQuickGroup({ title: titleInput.value, tabs: chosen });
          close(); resolve(group);
        } },
      ]);
      void api;
    });
    if (modal) { await ctx.refresh(); toast('已保存标签集合'); }
  }

  async function restore(item) {
    try {
      if (item.type === 'group') {
        for (const tab of item.tabs || []) await chrome.tabs.create({ url: tab.url, active: false });
        toast(`已恢复 ${item.tabs?.length || 0} 个标签页`);
      } else {
        await chrome.tabs.create({ url: item.url, active: true });
      }
    } catch (err) {
      toast('恢复失败：' + (err.message || err), 'error');
    }
  }

  function empty(title, desc) {
    return h('div', { class: 'empty feature-empty' }, icon('star', 36), h('div', { class: 'empty-title', text: title }), h('div', { class: 'empty-hint', text: desc }));
  }

  function host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url || ''; } }
  function formatTime(ts) { return ts ? new Date(ts).toLocaleDateString() : ''; }

  function showQuickModal(title, body, buttons) {
    return ctx.showModal({ title, body, buttons });
  }

  return { render, addCurrent, addWindowGroup };
}
