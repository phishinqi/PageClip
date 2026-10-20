// Local topic categorization for outgoing copies only. No model, storage or reverse dictionary.
export const AI_TOPICS_KEY = 'pageclip_ai_topics';
export function normalizeTopicRules(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (input.enabled !== undefined && typeof input.enabled !== 'boolean') ||
      (input.version !== undefined && input.version !== 1)) throw new TypeError('INVALID_TOPIC_RULES');
  return Object.freeze({ version: 1, enabled: input.enabled === true });
}

const technical = /Android|iOS|Windows|Linux|macOS|\bApp\b|\bAPK\b|\bIPA\b|\bDLL\b|\bELF\b|\bSO\b|\bEXE\b|\bWi-?Fi\b|软件|游戏|二进制|协议|密码|补丁|客户端|服务端|程序|无线网络|安全研究|安全测试/i;
const ordinary = /思维|难题|困局|思考|人生|解题/;
const binary = /二进制|\bDLL\b|\bELF\b|\bSO\b|\bEXE\b/i;
const wireless = /\bWi-?Fi\b|无线网络/i;
const game = /游戏/;
const platforms = [['Android', /Android|\bAPK\b/i], ['iOS', /iOS|\bIPA\b/i], ['Windows', /Windows/i], ['Linux', /Linux/i], ['macOS', /macOS/i], ['WiFi', /\bWi-?Fi\b|无线网络/i]];
const resources = [['教程', /教程|从入门到精通/], ['笔记', /笔记/], ['工具', /工具/], ['补丁', /补丁/], ['合集', /合集/], ['下载', /下载/], ['源码', /源码/], ['修改版本', /修改版|修改版本/]];
// Phrase rules precede shorter words. Each match selects a category from its context;
// platform/product names and resource words outside the matched phrase are preserved.
const rules = [
  { pattern: /白盒鉴权脆弱性测试版/g, category: () => '软件修改研究', replacement: () => '非官方修改版' },
  { pattern: /鉴权缺陷验证热补丁\s*PoC/gi, category: () => '授权机制分析', replacement: () => '授权机制分析补丁' },
  { pattern: /授权凭证生成逻辑复现/g, category: () => '授权机制分析', replacement: () => '授权机制分析工具' },
  { pattern: /内存转储与还原解包/g, category: () => '二进制分析', replacement: () => '二进制解包分析' },
  { pattern: /进程内存完整性测试程序/g, category: () => '运行时分析', replacement: context => game.test(context) ? '游戏运行时分析工具' : '进程运行时分析工具' },
  { pattern: /白盒鉴权脆弱性测试/g, category: context => wireless.test(context) ? '无线网络安全测试' : /修改版|修改版本/.test(context) ? '软件修改研究' : '授权机制分析' },
  { pattern: /逆向工程/g, category: context => binary.test(context) ? '二进制分析' : '程序分析' },
  { pattern: /逆向/g, category: context => binary.test(context) ? '二进制分析' : '程序分析' },
  { pattern: /(?<![A-Za-z])Hook(?![A-Za-z])/gi, category: () => '运行时分析', replacement: () => '运行时拦截分析' },
];

function normalizeText(text, context = '') {
  if (typeof text !== 'string') return { text, topics: [], replacements: 0 };
  // An ordinary expression must not become technical merely because of its folder/tag.
  if ((ordinary.test(text) && !technical.test(text)) || !technical.test(text + ' ' + context)) return { text, topics: [], replacements: 0 };
  const source = text, topics = new Set(); let replacements = 0;
  // One pass over alternatives prevents replacements from being normalized again.
  const pattern = new RegExp(rules.map(rule => `(${rule.pattern.source})`).join('|'), 'gi');
  const normalized = source.replace(pattern, (...args) => {
    const offset = args.at(-2), tail = source.slice(offset);
    if (/^逆向(?:思维|思考)/.test(tail) || /^白盒鉴权脆弱性测试(?:难题|困局)/.test(tail)) return args[0];
    const index = args.slice(1, 1 + rules.length).findIndex(value => value !== undefined);
    const rule = rules[index], category = rule.category(context + ' ' + source);
    topics.add(category); replacements++;
    let replacement = rule.replacement ? rule.replacement(context + ' ' + source) : category;
    const prefix = source.slice(0, offset);
    for (const word of ['二进制', '游戏']) {
      if (prefix.endsWith(word) && replacement.startsWith(word)) replacement = replacement.slice(word.length);
    }
    return replacement;
  });
  return { text: normalized, topics: [...topics], replacements };
}

/** An unchanged original is never returned as metadata beside the normalized title. */
export function normalizeBookmarkTopic(item) {
  const context = [item.title, ...(item.tags || []), item.note || ''].join(' ');
  const topics = new Set(); let replacements = 0, fields = 0;
  const apply = value => {
    const result = normalizeText(value, context);
    result.topics.forEach(topic => topics.add(topic));
    replacements += result.replacements; if (result.replacements) fields++;
    return result.text;
  };
  const copy = { ...item, title: apply(item.title), tags: (item.tags || []).map(apply) };
  if (typeof item.note === 'string') copy.note = apply(item.note);
  if (replacements) {
    const resourceText = context + ' ' + copy.title;
    copy.topicHints = {
      platforms: platforms.filter(([, pattern]) => pattern.test(context)).map(([name]) => name),
      topics: [...topics],
      resourceTypes: resources.filter(([, pattern]) => pattern.test(resourceText)).map(([name]) => name),
    };
  }
  return { item: copy, stats: { replacements, fields, bookmarks: replacements ? 1 : 0 } };
}

/** Catalogs carry the same neutral vocabulary as bookmarks. URLs/IDs are untouched. */
export function normalizeTopicPayload(items = [], folders = [], tags = [], newFolders = [], options = {}) {
  const snapshot = normalizeTopicRules(options), stats = { replacements: 0, fields: 0, bookmarks: 0 };
  const add = value => { for (const key of Object.keys(stats)) stats[key] += value[key] || 0; };
  const catalogContext = items.some(item => technical.test([item.title, ...(item.tags || [])].join(' '))) ? '软件' : '';
  const technicalLabel = /^(?:逆向(?:工程)?|Hook|白盒鉴权脆弱性测试|内存转储与还原解包|授权凭证生成逻辑复现)$/i;
  const apply = value => {
    if (!snapshot.enabled) return value;
    // A mixed collection gives context to bare topic labels, not unrelated titles.
    const result = normalizeText(value, typeof value === 'string' && technicalLabel.test(value.trim()) ? catalogContext : '');
    add({ replacements: result.replacements, fields: result.replacements ? 1 : 0 });
    return result.text;
  };
  return {
    items: items.map(item => {
      if (!snapshot.enabled) return { ...item, tags: [...(item.tags || [])] };
      const result = normalizeBookmarkTopic(item); add(result.stats); return result.item;
    }),
    folders: folders.map(folder => ({ ...folder, path: apply(folder.path) })),
    tags: snapshot.enabled ? [...new Set(tags.map(apply))] : [...tags],
    newFolders: newFolders.map(folder => ({ ...folder, name: apply(folder.name) })),
    stats,
  };
}
