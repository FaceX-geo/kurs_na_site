import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  VACANCY_SECTORS,
  calculateAgeOn,
  digitsOnly,
  isVacancyRouteCompatible,
  minimumAgeFor,
  normalizeVacancy,
} from "../scripts/application-rules.js";

const projectUrl = new URL("../", import.meta.url);

test("salary input is normalized to digits", () => {
  assert.equal(digitsOnly("150 000 ₽"), "150000");
  assert.equal(digitsOnly(""), "");
});

test("minimum age follows selected route", () => {
  assert.equal(minimumAgeFor("student"), 16);
  assert.equal(minimumAgeFor("relocation"), 18);
});

test("vacancy context is compatible only with its original route", () => {
  assert.equal(isVacancyRouteCompatible("student", "student"), true);
  assert.equal(isVacancyRouteCompatible("relocation", "relocation"), true);
  assert.equal(isVacancyRouteCompatible("student", "relocation"), false);
  assert.equal(isVacancyRouteCompatible("relocation", "student"), false);
});

test("age calculation respects birthday boundary", () => {
  const birthday = new Date(2008, 7, 7);
  assert.equal(calculateAgeOn(birthday, new Date(2026, 7, 6)), 17);
  assert.equal(calculateAgeOn(birthday, new Date(2026, 7, 7)), 18);
  assert.equal(calculateAgeOn(birthday, new Date(2026, 7, 8)), 18);
});

test("fallback catalog has six unique sectors and valid vacancies", async () => {
  const raw = await readFile(new URL("assets/data/vacancies.json", projectUrl), "utf8");
  const payload = JSON.parse(raw);
  const items = payload.items.map(normalizeVacancy);
  assert.ok(items.every(Boolean));
  assert.equal(Object.keys(VACANCY_SECTORS).length, 6);
  assert.deepEqual(new Set(items.map((item) => item.sector)), new Set(Object.keys(VACANCY_SECTORS)));
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
});

test("landing exposes six accessible sector controls and required resume", async () => {
  const html = await readFile(new URL("index.html", projectUrl), "utf8");
  assert.equal((html.match(/data-vacancy-sector-open=/g) || []).length, 6);
  assert.match(html, /id="resume"[^>]*required/);
  assert.match(html, /id="wishSalary"[^>]*pattern="\[0-9\]\*"/);
  assert.match(html, /Живи и работай там, где другие мечтают отдыхать/);
});
