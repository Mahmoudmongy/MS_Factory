const nativeStorage = {
  get: Storage.prototype.getItem,
  set: Storage.prototype.setItem,
  remove: Storage.prototype.removeItem,
  key: Storage.prototype.key,
  clear: Storage.prototype.clear
};

export function activateUserStorage(profile) {
  if (!profile?.id) throw new Error("A signed-in profile ID is required for local storage isolation");

  const proto = Storage.prototype;
  let adminId = profile.is_admin === true ? profile.id : null;

  if (!adminId) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = nativeStorage.key.call(localStorage, i);
      if (!key || !key.startsWith("factory-profile:")) continue;
      try {
        const cached = JSON.parse(nativeStorage.get.call(localStorage, key) || "null");
        if (cached?.is_admin === true && cached.id) { adminId = cached.id; break; }
      } catch (_) {}
    }
  }

  const pendingAdminPrefix = "factory-user:__pending_admin__:";
  const legacyKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = nativeStorage.key.call(localStorage, i);
    if (key && key.startsWith("mgr6")) legacyKeys.push(key);
  }

  if (adminId) {
    const pendingKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = nativeStorage.key.call(localStorage, i);
      if (key && key.startsWith(pendingAdminPrefix)) pendingKeys.push(key);
    }
    for (const oldKey of pendingKeys) {
      const logicalKey = oldKey.slice(pendingAdminPrefix.length);
      const destination = "factory-user:" + adminId + ":" + logicalKey;
      if (nativeStorage.get.call(localStorage, destination) === null) {
        const value = nativeStorage.get.call(localStorage, oldKey);
        if (value !== null) nativeStorage.set.call(localStorage, destination, value);
      }
      nativeStorage.remove.call(localStorage, oldKey);
    }
  }

  const legacyOwner = adminId || "__pending_admin__";
  for (const key of legacyKeys) {
    const destination = "factory-user:" + legacyOwner + ":" + key;
    if (nativeStorage.get.call(localStorage, destination) === null) {
      const value = nativeStorage.get.call(localStorage, key);
      if (value !== null) nativeStorage.set.call(localStorage, destination, value);
    }
    nativeStorage.remove.call(localStorage, key);
  }

  window.__factoryStorageUserId = String(profile.id);
  if (!proto.__factoryUserScoped) {
    const mapKey = key => {
      const value = String(key);
      return value.startsWith("mgr6")
        ? "factory-user:" + String(window.__factoryStorageUserId) + ":" + value
        : value;
    };
    Object.defineProperty(proto, "__factoryUserScoped", { value: true });
    proto.getItem = function(key) { return nativeStorage.get.call(this, mapKey(key)); };
    proto.setItem = function(key, value) { return nativeStorage.set.call(this, mapKey(key), value); };
    proto.removeItem = function(key) { return nativeStorage.remove.call(this, mapKey(key)); };
    proto.clear = function() {
      const prefix = "factory-user:" + String(window.__factoryStorageUserId) + ":";
      const remove = [];
      for (let i = 0; i < this.length; i++) {
        const key = nativeStorage.key.call(this, i);
        if (key && key.startsWith(prefix)) remove.push(key);
      }
      remove.forEach(key => nativeStorage.remove.call(this, key));
    };
  }
}
