export type CandidateStage =
  | "new"
  | "contact"
  | "documents"
  | "matching"
  | "employer"
  | "relocation"
  | "completed";

export type DemoCandidate = {
  id: string;
  initials: string;
  name: string;
  profession: string;
  roles: string[];
  program: string;
  stage: CandidateStage;
  stageLabel: string;
  source: string;
  owner: string;
  nextStep: string;
  needsReview?: boolean;
};

export type DemoCase = {
  id: string;
  candidateId: string;
  candidateName: string;
  initials: string;
  profession: string;
  owner: string;
  stage: CandidateStage;
  stageLabel: string;
  nextStep: string;
  dueLabel: string;
  overdue?: boolean;
};

export const stageMeta: Record<CandidateStage, { label: string; tone: string; order: number }> = {
  new: { label: "Новые", tone: "new", order: 1 },
  contact: { label: "Связались", tone: "contact", order: 2 },
  documents: { label: "Документы", tone: "documents", order: 3 },
  matching: { label: "Подбор", tone: "matching", order: 4 },
  employer: { label: "У работодателя", tone: "employer", order: 5 },
  relocation: { label: "Готовим переезд", tone: "relocation", order: 6 },
  completed: { label: "Завершено", tone: "completed", order: 7 },
};

export const demoCandidates: DemoCandidate[] = [
  {
    id: "demo-alexey",
    initials: "АК",
    name: "Алексей Круглов",
    profession: "Механик",
    roles: ["Кандидат"],
    program: "Подбор работодателя",
    stage: "matching",
    stageLabel: "Подбираем работодателя",
    source: "Сайт",
    owner: "Артём К.",
    nextStep: "Подобрать вакансии",
  },
  {
    id: "demo-anna",
    initials: "АС",
    name: "Анна Смирнова",
    profession: "Врач-терапевт",
    roles: ["Кандидат", "Рекомендатель"],
    program: "Подбор работодателя",
    stage: "employer",
    stageLabel: "У работодателя",
    source: "Рекомендация",
    owner: "Ольга Л.",
    nextStep: "Получить ответ работодателя",
    needsReview: true,
  },
  {
    id: "demo-dmitry",
    initials: "ДВ",
    name: "Дмитрий Волков",
    profession: "Ведущий геодезист",
    roles: ["Кандидат"],
    program: "Переезд",
    stage: "relocation",
    stageLabel: "Готовим переезд",
    source: "Сайт",
    owner: "Наталья К.",
    nextStep: "Оформить документы",
  },
  {
    id: "demo-elena",
    initials: "ЕК",
    name: "Елена Соколова",
    profession: "Главный бухгалтер",
    roles: ["Кандидат", "Рекомендатель"],
    program: "Переезд",
    stage: "relocation",
    stageLabel: "Готовим переезд",
    source: "Соцсети",
    owner: "Ольга Л.",
    nextStep: "Согласовать условия",
  },
  {
    id: "demo-ivan",
    initials: "ИП",
    name: "Иван Петров",
    profession: "Инженер ПТО",
    roles: ["Студент"],
    program: "Стажировка",
    stage: "documents",
    stageLabel: "Проверяем документы",
    source: "Вуз-партнёр",
    owner: "Ольга Л.",
    nextStep: "Проверить документы",
  },
  {
    id: "demo-maria",
    initials: "МК",
    name: "Мария Орлова",
    profession: "Лаборант",
    roles: ["Кандидат"],
    program: "Подбор работодателя",
    stage: "matching",
    stageLabel: "Подбираем работодателя",
    source: "Сайт",
    owner: "Артём К.",
    nextStep: "Проверить документы",
  },
];

export const demoCases: DemoCase[] = [
  {
    id: "case-anna",
    candidateId: "demo-anna",
    candidateName: "Анна Смирнова",
    initials: "АС",
    profession: "Врач-терапевт",
    owner: "Ольга Лебедева",
    stage: "employer",
    stageLabel: "У работодателя",
    nextStep: "Получить ответ ООО «СеверЭнерго»",
    dueLabel: "Сегодня, 13:00",
  },
  {
    id: "case-alexey",
    candidateId: "demo-alexey",
    candidateName: "Алексей Круглов",
    initials: "АК",
    profession: "Механик",
    owner: "Артём Кузнецов",
    stage: "matching",
    stageLabel: "Подбор",
    nextStep: "Подобрать вакансии",
    dueLabel: "Сегодня, 17:00",
  },
  {
    id: "case-dmitry",
    candidateId: "demo-dmitry",
    candidateName: "Дмитрий Волков",
    initials: "ДВ",
    profession: "Ведущий геодезист",
    owner: "Наталья Крылова",
    stage: "relocation",
    stageLabel: "Готовим переезд",
    nextStep: "Оформить билеты",
    dueLabel: "7 августа",
  },
  {
    id: "case-maria",
    candidateId: "demo-maria",
    candidateName: "Мария Орлова",
    initials: "МО",
    profession: "Лаборант",
    owner: "Артём Кузнецов",
    stage: "contact",
    stageLabel: "Связались",
    nextStep: "Уточнить опыт работы",
    dueLabel: "Просрочено на 1 день",
    overdue: true,
  },
  {
    id: "case-elena",
    candidateId: "demo-elena",
    candidateName: "Елена Соколова",
    initials: "ЕС",
    profession: "Главный бухгалтер",
    owner: "Ольга Лебедева",
    stage: "documents",
    stageLabel: "Документы",
    nextStep: "Запросить справку",
    dueLabel: "8 августа",
  },
  {
    id: "case-sergey",
    candidateId: "demo-sergey",
    candidateName: "Сергей Васильев",
    initials: "СВ",
    profession: "Электромонтёр",
    owner: "Наталья Крылова",
    stage: "new",
    stageLabel: "Новая заявка",
    nextStep: "Назначить ответственного",
    dueLabel: "Без срока",
  },
  {
    id: "case-olga",
    candidateId: "demo-olga",
    candidateName: "Ольга Миронова",
    initials: "ОМ",
    profession: "Инженер-химик",
    owner: "Ольга Лебедева",
    stage: "completed",
    stageLabel: "Переезд завершён",
    nextStep: "Проверить адаптацию",
    dueLabel: "12 августа",
  },
];

export const annaTimeline = [
  {
    id: "activity-1",
    date: "31 июля 2026",
    time: "14:32",
    type: "Задача",
    title: "Получить ответ ООО «СеверЭнерго» до 13:00",
    detail: "Ответственный: Ольга Лебедева",
  },
  {
    id: "activity-2",
    date: "30 июля 2026",
    time: "11:08",
    type: "Email",
    title: "Запрошены дополнительные документы",
    detail: "CRM-копия письма, оригинал может быть недоступен",
  },
  {
    id: "activity-3",
    date: "30 июля 2026",
    time: "10:15",
    type: "MAX",
    title: "Уточнён срок справки о несудимости",
    detail: "Доставка не подтверждена провайдером",
  },
  {
    id: "activity-4",
    date: "29 июля 2026",
    time: "16:47",
    type: "Этап",
    title: "Этап изменён на «У работодателя»",
    detail: "Изменение подтверждено Ольгой Лебедевой",
  },
];
