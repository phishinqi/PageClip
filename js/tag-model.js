// 标签的纯计算：规范化、批量编辑、全局改名/删除和自动加标签规则。
// 不访问 chrome.* 或存储，store、导入、后台、界面和测试共用。
// 收藏条目的标签存在条目上；只在 Chrome 书签里的网址，标签存在 data.urlTags（网址 → 标签）。
// 同一网址只存一处，所以收藏和 Chrome 书签按网址共享同一组标签。

export const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 24;
const MAX_RULES = 200;
// Chrome 根目录（以及 HTML 导入时生成的根目录）不作为文件夹标签，结构上判断不出来时按名称兜底。
const ROOT_FOLDER_NAMES = new Set([
  '书签栏', '其他书签', '移动设备书签', '書籤列', '其他書籤', '行動裝置書籤', '浏览器书签',
  'bookmarks bar', 'other bookmarks', 'mobile bookmarks', 'bookmarks toolbar', 'bookmarks menu',
]);

export function cleanTag(raw) {
  return String(raw || '').trim().replace(/^#+/, '').slice(0, MAX_TAG_LENGTH);
}

export function tagKey(tag) {
  return String(tag || '').toLowerCase();
}

export function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,，\s]+/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = cleanTag(raw);
    if (!t) continue;
    const key = tagKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

// 去重但不截断，用于待添加的标签，这样才能统计因上限被跳过的数量。
function uniqueTags(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const t = cleanTag(raw);
    const key = tagKey(t);
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function hasTag(tags, tag) {
  const key = tagKey(cleanTag(tag));
  return (tags || []).some((t) => tagKey(t) === key);
}

export function sameTags(a, b) {
  const left = a || [];
  const right = b || [];
  return left.length === right.length && left.every((t, i) => t === right[i]);
}

// 按顺序补到上限为止；skipped 是因为达到上限而没加上的新标签数。
export function addTags(current, additions) {
  const tags = normalizeTags(current);
  const keys = new Set(tags.map(tagKey));
  let skipped = 0;
  for (const tag of uniqueTags(additions)) {
    const key = tagKey(tag);
    if (keys.has(key)) continue;
    if (tags.length >= MAX_TAGS) {
      skipped++;
      continue;
    }
    tags.push(tag);
    keys.add(key);
  }
  return { tags, skipped };
}

export function removeTags(current, removals) {
  const doomed = new Set(uniqueTags(removals).map(tagKey));
  return normalizeTags(current).filter((t) => !doomed.has(tagKey(t)));
}

// 批量编辑：replace 时 add 就是新的完整标签组，否则先移除再追加。
export function editTags(current, { add = [], remove = [], replace = false } = {}) {
  const before = normalizeTags(current);
  const base = replace ? [] : removeTags(before, remove);
  const { tags, skipped } = addTags(base, add);
  return { tags, skipped, changed: !sameTags(before, tags) };
}

// 改名或合并：from（不区分大小写）原位换成 to；条目上已有 to 时去重，也就是合并。
export function renameInTags(current, from, to) {
  const fromKey = tagKey(cleanTag(from));
  const target = cleanTag(to);
  const tags = normalizeTags(current);
  if (!fromKey || !target || !tags.some((t) => tagKey(t) === fromKey)) return { tags, changed: false };
  const next = normalizeTags(tags.map((t) => (tagKey(t) === fromKey ? target : t)));
  return { tags: next, changed: !sameTags(tags, next) };
}

// ———— 网址标签 ————

export function urlKey(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  try {
    return new URL(value).href;
  } catch {
    return value.slice(0, 2048);
  }
}

export function normalizeUrlTags(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [url, tags] of Object.entries(raw)) {
    const key = urlKey(url);
    if (!key) continue;
    const merged = addTags(out[key] || [], normalizeTags(tags)).tags;
    if (merged.length) out[key] = merged;
  }
  return out;
}

// 网址 → 收藏条目列表（网址通常唯一；万一重复，就一起修改）。
export function itemsByUrlKey(data) {
  const map = new Map();
  for (const item of data?.items || []) {
    const key = urlKey(item.url);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function tagsOf(data, url, items = itemsByUrlKey(data)) {
  const key = urlKey(url);
  const owners = items.get(key);
  if (owners) return owners[0].tags || [];
  return data?.urlTags?.[key] || [];
}

export function writeTags(data, url, tags, items = itemsByUrlKey(data), now = Date.now()) {
  const key = urlKey(url);
  if (!key) return;
  const clean = normalizeTags(tags);
  const owners = items.get(key);
  if (owners) {
    for (const item of owners) {
      if (sameTags(item.tags || [], clean)) continue;
      item.tags = clean;
      item.updatedAt = now;
    }
    return;
  }
  if (!data.urlTags || typeof data.urlTags !== 'object') data.urlTags = {};
  if (clean.length) data.urlTags[key] = clean;
  else delete data.urlTags[key];
}

// 每个带标签的网址只出现一次：收藏条目优先，其余是只在 Chrome 书签里的网址。
function eachTaggedUrl(data, fn, { liveUrls = null } = {}) {
  const items = itemsByUrlKey(data);
  for (const [key, owners] of items) fn(key, owners[0].tags || []);
  for (const [url, tags] of Object.entries(data?.urlTags || {})) {
    const key = urlKey(url);
    if (!key || items.has(key) || (liveUrls && !liveUrls.has(key))) continue;
    fn(key, tags || []);
  }
}

export function taggedUrlKeys(data) {
  const keys = new Set();
  eachTaggedUrl(data, (key, tags) => { if (tags.length) keys.add(key); });
  return keys;
}

export function buildTagIndex(data) {
  const index = new Map();
  eachTaggedUrl(data, (key, tags) => { if (tags.length) index.set(key, tags); });
  return index;
}

// 网址进入收藏时取走 Chrome 书签上的标签，保证同一网址只存一份。
export function takeUrlTags(data, url) {
  const key = urlKey(url);
  const tags = data?.urlTags?.[key];
  if (!tags) return [];
  delete data.urlTags[key];
  return tags;
}

// 新条目的初始标签：自带标签 → 同网址 Chrome 书签上的标签 → 规则（开启自动执行时）。
export function tagsForNewItem(data, { url, title = '', folderName = '', tags = [], applyRules = true } = {}) {
  let result = addTags(tags, takeUrlTags(data, url)).tags;
  const rules = normalizeTagRules(data?.settings?.tagRules);
  if (applyRules && rules.autoApply && hasActiveRules(rules)) {
    result = addTags(result, ruleTagsFor({ url, title, folderName }, rules)).tags;
  }
  return result;
}

// 按不区分大小写合并统计，显示最常用的写法；liveUrls 用来排除已经没有书签的网址。
export function countTags(data, options = {}) {
  const groups = new Map();
  eachTaggedUrl(data, (key, tags) => {
    for (const tag of tags) {
      const group = groups.get(tagKey(tag)) || { count: 0, variants: new Map() };
      group.count++;
      group.variants.set(tag, (group.variants.get(tag) || 0) + 1);
      groups.set(tagKey(tag), group);
    }
  }, options);
  return [...groups.values()]
    .map((group) => ({
      name: [...group.variants.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      count: group.count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function tagUsage(data, tag, options = {}) {
  let count = 0;
  eachTaggedUrl(data, (key, tags) => { if (hasTag(tags, tag)) count++; }, options);
  return { count, rules: countRulesUsing(normalizeTagRules(data?.settings?.tagRules), tag) };
}

// ———— 自动加标签规则 ————

export function normalizeDomain(input) {
  let value = String(input || '').trim().toLowerCase().replace(/^\*\./, '');
  if (!value) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `http://${value}`;
  try {
    return new URL(value).hostname.replace(/^www\./, '').replace(/\.+$/, '');
  } catch {
    return '';
  }
}

function normalizeRuleList(list, field, clean, extra = () => ({})) {
  return (Array.isArray(list) ? list : [])
    .map((rule) => ({ [field]: clean(rule?.[field]), tags: normalizeTags(rule?.tags), ...extra(rule) }))
    .filter((rule) => rule[field] && rule.tags.length)
    .slice(0, MAX_RULES);
}

export function normalizeTagRules(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    autoApply: source.autoApply !== false,
    folder: source.folder === true,
    // Older rules matched a domain and all of its subdomains. Keep that
    // behavior when `match` is absent so existing users do not lose tags.
    domains: normalizeRuleList(source.domains, 'domain', normalizeDomain, (rule) => ({
      match: rule?.match === 'exact' ? 'exact' : 'subdomains',
    })),
    keywords: normalizeRuleList(source.keywords, 'keyword', (value) => String(value || '').trim().slice(0, 100)),
  };
}

export function hasActiveRules(rules) {
  return !!rules && (rules.folder || rules.domains.length > 0 || rules.keywords.length > 0);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// 顺序：域名规则 → 关键词规则 → 文件夹名。域名规则可精确匹配主机名，或包含其下级子域名。
export function ruleTagsFor({ url = '', title = '', folderName = '' } = {}, rules) {
  const out = [];
  const host = hostOf(url);
  for (const rule of rules.domains) {
    const matched = rule.match === 'exact'
      ? host === rule.domain
      : host === rule.domain || host.endsWith(`.${rule.domain}`);
    if (host && matched) out.push(...rule.tags);
  }
  const hay = `${title}\n${url}`.toLowerCase();
  for (const rule of rules.keywords) if (hay.includes(rule.keyword.toLowerCase())) out.push(...rule.tags);
  if (rules.folder && folderName) out.push(folderName);
  return uniqueTags(out);
}

export function folderTagName(name) {
  const value = String(name || '').trim();
  if (!value || ROOT_FOLDER_NAMES.has(value.toLowerCase())) return '';
  return cleanTag(value);
}

// 收藏条目的文件夹名：「未分类」和导入时对应 Chrome 根目录的顶层文件夹不算。
export function collectionFolderName(data, folderId) {
  const folder = (data?.folders || []).find((f) => f.id === folderId);
  if (!folder || folder.system || (folder.imported && !folder.parentId)) return '';
  return folderTagName(folder.name);
}

// Chrome 书签的父文件夹名：根节点（id 0）和它的直接子节点（书签栏、其他书签等）不算。
export function bookmarkFolderName(parent) {
  if (!parent || !parent.parentId || parent.parentId === '0') return '';
  return folderTagName(parent.title);
}

export function collectionRuleEntries(data) {
  return (data?.items || []).map((item) => ({
    url: item.url,
    title: item.title || '',
    folderName: collectionFolderName(data, item.folderId),
  }));
}

// 按层级判断根目录：getTree() 的根是第 0 层，书签栏等是第 1 层，用户文件夹从第 2 层开始。
export function bookmarkRuleEntries(tree) {
  const out = [];
  const walk = (node, parent, depth) => {
    if (!node) return;
    if (node.url) {
      out.push({ url: node.url, title: node.title || '', folderName: parent && depth >= 3 ? folderTagName(parent.title) : '' });
      return;
    }
    for (const child of node.children || []) walk(child, node, depth + 1);
  };
  for (const root of Array.isArray(tree) ? tree : [tree]) walk(root, null, 0);
  return out;
}

// 规则对现有书签的计划：同一网址出现在多处时合并规则标签，只保留真正有变化的网址。
export function planRuleTags(data, entries, rules = normalizeTagRules(data?.settings?.tagRules)) {
  const updates = new Map();
  let limited = 0;
  if (!hasActiveRules(rules)) return { updates, limited };
  const wanted = new Map();
  for (const entry of entries || []) {
    const key = urlKey(entry?.url);
    if (!key) continue;
    const tags = ruleTagsFor(entry, rules);
    if (tags.length) wanted.set(key, [...(wanted.get(key) || []), ...tags]);
  }
  const items = itemsByUrlKey(data);
  for (const [key, tags] of wanted) {
    const current = normalizeTags(tagsOf(data, key, items));
    const result = addTags(current, tags);
    if (result.skipped) limited++;
    if (!sameTags(current, result.tags)) updates.set(key, result.tags);
  }
  return { updates, limited };
}

export function countRulesUsing(rules, tag) {
  return [...rules.domains, ...rules.keywords].filter((rule) => hasTag(rule.tags, tag)).length;
}

export function renameTagInRules(rules, from, to) {
  let changed = 0;
  const map = (list) => list.map((rule) => {
    const result = renameInTags(rule.tags, from, to);
    if (result.changed) changed++;
    return { ...rule, tags: result.tags };
  });
  return { rules: { ...rules, domains: map(rules.domains), keywords: map(rules.keywords) }, changed };
}

export function removeTagFromRules(rules, tag) {
  let changed = 0;
  const map = (list) => list
    .map((rule) => {
      const tags = removeTags(rule.tags, [tag]);
      if (tags.length !== rule.tags.length) changed++;
      return { ...rule, tags };
    })
    .filter((rule) => rule.tags.length);
  return { rules: { ...rules, domains: map(rules.domains), keywords: map(rules.keywords) }, changed };
}
