// Pure progress accounting. Helpers mutate/return only the supplied task; callers
// persist it, own task.phase, and schedule any UI refreshes themselves.
const list = value => Array.isArray(value) ? value : [];
const countOf = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const timestamp = value => Number.isFinite(value) && value >= 0;
const states = new Set(['idle', 'analyzing', 'paused', 'cancelled', 'review', 'failed', 'confirmed']);

function idsOf(items) {
  const ids = new Set();
  for (const item of list(items)) {
    // itemId is the prepared-item schema; id also reconstructs older raw items.
    const id = typeof item === 'string' ? item : item?.itemId ?? item?.id;
    if (typeof id === 'string' && id.length) ids.add(id);
  }
  return ids;
}

function counts(task) {
  const succeeded = idsOf(task.suggestions);
  const failed = idsOf(list(task.failed).flatMap(batch => list(batch?.items)));
  const pending = idsOf(task.pending);
  // A successful result wins over a stale failure or pending entry.
  for (const id of succeeded) { failed.delete(id); pending.delete(id); }
  for (const id of failed) pending.delete(id);
  const processed = succeeded.size + failed.size;
  const total = Math.max(countOf(task.total), processed + pending.size);
  return { total, processed, succeeded: succeeded.size, failed: failed.size, pending: total - processed };
}

function stateOf(task, progress) {
  if (states.has(task.phase)) return task.phase;
  if (task.applied || task.confirmed) return 'confirmed';
  if (task.cancelled) return 'cancelled';
  if (task.paused) return 'paused';
  if (timestamp(task.requestStartedAt)) return 'analyzing';
  // A restored legacy task with unfinished items has no live request to await.
  if (progress.pending) return task.started ? 'paused' : 'idle';
  if (progress.failed) return 'failed';
  if (progress.succeeded) return 'review';
  return 'idle';
}

/**
 * Read-only snapshot; all durations are seconds, rounded up. Unknown ETA is null.
 * total is the larger of task.total and the unique known item union. Missing IDs
 * in an old task's total remain pending. Failed IDs count as processed until the
 * caller removes them from failed and moves them back into pending for a retry.
 * batchIndex is a persisted 1-based request ordinal (0 before any request), never
 * guessed from item counts. batchSize is the last/current actual request size.
 */
export function progressOf(task = {}, now = Date.now()) {
  task = task || {};
  const progress = counts(task);
  const state = stateOf(task, progress);
  const waiting = state === 'analyzing' && timestamp(task.requestStartedAt);
  const waitSeconds = waiting ? Math.ceil(Math.max(0, now - task.requestStartedAt) / 1000) : 0;
  const sampled = countOf(task.sampleProcessed);
  const duration = Number.isFinite(task.sampleDuration) ? Math.max(0, task.sampleDuration) : 0;
  const remainingSeconds = progress.total > 0 && !progress.pending ? 0
    : sampled > 0 && duration > 0 ? Math.ceil(progress.pending * duration / sampled / 1000) : null;
  return {
    ...progress,
    percent: progress.total ? Math.min(100, progress.processed / progress.total * 100) : 0,
    batchIndex: countOf(task.batchIndex),
    batchSize: countOf(task.activeBatchSize),
    waitSeconds,
    remainingSeconds,
    state,
  };
}

/** Start/resume a run. Reset speed samples so pauses never enter its ETA. */
export function beginProgressRun(task, now = Date.now()) {
  task.sampleStartedAt = now;
  task.sampleProcessed = 0;
  task.sampleDuration = 0; // milliseconds of completed requests only
  task.sampleBaselineProcessed = counts(task).processed;
  task.batchIndex = countOf(task.batchIndex);
  task.activeBatchSize = 0;
  task.requestStartedAt = null;
  return task;
}

/** Call just before sending the actual batch (including byte-limited batches). */
export function beginProgressBatch(task, size, now = Date.now()) {
  if (!timestamp(task.sampleStartedAt)) beginProgressRun(task, now);
  task.batchIndex = countOf(task.batchIndex) + 1;
  task.activeBatchSize = countOf(size);
  task.sampleBaselineProcessed = counts(task).processed;
  task.requestStartedAt = now;
  return task;
}

/**
 * Call AFTER updating suggestions/failed and removing the completed pending items.
 * count includes successes + failures, and caps credit; unique processed deltas
 * prevent duplicate/stale results from inflating speed. Call once per request.
 * Aborted requests receive no credit; beginProgressRun discards them on resume.
 */
export function finishProgressBatch(task, count, now = Date.now()) {
  if (!timestamp(task.requestStartedAt)) return task;
  const completed = Math.min(countOf(count), countOf(task.activeBatchSize),
    Math.max(0, counts(task).processed - countOf(task.sampleBaselineProcessed)));
  if (completed > 0) {
    task.sampleProcessed = countOf(task.sampleProcessed) + completed;
    const duration = Number.isFinite(task.sampleDuration) ? Math.max(0, task.sampleDuration) : 0;
    task.sampleDuration = duration + Math.max(0, now - task.requestStartedAt);
  }
  task.requestStartedAt = null;
  return task;
}
