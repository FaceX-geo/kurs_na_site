# Контракт одноразовых credential-ссылок

Frontend принимает одноразовый credential только из URL fragment. Fragment не
передаётся серверу браузером и не попадает в HTTP referrer:

- приглашение: `/cabinet/invite/accept#token=<opaque-token>`;
- сброс пароля: `/cabinet/password/reset#token=<opaque-token>`.

После первого render frontend переносит токен только в память компонента и
сразу удаляет fragment и query из адресной строки через `replace`. Токен не
пишется в `localStorage`, `sessionStorage`, cookies, analytics, логи или DOM.
Query-вариант `?token=...` намеренно не принимается.

Форма проверяет совпадение паролей и ограничения OpenAPI (12–256 символов), а в
backend отправляет ровно `{ token, password }` в `AcceptInvite` либо
`CompletePasswordReset`. После успеха токен и оба password field очищаются.

Credential delivery provider получает `oneTimeCredential` отдельно. При
формировании пользовательского письма/сообщения provider обязан собрать ссылку
ровно в этом fragment-формате. Если provider использует другую форму, меняется
его шаблон либо этот versioned документ вместе с frontend-тестами; токен нельзя
переносить в query ради совместимости.
