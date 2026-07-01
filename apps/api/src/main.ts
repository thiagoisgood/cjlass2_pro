import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { assertProductionConfig } from "./core/runtime-config.js";

async function bootstrap() {
  assertProductionConfig();

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? true,
    credentials: true,
  });

  const openApiDocument = createOpenApiDocument();
  app.getHttpAdapter().getInstance().get("/api/v1/openapi.json", async () => openApiDocument);

  await app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0");
}

function createOpenApiDocument() {
  const routes: Array<[string, "get" | "post" | "patch" | "delete"]> = [
    ["/api/v1/snapshot", "get"],
    ["/api/v1/health", "get"],
    ["/api/v1/dev/reset", "post"],
    ["/api/v1/auth/login", "post"],
    ["/api/v1/auth/session", "get"],
    ["/api/v1/dashboard", "get"],
    ["/api/v1/students", "get"],
    ["/api/v1/students", "post"],
    ["/api/v1/households", "get"],
    ["/api/v1/courses", "get"],
    ["/api/v1/lessons", "get"],
    ["/api/v1/lessons", "post"],
    ["/api/v1/schedule/proposals", "post"],
    ["/api/v1/schedule/proposals/{id}/confirm", "post"],
    ["/api/v1/schedule/proposals/{id}/cancel", "post"],
    ["/api/v1/attendance", "post"],
    ["/api/v1/lesson-ledger", "get"],
    ["/api/v1/lesson-ledger/summary", "get"],
    ["/api/v1/lesson-ledger/{id}/reverse", "post"],
    ["/api/v1/orders", "get"],
    ["/api/v1/orders", "post"],
    ["/api/v1/payments", "post"],
    ["/api/v1/invoices", "get"],
    ["/api/v1/invoices/issue", "post"],
    ["/api/v1/refunds", "get"],
    ["/api/v1/refunds", "post"],
    ["/api/v1/refunds/exceptional", "post"],
    ["/api/v1/refunds/{id}/approve", "post"],
    ["/api/v1/refunds/{id}/settle", "post"],
    ["/api/v1/payment-ledger", "get"],
    ["/api/v1/payment-ledger/summary", "get"],
    ["/api/v1/payment-ledger/{id}/reverse", "post"],
    ["/api/v1/financial-ledger", "get"],
    ["/api/v1/financial-ledger/summary", "get"],
    ["/api/v1/financial-ledger/reconcile", "post"],
    ["/api/v1/financial-accounts", "get"],
    ["/api/v1/financial-accounts", "post"],
    ["/api/v1/accounting-period-locks", "get"],
    ["/api/v1/accounting-periods/{period}/lock", "post"],
    ["/api/v1/reconciliation-runs", "get"],
    ["/api/v1/payroll-rules", "get"],
    ["/api/v1/payroll-rules", "post"],
    ["/api/v1/payroll/generate", "post"],
    ["/api/v1/payroll-records", "get"],
    ["/api/v1/payroll-records/batch-confirm", "post"],
    ["/api/v1/payroll-records/{id}/confirm", "post"],
    ["/api/v1/payroll-records/{id}/settle", "post"],
    ["/api/v1/notifications", "get"],
    ["/api/v1/notifications", "post"],
    ["/api/v1/notifications/{id}", "patch"],
    ["/api/v1/notifications/{id}/send", "post"],
    ["/api/v1/notifications/send-all", "post"],
    ["/api/v1/notifications/{id}/schedule", "post"],
    ["/api/v1/notifications/dunning-drafts", "post"],
    ["/api/v1/notification-deliveries", "get"],
    ["/api/v1/notification-deliveries/{id}/retry", "post"],
    ["/api/v1/notification-deliveries/{id}/cancel", "post"],
    ["/api/v1/notification-queue/status", "get"],
    ["/api/v1/notification-queue/process", "post"],
    ["/api/v1/reports", "get"],
    ["/api/v1/reports/summary", "get"],
    ["/api/v1/business-tasks", "get"],
    ["/api/v1/business-tasks/{id}/confirm", "post"],
    ["/api/v1/business-tasks/{id}/cancel", "post"],
    ["/api/v1/audit-logs", "get"],
    ["/api/v1/knowledge-docs", "get"],
    ["/api/v1/agent-runs", "get"],
    ["/api/v1/channel-integrations", "get"],
    ["/api/v1/commands/interpret", "post"],
    ["/api/v1/exports/{type}", "get"],
    ["/api/v1/users", "get"],
    ["/api/v1/users", "post"],
    ["/api/v1/users/{id}", "patch"],
    ["/api/v1/users/{id}/reset-password", "post"],
    ["/api/v1/knowledge-docs", "post"],
    ["/api/v1/knowledge-docs/upload", "post"],
    ["/api/v1/knowledge-docs/{id}", "delete"],
    ["/api/v1/knowledge-docs/{id}/invalidate", "post"],
    ["/api/v1/knowledge-docs/{id}/reindex", "post"],
    ["/api/v1/knowledge-docs/{id}/search", "post"],
    ["/api/v1/knowledge-search", "post"],
    ["/api/v1/agent-runs", "post"],
    ["/api/v1/mcp/tools", "get"],
    ["/api/v1/mcp/tools/{name}", "get"],
    ["/api/v1/mcp/execute", "post"],
    ["/api/v1/mcp/approvals", "get"],
    ["/api/v1/mcp/approvals/{id}/decide", "post"],
    ["/api/v1/agent/hermes-status", "get"],
    ["/api/v1/channel-integrations", "post"],
    ["/api/v1/channel-integrations/{id}", "patch"],
    ["/api/v1/channel-accounts", "get"],
    ["/api/v1/channel-messages", "get"],
    ["/api/v1/channels/wecom/callback", "post"],
    ["/api/v1/schedule/periodic", "post"],
    ["/api/v1/schedule/batch", "post"],
    ["/api/v1/availability/teacher/{name}", "get"],
    ["/api/v1/availability/room/{name}", "get"],
  ];
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, method] of routes) {
    paths[path] ??= {};
    paths[path][method] = {
      tags: ["core"],
      responses: {
        "200": { description: "Successful response" },
        "201": { description: "Resource or command accepted" },
      },
    };
  }
  return {
    openapi: "3.0.0",
    info: {
      title: "cjlass2 Core API",
      description: "Production API for the independent teacher and small institution academic operations system.",
      version: "1.0.0",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API_AUTH_TOKEN",
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

void bootstrap();
