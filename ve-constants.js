(function(){
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});

  // Prevent re-initialization if already loaded
  if (VN.constantsInitialized) return;
  VN.constantsInitialized = true;

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
      const snapshot = buildPersistSnapshot();
      try { chrome.storage.local.set({ [VN.consts.STORAGE_KEY]: snapshot }); } catch (_) {}
    }, VN.consts.PERSIST_DEBOUNCE_MS);
  };

  // Apply state from storage (used for cross-tab sync)
  const applyStorageState = (snapshot, skipPanelVisible = true) => {
    if (!snapshot || typeof snapshot !== 'object') return false;
    
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
        const val = snapshot.settings[k];
        if (typeof val === 'number' && !isNaN(val) && isFinite(val) && VN.state.settings[k] !== val) {
          VN.state.settings[k] = val;
          changed = true;
        }
      });
    }
    
    // Sync panel position with validation
    if (snapshot.panelPosition && typeof snapshot.panelPosition === 'object') {
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

  // Per-tab state: Each tab loads from storage on init but doesn't sync with other tabs.
  // This is simpler and more reliable than cross-tab synchronization.

  VN.loadPersistedState = () => new Promise((resolve) => {
    if (!chrome?.storage?.local) { resolve(); return; }
    try {
      chrome.storage.local.get(VN.consts.STORAGE_KEY, (result) => {
        const payload = result?.[VN.consts.STORAGE_KEY];
        const snapshot = payload && typeof payload === 'object'
          ? (payload.data && typeof payload.data === 'object' ? payload.data : payload)
          : null;
        
        // Load all state from storage on init
        applyStorageState(snapshot, false);
        resolve();
      });
    } catch (_) { resolve(); }
  });
})();
