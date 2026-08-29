// 「收藏」页签：插件自建收藏体系 —— 文件夹树 + 列表、标签、备注、置顶、时间、拖拽。

import {
  h,
  icon,
  faviconEl,
  showModal,
  formDialog,
  confirmDialog,
  contextMenu,
  toast,
  openUrl,
  fmtTime,
  hostOf,
} from './ui.js';
import {
  UNCATEGORIZED_ID,
  collectTags,
  moveItem,
  moveFolder,
  updateItem,
  removeItem,
  setItemPinned,
  addFolder,
  renameFolder,
  removeFolder,
  updateSettings,
  isDescendantFolder,
} from './store.js';
import { createDnd } from './tree.js';

export function createCollectionTab(ctx) {
  const { state } = ctx;
  const rail = ctx.railEl;
  const header = ctx.headerEl;
  const scroll = ctx.scrollEl;
  const selectedItems = new Set();
  let selectionMode = false;
  let selectionAnchor = null;

  // ———— 渲染入口 ————

  function renderAll() {
    const data = ctx.getData();
    rail.classList.toggle('collapsed', data.settings.railExpanded === false);
    renderRail(data);
    renderList(data);
  }

  function nameOf(folderId, data) {
    const f = data.folders.find((x) => x.id === folderId);
    return f ? f.name : '未分类';
  }

  // ———— 左侧文件夹栏 ————

  function renderRail(data) {
    rail.replaceChildren();
    rail.append(
      railRow({
        data,
        id: 'all',
        kind: 'col-all',
        name: '全部收藏',
        count: data.items.length,
        active: state.folderId === 'all',
        ico: icon('inbox', 15),
      })
    );
    rail.append(
      railRow({
        data,
        id: UNCATEGORIZED_ID,
        kind: 'col-folder',
        name: nameOf(UNCATEGORIZED_ID, data),
        count: data.items.filter((it) => it.folderId === UNCATEGORIZED_ID).length,
        active: state.folderId === UNCATEGORIZED_ID,
        system: true,
        ico: icon('inbox', 15),
      })
    );
    const roots = data.folders
      .filter((f) => !f.system && f.parentId === null)
      .sort((a, b) => a.order - b.order);
    for (const f of roots) appendFolderRows(rail, data, f, 0);
    rail.append(
      h(
        'button',
        { class: 'rail-add', title: '在顶层新建文件夹', onclick: () => newFolderDialog(null) },
        icon('folderPlus', 14),
        '新建文件夹'
      )
    );
  }

  function appendFolderRows(container, data, folder, depth) {
    const children = data.folders.filter((f) => f.parentId === folder.id);
    const isExpanded = state.colExpanded.has(folder.id);
    const row = railRow({
      data,
      id: folder.id,
      kind: 'col-folder',
      name: folder.name,
      count: data.items.filter((it) => it.folderId === folder.id).length,
      active: state.folderId === folder.id,
      depth,
      hasChildren: children.length > 0,
      expanded: isExpanded,
      ico: icon('folder', 15),
    });
    row.setAttribute('aria-expanded', String(isExpanded));
    container.append(row);
    if (children.length) {
      const childWrap = h('div', {
        class: `folder-children${isExpanded ? ' is-expanded' : ''}`,
        dataset: { parentFolder: folder.id },
      });
      for (const c of children.sort((a, b) => a.order - b.order)) {
        appendFolderRows(childWrap, data, c, depth + 1);
      }
      container.append(childWrap);
    }
  }

  function railRow({ data, id, kind, name, count, active, system, depth = 0, hasChildren, expanded: isOpen, ico }) {
    const row = h('div', {
      class: `rail-row${active ? ' active' : ''}${system ? ' system' : ''}`,
      draggable: system || kind === 'col-all' ? null : 'true',
      tabindex: '0',
      'aria-label': `${name}，${count || 0} 项`,
      'aria-expanded': hasChildren ? String(!!isOpen) : null,
      dataset: {
        id,
        kind,
        ...(system ? { system: '1', nodrag: '1' } : kind === 'col-all' ? { nodrag: '1' } : {}),
      },
    });
    row.style.paddingLeft = `${8 + depth * 12}px`;

    const caret = hasChildren
      ? h('span', { class: `caret${isOpen ? ' open' : ''}` }, icon('chevron', 13))
      : h('span', { class: 'caret ph' });

    const actions = h('span', { class: 'row-actions' });
    if (kind === 'col-folder' && !system) {
      actions.append(
        actBtn('plus', '新建子文件夹', () => newFolderDialog(id)),
        actBtn('edit', '重命名', () => renameFolderDialog(id)),
        actBtn('trash', '删除', () => deleteFolderDialog(id))
      );
    }

    row.append(caret, ico, h('span', { class: 'row-title', title: name, text: name }));
    if (count != null) row.append(h('span', { class: 'row-count', text: String(count) }));
    row.append(actions);

    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions') || e.target.closest('.caret')) return;
      state.folderId = id;
      renderAll();
    });
    if (hasChildren) {
      row.querySelector('.caret').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleColExpand(id);
      });
    }
    if (kind === 'col-folder') {
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const items = [];
        if (!system) items.push({ label: '新建子文件夹', icon: 'folderPlus', onClick: () => newFolderDialog(id) });
        items.push(
          { label: '打开文件夹收藏', icon: 'folder', onClick: () => { state.folderId = id; renderAll(); } }
        );
        if (!system) {
          items.push(
            { sep: true },
            { label: '重命名', icon: 'edit', onClick: () => renameFolderDialog(id) },
            { label: '移动到…', icon: 'swap', onClick: () => moveFolderPicker(id) },
            { label: '删除', icon: 'trash', danger: true, onClick: () => deleteFolderDialog(id) }
          );
        }
        contextMenu(e.clientX, e.clientY, items);
      });
    }
    return row;
  }

  function actBtn(name, title, onClick) {
    return h('button', { class: 'act-btn', title, onclick: (e) => { e.stopPropagation(); onClick(); } }, icon(name, 13));
  }

  function toggleColExpand(id) {
    const expanded = !state.colExpanded.has(id);
    if (expanded) state.colExpanded.add(id);
    else state.colExpanded.delete(id);
    const safeId = CSS.escape(id);
    const childWrap = rail.querySelector(`.folder-children[data-parent-folder="${safeId}"]`);
    const row = rail.querySelector(`.rail-row[data-id="${safeId}"]`);
    childWrap?.classList.toggle('is-expanded', expanded);
    row?.setAttribute('aria-expanded', String(expanded));
    row?.querySelector('.caret')?.classList.toggle('open', expanded);
  }

  // ———— 右侧列表 ————

  function renderList(data) {
    renderHeader(data);
    const tagMap = collectTags(data);
    renderTagChips(tagMap);
    scroll.replaceChildren();

    const visibleIds = new Set(data.items.map((it) => it.id));
    for (const id of [...selectedItems]) if (!visibleIds.has(id)) selectedItems.delete(id);
    const inFolder = (it) => state.folderId === 'all' || it.folderId === state.folderId;
    const tagOk = (it) =>
      [...state.tagFilter].every((t) => (it.tags || []).some((x) => x.toLowerCase() === t.toLowerCase()));
    const match = data.items.filter((it) => inFolder(it) && tagOk(it));
    const custom = data.settings.sortMode === 'custom';
    const sorted = [...match].sort(
      custom ? (a, b) => a.order - b.order : (a, b) => b.createdAt - a.createdAt
    );
    const pinned = sorted.filter((it) => it.pinned);
    const rest = sorted.filter((it) => !it.pinned);

    if (!match.length) {
      scroll.append(emptyState(data));
      return;
    }
    if (pinned.length) {
      scroll.append(sectionLabel(icon('pin', 13), '置顶'));
      pinned.forEach((it) => scroll.append(card(it, data, sorted)));
    }
    if (rest.length) {
      if (pinned.length && !custom) scroll.append(sectionLabel(icon('clock', 13), '最近收藏'));
      rest.forEach((it) => scroll.append(card(it, data, sorted)));
    }
  }

  function renderHeader(data) {
    const title =
      state.folderId === 'all' ? '全部收藏' : nameOf(state.folderId, data);
    const count = data.items.filter(
      (it) => state.folderId === 'all' || it.folderId === state.folderId
    ).length;
    const custom = data.settings.sortMode === 'custom';
    const selectButton = h('button', {
      class: `icon-btn selection-toggle${selectionMode ? ' active' : ''}`,
      title: selectionMode ? '退出选择模式' : '进入选择模式',
      onclick: () => {
        selectionMode = !selectionMode;
        if (!selectionMode) selectedItems.clear();
        renderAll();
      },
    }, icon('check', 14));
    const selectionToolbar = selectionMode ? h('span', { class: 'selection-toolbar' },
      h('span', { class: 'selection-count', text: `已选 ${selectedItems.size}` }),
      h('button', { class: 'text-btn', onclick: () => selectVisible(data) }, '全选'),
      h('button', { class: 'text-btn', onclick: () => { selectedItems.clear(); renderAll(); } }, '清除')
    ) : null;
    const headerChildren = [
      h(
        'button',
        {
          class: 'icon-btn',
          title: state.railExpanded() ? '收起文件夹栏' : '展开文件夹栏',
          onclick: async () => {
            const next = !state.railExpanded();
            await updateSettings({ railExpanded: next });
            renderAll();
          },
        },
        icon('folder', 15)
      ),
      h('span', { class: 'list-title', text: title }),
      h('span', { class: 'list-count', text: `${count}` }),
      selectionToolbar,
      selectButton,
      h('span', { class: 'flex1' }),
      h(
        'span',
        { class: 'seg' },
        h('button', {
          class: `seg-btn${!custom ? ' active' : ''}`,
          title: '按收藏时间排序',
          onclick: () => setSortMode('time'),
        }, icon('clock', 13), '时间'),
        h('button', {
          class: `seg-btn${custom ? ' active' : ''}`,
          title: '按自定义顺序（拖拽）排序',
          onclick: () => setSortMode('custom'),
        }, icon('swap', 13), '自定义')
      ),
    ].filter(Boolean);
    header.replaceChildren(...headerChildren);
  }

  async function setSortMode(mode) {
    if (ctx.getData().settings.sortMode === mode) return;
    await updateSettings({ sortMode: mode });
    renderAll();
  }

  function selectVisible(data) {
    const inFolder = (it) => state.folderId === 'all' || it.folderId === state.folderId;
    const tagOk = (it) => [...state.tagFilter].every((t) => (it.tags || []).some((x) => x.toLowerCase() === t.toLowerCase()));
    data.items.filter((it) => inFolder(it) && tagOk(it)).forEach((it) => selectedItems.add(it.id));
    renderAll();
  }

  function toggleItemSelection(itemId, event, visibleItems) {
    if (event.shiftKey && selectionAnchor) {
      const start = visibleItems.findIndex((it) => it.id === selectionAnchor);
      const end = visibleItems.findIndex((it) => it.id === itemId);
      if (start >= 0 && end >= 0) {
        const [lo, hi] = start < end ? [start, end] : [end, start];
        if (!event.ctrlKey && !event.metaKey) selectedItems.clear();
        visibleItems.slice(lo, hi + 1).forEach((it) => selectedItems.add(it.id));
      }
    } else if (event.ctrlKey || event.metaKey || selectionMode) {
      if (selectedItems.has(itemId)) selectedItems.delete(itemId);
      else selectedItems.add(itemId);
    } else {
      selectedItems.clear();
      selectedItems.add(itemId);
    }
    selectionAnchor = itemId;
    syncItemSelection(itemId);
    return true;
  }

  function syncItemSelection() {
    scroll.querySelectorAll('.card[data-kind="col-item"]').forEach((el) => {
      const selected = selectedItems.has(el.dataset.id);
      el.classList.toggle('is-selected', selected);
      el.setAttribute('aria-pressed', String(selected));
    });
    header.querySelector('.selection-count')?.replaceChildren(
      document.createTextNode(`已选 ${selectedItems.size}`)
    );
  }

  function renderTagChips(tagMap) {
    const tags = [...tagMap.entries()].sort((a, b) => b[1] - a[1]);
    if (!tags.length) return placeChips(null);
    const chips = h('div', { class: 'tag-chips' });
    for (const [tag, n] of tags) {
      const selected = [...state.tagFilter].some((t) => t.toLowerCase() === tag.toLowerCase());
      const chip = h(
        'button',
        { class: `tag-chip${selected ? ' selected' : ''}`, title: '点击按标签筛选' },
        `#${tag}`,
        h('span', { class: 'tag-count', text: String(n) })
      );
      chip.addEventListener('click', () => {
        const key = tag.toLowerCase();
        const hit = [...state.tagFilter].find((t) => t.toLowerCase() === key);
        if (hit) state.tagFilter.delete(hit);
        else state.tagFilter.add(tag);
        renderAll();
      });
      chips.append(chip);
    }
    if (state.tagFilter.size) {
      const clear = h('button', { class: 'tag-chip clear', title: '清除标签筛选' }, icon('close', 12), '清除');
      clear.addEventListener('click', () => {
        state.tagFilter.clear();
        renderAll();
      });
      chips.append(clear);
    }
    placeChips(chips);
  }

  function placeChips(el) {
    const old = document.getElementById('tag-chips');
    if (old) old.remove();
    if (el) {
      el.id = 'tag-chips';
      header.after(el);
    }
  }

  function sectionLabel(ico, text) {
    return h('div', { class: 'section-label' }, ico, text ? h('span', { text }) : h('span', { class: 'flex1' }));
  }

  function card(item, data, visibleItems) {
    const row = h('div', {
      class: `card${selectedItems.has(item.id) ? ' is-selected' : ''}`,
      draggable: 'true',
      tabindex: '0',
      role: 'button',
      'aria-pressed': String(selectedItems.has(item.id)),
      'aria-label': `${item.title || item.url}，${hostOf(item.url) || item.url}`,
      dataset: { id: item.id, kind: 'col-item' },
    });
    const actions = h('span', { class: 'row-actions card-actions' }, h('span', { class: 'flex1' }),
      actBtn('pin', item.pinned ? '取消置顶' : '置顶', () => togglePin(item)),
      actBtn('edit', '编辑', () => editItemDialog(item)),
      actBtn('swap', '剪切到文件夹', () => moveItemPicker(item)),
      actBtn('trash', '删除', () => deleteItem(item))
    );
    const titleRow = h(
      'div',
      { class: 'card-top' },
      faviconEl(item.url, 16),
      h('span', { class: 'card-title', text: item.title || item.url }),
      actions
    );
    const metaBits = [hostOf(item.url) || item.url.slice(0, 40)];
    if (state.folderId === 'all') metaBits.push(nameOf(item.folderId, data));
    metaBits.push(fmtTime(item.createdAt));
    const meta = h('div', { class: 'card-meta' }, metaBits.map((t) => h('span', { text: t })));
    row.append(titleRow, meta);

    if ((item.tags || []).length) {
      const tags = h('div', { class: 'card-tags' });
      for (const t of item.tags) {
        const chip = h('button', { class: 'mini-tag', text: `#${t}` });
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          state.tagFilter.add(t);
          renderAll();
        });
        tags.append(chip);
      }
      row.append(tags);
    }
    if (item.note) row.append(h('div', { class: 'card-note', text: item.note }));

    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions') || e.target.closest('.mini-tag')) return;
      if (e.detail > 1) return;
      toggleItemSelection(item.id, e, visibleItems);
    });
    row.addEventListener('dblclick', (e) => {
      if (e.target.closest('.row-actions, .mini-tag')) return;
      openUrl(item.url, { newTab: true });
    });
    row.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.row-actions, .mini-tag')) {
        e.preventDefault();
        openUrl(item.url, { newTab: true });
      }
    });
    row.addEventListener('auxclick', (e) => {
      if (e.button === 1 && !e.target.closest('.row-actions')) {
        e.preventDefault();
        openUrl(item.url, { newTab: true });
      }
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { label: '在新标签页打开', icon: 'open', onClick: () => openUrl(item.url, { ctrlKey: true }) },
        { label: '编辑', icon: 'edit', onClick: () => editItemDialog(item) },
        { label: item.pinned ? '取消置顶' : '置顶', icon: 'pin', onClick: () => togglePin(item) },
        { label: '移动到…', icon: 'swap', onClick: () => moveItemPicker(item) },
        { sep: true },
        { label: '删除', icon: 'trash', danger: true, onClick: () => deleteItem(item) },
      ]);
    });
    return row;
  }

  function emptyState(data) {
    if (state.folderId === 'all' && data.items.length === 0) {
      return h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty-ico' }, icon('bookmark', 40)),
        h('div', { class: 'empty-title', text: '还没有收藏' }),
        h('div', { class: 'empty-hint', text: '按 Ctrl+Shift+S，或点击右上角 ＋ 一键收藏当前网页' }),
        h('button', { class: 'btn btn-primary', onclick: () => ctx.collectCurrent() }, icon('plus', 14), '收藏当前页')
      );
    }
    if (state.tagFilter.size) {
      return h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty-ico' }, icon('search', 36)),
        h('div', { class: 'empty-title', text: '没有符合条件的收藏' }),
        h(
          'button',
          { class: 'btn btn-ghost', onclick: () => { state.tagFilter.clear(); renderAll(); } },
          '清除标签筛选'
        )
      );
    }
    return h(
      'div',
      { class: 'empty' },
      h('div', { class: 'empty-ico' }, icon('folder', 36)),
      h('div', { class: 'empty-title', text: '此文件夹暂无收藏' }),
      h('div', { class: 'empty-hint', text: '把收藏条目拖到左侧文件夹上即可移动' })
    );
  }

  // ———— 条目操作 ————

  async function togglePin(item) {
    await setItemPinned(item.id, !item.pinned);
    await ctx.refresh();
    toast(item.pinned ? '已取消置顶' : '已置顶');
  }

  async function deleteItem(item) {
    const ok = await confirmDialog({
      title: '删除收藏',
      message: `删除「${item.title || item.url}」？（不影响 Chrome 书签）`,
      okLabel: '删除',
    });
    if (!ok) return;
    await removeItem(item.id);
    await ctx.refresh();
    toast('已删除');
  }

  function moveItemPicker(item) {
    const data = ctx.getData();
    const m = h('div', { class: 'picker' });
    let modalApi;
    const options = [
      { id: UNCATEGORIZED_ID, name: '未分类', depth: 0 },
      ...flattenFolders(data.folders),
    ];
    for (const f of options) {
      if (f.id === item.folderId) continue;
      const row = h(
        'div',
        { class: 'picker-row' },
        h('span', { class: 'row-ico folder' }, icon('folder', 15)),
        h('span', { class: 'row-title', text: f.name })
      );
      row.style.paddingLeft = `${8 + f.depth * 14}px`;
      row.addEventListener('click', async () => {
        modalApi.close();
        await moveItem(item.id, { folderId: f.id });
        await ctx.refresh();
        toast(`已移动到「${f.name}」`);
      });
      m.append(row);
    }
    modalApi = showModal({
      title: `移动「${item.title || item.url}」到…`,
      body: m,
      buttons: [{ label: '取消', kind: 'ghost' }],
    });
  }

  function editItemDialog(item) {
    const data = ctx.getData();
    const allTags = [...collectTags(data).keys()];
    const tags = [...(item.tags || [])];
    const folderOptions = [
      { value: UNCATEGORIZED_ID, label: '未分类' },
      ...flattenFolders(data.folders).map((f) => ({
        value: f.id,
        label: '　'.repeat(f.depth) + f.name,
      })),
    ];

    const titleInput = h('input', { type: 'text', value: item.title || '', spellcheck: 'false' });
    const urlInput = h('input', { type: 'text', value: item.url, spellcheck: 'false' });
    const folderSelect = h('select', {});
    for (const o of folderOptions) {
      const opt = h('option', { value: o.value }, o.label);
      if (o.value === item.folderId) opt.selected = true;
      folderSelect.append(opt);
    }
    const noteInput = h('textarea', { rows: 4, placeholder: '记录为什么收藏、关键内容…' });
    noteInput.value = item.note || '';

    const chipWrap = h('div', { class: 'chip-editor' });
    const tagInput = h('input', { type: 'text', placeholder: '输入标签，回车添加', list: 'tag-suggest', spellcheck: 'false' });
    const dl = h('datalist', { id: 'tag-suggest' });
    for (const t of allTags) dl.append(h('option', { value: t }));
    chipWrap.append(dl);

    function renderChips() {
      [...chipWrap.querySelectorAll('.chip')].forEach((c) => c.remove());
      for (const t of tags) {
        const chip = h(
          'span',
          { class: 'chip' },
          `#${t}`,
          h('button', { class: 'chip-x', title: '移除' }, icon('close', 11))
        );
        chip.querySelector('.chip-x').addEventListener('click', () => {
          tags.splice(tags.indexOf(t), 1);
          renderChips();
        });
        chipWrap.insertBefore(chip, tagInput);
      }
    }
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
        e.preventDefault();
        const v = tagInput.value.trim().replace(/^#+/, '');
        if (v && !tags.some((t) => t.toLowerCase() === v.toLowerCase()) && tags.length < 12) tags.push(v);
        tagInput.value = '';
        renderChips();
      } else if (e.key === 'Backspace' && !tagInput.value && tags.length) {
        tags.pop();
        renderChips();
      }
    });
    renderChips();
    chipWrap.append(tagInput);

    const body = h(
      'div',
      { class: 'form' },
      formField('标题', titleInput),
      formField('网址', urlInput),
      formField('文件夹', folderSelect),
      formField('标签', chipWrap),
      formField('备注', noteInput)
    );

    showModal({
      title: '编辑收藏',
      body,
      buttons: [
        {
          label: '删除',
          kind: 'danger',
          onClick: async (close) => {
            close();
            await deleteItem(item);
          },
        },
        { label: '取消', kind: 'ghost' },
        {
          label: '保存',
          kind: 'primary',
          onClick: async (close) => {
            try {
              await updateItem(item.id, {
                title: titleInput.value,
                url: urlInput.value,
                folderId: folderSelect.value,
                tags,
                note: noteInput.value,
              });
              close();
              await ctx.refresh();
              toast('已保存');
            } catch (err) {
              toast(err.message || String(err), 'error');
            }
          },
        },
      ],
    });
  }

  function formField(label, control) {
    return h('label', { class: 'form-field' }, h('span', { class: 'form-label', text: label }), control);
  }

  // ———— 文件夹操作 ————

  async function newFolderDialog(parentId) {
    const v = await formDialog({
      title: parentId ? '新建子文件夹' : '新建文件夹',
      fields: [{ key: 'name', label: '名称', value: '', placeholder: '文件夹名称' }],
      validate: (vals) => (vals.name ? null : '名称不能为空'),
    });
    if (!v) return;
    const folder = await addFolder(v.name, parentId);
    state.colExpanded.add(parentId || folder.id);
    await ctx.refresh();
    toast('已创建文件夹');
  }

  async function renameFolderDialog(id) {
    const data = ctx.getData();
    const f = data.folders.find((x) => x.id === id);
    if (!f) return;
    const v = await formDialog({
      title: '重命名文件夹',
      fields: [{ key: 'name', label: '名称', value: f.name }],
      validate: (vals) => (vals.name ? null : '名称不能为空'),
    });
    if (!v) return;
    await renameFolder(id, v.name);
    await ctx.refresh();
    toast('已保存');
  }

  async function deleteFolderDialog(id) {
    const data = ctx.getData();
    const f = data.folders.find((x) => x.id === id);
    if (!f) return;
    if (f.system) {
      toast('「未分类」不能删除', 'error');
      return;
    }
    const doomed = collectDescendants(data, id);
    const n = data.items.filter((it) => doomed.has(it.folderId)).length;
    const ok = await confirmDialog({
      title: '删除文件夹',
      message: `删除文件夹「${f.name}」？其中 ${n} 个收藏将移入「未分类」，子文件夹将一并删除。`,
      okLabel: '删除',
    });
    if (!ok) return;
    await removeFolder(id);
    if (doomed.has(state.folderId)) state.folderId = 'all';
    await ctx.refresh();
    toast('已删除');
  }

  function collectDescendants(data, id) {
    const set = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of data.folders) {
        if (f.parentId && set.has(f.parentId) && !set.has(f.id)) {
          set.add(f.id);
          grew = true;
        }
      }
    }
    return set;
  }

  function moveFolderPicker(id) {
    const data = ctx.getData();
    const folders = flattenFolders(data.folders).filter(
      (f) => f.id !== id && !isDescendantFolder(data.folders, id, f.id) && f.id !== UNCATEGORIZED_ID
    );
    const m = h('div', { class: 'picker' });
    let modalApi;
    const top = h(
      'div',
      { class: 'picker-row' },
      h('span', { class: 'row-ico folder' }, icon('folder', 15)),
      h('span', { class: 'row-title', text: '（顶层）' })
    );
    top.addEventListener('click', async () => {
      modalApi.close();
      await moveFolder(id, { parentId: null });
      await ctx.refresh();
      toast('已移动到顶层');
    });
    m.append(top);
    for (const f of folders) {
      const row = h(
        'div',
        { class: 'picker-row' },
        h('span', { class: 'row-ico folder' }, icon('folder', 15)),
        h('span', { class: 'row-title', text: f.name })
      );
      row.style.paddingLeft = `${8 + f.depth * 14}px`;
      row.addEventListener('click', async () => {
        modalApi.close();
        await moveFolder(id, { parentId: f.id });
        state.colExpanded.add(f.id);
        await ctx.refresh();
        toast(`已移动到「${f.name}」`);
      });
      m.append(row);
    }
    modalApi = showModal({
      title: '移动文件夹到…',
      body: m,
      buttons: [{ label: '取消', kind: 'ghost' }],
    });
  }

  function flattenFolders(folders) {
    const out = [];
    const walk = (parent, depth) => {
      for (const f of folders
        .filter((x) => x.parentId === parent && !x.system)
        .sort((a, b) => a.order - b.order)) {
        out.push({ id: f.id, name: f.name, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  // ———— 拖拽（列表 + 文件夹栏两个容器，通过 dndBus 支持跨容器） ————

  createDnd({
    container: scroll,
    rowSelector: '.card',
    getPayload: (row) => {
      const ids = selectedItems.has(row.dataset.id) && selectedItems.size > 1
        ? [...selectedItems]
        : [row.dataset.id];
      return { kind: 'col-item', id: row.dataset.id, ids, count: ids.length };
    },
    policy: (drag, row) => {
      if (drag.kind !== 'col-item') return null;
      if (!row) return { zones: ['append'] };
      if (row.dataset.id === drag.id || (drag.ids || []).includes(row.dataset.id)) return null;
      return { zones: ['before', 'after'] };
    },
    onDrop: async (drag, row, zone) => {
      const ids = drag.ids || [drag.id];
      if (zone === 'append') {
        for (const id of ids) await moveItem(id, {});
      } else {
        const target = ctx.getData().items.find((it) => it.id === row.dataset.id);
        if (!target) return;
        if (ctx.getData().settings.sortMode !== 'custom') {
          await updateSettings({ sortMode: 'custom' });
          toast('已切换为自定义排序');
        }
        const ordered = zone === 'before' ? [...ids].reverse() : ids;
        for (const id of ordered) {
          await moveItem(id, {
            folderId: target.folderId,
            ...(zone === 'before' ? { beforeId: target.id } : { afterId: target.id }),
          });
        }
      }
      selectedItems.clear();
      await ctx.refresh();
    },
  });

  createDnd({
    container: rail,
    rowSelector: '.rail-row',
    getPayload: (row) => (row.dataset.nodrag ? null : { kind: 'col-folder', id: row.dataset.id }),
    policy: (drag, row) => {
      if (!row) return null;
      if (row.dataset.kind === 'col-all') return null;
      if (drag.kind === 'col-item') return { zones: ['into'] };
      if (drag.kind === 'col-folder') {
        if (row.dataset.id === drag.id) return null;
        if (row.dataset.system === '1') return null;
        return { zones: ['before', 'into', 'after'] };
      }
      return null;
    },
    onDrop: async (drag, row, zone) => {
      if (drag.kind === 'col-item') {
        if (row.dataset.kind === 'col-all') return;
        await moveItem(drag.id, { folderId: row.dataset.id });
        await ctx.refresh();
        toast(`已移动到「${nameOf(row.dataset.id, ctx.getData())}」`);
        return;
      }
      if (zone === 'into') {
        if (row.dataset.system === '1') throw new Error('不能移入「未分类」');
        await moveFolder(drag.id, { parentId: row.dataset.id });
        state.colExpanded.add(row.dataset.id);
      } else {
        await moveFolder(drag.id, zone === 'before' ? { beforeId: row.dataset.id } : { afterId: row.dataset.id });
      }
      await ctx.refresh();
    },
  });

  // railExpanded 的读取代理（值本体保存在 settings 中）
  state.railExpanded = () => ctx.getData().settings.railExpanded !== false;

  return { renderAll };
}
