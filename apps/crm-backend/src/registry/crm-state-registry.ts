export type CrmStateMachineKind = "case" | "task";
export type CrmStateMachineStatus = "draft" | "active" | "retired";

export interface CrmStateDefinition {
  readonly code: string;
  readonly title: string;
  readonly order: number;
  readonly aggregateStatus?: "open" | "completed" | "closed_unsuccessful";
}

export interface CrmTransitionGuard {
  readonly type: "equals_history_field";
  readonly field: string;
}

export interface CrmTransitionDefinition {
  readonly code: string;
  readonly from: readonly (string | null)[];
  readonly to: readonly string[];
  readonly permissionCode: string;
  readonly requiredFields: readonly string[];
  readonly reasonRequired: boolean;
  readonly targetGuard?: CrmTransitionGuard;
}

export interface CrmStateMachineDefinition {
  readonly kind: CrmStateMachineKind;
  readonly code: string;
  readonly version: number;
  readonly title: string;
  readonly status: CrmStateMachineStatus;
  readonly source: string;
  readonly initialState: string | null;
  readonly states: readonly CrmStateDefinition[];
  readonly transitions: readonly CrmTransitionDefinition[];
}

export interface ResolvedCrmTransition {
  readonly machine: CrmStateMachineDefinition;
  readonly transition: CrmTransitionDefinition;
  readonly from: string;
  readonly to: string;
}

export interface CrmStateRegistry {
  list(kind?: CrmStateMachineKind): readonly CrmStateMachineDefinition[];
  get(kind: CrmStateMachineKind, code: string, version?: number): CrmStateMachineDefinition | undefined;
  resolveTransition(
    kind: CrmStateMachineKind,
    code: string,
    version: number,
    from: string,
    to: string,
  ): ResolvedCrmTransition | undefined;
}

const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

function keyOf(kind: CrmStateMachineKind, code: string, version: number): string {
  return `${kind}:${code}:${version}`;
}

function freezeMachine(machine: CrmStateMachineDefinition): CrmStateMachineDefinition {
  return Object.freeze({
    ...machine,
    states: Object.freeze(machine.states.map((state) => Object.freeze({ ...state }))),
    transitions: Object.freeze(
      machine.transitions.map((transition) =>
        Object.freeze({
          ...transition,
          from: Object.freeze([...transition.from]),
          to: Object.freeze([...transition.to]),
          requiredFields: Object.freeze([...transition.requiredFields]),
          ...(transition.targetGuard ? { targetGuard: Object.freeze({ ...transition.targetGuard }) } : {}),
        }),
      ),
    ),
  });
}

function assertMachine(machine: CrmStateMachineDefinition): void {
  if (!CODE_PATTERN.test(machine.code)) {
    throw new Error(`Invalid CRM state machine code: ${machine.code}`);
  }
  if (!Number.isSafeInteger(machine.version) || machine.version < 1) {
    throw new Error(`Invalid version for CRM state machine ${machine.code}`);
  }

  const states = new Set<string>();
  const orders = new Set<number>();
  for (const state of machine.states) {
    if (!CODE_PATTERN.test(state.code)) {
      throw new Error(`Invalid state ${state.code} in ${machine.code}@${machine.version}`);
    }
    if (states.has(state.code)) {
      throw new Error(`Duplicate state ${state.code} in ${machine.code}@${machine.version}`);
    }
    if (orders.has(state.order)) {
      throw new Error(`Duplicate state order ${state.order} in ${machine.code}@${machine.version}`);
    }
    states.add(state.code);
    orders.add(state.order);
  }

  if (machine.status === "active") {
    if (machine.states.length === 0 || machine.initialState === null) {
      throw new Error(`Active CRM state machine ${machine.code}@${machine.version} is empty`);
    }
    if (!states.has(machine.initialState)) {
      throw new Error(`Unknown initial state in ${machine.code}@${machine.version}`);
    }
  } else if (machine.initialState !== null && !states.has(machine.initialState)) {
    throw new Error(`Unknown initial state in ${machine.code}@${machine.version}`);
  }

  const transitionCodes = new Set<string>();
  const edges = new Set<string>();
  for (const transition of machine.transitions) {
    if (!CODE_PATTERN.test(transition.code)) {
      throw new Error(`Invalid transition code ${transition.code} in ${machine.code}@${machine.version}`);
    }
    if (transitionCodes.has(transition.code)) {
      throw new Error(`Duplicate transition ${transition.code} in ${machine.code}@${machine.version}`);
    }
    if (transition.from.length === 0 || transition.to.length === 0) {
      throw new Error(`Empty transition selector ${transition.code} in ${machine.code}@${machine.version}`);
    }
    if (!transition.permissionCode.trim()) {
      throw new Error(`Transition ${transition.code} has no permission code`);
    }

    transitionCodes.add(transition.code);
    for (const from of transition.from) {
      if (from !== null && !states.has(from)) {
        throw new Error(`Unknown from state ${from} in ${machine.code}@${machine.version}`);
      }
      for (const to of transition.to) {
        if (!states.has(to)) {
          throw new Error(`Unknown to state ${to} in ${machine.code}@${machine.version}`);
        }
        const edge = `${from ?? "<initial>"}->${to}`;
        if (edges.has(edge)) {
          throw new Error(`Duplicate transition edge ${edge} in ${machine.code}@${machine.version}`);
        }
        edges.add(edge);
      }
    }
  }
}

export function createCrmStateRegistry(definitions: readonly CrmStateMachineDefinition[]): CrmStateRegistry {
  const machines = new Map<string, CrmStateMachineDefinition>();
  const latest = new Map<string, CrmStateMachineDefinition>();

  for (const definition of definitions) {
    assertMachine(definition);
    const registryKey = keyOf(definition.kind, definition.code, definition.version);
    if (machines.has(registryKey)) {
      throw new Error(`Duplicate CRM state machine version: ${registryKey}`);
    }

    const frozen = freezeMachine(definition);
    machines.set(registryKey, frozen);

    const latestKey = `${definition.kind}:${definition.code}`;
    const current = latest.get(latestKey);
    if (!current || frozen.version > current.version) {
      latest.set(latestKey, frozen);
    }
  }

  const ordered = Object.freeze(
    [...machines.values()].sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.code.localeCompare(right.code) ||
        right.version - left.version,
    ),
  );

  return Object.freeze({
    list(kind?: CrmStateMachineKind) {
      return kind ? ordered.filter((machine) => machine.kind === kind) : ordered;
    },
    get(kind: CrmStateMachineKind, code: string, version?: number) {
      return version === undefined ? latest.get(`${kind}:${code}`) : machines.get(keyOf(kind, code, version));
    },
    resolveTransition(kind: CrmStateMachineKind, code: string, version: number, from: string, to: string) {
      const machine = machines.get(keyOf(kind, code, version));
      if (!machine) {
        return undefined;
      }
      const transition = machine.transitions.find(
        (candidate) => candidate.from.includes(from) && candidate.to.includes(to),
      );
      return transition ? { machine, transition, from, to } : undefined;
    },
  });
}

const relocationOpenStates = [
  "new",
  "qualification",
  "documents",
  "employer_selection",
  "employer_review",
  "offer",
  "relocation_preparation",
] as const;

const studentOpenStates = [
  "new",
  "qualification",
  "practice_selection",
  "host_review",
  "placement_confirmed",
  "in_practice",
] as const;

export const CRM_STATE_MACHINE_DEFINITIONS = Object.freeze([
  {
    kind: "case",
    code: "relocation",
    version: 1,
    title: "Переезд",
    status: "active",
    source: "cabinet-state-transition-catalog@1.1.0",
    initialState: "new",
    states: [
      { code: "new", title: "Новая заявка", order: 10, aggregateStatus: "open" },
      { code: "qualification", title: "Квалификация", order: 20, aggregateStatus: "open" },
      { code: "documents", title: "Документы", order: 30, aggregateStatus: "open" },
      {
        code: "employer_selection",
        title: "Подбор работодателя",
        order: 40,
        aggregateStatus: "open",
      },
      { code: "employer_review", title: "На рассмотрении", order: 50, aggregateStatus: "open" },
      { code: "offer", title: "Предложение", order: 60, aggregateStatus: "open" },
      {
        code: "relocation_preparation",
        title: "Подготовка переезда",
        order: 70,
        aggregateStatus: "open",
      },
      { code: "moved", title: "Переехал", order: 80, aggregateStatus: "completed" },
      {
        code: "closed_unsuccessful",
        title: "Завершено без результата",
        order: 90,
        aggregateStatus: "closed_unsuccessful",
      },
    ],
    transitions: [
      {
        code: "qualify",
        from: ["new"],
        to: ["qualification"],
        permissionCode: "crm.case.transition",
        requiredFields: ["owner_id", "next_step"],
        reasonRequired: false,
      },
      {
        code: "request_documents",
        from: ["qualification"],
        to: ["documents"],
        permissionCode: "crm.case.transition",
        requiredFields: ["program_type", "normalized_contact"],
        reasonRequired: false,
      },
      {
        code: "select_employer",
        from: ["documents"],
        to: ["employer_selection"],
        permissionCode: "crm.case.transition",
        requiredFields: ["document_decision"],
        reasonRequired: false,
      },
      {
        code: "submit_employer",
        from: ["employer_selection"],
        to: ["employer_review"],
        permissionCode: "crm.case.transition",
        requiredFields: ["employer_referral_id"],
        reasonRequired: false,
      },
      {
        code: "record_offer",
        from: ["employer_review"],
        to: ["offer"],
        permissionCode: "crm.case.transition",
        requiredFields: ["approved_referral_id"],
        reasonRequired: false,
      },
      {
        code: "prepare_relocation",
        from: ["offer"],
        to: ["relocation_preparation"],
        permissionCode: "crm.case.transition",
        requiredFields: ["employer_id", "job_title", "agreement_result"],
        reasonRequired: false,
      },
      {
        code: "record_move",
        from: ["relocation_preparation"],
        to: ["moved"],
        permissionCode: "crm.case.transition",
        requiredFields: ["municipality", "locality", "actual_relocation_date", "employer_id", "job_title"],
        reasonRequired: false,
      },
      {
        code: "close_unsuccessful",
        from: relocationOpenStates,
        to: ["closed_unsuccessful"],
        permissionCode: "crm.case.transition",
        requiredFields: ["reason_code"],
        reasonRequired: true,
      },
      {
        code: "reopen",
        from: ["closed_unsuccessful"],
        to: relocationOpenStates,
        permissionCode: "crm.case.reopen",
        requiredFields: ["reason", "target_state"],
        reasonRequired: true,
        targetGuard: { type: "equals_history_field", field: "last_open_state" },
      },
      {
        code: "correct_move",
        from: ["moved"],
        to: ["relocation_preparation"],
        permissionCode: "crm.case.reopen",
        requiredFields: ["reason", "correction_evidence"],
        reasonRequired: true,
      },
    ],
  },
  {
    kind: "case",
    code: "student",
    version: 1,
    title: "Студенты",
    status: "active",
    source: "cabinet-state-transition-catalog@1.1.0",
    initialState: "new",
    states: [
      { code: "new", title: "Новая заявка", order: 10, aggregateStatus: "open" },
      { code: "qualification", title: "Квалификация", order: 20, aggregateStatus: "open" },
      {
        code: "practice_selection",
        title: "Подбор практики",
        order: 30,
        aggregateStatus: "open",
      },
      { code: "host_review", title: "На рассмотрении", order: 40, aggregateStatus: "open" },
      {
        code: "placement_confirmed",
        title: "Место подтверждено",
        order: 50,
        aggregateStatus: "open",
      },
      { code: "in_practice", title: "На практике", order: 60, aggregateStatus: "open" },
      { code: "completed", title: "Завершено", order: 70, aggregateStatus: "completed" },
      {
        code: "closed_unsuccessful",
        title: "Завершено без результата",
        order: 80,
        aggregateStatus: "closed_unsuccessful",
      },
    ],
    transitions: [
      {
        code: "qualify",
        from: ["new"],
        to: ["qualification"],
        permissionCode: "crm.case.transition",
        requiredFields: ["owner_id", "education_minimum"],
        reasonRequired: false,
      },
      {
        code: "select_practice",
        from: ["qualification"],
        to: ["practice_selection"],
        permissionCode: "crm.case.transition",
        requiredFields: ["specialization", "practice_direction"],
        reasonRequired: false,
      },
      {
        code: "submit_host",
        from: ["practice_selection"],
        to: ["host_review"],
        permissionCode: "crm.case.transition",
        requiredFields: ["host_referral_id"],
        reasonRequired: false,
      },
      {
        code: "confirm_placement",
        from: ["host_review"],
        to: ["placement_confirmed"],
        permissionCode: "crm.case.transition",
        requiredFields: ["accepted_host_id", "planned_dates"],
        reasonRequired: false,
      },
      {
        code: "start_practice",
        from: ["placement_confirmed"],
        to: ["in_practice"],
        permissionCode: "crm.case.transition",
        requiredFields: ["actual_start_date"],
        reasonRequired: false,
      },
      {
        code: "complete_practice",
        from: ["in_practice"],
        to: ["completed"],
        permissionCode: "crm.case.transition",
        requiredFields: ["result", "actual_end_date"],
        reasonRequired: false,
      },
      {
        code: "close_unsuccessful",
        from: studentOpenStates,
        to: ["closed_unsuccessful"],
        permissionCode: "crm.case.transition",
        requiredFields: ["reason_code"],
        reasonRequired: true,
      },
      {
        code: "reopen",
        from: ["completed", "closed_unsuccessful"],
        to: studentOpenStates,
        permissionCode: "crm.case.reopen",
        requiredFields: ["reason", "target_state"],
        reasonRequired: true,
        targetGuard: { type: "equals_history_field", field: "last_open_state" },
      },
    ],
  },
  {
    kind: "case",
    code: "post_relocation",
    version: 1,
    title: "После переезда",
    status: "draft",
    source: "legacy-lifecycle-awaiting-process-owner-approval",
    initialState: null,
    states: [],
    transitions: [],
  },
  {
    kind: "task",
    code: "crm_task",
    version: 1,
    title: "Задача CRM",
    status: "active",
    source: "cabinet-state-transition-catalog@1.1.0",
    initialState: "to_do",
    states: [
      { code: "to_do", title: "К выполнению", order: 10 },
      { code: "in_progress", title: "В работе", order: 20 },
      { code: "done", title: "Выполнено", order: 30 },
      { code: "cancelled", title: "Отменено", order: 40 },
    ],
    transitions: [
      {
        code: "start",
        from: ["to_do"],
        to: ["in_progress"],
        permissionCode: "crm.task.manage",
        requiredFields: [],
        reasonRequired: false,
      },
      {
        code: "complete",
        from: ["in_progress"],
        to: ["done"],
        permissionCode: "crm.task.manage",
        requiredFields: [],
        reasonRequired: false,
      },
      {
        code: "cancel",
        from: ["to_do", "in_progress"],
        to: ["cancelled"],
        permissionCode: "crm.task.manage",
        requiredFields: ["reason"],
        reasonRequired: true,
      },
      {
        code: "reopen",
        from: ["done", "cancelled"],
        to: ["to_do"],
        permissionCode: "crm.task.manage",
        requiredFields: ["reason"],
        reasonRequired: true,
      },
    ],
  },
] as const satisfies readonly CrmStateMachineDefinition[]);

export const CRM_STATE_REGISTRY = createCrmStateRegistry(CRM_STATE_MACHINE_DEFINITIONS);

export const CRM_TASK_STATE_MACHINE = Object.freeze({ code: "crm_task", version: 1 });
