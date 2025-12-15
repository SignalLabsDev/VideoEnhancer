(() => {
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  
  // Helper to always get current state
  const getState = () => VN.state;
  
  const panelApi = {};

  // DOM references
  let panelNode = null;
  let mainToggleButton = null;
  let compatibilityToggleInput = null;
  let overlayToggleInput = null;
  
  const sliderInputs = {
    sharpen: null,
    contrast: null,
    saturation: null,
    brightness: null,
    gamma: null
  };

  const sliderValueLabels = {
    sharpen: null,
    contrast: null,
    saturation: null,
    brightness: null,
    gamma: null
  };

  // Drag state
  const dragState = {
    isDragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startTop: 0,
    startLeft: 0
  };

  // State flags
  let spaHooksInstalled = false;
  let panelWatchdog = null;
  let wired = false;

  // Check if we're in the top frame
  const isTopFrame = (() => {
    try {
      return window.top === window;
    } catch (_) {
      return true;
    }
  })();

  // =========================================================================
  // IFRAME HANDLING - If not top frame, just proxy messages to parent
  // =========================================================================
  if (!isTopFrame) {
    panelApi.ensure = () => {};
    panelApi.syncUI = () => {};
    panelApi.toggle = () => {
      try {
        window.top.postMessage({ __videoEnhancer: true, type: 'VIDEO_ENHANCER_TOGGLE_PANEL' }, '*');
      } catch (_) {}
    };
    panelApi.setVisible = panelApi.toggle;
    panelApi.broadcastState = () => {};

    // Listen for state sync from parent
    window.addEventListener('message', (event) => {
      const data = event?.data;
      if (!data || data.__videoEnhancer !== true) return;

      if (data.type === 'VIDEO_ENHANCER_STATE_SYNC' && data.state) {
        const state = getState();
        if (!state) return;
        
        const s = data.state;
        if (typeof s.enabled === 'boolean') state.enabled = s.enabled;
        if (typeof s.compatibilityMode === 'boolean') state.compatibilityMode = s.compatibilityMode;
        if (typeof s.overlayEnabled === 'boolean') state.overlayEnabled = s.overlayEnabled;
        if (s.settings && typeof s.settings === 'object') {
          ['sharpen','contrast','saturation','brightness','gamma'].forEach((k) => {
            if (typeof s.settings[k] === 'number') state.settings[k] = s.settings[k];
          });
        }
        VN.overlay?.refresh?.();
        VN.overlay?.updateState?.();
        VN.scheduleRefresh?.('state-sync');
      }
    });

    VN.panel = panelApi;
    return;
  }

  // =========================================================================
  // TOP FRAME ONLY - Full panel implementation
  // =========================================================================

  // Utility functions
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const formatPercent = (value) => `${Math.round(value * 100)}%`;

  // Build state snapshot for broadcasting to iframes
  const buildSyncState = () => {
    const state = getState();
    if (!state) return {};
    return {
      enabled: state.enabled,
      compatibilityMode: state.compatibilityMode,
      overlayEnabled: state.overlayEnabled,
      settings: { ...state.settings }
    };
  };

  // Broadcast state to all child iframes
  const broadcastState = () => {
    const message = { __videoEnhancer: true, type: 'VIDEO_ENHANCER_STATE_SYNC', state: buildSyncState() };
    try {
      for (let i = 0; i < window.frames.length; i += 1) {
        try { window.frames[i].postMessage(message, '*'); } catch (_) {}
      }
    } catch (_) {}
  };

  // Reset all DOM references
  const resetDomRefs = () => {
    panelNode = null;
    mainToggleButton = null;
    compatibilityToggleInput = null;
    overlayToggleInput = null;
    wired = false;
    Object.keys(sliderInputs).forEach((k) => { sliderInputs[k] = null; });
    Object.keys(sliderValueLabels).forEach((k) => { sliderValueLabels[k] = null; });
  };

  // =========================================================================
  // UI UPDATE FUNCTIONS
  // =========================================================================

  const applyPanelPosition = () => {
    if (!panelNode) return;
    const state = getState();
    if (!state) return;

    if (state.panelPosition.useCustom && state.panelPosition.left !== null) {
      panelNode.style.top = `${state.panelPosition.top}px`;
      panelNode.style.left = `${state.panelPosition.left}px`;
      panelNode.style.right = 'auto';
    } else {
      panelNode.style.top = '80px';
      panelNode.style.right = '16px';
      panelNode.style.left = 'auto';
    }
  };

  const updatePanelVisibility = () => {
    if (!panelNode) return;
    const state = getState();
    if (!state) return;
    
    if (state.panelVisible) {
      panelNode.classList.remove('video-enhancer-hidden');
    } else {
      panelNode.classList.add('video-enhancer-hidden');
    }
  };

  const setButtonState = (button, isOn, onLabel, offLabel) => {
    if (!button) return;
    button.textContent = isOn ? onLabel : offLabel;
    button.classList.toggle('video-enhancer-button-off', !isOn);
    button.classList.toggle('video-enhancer-button-on', isOn);
  };

  const updateTabStyles = () => {
    if (!panelNode) return;
    const state = getState();
    if (!state) return;

    const tabButtons = panelNode.querySelectorAll('[data-video-enhancer-tab]');
    tabButtons.forEach((button) => {
      const tabName = button.getAttribute('data-video-enhancer-tab');
      const isActive = tabName === state.activeTab;
      button.classList.toggle('video-enhancer-tab-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
      button.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    const tabContents = panelNode.querySelectorAll('[data-video-enhancer-content]');
    tabContents.forEach((content) => {
      const tabName = content.getAttribute('data-video-enhancer-content');
      const isActive = tabName === state.activeTab;
      content.classList.toggle('video-enhancer-tab-content-active', isActive);
      content.setAttribute('aria-hidden', String(!isActive));
    });
  };

  const updateCompatibilityState = () => {
    const state = getState();
    if (!state) return;
    
    const sharpenInput = sliderInputs.sharpen;
    const sharpenLabel = sliderValueLabels.sharpen;
    const sharpenGroup = sharpenInput?.closest('.video-enhancer-slider-group');

    if (sharpenInput && sharpenLabel && sharpenGroup) {
      const isDisabled = state.compatibilityMode;
      sharpenInput.disabled = isDisabled;
      sharpenInput.classList.toggle('video-enhancer-disabled', isDisabled);
      sharpenLabel.classList.toggle('video-enhancer-disabled', isDisabled);
      sharpenGroup.classList.toggle('video-enhancer-disabled', isDisabled);
    }
  };

  const syncSliders = () => {
    const state = getState();
    if (!state) return;
    
    Object.entries(sliderInputs).forEach(([key, input]) => {
      if (!input) return;
      const value = state.settings[key];
      const sliderValue = Math.round(value * 100);
      if (Number(input.value) !== sliderValue) {
        input.value = String(sliderValue);
      }
      const label = sliderValueLabels[key];
      if (label) {
        if (key === 'gamma') {
          label.textContent = value.toFixed(2);
        } else {
          label.textContent = formatPercent(value);
        }
      }
    });
  };

  // Main UI sync function - updates all UI elements to match state
  const syncUI = () => {
    if (!panelNode) return;
    const state = getState();
    if (!state) return;
    
    applyPanelPosition();
    updatePanelVisibility();
    setButtonState(mainToggleButton, state.enabled, 'ON', 'OFF');
    
    if (compatibilityToggleInput) {
      compatibilityToggleInput.checked = state.compatibilityMode;
    }
    if (overlayToggleInput) {
      overlayToggleInput.checked = state.overlayEnabled;
    }
    
    syncSliders();
    updateCompatibilityState();
    updateTabStyles();
    
    // Update overlay button state
    VN.overlay?.updateState?.();
  };

  // =========================================================================
  // EVENT HANDLERS
  // =========================================================================

  const setActiveTab = (tabName) => {
    const state = getState();
    if (!state) return;
    
    const normalized = tabName === 'custom' ? 'custom' : 'preset';
    if (state.activeTab !== normalized) {
      state.activeTab = normalized;
      VN.schedulePersist?.('tab-change');
    }
    updateTabStyles();
  };

  const handleMainToggle = () => {
    const state = getState();
    if (!state) return;
    
    const newEnabled = !state.enabled;
    state.enabled = newEnabled;
    
    syncUI();
    VN.schedulePersist?.('main-toggle');
    
    if (newEnabled) {
      VN.scheduleRefresh?.('main-toggle');
    } else {
      VN.updateAllVideos?.(null);
    }
    
    broadcastState();
  };

  const handleCompatibilityToggle = (event) => {
    const state = getState();
    if (!state) return;
    
    state.compatibilityMode = event?.target?.checked ?? !state.compatibilityMode;
    syncUI();
    VN.schedulePersist?.('compatibility-toggle');
    if (state.enabled) {
      VN.scheduleRefresh?.('compatibility-toggle');
    }
    broadcastState();
  };

  const handleOverlayToggle = (event) => {
    const state = getState();
    if (!state) return;
    
    state.overlayEnabled = event?.target?.checked ?? !state.overlayEnabled;
    
    // Refresh overlay visibility
    VN.overlay?.refresh?.();
    
    syncUI();
    VN.schedulePersist?.('overlay-toggle');
    broadcastState();
  };

  const handleSliderInput = (key, event) => {
    const state = getState();
    if (!state) return;
    
    const rawValue = Number(event.target.value);
    const normalized = rawValue / 100;
    state.settings[key] = Number(normalized.toFixed(3));
    
    const label = sliderValueLabels[key];
    if (label) {
      if (key === 'gamma') {
        label.textContent = state.settings[key].toFixed(2);
      } else {
        label.textContent = formatPercent(state.settings[key]);
      }
    }
    
    VN.schedulePersist?.(`slider-${key}`);
    if (state.enabled) {
      VN.scheduleRefresh?.(`slider-${key}`);
    }
    broadcastState();
  };

  const handlePointerMove = (event) => {
    if (!dragState.isDragging || dragState.pointerId !== event.pointerId) return;
    const state = getState();
    if (!state) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;

    const nextTop = clamp(
      dragState.startTop + deltaY,
      16,
      Math.max(16, window.innerHeight - panelNode.offsetHeight - 16)
    );
    const nextLeft = clamp(
      dragState.startLeft + deltaX,
      16,
      Math.max(16, window.innerWidth - panelNode.offsetWidth - 16)
    );

    state.panelPosition.useCustom = true;
    state.panelPosition.top = nextTop;
    state.panelPosition.left = nextLeft;

    panelNode.style.top = `${nextTop}px`;
    panelNode.style.left = `${nextLeft}px`;
    panelNode.style.right = 'auto';
  };

  const endDrag = (event) => {
    if (!dragState.isDragging || dragState.pointerId !== event.pointerId) return;

    dragState.isDragging = false;
    dragState.pointerId = null;
    if (panelNode && panelNode.hasPointerCapture(event.pointerId)) {
      panelNode.releasePointerCapture(event.pointerId);
    }
    panelNode?.classList.remove('video-enhancer-dragging');
    VN.schedulePersist?.('panel-position');
  };

  // =========================================================================
  // PANEL CREATION AND WIRING
  // =========================================================================

  const wirePanelNode = () => {
    if (!panelNode || !panelNode.isConnected || wired) return;
    wired = true;

    mainToggleButton = panelNode.querySelector('#video-enhancer-main-toggle');
    compatibilityToggleInput = panelNode.querySelector('#video-enhancer-compatibility-toggle');
    overlayToggleInput = panelNode.querySelector('#video-enhancer-overlay-toggle');

    sliderInputs.sharpen = panelNode.querySelector('#video-enhancer-custom-sharpen');
    sliderInputs.contrast = panelNode.querySelector('#video-enhancer-custom-contrast');
    sliderInputs.saturation = panelNode.querySelector('#video-enhancer-custom-saturation');
    sliderInputs.brightness = panelNode.querySelector('#video-enhancer-custom-brightness');
    sliderInputs.gamma = panelNode.querySelector('#video-enhancer-custom-gamma');

    sliderValueLabels.sharpen = panelNode.querySelector('#video-enhancer-custom-sharpen-value');
    sliderValueLabels.contrast = panelNode.querySelector('#video-enhancer-custom-contrast-value');
    sliderValueLabels.saturation = panelNode.querySelector('#video-enhancer-custom-saturation-value');
    sliderValueLabels.brightness = panelNode.querySelector('#video-enhancer-custom-brightness-value');
    sliderValueLabels.gamma = panelNode.querySelector('#video-enhancer-custom-gamma-value');

    // Tab buttons
    const tabButtons = panelNode.querySelectorAll('[data-video-enhancer-tab]');
    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        setActiveTab(button.getAttribute('data-video-enhancer-tab'));
      });
    });

    // Hide button
    panelNode.querySelector('#video-enhancer-hide')?.addEventListener('click', () => {
      panelApi.setVisible(false);
    });

    // Drag handling
    const header = panelNode.querySelector('.video-enhancer-header');
    panelNode.addEventListener('pointermove', handlePointerMove);
    panelNode.addEventListener('pointerup', endDrag);
    panelNode.addEventListener('pointercancel', endDrag);

    header?.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if ((event.target instanceof HTMLElement) && event.target.closest('.video-enhancer-icon-button')) return;

      panelNode.setPointerCapture(event.pointerId);

      const rect = panelNode.getBoundingClientRect();
      dragState.isDragging = true;
      dragState.pointerId = event.pointerId;
      dragState.startX = event.clientX;
      dragState.startY = event.clientY;
      dragState.startTop = rect.top;
      dragState.startLeft = rect.left;

      panelNode.classList.add('video-enhancer-dragging');
      event.preventDefault();
    });

    // Main toggle
    mainToggleButton?.addEventListener('click', handleMainToggle);

    // Checkboxes
    compatibilityToggleInput?.addEventListener('change', handleCompatibilityToggle);
    overlayToggleInput?.addEventListener('change', handleOverlayToggle);

    // Sliders
    sliderInputs.sharpen?.addEventListener('input', (e) => handleSliderInput('sharpen', e));
    sliderInputs.contrast?.addEventListener('input', (e) => handleSliderInput('contrast', e));
    sliderInputs.saturation?.addEventListener('input', (e) => handleSliderInput('saturation', e));
    sliderInputs.brightness?.addEventListener('input', (e) => handleSliderInput('brightness', e));
    sliderInputs.gamma?.addEventListener('input', (e) => handleSliderInput('gamma', e));
  };

  const createPanelNode = () => {
    panelNode = document.createElement('div');
    panelNode.id = 'video-enhancer-panel';
    panelNode.setAttribute('role', 'region');
    panelNode.setAttribute('aria-label', 'Video Enhancer Controls');

    // Start hidden
    panelNode.classList.add('video-enhancer-hidden');

    panelNode.innerHTML = `
      <div class="video-enhancer-header">
        <h1>Video Enhancer</h1>
        <button id="video-enhancer-hide" type="button" class="video-enhancer-icon-button" aria-label="Hide Video Enhancer">&times;</button>
      </div>
      <div class="video-enhancer-tabs" role="tablist" aria-label="Video Enhancer modes">
        <button type="button" class="video-enhancer-tab" role="tab" data-video-enhancer-tab="preset" aria-controls="video-enhancer-tab-preset">Default</button>
        <button type="button" class="video-enhancer-tab" role="tab" data-video-enhancer-tab="custom" aria-controls="video-enhancer-tab-custom">Settings</button>
      </div>
      <div id="video-enhancer-tab-preset" class="video-enhancer-tab-content" role="tabpanel" data-video-enhancer-content="preset" aria-hidden="false">
        <button id="video-enhancer-main-toggle" type="button" class="video-enhancer-primary-button">OFF</button>
        <p class="video-enhancer-note video-enhancer-help-text">Enhance your video experience with customizable filters</p>
      </div>
      <div id="video-enhancer-tab-custom" class="video-enhancer-tab-content" role="tabpanel" data-video-enhancer-content="custom" aria-hidden="true">
        <div class="video-enhancer-slider-group">
          <label class="video-enhancer-slider-label" for="video-enhancer-custom-sharpen">
            <span>Sharpen</span>
            <span id="video-enhancer-custom-sharpen-value">30%</span>
          </label>
          <input id="video-enhancer-custom-sharpen" type="range" min="0" max="150" step="1" value="30" />
        </div>
        <div class="video-enhancer-slider-group">
          <label class="video-enhancer-slider-label" for="video-enhancer-custom-contrast">
            <span>Contrast</span>
            <span id="video-enhancer-custom-contrast-value">110%</span>
          </label>
          <input id="video-enhancer-custom-contrast" type="range" min="50" max="200" step="1" value="110" />
        </div>
        <div class="video-enhancer-slider-group">
          <label class="video-enhancer-slider-label" for="video-enhancer-custom-saturation">
            <span>Saturation</span>
            <span id="video-enhancer-custom-saturation-value">110%</span>
          </label>
          <input id="video-enhancer-custom-saturation" type="range" min="50" max="200" step="1" value="110" />
        </div>
        <div class="video-enhancer-slider-group">
          <label class="video-enhancer-slider-label" for="video-enhancer-custom-brightness">
            <span>Brightness</span>
            <span id="video-enhancer-custom-brightness-value">100%</span>
          </label>
          <input id="video-enhancer-custom-brightness" type="range" min="50" max="200" step="1" value="100" />
        </div>
        <div class="video-enhancer-slider-group">
          <label class="video-enhancer-slider-label" for="video-enhancer-custom-gamma">
            <span>Gamma</span>
            <span id="video-enhancer-custom-gamma-value">1.10</span>
          </label>
          <input id="video-enhancer-custom-gamma" type="range" min="50" max="200" step="1" value="110" />
        </div>
        <div class="video-enhancer-toggle-list">
          <label class="video-enhancer-toggle" for="video-enhancer-compatibility-toggle">
            <input id="video-enhancer-compatibility-toggle" type="checkbox" />
            <span>Compatibility mode</span>
          </label>
          <label class="video-enhancer-toggle" for="video-enhancer-overlay-toggle">
            <input id="video-enhancer-overlay-toggle" type="checkbox" />
            <span>Show overlay button on hover</span>
          </label>
        </div>
      </div>
    `;

    document.documentElement.appendChild(panelNode);
  };

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  // Ensure panel DOM exists (create if needed, wire if not wired)
  panelApi.ensure = () => {
    // If panel exists but is disconnected, reset refs
    if (panelNode && !panelNode.isConnected) {
      resetDomRefs();
    }

    // If panel already exists and is connected, just ensure it's wired
    if (panelNode && panelNode.isConnected) {
      wirePanelNode();
      return;
    }

    // Check if panel already exists in DOM (e.g., from previous injection)
    panelNode = document.getElementById('video-enhancer-panel');
    if (panelNode) {
      wirePanelNode();
      return;
    }

    // Create new panel
    createPanelNode();
    wirePanelNode();
  };

  // Set panel visibility
  panelApi.setVisible = (visible) => {
    const state = getState();
    if (!state) return;
    
    const newVisible = Boolean(visible);
    
    // If showing, ensure panel exists first
    if (newVisible) {
      panelApi.ensure();
    }

    // Update state and UI
    state.panelVisible = newVisible;
    updatePanelVisibility();
    
    if (newVisible && panelNode) {
      syncUI();
    }

    VN.schedulePersist?.('panel-visibility');
  };

  // Toggle panel visibility
  panelApi.toggle = () => {
    const state = getState();
    panelApi.setVisible(!state?.panelVisible);
  };

  // Sync UI to current state
  panelApi.syncUI = syncUI;

  // Broadcast state to child frames
  panelApi.broadcastState = broadcastState;

  // =========================================================================
  // INITIALIZATION
  // =========================================================================

  // SPA navigation hooks
  const onUrlChange = () => {
    const state = getState();
    if (!state?.panelVisible || !panelNode) return;
    syncUI();
  };

  const installSpaHooks = () => {
    if (spaHooksInstalled) return;
    spaHooksInstalled = true;

    const wrap = (fn) => function() {
      const result = fn.apply(this, arguments);
      onUrlChange();
      return result;
    };

    if (typeof history.pushState === 'function') {
      history.pushState = wrap(history.pushState);
    }
    if (typeof history.replaceState === 'function') {
      history.replaceState = wrap(history.replaceState);
    }

    const events = ['popstate', 'yt-navigate-finish', 'yt-page-data-updated', 'yt-navigate-start'];
    events.forEach((evt) => window.addEventListener(evt, onUrlChange));
  };

  installSpaHooks();

  // Watchdog to recover panel if DOM is removed (e.g., by page scripts)
  if (!panelWatchdog) {
    panelWatchdog = setInterval(() => {
      const state = getState();
      if (!state?.panelVisible) return;
      if (!panelNode || !panelNode.isConnected) {
        resetDomRefs();
        panelApi.ensure();
        syncUI();
      }
    }, 2000);
  }

  // Listen for toggle messages from iframes or background
  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || data.__videoEnhancer !== true) return;

    if (data.type === 'VIDEO_ENHANCER_TOGGLE_PANEL') {
      panelApi.toggle();
    }
  });

  VN.panel = panelApi;
})();
