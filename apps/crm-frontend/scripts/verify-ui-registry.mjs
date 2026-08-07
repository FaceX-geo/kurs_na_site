import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultAppRoot = path.resolve(scriptDirectory, "..");

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

const CONTRACT_KEYS = [
  "schemaVersion",
  "componentId",
  "version",
  "purpose",
  "variants",
  "states",
  "inputs",
  "events",
  "accessibility",
  "motion",
  "invariants",
];

const AUTH_SCREEN_NUMBERS = new Set([45, 46, 47, 48]);
const AUTH_OPERATION_ALLOWLIST = new Map([
  [45, new Set(["Login"])],
  [46, new Set(["VerifyMfa"])],
  [47, new Set()],
  [48, new Set(["EnrollMfa"])],
]);

const BACKEND_STATUSES = new Set(["connected", "partial", "contract-gap", "not-applicable"]);
const SHELLS = new Set(["authenticated", "auth", "none"]);
const COMPONENT_ID_PATTERN = /^ui\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RECIPE_ID_PATTERN = /^recipe\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCREEN_ID_PATTERN = /^(?:crm|identity)\.(?:screen|surface)\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const REFERENCE_IMAGE_PATTERN = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.png$/;
const BUSINESS_ROLES = new Set(["SUPER_ADMIN", "SPECIALIST"]);
const SCOPE_POLICIES = new Set([
  "backend-effective-scope",
  "server-authorized-admin-registry",
  "contract-gap",
]);

const FORBIDDEN_RUNTIME_WORDS = new Set([
  "tracker",
  "трекер",
  "project",
  "projects",
  "проект",
  "проекты",
  "graph",
  "граф",
  "erp",
  "cms",
  "migration-console",
]);

const FORBIDDEN_RUNTIME_PATTERNS = [
  { pattern: /ks_projects_tracker/i, label: "Tracker repository path" },
  { pattern: /@xyflow\/react/i, label: "Tracker graph dependency" },
  {
    pattern: /["']\/cabinet\/(?:projects?|migration|erp|cms)(?:\/|[?"'])/i,
    label: "foreign route",
  },
  { pattern: /["']\/api\/(?:projects?|migration)(?:\/|[?"'])/i, label: "foreign API" },
  { pattern: />\s*Backend operationId\s*:/i, label: "raw operationId in visible copy" },
  {
    pattern: />\s*\{\s*receipt\.evidence\.operationId\s*\}\s*</,
    label: "raw receipt operationId in visible copy",
  },
  {
    pattern: />\s*(?:X-Request-ID|Idempotency-Key|CSRF token)\b/i,
    label: "raw protocol field in visible copy",
  },
];

const EXPECTED_NAVIGATION = [
  { id: "work", label: "Моя работа", kind: "route" },
  { id: "relocation", label: "Заявки и воронки", kind: "route" },
  { id: "people", label: "Участники", kind: "route" },
  { id: "tasks", label: "Задачи", kind: "route" },
  { id: "employers", label: "Работодатели", kind: "route" },
  { id: "reports", label: "Отчёты", kind: "route" },
  { id: "assistant", label: "Помощник", kind: "separate-action" },
  { id: "admin-users", label: "Пользователи", kind: "gated-route" },
  { id: "admin-vacancies", label: "Вакансии лендинга", kind: "gated-route" },
  { id: "admin-stories", label: "Истории лендинга", kind: "gated-route" },
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function words(value) {
  if (typeof value !== "string") {
    return [];
  }
  return Array.from(
    value.toLocaleLowerCase("ru-RU").matchAll(/[\p{L}\p{N}_-]+/gu),
    (match) => match[0],
  );
}

function collectOpenApiOperationIds(openApi) {
  const operationIds = new Set();
  if (!isRecord(openApi?.paths)) {
    return operationIds;
  }

  for (const pathItem of Object.values(openApi.paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLocaleLowerCase()) || !isRecord(operation)) {
        continue;
      }
      if (isNonEmptyString(operation.operationId)) {
        operationIds.add(operation.operationId);
      }
    }
  }
  return operationIds;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

async function readJson(filePath) {
  const source = await readFile(filePath, "utf8");
  return JSON.parse(source);
}

async function listFiles(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.resolve(directory, entry.name))
    .sort();
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

export async function verifyUiRegistry({ appRoot = defaultAppRoot } = {}) {
  const resolvedAppRoot = path.resolve(appRoot);
  const registryDirectory = path.resolve(resolvedAppRoot, "registry");
  const componentsPath = path.resolve(registryDirectory, "components.json");
  const screensPath = path.resolve(registryDirectory, "screens.json");
  const recipesPath = path.resolve(registryDirectory, "recipes.json");
  const accessPoliciesPath = path.resolve(registryDirectory, "access-policies.json");
  const openApiPath = path.resolve(resolvedAppRoot, "../crm-backend/openapi/openapi.json");
  const errors = [];
  const check = (condition, message) => {
    if (!condition) {
      errors.push(message);
    }
  };

  let componentsRegistry;
  let screensRegistry;
  let recipesRegistry;
  let accessPoliciesRegistry;
  let openApi;
  try {
    [componentsRegistry, screensRegistry, recipesRegistry, accessPoliciesRegistry, openApi] =
      await Promise.all([
        readJson(componentsPath),
        readJson(screensPath),
        readJson(recipesPath),
        readJson(accessPoliciesPath),
        readJson(openApiPath),
      ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`UI registry input cannot be read: ${message}`);
  }

  check(
    componentsRegistry?.schemaVersion === "1.0.0",
    "components.json must use schemaVersion 1.0.0",
  );
  check(screensRegistry?.schemaVersion === "1.0.0", "screens.json must use schemaVersion 1.0.0");
  check(recipesRegistry?.schemaVersion === "1.0.0", "recipes.json must use schemaVersion 1.0.0");
  check(
    accessPoliciesRegistry?.schemaVersion === "1.0.0",
    "access-policies.json must use schemaVersion 1.0.0",
  );
  check(
    componentsRegistry?.product === "kurs-na-sever-crm",
    "components.json has the wrong product",
  );
  check(screensRegistry?.product === "kurs-na-sever-crm", "screens.json has the wrong product");
  check(recipesRegistry?.product === "kurs-na-sever-crm", "recipes.json has the wrong product");
  check(
    accessPoliciesRegistry?.product === "kurs-na-sever-crm",
    "access-policies.json has the wrong product",
  );

  const openApiOperationIds = collectOpenApiOperationIds(openApi);
  check(openApiOperationIds.size > 0, "backend OpenAPI exposes no operationId values");

  const components = ensureArray(componentsRegistry?.components);
  const componentIds = new Set();
  const registeredContractPaths = new Set();
  const registeredSnippetPaths = new Set();

  for (const component of components) {
    const context = `component ${component?.id ?? "<missing-id>"}`;
    check(isRecord(component), `${context} must be an object`);
    check(COMPONENT_ID_PATTERN.test(component?.id ?? ""), `${context} has an invalid id`);
    check(!componentIds.has(component?.id), `${context} is duplicated`);
    if (isNonEmptyString(component?.id)) {
      componentIds.add(component.id);
    }

    for (const key of ["owner", "implementationPath", "contractPath", "snippetPath"]) {
      check(isNonEmptyString(component?.[key]), `${context} must define ${key}`);
    }
    for (const key of ["variants", "states", "inputs", "events", "accessibility", "motion"]) {
      check(
        Array.isArray(component?.[key]) && component[key].length > 0,
        `${context}.${key} must be non-empty`,
      );
    }

    const implementationPath = path.resolve(
      resolvedAppRoot,
      component?.implementationPath ?? "missing",
    );
    const contractPath = path.resolve(resolvedAppRoot, component?.contractPath ?? "missing");
    const snippetPath = path.resolve(resolvedAppRoot, component?.snippetPath ?? "missing");
    check(
      isPathInside(resolvedAppRoot, implementationPath),
      `${context} implementation escapes the CRM frontend root`,
    );
    check(
      isPathInside(resolvedAppRoot, contractPath),
      `${context} contract escapes the CRM frontend root`,
    );
    check(
      isPathInside(resolvedAppRoot, snippetPath),
      `${context} snippet escapes the CRM frontend root`,
    );
    const isSharedUiImplementation = component?.implementationPath?.startsWith("src/shared/ui/");
    const isRuntimeShellImplementation =
      component?.id === "ui.app-shell" &&
      component?.implementationPath === "src/app/layout/AppShell.tsx";
    check(
      isSharedUiImplementation || isRuntimeShellImplementation,
      `${context} implementation must be CRM-owned shared UI or the registered runtime shell`,
    );
    check(
      component?.contractPath?.startsWith("registry/contracts/"),
      `${context} contract must live in registry/contracts`,
    );
    check(
      component?.snippetPath?.startsWith("registry/snippets/"),
      `${context} snippet must live in registry/snippets`,
    );
    registeredContractPaths.add(contractPath);
    registeredSnippetPaths.add(snippetPath);

    let contract;
    let snippet;
    let implementation;
    try {
      [contract, snippet, implementation] = await Promise.all([
        readJson(contractPath),
        readFile(snippetPath, "utf8"),
        readFile(implementationPath, "utf8"),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${context} artifact cannot be read: ${message}`);
      continue;
    }

    for (const key of CONTRACT_KEYS) {
      check(contract[key] !== undefined, `${context} contract is missing ${key}`);
    }
    check(contract.componentId === component.id, `${context} contract componentId does not match`);
    check(contract.schemaVersion === "1.0.0", `${context} contract must use schemaVersion 1.0.0`);
    check(
      Array.isArray(contract.variants) && contract.variants.length > 0,
      `${context} contract variants must be non-empty`,
    );
    check(
      Array.isArray(contract.states) && contract.states.length > 0,
      `${context} contract states must be non-empty`,
    );
    check(Array.isArray(contract.inputs), `${context} contract inputs must be an array`);
    check(
      Array.isArray(contract.invariants) && contract.invariants.length > 0,
      `${context} contract invariants must be non-empty`,
    );
    check(
      snippet.includes(`// component-id: ${component.id}`),
      `${context} snippet needs its exact component-id marker`,
    );
    const snippetConsumesRegisteredApi =
      snippet.includes('from "@/shared/ui"') ||
      (component?.id === "ui.app-shell" && snippet.includes('from "@/app/layout/AppShell"'));
    check(
      snippetConsumesRegisteredApi,
      `${context} snippet must consume the public shared UI API or the registered runtime shell`,
    );

    for (const [fileLabel, source] of [
      ["implementation", implementation],
      ["snippet", snippet],
    ]) {
      for (const forbidden of FORBIDDEN_RUNTIME_PATTERNS) {
        check(
          !forbidden.pattern.test(source),
          `${context} ${fileLabel} contains forbidden ${forbidden.label}`,
        );
      }
    }
  }

  let actualContractPaths = [];
  let actualSnippetPaths = [];
  try {
    [actualContractPaths, actualSnippetPaths] = await Promise.all([
      listFiles(path.resolve(registryDirectory, "contracts"), ".json"),
      listFiles(path.resolve(registryDirectory, "snippets"), ".tsx"),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`registry artifact directories cannot be read: ${message}`);
  }
  for (const contractPath of actualContractPaths) {
    check(
      registeredContractPaths.has(contractPath),
      `unregistered contract: ${path.relative(resolvedAppRoot, contractPath)}`,
    );
  }
  for (const snippetPath of actualSnippetPaths) {
    check(
      registeredSnippetPaths.has(snippetPath),
      `unregistered snippet: ${path.relative(resolvedAppRoot, snippetPath)}`,
    );
  }
  check(
    actualContractPaths.length === components.length,
    "every component must have exactly one registered contract",
  );
  check(
    actualSnippetPaths.length === components.length,
    "every component must have exactly one registered snippet",
  );

  const screens = ensureArray(screensRegistry?.screens);
  check(
    screens.length === 51,
    `screens.json must contain exactly 51 screens, found ${screens.length}`,
  );
  const screenIds = new Set();
  const screenNumbers = new Set();
  const referenceImages = new Set();

  for (const screen of screens) {
    const context = `screen ${screen?.number ?? "?"} ${screen?.id ?? "<missing-id>"}`;
    check(Number.isInteger(screen?.number), `${context} number must be an integer`);
    check(
      screen.number >= 1 && screen.number <= 51,
      `${context} number must be in the 1..51 inventory`,
    );
    check(!screenNumbers.has(screen.number), `${context} number is duplicated`);
    screenNumbers.add(screen.number);
    check(SCREEN_ID_PATTERN.test(screen?.id ?? ""), `${context} has an invalid id`);
    check(!screenIds.has(screen?.id), `${context} id is duplicated`);
    if (isNonEmptyString(screen?.id)) {
      screenIds.add(screen.id);
    }
    check(isNonEmptyString(screen?.title), `${context} title is required`);
    check(isNonEmptyString(screen?.purpose), `${context} purpose is required`);
    check(isNonEmptyString(screen?.kind), `${context} kind is required`);
    check(SHELLS.has(screen?.shell), `${context} has unsupported shell ${screen?.shell}`);
    check(
      BACKEND_STATUSES.has(screen?.backendStatus),
      `${context} has unsupported backendStatus ${screen?.backendStatus}`,
    );
    check(
      REFERENCE_IMAGE_PATTERN.test(screen?.referenceImage ?? ""),
      `${context} has an invalid reference image name`,
    );
    check(!referenceImages.has(screen?.referenceImage), `${context} reference image is duplicated`);
    referenceImages.add(screen?.referenceImage);

    if (screen.route === null) {
      check(
        ["surface", "registry-only"].includes(screen.kind),
        `${context} may omit a route only for a surface or registry-only entry`,
      );
    } else {
      check(
        isNonEmptyString(screen.route) && screen.route.startsWith("/cabinet/"),
        `${context} route must start with /cabinet/`,
      );
    }

    const operationIds = ensureArray(screen?.operationIds);
    const screenComponentIds = ensureArray(screen?.componentIds);
    check(Array.isArray(screen?.operationIds), `${context}.operationIds must be an array`);
    check(
      Array.isArray(screen?.componentIds) && screenComponentIds.length > 0,
      `${context}.componentIds must be non-empty`,
    );
    check(
      new Set(operationIds).size === operationIds.length,
      `${context} has duplicate operationIds`,
    );
    check(
      new Set(screenComponentIds).size === screenComponentIds.length,
      `${context} has duplicate componentIds`,
    );
    for (const operationId of operationIds) {
      check(isNonEmptyString(operationId), `${context} contains an invalid operationId`);
      check(
        openApiOperationIds.has(operationId),
        `${context} references unknown OpenAPI operationId ${operationId}`,
      );
    }
    for (const componentId of screenComponentIds) {
      check(
        componentIds.has(componentId),
        `${context} references unknown component ${componentId}`,
      );
    }

    if (["connected", "partial"].includes(screen.backendStatus)) {
      check(operationIds.length > 0, `${context} must reference at least one verified operationId`);
    } else {
      check(
        operationIds.length === 0,
        `${context} must keep operationIds empty while it is a contract gap`,
      );
    }

    if (screen.businessRoles !== undefined) {
      check(
        Array.isArray(screen.businessRoles) && screen.businessRoles.length > 0,
        `${context}.businessRoles must be a non-empty array when declared`,
      );
      for (const role of ensureArray(screen.businessRoles)) {
        check(BUSINESS_ROLES.has(role), `${context} has unsupported business role ${role}`);
      }
      check(
        Array.isArray(screen.requiredPermissions),
        `${context}.requiredPermissions must be an array when businessRoles are declared`,
      );
    }

    const runtimeWords = [screen.title, screen.purpose, screen.kind, screen.route].flatMap(words);
    for (const runtimeWord of runtimeWords) {
      check(
        !FORBIDDEN_RUNTIME_WORDS.has(runtimeWord),
        `${context} contains foreign runtime concept ${runtimeWord}`,
      );
    }

    if (AUTH_SCREEN_NUMBERS.has(screen.number)) {
      check(screen.shell === "auth", `${context} must use the isolated auth shell`);
      check(
        !screenComponentIds.includes("ui.app-shell"),
        `${context} must not render the CRM app shell`,
      );
      const allowedOperations = AUTH_OPERATION_ALLOWLIST.get(screen.number) ?? new Set();
      for (const operationId of operationIds) {
        check(
          allowedOperations.has(operationId),
          `${context} cannot use ${operationId} in the MAX test boundary`,
        );
      }
      check(
        operationIds.length === allowedOperations.size,
        `${context} operationIds differ from its auth allowlist`,
      );
    }

    if (screen.number === 33) {
      check(
        !operationIds.some((operationId) => operationId.includes("ProjectRole")),
        `${context} must use CRM role operations, not project roles`,
      );
    }
    if (screen.number === 50) {
      check(
        operationIds.length === 0,
        `${context} must not reuse migration operations for unlinked CRM records`,
      );
    }
  }

  const accessPolicies = ensureArray(accessPoliciesRegistry?.policies);
  const accessPolicyIds = new Set();
  for (const policy of accessPolicies) {
    const context = `access policy ${policy?.id ?? "<missing-id>"}`;
    check(isNonEmptyString(policy?.id), `${context} id is required`);
    check(!accessPolicyIds.has(policy?.id), `${context} is duplicated`);
    accessPolicyIds.add(policy?.id);
    check(
      isNonEmptyString(policy?.route) && policy.route.startsWith("/cabinet/crm/"),
      `${context} route must stay inside /cabinet/crm/`,
    );
    check(
      Array.isArray(policy?.businessRoles) && policy.businessRoles.length > 0,
      `${context}.businessRoles must be non-empty`,
    );
    for (const role of ensureArray(policy?.businessRoles)) {
      check(BUSINESS_ROLES.has(role), `${context} has unsupported business role ${role}`);
    }
    check(
      Array.isArray(policy?.requiredPermissions),
      `${context}.requiredPermissions must be an array`,
    );
    check(SCOPE_POLICIES.has(policy?.scopePolicy), `${context} has unsupported scopePolicy`);
    check(Array.isArray(policy?.operationIds), `${context}.operationIds must be an array`);
    for (const operationId of ensureArray(policy?.operationIds)) {
      check(
        openApiOperationIds.has(operationId),
        `${context} references unknown OpenAPI operationId ${operationId}`,
      );
    }
    if (policy?.scopePolicy === "contract-gap") {
      check(policy.operationIds.length === 0, `${context} contract gap cannot invent operationIds`);
    } else {
      check(policy.operationIds.length > 0, `${context} must reference verified operationIds`);
    }
  }
  check(accessPolicies.length >= 10, "access-policies.json must cover the two-role runtime routes");

  for (let number = 1; number <= 51; number += 1) {
    check(screenNumbers.has(number), `screen inventory is missing number ${number}`);
  }

  const navigation = ensureArray(recipesRegistry?.topLevelNavigation);
  check(
    navigation.length === EXPECTED_NAVIGATION.length,
    "top-level navigation must match the two-role registry",
  );
  EXPECTED_NAVIGATION.forEach((expected, index) => {
    const actual = navigation[index];
    check(actual?.id === expected.id, `navigation item ${index + 1} must be ${expected.id}`);
    check(
      actual?.label === expected.label,
      `navigation item ${expected.id} must be labelled ${expected.label}`,
    );
    check(
      actual?.kind === expected.kind,
      `navigation item ${expected.id} must use kind ${expected.kind}`,
    );
  });
  const assistantNavigation = navigation.find((item) => item?.id === "assistant");
  check(
    assistantNavigation?.href === null,
    "assistant navigation must remain a separate action without a synthetic route",
  );
  for (const item of navigation) {
    check(
      Array.isArray(item?.businessRoles) && item.businessRoles.length > 0,
      `navigation ${item?.id} must declare businessRoles`,
    );
    for (const role of ensureArray(item?.businessRoles)) {
      check(BUSINESS_ROLES.has(role), `navigation ${item?.id} has unsupported role ${role}`);
    }
    if (item?.href !== null) {
      check(
        isNonEmptyString(item?.href) && item.href.startsWith("/cabinet/crm/"),
        `navigation ${item?.id} has a foreign route`,
      );
    }
  }

  const recipes = ensureArray(recipesRegistry?.recipes);
  const recipeIds = new Set();
  const coveredScreenIds = new Set();
  for (const recipe of recipes) {
    const context = `recipe ${recipe?.id ?? "<missing-id>"}`;
    check(RECIPE_ID_PATTERN.test(recipe?.id ?? ""), `${context} has an invalid id`);
    check(!recipeIds.has(recipe?.id), `${context} is duplicated`);
    if (isNonEmptyString(recipe?.id)) {
      recipeIds.add(recipe.id);
    }
    check(isNonEmptyString(recipe?.purpose), `${context} purpose is required`);
    for (const key of ["screenIds", "componentIds", "entryStates", "exitEvidence", "invariants"]) {
      check(
        Array.isArray(recipe?.[key]) && recipe[key].length > 0,
        `${context}.${key} must be non-empty`,
      );
    }
    check(
      new Set(ensureArray(recipe?.screenIds)).size === ensureArray(recipe?.screenIds).length,
      `${context} has duplicate screenIds`,
    );
    check(
      new Set(ensureArray(recipe?.componentIds)).size === ensureArray(recipe?.componentIds).length,
      `${context} has duplicate componentIds`,
    );
    for (const screenId of ensureArray(recipe?.screenIds)) {
      check(screenIds.has(screenId), `${context} references unknown screen ${screenId}`);
      coveredScreenIds.add(screenId);
    }
    for (const componentId of ensureArray(recipe?.componentIds)) {
      check(
        componentIds.has(componentId),
        `${context} references unknown component ${componentId}`,
      );
    }
  }
  for (const screenId of screenIds) {
    check(coveredScreenIds.has(screenId), `screen ${screenId} is not covered by any recipe`);
  }

  if (errors.length > 0) {
    throw new Error(
      `UI registry verification failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }

  return {
    components: components.length,
    screens: screens.length,
    recipes: recipes.length,
    operationIds: openApiOperationIds.size,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const result = await verifyUiRegistry();
    console.log(
      `ui-registry: PASS components=${result.components} screens=${result.screens} recipes=${result.recipes} operationIds=${result.operationIds}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
