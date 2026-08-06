export type Candidate360HttpMethod = "GET" | "POST";

export type Candidate360OperationKey =
  | "duplicates.list"
  | "duplicates.merge"
  | "documents.list"
  | "documents.get"
  | "documents.content"
  | "recommenders.list"
  | "recommenders.link"
  | "documents.review";

export interface Candidate360OperationDefinition {
  readonly key: Candidate360OperationKey;
  readonly operationId:
    | "ListDuplicateCandidates"
    | "MergeCandidate"
    | "ListCandidateDocuments"
    | "GetCandidateDocument"
    | "GetCandidateDocumentContent"
    | "ListCandidateRecommenders"
    | "LinkRecommender"
    | "ReviewDocument";
  readonly method: Candidate360HttpMethod;
  readonly path: string;
  readonly permissionCode:
    | "crm.candidate.duplicates.read"
    | "crm.candidate.merge"
    | "crm.candidate.document.read"
    | "crm.candidate.document.download"
    | "crm.candidate.recommender.read"
    | "crm.candidate.recommender.link"
    | "crm.candidate.document.review";
  readonly resourceType: "candidate_duplicate" | "person" | "candidate_document";
  readonly summary: string;
}

const definitions = [
  {
    key: "duplicates.list",
    operationId: "ListDuplicateCandidates",
    method: "GET",
    path: "/internal/v1/crm/candidate-duplicates",
    permissionCode: "crm.candidate.duplicates.read",
    resourceType: "candidate_duplicate",
    summary: "Очередь возможных дублей кандидатов",
  },
  {
    key: "duplicates.merge",
    operationId: "MergeCandidate",
    method: "POST",
    path: "/internal/v1/crm/candidate-duplicates/:duplicateId/merge",
    permissionCode: "crm.candidate.merge",
    resourceType: "candidate_duplicate",
    summary: "Подтвердить обратимое объединение кандидатов",
  },
  {
    key: "documents.list",
    operationId: "ListCandidateDocuments",
    method: "GET",
    path: "/internal/v1/crm/people/:personId/documents",
    permissionCode: "crm.candidate.document.read",
    resourceType: "person",
    summary: "Документы кандидата",
  },
  {
    key: "documents.get",
    operationId: "GetCandidateDocument",
    method: "GET",
    path: "/internal/v1/crm/documents/:documentId",
    permissionCode: "crm.candidate.document.read",
    resourceType: "candidate_document",
    summary: "Карточка документа кандидата",
  },
  {
    key: "documents.content",
    operationId: "GetCandidateDocumentContent",
    method: "GET",
    path: "/internal/v1/crm/documents/:documentId/content",
    permissionCode: "crm.candidate.document.download",
    resourceType: "candidate_document",
    summary: "Скачать проверенное содержимое документа кандидата",
  },
  {
    key: "recommenders.list",
    operationId: "ListCandidateRecommenders",
    method: "GET",
    path: "/internal/v1/crm/people/:personId/recommenders",
    permissionCode: "crm.candidate.recommender.read",
    resourceType: "person",
    summary: "Рекомендатели кандидата",
  },
  {
    key: "recommenders.link",
    operationId: "LinkRecommender",
    method: "POST",
    path: "/internal/v1/crm/people/:personId/recommenders",
    permissionCode: "crm.candidate.recommender.link",
    resourceType: "person",
    summary: "Связать кандидата с рекомендателем",
  },
  {
    key: "documents.review",
    operationId: "ReviewDocument",
    method: "POST",
    path: "/internal/v1/crm/documents/:documentId/reviews",
    permissionCode: "crm.candidate.document.review",
    resourceType: "candidate_document",
    summary: "Проверить документ кандидата",
  },
] as const satisfies readonly Candidate360OperationDefinition[];

function buildRegistry(
  operations: readonly Candidate360OperationDefinition[],
): Readonly<Record<Candidate360OperationKey, Candidate360OperationDefinition>> {
  const result = new Map<Candidate360OperationKey, Candidate360OperationDefinition>();
  const operationIds = new Set<string>();
  const routes = new Set<string>();

  for (const operation of operations) {
    if (result.has(operation.key)) throw new Error(`Duplicate Candidate 360 operation key: ${operation.key}`);
    if (operationIds.has(operation.operationId)) {
      throw new Error(`Duplicate Candidate 360 operationId: ${operation.operationId}`);
    }
    const route = `${operation.method} ${operation.path}`;
    if (routes.has(route)) throw new Error(`Duplicate Candidate 360 route: ${route}`);
    result.set(operation.key, Object.freeze({ ...operation }));
    operationIds.add(operation.operationId);
    routes.add(route);
  }

  return Object.freeze(
    Object.fromEntries(result) as Record<Candidate360OperationKey, Candidate360OperationDefinition>,
  );
}

export const CANDIDATE_360_OPERATIONS = buildRegistry(definitions);

export const CANDIDATE_360_OPERATION_LIST: readonly Candidate360OperationDefinition[] = Object.freeze(
  Object.values(CANDIDATE_360_OPERATIONS),
);
