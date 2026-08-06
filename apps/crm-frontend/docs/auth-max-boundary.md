# Временная граница второго фактора

## Production-решение до интеграции MAX

Backend уже публикует `Login`, `VerifyMfa` и `EnrollMfa`. В production frontend
использует их как безопасный TOTP-контур:

1. пароль создаёт короткоживущий challenge;
2. для нового пользователя `EnrollMfa` выдаёт одноразовый secret/otpauth URI;
3. сервер подтверждает реальный шестизначный TOTP;
4. recovery codes показываются один раз и не сохраняются frontend;
5. только подтверждённая backend session открывает CRM.

Это не проверка через MAX. MAX остаётся маркированной UI/provider-заглушкой до
появления отдельного versioned backend-контракта. Текст challenge обязан
ветвиться по `pendingAuth.provider`: `totp` называется TOTP, `max_otp` — MAX.

## Development stub

- development по умолчанию может использовать явно отмеченный mock transport;
- `VITE_CRM_AUTH_MODE=live` включает реальную session/login/TOTP цепочку;
- production аварийно останавливается при `VITE_CRM_AUTH_MODE=mock`;
- stub не вызывает MAX, не пишет OTP/пароли и не создаёт production session;
- auth shell не загружает CRM records, counts или notifications.

## Fresh MFA для критичных действий

Обычный вход даёт `authenticationLevel=mfa`. Создание специалиста и другие
критичные admin/content mutations выполняются только после `VerifyMfa` reauth
branch `{ password, mfaCode }`. Пароль и код живут только в состоянии открытой
формы, не логируются и не сохраняются. Успешный ответ обновляет CSRF/session и
профиль; frontend затем выполняет ровно ранее подтверждённое действие.

## Fail-closed ограничения

- business role берётся только из явного `businessRole`; internal roles не
  конвертируются в `SUPER_ADMIN` или `SPECIALIST` на клиенте;
- email/SMS не используются как обход фактора;
- отсутствующий или устаревший challenge не заменяется локальным кодом;
- CSRF никогда не синтезируется frontend;
- MAX не считается подключённым или подтверждённым по одному UI-тексту.

## Условие замены TOTP на MAX

MAX становится production-фактором только после появления и проверки операций
начала challenge, подтверждения, cooldown/expiry/attempt limits, recovery,
enrollment state и provider audit trail. Затем синхронно обновляются OpenAPI,
generated types, registry, тесты и deployment configuration.
