const CONTENT_SCRIPT_FILES = [
  've-constants.js',
  've-filters.js',
  've-overlay.js',
  've-panel.js',
  'contentScript.js'
];

const CONTENT_CSS_FILES = ['contentStyles.css'];

const sendTogglePanelMessage = (tabId) => new Promise((resolve) => {
  // Important: target only the top frame; otherwise every frame toggles and it can "flash".
  chrome.tabs.sendMessage(tabId, { type: 'VIDEO_ENHANCER_TOGGLE_PANEL' }, { frameId: 0 }, () => {
    const error = chrome.runtime.lastError;
    if (error) {
      resolve({ ok: false, error });
      return;
    }
    resolve({ ok: true });
  });
});

const ensureContentScriptInjected = async (tabId) => {
  // These calls can fail on restricted pages (chrome://, edge://, etc.).
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: CONTENT_CSS_FILES
    });
  } catch (e) {
    // Non-fatal; scripts may still work without re-inserting CSS.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: CONTENT_SCRIPT_FILES
    });
    return true;
  } catch (e) {
    console.debug('Video Enhancer injection error:', e?.message || String(e));
    return false;
  }
};

// Iframe overlays and content scripts ask the worker to toggle the top-frame
// panel. Use runtime messaging instead of window.postMessage so page scripts
// cannot forge the request.
let uiCssPromise = null;
const loadUiCss = () => {
  if (!uiCssPromise) {
    uiCssPromise = fetch(chrome.runtime.getURL('contentStyles.css'))
      .then((response) => response.text())
      .catch((error) => {
        uiCssPromise = null;
        throw error;
      });
  }
  return uiCssPromise;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // A page cannot fetch an extension URL. The worker can, so it reads the
  // stylesheet and hands the text back for the shadow root.
  if (message?.type === 'VIDEO_ENHANCER_GET_UI_CSS') {
    loadUiCss()
      .then((css) => sendResponse({ ok: true, css }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type !== 'VIDEO_ENHANCER_TOGGLE_PANEL_FROM_FRAME') return;

  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') {
    sendResponse({ ok: false, error: 'No sender tab' });
    return;
  }

  sendTogglePanelMessage(tabId).then((result) => {
    sendResponse({ ok: result.ok, error: result.error?.message || null });
  });
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab || tab.id === undefined) return;

  (async () => {
    const firstAttempt = await sendTogglePanelMessage(tab.id);
    if (firstAttempt.ok) return;

    // Most common cause: content script not ready yet (fresh navigation / SPA).
    const injected = await ensureContentScriptInjected(tab.id);
    if (!injected) return;

    const secondAttempt = await sendTogglePanelMessage(tab.id);
    if (!secondAttempt.ok) {
      console.debug('Video Enhancer toggle message error:', secondAttempt.error?.message);
    }
  })();
});

