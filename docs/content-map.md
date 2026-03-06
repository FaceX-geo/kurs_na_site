# Content Map — Migration from `Курс на Север.webarchive`

## Preserved legacy assets (exactly)
- Top logo block from old site:
  - old: `/upload/corporate_s1/logo2.png`
  - new: `assets/images/logo-top.png`
- Hero image from old slider:
  - old: `/upload/iblock/5f9/3qt9msxb1pdnezfz6im1q5db18u64vxf.jpg`
  - new: `assets/images/hero-main.jpg`

## Section mapping
| Old ID / block | Old title | New section | Migration notes |
|---|---|---|---|
| `#slider` | Hero slider | Hero (`index.html`) | Slider replaced by static premium hero with preserved image |
| `#advantages` | Как принять участие? | Participation flow | 4-step UX cards, content preserved by meaning |
| `#indicators` | «Курс на Север» в цифрах | Program metrics | Same key numbers: 930+, 150+, 76, 31 |
| `#services` | Регион заботится о вас | Support cards + modals | 4 categories kept, modal content rewritten for clarity |
| `#steps` | Поддержка на каждом шагу | Relocation timeline | 8 support steps preserved and reformatted |
| `#about` | О проекте «Курс на Север» | About section | Meaning preserved, editorial hierarchy |
| `#contacts` | Контакты | Contacts section | Same address, schedule, phone, email, social links |
| `#partners` | Полезные ссылки | Partner links | Reduced to key strategic/official links |
| `#footer` | Legal/social | Footer | Policies retained, clean structure |

## Support categories migrated
1. Общие меры поддержки в Мурманской области
2. Меры поддержки педагогических работников
3. Меры поддержки для медицинских работников
4. Для студентов

## Semantic depth transfer (legacy -> new UX)
- `#services` summary cards now use progressive disclosure:
  - card summary for fast scan;
  - modal details for full facts and legal/program references.
- Education support preserved in detail:
  - `Арктический учитель`, category bonuses, housing compensation, long leave logic.
- Medical support preserved in detail:
  - `Земский доктор/фельдшер`, regional quota payouts, housing and relocation package.
- Student support preserved in detail:
  - practice-first onboarding, internship-to-offer trajectory, curated external application link.
- General support preserved in detail:
  - north allowances, district coefficients, leave and relocation compensation.

## Contact data preserved
- Address: `г. Мурманск, ул. Академика Книповича, 48`
- Work schedule: `пн-пт с 09:00 по 17:00 мск`
- Phone: `+7 (911) 322-36-15`
- Email: `info@kursnasever.ru`
- Social:
  - `https://vk.com/kurs_na_sever`
  - `https://t.me/go_north`

## Partner links: reduced set
Kept as key links:
- `https://gov-murman.ru/region/support_measures/`
- `https://nashsever51.ru/`
- `https://invest.nashsever51.ru/`
- `https://murmansk.travel/`

## Removed / replaced legacy behavior
- Removed legacy `fetch` interception for `crm.contact.add` and chained deal creation.
- Removed old jQuery-heavy modal/menu/slider stack.
- Replaced with vanilla JS UX layer and REST JSON v1 adapter (`scripts/api-client.js`).

## New information architecture
1. Sticky header
2. Hero
3. Program metrics
4. Participation flow
5. Support categories + modal details
6. Relocation timeline
7. About
8. Contacts + partners
9. Application form (2-step)
10. Footer legal

## Brand alignment notes
- All page sections consume tokenized spacing/type/color system from `styles/main.css`.
- Typography is local (`assets/fonts`) with fallback stack, no required external font CDN.
- Motion is subtle and functional, aligned with `docs/brand-spec.md`.
