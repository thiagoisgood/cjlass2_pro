import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  cloneSeedState,
  type AgentRun,
  type AgentApproval,
  type AgentToolCall,
  type AppSnapshot,
  type AuditLog,
  type BusinessTask,
  type ChannelAccount,
  type ChannelIntegration,
  type ChannelMessage,
  type CommunicationRecord,
  type AccountingPeriodLock,
  type FinancialAccount,
  type FinancialLedgerEntry,
  type Invoice,
  type KnowledgeChunk,
  type KnowledgeDoc,
  type Lesson,
  type LessonLedgerEntry,
  type NotificationDelivery,
  type NotificationDraft,
  type Order,
  type PaymentLedgerEntry,
  type PayrollRecord,
  type PayrollRule,
  type ReconciliationRun,
  type Refund,
  type Student,
  type StudentRecord,
  type Template,
  TENANT_ID,
} from "@cjlass2/shared";
import pg, { type PoolClient } from "pg";
import { defaultAdminEmail, defaultAdminPasswordHash, normalizeEmail } from "./auth-credentials.js";
import { type UserRole } from "./request-context.js";

const { Pool } = pg;
export const POSTGRES_SCHEMA_VERSION = 6;
export const POSTGRES_SCHEMA_CHECKSUM = "12790449de2bc6b7cab90dbc2eaa2d98c3f38ecd55b4195804d8fae45f2c7fc9";

export interface StoreUser {
  userId: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  status: string;
}

interface KnowledgeVectorSearchFilters {
  scope?: string;
  status?: string;
  includeExpired?: boolean;
  asOf?: string;
}

@Injectable()
export class JsonStateStore implements OnModuleInit, OnModuleDestroy {
  private memoryState: AppSnapshot | null = null;
  private memoryIdempotency = new Map<string, { requestHash: string; response: unknown }>();
  private memoryUsers = new Map<string, StoreUser>();
  private pool: pg.Pool | null = null;
  private transactionContext = new AsyncLocalStorage<{ client: PoolClient; tenantId: string }>();

  constructor() {
    if (process.env.DATABASE_URL) {
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    }
  }

  async onModuleInit() {
    await this.ensureReady();
  }

  async onModuleDestroy() {
    await this.close();
  }

  async close() {
    await this.pool?.end();
  }

  async load(): Promise<AppSnapshot> {
    await this.ensureReady();
    if (!this.pool) {
      return structuredClone(this.memoryState ?? cloneSeedState());
    }

    const activeTransaction = this.transactionContext.getStore();
    if (activeTransaction) {
      const tenantResult = await activeTransaction.client.query("SELECT id FROM tenants WHERE id = $1", [activeTransaction.tenantId]);
      if (tenantResult.rowCount === 0) {
        const seed = withRuntimeIntegrationStatus(cloneSeedState());
        await this.replaceRelationalState(activeTransaction.client, seed);
        return seed;
      }
      return withRuntimeIntegrationStatus(await this.loadRelationalState(activeTransaction.client, activeTransaction.tenantId));
    }

    return this.withTenantTransaction(TENANT_ID, async (client) => {
      const tenantResult = await client.query("SELECT id FROM tenants WHERE id = $1", [TENANT_ID]);
      if (tenantResult.rowCount === 0) {
        const seed = withRuntimeIntegrationStatus(cloneSeedState());
        await this.replaceRelationalState(client, seed);
        return seed;
      }
      return withRuntimeIntegrationStatus(await this.loadRelationalState(client, TENANT_ID));
    });
  }

  isDatabaseMode(): boolean {
    return this.pool !== null;
  }

  async searchKnowledgeByEmbedding(
    tenantId: string,
    embedding: number[],
    limit: number,
    filters: KnowledgeVectorSearchFilters = {},
  ): Promise<Array<{ chunk: KnowledgeChunk; score: number }>> {
    await this.ensureReady();
    if (!this.pool || !embedding.length) {
      return [];
    }
    const normalizedLimit = Math.max(1, Math.min(Number(limit || 5), 20));
    const asOf = filters.asOf || new Date().toISOString().slice(0, 10);
    const params: unknown[] = [
      tenantId,
      vectorLiteral(embedding),
      normalizedLimit,
      filters.status || "生效中",
      Boolean(filters.includeExpired),
      asOf,
    ];
    const conditions = [
      "c.tenant_id = $1",
      "c.embedding IS NOT NULL",
      "d.status = $4",
      "d.invalidated_at IS NULL",
      "($5::boolean OR d.effective_from IS NULL OR d.effective_from = '' OR d.effective_from::date <= $6::date)",
      "($5::boolean OR d.expires_at IS NULL OR d.expires_at = '' OR d.expires_at::date >= $6::date)",
    ];
    if (filters.scope) {
      params.push(filters.scope);
      conditions.push(`d.scope = $${params.length}`);
    }
    return this.withTenantTransaction(tenantId, async (client) => {
      const result = await client.query(
        `SELECT
           c.id,
           c.tenant_id,
           c.doc_id,
           c.chunk_index,
           c.content,
           c.content_hash,
           c.embedding::text AS embedding,
           c.embedding_provider,
           c.embedding_model,
           c.embedding_dimension,
           c.embedded_at,
           c.metadata || jsonb_build_object(
             'title', d.title,
             'scope', d.scope,
             'sourceLabel', COALESCE(c.metadata->>'sourceLabel', d.title || '#' || (c.chunk_index + 1)::text)
           ) AS metadata,
           1 - (c.embedding <=> $2::vector) AS score
         FROM knowledge_chunks c
         JOIN knowledge_docs d ON d.id = c.doc_id AND d.tenant_id = c.tenant_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY c.embedding <=> $2::vector, c.chunk_index ASC
         LIMIT $3`,
        params,
      );
      return result.rows.map((row) => ({ chunk: toKnowledgeChunk(row), score: Number(row.score ?? 0) }));
    });
  }

  async save(state: AppSnapshot): Promise<AppSnapshot> {
    const nextState = withRuntimeIntegrationStatus(structuredClone(state));
    if (!this.pool) {
      const previous = this.memoryState;
      this.memoryState = nextState;
      return structuredClone(nextState);
    }

    const activeTransaction = this.transactionContext.getStore();
    if (activeTransaction) {
      await this.replaceRelationalState(activeTransaction.client, nextState);
      return nextState;
    }

    return this.withTenantTransaction(nextState.organization.id || TENANT_ID, async (client) => {
      await this.replaceRelationalState(client, nextState);
      return nextState;
    });
  }

  async saveIncremental(previous: AppSnapshot | null, next: AppSnapshot): Promise<AppSnapshot> {
    const nextState = withRuntimeIntegrationStatus(structuredClone(next));
    if (!this.pool) {
      this.memoryState = nextState;
      return structuredClone(nextState);
    }
    const tenantId = nextState.organization.id || TENANT_ID;
    return this.withTenantTransaction(tenantId, async (client) => {
      await this.ensureTenantAndAdmin(client, nextState);
      await this.upsertChangedEntities(client, tenantId, previous, nextState);
      return nextState;
    });
  }

  async listUsers(tenantId: string): Promise<StoreUser[]> {
    await this.ensureReady();
    if (!this.pool) {
      const state = this.memoryState ?? withRuntimeIntegrationStatus(cloneSeedState());
      const defaultUser: StoreUser = {
        userId: "user-lin",
        tenantId: state.organization.id || TENANT_ID,
        email: defaultAdminEmail(),
        passwordHash: defaultAdminPasswordHash(),
        displayName: state.organization.user,
        role: "admin",
        status: "active",
      };
      const memoryUsers = [...this.memoryUsers.values()].filter((u) => u.tenantId === tenantId);
      return [defaultUser, ...memoryUsers.filter((u) => u.userId !== defaultUser.userId)];
    }
    return this.withTenantTransaction(tenantId, async (client) => {
      const result = await client.query(
        `SELECT id, tenant_id, email, password_hash, display_name, role, status
         FROM users WHERE tenant_id = $1 ORDER BY created_at ASC`,
        [tenantId],
      );
      return result.rows.map(toStoreUser);
    });
  }

  async createUser(input: { userId: string; tenantId: string; email: string; passwordHash: string; displayName: string; role: UserRole }): Promise<StoreUser> {
    const user: StoreUser = { ...input, status: "active" };
    await this.ensureReady();
    if (!this.pool) {
      this.memoryUsers.set(user.userId, user);
      return user;
    }
    return this.withTenantTransaction(input.tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subtitle, updated_at)
         VALUES ($1, $2, '', now())
         ON CONFLICT (id) DO UPDATE SET updated_at = now()`,
        [input.tenantId, "晓知教育工作室"],
      );
      await client.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, display_name, role, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', now())
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           display_name = EXCLUDED.display_name,
           role = EXCLUDED.role,
           status = 'active',
           updated_at = now()`,
        [input.userId, input.tenantId, input.email, input.passwordHash, input.displayName, input.role],
      );
      return { ...input, status: "active" };
    });
  }

  async updateUser(userId: string, tenantId: string, patch: { displayName?: string; role?: UserRole; status?: string; passwordHash?: string }): Promise<StoreUser | null> {
    await this.ensureReady();
    if (!this.pool) {
      const existing = this.memoryUsers.get(userId);
      if (!existing && userId === "user-lin") {
        const state = this.memoryState ?? withRuntimeIntegrationStatus(cloneSeedState());
        const defaultUser: StoreUser = {
          userId: "user-lin",
          tenantId: state.organization.id || TENANT_ID,
          email: defaultAdminEmail(),
          passwordHash: defaultAdminPasswordHash(),
          displayName: state.organization.user,
          role: "admin",
          status: "active",
        };
        const updated = { ...defaultUser, ...(patch.displayName ? { displayName: patch.displayName } : {}), ...(patch.role ? { role: patch.role } : {}), ...(patch.status ? { status: patch.status } : {}), ...(patch.passwordHash ? { passwordHash: patch.passwordHash } : {}) };
        this.memoryUsers.set(userId, updated);
        return updated;
      }
      if (!existing) return null;
      const updated = { ...existing, ...(patch.displayName ? { displayName: patch.displayName } : {}), ...(patch.role ? { role: patch.role } : {}), ...(patch.status ? { status: patch.status } : {}), ...(patch.passwordHash ? { passwordHash: patch.passwordHash } : {}) };
      this.memoryUsers.set(userId, updated);
      return updated;
    }
    return this.withTenantTransaction(tenantId, async (client) => {
      const existing = await client.query("SELECT * FROM users WHERE tenant_id = $1 AND id = $2", [tenantId, userId]);
      if (!existing.rows[0]) return null;
      const current = toStoreUser(existing.rows[0]);
      const nextDisplayName = patch.displayName ?? current.displayName;
      const nextRole = patch.role ?? current.role;
      const nextStatus = patch.status ?? current.status;
      const nextPasswordHash = patch.passwordHash ?? current.passwordHash;
      await client.query(
        `UPDATE users SET display_name = $1, role = $2, status = $3, password_hash = $4, updated_at = now()
         WHERE id = $5 AND tenant_id = $6`,
        [nextDisplayName, nextRole, nextStatus, nextPasswordHash, userId, tenantId],
      );
      return { ...current, displayName: nextDisplayName, role: nextRole, status: nextStatus, passwordHash: nextPasswordHash };
    });
  }

  async reset(): Promise<AppSnapshot> {
    const seed = withRuntimeIntegrationStatus(cloneSeedState());
    if (!this.pool) {
      return this.save(seed);
    }
    const activeTransaction = this.transactionContext.getStore();
    if (activeTransaction) {
      await this.clearTenantData(activeTransaction.client, activeTransaction.tenantId, true);
      await this.replaceRelationalState(activeTransaction.client, seed);
      return seed;
    }
    return this.withTenantTransaction(TENANT_ID, async (client) => {
      await this.clearTenantData(client, TENANT_ID, true);
      await this.replaceRelationalState(client, seed);
      return seed;
    });
  }

  async findUserByEmail(tenantId: string, email: string): Promise<StoreUser | null> {
    const normalizedEmail = normalizeEmail(email);
    await this.ensureReady();
    if (!this.pool) {
      const state = this.memoryState ?? withRuntimeIntegrationStatus(cloneSeedState());
      return normalizedEmail === defaultAdminEmail()
        ? {
          userId: "user-lin",
          tenantId: state.organization.id || TENANT_ID,
          email: defaultAdminEmail(),
          passwordHash: defaultAdminPasswordHash(),
          displayName: state.organization.user,
          role: "admin",
          status: "active",
        }
        : null;
    }
    return this.withTenantTransaction(tenantId, async (client) => {
      const result = await client.query(
        `SELECT id, tenant_id, email, password_hash, display_name, role, status
         FROM users
         WHERE tenant_id = $1 AND lower(email) = $2 AND status = 'active'
         LIMIT 1`,
        [tenantId, normalizedEmail],
      );
      return result.rows[0] ? toStoreUser(result.rows[0]) : null;
    });
  }

  async findUserById(tenantId: string, userId: string): Promise<StoreUser | null> {
    await this.ensureReady();
    if (!this.pool) {
      const state = this.memoryState ?? withRuntimeIntegrationStatus(cloneSeedState());
      return userId === "user-lin"
        ? {
          userId: "user-lin",
          tenantId: state.organization.id || TENANT_ID,
          email: defaultAdminEmail(),
          passwordHash: defaultAdminPasswordHash(),
          displayName: state.organization.user,
          role: "admin",
          status: "active",
        }
        : null;
    }
    return this.withTenantTransaction(tenantId, async (client) => {
      const result = await client.query(
        `SELECT id, tenant_id, email, password_hash, display_name, role, status
         FROM users
         WHERE tenant_id = $1 AND id = $2
         LIMIT 1`,
        [tenantId, userId],
      );
      return result.rows[0] ? toStoreUser(result.rows[0]) : null;
    });
  }

  async withIdempotency<T>(tenantId: string, idempotencyKey: string | undefined, request: unknown, producer: () => Promise<T>): Promise<T> {
    if (!idempotencyKey) {
      return producer();
    }
    await this.ensureReady();
    const requestHash = hashStable(request);
    const memoryKey = `${tenantId}:${idempotencyKey}`;
    if (!this.pool) {
      const cached = this.memoryIdempotency.get(memoryKey);
      if (cached) {
        assertSameRequest(cached.requestHash, requestHash);
        return structuredClone(cached.response) as T;
      }
      const response = await producer();
      this.memoryIdempotency.set(memoryKey, { requestHash, response: structuredClone(response) });
      return response;
    }

    return this.withTenantTransaction(tenantId, async (client) => {
      const existing = await client.query(
        "SELECT request_hash, response FROM idempotency_keys WHERE tenant_id = $1 AND key = $2 FOR UPDATE",
        [tenantId, idempotencyKey],
      );
      if (existing.rowCount && existing.rows[0]) {
        assertSameRequest(String(existing.rows[0].request_hash ?? ""), requestHash);
        return existing.rows[0].response as T;
      }
      const response = await producer();
      await client.query(
        `INSERT INTO idempotency_keys (tenant_id, key, request_hash, response)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, key) DO NOTHING`,
        [tenantId, idempotencyKey, requestHash, response],
      );
      return response;
    });
  }

  private async ensureTenantAndAdmin(client: PoolClient, state: AppSnapshot) {
    const tenantId = state.organization.id || TENANT_ID;
    await client.query(
      `INSERT INTO tenants (id, name, subtitle, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, subtitle = EXCLUDED.subtitle, updated_at = now()`,
      [tenantId, state.organization.name, state.organization.subtitle],
    );
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, display_name, role, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         role = EXCLUDED.role,
         updated_at = now()`,
      ["user-lin", tenantId, defaultAdminEmail(), defaultAdminPasswordHash(), state.organization.user, normalizeRole(state.organization.role)],
    );
  }

  private async upsertChangedEntities(client: PoolClient, tenantId: string, previous: AppSnapshot | null, next: AppSnapshot) {
    const previousById = <T extends { id: string }>(items: T[]) => new Map(items.map((item) => [item.id, item]));

    // Students: upsert changed, delete removed
    const prevStudents = previousById(previous?.students ?? []);
    for (const [index, student] of next.students.entries()) {
      const prev = prevStudents.get(student.id);
      if (!prev || hasEntityChanged(prev, student)) {
        await this.upsertStudent(client, tenantId, student, index);
      }
    }
    for (const prev of previous?.students ?? []) {
      if (!next.students.some((s) => s.id === prev.id)) {
        await client.query("DELETE FROM student_communications WHERE student_id = $1 AND tenant_id = $2", [prev.id, tenantId]);
        await client.query("DELETE FROM student_records WHERE student_id = $1 AND tenant_id = $2", [prev.id, tenantId]);
        await client.query("DELETE FROM students WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    // Student records/communications: diff by content
    for (const student of next.students) {
      await client.query("DELETE FROM student_records WHERE student_id = $1 AND tenant_id = $2", [student.id, tenantId]);
      await client.query("DELETE FROM student_communications WHERE student_id = $1 AND tenant_id = $2", [student.id, tenantId]);
      for (const [recordIndex, record] of student.records.entries()) {
        await client.query(
          `INSERT INTO student_records (id, tenant_id, student_id, date_text, title, teacher, status, note, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [childId("student-record", student.id, recordIndex), tenantId, student.id, record.date, record.title, record.teacher, record.status, record.note, recordIndex],
        );
      }
      for (const [communicationIndex, communication] of student.communications.entries()) {
        await client.query(
          `INSERT INTO student_communications (id, tenant_id, student_id, type, title, time_text, body, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [childId("student-communication", student.id, communicationIndex), tenantId, student.id, communication.type, communication.title, communication.time, communication.text, communicationIndex],
        );
      }
    }

    // Courses: upsert unique courses
    const courseRows = uniqueCourses(next.lessons);
    for (const [index, course] of courseRows.entries()) {
      await client.query(
        `INSERT INTO courses (id, tenant_id, title, type, default_price, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (tenant_id, title, type) DO UPDATE SET default_price = EXCLUDED.default_price, updated_at = now()`,
        [`course-${tenantId}-${index + 1}`, tenantId, course.title, course.type, course.price],
      );
    }

    await this.upsertTeacherIdentities(client, tenantId, next);

    // Lessons: upsert changed
    const prevLessons = previousById(previous?.lessons ?? []);
    for (const [index, lesson] of next.lessons.entries()) {
      const prev = prevLessons.get(lesson.id);
      if (!prev || hasEntityChanged(prev, lesson)) {
        await this.upsertLesson(client, tenantId, lesson, index);
      }
    }
    for (const prev of previous?.lessons ?? []) {
      if (!next.lessons.some((l) => l.id === prev.id)) {
        await client.query("DELETE FROM lessons WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    // Lesson ledger entries: append-only; insert new entries
    const prevLessonLedgerIds = new Set((previous?.lessonLedgerEntries ?? []).map((e) => e.id));
    for (const entry of next.lessonLedgerEntries) {
      if (!prevLessonLedgerIds.has(entry.id)) {
        await this.insertLessonLedgerEntry(client, tenantId, entry);
      }
    }

    // Orders: upsert changed
    const prevOrders = previousById(previous?.orders ?? []);
    for (const [index, order] of next.orders.entries()) {
      const prev = prevOrders.get(order.id);
      if (!prev || hasEntityChanged(prev, order)) {
        await this.upsertOrder(client, tenantId, order, index);
      }
    }
    for (const prev of previous?.orders ?? []) {
      if (!next.orders.some((o) => o.id === prev.id)) {
        await client.query("DELETE FROM orders WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    // Payment ledger entries: append-only; insert new entries
    const prevPaymentLedgerIds = new Set((previous?.paymentLedgerEntries ?? []).map((e) => e.id));
    for (const entry of next.paymentLedgerEntries) {
      if (!prevPaymentLedgerIds.has(entry.id)) {
        await this.insertPaymentLedgerEntry(client, tenantId, entry);
      }
    }

    // Formal finance records
    const prevInvoices = previousById(previous?.invoices ?? []);
    for (const invoice of next.invoices ?? []) {
      const prev = prevInvoices.get(invoice.id);
      if (!prev || hasEntityChanged(prev, invoice)) {
        await this.upsertInvoice(client, tenantId, invoice);
      }
    }
    for (const prev of previous?.invoices ?? []) {
      if (!(next.invoices ?? []).some((item) => item.id === prev.id)) {
        await client.query("DELETE FROM invoices WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    const prevRefunds = previousById(previous?.refunds ?? []);
    for (const refund of next.refunds ?? []) {
      const prev = prevRefunds.get(refund.id);
      if (!prev || hasEntityChanged(prev, refund)) {
        await this.upsertRefund(client, tenantId, refund);
      }
    }
    for (const prev of previous?.refunds ?? []) {
      if (!(next.refunds ?? []).some((item) => item.id === prev.id)) {
        await client.query("DELETE FROM refunds WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    const prevFinancialLedgerIds = new Set((previous?.financialLedgerEntries ?? []).map((entry) => entry.id));
    for (const entry of next.financialLedgerEntries ?? []) {
      if (!prevFinancialLedgerIds.has(entry.id)) {
        await this.insertFinancialLedgerEntry(client, tenantId, entry);
      }
    }

    const prevFinancialAccounts = previousById(previous?.financialAccounts ?? []);
    for (const account of next.financialAccounts ?? []) {
      const prev = prevFinancialAccounts.get(account.id);
      if (!prev || hasEntityChanged(prev, account)) {
        await this.upsertFinancialAccount(client, tenantId, account);
      }
    }
    for (const prev of previous?.financialAccounts ?? []) {
      if (!(next.financialAccounts ?? []).some((item) => item.id === prev.id)) {
        await client.query("DELETE FROM financial_accounts WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    const prevAccountingLocks = previousById(previous?.accountingPeriodLocks ?? []);
    for (const lock of next.accountingPeriodLocks ?? []) {
      const prev = prevAccountingLocks.get(lock.id);
      if (!prev || hasEntityChanged(prev, lock)) {
        await this.upsertAccountingPeriodLock(client, tenantId, lock);
      }
    }
    for (const prev of previous?.accountingPeriodLocks ?? []) {
      if (!(next.accountingPeriodLocks ?? []).some((item) => item.id === prev.id)) {
        await client.query("DELETE FROM accounting_period_locks WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    const prevReconciliationRuns = previousById(previous?.reconciliationRuns ?? []);
    for (const run of next.reconciliationRuns ?? []) {
      const prev = prevReconciliationRuns.get(run.id);
      if (!prev || hasEntityChanged(prev, run)) {
        await this.upsertReconciliationRun(client, tenantId, run);
      }
    }
    for (const prev of previous?.reconciliationRuns ?? []) {
      if (!(next.reconciliationRuns ?? []).some((item) => item.id === prev.id)) {
        await client.query("DELETE FROM reconciliation_runs WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    const prevPayrollRules = previousById(previous?.payrollRules ?? []);
    for (const rule of next.payrollRules ?? []) {
      const prev = prevPayrollRules.get(rule.id);
      if (!prev || hasEntityChanged(prev, rule)) {
        await this.upsertPayrollRule(client, tenantId, rule);
      }
    }
    for (const prev of previous?.payrollRules ?? []) {
      if (!(next.payrollRules ?? []).some((item) => item.id === prev.id)) {
        await client.query("DELETE FROM payroll_rules WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    const prevPayrollRecords = previousById(previous?.payrollRecords ?? []);
    for (const record of next.payrollRecords ?? []) {
      const prev = prevPayrollRecords.get(record.id);
      if (!prev || hasEntityChanged(prev, record)) {
        await this.upsertPayrollRecord(client, tenantId, record);
      }
    }
    for (const prev of previous?.payrollRecords ?? []) {
      if (!(next.payrollRecords ?? []).some((item) => item.id === prev.id)) {
        await client.query("DELETE FROM payroll_records WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    // Notifications: upsert changed
    const prevNotifications = previousById(previous?.notifications ?? []);
    for (const [index, note] of next.notifications.entries()) {
      const prev = prevNotifications.get(note.id);
      if (!prev || hasEntityChanged(prev, note)) {
        await this.upsertNotification(client, tenantId, note, index);
      }
    }
    for (const prev of previous?.notifications ?? []) {
      if (!next.notifications.some((n) => n.id === prev.id)) {
        await client.query("DELETE FROM notification_deliveries WHERE notification_id = $1 AND tenant_id = $2", [prev.id, tenantId]);
        await client.query("DELETE FROM notification_drafts WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    // Notification deliveries: upsert changed
    const prevDeliveries = previousById(previous?.notificationDeliveries ?? []);
    for (const delivery of next.notificationDeliveries) {
      const prev = prevDeliveries.get(delivery.id);
      if (!prev || hasEntityChanged(prev, delivery)) {
        await this.upsertNotificationDelivery(client, tenantId, delivery);
      }
    }
    for (const prev of previous?.notificationDeliveries ?? []) {
      if (!next.notificationDeliveries.some((d) => d.id === prev.id)) {
        await client.query("DELETE FROM notification_deliveries WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    // Business tasks: upsert changed (with checks and effects)
    const prevTasks = previousById(previous?.tasks ?? []);
    for (const [index, task] of next.tasks.entries()) {
      const prev = prevTasks.get(task.id);
      if (!prev || hasEntityChanged(prev, task)) {
        await this.upsertBusinessTask(client, tenantId, task, index);
      }
    }
    for (const prev of previous?.tasks ?? []) {
      if (!next.tasks.some((t) => t.id === prev.id)) {
        await client.query("DELETE FROM business_task_effects WHERE task_id = $1 AND tenant_id = $2", [prev.id, tenantId]);
        await client.query("DELETE FROM business_task_checks WHERE task_id = $1 AND tenant_id = $2", [prev.id, tenantId]);
        await client.query("DELETE FROM business_tasks WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    // Templates: replace all (small dataset)
    await client.query("DELETE FROM notification_templates WHERE tenant_id = $1", [tenantId]);
    for (const [index, template] of next.templates.entries()) {
      await client.query(
        `INSERT INTO notification_templates (id, tenant_id, title, type, content, sort_order, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [template.id, tenantId, template.title, template.type, template.content, index],
      );
    }

    // Audit logs: append-only; insert new entries
    const prevAuditIds = new Set((previous?.auditLogs ?? []).map((log) => log.id));
    for (const [index, log] of next.auditLogs.entries()) {
      if (!prevAuditIds.has(log.id)) {
        await client.query(
          `INSERT INTO audit_logs (id, tenant_id, time_text, actor, action, summary, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now() - ($8::INTEGER * interval '1 second'))`,
          [log.id, tenantId, log.time, log.actor, log.action, log.summary, log.status, index],
        );
      }
    }

    // Knowledge docs: upsert changed
    const prevDocs = previousById(previous?.ragDocs ?? []);
    for (const doc of next.ragDocs) {
      const prev = prevDocs.get(doc.id);
      if (!prev || hasEntityChanged(prev, doc)) {
        await client.query(
          `INSERT INTO knowledge_docs (
             id, tenant_id, title, scope, status, updated_at_text, source_count,
             source_uri, mime_type, checksum, parser, effective_from, expires_at,
             invalidated_at, invalidated_by, metadata
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             scope = EXCLUDED.scope,
             status = EXCLUDED.status,
             updated_at_text = EXCLUDED.updated_at_text,
             source_count = EXCLUDED.source_count,
             source_uri = EXCLUDED.source_uri,
             mime_type = EXCLUDED.mime_type,
             checksum = EXCLUDED.checksum,
             parser = EXCLUDED.parser,
             effective_from = EXCLUDED.effective_from,
             expires_at = EXCLUDED.expires_at,
             invalidated_at = EXCLUDED.invalidated_at,
             invalidated_by = EXCLUDED.invalidated_by,
             metadata = EXCLUDED.metadata`,
          [
            doc.id,
            tenantId,
            doc.title,
            doc.scope,
            doc.status,
            doc.updatedAt,
            doc.sourceCount,
            doc.sourceUri ?? "",
            doc.mimeType ?? "text/plain",
            doc.checksum ?? "",
            doc.parser ?? "",
            doc.effectiveFrom ?? "",
            doc.expiresAt ?? "",
            parseTimestamp(doc.invalidatedAt),
            doc.invalidatedBy ?? null,
            doc.metadata ?? {},
          ],
        );
      }
    }
    for (const prev of previous?.ragDocs ?? []) {
      if (!next.ragDocs.some((doc) => doc.id === prev.id)) {
        await client.query("DELETE FROM knowledge_docs WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    // Knowledge chunks: upsert changed, delete removed
    const prevChunks = previousById(previous?.knowledgeChunks ?? []);
    for (const chunk of next.knowledgeChunks) {
      const prev = prevChunks.get(chunk.id);
      if (!prev || hasEntityChanged(prev, chunk)) {
        await this.upsertKnowledgeChunk(client, tenantId, chunk);
      }
    }
    for (const prev of previous?.knowledgeChunks ?? []) {
      if (!next.knowledgeChunks.some((chunk) => chunk.id === prev.id)) {
        await client.query("DELETE FROM knowledge_chunks WHERE id = $1 AND tenant_id = $2", [prev.id, tenantId]);
      }
    }

    // Channel integrations: upsert changed
    const prevChannels = previousById(previous?.channelIntegrations ?? []);
    for (const channel of next.channelIntegrations) {
      const prev = prevChannels.get(channel.id);
      if (!prev || hasEntityChanged(prev, channel)) {
        await client.query(
          `INSERT INTO channel_integrations (id, tenant_id, name, type, status, description, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, status = EXCLUDED.status, description = EXCLUDED.description, updated_at = now()`,
          [channel.id, tenantId, channel.name, channel.type, channel.status, channel.description],
        );
      }
    }

    // Channel accounts/messages: upsert changed
    const prevChannelAccounts = previousById(previous?.channelAccounts ?? []);
    for (const account of next.channelAccounts) {
      const prev = prevChannelAccounts.get(account.id);
      if (!prev || hasEntityChanged(prev, account)) {
        await this.upsertChannelAccount(client, tenantId, account);
      }
    }
    const prevChannelMessages = previousById(previous?.channelMessages ?? []);
    for (const message of next.channelMessages) {
      const prev = prevChannelMessages.get(message.id);
      if (!prev || hasEntityChanged(prev, message)) {
        await this.upsertChannelMessage(client, tenantId, message);
      }
    }

    // Agent runs: upsert changed
    const prevRuns = previousById(previous?.agentRuns ?? []);
    for (const run of next.agentRuns) {
      const prev = prevRuns.get(run.id);
      if (!prev || hasEntityChanged(prev, run)) {
        await client.query(
          `INSERT INTO agent_runs (id, tenant_id, status, task, started_at_text, tool_calls)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, task = EXCLUDED.task, tool_calls = EXCLUDED.tool_calls`,
          [run.id, tenantId, run.status, run.task, run.startedAt, run.toolCalls],
        );
      }
    }

    const prevToolCalls = previousById(previous?.agentToolCalls ?? []);
    for (const call of next.agentToolCalls) {
      const prev = prevToolCalls.get(call.id);
      if (!prev || hasEntityChanged(prev, call)) {
        await this.upsertAgentToolCall(client, tenantId, call);
      }
    }
    const prevApprovals = previousById(previous?.agentApprovals ?? []);
    for (const approval of next.agentApprovals) {
      const prev = prevApprovals.get(approval.id);
      if (!prev || hasEntityChanged(prev, approval)) {
        await this.upsertAgentApproval(client, tenantId, approval);
      }
    }
  }

  private async upsertStudent(client: PoolClient, tenantId: string, student: Student, index: number) {
    await client.query(
      `INSERT INTO students (
        id, tenant_id, name, short, grade, status, tags, code, joined_at, guardian, phone, note,
        teacher, teacher_course, package_name, base_remaining_hours, package_valid_to, attendance_rate,
        latest_attendance, due_amount, growth_points, sort_order, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, short = EXCLUDED.short, grade = EXCLUDED.grade, status = EXCLUDED.status,
        tags = EXCLUDED.tags, code = EXCLUDED.code, guardian = EXCLUDED.guardian, phone = EXCLUDED.phone,
        note = EXCLUDED.note, teacher = EXCLUDED.teacher, teacher_course = EXCLUDED.teacher_course,
        package_name = EXCLUDED.package_name, base_remaining_hours = EXCLUDED.base_remaining_hours,
        package_valid_to = EXCLUDED.package_valid_to, attendance_rate = EXCLUDED.attendance_rate,
        latest_attendance = EXCLUDED.latest_attendance, due_amount = EXCLUDED.due_amount,
        growth_points = EXCLUDED.growth_points, sort_order = EXCLUDED.sort_order, updated_at = now()`,
      [
        student.id, tenantId, student.name, student.short, student.grade, student.status,
        student.tags, student.code, student.joinedAt, student.guardian, student.phone, student.note,
        student.teacher, student.teacherCourse, student.packageName,
        student.baseRemainingHours ?? student.remainingHours, student.packageValidTo,
        student.attendanceRate, student.latestAttendance, student.dueAmount, student.growthPoints, index,
      ],
    );
  }

  private async upsertLesson(client: PoolClient, tenantId: string, lesson: Lesson, index: number) {
    await client.query(
      `INSERT INTO lessons (
        id, tenant_id, day_index, date_text, start_time, end_time, title, type, student_id, student_name,
        teacher, room, status, color, attendance, package_name, remaining_text, price, selected, sort_order, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now())
      ON CONFLICT (id) DO UPDATE SET
        day_index = EXCLUDED.day_index, date_text = EXCLUDED.date_text, start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time, title = EXCLUDED.title, type = EXCLUDED.type,
        student_id = EXCLUDED.student_id, student_name = EXCLUDED.student_name,
        teacher = EXCLUDED.teacher, room = EXCLUDED.room, status = EXCLUDED.status,
        color = EXCLUDED.color, attendance = EXCLUDED.attendance, package_name = EXCLUDED.package_name,
        remaining_text = EXCLUDED.remaining_text, price = EXCLUDED.price,
        selected = EXCLUDED.selected, sort_order = EXCLUDED.sort_order, updated_at = now()`,
      [
        lesson.id, tenantId, lesson.day, lesson.date, lesson.start, lesson.end,
        lesson.title, lesson.type, lesson.studentId, lesson.studentName,
        lesson.teacher, lesson.room, lesson.status, lesson.color, lesson.attendance,
        lesson.package, lesson.remaining, lesson.price, Boolean(lesson.selected), index,
      ],
    );
  }

  private async upsertOrder(client: PoolClient, tenantId: string, order: Order, index: number) {
    await client.query(
      `INSERT INTO orders (
        id, tenant_id, student_id, student_name, name, amount, paid_snapshot, status, due, channel,
        invoice, created_at_text, sort_order, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
      ON CONFLICT (id) DO UPDATE SET
        student_name = EXCLUDED.student_name, name = EXCLUDED.name, amount = EXCLUDED.amount,
        paid_snapshot = EXCLUDED.paid_snapshot, status = EXCLUDED.status, due = EXCLUDED.due,
        channel = EXCLUDED.channel, invoice = EXCLUDED.invoice, sort_order = EXCLUDED.sort_order, updated_at = now()`,
      [order.id, tenantId, order.studentId, order.student, order.name, order.amount, order.paid, order.status, order.due, order.channel, order.invoice, order.createdAt, index],
    );
  }

  private async insertLessonLedgerEntry(client: PoolClient, tenantId: string, entry: LessonLedgerEntry) {
    await client.query(
      `INSERT INTO lesson_ledger_entries (
        id, tenant_id, student_id, lesson_id, entry_type, hours_delta, reason, source, actor_id, occurred_at, reverses_entry_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), $11)`,
      [
        entry.id, tenantId, entry.studentId, entry.lessonId ?? null, entry.entryType,
        entry.hoursDelta, entry.reason, entry.source, entry.actorId,
        parseTimestamp(entry.occurredAt), entry.reversesEntryId ?? null,
      ],
    );
  }

  private async insertPaymentLedgerEntry(client: PoolClient, tenantId: string, entry: PaymentLedgerEntry) {
    await client.query(
      `INSERT INTO payment_ledger_entries (
        id, tenant_id, order_id, student_id, entry_type, amount_delta, channel, reason, actor_id, occurred_at, reverses_entry_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), $11)`,
      [
        entry.id, tenantId, entry.orderId, entry.studentId, entry.entryType,
        entry.amountDelta, entry.channel, entry.reason, entry.actorId,
        parseTimestamp(entry.occurredAt), entry.reversesEntryId ?? null,
      ],
    );
  }

  private async upsertTeacherIdentities(client: PoolClient, tenantId: string, state: AppSnapshot) {
    const names = new Map<string, string>();
    for (const lesson of state.lessons) {
      if (lesson.teacher?.trim()) {
        names.set(teacherIdForName(lesson.teacher), lesson.teacher.trim());
      }
    }
    for (const rule of state.payrollRules ?? []) {
      if (rule.teacherName?.trim()) {
        names.set(rule.teacherId || teacherIdForName(rule.teacherName), rule.teacherName.trim());
      }
    }
    for (const record of state.payrollRecords ?? []) {
      if (record.teacherName?.trim()) {
        names.set(record.teacherId || teacherIdForName(record.teacherName), record.teacherName.trim());
      }
    }
    for (const [teacherId, displayName] of names.entries()) {
      await client.query(
        `INSERT INTO teachers (id, tenant_id, display_name, status, updated_at)
         VALUES ($1, $2, $3, 'active', now())
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'active', updated_at = now()`,
        [teacherId, tenantId, displayName],
      );
    }
  }

  private async upsertInvoice(client: PoolClient, tenantId: string, invoice: Invoice) {
    await client.query(
      `INSERT INTO invoices (
        id, tenant_id, order_id, invoice_no, amount, status, issued_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, coalesce($8::timestamptz, now()), coalesce($9::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET
        order_id = EXCLUDED.order_id,
        invoice_no = EXCLUDED.invoice_no,
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        issued_at = EXCLUDED.issued_at,
        updated_at = now()`,
      [
        invoice.id,
        tenantId,
        invoice.orderId,
        invoice.invoiceNo,
        invoice.amount,
        invoice.status,
        parseTimestamp(invoice.issuedAt),
        parseTimestamp(invoice.createdAt),
        parseTimestamp(invoice.updatedAt),
      ],
    );
  }

  private async upsertRefund(client: PoolClient, tenantId: string, refund: Refund) {
    await client.query(
      `INSERT INTO refunds (
        id, tenant_id, order_id, payment_ledger_entry_id, amount, reason, status,
        requested_by, approved_by, exceptional, exception_code, exception_note, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, coalesce($13::timestamptz, now()), coalesce($14::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET
        payment_ledger_entry_id = EXCLUDED.payment_ledger_entry_id,
        amount = EXCLUDED.amount,
        reason = EXCLUDED.reason,
        status = EXCLUDED.status,
        approved_by = EXCLUDED.approved_by,
        exceptional = EXCLUDED.exceptional,
        exception_code = EXCLUDED.exception_code,
        exception_note = EXCLUDED.exception_note,
        updated_at = now()`,
      [
        refund.id,
        tenantId,
        refund.orderId,
        refund.paymentLedgerEntryId ?? null,
        refund.amount,
        refund.reason,
        refund.status,
        refund.requestedBy,
        refund.approvedBy ?? null,
        Boolean(refund.exceptional),
        refund.exceptionCode ?? null,
        refund.exceptionNote ?? null,
        parseTimestamp(refund.createdAt),
        parseTimestamp(refund.updatedAt),
      ],
    );
  }

  private async insertFinancialLedgerEntry(client: PoolClient, tenantId: string, entry: FinancialLedgerEntry) {
    await client.query(
      `INSERT INTO financial_ledger_entries (
        id, tenant_id, source_type, source_id, student_id, account, direction, amount, occurred_at, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()), coalesce($10::timestamptz, now()))
      ON CONFLICT (id) DO NOTHING`,
      [
        entry.id,
        tenantId,
        entry.sourceType,
        entry.sourceId,
        entry.studentId ?? null,
        entry.account,
        entry.direction,
        entry.amount,
        parseTimestamp(entry.occurredAt),
        parseTimestamp(entry.createdAt),
      ],
    );
  }

  private async upsertFinancialAccount(client: PoolClient, tenantId: string, account: FinancialAccount) {
    await client.query(
      `INSERT INTO financial_accounts (
        id, tenant_id, code, name, type, normal_balance, status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), coalesce($9::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET
        code = EXCLUDED.code,
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        normal_balance = EXCLUDED.normal_balance,
        status = EXCLUDED.status,
        updated_at = now()`,
      [
        account.id,
        tenantId,
        account.code,
        account.name,
        account.type,
        account.normalBalance,
        account.status,
        parseTimestamp(account.createdAt),
        parseTimestamp(account.updatedAt),
      ],
    );
  }

  private async upsertAccountingPeriodLock(client: PoolClient, tenantId: string, lock: AccountingPeriodLock) {
    await client.query(
      `INSERT INTO accounting_period_locks (
        id, tenant_id, period, status, locked_at, locked_by, note, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, coalesce($5::timestamptz, now()), $6, $7, coalesce($8::timestamptz, now()), coalesce($9::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET
        period = EXCLUDED.period,
        status = EXCLUDED.status,
        locked_at = EXCLUDED.locked_at,
        locked_by = EXCLUDED.locked_by,
        note = EXCLUDED.note,
        updated_at = now()`,
      [
        lock.id,
        tenantId,
        lock.period,
        lock.status,
        parseTimestamp(lock.lockedAt),
        lock.lockedBy,
        lock.note ?? null,
        parseTimestamp(lock.createdAt),
        parseTimestamp(lock.updatedAt),
      ],
    );
  }

  private async upsertReconciliationRun(client: PoolClient, tenantId: string, run: ReconciliationRun) {
    await client.query(
      `INSERT INTO reconciliation_runs (
        id, tenant_id, period, status, debit_total, credit_total, difference, checked_at, checked_by, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        period = EXCLUDED.period,
        status = EXCLUDED.status,
        debit_total = EXCLUDED.debit_total,
        credit_total = EXCLUDED.credit_total,
        difference = EXCLUDED.difference,
        checked_at = EXCLUDED.checked_at,
        checked_by = EXCLUDED.checked_by,
        notes = EXCLUDED.notes`,
      [
        run.id,
        tenantId,
        run.period,
        run.status,
        run.debitTotal,
        run.creditTotal,
        run.difference,
        parseTimestamp(run.checkedAt),
        run.checkedBy,
        run.notes,
      ],
    );
  }

  private async upsertPayrollRule(client: PoolClient, tenantId: string, rule: PayrollRule) {
    const teacherId = rule.teacherId || teacherIdForName(rule.teacherName);
    await client.query(
      `INSERT INTO teachers (id, tenant_id, display_name, status, updated_at)
       VALUES ($1, $2, $3, 'active', now())
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'active', updated_at = now()`,
      [teacherId, tenantId, rule.teacherName],
    );
    await client.query(
      `INSERT INTO payroll_rules (
        id, tenant_id, teacher_id, course_id, rule_type, amount, status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), coalesce($9::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET
        teacher_id = EXCLUDED.teacher_id,
        course_id = EXCLUDED.course_id,
        rule_type = EXCLUDED.rule_type,
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        updated_at = now()`,
      [
        rule.id,
        tenantId,
        teacherId,
        rule.courseId ?? null,
        rule.ruleType,
        rule.amount,
        rule.status,
        parseTimestamp(rule.createdAt),
        parseTimestamp(rule.updatedAt),
      ],
    );
  }

  private async upsertPayrollRecord(client: PoolClient, tenantId: string, record: PayrollRecord) {
    const teacherId = record.teacherId || teacherIdForName(record.teacherName);
    await client.query(
      `INSERT INTO payroll_records (
        id, tenant_id, teacher_id, lesson_id, rule_id, amount, status,
        confirmed_at, settled_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, coalesce($10::timestamptz, now()), coalesce($11::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET
        teacher_id = EXCLUDED.teacher_id,
        lesson_id = EXCLUDED.lesson_id,
        rule_id = EXCLUDED.rule_id,
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        confirmed_at = EXCLUDED.confirmed_at,
        settled_at = EXCLUDED.settled_at,
        updated_at = now()`,
      [
        record.id,
        tenantId,
        teacherId,
        record.lessonId ?? null,
        record.ruleId ?? null,
        record.amount,
        record.status,
        parseTimestamp(record.confirmedAt),
        parseTimestamp(record.settledAt),
        parseTimestamp(record.createdAt),
        parseTimestamp(record.updatedAt),
      ],
    );
  }

  private async upsertNotification(client: PoolClient, tenantId: string, note: NotificationDraft, index: number) {
    await client.query(
      `INSERT INTO notification_drafts (
        id, tenant_id, type, title, recipient, channel, status, content, created_at_text,
        sent_rate, scheduled_for, sort_order, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type, title = EXCLUDED.title, recipient = EXCLUDED.recipient,
        channel = EXCLUDED.channel, status = EXCLUDED.status, content = EXCLUDED.content,
        sent_rate = EXCLUDED.sent_rate, scheduled_for = EXCLUDED.scheduled_for,
        sort_order = EXCLUDED.sort_order, updated_at = now()`,
      [note.id, tenantId, note.type, note.title, note.recipient, note.channel, note.status, note.content, note.createdAt, note.sentRate ?? null, note.scheduledFor ?? null, index],
    );
  }

  private async upsertNotificationDelivery(client: PoolClient, tenantId: string, delivery: NotificationDelivery) {
    await client.query(
      `INSERT INTO notification_deliveries (
        id, tenant_id, notification_id, channel, recipient, status, provider_message_id,
        error_message, attempts, scheduled_for_text, next_retry_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11::timestamptz, null), coalesce($12::timestamptz, now()), coalesce($13::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, provider_message_id = EXCLUDED.provider_message_id,
        error_message = EXCLUDED.error_message, attempts = EXCLUDED.attempts,
        next_retry_at = EXCLUDED.next_retry_at, updated_at = now()`,
      [
        delivery.id, tenantId, delivery.notificationId, delivery.channel, delivery.recipient,
        delivery.status, delivery.providerMessageId ?? null, delivery.errorMessage ?? null,
        delivery.attempts, delivery.scheduledFor ?? null,
        parseTimestamp(delivery.nextRetryAt), parseTimestamp(delivery.createdAt), parseTimestamp(delivery.updatedAt),
      ],
    );
  }

  private async upsertBusinessTask(client: PoolClient, tenantId: string, task: BusinessTask, index: number) {
    await client.query(
      `INSERT INTO business_tasks (
        id, tenant_id, type, title, status, channel, source_text, lesson_id, student_id, created_at_text,
        executed_at_text, proposal_original, proposal_target, proposal_course, proposal_teacher, proposal_room,
        proposal_amount, expected_version, idempotency_key, sort_order, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now())
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, executed_at_text = EXCLUDED.executed_at_text,
        expected_version = EXCLUDED.expected_version, sort_order = EXCLUDED.sort_order, updated_at = now()`,
      [
        task.id, tenantId, task.type, task.title, task.status, task.channel, task.sourceText,
        task.lessonId ?? null, task.studentId ?? null, task.createdAt, task.executedAt ?? null,
        task.proposal.original ?? null, task.proposal.target ?? null,
        task.proposal.course ?? null, task.proposal.teacher ?? null, task.proposal.room ?? null,
        task.proposal.amount ?? null, task.expectedVersion, task.idempotencyKey, index,
      ],
    );
    await client.query("DELETE FROM business_task_checks WHERE task_id = $1 AND tenant_id = $2", [task.id, tenantId]);
    for (const [checkIndex, check] of task.checks.entries()) {
      await client.query(
        `INSERT INTO business_task_checks (id, tenant_id, task_id, label, ok, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [childId("task-check", task.id, checkIndex), tenantId, task.id, check.label, check.ok, checkIndex],
      );
    }
    await client.query("DELETE FROM business_task_effects WHERE task_id = $1 AND tenant_id = $2", [task.id, tenantId]);
    for (const [effectIndex, effect] of task.effects.entries()) {
      await client.query(
        `INSERT INTO business_task_effects (id, tenant_id, task_id, effect, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [childId("task-effect", task.id, effectIndex), tenantId, task.id, effect, effectIndex],
      );
    }
  }

  private async upsertKnowledgeChunk(client: PoolClient, tenantId: string, chunk: KnowledgeChunk) {
    await client.query(
      `INSERT INTO knowledge_chunks (
         id, tenant_id, doc_id, chunk_index, content, metadata,
         content_hash, embedding, embedding_provider, embedding_model, embedding_dimension, embedded_at,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, $10, $11, $12, now())
       ON CONFLICT (id) DO UPDATE SET
         chunk_index = EXCLUDED.chunk_index,
         content = EXCLUDED.content,
         metadata = EXCLUDED.metadata,
         content_hash = EXCLUDED.content_hash,
         embedding = EXCLUDED.embedding,
         embedding_provider = EXCLUDED.embedding_provider,
         embedding_model = EXCLUDED.embedding_model,
         embedding_dimension = EXCLUDED.embedding_dimension,
         embedded_at = EXCLUDED.embedded_at`,
      [
        chunk.id,
        tenantId,
        chunk.docId,
        chunk.chunkIndex,
        chunk.content,
        {
          ...chunk.metadata,
          title: chunk.title,
          scope: chunk.scope,
          sourceLabel: chunk.sourceLabel,
        },
        chunk.contentHash ?? "",
        chunk.embedding?.length ? vectorLiteral(chunk.embedding) : null,
        chunk.embeddingProvider ?? null,
        chunk.embeddingModel ?? null,
        chunk.embeddingDimension ?? null,
        parseTimestamp(chunk.embeddedAt),
      ],
    );
  }

  private async upsertChannelAccount(client: PoolClient, tenantId: string, account: ChannelAccount) {
    await client.query(
      `INSERT INTO channel_accounts (
        id, tenant_id, channel_id, channel_type, external_user_id, display_name,
        linked_user_id, linked_student_id, status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), coalesce($11::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        linked_user_id = EXCLUDED.linked_user_id,
        linked_student_id = EXCLUDED.linked_student_id,
        status = EXCLUDED.status,
        updated_at = now()`,
      [
        account.id,
        tenantId,
        account.channelId,
        account.channelType,
        account.externalUserId,
        account.displayName,
        account.linkedUserId ?? null,
        account.linkedStudentId ?? null,
        account.status,
        parseTimestamp(account.createdAt),
        parseTimestamp(account.updatedAt),
      ],
    );
  }

  private async upsertChannelMessage(client: PoolClient, tenantId: string, message: ChannelMessage) {
    await client.query(
      `INSERT INTO channel_messages (
        id, tenant_id, channel_type, message_id, from_user, text, event_type,
        status, task_id, response_text, received_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        task_id = EXCLUDED.task_id,
        response_text = EXCLUDED.response_text`,
      [
        message.id,
        tenantId,
        message.channelType,
        message.messageId,
        message.fromUser,
        message.text,
        message.eventType,
        message.status,
        message.taskId ?? null,
        message.responseText ?? null,
        parseTimestamp(message.receivedAt),
      ],
    );
  }

  private async upsertAgentToolCall(client: PoolClient, tenantId: string, call: AgentToolCall) {
    await client.query(
      `INSERT INTO agent_tool_calls (
        id, tenant_id, agent_run_id, tool_name, input_params, output_result,
        status, error_message, duration_ms, created_at, completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), $11::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        output_result = EXCLUDED.output_result,
        status = EXCLUDED.status,
        error_message = EXCLUDED.error_message,
        duration_ms = EXCLUDED.duration_ms,
        completed_at = EXCLUDED.completed_at`,
      [
        call.id,
        tenantId,
        call.agentRunId,
        call.toolName,
        call.inputParams,
        call.outputResult ?? null,
        call.status,
        call.errorMessage ?? null,
        call.durationMs ?? null,
        parseTimestamp(call.createdAt),
        parseTimestamp(call.completedAt),
      ],
    );
  }

  private async upsertAgentApproval(client: PoolClient, tenantId: string, approval: AgentApproval) {
    await client.query(
      `INSERT INTO agent_approvals (
        id, tenant_id, agent_run_id, tool_call_id, tool_name, risk_level, status,
        requested_by, approved_by, approval_note, input_params, created_at, decided_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12::timestamptz, now()), $13::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        approved_by = EXCLUDED.approved_by,
        approval_note = EXCLUDED.approval_note,
        decided_at = EXCLUDED.decided_at`,
      [
        approval.id,
        tenantId,
        approval.agentRunId ?? null,
        approval.toolCallId ?? null,
        approval.toolName,
        approval.riskLevel,
        approval.status,
        approval.requestedBy,
        approval.approvedBy ?? null,
        approval.approvalNote ?? null,
        approval.inputParams,
        parseTimestamp(approval.createdAt),
        parseTimestamp(approval.decidedAt),
      ],
    );
  }

  private async withTenantTransaction<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error("PostgreSQL pool is not configured");
    }
    const activeTransaction = this.transactionContext.getStore();
    if (activeTransaction) {
      if (activeTransaction.tenantId !== tenantId) {
        throw new ConflictException("Cannot switch tenant inside an active transaction");
      }
      return work(activeTransaction.client);
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await this.transactionContext.run({ client, tenantId }, () => work(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensureReady() {
    if (!this.pool) {
      this.memoryState ??= withRuntimeIntegrationStatus(cloneSeedState());
      return;
    }
    await runPostgresMigrations(this.pool);
    await this.assertPostgresSchemaVersion();
  }

  private async assertPostgresSchemaVersion() {
    if (!this.pool) {
      return;
    }
    const result = await this.pool.query(
      "SELECT version, checksum FROM schema_migrations ORDER BY version DESC LIMIT 1",
    );
    const latest = result.rows[0];
    if (!latest) {
      throw new Error(`PostgreSQL schema_migrations is empty; expected version ${POSTGRES_SCHEMA_VERSION}`);
    }
    const version = Number(latest.version);
    const checksum = String(latest.checksum ?? "");
    if (version !== POSTGRES_SCHEMA_VERSION || checksum !== POSTGRES_SCHEMA_CHECKSUM) {
      throw new Error(
        `PostgreSQL schema version mismatch: expected ${POSTGRES_SCHEMA_VERSION}/${POSTGRES_SCHEMA_CHECKSUM}, got ${version}/${checksum}`,
      );
    }
  }

  private async loadRelationalState(client: PoolClient, tenantId: string): Promise<AppSnapshot> {
    const tenantResult = await client.query("SELECT * FROM tenants WHERE id = $1", [tenantId]);
    const userResult = await client.query("SELECT * FROM users WHERE tenant_id = $1 ORDER BY created_at ASC, id ASC", [tenantId]);
    const studentResult = await client.query("SELECT * FROM students WHERE tenant_id = $1 ORDER BY sort_order ASC, created_at ASC", [tenantId]);
    const recordResult = await client.query("SELECT * FROM student_records WHERE tenant_id = $1 ORDER BY sort_order ASC, created_at ASC", [tenantId]);
    const communicationResult = await client.query("SELECT * FROM student_communications WHERE tenant_id = $1 ORDER BY sort_order ASC, created_at ASC", [tenantId]);
    const lessonResult = await client.query("SELECT * FROM lessons WHERE tenant_id = $1 ORDER BY sort_order ASC, created_at ASC", [tenantId]);
    const lessonLedgerResult = await client.query(
      `SELECT lle.*, s.name AS student_name
       FROM lesson_ledger_entries lle
       LEFT JOIN students s ON s.id = lle.student_id
       WHERE lle.tenant_id = $1
       ORDER BY lle.occurred_at DESC, lle.id ASC`,
      [tenantId],
    );
    const orderResult = await client.query("SELECT * FROM orders WHERE tenant_id = $1 ORDER BY sort_order ASC, created_at ASC", [tenantId]);
    const paymentLedgerResult = await client.query(
      `SELECT ple.*, s.name AS student_name
       FROM payment_ledger_entries ple
       LEFT JOIN students s ON s.id = ple.student_id
       WHERE ple.tenant_id = $1
       ORDER BY ple.occurred_at DESC, ple.id ASC`,
      [tenantId],
    );
    const invoiceResult = await client.query("SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY updated_at DESC, created_at DESC, id ASC", [tenantId]);
    const refundResult = await client.query("SELECT * FROM refunds WHERE tenant_id = $1 ORDER BY updated_at DESC, created_at DESC, id ASC", [tenantId]);
    const financialLedgerResult = await client.query("SELECT * FROM financial_ledger_entries WHERE tenant_id = $1 ORDER BY occurred_at DESC, id ASC", [tenantId]);
    const financialAccountResult = await client.query("SELECT * FROM financial_accounts WHERE tenant_id = $1 ORDER BY code ASC, created_at ASC", [tenantId]);
    const accountingLockResult = await client.query("SELECT * FROM accounting_period_locks WHERE tenant_id = $1 ORDER BY period DESC, locked_at DESC", [tenantId]);
    const reconciliationResult = await client.query("SELECT * FROM reconciliation_runs WHERE tenant_id = $1 ORDER BY checked_at DESC, id ASC", [tenantId]);
    const payrollRuleResult = await client.query(
      `SELECT pr.*, t.display_name AS teacher_name
       FROM payroll_rules pr
       LEFT JOIN teachers t ON t.id = pr.teacher_id
       WHERE pr.tenant_id = $1
       ORDER BY pr.updated_at DESC, pr.id ASC`,
      [tenantId],
    );
    const payrollRecordResult = await client.query(
      `SELECT pr.*, t.display_name AS teacher_name
       FROM payroll_records pr
       LEFT JOIN teachers t ON t.id = pr.teacher_id
       WHERE pr.tenant_id = $1
       ORDER BY pr.updated_at DESC, pr.created_at DESC, pr.id ASC`,
      [tenantId],
    );
    const notificationResult = await client.query("SELECT * FROM notification_drafts WHERE tenant_id = $1 ORDER BY sort_order ASC, updated_at ASC", [tenantId]);
    const deliveryResult = await client.query("SELECT * FROM notification_deliveries WHERE tenant_id = $1 ORDER BY updated_at DESC, created_at DESC, id ASC", [tenantId]);
    const taskResult = await client.query("SELECT * FROM business_tasks WHERE tenant_id = $1 ORDER BY sort_order ASC, updated_at ASC", [tenantId]);
    const checkResult = await client.query("SELECT * FROM business_task_checks WHERE tenant_id = $1 ORDER BY sort_order ASC", [tenantId]);
    const effectResult = await client.query("SELECT * FROM business_task_effects WHERE tenant_id = $1 ORDER BY sort_order ASC", [tenantId]);
    const templateResult = await client.query("SELECT * FROM notification_templates WHERE tenant_id = $1 ORDER BY sort_order ASC, updated_at ASC", [tenantId]);
    const auditResult = await client.query("SELECT * FROM audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC, id ASC", [tenantId]);
    const docResult = await client.query("SELECT * FROM knowledge_docs WHERE tenant_id = $1 ORDER BY updated_at_text DESC, id ASC", [tenantId]);
    const knowledgeChunkResult = await client.query("SELECT * FROM knowledge_chunks WHERE tenant_id = $1 ORDER BY doc_id ASC, chunk_index ASC, id ASC", [tenantId]);
    const channelResult = await client.query("SELECT * FROM channel_integrations WHERE tenant_id = $1 ORDER BY id ASC", [tenantId]);
    const channelAccountResult = await client.query("SELECT * FROM channel_accounts WHERE tenant_id = $1 ORDER BY updated_at DESC, id ASC", [tenantId]);
    const channelMessageResult = await client.query("SELECT * FROM channel_messages WHERE tenant_id = $1 ORDER BY received_at DESC, id ASC", [tenantId]);
    const agentResult = await client.query("SELECT * FROM agent_runs WHERE tenant_id = $1 ORDER BY created_at DESC, id ASC", [tenantId]);
    const toolCallResult = await client.query("SELECT * FROM agent_tool_calls WHERE tenant_id = $1 ORDER BY created_at DESC, id ASC", [tenantId]);
    const approvalResult = await client.query("SELECT * FROM agent_approvals WHERE tenant_id = $1 ORDER BY created_at DESC, id ASC", [tenantId]);

    const tenant = tenantResult.rows[0];
    const user = userResult.rows[0];
    const recordsByStudent = groupBy(recordResult.rows.map(toStudentRecordRow), (row) => row.studentId);
    const communicationsByStudent = groupBy(communicationResult.rows.map(toCommunicationRow), (row) => row.studentId);
    const checksByTask = groupBy(checkResult.rows.map(toTaskCheckRow), (row) => row.taskId);
    const effectsByTask = groupBy(effectResult.rows.map(toTaskEffectRow), (row) => row.taskId);

    return {
      organization: {
        id: String(tenant.id),
        name: String(tenant.name),
        subtitle: String(tenant.subtitle ?? ""),
        user: String(user?.display_name ?? "机构管理员"),
        role: String(user?.role ?? "admin"),
      },
      students: studentResult.rows.map((row): Student => ({
        id: String(row.id),
        name: String(row.name),
        short: String(row.short),
        grade: String(row.grade),
        status: String(row.status),
        tags: row.tags ?? [],
        code: String(row.code),
        joinedAt: String(row.joined_at),
        guardian: String(row.guardian),
        phone: String(row.phone),
        note: String(row.note),
        teacher: String(row.teacher),
        teacherCourse: String(row.teacher_course),
        packageName: String(row.package_name),
        baseRemainingHours: Number(row.base_remaining_hours),
        remainingHours: Number(row.base_remaining_hours),
        packageValidTo: String(row.package_valid_to),
        attendanceRate: String(row.attendance_rate),
        latestAttendance: String(row.latest_attendance),
        dueAmount: Number(row.due_amount),
        growthPoints: Number(row.growth_points),
        records: (recordsByStudent.get(String(row.id)) ?? []).map(({ record }) => record),
        communications: (communicationsByStudent.get(String(row.id)) ?? []).map(({ communication }) => communication),
      })),
      lessons: lessonResult.rows.map(toLesson),
      orders: orderResult.rows.map(toOrder),
      lessonLedgerEntries: lessonLedgerResult.rows.map(toLessonLedgerEntry),
      paymentLedgerEntries: paymentLedgerResult.rows.map(toPaymentLedgerEntry),
      invoices: invoiceResult.rows.map(toInvoice),
      refunds: refundResult.rows.map(toRefund),
      financialLedgerEntries: financialLedgerResult.rows.map(toFinancialLedgerEntry),
      financialAccounts: financialAccountResult.rows.map(toFinancialAccount),
      accountingPeriodLocks: accountingLockResult.rows.map(toAccountingPeriodLock),
      reconciliationRuns: reconciliationResult.rows.map(toReconciliationRun),
      payrollRules: payrollRuleResult.rows.map(toPayrollRule),
      payrollRecords: payrollRecordResult.rows.map(toPayrollRecord),
      notifications: notificationResult.rows.map(toNotification),
      notificationDeliveries: deliveryResult.rows.map(toNotificationDelivery),
      tasks: taskResult.rows.map((row): BusinessTask => ({
        id: String(row.id),
        type: row.type,
        title: String(row.title),
        status: row.status,
        channel: String(row.channel),
        sourceText: String(row.source_text),
        lessonId: row.lesson_id ? String(row.lesson_id) : undefined,
        studentId: row.student_id ? String(row.student_id) : undefined,
        createdAt: String(row.created_at_text),
        executedAt: row.executed_at_text ? String(row.executed_at_text) : undefined,
        proposal: {
          original: nullableText(row.proposal_original),
          target: nullableText(row.proposal_target),
          course: nullableText(row.proposal_course),
          teacher: nullableText(row.proposal_teacher),
          room: nullableText(row.proposal_room),
          amount: row.proposal_amount == null ? undefined : Number(row.proposal_amount),
        },
        checks: (checksByTask.get(String(row.id)) ?? []).map(({ check }) => check),
        effects: (effectsByTask.get(String(row.id)) ?? []).map(({ effect }) => effect),
        expectedVersion: Number(row.expected_version),
        idempotencyKey: String(row.idempotency_key),
      })),
      templates: templateResult.rows.map((row): Template => ({
        id: String(row.id),
        title: String(row.title),
        type: String(row.type),
        content: String(row.content),
      })),
      auditLogs: auditResult.rows.map((row): AuditLog => ({
        id: String(row.id),
        time: String(row.time_text),
        actor: String(row.actor),
        action: String(row.action),
        summary: String(row.summary),
        status: String(row.status),
      })),
      ragDocs: docResult.rows.map((row): KnowledgeDoc => ({
        id: String(row.id),
        title: String(row.title),
        scope: String(row.scope),
        status: String(row.status),
        updatedAt: String(row.updated_at_text),
        sourceCount: Number(row.source_count),
        sourceUri: String(row.source_uri ?? ""),
        mimeType: String(row.mime_type ?? ""),
        checksum: String(row.checksum ?? ""),
        parser: String(row.parser ?? ""),
        effectiveFrom: String(row.effective_from ?? ""),
        expiresAt: String(row.expires_at ?? ""),
        invalidatedAt: row.invalidated_at ? String(row.invalidated_at) : undefined,
        invalidatedBy: row.invalidated_by ? String(row.invalidated_by) : undefined,
        metadata: (row.metadata ?? {}) as Record<string, string | number | boolean>,
      })),
      knowledgeChunks: knowledgeChunkResult.rows.map(toKnowledgeChunk),
      channelIntegrations: channelResult.rows.map((row): ChannelIntegration => ({
        id: String(row.id),
        name: String(row.name),
        type: row.type,
        status: row.status,
        description: String(row.description),
      })),
      channelAccounts: channelAccountResult.rows.map(toChannelAccount),
      channelMessages: channelMessageResult.rows.map(toChannelMessage),
      agentRuns: agentResult.rows.map((row): AgentRun => ({
        id: String(row.id),
        status: String(row.status),
        task: String(row.task),
        startedAt: String(row.started_at_text),
        toolCalls: Number(row.tool_calls),
        agentRunId: nullableText(row.agent_run_id),
      })),
      agentToolCalls: toolCallResult.rows.map(toAgentToolCall),
      agentApprovals: approvalResult.rows.map(toAgentApproval),
    };
  }

  private async replaceRelationalState(client: PoolClient, state: AppSnapshot) {
    const tenantId = state.organization.id || TENANT_ID;
    await client.query(
      `INSERT INTO tenants (id, name, subtitle, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, subtitle = EXCLUDED.subtitle, updated_at = now()`,
      [tenantId, state.organization.name, state.organization.subtitle],
    );
    await this.clearTenantData(client, tenantId, false);
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, display_name, role, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         role = EXCLUDED.role,
         updated_at = now()`,
      ["user-lin", tenantId, defaultAdminEmail(), defaultAdminPasswordHash(), state.organization.user, normalizeRole(state.organization.role)],
    );

    for (const [index, student] of state.students.entries()) {
      await client.query(
        `INSERT INTO students (
          id, tenant_id, name, short, grade, status, tags, code, joined_at, guardian, phone, note,
          teacher, teacher_course, package_name, base_remaining_hours, package_valid_to, attendance_rate,
          latest_attendance, due_amount, growth_points, sort_order, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, now())`,
        [
          student.id,
          tenantId,
          student.name,
          student.short,
          student.grade,
          student.status,
          student.tags,
          student.code,
          student.joinedAt,
          student.guardian,
          student.phone,
          student.note,
          student.teacher,
          student.teacherCourse,
          student.packageName,
          student.baseRemainingHours ?? student.remainingHours,
          student.packageValidTo,
          student.attendanceRate,
          student.latestAttendance,
          student.dueAmount,
          student.growthPoints,
          index,
        ],
      );
      for (const [recordIndex, record] of student.records.entries()) {
        await client.query(
          `INSERT INTO student_records (id, tenant_id, student_id, date_text, title, teacher, status, note, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [childId("student-record", student.id, recordIndex), tenantId, student.id, record.date, record.title, record.teacher, record.status, record.note, recordIndex],
        );
      }
      for (const [communicationIndex, communication] of student.communications.entries()) {
        await client.query(
          `INSERT INTO student_communications (id, tenant_id, student_id, type, title, time_text, body, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [childId("student-communication", student.id, communicationIndex), tenantId, student.id, communication.type, communication.title, communication.time, communication.text, communicationIndex],
        );
      }
    }

    const courseRows = uniqueCourses(state.lessons);
    for (const [index, course] of courseRows.entries()) {
      await client.query(
        `INSERT INTO courses (id, tenant_id, title, type, default_price, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (tenant_id, title, type) DO UPDATE SET default_price = EXCLUDED.default_price, updated_at = now()`,
        [`course-${tenantId}-${index + 1}`, tenantId, course.title, course.type, course.price],
      );
    }
    await this.upsertTeacherIdentities(client, tenantId, state);

    for (const [index, lesson] of state.lessons.entries()) {
      await client.query(
        `INSERT INTO lessons (
          id, tenant_id, day_index, date_text, start_time, end_time, title, type, student_id, student_name,
          teacher, room, status, color, attendance, package_name, remaining_text, price, selected, sort_order, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now())`,
        [
          lesson.id,
          tenantId,
          lesson.day,
          lesson.date,
          lesson.start,
          lesson.end,
          lesson.title,
          lesson.type,
          lesson.studentId,
          lesson.studentName,
          lesson.teacher,
          lesson.room,
          lesson.status,
          lesson.color,
          lesson.attendance,
          lesson.package,
          lesson.remaining,
          lesson.price,
          Boolean(lesson.selected),
          index,
        ],
      );
    }

    for (const entry of state.lessonLedgerEntries) {
      await client.query(
        `INSERT INTO lesson_ledger_entries (
          id, tenant_id, student_id, lesson_id, entry_type, hours_delta, reason, source, actor_id, occurred_at, reverses_entry_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), $11)`,
        [
          entry.id,
          tenantId,
          entry.studentId,
          entry.lessonId ?? null,
          entry.entryType,
          entry.hoursDelta,
          entry.reason,
          entry.source,
          entry.actorId,
          parseTimestamp(entry.occurredAt),
          entry.reversesEntryId ?? null,
        ],
      );
    }

    for (const [index, order] of state.orders.entries()) {
      await client.query(
        `INSERT INTO orders (
          id, tenant_id, student_id, student_name, name, amount, paid_snapshot, status, due, channel,
          invoice, created_at_text, sort_order, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
        [order.id, tenantId, order.studentId, order.student, order.name, order.amount, order.paid, order.status, order.due, order.channel, order.invoice, order.createdAt, index],
      );
    }

    for (const entry of state.paymentLedgerEntries) {
      await client.query(
        `INSERT INTO payment_ledger_entries (
          id, tenant_id, order_id, student_id, entry_type, amount_delta, channel, reason, actor_id, occurred_at, reverses_entry_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), $11)`,
        [
          entry.id,
          tenantId,
          entry.orderId,
          entry.studentId,
          entry.entryType,
          entry.amountDelta,
          entry.channel,
          entry.reason,
          entry.actorId,
          parseTimestamp(entry.occurredAt),
          entry.reversesEntryId ?? null,
        ],
      );
    }

    for (const invoice of state.invoices ?? []) {
      await this.upsertInvoice(client, tenantId, invoice);
    }

    for (const refund of state.refunds ?? []) {
      await this.upsertRefund(client, tenantId, refund);
    }

    for (const entry of state.financialLedgerEntries ?? []) {
      await this.insertFinancialLedgerEntry(client, tenantId, entry);
    }

    for (const account of state.financialAccounts ?? []) {
      await this.upsertFinancialAccount(client, tenantId, account);
    }

    for (const lock of state.accountingPeriodLocks ?? []) {
      await this.upsertAccountingPeriodLock(client, tenantId, lock);
    }

    for (const run of state.reconciliationRuns ?? []) {
      await this.upsertReconciliationRun(client, tenantId, run);
    }

    for (const rule of state.payrollRules ?? []) {
      await this.upsertPayrollRule(client, tenantId, rule);
    }

    for (const record of state.payrollRecords ?? []) {
      await this.upsertPayrollRecord(client, tenantId, record);
    }

    for (const [index, note] of state.notifications.entries()) {
      await client.query(
        `INSERT INTO notification_drafts (
          id, tenant_id, type, title, recipient, channel, status, content, created_at_text,
          sent_rate, scheduled_for, sort_order, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())`,
        [note.id, tenantId, note.type, note.title, note.recipient, note.channel, note.status, note.content, note.createdAt, note.sentRate ?? null, note.scheduledFor ?? null, index],
      );
    }

    for (const delivery of state.notificationDeliveries) {
      await client.query(
        `INSERT INTO notification_deliveries (
          id, tenant_id, notification_id, channel, recipient, status, provider_message_id,
          error_message, attempts, scheduled_for_text, next_retry_at, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11::timestamptz, null), coalesce($12::timestamptz, now()), coalesce($13::timestamptz, now()))`,
        [
          delivery.id,
          tenantId,
          delivery.notificationId,
          delivery.channel,
          delivery.recipient,
          delivery.status,
          delivery.providerMessageId ?? null,
          delivery.errorMessage ?? null,
          delivery.attempts,
          delivery.scheduledFor ?? null,
          parseTimestamp(delivery.nextRetryAt),
          parseTimestamp(delivery.createdAt),
          parseTimestamp(delivery.updatedAt),
        ],
      );
    }

    for (const [index, task] of state.tasks.entries()) {
      await client.query(
        `INSERT INTO business_tasks (
          id, tenant_id, type, title, status, channel, source_text, lesson_id, student_id, created_at_text,
          executed_at_text, proposal_original, proposal_target, proposal_course, proposal_teacher, proposal_room,
          proposal_amount, expected_version, idempotency_key, sort_order, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now())`,
        [
          task.id,
          tenantId,
          task.type,
          task.title,
          task.status,
          task.channel,
          task.sourceText,
          task.lessonId ?? null,
          task.studentId ?? null,
          task.createdAt,
          task.executedAt ?? null,
          task.proposal.original ?? null,
          task.proposal.target ?? null,
          task.proposal.course ?? null,
          task.proposal.teacher ?? null,
          task.proposal.room ?? null,
          task.proposal.amount ?? null,
          task.expectedVersion,
          task.idempotencyKey,
          index,
        ],
      );
      for (const [checkIndex, check] of task.checks.entries()) {
        await client.query(
          `INSERT INTO business_task_checks (id, tenant_id, task_id, label, ok, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [childId("task-check", task.id, checkIndex), tenantId, task.id, check.label, check.ok, checkIndex],
        );
      }
      for (const [effectIndex, effect] of task.effects.entries()) {
        await client.query(
          `INSERT INTO business_task_effects (id, tenant_id, task_id, effect, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [childId("task-effect", task.id, effectIndex), tenantId, task.id, effect, effectIndex],
        );
      }
    }

    for (const [index, template] of state.templates.entries()) {
      await client.query(
        `INSERT INTO notification_templates (id, tenant_id, title, type, content, sort_order, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [template.id, tenantId, template.title, template.type, template.content, index],
      );
    }

    for (const [index, log] of state.auditLogs.entries()) {
      await client.query(
        `INSERT INTO audit_logs (id, tenant_id, time_text, actor, action, summary, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() - ($8::INTEGER * interval '1 second'))`,
        [log.id, tenantId, log.time, log.actor, log.action, log.summary, log.status, index],
      );
    }

    for (const doc of state.ragDocs) {
      await client.query(
        `INSERT INTO knowledge_docs (id, tenant_id, title, scope, status, updated_at_text, source_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [doc.id, tenantId, doc.title, doc.scope, doc.status, doc.updatedAt, doc.sourceCount],
      );
    }

    for (const chunk of state.knowledgeChunks) {
      await this.upsertKnowledgeChunk(client, tenantId, chunk);
    }

    for (const channel of state.channelIntegrations) {
      await client.query(
        `INSERT INTO channel_integrations (id, tenant_id, name, type, status, description, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [channel.id, tenantId, channel.name, channel.type, channel.status, channel.description],
      );
    }

    for (const account of state.channelAccounts) {
      await this.upsertChannelAccount(client, tenantId, account);
    }

    for (const message of state.channelMessages) {
      await this.upsertChannelMessage(client, tenantId, message);
    }

    for (const run of state.agentRuns) {
      await client.query(
        `INSERT INTO agent_runs (id, tenant_id, status, task, started_at_text, tool_calls)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [run.id, tenantId, run.status, run.task, run.startedAt, run.toolCalls],
      );
    }

    for (const call of state.agentToolCalls) {
      await this.upsertAgentToolCall(client, tenantId, call);
    }

    for (const approval of state.agentApprovals) {
      await this.upsertAgentApproval(client, tenantId, approval);
    }
  }

  private async clearTenantData(client: PoolClient, tenantId: string, includeIdempotency: boolean) {
    const tables = [
      "agent_approvals",
      "agent_tool_calls",
      "channel_messages",
      "channel_accounts",
      "knowledge_chunks",
      "documents",
      "reconciliation_runs",
      "accounting_period_locks",
      "payroll_records",
      "payroll_rules",
      "financial_ledger_entries",
      "financial_accounts",
      "refunds",
      "invoices",
      "learning_records",
      "student_package_accounts",
      "course_packages",
      "household_members",
      "households",
      "teachers",
      "notification_deliveries",
      "business_task_checks",
      "business_task_effects",
      "payment_ledger_entries",
      "lesson_ledger_entries",
      "student_records",
      "student_communications",
      "agent_runs",
      "channel_integrations",
      "knowledge_docs",
      "notification_templates",
      "audit_logs",
      "business_tasks",
      "notification_drafts",
      "orders",
      "lessons",
      "courses",
      "users",
      "students",
    ];
    if (includeIdempotency) {
      tables.unshift("idempotency_keys");
    }
    for (const table of tables) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
  }
}

interface PostgresMigration {
  version: number;
  name: string;
  checksum: string;
  statements: string[];
}

async function runPostgresMigrations(pool: pg.Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  for (const migration of loadPostgresMigrations()) {
    const existing = await pool.query("SELECT checksum FROM schema_migrations WHERE version = $1", [migration.version]);
    if (existing.rowCount) {
      const checksum = String(existing.rows[0].checksum ?? "");
      if (checksum !== migration.checksum) {
        throw new Error(`PostgreSQL migration checksum mismatch for ${migration.version}: expected ${migration.checksum}, got ${checksum}`);
      }
      continue;
    }
    const client = await pool.connect();
    try {
      const regularStatements = [];
      for (const statement of migration.statements) {
        if (statement.toLowerCase().startsWith("create extension")) {
          try {
            await client.query(statement);
          } catch {
            // pgvector is required in production, but memory/local tests can run without it.
          }
        } else {
          regularStatements.push(statement);
        }
      }
      await client.query("BEGIN");
      for (const statement of regularStatements) {
        await client.query(statement);
      }
      await client.query(
        `INSERT INTO schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)
         ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name, checksum = EXCLUDED.checksum`,
        [migration.version, migration.name, migration.checksum],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function loadPostgresMigrations(): PostgresMigration[] {
  const migrationsDir = resolvePostgresMigrationsDir();
  const files = readdirSync(migrationsDir)
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(file))
    .sort();
  return files.map((file): PostgresMigration => {
    const match = file.match(/^(\d{4})_(.+)\.sql$/i);
    if (!match) {
      throw new Error(`Invalid PostgreSQL migration filename: ${file}`);
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    return {
      version: Number(match[1]),
      name: match[2],
      checksum: createHash("sha256").update(sql).digest("hex"),
      statements: splitSqlStatements(sql),
    };
  });
}

function resolvePostgresMigrationsDir(): string {
  const candidates = [
    join(process.cwd(), "infra/postgres/migrations"),
    join(process.cwd(), "../../infra/postgres/migrations"),
    resolve(process.cwd(), "infra/postgres/migrations"),
  ];
  const migrationsDir = candidates.find((candidate) => existsSync(candidate));
  if (!migrationsDir) {
    throw new Error("PostgreSQL migrations directory not found: infra/postgres/migrations");
  }
  return migrationsDir;
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function hashStable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function assertSameRequest(cachedHash: string, requestHash: string) {
  if (cachedHash !== requestHash) {
    throw new ConflictException("Idempotency key already used for a different request");
  }
}

function withRuntimeIntegrationStatus(state: AppSnapshot): AppSnapshot {
  // Channel statuses are now explicitly managed through the API.
  // Env vars (WECOM_CORP_ID, WECHAT_H5_APP_ID, etc.) are only used
  // by the notification provider for sending decisions, not for UI status.
  return state;
}

function toLesson(row: Record<string, unknown>): Lesson {
  return {
    id: String(row.id),
    day: Number(row.day_index),
    date: String(row.date_text),
    start: String(row.start_time),
    end: String(row.end_time),
    title: String(row.title),
    type: String(row.type),
    studentId: String(row.student_id),
    studentName: String(row.student_name),
    teacher: String(row.teacher),
    room: String(row.room),
    status: String(row.status),
    color: row.color as Lesson["color"],
    attendance: String(row.attendance),
    package: String(row.package_name),
    remaining: String(row.remaining_text),
    price: Number(row.price),
    selected: Boolean(row.selected),
  };
}

function toStoreUser(row: Record<string, unknown>): StoreUser {
  return {
    userId: String(row.id),
    tenantId: String(row.tenant_id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    displayName: String(row.display_name),
    role: normalizeRole(String(row.role)),
    status: String(row.status),
  };
}

function toOrder(row: Record<string, unknown>): Order {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    student: String(row.student_name),
    name: String(row.name),
    amount: Number(row.amount),
    paid: Number(row.paid_snapshot),
    status: String(row.status),
    due: String(row.due),
    channel: String(row.channel),
    invoice: String(row.invoice),
    createdAt: String(row.created_at_text),
  };
}

function toLessonLedgerEntry(row: Record<string, unknown>): LessonLedgerEntry {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    studentName: String(row.student_name ?? row.student_id),
    lessonId: nullableText(row.lesson_id),
    entryType: row.entry_type as LessonLedgerEntry["entryType"],
    hoursDelta: Number(row.hours_delta),
    reason: String(row.reason),
    source: String(row.source),
    actorId: String(row.actor_id),
    occurredAt: timestampText(row.occurred_at),
    reversesEntryId: nullableText(row.reverses_entry_id),
  };
}

function toPaymentLedgerEntry(row: Record<string, unknown>): PaymentLedgerEntry {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    studentId: String(row.student_id),
    studentName: String(row.student_name ?? row.student_id),
    entryType: row.entry_type as PaymentLedgerEntry["entryType"],
    amountDelta: Number(row.amount_delta),
    channel: String(row.channel),
    reason: String(row.reason),
    actorId: String(row.actor_id),
    occurredAt: timestampText(row.occurred_at),
    reversesEntryId: nullableText(row.reverses_entry_id),
  };
}

function toInvoice(row: Record<string, unknown>): Invoice {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    invoiceNo: String(row.invoice_no),
    amount: Number(row.amount),
    status: row.status as Invoice["status"],
    issuedAt: row.issued_at == null ? undefined : timestampText(row.issued_at),
    createdAt: timestampText(row.created_at),
    updatedAt: timestampText(row.updated_at),
  };
}

function toRefund(row: Record<string, unknown>): Refund {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    paymentLedgerEntryId: nullableText(row.payment_ledger_entry_id),
    amount: Number(row.amount),
    reason: String(row.reason),
    status: row.status as Refund["status"],
    requestedBy: String(row.requested_by),
    approvedBy: nullableText(row.approved_by),
    exceptional: Boolean(row.exceptional),
    exceptionCode: nullableText(row.exception_code),
    exceptionNote: nullableText(row.exception_note),
    createdAt: timestampText(row.created_at),
    updatedAt: timestampText(row.updated_at),
  };
}

function toFinancialLedgerEntry(row: Record<string, unknown>): FinancialLedgerEntry {
  return {
    id: String(row.id),
    sourceType: row.source_type as FinancialLedgerEntry["sourceType"],
    sourceId: String(row.source_id),
    studentId: nullableText(row.student_id),
    account: String(row.account),
    direction: row.direction as FinancialLedgerEntry["direction"],
    amount: Number(row.amount),
    occurredAt: timestampText(row.occurred_at),
    createdAt: timestampText(row.created_at),
  };
}

function toFinancialAccount(row: Record<string, unknown>): FinancialAccount {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    type: row.type as FinancialAccount["type"],
    normalBalance: row.normal_balance as FinancialAccount["normalBalance"],
    status: row.status as FinancialAccount["status"],
    createdAt: timestampText(row.created_at),
    updatedAt: timestampText(row.updated_at),
  };
}

function toAccountingPeriodLock(row: Record<string, unknown>): AccountingPeriodLock {
  return {
    id: String(row.id),
    period: String(row.period),
    status: "locked",
    lockedAt: timestampText(row.locked_at),
    lockedBy: String(row.locked_by),
    note: nullableText(row.note),
    createdAt: timestampText(row.created_at),
    updatedAt: timestampText(row.updated_at),
  };
}

function toReconciliationRun(row: Record<string, unknown>): ReconciliationRun {
  return {
    id: String(row.id),
    period: String(row.period),
    status: row.status as ReconciliationRun["status"],
    debitTotal: Number(row.debit_total),
    creditTotal: Number(row.credit_total),
    difference: Number(row.difference),
    checkedAt: timestampText(row.checked_at),
    checkedBy: String(row.checked_by),
    notes: Array.isArray(row.notes) ? row.notes.map(String) : [],
  };
}

function toPayrollRule(row: Record<string, unknown>): PayrollRule {
  const teacherName = String(row.teacher_name ?? row.teacher_id ?? "未指定教师");
  return {
    id: String(row.id),
    teacherId: nullableText(row.teacher_id),
    teacherName,
    courseId: nullableText(row.course_id),
    ruleType: row.rule_type as PayrollRule["ruleType"],
    amount: Number(row.amount),
    status: row.status as PayrollRule["status"],
    createdAt: timestampText(row.created_at),
    updatedAt: timestampText(row.updated_at),
  };
}

function toPayrollRecord(row: Record<string, unknown>): PayrollRecord {
  const teacherName = String(row.teacher_name ?? row.teacher_id ?? "未指定教师");
  return {
    id: String(row.id),
    teacherId: nullableText(row.teacher_id),
    teacherName,
    lessonId: nullableText(row.lesson_id),
    ruleId: nullableText(row.rule_id),
    amount: Number(row.amount),
    status: row.status as PayrollRecord["status"],
    confirmedAt: row.confirmed_at == null ? undefined : timestampText(row.confirmed_at),
    settledAt: row.settled_at == null ? undefined : timestampText(row.settled_at),
    createdAt: timestampText(row.created_at),
    updatedAt: timestampText(row.updated_at),
  };
}

function toNotification(row: Record<string, unknown>): NotificationDraft {
  return {
    id: String(row.id),
    type: String(row.type),
    title: String(row.title),
    recipient: String(row.recipient),
    channel: String(row.channel),
    status: row.status as NotificationDraft["status"],
    content: String(row.content),
    createdAt: String(row.created_at_text),
    sentRate: nullableText(row.sent_rate),
    scheduledFor: nullableText(row.scheduled_for),
  };
}

function toNotificationDelivery(row: Record<string, unknown>): NotificationDelivery {
  return {
    id: String(row.id),
    notificationId: String(row.notification_id),
    channel: String(row.channel),
    recipient: String(row.recipient),
    status: row.status as NotificationDelivery["status"],
    providerMessageId: nullableText(row.provider_message_id),
    errorMessage: nullableText(row.error_message),
    attempts: Number(row.attempts),
    scheduledFor: nullableText(row.scheduled_for_text),
    nextRetryAt: row.next_retry_at == null ? undefined : timestampText(row.next_retry_at),
    createdAt: timestampText(row.created_at),
    updatedAt: timestampText(row.updated_at),
  };
}

function toKnowledgeChunk(row: Record<string, unknown>): KnowledgeChunk {
  const metadata = (row.metadata ?? {}) as Record<string, string | number | boolean>;
  return {
    id: String(row.id),
    docId: String(row.doc_id),
    chunkIndex: Number(row.chunk_index),
    title: String(metadata.title ?? "知识片段"),
    scope: String(metadata.scope ?? "机构知识库"),
    content: String(row.content),
    sourceLabel: String(metadata.sourceLabel ?? `${row.doc_id}#${row.chunk_index}`),
    metadata,
    contentHash: String(row.content_hash ?? ""),
    embedding: parseVectorValue(row.embedding),
    embeddingProvider: row.embedding_provider ? String(row.embedding_provider) : undefined,
    embeddingModel: row.embedding_model ? String(row.embedding_model) : undefined,
    embeddingDimension: row.embedding_dimension == null ? undefined : Number(row.embedding_dimension),
    embeddedAt: row.embedded_at ? String(row.embedded_at) : undefined,
  };
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => Number(value).toFixed(8)).join(",")}]`;
}

function parseVectorValue(value: unknown): number[] | undefined {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(Number).filter(Number.isFinite);
  }
  const text = String(value).trim();
  if (!text.startsWith("[") || !text.endsWith("]")) {
    return undefined;
  }
  const vector = text
    .slice(1, -1)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter(Number.isFinite);
  return vector.length ? vector : undefined;
}

function toChannelAccount(row: Record<string, unknown>): ChannelAccount {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    channelType: row.channel_type as ChannelAccount["channelType"],
    externalUserId: String(row.external_user_id),
    displayName: String(row.display_name),
    linkedUserId: nullableText(row.linked_user_id),
    linkedStudentId: nullableText(row.linked_student_id),
    status: row.status as ChannelAccount["status"],
    createdAt: timestampText(row.created_at),
    updatedAt: timestampText(row.updated_at),
  };
}

function toChannelMessage(row: Record<string, unknown>): ChannelMessage {
  return {
    id: String(row.id),
    channelType: row.channel_type as ChannelMessage["channelType"],
    messageId: String(row.message_id),
    fromUser: String(row.from_user),
    text: String(row.text),
    eventType: row.event_type as ChannelMessage["eventType"],
    status: row.status as ChannelMessage["status"],
    taskId: nullableText(row.task_id),
    responseText: nullableText(row.response_text),
    receivedAt: timestampText(row.received_at),
  };
}

function toAgentToolCall(row: Record<string, unknown>): AgentToolCall {
  return {
    id: String(row.id),
    agentRunId: String(row.agent_run_id),
    toolName: String(row.tool_name),
    inputParams: objectValue(row.input_params),
    outputResult: row.output_result == null ? undefined : objectValue(row.output_result),
    status: row.status as AgentToolCall["status"],
    errorMessage: nullableText(row.error_message),
    durationMs: row.duration_ms == null ? undefined : Number(row.duration_ms),
    createdAt: timestampText(row.created_at),
    completedAt: row.completed_at == null ? undefined : timestampText(row.completed_at),
  };
}

function toAgentApproval(row: Record<string, unknown>): AgentApproval {
  return {
    id: String(row.id),
    agentRunId: nullableText(row.agent_run_id),
    toolCallId: nullableText(row.tool_call_id),
    toolName: String(row.tool_name),
    riskLevel: row.risk_level as AgentApproval["riskLevel"],
    status: row.status as AgentApproval["status"],
    requestedBy: String(row.requested_by),
    approvedBy: nullableText(row.approved_by),
    approvalNote: nullableText(row.approval_note),
    inputParams: objectValue(row.input_params),
    createdAt: timestampText(row.created_at),
    decidedAt: row.decided_at == null ? undefined : timestampText(row.decided_at),
  };
}

function toStudentRecordRow(row: Record<string, unknown>): { studentId: string; record: StudentRecord } {
  return {
    studentId: String(row.student_id),
    record: {
      date: String(row.date_text),
      title: String(row.title),
      teacher: String(row.teacher),
      status: String(row.status),
      note: String(row.note),
    },
  };
}

function toCommunicationRow(row: Record<string, unknown>): { studentId: string; communication: CommunicationRecord } {
  return {
    studentId: String(row.student_id),
    communication: {
      type: String(row.type),
      title: String(row.title),
      time: String(row.time_text),
      text: String(row.body),
    },
  };
}

function toTaskCheckRow(row: Record<string, unknown>) {
  return {
    taskId: String(row.task_id),
    check: {
      label: String(row.label),
      ok: Boolean(row.ok),
    },
  };
}

function toTaskEffectRow(row: Record<string, unknown>) {
  return {
    taskId: String(row.task_id),
    effect: String(row.effect),
  };
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function nullableText(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function timestampText(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function parseTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\//g, "-");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function childId(prefix: string, parentId: string, index: number): string {
  return `${prefix}-${parentId}-${index + 1}`;
}

function uniqueCourses(lessons: Lesson[]): Array<{ title: string; type: string; price: number }> {
  const courses = new Map<string, { title: string; type: string; price: number }>();
  for (const lesson of lessons) {
    const key = `${lesson.title}::${lesson.type}`;
    courses.set(key, { title: lesson.title, type: lesson.type, price: lesson.price });
  }
  return [...courses.values()];
}

function teacherIdForName(name: string): string {
  const normalized = name.trim().toLowerCase()
    .replace(/老师/g, "lao-shi")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `teacher-${normalized || "unknown"}`;
}

function normalizeRole(role: string): UserRole {
  if (role === "teacher" || role === "finance" || role === "assistant" || role === "readonly") {
    return role;
  }
  return "admin";
}

function hasEntityChanged<T extends object>(previous: T, next: T): boolean {
  const keys = new Set([...Object.keys(previous as object), ...Object.keys(next as object)]);
  for (const key of keys) {
    if (key === "records" || key === "communications" || key === "checks" || key === "effects") continue;
    const prevValue = (previous as Record<string, unknown>)[key];
    const nextValue = (next as Record<string, unknown>)[key];
    if (JSON.stringify(prevValue) !== JSON.stringify(nextValue)) return true;
  }
  return false;
}
