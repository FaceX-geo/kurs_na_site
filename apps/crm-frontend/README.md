# CRM frontend «Курс на Север»

Standalone React/Vite workspace for the internal CRM. The frontend is generated
against the versioned backend OpenAPI contract, owns its UI registry locally and
does not import runtime code from Landing or Tracker.

## Start locally

```bash
npm install
npm run dev -- --port 4173
```

Open `http://localhost:4173/cabinet/crm`. A development build starts in the
clearly labelled mock-auth mode so interface work is not blocked by external
factor delivery. Use `VITE_CRM_AUTH_MODE=live` to exercise backend
session/login/TOTP flows. Production builds fail closed if mock auth is
requested. TOTP is the temporary production-safe bridge and is not presented as
verification through MAX.

## Contract workflow

```bash
npm run api:generate
npm run registry:check
npm run verify
```

- Backend HTTP truth: `../crm-backend/openapi/openapi.json`.
- Generated API types: `src/shared/api/generated/openapi.ts`.
- UI registry: `registry/components.json`, `registry/screens.json`, contracts,
  snippets and recipes.
- Product boundaries: `AGENTS.md` and `docs/architecture.md`.
- Factor test/production boundary: `docs/auth-max-boundary.md`.
- One-time credential link contract: `docs/credential-links.md`.

## Public routes

- `/cabinet/login` — password/login test surface;
- `/cabinet/invite/accept#token=<opaque-token>` — create password from an invitation;
- `/cabinet/password/reset#token=<opaque-token>` — complete password reset;
- `/cabinet/mfa` — provider-aware TOTP or labelled MAX challenge;
- `/cabinet/recovery` — controlled recovery boundary;
- `/cabinet/mfa/enroll` — real temporary TOTP enrollment with one-time recovery codes;
- `/cabinet/crm` — role-aware authenticated CRM shell.

Feature routes remain under `/cabinet/crm/...` and are checked against
`registry/screens.json`.
