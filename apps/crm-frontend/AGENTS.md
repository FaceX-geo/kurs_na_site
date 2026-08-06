# AGENTS.md — Kurs na Sever CRM Frontend

## Business purpose

The CRM frontend turns backend records and guarded operations into a dense,
predictable workspace for specialists and managers. It reduces repeated search,
status reconciliation and hand-written follow-up while keeping identity,
permissions, conflict resolution, critical changes and final confirmation under
human control.

## Application boundary

- This directory is the standalone CRM frontend.
- Landing remains a separate static application.
- The project Tracker is not a runtime, domain, data, navigation or import
  source. Its registry workflow may be adapted only as local CRM-owned files
  with provenance and without filesystem imports.
- Graph, project-tracker, ERP and private portals are outside this application.
  Landing runtime remains separate, while its versioned vacancy/story admin
  seam belongs to the `SUPER_ADMIN` scope of this frontend.
- Runtime data enters only through the generated backend contract and adapters
  under `src/shared/api/`. UI components never call `fetch` directly.

## Sources of truth

Use this order when sources conflict:

1. product-owner decisions and signed requirements;
2. `../crm-backend/openapi/openapi.json` for HTTP operations and schemas;
3. local `registry/` contracts, screen inventory and recipes;
4. local frontend architecture and auth-boundary documents;
5. the 51-screen CRM PDF pack as visual and workflow baseline.

The PDF is not a security or backend truth. Missing backend operations remain a
visible contract gap; never invent an endpoint to make a screen look complete.

## Registry-first UI workflow

Before adding or changing reusable UI:

1. find or add the stable record in `registry/components.json`;
2. update the matching JSON contract in `registry/contracts/`;
3. update the executable TSX example in `registry/snippets/`;
4. connect the component to a screen and recipe only when required;
5. run `npm run registry:check`, typecheck and relevant tests.

Every reusable component has an owner, implementation path, variants, states,
inputs, events, accessibility rules, motion rules, contract and snippet.
Unregistered reusable UI is not part of the CRM design system.

## Visual contract

- Desktop reference: `1536 × 1024`, sidebar `260px`.
- Canvas `#F6F9FD`; ink `#071942`; sidebar `#061A3D`; work blue
  `#2764D8`; reference coral `#EC194C`.
- Use the accessible action coral token for normal-size button text; reference
  coral may be used for larger UI and decoration.
- Onest is the shipped font. Do not add another font without an explicit asset
  and license decision.
- Minimum target is `44 × 44px`; focus-visible state and 200% zoom are required.
- Status never relies on colour alone.
- Kanban always has a list alternative and a keyboard move request that enters
  preview; drag/drop cannot be the only interaction.
- Do not add inline SVG, emoji or CSS image art. Use the approved icon package or
  supplied raster assets.

## Interaction and write safety

All reads represent `loading / ready / empty / error / validation / stale /
denied / conflict / archived`. Critical writes follow:

`draft → preview → explicit confirmation → receipt`

- A UI click is a request, not proof that a mutation succeeded.
- Confirmation sends the backend operation with CSRF, idempotency/version data
  supplied by the API layer.
- Receipts contain backend evidence and never fabricate delivery/read status.
- Batch retry starts a new preview and targets only explicitly retryable items.

## Authentication and temporary factor boundary

Screens 45–48 are isolated from the authenticated shell and CRM data.
Development bypass is allowed only as an explicit local test stub controlled by
configuration. It must be visibly labelled and unavailable in production
builds. Production uses the versioned TOTP `EnrollMfa`/`VerifyMfa` operations as
a temporary safe bridge; it must never be described as verification through
MAX. MAX remains a labelled UI/provider placeholder until its own versioned
contract exists. Production fails closed when session, explicit business role,
permissions or the required factor are unavailable.

Do not introduce email/SMS fallback, persist OTP values, log credentials, or
show CRM data before the server confirms the authenticated session.

## Accessibility and motion

- Follow WCAG 2.2 AA, semantic landmarks, labelled controls and deterministic
  focus order.
- Modal surfaces trap focus while open and restore the exact invoker on close.
- Table selection, sorting and row opening are keyboard-operable.
- Live regions announce async, validation, conflict and receipt outcomes.
- `prefers-reduced-motion` removes spatial movement without removing state or
  focus feedback.

## Repository safety

- Search and edit only this frontend unless an exact versioned backend contract
  path is required for read-only validation.
- Never use cross-repository imports or copy private/source data into fixtures,
  snippets or screenshots.
- Preserve unrelated dirty and untracked files; stage only exact task paths.
- `git add -A`, destructive reset/checkout and broad searches across `/Volumes`
  are prohibited.

## Required checks

For registry/foundation changes run:

```sh
npm run registry:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Visual feature delivery additionally requires desktop/mobile screenshots,
keyboard-only checks, reduced-motion checks and no open P0/P1/P2 findings.
