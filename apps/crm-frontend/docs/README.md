# CRM Frontend

Frontend освобождает специалистов «Курса на Север» от ручной сверки заявок,
задач, работодателей и коммуникаций, оставляя человеку контроль над переходами,
массовыми действиями и критичными решениями.

## Документы

- [Архитектура](./architecture.md) — границы, слои, контракты и эксплуатационные
  инварианты;
- [Граница второго фактора](./auth-max-boundary.md) — development stub,
  production TOTP bridge и fail-closed MAX boundary;
- [Credential links](./credential-links.md) — fragment-only приглашение и сброс
  пароля без хранения одноразового токена;
- [Provenance реестра](./registry-provenance.md) — что именно адаптировано из
  соседнего продукта и что запрещено переносить;
- [Third-party UI dependencies](./third-party-assets.md) — зафиксированные
  версии, лицензии и допустимое использование;
- [Generated raster assets](./generated-assets.md) — prompts, размеры и hashes
  двух CRM-owned ImageGen-фонов;
- [UI Registry](../registry/README.md) — 51 экран, компоненты, contracts, snippets
  и recipes.

## Локальная проверка foundation

```bash
npm run registry:check
npx tsc -p registry/tsconfig.json
npm run typecheck
npm run lint
npm run test
```

`npm run verify` дополнительно регенерирует API types и собирает runtime. Его
используют после осознанного обновления backend OpenAPI, а не как способ скрыто
переписать generated-файлы.
