const stableJsonCore = value => {
  if (Array.isArray(value)) return "[" + value.map(stableJsonCore).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).filter(key => !key.startsWith("_cloud")).sort()
      .map(key => JSON.stringify(key) + ":" + stableJsonCore(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
};

export const ACCOUNTING_SOURCES = ["invoices", "production", "settings"];
export const accountingVersionKey = source => "mgr6-accounting-version-" + source;
export const accountingHashKey = source => "mgr6-accounting-hash-" + source;
export const accountingConflictKey = source => "mgr6-accounting-conflict-" + source;

export function accountingSourceForRow(row) {
  const source = String(row?.src || "");
  if (source === "doc" || source === "vch") return "invoices";
  if (source === "po" || source === "wo") return "production";
  return "settings";
}

export function accountingPayloadForSource(state, source) {
  const belongs = row => accountingSourceForRow(row) === source;
  return {
    ledger: (Array.isArray(state.L) ? state.L : []).filter(belongs),
    movements: (Array.isArray(state.mv) ? state.mv : []).filter(belongs),
    work_orders: source === "production" && Array.isArray(state.wo) ? state.wo : [],
    journal_entries: source === "settings" && Array.isArray(state.je) ? state.je : []
  };
}

export function accountingHash(payload) {
  const value = stableJsonCore(payload);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function replaceAccountingPayload(state, source, payload) {
  const ledger = Array.isArray(payload?.ledger) ? payload.ledger : [];
  const movements = Array.isArray(payload?.movements) ? payload.movements : [];
  state.L = (Array.isArray(state.L) ? state.L : []).filter(row => accountingSourceForRow(row) !== source).concat(ledger);
  state.mv = (Array.isArray(state.mv) ? state.mv : []).filter(row => accountingSourceForRow(row) !== source).concat(movements);
  if (source === "production") state.wo = Array.isArray(payload?.work_orders) ? payload.work_orders : [];
  if (source === "settings") state.je = Array.isArray(payload?.journal_entries) ? payload.journal_entries : [];
}

export function recalcAccountingInventory(state) {
  if (!Array.isArray(state.items)) return;
  state.items.forEach(item => { item.st = {}; item.val = 0; });
  (Array.isArray(state.mv) ? state.mv : []).forEach(move => {
    const item = state.items.find(candidate => String(candidate.id) === String(move.iid));
    if (!item) return;
    const variant = String(move.v || "-");
    item.st[variant] = (Number(item.st[variant]) || 0) + (Number(move.q) || 0);
    item.val = (Number(item.val) || 0) + (Number(move.val) || 0);
  });
}
