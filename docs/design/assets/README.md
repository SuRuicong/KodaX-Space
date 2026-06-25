# KodaX Manta Pulse — SVG + TUI asset kit

This package turns the selected **Manta Pulse** direction into real, editable assets. Everything is original vector/code; no raster tracing is required.

## Files

### Static SVG

- `svg/kodax-manta-mark.svg` — transparent primary mark with cyan/blue gradient.
- `svg/kodax-manta-mark-mono.svg` — filled monochrome mark; uses `currentColor` when inlined.
- `svg/kodax-manta-mark-monoline.svg` — outline-only, suitable for tiny UI and engraving.
- `svg/kodax-manta-app-icon.svg` — 512×512 rounded-square application icon.
- `svg/kodax-manta-favicon.svg` — simplified 64×64 mark.
- `svg/kodax-manta-symbols.svg` — inline SVG sprite with filled and outline symbols.

### Animated SVG states

Located in `svg/motion/`:

`idle`, `thinking`, `scan`, `streaming`, `tool`, `agents`, `success`, `warning`, and `error`.

The animations use SVG + CSS only. They include a `prefers-reduced-motion` fallback. The state files are separate so they also work when loaded with `<img>`:

```html
<img src="/brand/kodax-manta-kit/svg/motion/kodax-manta-thinking.svg" width="96" alt="KodaX thinking">
```

Open `web/motion-gallery.html` to inspect all states together.

## TUI

### Dependency-free terminal demo

```bash
node tui/manta-ansi-demo.mjs --state cycle --unicode --label
node tui/manta-ansi-demo.mjs --state thinking --ascii
node tui/manta-ansi-demo.mjs --state tool --compact
node tui/manta-ansi-demo.mjs --state success --once --no-color
```

The demo detects truecolor/256-color/16-color terminals and respects the `NO_COLOR` convention. ASCII is the default because it is width-stable across CJK terminals; `--unicode` enables box drawing.

### Ink/React component

`KodaXManta.tsx` is designed for KodaX's Ink-based REPL:

```tsx
import {KodaXManta} from './KodaXManta.js';

<KodaXManta
  state="thinking"
  charset="ascii"
  compact={false}
  showLabel
/>
```

Suggested state mapping:

| KodaX event | Manta state |
|---|---|
| waiting / ready | `idle` |
| model request pending | `loading` |
| streaming tokens | `active` |
| reasoning | `thinking` |
| tool execution | `tool` |
| agent team / child tasks | `agents` |
| completed | `success` |
| permission / soft failure | `warning` |
| hard failure | `error` |

Set `KODAX_REDUCED_MOTION=1` to stop the Ink animation.

## Brand geometry

The mark uses one mirrored wing silhouette, one vertical spine, one four-point core, and one flowing tail. This keeps it recognizable in GUI while allowing a terminal translation using only lines, a center point, and a tail. The silhouette remains legible in monochrome and at favicon scale.

## Production notes

- Keep the primary mark transparent. Use the app-icon file only for dock/taskbar contexts.
- For 16–24 px sizes, prefer `favicon.svg` or `mark-monoline.svg`.
- Success/error SVGs contain one-shot-like emphasis inside a loop for preview. In an inline production component, set the relevant animation iteration count to `1` when the state transition should not repeat.
- The SVG source deliberately uses simple Bézier paths and standard CSS animations so it can be edited in Figma, Illustrator, Inkscape, or directly in code.
