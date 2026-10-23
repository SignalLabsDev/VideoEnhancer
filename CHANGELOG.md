# Changelog

## Unreleased (review-fixes)

### Fixed

- Keep the control panel and inline overlay inside the fullscreen element, and reposition the overlay immediately on fullscreen changes.
- Apply filters only to the primary video, avoiding GPU work on offscreen previews and secondary players.
- Use a real per-channel gamma transfer in SVG filter mode, with a CSS fallback in compatibility mode.
- Restore keyboard access to the Settings tab and visible focus indicators across the panel.
- Make preset overwrite, deletion, and the 50-preset limit explicit instead of silent.
- Keep the panel within the viewport with scrolling for short screens and clamped restored positions.
- Remove invisible overlay controls from the tab order, add accessible names and pressed state, and restore focus after keyboard slider editing.
- Relay iframe panel toggle requests through the extension service worker instead of accepting page-forgeable window messages.

### Changed

- Keep the preset action labeled Save, show status feedback only for save results and errors, and use a single purple border on text fields while they are being edited.

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
