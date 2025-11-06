(() => {
  if (window.videoEnhancerInitialized) {
    return;
  }
  window.videoEnhancerInitialized = true;

  const FILTER_ID = `video-enhancer-filter-${Math.random().toString(36).slice(2)}`;
  const DATA_APPLIED_KEY = 'videoEnhancerApplied';
  const DATA_ORIGINAL_FILTER_KEY = 'videoEnhancerOriginalFilter';
  const DATA_SETTINGS_KEY = 'videoEnhancerSettingsToken';
  const DATA_CURRENT_FILTER_KEY = 'videoEnhancerCurrentFilter';
  const STORAGE_KEY = 'videoEnhancerState';
  const STORAGE_VERSION = 1;
  const PERSIST_DEBOUNCE_MS = 250;

  const PRESET_SETTINGS = Object.freeze({
    sharpen: 0.55,
    contrast: 1.1,
    saturation: 1.15,
    brightness: 1.0,
    gamma: 1.0
  });

  const DEFAULT_SETTINGS = Object.freeze({
    sharpen: PRESET_SETTINGS.sharpen,
    contrast: PRESET_SETTINGS.contrast,
    saturation: PRESET_SETTINGS.saturation,
    brightness: PRESET_SETTINGS.brightness,
    gamma: PRESET_SETTINGS.gamma
  });

  const state = {
    enabled: false,
    panelVisible: false,
    activeTab: 'preset',
    compatibilityMode: false,
    settings: { ...DEFAULT_SETTINGS },
    panelPosition: {
      useCustom: false,
      top: 80,
      left: null
    }
  };

  // Enable verbose logging via `localStorage.setItem('videoEnhancerDebug', '1')` in DevTools.
  const DEBUG = (() => {
    try {
      return localStorage.getItem('videoEnhancerDebug') === '1';
    } catch (error) {
      console.warn('[VideoEnhancer] Unable to read debug flag from localStorage:', error);
      return false;
    }
  })();

  const debugLog = (...args) => {
    if (DEBUG) {
      console.debug('[VideoEnhancer]', ...args);
    }
  };

  if (DEBUG) {
    debugLog('Debug logging enabled');
  }

  try {
    window.videoEnhancerDebugLog = debugLog;
  } catch (error) {
    debugLog('Unable to expose debug logger on window', error);
  }

  const baseKernel = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const sharpenKernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  let filterNode = null;
  let convolveNode = null;
  let panelNode = null;
  let mainToggleButton = null;
  let compatibilityToggleButton = null;
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
  let presetSummaryNode = null;
  const dragState = {
    isDragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startTop: 0,
    startLeft: 0
  };
  let lastKernelAmount = null;
  let persistTimer = null;
  let visibilitySuspended = false;

  const MIN_TARGET_WIDTH = 320;
  const MIN_TARGET_HEIGHT = 180;

  const collectVideoMetrics = () => {
    const videos = Array.from(document.querySelectorAll('video')).filter((node) => node instanceof HTMLVideoElement);
    return videos.map((video) => {
      const rect = video.getBoundingClientRect();
      return {
        video,
        rect,
        area: rect.width * rect.height
      };
    });
  };

  const isMetricEligible = (metric) => metric.rect.width >= MIN_TARGET_WIDTH && metric.rect.height >= MIN_TARGET_HEIGHT;

  const findPrimaryMetric = (metrics) => metrics.reduce((best, metric) => {
    if (!best || metric.area > best.area) {
      return metric;
    }
    return best;
  }, null);

  const describeMetric = (metric) => {
    if (!metric) {
      return null;
    }

    const { rect, video } = metric;
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      area: Math.round(metric.area),
      src: video.currentSrc || video.src || video.dataset.src || 'inline'
    };
  };

  const findAnchorForVideo = (video) =>
    video.closest('ytd-player') ||
    video.closest('.video-player__container') ||
    video.closest('.persistent-player') ||
    video.closest('.tw-player') ||
    video.closest('#player') ||
    video.closest('#video-container') ||
    video.parentElement;

  const buildPersistSnapshot = () => ({
    version: STORAGE_VERSION,
    data: {
      enabled: state.enabled,
      panelVisible: state.panelVisible,
      activeTab: state.activeTab,
      compatibilityMode: state.compatibilityMode,
      settings: { ...state.settings },
      panelPosition: { ...state.panelPosition }
    }
  });

  const schedulePersist = (reason) => {
    if (!chrome?.storage?.local) {
      return;
    }

    if (persistTimer) {
      clearTimeout(persistTimer);
    }

    persistTimer = setTimeout(() => {
      persistTimer = null;
      const snapshot = buildPersistSnapshot();
      debugLog('Persisting state', { reason, snapshot });

      try {
        chrome.storage.local.set({ [STORAGE_KEY]: snapshot }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            debugLog('Persist error', chrome.runtime.lastError.message);
          }
        });
      } catch (error) {
        debugLog('Persist exception', error);
      }
    }, PERSIST_DEBOUNCE_MS);
  };

  const loadPersistedState = () => new Promise((resolve) => {
    if (!chrome?.storage?.local) {
      resolve();
      return;
    }

    try {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          debugLog('Storage load error', chrome.runtime.lastError.message);
          resolve();
          return;
        }

        const payload = result?.[STORAGE_KEY];
        const snapshot = payload && typeof payload === 'object'
          ? (payload.data && typeof payload.data === 'object' ? payload.data : payload)
          : null;

        if (snapshot) {
          if (typeof snapshot.enabled === 'boolean') {
            state.enabled = snapshot.enabled;
          }
          if (typeof snapshot.panelVisible === 'boolean') {
            state.panelVisible = snapshot.panelVisible;
          }
          if (snapshot.activeTab === 'custom' || snapshot.activeTab === 'preset') {
            state.activeTab = snapshot.activeTab;
          }
          if (typeof snapshot.compatibilityMode === 'boolean') {
            state.compatibilityMode = snapshot.compatibilityMode;
          }
          const settingsSource = (snapshot.settings && typeof snapshot.settings === 'object')
            ? snapshot.settings
            : (snapshot.custom && typeof snapshot.custom === 'object' ? snapshot.custom : null);

          if (settingsSource) {
            const restoredSettings = { ...DEFAULT_SETTINGS };
            ['sharpen', 'contrast', 'saturation', 'brightness', 'gamma'].forEach((key) => {
              if (typeof settingsSource[key] === 'number') {
                const value = settingsSource[key];
                if (key === 'sharpen') {
                  restoredSettings[key] = Math.min(Math.max(value, 0), 1.5);
                } else if (key === 'brightness' || key === 'gamma') {
                  restoredSettings[key] = Math.min(Math.max(value, 0.5), 2);
                } else {
                  restoredSettings[key] = Math.min(Math.max(value, 0.5), 2);
                }
              }
            });
            state.settings = restoredSettings;
          }
          if (snapshot.panelPosition && typeof snapshot.panelPosition === 'object') {
            state.panelPosition = {
              useCustom: Boolean(snapshot.panelPosition.useCustom),
              top: typeof snapshot.panelPosition.top === 'number' ? snapshot.panelPosition.top : state.panelPosition.top,
              left: typeof snapshot.panelPosition.left === 'number' ? snapshot.panelPosition.left : state.panelPosition.left
            };
          }
        }

        debugLog('Restored state', {
          enabled: state.enabled,
          panelVisible: state.panelVisible,
          activeTab: state.activeTab,
          settings: { ...state.settings }
        });

        resolve();
      });
    } catch (error) {
      debugLog('Storage load exception', error);
      resolve();
    }
  });

  const computeKernelString = (amount) => baseKernel
    .map((baseValue, index) => {
      const sharpenValue = sharpenKernel[index];
      const mixed = baseValue + amount * (sharpenValue - baseValue);
      return Number.parseFloat(mixed.toFixed(4));
    })
    .join(' ');

  const ensureFilter = () => {
    if (filterNode && convolveNode) {
      return;
    }

    const svgNS = 'http://www.w3.org/2000/svg';
    filterNode = document.createElementNS(svgNS, 'svg');
    filterNode.setAttribute('aria-hidden', 'true');
    filterNode.setAttribute('focusable', 'false');
    filterNode.style.position = 'absolute';
    filterNode.style.width = '0';
    filterNode.style.height = '0';
    filterNode.style.pointerEvents = 'none';

    const defsNode = document.createElementNS(svgNS, 'defs');
    const filter = document.createElementNS(svgNS, 'filter');
    filter.setAttribute('id', FILTER_ID);
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    convolveNode = document.createElementNS(svgNS, 'feConvolveMatrix');
    convolveNode.setAttribute('order', '3');
    convolveNode.setAttribute('kernelMatrix', computeKernelString(state.settings.sharpen));
    convolveNode.setAttribute('edgeMode', 'duplicate');

    filter.appendChild(convolveNode);
    defsNode.appendChild(filter);
    filterNode.appendChild(defsNode);

    const targetParent = document.body || document.documentElement;
    if (targetParent) {
      targetParent.appendChild(filterNode);
    } else {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          (document.body || document.documentElement).appendChild(filterNode);
        },
        { once: true }
      );
    }
  };

  const updateKernel = (amount) => {
    if (!convolveNode) {
      return;
    }
    if (lastKernelAmount !== null && Math.abs(lastKernelAmount - amount) < 0.0001) {
      return;
    }
    debugLog('Updating kernel', { sharpen: Number(amount.toFixed(4)) });
    convolveNode.setAttribute('kernelMatrix', computeKernelString(amount));
    lastKernelAmount = amount;
  };

  const formatPercent = (value) => `${Math.round(value * 100)}%`;

  const formatDeltaPercent = (value) => {
    const delta = Math.round((value - 1) * 100);
    if (delta === 0) {
      return '0%';
    }
    return `${delta > 0 ? '+' : ''}${delta}%`;
  };

  const updatePresetSummary = () => {
    if (!presetSummaryNode) {
      return;
    }
    const parts = [
      `Sharpen ${formatPercent(state.settings.sharpen)}`,
      `Contrast ${formatDeltaPercent(state.settings.contrast)}`,
      `Saturation ${formatDeltaPercent(state.settings.saturation)}`
    ];
    if (state.settings.brightness !== 1) {
      parts.push(`Brightness ${formatDeltaPercent(state.settings.brightness)}`);
    }
    if (state.settings.gamma !== 1) {
      parts.push(`Gamma ${state.settings.gamma.toFixed(2)}`);
    }
    presetSummaryNode.textContent = parts.join(' · ');
  };

  const getCurrentSettings = () => state.settings;

  const applyFilterToVideo = (video, settings) => {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }

    ensureFilter();

    if (!(DATA_ORIGINAL_FILTER_KEY in video.dataset)) {
      video.dataset[DATA_ORIGINAL_FILTER_KEY] = video.style.filter || '';
    }

    const originalFilter = video.dataset[DATA_ORIGINAL_FILTER_KEY];

    const filterParts = [];
    if (originalFilter && originalFilter.trim().length > 0) {
      filterParts.push(originalFilter.trim());
    }

    if (settings.brightness !== 1) {
      filterParts.push(`brightness(${Number(settings.brightness.toFixed(2))})`);
    }

    if (settings.contrast !== 1) {
      filterParts.push(`contrast(${Number(settings.contrast.toFixed(2))})`);
    }

    if (settings.saturation !== 1) {
      filterParts.push(`saturate(${Number(settings.saturation.toFixed(2))})`);
    }

    // Apply gamma approximation using brightness + contrast combo
    if (settings.gamma !== 1) {
      const gammaAdjust = Math.pow(settings.gamma, 0.5);
      filterParts.push(`brightness(${Number(gammaAdjust.toFixed(2))})`);
    }

    // Only apply sharpen filter if not in compatibility mode
    if (!state.compatibilityMode) {
      filterParts.push(`url(#${FILTER_ID})`);
    }

    const newFilter = filterParts.join(' ').trim();
    const settingsToken = `${settings.sharpen.toFixed(4)}|${settings.contrast.toFixed(4)}|${settings.saturation.toFixed(4)}|${settings.brightness.toFixed(4)}|${settings.gamma.toFixed(4)}|${state.compatibilityMode}`;

    if (
      video.dataset[DATA_APPLIED_KEY] === 'true' &&
      video.dataset[DATA_SETTINGS_KEY] === settingsToken &&
      video.dataset[DATA_CURRENT_FILTER_KEY] === newFilter
    ) {
      return;
    }

    video.style.filter = newFilter;
    video.dataset[DATA_APPLIED_KEY] = 'true';
    video.dataset[DATA_SETTINGS_KEY] = settingsToken;
    video.dataset[DATA_CURRENT_FILTER_KEY] = newFilter;
    const rect = video.getBoundingClientRect();
    debugLog('Applied filter', {
      settings,
      compatibilityMode: state.compatibilityMode,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      src: video.currentSrc || video.src || video.dataset.src || 'inline'
    });
  };

  const removeFilterFromVideo = (video) => {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }

    if (video.dataset[DATA_APPLIED_KEY] !== 'true') {
      return;
    }

    const originalFilter = video.dataset[DATA_ORIGINAL_FILTER_KEY] ?? '';
    video.style.filter = originalFilter;
    delete video.dataset[DATA_APPLIED_KEY];
    delete video.dataset[DATA_ORIGINAL_FILTER_KEY];
    delete video.dataset[DATA_SETTINGS_KEY];
    delete video.dataset[DATA_CURRENT_FILTER_KEY];
    if (DEBUG) {
      const rect = video.getBoundingClientRect();
      debugLog('Removed filter', {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        src: video.currentSrc || video.src || video.dataset.src || 'inline'
      });
    }
  };

  const updateAllVideos = (settings) => {
    const metrics = collectVideoMetrics();
    const primaryMetric = findPrimaryMetric(metrics);
    let targetedMetrics = [];

    if (settings) {
      targetedMetrics = metrics.filter(isMetricEligible);
      if (targetedMetrics.length === 0 && primaryMetric) {
        targetedMetrics = [primaryMetric];
      }
    }

    const targetedVideos = new Set(targetedMetrics.map((metric) => metric.video));

    debugLog('updateAllVideos', {
      applyingSettings: Boolean(settings),
      totalVideos: metrics.length,
      targeted: targetedMetrics.length,
      primary: describeMetric(primaryMetric)
    });

    metrics.forEach((metric) => {
      if (!settings) {
        if (metric.video.dataset[DATA_APPLIED_KEY] === 'true') {
          removeFilterFromVideo(metric.video);
        }
        return;
      }

      if (targetedVideos.size === 0 || targetedVideos.has(metric.video)) {
        applyFilterToVideo(metric.video, settings);
      } else if (metric.video.dataset[DATA_APPLIED_KEY] === 'true') {
        removeFilterFromVideo(metric.video);
      }
    });
  };

  const refreshEffect = () => {
    debugLog('refreshEffect', { enabled: state.enabled });
    if (!state.enabled) {
      updateAllVideos(null);
      return;
    }

    const settings = getCurrentSettings();
    ensureFilter();
    updateKernel(settings.sharpen);
    updateAllVideos(settings);
  };

  let refreshScheduled = false;

  const scheduleRefresh = (reason) => {
    if (refreshScheduled) {
      debugLog('Refresh already scheduled', reason);
      return;
    }

    refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshScheduled = false;
      debugLog('Executing scheduled refresh', reason);
      refreshEffect();
    });
  };

  const updatePanelVisibility = () => {
    if (panelNode) {
      panelNode.classList.toggle('video-enhancer-hidden', !state.panelVisible);
    }
  };

  const setPanelVisibility = (visible) => {
    state.panelVisible = visible;
    applyPanelPosition();
    updatePanelVisibility();
    schedulePersist('panel-visibility');
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const applyPanelPosition = () => {
    if (!panelNode) {
      return;
    }

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

  const setButtonState = (button, isOn, onLabel, offLabel) => {
    if (!button) {
      return;
    }
    button.textContent = isOn ? onLabel : offLabel;
    button.classList.toggle('video-enhancer-button-off', !isOn);
  };

  const updateTabStyles = () => {
    if (!panelNode) {
      return;
    }

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

  const syncSliders = () => {
    Object.entries(sliderInputs).forEach(([key, input]) => {
      if (!input) {
        return;
      }
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
    applyPanelPosition();
    updatePanelVisibility();
    setButtonState(mainToggleButton, state.enabled, 'Enhancer: On', 'Enhancer: Off');
    setButtonState(compatibilityToggleButton, state.compatibilityMode, 'Compatibility: On', 'Compatibility: Off');
    syncSliders();
    updateTabStyles();
    updatePresetSummary();
  };

  const handleMainToggle = () => {
    const willEnable = !state.enabled;
    debugLog('Main toggle clicked', { willEnable });
    state.enabled = willEnable;
    syncUI();
    schedulePersist('main-toggle');
    scheduleRefresh('main-toggle');
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

    debugLog('Slider changed', { key, value: state.settings[key] });

    schedulePersist(`slider-${key}`);

    if (state.enabled) {
      scheduleRefresh(`slider-${key}`);
    }

    updatePresetSummary();
  };

  const handleCompatibilityToggle = () => {
    const willEnable = !state.compatibilityMode;
    debugLog('Compatibility toggle clicked', { willEnable });
    state.compatibilityMode = willEnable;
    syncUI();
    schedulePersist('compatibility-toggle');
    if (state.enabled) {
      scheduleRefresh('compatibility-toggle');
    }
  };

  const setActiveTab = (tabName) => {
    const normalized = tabName === 'custom' ? 'custom' : 'preset';
    if (state.activeTab !== normalized) {
      state.activeTab = normalized;
      schedulePersist('tab-change');
    }
    updateTabStyles();
  };

  const ensurePanel = () => {
    if (panelNode) {
      return;
    }

    panelNode = document.getElementById('video-enhancer-panel');
    if (panelNode) {
      return;
    }

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
        <button type="button" class="video-enhancer-tab" role="tab" data-video-enhancer-tab="preset" aria-controls="video-enhancer-tab-preset">Preset</button>
        <button type="button" class="video-enhancer-tab" role="tab" data-video-enhancer-tab="custom" aria-controls="video-enhancer-tab-custom">Custom</button>
      </div>
      <div id="video-enhancer-tab-preset" class="video-enhancer-tab-content" role="tabpanel" data-video-enhancer-content="preset" aria-hidden="false">
        <button id="video-enhancer-main-toggle" type="button" class="video-enhancer-primary-button">Enhancer: Off</button>
        <button id="video-enhancer-compatibility-toggle" type="button" class="video-enhancer-secondary-button">Compatibility: Off</button>
        <p class="video-enhancer-note" id="video-enhancer-preset-summary">
          Sharpen ${formatPercent(DEFAULT_SETTINGS.sharpen)} · Contrast ${formatDeltaPercent(DEFAULT_SETTINGS.contrast)} · Saturation ${formatDeltaPercent(DEFAULT_SETTINGS.saturation)}
        </p>
        <p class="video-enhancer-note video-enhancer-help-text">💡 Enable compatibility mode if you experience performance issues or visual glitches.</p>
      </div>
      <div id="video-enhancer-tab-custom" class="video-enhancer-tab-content" role="tabpanel" data-video-enhancer-content="custom" aria-hidden="true">
        <div class="video-enhancer-slider-group">
          <label class="video-enhancer-slider-label" for="video-enhancer-custom-sharpen">
            <span>Sharpen</span>
            <span id="video-enhancer-custom-sharpen-value">55%</span>
          </label>
          <input id="video-enhancer-custom-sharpen" type="range" min="0" max="150" step="1" value="55" />
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
            <span id="video-enhancer-custom-saturation-value">115%</span>
          </label>
          <input id="video-enhancer-custom-saturation" type="range" min="50" max="200" step="1" value="115" />
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
            <span id="video-enhancer-custom-gamma-value">1.00</span>
          </label>
          <input id="video-enhancer-custom-gamma" type="range" min="50" max="200" step="1" value="100" />
        </div>
      </div>
    `;

    document.documentElement.appendChild(panelNode);

    mainToggleButton = panelNode.querySelector('#video-enhancer-main-toggle');
    compatibilityToggleButton = panelNode.querySelector('#video-enhancer-compatibility-toggle');
    presetSummaryNode = panelNode.querySelector('#video-enhancer-preset-summary');

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
      setPanelVisibility(false);
    });

    const header = panelNode.querySelector('.video-enhancer-header');
    const handlePointerMove = (event) => {
      if (!dragState.isDragging || dragState.pointerId !== event.pointerId) {
        return;
      }

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
      if (!dragState.isDragging || dragState.pointerId !== event.pointerId) {
        return;
      }

      dragState.isDragging = false;
      dragState.pointerId = null;
      if (panelNode.hasPointerCapture(event.pointerId)) {
        panelNode.releasePointerCapture(event.pointerId);
      }
      panelNode.classList.remove('video-enhancer-dragging');
      schedulePersist('panel-position');
    };

    panelNode.addEventListener('pointermove', handlePointerMove);
    panelNode.addEventListener('pointerup', endDrag);
    panelNode.addEventListener('pointercancel', endDrag);

    header?.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      if ((event.target instanceof HTMLElement) && event.target.closest('.video-enhancer-icon-button')) {
        return;
      }

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
    compatibilityToggleButton?.addEventListener('click', handleCompatibilityToggle);

    sliderInputs.sharpen?.addEventListener('input', (event) => handleSliderInput('sharpen', event));
    sliderInputs.contrast?.addEventListener('input', (event) => handleSliderInput('contrast', event));
    sliderInputs.saturation?.addEventListener('input', (event) => handleSliderInput('saturation', event));
    sliderInputs.brightness?.addEventListener('input', (event) => handleSliderInput('brightness', event));
    sliderInputs.gamma?.addEventListener('input', (event) => handleSliderInput('gamma', event));

    syncUI();
  };

  const processNode = (node) => {
    if (node instanceof HTMLVideoElement) {
      debugLog('Mutation observed direct video element');
      scheduleRefresh('mutation:video');
      return;
    }

    if (node instanceof HTMLElement) {
      const containsVideo = node.tagName === 'VIDEO' || node.querySelector('video');
      if (containsVideo) {
        debugLog('Mutation observed container with video');
        scheduleRefresh('mutation:container');
      }
    }
  };

  const initMutationObserver = () => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLVideoElement) {
          debugLog('Mutation observed attribute change on video');
          scheduleRefresh('mutation:attributes');
          return;
        }

        mutation.addedNodes.forEach((node) => {
          processNode(node);
        });
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'style', 'class', 'data-player-state']
    });
  };

  const handleVisibilityChange = () => {
    if (document.hidden) {
      if (state.enabled) {
        debugLog('Document hidden – temporarily removing filters');
        updateAllVideos(null);
        visibilitySuspended = true;
      }
      return;
    }

    if (visibilitySuspended) {
      debugLog('Document visible – restoring filters');
      visibilitySuspended = false;
      scheduleRefresh('visibility-restore');
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);

  const init = async () => {
    await loadPersistedState();
    ensureFilter();
    ensurePanel();
    initMutationObserver();
    syncUI();
    refreshEffect();
  };

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === 'VIDEO_ENHANCER_TOGGLE_PANEL') {
        ensurePanel();
        setPanelVisibility(!state.panelVisible);
      }
    });
  }

  const runInit = () => {
    init().catch((error) => {
      debugLog('Init error', error);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInit, { once: true });
  } else {
    runInit();
  }
})();

