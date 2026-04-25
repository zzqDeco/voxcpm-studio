# VoxCPM Studio Design System

> Global source of truth for `apps/demo-web`.
> Page overrides may live in `design-system/pages/`, but this file defines the default product language.

## Direction

- **Source:** UI UX Pro Max, refined for a local AI voice lab.
- **Pattern:** `Data-Dense Dashboard` + `Comparative Analysis Dashboard`.
- **Product Form:** `Instrument Control Console`, not marketing dashboard.
- **Audience:** operators running inference, streaming, ASR, bench, training, and history review locally.
- **Language:** zh-CN first, with stable English technical labels where the API already uses them.

## Visual Rules

- Use a light operational surface: warm stone page base, white/zinc cards, graphite text.
- Cobalt is the only primary action color; amber is reserved for warning, attention, and signal highlights.
- Avoid purple, decorative gradients, emoji icons, and oversized marketing hero layouts.
- Cards, inputs, and buttons use a compact 6-8px radius. Pills are the only fully rounded shape.
- Use `Fira Code`/mono for metrics, logs, IDs, and technical labels; use the body sans stack for dense controls.
- Motion stays between 150ms and 300ms, respects `prefers-reduced-motion`, and never shifts layout on hover.

## Interaction Model

- The app shell is a command header plus sticky workspace rail.
- Runtime, active model, busy state, device capability, latest task, and counts must be visible without opening a tab.
- Each workspace follows a task flow:
  - `Playground`: Compose -> Generate -> Inspect.
  - `Compare`: Select pair -> Inspect deltas -> Review candidates.
  - `Bench`: Configure scenarios -> Run matrix -> Review results/skips.
  - `Training`: Prepare config -> Launch -> Monitor logs -> Apply checkpoint.
  - `History`: Filter -> Select -> Reuse or compare.
- Async actions always publish a visible status banner with success, loading, busy, or error tone.

## Component Rules

- Buttons have three levels only: primary, secondary, text/utility.
- Status color always comes from shared tones: `neutral`, `info`, `success`, `warning`, `danger`.
- Tables collapse to scan-friendly cards on mobile rather than forcing page-level horizontal scroll.
- Streaming must render as a timeline with chunk count and terminal state.
- Training logs are isolated in a dark terminal with pause, copy, download, and scroll-to-bottom controls.
- History rows must be useful before selection: status, mode, device, RTF, metric, and timestamp are required.

## Acceptance Checklist

- No horizontal page scroll at `390px`, `768px`, `1024px`, or `1440px`.
- Keyboard focus is visible on tabs, buttons, selects, file inputs, run rows, and console controls.
- Runtime/busy/loading states are visually distinct and not color-only.
- Compare remains symmetric on desktop and readable on mobile.
- Bench scenario rows show skipped/failed reasons without breaking layout.
- Long model names, long logs, and 100+ history rows remain usable.
