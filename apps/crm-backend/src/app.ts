import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { registerErrorHandling } from "./common/errors.js";
import { newPublicId } from "./common/id.js";
import type { AppConfig } from "./config/env.js";
import type { DatabaseHandle } from "./db/client.js";
import { systemPlugin } from "./modules/system/plugin.js";

export interface AppDependencies {
  database?: DatabaseHandle;
  registerRoutes?: (app: FastifyInstance) => Promise<void>;
  readinessChecks?: Readonly<Record<string, () => Promise<void>>>;
}

const TRUSTED_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

function requestIdFromEdge(request: { readonly headers: Record<string, unknown> }): string {
  const value = request.headers["x-request-id"];
  return typeof value === "string" && TRUSTED_REQUEST_ID.test(value) ? value : newPublicId("request");
}

export async function buildApp(config: AppConfig, dependencies: AppDependencies = {}) {
  const app = Fastify({
    trustProxy: config.trustProxy,
    genReqId: requestIdFromEdge,
    logger:
      config.nodeEnv === "test"
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "req.body.personal",
                "req.body.password",
                "req.body.token",
                "res.headers.set-cookie",
              ],
              censor: "[REDACTED]",
            },
          },
    bodyLimit: config.uploads.maxBytes,
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Курс на Север CRM Backend API",
        description: "Versioned public intake and internal CRM contracts.",
        version: "0.1.0",
      },
      servers: [{ url: "/", description: "Same-origin edge" }],
      tags: [
        { name: "system", description: "Liveness and readiness" },
        { name: "public-intake", description: "Cookie-free landing intake" },
        { name: "public-content", description: "Versioned vacancies and relocation stories" },
        { name: "crm", description: "Authenticated CRM operations" },
        { name: "identity", description: "Authentication and sessions" },
        { name: "migration", description: "Migration control plane" },
      ],
      components: {
        securitySchemes: {
          sessionCookie: {
            type: "apiKey",
            in: "cookie",
            name: config.session.cookieName,
          },
          csrfToken: {
            type: "apiKey",
            in: "header",
            name: "X-CSRF-Token",
          },
        },
      },
    },
  });

  if (config.nodeEnv !== "production") {
    await app.register(swaggerUi, { routePrefix: "/docs", staticCSP: true });
  }

  await app.register(helmet, {
    global: true,
    ...(config.nodeEnv === "production" ? {} : { contentSecurityPolicy: false }),
  });
  await app.register(cookie);
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.publicOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Idempotency-Key", "If-Match", "X-CSRF-Token", "X-Request-ID"],
    exposedHeaders: ["ETag", "X-Request-ID", "Retry-After"],
    credentials: true,
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => request.ip,
  });
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: config.uploads.maxBytes,
      fields: 2,
    },
  });

  registerErrorHandling(app);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    if (request.url.startsWith("/internal/")) {
      reply.header("cache-control", "no-store, private");
      reply.header("pragma", "no-cache");
    }
  });

  const readinessChecks: Record<string, () => Promise<void>> = {
    ...(dependencies.database ? { database: () => dependencies.database?.ping() ?? Promise.resolve() } : {}),
    ...dependencies.readinessChecks,
  };

  await app.register(systemPlugin, { version: "0.1.0", checks: readinessChecks });
  if (dependencies.registerRoutes) {
    await dependencies.registerRoutes(app);
  }

  return app;
}
