'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 've-constants.js'), 'utf8');

const settings = (overrides = {}) => ({
  sharpen: 0.3,
  contrast: 1,
  saturation: 1.15,
  brightness: 1,
  gamma: 1.1,
  ...overrides
});

const preset = (id, name, overrides = {}) => ({
  id,
  name,
  settings: settings(overrides)
});

const changes = ({
  fields = [],
  settingKeys = [],
  presetUpserts = [],
  presetDeletes = []
} = {}) => ({
  fields: new Set(fields),
  settings: new Set(settingKeys),
  presetUpserts: new Set(presetUpserts),
  presetDeletes: new Set(presetDeletes)
});

const load = (chrome) => {
  const sandbox = { window: {}, chrome, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 've-constants.js' });
  return sandbox.window.VideoEnhancer;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const testMerge = () => {
  const VN = load(undefined);
  const remote = {
    revision: 4,
    enabled: true,
    panelVisible: false,
    activeTab: 'preset',
    compatibilityMode: false,
    overlayEnabled: true,
    settings: settings({ contrast: 1.4 }),
    presets: [preset('a', 'Day'), preset('b', 'Night')],
    panelPosition: { useCustom: true, top: 40, left: 20 }
  };
  const local = {
    enabled: false,
    panelVisible: true,
    activeTab: 'custom',
    compatibilityMode: true,
    overlayEnabled: false,
    settings: settings({ sharpen: 0.8 }),
    presets: [preset('a', 'Day'), preset('c', 'Film', { gamma: 1.2 })],
    panelPosition: { useCustom: false, top: 80, left: null }
  };

  const merged = VN.mergePersistData(remote, local, changes({
    fields: ['enabled'],
    settingKeys: ['sharpen'],
    presetUpserts: ['c'],
    presetDeletes: ['b']
  }));

  assert.strictEqual(merged.enabled, false, 'local toggle should win');
  assert.strictEqual(merged.panelVisible, false, 'untouched panel flag should stay stored');
  assert.strictEqual(merged.activeTab, 'preset');
  assert.strictEqual(merged.compatibilityMode, false);
  assert.strictEqual(merged.overlayEnabled, true);
  assert.strictEqual(merged.settings.sharpen, 0.8, 'local slider should win');
  assert.strictEqual(merged.settings.contrast, 1.4, 'other tab slider should stay');
  assert.strictEqual(merged.presets.map((item) => item.id).join(','), 'a,c');
  assert.strictEqual(merged.presets.find((item) => item.id === 'c').settings.gamma, 1.2);
  assert.strictEqual(merged.panelPosition.useCustom, true);
  assert.strictEqual(merged.panelPosition.top, 40);
  assert.strictEqual(merged.panelPosition.left, 20);
  assert.strictEqual(merged.revision, 5);

  const sameSlider = VN.mergePersistData(remote, local, changes({ settingKeys: ['contrast'] }));
  assert.strictEqual(sameSlider.settings.contrast, 1, 'local edit of the same slider wins');
  assert.strictEqual(sameSlider.settings.sharpen, 0.3, 'untouched slider stays stored');
  assert.strictEqual(
    sameSlider.presets.map((item) => item.id).join(','),
    'a,b',
    'no preset edit should not restore a locally cached preset'
  );
};

const testWheel = () => {
  const VN = load(undefined);
  const step = (previous, delta, now, focused) => {
    const result = VN.nextWheelState(previous, delta, { now, focused });
    return {
      step: result.step,
      consume: result.consume,
      state: {
        delta: result.state.delta,
        lastStep: result.state.lastStep,
        lastEvent: result.state.lastEvent,
        claimed: result.state.claimed
      }
    };
  };

  let focused = step(null, 8, 0, true);
  assert.strictEqual(focused.step, false);
  assert.strictEqual(Boolean(focused.consume), true, 'a focused slider should not let the panel scroll');

  focused = step(focused.state, 8, 250, true);
  assert.strictEqual(focused.step, true, 'a short pause should not throw away a light swipe');
  assert.strictEqual(focused.state.delta, 0);

  let unfocused = step(null, 4, 0, false);
  assert.strictEqual(unfocused.consume, false, 'a tiny unfocused scroll should scroll the panel');
  unfocused = step(unfocused.state, 4, 400, false);
  assert.strictEqual(unfocused.state.delta, 4, 'a real pause should start a new scroll');
  assert.strictEqual(unfocused.step, false);

  const notch = step(null, -100, 0, false);
  assert.strictEqual(notch.step, true);
  assert.strictEqual(notch.consume, true);
  assert.ok(Math.abs(notch.state.delta) < 16, 'one flick should not bank extra steps');

  const follow = step(notch.state, -4, 50, false);
  assert.strictEqual(follow.step, false, 'the next small movement should not cash in a banked flick');

  const turned = step({ delta: 10, lastStep: -40, lastEvent: 0, claimed: false }, -4, 20, true);
  assert.strictEqual(turned.state.delta, -4, 'changing direction should not keep the old total');
  assert.strictEqual(turned.step, false);
};

const createChrome = () => {
  const store = {};
  const sets = [];
  const chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(_key, callback) {
          chrome.runtime.lastError = chrome.storage.local.failGet
            ? { message: chrome.storage.local.failGet }
            : null;
          callback({ ...store });
          chrome.runtime.lastError = null;
        },
        set(items, callback) {
          sets.push(items);
          chrome.runtime.lastError = chrome.storage.local.failSet
            ? { message: chrome.storage.local.failSet }
            : null;
          if (!chrome.runtime.lastError) Object.assign(store, items);
          if (callback) callback();
          chrome.runtime.lastError = null;
        }
      }
    }
  };
  return { chrome, store, sets };
};

const testFailedReadDoesNotOverwrite = async () => {
  const { chrome, store, sets } = createChrome();
  store.videoEnhancerState = {
    version: 1,
    data: {
      enabled: true,
      settings: settings({ sharpen: 0.9 }),
      presets: [preset('a', 'Day')]
    }
  };
  chrome.storage.local.failGet = 'Extension context invalidated.';
  const VN = load(chrome);
  await VN.loadPersistedState();

  assert.strictEqual(VN.state.settings.sharpen, 0.3, 'failed read should not invent empty settings');
  VN.state.enabled = false;
  VN.consts.PERSIST_DEBOUNCE_MS = 0;
  VN.schedulePersist('main-toggle');
  await wait(30);
  assert.strictEqual(sets.length, 0, 'a failed read must not be saved back');
  assert.strictEqual(store.videoEnhancerState.data.settings.sharpen, 0.9);
};

const testSaveMergesOtherTab = async () => {
  const { chrome, store, sets } = createChrome();
  store.videoEnhancerState = {
    version: 1,
    data: {
      revision: 2,
      enabled: true,
      panelVisible: false,
      activeTab: 'preset',
      compatibilityMode: false,
      overlayEnabled: true,
      settings: settings(),
      presets: [preset('a', 'Day'), preset('b', 'Night')],
      panelPosition: { useCustom: false, top: 80, left: null }
    }
  };
  const VN = load(chrome);
  await VN.loadPersistedState();
  VN.consts.PERSIST_DEBOUNCE_MS = 0;

  VN.notePresetDelete('b');
  VN.state.presets = VN.state.presets.filter((item) => item.id !== 'b');
  VN.state.settings = settings({ sharpen: 0.8 });
  VN.schedulePersist('slider-sharpen');

  store.videoEnhancerState = {
    version: 1,
    data: {
      ...store.videoEnhancerState.data,
      revision: 3,
      settings: settings({ contrast: 1.5 }),
      presets: [preset('a', 'Day'), preset('b', 'Night'), preset('c', 'Film')]
    }
  };

  await wait(40);
  const saved = sets.at(-1).videoEnhancerState.data;
  assert.strictEqual(saved.presets.map((item) => item.id).join(','), 'a,c');
  assert.strictEqual(saved.settings.sharpen, 0.8);
  assert.strictEqual(saved.settings.contrast, 1.5);
  assert.strictEqual(saved.revision, 4);
  assert.strictEqual(store.videoEnhancerState.data.revision, 4);
};

const testDeadWriteDoesNotRetryForever = async () => {
  const { chrome, sets } = createChrome();
  const VN = load(chrome);
  chrome.storage.local.failSet = 'Extension context invalidated.';
  await VN.loadPersistedState();
  VN.consts.PERSIST_DEBOUNCE_MS = 0;
  VN.state.enabled = false;
  VN.schedulePersist('main-toggle');
  await wait(80);
  assert.strictEqual(sets.length, 1, 'a dead extension should not keep retrying the save');
};

const main = async () => {
  testMerge();
  testWheel();
  await testFailedReadDoesNotOverwrite();
  await testSaveMergesOtherTab();
  await testDeadWriteDoesNotRetryForever();
  console.log('storage-sync tests passed');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
