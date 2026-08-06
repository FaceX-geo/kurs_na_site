export const VACANCY_SECTORS = Object.freeze({
  industry: "Промышленность",
  medicine: "Здравоохранение",
  education: "Образование",
  port: "Вакансии порта",
  safety: "Безопасность",
  students: "Старт карьеры",
});

export function digitsOnly(value = "") {
  return String(value).replace(/\D/g, "");
}

export function minimumAgeFor(applicantType) {
  return applicantType === "student" ? 16 : 18;
}

export function isVacancyRouteCompatible(vacancyApplicantType, applicantType) {
  return vacancyApplicantType === applicantType;
}

export function calculateAgeOn(date, today = new Date()) {
  let age = today.getFullYear() - date.getFullYear();
  const monthDelta = today.getMonth() - date.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < date.getDate())) {
    age -= 1;
  }
  return age;
}

export function normalizeVacancy(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const sector = String(item.sector || "").trim();
  const title = String(item.title || "").trim();
  const id = String(item.id || "").trim();
  if (!id || !title || !Object.hasOwn(VACANCY_SECTORS, sector)) {
    return null;
  }

  const list = (value) => Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];

  return {
    id,
    sector,
    title,
    city: String(item.city || "Мурманская область").trim(),
    employer: String(item.employer || "Работодатель проекта").trim(),
    salaryText: String(item.salaryText || "Условия уточнит куратор").trim(),
    summary: String(item.summary || "Подробности вакансии уточнит куратор проекта.").trim(),
    responsibilities: list(item.responsibilities),
    requirements: list(item.requirements),
    conditions: list(item.conditions),
    applicantType: item.applicantType === "student" ? "student" : "relocation",
    sphere: String(item.sphere || "").trim(),
    published: item.published !== false,
  };
}
