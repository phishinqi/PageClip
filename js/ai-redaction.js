// Pure local redaction boundary. No storage, network, dictionary or reverse mapping in output.
export const AI_REDACTION_KEY = 'pageclip_ai_redaction';
export const MAX_REDACTION_WORDS = 500;
export const MAX_REDACTION_WORD_LENGTH = 100;
const PLACEHOLDER_SOURCE = String.raw`\[已脱敏_[1-9]\d*\]`;
const TEXT_FIELDS = new Set(['title', 'name', 'path', 'folderPath', 'note', 'tags', 'existingTags', 'platforms', 'topics', 'resourceTypes']);
const fold = value => value.replace(/[A-Z]/g, c => c.toLowerCase());
function invalid(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/** Normalize once per task and persist that snapshot locally for resume. Throws rather than truncates. */
export function normalizeRedactionRules(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (input.enabled !== undefined && typeof input.enabled !== 'boolean')) throw invalid('INVALID_REDACTION_RULES');
  let source = input.words ?? [];
  if (typeof source === 'string') source = source.split(/\r\n?|\n/);
  if (!Array.isArray(source)) throw invalid('INVALID_REDACTION_RULES');
  const words = [], seen = new Set();
  for (const entry of source) {
    if (typeof entry !== 'string' || /[\r\n]/.test(entry)) throw invalid('INVALID_REDACTION_RULES');
    const word = entry.trim();
    if (!word) continue;
    if (word.length > MAX_REDACTION_WORD_LENGTH) throw invalid('REDACTION_WORD_TOO_LONG');
    const key = fold(word);
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
    if (words.length > MAX_REDACTION_WORDS) throw invalid('REDACTION_TOO_MANY_WORDS');
  }
  return Object.freeze({ enabled: input.enabled === true, words: Object.freeze(words) });
}

/** Recognize placeholders in edited model output, including nested suggestion data. */
export function containsRedactionPlaceholder(value) {
  if (typeof value === 'string') return new RegExp(PLACEHOLDER_SOURCE).test(value);
  if (Array.isArray(value)) return value.some(containsRedactionPlaceholder);
  return !!value && typeof value === 'object' && Object.values(value).some(containsRedactionPlaceholder);
}
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Only English letter case is folded. Every other character is matched literally.
const literalPattern = text => [...text].map(c => /[A-Za-z]/.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : escapePattern(c)).join('');

/**
 * Redact privacy-cleaned payloads before byte budgeting. IDs and relationships are copied verbatim.
 * Indices follow normalized dictionary order, independent of matches/batches; resume needs only rules.
 * stats.fields counts changed string values; a matched URL counts as one replacement and one field.
 */
export function redactPayload(items = [], folders = [], tags = [], newFolders = [], rules = {}) {
  const snapshot = normalizeRedactionRules(rules);
  const stats = { replacements: 0, fields: 0 };
  const entries = snapshot.enabled ? snapshot.words.map((word, index) => ({ word, index: index + 1 })) : [];
  entries.sort((a, b) => b.word.length - a.word.length || a.index - b.index);
  const indices = new Map(entries.map(({ word, index }) => [fold(word), index]));
  // Existing placeholders are opaque, so neither overlaps nor later batches redact generated tokens.
  const pattern = entries.length ? new RegExp(`${PLACEHOLDER_SOURCE}|${entries.map(({ word }) => literalPattern(word)).join('|')}`, 'g') : null;
  const placeholder = new RegExp(`^${PLACEHOLDER_SOURCE}$`);
  function redact(text, wholeUrl = false) {
    if (!pattern) return text;
    pattern.lastIndex = 0;
    let count = 0;
    if (wholeUrl) {
      let match;
      while ((match = pattern.exec(text))) {
        if (placeholder.test(match[0])) continue;
        stats.replacements++; stats.fields++;
        return `[已脱敏_${indices.get(fold(match[0]))}]`;
      }
      return text;
    }
    const result = text.replace(pattern, match => {
      if (placeholder.test(match)) return match;
      count++;
      return `[已脱敏_${indices.get(fold(match))}]`;
    });
    if (count) { stats.replacements += count; stats.fields++; }
    return result;
  }
  function copy(value, textContext = false) {
    if (typeof value === 'string') return textContext ? redact(value) : value;
    if (Array.isArray(value)) return value.map(entry => copy(entry, textContext));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
      key === 'url' && typeof entry === 'string' ? redact(entry, true) : copy(entry, TEXT_FIELDS.has(key))
    ]));
  }
  return { items: copy(items), folders: copy(folders), tags: copy(tags, true), newFolders: copy(newFolders), stats };
}
