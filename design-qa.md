# Design QA — hero and career directions

## Comparison target

- Source visual truth: user feedback from 2026-08-03 plus `output/qa-20260803-hero-directions/01-before-hero.png`, `02-before-directions.png`, and the v10 career photographs.
- Rendered implementation: `http://192.168.0.108:8105/` on Bravo.
- Desktop evidence: `03-after-hero-desktop.png`, `04-after-directions-top-desktop.png`, `05-after-directions-bottom-desktop.png`.
- Mobile evidence: `06-after-hero-mobile.png`, `07-after-directions-mobile.png`, `08-after-brand-placements-mobile.png`.
- Combined comparison evidence: `09-comparison-hero-before-after.png`, `10-comparison-directions-before-after.png`, `11-comparison-brand-placements-before-after.png`.

## Viewports and normalization

- Desktop CSS viewport: 1440 × 1000; source and implementation captures: 1425 × 990; device scale factor unchanged.
- Mobile CSS viewport: 390 × 844; implementation captures: 375 × 812; device scale factor unchanged.
- Comparison pairs use the same browser, viewport, page state and capture density.

## Required fidelity surfaces

- Fonts and typography: profession titles use normal word breaking, no forced `<br>`, no letter-by-letter wrapping, and non-breaking hyphens for compound roles. All six mobile titles report `scrollWidth <= clientWidth`.
- Spacing and layout rhythm: hero bottom radii are `0px`; computed hero bottom and the next section top are both `728px` on mobile, proving there is no inter-section gap.
- Colors and visual tokens: existing navy, ice-blue and documentary treatment are unchanged.
- Image quality and asset fidelity: four v11 photographs retain the established 4:5 documentary crop. The brand is now placed on a classroom poster, ship hull, electrical cabinet and laboratory plaque; only the engineer card retains a clothing patch and the doctor retains a folder mark.
- Copy and content: career names and CTA copy are unchanged semantically.

## Comparison history

### Iteration 1

- [P2] `Стажёр‑аналитик` overflowed the narrow desktop card after letter-level wrapping was disabled.
- Fix: added a card-specific optical size while preserving the full compound word and normal word-breaking rules.

### Iteration 2

- Post-fix evidence: `05-after-directions-bottom-desktop.png` and mobile computed title metrics.
- Result: all six profession titles fit their cards without character-level wrapping or clipping.

## Findings

- No remaining P0, P1 or P2 findings in the requested scope.
- Browser console: no errors or warnings.
- Responsive width: no horizontal document overflow at 390px viewport.
- Bravo runtime: container healthy; page and all four v11 WebP assets return HTTP 200.

## Focused region comparison

Focused comparisons were required because the requested changes concerned the hero seam, individual title wrapping and in-image brand placement. The three combined comparison files above were inspected after the final build.

## Follow-up polish

- No blocking follow-up. Any future adjustment to brand scale inside the generated photographs is a subjective P3 refinement.

final result: passed
