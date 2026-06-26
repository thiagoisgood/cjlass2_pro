import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { AgentGatewayService } from "../src/core/agent-gateway.service.js";
import { AuthService } from "../src/core/auth.service.js";
import { CoreService } from "../src/core/core.service.js";
import { JsonStateStore } from "../src/core/json-state.store.js";
import { NotificationQueueService } from "../src/core/notification-queue.service.js";
import { assertScope, defaultRequestContext, requestContextFromHeaders } from "../src/core/request-context.js";

test("attendance deducts exactly one lesson hour and writes audit", async () => {
  const service = new CoreService(new JsonStateStore());
  const before = await service.snapshot();
  const studentBefore = before.students.find((student) => student.id === "stu-zhang");
  const after = await service.markAttendance({ lessonId: "lesson-2", status: "已到课" });
  const studentAfter = after.students.find((student) => student.id === "stu-zhang");
  assert.equal(studentAfter?.remainingHours, (studentBefore?.remainingHours ?? 0) - 1);
  assert.equal(after.auditLogs[0].action, "点名与课消");
  assert.equal(after.lessonLedgerEntries[0].lessonId, "lesson-2");
  assert.equal(after.lessonLedgerEntries[0].entryType, "deduct");
  assert.equal(after.lessonLedgerEntries[0].hoursDelta, -1);
});

test("lesson read model is aggregated from ledger entries", async () => {
  const service = new CoreService(new JsonStateStore());
  const before = await service.snapshot();
  const seedStudent = before.students.find((student) => student.id === "stu-zhang");
  const seedLedgerDelta = before.lessonLedgerEntries
    .filter((entry) => entry.studentId === "stu-zhang")
    .reduce((sum, entry) => sum + entry.hoursDelta, 0);
  assert.equal(seedStudent?.baseRemainingHours, 13);
  assert.equal(seedLedgerDelta, -1);
  assert.equal(seedStudent?.remainingHours, 12);
  assert.match(before.lessons.find((lesson) => lesson.id === "lesson-2")?.remaining ?? "", /^12 \//);

  const attended = await service.markAttendance({ lessonId: "lesson-2", status: "已到课" });
  const attendedStudent = attended.students.find((student) => student.id === "stu-zhang");
  assert.equal(attendedStudent?.baseRemainingHours, 13);
  assert.equal(attendedStudent?.remainingHours, 11);
  assert.match(attended.lessons.find((lesson) => lesson.id === "lesson-2")?.remaining ?? "", /^11 \//);

  const summary = await service.lessonLedgerSummary();
  const row = summary.find((item) => item.studentId === "stu-zhang");
  assert.equal(row?.baseRemainingHours, 13);
  assert.equal(row?.ledgerDelta, -2);
  assert.equal(row?.remainingHours, 11);
  assert.equal(row?.entries, 2);
});

test("payment settlement never deletes order history", async () => {
  const service = new CoreService(new JsonStateStore());
  const after = await service.recordPayment("order-1");
  const order = after.orders.find((item) => item.id === "order-1");
  assert.equal(order?.status, "已结清");
  assert.equal(order?.paid, order?.amount);
  assert.equal(after.orders.length >= 1, true);
  assert.equal(after.paymentLedgerEntries[0].orderId, "order-1");
  assert.equal(after.paymentLedgerEntries[0].entryType, "payment");
  assert.equal(after.paymentLedgerEntries[0].amountDelta, 1680);
});

test("payment correction appends a refund ledger instead of deleting history", async () => {
  const service = new CoreService(new JsonStateStore());
  const paid = await service.recordPayment("order-1");
  const paymentEntry = paid.paymentLedgerEntries[0];
  const corrected = await service.reversePaymentLedgerEntry(paymentEntry.id, { reason: "家长申请退款冲销" });
  const reversal = corrected.paymentLedgerEntries[0];
  const order = corrected.orders.find((item) => item.id === "order-1");
  assert.equal(reversal.entryType, "refund");
  assert.equal(reversal.amountDelta, -paymentEntry.amountDelta);
  assert.equal(reversal.reversesEntryId, paymentEntry.id);
  assert.equal(order?.paid, paid.orders.find((item) => item.id === "order-1")!.paid - paymentEntry.amountDelta);
  assert.equal(corrected.paymentLedgerEntries.some((item) => item.id === paymentEntry.id), true);
  await assert.rejects(
    () => service.reversePaymentLedgerEntry(paymentEntry.id, { reason: "重复冲销" }),
    /already reversed/,
  );
});

test("payment read model is aggregated from ledger entries", async () => {
  const service = new CoreService(new JsonStateStore());
  const before = await service.snapshot();
  const seedOrder = before.orders.find((item) => item.id === "order-1");
  const seedLedgerTotal = before.paymentLedgerEntries
    .filter((entry) => entry.orderId === "order-1")
    .reduce((sum, entry) => sum + entry.amountDelta, 0);
  assert.equal(seedOrder?.paid, seedLedgerTotal);

  const created = await service.createOrder({ studentId: "stu-zhang", name: "阅读专项 5课时", amount: 1000, paid: 300, channel: "银行转账" });
  const order = created.orders[0];
  const ledgerTotal = created.paymentLedgerEntries
    .filter((entry) => entry.orderId === order.id)
    .reduce((sum, entry) => sum + entry.amountDelta, 0);
  assert.equal(order.paid, 300);
  assert.equal(ledgerTotal, 300);
  assert.equal(order.status, "部分已付");

  const summary = await service.paymentLedgerSummary();
  const row = summary.find((item) => item.orderId === order.id);
  assert.equal(row?.paidFromLedger, 300);
  assert.equal(row?.outstanding, 700);
});

test("lesson correction appends a restore ledger instead of deleting history", async () => {
  const service = new CoreService(new JsonStateStore());
  const attended = await service.markAttendance({ lessonId: "lesson-2", status: "已到课" });
  const deduction = attended.lessonLedgerEntries[0];
  const beforeStudent = attended.students.find((item) => item.id === deduction.studentId);
  const corrected = await service.reverseLessonLedgerEntry(deduction.id, { reason: "误点名恢复课时" });
  const reversal = corrected.lessonLedgerEntries[0];
  const afterStudent = corrected.students.find((item) => item.id === deduction.studentId);
  assert.equal(reversal.entryType, "restore");
  assert.equal(reversal.hoursDelta, -deduction.hoursDelta);
  assert.equal(reversal.reversesEntryId, deduction.id);
  assert.equal(afterStudent?.remainingHours, (beforeStudent?.remainingHours ?? 0) - deduction.hoursDelta);
  assert.equal(corrected.lessonLedgerEntries.some((item) => item.id === deduction.id), true);
  await assert.rejects(
    () => service.reverseLessonLedgerEntry(deduction.id, { reason: "重复恢复" }),
    /already reversed/,
  );
});

test("reports aggregate from ledgers and attendance records instead of fixed constants", async () => {
  const service = new CoreService(new JsonStateStore());
  const seed = await service.reports();
  assert.equal(seed.income, 6780);
  assert.equal(seed.consumedLessons, 2);
  assert.equal(seed.attendanceRate, 66.7);
  assert.deepEqual(seed.incomeTrend, [1920, 3120, 1740]);
  assert.deepEqual(seed.teacherPayroll, []);

  await service.markAttendance({ lessonId: "lesson-2", status: "已到课" });
  const afterAttendance = await service.reports();
  assert.equal(afterAttendance.consumedLessons, 3);
  assert.equal(afterAttendance.attendanceRate, 75);
  assert.deepEqual(afterAttendance.teacherPayroll, [{ teacher: "王老师", lessons: 1, pay: 180 }]);

  const created = await service.createOrder({ studentId: "stu-zhang", name: "阅读专项 5课时", amount: 1000, paid: 300, channel: "银行转账" });
  const createdOrder = created.orders[0];
  const afterOrder = await service.reports();
  assert.equal(afterOrder.income, 7080);
  assert.equal(afterOrder.incomeTrend.at(-1), 300);

  const paidEntry = created.paymentLedgerEntries.find((entry) => entry.orderId === createdOrder.id);
  assert.ok(paidEntry);
  await service.reversePaymentLedgerEntry(paidEntry.id, { reason: "测试冲销" });
  const afterReversal = await service.reports();
  assert.equal(afterReversal.income, 6780);
});

test("schedule proposal is confirmed through business task", async () => {
  const service = new CoreService(new JsonStateStore());
  const proposed = await service.proposeSchedule({ text: "把张子涵的英语课调到明天上午", source: "web" });
  const task = proposed.tasks[0];
  assert.equal(task.status, "等待确认");
  const confirmed = await service.confirmTask(task.id);
  assert.equal(confirmed.tasks.find((item) => item.id === task.id)?.status, "执行成功");
  assert.equal(confirmed.notifications.slice(0, 2).every((note) => note.status === "草稿"), true);
});

test("lesson creation rejects teacher room or student schedule conflicts", async () => {
  const service = new CoreService(new JsonStateStore());
  await assert.rejects(
    () => service.createLesson({
      studentId: "stu-li",
      date: "05/08",
      day: 2,
      start: "09:30",
      end: "10:30",
      teacher: "王老师",
      room: "教室A",
      title: "冲突测试课",
    }),
    /Schedule conflict.*教师冲突.*教室冲突/s,
  );
});

test("schedule proposal exposes conflicts and confirmation rechecks before writing", async () => {
  const service = new CoreService(new JsonStateStore());
  await service.createLesson({
    studentId: "stu-li",
    date: "05/08",
    day: 2,
    start: "10:45",
    end: "11:15",
    teacher: "王老师",
    room: "教室D",
    title: "目标时段占用",
  });
  const proposed = await service.proposeSchedule({ text: "把张子涵的英语课调到明天上午", lessonId: "lesson-2", source: "web" });
  const task = proposed.tasks[0];
  assert.equal(task.checks.find((check) => check.label === "教师可用")?.ok, false);
  assert.match(task.effects.join(" "), /教师冲突/);
  await assert.rejects(
    () => service.confirmTask(task.id, { expectedVersion: task.expectedVersion }),
    /unresolved checks/,
  );
});

test("idempotency key replays the same payment response without duplicating ledger entries", async () => {
  const service = new CoreService(new JsonStateStore());
  const first = await service.recordPayment("order-1", { idempotencyKey: "payment-order-1" });
  const second = await service.recordPayment("order-1", { idempotencyKey: "payment-order-1" });
  assert.equal(second.paymentLedgerEntries.length, first.paymentLedgerEntries.length);
  assert.equal(second.paymentLedgerEntries[0].id, first.paymentLedgerEntries[0].id);
});

test("idempotency key rejects a different request payload", async () => {
  const service = new CoreService(new JsonStateStore());
  await service.markAttendance({ lessonId: "lesson-2", status: "已到课" }, { idempotencyKey: "attendance-once" });
  await assert.rejects(
    () => service.markAttendance({ lessonId: "lesson-3", status: "已到课" }, { idempotencyKey: "attendance-once" }),
    /Idempotency key already used/,
  );
});

test("business task confirmation checks expected version", async () => {
  const service = new CoreService(new JsonStateStore());
  const proposed = await service.proposeSchedule({ text: "把张子涵的英语课调到明天上午", source: "web" });
  const task = proposed.tasks[0];
  await assert.rejects(
    () => service.confirmTask(task.id, { expectedVersion: task.expectedVersion + 1 }),
    /version conflict/,
  );
});

test("notification delivery records failed external sends and retry state", async () => {
  const previousWechat = process.env.WECHAT_H5_APP_ID;
  const previousRedis = process.env.REDIS_URL;
  delete process.env.WECHAT_H5_APP_ID;
  delete process.env.REDIS_URL;
  try {
    const queue = new NotificationQueueService();
    const service = new CoreService(new JsonStateStore(), queue);
    const sent = await service.sendNotification("note-1");
    const note = sent.notifications.find((item) => item.id === "note-1");
    assert.equal(note?.status, "发送失败");
    assert.equal(sent.notificationDeliveries[0].notificationId, "note-1");
    assert.equal(sent.notificationDeliveries[0].status, "failed");
    assert.match(sent.notificationDeliveries[0].errorMessage ?? "", /未连接|环境变量/);

    const retried = await service.retryNotificationDelivery(sent.notificationDeliveries[0].id);
    assert.equal(retried.notificationDeliveries[0].status, "retry");
    assert.equal(retried.notificationDeliveries[0].attempts, 2);
    assert.ok(retried.notificationDeliveries[0].nextRetryAt);
    assert.equal(queue.getMemoryJobs()[0].action, "retry");
    assert.equal(queue.getMemoryJobs()[0].deliveryId, sent.notificationDeliveries[0].id);
  } finally {
    if (previousWechat == null) {
      delete process.env.WECHAT_H5_APP_ID;
    } else {
      process.env.WECHAT_H5_APP_ID = previousWechat;
    }
    if (previousRedis == null) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedis;
    }
  }
});

test("configured external notification channels enqueue async delivery jobs", async () => {
  const previousWechat = process.env.WECHAT_H5_APP_ID;
  const previousRedis = process.env.REDIS_URL;
  process.env.WECHAT_H5_APP_ID = "wechat-app-for-test";
  delete process.env.REDIS_URL;
  try {
    const queue = new NotificationQueueService();
    const service = new CoreService(new JsonStateStore(), queue);
    const sent = await service.sendNotification("note-1");
    const note = sent.notifications.find((item) => item.id === "note-1");
    assert.equal(note?.status, "待发送");
    assert.equal(note?.sentRate, "队列中");
    assert.equal(sent.notificationDeliveries[0].status, "queued");
    assert.equal(queue.getMemoryJobs().length, 1);
    assert.equal(queue.getMemoryJobs()[0].action, "send");
    assert.equal(queue.getMemoryJobs()[0].notificationId, "note-1");
  } finally {
    if (previousWechat == null) {
      delete process.env.WECHAT_H5_APP_ID;
    } else {
      process.env.WECHAT_H5_APP_ID = previousWechat;
    }
    if (previousRedis == null) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedis;
    }
  }
});

test("notification queue reports memory fallback when redis is not configured", async () => {
  const previousRedis = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    const queue = new NotificationQueueService();
    const service = new CoreService(new JsonStateStore(), queue);
    await service.scheduleNotification("note-2", "2026-06-26 09:00");
    assert.deepEqual(service.notificationQueueStatus(), {
      backend: "memory",
      redisConfigured: false,
      redisUnavailable: false,
      memoryDepth: 1,
      stream: "cjlass2:notification_jobs",
    });
  } finally {
    if (previousRedis == null) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedis;
    }
  }
});

test("notification worker sends queued jobs through the controlled provider", async () => {
  const previousWechat = process.env.WECHAT_H5_APP_ID;
  const previousRedis = process.env.REDIS_URL;
  const previousProviderMode = process.env.NOTIFICATION_PROVIDER_MODE;
  process.env.WECHAT_H5_APP_ID = "wechat-app-for-test";
  process.env.NOTIFICATION_PROVIDER_MODE = "mock";
  delete process.env.REDIS_URL;
  try {
    const queue = new NotificationQueueService();
    const service = new CoreService(new JsonStateStore(), queue);
    const queued = await service.sendNotification("note-1");
    assert.equal(queued.notificationDeliveries[0].status, "queued");

    const result = await service.processNotificationQueue();
    assert.deepEqual(result, { processed: 1, sent: 1, failed: 0, retried: 0 });
    const snapshot = await service.snapshot();
    assert.equal(snapshot.notificationDeliveries[0].status, "sent");
    assert.match(snapshot.notificationDeliveries[0].providerMessageId ?? "", /^mock-/);
    assert.equal(snapshot.notifications.find((item) => item.id === "note-1")?.status, "已发送");
    assert.equal(service.notificationQueueStatus().memoryDepth, 0);
  } finally {
    restoreEnv("WECHAT_H5_APP_ID", previousWechat);
    restoreEnv("REDIS_URL", previousRedis);
    restoreEnv("NOTIFICATION_PROVIDER_MODE", previousProviderMode);
  }
});

test("notification worker claims due jobs from redis streams", async () => {
  const previousWechat = process.env.WECHAT_H5_APP_ID;
  const previousRedis = process.env.REDIS_URL;
  const previousProviderMode = process.env.NOTIFICATION_PROVIDER_MODE;
  process.env.WECHAT_H5_APP_ID = "wechat-app-for-test";
  process.env.REDIS_URL = "redis://fake-local-test";
  process.env.NOTIFICATION_PROVIDER_MODE = "mock";
  try {
    const streamRows: Array<{ id: string; message: Record<string, string> }> = [];
    const fakeRedis = {
      isOpen: true,
      async connect() {},
      async quit() {},
      async xAdd(_key: string, _id: string, message: Record<string, string>) {
        const id = `${streamRows.length + 1}-0`;
        streamRows.push({ id, message });
        return id;
      },
      async xRange(_key: string, _start: string, _end: string, options?: { COUNT?: number }) {
        return streamRows.slice(0, options?.COUNT ?? streamRows.length);
      },
      async xDel(_key: string, id: string | string[]) {
        const ids = new Set(Array.isArray(id) ? id : [id]);
        const before = streamRows.length;
        for (let index = streamRows.length - 1; index >= 0; index -= 1) {
          if (ids.has(streamRows[index].id)) {
            streamRows.splice(index, 1);
          }
        }
        return before - streamRows.length;
      },
    };
    const queue = new NotificationQueueService();
    (queue as unknown as { redisClient: typeof fakeRedis }).redisClient = fakeRedis;
    const service = new CoreService(new JsonStateStore(), queue);
    const queued = await service.sendNotification("note-1");
    assert.equal(queued.notificationDeliveries[0].status, "queued");
    assert.equal(queue.getMemoryJobs().length, 0);
    assert.equal(streamRows.length, 1);
    assert.equal(service.notificationQueueStatus().backend, "redis");

    const result = await service.processNotificationQueue();
    assert.deepEqual(result, { processed: 1, sent: 1, failed: 0, retried: 0 });
    assert.equal(streamRows.length, 0);
    const snapshot = await service.snapshot();
    assert.equal(snapshot.notificationDeliveries[0].status, "sent");
    assert.match(snapshot.notificationDeliveries[0].providerMessageId ?? "", /^mock-/);
  } finally {
    restoreEnv("WECHAT_H5_APP_ID", previousWechat);
    restoreEnv("REDIS_URL", previousRedis);
    restoreEnv("NOTIFICATION_PROVIDER_MODE", previousProviderMode);
  }
});

test("notification worker requeues provider failures for retry", async () => {
  const previousWechat = process.env.WECHAT_H5_APP_ID;
  const previousRedis = process.env.REDIS_URL;
  const previousProviderMode = process.env.NOTIFICATION_PROVIDER_MODE;
  process.env.WECHAT_H5_APP_ID = "wechat-app-for-test";
  delete process.env.NOTIFICATION_PROVIDER_MODE;
  delete process.env.REDIS_URL;
  try {
    const queue = new NotificationQueueService();
    const service = new CoreService(new JsonStateStore(), queue);
    await service.sendNotification("note-1");

    const result = await service.processNotificationQueue();
    assert.deepEqual(result, { processed: 1, sent: 0, failed: 0, retried: 1 });
    const snapshot = await service.snapshot();
    assert.equal(snapshot.notificationDeliveries[0].status, "retry");
    assert.match(snapshot.notificationDeliveries[0].errorMessage ?? "", /webhook/);
    assert.equal(service.notificationQueueStatus().memoryDepth, 1);
  } finally {
    restoreEnv("WECHAT_H5_APP_ID", previousWechat);
    restoreEnv("REDIS_URL", previousRedis);
    restoreEnv("NOTIFICATION_PROVIDER_MODE", previousProviderMode);
  }
});

test("notification scheduling creates a scheduled delivery record", async () => {
  const previousRedis = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    const queue = new NotificationQueueService();
    const service = new CoreService(new JsonStateStore(), queue);
    const scheduled = await service.scheduleNotification("note-2", "2026-06-26 09:00");
    const note = scheduled.notifications.find((item) => item.id === "note-2");
    assert.equal(note?.status, "预约发送");
    assert.equal(note?.scheduledFor, "2026-06-26 09:00");
    assert.equal(scheduled.notificationDeliveries[0].notificationId, "note-2");
    assert.equal(scheduled.notificationDeliveries[0].status, "scheduled");
    assert.equal(scheduled.notificationDeliveries[0].scheduledFor, "2026-06-26 09:00");
    assert.equal(queue.getMemoryJobs()[0].action, "scheduled_send");
    assert.equal(queue.getMemoryJobs()[0].runAt, "2026-06-26 09:00");
  } finally {
    if (previousRedis == null) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedis;
    }
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value == null) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test("request context enforces auth token and RBAC scopes", () => {
  const previousToken = process.env.API_AUTH_TOKEN;
  process.env.API_AUTH_TOKEN = "secret-token";
  try {
    assert.throws(() => requestContextFromHeaders({}), /bearer token/);
    const readonly = requestContextFromHeaders({ authorization: "Bearer secret-token", "x-user-role": "readonly" });
    assert.equal(readonly.role, "readonly");
    assert.throws(() => assertScope(readonly, "write:payments"), /Missing required scope/);
    const finance = requestContextFromHeaders({ authorization: "Bearer secret-token", "x-user-role": "finance" });
    assert.doesNotThrow(() => assertScope(finance, "write:payments"));
  } finally {
    if (previousToken == null) {
      delete process.env.API_AUTH_TOKEN;
    } else {
      process.env.API_AUTH_TOKEN = previousToken;
    }
  }
});

test("local admin can login and use the signed session token as request context", async () => {
  const auth = new AuthService(new JsonStateStore());
  const session = await auth.login({ email: "admin@cjlass.local", password: "ChangeMe123!" });
  assert.equal(session.user.role, "admin");
  assert.match(session.token, /^v1\./);
  const loadedUser = await auth.sessionFromToken(session.token);
  assert.equal(loadedUser.userId, "user-lin");
  const context = requestContextFromHeaders({ authorization: `Bearer ${session.token}` });
  assert.equal(context.userId, "user-lin");
  assert.equal(context.actorName, "林老师");
  assert.doesNotThrow(() => assertScope(context, "write:payments"));
});

test("postgres schema uses normalized production tables instead of app_state snapshots", () => {
  const schema = readFileSync(new URL("../../../../infra/postgres/init.sql", import.meta.url), "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS schema_migrations\b/);
  assert.match(schema, /INSERT INTO schema_migrations \(version, name, checksum\)/);
  assert.match(schema, /VALUES \(1, 'initial_core_schema', '[a-f0-9]{64}'\)/);
  assert.match(schema, /VALUES \(2, 'notification_delivery_state_machine', '[a-f0-9]{64}'\)/);
  for (const table of [
    "tenants",
    "users",
    "students",
    "student_records",
    "lessons",
    "lesson_ledger_entries",
    "orders",
    "payment_ledger_entries",
    "notification_drafts",
    "notification_deliveries",
    "business_tasks",
    "audit_logs",
    "knowledge_docs",
    "knowledge_chunks",
    "channel_integrations",
    "agent_runs",
    "idempotency_keys",
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS app_state\b/);
  assert.match(schema, /ALTER TABLE students ENABLE ROW LEVEL SECURITY/);
  assert.match(schema, /ALTER TABLE students FORCE ROW LEVEL SECURITY/);
  assert.match(schema, /CREATE POLICY tenant_isolation_students ON students USING \(tenant_id = current_setting\('app\.tenant_id', true\)\)/);
  assert.match(schema, /CREATE POLICY tenant_isolation_tenants ON tenants USING \(id = current_setting\('app\.tenant_id', true\)\)/);
});

test("postgres store keeps tenant writes inside a transaction context", () => {
  const storeSource = readFileSync(new URL("../../src/core/json-state.store.ts", import.meta.url), "utf8");
  assert.match(storeSource, /POSTGRES_SCHEMA_VERSION = 4/);
  assert.match(storeSource, /POSTGRES_SCHEMA_CHECKSUM = "[a-f0-9]{64}"/);
  assert.match(storeSource, /assertPostgresSchemaVersion/);
  assert.match(storeSource, /schema version mismatch/);
  assert.match(storeSource, /AsyncLocalStorage/);
  assert.match(storeSource, /set_config\('app\.tenant_id'/);
  assert.match(storeSource, /FOR UPDATE/);
  assert.match(storeSource, /transactionContext\.run/);
});

test("postgres store runs ordered migration files instead of replaying init snapshot", () => {
  const migrationDir = new URL("../../../../infra/postgres/migrations/", import.meta.url);
  const migrationFiles = readdirSync(migrationDir).sort();
  assert.deepEqual(migrationFiles, [
    "0001_initial_core_schema.sql",
    "0002_notification_delivery_state_machine.sql",
    "0003_agent_tool_calls_and_approvals.sql",
    "0004_mvp_business_objects_and_channels.sql",
  ]);
  const initialMigration = readFileSync(new URL("0001_initial_core_schema.sql", migrationDir), "utf8");
  const deliveryMigration = readFileSync(new URL("0002_notification_delivery_state_machine.sql", migrationDir), "utf8");
  const agentMigration = readFileSync(new URL("0003_agent_tool_calls_and_approvals.sql", migrationDir), "utf8");
  const mvpMigration = readFileSync(new URL("0004_mvp_business_objects_and_channels.sql", migrationDir), "utf8");
  assert.match(initialMigration, /CREATE TABLE IF NOT EXISTS tenants\b/);
  assert.doesNotMatch(initialMigration, /INSERT INTO schema_migrations \(version, name, checksum\)/);
  assert.doesNotMatch(initialMigration, /scheduled_for_text TEXT/);
  assert.match(deliveryMigration, /ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS scheduled_for_text TEXT/);
  assert.match(agentMigration, /CREATE TABLE IF NOT EXISTS agent_tool_calls/);
  assert.match(agentMigration, /CREATE TABLE IF NOT EXISTS agent_approvals/);
  for (const table of [
    "households",
    "household_members",
    "teachers",
    "course_packages",
    "student_package_accounts",
    "invoices",
    "refunds",
    "financial_ledger_entries",
    "payroll_rules",
    "payroll_records",
    "learning_records",
    "documents",
    "channel_accounts",
    "channel_messages",
  ]) {
    assert.match(mvpMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
    assert.match(mvpMigration, new RegExp(`tenant_isolation_${table}`));
  }

  const storeSource = readFileSync(new URL("../../src/core/json-state.store.ts", import.meta.url), "utf8");
  assert.match(storeSource, /runPostgresMigrations/);
  assert.match(storeSource, /loadPostgresMigrations/);
  assert.match(storeSource, /sha256/);
  assert.match(storeSource, /migration checksum mismatch/);
  assert.doesNotMatch(storeSource, /loadPostgresSchema/);
});

test("core service exposes an env-gated notification queue worker", () => {
  const serviceSource = readFileSync(new URL("../../src/core/core.service.ts", import.meta.url), "utf8");
  assert.match(serviceSource, /NOTIFICATION_WORKER_ENABLED/);
  assert.match(serviceSource, /processNotificationQueueSafely/);
  assert.match(serviceSource, /setInterval/);
  assert.match(serviceSource, /notificationWorkerRunning/);
});

test("user management: create, list, update, and reset password", async () => {
  const service = new CoreService(new JsonStateStore());
  const context = defaultRequestContext();

  const created = await service.createUser(
    { email: "teacher@example.com", password: "Test1234!", displayName: "张老师", role: "teacher" },
    context,
  );
  assert.equal(created.email, "teacher@example.com");
  assert.equal(created.displayName, "张老师");
  assert.equal(created.role, "teacher");

  const users = await service.listUsers("tenant-xiaozhi");
  assert.ok(users.length >= 2);
  assert.ok(users.some((user) => user.email === "teacher@example.com"));

  const updated = await service.updateUser(created.userId, { displayName: "张主任", role: "admin" }, context);
  assert.equal(updated.displayName, "张主任");
  assert.equal(updated.role, "admin");

  const reset = await service.resetUserPassword(created.userId, "NewPass5678!", context);
  assert.equal(reset.email, "teacher@example.com");
});

test("knowledge docs: create, search, and delete", async () => {
  const service = new CoreService(new JsonStateStore());
  const context = defaultRequestContext();

  const before = await service.snapshot();
  const beforeCount = before.ragDocs.length;

  const created = await service.createKnowledgeDoc(
    { title: "英语口语测试标准", scope: "课程知识库", content: "这是一份关于英语口语测试的标准文档，包含评分细则和考试流程。" },
    context,
  );
  assert.equal(created.ragDocs[0].title, "英语口语测试标准");
  assert.equal(created.ragDocs.length, beforeCount + 1);
  assert.equal(created.knowledgeChunks[0].docId, created.ragDocs[0].id);
  assert.match(created.knowledgeChunks[0].content, /评分细则/);

  const searchResult = await service.searchKnowledge("评分细则", 10, context);
  assert.equal(searchResult.results.length >= 1, true);
  assert.ok(searchResult.results.some((doc) => doc.title === "英语口语测试标准"));
  assert.match(searchResult.results[0].excerpt, /评分细则/);
  assert.equal(searchResult.results[0].sources[0].docId, created.ragDocs[0].id);

  const deleted = await service.deleteKnowledgeDoc(created.ragDocs[0].id, context);
  assert.equal(deleted.ragDocs.length, beforeCount);
  assert.ok(!deleted.ragDocs.some((doc) => doc.title === "英语口语测试标准"));
  assert.ok(!deleted.knowledgeChunks.some((chunk) => chunk.docId === created.ragDocs[0].id));
});

test("channel callback verifies signature, deduplicates messages, and creates business tasks", async () => {
  const previousSecret = process.env.WECOM_CALLBACK_SECRET;
  process.env.WECOM_CALLBACK_SECRET = "channel-secret";
  try {
    const service = new CoreService(new JsonStateStore());
    const payload = {
      channel: "wecom" as const,
      messageId: "wecom-msg-1",
      fromUser: "teacher-wang",
      text: "把张子涵的英语课调到明天上午",
      timestamp: "2026-06-26T08:00:00Z",
      nonce: "nonce-1",
    };
    const signature = createHmac("sha256", "channel-secret")
      .update(["wecom", payload.timestamp, payload.nonce, payload.messageId, payload.fromUser, payload.text, "", ""].join("\n"))
      .digest("hex");

    const result = await service.handleChannelCallback({ ...payload, signature }, defaultRequestContext());
    assert.equal(result.accepted, true);
    assert.equal(result.duplicate, false);
    assert.ok(result.taskId);

    const snapshot = await service.snapshot();
    assert.equal(snapshot.channelAccounts.some((account) => account.externalUserId === "teacher-wang"), true);
    assert.equal(snapshot.channelMessages[0].status, "processed");
    assert.equal(snapshot.tasks[0].id, result.taskId);

    const duplicate = await service.handleChannelCallback({ ...payload, signature }, defaultRequestContext());
    assert.equal(duplicate.duplicate, true);
    assert.equal((await service.snapshot()).channelMessages.filter((message) => message.messageId === payload.messageId).length, 1);

    await assert.rejects(
      () => service.handleChannelCallback({ ...payload, messageId: "wecom-msg-2", signature: "bad" }, defaultRequestContext()),
      /Invalid channel callback signature/,
    );
  } finally {
    restoreEnv("WECOM_CALLBACK_SECRET", previousSecret);
  }
});

test("agent runs: create and track execution", async () => {
  const service = new CoreService(new JsonStateStore());
  const context = defaultRequestContext();

  const before = await service.snapshot();
  const beforeCount = before.agentRuns.length;

  const created = await service.createAgentRun({ task: "生成续费提醒通知", toolCalls: 3 }, context);
  assert.equal(created.agentRuns.length, beforeCount + 1);
  assert.equal(created.agentRuns[0].task, "生成续费提醒通知");
  assert.equal(created.agentRuns[0].toolCalls, 3);
  assert.equal(created.agentRuns[0].status, "完成");
});

test("channel integrations: create and update status", async () => {
  const service = new CoreService(new JsonStateStore());
  const context = defaultRequestContext();

  const created = await service.createChannelIntegration(
    { name: "测试企微通道", type: "wecom", description: "用于内部通知测试" },
    context,
  );
  const newChannel = created.channelIntegrations.find((c) => c.name === "测试企微通道");
  assert.ok(newChannel);
  assert.equal(newChannel?.status, "not_configured");

  const updated = await service.updateChannelIntegration(newChannel!.id, { status: "connected", description: "已激活" }, context);
  const updatedChannel = updated.channelIntegrations.find((c) => c.id === newChannel!.id);
  assert.equal(updatedChannel?.status, "connected");
  assert.equal(updatedChannel?.description, "已激活");
});

test("full business flow: create student, order, schedule, attendance, payment, notification", async () => {
  const service = new CoreService(new JsonStateStore());

  // 1. Create a new student
  const afterStudent = await service.createStudent({
    name: "测试学生",
    grade: "三年级",
    teacher: "王老师",
    teacherCourse: "英语",
    remainingHours: 10,
  });
  const newStudent = afterStudent.students.find((s) => s.name === "测试学生");
  assert.ok(newStudent);
  assert.equal(newStudent?.remainingHours, 10);

  // 2. Create an order for the student
  const afterOrder = await service.createOrder({
    studentId: newStudent!.id,
    name: "英语 10课时包",
    amount: 2000,
    paid: 500,
    channel: "微信支付",
  });
  const newOrder = afterOrder.orders[0];
  assert.equal(newOrder.amount, 2000);
  assert.equal(newOrder.paid, 500);
  assert.equal(newOrder.status, "部分已付");

  // 3. Create a lesson
  const afterLesson = await service.createLesson({
    studentId: newStudent!.id,
    date: "06/25",
    day: 2,
    start: "14:00",
    end: "15:00",
    teacher: "王老师",
    room: "教室D",
    title: "英语测试课",
    type: "一对一",
  });
  const newLesson = afterLesson.lessons.find((l) => l.title === "英语测试课");
  assert.ok(newLesson);

  // 4. Mark attendance (should deduct 1 hour)
  const afterAttendance = await service.markAttendance({ lessonId: newLesson!.id, status: "已到课" });
  const afterStudent2 = afterAttendance.students.find((s) => s.id === newStudent!.id);
  assert.equal(afterStudent2?.remainingHours, 9);

  // 5. Record full payment
  const afterPayment = await service.recordPayment(newOrder.id);
  const paidOrder = afterPayment.orders.find((o) => o.id === newOrder.id);
  assert.equal(paidOrder?.status, "已结清");

  // 6. Create and send a notification
  const afterNote = await service.createNotification({
    type: "课后反馈",
    title: "测试课后反馈",
    recipient: "测试学生家长",
    channel: "站内",
  });
  const noteId = afterNote.notifications[0].id;
  const afterSend = await service.sendNotification(noteId);
  const sentNote = afterSend.notifications.find((n) => n.id === noteId);
  assert.equal(sentNote?.status, "已发送");

  // 7. Verify audit log has all operations
  const auditActions = afterSend.auditLogs.map((log) => log.action);
  assert.ok(auditActions.includes("创建学员"));
  assert.ok(auditActions.includes("创建订单"));
  assert.ok(auditActions.includes("新增课程"));
  assert.ok(auditActions.includes("点名与课消"));
  assert.ok(auditActions.includes("记录收款"));
  assert.ok(auditActions.includes("创建通知草稿"));
});

test("store exposes isDatabaseMode and saveIncremental methods", () => {
  const store = new JsonStateStore();
  assert.equal(store.isDatabaseMode(), false);
  assert.equal(typeof store.saveIncremental, "function");
  assert.equal(typeof store.listUsers, "function");
  assert.equal(typeof store.createUser, "function");
  assert.equal(typeof store.updateUser, "function");
});

test("core service uses incremental writes in DB mode and full replace in memory mode", () => {
  const serviceSource = readFileSync(new URL("../../src/core/core.service.ts", import.meta.url), "utf8");
  assert.match(serviceSource, /saveWithAudit.*previous/);
  assert.match(serviceSource, /isDatabaseMode\(\)/);
  assert.match(serviceSource, /saveIncremental\(previous/);
});

test("controller exposes user management and knowledge endpoints", () => {
  const controllerSource = readFileSync(new URL("../../src/core/core.controller.ts", import.meta.url), "utf8");
  assert.match(controllerSource, /@Get\("users"\)/);
  assert.match(controllerSource, /@Post\("users"\)/);
  assert.match(controllerSource, /@Patch\("users\/:id"\)/);
  assert.match(controllerSource, /@Post\("users\/:id\/reset-password"\)/);
  assert.match(controllerSource, /@Post\("knowledge-docs"\)/);
  assert.match(controllerSource, /@Delete\("knowledge-docs\/:id"\)/);
  assert.match(controllerSource, /@Post\("knowledge-docs\/:id\/search"\)/);
  assert.match(controllerSource, /@Post\("agent-runs"\)/);
  assert.match(controllerSource, /@Post\("channel-integrations"\)/);
  assert.match(controllerSource, /@Patch\("channel-integrations\/:id"\)/);
});

test("periodic lessons: generate weekly recurring schedule", async () => {
  const service = new CoreService(new JsonStateStore());
  const before = await service.snapshot();
  const beforeCount = before.lessons.length;

  const result = await service.createPeriodicLessons({
    studentId: "stu-zhang",
    teacher: "王老师",
    room: "教室E",
    title: "英语周期课",
    dayOfWeek: 3,
    startTime: "16:00",
    endTime: "17:00",
    startDate: "2026-07-01",
    weeks: 4,
    price: 200,
  });

  const newLessons = result.lessons.filter((l) => l.title === "英语周期课");
  assert.equal(newLessons.length, 4);
  assert.equal(newLessons.every((l) => l.teacher === "王老师"), true);
  assert.equal(newLessons.every((l) => l.room === "教室E"), true);
  assert.equal(newLessons.every((l) => l.start === "16:00"), true);
});

test("batch schedule: create multiple lessons in one transaction", async () => {
  const service = new CoreService(new JsonStateStore());
  const before = await service.snapshot();
  const beforeCount = before.lessons.length;

  const result = await service.batchSchedule([
    { studentId: "stu-zhang", date: "07/01", day: 3, start: "08:00", end: "09:00", teacher: "王老师", room: "教室F", title: "批量课1" },
    { studentId: "stu-li", date: "07/01", day: 3, start: "10:00", end: "11:00", teacher: "李老师", room: "教室B", title: "批量课2" },
  ]);

  assert.equal(result.lessons.length, beforeCount + 2);
  assert.ok(result.lessons.some((l) => l.title === "批量课1"));
  assert.ok(result.lessons.some((l) => l.title === "批量课2"));
});

test("teacher availability shows booked time slots", async () => {
  const service = new CoreService(new JsonStateStore());
  const availability = await service.teacherAvailability("王老师");
  assert.ok(availability.lessons.length > 0);
  assert.equal(availability.teacher, "王老师");
  assert.equal(availability.lessons.every((l) => l.start && l.end), true);
});

test("room availability shows booked time slots", async () => {
  const service = new CoreService(new JsonStateStore());
  const availability = await service.roomAvailability("教室A");
  assert.ok(availability.lessons.length > 0);
  assert.equal(availability.room, "教室A");
});

test("agent gateway: list MCP tools", async () => {
  const store = new JsonStateStore();
  const agentGateway = new AgentGatewayService(store, new CoreService(store));
  await agentGateway.onModuleInit();

  const tools = agentGateway.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "student_search",
    "student_get_profile",
    "schedule_query",
    "package_get_balance",
    "finance_get_summary",
    "schedule_propose",
    "schedule_check_conflicts",
    "schedule_commit",
    "attendance_mark",
    "notification_draft",
    "notification_send",
    "knowledge_search",
  ]);
  assert.equal(tools.filter((t) => t.category === "query").length, 6);
  assert.equal(tools.filter((t) => t.category === "proposal").length, 2);
  assert.equal(tools.filter((t) => t.category === "execute").length, 4);
  assert.equal(tools.some((t) => t.category === "high_risk"), false);
});

test("agent gateway: get tool by name", async () => {
  const store = new JsonStateStore();
  const agentGateway = new AgentGatewayService(store, new CoreService(store));
  await agentGateway.onModuleInit();

  const tool = agentGateway.getTool("student_search");
  assert.ok(tool);
  assert.equal(tool?.name, "student_search");
  assert.equal(tool?.category, "query");
  assert.ok(tool?.inputSchema.query);
});

test("agent gateway: execute query tool", async () => {
  const store = new JsonStateStore();
  const agentGateway = new AgentGatewayService(store, new CoreService(store));
  await agentGateway.onModuleInit();

  const context = defaultRequestContext();
  const result = await agentGateway.executeTool("student_search", { query: "张" }, context);

  assert.equal(result.toolCall.status, "completed");
  assert.equal(result.toolCall.toolName, "student_search");
  assert.ok(result.toolCall.durationMs !== undefined);
  assert.ok(result.result);
  assert.equal((result.result.students as Array<unknown>).length >= 1, true);
  const snapshot = await store.load();
  assert.equal(snapshot.agentToolCalls[0].toolName, "student_search");
});

test("agent gateway: execute tools call CoreService mutations", async () => {
  const store = new JsonStateStore();
  const core = new CoreService(store);
  const agentGateway = new AgentGatewayService(store, core);
  await agentGateway.onModuleInit();

  const context = defaultRequestContext();
  const scheduled = await agentGateway.executeTool(
    "schedule_commit",
    { studentId: "stu-zhang", teacher: "王老师", room: "教室F", date: "2026-07-02", startTime: "08:00", endTime: "09:00", title: "MCP排课" },
    context,
  );
  assert.equal(scheduled.toolCall.status, "completed");
  assert.equal((await core.snapshot()).lessons.some((lesson) => lesson.title === "MCP排课"), true);

  const attended = await agentGateway.executeTool("attendance_mark", { lessonId: "lesson-2", status: "已到课" }, context);
  assert.equal(attended.toolCall.status, "completed");
  const student = (await core.snapshot()).students.find((item) => item.id === "stu-zhang");
  assert.equal(student?.remainingHours, 11);
});

test("agent gateway: unknown tool throws error", async () => {
  const store = new JsonStateStore();
  const agentGateway = new AgentGatewayService(store, new CoreService(store));
  await agentGateway.onModuleInit();

  const context = defaultRequestContext();
  await assert.rejects(
    () => agentGateway.executeTool("nonexistent_tool", {}, context),
    /Unknown MCP tool/,
  );
});

test("agent gateway: hermes status reports configuration", async () => {
  const store = new JsonStateStore();
  const agentGateway = new AgentGatewayService(store, new CoreService(store));
  await agentGateway.onModuleInit();

  const status = agentGateway.getHermesStatus();
  assert.equal(typeof status.configured, "boolean");
});

test("agent gateway: tool categories match specification", async () => {
  const store = new JsonStateStore();
  const agentGateway = new AgentGatewayService(store, new CoreService(store));
  await agentGateway.onModuleInit();

  const tools = agentGateway.listTools();

  // Query tools
  const queryTools = tools.filter((t) => t.category === "query");
  assert.ok(queryTools.some((t) => t.name === "student_search"));
  assert.ok(queryTools.some((t) => t.name === "student_get_profile"));
  assert.ok(queryTools.some((t) => t.name === "schedule_query"));
  assert.ok(queryTools.some((t) => t.name === "package_get_balance"));
  assert.ok(queryTools.some((t) => t.name === "finance_get_summary"));
  assert.ok(queryTools.some((t) => t.name === "knowledge_search"));

  // Proposal tools
  const proposalTools = tools.filter((t) => t.category === "proposal");
  assert.ok(proposalTools.some((t) => t.name === "schedule_propose"));
  assert.ok(proposalTools.some((t) => t.name === "schedule_check_conflicts"));

  // Execute tools
  const executeTools = tools.filter((t) => t.category === "execute");
  assert.ok(executeTools.some((t) => t.name === "schedule_commit"));
  assert.ok(executeTools.some((t) => t.name === "attendance_mark"));
  assert.ok(executeTools.some((t) => t.name === "notification_draft"));
  assert.ok(executeTools.some((t) => t.name === "notification_send"));
});

test("agent_tool_calls and agent_approvals tables exist in migration", () => {
  const migration = readFileSync(
    new URL("../../../../infra/postgres/migrations/0003_agent_tool_calls_and_approvals.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_tool_calls/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_approvals/);
  assert.match(migration, /agent_run_id TEXT NOT NULL REFERENCES agent_runs/);
  assert.match(migration, /tool_name TEXT NOT NULL/);
  assert.match(migration, /input_params JSONB/);
  assert.match(migration, /output_result JSONB/);
  assert.match(migration, /risk_level TEXT NOT NULL/);
  assert.match(migration, /status TEXT NOT NULL/);
  assert.match(migration, /requested_by TEXT NOT NULL/);
  assert.match(migration, /approved_by TEXT/);
  assert.match(migration, /tenant_isolation_agent_tool_calls/);
  assert.match(migration, /tenant_isolation_agent_approvals/);
});
