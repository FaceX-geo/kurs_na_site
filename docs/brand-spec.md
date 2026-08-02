# Brand Spec — Kurs na Sever (Single Source of Truth)

## 1. Purpose
Этот документ фиксирует визуальные, типографические, motion и UX-правила.
Все продуктовые страницы должны соответствовать этой спецификации.

## 2. Foundations
- Fonts (self-host): `Onest Local`, `Manrope Local` from `assets/fonts`.
- Visual tone: editorial / monochrome base / cold accent.
- UX principle: content clarity first, decorative minimalism.

## 3. Token contract
- Colors: `--color-ink-*`, `--color-surface-*`, `--color-line`, `--color-accent-*`, `--color-success-*`, `--color-danger-*`.
- Spacing: `--space-1..--space-7`.
- Radius: `--radius-1..--radius-4`.
- Elevation: `--elevation-1`, `--elevation-2`.
- Motion: `--motion-fast/base/slow/linger`, `--ease-standard`, `--ease-soft-out`.

## 4. Typography
- Display: `--font-display` (headlines, hero, large section titles).
- Body: `--font-body` (content, controls, form labels).
- Mandatory readable line-height for long text: `>= 1.5`.

## 5. Motion policy
- Allowed: opacity/transform transitions.
- Allowed: one low-frequency atmospheric loop per viewport when it carries a real regional motif, has a visible pause/resume control, stops outside the viewport and respects `prefers-reduced-motion`.
- Disallowed: generic decorative infinite loops, rapid flashing and aggressive rotations/scales.
- Critical content must stay visible when JS fails.
- Reveal policy: `.reveal` is visible by default, animation state only via `.js .reveal.is-pending`.
- Mandatory `prefers-reduced-motion: reduce` support.

## 6. Component rules
- Buttons: primary/secondary/soft/disabled states.
- Forms: field-level errors + global feedback line.
- Cards: clear summary + progressive disclosure to modal/details.
- Modal: focus trap, ESC close, overlay close, focus return.

## 7. Content pattern rules
- Hero: value proposition + primary action.
- Section lead: fact + benefit + next step.
- Detail modal: grouped bullet points + reference links.
- Copy style: concise, factual, action-oriented.

## 8. Main page conformity checklist
Use this checklist before release:

1. Local fonts loaded from `assets/fonts` only (no required CDN).
2. Main tokens in `styles/main.css` equal token names in `styles/brand.css`.
3. `.reveal` content visible without JS and without `main.js` runtime.
4. Motion uses defined durations/easings only.
5. `prefers-reduced-motion` fully disables non-essential transitions.
6. Header, hero, support cards, timeline, contacts, form follow tokenized spacing.
7. Form returns field-level messages for `422` and global message with `requestId` for server errors.
8. Mobile menu and modals pass keyboard navigation flow.
9. Visual hierarchy matches brand spec (headline contrast, white space, clean card rhythm).
10. Partner and support content preserved in meaning from legacy source.
