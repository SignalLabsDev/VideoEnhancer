(function(){
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});

  // Prevent re-initialization if already loaded
  if (VN.constantsInitialized) return;
  VN.constantsInitialized = true;

  // IDs and keys
  VN.ids = {
    DATA_APPLIED_KEY: 'videoEnhancerApplied',
    DATA_ORIGINAL_FILTER_KEY: 'videoEnhancerOriginalFilter',
    DATA_ORIGINAL_FILTER_PRIORITY_KEY: 'videoEnhancerOriginalFilterPriority',
    DATA_SETTINGS_KEY: 'videoEnhancerSettingsToken',
    DATA_CURRENT_FILTER_KEY: 'videoEnhancerCurrentFilter'
  };

  // Defaults
  const PRESET_SETTINGS = Object.freeze({
    sharpen: 0.3,
    contrast: 1.0,
    saturation: 1.15,
    brightness: 1.0,
    gamma: 1.1
  });

  VN.DEFAULT_SETTINGS = Object.freeze({
    sharpen: PRESET_SETTINGS.sharpen,
    contrast: PRESET_SETTINGS.contrast,
    saturation: PRESET_SETTINGS.saturation,
    brightness: PRESET_SETTINGS.brightness,
    gamma: PRESET_SETTINGS.gamma
  });

  const SETTING_RANGES = Object.freeze({
    sharpen: [0, 1.5],
    contrast: [0.5, 2],
    saturation: [0.5, 2],
    brightness: [0.5, 2],
    gamma: [0.5, 2]
  });

  VN.normalizeSettings = (settings, fallback = VN.DEFAULT_SETTINGS) => {
    const normalized = {};
    Object.entries(SETTING_RANGES).forEach(([key, [min, max]]) => {
      const value = settings?.[key];
      const fallbackValue = fallback?.[key];
      // Only accept real numbers. Coercing null/''/false would turn a corrupt
      // field into 0 and clamp it to the bottom of the range.
      const safeValue = (typeof value === 'number' && Number.isFinite(value))
        ? value
        : (typeof fallbackValue === 'number' && Number.isFinite(fallbackValue)
          ? fallbackValue
          : VN.DEFAULT_SETTINGS[key]);
      normalized[key] = Number(Math.min(max, Math.max(min, safeValue)).toFixed(3));
    });
    return normalized;
  };

  VN.state = {
    enabled: true,
    panelVisible: false,
    activeTab: 'preset',
    compatibilityMode: false,
    overlayEnabled: true,
    settings: { ...VN.DEFAULT_SETTINGS },
    presets: [],
    panelPosition: { useCustom: false, top: 80, left: null }
  };

  VN.consts = {
    STORAGE_KEY: 'videoEnhancerState',
    STORAGE_VERSION: 1,
    PERSIST_DEBOUNCE_MS: 250,
    MIN_TARGET_WIDTH: 320,
    MIN_TARGET_HEIGHT: 180
  };

  // Persisted payloads are wrapped in a version envelope. Older builds stored a
  // bare object, so accept that shape too, but never guess at a future schema.
  const unwrapPersistedSnapshot = (payload) => {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.version !== undefined && payload.version !== VN.consts.STORAGE_VERSION) return null;
    return (payload.data && typeof payload.data === 'object') ? payload.data : payload;
  };

  // A save used to write the whole snapshot. Two tabs editing at once could put
  // a deleted preset back, because the slower tab still had the old list.
  // Each tab now records only what it changed and merges that into storage.
  const pending = {
    fields: new Set(),
    settings: new Set(),
    presetUpserts: new Set(),
    presetDeletes: new Set()
  };

  const SCALAR_FIELDS = ['enabled', 'panelVisible', 'activeTab', 'compatibilityMode', 'overlayEnabled', 'panelPosition'];
  const settingKeys = () => Object.keys(SETTING_RANGES);

  const noteField = (field) => {
    if (SCALAR_FIELDS.includes(field)) pending.fields.add(field);
  };

  const noteSettings = (keys) => {
    keys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(SETTING_RANGES, key)) pending.settings.add(key);
    });
  };

  VN.notePersistField = noteField;

  VN.notePresetUpsert = (id) => {
    if (typeof id !== 'string' || !id) return;
    pending.presetDeletes.delete(id);
    pending.presetUpserts.add(id);
  };

  VN.notePresetDelete = (id) => {
    if (typeof id !== 'string' || !id) return;
    pending.presetUpserts.delete(id);
    pending.presetDeletes.add(id);
  };

  const noteFromReason = (reason) => {
    if (typeof reason !== 'string' || !reason) return;
    if (reason === 'enabled-toggle' || reason === 'main-toggle') noteField('enabled');
    else if (reason === 'panel-position' || reason === 'panel-position-clamp') noteField('panelPosition');
    else if (reason === 'panel-visibility') noteField('panelVisible');
    else if (reason === 'tab-change') noteField('activeTab');
    else if (reason === 'compatibility-toggle') noteField('compatibilityMode');
    else if (reason === 'overlay-toggle') noteField('overlayEnabled');
    else if (reason === 'settings-reset' || reason === 'preset-apply' || reason === 'settings-import') {
      noteSettings(settingKeys());
    } else if (reason.startsWith('slider-')) {
      noteSettings([reason.slice('slider-'.length)]);
    }
  };

  const sanitizePresetList = (presets) => {
    if (!Array.isArray(presets)) return null;
    return presets
      .slice(0, 50)
      .filter((preset) => preset && typeof preset === 'object')
      .map((preset, index) => {
        const name = typeof preset.name === 'string' ? preset.name.trim().slice(0, 40) : '';
        const id = typeof preset.id === 'string' && preset.id.length <= 100
          ? preset.id
          : `saved-${index}`;
        if (!name) return null;
        return {
          id,
          name,
          settings: VN.normalizeSettings(preset.settings, VN.DEFAULT_SETTINGS)
        };
      })
      .filter(Boolean);
  };

  const clonePreset = (preset) => ({
    id: preset.id,
    name: preset.name,
    settings: { ...preset.settings }
  });

  const samePreset = (a, b) => Boolean(
    a && b && a.id === b.id && a.name === b.name &&
    JSON.stringify(a.settings) === JSON.stringify(b.settings)
  );

  // Copy rather than require a same-realm Set. Tests call this from outside the
  // content-script world, and `instanceof Set` fails across that boundary.
  const asSet = (value) => {
    if (!value) return new Set();
    try { return new Set(value); } catch (_) { return new Set(); }
  };

  const asChangeSets = (changes) => ({
    fields: asSet(changes?.fields),
    settings: asSet(changes?.settings),
    presetUpserts: asSet(changes?.presetUpserts),
    presetDeletes: asSet(changes?.presetDeletes)
  });

  const mergeSettings = (remoteSettings, localSettings, changes) => {
    const base = VN.normalizeSettings(remoteSettings, localSettings);
    changes.settings.forEach((key) => {
      if (localSettings && Object.prototype.hasOwnProperty.call(localSettings, key)) {
        base[key] = localSettings[key];
      }
    });
    return base;
  };

  const mergePresetLists = (remotePresets, localPresets, changes) => {
    const remoteList = sanitizePresetList(remotePresets);
    const localList = sanitizePresetList(localPresets) || [];
    if (!remoteList) return localList.map(clonePreset);
    if (!changes.presetUpserts.size && !changes.presetDeletes.size) {
      return remoteList.map(clonePreset);
    }

    const localById = new Map(localList.map((preset) => [preset.id, preset]));
    const merged = [];
    const seen = new Set();
    remoteList.forEach((preset) => {
      if (changes.presetDeletes.has(preset.id)) return;
      const next = changes.presetUpserts.has(preset.id) && localById.has(preset.id)
        ? localById.get(preset.id)
        : preset;
      merged.push(clonePreset(next));
      seen.add(next.id);
    });
    changes.presetUpserts.forEach((id) => {
      if (seen.has(id) || changes.presetDeletes.has(id)) return;
      const localPreset = localById.get(id);
      if (localPreset) merged.push(clonePreset(localPreset));
    });
    return merged.slice(0, 50);
  };

  const pickBoolean = (field, remote, local, changes) => {
    if (changes.fields.has(field)) return Boolean(local[field]);
    return typeof remote[field] === 'boolean' ? remote[field] : Boolean(local[field]);
  };

  const pickTab = (remote, local, changes) => {
    const raw = changes.fields.has('activeTab') ? local.activeTab : remote.activeTab;
    if (raw === 'custom' || raw === 'preset') return raw;
    return local.activeTab === 'custom' ? 'custom' : 'preset';
  };

  const pickPanelPosition = (remote, local, changes) => {
    const fallback = local.panelPosition || { useCustom: false, top: 80, left: null };
    if (changes.fields.has('panelPosition')) return { ...fallback };
    const pos = remote.panelPosition;
    if (!pos || typeof pos !== 'object') return { ...fallback };
    return {
      useCustom: Boolean(pos.useCustom),
      top: (typeof pos.top === 'number' && Number.isFinite(pos.top)) ? pos.top : fallback.top,
      left: (typeof pos.left === 'number' && Number.isFinite(pos.left)) ? pos.left : fallback.left
    };
  };

  // Pure merge used by the save path and by tests. `changes` says which local
  // fields are allowed to win; everything else stays as stored.
  VN.mergePersistData = (remote, local, changes) => {
    const safeRemote = remote && typeof remote === 'object' ? remote : {};
    const safeLocal = local && typeof local === 'object' ? local : {};
    const safeChanges = asChangeSets(changes);
    const remoteRevision = Number.isFinite(safeRemote.revision) ? safeRemote.revision : 0;
    return {
      enabled: pickBoolean('enabled', safeRemote, safeLocal, safeChanges),
      panelVisible: pickBoolean('panelVisible', safeRemote, safeLocal, safeChanges),
      activeTab: pickTab(safeRemote, safeLocal, safeChanges),
      compatibilityMode: pickBoolean('compatibilityMode', safeRemote, safeLocal, safeChanges),
      overlayEnabled: pickBoolean('overlayEnabled', safeRemote, safeLocal, safeChanges),
      settings: mergeSettings(safeRemote.settings, safeLocal.settings || VN.DEFAULT_SETTINGS, safeChanges),
      presets: mergePresetLists(safeRemote.presets, safeLocal.presets, safeChanges),
      panelPosition: pickPanelPosition(safeRemote, safeLocal, safeChanges),
      revision: remoteRevision + 1
    };
  };

  // Persistence. A failed read must not be treated as "nothing saved", or the
  // next edit would write this tab's defaults over settings that are still there.
  let persistTimer = null;
  let persistInFlight = false;
  let persistQueued = false;
  let persistRetries = 0;
  let storageReadable = false;

  const storageError = () => {
    try { return chrome.runtime?.lastError || null; } catch (_) { return null; }
  };

  const storageIsDead = (error) => /invalidated|context/i.test(String(error?.message || error || ''));

  const hasPending = () => Boolean(
    pending.fields.size || pending.settings.size ||
    pending.presetUpserts.size || pending.presetDeletes.size
  );

  const copyPending = () => ({
    fields: new Set(pending.fields),
    settings: new Set(pending.settings),
    presetUpserts: new Set(pending.presetUpserts),
    presetDeletes: new Set(pending.presetDeletes)
  });

  const buildLocalData = () => ({
    enabled: VN.state.enabled,
    panelVisible: VN.state.panelVisible,
    activeTab: VN.state.activeTab,
    compatibilityMode: VN.state.compatibilityMode,
    overlayEnabled: VN.state.overlayEnabled,
    settings: { ...VN.state.settings },
    presets: VN.state.presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      settings: { ...preset.settings }
    })),
    panelPosition: { ...VN.state.panelPosition }
  });

  const ackPending = (written, captured) => {
    captured.fields.forEach((field) => {
      if (field === 'panelPosition') {
        const now = VN.state.panelPosition;
        const then = written.panelPosition;
        if (now && then && now.useCustom === then.useCustom && now.top === then.top && now.left === then.left) {
          pending.fields.delete(field);
        }
        return;
      }
      if (VN.state[field] === written[field]) pending.fields.delete(field);
    });
    captured.settings.forEach((key) => {
      if (VN.state.settings?.[key] === written.settings?.[key]) pending.settings.delete(key);
    });
    captured.presetUpserts.forEach((id) => {
      const now = VN.state.presets.find((preset) => preset.id === id);
      const then = written.presets.find((preset) => preset.id === id);
      if (samePreset(now, then)) pending.presetUpserts.delete(id);
    });
    captured.presetDeletes.forEach((id) => {
      if (!VN.state.presets.some((preset) => preset.id === id)) pending.presetDeletes.delete(id);
    });
  };

  const finishFlight = (failed) => {
    persistInFlight = false;
    if (!storageReadable) {
      persistQueued = false;
      return;
    }
    if (failed) {
      persistRetries += 1;
      if (persistRetries > 2) return;
      persistQueued = true;
    } else {
      persistRetries = 0;
    }
    if (!persistQueued && !hasPending()) return;
    persistQueued = false;
    if (hasPending()) VN.schedulePersist('retry');
  };

  const flushPersist = () => {
    if (!storageReadable || !chrome?.storage?.local || persistInFlight || !hasPending()) return;
    persistInFlight = true;
    const captured = copyPending();
    try {
      chrome.storage.local.get(VN.consts.STORAGE_KEY, (result) => {
        try {
          const error = storageError();
          if (error) {
            if (storageIsDead(error)) storageReadable = false;
            finishFlight(true);
            return;
          }

          const remote = unwrapPersistedSnapshot(result?.[VN.consts.STORAGE_KEY]);
          const merged = VN.mergePersistData(remote, buildLocalData(), captured);
          const payload = {
            version: VN.consts.STORAGE_VERSION,
            timestamp: Date.now(),
            data: merged
          };
          chrome.storage.local.set({ [VN.consts.STORAGE_KEY]: payload }, () => {
            const setError = storageError();
            if (!setError) ackPending(merged, captured);
            else if (storageIsDead(setError)) storageReadable = false;
            finishFlight(Boolean(setError));
          });
        } catch (_) {
          finishFlight(true);
        }
      });
    } catch (_) {
      persistInFlight = false;
    }
  };

  VN.schedulePersist = (reason) => {
    noteFromReason(reason);
    if (!storageReadable || !chrome?.storage?.local) return;
    if (persistInFlight) {
      persistQueued = true;
      return;
    }
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      flushPersist();
    }, VN.consts.PERSIST_DEBOUNCE_MS);
  };

  // Apply state from storage (used for cross-tab sync)
  const applyStorageState = (snapshot, skipPanelVisible = true) => {
    if (!snapshot || typeof snapshot !== 'object') return false;
    
    let changed = false;
    
    // Unsaved local edits are left alone. Applying the incoming snapshot over
    // them would drop a slider move or preset delete that has not been saved yet.
    const skipField = (field) => pending.fields.has(field);

    if (!skipField('enabled') && typeof snapshot.enabled === 'boolean' && VN.state.enabled !== snapshot.enabled) {
      VN.state.enabled = snapshot.enabled;
      changed = true;
    }
    
    // Skip panelVisible sync - each tab manages its own panel
    if (!skipPanelVisible && !skipField('panelVisible') && typeof snapshot.panelVisible === 'boolean') {
      VN.state.panelVisible = snapshot.panelVisible;
    }
    
    if (!skipField('activeTab') && (snapshot.activeTab === 'custom' || snapshot.activeTab === 'preset') && VN.state.activeTab !== snapshot.activeTab) {
      VN.state.activeTab = snapshot.activeTab;
      changed = true;
    }
    
    if (!skipField('compatibilityMode') && typeof snapshot.compatibilityMode === 'boolean' && VN.state.compatibilityMode !== snapshot.compatibilityMode) {
      VN.state.compatibilityMode = snapshot.compatibilityMode;
      changed = true;
    }
    
    if (!skipField('overlayEnabled') && typeof snapshot.overlayEnabled === 'boolean' && VN.state.overlayEnabled !== snapshot.overlayEnabled) {
      VN.state.overlayEnabled = snapshot.overlayEnabled;
      changed = true;
    }
    
    if (snapshot.settings && typeof snapshot.settings === 'object') {
      const normalizedSettings = VN.normalizeSettings(snapshot.settings, VN.state.settings);
      pending.settings.forEach((key) => {
        if (VN.state.settings && Object.prototype.hasOwnProperty.call(VN.state.settings, key)) {
          normalizedSettings[key] = VN.state.settings[key];
        }
      });
      if (Object.keys(normalizedSettings).some((key) => normalizedSettings[key] !== VN.state.settings[key])) {
        VN.state.settings = normalizedSettings;
        changed = true;
      }
    }

    if (Array.isArray(snapshot.presets)) {
      const normalizedPresets = (pending.presetUpserts.size || pending.presetDeletes.size)
        ? mergePresetLists(snapshot.presets, VN.state.presets, pending)
        : sanitizePresetList(snapshot.presets);
      if (normalizedPresets && JSON.stringify(normalizedPresets) !== JSON.stringify(VN.state.presets)) {
        VN.state.presets = normalizedPresets;
        changed = true;
      }
    }
    
    // Sync panel position with validation
    if (!skipField('panelPosition') && snapshot.panelPosition && typeof snapshot.panelPosition === 'object') {
      const pos = snapshot.panelPosition;
      const newPos = {
        useCustom: Boolean(pos.useCustom),
        top: (typeof pos.top === 'number' && isFinite(pos.top)) ? pos.top : VN.state.panelPosition.top,
        left: (typeof pos.left === 'number' && isFinite(pos.left)) ? pos.left : VN.state.panelPosition.left
      };
      
      if (newPos.useCustom !== VN.state.panelPosition.useCustom || 
          newPos.top !== VN.state.panelPosition.top || 
          newPos.left !== VN.state.panelPosition.left) {
        VN.state.panelPosition = newPos;
        changed = true;
      }
    }
    
    return changed;
  };

  // Panel visibility is per-tab: every tab loads the persisted snapshot on
  // init but panelVisible is not applied from other tabs. Settings and presets
  // do sync through chrome.storage.onChanged below. A save merges this tab's
  // changes into whatever is already stored, so one tab cannot undo another's.

  // Iframe content scripts cannot safely use window.postMessage to ask the top
  // frame to toggle the panel: any page script can forge that message. Relay the
  // request through the extension service worker instead, which only accepts
  // messages from this extension.
  VN.requestPanelToggleFromFrame = () => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    try {
      chrome.runtime.sendMessage({ type: 'VIDEO_ENHANCER_TOGGLE_PANEL_FROM_FRAME' }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  };

  VN.loadPersistedState = () => new Promise((resolve) => {
    if (!chrome?.storage?.local) { resolve(); return; }
    try {
      chrome.storage.local.get(VN.consts.STORAGE_KEY, (result) => {
        // Read the error before anything else. A failed get has no result, and
        // treating that as empty settings would later overwrite the real ones.
        const error = storageError();
        if (error) {
          storageReadable = false;
          resolve();
          return;
        }
        storageReadable = true;
        applyStorageState(unwrapPersistedSnapshot(result?.[VN.consts.STORAGE_KEY]), false);
        resolve();
      });
    } catch (_) { resolve(); }
  });

  // Listen for storage changes to sync state across frames/tabs
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[VN.consts.STORAGE_KEY]) return;
      
      const snapshot = unwrapPersistedSnapshot(changes[VN.consts.STORAGE_KEY].newValue);

      if (applyStorageState(snapshot)) {
        // If state changed, trigger a refresh in this frame
        VN.panel?.syncUI?.();
        VN.scheduleRefresh?.('storage-sync');
        VN.overlay?.refresh?.();
      }
    });
  }

  // Trackpad scrolls arrive as many small movements. They add up to one slider
  // step. A mouse notch is often ~100px, so the old 100px threshold ignored a
  // light swipe. 16px is one step; a larger flick still steps once, and any
  // extra is thrown away so it cannot bank several future steps.
  VN.nextWheelState = (previous, delta, { now = 0, focused = false, idleMs = 320, stepPx = 16, cooldownMs = 32 } = {}) => {
    const stale = !previous || (now - (previous.lastEvent || 0)) > idleMs;
    // lastStep starts one cooldown ago. A brand-new total must be allowed to
    // step immediately; 0 would look like a step that just happened at time 0.
    const state = (!previous || (stale && !focused))
      ? { delta: 0, lastStep: now - cooldownMs, lastEvent: now, claimed: false }
      : { ...previous, lastEvent: now };

    if (!delta) return { state, step: false, consume: false };
    if (state.delta !== 0 && Math.sign(state.delta) !== Math.sign(delta)) state.delta = 0;
    state.delta += delta;

    let step = false;
    if (Math.abs(state.delta) >= stepPx && (now - state.lastStep) >= cooldownMs) {
      const sign = Math.sign(state.delta);
      const leftover = Math.abs(state.delta) % stepPx;
      state.delta = sign * leftover;
      state.lastStep = now;
      state.claimed = true;
      step = true;
    }

    const consume = Boolean(state.claimed || focused || Math.abs(delta) >= stepPx);
    return { state, step, consume };
  };

  /**
   * Deeply collects all video elements, including those inside open Shadow Roots.
   */
  VN.collectVideos = () => {
    const found = [];
    const stack = [document.documentElement];
    const seen = new Set();

    while (stack.length) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);

      if (node instanceof HTMLVideoElement) {
        found.push(node);
        continue;
      }

      if (!(node instanceof Element || node instanceof DocumentFragment || node instanceof Document)) continue;

      if (node instanceof Element) {
        const sr = node.shadowRoot;
        if (sr && sr.mode === 'open') {
          stack.push(sr);
        }
      }

      // Videos are elements; skipping text/comment nodes cuts most of the walk.
      const children = node.children;
      if (!children) continue;
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push(children[i]);
      }
    }
    return found;
  };
})();
