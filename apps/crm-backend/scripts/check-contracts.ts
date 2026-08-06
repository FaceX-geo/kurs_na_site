#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UPLOAD_STORAGE_CEILING_BYTES } from "../src/common/upload-policy.js";
import { CANDIDATE_360_OPERATION_LIST } from "../src/modules/candidate360/registry.js";
import { CRM_COMMAND_OPERATION_LIST } from "../src/modules/crm-commands/registry.js";
import { CRM_OPERATIONS_OPERATION_LIST } from "../src/modules/crm-operations/registry.js";
import { ROLE_OPERATION_LIST, ROLE_PREVIEW_OPERATION } from "../src/modules/identity/admin-role-registry.js";
import { IDENTITY_OPERATION_LIST } from "../src/modules/identity/operation-registry.js";
import { PUBLIC_CONTENT_OPERATION_LIST } from "../src/modules/public-content/registry.js";
import { CRM_OPERATION_LIST } from "../src/registry/operation-registry.js";

type JsonObject = Readonly<Record<string, unknown>>;

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function openApiPath(fastifyPath: string): string {
  return fastifyPath.replace(/:([A-Za-z0-9_]+)/gu, "{$1}");
}

function operationAt(paths: JsonObject, routePath: string, method: string): JsonObject {
  const pathItem = object(paths[routePath], `OpenAPI path ${routePath}`);
  return object(pathItem[method.toLowerCase()], `${method} ${routePath}`);
}

interface ContractRegistryOperation {
  readonly key: string;
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly permissionCode: string;
}

function assertRegistryOperations(
  paths: JsonObject,
  label: string,
  operations: readonly ContractRegistryOperation[],
): void {
  for (const registered of operations) {
    const routePath = openApiPath(registered.path);
    const operation = operationAt(paths, routePath, registered.method);
    if (operation.operationId !== registered.operationId) {
      throw new Error(`${label} operation registry drift for ${registered.key}`);
    }
    if (operation["x-permission-code"] !== registered.permissionCode) {
      throw new Error(`${label} permission registry drift for ${registered.key}`);
    }
    const security = array(operation.security).map((item) => object(item, "security requirement"));
    if (security.length === 0) {
      throw new Error(`${label} operation ${registered.key} is missing security requirements`);
    }
    if (registered.method !== "GET" && !security.some((requirement) => "csrfToken" in requirement)) {
      throw new Error(`${label} mutation ${registered.key} is missing the CSRF security requirement`);
    }
  }
}

const inputPath = path.resolve(process.argv[2] ?? "openapi/openapi.json");
const document = object(JSON.parse(await readFile(inputPath, "utf8")) as unknown, "OpenAPI document");
if (document.openapi !== "3.1.0") {
  throw new Error("OpenAPI version must be 3.1.0");
}
const paths = object(document.paths, "OpenAPI paths");
const operationIds = new Set<string>();
let operationCount = 0;

for (const [routePath, rawPathItem] of Object.entries(paths)) {
  const pathItem = object(rawPathItem, `path ${routePath}`);
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const rawOperation = pathItem[method];
    if (rawOperation === undefined) {
      continue;
    }
    const operation = object(rawOperation, `${method.toUpperCase()} ${routePath}`);
    const operationId = operation.operationId;
    if (typeof operationId !== "string" || operationId.length === 0) {
      throw new Error(`${method.toUpperCase()} ${routePath} has no operationId`);
    }
    if (operationIds.has(operationId)) {
      throw new Error(`Duplicate operationId ${operationId}`);
    }
    operationIds.add(operationId);
    operationCount += 1;
  }
}

assertRegistryOperations(paths, "CRM read model", CRM_OPERATION_LIST);
assertRegistryOperations(paths, "CRM command", CRM_COMMAND_OPERATION_LIST);
assertRegistryOperations(paths, "CRM operations", CRM_OPERATIONS_OPERATION_LIST);
assertRegistryOperations(paths, "Candidate 360", CANDIDATE_360_OPERATION_LIST);
assertRegistryOperations(paths, "Public content", PUBLIC_CONTENT_OPERATION_LIST);

const queueCommunication = operationAt(
  paths,
  "/internal/v1/crm/communication-drafts/{draftId}/queue",
  "POST",
);
const queueParameters = array(queueCommunication.parameters).map((parameter) =>
  object(parameter, "QueueCommunication parameter"),
);
for (const headerName of ["if-match", "idempotency-key", "x-csrf-token"]) {
  if (!queueParameters.some((parameter) => parameter.in === "header" && parameter.name === headerName)) {
    throw new Error(`QueueCommunication is missing required ${headerName} header`);
  }
}
const queueResponses = object(queueCommunication.responses, "QueueCommunication responses");
const queueOkResponse = object(queueResponses["200"], "QueueCommunication 200 response");
const queueResponseHeaders = object(queueOkResponse.headers, "QueueCommunication response headers");
for (const headerName of ["ETag", "Idempotency-Replayed"]) {
  if (!(headerName in queueResponseHeaders)) {
    throw new Error(`QueueCommunication is missing documented ${headerName} response header`);
  }
}

const transitionCase = operationAt(paths, "/internal/v1/crm/cases/{caseId}/transitions", "POST");
const transitionCaseParameters = array(transitionCase.parameters).map((parameter) =>
  object(parameter, "TransitionCase parameter"),
);
for (const headerName of ["if-match", "idempotency-key", "x-csrf-token"]) {
  if (
    !transitionCaseParameters.some((parameter) => parameter.in === "header" && parameter.name === headerName)
  ) {
    throw new Error(`TransitionCase is missing ${headerName} header`);
  }
}
if (
  !transitionCaseParameters.some(
    (parameter) =>
      parameter.in === "header" && parameter.name === "idempotency-key" && parameter.required === true,
  )
) {
  throw new Error("TransitionCase Idempotency-Key must be required");
}
const transitionCaseResponses = object(transitionCase.responses, "TransitionCase responses");
const transitionCaseOk = object(transitionCaseResponses["200"], "TransitionCase 200 response");
const transitionCaseHeaders = object(transitionCaseOk.headers, "TransitionCase response headers");
for (const headerName of ["ETag", "Idempotency-Replayed"]) {
  if (!(headerName in transitionCaseHeaders)) {
    throw new Error(`TransitionCase is missing documented ${headerName} response header`);
  }
}
const transitionCaseContract = JSON.stringify(transitionCaseOk);
for (const receiptField of ["receipt", "auditEventId", "operationId", "requestId", "caseId", "version"]) {
  if (!transitionCaseContract.includes(`"${receiptField}"`)) {
    throw new Error(`TransitionCase response is missing ${receiptField}`);
  }
}

for (const registered of [ROLE_PREVIEW_OPERATION, ...ROLE_OPERATION_LIST]) {
  const routePath = openApiPath(registered.path);
  const operation = operationAt(paths, routePath, registered.method);
  if (operation.operationId !== registered.operationId) {
    throw new Error(`Identity role operation registry drift for ${registered.operationId}`);
  }
  if (operation["x-permission-code"] !== registered.permissionCode) {
    throw new Error(`Identity role permission registry drift for ${registered.operationId}`);
  }
  if (array(operation.security).length === 0) {
    throw new Error(`Identity role operation ${registered.operationId} is missing security requirements`);
  }
}

for (const registered of IDENTITY_OPERATION_LIST) {
  const routePath = openApiPath(registered.path);
  const operation = operationAt(paths, routePath, registered.method);
  if (operation.operationId !== registered.operationId) {
    throw new Error(`Identity operation registry drift for ${registered.key}`);
  }
  const security = array(operation.security).map((item) => object(item, "security requirement"));
  if (registered.access === "conditional_public_or_reauth") {
    const hasPublicBranch = security.some((requirement) => Object.keys(requirement).length === 0);
    const hasProtectedBranch = security.some(
      (requirement) => "sessionCookie" in requirement && "csrfToken" in requirement,
    );
    if (!hasPublicBranch || !hasProtectedBranch) {
      throw new Error(
        "VerifyMfa must describe both public challenge and protected reauthentication branches",
      );
    }
    const responses = object(operation.responses, "VerifyMfa responses");
    if (!("403" in responses) || !("503" in responses)) {
      throw new Error("VerifyMfa must publish account and MFA provider failure contracts");
    }
    continue;
  }
  if (registered.access === "authenticated_origin") {
    const exactSessionOnlySecurity =
      security.length === 1 &&
      security.some((requirement) => "sessionCookie" in requirement && !("csrfToken" in requirement));
    if (!exactSessionOnlySecurity) {
      throw new Error("RefreshCsrfToken must require sessionCookie without an existing CSRF token");
    }
    const responses = object(operation.responses, "RefreshCsrfToken responses");
    for (const status of ["401", "403", "429"]) {
      if (!(status in responses)) {
        throw new Error(`RefreshCsrfToken must publish ${status} response`);
      }
    }
    continue;
  }
  if (!security.some((requirement) => "sessionCookie" in requirement)) {
    throw new Error(`Identity operation ${registered.key} must require a session cookie`);
  }
  if (registered.permissionCode && operation["x-permission-code"] !== registered.permissionCode) {
    throw new Error(`Identity permission registry drift for ${registered.key}`);
  }
  if (registered.method === "GET") {
    const parameters = array(operation.parameters).map((item) => object(item, "identity list parameter"));
    for (const name of ["cursor", "limit"]) {
      if (!parameters.some((parameter) => parameter.in === "query" && parameter.name === name)) {
        throw new Error(`Identity operation ${registered.key} is missing ${name} pagination`);
      }
    }
  }
}

const provisionSpecialist = operationAt(paths, "/internal/v1/admin/specialists", "POST");
const provisionSpecialistParameters = array(provisionSpecialist.parameters).map((item) =>
  object(item, "ProvisionSpecialist parameter"),
);
if (
  !provisionSpecialistParameters.some(
    (parameter) =>
      parameter.in === "header" && parameter.name === "idempotency-key" && parameter.required === true,
  )
) {
  throw new Error("ProvisionSpecialist Idempotency-Key must be required");
}
const provisionSpecialistResponses = object(provisionSpecialist.responses, "ProvisionSpecialist responses");
const provisionSpecialistAccepted = object(
  provisionSpecialistResponses["202"],
  "ProvisionSpecialist 202 response",
);
const provisionSpecialistHeaders = object(
  provisionSpecialistAccepted.headers,
  "ProvisionSpecialist response headers",
);
if (!("Idempotency-Replayed" in provisionSpecialistHeaders)) {
  throw new Error("ProvisionSpecialist is missing documented Idempotency-Replayed response header");
}
const provisionSpecialistContract = JSON.stringify(provisionSpecialistAccepted);
for (const receiptField of [
  "auditEventId",
  "operationId",
  "requestId",
  "userId",
  "employeeProfileId",
  "occurredAt",
  "credentialDelivery",
]) {
  if (!provisionSpecialistContract.includes(`"${receiptField}"`)) {
    throw new Error(`ProvisionSpecialist response is missing ${receiptField}`);
  }
}

const publicRoutes = [
  ["GET", "/public/v1/dictionaries/spheres"],
  ["GET", "/public/v1/map-points"],
  ["GET", "/public/v1/vacancies"],
  ["GET", "/public/v1/stories"],
  ["POST", "/public/v1/uploads"],
  ["POST", "/public/v1/applications"],
] as const;
for (const [method, routePath] of publicRoutes) {
  const operation = operationAt(paths, routePath, method);
  if (array(operation.security).length !== 0) {
    throw new Error(`${method} ${routePath} must remain cookie-free`);
  }
  if (method === "POST") {
    const parameters = array(operation.parameters).map((parameter) => object(parameter, "parameter"));
    const hasIdempotencyKey = parameters.some(
      (parameter) => parameter.in === "header" && parameter.name === "idempotency-key",
    );
    if (!hasIdempotencyKey) {
      throw new Error(`${method} ${routePath} has no Idempotency-Key contract`);
    }
  }
}

const publicUpload = operationAt(paths, "/public/v1/uploads", "POST");
const publicUploadResponses = object(publicUpload.responses, "Public upload responses");
const publicUploadCreated = object(publicUploadResponses["201"], "Public upload 201 response");
const publicUploadContent = object(publicUploadCreated.content, "Public upload response content");
const publicUploadJson = object(publicUploadContent["application/json"], "Public upload JSON response");
const publicUploadSchema = object(publicUploadJson.schema, "Public upload receipt schema");
const publicUploadProperties = object(publicUploadSchema.properties, "Public upload receipt properties");
const publicUploadSize = object(publicUploadProperties.size, "Public upload receipt size");
if (publicUploadSize.maximum !== UPLOAD_STORAGE_CEILING_BYTES) {
  throw new Error("Public upload receipt maximum must match the durable storage ceiling");
}

const candidateDocument = operationAt(paths, "/internal/v1/crm/documents/{documentId}", "GET");
const candidateDocumentResponses = object(candidateDocument.responses, "Candidate document responses");
const candidateDocumentOk = object(candidateDocumentResponses["200"], "Candidate document 200 response");
const candidateDocumentContent = object(candidateDocumentOk.content, "Candidate document response content");
const candidateDocumentJson = object(
  candidateDocumentContent["application/json"],
  "Candidate document JSON response",
);
const candidateDocumentSchema = object(candidateDocumentJson.schema, "Candidate document schema");
const candidateDocumentProperties = object(
  candidateDocumentSchema.properties,
  "Candidate document properties",
);
const candidateByteSize = object(candidateDocumentProperties.byteSize, "Candidate document byteSize");
const candidateByteSizeVariants = array(candidateByteSize.anyOf).map((variant) =>
  object(variant, "Candidate document byteSize variant"),
);
if (!candidateByteSizeVariants.some((variant) => variant.maximum === UPLOAD_STORAGE_CEILING_BYTES)) {
  throw new Error("Candidate document byteSize maximum must match the durable storage ceiling");
}

for (const legacyPath of [
  "/api/v1/dictionaries/spheres",
  "/api/v1/map-points",
  "/api/v1/vacancies",
  "/api/v1/stories",
  "/api/v1/uploads",
  "/api/v1/files",
  "/api/v1/applications",
]) {
  const pathItem = object(paths[legacyPath], `legacy path ${legacyPath}`);
  const method =
    legacyPath.includes("uploads") || legacyPath.includes("files") || legacyPath.includes("applications")
      ? "post"
      : "get";
  const operation = object(pathItem[method], `${method} ${legacyPath}`);
  if (operation.deprecated !== true) {
    throw new Error(`Compatibility route ${legacyPath} must be deprecated`);
  }
}

const requirementsCrosswalkPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "docs/cabinet/generated/requirements-crosswalk.csv",
);
const requirementsCrosswalk = await readFile(requirementsCrosswalkPath, "utf8");
const requiredCrmOperations = new Map<string, readonly string[]>();
for (const line of requirementsCrosswalk.split(/\r?\n/u)) {
  const match = /^"(CRM-(?:0[1-9]|1[0-3]))","[^"]*","[^"]*","([^"]+)"/u.exec(line);
  if (!match?.[1] || !match[2]) continue;
  requiredCrmOperations.set(match[1], match[2].split("|").filter(Boolean));
}
if (requiredCrmOperations.size !== 13) {
  throw new Error("CRM requirement crosswalk must contain CRM-01 through CRM-13");
}
for (const [requirementId, requiredOperations] of requiredCrmOperations) {
  for (const operationId of requiredOperations) {
    if (!operationIds.has(operationId)) {
      throw new Error(`${requirementId} requires missing OpenAPI operationId ${operationId}`);
    }
  }
}
const requirementsCrosswalkSha256 = createHash("sha256").update(requirementsCrosswalk).digest("hex");

process.stdout.write(
  `${JSON.stringify({
    status: "ok",
    inputPath,
    operationCount,
    crmReadOperations: CRM_OPERATION_LIST.length,
    crmCommandOperations: CRM_COMMAND_OPERATION_LIST.length,
    crmOperations: CRM_OPERATIONS_OPERATION_LIST.length,
    candidate360Operations: CANDIDATE_360_OPERATION_LIST.length,
    publicContentOperations: PUBLIC_CONTENT_OPERATION_LIST.length,
    identityOperations: IDENTITY_OPERATION_LIST.length,
    identityRoleOperations: ROLE_OPERATION_LIST.length + 1,
    crmRequirements: requiredCrmOperations.size,
    requirementsCrosswalkSha256,
  })}\n`,
);
