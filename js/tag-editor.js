// 标签编辑界面：单条编辑用的标签输入框、批量编辑弹窗，以及标签的全局改名 / 合并 / 删除。
// 收藏页签和 Chrome 书签页签共用；数据修改都走 store.js，按网址生效（两边同网址共用标签）。

import { h, icon, showModal, formDialog, confirmDialog, toast, toastAction } from './ui.js';
import { t } from './i18n.js';
import { MAX_TAGS, buildTagIndex, cleanTag, countTags, normalizeTags, tagKey, tagUsage, urlKey } from './tag-model.js';
import { deleteTag, editTagsForUrls, renameTag, restoreTagSnapshot } from './store.js';

let inputSeq = 0;

// 标签输入框：回车、英文逗号、中文逗号添加；输入框为空时退格删掉最后一个。
// 外层请用 div 而不是 label：label 会把点击转给第一个按钮（也就是第一个标签的删除键）。
export function createTagInput({ tags = [], suggestions = [], placeholder = t('collection.tagsPlaceholder') } = {}) {
  const list = normalizeTags(tags);
  const wrap = h('div', { class: 'chip-editor' });
  const listId = `tag-suggest-${++inputSeq}`;
  const input = h('input', { type: 'text', placeholder, list: listId, spellcheck: 'false' });
  const datalist = h('datalist', { id: listId });
  for (const name of suggestions) datalist.append(h('option', { value: name }));
  wrap.append(datalist, input);

  function render() {
    wrap.querySelectorAll('.chip').forEach((chip) => chip.remove());
    for (const name of list) {
      const remove = h('button', { class: 'chip-x', type: 'button', title: t('collection.remove') }, icon('close', 11));
      remove.addEventListener('click', () => {
        list.splice(list.indexOf(name), 1);
        render();
      });
      const chip = h('span', { class: 'chip' }, `#${name}`, remove);
      if (input.parentNode === wrap) wrap.insertBefore(chip, input);
      else wrap.append(chip);
    }
  }
  function commit() {
    const value = cleanTag(input.value);
    if (value && !list.some((name) => tagKey(name) === tagKey(value)) && list.length < MAX_TAGS) list.push(value);
    input.value = '';
    render();
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && list.length) {
      list.pop();
      render();
    }
  });
  render();
  return {
    el: wrap,
    // 保存时把输入框里还没按回车的内容也算进去。
    getTags() {
      if (input.value.trim()) commit();
      return [...list];
    },
  };
}

function field(label, control) {
  return h('div', { class: 'form-field' }, h('span', { class: 'form-label', text: label }), control);
}

function offerUndo(message, snapshot, onDone, undoChange) {
  toastAction(message, t('tags.undo'), async () => {
    try {
      await restoreTagSnapshot(snapshot);
      await onDone?.(undoChange);
      toast(t('tags.undone'));
    } catch (error) {
      toast(error.message || String(error), 'error');
    }
  });
}

// 批量编辑弹窗。urls 是选中书签的网址（收藏条目或 Chrome 书签），去重后一起修改。
export function openBatchTagEditor({ urls, data, onDone }) {
  const keys = [...new Set((urls || []).map(urlKey).filter(Boolean))];
  if (!keys.length) return;
  const total = keys.length;
  const index = buildTagIndex(data);
  const coverage = new Map();
  for (const key of keys) {
    for (const name of index.get(key) || []) {
      const entry = coverage.get(tagKey(name)) || { id: tagKey(name), name, count: 0 };
      entry.count++;
      coverage.set(entry.id, entry);
    }
  }
  const existing = [...coverage.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const removing = new Set();
  const filling = new Set();

  const list = h('div', { class: 'tag-batch-list' });
  function toggle(set, other, id) {
    other.delete(id);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    renderList();
  }
  function renderList() {
    list.replaceChildren();
    if (!existing.length) {
      list.append(h('div', { class: 'tag-batch-empty', text: t('tags.noneExisting') }));
      return;
    }
    for (const entry of existing) {
      const isRemoving = removing.has(entry.id);
      const isFilling = filling.has(entry.id);
      const row = h('div', { class: `tag-batch-row${isRemoving ? ' is-removing' : ''}${isFilling ? ' is-filling' : ''}` },
        h('span', { class: 'tag-batch-name', text: `#${entry.name}` }),
        h('span', { class: 'tag-batch-count', text: `${isRemoving ? 0 : isFilling ? total : entry.count}/${total}` })
      );
      if (entry.count < total) {
        row.append(h('button', {
          class: `text-btn tag-batch-fill${isFilling ? ' active' : ''}`,
          type: 'button',
          title: t(isFilling ? 'tags.unfillTitle' : 'tags.fillTitle'),
          'aria-pressed': String(isFilling),
          onclick: () => toggle(filling, removing, entry.id),
        }, t('tags.fill')));
      }
      row.append(h('button', {
        class: `act-btn tag-batch-remove${isRemoving ? ' active' : ''}`,
        type: 'button',
        title: t(isRemoving ? 'tags.keepTitle' : 'tags.removeTitle'),
        'aria-pressed': String(isRemoving),
        onclick: () => toggle(removing, filling, entry.id),
      }, icon('close', 12)));
      list.append(row);
    }
  }
  renderList();

  const adding = createTagInput({ suggestions: countTags(data).map((entry) => entry.name) });
  const replaceBox = h('input', { type: 'checkbox' });
  replaceBox.addEventListener('change', () => list.classList.toggle('is-disabled', replaceBox.checked));
  const body = h('div', { class: 'form tag-batch' },
    field(t('tags.existing'), list),
    field(t('tags.add'), adding.el),
    h('label', { class: 'tag-batch-replace' }, replaceBox, h('span', { text: t('tags.replace') }))
  );

  let busy = false;
  showModal({
    title: t('tags.batchTitle', { COUNT: total }),
    body,
    buttons: [
      { label: t('button.cancel'), kind: 'ghost' },
      {
        label: t('tags.apply', { COUNT: total }),
        kind: 'primary',
        onClick: async (close) => {
          if (busy) return;
          const added = adding.getTags();
          const edit = replaceBox.checked
            ? { replace: true, add: added }
            : {
              add: [...existing.filter((entry) => filling.has(entry.id)).map((entry) => entry.name), ...added],
              remove: existing.filter((entry) => removing.has(entry.id)).map((entry) => entry.name),
            };
          if (!edit.replace && !edit.add.length && !edit.remove.length) {
            toast(t('tags.noChanges'), 'error');
            return;
          }
          busy = true;
          try {
            const result = await editTagsForUrls(keys, edit);
            close();
            await onDone?.();
            if (!result.changed) {
              toast(result.limited ? t('tags.limited', { COUNT: result.limited }) : t('tags.noChanges'), result.limited ? 'error' : 'ok');
              return;
            }
            const message = result.limited
              ? `${t('tags.updated', { COUNT: result.changed })} · ${t('tags.limitedShort', { COUNT: result.limited })}`
              : t('tags.updated', { COUNT: result.changed });
            offerUndo(message, result.snapshot, onDone);
          } catch (error) {
            toast(error.message || String(error), 'error');
          } finally {
            busy = false;
          }
        },
      },
    ],
  });
}

// ———— 全局改名 / 合并 / 删除（侧边栏标签条右键） ————
// onDone(change) 会收到 { from, to }，便于调用方同步标签筛选；撤销时收到反向的 change。

async function changeTagGlobally(from, to, { merge, getData, onDone }) {
  const usage = tagUsage(getData(), from);
  const ok = await confirmDialog({
    title: t('tags.globalTitle'),
    message: t(merge ? 'tags.confirmMerge' : 'tags.confirmRename', { FROM: from, TO: to, COUNT: usage.count, RULES: usage.rules }),
    okLabel: t('button.confirm'),
    danger: false,
  });
  if (!ok) return;
  try {
    const result = await renameTag(from, to);
    await onDone?.({ from, to });
    offerUndo(t(merge ? 'tags.merged' : 'tags.renamed', { TAG: to }), result.snapshot, onDone, merge ? null : { from: to, to: from });
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
}

// 改名时输入已有的标签名就是合并。
export async function renameTagGlobally(tag, { getData, onDone }) {
  const values = await formDialog({
    title: t('tags.renameTitle', { TAG: tag }),
    fields: [{ key: 'name', label: t('tags.newName'), value: tag, hint: t('tags.renameHint') }],
    validate: (vals) => (cleanTag(vals.name) ? null : t('tags.nameRequired')),
  });
  if (!values) return;
  const target = cleanTag(values.name);
  if (target === tag) {
    toast(t('tags.sameName'), 'error');
    return;
  }
  const existing = countTags(getData()).find((entry) => tagKey(entry.name) === tagKey(target) && tagKey(entry.name) !== tagKey(tag));
  await changeTagGlobally(tag, existing ? existing.name : target, { merge: !!existing, getData, onDone });
}

export function mergeTagGlobally(tag, { getData, onDone }) {
  const others = countTags(getData()).filter((entry) => tagKey(entry.name) !== tagKey(tag));
  if (!others.length) {
    toast(t('tags.noOtherTags'), 'error');
    return;
  }
  const picker = h('div', { class: 'picker' });
  let modal = null;
  for (const entry of others) {
    const row = h('div', { class: 'picker-row' },
      h('span', { class: 'row-ico' }, icon('tag', 14)),
      h('span', { class: 'row-title', text: `#${entry.name}` }),
      h('span', { class: 'row-count', text: String(entry.count) })
    );
    row.addEventListener('click', () => {
      modal.close();
      changeTagGlobally(tag, entry.name, { merge: true, getData, onDone });
    });
    picker.append(row);
  }
  modal = showModal({
    title: t('tags.mergeTitle', { TAG: tag }),
    body: picker,
    buttons: [{ label: t('button.cancel'), kind: 'ghost' }],
  });
}

export async function deleteTagGlobally(tag, { getData, onDone }) {
  const usage = tagUsage(getData(), tag);
  const ok = await confirmDialog({
    title: t('tags.globalTitle'),
    message: t('tags.confirmDelete', { TAG: tag, COUNT: usage.count, RULES: usage.rules }),
    okLabel: t('tags.delete'),
  });
  if (!ok) return;
  try {
    const result = await deleteTag(tag);
    await onDone?.({ from: tag, to: null });
    offerUndo(t('tags.deleted', { TAG: tag }), result.snapshot, onDone);
  } catch (error) {
    toast(error.message || String(error), 'error');
  }
}
