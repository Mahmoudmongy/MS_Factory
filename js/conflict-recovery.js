const safeScope = value => String(value || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');

export function createConflictRecovery({ storage = localStorage, cookieDocument = document, scope = 'anonymous' } = {}) {
  const suffix = safeScope(scope);
  const blockKey = 'ms-factory-db-conflict-block-v1:' + scope;
  const reviewKey = 'ms-factory-db-conflict-review-v1:' + scope;
  const cookieKey = 'ms_factory_conflict_block_' + suffix;

  function cookieHasBlock() {
    return String(cookieDocument.cookie || '').split(';').some(part => part.trim().startsWith(cookieKey + '=1'));
  }
  function hasBlock() {
    try { if (storage.getItem(blockKey)) return true; } catch (_) {}
    return cookieHasBlock();
  }
  function persistBlock(metadata = {}) {
    const value = JSON.stringify({ ...metadata, createdAt: metadata.createdAt || new Date().toISOString() });
    try {
      storage.setItem(blockKey, value);
      if (storage.getItem(blockKey) === value) return true;
    } catch (_) {}
    try {
      cookieDocument.cookie = cookieKey + '=1; Path=/; SameSite=Lax; Max-Age=31536000';
      return cookieHasBlock();
    } catch (_) { return false; }
  }
  function clearBlock() {
    try { storage.removeItem(blockKey); } catch (_) {}
    try { cookieDocument.cookie = cookieKey + '=; Path=/; SameSite=Lax; Max-Age=0'; } catch (_) {}
  }
  function readArchives() {
    let raw = null;
    try { raw = storage.getItem(reviewKey); } catch (error) { throw error; }
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('نسخة العمليات المحفوظة غير صالحة؛ لم يتم مسح الطابور.');
    return parsed;
  }
  function archiveRejectedQueue(operations, metadata = {}, queueKey) {
    if (!persistBlock({ ...metadata, operationCount: operations.length })) {
      throw new Error('تعذر حفظ قفل إعادة الإرسال؛ لم يتم لمس طابور العمليات.');
    }
    const prior = readArchives();
    const entry = {
      ...metadata,
      capturedAt: metadata.capturedAt || new Date().toISOString(),
      rejectedOperationCount: operations.length,
      rejectedOperations: operations
    };
    const next = [...prior, entry];
    const serialized = JSON.stringify(next);
    storage.setItem(reviewKey, serialized);
    const verified = JSON.parse(storage.getItem(reviewKey) || 'null');
    if (!Array.isArray(verified) || verified.length !== next.length ||
        verified[verified.length - 1]?.capturedAt !== entry.capturedAt ||
        verified[verified.length - 1]?.rejectedOperationCount !== operations.length) {
      throw new Error('لم يتم التحقق من حفظ نسخة العمليات؛ لم يتم مسح الطابور.');
    }
    // removeItem does not need additional quota. The durable marker remains until this succeeds.
    storage.removeItem(queueKey);
    clearBlock();
    return entry;
  }
  function getExportPayload(queue = [], extra = {}) {
    return {
      format: 'ms-factory-conflict-review-v1',
      exportedAt: new Date().toISOString(),
      scope,
      archives: readArchives(),
      stillQueuedOperations: queue,
      resendBlocked: hasBlock(),
      ...extra
    };
  }
  return { blockKey, reviewKey, cookieKey, hasBlock, persistBlock, clearBlock, readArchives, archiveRejectedQueue, getExportPayload };
}
