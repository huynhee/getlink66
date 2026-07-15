# TrollLLM-Inspired Design Reference

## Status

- Purpose: retained visual reference for the final UI unification phase.
- Current state: documented only; these rules are not yet applied across the application.
- Product identity remains 3DiPL. Do not copy the TrollLLM name, content, products, or page structure literally.
- Use the references to derive reusable design tokens and components, not page-specific CSS patches.

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
- Emerald green as the primary action and success color.
- Neon green for small highlights and intentional hover glows only.
- Purple for premium or advanced features.
- Monospace typography for technical labels, statuses, model metadata, IDs, badges, and compact navigation.
- Humanist sans-serif typography for descriptions, forms, body copy, and longer reading.
- Sharp controls, restrained 4px/8px rounding, thin borders, and little default shadow.
- A visible grid may be used on operational/catalog pages, but it must stay subtle and never reduce readability.

## Color Tokens

### Brand and interaction

| Token | Value | Use |
| --- | --- | --- |
| `--brand-primary` | `#059669` | Primary CTA, active navigation, success |
| `--brand-primary-hover` | `#047857` | Primary hover |
| `--brand-primary-active` | `#065F46` | Primary active |
| `--accent-neon` | `#00FF88` | Small highlights and hover glow |
| `--accent-purple` | `#A855F7` | Pro, premium, advanced features |
| `--accent-cyan` | `#06B6D4` | Informational emphasis |
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

## Implementation Order for the Final Design Phase

1. Audit current colors, fonts, spacing, radius, shadows, and component variants.
2. Introduce shared light/dark design tokens without changing behavior.
3. Normalize primitives: button, input, select, checkbox, badge, table, modal, pagination.
4. Normalize global shell: navbar, announcements, account menu, footer, mobile navigation.
5. Apply patterns to Marketplace Models and Scenes.
6. Apply patterns to Getlink, Top-up, Membership, History, Invite, and Account.
7. Apply patterns to every Admin module, including light mode.
8. Verify desktop/mobile, light/dark, Vietnamese/English, overflow, focus, and visual regression screenshots.

## Do Not

- Do not copy TrollLLM branding or content.
- Do not redesign pages before their product workflow is complete.
- Do not turn every section into a card.
- Do not use neon green as a large background color.
- Do not add arbitrary radii, spacing, or new accent colors.
- Do not sacrifice marketplace density or admin usability to mimic a marketing page.
- Do not treat this document as proof that the final design has already been implemented.
