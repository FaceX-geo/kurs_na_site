import ApiClient, {
  ApiError,
  bindSubmitAttemptPayload,
  createSubmitAttempt,
} from "./api-client.js?v=20260807-1";
import { initAurora } from "./aurora.js?v=20260731-5";
import { isPublishedMapPoint, projectLonLat } from "./map-geometry.js?v=20260729-1";
import {
  VACANCY_SECTORS,
  calculateAgeOn,
  digitsOnly,
  isVacancyRouteCompatible,
  minimumAgeFor,
  normalizeVacancy,
} from "./application-rules.js?v=20260806-1";

const PUBLIC_API_BASE_URL = "/public/v1";
const PRIVACY_POLICY_VERSION = "landing-inline-2026-08-06";

const apiClient = new ApiClient({
  baseUrl: PUBLIC_API_BASE_URL,
  maxRetries: 2,
  retryDelayMs: 350,
});

const supportContent = {
  general: {
    eyebrow: "Для всех участников",
    title: "Общие меры поддержки",
    media: {
      src: "assets/images/support-general-smile-logo-v13.webp",
      mobileSrc: "assets/images/support-general-smile-logo-mobile-v13.webp",
      alt: "Улыбающаяся семья распаковывает вещи после переезда в Мурманск.",
      positionDesktop: "78% 42%",
      positionMobile: "86% 50%",
    },
    summary: [
      "Северная надбавка до 80% и районные коэффициенты.",
      "Дополнительный оплачиваемый отпуск 24 дня.",
      "Компенсация переезда и провоза багажа до 5 тонн на семью.",
    ],
    details: [
      "Процентная надбавка за работу в районах Крайнего Севера может достигать 80%; для молодых специалистов до 35 лет действуют специальные условия начисления.",
      "Районный коэффициент в Мурманской области составляет 1,4; в отдельных территориях применяются повышенные значения.",
      "Ежегодный дополнительный оплачиваемый отпуск за работу в районах Крайнего Севера — 24 календарных дня.",
      "Раз в два года может компенсироваться проезд к месту отдыха и обратно для работника и членов семьи.",
      "При переезде работодатель может компенсировать проезд и провоз багажа до 5 тонн на семью.",
      "Для женщин может устанавливаться сокращённая 36-часовая рабочая неделя с сохранением полной оплаты.",
    ],
  },
  education: {
    eyebrow: "Сфера образования",
    title: "Поддержка педагогов",
    media: {
      src: "assets/images/support-education-smile-v12.webp",
      alt: "Улыбающийся педагог проводит занятие в школе Мурманской области.",
      positionDesktop: "80% 42%",
      positionMobile: "98% 50%",
    },
    summary: [
      "Конкурс «Арктический учитель»: выплаты до 1 000 000 ₽.",
      "Надбавки 10 000–15 000 ₽ по квалификационной категории.",
      "Компенсация аренды жилья до 25 000 ₽ в месяц.",
    ],
    details: [
      "Победители конкурса «Арктический учитель», переехавшие в область на дефицитные места, могут получить до 1 000 000 ₽.",
      "Педагогам с первой квалификационной категорией предусмотрена ежемесячная надбавка 10 000 ₽, с высшей — 15 000 ₽.",
      "Для специалистов на квотированных рабочих местах возможна компенсация аренды жилья до 25 000 ₽ в месяц.",
      "Молодым педагогам может предоставляться единовременное пособие при первом трудоустройстве после выпуска.",
      "Для работников образования предусмотрены северная надбавка, районный коэффициент и расширенный отпуск.",
      "Полный набор мер зависит от муниципалитета, должности и программы трудоустройства.",
    ],
  },
  medicine: {
    eyebrow: "Сфера здравоохранения",
    title: "Поддержка медиков",
    media: {
      src: "assets/images/support-medicine-smile-v12.webp",
      alt: "Улыбающийся врач обсуждает рабочую смену с коллегой в региональной клинике.",
      positionDesktop: "80% 40%",
      positionMobile: "90% 50%",
    },
    summary: [
      "«Земский доктор»: выплаты до 2 000 000 ₽.",
      "Региональные квотные выплаты до 1 500 000 ₽.",
      "Компенсация аренды жилья до 25 000 ₽ в месяц.",
    ],
    details: [
      "По программе «Земский доктор» выплата для врача может достигать 2 000 000 ₽ в зависимости от места трудоустройства.",
      "По программе «Земский фельдшер» предусмотрены выплаты для фельдшеров, акушеров и медицинских сестёр.",
      "Региональные выплаты на квотированных дефицитных местах могут достигать 1 500 000 ₽.",
      "Компенсация аренды жилья может составлять до 25 000 ₽ в месяц; в отдельных случаях предоставляется служебное жильё.",
      "При переезде могут компенсироваться проезд, провоз багажа и предоставляться отпуск для обустройства.",
      "Будущим медикам доступны целевые стипендии, места практики и гарантированный маршрут к трудоустройству.",
    ],
  },
  students: {
    eyebrow: "Старт карьеры",
    title: "Поддержка студентов",
    media: {
      src: "assets/images/support-students-smile-v12.webp",
      alt: "Улыбающийся студент проходит инженерную практику на предприятии Мурманской области.",
      positionDesktop: "82% 42%",
      positionMobile: "95% 50%",
    },
    summary: [
      "Практика на предприятиях Мурманской области.",
      "Карьерный трек под специальность и уровень подготовки.",
      "Поддержка перехода от стажировки к первому офферу.",
    ],
    details: [
      "Проект помогает выбрать практику на предприятиях региона с учётом специальности и карьерных интересов.",
      "Студент знакомится с работодателем и задачами ещё во время обучения.",
      "Куратор помогает подготовить резюме, пройти первые интервью и собрать обратную связь.",
      "После успешной практики участник может перейти к стажировке или трудоустройству.",
      "Для будущих медиков предусмотрены отдельные целевые программы, стипендии и места практики.",
      "Условия участия и календарь набора уточняются командой проекта.",
    ],
  },
};

const storyContent = {
  family: {
    id: "family",
    tone: "story-message--berry",
    filters: ["children", "couple", "big-city"],
    cardTags: ["С детьми", "Переезд семьёй"],
    ariaLabel: "Открыть историю Марины о переезде с детьми",
    eyebrow: "Собирательная история · семья",
    title: "Переезд, в котором учли всю семью",
    person: "Марина, 35",
    route: "Воронеж → Мурманск",
    avatar: "assets/images/story-avatar-family-v8.webp",
    avatarAlt: "Портрет Марины",
    cardQuote: "Куратор связал работу, жильё и школу в один маршрут.",
    quote: "Больше всего переживала за школу и быт. Куратор собрал всё в один понятный маршрут — от собеседования до первого учебного дня детей.",
    tags: ["С детьми", "Переезд семьёй", "Новый город"],
    lead: "Марине было важно не просто принять оффер, а синхронизировать работу, жильё, школу и дорогу для всей семьи.",
    gallery: [
      { src: "assets/images/story-avatar-family-v8.webp", alt: "Семейный портрет участницы" },
      { src: "assets/images/support-general-smile-logo-v13.webp", alt: "Улыбающаяся семья после переезда в Мурманскую область" },
      { src: "assets/images/relocation-story-summer.jpg", alt: "Летний Мурманск после переезда" },
    ],
    steps: [
      "Куратор собрал требования к вакансии и семейные ограничения в одной анкете.",
      "До выхода на работу согласовали жильё, школу и дату перевозки вещей.",
      "Семья получила единый календарь переезда вместо нескольких разрозненных списков.",
      "После приезда куратор оставался на связи в течение адаптационного периода.",
    ],
  },
  dog: {
    id: "dog",
    tone: "story-message--cyan",
    filters: ["dog", "alone", "career-change", "big-city"],
    cardTags: ["С собакой", "Смена профессии"],
    ariaLabel: "Открыть историю Ильи о переезде с собакой",
    eyebrow: "Собирательная история · с питомцем",
    title: "Новая работа ближе к горам",
    person: "Илья, 29",
    route: "Санкт-Петербург → Кировск",
    avatar: "assets/images/story-avatar-dog-v8.webp",
    avatarAlt: "Портрет Ильи с собакой",
    cardQuote: "До даты выхода решили работу, жильё и переезд с собакой.",
    quote: "Искал работу ближе к горам, но не понимал, как перевозить собаку и снимать жильё. В итоге все вопросы решили до даты выхода.",
    tags: ["С собакой", "Смена профессии", "Переехал один"],
    lead: "Илья менял карьерный трек и хотел заранее убедиться, что найдёт жильё, где можно жить с собакой.",
    gallery: [
      { src: "assets/images/story-avatar-dog-v8.webp", alt: "Илья с собакой" },
      { src: "assets/images/route-khibiny-summer.jpg", alt: "Летние Хибины рядом с Кировском" },
      { src: "assets/images/route-teriberka-summer.jpg", alt: "Побережье Баренцева моря летом" },
    ],
    steps: [
      "Опыт Ильи сопоставили с вакансиями, где работодатель был готов к смене специализации.",
      "Куратор собрал варианты аренды с разрешёнными питомцами и контакты перевозчиков.",
      "Собеседования провели дистанционно, а дату выхода связали с датой переезда.",
      "После трудоустройства в маршрут добавили знакомство с городом и местным сообществом.",
    ],
  },
  student: {
    id: "student",
    tone: "story-message--blue",
    filters: ["student", "alone"],
    cardTags: ["Студент", "Переехала одна"],
    ariaLabel: "Открыть историю Алины о студенческой практике",
    eyebrow: "Собирательная история · практика",
    title: "Практика, которая стала первым оффером",
    person: "Алина, 21",
    route: "Петрозаводск → Мурманск",
    avatar: "assets/images/story-avatar-student-v8.webp",
    avatarAlt: "Портрет Алины",
    cardQuote: "Практика в Мурманске превратилась в первый оффер.",
    quote: "Приехала на практику на шесть недель, познакомилась с командой и ещё до защиты диплома получила предложение вернуться.",
    tags: ["Студент", "Переехала одна", "Первый оффер"],
    lead: "Алина искала производственную практику по специальности и хотела понять, подходит ли ей жизнь в Заполярье.",
    gallery: [
      { src: "assets/images/story-avatar-student-v8.webp", alt: "Портрет студентки" },
      { src: "assets/images/students-mgtu-arrival-smile-v12.webp", alt: "Улыбающиеся студенты у арктического университета" },
      { src: "assets/images/route-murmansk-port-summer.jpg", alt: "Мурманский порт летом" },
    ],
    steps: [
      "По специальности и срокам практики подобрали несколько предприятий региона.",
      "До поездки согласовали проживание, наставника и перечень реальных задач.",
      "Во время практики Алина собрала портфолио и прошла встречу с будущей командой.",
      "После защиты диплома работодатель предложил вернуться уже на штатную позицию.",
    ],
  },
  doctor: {
    id: "doctor",
    tone: "story-message--blue",
    filters: ["alone", "career-change"],
    cardTags: ["Новая специальность", "Переехала одна"],
    ariaLabel: "Открыть историю Ирины о работе врачом в Апатитах",
    eyebrow: "Собирательная история · медицина",
    title: "Работа, ради которой стоило сменить город",
    person: "Ирина, 33",
    route: "Казань → Апатиты",
    avatar: "assets/images/story-avatar-doctor-v9.webp",
    avatarAlt: "Портрет Ирины, врача в Апатитах",
    cardQuote: "Сначала познакомилась с отделением — потом приняла решение.",
    quote: "Хотела больше самостоятельности в работе. Сначала приехала на знакомство с отделением, а уже потом спокойно приняла решение о переезде.",
    tags: ["Медицина", "Переехала одна", "Смена города"],
    lead: "Ирина выбирала не просто вакансию, а команду, профессиональную нагрузку и город, в котором сможет чувствовать себя дома.",
    gallery: [
      { src: "assets/images/story-avatar-doctor-v9.webp", alt: "Портрет врача Ирины" },
      { src: "assets/images/support-medicine-smile-v12.webp", alt: "Улыбающаяся медицинская команда в Мурманской области" },
      { src: "assets/images/route-khibiny-summer.jpg", alt: "Летние Хибины рядом с Апатитами" },
    ],
    steps: [
      "Куратор уточнил профессиональные задачи и связал Ирину с будущим руководителем.",
      "До решения о переезде организовали знакомство с отделением и городом.",
      "Отдельно проверили доступные выплаты, жильё и календарь оформления документов.",
      "После выхода на работу куратор помог закрыть оставшиеся бытовые вопросы.",
    ],
  },
  engineer: {
    id: "engineer",
    tone: "story-message--berry",
    filters: ["children", "couple", "career-change"],
    cardTags: ["Семья", "Инженерная карьера"],
    ariaLabel: "Открыть историю Андрея о семейном переезде в Мончегорск",
    eyebrow: "Собирательная история · инженер",
    title: "Один оффер — маршрут для всей семьи",
    person: "Андрей, 38",
    route: "Екатеринбург → Мончегорск",
    avatar: "assets/images/story-avatar-engineer-v9.webp",
    avatarAlt: "Портрет инженера Андрея",
    cardQuote: "Когда сложили две карьеры, школу и жильё — риск исчез.",
    quote: "Оффер был сильным, но решение зависело от школы, работы супруги и жилья. Когда всё сложили в один план, переезд перестал казаться риском.",
    tags: ["С детьми", "Переезд семьёй", "Промышленность"],
    lead: "Для семьи Андрея главным условием была синхронизация двух карьер и привычного ритма детей.",
    gallery: [
      { src: "assets/images/story-avatar-engineer-v9.webp", alt: "Портрет инженера Андрея" },
      { src: "assets/images/career-industry-smile-v12.webp", alt: "Улыбающийся инженер на предприятии Мурманской области" },
      { src: "assets/images/support-general-smile-logo-v13.webp", alt: "Улыбающаяся семья в Мурманской области" },
    ],
    steps: [
      "Вакансию и условия работодателя проверили до финального собеседования.",
      "Для супруги собрали отдельную подборку подходящих ролей.",
      "Школу, аренду и перевозку вещей связали с датой выхода на работу.",
      "Семья получила общий календарь и контакт одного ответственного куратора.",
    ],
  },
  young: {
    id: "young",
    tone: "story-message--cyan",
    filters: ["student", "dog", "alone"],
    cardTags: ["Первый оффер", "С собакой"],
    ariaLabel: "Открыть историю Максима о первом оффере и переезде с собакой",
    eyebrow: "Собирательная история · первый оффер",
    title: "Первый серьёзный проект — на Севере",
    person: "Максим, 24",
    route: "Нижний Новгород → Мурманск",
    avatar: "assets/images/story-avatar-young-v9.webp",
    avatarAlt: "Портрет Максима с собакой",
    cardQuote: "Получил наставника, жильё с собакой и понятный старт.",
    quote: "Боялся, что без большого опыта останусь один на один с переездом. Вместо этого получил наставника, понятный старт и помощь с жильём, где можно с собакой.",
    tags: ["Выпускник", "С собакой", "Первый переезд"],
    lead: "Максиму было важно начать карьеру в реальном проекте и не расставаться с собакой из-за условий аренды.",
    gallery: [
      { src: "assets/images/story-avatar-young-v9.webp", alt: "Портрет Максима с собакой" },
      { src: "assets/images/students-mgtu-arrival-smile-v12.webp", alt: "Улыбающиеся молодые специалисты у арктического университета" },
      { src: "assets/images/route-murmansk-port-summer.jpg", alt: "Мурманский порт летом" },
    ],
    steps: [
      "Резюме выпускника сопоставили с задачами, где был предусмотрен наставник.",
      "Собеседование и знакомство с командой прошли дистанционно.",
      "До поездки нашли варианты аренды, где разрешено жить с питомцем.",
      "Первые недели работы включили в адаптационный план вместе с бытовыми задачами.",
    ],
  },
  teacher: {
    id: "teacher",
    tone: "story-message--berry",
    filters: ["children", "career-change", "couple"],
    cardTags: ["Педагог", "С детьми"],
    ariaLabel: "Открыть историю Ольги о работе учителем в Мончегорске",
    eyebrow: "Собирательная история · образование",
    title: "Школа, команда и спокойный переезд",
    person: "Ольга, 36",
    route: "Тула → Мончегорск",
    avatar: "assets/images/career-education-smile-v12.webp",
    avatarAlt: "Портрет учителя Ольги",
    cardQuote: "До переезда знала коллег, класс и школу ребёнка.",
    quote: "Сначала увидела будущий класс по видеосвязи. К моменту переезда уже знала коллег и понимала, где будет учиться ребёнок.",
    tags: ["Педагог", "С детьми", "Новый город"],
    lead: "Ольге было важно одновременно решить рабочий вопрос и адаптацию ребёнка.",
    gallery: [
      { src: "assets/images/career-education-smile-v12.webp", alt: "Ольга в школьном классе" },
      { src: "assets/images/support-education-smile-v12.webp", alt: "Улыбающийся педагог в образовательной среде Мурманской области" },
      { src: "assets/images/relocation-story-summer.jpg", alt: "Лето после переезда на Север" },
    ],
    steps: ["Знакомство со школой онлайн.", "Проверка выплат и аренды.", "Выбор школы для ребёнка.", "Поддержка в первые недели."],
  },
  port: {
    id: "port",
    tone: "story-message--blue",
    filters: ["alone", "career-change", "big-city"],
    cardTags: ["Порт", "Новая отрасль"],
    ariaLabel: "Открыть историю Дениса о работе в Мурманском порту",
    eyebrow: "Собирательная история · логистика",
    title: "Из сервиса — в портовую логистику",
    person: "Денис, 31",
    route: "Самара → Мурманск",
    avatar: "assets/images/career-port-smile-logo-v13.webp",
    avatarAlt: "Портрет портового специалиста Дениса",
    cardQuote: "Мой опыт подошёл новой отрасли — остальное помогли собрать.",
    quote: "Опыт оказался переносимым. Куратор помог увидеть подходящие роли, а работодатель — пройти вводное обучение.",
    tags: ["Переехал один", "Смена профессии", "Логистика"],
    lead: "Денис искал переход в более крупные операционные проекты без потери накопленного опыта.",
    gallery: [
      { src: "assets/images/career-port-smile-logo-v13.webp", alt: "Денис на рабочем причале" },
      { src: "assets/images/route-murmansk-port-summer.jpg", alt: "Мурманский порт летом" },
      { src: "assets/images/relocation-story-summer.jpg", alt: "Мурманск после переезда" },
    ],
    steps: ["Разбор опыта и новых ролей.", "Дистанционные собеседования.", "Жильё рядом с работой.", "Вводное обучение на месте."],
  },
  energy: {
    id: "energy",
    tone: "story-message--cyan",
    filters: ["couple", "career-change"],
    cardTags: ["Энергетика", "Переезд вдвоём"],
    ariaLabel: "Открыть историю Светланы о переезде в Полярные Зори",
    eyebrow: "Собирательная история · энергетика",
    title: "Две карьеры в одном маршруте",
    person: "Светлана, 34",
    route: "Пермь → Полярные Зори",
    avatar: "assets/images/career-safety-smile-logo-v13.webp",
    avatarAlt: "Портрет инженера-энергетика Светланы",
    cardQuote: "Сильная роль для меня и варианты работы для мужа.",
    quote: "Мне предложили сильную роль, а для мужа нашли несколько подходящих вариантов. Только тогда решение стало семейным.",
    tags: ["Переезд вдвоём", "Энергетика", "Работа для партнёра"],
    lead: "Главным условием была возможность развиваться обоим партнёрам.",
    gallery: [
      { src: "assets/images/career-safety-smile-logo-v13.webp", alt: "Светлана на энергообъекте" },
      { src: "assets/images/support-general-smile-logo-v13.webp", alt: "Улыбающаяся семья в Мурманской области" },
      { src: "assets/images/route-khibiny-summer.jpg", alt: "Летний Кольский полуостров" },
    ],
    steps: ["Проверка условий оффера.", "Подбор ролей для партнёра.", "Синхронизация дат переезда.", "Адаптация на новом месте."],
  },
  analyst: {
    id: "analyst",
    tone: "story-message--blue",
    filters: ["student", "alone"],
    cardTags: ["Выпускник", "Первый проект"],
    ariaLabel: "Открыть историю Романа о первом проекте в Апатитах",
    eyebrow: "Собирательная история · старт карьеры",
    title: "Диплом — и сразу в реальный проект",
    person: "Роман, 23",
    route: "Москва → Апатиты",
    avatar: "assets/images/career-students-smile-logo-v13.webp",
    avatarAlt: "Портрет аналитика Романа",
    cardQuote: "Наставник, реальный проект и путь к штатной позиции.",
    quote: "Хотел не формальную стажировку, а реальные задачи. Получил наставника, проект и понятный путь к штатной позиции.",
    tags: ["Выпускник", "Переехал один", "Первый оффер"],
    lead: "Роман выбирал место, где сможет быстро превратить знания в опыт.",
    gallery: [
      { src: "assets/images/career-students-smile-logo-v13.webp", alt: "Роман в лаборатории" },
      { src: "assets/images/students-mgtu-arrival-smile-v12.webp", alt: "Улыбающиеся молодые специалисты в Мурманске" },
      { src: "assets/images/route-khibiny-summer.jpg", alt: "Летние Хибины" },
    ],
    steps: ["Подбор проекта по специальности.", "Интервью с наставником.", "Организация переезда.", "План роста на первые месяцы."],
  },
};

const state = {
  formStep: 1,
  resumeFileId: null,
  resumeFileBindingToken: null,
  resumeAttachment: { file: null, source: "" },
  formSubmitting: false,
  submitAttempt: null,
  applicationContext: {
    source: "direct",
    vacancyId: "",
    vacancySector: "",
    role: "",
    sphere: "",
    city: "",
    applicantType: "relocation",
  },
  selectedCity: null,
  activeSupport: "general",
};

function qs(selector, context = document) {
  return context.querySelector(selector);
}

function qsa(selector, context = document) {
  return Array.from(context.querySelectorAll(selector));
}

function invalidateSubmitAttempt() {
  state.submitAttempt = null;
}

function setResumeAttachment(file, source = "upload") {
  const form = qs("#application-form");
  const input = qs("#resume", form || document);
  const fileName = qs("#resume-name", form || document);

  state.resumeAttachment = {
    file: file instanceof File ? file : null,
    source: file instanceof File ? source : "",
  };
  state.resumeFileId = null;
  state.resumeFileBindingToken = null;
  invalidateSubmitAttempt();

  if (source === "builder" && input) {
    input.value = "";
  }
  if (fileName) {
    fileName.textContent = file instanceof File
      ? `${file.name} · прикреплено к заявке`
      : "PDF, DOC, DOCX или RTF до 10 МБ";
  }
  if (form && file instanceof File) {
    setFieldError(form, "resume", "");
  }
}

function setBodyLock(className, enabled) {
  document.body.classList.toggle(className, enabled);
}

function scrollToSection(target) {
  const element = typeof target === "string" ? qs(target) : target;
  if (!element) {
    return;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
}

function initHeader() {
  const header = qs("[data-site-header]");
  if (!header) {
    return;
  }

  const update = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 24);
  };

  update();
  window.addEventListener("scroll", update, { passive: true });
}

function initMobileMenu() {
  const nav = qs("[data-mobile-nav]");
  const openButton = qs("[data-menu-open]");
  const closeButtons = qsa("[data-menu-close]");
  if (!nav || !openButton) {
    return;
  }

  const focusableSelector = "a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";

  const close = ({ returnFocus = true } = {}) => {
    nav.setAttribute("aria-hidden", "true");
    openButton.setAttribute("aria-expanded", "false");
    setBodyLock("menu-open", false);
    if (returnFocus) {
      openButton.focus();
    }
  };

  const open = () => {
    nav.setAttribute("aria-hidden", "false");
    openButton.setAttribute("aria-expanded", "true");
    setBodyLock("menu-open", true);
    qs(focusableSelector, nav)?.focus();
  };

  openButton.addEventListener("click", open);
  closeButtons.forEach((button) => button.addEventListener("click", () => close()));
  qsa("a[href^='#']", nav).forEach((link) => {
    link.addEventListener("click", () => close({ returnFocus: false }));
  });

  nav.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusable = qsa(focusableSelector, nav).filter((element) => !element.hasAttribute("hidden"));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function initAnchorLinks() {
  qsa("a[href^='#']").forEach((link) => {
    link.addEventListener("click", (event) => {
      const selector = link.getAttribute("href");
      if (!selector || selector === "#") {
        return;
      }

      const target = qs(selector);
      if (!target) {
        return;
      }

      event.preventDefault();
      scrollToSection(target);
    });
  });
}

function initReveal() {
  const elements = qsa(".reveal");
  if (!elements.length || !("IntersectionObserver" in window)) {
    return;
  }

  elements.forEach((element) => element.classList.add("is-pending"));
  const observer = new IntersectionObserver((entries, instance) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }
      entry.target.classList.add("is-visible");
      instance.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });

  elements.forEach((element) => observer.observe(element));
}

function initHeroParallax() {
  const scene = qs("[data-hero-scene]");
  if (!scene || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;
  let frame = 0;
  let visible = true;

  const requestRender = () => {
    if (visible && !frame) {
      frame = requestAnimationFrame(render);
    }
  };

  const render = () => {
    frame = 0;
    currentX += (targetX - currentX) * 0.06;
    currentY += (targetY - currentY) * 0.06;
    scene.style.setProperty("--hero-bg-x", `${(currentX * -7).toFixed(2)}px`);
    scene.style.setProperty("--hero-bg-y", `${(currentY * -5).toFixed(2)}px`);
    scene.style.setProperty("--hero-person-x", `${(currentX * 12).toFixed(2)}px`);
    scene.style.setProperty("--hero-person-y", `${(currentY * 7).toFixed(2)}px`);
    const isSettling = Math.abs(targetX - currentX) > 0.001
      || Math.abs(targetY - currentY) > 0.001;
    if (visible && isSettling) {
      frame = requestAnimationFrame(render);
    }
  };

  scene.addEventListener("pointermove", (event) => {
    const rect = scene.getBoundingClientRect();
    targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    requestRender();
  }, { passive: true });

  scene.addEventListener("pointerleave", () => {
    targetX = 0;
    targetY = 0;
    requestRender();
  }, { passive: true });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) {
        requestRender();
      } else if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }, { rootMargin: "10% 0px" });
    observer.observe(scene);
  }

  requestRender();
}

function initVacancies() {
  const section = qs("#vacancies");
  const results = qs("[data-vacancy-results]", section);
  const list = qs("[data-vacancy-list]", section);
  const status = qs("[data-vacancy-status]", section);
  const title = qs("[data-vacancy-list-title]", section);
  const meta = qs("[data-vacancy-list-meta]", section);
  const dialog = qs("#vacancy-dialog");
  const sectorButtons = qsa("[data-vacancy-sector-open]", section);
  const vacancyById = new Map();
  let activeSector = "";
  let controller = null;

  if (!section || !results || !list || !dialog) {
    return;
  }

  const createButton = (label, className, datasetName, vacancyId) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.dataset[datasetName] = vacancyId;
    return button;
  };

  const loadSector = async (sector, signal) => {
    try {
      const remote = await apiClient.getVacancies(sector, signal);
      const normalizedRemote = remote.map(normalizeVacancy).filter((item) => item?.published);
      return { items: normalizedRemote, source: "api", updatedAt: "" };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw error;
      }
    }

    const fallback = await fetchJson(new URL("../assets/data/vacancies.json", import.meta.url));
    return {
      items: (fallback.items || [])
        .map(normalizeVacancy)
        .filter((item) => item?.published && item.sector === sector),
      source: "fallback",
      updatedAt: fallback.updatedAt || "",
    };
  };

  const renderList = (items) => {
    vacancyById.clear();
    const cards = items.map((vacancy) => {
      vacancyById.set(vacancy.id, vacancy);
      const article = document.createElement("article");
      article.className = "vacancy-list-card";

      const content = document.createElement("div");
      const cardMeta = document.createElement("div");
      cardMeta.className = "vacancy-list-card__meta";
      [vacancy.city, vacancy.employer, vacancy.salaryText].filter(Boolean).forEach((value) => {
        const item = document.createElement("span");
        item.textContent = value;
        cardMeta.append(item);
      });
      const heading = document.createElement("h4");
      heading.textContent = vacancy.title;
      const summary = document.createElement("p");
      summary.textContent = vacancy.summary;
      content.append(cardMeta, heading, summary);

      const actions = document.createElement("div");
      actions.className = "vacancy-list-card__actions";
      actions.append(
        createButton("Подробнее", "button button--secondary button--compact", "vacancyDetails", vacancy.id),
        createButton("Откликнуться", "button button--primary button--compact", "vacancyApply", vacancy.id),
      );
      article.append(content, actions);
      return article;
    });
    list.replaceChildren(...cards);
  };

  const renderDetailList = (selector, values) => {
    const target = qs(selector, dialog);
    const sectionElement = target?.closest("[data-vacancy-dialog-section]");
    if (!target || !sectionElement) {
      return;
    }
    const items = values.map((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      return item;
    });
    target.replaceChildren(...items);
    sectionElement.hidden = !items.length;
  };

  const openVacancy = (vacancy) => {
    dialog.dataset.vacancyId = vacancy.id;
    qs("[data-vacancy-dialog-sector]", dialog).textContent = VACANCY_SECTORS[vacancy.sector];
    qs("[data-vacancy-dialog-title]", dialog).textContent = vacancy.title;
    qs("[data-vacancy-dialog-city]", dialog).textContent = vacancy.city;
    qs("[data-vacancy-dialog-employer]", dialog).textContent = vacancy.employer;
    qs("[data-vacancy-dialog-salary]", dialog).textContent = vacancy.salaryText;
    qs("[data-vacancy-dialog-summary]", dialog).textContent = vacancy.summary;
    renderDetailList("[data-vacancy-dialog-responsibilities]", vacancy.responsibilities);
    renderDetailList("[data-vacancy-dialog-requirements]", vacancy.requirements);
    renderDetailList("[data-vacancy-dialog-conditions]", vacancy.conditions);
    openDialog(dialog);
  };

  const applyVacancy = (vacancy, source) => {
    prefillApplication({
      vacancyId: vacancy.id,
      vacancySector: vacancy.sector,
      role: vacancy.title,
      sphere: vacancy.sphere,
      city: vacancy.city,
      applicantType: vacancy.applicantType,
      source,
    });
  };

  const showSector = async (sector) => {
    if (!Object.hasOwn(VACANCY_SECTORS, sector)) {
      return;
    }
    activeSector = sector;
    controller?.abort();
    controller = new AbortController();
    sectorButtons.forEach((button) => {
      const active = button.dataset.vacancySectorOpen === sector;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-expanded", String(active));
    });
    results.hidden = false;
    title.textContent = VACANCY_SECTORS[sector];
    meta.textContent = "Загружаем актуальные предложения…";
    status.textContent = "Загрузка вакансий.";
    list.replaceChildren();

    try {
      const payload = await loadSector(sector, controller.signal);
      if (sector !== activeSector) {
        return;
      }
      renderList(payload.items);
      const updatedAt = payload.updatedAt ? new Date(payload.updatedAt) : null;
      const updateLabel = updatedAt && !Number.isNaN(updatedAt.getTime())
        ? ` · данные от ${updatedAt.toLocaleDateString("ru-RU")}`
        : "";
      meta.textContent = payload.source === "api"
        ? `Найдено предложений: ${payload.items.length}`
        : `Базовые направления набора${updateLabel}. Наличие и условия подтвердит куратор.`;
      status.textContent = payload.items.length
        ? `Показано вакансий: ${payload.items.length}.`
        : "Сейчас в этом направлении нет опубликованных вакансий. Оставьте общую заявку — куратор проверит новые предложения.";
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      meta.textContent = "Не удалось загрузить подборку.";
      status.textContent = "Обновите страницу или оставьте общую заявку — куратор поможет подобрать направление.";
    }
    results.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  section.addEventListener("click", (event) => {
    const sectorButton = event.target.closest("[data-vacancy-sector-open]");
    if (sectorButton) {
      showSector(sectorButton.dataset.vacancySectorOpen);
      return;
    }
    const detailsButton = event.target.closest("[data-vacancy-details]");
    if (detailsButton) {
      const vacancy = vacancyById.get(detailsButton.dataset.vacancyDetails);
      if (vacancy) {
        openVacancy(vacancy);
      }
      return;
    }
    const applyButton = event.target.closest("[data-vacancy-apply]");
    if (applyButton) {
      const vacancy = vacancyById.get(applyButton.dataset.vacancyApply);
      if (vacancy) {
        applyVacancy(vacancy, "vacancy-list");
      }
    }
  });

  qs("[data-vacancy-results-close]", section)?.addEventListener("click", () => {
    controller?.abort();
    activeSector = "";
    results.hidden = true;
    sectorButtons.forEach((button) => {
      button.classList.remove("is-active");
      button.setAttribute("aria-expanded", "false");
    });
    sectorButtons[0]?.focus();
  });

  qs("[data-vacancy-dialog-apply]", dialog)?.addEventListener("click", () => {
    const vacancy = vacancyById.get(dialog.dataset.vacancyId);
    if (vacancy) {
      applyVacancy(vacancy, "vacancy-detail");
    }
  });
}

function updateCityPanel(city) {
  state.selectedCity = city;
  const panel = qs("[data-city-panel]");
  const map = qs("[data-region-map]");
  if (!panel) {
    return;
  }

  map?.classList.add("has-selection");
  panel.hidden = false;
  qs("[data-city-eyebrow]", panel).textContent = city.eyebrow || "Город Мурманской области";
  qs("[data-city-name]", panel).textContent = city.name;
  qs("[data-city-description]", panel).textContent = city.description || "Подробности о городе появятся после публикации.";

  const sectors = qs("[data-city-sectors]", panel);
  sectors.replaceChildren(...(Array.isArray(city.sectors) ? city.sectors : []).map((sector) => {
    const element = document.createElement("span");
    element.textContent = sector;
    return element;
  }));

  const note = qs("[data-city-note]", panel);
  note.hidden = !city.note;
  note.textContent = city.note || "";

  const source = qs("[data-city-source]", panel);
  source.hidden = !city.source;
  if (city.source) {
    source.href = city.source;
    source.setAttribute("aria-label", `Открыть официальный источник о городе ${city.name}`);
  }

  qsa("[data-map-city]").forEach((control) => {
    const active = control.dataset.mapCity === city.id;
    control.classList.toggle("is-active", active);
    control.setAttribute("aria-pressed", String(active));
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || !contentType.includes("application/json")) {
    throw new Error(`JSON resource unavailable: ${url}`);
  }

  return response.json();
}

async function loadMapPoints() {
  const sources = [`${PUBLIC_API_BASE_URL}/map-points`, "assets/data/map-points.json"];

  for (const source of sources) {
    try {
      const payload = await fetchJson(source);
      const items = Array.isArray(payload) ? payload : payload?.items;
      if (Array.isArray(items)) {
        return items.filter(isPublishedMapPoint);
      }
    } catch {
      // The static preview intentionally falls through to the bundled empty dataset.
    }
  }

  return [];
}

async function initMap() {
  const markerLayer = qs("[data-map-markers]");
  const map = qs("[data-region-map]");
  if (!markerLayer || !map) {
    return;
  }

  let projection = null;
  let mapPoints = [];
  try {
    [projection, mapPoints] = await Promise.all([
      fetchJson("assets/data/murmansk-map-projection.json"),
      loadMapPoints(),
    ]);
  } catch {
    map.classList.add("is-unavailable");
    return;
  }

  const markers = mapPoints.map((city) => {
    const position = projectLonLat(Number(city.longitude), Number(city.latitude), projection);
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "map-marker";
    marker.dataset.mapCity = city.id;
    marker.style.left = position.left;
    marker.style.top = position.top;
    marker.style.setProperty("--label-x", `${Number(city.labelOffsetX) || 16}px`);
    marker.style.setProperty("--label-y", `${Number(city.labelOffsetY) || -34}px`);
    const nudgeX = Number(city.nudgeX) || 0;
    const nudgeY = Number(city.nudgeY) || 0;
    const leaderX = -nudgeX;
    const leaderY = -nudgeY;
    marker.style.setProperty("--marker-x", `${nudgeX}px`);
    marker.style.setProperty("--marker-y", `${nudgeY}px`);
    marker.style.setProperty("--leader-length", `${Math.hypot(leaderX, leaderY).toFixed(2)}px`);
    marker.style.setProperty("--leader-angle", `${Math.atan2(leaderY, leaderX) * 180 / Math.PI}deg`);
    marker.style.setProperty("--leader-opacity", nudgeX || nudgeY ? "1" : "0");
    marker.setAttribute("aria-label", `Выбрать город ${city.name}`);
    marker.setAttribute("aria-pressed", "false");

    const leader = document.createElement("span");
    leader.className = "map-marker__leader";
    const anchor = document.createElement("span");
    anchor.className = "map-marker__anchor";
    const dot = document.createElement("span");
    dot.className = "map-marker__dot";
    const label = document.createElement("span");
    label.className = "map-marker__label";
    label.textContent = city.name;
    marker.append(leader, anchor, dot, label);
    marker.addEventListener("click", () => updateCityPanel(city));
    return marker;
  });

  markerLayer.replaceChildren(...markers);
  map.classList.toggle("has-points", markers.length > 0);
  map.classList.toggle("is-empty", markers.length === 0);

  const status = qs("[data-map-status]");
  if (status) {
    status.textContent = markers.length > 0
      ? `На карте: ${markers.length}`
      : "Точки подключаются из админ-панели";
  }
}

function renderSupport(key) {
  const content = supportContent[key];
  if (!content) {
    return;
  }

  state.activeSupport = key;
  const detail = qs("[data-support-detail]");
  const photo = qs("[data-support-photo]", detail);
  const mobilePhotoSource = qs("[data-support-photo-source]", detail);
  const mobilePhotoFallbackSource = qs("[data-support-photo-fallback-source]", detail);
  const desktopPhotoSource = qs("[data-support-photo-desktop-source]", detail);
  if (photo && content.media) {
    const nextSrc = content.media.src.replace(/\.webp$/i, ".png");
    desktopPhotoSource?.setAttribute("srcset", content.media.src);
    if (mobilePhotoSource) {
      if (content.media.mobileSrc) {
        mobilePhotoSource.srcset = content.media.mobileSrc;
        mobilePhotoFallbackSource?.setAttribute(
          "srcset",
          content.media.mobileSrc.replace(/\.webp$/i, ".png"),
        );
      } else {
        mobilePhotoSource.removeAttribute("srcset");
        mobilePhotoFallbackSource?.removeAttribute("srcset");
      }
    }
    photo.alt = content.media.alt;
    photo.style.setProperty("--support-position-desktop", content.media.positionDesktop);
    photo.style.setProperty("--support-position-mobile", content.media.positionMobile);

    if (!photo.getAttribute("src")?.endsWith(nextSrc)) {
      detail?.setAttribute("aria-busy", "true");
      detail?.classList.add("is-media-changing");
      detail?.classList.remove("is-media-error");
      photo.dataset.pendingSrc = nextSrc;

      const handleLoad = () => settleMedia(true);
      const handleError = () => settleMedia(false);
      const settleMedia = (loaded) => {
        photo.removeEventListener("load", handleLoad);
        photo.removeEventListener("error", handleError);
        if (photo.dataset.pendingSrc !== nextSrc) {
          return;
        }
        detail?.removeAttribute("aria-busy");
        detail?.classList.remove("is-media-changing");
        detail?.classList.toggle("is-media-error", !loaded);
        delete photo.dataset.pendingSrc;
      };

      photo.addEventListener("load", handleLoad);
      photo.addEventListener("error", handleError);
      photo.src = nextSrc;
      if (photo.complete) {
        settleMedia(photo.naturalWidth > 0);
      }
    }
  }
  qs("[data-support-eyebrow]").textContent = content.eyebrow;
  qs("[data-support-title]").textContent = content.title;
  qs("[data-support-list]").replaceChildren(...content.summary.map((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    return li;
  }));

  qsa("[data-support-tab]").forEach((tab) => {
    const active = tab.dataset.supportTab === key;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-pressed", String(active));
  });
}

function openDialog(dialog) {
  if (!dialog || typeof dialog.showModal !== "function") {
    return;
  }
  dialog.showModal();
  setBodyLock("dialog-open", true);
}

function closeDialog(dialog) {
  if (!dialog?.open) {
    return;
  }
  dialog.close();
}

function initDialogs() {
  qsa("dialog").forEach((dialog) => {
    qsa("[data-dialog-close]", dialog).forEach((button) => {
      button.addEventListener("click", () => closeDialog(dialog));
    });
    qsa("[data-dialog-apply]", dialog).forEach((link) => {
      link.addEventListener("click", () => closeDialog(dialog));
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        closeDialog(dialog);
      }
    });
    dialog.addEventListener("close", () => {
      if (!qsa("dialog[open]").length) {
        setBodyLock("dialog-open", false);
      }
    });
  });
}

function initNorthLife() {
  const section = qs("[data-north-life]");
  if (!section) {
    return;
  }
  const features = qsa("[data-life-feature]", section);
  if (!features.length) {
    return;
  }

  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    features.forEach((feature) => feature.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, {
    rootMargin: "0px 0px -12%",
    threshold: 0.12,
  });

  features.forEach((feature) => observer.observe(feature));
}

function initLegalAndCookies() {
  const privacyDialog = qs("#privacy-dialog");
  const cookieDialog = qs("#cookie-policy-dialog");
  const banner = qs("[data-cookie-banner]");
  const storageKey = "kurs-na-sever:cookie-consent:v1";

  const readConsent = () => {
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };

  const saveConsent = (value) => {
    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      // The choice still applies to the current page when storage is unavailable.
    }
    if (banner) {
      banner.hidden = true;
    }
    document.documentElement.dataset.cookieConsent = value;
  };

  qsa("[data-open-privacy]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDialog(privacyDialog);
    });
  });

  qsa("[data-open-cookie-policy], [data-open-cookie-settings]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openDialog(cookieDialog);
    });
  });

  qsa("[data-cookie-accept]").forEach((button) => {
    button.addEventListener("click", () => saveConsent("all"));
  });
  qsa("[data-cookie-essential]").forEach((button) => {
    button.addEventListener("click", () => saveConsent("necessary"));
  });

  const storedConsent = readConsent();
  if (storedConsent) {
    document.documentElement.dataset.cookieConsent = storedConsent;
  } else if (banner) {
    banner.hidden = false;
  }
}

function initSupport() {
  Object.values(supportContent).forEach(({ media }) => {
    if (!media?.src) {
      return;
    }
    [media.src, media.mobileSrc].filter(Boolean).forEach((src) => {
      const image = new Image();
      image.src = src;
      if (typeof image.decode === "function") {
        image.decode().catch(() => {});
      }
    });
  });

  qsa("[data-support-tab]").forEach((tab) => {
    tab.addEventListener("click", () => renderSupport(tab.dataset.supportTab));
  });

  renderSupport(state.activeSupport);

  qs("[data-open-support-dialog]")?.addEventListener("click", () => {
    const content = supportContent[state.activeSupport];
    const dialog = qs("#support-dialog");
    qs("[data-support-dialog-eyebrow]", dialog).textContent = content.eyebrow;
    qs("[data-support-dialog-title]", dialog).textContent = content.title;
    qs("[data-support-dialog-list]", dialog).replaceChildren(...content.details.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    }));
    openDialog(dialog);
  });
}

async function initStories() {
  const section = qs("#stories");
  if (!section) {
    return;
  }
  const feed = qs("[data-story-feed]", section);
  if (!feed) {
    return;
  }
  const slots = qsa("[data-story-slot]", feed);
  const filters = qsa("[data-story-filter]");
  const dialog = qs("#story-dialog");
  const filterStatus = qs("[data-story-filter-status]", section);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  try {
    const managedStories = await apiClient.getStories();
    managedStories.suppressedIds.forEach((storyId) => {
      delete storyContent[storyId];
    });
    managedStories.items.forEach((story) => {
      if (["__proto__", "prototype", "constructor"].includes(story.id)) return;
      storyContent[story.id] = {
        ...story,
        tone: `story-message--${story.tone}`,
      };
    });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.warn("Не удалось обновить истории из CRM; используется встроенный реестр.", error);
    }
  }

  const stories = Object.values(storyContent);
  const preferredStoryIds = ["family", "dog", "student", "doctor"];
  const initialStoryIds = [
    ...preferredStoryIds.filter((storyId) => storyContent[storyId]),
    ...stories.map((story) => story.id).filter((storyId) => !preferredStoryIds.includes(storyId)),
  ].slice(0, 4);
  let activeFilter = "all";
  let timerId = null;
  let rotationBag = [];
  let lastSlotIndex = -1;
  let renderEpoch = 0;
  let pointerPaused = false;
  let focusPaused = false;
  let sectionVisible = true;

  if (!slots.length || !dialog) {
    return;
  }

  const shuffle = (items) => {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  };

  const getEligibleStories = () => stories.filter((story) => (
    activeFilter === "all" || story.filters.includes(activeFilter)
  ));

  const getVisibleStoryIds = () => slots
    .filter((slot) => !slot.hidden)
    .map((slot) => qs("[data-story]", slot)?.dataset.story)
    .filter(Boolean);

  const createStoryCard = (story) => {
    const button = document.createElement("button");
    button.className = ["story-message", story.tone].filter(Boolean).join(" ");
    button.type = "button";
    button.dataset.story = story.id;
    button.dataset.storyTags = story.filters.join(",");
    button.setAttribute("aria-label", story.ariaLabel);

    const avatarWrap = document.createElement("span");
    avatarWrap.className = "story-message__avatar";
    const avatar = document.createElement("img");
    avatar.src = story.avatar;
    avatar.alt = story.avatarAlt;
    avatar.width = 640;
    avatar.height = 640;
    avatar.loading = "lazy";
    avatar.decoding = "async";
    avatarWrap.append(avatar, document.createElement("i"));
    avatarWrap.lastElementChild.setAttribute("aria-hidden", "true");

    const bubble = document.createElement("span");
    bubble.className = "story-message__bubble";
    const meta = document.createElement("span");
    meta.className = "story-message__meta";
    const person = document.createElement("strong");
    person.textContent = story.person;
    const route = document.createElement("small");
    route.textContent = story.route;
    meta.append(person, route);

    const quote = document.createElement("span");
    quote.className = "story-message__quote";
    quote.textContent = `«${story.cardQuote || story.quote}»`;

    const tags = document.createElement("span");
    tags.className = "story-message__tags";
    story.cardTags.forEach((tag) => {
      const item = document.createElement("i");
      item.textContent = tag;
      tags.append(item);
    });

    const action = document.createElement("span");
    action.className = "story-message__time";
    action.append("Читать историю ");
    const arrow = document.createElement("img");
    arrow.src = "assets/icons/arrow-right.svg";
    arrow.alt = "";
    arrow.setAttribute("aria-hidden", "true");
    action.append(arrow);

    bubble.append(meta, quote, tags, action);
    button.append(avatarWrap, bubble);
    return button;
  };

  const renderStoryDialog = (storyKey) => {
    const story = storyContent[storyKey];
    if (!story) {
      return;
    }

    dialog.dataset.story = storyKey;
    qs("[data-story-eyebrow]", dialog).textContent = story.eyebrow;
    qs("[data-story-title]", dialog).textContent = story.title;
    const avatar = qs("[data-story-avatar]", dialog);
    avatar.src = story.avatar;
    avatar.alt = story.avatarAlt;
    qs("[data-story-person]", dialog).textContent = story.person;
    qs("[data-story-route]", dialog).textContent = story.route;
    qs("[data-story-quote]", dialog).textContent = `«${story.quote}»`;
    qs("[data-story-tags]", dialog).replaceChildren(...story.tags.map((tag) => {
      const element = document.createElement("span");
      element.textContent = tag;
      return element;
    }));
    qs("[data-story-lead]", dialog).textContent = story.lead;
    qs("[data-story-gallery]", dialog).replaceChildren(...story.gallery.map((item) => {
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.src = item.src;
      image.alt = item.alt;
      image.loading = "lazy";
      image.decoding = "async";
      figure.append(image);
      return figure;
    }));
    qs("[data-story-steps]", dialog).replaceChildren(...story.steps.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    }));
    clearTimeout(timerId);
    openDialog(dialog);
  };

  const renderStoriesImmediately = (storyIds) => {
    renderEpoch += 1;
    slots.forEach((slot, index) => {
      const story = storyContent[storyIds[index]];
      slot.hidden = !story;
      if (story) {
        slot.replaceChildren(createStoryCard(story));
      } else {
        slot.replaceChildren();
      }
    });
  };

  const shouldPauseRotation = () => (
    pointerPaused
    || focusPaused
    || !sectionVisible
    || document.hidden
    || reducedMotion.matches
    || dialog.open
  );

  const clearRotationTimer = () => {
    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
  };

  const preloadAvatar = async (story) => {
    const image = new Image();
    image.src = story.avatar;
    if (typeof image.decode === "function") {
      await image.decode().catch(() => {});
    }
  };

  const replaceStoryInSlot = async (slotIndex, nextStory) => {
    const slot = slots[slotIndex];
    const previous = qs("[data-story]", slot);
    const epoch = renderEpoch;
    await preloadAvatar(nextStory);
    if (epoch !== renderEpoch || !previous?.isConnected) {
      return false;
    }

    const incoming = createStoryCard(nextStory);
    incoming.classList.add("story-message--entering");
    slot.append(incoming);
    incoming.getBoundingClientRect();
    previous.classList.add("story-message--leaving");
    incoming.classList.add("is-active");

    await new Promise((resolve) => window.setTimeout(resolve, 640));
    if (epoch !== renderEpoch) {
      return false;
    }
    previous.remove();
    incoming.classList.remove("story-message--entering", "is-active");
    return true;
  };

  const takeNextStoryId = () => {
    const visibleIds = new Set(getVisibleStoryIds());
    const candidates = getEligibleStories()
      .map((story) => story.id)
      .filter((id) => !visibleIds.has(id));
    if (!candidates.length) {
      return null;
    }
    const candidateSet = new Set(candidates);
    rotationBag = rotationBag.filter((id) => candidateSet.has(id));
    if (!rotationBag.length) {
      rotationBag = shuffle(candidates);
    }
    return rotationBag.shift() || null;
  };

  const scheduleRotation = () => {
    clearRotationTimer();
    if (shouldPauseRotation()) {
      feed.dataset.rotationState = "paused";
      return;
    }
    if (getEligibleStories().length <= getVisibleStoryIds().length) {
      feed.dataset.rotationState = "idle";
      return;
    }
    const delay = 5000;
    feed.dataset.rotationDelay = String(delay);
    feed.dataset.rotationState = "scheduled";
    timerId = window.setTimeout(async () => {
      timerId = null;
      if (shouldPauseRotation()) {
        scheduleRotation();
        return;
      }
      const nextStoryId = takeNextStoryId();
      if (!nextStoryId) {
        scheduleRotation();
        return;
      }
      const availableSlots = slots
        .map((slot, index) => (!slot.hidden ? index : -1))
        .filter((index) => index >= 0 && (slots.length === 1 || index !== lastSlotIndex));
      const slotIndex = availableSlots[Math.floor(Math.random() * availableSlots.length)] ?? 0;
      feed.dataset.rotationState = "animating";
      const replaced = await replaceStoryInSlot(slotIndex, storyContent[nextStoryId]);
      if (replaced) {
        lastSlotIndex = slotIndex;
      }
      scheduleRotation();
    }, delay);
  };

  const applyFilter = (value, { announce = true } = {}) => {
    activeFilter = value;
    rotationBag = [];
    lastSlotIndex = -1;
    filters.forEach((filter) => {
      const active = filter.dataset.storyFilter === value;
      filter.classList.toggle("is-active", active);
      filter.setAttribute("aria-pressed", String(active));
    });
    const eligible = getEligibleStories();
    const preferredIds = value === "all"
      ? initialStoryIds.filter((id) => eligible.some((story) => story.id === id))
      : eligible.map((story) => story.id);
    renderStoriesImmediately(preferredIds.slice(0, slots.length));
    if (announce && filterStatus) {
      filterStatus.textContent = `Найдено историй: ${eligible.length}.`;
    }
    scheduleRotation();
  };

  filters.forEach((filter) => {
    filter.addEventListener("click", () => applyFilter(filter.dataset.storyFilter || "all"));
  });

  feed.addEventListener("click", (event) => {
    const button = event.target.closest("[data-story]");
    if (button && feed.contains(button)) {
      renderStoryDialog(button.dataset.story);
    }
  });

  feed.addEventListener("pointerenter", () => {
    pointerPaused = true;
    scheduleRotation();
  });
  feed.addEventListener("pointerleave", () => {
    pointerPaused = false;
    scheduleRotation();
  });
  feed.addEventListener("focusin", () => {
    focusPaused = true;
    scheduleRotation();
  });
  feed.addEventListener("focusout", () => {
    window.requestAnimationFrame(() => {
      focusPaused = feed.contains(document.activeElement);
      scheduleRotation();
    });
  });

  dialog.addEventListener("close", scheduleRotation);
  document.addEventListener("visibilitychange", scheduleRotation);
  if (typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", scheduleRotation);
  } else {
    reducedMotion.addListener?.(scheduleRotation);
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(([entry]) => {
      sectionVisible = entry.isIntersecting && entry.intersectionRatio >= 0.2;
      scheduleRotation();
    }, { threshold: [0, 0.2, 0.6] });
    observer.observe(section);
  }

  if (dialog) {
    qs("[data-story-apply]", dialog)?.addEventListener("click", () => {
      const storyKey = dialog.dataset.story || "family";
      prefillApplication({
        applicantType: storyKey === "student" ? "student" : "relocation",
        source: `story-${storyKey}`,
      });
    });
  }

  applyFilter("all", { announce: false });
}

function initResumeBuilder() {
  const dialog = qs("#resume-dialog");
  const form = qs("[data-resume-form]", dialog);
  if (!dialog || !form) {
    return;
  }

  const experienceList = qs("[data-resume-experience-list]", form);
  const educationList = qs("[data-resume-education-list]", form);
  const experienceTemplate = qs("#resume-experience-template");
  const educationTemplate = qs("#resume-education-template");
  const status = qs("[data-resume-status]", dialog);
  const saveButton = qs("[data-print-resume]", dialog);
  let repeatSequence = 0;
  let logoDataUrlPromise = null;

  const readExperience = () => qsa("[data-resume-experience-item]", form)
    .map((item) => ({
      position: qs('[name="experiencePosition"]', item)?.value.trim() || "",
      start: qs('[name="experienceStart"]', item)?.value.trim() || "",
      end: qs('[name="experienceEnd"]', item)?.value.trim() || "",
      duties: qs('[name="experienceDuties"]', item)?.value.trim() || "",
    }))
    .filter((item) => Object.values(item).some(Boolean));

  const readEducation = () => qsa("[data-resume-education-item]", form)
    .map((item) => ({
      institution: qs('[name="educationInstitution"]', item)?.value.trim() || "",
      specialty: qs('[name="educationSpecialty"]', item)?.value.trim() || "",
      year: qs('[name="educationYear"]', item)?.value.trim() || "",
    }))
    .filter((item) => Object.values(item).some(Boolean));

  const createPreviewEntry = ({ title, meta, text }) => {
    const article = document.createElement("article");
    const head = document.createElement("div");
    const strong = document.createElement("strong");
    const span = document.createElement("span");
    strong.textContent = title;
    span.textContent = meta;
    head.append(strong, span);
    article.append(head);
    if (text) {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      article.append(paragraph);
    }
    return article;
  };

  const syncPreview = () => {
    const fullName = form.elements.fullName?.value.trim() || "";
    const role = form.elements.role?.value.trim() || "";
    const contact = form.elements.contact?.value.trim() || "";
    const summary = form.elements.summary?.value.trim() || "";
    qs("[data-resume-preview-name]", dialog).textContent = fullName || "Ваше имя";
    qs("[data-resume-preview-role]", dialog).textContent = role || "Желаемая должность";
    qs("[data-resume-preview-contact]", dialog).textContent = contact || "Контакты";
    qs("[data-resume-preview-summary]", dialog).textContent = summary
      || "Коротко расскажите о сильных сторонах и профессиональном фокусе.";

    const experience = readExperience();
    const experiencePreview = qs("[data-resume-preview-experience-list]", dialog);
    experiencePreview.replaceChildren(...(experience.length
      ? experience.map((item) => createPreviewEntry({
          title: item.position || "Должность",
          meta: [item.start, item.end].filter(Boolean).join(" — "),
          text: item.duties,
        }))
      : [Object.assign(document.createElement("p"), { textContent: "Добавьте место работы, должность и обязанности." })]));

    const education = readEducation();
    const educationPreview = qs("[data-resume-preview-education-list]", dialog);
    educationPreview.replaceChildren(...(education.length
      ? education.map((item) => createPreviewEntry({
          title: item.institution || "Учебное заведение",
          meta: item.year,
          text: item.specialty,
        }))
      : [Object.assign(document.createElement("p"), { textContent: "Добавьте учебное заведение и специальность." })]));
  };

  const updateRemoveButtons = () => {
    ["experience", "education"].forEach((type) => {
      const items = qsa(`[data-resume-${type}-item]`, form);
      items.forEach((item) => {
        const remove = qs("[data-remove-resume-item]", item);
        remove.hidden = items.length === 1;
      });
    });
  };

  const appendRepeatItem = (type, { focus = false } = {}) => {
    const template = type === "experience" ? experienceTemplate : educationTemplate;
    const list = type === "experience" ? experienceList : educationList;
    if (!template || !list) {
      return;
    }

    repeatSequence += 1;
    const fragment = template.content.cloneNode(true);
    const item = fragment.firstElementChild;
    qsa("input, textarea", item).forEach((control, index) => {
      const id = `resume-${type}-${repeatSequence}-${index}`;
      control.id = id;
      control.previousElementSibling?.setAttribute("for", id);
      if (control.inputMode === "numeric") {
        control.addEventListener("input", () => {
          control.value = control.value.replace(/\D/g, "").slice(0, 4);
        });
      }
    });
    qs("[data-remove-resume-item]", item)?.addEventListener("click", () => {
      const addButton = qs(type === "experience" ? "[data-add-experience]" : "[data-add-education]", form);
      item.remove();
      updateRemoveButtons();
      syncPreview();
      addButton?.focus();
      status.textContent = type === "experience"
        ? "Место работы удалено."
        : "Образование удалено.";
    });
    list.append(item);
    updateRemoveButtons();
    syncPreview();
    if (focus) {
      const firstControl = qs("input, textarea", item);
      firstControl?.focus();
      status.textContent = type === "experience"
        ? "Добавлено ещё одно место работы."
        : "Добавлено ещё одно образование.";
    }
  };

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsDataURL(blob);
  });

  const loadResumeLogo = () => {
    if (!logoDataUrlPromise) {
      const url = new URL("../assets/images/logo-na-severe-zhit-black.png", import.meta.url);
      logoDataUrlPromise = fetch(url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Logo request failed: ${response.status}`);
          }
          return response.blob();
        })
        .then(blobToDataUrl)
        .catch((error) => {
          logoDataUrlPromise = null;
          throw error;
        });
    }
    return logoDataUrlPromise;
  };

  const pdfText = (value, fallback = "Не указано") => value || fallback;

  const buildResumeDefinition = (logoDataUrl) => {
    const fullName = form.elements.fullName.value.trim();
    const role = form.elements.role.value.trim();
    const contact = form.elements.contact.value.trim();
    const summary = form.elements.summary.value.trim();
    const experience = readExperience();
    const education = readEducation();
    const siteUrl = "https://kursnasever.ru";

    const sectionTitle = (text) => ({
      text: text.toUpperCase(),
      color: "#00588D",
      bold: true,
      fontSize: 10,
      characterSpacing: 1.4,
      margin: [0, 22, 0, 9],
    });

    return {
      pageSize: "A4",
      pageMargins: [48, 48, 48, 76],
      defaultStyle: { font: "Roboto", color: "#17344B", fontSize: 10.5, lineHeight: 1.25 },
      watermark: { text: "КУРС НА СЕВЕР", color: "#71C4EF", opacity: 0.045, bold: true, angle: -24 },
      content: [
        {
          columns: [
            { image: logoDataUrl, width: 92, margin: [0, 0, 0, 20] },
            { text: "РЕЗЮМЕ УЧАСТНИКА", alignment: "right", color: "#0070B3", bold: true, fontSize: 9, characterSpacing: 1.8, margin: [0, 8, 0, 0] },
          ],
        },
        { text: fullName, style: "name" },
        { text: role, style: "role" },
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 3, lineColor: "#EA5B13" }], margin: [0, 14, 0, 14] },
        { text: pdfText(contact, "Контакты не указаны"), color: "#536E81", fontSize: 10 },
        ...(summary ? [sectionTitle("Профессиональный профиль"), { text: summary }] : []),
        sectionTitle("Опыт работы"),
        ...(experience.length ? experience.flatMap((item, index) => ([
          {
            columns: [
              { text: pdfText(item.position, "Должность"), bold: true, color: "#082F49", fontSize: 12 },
              { text: [item.start, item.end].filter(Boolean).join(" — "), alignment: "right", color: "#0070B3", fontSize: 9 },
            ],
            margin: [0, index ? 13 : 0, 0, 4],
          },
          ...(item.duties ? [{ text: item.duties, color: "#435F73" }] : []),
        ])) : [{ text: "Опыт работы не указан.", color: "#6D8291", italics: true }]),
        sectionTitle("Образование"),
        ...(education.length ? education.flatMap((item, index) => ([
          {
            columns: [
              { text: pdfText(item.institution, "Учебное заведение"), bold: true, color: "#082F49", fontSize: 12 },
              { text: item.year, alignment: "right", color: "#0070B3", fontSize: 9 },
            ],
            margin: [0, index ? 13 : 0, 0, 4],
          },
          ...(item.specialty ? [{ text: item.specialty, color: "#435F73" }] : []),
        ])) : [{ text: "Образование не указано.", color: "#6D8291", italics: true }]),
      ],
      footer: () => ({
        margin: [48, 0, 48, 14],
        stack: [
          { canvas: [{ type: "line", x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 0.8, lineColor: "#B9DCEA" }], margin: [0, 0, 0, 8] },
          {
            columns: [
              { text: "КУРС НА СЕВЕР", color: "#B9DCEA", bold: true, fontSize: 15, characterSpacing: 1.3, margin: [0, 7, 0, 0] },
              { text: "Вакансии · поддержка · переезд", alignment: "center", color: "#637F90", fontSize: 8, margin: [0, 10, 0, 0] },
              { qr: siteUrl, fit: 34, alignment: "right", foreground: "#00588D", background: "#FFFFFF" },
            ],
          },
        ],
      }),
      styles: {
        name: { fontSize: 26, bold: true, color: "#00588D", lineHeight: 1.05 },
        role: { fontSize: 14, bold: true, color: "#0070B3", margin: [0, 6, 0, 0] },
      },
      info: {
        title: `Резюме — ${fullName}`,
        subject: "Резюме для проекта «Курс на Север»",
        author: fullName,
        creator: "Курс на Север",
      },
    };
  };

  const saveResumePdf = async () => {
    if (!form.reportValidity()) {
      status.textContent = "Заполните имя и желаемую должность.";
      return;
    }
    if (!window.pdfMake?.createPdf) {
      status.textContent = "Модуль PDF не загрузился. Обновите страницу и попробуйте ещё раз.";
      return;
    }

    saveButton.disabled = true;
    status.textContent = "Собираем брендированный PDF…";
    try {
      const logoDataUrl = await loadResumeLogo();
      const definition = buildResumeDefinition(logoDataUrl);
      const safeName = (form.elements.fullName.value.trim() || "resume")
        .toLocaleLowerCase("ru-RU")
        .replace(/[^a-zа-яё0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "");
      const filename = `kurs-na-sever-${safeName || "resume"}.pdf`;
      const blob = await new Promise((resolve, reject) => {
        try {
          window.pdfMake.createPdf(definition).getBlob(resolve);
        } catch (error) {
          reject(error);
        }
      });
      const resumeFile = new File([blob], filename, {
        type: "application/pdf",
        lastModified: Date.now(),
      });
      setResumeAttachment(resumeFile, "builder");

      const downloadUrl = URL.createObjectURL(blob);
      const download = document.createElement("a");
      download.href = downloadUrl;
      download.download = filename;
      download.hidden = true;
      document.body.append(download);
      download.click();
      download.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      status.textContent = "PDF готов, скачан и прикреплён к заявке.";
    } catch {
      status.textContent = "Не удалось собрать PDF. Попробуйте ещё раз.";
    } finally {
      saveButton.disabled = false;
    }
  };

  form.addEventListener("input", syncPreview);
  qs("[data-add-experience]", form)?.addEventListener("click", () => appendRepeatItem("experience", { focus: true }));
  qs("[data-add-education]", form)?.addEventListener("click", () => appendRepeatItem("education", { focus: true }));
  qsa("[data-open-resume]").forEach((button) => {
    button.addEventListener("click", () => openDialog(dialog));
  });
  saveButton?.addEventListener("click", () => {
    syncPreview();
    saveResumePdf();
  });
  appendRepeatItem("experience");
  appendRepeatItem("education");
  syncPreview();
}

function normalizePhone(value) {
  let digits = value.replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits[0] === "8") {
    digits = `7${digits.slice(1)}`;
  }
  if (digits[0] !== "7") {
    digits = `7${digits}`;
  }
  digits = digits.slice(0, 11);
  const chunks = [
    digits.slice(1, 4),
    digits.slice(4, 7),
    digits.slice(7, 9),
    digits.slice(9, 11),
  ];
  let result = "+7";
  if (chunks[0]) {
    result += ` (${chunks[0]}`;
    if (chunks[0].length === 3) {
      result += ")";
    }
  }
  if (chunks[1]) {
    result += ` ${chunks[1]}`;
  }
  if (chunks[2]) {
    result += `-${chunks[2]}`;
  }
  if (chunks[3]) {
    result += `-${chunks[3]}`;
  }
  return result;
}

function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function calculateAge(date, today = new Date()) {
  return calculateAgeOn(date, today);
}

function getFieldControls(form, fieldName) {
  if (fieldName === "birthdate") {
    return ["birth-day", "birth-month", "birth-year"]
      .map((id) => qs(`#${id}`, form))
      .filter(Boolean);
  }
  if (fieldName === "applicantType") {
    return qsa('input[name="applicantType"]', form);
  }
  const control = qs(`#${fieldName}`, form);
  return control ? [control] : [];
}

function setFieldError(form, fieldName, message) {
  const controls = getFieldControls(form, fieldName);
  const control = controls[0];
  const error = qs(`[data-error-for="${fieldName}"]`, form);
  control?.closest(".field, .consent")?.classList.toggle("is-invalid", Boolean(message));
  if (error) {
    error.id ||= `${fieldName}-error`;
    error.textContent = message || "";
  }
  controls.forEach((currentControl) => {
    if (message) {
      currentControl.setAttribute("aria-invalid", "true");
      const describedBy = new Set((currentControl.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      if (error?.id) {
        describedBy.add(error.id);
      }
      currentControl.setAttribute("aria-describedby", [...describedBy].join(" "));
    } else {
      currentControl.removeAttribute("aria-invalid");
      const describedBy = (currentControl.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((id) => id && id !== error?.id);
      if (describedBy.length) {
        currentControl.setAttribute("aria-describedby", describedBy.join(" "));
      } else {
        currentControl.removeAttribute("aria-describedby");
      }
    }
  });
}

function clearErrors(form) {
  qsa("[data-error-for]", form).forEach((error) => {
    setFieldError(form, error.dataset.errorFor, "");
  });
}

const formStepOneFields = new Set(["applicantType", "surname", "name", "middlename", "birthdate", "email", "phone"]);

function focusFirstError(form, errors) {
  const first = errors.find((error) => getFieldControls(form, error.field).length);
  if (!first) {
    return;
  }
  requestAnimationFrame(() => {
    const control = getFieldControls(form, first.field)[0];
    control?.focus({ preventScroll: true });
    control?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

const studentBaseFieldNames = [
  "studentInstitution",
  "studentSpecialty",
  "graduationYear",
  "studentStatus",
];

const studentPracticeFieldNames = [
  "practiceStart",
  "practiceEnd",
];

const studentFieldNames = [...studentBaseFieldNames, ...studentPracticeFieldNames];

function getApplicantType(form) {
  return qs('input[name="applicantType"]:checked', form)?.value === "student"
    ? "student"
    : "relocation";
}

function updateStudentPracticeFields(form) {
  const studentMode = getApplicantType(form) === "student";
  const graduated = qs("#studentStatus", form)?.value === "graduated";

  qsa("[data-practice-field]", form).forEach((field) => {
    field.hidden = studentMode && graduated;
    qsa("input, select, textarea", field).forEach((control) => {
      control.disabled = !studentMode || graduated;
      control.required = studentMode && !graduated;
      if (graduated) {
        control.value = "";
      }
    });
  });

  if (graduated) {
    studentPracticeFieldNames.forEach((fieldName) => setFieldError(form, fieldName, ""));
  }
}

function setApplicantTypeMode(form, type) {
  const studentMode = type === "student";
  const selected = qs(`input[name="applicantType"][value="${studentMode ? "student" : "relocation"}"]`, form);
  if (selected) {
    selected.checked = true;
  }

  qsa("[data-relocation-field]", form).forEach((field) => {
    field.hidden = studentMode;
    qsa("input, select, textarea", field).forEach((control) => {
      control.disabled = studentMode;
      control.required = !studentMode && ["sphere", "wishPost"].includes(control.id);
    });
  });

  const studentFields = qs("[data-student-fields]", form);
  if (studentFields) {
    studentFields.hidden = !studentMode;
    qsa("input, select, textarea", studentFields).forEach((control) => {
      control.disabled = !studentMode;
      control.required = studentMode && studentFieldNames.includes(control.id);
    });
  }

  updateStudentPracticeFields(form);

  const regionLabel = qs("[data-region-label]", form);
  const region = qs("#region", form);
  if (regionLabel) {
    regionLabel.textContent = studentMode ? "Регион обучения" : "Регион проживания";
  }
  if (region) {
    region.placeholder = studentMode
      ? "Начните вводить регион обучения"
      : "Начните вводить регион";
  }

  const birthdateHint = qs("#birthdate-hint", form);
  if (birthdateHint) {
    birthdateHint.textContent = studentMode
      ? "Участие в студенческом маршруте — с 16 лет"
      : "Маршрут трудоустройства и переезда — с 18 лет";
  }

  ["sphere", "wishPost", "wishSalary", ...studentFieldNames].forEach((fieldName) => {
    setFieldError(form, fieldName, "");
  });
}

function initBirthdateInput(form) {
  const inputs = [
    { control: qs("#birth-day", form), width: 2 },
    { control: qs("#birth-month", form), width: 2 },
    { control: qs("#birth-year", form), width: 4 },
  ];
  const hidden = qs("#birthdate", form);
  if (!hidden || inputs.some(({ control }) => !control)) {
    return { sync() {} };
  }

  const sync = () => {
    const [day, month, year] = inputs.map(({ control }) => control.value);
    if (day.length !== 2 || month.length !== 2 || year.length !== 4) {
      hidden.value = "";
      return;
    }
    const value = `${year}-${month}-${day}`;
    hidden.value = parseDate(value) ? value : "";
    if (hidden.value) {
      setFieldError(form, "birthdate", "");
    }
  };

  inputs.forEach(({ control, width }, index) => {
    control.addEventListener("input", () => {
      control.value = control.value.replace(/\D/g, "").slice(0, width);
      sync();
      if (control.value.length === width && inputs[index + 1]) {
        inputs[index + 1].control.focus();
      }
    });

    control.addEventListener("paste", (event) => {
      const pasted = event.clipboardData?.getData("text").trim() || "";
      const localDate = pasted.match(/^(\d{1,2})[.\/\-\s](\d{1,2})[.\/\-\s](\d{4})$/);
      const isoDate = pasted.match(/^(\d{4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})$/);
      if (localDate || isoDate) {
        event.preventDefault();
        const day = localDate ? localDate[1] : isoDate[3];
        const month = localDate ? localDate[2] : isoDate[2];
        const year = localDate ? localDate[3] : isoDate[1];
        inputs[0].control.value = day.padStart(2, "0");
        inputs[1].control.value = month.padStart(2, "0");
        inputs[2].control.value = year;
        sync();
        inputs[2].control.focus();
        return;
      }

      const digits = pasted.replace(/\D/g, "");
      if (digits.length === 8) {
        event.preventDefault();
        inputs[0].control.value = digits.slice(0, 2);
        inputs[1].control.value = digits.slice(2, 4);
        inputs[2].control.value = digits.slice(4, 8);
        sync();
        inputs[2].control.focus();
        return;
      }
      if (!digits) {
        return;
      }
      event.preventDefault();
      let offset = 0;
      for (let partIndex = index; partIndex < inputs.length && offset < digits.length; partIndex += 1) {
        const part = inputs[partIndex];
        part.control.value = digits.slice(offset, offset + part.width);
        offset += part.width;
      }
      sync();
      const nextEmpty = inputs.find(({ control: partControl }) => partControl.value.length === 0);
      (nextEmpty?.control || inputs.at(-1).control).focus();
    });

    control.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !control.value && inputs[index - 1]) {
        inputs[index - 1].control.focus();
      }
      if (event.key === "ArrowLeft" && control.selectionStart === 0 && inputs[index - 1]) {
        event.preventDefault();
        inputs[index - 1].control.focus();
      }
      if (event.key === "ArrowRight" && control.selectionStart === control.value.length && inputs[index + 1]) {
        event.preventDefault();
        inputs[index + 1].control.focus();
      }
    });

    control.addEventListener("blur", () => {
      if (index < 2 && control.value.length === 1) {
        control.value = control.value.padStart(2, "0");
      }
      sync();
    });
  });

  sync();
  return { sync };
}

function normalizeRegionSearch(value) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function initRegionCombobox(form) {
  const input = qs("#region", form);
  const listbox = qs("#region-options", form);
  if (!input || !listbox) {
    return { reset() {} };
  }

  let regions = [];
  let visibleRegions = [];
  let activeIndex = -1;
  let renderId = 0;
  input.dataset.regionsLoaded = "loading";

  const setExpanded = (expanded) => {
    input.setAttribute("aria-expanded", String(expanded));
    listbox.hidden = !expanded;
    if (!expanded) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
    }
  };

  const updateValidity = () => {
    const normalizedValue = normalizeRegionSearch(input.value);
    const exact = regions.find((region) => normalizeRegionSearch(region) === normalizedValue);
    input.dataset.regionValid = String(Boolean(exact));
    return exact || null;
  };

  const selectRegion = (region) => {
    input.value = region;
    input.dataset.regionValid = "true";
    setFieldError(form, "region", "");
    setExpanded(false);
    input.focus();
  };

  const render = (query = input.value) => {
    if (!regions.length) {
      setExpanded(false);
      return;
    }

    const normalizedQuery = normalizeRegionSearch(query);
    visibleRegions = regions
      .map((region) => ({ region, normalized: normalizeRegionSearch(region) }))
      .filter(({ normalized }) => !normalizedQuery || normalized.includes(normalizedQuery))
      .sort((a, b) => {
        const aStarts = a.normalized.startsWith(normalizedQuery) ? 0 : 1;
        const bStarts = b.normalized.startsWith(normalizedQuery) ? 0 : 1;
        return aStarts - bStarts || a.region.localeCompare(b.region, "ru");
      })
      .slice(0, 12)
      .map(({ region }) => region);

    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    renderId += 1;

    if (!visibleRegions.length) {
      const empty = document.createElement("li");
      empty.className = "region-combobox__empty";
      empty.textContent = "Регион не найден";
      empty.setAttribute("aria-disabled", "true");
      listbox.replaceChildren(empty);
      setExpanded(true);
      return;
    }

    const options = visibleRegions.map((region, index) => {
      const option = document.createElement("li");
      option.id = `region-option-${renderId}-${index}`;
      option.className = "region-combobox__option";
      option.dataset.region = region;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = region;
      return option;
    });
    listbox.replaceChildren(...options);
    setExpanded(true);
  };

  const setActive = (index) => {
    if (!visibleRegions.length) {
      return;
    }
    activeIndex = (index + visibleRegions.length) % visibleRegions.length;
    qsa('[role="option"]', listbox).forEach((option, optionIndex) => {
      const active = optionIndex === activeIndex;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", String(active));
      if (active) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    });
  };

  input.addEventListener("focus", () => render());
  input.addEventListener("input", () => {
    updateValidity();
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (listbox.hidden) {
        render();
      }
      setActive(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (listbox.hidden) {
        render();
      }
      setActive(activeIndex < 0 ? visibleRegions.length - 1 : activeIndex - 1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectRegion(visibleRegions[activeIndex]);
    } else if (event.key === "Escape") {
      setExpanded(false);
    }
  });
  input.addEventListener("blur", () => {
    const exact = updateValidity();
    if (exact) {
      input.value = exact;
    }
    window.setTimeout(() => setExpanded(false), 120);
  });

  listbox.addEventListener("pointerdown", (event) => {
    const option = event.target.closest("[data-region]");
    if (!option) {
      return;
    }
    event.preventDefault();
    selectRegion(option.dataset.region);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".region-combobox")) {
      setExpanded(false);
    }
  });

  fetch(new URL("../assets/data/regions.json", import.meta.url), { credentials: "same-origin" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Region dictionary request failed: ${response.status}`);
      }
      return response.json();
    })
    .then((items) => {
      regions = Array.isArray(items)
        ? items.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
        : [];
      input.dataset.regionsLoaded = "ready";
      updateValidity();
      if (document.activeElement === input) {
        render();
      }
    })
    .catch(() => {
      input.dataset.regionsLoaded = "error";
      input.dataset.regionValid = "false";
    });

  return {
    reset() {
      input.value = "";
      input.dataset.regionValid = "false";
      setExpanded(false);
    },
  };
}

function validateFormStep(form, step) {
  const applicantType = getApplicantType(form);
  const studentStatus = qs("#studentStatus", form)?.value || "";
  const required = step === 1
    ? ["surname", "name", "birthdate", "email", "phone"]
    : applicantType === "student"
      ? [
          "region",
          ...studentBaseFieldNames,
          ...(studentStatus === "graduated" ? [] : studentPracticeFieldNames),
          "agreeTerms",
        ]
      : ["region", "sphere", "wishPost", "agreeTerms"];
  const errors = [];

  required.forEach((name) => {
    const control = qs(`#${name}`, form);
    const value = control?.type === "checkbox" ? control.checked : control?.value.trim();
    if (!value) {
      const hasPartialBirthdate = name === "birthdate"
        && ["birth-day", "birth-month", "birth-year"].some((id) => qs(`#${id}`, form)?.value);
      errors.push({
        field: name,
        message: hasPartialBirthdate ? "Проверьте дату рождения." : "Заполните обязательное поле.",
      });
    }
  });

  const birthdate = qs("#birthdate", form)?.value;
  if (birthdate) {
    const date = parseDate(birthdate);
    const age = date ? calculateAge(date) : -1;
    const minimumAge = minimumAgeFor(applicantType);
    if (!date) {
      errors.push({ field: "birthdate", message: "Проверьте дату рождения." });
    } else if (age < minimumAge) {
      errors.push({
        field: "birthdate",
        message: `Для выбранного маршрута минимальный возраст — ${minimumAge} лет.`,
      });
    }
  }

  const region = qs("#region", form);
  if (
    step === 2
    && region?.value.trim()
    && region.dataset.regionsLoaded !== "ready"
  ) {
    errors.push({
      field: "region",
      message: region.dataset.regionsLoaded === "error"
        ? "Не удалось загрузить справочник регионов. Обновите страницу."
        : "Справочник регионов ещё загружается. Попробуйте снова через секунду.",
    });
  } else if (
    step === 2
    && region?.value.trim()
    && region.dataset.regionValid !== "true"
  ) {
    errors.push({ field: "region", message: "Выберите регион из списка." });
  }

  if (step === 2 && applicantType === "student") {
    const graduationYear = qs("#graduationYear", form)?.value.trim() || "";
    const latestYear = new Date().getFullYear() + 10;
    if (graduationYear && (!/^\d{4}$/.test(graduationYear) || Number(graduationYear) < 1950 || Number(graduationYear) > latestYear)) {
      errors.push({ field: "graduationYear", message: `Введите год от 1950 до ${latestYear}.` });
    }

    const practiceStart = qs("#practiceStart", form)?.value || "";
    const practiceEnd = qs("#practiceEnd", form)?.value || "";
    if (practiceStart && practiceEnd && practiceEnd < practiceStart) {
      errors.push({ field: "practiceEnd", message: "Дата окончания должна быть позже даты начала." });
    }
  }

  const email = qs("#email", form)?.value.trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.push({ field: "email", message: "Проверьте адрес электронной почты." });
  }

  const phone = qs("#phone", form)?.value.replace(/\D/g, "") || "";
  if (phone && phone.length !== 11) {
    errors.push({ field: "phone", message: "Введите номер полностью." });
  }

  const salary = qs("#wishSalary", form)?.value.trim() || "";
  if (step === 2 && applicantType === "relocation" && salary && !/^\d+$/.test(salary)) {
    errors.push({ field: "wishSalary", message: "Укажите доход только цифрами." });
  }

  const file = state.resumeAttachment.file || qs("#resume", form)?.files?.[0];
  if (step === 2 && !file && !state.resumeFileId) {
    errors.push({ field: "resume", message: "Прикрепите резюме или соберите его на сайте." });
  }
  if (file && file.size > 10 * 1024 * 1024) {
    errors.push({ field: "resume", message: "Размер файла не должен превышать 10 МБ." });
  }

  return errors;
}

function updateFormStep(form, step) {
  state.formStep = step;
  qsa("[data-form-step]", form).forEach((panel) => {
    const active = Number(panel.dataset.formStep) === step;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
  qsa("[data-form-step-button]", form).forEach((button) => {
    const active = Number(button.dataset.formStepButton) === step;
    button.classList.toggle("is-active", active);
    if (active) {
      button.setAttribute("aria-current", "step");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  qs("#form-step-status", form).textContent = `Шаг ${step} из 2`;
  qs("#form-back", form).hidden = step === 1;
  qs("#form-next", form).hidden = step === 2;
  qs("#form-submit", form).hidden = step === 1;
}

function showFormFeedback(form, message, type) {
  const feedback = qs("#form-feedback", form);
  feedback.hidden = false;
  feedback.className = `form-feedback is-${type}`;
  feedback.textContent = message;
}

function hideFormFeedback(form) {
  const feedback = qs("#form-feedback", form);
  feedback.hidden = true;
  feedback.className = "form-feedback";
  feedback.textContent = "";
}

function collectUTM() {
  const search = new URLSearchParams(window.location.search);
  return ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
    .reduce((result, key) => {
      if (search.get(key)) {
        result[key] = search.get(key).slice(0, 300);
      }
      return result;
    }, {});
}

function collectClickIds() {
  const search = new URLSearchParams(window.location.search);
  return [
    ["yclid", "yclid"],
    ["gclid", "gclid"],
    ["vk_click_id", "vkClickId"],
  ].reduce((result, [queryKey, contractKey]) => {
    const value = search.get(queryKey);
    if (value) result[contractKey] = value.slice(0, 512);
    return result;
  }, {});
}

function collectSubmissionMeta(submittedAt) {
  const consentState = document.documentElement.dataset.cookieConsent;
  const utm = collectUTM();
  const clickIds = collectClickIds();
  const landingUrl = window.location.href.slice(0, 2_048);
  return {
    source: "web",
    entryPoint: { ...state.applicationContext },
    utm,
    timestamp: submittedAt,
    ...(consentState === "necessary" || consentState === "all" ? { consentState } : {}),
    landing: {
      host: window.location.hostname.slice(0, 253),
      path: `${window.location.pathname}${window.location.search}`.slice(0, 2_048),
      url: landingUrl,
    },
    attribution: {
      lastTouch: {
        capturedAt: submittedAt,
        landingUrl,
        referrer: document.referrer.slice(0, 2_048),
        utm,
        clickIds,
      },
    },
  };
}

async function loadSpheres(select) {
  let items = [];
  try {
    items = await apiClient.getSpheres();
  } catch {
    try {
      const registry = await fetchJson(new URL("../assets/data/spheres.json", import.meta.url));
      items = Array.isArray(registry.items) ? registry.items : [];
    } catch {
      items = [];
    }
  }

  items = items.filter((item) => (item.value || item.id || item.code) !== "students");

  const currentValue = select.value;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Выберите сферу";
  select.replaceChildren(placeholder, ...items.map((item) => {
    const option = document.createElement("option");
    option.value = item.value || item.id || item.code || "";
    option.textContent = item.label || item.name || item.value;
    return option;
  }));
  select.value = currentValue === "students" ? "" : currentValue;
}

function clearApplicationVacancyContext(form, applicantType, source = "route-switch") {
  invalidateSubmitAttempt();
  const vacancyIdInput = qs("#vacancyId", form);
  const vacancySectorInput = qs("#vacancySector", form);
  const context = qs("[data-application-context]", form);

  if (vacancyIdInput) {
    vacancyIdInput.value = "";
  }
  if (vacancySectorInput) {
    vacancySectorInput.value = "";
  }
  if (context) {
    context.hidden = true;
    qs("[data-application-context-title]", context).textContent = "";
    qs("[data-application-context-meta]", context).textContent = "";
  }

  state.applicationContext = {
    source,
    vacancyId: "",
    vacancySector: "",
    role: "",
    sphere: "",
    city: "",
    applicantType,
  };
}

function prefillApplication({
  vacancyId = "",
  vacancySector = "",
  role = "",
  sphere = "",
  city = "",
  source = "direct",
  applicantType,
} = {}) {
  const form = qs("#application-form");
  if (!form) {
    return;
  }
  invalidateSubmitAttempt();

  const resolvedApplicantType = applicantType || (sphere === "students" ? "student" : "relocation");
  setApplicantTypeMode(form, resolvedApplicantType);

  if (role && resolvedApplicantType === "relocation") {
    qs("#wishPost", form).value = role;
  }
  if (sphere && sphere !== "students" && resolvedApplicantType === "relocation") {
    const select = qs("#sphere", form);
    if (qsa("option", select).some((option) => option.value === sphere)) {
      select.value = sphere;
    }
  }
  if (role && resolvedApplicantType === "student") {
    const comment = qs("#comment", form);
    comment.value = comment.value || `Интересует направление «${role}».`;
  }
  if (city) {
    const comment = qs("#comment", form);
    comment.value = comment.value || `Интересует переезд в город ${city}.`;
  }

  const vacancyIdInput = qs("#vacancyId", form);
  const vacancySectorInput = qs("#vacancySector", form);
  const context = qs("[data-application-context]", form);
  if (vacancyIdInput) {
    vacancyIdInput.value = vacancyId;
  }
  if (vacancySectorInput) {
    vacancySectorInput.value = vacancySector;
  }
  if (context) {
    context.hidden = !vacancyId;
    qs("[data-application-context-title]", context).textContent = role;
    qs("[data-application-context-meta]", context).textContent = [
      VACANCY_SECTORS[vacancySector] || "",
      city,
    ].filter(Boolean).join(" · ");
  }

  state.applicationContext = {
    source,
    vacancyId,
    vacancySector,
    role,
    sphere,
    city,
    applicantType: resolvedApplicantType,
  };
  scrollToSection("#application");
}

function initApplicationForm() {
  const form = qs("#application-form");
  if (!form) {
    return;
  }

  const phone = qs("#phone", form);
  const file = qs("#resume", form);
  const sphere = qs("#sphere", form);
  const wishSalary = qs("#wishSalary", form);
  const next = qs("#form-next", form);
  const back = qs("#form-back", form);
  const submit = qs("#form-submit", form);
  const practiceStart = qs("#practiceStart", form);
  const practiceEnd = qs("#practiceEnd", form);
  const graduationYear = qs("#graduationYear", form);
  const studentStatus = qs("#studentStatus", form);
  const birthdateInput = initBirthdateInput(form);
  const regionCombobox = initRegionCombobox(form);

  updateFormStep(form, 1);
  setApplicantTypeMode(form, getApplicantType(form));
  loadSpheres(sphere);

  qsa('input[name="applicantType"]', form).forEach((control) => {
    control.addEventListener("change", () => {
      clearErrors(form);
      const applicantType = getApplicantType(form);
      if (
        state.applicationContext.vacancyId
        && !isVacancyRouteCompatible(state.applicationContext.applicantType, applicantType)
      ) {
        clearApplicationVacancyContext(form, applicantType);
      }
      state.applicationContext.applicantType = applicantType;
      setApplicantTypeMode(form, applicantType);
    });
  });

  graduationYear?.addEventListener("input", () => {
    graduationYear.value = graduationYear.value.replace(/\D/g, "").slice(0, 4);
  });

  studentStatus?.addEventListener("change", () => {
    updateStudentPracticeFields(form);
  });

  practiceStart?.addEventListener("change", () => {
    if (practiceEnd) {
      practiceEnd.min = practiceStart.value;
    }
  });

  phone.addEventListener("input", () => {
    phone.value = normalizePhone(phone.value);
  });

  wishSalary?.addEventListener("input", () => {
    wishSalary.value = digitsOnly(wishSalary.value).slice(0, 9);
    setFieldError(form, "wishSalary", "");
  });

  file.addEventListener("change", () => {
    const selected = file.files?.[0];
    setResumeAttachment(selected || null, selected ? "upload" : "");
  });

  form.addEventListener("input", () => {
    invalidateSubmitAttempt();
    hideFormFeedback(form);
  });
  form.addEventListener("change", invalidateSubmitAttempt);

  next.addEventListener("click", () => {
    clearErrors(form);
    const errors = validateFormStep(form, 1);
    if (errors.length) {
      errors.forEach((error) => setFieldError(form, error.field, error.message));
      showFormFeedback(form, "Проверьте заполнение обязательных полей.", "error");
      focusFirstError(form, errors);
      return;
    }
    updateFormStep(form, 2);
    qs("#region", form)?.focus();
  });

  back.addEventListener("click", () => {
    clearErrors(form);
    updateFormStep(form, 1);
    qs("#surname", form)?.focus();
  });

  qsa("[data-form-step-button]", form).forEach((button) => {
    button.addEventListener("click", () => {
      const target = Number(button.dataset.formStepButton);
      if (target === 1) {
        updateFormStep(form, 1);
      } else if (target === 2) {
        const errors = validateFormStep(form, 1);
        clearErrors(form);
        if (errors.length) {
          errors.forEach((error) => setFieldError(form, error.field, error.message));
          focusFirstError(form, errors);
          return;
        }
        updateFormStep(form, 2);
      }
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.formSubmitting) {
      return;
    }

    clearErrors(form);
    hideFormFeedback(form);
    const errors = [...validateFormStep(form, 1), ...validateFormStep(form, 2)];
    if (errors.length) {
      errors.forEach((error) => setFieldError(form, error.field, error.message));
      updateFormStep(form, errors.some((error) => formStepOneFields.has(error.field)) ? 1 : 2);
      showFormFeedback(form, "Проверьте заполнение обязательных полей.", "error");
      focusFirstError(form, errors);
      return;
    }

    state.formSubmitting = true;
    form.setAttribute("aria-busy", "true");
    submit.disabled = true;
    const submitLabel = submit.childNodes[0];
    const originalText = submitLabel?.textContent;
    if (submitLabel) {
      submitLabel.textContent = "Отправляем ";
    }

    try {
      const applicantType = getApplicantType(form);
      if (
        state.applicationContext.vacancyId
        && !isVacancyRouteCompatible(state.applicationContext.applicantType, applicantType)
      ) {
        clearApplicationVacancyContext(form, applicantType);
      }
      state.applicationContext.applicantType = applicantType;
      const attempt = state.submitAttempt ?? createSubmitAttempt();
      state.submitAttempt = attempt;

      const resume = state.resumeAttachment.file || file.files?.[0];
      if (resume && !state.resumeFileId) {
        const uploadReceipt = await apiClient.uploadFile(resume, undefined, attempt.keys.upload);
        state.resumeFileId = uploadReceipt.fileId;
        state.resumeFileBindingToken = uploadReceipt.bindingToken;
      }

      const normalizedSalary = digitsOnly(qs("#wishSalary", form).value);
      const submittedAt = attempt.submittedAt;

      const payload = bindSubmitAttemptPayload(attempt, {
        schemaVersion: "landing.application@1",
        personal: {
          surname: qs("#surname", form).value.trim(),
          name: qs("#name", form).value.trim(),
          middlename: qs("#middlename", form).value.trim(),
          birthdate: qs("#birthdate", form).value,
          email: qs("#email", form).value.trim(),
          phone: qs("#phone", form).value.trim(),
        },
        application: {
          applicantType,
          ...(state.applicationContext.vacancyId
            ? {
                vacancyId: state.applicationContext.vacancyId,
                vacancySector: state.applicationContext.vacancySector,
              }
            : {}),
          referralCode: qs("#referral", form).value.trim(),
          region: qs("#region", form).value.trim(),
          ...(applicantType === "student"
            ? {
                studentProfile: {
                  institution: qs("#studentInstitution", form).value.trim(),
                  specialty: qs("#studentSpecialty", form).value.trim(),
                  graduationYear: Number(qs("#graduationYear", form).value),
                  status: qs("#studentStatus", form).value,
                  ...(qs("#studentStatus", form).value === "graduated"
                    ? {}
                    : {
                        practicePeriod: {
                          start: qs("#practiceStart", form).value,
                          end: qs("#practiceEnd", form).value,
                        },
                      }),
                },
              }
            : {
                sphere: sphere.value,
                wishPost: qs("#wishPost", form).value.trim(),
                ...(normalizedSalary ? { wishSalary: normalizedSalary } : {}),
              }),
          comment: qs("#comment", form).value.trim(),
        },
        consents: {
          privacyAccepted: qs("#agreeTerms", form).checked,
          privacyPolicyVersion: PRIVACY_POLICY_VERSION,
          acceptedAt: submittedAt,
        },
        attachments: {
          resumeFileId: state.resumeFileId,
          resumeFileBindingToken: state.resumeFileBindingToken,
        },
        meta: collectSubmissionMeta(submittedAt),
      });

      await apiClient.submitApplication(payload, undefined, attempt.keys.application);
      state.submitAttempt = null;
      form.reset();
      setResumeAttachment(null);
      clearApplicationVacancyContext(form, "relocation", "direct");
      birthdateInput.sync();
      regionCombobox.reset();
      setApplicantTypeMode(form, "relocation");
      updateFormStep(form, 1);
      showFormFeedback(form, "Заявка отправлена. Куратор свяжется с вами в течение одного рабочего дня.", "success");
    } catch (error) {
      if (error instanceof ApiError) {
        const serverErrors = [];
        error.errors.forEach((item) => {
          const raw = item.field?.split(".").pop();
          const aliases = {
            privacyAccepted: "agreeTerms",
            referralCode: "referral",
            resumeFileId: "resume",
            resumeFileBindingToken: "resume",
            file: "resume",
            institution: "studentInstitution",
            specialty: "studentSpecialty",
            status: "studentStatus",
            practicePeriod: "practiceStart",
            start: "practiceStart",
            end: "practiceEnd",
          };
          const field = aliases[raw] || raw;
          if (field) {
            const fieldError = { field, message: item.message || "Проверьте значение поля." };
            serverErrors.push(fieldError);
            setFieldError(form, fieldError.field, fieldError.message);
          }
        });
        if (serverErrors.length) {
          updateFormStep(form, serverErrors.some((item) => formStepOneFields.has(item.field)) ? 1 : 2);
          focusFirstError(form, serverErrors);
        }
        const requestId = error.requestId ? ` ID запроса: ${error.requestId}` : "";
        showFormFeedback(form, `${error.message || "Не удалось отправить заявку."}${requestId}`, "error");
      } else {
        showFormFeedback(form, "Не удалось отправить заявку. Попробуйте ещё раз позже.", "error");
      }
    } finally {
      state.formSubmitting = false;
      form.removeAttribute("aria-busy");
      submit.disabled = false;
      if (submitLabel && typeof originalText === "string") {
        submitLabel.textContent = originalText;
      }
    }
  });

  qs("[data-student-apply]")?.addEventListener("click", () => prefillApplication({
    role: "Стажировка / старт карьеры",
    applicantType: "student",
    source: "students-section",
  }));

  qs("[data-city-apply]")?.addEventListener("click", () => {
    if (!state.selectedCity) {
      return;
    }
    prefillApplication({
      city: state.selectedCity.name,
      source: "city-map",
    });
  });
}

function initYear() {
  const year = qs("#year");
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }
}

async function init() {
  initHeader();
  initMobileMenu();
  initAnchorLinks();
  initReveal();
  initAurora();
  initHeroParallax();
  initVacancies();
  initDialogs();
  initNorthLife();
  initLegalAndCookies();
  initSupport();
  void initStories();
  initResumeBuilder();
  initApplicationForm();
  initYear();
  await initMap();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
