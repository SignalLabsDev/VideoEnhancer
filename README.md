# Video Enhancer

Open source and lightweight video enhancer for Twitch, YouTube, and Kick. Give streams a sharper, more vivid look with a single click or fine-tuned controls.

## Key Features

- **Context-aware overlay controls** – hover the primary video to toggle enhancement or open settings. On YouTube, the controls follow YouTube's own controls in windowed and fullscreen playback.
- **Floating control panel** – drag the panel anywhere, switch between a one-click preset and fully custom sliders for sharpen, contrast, saturation, brightness, and gamma.
- **Direct slider editing** – double-click a value to enter a specific number, or scroll over a slider to adjust it one unit at a time (0.01 for gamma).
- **Saved presets and reset** – save, apply, and delete named slider profiles, or restore the built-in filter defaults.
- **Settings backup** – export and import settings and saved profiles from the Backup & restore section at the bottom of the Settings tab.
- **Fullscreen auto-hide** – on other video players, the inline overlay fades after three seconds without mouse or keyboard activity and returns when you interact again.
- **Responsive to SPA navigation** – the overlay follows you across watch pages and live channels without reloads.
- **GPU-friendly sharpening** – blends CSS filters with an SVG-based sharpen pass for crisp playback on modern hardware.

## How It Works

1. Pin the extension and click the toolbar icon whenever you want to open or hide the control panel.
2. Start with the preset toggle for an instant boost, or move to the Settings tab to dial in each filter individually. Double-click a value to type it directly, and save named profiles to reuse settings later.
3. Use **Reset to default** to restore the extension's built-in filter defaults. Settings and profiles persist in this Chrome profile. Use **Backup & restore** to move them between installs.

## Tips

- The overlay controls stay out of the way when the video isn't hovered. On YouTube, they fade with YouTube's controls; on other players, the overlay fades after three seconds of fullscreen inactivity.
- If you notice halos at high sharpen levels, lower contrast slightly for a more balanced image.
- The panel remembers its position; drag it to a comfortable spot and it will stay there the next time you open it.

