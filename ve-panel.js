(() => {
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  
  // Prevent re-initialization
  if (VN.panelInitialized) return;
  VN.panelInitialized = true;
  
  // Helper to always get current state
  const getState = () => VN.state;
  
  const panelApi = {};

  // DOM references
  let panelNode = null;
  let mainToggleButton = null;
  let compatibilityToggleInput = null;
  let overlayToggleInput = null;
  let presetInput = null;
  let presetControl = null;
  let presetDropdownButton = null;
  let presetDropdown = null;
  let savePresetButton = null;
  let presetExportButton = null;
  let presetImportButton = null;
  let presetImportFileInput = null;
  let presetIoStatus = null;
  let presetFilterActive = false;
  let activeSliderValueEditor = null;
  
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
  let presetDismissListenerInstalled = false;

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

    // Per-tab state: iframes don't need state sync from parent

    VN.panel = panelApi;
    return;
  }

  // =========================================================================
  // TOP FRAME ONLY - Full panel implementation
  // =========================================================================

  // Utility functions
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const formatPercent = (value) => `${Math.round(value * 100)}%`;
  const formatSliderValue = (key, value) => key === 'gamma' ? value.toFixed(2) : formatPercent(value);

  // Per-tab state management: No cross-frame broadcasting needed

  // Reset all DOM references
  const resetDomRefs = () => {
    panelNode = null;
    mainToggleButton = null;
    compatibilityToggleInput = null;
    overlayToggleInput = null;
    presetInput = null;
    presetControl = null;
    presetDropdownButton = null;
    presetDropdown = null;
    savePresetButton = null;
    presetExportButton = null;
    presetImportButton = null;
    presetImportFileInput = null;
    presetIoStatus = null;
    presetFilterActive = false;
    activeSliderValueEditor = null;
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

  // Fullscreen only renders the fullscreen element and its descendants. Move the
  // panel into that subtree so it stays visible when opened from a fullscreen video.
  const getFullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement ||
    document.mozFullScreenElement || document.msFullscreenElement || null;

  const getPanelHost = () => {
    const fullscreenElement = getFullscreenElement();
    if (fullscreenElement && !(fullscreenElement instanceof HTMLVideoElement)) {
      return fullscreenElement;
    }
    return document.body || document.documentElement;
  };

  const ensurePanelHost = () => {
    if (!panelNode) return;
    const host = getPanelHost();
    if (panelNode.parentElement === host) return;

    try {
      host.appendChild(panelNode);
    } catch (_) {
      try { (document.body || document.documentElement).appendChild(panelNode); } catch (_) {}
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
      sharpenLabel.tabIndex = isDisabled ? -1 : 0;
      sharpenLabel.setAttribute('aria-disabled', String(isDisabled));
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
        label.textContent = formatSliderValue(key, value);
      }
    });
  };

  const finishSliderValueEdit = (session, shouldCommit) => {
    if (activeSliderValueEditor !== session) return;
    activeSliderValueEditor = null;

    const state = getState();
    const enteredValue = session.editor.value.trim();
    const value = Number(enteredValue);
    if (shouldCommit && state && enteredValue && Number.isFinite(value)) {
      const boundedValue = clamp(value, session.minimum, session.maximum);
      const steppedValue = session.minimum + Math.round((boundedValue - session.minimum) / session.step) * session.step;
      const displayValue = Number(steppedValue.toFixed(3));
      const normalized = session.key === 'gamma' ? displayValue : displayValue / 100;
      state.settings[session.key] = Number(normalized.toFixed(3));
      VN.schedulePersist?.(`slider-${session.key}`);
      if (state.enabled) VN.scheduleRefresh?.(`slider-${session.key}`);
    }

    syncSliders();
    session.wrapper.replaceWith(session.label);
  };

  const openSliderValueEditor = (key) => {
    const state = getState();
    const label = sliderValueLabels[key];
    const slider = sliderInputs[key];
    if (!state || !label || !slider || (key === 'sharpen' && state.compatibilityMode)) return;

    if (activeSliderValueEditor) activeSliderValueEditor.editor.blur();

    const displayScale = key === 'gamma' ? 1 : 100;
    const minimum = Number(slider.min) / 100 * displayScale;
    const maximum = Number(slider.max) / 100 * displayScale;
    const step = Number(slider.step) / 100 * displayScale;
    const maxEditorWidth = 32;
    const wrapper = document.createElement('span');
    wrapper.className = 'video-enhancer-slider-value-editor-wrap';
    const editor = document.createElement('input');
    editor.type = 'text';
    editor.className = 'video-enhancer-slider-value-editor';
    editor.inputMode = 'decimal';
    editor.autocomplete = 'off';
    editor.value = String(key === 'gamma' ? state.settings[key].toFixed(2) : Math.round(state.settings[key] * 100));
    editor.setAttribute('aria-label', `Set ${key} value`);

    wrapper.appendChild(editor);

    const session = { key, label, editor, wrapper, minimum, maximum, step };
    activeSliderValueEditor = session;
    label.replaceWith(wrapper);

    const measureCanvas = document.createElement('canvas');
    const measureContext = measureCanvas.getContext('2d');
    const fitEditorToText = () => {
      if (!measureContext) return;
      const styles = window.getComputedStyle(editor);
      measureContext.font = `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
      const textWidth = measureContext.measureText(editor.value || '0').width;
      const padding = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
      const fieldWidth = Math.min(maxEditorWidth, Math.max(8, Math.ceil(textWidth + padding)));
      editor.style.width = `${fieldWidth}px`;
      editor.style.flexBasis = `${fieldWidth}px`;
    };

    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        editor.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finishSliderValueEdit(session, false);
      }
    });
    editor.addEventListener('blur', () => finishSliderValueEdit(session, true), { once: true });
    editor.addEventListener('input', fitEditorToText);
    fitEditorToText();
    editor.focus();
    editor.select();
  };

  const handleSliderWheel = (key, event) => {
    const slider = sliderInputs[key];
    if (!slider || slider.disabled || event.deltaY === 0) return;

    event.preventDefault();
    event.stopPropagation();
    const direction = event.deltaY < 0 ? 1 : -1;
    const step = Number(slider.step) || 1;
    const currentValue = Number(slider.value);
    const nextValue = clamp(currentValue + direction * step, Number(slider.min), Number(slider.max));
    if (nextValue === currentValue) return;

    slider.value = String(nextValue);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const CHEVRON_ICON = '<svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const DELETE_ICON = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  // Save is disabled until there is a name to save under
  const updateSaveButton = () => {
    if (!savePresetButton) return;
    savePresetButton.disabled = !presetInput?.value.trim();
  };

  const SETTINGS_EXPORT_FORMAT = 'video-enhancer-settings';
  const SETTINGS_EXPORT_VERSION = 1;
  const hasValidSettings = (settings) => settings && typeof settings === 'object' &&
    !Array.isArray(settings) && Object.keys(VN.DEFAULT_SETTINGS).every((key) =>
      typeof settings[key] === 'number' && Number.isFinite(settings[key])
    );

  const setPresetIoStatus = (message, isError = false) => {
    if (!presetIoStatus) return;
    presetIoStatus.textContent = message;
    presetIoStatus.classList.toggle('video-enhancer-preset-io-error', isError);
  };

  const handleExportSettings = () => {
    const state = getState();
    if (!state) return;

    try {
      const payload = {
        format: SETTINGS_EXPORT_FORMAT,
        version: SETTINGS_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        enabled: state.enabled,
        compatibilityMode: state.compatibilityMode,
        overlayEnabled: state.overlayEnabled,
        settings: VN.normalizeSettings(state.settings, VN.DEFAULT_SETTINGS),
        presets: state.presets.map((preset) => ({
          name: preset.name,
          settings: VN.normalizeSettings(preset.settings, VN.DEFAULT_SETTINGS)
        }))
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `video-enhancer-settings-${new Date().toISOString().slice(0, 10)}.json`;
      link.style.display = 'none';
      document.documentElement.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setPresetIoStatus('Settings and profiles exported.');
    } catch (_) {
      setPresetIoStatus('Could not export settings.', true);
    }
  };

  const handleImportSettings = async (file) => {
    const state = getState();
    if (!state || !file) return;

    try {
      const payload = JSON.parse(await file.text());
      if (payload?.format !== SETTINGS_EXPORT_FORMAT || payload.version !== SETTINGS_EXPORT_VERSION ||
          !hasValidSettings(payload.settings) || !Array.isArray(payload.presets) || payload.presets.length > 50) {
        throw new Error('Unsupported settings file');
      }

      const importedSettings = VN.normalizeSettings(payload.settings, VN.DEFAULT_SETTINGS);
      const seenNames = new Set();
      let skipped = 0;
      const importedPresets = payload.presets.flatMap((preset) => {
        const name = typeof preset?.name === 'string' ? preset.name.trim().slice(0, 40) : '';
        if (!name || !hasValidSettings(preset.settings) || seenNames.has(name.toLocaleLowerCase())) {
          skipped += 1;
          return [];
        }
        seenNames.add(name.toLocaleLowerCase());
        return [{ name, settings: VN.normalizeSettings(preset.settings, VN.DEFAULT_SETTINGS) }];
      });

      const mergedPresets = state.presets.map((preset) => ({
        ...preset,
        settings: VN.normalizeSettings(preset.settings, VN.DEFAULT_SETTINGS)
      }));
      let added = 0;
      let updated = 0;
      importedPresets.forEach((importedPreset) => {
        const existing = mergedPresets.find((preset) =>
          preset.name.toLocaleLowerCase() === importedPreset.name.toLocaleLowerCase()
        );
        if (existing) {
          existing.settings = importedPreset.settings;
          updated += 1;
        } else if (mergedPresets.length < 50) {
          mergedPresets.push({
            id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            ...importedPreset
          });
          added += 1;
        } else {
          skipped += 1;
        }
      });

      state.settings = importedSettings;
      if (typeof payload.enabled === 'boolean') state.enabled = payload.enabled;
      if (typeof payload.compatibilityMode === 'boolean') state.compatibilityMode = payload.compatibilityMode;
      if (typeof payload.overlayEnabled === 'boolean') state.overlayEnabled = payload.overlayEnabled;
      state.presets = mergedPresets;
      syncUI();
      VN.schedulePersist?.('settings-import');
      if (state.enabled) VN.scheduleRefresh?.('settings-import');
      else VN.updateAllVideos?.(null);
      VN.overlay?.refresh?.();

      const profileSummary = `${added} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}`;
      setPresetIoStatus(`Settings imported; profiles ${profileSummary}.`);
    } catch (_) {
      setPresetIoStatus('Could not import that file. Choose a Video Enhancer settings export.', true);
    }
  };

  const updatePresetOptions = () => {
    if (!presetDropdown) return;
    const state = getState();
    const query = presetFilterActive ? (presetInput?.value.trim().toLocaleLowerCase() || '') : '';
    const presets = (state?.presets || []).filter((preset) =>
      preset.name.toLocaleLowerCase().includes(query)
    );
    presetDropdown.replaceChildren();

    presets.forEach((preset) => {
      const row = document.createElement('div');
      row.className = 'video-enhancer-preset-item';

      const applyButton = document.createElement('button');
      applyButton.type = 'button';
      applyButton.className = 'video-enhancer-preset-option';
      applyButton.setAttribute('role', 'menuitem');
      applyButton.textContent = preset.name;
      applyButton.title = preset.name;
      applyButton.setAttribute('aria-label', `Apply preset ${preset.name}`);
      applyButton.addEventListener('click', () => handleApplyPreset(preset.id));

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'video-enhancer-preset-delete';
      deleteButton.setAttribute('role', 'menuitem');
      deleteButton.innerHTML = DELETE_ICON;
      deleteButton.title = `Delete ${preset.name}`;
      deleteButton.setAttribute('aria-label', `Delete preset ${preset.name}`);
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        handleDeletePreset(preset.id);
      });

      row.append(applyButton, deleteButton);
      presetDropdown.appendChild(row);
    });

    if (!presetDropdown.childElementCount && !presetDropdown.hidden) setPresetDropdownOpen(false);
    updateSaveButton();
  };

  const setPresetDropdownOpen = (isOpen) => {
    if (!presetDropdown || !presetDropdownButton) return;
    const shouldShow = Boolean(isOpen && presetDropdown.childElementCount);
    presetDropdown.hidden = !shouldShow;
    presetControl?.classList.toggle('video-enhancer-preset-open', shouldShow);
    presetDropdownButton.setAttribute('aria-expanded', String(shouldShow));
    presetInput?.setAttribute('aria-expanded', String(shouldShow));
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
    updatePresetOptions();
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
    
    // Update UI immediately
    if (panelNode && panelNode.isConnected) {
      syncUI();
    }
    
    VN.schedulePersist?.('main-toggle');
    
    // Apply or remove filter
    if (newEnabled) {
      VN.scheduleRefresh?.('main-toggle');
    } else {
      VN.updateAllVideos?.(null);
    }
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
  };

  const handleOverlayToggle = (event) => {
    const state = getState();
    if (!state) return;
    
    state.overlayEnabled = event?.target?.checked ?? !state.overlayEnabled;
    
    // Update UI immediately
    syncUI();
    
    // Refresh overlay visibility (will hide if disabled)
    VN.overlay?.refresh?.();
    
    VN.schedulePersist?.('overlay-toggle');
  };

  const handleSliderInput = (key, event) => {
    const state = getState();
    if (!state) return;
    
    const rawValue = Number(event.target.value);
    const normalized = rawValue / 100;
    state.settings[key] = Number(normalized.toFixed(3));
    
    const label = sliderValueLabels[key];
    if (label) {
      label.textContent = formatSliderValue(key, state.settings[key]);
    }
    
    VN.schedulePersist?.(`slider-${key}`);
    if (state.enabled) {
      VN.scheduleRefresh?.(`slider-${key}`);
    }
  };

  const handleResetSettings = () => {
    const state = getState();
    if (!state) return;
    state.settings = { ...VN.DEFAULT_SETTINGS };
    syncUI();
    VN.schedulePersist?.('settings-reset');
    if (state.enabled) VN.scheduleRefresh?.('settings-reset');
  };

  const handleSavePreset = () => {
    const state = getState();
    const name = presetInput?.value.trim().slice(0, 40) || '';
    if (!state) return;
    if (!name) {
      presetInput?.focus();
      return;
    }

    const existing = state.presets.find((preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!existing && state.presets.length >= 50) return;

    const settings = VN.normalizeSettings(state.settings, VN.DEFAULT_SETTINGS);
    const preset = existing || {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      settings
    };
    preset.name = name;
    preset.settings = settings;
    if (!existing) state.presets.push(preset);

    presetFilterActive = false;
    updatePresetOptions();
    setPresetDropdownOpen(false);
    VN.schedulePersist?.('preset-save');
    if (savePresetButton) {
      savePresetButton.classList.add('video-enhancer-saved');
      window.clearTimeout(savePresetButton._savedTimer);
      savePresetButton._savedTimer = window.setTimeout(() => {
        savePresetButton?.classList.remove('video-enhancer-saved');
      }, 150);
    }
  };

  const handleApplyPreset = (presetId) => {
    const state = getState();
    const preset = state?.presets.find((item) => item.id === presetId);
    if (!state || !preset) return;
    state.settings = VN.normalizeSettings(preset.settings, VN.DEFAULT_SETTINGS);
    presetFilterActive = false;
    if (presetInput) presetInput.value = preset.name;
    updatePresetOptions();
    setPresetDropdownOpen(false);
    syncUI();
    VN.schedulePersist?.('preset-apply');
    if (state.enabled) VN.scheduleRefresh?.('preset-apply');
  };

  const handleDeletePreset = (presetId, keepDropdownOpen = true) => {
    const state = getState();
    if (!state || !presetId) return;
    const preset = state.presets.find((item) => item.id === presetId);
    state.presets = state.presets.filter((item) => item.id !== presetId);
    if (preset && presetInput?.value.trim().toLocaleLowerCase() === preset.name.toLocaleLowerCase()) {
      presetInput.value = '';
      presetFilterActive = false;
    }
    updatePresetOptions();
    setPresetDropdownOpen(keepDropdownOpen);
    if (keepDropdownOpen) presetInput?.focus();
    VN.schedulePersist?.('preset-delete');
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
    presetControl = panelNode.querySelector('.video-enhancer-preset-combo');
    presetInput = panelNode.querySelector('#video-enhancer-preset-input');
    presetDropdownButton = panelNode.querySelector('#video-enhancer-preset-dropdown-toggle');
    presetDropdown = panelNode.querySelector('#video-enhancer-preset-dropdown');
    savePresetButton = panelNode.querySelector('#video-enhancer-save-preset');
    presetExportButton = panelNode.querySelector('#video-enhancer-export-settings');
    presetImportButton = panelNode.querySelector('#video-enhancer-import-settings');
    presetImportFileInput = panelNode.querySelector('#video-enhancer-import-file');
    presetIoStatus = panelNode.querySelector('#video-enhancer-preset-io-status');

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

    Object.entries(sliderValueLabels).forEach(([key, label]) => {
      label?.addEventListener('dblclick', () => openSliderValueEditor(key));
      label?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openSliderValueEditor(key);
        }
      });
    });

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
    panelNode.querySelector('#video-enhancer-reset-settings')?.addEventListener('click', handleResetSettings);
    savePresetButton?.addEventListener('click', handleSavePreset);
    presetExportButton?.addEventListener('click', handleExportSettings);
    presetImportButton?.addEventListener('click', () => {
      setPresetIoStatus('');
      if (presetImportFileInput) {
        presetImportFileInput.value = '';
        presetImportFileInput.click();
      }
    });
    presetImportFileInput?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      handleImportSettings(file).finally(() => {
        event.target.value = '';
      });
    });
    // Typing only names a preset; the list opens from the chevron (filtering if already open)
    presetInput?.addEventListener('input', () => {
      presetFilterActive = true;
      updatePresetOptions();
    });
    // Keep focus in the input while clicking the chevron or menu rows
    presetDropdownButton?.addEventListener('mousedown', (event) => event.preventDefault());
    presetDropdown?.addEventListener('mousedown', (event) => event.preventDefault());
    presetDropdownButton?.addEventListener('click', () => {
      const shouldOpen = presetDropdown?.hidden ?? true;
      if (shouldOpen) presetFilterActive = false;
      updatePresetOptions();
      setPresetDropdownOpen(shouldOpen);
      if (shouldOpen) presetInput?.focus();
    });
    presetInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSavePreset();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        updatePresetOptions();
        setPresetDropdownOpen(true);
        presetDropdown?.querySelector('.video-enhancer-preset-option')?.focus();
      } else if (event.key === 'Escape') {
        setPresetDropdownOpen(false);
      }
    });
    presetControl?.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (!presetControl?.contains(document.activeElement)) setPresetDropdownOpen(false);
      }, 0);
    });
    if (!presetDismissListenerInstalled) {
      document.addEventListener('pointerdown', (event) => {
        if (presetControl && !presetControl.contains(event.target)) setPresetDropdownOpen(false);
      }, true);
      presetDismissListenerInstalled = true;
    }

    // Sliders
    sliderInputs.sharpen?.addEventListener('input', (e) => handleSliderInput('sharpen', e));
    sliderInputs.contrast?.addEventListener('input', (e) => handleSliderInput('contrast', e));
    sliderInputs.saturation?.addEventListener('input', (e) => handleSliderInput('saturation', e));
    sliderInputs.brightness?.addEventListener('input', (e) => handleSliderInput('brightness', e));
    sliderInputs.gamma?.addEventListener('input', (e) => handleSliderInput('gamma', e));
    Object.entries(sliderInputs).forEach(([key, slider]) => {
      slider?.addEventListener('wheel', (event) => handleSliderWheel(key, event), { passive: false });
    });
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
        <div class="video-enhancer-preset-tools">
          <div id="video-enhancer-preset-title" class="video-enhancer-preset-title">Presets</div>
          <div class="video-enhancer-preset-row-layout">
            <div class="video-enhancer-preset-combo">
              <input id="video-enhancer-preset-input" type="text" maxlength="40" aria-labelledby="video-enhancer-preset-title" autocomplete="off" spellcheck="false" aria-controls="video-enhancer-preset-dropdown" aria-expanded="false" />
              <button id="video-enhancer-preset-dropdown-toggle" type="button" class="video-enhancer-preset-chevron" tabindex="-1" aria-label="Show saved presets" aria-haspopup="menu" aria-controls="video-enhancer-preset-dropdown" aria-expanded="false">${CHEVRON_ICON}</button>
              <div id="video-enhancer-preset-dropdown" class="video-enhancer-preset-menu" role="menu" aria-label="Saved presets" hidden></div>
            </div>
            <button id="video-enhancer-save-preset" type="button" class="video-enhancer-secondary-button video-enhancer-preset-save" disabled>Save</button>
          </div>
        </div>
        <div class="video-enhancer-slider-group">
          <div class="video-enhancer-slider-label">
            <label for="video-enhancer-custom-sharpen">Sharpen</label>
            <span id="video-enhancer-custom-sharpen-value" class="video-enhancer-slider-value" role="button" tabindex="0" title="Double-click to enter a specific value" aria-label="Edit sharpen value">30%</span>
          </div>
          <input id="video-enhancer-custom-sharpen" type="range" min="0" max="150" step="1" value="30" />
        </div>
        <div class="video-enhancer-slider-group">
          <div class="video-enhancer-slider-label">
            <label for="video-enhancer-custom-contrast">Contrast</label>
            <span id="video-enhancer-custom-contrast-value" class="video-enhancer-slider-value" role="button" tabindex="0" title="Double-click to enter a specific value" aria-label="Edit contrast value">110%</span>
          </div>
          <input id="video-enhancer-custom-contrast" type="range" min="50" max="200" step="1" value="110" />
        </div>
        <div class="video-enhancer-slider-group">
          <div class="video-enhancer-slider-label">
            <label for="video-enhancer-custom-saturation">Saturation</label>
            <span id="video-enhancer-custom-saturation-value" class="video-enhancer-slider-value" role="button" tabindex="0" title="Double-click to enter a specific value" aria-label="Edit saturation value">110%</span>
          </div>
          <input id="video-enhancer-custom-saturation" type="range" min="50" max="200" step="1" value="110" />
        </div>
        <div class="video-enhancer-slider-group">
          <div class="video-enhancer-slider-label">
            <label for="video-enhancer-custom-brightness">Brightness</label>
            <span id="video-enhancer-custom-brightness-value" class="video-enhancer-slider-value" role="button" tabindex="0" title="Double-click to enter a specific value" aria-label="Edit brightness value">100%</span>
          </div>
          <input id="video-enhancer-custom-brightness" type="range" min="50" max="200" step="1" value="100" />
        </div>
        <div class="video-enhancer-slider-group">
          <div class="video-enhancer-slider-label">
            <label for="video-enhancer-custom-gamma">Gamma</label>
            <span id="video-enhancer-custom-gamma-value" class="video-enhancer-slider-value" role="button" tabindex="0" title="Double-click to enter a specific value" aria-label="Edit gamma value">1.10</span>
          </div>
          <input id="video-enhancer-custom-gamma" type="range" min="50" max="200" step="1" value="110" />
        </div>
        <button id="video-enhancer-reset-settings" type="button" class="video-enhancer-secondary-button">Reset to default</button>
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
        <details class="video-enhancer-preset-io">
          <summary>Backup &amp; restore</summary>
          <div class="video-enhancer-preset-io-content">
            <div class="video-enhancer-preset-io-help">Move settings and profiles between installs.</div>
            <div class="video-enhancer-preset-io-buttons">
              <button id="video-enhancer-export-settings" type="button" class="video-enhancer-secondary-button" title="Download current settings and saved profiles">Export</button>
              <button id="video-enhancer-import-settings" type="button" class="video-enhancer-secondary-button" title="Import settings and saved profiles from a JSON file">Import</button>
              <input id="video-enhancer-import-file" type="file" accept=".json,application/json" hidden />
            </div>
            <div id="video-enhancer-preset-io-status" class="video-enhancer-preset-io-status" role="status" aria-live="polite"></div>
          </div>
        </details>
      </div>
    `;

    ensurePanelHost();
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

    // Check if panel already exists in DOM (e.g., from previous injection)
    if (!panelNode) {
      panelNode = document.getElementById('video-enhancer-panel');
    }

    // If panel exists and is connected, ensure it's wired and hosted correctly
    if (panelNode && panelNode.isConnected) {
      ensurePanelHost();
      wirePanelNode();
      return;
    }

    // Create new panel if needed
    if (!panelNode) {
      createPanelNode();
      wirePanelNode();
    }
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
    
    // Always sync UI when visibility changes to ensure correct state
    if (panelNode) {
      syncUI();
    }

    VN.schedulePersist?.('panel-visibility');
  };

  // Toggle panel visibility
  panelApi.toggle = () => {
    const state = getState();
    const newVisible = !state?.panelVisible;
    
    // If opening, ensure panel exists and is wired first
    if (newVisible) {
      panelApi.ensure();
    }
    
    panelApi.setVisible(newVisible);
  };

  // Sync UI to current state
  panelApi.syncUI = syncUI;

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

  // Keep the panel in the active fullscreen subtree (and move it back on exit).
  const fullscreenEvents = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
  fullscreenEvents.forEach((evt) => document.addEventListener(evt, () => {
    ensurePanelHost();
    if (getState()?.panelVisible) applyPanelPosition();
  }, true));

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
