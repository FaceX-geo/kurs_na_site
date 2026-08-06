import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

const HealthSchema = Type.Object(
  {
    status: Type.Literal("ok"),
    service: Type.Literal("kurs-na-sever-crm-backend"),
    version: Type.String(),
    timestamp: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);

const ReadinessSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("ready"), Type.Literal("not_ready")]),
    checks: Type.Record(
      Type.String(),
      Type.Object(
        {
          status: Type.Union([Type.Literal("ok"), Type.Literal("error")]),
          latencyMs: Type.Number({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
    timestamp: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);

export interface SystemPluginOptions {
  version: string;
  checks: Readonly<Record<string, () => Promise<void>>>;
}

async function executeChecks(checks: SystemPluginOptions["checks"]) {
  const results: Record<string, { status: "ok" | "error"; latencyMs: number }> = {};

  await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      const startedAt = performance.now();
      try {
        await check();
        results[name] = { status: "ok", latencyMs: Number((performance.now() - startedAt).toFixed(2)) };
      } catch {
        results[name] = { status: "error", latencyMs: Number((performance.now() - startedAt).toFixed(2)) };
      }
    }),
  );

  return results;
}

export const systemPlugin: FastifyPluginAsync<SystemPluginOptions> = async (app, options) => {
  const liveness = async () => ({
    status: "ok" as const,
    service: "kurs-na-sever-crm-backend" as const,
    version: options.version,
    timestamp: new Date().toISOString(),
  });
  app.get(
    "/health/live",
    {
      schema: {
        operationId: "GetLiveness",
        tags: ["system"],
        summary: "Process liveness",
        response: { 200: HealthSchema },
      },
    },
    liveness,
  );
  app.get(
    "/healthz",
    {
      schema: {
        operationId: "GetHealthLegacy",
        tags: ["system"],
        summary: "Deprecated process liveness alias",
        deprecated: true,
        response: { 200: HealthSchema },
      },
    },
    liveness,
  );

  const readiness = async (_request: FastifyRequest, reply: FastifyReply) => {
    const checks = await executeChecks(options.checks);
    const ready = Object.values(checks).every((check) => check.status === "ok");
    return reply.status(ready ? 200 : 503).send({
      status: ready ? "ready" : "not_ready",
      checks,
      timestamp: new Date().toISOString(),
    });
  };
  const readinessSchema = {
    tags: ["system"],
    summary: "Dependency readiness",
    response: { 200: ReadinessSchema, 503: ReadinessSchema },
  };
  app.get(
    "/health/ready",
    {
      schema: { ...readinessSchema, operationId: "GetReadiness" },
    },
    readiness,
  );
  app.get(
    "/readyz",
    {
      schema: {
        ...readinessSchema,
        operationId: "GetReadinessLegacy",
        summary: "Deprecated dependency readiness alias",
        deprecated: true,
      },
    },
    readiness,
  );
};
