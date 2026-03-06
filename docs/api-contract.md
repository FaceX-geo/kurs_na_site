# API Contract — Kurs na Sever (REST JSON v1)

## Base
- Base URL: `/api/v1`
- Auth: `Authorization: Bearer <token>` (or session/cookie in backend perimeter)
- Content-Type: `application/json` (except multipart upload)
- Error envelope (common):

```json
{
  "message": "Validation failed",
  "requestId": "req_01J...",
  "errors": [
    { "field": "personal.email", "code": "invalid", "message": "Некорректный email" }
  ]
}
```

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
    "referralCode": "ABC1234567",
    "region": "Санкт-Петербург",
    "sphere": "medicine",
    "wishPost": "Врач-терапевт",
    "wishSalary": "150000",
    "comment": "Готов к переезду в течение 2 месяцев"
  },
  "consents": {
    "privacyAccepted": true
  },
  "attachments": {
    "resumeFileId": "file_8f8f1d"
  },
  "meta": {
    "source": "web",
    "utm": {
      "utm_source": "vk",
      "utm_campaign": "kns-2026"
    },
    "timestamp": "2026-02-28T10:25:00.000Z",
    "clientFingerprint": "fp_182739812"
  }
}
```

### Success `201`
```json
{
  "applicationId": "app_24132",
  "status": "received",
  "createdAt": "2026-02-28T10:25:01.001Z"
}
```

### Errors
- `422` — validation error with `errors[]`
- `429` — rate limit
- `500`/`502`/`503`/`504` — server side errors

## 2) Upload file
### `POST /files`
Upload resume file.

### Request
- `multipart/form-data`
- field: `file`

### Success `201`
```json
{
  "fileId": "file_8f8f1d",
  "name": "resume.pdf",
  "size": 240182
}
```

### Errors
- `413` — payload too large
- `415` — unsupported file type
- `422` — invalid upload payload

## 3) Fetch sphere dictionary
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

## Frontend mapping rules
- `422` with `errors[].field` => field-level message under form control.
- Field alias mapping in UI:
  - `consents.privacyAccepted` -> `agreeTerms`
  - `application.referralCode` -> `referral`
  - `attachments.resumeFileId` -> `resume`
- `requestId` from any error => show in global feedback for support diagnostics.
- Submit button lock during `loading`.
- Safe retry policy for transient statuses: `429, 500, 502, 503, 504`.
