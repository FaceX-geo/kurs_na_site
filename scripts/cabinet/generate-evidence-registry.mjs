#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const sourcePath = path.join(
  repositoryRoot,
  "docs/cabinet/generated/requirements-crosswalk.csv",
);
const targetPath = path.join(
  repositoryRoot,
  "docs/cabinet/generated/evidence-id-registry.json",
);

function parseCsv(raw) {
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
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function splitPipe(value) {
  return String(value ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isNotApplicable(value) {
  return /^N\/A\([^)]+\)$/.test(value);
}

const rows = parseCsv(fs.readFileSync(sourcePath, "utf8"));
const headers = rows[0];
const objects = rows.slice(1).map((row) =>
  Object.fromEntries(headers.map((header, index) => [header, row[index]])),
);

const testMap = new Map();
const auditMap = new Map();
const queryMap = new Map();
const exemptions = [];

function register(map, id, requirementId, kind) {
  const entry = map.get(id) ?? {
    id,
    kind,
    lifecycle: "planned_until_gate_evidence_is_persisted",
    requirements: [],
  };
  if (!entry.requirements.includes(requirementId)) {
    entry.requirements.push(requirementId);
  }
  map.set(id, entry);
}

for (const requirement of objects) {
  for (const [column, kind] of [
    ["positive_test_id", "positive_test"],
    ["forbidden_test_id", "forbidden_test"],
  ]) {
    for (const id of splitPipe(requirement[column])) {
      register(testMap, id, requirement.requirement_id, kind);
    }
  }
  for (const id of splitPipe(requirement.audit_evidence)) {
    if (isNotApplicable(id)) {
      exemptions.push({
        requirement_id: requirement.requirement_id,
        field: "audit_evidence",
        reason: id.slice(4, -1),
      });
    } else {
      register(auditMap, id, requirement.requirement_id, "audit_evidence");
    }
  }
  for (const id of splitPipe(requirement.migration_query)) {
    if (isNotApplicable(id)) {
      exemptions.push({
        requirement_id: requirement.requirement_id,
        field: "migration_query",
        reason: id.slice(4, -1),
      });
    } else {
      register(queryMap, id, requirement.requirement_id, "migration_query");
    }
  }
  for (const field of ["operation", "visual_reference"]) {
    if (isNotApplicable(requirement[field])) {
      exemptions.push({
        requirement_id: requirement.requirement_id,
        field,
        reason: requirement[field].slice(4, -1),
      });
    }
  }
}

const registry = {
  registry_version: "1.0.0",
  source: "requirements-crosswalk.csv",
  lifecycle_contract:
    "planned IDs become evidence-backed at their owning gate; unknown IDs and unreasoned N/A are invalid",
  tests: [...testMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
  audit_evidence: [...auditMap.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  ),
  migration_queries: [...queryMap.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  ),
  exemptions: exemptions.sort((left, right) =>
    `${left.requirement_id}:${left.field}`.localeCompare(
      `${right.requirement_id}:${right.field}`,
    ),
  ),
};

fs.writeFileSync(targetPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(
  `Evidence registry generated: ${registry.tests.length} tests, ` +
    `${registry.audit_evidence.length} audit IDs, ` +
    `${registry.migration_queries.length} migration query IDs, ` +
    `${registry.exemptions.length} reasoned exemptions`,
);
