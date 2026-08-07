import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "./config/env.js";
import type { DatabaseHandle } from "./db/client.js";
import {
  candidate360Plugin,
  createCandidate360Service,
  PostgresCandidate360AuthorizationAdapter,
  PostgresCandidate360Repository,
} from "./modules/candidate360/index.js";
import {
  CRM_DICTIONARY_REGISTRY,
  CRM_STATE_REGISTRY,
  createCrmService,
  crmPlugin,
  PostgresCrmAuthorizationAdapter,
  PostgresCrmRepository,
  PostgresCrmTeamScopeResolver,
} from "./modules/crm/index.js";
import {
  createCrmCommandService,
  crmCommandPlugin,
  PostgresCrmCommandRepository,
} from "./modules/crm-commands/index.js";
import {
  createCrmOperationsService,
  crmOperationsPlugin,
  PostgresCrmOperationsRepository,
} from "./modules/crm-operations/index.js";
import {
  type AuthContext,
  IdentityAdminService,
  IdentityService,
  identityAdminPlugin,
  identityPlugin,
} from "./modules/identity/index.js";
import {
  createIntakeService,
  createObjectStore,
  intakeRoutes,
  PostgresIntakeAdapter,
} from "./modules/intake/index.js";
import {
  createOperationsReadService,
  operationsPlugin,
  PostgresOperationsAuthorizationAdapter,
  PostgresOperationsReadModel,
} from "./modules/operations/index.js";
import {
  createPublicContentService,
  PostgresPublicContentRepository,
  publicContentPlugin,
} from "./modules/public-content/index.js";

export interface ApplicationComposition {
  readonly identityService: IdentityService;
  readonly readinessChecks: Readonly<Record<string, () => Promise<void>>>;
  registerRoutes(app: FastifyInstance): Promise<void>;
}

/** Composition root: all concrete adapters are selected here, never in domain services. */
export function composeApplication(config: AppConfig, database: DatabaseHandle): ApplicationComposition {
  const crmRequestHashingKey = createHmac("sha256", config.piiHashingKey)
    .update("crm-command-idempotency@1")
    .digest("hex");
  const identityService = new IdentityService(database.db, config);
  const identityAdminService = new IdentityAdminService(database.db, config, identityService);
  const objectStore = createObjectStore(config);
  const intakeAdapter = new PostgresIntakeAdapter(database.db, config, objectStore);
  const intakeService = createIntakeService({
    repository: intakeAdapter,
    storage: intakeAdapter,
    maxUploadBytes: config.uploads.maxBytes,
  });
  const crmRepository = new PostgresCrmRepository(database.db, {
    idempotencyTtlSeconds: config.idempotencyTtlSeconds,
  });
  const crmTeamScopeResolver = new PostgresCrmTeamScopeResolver(database.db);
  const crmAuthorization = new PostgresCrmAuthorizationAdapter(database.db, {
    teamScopeResolver: crmTeamScopeResolver,
  });
  const crmService = createCrmService({
    repository: crmRepository,
    authorization: crmAuthorization,
    stateRegistry: CRM_STATE_REGISTRY,
    dictionaryRegistry: CRM_DICTIONARY_REGISTRY,
    cursorSigningKey: config.cursorSigningKey,
    requestHashingKey: crmRequestHashingKey,
  });
  const crmCommandService = createCrmCommandService({
    repository: new PostgresCrmCommandRepository(database.db, crmRepository, config.idempotencyTtlSeconds),
    authorization: crmAuthorization,
    requestHashingKey: crmRequestHashingKey,
  });
  const candidate360Service = createCandidate360Service({
    repository: new PostgresCandidate360Repository(database.db),
    authorization: new PostgresCandidate360AuthorizationAdapter(database.db, {
      teamScopeResolver: crmTeamScopeResolver,
    }),
    cursorSigningKey: config.cursorSigningKey,
    contentStore: objectStore,
    maxDocumentContentBytes: config.uploads.maxBytes,
  });
  const crmOperationsService = createCrmOperationsService({
    repository: new PostgresCrmOperationsRepository(database.db, config.idempotencyTtlSeconds),
    authorization: crmAuthorization,
    cursorSigningKey: config.cursorSigningKey,
    requestHashingKey: crmRequestHashingKey,
  });
  const operationsService = createOperationsReadService({
    repository: new PostgresOperationsReadModel(database.db),
    authorization: new PostgresOperationsAuthorizationAdapter(database.db),
    cursorSigningKey: config.cursorSigningKey,
  });
  const publicContentService = createPublicContentService(
    new PostgresPublicContentRepository(database.db, {
      cursorSigningKey: config.cursorSigningKey,
      idempotencyTtlSeconds: config.idempotencyTtlSeconds,
    }),
  );
  const authContexts = new WeakMap<FastifyRequest, AuthContext>();

  const authenticate = async (request: FastifyRequest): Promise<AuthContext> => {
    const existing = authContexts.get(request);
    if (existing) {
      return existing;
    }
    const context = await identityService.authenticate(request);
    authContexts.set(request, context);
    return context;
  };

  const resolveCrmActor = async (request: FastifyRequest) => {
    const context = await authenticate(request);
    const employee = await database.db
      .selectFrom("identity.employee_profile")
      .select("id")
      .where("person_id", "=", context.personId)
      .where("employment_state", "=", "active")
      .where("archived_at", "is", null)
      .executeTakeFirst();
    return {
      userAccountId: context.userAccountId,
      employeeProfileId: employee?.id ?? null,
      requestId: request.id,
    };
  };

  const verifyCrmMutation = async (request: FastifyRequest) => {
    const context = await authenticate(request);
    identityService.assertTrustedMutation(
      request,
      context,
      request.headers["x-csrf-token"] as string | undefined,
    );
  };

  return {
    identityService,
    readinessChecks: { objectStorage: () => objectStore.ping() },
    async registerRoutes(app) {
      await app.register(identityPlugin, {
        config,
        database,
        service: identityService,
        adminService: identityAdminService,
      });
      await app.register(identityAdminPlugin, {
        config,
        database,
        authService: identityService,
        service: identityAdminService,
      });
      await app.register(intakeRoutes, {
        service: intakeService,
        uploadMaxBytes: config.uploads.maxBytes,
        aliases: true,
        allowedOrigins: config.publicOrigins,
      });
      await app.register(publicContentPlugin, {
        service: publicContentService,
        resolveAuth: authenticate,
        async verifyMutationRequest(request, context) {
          identityService.assertTrustedMutation(
            request,
            context,
            request.headers["x-csrf-token"] as string | undefined,
          );
        },
      });
      await app.register(crmPlugin, {
        service: crmService,
        resolveActor: resolveCrmActor,
        verifyMutationRequest: verifyCrmMutation,
      });
      await app.register(crmCommandPlugin, {
        service: crmCommandService,
        resolveActor: resolveCrmActor,
        verifyMutationRequest: verifyCrmMutation,
      });
      await app.register(candidate360Plugin, {
        service: candidate360Service,
        resolveActor: resolveCrmActor,
        verifyMutationRequest: verifyCrmMutation,
      });
      await app.register(crmOperationsPlugin, {
        service: crmOperationsService,
        resolveActor: resolveCrmActor,
        verifyMutationRequest: verifyCrmMutation,
      });
      await app.register(operationsPlugin, {
        service: operationsService,
        async resolveActor(request) {
          const context = await authenticate(request);
          return { userAccountId: context.userAccountId, requestId: request.id };
        },
      });
    },
  };
}
