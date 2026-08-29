// 通用拖拽控制器（两个页签共用）。
// 三区判定：目标行 上25% = 插入在前(before)，中50% = 放入文件夹(into)，下25% = 插入在后(after)。
// 目标不是文件夹时只有 before/after（上下各 50%）。
// 跨容器拖拽通过模块级 dndBus 共享当前拖拽负载（收藏条目可拖到左侧文件夹栏）。

import { h, toast } from './ui.js';

// 当前拖拽负载：{ kind, id }，dragstart 时设置，dragend 清空
export const dndBus = { drag: null };

// Chromium BookmarkModel::Move 源码核实：同层移动时内部会做 index--（且
// index == old_index / old_index+1 视为无操作），因此调用方传“原数组语义”的
// 插入位置即可：before = target.index，after = target.index + 1，无需自行 -1。
export function chromeMoveIndex(targetNode, zone) {
  return targetNode.index + (zone === 'after' ? 1 : 0);
}

// 同层移动是否实际无变化（避免无谓的 API 调用）
export function isSamePlace(draggedNode, parentId, index) {
  return (
    draggedNode.parentId === parentId &&
    (index === draggedNode.index || index === draggedNode.index + 1)
  );
}

// 文件夹防循环：沿 targetId 的祖先链向上找，命中 draggedId 则拒绝
export function wouldCycle(nodesById, draggedId, targetFolderId) {
  let cur = nodesById.get(targetFolderId);
  while (cur) {
    if (cur.id === draggedId) return true;
    cur = cur.parentId ? nodesById.get(cur.parentId) : null;
  }
  return false;
}

/**
 * 创建一个拖拽控制器。
 * @param {Object} opts
 * @param {HTMLElement} opts.container   监听拖拽事件的容器（position:relative）
 * @param {string} opts.rowSelector      可作为放置目标的行选择器
 * @param {(rowEl)=>{kind,id}|null} opts.getPayload  dragstart 时从行元素取拖拽负载
 * @param {(payload, rowEl|null)=>{zones:string[], appendTo?:any}|null} opts.policy
 *        rowEl 为 null 表示拖到容器空白处（appendTo 语义）；返回 null 禁止放置
 * @param {(payload, rowEl|null, zone)=>Promise} opts.onDrop
 */
export function createDnd({ container, rowSelector, getPayload, policy, onDrop }) {
  container.classList.add('dnd-container');
  const line = h('div', { class: 'dnd-line' });
  line.style.display = 'none';
  container.append(line);
  let hoverRow = null;

  container.addEventListener('dragstart', (e) => {
    const row = e.target.closest && e.target.closest(rowSelector);
    if (!row || row.dataset.nodrag) {
      e.preventDefault();
      return;
    }
    const payload = getPayload(row);
    if (!payload) {
      e.preventDefault();
      return;
    }
    dndBus.drag = payload;
    const ids = payload.ids || [payload.id];
    container.querySelectorAll(rowSelector).forEach((candidate) => {
      if (ids.includes(candidate.dataset.id)) candidate.classList.add('dragging');
    });
    row.classList.add('drag-primary');
    if (payload.count > 1) {
      row.append(h('span', { class: 'drag-count', text: `${payload.count} 项` }));
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ids.join(','));
  });

  container.addEventListener('dragend', () => {
    dndBus.drag = null;
    container.querySelectorAll('.dragging, .drag-primary').forEach((el) => {
      el.classList.remove('dragging', 'drag-primary');
    });
    container.querySelectorAll('.drag-count').forEach((el) => el.remove());
    hide();
  });

  container.addEventListener('dragover', (e) => {
    if (!dndBus.drag) return;
    const row = e.target.closest && e.target.closest(rowSelector);
    const p = row ? policy(dndBus.drag, row) : policy(dndBus.drag, null);
    if (!p || !p.zones.length) {
      hide();
      return; // 不 preventDefault → 浏览器禁止放置
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const zone = row ? zoneOf(e, row, p.zones) : 'append';
    show(row, zone);
  });

  container.addEventListener('drop', async (e) => {
    if (!dndBus.drag) return;
    e.preventDefault();
    const payload = dndBus.drag;
    const row = hoverRow;
    const zone = row ? row.dataset.dropZone || 'into' : 'append';
    hide();
    dndBus.drag = null;
    container.querySelectorAll('.dragging, .drag-primary').forEach((el) => {
      el.classList.remove('dragging', 'drag-primary');
    });
    container.querySelectorAll('.drag-count').forEach((el) => el.remove());
    if (!row && zone !== 'append') return;
    try {
      await onDrop(payload, row, zone);
    } catch (err) {
      toast(err && err.message ? err.message : String(err), 'error');
    }
  });

  function zoneOf(e, row, zones) {
    const r = row.getBoundingClientRect();
    const y = e.clientY;
    if (!zones.includes('into')) {
      return y < r.top + r.height / 2 ? 'before' : 'after';
    }
    if (y < r.top + r.height * 0.25) return 'before';
    if (y > r.bottom - r.height * 0.25) return 'after';
    return 'into';
  }

  function show(row, zone) {
    if (!container.contains(line)) container.append(line);
    if (hoverRow && hoverRow !== row) {
      hoverRow.classList.remove('drop-into');
      delete hoverRow.dataset.dropZone;
    }
    hoverRow = row;
    if (!row) {
      // 容器空白处：指示线贴底
      line.style.display = 'block';
      line.style.top = `${container.scrollHeight - 1}px`;
      return;
    }
    row.dataset.dropZone = zone;
    if (zone === 'into') {
      row.classList.add('drop-into');
      line.style.display = 'none';
      return;
    }
    row.classList.remove('drop-into');
    const rowBox = row.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();
    const top = rowBox.top - containerBox.top + container.scrollTop + (zone === 'after' ? rowBox.height : 0);
    line.style.display = 'block';
    line.style.top = `${top}px`;
  }

  function hide() {
    line.style.display = 'none';
    if (hoverRow) {
      hoverRow.classList.remove('drop-into');
      delete hoverRow.dataset.dropZone;
      hoverRow = null;
    }
  }
}
