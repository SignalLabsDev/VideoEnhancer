(function(){
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});

  // IDs and keys
  const FILTER_ID = `video-enhancer-filter-${Math.random().toString(36).slice(2)}`;
  VN.ids = {
    FILTER_ID,
    DATA_APPLIED_KEY: 'videoEnhancerApplied',
    DATA_ORIGINAL_FILTER_KEY: 'videoEnhancerOriginalFilter',
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

  VN.state = {
    enabled: true,
    panelVisible: false,
    activeTab: 'preset',
    compatibilityMode: false,
    overlayEnabled: true,
    settings: { ...VN.DEFAULT_SETTINGS },
    panelPosition: { useCustom: false, top: 80, left: null }
  };

  VN.consts = {
    STORAGE_KEY: 'videoEnhancerState',
    STORAGE_VERSION: 1,
    PERSIST_DEBOUNCE_MS: 250,
    MIN_TARGET_WIDTH: 320,
    MIN_TARGET_HEIGHT: 180
  };

  // Persistence
  let persistTimer = null;
  let lastPersistTime = 0;
  
  const buildPersistSnapshot = () => ({
    version: VN.consts.STORAGE_VERSION,
    timestamp: Date.now(),
    data: {
      enabled: VN.state.enabled,
      panelVisible: VN.state.panelVisible,
      activeTab: VN.state.activeTab,
      compatibilityMode: VN.state.compatibilityMode,
      overlayEnabled: VN.state.overlayEnabled,
      settings: { ...VN.state.settings },
      panelPosition: { ...VN.state.panelPosition }
    }
  });

  VN.schedulePersist = () => {
    if (!chrome?.storage?.local) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      lastPersistTime = Date.now();
      const snapshot = buildPersistSnapshot();
      try { chrome.storage.local.set({ [VN.consts.STORAGE_KEY]: snapshot }); } catch (_) {}
    }, VN.consts.PERSIST_DEBOUNCE_MS);
  };

  // Apply state from storage (used for cross-tab sync)
  const applyStorageState = (snapshot, skipPanelVisible = true) => {
    if (!snapshot) return false;
    
    let changed = false;
    
    if (typeof snapshot.enabled === 'boolean' && VN.state.enabled !== snapshot.enabled) {
      VN.state.enabled = snapshot.enabled;
      changed = true;
    }
    
    // Skip panelVisible sync - each tab manages its own panel
    if (!skipPanelVisible && typeof snapshot.panelVisible === 'boolean') {
      VN.state.panelVisible = snapshot.panelVisible;
    }
    
    if ((snapshot.activeTab === 'custom' || snapshot.activeTab === 'preset') && VN.state.activeTab !== snapshot.activeTab) {
      VN.state.activeTab = snapshot.activeTab;
      changed = true;
    }
    
    if (typeof snapshot.compatibilityMode === 'boolean' && VN.state.compatibilityMode !== snapshot.compatibilityMode) {
      VN.state.compatibilityMode = snapshot.compatibilityMode;
      changed = true;
    }
    
    if (typeof snapshot.overlayEnabled === 'boolean' && VN.state.overlayEnabled !== snapshot.overlayEnabled) {
      VN.state.overlayEnabled = snapshot.overlayEnabled;
      changed = true;
    }
    
    if (snapshot.settings && typeof snapshot.settings === 'object') {
      ['sharpen','contrast','saturation','brightness','gamma'].forEach((k) => {
        if (typeof snapshot.settings[k] === 'number' && VN.state.settings[k] !== snapshot.settings[k]) {
          VN.state.settings[k] = snapshot.settings[k];
          changed = true;
        }
      });
    }
    
    // Sync panel position
    if (snapshot.panelPosition && typeof snapshot.panelPosition === 'object') {
      VN.state.panelPosition = {
        useCustom: Boolean(snapshot.panelPosition.useCustom),
        top: typeof snapshot.panelPosition.top === 'number' ? snapshot.panelPosition.top : VN.state.panelPosition.top,
        left: typeof snapshot.panelPosition.left === 'number' ? snapshot.panelPosition.left : VN.state.panelPosition.left
      };
    }
    
    return changed;
  };

  // Listen for storage changes from other tabs
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      
      const change = changes[VN.consts.STORAGE_KEY];
      if (!change || !change.newValue) return;
      
      const payload = change.newValue;
      const timestamp = payload.timestamp || 0;
      
      // Ignore changes we just made (within 500ms)
      if (timestamp && lastPersistTime && Math.abs(timestamp - lastPersistTime) < 500) {
        return;
      }
      
      const snapshot = payload.data && typeof payload.data === 'object' ? payload.data : payload;
      const changed = applyStorageState(snapshot, true);
      
      if (changed) {
        // Update UI and effects
        VN.overlay?.refresh?.();
        VN.overlay?.updateState?.();
        VN.panel?.syncUI?.();
        VN.panel?.broadcastState?.();
        
        if (VN.state.enabled) {
          VN.scheduleRefresh?.('cross-tab-sync');
        } else {
          VN.updateAllVideos?.(null);
        }
      }
    });
  }

  VN.loadPersistedState = () => new Promise((resolve) => {
    if (!chrome?.storage?.local) { resolve(); return; }
    try {
      chrome.storage.local.get(VN.consts.STORAGE_KEY, (result) => {
        const payload = result?.[VN.consts.STORAGE_KEY];
        const snapshot = payload && typeof payload === 'object'
          ? (payload.data && typeof payload.data === 'object' ? payload.data : payload)
          : null;
        
        // On initial load, apply everything including panelVisible
        applyStorageState(snapshot, false);
        resolve();
      });
    } catch (_) { resolve(); }
  });
})();
