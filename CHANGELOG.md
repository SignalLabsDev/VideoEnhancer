# Changelog

## 2.2.1 – 2026-10-24

### Fixed

- Keep the panel and overlay out of the page's CSS, so a site cannot change their font, button size, or control styles. Load that stylesheet through the extension, since pages such as YouTube block extension URLs.
- Keep the overlay buttons visible while the pointer is on them, instead of letting the player hide its controls and taking the buttons with it.

## 2.2.0 – 2026-10-24

### Fixed

- Merge a tab's settings save into what is already stored, so one tab cannot put back a preset another tab deleted or overwrite a slider the other tab moved.
- Keep a slider's trackpad scroll on the slider, and count a light swipe as one step, so the value moves one at a time without needing a long flick.
- Ignore a failed settings read instead of later saving this tab's in-memory defaults over settings that are still stored.
- Acknowledge panel-toggle messages so the toolbar button no longer re-injects the content scripts into every frame on each click.
- Keep the video that already has the filter when the overlay has no in-view target, instead of switching to an unrelated offscreen preview.
- Preserve fullscreen idle state across transient player gaps so the overlay does not reappear without mouse or keyboard input.
- Accumulate trackpad wheel deltas into single slider steps, and let the panel scroll when a slider is already at its limit.
- Remove the blocking delete confirmation; the row's delete button now removes the preset immediately.
- Keep the preset menu inside the panel's visible area on short windows, and make it reachable with the keyboard.
- Keep overlay controls hidden while a native `<video>` element is fullscreen, including after scroll, resize, and video mutations reposition the overlay.
- Keep an inline `none` or other CSS-wide filter keyword, including `revert-layer`, when the enhancement adds no functions, so a stylesheet filter does not show through and `revert-layer` is not joined into an invalid value.
- Recreate the SVG filter when a page removes it and inserts nothing else, instead of leaving a dangling `url(#…)` on a static video.
- Count one line-mode mouse-wheel notch as one slider step.
- Return keyboard focus to the slider when Enter commits a typed value.
- Show the panel focus ring on the preset name field when it is focused from the keyboard.
- Only accept numeric stored settings, and ignore unknown storage schema versions.
- Keep the control panel and inline overlay inside the fullscreen element, and reposition the overlay immediately on fullscreen changes.
- Apply filters only to the primary video, avoiding GPU work on offscreen previews and secondary players.
- Use a real per-channel gamma transfer in SVG filter mode, with a CSS fallback in compatibility mode.
- Restore keyboard access to the Settings tab and visible focus indicators across the panel.
- Make preset overwrite, deletion, and the 50-preset limit explicit instead of silent.
- Keep the panel within the viewport with scrolling for short screens and clamped restored positions.
- Remove invisible overlay controls from the tab order, add accessible names and pressed state, and restore focus after keyboard slider editing.
- Relay iframe panel toggle requests through the extension service worker instead of accepting page-forgeable window messages.

### Changed

- Keep the preset action labeled Save and use a single purple border on slider value fields while they are being edited.
- Remove the dead isolated-world `history.pushState` hooks; SPA navigation is handled by `popstate`, YouTube navigation events, the mutation observer, and the watchdog.
- Remove unused filter, preset, and settings constants.
- Make slider values regular text fields: single click places the caret, double-click selects the whole number, and the purple focus border moves from the preset field to the value editor.
- Show an italic “No presets saved yet” placeholder in the preset menu when the list is empty, and “No matching presets” when a filter has no matches.

## 2.1.1 – 2026-10-23

### Fixed

- Keep inline overlay controls visible and correctly positioned over YouTube's end screen when its controls are visible.

## 2.1.0 – 2026-10-23

### Added

- Save, apply, and delete named slider profiles.
- Export and import settings and profiles as JSON for backup or transfer between installs.
- Reset custom filter settings to their built-in defaults.
- Double-click slider values to enter exact numbers, and scroll over a slider to adjust it in one-unit increments (0.01 for gamma).

### Improved

- Make inline overlay controls follow YouTube's visible controls in windowed and fullscreen playback, fading away with them.
- Keep numeric editing compact and stable, select the current number for replacement, and show a muted focus border.
- Keep the overlay idle timeout for fullscreen playback on other video players.
