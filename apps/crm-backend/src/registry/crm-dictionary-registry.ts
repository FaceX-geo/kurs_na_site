export interface CrmDictionaryValue {
  readonly code: string;
  readonly title: string;
  readonly order: number;
  readonly active: boolean;
}

export interface CrmDictionary {
  readonly code: string;
  readonly version: number;
  readonly values: readonly CrmDictionaryValue[];
}

export interface CrmDictionaryRegistry {
  readonly version: number;
  list(): readonly CrmDictionary[];
  get(code: string): CrmDictionary | undefined;
}

export function createCrmDictionaryRegistry(
  version: number,
  dictionaries: readonly CrmDictionary[],
): CrmDictionaryRegistry {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("CRM dictionary registry version must be a positive integer");
  }

  const byCode = new Map<string, CrmDictionary>();
  for (const dictionary of dictionaries) {
    if (byCode.has(dictionary.code)) {
      throw new Error(`Duplicate CRM dictionary: ${dictionary.code}`);
    }
    const valueCodes = new Set<string>();
    const valueOrders = new Set<number>();
    for (const value of dictionary.values) {
      if (valueCodes.has(value.code) || valueOrders.has(value.order)) {
        throw new Error(`Duplicate value or order in CRM dictionary ${dictionary.code}`);
      }
      valueCodes.add(value.code);
      valueOrders.add(value.order);
    }
    byCode.set(
      dictionary.code,
      Object.freeze({
        ...dictionary,
        values: Object.freeze(dictionary.values.map((value) => Object.freeze({ ...value }))),
      }),
    );
  }

  const ordered = Object.freeze(
    [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code)),
  );
  return Object.freeze({
    version,
    list: () => ordered,
    get: (code: string) => byCode.get(code),
  });
}

export const CRM_DICTIONARY_REGISTRY = createCrmDictionaryRegistry(1, [
  {
    code: "case_status",
    version: 1,
    values: [
      { code: "open", title: "Открыт", order: 10, active: true },
      { code: "completed", title: "Завершён", order: 20, active: true },
      { code: "archived", title: "В архиве", order: 30, active: true },
    ],
  },
  {
    code: "profile_state",
    version: 1,
    values: [
      { code: "active", title: "Активный", order: 10, active: true },
      { code: "inactive", title: "Неактивный", order: 20, active: true },
      { code: "merged", title: "Объединён", order: 30, active: true },
    ],
  },
  {
    code: "referral_channel",
    version: 1,
    values: [
      { code: "email", title: "Email", order: 10, active: true },
      { code: "phone", title: "Телефон", order: 20, active: true },
      { code: "messenger", title: "Мессенджер", order: 30, active: true },
      { code: "manual", title: "Вручную", order: 40, active: true },
    ],
  },
]);
