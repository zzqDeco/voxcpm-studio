# Design System Master File

> Global source of truth for `apps/demo-web`.
> When building a specific workspace, check `design-system/pages/[page-name].md` first.
> Page files override this master only where they explicitly differ.

---

**Project:** VoxCPM Studio  
**Generated With:** UI UX Pro Max + project-specific refinement  
**Product Type:** Local AI voice workbench  
**Primary Audience:** Operators testing local inference, training, bench, and history workflows

---

## Design Direction

- **Core Pattern:** `Data-Dense Dashboard` + `Comparative Analysis Dashboard`
- **Product Tone:** research lab + editorial control center
- **Language Priority:** zh-CN first
- **Device Strategy:** desktop-first, responsive down to tablet and mobile
- **Navigation Strategy:** top control hero + sticky task rail, no permanent sidebar

## Color System

| Role | Value | Notes |
|------|-------|-------|
| Primary action | `#1E40AF` | Cobalt control color |
| Primary hover | `#2957D0` | Brighter action emphasis |
| Secondary action | `#3B82F6` | Info / active state |
| Accent | `#F59E0B` | Amber highlight, warnings, focus moments |
| Background base | `#F7F3EB` | Warm stone surface |
| Raised surface | `rgba(255,255,255,0.84)` | Main cards |
| Strong text | `#18212F` | Default body contrast |
| Muted text | `#6E7B8F` | Labels / meta |
| Success | `#15935F` | Completed states |
| Danger | `#BE4B39` | Error / failed |

**Rules**
- Keep the workspace in light mode.
- Use cobalt for decisive actions and active navigation.
- Use amber for emphasis, not as a second primary brand color.
- Avoid purple accents and flat white backgrounds.

## Typography

- **Display / Section Titles:** `"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif`
- **Body / Dense UI:** `"IBM Plex Sans", "PingFang SC", "Noto Sans SC", sans-serif`
- **Metrics / Logs / Technical Labels:** `"Fira Code", "IBM Plex Mono", monospace`

**Rules**
- Large page titles use display serif to create editorial contrast.
- Operational labels, tabs, and metrics may use mono sparingly.
- Dense data zones should prefer compact sans text with strong hierarchy.

## Layout Rules

- Hero is a control header, not a marketing banner.
- Sticky task rail sits below the hero and contains tab navigation plus workspace status.
- Most workspaces use a two-zone layout:
  - Left: control, filter, or selection deck
  - Right: result, summary, or detail deck
- Compare uses a symmetric dual-view layout.
- Training uses light controls plus a dark terminal zone for logs.
- Mobile keeps the task rail as a horizontal scroll strip.

## Component Rules

- **Cards:** rounded, soft-elevated, with clear header and compact spacing
- **Buttons:** three levels only
  - Primary: cobalt gradient
  - Secondary: white glass surface with border
  - Small utility: compact secondary
- **Status pills:** use tokenized tones only (`neutral`, `info`, `success`, `warning`, `danger`)
- **Metrics:** always in repeatable tiles with uppercase micro-label + numeric emphasis
- **Lists / tables:** use strong row grouping and clear hover/selected state
- **Timeline:** streaming feedback must render as an event timeline, not raw text
- **Console:** dark terminal style reserved for training logs only

## Motion + UX

- Transitions stay in the `150ms–320ms` band.
- Allow subtle hover lift; do not use layout-shifting scale effects.
- Use visible focus rings on all interactive elements.
- Provide keyboard reachability for nav, forms, and lists.
- Respect `prefers-reduced-motion`.
- Never leave async actions without explicit state feedback.

## Anti-Patterns

- No emoji icons
- No purple-primary palette
- No flat, single-tone white page background
- No hidden focus states
- No tab content that causes horizontal overflow on mobile
- No generic settings-form look for Training
- No plain text dump for streaming events

## Delivery Checklist

- [ ] No horizontal scroll at `390px`, `768px`, `1024px`, `1440px`
- [ ] Sticky rail does not hide content
- [ ] Buttons, pills, and alerts share one visual language
- [ ] Runtime / busy / success / error states are visually distinct
- [ ] History rows are scan-friendly before selection
- [ ] Compare remains balanced and symmetric
- [ ] Training log area stays visually isolated as a terminal zone
