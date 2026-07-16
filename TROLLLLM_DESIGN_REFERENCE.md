# TrollLLM-Inspired Design Reference

## Status

- Purpose: retained visual reference for the final UI unification phase.
- Current state: implemented as the shared visual layer across the public site, marketplace, account flows, payments, and admin.
- Product identity remains 3DiPL. Do not copy the TrollLLM name, content, products, or page structure literally.
- The implementation source of truth is `frontend/src/design-system.css`, loaded after the legacy stylesheet.
- Use the references to evolve reusable design tokens and components, not page-specific CSS patches.

## Reference Inputs

- `trollllm.xyz_ (1).png`: dark landing page reference.
- `trollllm.xyz_.png`: light landing page reference.
- `trollllm.xyz_models.png`: light data/catalog page reference.
- Original user-provided design-system notes captured in Codex attachment `e9716731-4a1f-4069-9f5d-612d3c81147e`.

The source screenshots currently live outside the repository. Their important visual rules are preserved below so future work does not depend on those local files.

## Visual Direction

The target is a developer-oriented, high-contrast interface that feels technical but approachable:

- Minimal, mostly flat surfaces with generous whitespace.
- Warm off-white light mode and near-black dark mode.
- 3DiPL brand accents use neon green, magenta, and cyan.
- Dark mode may use the exact neon brand values; light mode uses darker accessible variants for readable controls and text.
- Magenta marks premium or advanced features.
- Monospace typography for technical labels, statuses, model metadata, IDs, badges, and compact navigation.
- Humanist sans-serif typography for descriptions, forms, body copy, and longer reading.
- Sharp controls, restrained 4px/8px rounding, thin borders, and little default shadow.
- A visible grid may be used on operational/catalog pages, but it must stay subtle and never reduce readability.

## Color Tokens

### Brand and interaction

| Token | Value | Use |
| --- | --- | --- |
| `--brand-primary` | Dark `#00FF88`, light `#008F58` | Primary CTA, active navigation, success |
| `--brand-primary-hover` | Dark `#28FFA0`, light `#007A4B` | Primary hover |
| `--brand-primary-active` | Dark `#00D975`, light `#006B42` | Primary active |
| `--accent-neon` | `#00FF88` | Small highlights and hover glow |
| `--accent-purple` | `#FF2BD6` | Pro, premium, advanced features |
| `--accent-cyan` | `#00E5FF` | Informational emphasis |
| `--warning` | `#FBBF24` | Warning and pending states |
| `--danger` | `#EF4444` | Destructive and error states |

### Light mode

| Token | Value |
| --- | --- |
| `--page-bg` | `#FAF8F5` |
| `--surface-1` | `#FFFFFF` |
| `--surface-2` | `#F3F3F2` |
| `--text-primary` | `#0A0A0A` |
| `--text-secondary` | `#292524` |
| `--text-muted` | `#78716C` |
| `--border` | `#E5E5E5` |
| `--border-soft` | `#E7E0D5` |

### Dark mode

Dark mode should preserve the same hierarchy instead of merely inverting colors:

- Page background: near black around `#0A0A0A`.
- Surfaces: stepped neutral-black layers with visible borders.
- Primary readable text: warm off-white, not pure white everywhere.
- Muted text must still pass WCAG AA when used for normal body text.
- Neon accents must remain accents; large areas should not glow.

## Typography

| Role | Family | Typical use |
| --- | --- | --- |
| Display | Inter | Page and major section headings |
| UI/body | DM Sans | Body copy, forms, navigation, descriptions |
| Technical | JetBrains Mono | IDs, model names, statuses, badges, metadata, admin data |

Preferred stacks:

```css
--font-display: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-body: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-mono: "JetBrains Mono", "Courier New", monospace;
```

Rules:

- Letter spacing is `0`; do not use negative tracking.
- Large hero type is reserved for real landing-page heroes.
- Dense catalog, admin, and operational screens use compact headings.
- Do not scale font size directly with viewport width.
- Body copy defaults to 16px with at least 1.5 line height.
- Technical labels typically use 12px-14px monospace.

## Spacing and Layout

- Base spacing unit: 8px.
- Allowed scale: 4, 8, 12, 16, 24, 32, 48, 64, 80, 96px.
- Main container max width: 1440px centered.
- Desktop side padding: 64px-80px.
- Tablet side padding: 24px-32px.
- Mobile side padding: 16px.
- Cards normally use 16px-24px internal padding.
- Major landing sections use 48px-80px vertical separation.
- Operational/catalog pages may be denser than marketing sections.

## Shape and Elevation

- Buttons and navigation: 0px radius.
- Inputs: 4px radius.
- Cards, modals, framed tools: up to 8px radius.
- Default surfaces are flat with no shadow.
- Modals may use a dark soft shadow.
- Interactive featured cards may use a subtle neon-green glow on hover.
- Avoid nested cards and decorative floating page-section cards.

## Component Rules

### Buttons

- Primary: filled `#059669`, warm-white text, 42px desktop height, monospace label.
- Secondary: transparent with a 2px green border.
- Ghost: neutral 1px border and no decorative fill.
- Disabled: desaturated, about 0.6 opacity, no pointer affordance.
- Every button needs a visible keyboard focus state.

### Inputs

- 40px desktop height and 44px minimum on mobile.
- White/light surface, 1px soft border, 4px radius.
- Focus: green border plus a restrained green focus ring.
- Error: 2px red border and red focus ring.
- Form labels use compact bold monospace.

### Cards

- Use cards for repeated items, modals, and genuinely framed tools.
- Prefer a thin neutral border over a shadow.
- Interactive hover may brighten the surface and add a subtle green glow.
- Marketplace asset cards should keep stable square media dimensions.

### Navigation

- Sticky, flat, single bottom border.
- Active items use green text/border instead of a large filled pill.
- Mobile navigation becomes a drawer or accordion below 768px.
- All touch targets are at least 40x40px; primary mobile actions target 48px.

## Page Pattern References

### Landing page

- Large direct statement with green/purple emphasis.
- Supporting technical terminal/window visual.
- Full-width feature bands separated by whitespace rather than floating section cards.
- Compact feature cards arranged in a clear grid.
- Pricing, FAQ, community CTA, and final CTA maintain the same token system.
- Dark and light themes must have equivalent contrast and hierarchy.

### Catalog/data page

The `trollllm.xyz_models.png` reference adds these patterns:

- A centered, literal page title with one short supporting sentence.
- A compact metric band above catalog controls.
- Filter tabs on the left and search on the right.
- Dense two-column desktop card grid for textual/operational data.
- Cards use one outer frame and internal dividers instead of nested cards.
- Provider/type/status badges remain compact and monospace.
- Status is communicated through both text and color.
- Repeated metrics align to a stable internal grid.

For 3DiPL, preserve the existing domain-specific catalog behavior:

- Model and Scene media cards remain square and image-led.
- Admin tables remain scan-friendly and denser than landing pages.
- Getlink, payment, history, and account flows prioritize clarity over marketing composition.

## Responsive Rules

| Range | Behavior |
| --- | --- |
| 320-767px | Single column, 16px margins, collapsible filters/navigation |
| 768-1023px | Two-column where useful, 24px-32px margins |
| 1024-1439px | Full desktop navigation and multi-column layouts |
| 1440px+ | Center at 1440px; do not keep expanding content width |

- No horizontal page overflow.
- Tables require deliberate mobile treatment: stacked rows, priority columns, or horizontal table scroll only.
- Catalog filters collapse on mobile without losing selected-state visibility.
- Fixed-format controls use stable dimensions so dynamic content does not shift layout.

## Accessibility and Interaction

- WCAG AA contrast for all readable text.
- Visible `:focus-visible` treatment on every interactive control.
- Do not rely on color alone for status.
- Form errors must be connected to their inputs.
- Respect reduced-motion preferences.
- Icon-only controls require tooltips or accessible labels.
- Hover-only information must have an accessible mobile/focus equivalent when important.

## Implementation Record

Implemented on 2026-07-16:

- `frontend/src/design-system.css` owns shared color, typography, spacing, border, elevation, focus, responsive, and light/dark tokens.
- `frontend/index.html` loads DM Sans, Inter, and JetBrains Mono with system fallbacks.
- `frontend/src/App.jsx` adds page and shell namespaces so public, marketplace, account, payment, and admin views can share primitives without losing domain-specific density.
- Header, announcement bar, navigation, account menu, language/theme controls, footer, buttons, fields, badges, tables, modals, pagination, and cards now follow one visual system.
- Models and Scenes retain square image-led cards, compact metadata, dense filters, aligned detail views, and responsive recommendations.
- Getlink, Top-up, Membership, History, Invite, Guide, Privacy, and Terms use the same surface, type, control, and spacing hierarchy.
- Admin modules use the same light/dark tokens, five-column desktop package layout, responsive tables, and two-column mobile KPI layout.
- Membership feature labels now pass through one presentation helper so database keys can remain English while Vietnamese and English UI labels stay consistent.
- The header switches to its compact menu at 1100px to prevent navigation/account overlap. Content layout breakpoints remain independent.
- Visual checks cover desktop and mobile, light and dark themes, public routes, marketplace detail/list views, account/payment views, and admin modules.
- Automated checks confirm no horizontal page overflow at the tested 390px and 1440px viewports.

## Maintenance Order

1. Change shared tokens and primitives in `frontend/src/design-system.css` first.
2. Preserve page behavior and domain-specific density when updating shared components.
3. Verify public and admin light/dark themes after every visual change.
4. Verify 390px, 768px, 1100px, and 1440px widths without horizontal overflow.
5. Verify Vietnamese and English labels, especially data-backed package and taxonomy text.
6. Keep visual regression screenshots for changes that affect the global shell, marketplace cards, payment cards, or admin layout.

## Do Not

- Do not copy TrollLLM branding or content.
- Do not redesign pages before their product workflow is complete.
- Do not turn every section into a card.
- Do not use neon green as a large background color.
- Do not add arbitrary radii, spacing, or new accent colors.
- Do not sacrifice marketplace density or admin usability to mimic a marketing page.
- Do not bypass the shared design layer with isolated page-specific colors, shadows, radii, or typography.
