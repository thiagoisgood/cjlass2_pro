# Release Readiness Gates

This project has two release-check profiles:

- `local`: default when `NODE_ENV` is not production. It checks code-level release hygiene such as OpenAPI route coverage and external frontend font dependencies.
- `production`: strict pre-deploy gate. It requires production secrets, real integration configuration, backup/restore evidence, finance acceptance evidence, and a controlled webhook exposure boundary.

## Local check

```bash
npm run ops:release-check
```

## Production profile

Run this before building or deploying production containers:

```bash
RELEASE_CHECK_STRICT=true \
RELEASE_CHECK_PROFILE=production \
npm run ops:release-check
```

The production profile intentionally fails unless the release has evidence for the remaining high-priority audit items:

- Real PostgreSQL, explicit CORS, API/session/webhook/channel secrets, and non-default admin password.
- Real Hermes/OpenAI-compatible agent URL and API key.
- Remote embedding provider, not local deterministic embedding fallback.
- At least one outbound notification webhook. Set `REQUIRE_ALL_CHANNEL_WEBHOOKS=true` to require WeCom, WeChat, Feishu, and DingTalk webhook URLs.
- `OBJECT_STORAGE_URI`, `WAL_ARCHIVE_URI`, and `RESTORE_DRILL_EVIDENCE` for backup retention and restore drill proof.
- `ACCESS_SCOPE_MODEL_EVIDENCE` for the explicit organization/member/class/campus/guardian authorization model.
- `PAYMENT_CHANNEL_PROVIDER`, `INVOICE_NUMBER_RULE`, and `FINANCE_ACCEPTANCE_EVIDENCE` for production finance acceptance.
- `WEBHOOK_PORT` bound to loopback, plus `WEBHOOK_ACCESS_CONTROL_EVIDENCE` for reverse-proxy or network access control.

## Production smoke

After containers are healthy, run the read-only smoke checks:

```bash
PRODUCTION_BASE_URL=https://cjlass.example \
API_AUTH_TOKEN=... \
npm run ops:production-smoke
```

The smoke script verifies:

- `/api/v1/health` reports PostgreSQL database mode, Node 20+, and production config readiness.
- OpenAPI includes MCP and RAG endpoints.
- Bearer auth accepts the configured token.
- MCP tools include invoice, refund, payroll generation, and payroll settlement operations.
- Hermes is configured unless `SMOKE_REQUIRE_HERMES=false`.
- RAG search and channel-integration list endpoints are readable without mutating data.

The deployment script runs both the production profile and the read-only smoke check automatically.
