chrome.action.onClicked.addListener((tab) => {
  if (!tab || tab.id === undefined) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'VIDEO_ENHANCER_TOGGLE_PANEL' }, () => {
    const error = chrome.runtime.lastError;
    if (error) {
      console.debug('Video Enhancer toggle message error:', error.message);
    }
  });
});

