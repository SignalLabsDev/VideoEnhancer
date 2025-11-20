(() => {
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  const { state } = VN;
  
  const panelApi = {};
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
  };

  const handleCompatibilityToggle = (event) => {
    const willEnable = event?.target?.checked ?? !state.compatibilityMode;
    state.compatibilityMode = willEnable;
    syncUI();
    VN.schedulePersist('compatibility-toggle');
    if (state.enabled) {
      VN.scheduleRefresh('compatibility-toggle');
    }
  };

  const handleOverlayToggle = (event) => {
    const willEnable = event?.target?.checked ?? !state.overlayEnabled;
    state.overlayEnabled = willEnable;
    VN.overlay?.setSuppressed?.(!state.overlayEnabled);
    syncUI();
    VN.schedulePersist('overlay-toggle');
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <path d="M12 5.25C12.6904 5.25 13.25 4.69036 13.25 4C13.25 3.30964 12.6904 2.75 12 2.75C11.3096 2.75 10.75 3.30964 10.75 4C10.75 4.69036 11.3096 5.25 12 5.25Z" fill="#f5f7fa"/>
            <path d="M12 21.25C12.6904 21.25 13.25 20.6904 13.25 20C13.25 19.3096 12.6904 18.75 12 18.75C11.3096 18.75 10.75 19.3096 10.75 20C10.75 20.6904 11.3096 21.25 12 21.25Z" fill="#f5f7fa"/>
            <path d="M5.25 12C5.25 12.6904 4.69036 13.25 4 13.25C3.30964 13.25 2.75 12.6904 2.75 12C2.75 11.3096 3.30964 10.75 4 10.75C4.69036 10.75 5.25 11.3096 5.25 12Z" fill="#f5f7fa"/>
            <path d="M21.25 12C21.25 12.6904 20.6904 13.25 20 13.25C19.3096 13.25 18.75 12.6904 18.75 12C18.75 11.3096 19.3096 10.75 20 10.75C20.6904 10.75 21.25 11.3096 21.25 12Z" fill="#f5f7fa"/>
            <path d="M17.3031 6.69692C17.7929 6.20713 17.7929 5.4092 17.3031 4.91941C16.8133 4.42962 16.0154 4.42962 15.5256 4.91941C15.0358 5.4092 15.0358 6.20713 15.5256 6.69692C16.0154 7.18671 16.8133 7.18671 17.3031 6.69692Z" fill="#f5f7fa"/>
            <path d="M8.47444 19.0806C8.96423 18.5908 8.96423 17.7929 8.47444 17.3031C7.98465 16.8133 7.18672 16.8133 6.69693 17.3031C6.20714 17.7929 6.20714 18.5908 6.69693 19.0806C7.18672 19.5704 7.98465 19.5704 8.47444 19.0806Z" fill="#f5f7fa"/>
            <path d="M19.0806 17.3031C19.5704 16.8133 19.5704 16.0154 19.0806 15.5256C18.5908 15.0358 17.7929 15.0358 17.3031 15.5256C16.8133 16.0154 16.8133 16.8133 17.3031 17.3031C17.7929 17.7929 18.5908 17.7929 19.0806 17.3031Z" fill="#f5f7fa"/>
            <path d="M6.69693 8.47444C7.18672 7.98465 7.18672 7.18672 6.69693 6.69693C6.20714 6.20714 5.40921 6.20714 4.91942 6.69693C4.42963 7.18672 4.42963 7.98465 4.91942 8.47444C5.40921 8.96423 6.20714 8.96423 6.69693 8.47444Z" fill="#f5f7fa"/>
          </svg>
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

  panelApi.syncUI = syncUI;

  VN.panel = panelApi;
})();
