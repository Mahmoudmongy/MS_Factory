// Keep each authenticated account's local-first workspace and sync metadata separate.
// This prevents normal application flows from reusing another account's cached state.
// It is not a security boundary against a person with developer-tools access to this origin.
let activeUserId = null;
let wrapped = false;
let nativeGet, nativeSet, nativeRemove;

const isAccountScopedKey = key =>
  key === "mgr6" ||
  key === "mgr6pref" ||
  key === "mgr6-sync-pending" ||
  key.startsWith("mgr6-cloud-") ||
  key.startsWith("mgr6-backup-");

function mappedKey(key) {
  const value = String(key);
  return isAccountScopedKey(value) ? value + "::" + activeUserId : value;
}

export function scopeFactoryStorage(profile, storage = globalThis.localStorage) {
  if (!profile || typeof profile.id !== "string" || !profile.id.trim()) {
    throw new Error("A verified authenticated profile is required before loading factory data.");
  }
  if (!storage) throw new Error("Local storage is unavailable.");

  const id = profile.id.trim();
  const proto = Object.getPrototypeOf(storage);
  if (!wrapped) {
    nativeGet = proto.getItem;
    nativeSet = proto.setItem;
    nativeRemove = proto.removeItem;
    wrapped = true;
  }

  // Migrate the old unscoped workspace only to its verified factory administrator.
  // If an employee signs in first, quarantine the legacy value instead of showing it
  // in that employee's workspace. The value is preserved for the administrator.
  const scopedStateKey = "mgr6::" + id;
  const existingScopedState = nativeGet.call(storage, scopedStateKey);
  const legacyState = nativeGet.call(storage, "mgr6");
  const legacyOwner = nativeGet.call(storage, "mgr6-legacy-owner");
  const quarantinedState = nativeGet.call(storage, "mgr6-legacy-unassigned");

  if (!existingScopedState) {
    const mayClaimLegacy = profile.is_admin === true || legacyOwner === id;
    const candidate = legacyState || quarantinedState;
    if (mayClaimLegacy && candidate && (!legacyOwner || legacyOwner === id)) {
      nativeSet.call(storage, scopedStateKey, candidate);
      nativeSet.call(storage, "mgr6-backup-before-account-scope::" + id, candidate);
      nativeSet.call(storage, "mgr6-legacy-owner", id);
      if (legacyState) nativeRemove.call(storage, "mgr6");
      if (quarantinedState) nativeRemove.call(storage, "mgr6-legacy-unassigned");
    } else if (!profile.is_admin && legacyState && !legacyOwner && !quarantinedState) {
      nativeSet.call(storage, "mgr6-legacy-unassigned", legacyState);
      nativeRemove.call(storage, "mgr6");
    }
  }

  activeUserId = id;
  if (!proto.__msFactoryAccountScope) {
    Object.defineProperty(proto, "__msFactoryAccountScope", { value: true, configurable: false });
    proto.getItem = function(key) { return nativeGet.call(this, mappedKey(key)); };
    proto.setItem = function(key, value) { return nativeSet.call(this, mappedKey(key), value); };
    proto.removeItem = function(key) { return nativeRemove.call(this, mappedKey(key)); };
  }
  return { userId: id, stateKey: scopedStateKey };
}

export function getActiveFactoryStorageUser() {
  return activeUserId;
}
