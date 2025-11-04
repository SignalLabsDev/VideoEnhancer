# Video Enhancer Chrome Extension

Enhance Twitch and YouTube playback with a one-click preset or fine-grained custom controls for sharpening, contrast, and saturation.

## Features

- **Preset tab** – a single toggle applies tuned values (sharpen 55%, contrast +10%, saturation +15%) to YouTube (web/mobile/music) and Twitch players
- **Custom tab** – adjust sharpening (0–150%), contrast & saturation (50–200%); changes start from the preset and persist across sessions
- **Toolbar toggle** – use the Chrome toolbar button to show/hide the floating panel
- **GPU-accelerated pipeline** – combines CSS contrast/saturation with an SVG `feConvolveMatrix` sharpen pass for real-time updates
- **SPA aware** – MutationObserver keeps new/changed videos in sync on both platforms, including Twitch channel switches and YouTube navigation

## Usage

- Click the extension’s toolbar icon to toggle the control panel
- Use the **Preset** tab’s toggle to turn the effect on or off (it’s off by default)
- Switch to the **Custom** tab to dial in sharpening, contrast, and saturation; adjustments update the stream in real time and persist across sessions
- Effect state applies to all visible videos on the page and persists through dynamic content updates until you toggle it off

## Notes

- The floating panel can be dragged by its header; double-check positioning if you resize the window or use smaller viewports
- Custom slider values persist; adjust the defaults in `contentScript.js` (see `PRESET_SETTINGS`) if you want a different starting point
- For extreme sharpening levels, consider pairing with lower contrast to avoid halos on high-contrast footage


