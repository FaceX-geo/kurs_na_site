#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");

const files = {
  policy: "docs/cabinet/generated/authorization-policy-catalog.json",
  policyDoc: "docs/cabinet/06-authorization-policy-catalog.md",
  transitions: "docs/cabinet/generated/state-transition-catalog.json",
  migrationManifest: "docs/cabinet/generated/migration-scope-manifest.json",
  tableDispositions: "docs/cabinet/generated/source-table-dispositions.csv",
  columnDispositions: "docs/cabinet/generated/column-disposition-manifest.json",
  migrationQueries: "docs/cabinet/generated/migration-query-registry.json",
  targetModel: "docs/cabinet/generated/target-model-registry.json",
  evidenceRegistry: "docs/cabinet/generated/evidence-id-registry.json",
  sourceFieldMap: "docs/cabinet/generated/source-field-map.json",
  requirements: "docs/cabinet/generated/requirements-crosswalk.csv",
  sourceInventory: "docs/migration/generated/table-inventory.csv",
  schemaInventory: "docs/migration/generated/schema-inventory.json",
  referenceManifest: "docs/design/kurs-na-sever-system-reference/MANIFEST.csv",
  gitignore: ".gitignore",
};

const failures = [];

function absolute(relativePath) {
  return path.join(repositoryRoot, relativePath);
}

function readText(relativePath) {
  const target = absolute(relativePath);
  if (!fs.existsSync(target)) {
    failures.push(`missing file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(target, "utf8");
}

function assertNoDuplicateJsonKeys(raw, label) {
  let index = 0;

  function skipWhitespace() {
    while (/\s/.test(raw[index] ?? "")) index += 1;
  }

  function parseString() {
    const start = index;
    index += 1;
    let escaped = false;
    while (index < raw.length) {
      const character = raw[index];
      index += 1;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        return JSON.parse(raw.slice(start, index));
      }
    }
    throw new Error("unterminated string");
  }

  function parseValue() {
    skipWhitespace();
    const character = raw[index];
    if (character === "{") {
      parseObject();
      return;
    }
    if (character === "[") {
      parseArray();
      return;
    }
    if (character === '"') {
      parseString();
      return;
    }
    const start = index;
    while (index < raw.length && !/[\s,\]}]/.test(raw[index])) index += 1;
    if (index === start) throw new Error(`unexpected token at byte ${index}`);
  }

  function parseObject() {
    index += 1;
    const keys = new Set();
    skipWhitespace();
    if (raw[index] === "}") {
      index += 1;
      return;
    }
    while (index < raw.length) {
      skipWhitespace();
      if (raw[index] !== '"') throw new Error(`object key expected at byte ${index}`);
      const key = parseString();
      if (keys.has(key)) throw new Error(`duplicate object key "${key}"`);
      keys.add(key);
      skipWhitespace();
      if (raw[index] !== ":") throw new Error(`colon expected at byte ${index}`);
      index += 1;
      parseValue();
      skipWhitespace();
      if (raw[index] === "}") {
        index += 1;
        return;
      }
      if (raw[index] !== ",") throw new Error(`comma expected at byte ${index}`);
      index += 1;
    }
    throw new Error("unterminated object");
  }

  function parseArray() {
    index += 1;
    skipWhitespace();
    if (raw[index] === "]") {
      index += 1;
      return;
    }
    while (index < raw.length) {
      parseValue();
      skipWhitespace();
      if (raw[index] === "]") {
        index += 1;
        return;
      }
      if (raw[index] !== ",") throw new Error(`comma expected at byte ${index}`);
      index += 1;
    }
    throw new Error("unterminated array");
  }

  try {
    parseValue();
    skipWhitespace();
    if (index !== raw.length) throw new Error(`trailing content at byte ${index}`);
  } catch (error) {
    failures.push(`strict JSON validation ${label}: ${error.message}`);
  }
}

function readJson(relativePath) {
  const raw = readText(relativePath);
  if (!raw) return {};
  assertNoDuplicateJsonKeys(raw, relativePath);
  try {
    return JSON.parse(raw);
  } catch (error) {
    failures.push(`invalid JSON ${relativePath}: ${error.message}`);
    return {};
  }
}

function parseCsv(raw, label) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    const next = raw[index + 1];

    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) failures.push(`unterminated CSV quote: ${label}`);
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (!rows.length) failures.push(`empty CSV: ${label}`);
  return rows;
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) failures.push(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function splitPipe(value) {
  return String(value ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isNotApplicable(value) {
  return /^N\/A\([^)]+\)$/.test(String(value ?? ""));
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function permissionReferenceCode(reference) {
  if (typeof reference === "string") return reference;
  if (reference && typeof reference.permission === "string") return reference.permission;
  failures.push(`invalid permission reference: ${JSON.stringify(reference)}`);
  return "";
}

function collectTransitionPermissions(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectTransitionPermissions(item, output);
    return output;
  }
  if (value && typeof value === "object") {
    if (typeof value.permission === "string") output.push(value.permission);
    for (const child of Object.values(value)) {
      collectTransitionPermissions(child, output);
    }
  }
  return output;
}

const policy = readJson(files.policy);
const transitions = readJson(files.transitions);
const migrationManifest = readJson(files.migrationManifest);
const columnDispositions = readJson(files.columnDispositions);
const migrationQueries = readJson(files.migrationQueries);
const targetModel = readJson(files.targetModel);
const evidenceRegistry = readJson(files.evidenceRegistry);
const sourceFieldMap = readJson(files.sourceFieldMap);
const schemaInventory = readJson(files.schemaInventory);

const permissionCodes = (policy.permissions ?? []).map((entry) => entry.code);
assertUnique(permissionCodes, "permission code");
const permissionSet = new Set(permissionCodes);
const permissionByCode = new Map(
  (policy.permissions ?? []).map((permission) => [permission.code, permission]),
);
const operationOwners = new Map();
for (const permission of policy.permissions ?? []) {
  for (const operation of permission.operations ?? []) {
    const owners = operationOwners.get(operation) ?? [];
    owners.push(permission.code);
    operationOwners.set(operation, owners);
  }
}
for (const [operation, owners] of operationOwners) {
  if (owners.length !== 1) {
    failures.push(`operation ${operation} has ${owners.length} permission owners: ${owners.join(", ")}`);
  }
}

const actorRegistry = new Set([
  ...Object.keys(policy.roles ?? {}),
  ...Object.keys(policy.principals ?? {}),
]);
for (const permission of policy.permissions ?? []) {
  if (!permission.code || !permission.operations?.length) {
    failures.push(`permission without code/operations: ${JSON.stringify(permission)}`);
  }
  if (!permission.roles?.length && permission.code !== "audit.events.mutate") {
    failures.push(`permission has no role/principal: ${permission.code}`);
  }
  for (const actor of permission.roles ?? []) {
    if (!actorRegistry.has(actor)) {
      failures.push(`permission ${permission.code} references unknown role/principal: ${actor}`);
    }
  }
  for (const scope of permission.scopes ?? []) {
    if (!(scope in (policy.scopes ?? {}))) {
      failures.push(`permission ${permission.code} references unknown scope: ${scope}`);
    }
  }
}

for (const [name, principal] of Object.entries(policy.principals ?? {})) {
  for (const requiredField of [
    "kind",
    "authentication",
    "owner",
    "scope",
    "grant_path",
    "ttl_or_rotation",
    "ui_assignable",
  ]) {
    if (principal[requiredField] === undefined || principal[requiredField] === "") {
      failures.push(`principal ${name} missing ${requiredField}`);
    }
  }
  if (principal.kind === "service_principal" && principal.ui_assignable !== false) {
    failures.push(`service principal ${name} must not be UI assignable`);
  }
}
const approvalScopedSubjectNames = [
  "explicit_ai_pii_role",
  "designated_release_owner",
  "designated_platform_ops",
];
const approvalScopedScopeFields = {
  explicit_ai_pii_role: "dataset_scope",
  designated_release_owner: "migration_run_id",
  designated_platform_ops: "operation_scope",
};
const approvalScopedCommonContext = [
  "approved_request_id",
  "actor_id",
  "payload_hash",
  "approved_operation",
  "approved_permission",
  "expires_at",
];
for (const name of approvalScopedSubjectNames) {
  const principal = policy.principals?.[name];
  if (
    principal?.kind !== "approval_scoped_subject" ||
    principal.ui_assignable !== false ||
    principal.auto_expire !== true ||
    principal.grant_path !== "approved_request_id_and_payload_hash" ||
    !approvalScopedCommonContext.every((field) => principal.required_context?.includes(field)) ||
    !principal.required_context?.includes(approvalScopedScopeFields[name])
  ) {
    failures.push(
      `${name} must be non-assignable, auto-expiring and bound to request/actor/payload/operation/permission/scope/expiry`,
    );
  }
}
const expectedApprovalBindingGuard =
  "approved_request_actor_payload_operation_permission_scope_expiry_match_if_approval_scoped_subject";
const approvalScopedContract = policy.approval_scoped_subject_contract;
if (
  !approvalScopedContract ||
  approvalScopedContract.binding_guard !== expectedApprovalBindingGuard ||
  !approvalScopedCommonContext.every((field) =>
    approvalScopedContract.required_context_fields?.includes(field),
  ) ||
  approvalScopedContract.permission_recheck_on_every_use !== true ||
  approvalScopedContract.payload_hash_recheck_on_every_use !== true ||
  approvalScopedContract.scope_recheck_on_every_use !== true ||
  approvalScopedContract.all_consuming_permissions_require_binding_guard !== true
) {
  failures.push("approval-scoped subject contract is incomplete");
}
const approvalScopedSubjectSet = new Set(approvalScopedSubjectNames);
for (const permission of policy.permissions ?? []) {
  if (
    permission.roles?.some((role) => approvalScopedSubjectSet.has(role)) &&
    !permission.guards?.includes(expectedApprovalBindingGuard)
  ) {
    failures.push(
      `approval-scoped consuming permission lacks exact binding guard: ${permission.code}`,
    );
  }
}

const expectedPersistentPrivilegedRoles = [
  "platform_superadmin",
  "crm_admin",
  "project_admin",
  "migration_operator",
  "audit_reader",
];
const privilegedRoles = policy.privileged_roles;
if (
  !privilegedRoles ||
  JSON.stringify(privilegedRoles.persistent_roles) !==
    JSON.stringify(expectedPersistentPrivilegedRoles) ||
  JSON.stringify(privilegedRoles.approval_scoped_subjects) !==
    JSON.stringify(approvalScopedSubjectNames) ||
  privilegedRoles.disable_archive_critical_when !== "subject_is_privileged" ||
  privilegedRoles.minimum_eligible_count_after_disable_or_archive?.platform_superadmin !== 2 ||
  privilegedRoles.minimum_eligible_count_after_disable_or_archive?.crm_admin !== 1 ||
  privilegedRoles.minimum_eligible_count_after_disable_or_archive?.project_admin !== 1 ||
  JSON.stringify(privilegedRoles.roles_without_minimum_still_require_critical_approval) !==
    JSON.stringify(["migration_operator", "audit_reader"])
) {
  failures.push("typed privileged-role set or disable/archive thresholds are incomplete");
}
for (const role of expectedPersistentPrivilegedRoles) {
  if (!(role in (policy.roles ?? {}))) {
    failures.push(`typed privileged role is not registered as a role: ${role}`);
  }
}

const criticalReferences = [
  ...(policy.critical_approval?.operations ?? []),
  ...(policy.bootstrap?.prototype_single_account_denied_operations ?? []),
];
function validCriticalWhen(when) {
  if (when === "always") return true;
  if (when === "subject_is_privileged") {
    return true;
  }
  const countMatch = String(when).match(
    /^(crm_admin_count|project_admin_count) (==|>=) ([01])$/,
  );
  if (countMatch) {
    return (
      (countMatch[2] === "==" && countMatch[3] === "0") ||
      (countMatch[2] === ">=" && countMatch[3] === "1")
    );
  }
  const roleMatch = String(when).match(/^target_role == '([a-z0-9_]+)'$/);
  return Boolean(roleMatch && roleMatch[1] in (policy.roles ?? {}));
}
for (const reference of criticalReferences) {
  const code = permissionReferenceCode(reference);
  if (code && !permissionSet.has(code)) {
    failures.push(`critical/prototype list references unknown permission: ${code}`);
  }
  if (reference && typeof reference === "object" && !reference.when) {
    failures.push(`conditional permission reference lacks when: ${JSON.stringify(reference)}`);
  } else if (reference && typeof reference === "object" && !validCriticalWhen(reference.when)) {
    failures.push(`conditional permission reference has invalid when grammar: ${JSON.stringify(reference)}`);
  }
}
const criticalPermissionCodes = new Set(
  (policy.critical_approval?.operations ?? []).map(permissionReferenceCode).filter(Boolean),
);
const prototypeDeniedPermissionCodes = new Set(
  (policy.bootstrap?.prototype_single_account_denied_operations ?? [])
    .map(permissionReferenceCode)
    .filter(Boolean),
);
for (const code of criticalPermissionCodes) {
  if (!prototypeDeniedPermissionCodes.has(code)) {
    failures.push(`critical permission is not denied in single-account prototype: ${code}`);
  }
}
const criticalConditionList = (policy.critical_approval?.operations ?? []).map(
  (reference) => `${permissionReferenceCode(reference)}|${reference.when}`,
);
const prototypeDeniedConditionList = (
  policy.bootstrap?.prototype_single_account_denied_operations ?? []
).map((reference) => `${permissionReferenceCode(reference)}|${reference.when}`);
assertUnique(criticalConditionList, "critical permission condition");
assertUnique(prototypeDeniedConditionList, "prototype-denied permission condition");
const criticalConditions = new Set(criticalConditionList);
const prototypeDeniedConditions = new Set(prototypeDeniedConditionList);
for (const condition of criticalConditions) {
  if (!prototypeDeniedConditions.has(condition)) {
    failures.push(`critical condition is not exactly denied in single-account prototype: ${condition}`);
  }
}
const disableUserPermission = (policy.permissions ?? []).find(
  (permission) => permission.code === "identity.users.disable",
);
for (const guard of [
  "eligible_platform_superadmin_count_after_at_least_two_if_subject_has_role",
  "eligible_crm_admin_count_after_at_least_one_if_subject_has_role",
  "eligible_project_admin_count_after_at_least_one_if_subject_has_role",
  "replacement_assigned_before_disable_if_privileged",
  "critical_if_subject_privileged",
  "no_orphaned_critical_approvals",
  "reassign_operational_ownership_before_disable",
]) {
  if (!disableUserPermission?.guards?.includes(guard)) {
    failures.push(`identity.users.disable lacks privileged-lifecycle guard: ${guard}`);
  }
}
if (!criticalConditions.has("identity.users.disable|subject_is_privileged")) {
  failures.push("identity.users.disable must be critical for the exact typed privileged set");
}

const markdownPermissionCodes = [
  ...readText(files.policyDoc).matchAll(/`([a-z][a-z0-9_.]+\.[a-z0-9_.]+)`/g),
]
  .map((match) => match[1])
  .filter((code) => !code.endsWith(".*"));
for (const permission of new Set(markdownPermissionCodes)) {
  if (!permissionSet.has(permission)) {
    failures.push(`human-readable policy references unknown permission: ${permission}`);
  }
}
const policyMachineHash = sha256Text(readText(files.policy));
if (!readText(files.policyDoc).includes(policyMachineHash)) {
  failures.push("human authorization catalog is not pinned to current machine JSON hash");
}
const transitionMachineHash = sha256Text(readText(files.transitions));
const transitionDocPath = "docs/cabinet/07-state-transition-catalog.md";
if (!readText(transitionDocPath).includes(transitionMachineHash)) {
  failures.push("human transition catalog is not pinned to current machine JSON hash");
}
const referencedPermissions = new Set(collectTransitionPermissions(transitions));
for (const permission of referencedPermissions) {
  if (!permissionSet.has(permission)) {
    failures.push(`transition references unknown permission: ${permission}`);
  }
}

for (const [machineName, machine] of Object.entries(transitions.state_machines ?? {})) {
  const states = machine.states ?? [];
  assertUnique(states, `${machineName} state`);
  const stateSet = new Set(states);
  if (!states.length) failures.push(`state machine has no states: ${machineName}`);
  if (!stateSet.has(machine.initial_state)) {
    failures.push(`${machineName} initial_state is unknown: ${machine.initial_state}`);
  }
  const terminalStates = new Set(machine.terminal_states ?? []);
  for (const terminalState of terminalStates) {
    if (!stateSet.has(terminalState)) {
      failures.push(`${machineName} terminal state is unknown: ${terminalState}`);
    }
  }

  const groups = machine.state_sets ?? {};
  for (const [groupName, members] of Object.entries(groups)) {
    if (!Array.isArray(members) || !members.length) {
      failures.push(`${machineName} state set is empty: ${groupName}`);
      continue;
    }
    assertUnique(members, `${machineName}.${groupName} state-set member`);
    for (const member of members) {
      if (!stateSet.has(member)) {
        failures.push(`${machineName}.${groupName} references unknown state: ${member}`);
      }
    }
  }

  const inbound = new Set();
  const outbound = new Set();
  const expandedPairs = new Set();
  for (const [index, transition] of (machine.transitions ?? []).entries()) {
    if (
      typeof transition.permission !== "string" ||
      !transition.permission ||
      !permissionSet.has(transition.permission)
    ) {
      failures.push(`${machineName} transition ${index} lacks a registered permission`);
    }
    const hasFrom = Object.hasOwn(transition, "from");
    const hasFromSet = Object.hasOwn(transition, "from_set");
    const hasTo = Object.hasOwn(transition, "to");
    const hasToSet = Object.hasOwn(transition, "to_set");
    if (Number(hasFrom) + Number(hasFromSet) !== 1) {
      failures.push(`${machineName} transition ${index} must define exactly one from/from_set`);
      continue;
    }
    if (Number(hasTo) + Number(hasToSet) !== 1) {
      failures.push(`${machineName} transition ${index} must define exactly one to/to_set`);
      continue;
    }

    const fromStates = hasFromSet ? groups[transition.from_set] : [transition.from];
    const toStates = hasToSet ? groups[transition.to_set] : [transition.to];
    if (hasFromSet && !fromStates) {
      failures.push(`${machineName} transition ${index} references unknown from_set: ${transition.from_set}`);
      continue;
    }
    if (hasToSet && !toStates) {
      failures.push(`${machineName} transition ${index} references unknown to_set: ${transition.to_set}`);
      continue;
    }
    if (hasToSet && (!transition.target_state_field || !transition.target_guard)) {
      failures.push(`${machineName} transition ${index} to_set requires target_state_field and target_guard`);
    }
    for (const scalar of [transition.from, transition.to]) {
      if (typeof scalar === "string" && (scalar.includes("*") || scalar.includes("|"))) {
        failures.push(`${machineName} transition ${index} contains forbidden wildcard/composite: ${scalar}`);
      }
    }
    for (const fromState of fromStates ?? []) {
      if (fromState !== null && !stateSet.has(fromState)) {
        failures.push(`${machineName} transition ${index} has unknown from state: ${fromState}`);
      }
      for (const toState of toStates ?? []) {
        if (!stateSet.has(toState)) {
          failures.push(`${machineName} transition ${index} has unknown to state: ${toState}`);
          continue;
        }
        if (fromState === null && toState !== machine.initial_state) {
          failures.push(`${machineName} creation transition must target initial_state`);
        }
        if (fromState === toState && transition.allow_self_transition !== true) {
          failures.push(`${machineName} transition ${index} has undeclared self-transition: ${toState}`);
        }
        const pair = `${fromState ?? "<new>"}->${toState}`;
        if (expandedPairs.has(pair)) {
          failures.push(`${machineName} has duplicate expanded transition: ${pair}`);
        }
        expandedPairs.add(pair);
        inbound.add(toState);
        if (fromState !== null) outbound.add(fromState);
      }
    }
  }
  for (const state of states) {
    if (state !== machine.initial_state && !inbound.has(state)) {
      failures.push(`${machineName} state has no inbound transition: ${state}`);
    }
    if (!terminalStates.has(state) && !outbound.has(state)) {
      failures.push(`${machineName} nonterminal state has no outbound transition: ${state}`);
    }
    if (terminalStates.has(state) && outbound.has(state)) {
      failures.push(`${machineName} terminal state has outbound transition: ${state}`);
    }
  }
}

const userAccountTransitions = transitions.state_machines?.user_account_state?.transitions ?? [];
const disableAccountTransition = userAccountTransitions.find(
  (transition) => transition.from === "active" && transition.to === "disabled",
);
const archiveAccountTransition = userAccountTransitions.find(
  (transition) => transition.from_set === "archivable" && transition.to === "archived",
);
const requiredPrivilegedDisableArchiveGuards = [
  "eligible_platform_superadmin_count_after_at_least_two_if_subject_has_role",
  "eligible_crm_admin_count_after_at_least_one_if_subject_has_role",
  "eligible_project_admin_count_after_at_least_one_if_subject_has_role",
  "replacement_assigned_before_disable_if_privileged",
  "critical_approval_if_subject_is_privileged",
  "no_orphaned_critical_approvals",
];
for (const [label, transition] of [
  ["active-to-disabled", disableAccountTransition],
  ["archivable-to-archived", archiveAccountTransition],
]) {
  if (
    !transition ||
    transition.permission !== "identity.users.disable" ||
    !requiredPrivilegedDisableArchiveGuards.every((guard) =>
      transition.required?.includes(guard),
    )
  ) {
    failures.push(`user account ${label} transition lacks exact privileged guards`);
  }
}

if (policy.default !== "deny" || policy.unregistered_operation !== "deny") {
  failures.push("authorization policy must deny unregistered operations");
}
if (!policy.bootstrap?.production_people_required || policy.bootstrap.production_people_required < 2) {
  failures.push("production bootstrap must require two people");
}
const domainBootstrap = policy.bootstrap?.domain_bootstrap;
if (!domainBootstrap || domainBootstrap.critical_approval_required !== true) {
  failures.push("domain bootstrap must be defined and require critical approval");
} else {
  const expectedDomainBootstrap = {
    crm: {
      operation: "AssignInitialCrmAdmin",
      permission: "identity.roles.assign_initial_crm_admin",
      zeroGuard: "crm_admin_count == 0",
    },
    project: {
      operation: "AssignInitialProjectAdmin",
      permission: "identity.roles.assign_initial_project_admin",
      zeroGuard: "project_admin_count == 0",
    },
  };
  for (const [domain, expected] of Object.entries(expectedDomainBootstrap)) {
    const rule = domainBootstrap[domain];
    if (!rule) {
      failures.push(`missing ${domain} first-admin bootstrap rule`);
      continue;
    }
    if (rule.operation !== expected.operation || rule.permission !== expected.permission) {
      failures.push(`${domain} first-admin bootstrap operation/permission mismatch`);
    }
    if (rule.enabled_when !== expected.zeroGuard) {
      failures.push(`${domain} first-admin bootstrap must require zero existing domain admins`);
    }
    if (!String(rule.approver).includes("different_eligible_platform_superadmin")) {
      failures.push(`${domain} first-admin bootstrap requires a distinct eligible approver`);
    }
    if (!String(rule.closes_irreversibly_when).includes(">= 1")) {
      failures.push(`${domain} first-admin bootstrap must close irreversibly after first admin`);
    }
    const owners = operationOwners.get(expected.operation) ?? [];
    if (owners.length !== 1 || owners[0] !== expected.permission) {
      failures.push(`${domain} first-admin bootstrap operation lacks its dedicated permission`);
    }
    if (!criticalPermissionCodes.has(expected.permission)) {
      failures.push(`${domain} first-admin bootstrap permission is not critical`);
    }
  }
  if (domainBootstrap.self_assignment !== "deny") {
    failures.push("domain bootstrap self-assignment must be denied");
  }
}
const domainAdminLifecycle = policy.bootstrap?.domain_admin_lifecycle;
if (
  !domainAdminLifecycle ||
  domainAdminLifecycle.ordinary_assignment_forbids_domain_admin !== true ||
  domainAdminLifecycle.self_assignment !== "deny"
) {
  failures.push("post-bootstrap domain-admin lifecycle must be explicit and deny bypass/self-assignment");
} else {
  const expectedDomainAdminLifecycle = {
    crm: {
      operation: "AssignCrmAdminRole",
      permission: "identity.roles.assign_crm_admin",
      guard: "crm_admin_count >= 1",
      approver: "different_eligible_crm_admin",
    },
    project: {
      operation: "AssignProjectAdminRole",
      permission: "identity.roles.assign_project_admin",
      guard: "project_admin_count >= 1",
      approver: "different_eligible_project_admin",
    },
  };
  for (const [domain, expected] of Object.entries(expectedDomainAdminLifecycle)) {
    const rule = domainAdminLifecycle[domain];
    if (
      !rule ||
      rule.operation !== expected.operation ||
      rule.permission !== expected.permission ||
      rule.enabled_when !== expected.guard ||
      rule.approver !== expected.approver ||
      rule.critical_approval_required !== true ||
      JSON.stringify(rule.subject_must_differ_from) !== JSON.stringify(["proposer", "approver"])
    ) {
      failures.push(`${domain} post-bootstrap admin assignment lifecycle is incomplete`);
      continue;
    }
    const owners = operationOwners.get(expected.operation) ?? [];
    if (owners.length !== 1 || owners[0] !== expected.permission) {
      failures.push(`${domain} post-bootstrap admin operation lacks its dedicated permission`);
    }
    if (!criticalPermissionCodes.has(expected.permission)) {
      failures.push(`${domain} post-bootstrap admin permission is not critical`);
    }
  }
  const expectedRevocations = {
    revoke_platform: {
      operation: "RevokePlatformRole",
      permission: "identity.roles.revoke_platform",
      guard: "eligible_platform_superadmin_count_after >= 2",
      approver: "different_eligible_platform_superadmin",
    },
    revoke_crm: {
      operation: "RevokeCrmAdminRole",
      permission: "identity.roles.revoke_crm_admin",
      guard: "eligible_crm_admin_count_after >= 1",
      approver: "different_eligible_crm_admin",
    },
    revoke_project: {
      operation: "RevokeProjectAdminRole",
      permission: "identity.roles.revoke_project_admin",
      guard: "eligible_project_admin_count_after >= 1",
      approver: "different_eligible_project_admin",
    },
  };
  for (const [ruleName, expected] of Object.entries(expectedRevocations)) {
    const rule = domainAdminLifecycle[ruleName];
    if (
      !rule ||
      rule.operation !== expected.operation ||
      rule.permission !== expected.permission ||
      rule.enabled_when !== expected.guard ||
      rule.approver !== expected.approver ||
      rule.critical_approval_required !== true ||
      rule.replacement_first !== true ||
      JSON.stringify(rule.subject_must_differ_from) !== JSON.stringify(["proposer", "approver"])
    ) {
      failures.push(`${ruleName} privileged-role revocation lifecycle is incomplete`);
      continue;
    }
    const owners = operationOwners.get(expected.operation) ?? [];
    if (owners.length !== 1 || owners[0] !== expected.permission) {
      failures.push(`${ruleName} privileged-role revocation lacks its dedicated permission`);
    }
    if (!criticalPermissionCodes.has(expected.permission)) {
      failures.push(`${ruleName} privileged-role revocation is not critical`);
    }
  }
}

const roleLifecycle = policy.role_lifecycle;
const expectedOrdinaryRoleLifecycles = {
  crm: {
    assignOperation: "AssignCrmRole",
    assignPermission: "identity.roles.assign_crm",
    revokeOperation: "RevokeCrmRole",
    revokePermission: "identity.roles.revoke_crm",
    allowedRoles: ["crm_project_manager", "crm_lead_specialist", "crm_department_head"],
    forbiddenRoles: ["crm_admin"],
    domainGuard: "target_role_not_crm_admin",
    orphanGuard: "no_orphaned_operational_responsibility",
  },
  project: {
    assignOperation: "AssignProjectRole",
    assignPermission: "identity.roles.assign_project",
    revokeOperation: "RevokeProjectRole",
    revokePermission: "identity.roles.revoke_project",
    allowedRoles: ["project_direction_lead", "project_manager", "project_executor"],
    forbiddenRoles: ["project_admin"],
    domainGuard: "target_role_not_project_admin",
    orphanGuard: "no_orphaned_operational_responsibility",
  },
  migration: {
    assignOperation: "AssignMigrationRole",
    assignPermission: "identity.roles.assign_migration",
    revokeOperation: "RevokeMigrationRole",
    revokePermission: "identity.roles.revoke_migration",
    allowedRoles: ["migration_operator"],
    forbiddenRoles: [],
    critical: true,
    orphanGuard: "no_orphaned_critical_approvals",
    transferGuard: "transfer_active_migration_runs_before_revoke",
  },
  audit: {
    assignOperation: "AssignAuditRole",
    assignPermission: "identity.roles.assign_audit",
    revokeOperation: "RevokeAuditRole",
    revokePermission: "identity.roles.revoke_audit",
    allowedRoles: ["audit_reader"],
    forbiddenRoles: [],
    critical: true,
    orphanGuard: "no_orphaned_critical_approvals",
    transferGuard: "transfer_active_audit_scope_before_revoke",
  },
};
if (!roleLifecycle?.ordinary_roles) {
  failures.push("ordinary role lifecycle is missing");
} else {
  const commonRoleMutationGuards = [
    "actor_not_subject",
    "reason",
    "effective_access_preview",
    "expected_version",
    "privileged_session_recalculation_or_revoke",
  ];
  for (const [domain, expected] of Object.entries(expectedOrdinaryRoleLifecycles)) {
    const lifecycle = roleLifecycle.ordinary_roles[domain];
    if (
      !lifecycle ||
      lifecycle.assign_operation !== expected.assignOperation ||
      lifecycle.assign_permission !== expected.assignPermission ||
      lifecycle.revoke_operation !== expected.revokeOperation ||
      lifecycle.revoke_permission !== expected.revokePermission ||
      JSON.stringify(lifecycle.allowed_roles) !== JSON.stringify(expected.allowedRoles) ||
      JSON.stringify(lifecycle.forbidden_roles ?? []) !== JSON.stringify(expected.forbiddenRoles) ||
      Boolean(lifecycle.critical_approval_required) !== Boolean(expected.critical)
    ) {
      failures.push(`${domain} ordinary role assign/revoke lifecycle is incomplete`);
      continue;
    }
    for (const [operation, permissionCode] of [
      [expected.assignOperation, expected.assignPermission],
      [expected.revokeOperation, expected.revokePermission],
    ]) {
      const owners = operationOwners.get(operation) ?? [];
      if (owners.length !== 1 || owners[0] !== permissionCode) {
        failures.push(`${domain} role lifecycle operation lacks dedicated permission: ${operation}`);
      }
      const permission = permissionByCode.get(permissionCode);
      for (const guard of [...commonRoleMutationGuards, expected.orphanGuard]) {
        if (!permission?.guards?.includes(guard)) {
          failures.push(`${permissionCode} lacks role-mutation guard: ${guard}`);
        }
      }
      if (expected.domainGuard && !permission?.guards?.includes(expected.domainGuard)) {
        failures.push(`${permissionCode} can bypass the domain-admin lifecycle`);
      }
      if (expected.critical && !criticalConditions.has(`${permissionCode}|always`)) {
        failures.push(`${permissionCode} must always use critical approval`);
      }
    }
    if (
      expected.transferGuard &&
      !permissionByCode.get(expected.revokePermission)?.guards?.includes(expected.transferGuard)
    ) {
      failures.push(`${expected.revokePermission} lacks ownership-transfer guard`);
    }
  }
}
const roleReplacementSemantics = roleLifecycle?.set_replacement_semantics;
for (const contractField of [
  "explicit_removal_operation_required",
  "implicit_role_disappearance_forbidden",
  "reason_required",
  "effective_access_preview_required",
  "expected_version_required",
  "before_after_audit_required",
  "privileged_session_recalculation_or_revoke_required",
  "orphaned_responsibility_or_approval_forbidden",
]) {
  if (roleReplacementSemantics?.[contractField] !== true) {
    failures.push(`role replacement semantics missing: ${contractField}`);
  }
}
const expectedRoleAuditFields = [
  "actor_id",
  "subject_id",
  "domain",
  "role",
  "scope_before",
  "scope_after",
  "operation",
  "reason",
  "policy_version",
  "approval_request_id_if_critical",
  "occurred_at",
];
if (
  roleLifecycle?.audit_event?.event_type !== "identity.role_assignment_changed" ||
  roleLifecycle?.audit_event?.evidence_id !== "AUD-SA-ROLE-001" ||
  JSON.stringify(roleLifecycle?.audit_event?.required_fields) !==
    JSON.stringify(expectedRoleAuditFields)
) {
  failures.push("ordinary role lifecycle audit contract is incomplete");
}

const requirementsRows = parseCsv(readText(files.requirements), files.requirements);
const expectedRequirementHeaders = [
  "requirement_id",
  "class",
  "surface",
  "operation",
  "positive_test_id",
  "forbidden_test_id",
  "persisted_evidence",
  "audit_evidence",
  "migration_query",
  "visual_reference",
  "status",
];
const requirementHeaders = requirementsRows[0] ?? [];
if (JSON.stringify(requirementHeaders) !== JSON.stringify(expectedRequirementHeaders)) {
  failures.push("requirements crosswalk headers do not match the evidence contract");
}
for (const [index, row] of requirementsRows.slice(1).entries()) {
  if (row.length !== expectedRequirementHeaders.length) {
    failures.push(`requirements row ${index + 2} has ${row.length} columns`);
  }
  if (row.some((value) => value === "")) {
    failures.push(`requirements row ${index + 2} contains an empty cell`);
  }
  for (const operation of splitPipe(row[3])) {
    if (isNotApplicable(operation)) continue;
    const owners = operationOwners.get(operation) ?? [];
    if (owners.length !== 1) {
      failures.push(
        `crosswalk ${row[0]} operation ${operation} has ${owners.length} permission owners`,
      );
    }
  }
}
const requirementIds = requirementsRows.slice(1).map((row) => row[0]);
assertUnique(requirementIds, "requirement ID");
const sa03Requirement = requirementsRows.slice(1).find((row) => row[0] === "SA-03");
const expectedSa03Operations = [
  "AssignCrmRole",
  "RevokeCrmRole",
  "AssignProjectRole",
  "RevokeProjectRole",
  "AssignMigrationRole",
  "RevokeMigrationRole",
  "AssignAuditRole",
  "RevokeAuditRole",
];
const expectedSa03RoleLifecycleTests = [
  "E2E-ROLE-CRM-ORDINARY-REVOKE-001",
  "E2E-ROLE-PROJECT-ORDINARY-REVOKE-001",
  "E2E-ROLE-MIGRATION-REVOKE-001",
  "E2E-ROLE-AUDIT-REVOKE-001",
];
if (
  !sa03Requirement ||
  !expectedSa03Operations.every((operation) => splitPipe(sa03Requirement[3]).includes(operation)) ||
  !expectedSa03RoleLifecycleTests.every((testId) =>
    splitPipe(sa03Requirement[4]).includes(testId),
  ) ||
  !sa03Requirement[6].includes("assignment/removal") ||
  !sa03Requirement[6].includes("policy version") ||
  !sa03Requirement[6].includes("before/after effective access") ||
  sa03Requirement[7] !== "AUD-SA-ROLE-001"
) {
  failures.push("SA-03 crosswalk lacks symmetric role lifecycle evidence");
}

const evidenceCollections = {
  tests: evidenceRegistry.tests ?? [],
  audit_evidence: evidenceRegistry.audit_evidence ?? [],
  migration_queries: evidenceRegistry.migration_queries ?? [],
};
for (const [collectionName, entries] of Object.entries(evidenceCollections)) {
  assertUnique(
    entries.map((entry) => entry.id),
    `${collectionName} evidence ID`,
  );
  for (const entry of entries) {
    if (!/^[A-Z][A-Z0-9-]+$/.test(entry.id ?? "")) {
      failures.push(`invalid ${collectionName} evidence ID: ${entry.id}`);
    }
    if (!entry.requirements?.length) {
      failures.push(`${collectionName} evidence ID has no requirement: ${entry.id}`);
    }
  }
}
const evidenceSets = Object.fromEntries(
  Object.entries(evidenceCollections).map(([name, entries]) => [
    name,
    new Set(entries.map((entry) => entry.id)),
  ]),
);
const roleAuditEvidence = (evidenceRegistry.audit_evidence ?? []).find(
  (entry) => entry.id === "AUD-SA-ROLE-001",
);
if (
  roleAuditEvidence?.event_type !== "identity.role_assignment_changed" ||
  JSON.stringify(roleAuditEvidence?.required_fields) !== JSON.stringify(expectedRoleAuditFields)
) {
  failures.push("AUD-SA-ROLE-001 does not implement the role-lifecycle audit contract");
}
for (const testId of [
  ...(policy.bootstrap?.domain_bootstrap?.e2e_tests ?? []),
  ...(policy.bootstrap?.domain_admin_lifecycle?.e2e_tests ?? []),
  ...(policy.role_lifecycle?.e2e_tests ?? []),
]) {
  if (!evidenceSets.tests.has(testId)) {
    failures.push(`authorization lifecycle references unknown E2E evidence: ${testId}`);
  }
}
const requirementFieldIndexes = Object.fromEntries(
  expectedRequirementHeaders.map((header, index) => [header, index]),
);
for (const row of requirementsRows.slice(1)) {
  for (const [field, collectionName] of [
    ["positive_test_id", "tests"],
    ["forbidden_test_id", "tests"],
    ["audit_evidence", "audit_evidence"],
    ["migration_query", "migration_queries"],
  ]) {
    for (const value of splitPipe(row[requirementFieldIndexes[field]])) {
      if (isNotApplicable(value)) continue;
      if (!evidenceSets[collectionName].has(value)) {
        failures.push(`crosswalk ${row[0]} references unknown ${field}: ${value}`);
      }
    }
  }
  for (const field of ["operation", "audit_evidence", "migration_query", "visual_reference"]) {
    const value = row[requirementFieldIndexes[field]];
    if (value === "N/A") {
      failures.push(`crosswalk ${row[0]} ${field} must use N/A(reason)`);
    }
  }
}
const exemptionKeys = new Set(
  (evidenceRegistry.exemptions ?? []).map(
    (entry) => `${entry.requirement_id}:${entry.field}:${entry.reason}`,
  ),
);
for (const row of requirementsRows.slice(1)) {
  for (const field of ["operation", "audit_evidence", "migration_query", "visual_reference"]) {
    const value = row[requirementFieldIndexes[field]];
    if (isNotApplicable(value)) {
      const key = `${row[0]}:${field}:${value.slice(4, -1)}`;
      if (!exemptionKeys.has(key)) {
        failures.push(`crosswalk exemption is not registered: ${key}`);
      }
    }
  }
}

const sourceRows = parseCsv(readText(files.sourceInventory), files.sourceInventory);
const sourceHeaders = sourceRows[0] ?? [];
const tableColumn = sourceHeaders.indexOf("table");
const rowCountColumn = sourceHeaders.indexOf("rows");
const sourceCounts = new Map(
  sourceRows.slice(1).map((row) => [row[tableColumn], Number(row[rowCountColumn])]),
);
const schemaTables = schemaInventory.tables ?? {};
const migrationQueryEntries = migrationQueries.queries ?? [];
assertUnique(
  migrationQueryEntries.map((query) => query.query_id),
  "migration query ID",
);
const migrationQueryById = new Map(
  migrationQueryEntries.map((query) => [query.query_id, query]),
);
for (const query of migrationQueryEntries) {
  if (!query.query_kind || !query.expected_rule?.operator) {
    failures.push(`migration query lacks kind/expected rule: ${query.query_id}`);
  }
  if (query.query_kind === "source_extract") {
    const hasPredicate = typeof query.selection_predicate_sql === "string";
    const hasClassifier = typeof query.classifier_id === "string";
    if (hasPredicate === hasClassifier) {
      failures.push(
        `source query must have exactly one executable predicate or versioned classifier: ${query.query_id}`,
      );
    }
    for (const field of [
      "expected_selected_rows",
      "expected_excluded_rows",
      "expected_conflict_rows",
      "expected_source_rows",
    ]) {
      if (!Number.isInteger(query[field]) || query[field] < 0) {
        failures.push(`source query has invalid ${field}: ${query.query_id}`);
      }
    }
    if (
      query.expected_selected_rows +
        query.expected_excluded_rows +
        query.expected_conflict_rows !==
      query.expected_source_rows
    ) {
      failures.push(`source query classifier balance mismatch: ${query.query_id}`);
    }
    if (
      query.classification_balance?.selected_rows !== query.expected_selected_rows ||
      query.classification_balance?.excluded_rows !== query.expected_excluded_rows ||
      query.classification_balance?.conflict_rows !== query.expected_conflict_rows ||
      query.classification_balance?.baseline_rows !== query.expected_source_rows
    ) {
      failures.push(`source query classification contract mismatch: ${query.query_id}`);
    }
    if (
      !Array.isArray(query.extraction_columns) ||
      !Array.isArray(query.canonical_selected_columns) ||
      !Array.isArray(query.quarantine_columns)
    ) {
      failures.push(`source query column contracts missing: ${query.query_id}`);
    } else {
      assertUnique(query.extraction_columns, `${query.query_id} extraction column`);
      for (const column of [
        ...query.canonical_selected_columns,
        ...query.quarantine_columns,
      ]) {
        if (!query.extraction_columns.includes(column)) {
          failures.push(`source query extraction omits contracted column: ${query.query_id}.${column}`);
        }
      }
    }
    if (
      hasPredicate &&
      (!query.classification_count_sql ||
        !query.classification_count_sql_sha256 ||
        !query.count_sql)
    ) {
      failures.push(`predicate source query lacks executable count SQL: ${query.query_id}`);
    }
    if (
      hasClassifier &&
      (!/-v\d+$/.test(query.classifier_id) || !query.classifier_executor_id)
    ) {
      failures.push(`source query classifier is not versioned/executable: ${query.query_id}`);
    }
  }
}
const classifierEntries = migrationQueries.classifier_registry ?? [];
assertUnique(
  classifierEntries.map((entry) => entry.classifier_id),
  "migration classifier ID",
);
const classifierIds = new Set(classifierEntries.map((entry) => entry.classifier_id));
for (const query of migrationQueryEntries.filter(
  (entry) => entry.query_kind === "source_extract" && entry.classifier_id,
)) {
  if (!classifierIds.has(query.classifier_id)) {
    failures.push(`source query references unregistered classifier: ${query.query_id}`);
  }
}
if (
  migrationQueries.source_extract_query_count !== 57 ||
  migrationQueries.requirement_evidence_query_count !== 28 ||
  migrationQueries.coverage_denominator !== 438424 ||
  migrationQueries.classifier_count !== classifierEntries.length
) {
  failures.push("migration query registry count/denominator contract mismatch");
}
for (const entry of evidenceRegistry.migration_queries ?? []) {
  if (!migrationQueryById.has(entry.id)) {
    failures.push(`evidence registry migration query is not executable/typed: ${entry.id}`);
  }
}
const targetEntries = targetModel.targets ?? [];
assertUnique(
  targetEntries.map((target) => target.id),
  "target model ID",
);
const targetIds = new Set(targetEntries.map((target) => target.id));
const targetAliasMap = new Map(
  (targetModel.source_field_target_aliases ?? []).map((entry) => [
    entry.alias,
    entry.canonical_id,
  ]),
);
for (const forbiddenTarget of ["person", "identity.employee_unit", "crm.subject", "platform.subject"]) {
  if (targetIds.has(forbiddenTarget)) {
    failures.push(`target model contains obsolete/abstract target ID: ${forbiddenTarget}`);
  }
}
const requiredPeriodedRelations = [
  "identity.organization_unit_head",
  "identity.employee_unit_membership",
  "crm.crm_profile_assignment",
  "crm.case_assignment",
  "crm.employer_assignment",
  "crm.employer_referral_assignment",
  "crm.task_assignment",
  "project.task_assignment",
];
const requiredRelationFields = [
  "subject_id",
  "actor_id",
  "actor_kind",
  "role",
  "valid_from",
  "valid_to",
  "source_table",
  "source_key",
  "provenance",
];
for (const relationId of requiredPeriodedRelations) {
  const relation = targetEntries.find((target) => target.id === relationId);
  if (!relation || relation.kind !== "relation") {
    failures.push(`missing canonical perioded relation: ${relationId}`);
    continue;
  }
  for (const field of requiredRelationFields) {
    if (!relation.required_fields?.includes(field)) {
      failures.push(`perioded relation ${relationId} missing required field: ${field}`);
    }
  }
  if (
    !relation.valid_from_policy ||
    !relation.valid_to_policy ||
    !relation.operational_owner_roles ||
    !relation.historical_actor_roles
  ) {
    failures.push(`perioded relation ${relationId} lacks temporal/actor semantics`);
  }
}
const organizationUnitHead = targetEntries.find(
  (target) => target.id === "identity.organization_unit_head",
);
const organizationHeadBinding = organizationUnitHead?.source_bindings?.find(
  (binding) => binding.source_table === "b_uts_iblock_3_section",
);
if (
  !organizationUnitHead?.allowed_roles?.includes("head") ||
  organizationHeadBinding?.subject_column !== "VALUE_ID" ||
  organizationHeadBinding?.actor_column !== "UF_HEAD" ||
  organizationHeadBinding?.fixed_role !== "head"
) {
  failures.push("identity.organization_unit_head lacks exact perioded head/source binding");
}
const taskMemberTypeMap =
  migrationManifest.legacy_relation_type_maps?.["b_tasks_member.TYPE"];
const expectedTaskMemberTypes = {
  A: ["co_executor", 9, "operational_owner"],
  O: ["originator", 89, "historical_actor"],
  R: ["responsible", 89, "operational_owner"],
};
for (const [sourceType, [role, count, actorSemantics]] of Object.entries(
  expectedTaskMemberTypes,
)) {
  const mapping = taskMemberTypeMap?.mappings?.[sourceType];
  if (
    mapping?.role !== role ||
    mapping?.baseline_count !== count ||
    mapping?.actor_semantics !== actorSemantics ||
    mapping?.target_relation_by_task_domain?.crm !== "crm.task_assignment" ||
    mapping?.target_relation_by_task_domain?.project !== "project.task_assignment" ||
    mapping?.unresolved_task_domain_outcome !== "conflict_recorded"
  ) {
    failures.push(`b_tasks_member.TYPE ${sourceType} mapping is incomplete`);
  }
}
if (
  taskMemberTypeMap?.baseline_total !== 187 ||
  taskMemberTypeMap?.unknown?.baseline_count !== 0 ||
  taskMemberTypeMap?.unknown?.blocking !== true
) {
  failures.push("b_tasks_member.TYPE coverage/unknown blocking contract is incomplete");
}
if (
  taskMemberTypeMap?.task_domain_contract_ref !==
    "migration-scope-manifest.json#/legacy_task_domain_contract" ||
  migrationManifest.legacy_task_domain_contract?.classifier_id !==
    "legacy-task-domain-v1"
) {
  failures.push("b_tasks_member.TYPE mappings do not inherit the versioned task-domain classifier");
}

const manifestEntities = migrationManifest.entities ?? [];
assertUnique(
  manifestEntities.map((entity) => entity.source_table),
  "manifest source table",
);
const manifestByTable = new Map(
  manifestEntities.map((entity) => [entity.source_table, entity]),
);
for (const entity of manifestEntities) {
  const sourceCount = sourceCounts.get(entity.source_table);
  const schemaTable = schemaTables[entity.source_table];
  if (sourceCount === undefined) {
    failures.push(`manifest table absent from source inventory: ${entity.source_table}`);
  } else if (sourceCount !== entity.baseline_count) {
    failures.push(
      `manifest count mismatch ${entity.source_table}: ${entity.baseline_count} != ${sourceCount}`,
    );
  }
  if (!schemaTable) {
    failures.push(`manifest table absent from schema inventory: ${entity.source_table}`);
    continue;
  }
  const schemaColumnNames = new Set(schemaTable.columns.map((column) => column.name));
  const selectedColumns = entity.selected_columns ?? [];
  const explicitExcludedColumns = entity.excluded_columns ?? [];
  const quarantineColumns = entity.quarantine_columns ?? [];
  const coveredMirrorColumns = entity.covered_mirror_columns ?? [];
  assertUnique(selectedColumns, `${entity.source_table} selected column`);
  assertUnique(explicitExcludedColumns, `${entity.source_table} explicit excluded column`);
  assertUnique(quarantineColumns, `${entity.source_table} quarantine column`);
  assertUnique(coveredMirrorColumns, `${entity.source_table} covered mirror column`);
  for (const column of [
    ...selectedColumns,
    ...explicitExcludedColumns,
    ...quarantineColumns,
    ...coveredMirrorColumns,
  ]) {
    if (
      column.includes("*") ||
      /\s/.test(column) ||
      /approved|allowlist|placeholder/i.test(column)
    ) {
      failures.push(`${entity.source_table} contains placeholder/wildcard column: ${column}`);
    }
    if (!schemaColumnNames.has(column)) {
      failures.push(`${entity.source_table} references unknown schema column: ${column}`);
    }
  }
  for (const column of selectedColumns) {
    if (
      explicitExcludedColumns.includes(column) ||
      quarantineColumns.includes(column) ||
      coveredMirrorColumns.includes(column)
    ) {
      failures.push(`${entity.source_table} column has overlapping dispositions: ${column}`);
    }
  }
  if (!entity.source_key?.columns?.length) {
    failures.push(`manifest source key missing: ${entity.source_table}`);
  } else {
    const actualKeyColumns = entity.source_key.columns;
    let expectedKeyColumns = [];
    if (entity.source_key.kind === "primary_key") {
      expectedKeyColumns = (schemaTable.primary_key?.columns ?? []).map((column) => column.name);
    } else if (entity.source_key.kind === "unique_index") {
      const uniqueKey = (schemaTable.unique_keys ?? []).find(
        (key) => key.name === entity.source_key.constraint,
      );
      expectedKeyColumns = (uniqueKey?.columns ?? []).map((column) => column.name);
    } else {
      failures.push(`${entity.source_table} has unsupported source key kind`);
    }
    if (JSON.stringify(actualKeyColumns) !== JSON.stringify(expectedKeyColumns)) {
      failures.push(
        `${entity.source_table} source key does not match schema ${entity.source_key.kind}`,
      );
    }
    if (
      entity.primary_key &&
      JSON.stringify(entity.primary_key) !== JSON.stringify(actualKeyColumns)
    ) {
      failures.push(`${entity.source_table} legacy primary_key disagrees with source_key`);
    }
  }
  if (!entity.transform_version) failures.push(`manifest transform missing: ${entity.source_table}`);
  if (!entity.reconciliation) failures.push(`manifest reconciliation missing: ${entity.source_table}`);
  if (entity.coverage_scope !== "all_source_rows") {
    failures.push(`${entity.source_table} must account for all source rows`);
  }
  if (entity.expected_row_outcomes !== entity.baseline_count) {
    failures.push(`${entity.source_table} expected_row_outcomes must equal baseline_count`);
  }
  if (
    !Number.isInteger(entity.selection_baseline_count) ||
    !Number.isInteger(entity.selection_excluded_baseline_count) ||
    !Number.isInteger(entity.selection_conflict_baseline_count) ||
    entity.selection_baseline_count < 0 ||
    entity.selection_excluded_baseline_count < 0 ||
    entity.selection_conflict_baseline_count < 0 ||
    entity.selection_baseline_count +
      entity.selection_excluded_baseline_count +
      entity.selection_conflict_baseline_count !==
      entity.baseline_count
  ) {
    failures.push(`${entity.source_table} has invalid exact row-classification baseline`);
  }
  const query = migrationQueryById.get(entity.migration_query_id);
  if (!query) {
    failures.push(`${entity.source_table} references unknown migration query`);
  } else if (
    query.source_table !== entity.source_table ||
    query.expected_source_rows !== entity.baseline_count ||
    query.expected_row_outcomes !== entity.baseline_count ||
    query.expected_selected_rows !== entity.selection_baseline_count ||
    query.expected_excluded_rows !== entity.selection_excluded_baseline_count ||
    query.expected_conflict_rows !== entity.selection_conflict_baseline_count ||
    query.source_disposition !== entity.source_disposition
  ) {
    failures.push(`${entity.source_table} migration query contract mismatch`);
  }
  for (const target of entity.target ?? []) {
    if (!targetIds.has(target)) {
      failures.push(`${entity.source_table} references unknown target model ID: ${target}`);
    }
  }
}
if (manifestEntities.length !== 57) {
  failures.push(`migration manifest must contain 57 ledger tables, found ${manifestEntities.length}`);
}
const manifestOutcomeDenominator = manifestEntities.reduce(
  (total, entity) => total + Number(entity.expected_row_outcomes ?? 0),
  0,
);
if (manifestOutcomeDenominator !== 438424) {
  failures.push(`migration row-outcome denominator must be 438424, found ${manifestOutcomeDenominator}`);
}
if (
  migrationManifest.global_rules?.coverage_denominator_rows !== 438424 ||
  migrationManifest.row_outcome_contract?.coverage_denominator !== 438424 ||
  migrationManifest.global_rules?.ledger_source_tables !== 57 ||
  migrationManifest.global_rules?.included_source_tables !== 55 ||
  migrationManifest.global_rules?.quarantine_source_tables !== 2
) {
  failures.push("migration manifest ledger/include/quarantine denominator contract is incomplete");
}
const fileMigrationContract = migrationManifest.file_migration_contract ?? {};
const fullFileMode = fileMigrationContract.modes?.FULL ?? {};
const partialFileMode = fileMigrationContract.modes?.PARTIAL ?? {};
const requiredFullFileEvidence = [
  "db_snapshot_id",
  "upload_snapshot_id",
  "freeze_watermark",
  "binding_reconciliation",
  "acl_reconciliation",
  "malware_scan_result",
  "task_permission_crosswalk_version",
  "external_link_decision_reconciliation",
];
const requiredFullZeroMetrics = [
  "missing_binary_count",
  "binding_mismatch_count",
  "acl_mismatch_count",
  "unknown_principal_count",
  "orphan_acl_object_count",
  "orphan_storage_count",
  "malware_blocking_count",
  "unknown_task_id_count",
  "unresolved_external_link_decision_count",
];
if (
  fileMigrationContract.contract_version !== "file-migration-v2" ||
  fullFileMode.cutover_allowed_without_binary_snapshot !== false ||
  fullFileMode.scope_change_waiver_allowed !== false ||
  fileMigrationContract.full_scope_change_escape !== false ||
  fileMigrationContract.current_snapshot_capability !== "PARTIAL_ONLY" ||
  partialFileMode.metadata_never_counts_as_migrated_binary !== true ||
  partialFileMode.only_status_after_any_file_waiver !== "PARTIAL_MIGRATION_ACCEPTED" ||
  !requiredFullFileEvidence.every((field) => fullFileMode.required_evidence?.includes(field)) ||
  !requiredFullZeroMetrics.every((field) => fullFileMode.required_zero_metrics?.includes(field))
) {
  failures.push("file migration FULL/PARTIAL blocking contract is incomplete");
}
const expectedAclSourceCounts = {
  b_disk_right: 284,
  b_disk_simple_right: 1276,
  b_disk_sharing: 8,
  b_disk_storage: 221,
};
const fileAclContract = migrationManifest.file_acl_contract ?? {};
if (
  JSON.stringify(fileAclContract.source_tables ?? {}) !==
    JSON.stringify(expectedAclSourceCounts) ||
  fileAclContract.target_acl !== "platform.attachment_acl" ||
  fileAclContract.target_storage !== "platform.attachment_storage" ||
  fileAclContract.principal_resolution?.unknown_principal_blocks_full !== true ||
  fileAclContract.orphan_object_or_storage_blocks_full !== true ||
  fileAclContract.permission_decode?.source_column !== "b_disk_right.TASK_ID" ||
  fileAclContract.permission_decode?.numeric_task_id_copy_forbidden !== true ||
  fileAclContract.permission_decode?.unknown_task_id_count_required !== 0 ||
  fileAclContract.permission_decode?.unresolved_task_id_blocks_full !== true ||
  fileAclContract.legacy_external_link_contract?.baseline_rows !== 2 ||
  fileAclContract.legacy_external_link_contract?.legacy_secret_import_forbidden !== true ||
  fileAclContract.legacy_external_link_contract?.unresolved_decision_count_required !== 0 ||
  fileAclContract.legacy_external_link_contract?.unresolved_blocks_full !== true
) {
  failures.push("file ACL/storage/TASK_ID/external-link blocking contract is incomplete");
}

const expectedInactiveOwnerBaseline = {
  contacts: 458,
  deals: 70,
  companies: 88,
  employer_referrals: 0,
  tasks: 1,
  total: 617,
  unresolved: 0,
};
const inactiveOwnerContract = migrationManifest.inactive_owner_resolution_contract ?? {};
const inactiveOwnerQuery = migrationQueryById.get("MIG-Q-OWNERS-001");
const requiredInactiveOwnerDecisionFields = [
  "source_table",
  "source_key",
  "source_owner_id",
  "legacy_actor_id",
  "decision_id",
  "decision_outcome",
  "new_operational_owner_id",
  "rule_version",
  "decided_by",
  "decided_at",
  "signature",
];
if (
  JSON.stringify(inactiveOwnerContract.baseline ?? {}) !==
    JSON.stringify(expectedInactiveOwnerBaseline) ||
  inactiveOwnerContract.unresolved_required !== 0 ||
  inactiveOwnerContract.signature_contract?.algorithm !== "Ed25519" ||
  !requiredInactiveOwnerDecisionFields.every((field) =>
    inactiveOwnerContract.required_per_record_fields?.includes(field),
  ) ||
  inactiveOwnerContract.silent_fallback_forbidden !== true ||
  inactiveOwnerQuery?.result_type !== "object" ||
  inactiveOwnerQuery?.query_kind !== "signed_record_reconciliation" ||
  JSON.stringify(inactiveOwnerQuery?.expected_rule?.value ?? {}) !==
    JSON.stringify(expectedInactiveOwnerBaseline) ||
  inactiveOwnerQuery?.expected_rule?.per_record_signed_outcomes !== 617 ||
  inactiveOwnerQuery?.expected_rule?.unresolved !== 0
) {
  failures.push("inactive-owner signed 617-record reconciliation contract is incomplete");
}

const fingerprintContract = migrationManifest.semantic_fingerprint_contract ?? {};
if (
  fingerprintContract.algorithm !== "HMAC-SHA-256" ||
  fingerprintContract.key_storage !== "external_secret_manager" ||
  fingerprintContract.unkeyed_hash_for_personal_identifier_forbidden !== true ||
  !fingerprintContract.required_context_fields?.includes("purpose") ||
  !fingerprintContract.required_context_fields?.includes("key_version") ||
  !fingerprintContract.raw_input_forbidden_in?.includes("generated_artifacts")
  || targetModel.semantic_fingerprint_contract?.algorithm !== "HMAC-SHA-256"
) {
  failures.push("machine semantic HMAC fingerprint contract is incomplete");
}

const consentContract = migrationManifest.consent_snapshot_contract ?? {};
if (
  consentContract.target !== "crm.consent_snapshot" ||
  consentContract.source_binding?.table !== "b_uts_crm_contact" ||
  consentContract.source_binding?.column !== "UF_CRM_1746464685417" ||
  consentContract.source_binding?.source_field_id !== 206 ||
  consentContract.invariants?.policy_version !== "null_or_unknown" ||
  consentContract.invariants?.captured_at !== "null_unless_source_proves_timestamp" ||
  consentContract.invariants?.modern_consent_must_not_be_inferred !== true
  || targetModel.consent_snapshot_contract?.source_binding?.source_field_id !== 206
) {
  failures.push("legacy consent snapshot machine contract is incomplete");
}
const requiredTableTargets = {
  b_user: ["identity.person", "identity.legacy_actor", "identity.employee_profile"],
  b_utm_user: ["identity.employee_unit_membership"],
  b_crm_contact: ["identity.person", "crm.crm_profile_assignment"],
  b_crm_deal: ["crm.case_assignment"],
  b_crm_company: ["crm.employer_assignment"],
  b_crm_dynamic_items_1042: ["crm.employer_referral_assignment"],
  b_tasks: ["crm.task_assignment", "project.task_assignment"],
  b_tasks_member: ["crm.task_assignment", "project.task_assignment"],
  b_crm_deal_stage_history: ["crm.case_stage_history", "migration.conflict"],
  b_crm_deal_stage_history_with_supposed: ["migration.crm_stage_history_quarantine"],
  b_crm_entity_stage_history: ["crm.employer_referral_stage_history"],
  b_crm_entity_stage_history_with_supposed: ["migration.crm_stage_history_quarantine"],
  b_crm_observer: ["crm.case_assignment", "crm.crm_profile_assignment"],
  b_tasks_log: ["crm.task_history", "project.task_history", "migration.conflict"],
  b_tasks_task_dep: ["crm.task_dependency", "project.task_dependency", "migration.conflict"],
  b_tasks_stages: ["migration.source_task_stage_definition"],
  b_tasks_task_stage: ["migration.source_task_stage_membership"],
  b_tasks_result: ["crm.task_result"],
  b_disk_right: ["platform.attachment_acl", "migration.file_acl_conflict"],
  b_disk_simple_right: ["platform.attachment_acl", "migration.file_acl_conflict"],
  b_disk_sharing: ["platform.attachment_acl", "migration.file_acl_conflict"],
  b_disk_storage: ["platform.attachment_storage", "migration.file_acl_conflict"],
};
for (const [table, requiredTargets] of Object.entries(requiredTableTargets)) {
  const actualTargets = new Set(manifestByTable.get(table)?.target ?? []);
  for (const target of requiredTargets) {
    if (!actualTargets.has(target)) {
      failures.push(`${table} manifest lacks required canonical target: ${target}`);
    }
  }
}
if (!manifestByTable.get("b_tasks")?.selected_columns?.includes("STAGE_ID")) {
  failures.push("b_tasks.STAGE_ID must be selected for source-stage reconciliation");
}
const requiredStructuredTargetFields = {
  "crm.case_stage_history": ["case_id", "effective_from", "effective_to", "source_key", "provenance"],
  "crm.employer_referral_stage_history": [
    "employer_referral_id",
    "effective_from",
    "effective_to",
    "source_key",
    "provenance",
  ],
  "crm.task_history": ["task_id", "changed_field", "actor_kind", "source_key", "provenance"],
  "project.task_history": ["task_id", "changed_field", "actor_kind", "source_key", "provenance"],
  "crm.task_dependency": ["task_id", "predecessor_task_id", "source_key", "provenance"],
  "project.task_dependency": ["task_id", "predecessor_task_id", "source_key", "provenance"],
  "migration.source_task_stage_definition": [
    "source_stage_id",
    "referenced",
    "source_key",
    "provenance",
  ],
  "migration.source_task_stage_membership": [
    "source_task_id",
    "source_stage_id",
    "source_key",
    "provenance",
  ],
  "crm.task_result": ["task_id", "text_protected", "source_key", "provenance"],
  "platform.attachment_acl": fileAclContract.required_acl_fields ?? [],
  "platform.attachment_storage": fileAclContract.required_storage_fields ?? [],
  "crm.consent_snapshot": consentContract.required_fields ?? [],
  "migration.unmapped_custom_field_quarantine": [
    "source_table",
    "source_key",
    "source_column",
    "encrypted_value",
    "decision_status",
  ],
};
for (const [targetId, requiredFields] of Object.entries(requiredStructuredTargetFields)) {
  const target = targetEntries.find((entry) => entry.id === targetId);
  if (!target) {
    failures.push(`missing structured migration target: ${targetId}`);
    continue;
  }
  for (const field of requiredFields) {
    if (!target.required_fields?.includes(field)) {
      failures.push(`structured migration target ${targetId} missing field: ${field}`);
    }
  }
}
for (const relationId of ["crm.case_assignment", "crm.crm_profile_assignment"]) {
  const relation = targetEntries.find((entry) => entry.id === relationId);
  if (
    !relation?.allowed_roles?.includes("observer") ||
    !relation?.membership_roles?.includes("observer") ||
    !relation?.source_tables?.includes("b_crm_observer")
  ) {
    failures.push(`${relationId} lacks typed perioded observer semantics`);
  }
}

const exactSourceClassification = {
  b_crm_deal_stage_history: [3932, 0, 687],
  b_crm_deal_stage_history_with_supposed: [9399, 0, 0],
  b_crm_entity_stage_history: [3201, 0, 0],
  b_crm_entity_stage_history_with_supposed: [4271, 0, 0],
  b_crm_observer: [90, 0, 0],
  b_tasks_log: [399, 0, 230],
  b_tasks_task_dep: [0, 3, 1],
  b_tasks_stages: [18, 71, 0],
  b_tasks_task_stage: [174, 0, 0],
  b_tasks_result: [3, 0, 0],
};
for (const [table, [selected, excluded, conflict]] of Object.entries(
  exactSourceClassification,
)) {
  const entity = manifestByTable.get(table);
  if (
    entity?.selection_baseline_count !== selected ||
    entity?.selection_excluded_baseline_count !== excluded ||
    entity?.selection_conflict_baseline_count !== conflict
  ) {
    failures.push(`${table} exact source classification baseline mismatch`);
  }
}
if (
  migrationManifest.task_source_stage_contract?.task_stage_id?.zero_sentinel_rows !== 73 ||
  migrationManifest.task_source_stage_contract?.task_stage_id?.nonzero_rows !== 16 ||
  migrationManifest.task_source_stage_contract?.task_stage_id
    ?.canonical_status_inference_forbidden !== true ||
  migrationManifest.task_source_stage_contract?.memberships
    ?.temporal_period_inference_forbidden !== true
) {
  failures.push("legacy task source-stage evidence contract is incomplete");
}

const dispositionRows = parseCsv(
  readText(files.tableDispositions),
  files.tableDispositions,
);
const dispositionHeaders = dispositionRows[0] ?? [];
const dispositionIndex = Object.fromEntries(
  dispositionHeaders.map((header, index) => [header, index]),
);
for (const requiredHeader of [
  "source_table",
  "rows",
  "disposition",
  "reason_code",
  "migration_query_id",
  "transform_version",
  "expected_row_outcomes",
  "domain_owner",
  "decision_status",
]) {
  if (!(requiredHeader in dispositionIndex)) {
    failures.push(`source table disposition registry missing column: ${requiredHeader}`);
  }
}
const dispositionTableNames = dispositionRows
  .slice(1)
  .map((row) => row[dispositionIndex.source_table]);
assertUnique(dispositionTableNames, "source table disposition");
if (dispositionTableNames.length !== sourceCounts.size || sourceCounts.size !== 1669) {
  failures.push(
    `source table dispositions must classify all 1669 tables, found ${dispositionTableNames.length}`,
  );
}
let dispositionIncludedRows = 0;
let dispositionIncludedTables = 0;
let dispositionQuarantineLedgerRows = 0;
let dispositionQuarantineLedgerTables = 0;
for (const row of dispositionRows.slice(1)) {
  const table = row[dispositionIndex.source_table];
  const rows = Number(row[dispositionIndex.rows]);
  const disposition = row[dispositionIndex.disposition];
  const reasonCode = row[dispositionIndex.reason_code];
  const expectedOutcomes = Number(row[dispositionIndex.expected_row_outcomes]);
  if (!sourceCounts.has(table) || sourceCounts.get(table) !== rows) {
    failures.push(`source disposition count mismatch: ${table}`);
  }
  if (!reasonCode || !row[dispositionIndex.domain_owner] || !row[dispositionIndex.decision_status]) {
    failures.push(`source disposition lacks reason/owner/decision: ${table}`);
  }
  if (disposition === "include_row_ledger") {
    dispositionIncludedTables += 1;
    dispositionIncludedRows += expectedOutcomes;
    const entity = manifestByTable.get(table);
    if (!entity) failures.push(`included disposition absent from manifest: ${table}`);
    if (entity?.source_disposition !== "include_row_ledger") {
      failures.push(`included disposition disagrees with manifest: ${table}`);
    }
    if (expectedOutcomes !== rows) {
      failures.push(`included disposition must account for all rows: ${table}`);
    }
    if (row[dispositionIndex.migration_query_id] !== entity?.migration_query_id) {
      failures.push(`included disposition query mismatch: ${table}`);
    }
  } else if (disposition === "quarantine_only") {
    const entity = manifestByTable.get(table);
    if (entity) {
      dispositionQuarantineLedgerTables += 1;
      dispositionQuarantineLedgerRows += expectedOutcomes;
      if (
        entity.source_disposition !== "quarantine_only" ||
        expectedOutcomes !== rows ||
        row[dispositionIndex.migration_query_id] !== entity.migration_query_id
      ) {
        failures.push(`manifest quarantine disposition contract mismatch: ${table}`);
      }
    } else if (expectedOutcomes !== 0) {
      failures.push(`non-manifest quarantine table must have zero ledger outcomes: ${table}`);
    }
  } else if (disposition === "exclude_with_reason") {
    if (manifestByTable.has(table)) {
      failures.push(`manifest table cannot be excluded: ${table}`);
    }
    if (expectedOutcomes !== 0) {
      failures.push(`excluded table must have zero migration row outcomes: ${table}`);
    }
  } else {
    failures.push(`unknown source table disposition ${disposition}: ${table}`);
  }
}
if (
  dispositionIncludedTables !== 55 ||
  dispositionIncludedRows !== 424754 ||
  dispositionQuarantineLedgerTables !== 2 ||
  dispositionQuarantineLedgerRows !== 13670
) {
  failures.push(
    `source dispositions must contain 55 included / 2 ledger quarantine tables and 424754 / 13670 rows, found ${dispositionIncludedTables}/${dispositionQuarantineLedgerTables} and ${dispositionIncludedRows}/${dispositionQuarantineLedgerRows}`,
  );
}
const externalLinkDisposition = dispositionRows.slice(1).find(
  (row) => row[dispositionIndex.source_table] === "b_disk_external_link",
);
if (
  externalLinkDisposition?.[dispositionIndex.disposition] !== "quarantine_only" ||
  externalLinkDisposition?.[dispositionIndex.reason_code] !==
    "legacy_external_link_secret_revoke_or_reissue_decision_required"
) {
  failures.push("b_disk_external_link must have explicit security quarantine disposition");
}

const columnTables = columnDispositions.tables ?? [];
assertUnique(
  columnTables.map((table) => table.source_table),
  "column disposition table",
);
if (
  columnTables.length !== 57 ||
  columnDispositions.ledger_table_count !== 57 ||
  columnDispositions.included_table_count !== 55 ||
  columnDispositions.quarantine_table_count !== 2 ||
  columnDispositions.coverage_denominator !== 438424
) {
  failures.push("column disposition registry must cover 57 ledger tables / 438424 rows");
}
let classifiedColumnCount = 0;
let selectedColumnCount = 0;
let excludedColumnCount = 0;
let quarantinedColumnCount = 0;
for (const tableEntry of columnTables) {
  const entity = manifestByTable.get(tableEntry.source_table);
  const schemaTable = schemaTables[tableEntry.source_table];
  if (!entity || !schemaTable) {
    failures.push(`column dispositions reference unknown included table: ${tableEntry.source_table}`);
    continue;
  }
  if (tableEntry.baseline_count !== entity.baseline_count) {
    failures.push(`column disposition baseline mismatch: ${tableEntry.source_table}`);
  }
  const dispositionColumns = tableEntry.columns ?? [];
  assertUnique(
    dispositionColumns.map((column) => column.column),
    `${tableEntry.source_table} column disposition`,
  );
  const schemaColumnNames = schemaTable.columns.map((column) => column.name);
  if (
    JSON.stringify([...dispositionColumns.map((column) => column.column)].sort()) !==
    JSON.stringify([...schemaColumnNames].sort())
  ) {
    failures.push(`column dispositions do not classify exact schema columns: ${tableEntry.source_table}`);
  }
  const selected = new Set(entity.selected_columns ?? []);
  for (const column of dispositionColumns) {
    classifiedColumnCount += 1;
    if (column.disposition === "selected") {
      selectedColumnCount += 1;
      if (!selected.has(column.column)) {
        failures.push(`column marked selected but absent from manifest: ${tableEntry.source_table}.${column.column}`);
      }
      if (!["mapped", "provenance_only"].includes(column.semantic_disposition)) {
        failures.push(
          `selected column lacks exact mapped/provenance_only disposition: ${tableEntry.source_table}.${column.column}`,
        );
      }
      if (column.semantic_disposition === "mapped") {
        if (!column.target_ids?.length) {
          failures.push(`mapped column lacks target_ids: ${tableEntry.source_table}.${column.column}`);
        }
        for (const targetId of column.target_ids ?? []) {
          if (!targetIds.has(targetId)) {
            failures.push(
              `mapped column references unknown target: ${tableEntry.source_table}.${column.column} -> ${targetId}`,
            );
          }
        }
      } else if (!column.reason_code) {
        failures.push(`provenance-only column lacks reason: ${tableEntry.source_table}.${column.column}`);
      }
    } else if (column.disposition === "excluded") {
      excludedColumnCount += 1;
      if (selected.has(column.column)) {
        failures.push(`manifest-selected column is excluded: ${tableEntry.source_table}.${column.column}`);
      }
      if (column.semantic_disposition !== "excluded" || !column.reason_code) {
        failures.push(`excluded column lacks exact semantic disposition/reason: ${tableEntry.source_table}.${column.column}`);
      }
    } else if (column.disposition === "quarantined") {
      quarantinedColumnCount += 1;
      if (selected.has(column.column)) {
        failures.push(`manifest-selected column is quarantined: ${tableEntry.source_table}.${column.column}`);
      }
      if (
        column.semantic_disposition !== "quarantined" ||
        !column.reason_code ||
        !column.reason_detail ||
        column.decision_owner !== "migration_data_owner" ||
        column.decision_status !== "pending" ||
        column.cutover_blocking !== true ||
        JSON.stringify(column.target_ids) !==
          JSON.stringify(["migration.unmapped_custom_field_quarantine"])
      ) {
        failures.push(`quarantined column lacks field-specific owner/target contract: ${tableEntry.source_table}.${column.column}`);
      }
    } else {
      failures.push(`unknown column disposition: ${tableEntry.source_table}.${column.column}`);
    }
  }
}
if (
  classifiedColumnCount !== 1016 ||
  selectedColumnCount !== 479 ||
  excludedColumnCount !== 474 ||
  quarantinedColumnCount !== 63
) {
  failures.push(
    `column disposition totals must be 1016 = 479 selected + 474 excluded + 63 quarantined, found ${classifiedColumnCount} = ${selectedColumnCount} + ${excludedColumnCount} + ${quarantinedColumnCount}`,
  );
}

const expectedCrmUfProfiles = {
  b_uts_crm_contact: {
    totalRows: 3186,
    columns: 56,
    mapped: 13,
    mirrors: 2,
    quarantined: 37,
    emptyExcluded: 4,
  },
  b_uts_crm_deal: {
    totalRows: 1898,
    columns: 53,
    mapped: 17,
    mirrors: 5,
    quarantined: 26,
    emptyExcluded: 5,
  },
  b_crm_dynamic_items_1042: {
    totalRows: 1808,
    columns: 6,
    mapped: 6,
    mirrors: 0,
    quarantined: 0,
    emptyExcluded: 0,
  },
};
const crmUfProfileContract = columnDispositions.crm_uf_profile_contract ?? {};
const crmUfQuarantineContract =
  migrationManifest.custom_field_quarantine_contract ?? {};
if (
  crmUfProfileContract.value_logging !== false ||
  crmUfProfileContract.quarantine_values_in_generated_artifact !== false ||
  JSON.stringify(crmUfProfileContract.expected_disposition_totals ?? {}) !==
    JSON.stringify({
      mapped: 36,
      approved_serialized_mirror_excluded: 7,
      populated_unmapped_quarantined: 63,
      empty_excluded: 9,
      total: 115,
    }) ||
  JSON.stringify(crmUfProfileContract.table_totals ?? {}) !==
    JSON.stringify(
      Object.fromEntries(
        Object.entries(expectedCrmUfProfiles).map(([table, expectation]) => [
          table,
          expectation.totalRows,
        ]),
      ),
    ) ||
  crmUfQuarantineContract.populated_physical_columns_without_direct_mapping !== 70 ||
  crmUfQuarantineContract.approved_serialized_mirrors_excluded !== 7 ||
  crmUfQuarantineContract.populated_unmapped_physical_columns_quarantined !== 63 ||
  crmUfQuarantineContract.pending_decision_blocks_cutover !== true ||
  crmUfQuarantineContract.column_name_and_aggregate_counts_only_in_generated_artifacts !== true
) {
  failures.push("CRM UF profile contract must prohibit value logging and pin all table totals");
}

const crmUfProfiles = columnDispositions.crm_uf_value_profiles ?? [];
const crmUfProfileKeys = crmUfProfiles.map(
  (profile) => `${profile.source_table}.${profile.column}`,
);
assertUnique(crmUfProfileKeys, "CRM UF value profile");
if (crmUfProfiles.length !== 115) {
  failures.push(`CRM UF profiles must contain 115 physical columns, found ${crmUfProfiles.length}`);
}

const sourceFieldBindings = new Map();
const sourceFieldsById = new Map();
for (const [section, fields] of Object.entries({
  contact_fields: sourceFieldMap.contact_fields ?? [],
  deal_fields: sourceFieldMap.deal_fields ?? [],
  dynamic_1042_fields: sourceFieldMap.dynamic_1042_fields ?? [],
})) {
  for (const field of fields) {
    sourceFieldsById.set(field.id, { ...field, section });
    const directSource = String(field.source ?? "");
    if (/^[a-z0-9_]+\.UF_[A-Z0-9_]+$/.test(directSource)) {
      sourceFieldBindings.set(directSource, { ...field, section });
    }
  }
}
const expectedCrmUfMirrorProfiles = {
  "b_uts_crm_contact.UF_CRM_1742462391": [
    189,
    "b_utm_crm_contact.FIELD_ID=189.VALUE",
  ],
  "b_uts_crm_contact.UF_CRM_1770903563151": [
    345,
    "b_utm_crm_contact.FIELD_ID=345.VALUE_INT",
  ],
  "b_uts_crm_deal.UF_CRM_1742462733": [
    194,
    "b_utm_crm_deal.FIELD_ID=194.VALUE",
  ],
  "b_uts_crm_deal.UF_CRM_1760954951": [
    254,
    "b_utm_crm_deal.FIELD_ID=254.VALUE_INT",
  ],
  "b_uts_crm_deal.UF_CRM_1770105639": [
    341,
    "b_utm_crm_deal.FIELD_ID=341.VALUE_DATE",
  ],
  "b_uts_crm_deal.UF_CRM_1772605893": [
    375,
    "b_utm_crm_deal.FIELD_ID=375.VALUE",
  ],
  "b_uts_crm_deal.UF_CRM_1773992042": [
    404,
    "b_utm_crm_deal.FIELD_ID=404.VALUE_INT",
  ],
};

const allowedCrmUfProfileKeys = new Set([
  "source_table",
  "column",
  "total_rows",
  "non_null_count",
  "non_empty_count",
  "semantic_disposition",
  "target_ids",
  "source_field_binding",
  "reason_code",
  "reason_detail",
  "source_field_metadata",
  "decision_owner",
  "decision_status",
  "cutover_blocking",
  "approved_basis",
  "canonical_source_binding",
]);
for (const [table, expectation] of Object.entries(expectedCrmUfProfiles)) {
  const schemaUfColumns = (schemaTables[table]?.columns ?? [])
    .map((column) => column.name)
    .filter((column) => column.startsWith("UF_"));
  const tableProfiles = crmUfProfiles.filter((profile) => profile.source_table === table);
  const profiledColumns = tableProfiles.map((profile) => profile.column);
  if (
    schemaUfColumns.length !== expectation.columns ||
    JSON.stringify([...profiledColumns].sort()) !== JSON.stringify([...schemaUfColumns].sort())
  ) {
    failures.push(`${table} CRM UF profiles do not cover the exact physical schema columns`);
  }

  const tableDispositionColumns = new Map(
    (columnTables.find((entry) => entry.source_table === table)?.columns ?? []).map((column) => [
      column.column,
      column,
    ]),
  );
  let mappedProfiles = 0;
  let mirrorProfiles = 0;
  let quarantinedProfiles = 0;
  let emptyExcludedProfiles = 0;
  for (const profile of tableProfiles) {
    for (const key of Object.keys(profile)) {
      if (!allowedCrmUfProfileKeys.has(key)) {
        failures.push(`${table}.${profile.column} CRM UF profile exposes unexpected key: ${key}`);
      }
    }
    if (
      profile.total_rows !== expectation.totalRows ||
      !Number.isInteger(profile.non_null_count) ||
      !Number.isInteger(profile.non_empty_count) ||
      profile.non_empty_count < 0 ||
      profile.non_null_count < profile.non_empty_count ||
      profile.total_rows < profile.non_null_count
    ) {
      failures.push(`${table}.${profile.column} has invalid aggregate-only value counts`);
    }

    const columnDisposition = tableDispositionColumns.get(profile.column);
    if (profile.semantic_disposition === "mapped") {
      mappedProfiles += 1;
      const binding = sourceFieldBindings.get(`${table}.${profile.column}`);
      const canonicalTarget = targetAliasMap.get(
        String(binding?.target ?? "").split(".")[0],
      );
      const manifestTargets = new Set(manifestByTable.get(table)?.target ?? []);
      if (
        columnDisposition?.disposition !== "selected" ||
        columnDisposition?.semantic_disposition !== "mapped" ||
        !profile.target_ids?.length ||
        JSON.stringify([...(profile.target_ids ?? [])].sort()) !==
          JSON.stringify([...(columnDisposition?.target_ids ?? [])].sort()) ||
        !binding ||
        profile.source_field_binding?.source !== binding.source ||
        profile.source_field_binding?.target !== binding.target ||
        profile.source_field_binding?.section !== binding.section ||
        profile.source_field_binding?.field_id !== binding.id ||
        profile.source_field_binding?.source_label !== binding.source_label ||
        profile.source_field_binding?.type !== binding.type ||
        !canonicalTarget ||
        !targetIds.has(canonicalTarget) ||
        !profile.target_ids.includes(canonicalTarget) ||
        !manifestTargets.has(canonicalTarget)
      ) {
        failures.push(`${table}.${profile.column} mapped CRM UF profile contract mismatch`);
      }
      if ("reason_code" in profile) {
        failures.push(`${table}.${profile.column} mapped CRM UF profile must not carry an exclusion reason`);
      }
    } else if (profile.semantic_disposition === "excluded") {
      const profileKey = `${table}.${profile.column}`;
      const expectedMirror = expectedCrmUfMirrorProfiles[profileKey];
      if (expectedMirror) {
        mirrorProfiles += 1;
        const [fieldId, canonicalSource] = expectedMirror;
        const field = sourceFieldsById.get(fieldId);
        const canonicalTarget = targetAliasMap.get(
          String(field?.target ?? "").split(".")[0],
        );
        if (
          profile.reason_code !==
            "serialized_multi_value_mirror_excluded_canonical_source_b_utm" ||
          profile.non_empty_count <= 0 ||
          profile.approved_basis !== "source-field-map.json#/common_rules" ||
          profile.decision_owner !== "migration_data_owner" ||
          profile.decision_status !== "approved_canonical_b_utm_source" ||
          profile.cutover_blocking !== false ||
          profile.canonical_source_binding?.field_id !== fieldId ||
          profile.canonical_source_binding?.canonical_source !== canonicalSource ||
          profile.canonical_source_binding?.target !== field?.target ||
          !canonicalTarget ||
          !profile.target_ids?.includes(canonicalTarget) ||
          columnDisposition?.disposition !== "excluded" ||
          columnDisposition?.semantic_disposition !== "excluded" ||
          columnDisposition?.reason_code !== profile.reason_code ||
          columnDisposition?.decision_owner !== "migration_data_owner" ||
          columnDisposition?.decision_status !== "approved_canonical_b_utm_source" ||
          columnDisposition?.canonical_source_binding?.canonical_source !== canonicalSource
        ) {
          failures.push(`${profileKey} serialized mirror contract mismatch`);
        }
      } else {
        emptyExcludedProfiles += 1;
        if (
          profile.reason_code !== "empty_physical_uf_not_selected_by_versioned_mapping" ||
          profile.non_empty_count !== 0 ||
          columnDisposition?.disposition !== "excluded" ||
          columnDisposition?.semantic_disposition !== "excluded" ||
          columnDisposition?.reason_code !== profile.reason_code ||
          "target_ids" in profile ||
          "source_field_binding" in profile
        ) {
          failures.push(`${profileKey} empty excluded CRM UF profile contract mismatch`);
        }
      }
    } else if (profile.semantic_disposition === "quarantined") {
      quarantinedProfiles += 1;
      const sourceMetadataKeys = Object.keys(profile.source_field_metadata ?? {}).sort();
      if (
        profile.non_empty_count <= 0 ||
        !/^populated_unmapped_crm_uf_field_\d+_pending_owner_decision$/.test(
          profile.reason_code ?? "",
        ) ||
        !profile.reason_detail?.includes(`${table}.${profile.column}`) ||
        !Number.isInteger(profile.source_field_metadata?.definition_id) ||
        JSON.stringify(sourceMetadataKeys) !==
          JSON.stringify([
            "definition_id",
            "entity_id",
            "field_name",
            "mandatory",
            "multiple",
            "user_type_id",
          ]) ||
        profile.source_field_metadata?.field_name !== profile.column ||
        profile.decision_owner !== "migration_data_owner" ||
        profile.decision_status !== "pending" ||
        profile.cutover_blocking !== true ||
        JSON.stringify(profile.target_ids) !==
          JSON.stringify(["migration.unmapped_custom_field_quarantine"]) ||
        columnDisposition?.disposition !== "quarantined" ||
        columnDisposition?.reason_code !== profile.reason_code ||
        columnDisposition?.source_field_metadata?.definition_id !==
          profile.source_field_metadata.definition_id
      ) {
        failures.push(`${table}.${profile.column} populated quarantine contract mismatch`);
      }
    } else {
      failures.push(`${table}.${profile.column} has unknown CRM UF semantic disposition`);
    }
  }
  if (
    tableProfiles.length !== expectation.columns ||
    mappedProfiles !== expectation.mapped ||
    mirrorProfiles !== expectation.mirrors ||
    quarantinedProfiles !== expectation.quarantined ||
    emptyExcludedProfiles !== expectation.emptyExcluded
  ) {
    failures.push(
      `${table} CRM UF profile totals mismatch: ${mappedProfiles} mapped + ${mirrorProfiles} mirrors + ${quarantinedProfiles} quarantined + ${emptyExcludedProfiles} empty excluded`,
    );
  }
}
for (const profile of crmUfProfiles) {
  if (!(profile.source_table in expectedCrmUfProfiles)) {
    failures.push(`CRM UF profile references an unexpected table: ${profile.source_table}`);
  }
}

const expectedSnapshotHash =
  "7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf";
if (migrationManifest.snapshot?.sha256 !== expectedSnapshotHash) {
  failures.push("migration manifest snapshot hash mismatch");
}
if (sourceFieldMap.snapshot_sha256 !== expectedSnapshotHash) {
  failures.push("source field map snapshot hash mismatch");
}
for (const [label, value] of [
  ["schema inventory", schemaInventory.source?.sha256],
  ["column disposition registry", columnDispositions.snapshot_sha256],
  ["migration query registry", migrationQueries.snapshot_sha256],
  ["target model registry", targetModel.snapshot_sha256],
]) {
  if (value !== expectedSnapshotHash) {
    failures.push(`${label} snapshot hash mismatch`);
  }
}

const expectedFieldMapSizes = {
  contact_fields: 15,
  deal_fields: 22,
  dynamic_1042_fields: 10,
};
for (const [field, expectedCount] of Object.entries(expectedFieldMapSizes)) {
  const actualCount = sourceFieldMap[field]?.length ?? 0;
  if (actualCount !== expectedCount) {
    failures.push(`source field map ${field}: expected ${expectedCount}, found ${actualCount}`);
  }
}

const expectedCustomFieldIds = [
  14, 40, 84, 114, 119, 120, 128, 129, 167, 169, 170, 171, 183, 189, 194, 196,
  200, 206, 223, 224, 225, 233, 250, 251, 252, 253, 254, 255, 263, 267, 310,
  332, 341, 345, 356, 358, 359, 360, 361, 375, 383, 384, 385, 386, 404, 406,
];
const customFieldMetadata = sourceFieldMap.metadata_bindings?.custom_fields;
if (
  JSON.stringify(customFieldMetadata?.definition_ids ?? []) !==
    JSON.stringify(expectedCustomFieldIds) ||
  customFieldMetadata?.definition_selected_count !== 46 ||
  customFieldMetadata?.definitions?.length !== 46
) {
  failures.push("source field metadata must contain the exact 46 approved field IDs");
}
assertUnique(
  (customFieldMetadata?.definitions ?? []).map((definition) => definition.id),
  "source custom field definition ID",
);
const expectedEnumCounts = {
  "UF_CRM_1741079182998/field_171": 9,
  "UF_CRM_1742550450292/field_200": 17,
  "UF_CRM_1760952900341/field_250": 8,
  "UF_CRM_1771334896/field_356": 99,
  "UF_CRM_4_1772366729/field_361": 8,
  "UF_CRM_4_1772694354360/field_386": 2,
};
for (const [enumName, expectedCount] of Object.entries(expectedEnumCounts)) {
  const actualCount = Object.keys(sourceFieldMap.enum_maps?.[enumName] ?? {}).length;
  if (actualCount !== expectedCount) {
    failures.push(`enum map ${enumName}: expected ${expectedCount}, found ${actualCount}`);
  }
}
const statusCount = Object.values(
  sourceFieldMap.metadata_bindings?.crm_status?.entity_counts ?? {},
).reduce((total, count) => total + count, 0);
if (statusCount !== 96 || sourceFieldMap.metadata_bindings?.crm_status?.selected_count !== 96) {
  failures.push("CRM status metadata binding must contain 96 selected definitions");
}
if (
  sourceFieldMap.metadata_bindings?.deal_categories?.implicit_default?.id !== 0 ||
  sourceFieldMap.metadata_bindings?.deal_categories?.implicit_default?.source_kind !==
    "implicit_default" ||
  sourceFieldMap.metadata_bindings?.deal_categories?.implicit_default
    ?.source_table_row_present !== false
) {
  failures.push("deal category 0 must be recorded as an implicit default");
}

for (const field of [
  ...(sourceFieldMap.contact_fields ?? []),
  ...(sourceFieldMap.deal_fields ?? []),
  ...(sourceFieldMap.dynamic_1042_fields ?? []),
]) {
  const directMatch = String(field.source).match(/^([a-z0-9_]+)\.([A-Z][A-Z0-9_]*)$/);
  const multiMatch = String(field.source).match(
    /^([a-z0-9_]+)\.FIELD_ID=\d+\.([A-Z][A-Z0-9_]*)$/,
  );
  if (!directMatch && !multiMatch) {
    failures.push(`unparseable source-field binding: ${field.source}`);
    continue;
  }
  const table = (directMatch ?? multiMatch)[1];
  const valueColumn = (directMatch ?? multiMatch)[2];
  const selected = new Set(manifestByTable.get(table)?.selected_columns ?? []);
  for (const requiredColumn of multiMatch ? ["FIELD_ID", valueColumn] : [valueColumn]) {
    if (!selected.has(requiredColumn)) {
      failures.push(`source-field binding column is not selected: ${table}.${requiredColumn}`);
    }
  }
  const targetPrefix = String(field.target).split(".")[0];
  const canonicalTarget = targetAliasMap.get(targetPrefix);
  if (!canonicalTarget || !targetIds.has(canonicalTarget)) {
    failures.push(`source-field target alias is not canonical: ${field.target}`);
  }
}

const categoryRows = (sourceFieldMap.funnel_categories ?? []).reduce(
  (total, category) => total + category.rows,
  0,
);
if (categoryRows !== 1899) {
  failures.push(`funnel category rows must sum to 1899, found ${categoryRows}`);
}

const expectedStageSums = {
  "DEAL_STAGE/category_0": 222,
  "DEAL_STAGE_1/category_1": 1,
  "DEAL_STAGE_2/category_2": 1675,
  "DEAL_STAGE_3/category_3": 1,
  "DEAL_STAGE_5/category_5": 0,
  DYNAMIC_1042_STAGE_8: 1808,
};
for (const [stageGroup, expectedCount] of Object.entries(expectedStageSums)) {
  const actualCount = (sourceFieldMap.stages?.[stageGroup] ?? []).reduce(
    (total, stage) => total + stage.rows,
    0,
  );
  if (actualCount !== expectedCount) {
    failures.push(`${stageGroup} rows: expected ${expectedCount}, found ${actualCount}`);
  }
}

const stageTargetChecks = [
  ["DEAL_STAGE_2/category_2", "crm_relocation_case"],
  ["DEAL_STAGE_3/category_3", "crm_student_case"],
  ["DYNAMIC_1042_STAGE_8", "employer_referral"],
];
for (const [stageGroup, stateMachine] of stageTargetChecks) {
  const allowedStates = new Set(transitions.state_machines?.[stateMachine]?.states ?? []);
  for (const stage of sourceFieldMap.stages?.[stageGroup] ?? []) {
    if (stage.target_state !== null && stage.target_state !== undefined && !allowedStates.has(stage.target_state)) {
      failures.push(
        `${stageGroup} ${stage.code} maps to unknown ${stateMachine} state ${stage.target_state}`,
      );
    }
  }
}
if ((sourceFieldMap.activity_timeline_file_bindings ?? []).length < 12) {
  failures.push("activity/timeline/file binding map is incomplete");
}

const referenceRows = parseCsv(readText(files.referenceManifest), files.referenceManifest);
const existingReferenceIds = referenceRows.slice(1).map((row) => row[0]);
assertUnique(existingReferenceIds, "existing reference ID");
if (existingReferenceIds.length !== 33) {
  failures.push(`expected 33 existing references, found ${existingReferenceIds.length}`);
}

const requiredNewReferenceIds = [
  "AUTH-01",
  "AUTH-02",
  "AUTH-03",
  "ADM-01",
  "ADM-02",
  "ADM-03",
  "ADM-04",
  "ADM-05",
  "MIG-04",
];
const existingReferenceSet = new Set(existingReferenceIds);
for (const referenceId of requiredNewReferenceIds) {
  if (!existingReferenceSet.has(referenceId)) {
    failures.push(`required generated reference is missing: ${referenceId}`);
  }
}

const gitignore = readText(files.gitignore).split(/\r?\n/);
if (!gitignore.includes("sitemanager-final.sql.gz")) {
  failures.push("sensitive SQL dump is not explicitly ignored by Git");
}

if (failures.length) {
  console.error("Spec baseline validation: FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Spec baseline validation: PASSED");
console.log(`- permissions: ${permissionCodes.length}`);
console.log(`- transition permission references: ${referencedPermissions.size}`);
console.log(`- requirements: ${requirementIds.length}`);
console.log(`- migration manifest tables: ${manifestEntities.length}`);
console.log(`- CRM UF aggregate profiles: ${crmUfProfiles.length} / 115 physical columns`);
console.log(
  `- source field map: ${sourceFieldMap.contact_fields.length} contact + ${sourceFieldMap.deal_fields.length} deal + ${sourceFieldMap.dynamic_1042_fields.length} direction fields`,
);
console.log(`- references: ${existingReferenceIds.length} existing + 0 planned = 33`);
