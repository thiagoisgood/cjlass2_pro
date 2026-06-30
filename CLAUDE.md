# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CJlass2 Pro is an intelligent academic management system for independent teachers and small institutions (1-20 teachers, 20-2000 students). It combines traditional ERP functionality with natural language commands powered by Hermes Agent, delivered through web management, chat integrations (WeChat Work/Feishu/DingTalk), and mobile parent portals.

The system follows a "reliable business core + AI orchestration layer" architecture where deterministic business logic handles all critical operations (scheduling, billing, attendance) while AI provides convenience features (natural language commands, content organization, notification drafts).

## Commands

### Build & Test
```bash
# Full build (all workspaces)
npm run build

# Run all tests
npm run test

# API tests only (46 tests)
npm run test -w @cjlass2/api

# Frontend Playwright tests (7 tests, requires dev server)
npm run dev -w @cjlass2/web  # Start server first
npm run test:e2e -w @cjlass2/web

# Lint (TypeScript type checking)
npm run lint

# Development servers
npm run dev -w @cjlass2/api   # API on port 3001
npm run dev -w @cjlass2/web   # Web on port 5173
```

### Database
```bash
# Run database migrations (automatic on API start)
# Migrations are in infra/postgres/migrations/

# Seed initial data
npm run seed -w @cjlass2/api

# Docker environment
npm run docker:up      # Start postgres + redis
npm run docker:down    # Stop containers
```

## Architecture

### Monorepo Structure
- `apps/api` - NestJS backend API (Fastify adapter, port 3001)
- `apps/web` - React frontend (Vite, port 5173)
- `packages/shared` - Shared TypeScript types and utilities
- `infra/postgres` - Database migrations and initialization

### Core Backend Pattern: Incremental Writes

The system uses a dual-mode persistence strategy:

**Memory Mode** (no DATABASE_URL): Uses `AppSnapshot` aggregate pattern for simplicity in tests
```typescript
const state = await service.snapshot();
state.students.push(newStudent);
await store.save(state);  // Full replacement
```

**Database Mode** (with DATABASE_URL): Uses incremental diff-based upserts
```typescript
const previous = await service.snapshot();
const next = { ...previous, students: [...previous.students, newStudent] };
await store.saveIncremental(previous, next);  // Only changed rows
```

Key methods in `JsonStateStore`:
- `saveIncremental(previous, next)` - Diff-based upsert for production
- `withTenantTransaction(tenantId, callback)` - Transaction with RLS context
- `withIdempotency(key, callback)` - Idempotent operation wrapper

### Business Logic Layering

**Controller** (`core.controller.ts`) - HTTP endpoints, auth context extraction
```typescript
@Post('students')
createStudent(@Headers() headers, @Body() body) {
  const context = this.context(headers, 'write:students');
  return this.core.createStudent(body, this.meta(headers, body, context));
}
```

**Service** (`core.service.ts`) - Business rules, state mutations
```typescript
async createStudent(input, meta) {
  return this.withMutation('createStudent', { input }, meta, async (context) => {
    const previous = await this.snapshot();
    const student = { id: makeId('stu'), ...input };
    return this.saveWithAudit(
      { ...previous, students: [student, ...previous.students] },
      '创建学员', `${student.name}已加入`, '已完成',
      context.actorName, previous  // Pass previous for incremental writes
    );
  });
}
```

**Store** (`json-state.store.ts`) - Persistence, transactions, migrations
- Manages both memory and PostgreSQL modes
- Runs ordered migrations with checksum validation
- Enforces tenant isolation via RLS policies

### Immutable Ledger Model

Financial and attendance data uses append-only ledgers instead of mutable fields:

```typescript
// ❌ Never do this
student.remainingHours = 10;

// ✅ Always append ledger entries
const entry = {
  studentId, entryType: 'deduct', hoursDelta: -1,
  reason: '课程课消', source: 'attendance'
};
lessonLedgerEntries.push(entry);
// Balance is calculated: baseRemainingHours + sum(hoursDelta)
```

Tables: `lesson_ledger_entries`, `payment_ledger_entries`

### Agent Gateway (MCP Tools)

The AgentGateway exposes 15 MCP (Model Context Protocol) tools for AI integration:

**Query tools** - Read operations
```typescript
student_search, schedule_query, teacher_availability, package_get_balance
```

**Proposal tools** - Preview without executing
```typescript
schedule_propose, schedule_check_conflicts, refund_preview
```

**Execute tools** - Write operations
```typescript
schedule_commit, attendance_mark, notification_send
```

**High-risk tools** - Require approval flow
```typescript
refund_request, lesson_ledger_adjust, student_data_export
```

Key file: `apps/api/src/core/agent-gateway.service.ts`

### Authentication & Authorization

- Session tokens: HMAC-SHA256 signed, stored in `Authorization: Bearer <token>`
- API token: `API_AUTH_TOKEN` env var for service-to-service auth
- RBAC scopes: `read:students`, `write:payments`, etc.
- Tenant isolation: PostgreSQL RLS policies + `app.tenant_id` transaction context

```typescript
// Controller enforces scope
const context = this.context(headers, 'write:payments');

// Service uses context
async recordPayment(orderId, meta) {
  const context = meta.context;  // { tenantId, userId, role, scopes }
  // ...
}
```

### Notification System

Three-tier delivery with fallback:
1. **Redis Streams** (if REDIS_URL set) - Production queue
2. **Memory queue** - Development fallback
3. **Synchronous** - When both unavailable

Key services:
- `NotificationQueueService` - Queue management
- `NotificationProviderService` - Channel adapters (WeChat/WeCom/Feishu/DingTalk)

### Database Schema

Core tables (with RLS enabled):
- `tenants` - Multi-tenant isolation
- `users` - Authentication and authorization
- `students` - Student records
- `lessons` - Scheduled classes
- `orders` - Billing orders
- `lesson_ledger_entries` - Immutable attendance ledger
- `payment_ledger_entries` - Immutable payment ledger
- `notifications` - Message drafts
- `notification_deliveries` - Delivery tracking
- `business_tasks` - Natural language command state
- `agent_runs` / `agent_tool_calls` / `agent_approvals` - Agent execution tracking

Migrations: `infra/postgres/migrations/000X_*.sql`
- Automatically run on API startup
- Checksum-validated to prevent tampering
- Current version: 3 (agent_tool_calls_and_approvals)

## Testing

### API Tests (`apps/api/test/core.service.test.ts`)

46 tests covering:
- Business flows (create student → order → schedule → attendance → payment)
- Ledger integrity (append-only, reversals)
- Idempotency and version conflicts
- Auth/RBAC enforcement
- Notification delivery states
- Agent gateway (MCP tools, approvals)
- Database migrations

Run single test:
```bash
npm run build -w @cjlass2/api
node --test dist/test/core.service.test.js -t "test name pattern"
```

### Playwright Tests (`apps/web/tests/frontend.spec.ts`)

7 tests verifying:
- No design screenshot dependencies
- Interactive elements present
- Login flow
- API reachability

Requires dev server running on port 5173.

## Key Files

**Backend Core:**
- `apps/api/src/core/core.service.ts` - Business logic (1300+ lines)
- `apps/api/src/core/core.controller.ts` - HTTP endpoints (400+ lines)
- `apps/api/src/core/json-state.store.ts` - Persistence layer (1400+ lines)
- `apps/api/src/core/agent-gateway.service.ts` - MCP tools and approvals

**Frontend:**
- `apps/web/src/App.jsx` - Main React component (single-file app)
- `apps/web/src/api.js` - API client wrapper

**Shared Types:**
- `packages/shared/src/index.ts` - All TypeScript interfaces

**Infrastructure:**
- `infra/postgres/migrations/` - Database schema migrations
- `docker-compose.yml` - PostgreSQL + Redis services

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/cjlass2

# Redis (optional, falls back to memory queue)
REDIS_URL=redis://localhost:6379

# Authentication
API_AUTH_TOKEN=your-api-token
AUTH_SESSION_SECRET=your-session-secret

# Notification channels (optional)
WECOM_WEBHOOK_URL=https://example.com/wecom-webhook
WECHAT_WEBHOOK_URL=https://example.com/wechat-webhook
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
FEISHU_WEBHOOK_SECRET=your-sign-secret
DINGTALK_WEBHOOK_URL=https://example.com/dingtalk-webhook
NOTIFICATION_WEBHOOK_URL=https://example.com/generic-webhook

# Agent
HERMES_AGENT_URL=http://localhost:8080  # Optional
NOTIFICATION_PROVIDER_MODE=mock  # For testing only
```

## Development Workflow

1. **Start services**: `npm run docker:up` (or use existing Postgres/Redis)
2. **Start API**: `npm run dev -w @cjlass2/api`
3. **Start Web**: `npm run dev -w @cjlass2/web`
4. **Make changes** to business logic in `core.service.ts`
5. **Add tests** to `core.service.test.ts`
6. **Verify**: `npm run build && npm run test`

## Common Patterns

### Adding a New Business Operation

1. Add method to `CoreService`:
```typescript
async newOperation(input, meta: MutationMeta = {}) {
  return this.withMutation('newOperation', { input }, meta, async (context) => {
    const previous = await this.snapshot();
    // ... business logic
    return this.saveWithAudit(nextState, '操作名称', '描述', '状态', context.actorName, previous);
  });
}
```

2. Add endpoint to `CoreController`:
```typescript
@Post('new-operation')
newOperation(@Headers() headers, @Body() body) {
  const context = this.context(headers, 'write:resource');
  return this.core.newOperation(body, this.meta(headers, body, context));
}
```

3. Add route to OpenAPI in `main.ts`:
```typescript
['/api/v1/new-operation', 'post'],
```

4. Add test to `core.service.test.ts`

### Working with Ledgers

Always use ledger entries for financial/attendance data:
```typescript
// Deduct lesson hour
const entry = {
  id: makeId('ledger'),
  studentId, lessonId,
  entryType: 'deduct',  // or 'restore', 'adjustment'
  hoursDelta: -1,
  reason: '课程课消',
  source: 'attendance',
  actorId: context.userId,
  occurredAt: nowText()
};
```

### Handling Idempotency

Wrap operations with idempotency keys:
```typescript
// Client sends
POST /api/v1/payments
Idempotency-Key: unique-request-id

// Server uses
return this.withMutation('operation', input, { idempotencyKey: 'unique-request-id' }, ...);
```

## Important Notes

- **Never modify historical ledger entries** - always append reversals
- **Always pass `previous` state** to `saveWithAudit` in DB mode for incremental writes
- **Use `withMutation` wrapper** for all state-changing operations (provides idempotency + transaction)
- **Tenant isolation is enforced** via RLS - never bypass `withTenantTransaction`
- **Test both memory and DB modes** when adding persistence logic
- **Node version**: Requires Node 20+ (declared in `engines`)
- **OpenAPI spec**: Auto-generated from route definitions in `main.ts`
