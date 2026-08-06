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
    "privacyAccepted": true
  },
  "attachments": {
    "resumeFileId": "file_student_12a8"
  },
  "meta": {
    "source": "web",
    "entryPoint": {
      "source": "students-section",
      "applicantType": "student"
    },
    "utm": {},
    "timestamp": "2026-07-31T10:25:00.000Z",
    "clientFingerprint": "fp_182739812"
  }
}
```

Backend validation must reject mixed payloads: `studentProfile` must not be accepted for `relocation`, and `sphere`, `wishPost`, `wishSalary` must not be accepted for `student`.

`attachments.resumeFileId` is required for both applicant types. The backend must verify that the file exists, belongs to the active upload/session perimeter, has an allowed type, and does not exceed the configured size limit.

For `studentProfile.status = "graduated"`, `practicePeriod` is omitted and must not be required. For course values `"1"` through `"6"`, both `practicePeriod.start` and `practicePeriod.end` are required in `YYYY-MM` format.

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

## 2) Fetch published vacancies
### `GET /vacancies?sector={sector}`
Returns published vacancies for one of the supported sectors. An omitted `sector` may return all published vacancies.

### Success `200`
```json
{
  "updatedAt": "2026-08-06T00:00:00+03:00",
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
  ]
}
```

The backend remains the source of truth for publication status, employer, salary and conditions. The bundled static catalog is only a safe frontend fallback and must not be treated as proof that a position is currently open.

## 3) Upload file
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
- Submit button lock during `loading`.
- Safe retry policy for transient statuses: `429, 500, 502, 503, 504`.
