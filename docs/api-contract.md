# API Contract — Kurs na Sever (REST JSON v1)

## Base
- Canonical Base URL: `/public/v1`
- Compatibility alias: `/api/v1` (deprecated; retained for existing landing integrations)
- Auth: public intake is cookie-free and does not require a bearer token or CRM session
- Content-Type: `application/json` (except multipart upload)
- Browser credentials mode: `omit`
- Error envelope (common):

```json
{
  "code": "validation_error",
  "message": "Validation failed",
  "requestId": "req_01J...",
  "errors": [
    { "field": "personal.email", "code": "invalid", "message": "Некорректный email" }
  ]
}
```

`code`, `message`, `requestId` and `errors[]` are present in every public API error. The client may
map `errors[].field` to a form control, but must use `code` for programmatic branching and retain
`requestId` for support diagnostics.

## Idempotent writes

Every public `POST` requires an `Idempotency-Key` header. The key is an opaque value of 8–128
characters matching `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`.

- One form submit attempt creates two different keys: one for upload and one for application.
- Automatic network/transient retries reuse the original key until a receipt is returned.
- A new logical write uses a new key; upload and application keys must never be interchanged.
- First creation returns `201`. A replay of the same request may return `200` with
  `Idempotency-Replayed: true` and the original receipt.
- Reusing a key with different content returns `409 idempotency_conflict`.
- POST retries are allowed only when the request carries its stable idempotency key.

## 1) Create application
### `POST /applications`
Creates candidate application.

### Request body
```json
{
  "personal": {
    "surname": "Иванов",
    "name": "Иван",
    "middlename": "Иванович",
    "birthdate": "1998-06-12",
    "email": "ivanov@example.com",
    "phone": "+7 (911) 111-22-33"
  },
  "application": {
    "applicantType": "relocation",
    "vacancyId": "vac_medicine_therapist_01",
    "vacancySector": "medicine",
    "referralCode": "ABC1234567",
    "region": "Санкт-Петербург",
    "sphere": "medicine",
    "wishPost": "Врач-терапевт",
    "wishSalary": "150000",
    "comment": "Готов к переезду в течение 2 месяцев"
  },
  "consents": {
    "privacyAccepted": true,
    "privacyPolicyVersion": "landing-inline-2026-08-06",
    "acceptedAt": "2026-08-06T09:00:00.000Z"
  },
  "attachments": {
    "resumeFileId": "file_8f8f1d",
    "resumeFileBindingToken": "ub1.example-opaque-binding-token-at-least-32-chars"
  },
  "meta": {
    "source": "web",
    "entryPoint": {
      "source": "vacancy-card",
      "vacancyId": "vac_medicine_therapist_01",
      "vacancySector": "medicine"
    },
    "utm": {
      "utm_source": "vk",
      "utm_campaign": "kns-2026"
    },
    "timestamp": "2026-08-06T09:00:00.000Z",
    "consentState": "necessary",
    "landing": {
      "host": "cursnasever.facex.pro",
      "path": "/",
      "url": "https://cursnasever.facex.pro/"
    }
  }
}
```

`application.applicantType` is required and accepts:

- `relocation` — work and relocation route, minimum age 18. `sphere` and `wishPost` are required; `wishSalary` is optional and, when present, must match `^[0-9]+$`.
- `student` — student, graduate, internship or first-job route, minimum age 16. Relocation-only fields are omitted and `studentProfile` is required.

`application.vacancyId` and `application.vacancySector` are optional for a general application and required together when the user applies to a published vacancy. Supported sectors: `industry`, `medicine`, `education`, `port`, `safety`, `students`. If the user changes between the relocation and student routes, an incompatible vacancy binding is cleared before submission.

Student request variant:

```json
{
  "personal": {
    "surname": "Петрова",
    "name": "Анна",
    "middlename": "Сергеевна",
    "birthdate": "2004-09-18",
    "email": "anna@example.com",
    "phone": "+7 (921) 111-22-33"
  },
  "application": {
    "applicantType": "student",
    "referralCode": "",
    "region": "Республика Карелия",
    "studentProfile": {
      "institution": "Петрозаводский государственный университет",
      "specialty": "Промышленная теплоэнергетика",
      "graduationYear": 2027,
      "status": "3",
      "practicePeriod": {
        "start": "2027-06",
        "end": "2027-08"
      }
    },
    "comment": "Ищу производственную практику с возможностью дальнейшего трудоустройства"
  },
  "consents": {
    "privacyAccepted": true,
    "privacyPolicyVersion": "landing-inline-2026-08-06",
    "acceptedAt": "2026-08-06T10:25:00.000Z"
  },
  "attachments": {
    "resumeFileId": "file_student_12a8",
    "resumeFileBindingToken": "ub1.example-student-binding-token-at-least-32-chars"
  },
  "meta": {
    "source": "web",
    "entryPoint": {
      "source": "students-section",
      "applicantType": "student"
    },
    "utm": {},
    "timestamp": "2026-08-06T10:25:00.000Z"
  }
}
```

Backend validation must reject mixed payloads: `studentProfile` must not be accepted for `relocation`, and `sphere`, `wishPost`, `wishSalary` must not be accepted for `student`.

Canonical `/public/v1/applications` requires `privacyPolicyVersion` and `acceptedAt` together with
`privacyAccepted: true`. Only deprecated `/api/v1/applications` may temporarily omit the evidence
pair for the compatibility window; the backend does not invent a policy version or client timestamp.
`landing-inline-2026-08-06` identifies the currently deployed inline privacy text and must be
changed whenever that text or its processing purpose changes.

The legacy alias still accepts `meta.clientFingerprint` for payload compatibility, but the current
landing does not collect or generate it without an approved privacy basis. Clients may send
`meta.source`, `meta.utm`, `meta.timestamp`, `sessionId`, `consentState`, `landing` and
`attribution.firstTouch`/`attribution.lastTouch` with `capturedAt`, `landingUrl`, `referrer`, `utm`
and `clickIds` (`yclid`, `gclid`, `vkClickId`). These extensions are additive and do not change the
legacy payload shape.

Both `attachments.resumeFileId` and the opaque `resumeFileBindingToken` returned by the exact upload
attempt are required for canonical applications. The backend stores only a keyed token hash,
consumes the binding atomically with submission creation and rejects reuse or a mismatched file/token
pair. The deprecated alias may omit the token only during the explicit compatibility window.

For `studentProfile.status = "graduated"`, `practicePeriod` is omitted and must not be required. For course values `"1"` through `"6"`, both `practicePeriod.start` and `practicePeriod.end` are required in `YYYY-MM` format.

### Success `201`
```json
{
  "applicationId": "app_24132",
  "status": "received",
  "createdAt": "2026-08-06T09:00:01.001Z"
}
```

An idempotent replay returns the same receipt with `200` and `Idempotency-Replayed: true`.

### Errors
- `409` — idempotency key conflict
- `422` — validation error with `errors[]`
- `429` — rate limit
- `500`/`502`/`503`/`504` — server side errors

## 2) Fetch published vacancies
### `GET /vacancies?sector={sector}&cursor={cursor}&limit={limit}`
Returns published vacancies for one of the supported sectors. An omitted `sector` may return all
published vacancies. `limit` defaults to `20` and is capped at `100`; `cursor` is opaque and must be
returned unchanged by the client.

### Success `200`
```json
{
  "items": [
    {
      "id": "vac_industry_engineer_01",
      "sector": "industry",
      "title": "Инженер-механик",
      "city": "Мурманск",
      "employer": "Работодатель проекта",
      "salaryText": "от 150 000 ₽",
      "summary": "Работа с промышленным оборудованием",
      "responsibilities": ["Диагностика и обслуживание оборудования"],
      "requirements": ["Профильное образование или релевантный опыт"],
      "conditions": ["Точные условия подтвердит куратор"],
      "applicantType": "relocation",
      "sphere": "engineering",
      "published": true
    }
  ],
  "page": {
    "limit": 20,
    "nextCursor": "eyJpZCI6InZhY19pbmR1c3RyeV9lbmdpbmVlcl8wMSJ9",
    "hasMore": true
  }
}
```

The backend remains the source of truth for publication status, employer, salary and conditions. The bundled static catalog is only a safe frontend fallback and must not be treated as proof that a position is currently open.

## 3) Upload file
### `POST /uploads`
Upload resume file.

Compatibility routes `/public/v1/files`, `/api/v1/uploads` and `/api/v1/files` accept the same
contract. `/api/v1/files` is retained for the previous landing client; new clients use
`/public/v1/uploads`.

### Request
- `multipart/form-data`
- field: `file`
- formats: PDF, DOC, DOCX or RTF, up to 10 MiB; the backend checks extension, MIME and file signature

### Success `201`
```json
{
  "fileId": "file_8f8f1d",
  "name": "resume.pdf",
  "size": 240182,
  "status": "quarantined",
  "bindingToken": "ub1.example-opaque-binding-token-at-least-32-chars"
}
```

The receipt means that the file entered quarantine, not that it is already safe for distribution.
Upload uses a durable reservation, a stable quarantine object key and an atomic DB finalize. Exact
idempotency replay reconstructs the same binding token; a bounded reconciler removes only stale,
uncommitted objects. The application repository verifies and consumes the file binding.

### Errors
- `409` — idempotency key conflict
- `413` — payload too large
- `415` — unsupported file type
- `422` — invalid upload payload

## 4) Fetch sphere dictionary
### `GET /dictionaries/spheres`
Returns sphere options for application form.

### Success `200`
```json
{
  "items": [
    { "value": "education", "label": "Образование" },
    { "value": "medicine", "label": "Медицина" },
    { "value": "engineering", "label": "Техническая специальность" }
  ]
}
```

Also supported response shape:
```json
[
  { "value": "education", "label": "Образование" },
  { "value": "medicine", "label": "Медицина" }
]
```

The raw array response is a legacy compatibility shape. Canonical `/public/v1` responses use
`{ "items": [...] }`.

## 5) Fetch map points

### `GET /map-points`

Returns only published landing map points:

```json
{
  "items": [
    {
      "id": "murmansk",
      "name": "Мурманск",
      "longitude": 33.075,
      "latitude": 68.97,
      "sectors": ["medicine", "port"],
      "status": "published"
    }
  ]
}
```

## 6) Fetch published relocation stories

### `GET /stories?cursor={cursor}&limit={limit}`

Returns only stories explicitly published by a CRM super admin. `limit` defaults to `50` and is
capped at `100`; `cursor` is opaque. The landing merges these records into its bundled editorial
fallback by `id`, so an unpublished or archived managed record is never returned by this endpoint.

```json
{
  "items": [
    {
      "id": "story_engineer_murmansk",
      "tone": "berry",
      "filters": ["children", "couple"],
      "cardTags": ["Семья", "Инженерная карьера"],
      "ariaLabel": "Открыть историю инженера о переезде",
      "eyebrow": "История переезда",
      "title": "Один оффер — маршрут для всей семьи",
      "person": "Андрей, 38",
      "route": "Екатеринбург → Мончегорск",
      "avatar": "assets/images/story-avatar-engineer-v9.webp",
      "avatarAlt": "Портрет инженера Андрея",
      "cardQuote": "Когда сложили две карьеры, школу и жильё — риск исчез.",
      "quote": "Полный текст истории.",
      "tags": ["С детьми", "Промышленность"],
      "lead": "Вводный абзац истории.",
      "gallery": [{ "src": "assets/images/relocation-story-summer.jpg", "alt": "Мурманск летом" }],
      "steps": ["Проверили оффер", "Согласовали дату переезда"]
    }
  ],
  "suppressedIds": ["family"],
  "page": { "limit": 50, "nextCursor": null, "hasMore": false }
}
```

Pagination проходит по всем управляемым story records. `items` содержит опубликованные записи
текущей страницы, а `suppressedIds` — `publicId` черновиков и архивных записей той же страницы.
Клиент обязан пройти все курсоры, удалить эти идентификаторы из встроенного fallback и только
после этого наложить опубликованные записи. Поэтому архивирование в CRM не возвращает старую
историю из статического bundle.

## CRM cabinet seam

- Cabinet SPA: `/cabinet/`; browser routes under `/cabinet/crm/*` use the same-origin API.
- Authentication, sessions, permissions and business roles are served only by `/internal/v1/*`.
- Product roles are `SUPER_ADMIN` and `SPECIALIST`; technical RBAC roles remain internal backend
  implementation details.
- The generated backend OpenAPI document is the source of truth for all cabinet operations. The
  frontend must not invent routes or infer access from hidden navigation.
- Every cabinet mutation uses the session cookie, trusted-origin/CSRF validation, an
  `Idempotency-Key`, and optimistic concurrency headers where declared by OpenAPI.
- Public content writes are available only to `SUPER_ADMIN`; published vacancies flow through
  `/public/v1/vacancies`, and published stories through `/public/v1/stories`.

## Frontend mapping rules
- `422` with `errors[].field` => field-level message under form control.
- Field alias mapping in UI:
  - `consents.privacyAccepted` -> `agreeTerms`
  - `application.referralCode` -> `referral`
  - `application.studentProfile.institution` -> `studentInstitution`
  - `application.studentProfile.specialty` -> `studentSpecialty`
  - `application.studentProfile.graduationYear` -> `graduationYear`
  - `application.studentProfile.status` -> `studentStatus`
  - `application.studentProfile.practicePeriod.start` -> `practiceStart`
  - `application.studentProfile.practicePeriod.end` -> `practiceEnd`
  - `attachments.resumeFileId` -> `resume`
- `requestId` from any error => show in global feedback for support diagnostics.
- `code` drives programmatic error handling; do not parse localized `message` text.
- Submit button lock during `loading`.
- Safe retry policy for transient statuses: `429, 500, 502, 503, 504`. GET/HEAD/OPTIONS may retry
  directly; POST may retry only with the unchanged `Idempotency-Key` and unchanged body.
