# CRM frontend design QA

## Findings

No actionable P0, P1 or P2 visual differences remain in the verified login and
specialist shell states. The development-only test badge and extra test-login
panel are intentional product constraints rather than accidental reference
drift. They are absent from production builds.

Authenticated production screens remain an operational acceptance gate until
two real super-administrator identities complete invite and MFA enrollment. A
local mock session is visual evidence only and is not presented as proof of
production RBAC or migrated data visibility.

Residual P3 polish: the generated Murmansk and aurora photography is not the
same raster as the reference pack, but the subject, crop, contrast and placement
match its art direction and preserve text legibility.

## Evidence contract

- Source visual truth:
  `/Volumes/KINGSTON/Coding/kurs_na_sever/output/pdf/kurs-na-sever-crm-complete-interfaces-v5.pdf`
- Normalized source screens:
  - `/Volumes/KINGSTON/Coding/kurs_na_sever/docs/design/crm-complete-interface-pack-v5/images/01-manager-dashboard.png`
  - `/Volumes/KINGSTON/Coding/kurs_na_sever/docs/design/crm-complete-interface-pack-v5/images/45-login.png`
- Rendered implementation:
  - `/Volumes/KINGSTON/Coding/kurs_na_sever/apps/crm-frontend/qa-evidence/implementation-dashboard-final.png`
  - `/Volumes/KINGSTON/Coding/kurs_na_sever/apps/crm-frontend/qa-evidence/implementation-login-final.png`
  - `/Volumes/KINGSTON/Coding/kurs_na_sever/apps/crm-frontend/qa-evidence/implementation-login-roles-final.png`
  - `/Volumes/KINGSTON/Coding/kurs_na_sever/apps/crm-frontend/qa-evidence/implementation-dashboard-mobile-final.png`
- Desktop viewport and CSS size: `1536 × 1024`.
- Source pixels: `1536 × 1024`; implementation pixels: `1536 × 1024`.
- Desktop density: `devicePixelRatio=1`; no density resampling was required.
- Responsive check: `390 × 844` CSS pixels at DPR 1.
- State: development mock-auth login and authenticated specialist shell. The
  shell intentionally shows a backend error when no local API is running;
  domain data is not replaced with fixtures. MAX is explicitly marked as not
  called.

## Comparison evidence

Full-view comparisons place source on the left and implementation on the right:

- `/Volumes/KINGSTON/Coding/kurs_na_sever/apps/crm-frontend/qa-evidence/comparison-dashboard-final.png`
- `/Volumes/KINGSTON/Coding/kurs_na_sever/apps/crm-frontend/qa-evidence/comparison-login-final.png`
- `/Volumes/KINGSTON/Coding/kurs_na_sever/apps/crm-frontend/qa-evidence/comparison-login-roles-final.png`

Focused comparisons were required because dense card labels and form controls
are too small to judge reliably in the full-view pair:

- `/Volumes/KINGSTON/Coding/kurs_na_sever/apps/crm-frontend/qa-evidence/comparison-dashboard-priority-final.png`
- `/Volumes/KINGSTON/Coding/kurs_na_sever/apps/crm-frontend/qa-evidence/comparison-login-form-final.png`

## Required fidelity surfaces

- Fonts and typography: Onest Variable is bundled locally. Dashboard heading,
  navigation, metrics, fact labels and queue text were tuned against the source;
  wrapping remains stable at the mobile breakpoint.
- Spacing and layout rhythm: the 260px visual sidebar, 110px topbar, dashboard
  section positions, card heights, gaps and radii now follow screen 01. The
  `390 × 844` capture has no horizontal overflow or overlapping candidate facts.
- Colors and tokens: canvas, ink, sidebar, work blue, coral, success, attention
  and danger states map to the versioned CRM tokens. The action button uses the
  accessible solid coral token.
- Image quality and asset fidelity: both generated PNGs are high-resolution
  raster assets with the required Murmansk/aurora subjects and crop. No inline
  SVG art, emoji, CSS drawing or gradient substitute is used; interface icons
  come from the approved Tabler package.
- Copy and content: reference task language is preserved. Synthetic counts,
  unavailable provider outcomes and contract gaps are explicitly labelled and
  are never presented as live backend proof.

## Interaction and accessibility evidence

- The local test-login control completes without a provider call and opens the
  specialist shell; the shell exposes only specialist navigation.
- Domain screens use live API adapters and preserve explicit loading, empty,
  error, denied, conflict and stale states instead of demo success data.
- `TransitionCase` is contract-tested as
  `draft → preview → confirm → authoritative receipt` with stable
  idempotency, CSRF and `If-Match` metadata.
- The UI registry verifies 51 screens, 13 reusable components, seven recipes
  and all 120 OpenAPI operation IDs.
- Keyboard, focus restoration, reduced-motion and route access are covered by
  the executable accessibility and policy tests. The responsive shell evidence
  remains the `390 × 844` capture listed above.

## Comparison history

1. Pass 1 — blocked by P1 shell collision: the shared registry `.crm-topbar`
   selector overrode the runtime shell and placed the heading under a fixed
   topbar; focused main content also showed a browser outline.
   - Fix: runtime classes were namespaced as `.crm-shell-topbar` and
     `.crm-shell-sidebar`; route focus now prevents scrolling and removes the
     non-design outline.
   - Post-fix evidence:
     `qa-evidence/implementation-dashboard-pass3.png`.
2. Pass 2 — blocked by P2 vertical rhythm and missing fact icons.
   - Fix: dashboard header, metric, priority, queue and status spacing were
     aligned to the source; semantic Tabler fact icons and optical type sizes
     were restored.
   - Post-fix evidence:
     `qa-evidence/comparison-dashboard-final.png` and
     `qa-evidence/comparison-dashboard-priority-final.png`.
3. Pass 3 — blocked by P2 mobile candidate-fact crowding and oversized heading.
   - Fix: mobile facts use full-width labelled rows, the heading scales at the
     breakpoint and metric text is compacted without removing status labels.
   - Post-fix evidence:
     `qa-evidence/implementation-dashboard-mobile-final.png`.
4. Pass 4 — blocked by P2 login visual scale drift.
   - Fix: the visual pane ratio, imagery crop, title scale and card width were
     tuned while retaining the required development-only MAX explanation.
   - Post-fix evidence:
     `qa-evidence/comparison-login-final.png` and
     `qa-evidence/comparison-login-form-final.png`.
5. Pass 5 — the role/auth integration widened the login visual pane and form
   relative to screen 45.
   - Fix: restored the source `29.3%` image pane, compact form width, field
     height and typography while retaining the development-only auth notice.
   - Post-fix evidence:
     `qa-evidence/comparison-login-roles-final.png`.

final result: visual contract passed; authenticated production role walkthrough pending real identities
