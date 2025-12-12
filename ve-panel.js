(() => {
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  const { state } = VN;
  
  const panelApi = {};
  let panelNode = null;
  let mainToggleButton = null;
  let compatibilityToggleInput = null;
  let overlayToggleInput = null;

  const isTopFrame = (() => {
    try {
      return window.top === window;
    } catch (_) {
      return true;
    }
  })();

  if (!isTopFrame) {
    panelApi.ensure = () => {};
    panelApi.syncUI = () => {};
    panelApi.setVisible = () => {
      try {
        window.top.postMessage({ __videoEnhancer: true, type: 'VIDEO_ENHANCER_TOGGLE_PANEL' }, '*');
      } catch (_) {}
    };
    panelApi.toggle = () => panelApi.setVisible();

    const buildLocalSyncState = () => ({
      enabled: state.enabled,
      compatibilityMode: state.compatibilityMode,
      overlayEnabled: state.overlayEnabled,
      settings: { ...state.settings }
    });

    const broadcastToChildren = (message) => {
      try {
        for (let i = 0; i < window.frames.length; i += 1) {
          try { window.frames[i].postMessage(message, '*'); } catch (_) {}
        }
      } catch (_) {}
    };

    const applySyncState = (next) => {
      if (!next || typeof next !== 'object') return;
      if (typeof next.enabled === 'boolean') state.enabled = next.enabled;
      if (typeof next.compatibilityMode === 'boolean') state.compatibilityMode = next.compatibilityMode;
      if (typeof next.overlayEnabled === 'boolean') state.overlayEnabled = next.overlayEnabled;
      if (next.settings && typeof next.settings === 'object') {
        const merged = { ...state.settings };
        ['sharpen','contrast','saturation','brightness','gamma'].forEach((k) => {
          if (typeof next.settings[k] === 'number') merged[k] = next.settings[k];
        });
        state.settings = merged;
      }
      VN.overlay?.setSuppressed?.(!state.overlayEnabled);
      VN.overlay?.updateState?.();
      VN.scheduleRefresh?.('state-sync');
    };

    window.addEventListener('message', (event) => {
      const data = event?.data;
      if (!data || data.__videoEnhancer !== true) return;
      if (data.type === 'VIDEO_ENHANCER_REQUEST_STATE') {
        const msg = { __videoEnhancer: true, type: 'VIDEO_ENHANCER_STATE_SYNC', state: buildLocalSyncState() };
        try { window.postMessage(msg, '*'); } catch (_) {}
        broadcastToChildren(msg);
        return;
      }
      if (data.type === 'VIDEO_ENHANCER_STATE_SYNC') {
        applySyncState(data.state);
        broadcastToChildren(data);
      }
    });

    try {
      window.top.postMessage({ __videoEnhancer: true, type: 'VIDEO_ENHANCER_REQUEST_STATE' }, '*');
    } catch (_) {}

    VN.panel = panelApi;
    return;
  }

  const buildSyncState = () => ({
    enabled: state.enabled,
    compatibilityMode: state.compatibilityMode,
    overlayEnabled: state.overlayEnabled,
    settings: { ...state.settings }
  });

  const broadcastState = () => {
    const message = { __videoEnhancer: true, type: 'VIDEO_ENHANCER_STATE_SYNC', state: buildSyncState() };
    try { window.postMessage(message, '*'); } catch (_) {}
    try {
      for (let i = 0; i < window.frames.length; i += 1) {
        try { window.frames[i].postMessage(message, '*'); } catch (_) {}
      }
    } catch (_) {}
  };

  const applyStatePatch = (patch, reason) => {
    if (!patch || typeof patch !== 'object') return;

    if (typeof patch.enabled === 'boolean') {
      state.enabled = patch.enabled;
      VN.schedulePersist(reason || 'state-patch-enabled');
      VN.scheduleRefresh(reason || 'state-patch-enabled');
    }

    if (typeof patch.compatibilityMode === 'boolean') {
      state.compatibilityMode = patch.compatibilityMode;
      VN.schedulePersist(reason || 'state-patch-compat');
      if (state.enabled) VN.scheduleRefresh(reason || 'state-patch-compat');
    }

    if (typeof patch.overlayEnabled === 'boolean') {
      state.overlayEnabled = patch.overlayEnabled;
      VN.overlay?.setSuppressed?.(!state.overlayEnabled);
      VN.schedulePersist(reason || 'state-patch-overlay');
    }

    if (patch.settings && typeof patch.settings === 'object') {
      const merged = { ...state.settings };
      ['sharpen','contrast','saturation','brightness','gamma'].forEach((k) => {
        if (typeof patch.settings[k] === 'number') merged[k] = patch.settings[k];
      });
      state.settings = merged;
      VN.schedulePersist(reason || 'state-patch-settings');
      if (state.enabled) VN.scheduleRefresh(reason || 'state-patch-settings');
    }

    syncUI();
    broadcastState();
  };

  panelApi.broadcastState = broadcastState;

  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || data.__videoEnhancer !== true) return;
    if (data.type === 'VIDEO_ENHANCER_REQUEST_STATE') {
      broadcastState();
      return;
    }
    if (data.type === 'VIDEO_ENHANCER_STATE_PATCH') {
      applyStatePatch(data.patch, 'state-patch');
    }
  });

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

  const dragState = {
    isDragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startTop: 0,
    startLeft: 0
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const formatPercent = (value) => `${Math.round(value * 100)}%`;

  const applyPanelPosition = () => {
    if (!panelNode) return;

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
    if (panelNode) {
      panelNode.classList.toggle('video-enhancer-hidden', !state.panelVisible);
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

  const syncUI = () => {
    if (!panelNode) return;
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
    VN.overlay?.updateState?.();
  };

  const setActiveTab = (tabName) => {
    const normalized = tabName === 'custom' ? 'custom' : 'preset';
    if (state.activeTab !== normalized) {
      state.activeTab = normalized;
      VN.schedulePersist('tab-change');
    }
    updateTabStyles();
  };

  const handleMainToggle = () => {
    const willEnable = !state.enabled;
    state.enabled = willEnable;
    syncUI();
    VN.schedulePersist('main-toggle');
    VN.scheduleRefresh('main-toggle');
    broadcastState();
  };

  const handleCompatibilityToggle = (event) => {
    const willEnable = event?.target?.checked ?? !state.compatibilityMode;
    state.compatibilityMode = willEnable;
    syncUI();
    VN.schedulePersist('compatibility-toggle');
    if (state.enabled) {
      VN.scheduleRefresh('compatibility-toggle');
    }
    broadcastState();
  };

  const handleOverlayToggle = (event) => {
    const willEnable = event?.target?.checked ?? !state.overlayEnabled;
    state.overlayEnabled = willEnable;
    VN.overlay?.setSuppressed?.(!state.overlayEnabled);
    syncUI();
    VN.schedulePersist('overlay-toggle');
    broadcastState();
  };

  const handleSliderInput = (key, event) => {
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
    VN.schedulePersist(`slider-${key}`);
    if (state.enabled) {
      VN.scheduleRefresh(`slider-${key}`);
    }
    broadcastState();
  };

  const handlePointerMove = (event) => {
    if (!dragState.isDragging || dragState.pointerId !== event.pointerId) return;

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
    if (panelNode.hasPointerCapture(event.pointerId)) {
      panelNode.releasePointerCapture(event.pointerId);
    }
    panelNode.classList.remove('video-enhancer-dragging');
    VN.schedulePersist('panel-position');
  };

  panelApi.ensure = () => {
    if (panelNode) return;

    panelNode = document.getElementById('video-enhancer-panel');
    if (panelNode) return;

    panelNode = document.createElement('div');
    panelNode.id = 'video-enhancer-panel';
    panelNode.setAttribute('role', 'region');
    panelNode.setAttribute('aria-label', 'Video Enhancer Controls');

    panelNode.innerHTML = `
      <div class="video-enhancer-header">
        <h1>
          Video Enhancer
        </h1>
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

    const tabButtons = panelNode.querySelectorAll('[data-video-enhancer-tab]');
    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        setActiveTab(button.getAttribute('data-video-enhancer-tab'));
      });
    });

    panelNode.querySelector('#video-enhancer-hide')?.addEventListener('click', () => {
      panelApi.setVisible(false);
    });

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

    mainToggleButton?.addEventListener('click', handleMainToggle);
    compatibilityToggleInput?.addEventListener('change', handleCompatibilityToggle);
    overlayToggleInput?.addEventListener('change', handleOverlayToggle);

    sliderInputs.sharpen?.addEventListener('input', (event) => handleSliderInput('sharpen', event));
    sliderInputs.contrast?.addEventListener('input', (event) => handleSliderInput('contrast', event));
    sliderInputs.saturation?.addEventListener('input', (event) => handleSliderInput('saturation', event));
    sliderInputs.brightness?.addEventListener('input', (event) => handleSliderInput('brightness', event));
    sliderInputs.gamma?.addEventListener('input', (event) => handleSliderInput('gamma', event));

    syncUI();
  };

  panelApi.setVisible = (visible) => {
    state.panelVisible = visible;
    if (visible) {
      panelApi.ensure();
      syncUI();
    }
    updatePanelVisibility();
    VN.schedulePersist('panel-visibility');
  };

  panelApi.toggle = () => {
    panelApi.setVisible(!state.panelVisible);
  };

  panelApi.syncUI = syncUI;

  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || data.__videoEnhancer !== true) return;
    if (data.type === 'VIDEO_ENHANCER_TOGGLE_PANEL') {
      panelApi.toggle();
    }
  });

  VN.panel = panelApi;
})();
