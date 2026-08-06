import { describe, expect, it } from "vitest";
import { IntakeError } from "../src/modules/intake/errors.js";
import { hashCanonicalJson, normalizeApplicationPayload } from "../src/modules/intake/normalize.js";
import { applicationPayload } from "./intake-fixtures.js";

function issuesOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(IntakeError);
    return (error as IntakeError).issues;
  }
  throw new Error("Expected IntakeError");
}

describe("normalizeApplicationPayload", () => {
  it("normalizes the current landing payload and preserves legacy attribution", () => {
    const result = normalizeApplicationPayload(applicationPayload, {
      now: new Date("2026-08-06T09:00:00.000Z"),
    });

    expect(result.personal.email).toBe("ivanov@example.com");
    expect(result.personal.phoneE164).toBe("+79111112233");
    expect(result.application).toMatchObject({
      applicantType: "relocation",
      wishSalaryRub: 150000,
      vacancyId: null,
      vacancySector: null,
    });
    expect(result.consent).toEqual({
      privacyAccepted: true,
      privacyPolicyVersion: null,
      acceptedAt: null,
      evidence: "server-received-compat",
    });
    expect(result.meta.entryPoint.code).toBe("direct");
    expect(result.meta.lastTouch?.utm).toEqual({
      utm_source: "vk",
      utm_campaign: "kns-2026",
    });
  });

  it("rejects student fields in a relocation payload before union validation can strip them", () => {
    const issues = issuesOf(() =>
      normalizeApplicationPayload({
        ...applicationPayload,
        application: {
          ...applicationPayload.application,
          studentProfile: {
            institution: "МАГУ",
            specialty: "Лечебное дело",
            graduationYear: 2027,
            status: "3",
          },
        },
      }),
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        field: "application.studentProfile",
        code: "forbidden_for_applicant_type",
      }),
    );
  });

  it("rejects relocation fields in a student payload", () => {
    const issues = issuesOf(() =>
      normalizeApplicationPayload({
        ...applicationPayload,
        application: {
          applicantType: "student",
          region: "Карелия",
          sphere: "medicine",
          studentProfile: {
            institution: "ПетрГУ",
            specialty: "Медицина",
            graduationYear: 2027,
            status: "graduated",
          },
        },
      }),
    );

    expect(issues).toContainEqual(
      expect.objectContaining({ field: "application.sphere", code: "forbidden_for_applicant_type" }),
    );
  });

  it("enforces student practice-period semantics", () => {
    const issues = issuesOf(() =>
      normalizeApplicationPayload({
        ...applicationPayload,
        application: {
          applicantType: "student",
          region: "Карелия",
          studentProfile: {
            institution: "ПетрГУ",
            specialty: "Медицина",
            graduationYear: 2027,
            status: "3",
          },
        },
      }),
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        field: "application.studentProfile.practicePeriod",
        code: "required",
      }),
    );
  });

  it("accepts versioned consent and first/last-touch attribution extensions", () => {
    const result = normalizeApplicationPayload(
      {
        ...applicationPayload,
        consents: {
          privacyAccepted: true,
          privacyPolicyVersion: "privacy-2026-08",
          acceptedAt: "2026-08-06T08:59:00+00:00",
        },
        meta: {
          ...applicationPayload.meta,
          sessionId: "session_01",
          consentState: "necessary",
          landing: {
            host: "KURS-NASEVER.RF",
            path: "/vacancies",
            url: "https://kurs-nasever.rf/vacancies",
          },
          attribution: {
            firstTouch: {
              capturedAt: "2026-08-01T08:00:00Z",
              referrer: "https://vk.com/",
              utm: { utm_source: "vk" },
              clickIds: { vkClickId: "click_01" },
            },
            lastTouch: {
              capturedAt: "2026-08-06T08:55:00Z",
              utm: { utm_medium: "cpc" },
            },
          },
        },
      },
      { now: new Date("2026-08-06T09:00:00Z") },
    );

    expect(result.consent).toMatchObject({
      privacyPolicyVersion: "privacy-2026-08",
      acceptedAt: "2026-08-06T08:59:00.000Z",
      evidence: "client",
    });
    expect(result.meta.landing.host).toBe("kurs-nasever.rf");
    expect(result.meta.firstTouch?.clickIds).toEqual({ vkClickId: "click_01" });
    expect(result.meta.lastTouch?.utm).toEqual({ utm_medium: "cpc" });
  });

  it("requires complete consent evidence for the canonical public contract", () => {
    const issues = issuesOf(() =>
      normalizeApplicationPayload(applicationPayload, {
        now: new Date("2026-08-06T09:00:00Z"),
        requireConsentEvidence: true,
      }),
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "consents.privacyPolicyVersion", code: "required" }),
        expect.objectContaining({ field: "consents.acceptedAt", code: "required" }),
      ]),
    );
  });

  it("requires vacancy id and sector as a pair", () => {
    const issues = issuesOf(() =>
      normalizeApplicationPayload({
        ...applicationPayload,
        application: { ...applicationPayload.application, vacancyId: "vac_01" },
      }),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: "paired_fields" }));
  });

  it("hashes JSON independently of object key order", () => {
    expect(hashCanonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      hashCanonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });
});
