import { createHmac, timingSafeEqual } from "node:crypto";
import { ConflictException, Injectable, OnModuleDestroy, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import {
  cloneSeedState,
  type AppSnapshot,
  type AuditLog,
  type BusinessTask,
  type ChannelAccount,
  type ChannelIntegration,
  type ChannelMessage,
  type DashboardSummary,
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
  type ReportSummary,
  type Refund,
  type Student,
} from "@cjlass2/shared";
import { cosineSimilarity, EmbeddingProvider, hashContent } from "./embedding-provider.js";
import { hashPassword } from "./auth-credentials.js";
import { JsonStateStore } from "./json-state.store.js";
import { isNotificationChannelConfigured, NotificationProviderService } from "./notification-provider.service.js";
import { NotificationQueueService, type NotificationQueueJob } from "./notification-queue.service.js";
import { defaultRequestContext, type RequestContext } from "./request-context.js";
import { runtimeStatus } from "./runtime-config.js";

export interface MutationMeta {
  context?: RequestContext;
  idempotencyKey?: string;
  expectedVersion?: number;
}

export interface SchedulePreviewInput {
  studentId?: string;
  teacher?: string;
  room?: string;
  date?: string;
  day?: number;
  startTime?: string;
  endTime?: string;
  title?: string;
  type?: string;
  price?: number;
  ignoreLessonId?: string;
}

export interface ChannelCallbackInput {
  channel?: ChannelIntegration["type"];
  messageId?: string;
  fromUser?: string;
  displayName?: string;
  text?: string;
  event?: "message" | "card_action" | "verification";
  action?: "confirm_task" | "cancel_task";
  taskId?: string;
  lessonId?: string;
  studentId?: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
}

export interface KnowledgeSearchFilters {
  scope?: string;
  status?: string;
  includeExpired?: boolean;
  asOf?: string;
}

export interface KnowledgeDocInput {
  title: string;
  scope: string;
  content?: string;
  sourceUri?: string;
  mimeType?: string;
  effectiveFrom?: string;
  expiresAt?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface KnowledgeUploadInput {
  fileName: string;
  scope?: string;
  mimeType?: string;
  contentBase64?: string;
  text?: string;
  sourceUri?: string;
  effectiveFrom?: string;
  expiresAt?: string;
  metadata?: Record<string, string | number | boolean>;
}

@Injectable()
export class CoreService implements OnModuleInit, OnModuleDestroy {
  private notificationWorkerTimer: ReturnType<typeof setInterval> | null = null;
  private notificationWorkerRunning = false;
  private readonly embeddingProvider = new EmbeddingProvider();

  constructor(
    private readonly store: JsonStateStore,
    private readonly notificationQueue: NotificationQueueService = new NotificationQueueService(),
    private readonly notificationProvider: NotificationProviderService = new NotificationProviderService(),
  ) {}

  onModuleInit() {
    if (process.env.NOTIFICATION_WORKER_ENABLED !== "true") {
      return;
    }
    const intervalMs = Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS ?? 5000);
    this.notificationWorkerTimer = setInterval(() => {
      void this.processNotificationQueueSafely();
    }, Number.isFinite(intervalMs) && intervalMs >= 1000 ? intervalMs : 5000);
    this.notificationWorkerTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.notificationWorkerTimer) {
      clearInterval(this.notificationWorkerTimer);
      this.notificationWorkerTimer = null;
    }
  }

  async snapshot() {
    return applyLedgerReadModels(await this.store.load());
  }

  async scopedSnapshot(context: RequestContext = defaultRequestContext()): Promise<AppSnapshot> {
    return this.scopeSnapshot(await this.snapshot(), context);
  }

  scopeSnapshot(state: AppSnapshot, context: RequestContext = defaultRequestContext()): AppSnapshot {
    return scopeSnapshotForContext(applyLedgerReadModels(state), context);
  }

  async health() {
    const state = await this.snapshot();
    return {
      ok: true,
      databaseMode: this.store.isDatabaseMode(),
      students: state.students.length,
      lessons: state.lessons.length,
      notifications: state.notifications.length,
      queue: this.notificationQueue.status(),
      runtime: runtimeStatus(),
      checkedAt: nowText(),
    };
  }

  async reset(context: RequestContext = defaultRequestContext()) {
    const state = await this.store.reset();
    return this.saveWithAudit(applyLedgerReadModels(state), "重置演示数据", "系统数据已重置为初始状态", "已完成", context.actorName);
  }

  async dashboard(context: RequestContext = defaultRequestContext()): Promise<DashboardSummary> {
    const state = await this.scopedSnapshot(context);
    const pendingOrders = state.orders.filter((order) => order.status !== "已结清");
    const lowBalanceStudents = state.students.filter((student) => student.remainingHours <= 3);
    const pendingTasks = state.tasks.filter((task) => task.status === "等待确认");
    const pendingNotifications = state.notifications.filter((note) => note.status === "待发送" || note.status === "草稿");
    return {
      todayLessons: state.lessons.length,
      pendingAttendance: state.lessons.filter((lesson) => lesson.attendance === "未开始").length,
      pendingNotifications: pendingNotifications.length,
      pendingReschedules: pendingTasks.length,
      lowBalanceStudents: lowBalanceStudents.length,
      overdueOrders: pendingOrders.filter((order) => order.due.includes("逾期")).length,
      todos: [
        {
          id: "todo-low-balance",
          category: "学员",
          title: `${lowBalanceStudents.length} 位学员课时余额不足`,
          subtitle: "建议及时提醒学员续费",
          action: "提醒续费",
          tone: "orange",
          view: "billing",
        },
        {
          id: "todo-overdue",
          category: "收费",
          title: `${pendingOrders.length} 笔账单待处理`,
          subtitle: `总金额 ${currency(pendingOrders.reduce((sum, order) => sum + order.amount - order.paid, 0))}`,
          action: "去催缴",
          tone: "red",
          view: "billing",
        },
        {
          id: "todo-records",
          category: "课程",
          title: `${state.lessons.filter((lesson) => lesson.status === "已结束").length} 节课待记录`,
          subtitle: "课程已完成，请及时记录课堂反馈",
          action: "去记录",
          tone: "green",
          view: "schedule",
        },
        {
          id: "todo-tasks",
          category: "课程",
          title: `${pendingTasks.length} 条业务任务待确认`,
          subtitle: "来自网页或聊天入口的业务卡片",
          action: "去处理",
          tone: "purple",
          view: "chat",
        },
      ],
      week: {
        lessons: state.lessons.length * 3,
        visits: state.lessons.length * 11,
        newStudents: Math.max(1, state.students.length - 2),
        revenue: state.orders.reduce((sum, order) => sum + order.paid, 0),
      },
    };
  }

  async reports(context: RequestContext = defaultRequestContext()): Promise<ReportSummary> {
    const state = await this.scopedSnapshot(context);
    const income = sumPaymentLedger(state.paymentLedgerEntries);
    const attendance = aggregateAttendance(state);
    const lowBalanceStudents = state.students.filter((student) => student.remainingHours <= 3);
    const overdueOrders = state.orders.filter((order) => order.status !== "已结清");
    const pendingAttendance = state.lessons.filter((lesson) => lesson.attendance === "未开始");
    const pendingNotifications = state.notifications.filter((note) => note.status === "待发送" || note.status === "草稿");
    return {
      income,
      consumedLessons: Math.max(0, -sumLessonLedger(state.lessonLedgerEntries)),
      newStudents: state.students.length,
      attendanceRate: attendance.total ? Number(((attendance.present / attendance.total) * 100).toFixed(1)) : 0,
      incomeTrend: aggregatePaymentTrend(state.paymentLedgerEntries),
      teacherPayroll: aggregateTeacherPayroll(state),
      reminders: [
        { tone: "orange", title: "续费机会", text: `${lowBalanceStudents.length} 名学员剩余课时低于 3 节，建议本周跟进。`, action: "查看学员" },
        { tone: overdueOrders.length ? "red" : "green", title: "收款进度", text: `${overdueOrders.length} 笔订单待收，待收金额 ${currency(overdueOrders.reduce((sum, order) => sum + Math.max(0, order.amount - order.paid), 0))}。`, action: "查看订单" },
        { tone: pendingAttendance.length ? "blue" : "green", title: "考勤进度", text: `${pendingAttendance.length} 节课尚未点名，当前到课率 ${attendance.total ? Number(((attendance.present / attendance.total) * 100).toFixed(1)) : 0}%。`, action: "查看课表" },
        { tone: pendingNotifications.length ? "purple" : "green", title: "通知待办", text: `${pendingNotifications.length} 条通知等待确认或发送。`, action: "查看通知" },
      ],
    };
  }

  async createStudent(input: Partial<Student>, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("createStudent", { input }, meta, async (context) => {
    const previous = await this.snapshot();
    const state = previous;
    const name = input.name?.trim() || "新学员";
    const startingHours = Number(input.remainingHours ?? 10);
    const student: Student = {
      id: makeId("stu"),
      name,
      short: name.slice(0, 1),
      grade: input.grade || "未填写",
      status: "在读学员",
      tags: input.tags?.length ? input.tags : [input.teacherCourse || "课程"],
      code: `XS${Date.now().toString().slice(-8)}`,
      joinedAt: nowText().slice(0, 10),
      guardian: input.guardian || "家长",
      phone: input.phone || "待补充",
      note: input.note || "通过表单创建。",
      teacher: input.teacher || "林老师",
      teacherCourse: input.teacherCourse || input.packageName || "课程",
      packageName: input.packageName || `${input.teacherCourse || "课程"} 10 课时包`,
      baseRemainingHours: startingHours,
      remainingHours: startingHours,
      packageValidTo: input.packageValidTo || "2024-06-30",
      attendanceRate: "0 / 0",
      latestAttendance: "暂无",
      dueAmount: Number(input.dueAmount ?? 0),
      growthPoints: 0,
      records: [],
      communications: [],
    };
    return this.saveWithAudit({ ...state, students: [student, ...state.students] }, "创建学员", `${student.name}已加入学员档案`, "已完成", context.actorName, previous);
    });
  }

  async createLesson(input: Partial<Lesson>, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("createLesson", { input }, meta, async (context) => {
    const previous = await this.snapshot();
    const state = previous;
    const student = state.students.find((item) => item.id === input.studentId) ?? state.students[0];
    const lesson: Lesson = {
      id: makeId("lesson"),
      day: Number(input.day ?? 2),
      date: input.date || "05/08",
      start: input.start || "15:30",
      end: input.end || "16:30",
      title: input.title || `${student.teacherCourse || "新课程"}`,
      type: input.type || "一对一",
      studentId: student.id,
      studentName: student.name,
      teacher: input.teacher || student.teacher || "林老师",
      room: input.room || "教室A",
      status: "已确认",
      color: input.type === "固定班" ? "purple" : input.type === "小组课" ? "orange" : "green",
      attendance: "未开始",
      package: student.packageName,
      remaining: `${student.remainingHours} / 20 课时`,
      price: Number(input.price ?? 180),
    };
    assertLessonCanSchedule(state.lessons, lesson);
    return this.saveWithAudit({ ...state, lessons: [...state.lessons, lesson] }, "新增课程", `${student.name} ${lesson.title} 已排课`, "已完成", context.actorName, previous);
    });
  }

  async createOrder(input: Partial<Order>, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("createOrder", { input }, meta, async (context) => {
    const previous = await this.snapshot();
    const state = previous;
    const student = state.students.find((item) => item.id === input.studentId) ?? state.students[0];
    const amount = Number(input.amount ?? 2600);
    const paid = clamp(Number(input.paid ?? 0), 0, amount);
    if (paid > 0) {
      assertAccountingPeriodOpen(previous, nowText());
    }
    const order: Order = {
      id: makeId("order"),
      studentId: student.id,
      student: student.name,
      name: input.name || `${student.teacherCourse} 10课时包`,
      amount,
      paid: 0,
      status: "待收款",
      due: input.due || "待确认",
      channel: input.channel || "未收款",
      invoice: `SO${Date.now().toString().slice(-10)}`,
      createdAt: nowText(),
    };
	    const paymentLedgerEntries: PaymentLedgerEntry[] = paid > 0 ? [
	      {
	        id: makeId("pay-ledger"),
        orderId: order.id,
        studentId: order.studentId,
        studentName: order.student,
        entryType: "payment",
        amountDelta: paid,
        channel: input.channel || "初始导入",
        reason: `${order.name} 初始已付金额`,
        actorId: context.userId,
        occurredAt: nowText(),
	      },
	      ...state.paymentLedgerEntries,
	    ] : state.paymentLedgerEntries;
      const initialPaymentEntries = paid > 0 ? paymentFinancialEntries(paymentLedgerEntries[0]) : [];
      const invoice: Invoice = {
        id: makeId("invoice"),
        orderId: order.id,
        invoiceNo: order.invoice,
        amount: order.amount,
        status: "draft",
        createdAt: nowText(),
        updatedAt: nowText(),
      };
	    const nextState = applyLedgerReadModels({
        ...state,
        orders: [order, ...state.orders],
        paymentLedgerEntries,
        invoices: [invoice, ...(state.invoices ?? [])],
        financialLedgerEntries: [...initialPaymentEntries, ...(state.financialLedgerEntries ?? [])],
      });
	    return this.saveWithAudit(nextState, "创建订单", `${student.name} ${order.name} 已创建`, nextState.orders[0].status, context.actorName, previous);
	    });
	  }

  async recordPayment(orderId: string, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("recordPayment", { orderId }, meta, async (context) => {
	    const previous = await this.snapshot();
	    const state = previous;
	    const order = state.orders.find((item) => item.id === orderId);
	    if (!order) return state;
	    const remainingAmount = Math.max(0, order.amount - order.paid);
      if (remainingAmount > 0) {
        assertAccountingPeriodOpen(previous, nowText());
      }
		    const paymentEntry: PaymentLedgerEntry | null = remainingAmount > 0
          ? {
		        id: makeId("pay-ledger"),
		        orderId: order.id,
		        studentId: order.studentId,
	        studentName: order.student,
	        entryType: "payment",
	        amountDelta: remainingAmount,
	        channel: "微信支付",
	        reason: `${order.name} 收款结清`,
		        actorId: context.userId,
		        occurredAt: nowText(),
		      }
          : null;
        const paymentLedgerEntries: PaymentLedgerEntry[] = paymentEntry ? [paymentEntry, ...state.paymentLedgerEntries] : state.paymentLedgerEntries;
	      const orders = state.orders.map((item) => item.id === orderId ? { ...item, channel: "微信支付" } : item);
	      const nextState = applyLedgerReadModels({
          ...state,
          orders,
          paymentLedgerEntries,
          financialLedgerEntries: [
            ...(paymentEntry ? paymentFinancialEntries(paymentEntry) : []),
            ...(state.financialLedgerEntries ?? []),
          ],
        });
		    return this.saveWithAudit(nextState, "记录收款", `${order.student} ${order.name} 已结清`, "已完成", context.actorName, previous);
	    });
	  }

  async reversePaymentLedgerEntry(entryId: string, input: { reason?: string } = {}, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("reversePaymentLedgerEntry", { entryId, input }, meta, async (context) => {
      const state = await this.snapshot();
      const entry = state.paymentLedgerEntries.find((item) => item.id === entryId);
      if (!entry) return state;
      assertLedgerEntryCanReverse(state.paymentLedgerEntries, entryId, "payment");
      const reversalAmount = -entry.amountDelta;
      assertAccountingPeriodOpen(state, nowText());
      const reversal: PaymentLedgerEntry = {
        id: makeId("pay-ledger"),
        orderId: entry.orderId,
        studentId: entry.studentId,
        studentName: entry.studentName,
        entryType: reversalAmount < 0 ? "refund" : "payment",
        amountDelta: reversalAmount,
        channel: entry.channel,
        reason: input.reason?.trim() || `反向纠错：${entry.reason}`,
        actorId: context.userId,
        occurredAt: nowText(),
        reversesEntryId: entry.id,
      };
      const nextState = applyLedgerReadModels({ ...state, paymentLedgerEntries: [reversal, ...state.paymentLedgerEntries] });
      const financialLedgerEntries = [
        ...refundFinancialEntries({
          id: `reversal-${reversal.id}`,
          amount: Math.abs(reversal.amountDelta),
          orderId: reversal.orderId,
          studentId: reversal.studentId,
          occurredAt: reversal.occurredAt,
        }),
        ...(state.financialLedgerEntries ?? []),
      ];
      return this.saveWithAudit(
        { ...nextState, financialLedgerEntries },
        "反向纠错收款流水",
        `${entry.studentName} ${entry.reason} 已追加 ${currency(reversalAmount)} 反向流水`,
        "已完成",
        context.actorName,
      );
    });
  }

  async issueInvoice(orderId: string, input: { amount?: number; invoiceNo?: string } = {}, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("issueInvoice", { orderId, input }, meta, async (context) => {
      const previous = await this.snapshot();
      const order = previous.orders.find((item) => item.id === orderId);
      if (!order) {
        throw new ConflictException(`Order not found: ${orderId}`);
      }
      const now = nowText();
      assertAccountingPeriodOpen(previous, now);
      const existing = (previous.invoices ?? []).find((item) => item.orderId === orderId && item.status !== "void");
      const invoice: Invoice = {
        id: existing?.id ?? makeId("invoice"),
        orderId,
        invoiceNo: input.invoiceNo?.trim() || existing?.invoiceNo || order.invoice || `FP${Date.now().toString().slice(-10)}`,
        amount: clamp(Number(input.amount ?? existing?.amount ?? order.amount), 0, order.amount),
        status: "issued",
        issuedAt: existing?.issuedAt ?? now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const invoices = existing
        ? previous.invoices.map((item) => item.id === existing.id ? invoice : item)
        : [invoice, ...(previous.invoices ?? [])];
      const financialLedgerEntries = hasFinancialSource(previous, "invoice", invoice.id)
        ? previous.financialLedgerEntries
        : [...invoiceFinancialEntries(invoice, order), ...(previous.financialLedgerEntries ?? [])];
      return this.saveWithAudit(
        { ...previous, invoices, financialLedgerEntries },
        "开具发票",
        `${order.student} ${invoice.invoiceNo} 已开票 ${currency(invoice.amount)}`,
        "已开票",
        context.actorName,
        previous,
      );
    });
  }

  async requestRefund(input: { orderId: string; amount?: number; reason?: string }, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("requestRefund", { input }, meta, async (context) => {
      const previous = await this.snapshot();
      const order = previous.orders.find((item) => item.id === input.orderId);
      if (!order) {
        throw new ConflictException(`Order not found: ${input.orderId}`);
      }
      const paid = sumPaymentLedgerForOrder(previous.paymentLedgerEntries, order.id);
      const amount = clamp(Number(input.amount ?? Math.min(paid, order.amount)), 0, Math.max(0, paid));
      if (amount <= 0) {
        throw new ConflictException("Refund amount must be greater than 0 and cannot exceed paid amount");
      }
      const now = nowText();
      const refund: Refund = {
        id: makeId("refund"),
        orderId: order.id,
        amount,
        reason: input.reason?.trim() || `${order.name} 退款申请`,
        status: "requested",
        requestedBy: context.userId,
        createdAt: now,
        updatedAt: now,
      };
      return this.saveWithAudit(
        { ...previous, refunds: [refund, ...(previous.refunds ?? [])] },
        "提交退款申请",
        `${order.student} ${order.name} 申请退款 ${currency(amount)}`,
        "等待审批",
        context.actorName,
        previous,
      );
    });
  }

  async approveRefund(refundId: string, decision: "approved" | "rejected" = "approved", meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("approveRefund", { refundId, decision }, meta, async (context) => {
      const previous = await this.snapshot();
      const refund = previous.refunds.find((item) => item.id === refundId);
      if (!refund) {
        throw new ConflictException(`Refund not found: ${refundId}`);
      }
      if (refund.status !== "requested") {
        throw new ConflictException(`Refund is not waiting for approval: ${refund.status}`);
      }
      const now = nowText();
      const refunds = previous.refunds.map((item) => item.id === refundId
        ? { ...item, status: decision, approvedBy: context.userId, updatedAt: now }
        : item);
      return this.saveWithAudit(
        { ...previous, refunds },
        decision === "approved" ? "审批退款" : "拒绝退款",
        `${refund.reason} ${decision === "approved" ? "已通过" : "已拒绝"}`,
        decision === "approved" ? "已审批" : "已拒绝",
        context.actorName,
        previous,
      );
    });
  }

  async settleRefund(refundId: string, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("settleRefund", { refundId }, meta, async (context) => {
      const previous = await this.snapshot();
      const refund = previous.refunds.find((item) => item.id === refundId);
      if (!refund) {
        throw new ConflictException(`Refund not found: ${refundId}`);
      }
      if (refund.status !== "approved") {
        throw new ConflictException(`Refund must be approved before settlement: ${refund.status}`);
      }
      const order = previous.orders.find((item) => item.id === refund.orderId);
      if (!order) {
        throw new ConflictException(`Order not found: ${refund.orderId}`);
      }
      const now = nowText();
      assertAccountingPeriodOpen(previous, now);
      const ledgerEntry: PaymentLedgerEntry = {
        id: makeId("pay-ledger"),
        orderId: order.id,
        studentId: order.studentId,
        studentName: order.student,
        entryType: "refund",
        amountDelta: -refund.amount,
        channel: order.channel || "退款",
        reason: refund.reason,
        actorId: context.userId,
        occurredAt: now,
      };
      const refunds = previous.refunds.map((item) => item.id === refund.id
        ? { ...item, status: "settled" as const, paymentLedgerEntryId: ledgerEntry.id, updatedAt: now }
        : item);
      const nextState = applyLedgerReadModels({
        ...previous,
        refunds,
        paymentLedgerEntries: [ledgerEntry, ...previous.paymentLedgerEntries],
        financialLedgerEntries: [
          ...refundFinancialEntries({ id: refund.id, orderId: order.id, studentId: order.studentId, amount: refund.amount, occurredAt: now }),
          ...(previous.financialLedgerEntries ?? []),
        ],
      });
      return this.saveWithAudit(
        nextState,
        "退款结算",
        `${order.student} 已退款 ${currency(refund.amount)}，订单余额已由流水重算`,
        "已结算",
        context.actorName,
        previous,
      );
    });
  }

  async upsertFinancialAccount(input: Partial<FinancialAccount>, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("upsertFinancialAccount", { input }, meta, async (context) => {
      const previous = await this.snapshot();
      const name = input.name?.trim();
      if (!name) {
        throw new ConflictException("Financial account name is required");
      }
      const now = nowText();
      const existing = input.id
        ? (previous.financialAccounts ?? []).find((account) => account.id === input.id)
        : (previous.financialAccounts ?? []).find((account) => account.code === input.code || account.name === name);
      const account: FinancialAccount = {
        id: existing?.id ?? input.id ?? makeId("acct"),
        code: input.code?.trim() || existing?.code || `ACC${Date.now().toString().slice(-6)}`,
        name,
        type: input.type || existing?.type || "expense",
        normalBalance: input.normalBalance || existing?.normalBalance || (input.type === "income" || input.type === "liability" || input.type === "equity" ? "credit" : "debit"),
        status: input.status || existing?.status || "active",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const financialAccounts = existing
        ? (previous.financialAccounts ?? []).map((item) => item.id === existing.id ? account : item)
        : [account, ...(previous.financialAccounts ?? [])];
      return this.saveWithAudit(
        { ...previous, financialAccounts },
        existing ? "更新财务科目" : "新增财务科目",
        `${account.code} ${account.name} 已${existing ? "更新" : "启用"}`,
        account.status,
        context.actorName,
        previous,
      );
    });
  }

  async lockAccountingPeriod(period: string, input: { note?: string } = {}, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("lockAccountingPeriod", { period, input }, meta, async (context) => {
      const normalizedPeriod = normalizeAccountingPeriod(period);
      const previous = await this.snapshot();
      const now = nowText();
      const existing = (previous.accountingPeriodLocks ?? []).find((lock) => lock.period === normalizedPeriod);
      const lock: AccountingPeriodLock = {
        id: existing?.id ?? makeId("period-lock"),
        period: normalizedPeriod,
        status: "locked",
        lockedAt: existing?.lockedAt ?? now,
        lockedBy: existing?.lockedBy ?? context.userId,
        note: input.note?.trim() || existing?.note || "财务期末锁账",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const accountingPeriodLocks = existing
        ? (previous.accountingPeriodLocks ?? []).map((item) => item.id === existing.id ? lock : item)
        : [lock, ...(previous.accountingPeriodLocks ?? [])];
      return this.saveWithAudit(
        { ...previous, accountingPeriodLocks },
        "锁定会计期间",
        `${normalizedPeriod} 已锁账，后续分录写入将被阻止`,
        "locked",
        context.actorName,
        previous,
      );
    });
  }

  async reconcileFinancialLedger(input: { period?: string } = {}, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("reconcileFinancialLedger", { input }, meta, async (context) => {
      const previous = await this.snapshot();
      const period = normalizeAccountingPeriod(input.period || nowText().slice(0, 7));
      const entries = (previous.financialLedgerEntries ?? []).filter((entry) => accountingPeriodFor(entry.occurredAt) === period);
      const debitTotal = entries.filter((entry) => entry.direction === "debit").reduce((sum, entry) => sum + entry.amount, 0);
      const creditTotal = entries.filter((entry) => entry.direction === "credit").reduce((sum, entry) => sum + entry.amount, 0);
      const difference = Number((debitTotal - creditTotal).toFixed(2));
      const run: ReconciliationRun = {
        id: makeId("reconcile"),
        period,
        status: Math.abs(difference) < 0.01 ? "balanced" : "out_of_balance",
        debitTotal,
        creditTotal,
        difference,
        checkedAt: nowText(),
        checkedBy: context.userId,
        notes: [
          `${period} 共检查 ${entries.length} 条正式分录`,
          difference === 0 ? "借贷平衡" : `借贷差额 ${currency(difference)}`,
        ],
      };
      return this.saveWithAudit(
        { ...previous, reconciliationRuns: [run, ...(previous.reconciliationRuns ?? [])] },
        "财务对账",
        `${period} 对账${run.status === "balanced" ? "平衡" : "存在差异"}：借 ${currency(debitTotal)} / 贷 ${currency(creditTotal)}`,
        run.status,
        context.actorName,
        previous,
      );
    });
  }

  async requestExceptionalRefund(
    input: { orderId: string; amount?: number; reason?: string; exceptionCode?: string; exceptionNote?: string },
    meta: MutationMeta = {},
  ): Promise<AppSnapshot> {
    return this.withMutation("requestExceptionalRefund", { input }, meta, async (context) => {
      const previous = await this.snapshot();
      const order = previous.orders.find((item) => item.id === input.orderId);
      if (!order) {
        throw new ConflictException(`Order not found: ${input.orderId}`);
      }
      const paid = sumPaymentLedgerForOrder(previous.paymentLedgerEntries, order.id);
      const amount = clamp(Number(input.amount ?? Math.min(paid, order.amount)), 0, Math.max(0, paid));
      if (amount <= 0) {
        throw new ConflictException("Exceptional refund amount must be greater than 0 and cannot exceed paid amount");
      }
      const now = nowText();
      const refund: Refund = {
        id: makeId("refund"),
        orderId: order.id,
        amount,
        reason: input.reason?.trim() || `${order.name} 异常退款申请`,
        status: "requested",
        requestedBy: context.userId,
        exceptional: true,
        exceptionCode: input.exceptionCode?.trim() || "manual_exception",
        exceptionNote: input.exceptionNote?.trim() || "需财务复核后结算",
        createdAt: now,
        updatedAt: now,
      };
      return this.saveWithAudit(
        { ...previous, refunds: [refund, ...(previous.refunds ?? [])] },
        "提交异常退款",
        `${order.student} ${order.name} 异常退款 ${currency(amount)} 已提交`,
        "等待审批",
        context.actorName,
        previous,
      );
    });
  }

  async createPayrollRule(input: Partial<PayrollRule>, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("createPayrollRule", { input }, meta, async (context) => {
      const previous = await this.snapshot();
      const teacherName = input.teacherName?.trim() || previous.lessons[0]?.teacher || "未指定教师";
      const now = nowText();
      const rule: PayrollRule = {
        id: makeId("payroll-rule"),
        teacherId: input.teacherId || teacherIdForName(teacherName),
        teacherName,
        courseId: input.courseId,
        courseName: input.courseName,
        ruleType: input.ruleType || "fixed_per_lesson",
        amount: Number(input.amount ?? 120),
        status: input.status || "active",
        createdAt: now,
        updatedAt: now,
      };
      return this.saveWithAudit(
        { ...previous, payrollRules: [rule, ...(previous.payrollRules ?? [])] },
        "创建课酬规则",
        `${rule.teacherName} ${payrollRuleLabel(rule)} 已生效`,
        "已完成",
        context.actorName,
        previous,
      );
    });
  }

  async generatePayrollRecords(input: { teacherName?: string } = {}, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("generatePayrollRecords", { input }, meta, async (context) => {
      const previous = await this.snapshot();
      const existingLessonIds = new Set((previous.payrollRecords ?? []).map((record) => record.lessonId).filter(Boolean));
      const billableLessons = previous.lessons
        .filter(isBillableLesson)
        .filter((lesson) => !input.teacherName || lesson.teacher === input.teacherName)
        .filter((lesson) => !existingLessonIds.has(lesson.id));
      const now = nowText();
      const records = billableLessons.map((lesson): PayrollRecord => {
        const rule = matchPayrollRule(previous.payrollRules ?? [], lesson);
        return {
          id: makeId("payroll-record"),
          teacherId: teacherIdForName(lesson.teacher),
          teacherName: lesson.teacher,
          lessonId: lesson.id,
          ruleId: rule?.id,
          amount: payrollAmountForLesson(rule, lesson),
          status: "pending",
          createdAt: now,
          updatedAt: now,
        };
      });
      return this.saveWithAudit(
        { ...previous, payrollRecords: [...records, ...(previous.payrollRecords ?? [])] },
        "生成课酬记录",
        `生成 ${records.length} 条待确认课酬记录`,
        records.length ? "待确认" : "无新增",
        context.actorName,
        previous,
      );
    });
  }

  async confirmPayrollRecord(recordId: string, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("confirmPayrollRecord", { recordId }, meta, async (context) => {
      const previous = await this.snapshot();
      const record = previous.payrollRecords.find((item) => item.id === recordId);
      if (!record) {
        throw new ConflictException(`Payroll record not found: ${recordId}`);
      }
      if (record.status !== "pending") {
        throw new ConflictException(`Payroll record is not pending: ${record.status}`);
      }
      const now = nowText();
      assertAccountingPeriodOpen(previous, now);
      const nextRecord: PayrollRecord = { ...record, status: "confirmed", confirmedAt: now, updatedAt: now };
      const payrollRecords = previous.payrollRecords.map((item) => item.id === recordId ? nextRecord : item);
      const financialLedgerEntries = hasFinancialSource(previous, "payroll_confirm", record.id)
        ? previous.financialLedgerEntries
        : [...payrollConfirmFinancialEntries(nextRecord), ...(previous.financialLedgerEntries ?? [])];
      return this.saveWithAudit(
        { ...previous, payrollRecords, financialLedgerEntries },
        "确认课酬",
        `${record.teacherName} 课酬 ${currency(record.amount)} 已确认`,
        "已确认",
        context.actorName,
        previous,
      );
    });
  }

  async batchConfirmPayrollRecords(input: { recordIds?: string[]; teacherName?: string } = {}, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("batchConfirmPayrollRecords", { input }, meta, async (context) => {
      const previous = await this.snapshot();
      const selectedIds = new Set((input.recordIds ?? []).filter(Boolean));
      const now = nowText();
      const candidates = (previous.payrollRecords ?? []).filter((record) => {
        if (record.status !== "pending") return false;
        if (selectedIds.size && !selectedIds.has(record.id)) return false;
        if (input.teacherName && record.teacherName !== input.teacherName) return false;
        return true;
      });
      if (!candidates.length) {
        return this.saveWithAudit(
          previous,
          "批量确认课酬",
          "没有待确认课酬记录需要处理",
          "无新增",
          context.actorName,
          previous,
        );
      }
      assertAccountingPeriodOpen(previous, now);
      const candidateIds = new Set(candidates.map((record) => record.id));
      const nextRecords = previous.payrollRecords.map((record) => candidateIds.has(record.id)
        ? { ...record, status: "confirmed" as const, confirmedAt: now, updatedAt: now }
        : record);
      const newLedgerEntries = nextRecords
        .filter((record) => candidateIds.has(record.id) && !hasFinancialSource(previous, "payroll_confirm", record.id))
        .flatMap((record) => payrollConfirmFinancialEntries(record));
      return this.saveWithAudit(
        { ...previous, payrollRecords: nextRecords, financialLedgerEntries: [...newLedgerEntries, ...(previous.financialLedgerEntries ?? [])] },
        "批量确认课酬",
        `已确认 ${candidates.length} 条课酬，合计 ${currency(candidates.reduce((sum, record) => sum + record.amount, 0))}`,
        "已确认",
        context.actorName,
        previous,
      );
    });
  }

  async settlePayrollRecord(recordId: string, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("settlePayrollRecord", { recordId }, meta, async (context) => {
      const previous = await this.snapshot();
      const record = previous.payrollRecords.find((item) => item.id === recordId);
      if (!record) {
        throw new ConflictException(`Payroll record not found: ${recordId}`);
      }
      if (record.status !== "confirmed") {
        throw new ConflictException(`Payroll record must be confirmed before settlement: ${record.status}`);
      }
      const now = nowText();
      assertAccountingPeriodOpen(previous, now);
      const nextRecord: PayrollRecord = { ...record, status: "settled", settledAt: now, updatedAt: now };
      const payrollRecords = previous.payrollRecords.map((item) => item.id === recordId ? nextRecord : item);
      const financialLedgerEntries = hasFinancialSource(previous, "payroll_settle", record.id)
        ? previous.financialLedgerEntries
        : [...payrollSettleFinancialEntries(nextRecord), ...(previous.financialLedgerEntries ?? [])];
      return this.saveWithAudit(
        { ...previous, payrollRecords, financialLedgerEntries },
        "结算课酬",
        `${record.teacherName} 课酬 ${currency(record.amount)} 已结算`,
        "已结算",
        context.actorName,
        previous,
      );
    });
  }

  async financialLedgerSummary(context: RequestContext = defaultRequestContext()) {
    const state = await this.scopedSnapshot(context);
    const byAccount = new Map<string, { account: string; debit: number; credit: number; balance: number }>();
    for (const entry of state.financialLedgerEntries ?? []) {
      const row = byAccount.get(entry.account) ?? { account: entry.account, debit: 0, credit: 0, balance: 0 };
      if (entry.direction === "debit") {
        row.debit += entry.amount;
      } else {
        row.credit += entry.amount;
      }
      row.balance = row.debit - row.credit;
      byAccount.set(entry.account, row);
    }
    return [...byAccount.values()].sort((left, right) => Math.abs(right.balance) - Math.abs(left.balance));
  }

  async createNotification(input: Partial<NotificationDraft>, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("createNotification", { input }, meta, async (context) => {
    const previous = await this.snapshot();
    const state = previous;
    const note: NotificationDraft = {
      id: makeId("note"),
      type: input.type || "课程提醒",
      title: input.title || input.type || "新通知",
      recipient: input.recipient || "相关家长",
      channel: input.channel || "微信",
      status: input.status || "草稿",
      content: input.content || "请查看最新课程安排。",
      createdAt: nowText(),
    };
    return this.saveWithAudit({ ...state, notifications: [note, ...state.notifications] }, "创建通知草稿", `${note.title}已创建`, "草稿", context.actorName, previous);
    });
  }

  async updateNotification(noteId: string, input: Partial<NotificationDraft>, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("updateNotification", { noteId, input }, meta, async (context) => {
    const previous = await this.snapshot();
    const state = previous;
    const notifications = state.notifications.map((note) => note.id === noteId ? { ...note, ...input } : note);
    return this.saveWithAudit({ ...state, notifications }, "保存通知草稿", `${noteId} 已更新`, "草稿", context.actorName, previous);
    });
  }

  async sendNotification(noteId: string, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("sendNotification", { noteId }, meta, async (context) => {
    const previous = await this.snapshot();
    const state = previous;
    const note = state.notifications.find((item) => item.id === noteId);
    if (!note) return state;
    const delivery = createNotificationDelivery(note, context.userId);
    await this.enqueueDelivery(context.tenantId, delivery, delivery.status === "retry" ? "retry" : "send");
    const notifications = state.notifications.map((item) => item.id === noteId
      ? { ...item, ...notificationPatchFromDelivery(delivery) }
      : item);
    return this.saveWithAudit(
      { ...state, notifications, notificationDeliveries: [delivery, ...state.notificationDeliveries] },
      "发送通知",
      notificationSummary(note, delivery),
      auditStatusFromDelivery(delivery),
      context.actorName,
      previous,
    );
    });
  }

  async sendAllNotifications(meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("sendAllNotifications", {}, meta, async (context) => {
    const state = await this.snapshot();
    const pending = state.notifications.filter((item) => item.status === "待发送");
    const deliveries = pending.map((note) => createNotificationDelivery(note, context.userId));
    await Promise.all(deliveries.map((delivery) => this.enqueueDelivery(context.tenantId, delivery, "send")));
    const deliveryByNoteId = new Map(deliveries.map((delivery) => [delivery.notificationId, delivery]));
    const notifications = state.notifications.map((item) => {
      const delivery = deliveryByNoteId.get(item.id);
      if (!delivery) return item;
      return { ...item, ...notificationPatchFromDelivery(delivery) };
    });
    const sentCount = deliveries.filter((delivery) => delivery.status === "sent").length;
    const failedCount = deliveries.filter((delivery) => delivery.status === "failed").length;
    const queuedCount = deliveries.filter((delivery) => delivery.status === "queued").length;
    return this.saveWithAudit(
      { ...state, notifications, notificationDeliveries: [...deliveries, ...state.notificationDeliveries] },
      "批量发送通知",
      `处理 ${pending.length} 条待发送通知：${sentCount} 条送达，${queuedCount} 条入队，${failedCount} 条因渠道未连接失败`,
      failedCount ? "部分失败" : queuedCount ? "已入队" : "已发送",
      context.actorName,
    );
    });
  }

  async scheduleNotification(noteId: string, scheduledFor?: string, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("scheduleNotification", { noteId, scheduledFor }, meta, async (context) => {
    const state = await this.snapshot();
    const note = state.notifications.find((item) => item.id === noteId);
    if (!note) return state;
    const scheduledText = scheduledFor || "明日 09:00";
    const delivery = createScheduledDelivery(note, context.userId, scheduledText);
    await this.enqueueDelivery(context.tenantId, delivery, "scheduled_send");
    const notifications = state.notifications.map((item) => item.id === noteId ? { ...item, status: "预约发送" as const, scheduledFor: scheduledText } : item);
    return this.saveWithAudit(
      { ...state, notifications, notificationDeliveries: [delivery, ...state.notificationDeliveries] },
      "预约发送通知",
      `${note.title} 已设置 ${scheduledText} 预约发送`,
      "预约发送",
      context.actorName,
    );
    });
  }

  async retryNotificationDelivery(deliveryId: string, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("retryNotificationDelivery", { deliveryId }, meta, async (context) => {
      const state = await this.snapshot();
      const delivery = state.notificationDeliveries.find((item) => item.id === deliveryId);
      if (!delivery) return state;
      if (delivery.status === "sent") {
        throw new ConflictException("Notification delivery is already sent");
      }
      if (delivery.status === "cancelled") {
        throw new ConflictException("Notification delivery is cancelled");
      }
      const note = state.notifications.find((item) => item.id === delivery.notificationId);
      if (!note) return state;
      const next = createNotificationDelivery(note, context.userId, delivery.attempts + 1, delivery.id);
      await this.enqueueDelivery(context.tenantId, next, "retry");
      const notificationDeliveries = state.notificationDeliveries.map((item) => item.id === deliveryId ? next : item);
      const notifications = state.notifications.map((item) => item.id === note.id
        ? { ...item, ...notificationPatchFromDelivery(next) }
        : item);
      return this.saveWithAudit(
        { ...state, notifications, notificationDeliveries },
        "重试通知投递",
        next.status === "sent" ? `${note.title}重试送达` : next.status === "queued" ? `${note.title}重试任务已入队` : `${note.title}重试失败：${next.errorMessage}`,
        auditStatusFromDelivery(next),
        context.actorName,
      );
    });
  }

  async cancelNotificationDelivery(deliveryId: string, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("cancelNotificationDelivery", { deliveryId }, meta, async (context) => {
      const state = await this.snapshot();
      const delivery = state.notificationDeliveries.find((item) => item.id === deliveryId);
      if (!delivery) return state;
      if (delivery.status === "sent") {
        throw new ConflictException("Notification delivery is already sent");
      }
      const now = nowText();
      const notificationDeliveries = state.notificationDeliveries.map((item) => item.id === deliveryId ? { ...item, status: "cancelled" as const, updatedAt: now } : item);
      const notifications = state.notifications.map((item) => item.id === delivery.notificationId && item.status === "预约发送" ? { ...item, status: "草稿" as const, scheduledFor: undefined } : item);
      return this.saveWithAudit(
        { ...state, notifications, notificationDeliveries },
        "取消通知投递",
        `${delivery.notificationId} 的投递任务已取消`,
        "已取消",
        context.actorName,
      );
    });
  }

  notificationQueueStatus() {
    return this.notificationQueue.status();
  }

  async processNotificationQueue(limit = 20, context: RequestContext = defaultRequestContext()) {
    const jobs = await this.notificationQueue.claimDueJobs(limit);
    if (jobs.length === 0) {
      return { processed: 0, sent: 0, failed: 0, retried: 0 };
    }
    let state = await this.snapshot();
    let sent = 0;
    let failed = 0;
    let retried = 0;

    for (const job of jobs) {
      const delivery = state.notificationDeliveries.find((item) => item.id === job.deliveryId);
      const note = state.notifications.find((item) => item.id === job.notificationId);
      if (!delivery || !note || !["queued", "retry", "scheduled"].includes(delivery.status)) {
        continue;
      }

      const result = await this.notificationProvider.send({
        channel: delivery.channel,
        recipient: delivery.recipient,
        title: note.title,
        content: note.content,
        deliveryId: delivery.id,
      });

      const nextDelivery = result.ok
        ? markDeliverySent(delivery, result.providerMessageId)
        : markDeliveryFailed(delivery, result.errorMessage ?? "provider send failed");
      if (nextDelivery.status === "sent") {
        sent += 1;
      } else if (nextDelivery.status === "retry") {
        retried += 1;
        await this.notificationQueue.requeue({
          ...job,
          action: "retry",
          attempt: nextDelivery.attempts,
          runAt: nextDelivery.nextRetryAt,
          createdAt: nowText(),
        });
      } else {
        failed += 1;
      }

      state = {
        ...state,
        notificationDeliveries: state.notificationDeliveries.map((item) => item.id === nextDelivery.id ? nextDelivery : item),
        notifications: state.notifications.map((item) => item.id === note.id ? { ...item, ...notificationPatchFromDelivery(nextDelivery) } : item),
      };
    }

    await this.saveWithAudit(
      state,
      "处理通知队列",
      `处理 ${jobs.length} 个通知作业：${sent} 个送达，${retried} 个进入重试，${failed} 个失败`,
      failed ? "部分失败" : retried ? "部分重试" : "已完成",
      context.actorName,
    );
    return { processed: jobs.length, sent, failed, retried };
  }

  private async processNotificationQueueSafely() {
    if (this.notificationWorkerRunning) {
      return;
    }
    this.notificationWorkerRunning = true;
    try {
      await this.processNotificationQueue();
    } finally {
      this.notificationWorkerRunning = false;
    }
  }

  async generateDunningDrafts(meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("generateDunningDrafts", {}, meta, async (context) => {
    const state = await this.snapshot();
    const overdueOrders = state.orders.filter((order) => order.status !== "已结清").slice(0, 3);
    const notes: NotificationDraft[] = overdueOrders.map((order) => ({
      id: makeId("note"),
      type: "缴费提醒",
      title: `${order.student}缴费提醒`,
      recipient: `${order.student}家长`,
      channel: "微信",
      status: "草稿",
      content: `您好，${order.student}的${order.name}还有待支付 ${currency(order.amount - order.paid)}，请您方便时完成支付。`,
      createdAt: nowText(),
    }));
    return this.saveWithAudit({ ...state, notifications: [...notes, ...state.notifications] }, "批量生成催缴草稿", `生成 ${notes.length} 条缴费提醒草稿`, "草稿", context.actorName);
    });
  }

  async markAttendance(input: { lessonId: string; status: string }, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("markAttendance", { input }, meta, async (context) => {
    const previous = await this.snapshot();
    const state = previous;
    const lesson = state.lessons.find((item) => item.id === input.lessonId);
    if (!lesson) return state;
    const student = state.students.find((item) => item.id === lesson.studentId);
	    const lessons = state.lessons.map((item) => item.id === input.lessonId ? { ...item, attendance: input.status, status: input.status === "已到课" ? "已结束" : input.status } : item);
	    const shouldCreateLedger = input.status === "已到课" && lesson.attendance !== "已到课";
	    const students = state.students.map((item) => {
	      if (item.id !== lesson.studentId) return item;
	      const record = {
	        date: `${lesson.date} ${lesson.start} - ${lesson.end}`,
	        title: lesson.title,
	        teacher: lesson.teacher,
	        status: input.status,
	        note: shouldCreateLedger ? "已点名并扣减 1 课时。" : "保留原课时，等待后续处理。",
	      };
	      return { ...item, records: [record, ...item.records] };
	    });
	    const lessonLedgerEntries: LessonLedgerEntry[] = shouldCreateLedger ? [
	      {
	        id: makeId("lesson-ledger"),
	        studentId: lesson.studentId,
	        studentName: student?.name || lesson.studentName,
	        lessonId: lesson.id,
	        entryType: "deduct",
	        hoursDelta: -1,
	        reason: `${lesson.title} 到课课消`,
	        source: "attendance",
	        actorId: context.userId,
	        occurredAt: nowText(),
	      },
	      ...state.lessonLedgerEntries,
	    ] : state.lessonLedgerEntries;
	    return this.saveWithAudit(applyLedgerReadModels({ ...state, lessons, students, lessonLedgerEntries }), "点名与课消", `${student?.name || "学员"} ${lesson.title} 标记为${input.status}`, "已完成", context.actorName);
    });
  }

  async reverseLessonLedgerEntry(entryId: string, input: { reason?: string } = {}, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("reverseLessonLedgerEntry", { entryId, input }, meta, async (context) => {
      const state = await this.snapshot();
      const entry = state.lessonLedgerEntries.find((item) => item.id === entryId);
      if (!entry) return state;
      assertLedgerEntryCanReverse(state.lessonLedgerEntries, entryId, "lesson");
      const reversalHours = -entry.hoursDelta;
      const reversal: LessonLedgerEntry = {
        id: makeId("lesson-ledger"),
        studentId: entry.studentId,
        studentName: entry.studentName,
        lessonId: entry.lessonId,
        entryType: reversalHours > 0 ? "restore" : "deduct",
        hoursDelta: reversalHours,
        reason: input.reason?.trim() || `反向纠错：${entry.reason}`,
        source: "reversal",
        actorId: context.userId,
        occurredAt: nowText(),
        reversesEntryId: entry.id,
      };
      const students = state.students.map((student) => {
        if (student.id !== entry.studentId) return student;
        return {
          ...student,
          records: [
            {
              date: nowText(),
              title: "课时反向纠错",
              teacher: context.actorName,
              status: "已完成",
              note: `${entry.reason} 已追加 ${reversalHours > 0 ? "+" : ""}${reversalHours} 课时反向流水。`,
            },
            ...student.records,
          ],
        };
      });
      return this.saveWithAudit(
        applyLedgerReadModels({ ...state, students, lessonLedgerEntries: [reversal, ...state.lessonLedgerEntries] }),
        "反向纠错课时流水",
        `${entry.studentName} ${entry.reason} 已追加 ${reversalHours > 0 ? "+" : ""}${reversalHours} 课时反向流水`,
        "已完成",
        context.actorName,
      );
    });
  }

  async proposeSchedule(input: { text?: string; lessonId?: string; source?: string }, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("proposeSchedule", { input }, meta, async (context) => {
    const previous = await this.snapshot();
    const state = previous;
    const lesson = state.lessons.find((item) => item.id === input.lessonId) ?? state.lessons.find((item) => item.studentId === "stu-zhang") ?? state.lessons[0];
    const target = "05/08（周三）10:30 - 11:30";
    const candidate = buildRescheduledLesson(lesson, target);
    const conflicts = findScheduleConflicts(state.lessons, candidate, lesson.id);
    const task: BusinessTask = {
      id: makeId("task"),
      type: "reschedule",
      title: `${lesson.studentName}${lesson.title}调课确认`,
      status: "等待确认",
      channel: input.source === "chat" ? "聊天入口与网页同步" : "网页与聊天同步",
      sourceText: input.text || "调课申请",
      lessonId: lesson.id,
      studentId: lesson.studentId,
      createdAt: nowText(),
      proposal: {
        original: `${lesson.date} ${lesson.start} - ${lesson.end}`,
        target,
        course: lesson.title,
        teacher: lesson.teacher,
        room: lesson.room,
      },
      checks: [
        { label: "教师可用", ok: !hasScheduleConflict(conflicts, "teacher") },
        { label: "学员无冲突", ok: !hasScheduleConflict(conflicts, "student") },
        { label: "教室可用", ok: !hasScheduleConflict(conflicts, "room") },
        { label: "不改变已扣课时", ok: true },
      ],
      effects: conflicts.length
        ? [`发现 ${conflicts.length} 条排课冲突，需要调整方案后再确认`, ...conflicts.slice(0, 3).map(formatScheduleConflict)]
        : ["修改 1 节课程", "生成 2 条通知草稿", "写入审计流水并保留撤销入口"],
      expectedVersion: 1,
      idempotencyKey: meta.idempotencyKey ?? makeId("idem"),
    };
    return this.saveWithAudit({ ...state, tasks: [task, ...state.tasks] }, "自然语言识别", `生成调课方案：${task.title}`, "等待确认", context.actorName);
    });
  }

  async confirmTask(taskId: string, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("confirmTask", { taskId, expectedVersion: meta.expectedVersion }, meta, async (context) => {
    const previous = await this.snapshot();
    const state = previous;
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return state;
    assertTaskCanMutate(task, meta.expectedVersion);
    const originalLesson = state.lessons.find((lesson) => lesson.id === task.lessonId);
    if (!originalLesson) return state;
    const candidate = buildRescheduledLesson(originalLesson, task.proposal.target);
    assertTaskChecksPass(task);
    assertLessonCanSchedule(state.lessons, candidate, originalLesson.id);
    const lessons = state.lessons.map((lesson) => lesson.id === task.lessonId ? candidate : lesson);
    const tasks = state.tasks.map((item) => item.id === taskId ? { ...item, status: "执行成功" as const, executedAt: nowText(), expectedVersion: item.expectedVersion + 1 } : item);
    const notifications: NotificationDraft[] = [
      {
        id: makeId("note"),
        type: "调课通知",
        title: `${task.proposal.course}调课通知`,
        recipient: "张同学家长",
        channel: "微信",
        status: "草稿",
        content: `您好，${task.proposal.course}已从 ${task.proposal.original} 调整为 ${task.proposal.target}，${task.proposal.room} 不变。`,
        createdAt: nowText(),
      },
      {
        id: makeId("note"),
        type: "教师提醒",
        title: "调课同步提醒",
        recipient: task.proposal.teacher || "授课老师",
        channel: "企业微信",
        status: "草稿",
        content: `${task.proposal.course}已确认调课至 ${task.proposal.target}，请同步备课安排。`,
        createdAt: nowText(),
      },
      ...state.notifications,
    ];
    return this.saveWithAudit({ ...state, lessons, tasks, notifications }, "确认调课", `${task.title}已执行，并生成 2 条通知草稿`, "执行成功", context.actorName, previous);
    });
  }

  async cancelTask(taskId: string, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("cancelTask", { taskId, expectedVersion: meta.expectedVersion }, meta, async (context) => {
    const state = await this.snapshot();
    const task = state.tasks.find((item) => item.id === taskId);
    if (task) assertTaskCanMutate(task, meta.expectedVersion);
    const tasks = state.tasks.map((item) => item.id === taskId ? { ...item, status: "已取消" as const, expectedVersion: item.expectedVersion + 1 } : item);
    return this.saveWithAudit({ ...state, tasks }, "取消业务任务", "用户取消了待确认业务任务", "已取消", context.actorName);
    });
  }

  async interpretCommand(input: { text: string; source?: string; lessonId?: string; studentId?: string }, meta: MutationMeta = {}): Promise<{ state: AppSnapshot; result: { type: string; title: string; body: string; taskId?: string } }> {
    const text = input.text.trim();
    const lower = text.toLowerCase();
    const currentState = await this.snapshot();
    const selectedOrder = findOrderForCommand(currentState, text, input.studentId);
    const amount = amountFromText(text);
    if (/发票|开票|invoice/.test(lower)) {
      if (!selectedOrder) {
        return { state: currentState, result: { type: "question", title: "需要指定订单", body: "请补充学员姓名或订单名称，我才能开具对应发票。" } };
      }
      const state = await this.issueInvoice(selectedOrder.id, amount ? { amount } : {}, meta);
      return { state, result: { type: "done", title: "发票已开具", body: `${selectedOrder.student} ${selectedOrder.name} 已开票，并写入应收账款/课程收入分录。` } };
    }
    if (/退款|退费|refund/.test(lower)) {
      const pendingRefund = currentState.refunds.find((refund) => refund.status === "requested");
      const approvedRefund = currentState.refunds.find((refund) => refund.status === "approved");
      if (/审批|通过|同意/.test(lower) && pendingRefund) {
        const state = await this.approveRefund(pendingRefund.id, "approved", meta);
        return { state, result: { type: "done", title: "退款已审批", body: "退款申请已进入可结算状态。" } };
      }
      if (/结算|打款|支付|settle/.test(lower) && approvedRefund) {
        const state = await this.settleRefund(approvedRefund.id, meta);
        return { state, result: { type: "done", title: "退款已结算", body: "退款流水和正式财务分录已生成。" } };
      }
      if (!selectedOrder) {
        return { state: currentState, result: { type: "question", title: "需要指定退款订单", body: "请补充学员姓名、订单名称或退款金额，例如：给张子涵订单退款 300 元。" } };
      }
      const state = await this.requestRefund({ orderId: selectedOrder.id, amount, reason: text }, meta);
      return { state, result: { type: "approval", title: "退款申请已提交", body: "退款不会直接出账，需先审批，再执行结算。", taskId: state.tasks[0]?.id } };
    }
    if (/课酬|工资|薪酬|payroll/.test(lower)) {
      const pendingPayroll = currentState.payrollRecords.find((record) => record.status === "pending");
      const confirmedPayroll = currentState.payrollRecords.find((record) => record.status === "confirmed");
      if (/确认|审核/.test(lower) && pendingPayroll) {
        const state = await this.confirmPayrollRecord(pendingPayroll.id, meta);
        return { state, result: { type: "done", title: "课酬已确认", body: "系统已写入教师课酬/应付课酬分录。" } };
      }
      if (/结算|发放|支付/.test(lower) && confirmedPayroll) {
        const state = await this.settlePayrollRecord(confirmedPayroll.id, meta);
        return { state, result: { type: "done", title: "课酬已结算", body: "系统已写入应付课酬/银行存款分录。" } };
      }
      const teacherName = teacherNameFromText(text, currentState.lessons);
      const state = await this.generatePayrollRecords({ teacherName }, meta);
      return { state, result: { type: "draft", title: "课酬记录已生成", body: teacherName ? `${teacherName} 的待确认课酬已生成。` : "所有可计薪课程的待确认课酬已生成。" } };
    }
    if (/调课|调到|改到|改为|调整|推迟|提前|reschedule/.test(lower)) {
      const state = await this.proposeSchedule({ text, source: input.source, lessonId: input.lessonId }, meta);
      const task = state.tasks[0];
      return { state, result: { type: "proposal", title: "已生成调课预览", body: "系统已完成冲突校验，需要确认后才会修改课表并生成通知草稿。", taskId: task.id } };
    }
    if (/续费|催费|账单|收款|订单|缴费/.test(lower)) {
      const state = await this.generateDunningDrafts(meta);
      return { state, result: { type: "draft", title: "已生成缴费草稿", body: "草稿已进入通知中心，发送前可继续编辑。" } };
    }
    if (/通知|提醒|发送/.test(lower)) {
      const state = await this.createNotification({ type: "课程提醒", title: "课程提醒", recipient: "相关家长", content: "明天有课程，请提前 15 分钟到达教室，记得携带教材。如需请假或调整时间，请提前联系老师。" }, meta);
      return { state, result: { type: "draft", title: "已生成通知草稿", body: "固定提醒使用模板生成，发送前需要人工确认。" } };
    }
    if (/点名|到课|缺课|请假/.test(lower) && input.lessonId) {
      const status = /缺课/.test(lower) ? "缺课" : /请假/.test(lower) ? "请假" : "已到课";
      const state = await this.markAttendance({ lessonId: input.lessonId, status }, meta);
      return { state, result: { type: "done", title: "点名已记录", body: "已更新课程状态、课时流水和审计记录。" } };
    }
    return { state: await this.snapshot(), result: { type: "question", title: "需要补充一个关键信息", body: "我能识别到这是业务请求，但还缺少学员、课程、时间或金额中的关键字段。可以继续补充一句话，或直接使用预填表单。" } };
  }

  async exportCsv(type: string, context: RequestContext = defaultRequestContext()): Promise<string> {
    const state = await this.scopedSnapshot(context);
    if (type === "orders") {
      return toCsv(["id", "student", "name", "amount", "paid", "status"], state.orders.map((order) => [order.id, order.student, order.name, order.amount, order.paid, order.status]));
    }
    if (type === "audit") {
      return toCsv(["time", "actor", "action", "summary", "status"], state.auditLogs.map((log) => [log.time, log.actor, log.action, log.summary, log.status]));
    }
    if (type === "financial-ledger") {
      return toCsv(["time", "account", "direction", "amount", "sourceType", "sourceId"], (state.financialLedgerEntries ?? []).map((entry) => [entry.occurredAt, entry.account, entry.direction, entry.amount, entry.sourceType, entry.sourceId]));
    }
    if (type === "payroll") {
      return toCsv(["teacher", "amount", "status", "confirmedAt", "settledAt"], (state.payrollRecords ?? []).map((record) => [record.teacherName, record.amount, record.status, record.confirmedAt ?? "", record.settledAt ?? ""]));
    }
    if (type === "financial-accounts") {
      return toCsv(["code", "name", "type", "normalBalance", "status"], (state.financialAccounts ?? []).map((account) => [account.code, account.name, account.type, account.normalBalance, account.status]));
    }
    if (type === "accounting-locks") {
      return toCsv(["period", "status", "lockedAt", "lockedBy", "note"], (state.accountingPeriodLocks ?? []).map((lock) => [lock.period, lock.status, lock.lockedAt, lock.lockedBy, lock.note ?? ""]));
    }
    if (type === "reconciliation") {
      return toCsv(["period", "status", "debitTotal", "creditTotal", "difference", "checkedAt"], (state.reconciliationRuns ?? []).map((run) => [run.period, run.status, run.debitTotal, run.creditTotal, run.difference, run.checkedAt]));
    }
    return toCsv(["metric", "value"], [["income", state.orders.reduce((sum, order) => sum + order.paid, 0)], ["students", state.students.length], ["lessons", state.lessons.length]]);
  }


  async listUsers(tenantId: string) {
    return this.store.listUsers(tenantId);
  }

  async createUser(input: { email: string; password: string; displayName: string; role?: string }, context: RequestContext) {
    const userId = makeId("user");
    const user = await this.store.createUser({
      userId,
      tenantId: context.tenantId,
      email: input.email.trim().toLowerCase(),
      passwordHash: hashPassword(input.password),
      displayName: input.displayName,
      role: (input.role as "admin" | "teacher" | "finance" | "assistant" | "readonly") || "assistant",
    });
    await this.store.saveIncremental(await this.snapshot(), {
      ...(await this.snapshot()),
      auditLogs: [{
        id: makeId("audit"),
        time: nowText(),
        actor: context.actorName,
        action: "创建用户",
        summary: `已创建用户 ${user.displayName} (${user.email})`,
        status: "已完成",
      }, ...(await this.snapshot()).auditLogs],
    });
    return { userId: user.userId, email: user.email, displayName: user.displayName, role: user.role, status: user.status };
  }

  async updateUser(userId: string, patch: { displayName?: string; role?: string; status?: string }, context: RequestContext) {
    const previous = await this.snapshot();
    const role = patch.role as "admin" | "teacher" | "finance" | "assistant" | "readonly" | undefined;
    const user = await this.store.updateUser(userId, context.tenantId, { displayName: patch.displayName, role, status: patch.status });
    if (!user) {
      throw new ConflictException(`User not found: ${userId}`);
    }
    await this.store.saveIncremental(previous, {
      ...previous,
      auditLogs: [{
        id: makeId("audit"),
        time: nowText(),
        actor: context.actorName,
        action: "更新用户",
        summary: `已更新用户 ${user.displayName}`,
        status: "已完成",
      }, ...previous.auditLogs],
    });
    return { userId: user.userId, email: user.email, displayName: user.displayName, role: user.role, status: user.status };
  }

  async resetUserPassword(userId: string, newPassword: string, context: RequestContext) {
    const user = await this.store.updateUser(userId, context.tenantId, { passwordHash: hashPassword(newPassword) });
    if (!user) {
      throw new ConflictException(`User not found: ${userId}`);
    }
    return { userId: user.userId, email: user.email, displayName: user.displayName, role: user.role, status: user.status };
  }

  async createKnowledgeDoc(input: KnowledgeDocInput, context: RequestContext) {
    return this.indexKnowledgeDoc(input, context, "创建知识文档", "manual");
  }

  async uploadKnowledgeDoc(input: KnowledgeUploadInput, context: RequestContext) {
    const parsed = parseKnowledgeUpload(input);
    return this.indexKnowledgeDoc({
      title: parsed.title,
      scope: input.scope || "机构知识库",
      content: parsed.text,
      sourceUri: input.sourceUri || input.fileName,
      mimeType: parsed.mimeType,
      effectiveFrom: input.effectiveFrom,
      expiresAt: input.expiresAt,
      metadata: input.metadata,
    }, context, "上传知识文档", parsed.parser);
  }

  private async indexKnowledgeDoc(input: KnowledgeDocInput, context: RequestContext, action: string, source: string) {
    const previous = await this.snapshot();
    const content = input.content ?? input.title;
    const rawChunks = chunkKnowledgeContent(content);
    const embeddings = await this.embeddingProvider.embedBatch(rawChunks.map((chunk) => `${input.title}\n${chunk}`));
    const chunks = rawChunks.map((chunkContent, index): KnowledgeChunk => ({
      id: makeId("chunk"),
      docId: "",
      chunkIndex: index,
      title: input.title,
      scope: input.scope,
      content: chunkContent,
      sourceLabel: `${input.title}#${index + 1}`,
      metadata: {
        ...(input.metadata ?? {}),
        createdBy: context.userId,
        source,
      },
      contentHash: hashContent(chunkContent),
      embedding: embeddings[index]?.embedding,
      embeddingProvider: embeddings[index]?.provider,
      embeddingModel: embeddings[index]?.model,
      embeddingDimension: embeddings[index]?.dimension,
      embeddedAt: nowText(),
    }));
    const doc: KnowledgeDoc = {
      id: makeId("doc"),
      title: input.title,
      scope: input.scope,
      status: "生效中",
      updatedAt: nowText().slice(0, 10),
      sourceCount: chunks.length,
      sourceUri: input.sourceUri ?? "",
      mimeType: input.mimeType ?? "text/plain",
      checksum: hashContent(content),
      parser: source,
      effectiveFrom: input.effectiveFrom || nowText().slice(0, 10),
      expiresAt: input.expiresAt || "",
      metadata: input.metadata ?? {},
    };
    const knowledgeChunks = [
      ...chunks.map((chunk) => ({ ...chunk, docId: doc.id })),
      ...previous.knowledgeChunks,
    ];
    const next = { ...previous, ragDocs: [doc, ...previous.ragDocs], knowledgeChunks };
    return this.saveWithAudit(next, action, `已索引知识文档：${doc.title}（${chunks.length} 个片段）`, "已完成", context.actorName, previous);
  }

  async deleteKnowledgeDoc(docId: string, context: RequestContext) {
    const previous = await this.snapshot();
    const doc = previous.ragDocs.find((item) => item.id === docId);
    if (!doc) {
      throw new ConflictException(`Knowledge doc not found: ${docId}`);
    }
    const next = {
      ...previous,
      ragDocs: previous.ragDocs.filter((item) => item.id !== docId),
      knowledgeChunks: previous.knowledgeChunks.filter((chunk) => chunk.docId !== docId),
    };
    return this.saveWithAudit(next, "删除知识文档", `已删除知识文档：${doc.title}`, "已完成", context.actorName, previous);
  }

  async invalidateKnowledgeDoc(docId: string, input: { reason?: string } = {}, context: RequestContext) {
    const previous = await this.snapshot();
    const doc = previous.ragDocs.find((item) => item.id === docId);
    if (!doc) {
      throw new ConflictException(`Knowledge doc not found: ${docId}`);
    }
    const invalidatedAt = nowText();
    const nextDoc: KnowledgeDoc = {
      ...doc,
      status: "已失效",
      updatedAt: invalidatedAt.slice(0, 10),
      invalidatedAt,
      invalidatedBy: context.userId,
      metadata: {
        ...(doc.metadata ?? {}),
        invalidationReason: input.reason ?? "manual",
      },
    };
    const next = {
      ...previous,
      ragDocs: previous.ragDocs.map((item) => item.id === docId ? nextDoc : item),
    };
    return this.saveWithAudit(next, "失效知识文档", `已将知识文档标记失效：${doc.title}`, "已完成", context.actorName, previous);
  }

  async reindexKnowledgeDoc(docId: string, context: RequestContext) {
    const previous = await this.snapshot();
    const doc = previous.ragDocs.find((item) => item.id === docId);
    if (!doc) {
      throw new ConflictException(`Knowledge doc not found: ${docId}`);
    }
    const docChunks = previous.knowledgeChunks.filter((chunk) => chunk.docId === docId);
    const embeddings = await this.embeddingProvider.embedBatch(docChunks.map((chunk) => `${doc.title}\n${chunk.content}`));
    const nextChunks = previous.knowledgeChunks.map((chunk) => {
      const index = docChunks.findIndex((item) => item.id === chunk.id);
      if (index < 0) return chunk;
      const embedding = embeddings[index];
      return {
        ...chunk,
        contentHash: hashContent(chunk.content),
        embedding: embedding.embedding,
        embeddingProvider: embedding.provider,
        embeddingModel: embedding.model,
        embeddingDimension: embedding.dimension,
        embeddedAt: nowText(),
      };
    });
    const next = {
      ...previous,
      ragDocs: previous.ragDocs.map((item) => item.id === docId ? { ...item, updatedAt: nowText().slice(0, 10) } : item),
      knowledgeChunks: nextChunks,
    };
    return this.saveWithAudit(next, "重建知识索引", `已重建知识文档向量：${doc.title}`, "已完成", context.actorName, previous);
  }

  async searchKnowledge(query: string, limit = 5, context: RequestContext, filters: KnowledgeSearchFilters = {}) {
    const state = await this.scopedSnapshot(context);
    const normalizedLimit = clamp(Number(limit || 5), 1, 20);
    const asOf = filters.asOf ? new Date(filters.asOf) : new Date();
    const searchableDocs = state.ragDocs.filter((doc) => isKnowledgeDocSearchable(doc, filters, asOf));
    const docById = new Map(searchableDocs.map((doc) => [doc.id, doc]));
    const queryEmbedding = await this.embeddingProvider.embed(query);
    const vectorRows = await this.store.searchKnowledgeByEmbedding(context.tenantId, queryEmbedding.embedding, normalizedLimit, filters)
      .catch(() => []);
    const scopedVectorRows = vectorRows.filter((item) => docById.has(item.chunk.docId));
    const scoredChunks = (scopedVectorRows.length ? scopedVectorRows : state.knowledgeChunks
      .filter((chunk) => docById.has(chunk.docId))
      .map((chunk) => {
        const vectorScore = cosineSimilarity(queryEmbedding.embedding, chunk.embedding);
        const textScore = scoreKnowledgeChunk(query, chunk);
        const score = vectorScore > 0 ? vectorScore + Math.min(textScore, 3) * 0.05 : textScore;
        return { chunk, score, ranking: vectorScore > 0 ? "embedding" : "text" };
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.chunk.chunkIndex - right.chunk.chunkIndex)
      .slice(0, normalizedLimit);
    const fallbackDocs = scoredChunks.length
      ? []
      : searchableDocs
        .map((doc) => ({ doc, score: scoreText(query, `${doc.title} ${doc.scope}`) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, normalizedLimit);
    return {
      query,
      results: [
        ...scoredChunks.map(({ chunk, score }) => {
          const doc = docById.get(chunk.docId);
          return {
            id: chunk.docId,
            chunkId: chunk.id,
            title: doc?.title ?? chunk.title,
            scope: doc?.scope ?? chunk.scope,
            updatedAt: doc?.updatedAt,
            excerpt: excerptForQuery(chunk.content, query),
            relevance: Number(score.toFixed(3)),
            ranking: scopedVectorRows.length ? "pgvector" : (chunk.embedding?.length ? "embedding" : "text"),
            sources: [{ docId: chunk.docId, title: doc?.title ?? chunk.title, chunkIndex: chunk.chunkIndex, label: chunk.sourceLabel }],
          };
        }),
        ...fallbackDocs.map(({ doc, score }) => ({
          id: doc.id,
          title: doc.title,
          scope: doc.scope,
          updatedAt: doc.updatedAt,
          excerpt: `${doc.title} - ${doc.scope}`,
          relevance: Number(score.toFixed(3)),
          ranking: "title",
          sources: [{ docId: doc.id, title: doc.title, chunkIndex: 0, label: `${doc.title}#title` }],
        })),
      ],
      tenantId: context.tenantId,
      filters,
    };
  }

  async createAgentRun(input: { task: string; toolCalls?: number }, context: RequestContext) {
    const previous = await this.snapshot();
    const run = {
      id: makeId("agent"),
      status: "完成",
      task: input.task,
      startedAt: nowText(),
      toolCalls: input.toolCalls ?? 0,
    };
    const next = { ...previous, agentRuns: [run, ...previous.agentRuns] };
    return this.saveWithAudit(next, "执行 Agent 任务", `Agent 已处理：${run.task}`, "完成", context.actorName, previous);
  }

  async createChannelIntegration(input: { name: string; type: string; description?: string }, context: RequestContext) {
    const previous = await this.snapshot();
    const channel = {
      id: makeId("channel"),
      name: input.name,
      type: input.type as "wecom" | "wechat_h5" | "feishu" | "dingtalk",
      status: "not_configured" as const,
      description: input.description || "",
    };
    const next = { ...previous, channelIntegrations: [channel, ...previous.channelIntegrations] };
    return this.saveWithAudit(next, "创建渠道集成", `已添加渠道：${channel.name}`, "已完成", context.actorName, previous);
  }

  async updateChannelIntegration(channelId: string, patch: { status?: string; description?: string }, context: RequestContext) {
    const previous = await this.snapshot();
    const channel = previous.channelIntegrations.find((item) => item.id === channelId);
    if (!channel) {
      throw new ConflictException(`Channel integration not found: ${channelId}`);
    }
    const channelIntegrations = previous.channelIntegrations.map((item) => item.id === channelId
      ? { ...item, ...(patch.status ? { status: patch.status as "connected" | "not_configured" } : {}), ...(patch.description != null ? { description: patch.description } : {}) }
      : item);
    const next = { ...previous, channelIntegrations };
    return this.saveWithAudit(next, "更新渠道集成", `已更新渠道：${channel.name}`, "已完成", context.actorName, previous);
  }

  async previewSchedule(input: SchedulePreviewInput) {
    const state = await this.snapshot();
    const candidate = buildScheduleCandidate(state, input);
    const conflicts = findScheduleConflicts(state.lessons, candidate, input.ignoreLessonId);
    return {
      proposal: candidate,
      conflicts: conflicts.map((conflict) => ({
        kind: conflict.kind,
        lessonId: conflict.lesson.id,
        title: conflict.lesson.title,
        student: conflict.lesson.studentName,
        teacher: conflict.lesson.teacher,
        room: conflict.lesson.room,
        date: conflict.lesson.date,
        start: conflict.lesson.start,
        end: conflict.lesson.end,
        message: formatScheduleConflict(conflict),
      })),
      canSchedule: conflicts.length === 0,
    };
  }

  async handleChannelCallback(input: ChannelCallbackInput, context: RequestContext = defaultRequestContext()) {
    const channelType = input.channel ?? "wecom";
    verifyChannelCallback(input);
    const messageId = input.messageId?.trim() || `${channelType}-${input.timestamp || Date.now()}-${input.nonce || makeId("nonce")}`;
    const fromUser = input.fromUser?.trim() || "unknown-user";
    const text = input.text?.trim() || "";
    const eventType: ChannelMessage["eventType"] = input.event === "card_action" || input.action ? "card_action" : input.event === "verification" ? "verification" : "message";

    const receivedState = await this.snapshot();
    const existing = receivedState.channelMessages.find((message) => message.channelType === channelType && message.messageId === messageId);
    if (existing) {
      return {
        accepted: true,
        duplicate: true,
        messageId,
        status: "deduplicated",
        taskId: existing.taskId,
        responseText: existing.responseText,
      };
    }

    const channel = receivedState.channelIntegrations.find((item) => item.type === channelType);
    const account = upsertChannelAccount(receivedState.channelAccounts, {
      channelId: channel?.id ?? `channel-${channelType}`,
      channelType,
      externalUserId: fromUser,
      displayName: input.displayName || fromUser,
      context,
    });
    const message: ChannelMessage = {
      id: makeId("channel-message"),
      channelType,
      messageId,
      fromUser,
      text,
      eventType,
      status: "received",
      receivedAt: nowText(),
    };
    await this.saveWithAudit(
      {
        ...receivedState,
        channelAccounts: account.accounts,
        channelMessages: [message, ...receivedState.channelMessages],
      },
      "接收渠道消息",
      `${channel?.name ?? channelType} 收到 ${fromUser} 的${eventType === "card_action" ? "卡片动作" : "消息"}`,
      "已接收",
      context.actorName,
      receivedState,
    );

    try {
      let responseText = "已接收";
      let taskId = input.taskId;
      if (input.action === "confirm_task" && input.taskId) {
        await this.confirmTask(input.taskId, { context, idempotencyKey: `channel-confirm-${messageId}` });
        responseText = "任务已确认执行";
      } else if (input.action === "cancel_task" && input.taskId) {
        await this.cancelTask(input.taskId, { context, idempotencyKey: `channel-cancel-${messageId}` });
        responseText = "任务已取消";
      } else if (text) {
        const interpreted = await this.interpretCommand(
          { text, source: "chat", lessonId: input.lessonId, studentId: input.studentId },
          { context, idempotencyKey: `channel-message-${messageId}` },
        );
        taskId = interpreted.result.taskId;
        responseText = interpreted.result.body;
      }

      const finalState = await this.snapshot();
      const channelMessages = finalState.channelMessages.map((item) => item.id === message.id
        ? { ...item, status: "processed" as const, taskId, responseText }
        : item);
      await this.saveWithAudit(
        { ...finalState, channelMessages },
        "处理渠道消息",
        responseText,
        "已完成",
        context.actorName,
        finalState,
      );
      return { accepted: true, duplicate: false, messageId, status: "processed", taskId, responseText };
    } catch (error) {
      const finalState = await this.snapshot();
      const responseText = error instanceof Error ? error.message : String(error);
      const channelMessages = finalState.channelMessages.map((item) => item.id === message.id
        ? { ...item, status: "failed" as const, responseText }
        : item);
      await this.saveWithAudit(
        { ...finalState, channelMessages },
        "处理渠道消息失败",
        responseText,
        "失败",
        context.actorName,
        finalState,
      );
      throw error;
    }
  }

  async createPeriodicLessons(input: {
    studentId: string;
    teacher: string;
    room: string;
    title: string;
    type?: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    startDate: string;
    weeks: number;
    price?: number;
  }, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("createPeriodicLessons", { input }, meta, async (context) => {
      const previous = await this.snapshot();
      const student = previous.students.find((s) => s.id === input.studentId) ?? previous.students[0];
      const newLessons: Lesson[] = [];
      const startDate = parseDate(input.startDate);
      for (let week = 0; week < input.weeks; week++) {
        const lessonDate = addDays(startDate, (input.dayOfWeek - startDate.getDay() + 7) % 7 + week * 7);
        const dateText = `${String(lessonDate.getMonth() + 1).padStart(2, "0")}/${String(lessonDate.getDate()).padStart(2, "0")}`;
        const lesson: Lesson = {
          id: makeId("lesson"),
          day: input.dayOfWeek,
          date: dateText,
          start: input.startTime,
          end: input.endTime,
          title: input.title,
          type: input.type || "一对一",
          studentId: student.id,
          studentName: student.name,
          teacher: input.teacher,
          room: input.room,
          status: "已确认",
          color: input.type === "固定班" ? "purple" : input.type === "小组课" ? "orange" : "green",
          attendance: "未开始",
          package: student.packageName,
          remaining: `${student.remainingHours} / 20 课时`,
          price: Number(input.price ?? 180),
        };
        assertLessonCanSchedule([...previous.lessons, ...newLessons], lesson);
        newLessons.push(lesson);
      }
      const next = { ...previous, lessons: [...previous.lessons, ...newLessons] };
      return this.saveWithAudit(next, "批量周期排课", `已生成 ${newLessons.length} 节周期课程`, "已完成", context.actorName, previous);
    });
  }

  async batchSchedule(inputs: Array<Partial<Lesson>>, meta: MutationMeta = {}): Promise<AppSnapshot> {
    return this.withMutation("batchSchedule", { inputs }, meta, async (context) => {
      const previous = await this.snapshot();
      const newLessons: Lesson[] = [];
      for (const input of inputs) {
        const student = previous.students.find((s) => s.id === input.studentId) ?? previous.students[0];
        const lesson: Lesson = {
          id: makeId("lesson"),
          day: Number(input.day ?? 0),
          date: input.date || "01/01",
          start: input.start || "09:00",
          end: input.end || "10:00",
          title: input.title || student.teacherCourse,
          type: input.type || "一对一",
          studentId: student.id,
          studentName: student.name,
          teacher: input.teacher || student.teacher,
          room: input.room || "教室A",
          status: "已确认",
          color: input.type === "固定班" ? "purple" : input.type === "小组课" ? "orange" : "green",
          attendance: "未开始",
          package: student.packageName,
          remaining: `${student.remainingHours} 课时`,
          price: Number(input.price ?? 180),
        };
        assertLessonCanSchedule([...previous.lessons, ...newLessons], lesson);
        newLessons.push(lesson);
      }
      const next = { ...previous, lessons: [...previous.lessons, ...newLessons] };
      return this.saveWithAudit(next, "批量排课", `已生成 ${newLessons.length} 节课程`, "已完成", context.actorName, previous);
    });
  }

  async teacherAvailability(teacher: string, context: RequestContext = defaultRequestContext()) {
    const state = await this.scopedSnapshot(context);
    const teacherLessons = state.lessons.filter((l) => l.teacher === teacher && l.status !== "已取消");
    const slots = teacherLessons.map((l) => ({ date: l.date, start: l.start, end: l.end, title: l.title, room: l.room, student: l.studentName }));
    return { teacher, lessons: slots, totalSlots: slots.length };
  }

  async roomAvailability(room: string, context: RequestContext = defaultRequestContext()) {
    const state = await this.scopedSnapshot(context);
    const roomLessons = state.lessons.filter((l) => l.room === room && l.status !== "已取消");
    const slots = roomLessons.map((l) => ({ date: l.date, start: l.start, end: l.end, title: l.title, teacher: l.teacher }));
    return { room, lessons: slots, totalSlots: slots.length };
  }

  async paymentLedgerSummary(context: RequestContext = defaultRequestContext()) {
    const state = await this.scopedSnapshot(context);
    return state.orders.map((order) => {
      const ledgerPaid = sumPaymentLedgerForOrder(state.paymentLedgerEntries, order.id);
      return {
        orderId: order.id,
        studentId: order.studentId,
        student: order.student,
        amount: order.amount,
        paidFromLedger: ledgerPaid,
        outstanding: Math.max(0, order.amount - ledgerPaid),
        status: order.status,
        entries: state.paymentLedgerEntries.filter((entry) => entry.orderId === order.id).length,
      };
    });
  }

  async lessonLedgerSummary(context: RequestContext = defaultRequestContext()) {
    const state = await this.scopedSnapshot(context);
    return state.students.map((student) => {
      const ledgerDelta = sumLessonLedgerForStudent(state.lessonLedgerEntries, student.id);
      const baseRemainingHours = student.baseRemainingHours ?? student.remainingHours - ledgerDelta;
      return {
        studentId: student.id,
        student: student.name,
        baseRemainingHours,
        ledgerDelta,
        remainingHours: student.remainingHours,
        entries: state.lessonLedgerEntries.filter((entry) => entry.studentId === student.id).length,
      };
    });
  }

  private async withMutation<T>(operation: string, request: unknown, meta: MutationMeta, producer: (context: RequestContext) => Promise<T>): Promise<T> {
    const context = meta.context ?? defaultRequestContext();
    return this.store.withIdempotency(
      context.tenantId,
      meta.idempotencyKey,
      {
        operation,
        tenantId: context.tenantId,
        userId: context.userId,
        expectedVersion: meta.expectedVersion,
        request,
      },
      () => producer(context),
    );
  }

  private async saveWithAudit(state: AppSnapshot, action: string, summary: string, status: string, actor = "林老师", previous: AppSnapshot | null = null): Promise<AppSnapshot> {
    const nextState = applyLedgerReadModels(state);
    const withAudit: AppSnapshot = {
      ...nextState,
      auditLogs: [
        {
          id: makeId("audit"),
          time: nowText(),
          actor,
          action,
          summary,
          status,
        },
        ...nextState.auditLogs,
      ],
    };
    if (this.store.isDatabaseMode() && previous) {
      return this.store.saveIncremental(previous, withAudit);
    }
    return this.store.save(withAudit);
  }

  private async enqueueDelivery(tenantId: string, delivery: NotificationDelivery, action: NotificationQueueJob["action"]): Promise<void> {
    if (!["queued", "retry", "scheduled"].includes(delivery.status)) {
      return;
    }
    await this.notificationQueue.enqueue({
      id: makeId("notification-job"),
      tenantId,
      notificationId: delivery.notificationId,
      deliveryId: delivery.id,
      channel: delivery.channel,
      recipient: delivery.recipient,
      action,
      runAt: delivery.nextRetryAt ?? delivery.scheduledFor,
      attempt: delivery.attempts,
      createdAt: nowText(),
    });
  }
}

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function nowText(): string {
  return new Date().toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(/\//g, "-");
}

export function currency(value: number): string {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scopeSnapshotForContext(state: AppSnapshot, context: RequestContext): AppSnapshot {
  if (context.role === "admin") {
    return withFinanceCollections(state);
  }
  const visibleStudentIds = visibleStudentIdsForContext(state, context);
  const canSeeFinance = context.role === "finance";
  const canSeeOwnTeaching = context.role === "teacher";
  const canSeeOperationalStudents = context.role === "assistant" || context.role === "readonly" || context.role === "finance";
  const studentIsVisible = (studentId?: string) => {
    if (!studentId) return true;
    return canSeeOperationalStudents || visibleStudentIds.has(studentId);
  };
  const lessons = (state.lessons ?? []).filter((lesson) => studentIsVisible(lesson.studentId) && (context.role !== "teacher" || teacherMatchesContext(lesson.teacher, context) || visibleStudentIds.has(lesson.studentId)));
  const lessonIds = new Set(lessons.map((lesson) => lesson.id));
  const students = (state.students ?? [])
    .filter((student) => studentIsVisible(student.id))
    .map((student) => redactStudentForContext(student, context, visibleStudentIds.has(student.id)));
  const orders = canSeeFinance ? state.orders ?? [] : [];
  const visibleOrderIds = new Set(orders.map((order) => order.id));
  const payrollRecords = canSeeFinance
    ? state.payrollRecords ?? []
    : canSeeOwnTeaching
      ? (state.payrollRecords ?? []).filter((record) => teacherMatchesContext(record.teacherName, context))
      : [];
  const payrollRules = canSeeFinance
    ? state.payrollRules ?? []
    : canSeeOwnTeaching
      ? (state.payrollRules ?? []).filter((rule) => teacherMatchesContext(rule.teacherName, context))
      : [];
  const ragDocs = (state.ragDocs ?? []).filter((doc) => canSeeKnowledgeDoc(doc, context, visibleStudentIds));
  const visibleDocIds = new Set(ragDocs.map((doc) => doc.id));
  const financialActionPattern = /收款|退款|发票|开票|课酬|财务|订单|账|payroll|invoice|refund|payment/i;
  return {
    ...withFinanceCollections(state),
    students,
    lessons,
    orders,
    lessonLedgerEntries: (state.lessonLedgerEntries ?? []).filter((entry) => studentIsVisible(entry.studentId) && (!entry.lessonId || lessonIds.has(entry.lessonId) || canSeeOperationalStudents)),
    paymentLedgerEntries: canSeeFinance ? (state.paymentLedgerEntries ?? []).filter((entry) => visibleOrderIds.has(entry.orderId)) : [],
    invoices: canSeeFinance ? (state.invoices ?? []).filter((invoice) => visibleOrderIds.has(invoice.orderId)) : [],
    refunds: canSeeFinance ? (state.refunds ?? []).filter((refund) => visibleOrderIds.has(refund.orderId)) : [],
    financialLedgerEntries: canSeeFinance ? state.financialLedgerEntries ?? [] : [],
    financialAccounts: canSeeFinance ? state.financialAccounts ?? [] : [],
    accountingPeriodLocks: canSeeFinance ? state.accountingPeriodLocks ?? [] : [],
    reconciliationRuns: canSeeFinance ? state.reconciliationRuns ?? [] : [],
    payrollRules,
    payrollRecords,
    notifications: (state.notifications ?? []).filter((note) => canSeeFinance || !financialActionPattern.test(`${note.type} ${note.title} ${note.content}`)),
    notificationDeliveries: state.notificationDeliveries ?? [],
    tasks: (state.tasks ?? []).filter((task) => !task.studentId || studentIsVisible(task.studentId)),
    auditLogs: (state.auditLogs ?? []).filter((log) => canSeeFinance || !financialActionPattern.test(`${log.action} ${log.summary}`)),
    ragDocs,
    knowledgeChunks: (state.knowledgeChunks ?? []).filter((chunk) => visibleDocIds.has(chunk.docId)),
    agentApprovals: canSeeFinance ? state.agentApprovals ?? [] : [],
  };
}

function withFinanceCollections(state: AppSnapshot): AppSnapshot {
  return {
    ...state,
    financialAccounts: state.financialAccounts ?? [],
    accountingPeriodLocks: state.accountingPeriodLocks ?? [],
    reconciliationRuns: state.reconciliationRuns ?? [],
  };
}

function visibleStudentIdsForContext(state: AppSnapshot, context: RequestContext): Set<string> {
  if (context.role !== "teacher") {
    return new Set((state.students ?? []).map((student) => student.id));
  }
  const ids = new Set<string>();
  for (const student of state.students ?? []) {
    if (teacherMatchesContext(student.teacher, context)) {
      ids.add(student.id);
    }
  }
  for (const lesson of state.lessons ?? []) {
    if (teacherMatchesContext(lesson.teacher, context)) {
      ids.add(lesson.studentId);
    }
  }
  return ids;
}

function redactStudentForContext(student: Student, context: RequestContext, directlyVisible: boolean): Student {
  if (context.role === "teacher" && directlyVisible) {
    return student;
  }
  if (context.role === "assistant") {
    return { ...student, dueAmount: 0 };
  }
  if (context.role === "finance") {
    return {
      ...student,
      note: "",
      records: [],
      communications: [],
      growthPoints: 0,
    };
  }
  if (context.role === "readonly") {
    return {
      ...student,
      guardian: "已隐藏",
      phone: "已隐藏",
      note: "",
      dueAmount: 0,
      growthPoints: 0,
      records: [],
      communications: [],
    };
  }
  return student;
}

function teacherMatchesContext(value: string | undefined, context: RequestContext): boolean {
  const target = normalizePersonName(value);
  if (!target) return false;
  const candidates = [
    context.actorName,
    context.actorName.replace(/老师$/, ""),
    context.email?.split("@")[0],
    context.userId,
  ].map(normalizePersonName).filter(Boolean);
  return candidates.some((candidate) => target === candidate || target.includes(candidate) || candidate.includes(target));
}

function normalizePersonName(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/老师/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

function canSeeKnowledgeDoc(doc: KnowledgeDoc, context: RequestContext, visibleStudentIds: Set<string>): boolean {
  if (context.role === "admin") return true;
  const text = `${doc.title} ${doc.scope}`.toLowerCase();
  const metadataStudentId = typeof doc.metadata?.studentId === "string" ? doc.metadata.studentId : undefined;
  const isStudentDoc = Boolean(metadataStudentId) || /学员|学生|student/.test(text);
  const isFinanceDoc = /财务|收款|退款|发票|课酬|finance|payment|payroll|invoice|refund/.test(text);
  if (isFinanceDoc) {
    return context.role === "finance";
  }
  if (!isStudentDoc) {
    return true;
  }
  if (context.role === "finance" || context.role === "readonly") {
    return false;
  }
  if (!metadataStudentId) {
    return context.role === "assistant";
  }
  return visibleStudentIds.has(metadataStudentId);
}

function normalizeAccountingPeriod(value: string): string {
  const normalized = value.trim().replace(/\//g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})/);
  if (!match) {
    throw new ConflictException(`Invalid accounting period: ${value}`);
  }
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new ConflictException(`Invalid accounting period: ${value}`);
  }
  return `${match[1]}-${String(month).padStart(2, "0")}`;
}

function accountingPeriodFor(value: string): string {
  return normalizeAccountingPeriod(value || nowText());
}

function assertAccountingPeriodOpen(state: AppSnapshot, occurredAt: string) {
  const period = accountingPeriodFor(occurredAt);
  const lock = (state.accountingPeriodLocks ?? []).find((item) => item.period === period && item.status === "locked");
  if (lock) {
    throw new ConflictException(`Accounting period ${period} is locked`);
  }
}

function teacherIdForName(name: string): string {
  const normalized = name.trim().toLowerCase()
    .replace(/老师/g, "lao-shi")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `teacher-${normalized || "unknown"}`;
}

function hasFinancialSource(state: AppSnapshot, sourceType: FinancialLedgerEntry["sourceType"], sourceId: string): boolean {
  return (state.financialLedgerEntries ?? []).some((entry) => entry.sourceType === sourceType && entry.sourceId === sourceId);
}

function financialEntry(
  sourceType: FinancialLedgerEntry["sourceType"],
  sourceId: string,
  account: string,
  direction: FinancialLedgerEntry["direction"],
  amount: number,
  studentId: string | undefined,
  occurredAt: string,
): FinancialLedgerEntry {
  return {
    id: makeId("fin-ledger"),
    sourceType,
    sourceId,
    studentId,
    account,
    direction,
    amount: Math.abs(Number(amount || 0)),
    occurredAt,
    createdAt: nowText(),
  };
}

function invoiceFinancialEntries(invoice: Invoice, order: Order): FinancialLedgerEntry[] {
  return [
    financialEntry("invoice", invoice.id, "应收账款", "debit", invoice.amount, order.studentId, invoice.issuedAt ?? nowText()),
    financialEntry("invoice", invoice.id, "课程收入", "credit", invoice.amount, order.studentId, invoice.issuedAt ?? nowText()),
  ];
}

function paymentFinancialEntries(entry: PaymentLedgerEntry): FinancialLedgerEntry[] {
  const amount = Math.abs(entry.amountDelta);
  if (amount <= 0) return [];
  if (entry.amountDelta < 0) {
    return refundFinancialEntries({
      id: entry.id,
      orderId: entry.orderId,
      studentId: entry.studentId,
      amount,
      occurredAt: entry.occurredAt,
    });
  }
  return [
    financialEntry("payment", entry.id, "银行存款", "debit", amount, entry.studentId, entry.occurredAt),
    financialEntry("payment", entry.id, "应收账款", "credit", amount, entry.studentId, entry.occurredAt),
  ];
}

function refundFinancialEntries(input: { id: string; orderId: string; studentId?: string; amount: number; occurredAt: string }): FinancialLedgerEntry[] {
  return [
    financialEntry("refund", input.id, "退款支出", "debit", input.amount, input.studentId, input.occurredAt),
    financialEntry("refund", input.id, "银行存款", "credit", input.amount, input.studentId, input.occurredAt),
  ];
}

function payrollConfirmFinancialEntries(record: PayrollRecord): FinancialLedgerEntry[] {
  const occurredAt = record.confirmedAt ?? nowText();
  return [
    financialEntry("payroll_confirm", record.id, "教师课酬", "debit", record.amount, undefined, occurredAt),
    financialEntry("payroll_confirm", record.id, "应付课酬", "credit", record.amount, undefined, occurredAt),
  ];
}

function payrollSettleFinancialEntries(record: PayrollRecord): FinancialLedgerEntry[] {
  const occurredAt = record.settledAt ?? nowText();
  return [
    financialEntry("payroll_settle", record.id, "应付课酬", "debit", record.amount, undefined, occurredAt),
    financialEntry("payroll_settle", record.id, "银行存款", "credit", record.amount, undefined, occurredAt),
  ];
}

function matchPayrollRule(rules: PayrollRule[], lesson: Lesson): PayrollRule | undefined {
  return rules.find((rule) => rule.status === "active" && rule.teacherName === lesson.teacher && (!rule.courseName || rule.courseName === lesson.title))
    ?? rules.find((rule) => rule.status === "active" && rule.teacherName === lesson.teacher)
    ?? rules.find((rule) => rule.status === "active" && !rule.teacherName);
}

function payrollAmountForLesson(rule: PayrollRule | undefined, lesson: Lesson): number {
  if (!rule) {
    return Math.round(lesson.price * 0.5);
  }
  if (rule.ruleType === "percent_of_lesson_price") {
    return Math.round(lesson.price * rule.amount);
  }
  return Math.round(rule.amount);
}

function payrollRuleLabel(rule: PayrollRule): string {
  return rule.ruleType === "percent_of_lesson_price"
    ? `按课消金额 ${Math.round(rule.amount * 100)}%`
    : `每课 ${currency(rule.amount)}`;
}

function amountFromText(text: string): number | undefined {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块|rmb|¥)?/i);
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function findOrderForCommand(state: AppSnapshot, text: string, studentId?: string): Order | undefined {
  const byStudentId = studentId ? state.orders.find((order) => order.studentId === studentId) : undefined;
  if (studentId && byStudentId && !mentionsOtherStudent(state, text, studentId)) {
    return byStudentId;
  }
  const explicitStudent = state.students.find((student) => text.includes(student.name) || text.includes(student.short));
  if (explicitStudent) {
    return state.orders.find((order) => order.studentId === explicitStudent.id && order.status !== "已结清")
      ?? state.orders.find((order) => order.studentId === explicitStudent.id);
  }
  const explicitOrder = state.orders.find((order) => text.includes(order.invoice) || text.includes(order.name));
  if (explicitOrder) {
    return explicitOrder;
  }
  return state.orders.find((order) => order.status !== "已结清") ?? state.orders[0];
}

function mentionsOtherStudent(state: AppSnapshot, text: string, studentId: string): boolean {
  return state.students.some((student) => student.id !== studentId && (text.includes(student.name) || text.includes(student.short)));
}

function teacherNameFromText(text: string, lessons: Lesson[]): string | undefined {
  return [...new Set(lessons.map((lesson) => lesson.teacher))]
    .find((teacher) => text.includes(teacher) || text.includes(teacher.replace(/老师$/, "")));
}

function assertTaskCanMutate(task: BusinessTask, expectedVersion?: number) {
  if (task.status !== "等待确认") {
    throw new ConflictException(`Business task is not waiting for confirmation: ${task.status}`);
  }
  if (expectedVersion != null && task.expectedVersion !== expectedVersion) {
    throw new ConflictException(`Business task version conflict: expected ${expectedVersion}, current ${task.expectedVersion}`);
  }
}

function assertTaskChecksPass(task: BusinessTask) {
  const failedChecks = task.checks.filter((check) => !check.ok);
  if (failedChecks.length) {
    throw new ConflictException(`Business task has unresolved checks: ${failedChecks.map((check) => check.label).join(", ")}`);
  }
}

function assertLedgerEntryCanReverse<T extends { id: string; reversesEntryId?: string }>(entries: T[], entryId: string, type: string) {
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new ConflictException(`${type} ledger entry not found: ${entryId}`);
  }
  if (entry.reversesEntryId) {
    throw new ConflictException(`${type} ledger reversal entries cannot be reversed again`);
  }
  if (entries.some((item) => item.reversesEntryId === entryId)) {
    throw new ConflictException(`${type} ledger entry is already reversed`);
  }
}

type ScheduleConflictKind = "teacher" | "room" | "student";

interface ScheduleConflict {
  kind: ScheduleConflictKind;
  lesson: Lesson;
}

function assertLessonCanSchedule(lessons: Lesson[], candidate: Lesson, ignoreLessonId?: string) {
  const conflicts = findScheduleConflicts(lessons, candidate, ignoreLessonId);
  if (conflicts.length) {
    throw new ConflictException(`Schedule conflict: ${conflicts.map(formatScheduleConflict).join("; ")}`);
  }
}

function findScheduleConflicts(lessons: Lesson[], candidate: Lesson, ignoreLessonId?: string): ScheduleConflict[] {
  assertValidLessonTime(candidate);
  const conflicts: ScheduleConflict[] = [];
  for (const lesson of lessons) {
    if (lesson.id === ignoreLessonId || lesson.status === "已取消") {
      continue;
    }
    if (!isSameScheduleDate(lesson, candidate) || !lessonTimeOverlaps(lesson, candidate)) {
      continue;
    }
    if (lesson.teacher && candidate.teacher && lesson.teacher === candidate.teacher) {
      conflicts.push({ kind: "teacher", lesson });
    }
    if (lesson.room && candidate.room && lesson.room === candidate.room) {
      conflicts.push({ kind: "room", lesson });
    }
    if (lesson.studentId && candidate.studentId && lesson.studentId === candidate.studentId) {
      conflicts.push({ kind: "student", lesson });
    }
  }
  return conflicts;
}

function hasScheduleConflict(conflicts: ScheduleConflict[], kind: ScheduleConflictKind): boolean {
  return conflicts.some((conflict) => conflict.kind === kind);
}

function formatScheduleConflict(conflict: ScheduleConflict): string {
  const labels: Record<ScheduleConflictKind, string> = {
    teacher: "教师",
    room: "教室",
    student: "学员",
  };
  return `${labels[conflict.kind]}冲突：${conflict.lesson.title} ${conflict.lesson.date} ${conflict.lesson.start}-${conflict.lesson.end}`;
}

function buildRescheduledLesson(lesson: Lesson, target?: string): Lesson {
  const parsed = parseScheduleTarget(target);
  return {
    ...lesson,
    date: parsed.date ?? lesson.date,
    day: parsed.day ?? lesson.day,
    start: parsed.start ?? lesson.start,
    end: parsed.end ?? lesson.end,
    status: "已确认",
  };
}

function parseScheduleTarget(target?: string): { date?: string; day?: number; start?: string; end?: string } {
  if (!target) {
    return {};
  }
  const dateMatch = target.match(/(\d{1,2})[/-](\d{1,2})/);
  const timeMatch = target.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/);
  return {
    date: dateMatch ? `${dateMatch[1].padStart(2, "0")}/${dateMatch[2].padStart(2, "0")}` : undefined,
    day: dayIndexFromText(target),
    start: timeMatch?.[1],
    end: timeMatch?.[2],
  };
}

function dayIndexFromText(text: string): number | undefined {
  const match = text.match(/周([一二三四五六日天])/);
  if (!match) {
    return undefined;
  }
  return { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 }[match[1] as "一"];
}

function assertValidLessonTime(lesson: Lesson) {
  const start = timeToMinutes(lesson.start);
  const end = timeToMinutes(lesson.end);
  if (start == null || end == null || start >= end) {
    throw new ConflictException(`Invalid lesson time range: ${lesson.start}-${lesson.end}`);
  }
}

function isSameScheduleDate(left: Lesson, right: Lesson): boolean {
  const leftDate = normalizeLessonDate(left.date);
  const rightDate = normalizeLessonDate(right.date);
  if (leftDate && rightDate) {
    return leftDate === rightDate;
  }
  return left.day === right.day;
}

function lessonTimeOverlaps(left: Lesson, right: Lesson): boolean {
  const leftStart = timeToMinutes(left.start);
  const leftEnd = timeToMinutes(left.end);
  const rightStart = timeToMinutes(right.start);
  const rightEnd = timeToMinutes(right.end);
  if (leftStart == null || leftEnd == null || rightStart == null || rightEnd == null) {
    return false;
  }
  return leftStart < rightEnd && rightStart < leftEnd;
}

function normalizeLessonDate(value: string): string {
  const isoMatch = value.match(/\d{4}[/-](\d{1,2})[/-](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1].padStart(2, "0")}/${isoMatch[2].padStart(2, "0")}`;
  }
  const match = value.match(/(\d{1,2})[/-](\d{1,2})/);
  return match ? `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}` : "";
}

function buildScheduleCandidate(state: AppSnapshot, input: SchedulePreviewInput): Lesson {
  const student = state.students.find((item) => item.id === input.studentId) ?? state.students[0];
  const normalizedDate = input.date ? normalizeLessonDate(input.date) : normalizeLessonDate(nowText());
  const dayFromDate = input.date ? dayIndexFromDate(input.date) : undefined;
  return {
    id: input.ignoreLessonId ?? "preview-lesson",
    day: Number(input.day ?? dayFromDate ?? 0),
    date: normalizedDate || "01/01",
    start: input.startTime || "09:00",
    end: input.endTime || "10:00",
    title: input.title || student.teacherCourse || "课程",
    type: input.type || "一对一",
    studentId: student.id,
    studentName: student.name,
    teacher: input.teacher || student.teacher || "林老师",
    room: input.room || "教室A",
    status: "已确认",
    color: input.type === "固定班" ? "purple" : input.type === "小组课" ? "orange" : "green",
    attendance: "未开始",
    package: student.packageName,
    remaining: `${student.remainingHours} 课时`,
    price: Number(input.price ?? 180),
  };
}

function dayIndexFromDate(value: string): number | undefined {
  const normalized = value.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/)?.[0]?.replace(/\//g, "-");
  if (!normalized) {
    return undefined;
  }
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  const jsDay = parsed.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function chunkKnowledgeContent(content: string): string[] {
  const normalized = content.replace(/\r/g, "").trim();
  if (!normalized) {
    return [];
  }
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
    if ((current + "\n" + paragraph).trim().length > 520 && current) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = `${current}\n${paragraph}`.trim();
    }
  }
  if (current) {
    chunks.push(current.trim());
  }
  return chunks.length ? chunks : [normalized.slice(0, 520)];
}

function parseKnowledgeUpload(input: KnowledgeUploadInput): { title: string; text: string; mimeType: string; parser: string } {
  const title = input.fileName?.trim() || "未命名知识文档";
  const mimeType = normalizeMimeType(input.mimeType, title);
  const rawText = input.text ?? (input.contentBase64 ? Buffer.from(input.contentBase64, "base64").toString("utf8") : "");
  if (!rawText.trim()) {
    throw new ConflictException("Uploaded knowledge document is empty");
  }
  if (mimeType.includes("json")) {
    return { title, mimeType, parser: "upload-json", text: parseJsonKnowledgeText(rawText) };
  }
  if (mimeType.includes("csv")) {
    return { title, mimeType, parser: "upload-csv", text: parseCsvKnowledgeText(rawText) };
  }
  if (isTextKnowledgeMime(mimeType)) {
    return { title, mimeType, parser: mimeType.includes("markdown") ? "upload-markdown" : "upload-text", text: rawText };
  }
  throw new ConflictException(`Unsupported knowledge upload mime type: ${mimeType}`);
}

function normalizeMimeType(value: string | undefined, fileName: string): string {
  if (value?.trim()) {
    return value.trim().toLowerCase();
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".json")) return "application/json";
  return "text/plain";
}

function isTextKnowledgeMime(mimeType: string): boolean {
  return mimeType.startsWith("text/")
    || mimeType === "application/xml"
    || mimeType === "application/yaml"
    || mimeType === "application/x-yaml";
}

function parseJsonKnowledgeText(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    return flattenJsonForKnowledge(parsed).join("\n");
  } catch {
    throw new ConflictException("Uploaded JSON knowledge document is invalid");
  }
}

function flattenJsonForKnowledge(value: unknown, path = "$"): string[] {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [`${path}: ${String(value ?? "")}`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenJsonForKnowledge(item, `${path}[${index}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => flattenJsonForKnowledge(item, `${path}.${key}`));
}

function parseCsvKnowledgeText(rawText: string): string {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.split(",").map((cell) => cell.trim()).filter(Boolean).join(" | "))
    .filter(Boolean)
    .join("\n");
}

function isKnowledgeDocSearchable(doc: KnowledgeDoc, filters: KnowledgeSearchFilters, asOf: Date): boolean {
  if (filters.scope && doc.scope !== filters.scope) {
    return false;
  }
  const expectedStatus = filters.status || "生效中";
  if (doc.status !== expectedStatus) {
    return false;
  }
  if (doc.invalidatedAt) {
    return false;
  }
  if (filters.includeExpired) {
    return true;
  }
  const effectiveFrom = parseOptionalDate(doc.effectiveFrom);
  if (effectiveFrom && effectiveFrom > asOf) {
    return false;
  }
  const expiresAt = parseOptionalDate(doc.expiresAt);
  return !expiresAt || expiresAt >= asOf;
}

function parseOptionalDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value.replace(/\//g, "-"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function scoreKnowledgeChunk(query: string, chunk: KnowledgeChunk): number {
  return scoreText(query, `${chunk.title} ${chunk.scope} ${chunk.content}`);
}

function scoreText(query: string, text: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedText = text.toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }
  let score = normalizedText.includes(normalizedQuery) ? 2 : 0;
  const terms = tokenizeSearchText(normalizedQuery);
  for (const term of terms) {
    if (term.length > 1 && normalizedText.includes(term)) {
      score += 1;
    }
  }
  return score;
}

function tokenizeSearchText(text: string): string[] {
  const parts = text
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length) {
    return parts;
  }
  return [...new Set([...text].filter((char) => /\p{L}|\p{N}/u.test(char)))];
}

function excerptForQuery(content: string, query: string): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.trim().toLowerCase();
  const terms = [lowerQuery, ...tokenizeSearchText(lowerQuery)].filter(Boolean);
  const firstHit = terms
    .map((term) => lowerContent.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, firstHit - 40);
  const excerpt = content.slice(start, start + 140);
  return `${start > 0 ? "..." : ""}${excerpt}${start + 140 < content.length ? "..." : ""}`;
}

function verifyChannelCallback(input: ChannelCallbackInput) {
  const secret = process.env.WECOM_CALLBACK_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new UnauthorizedException("WECOM_CALLBACK_SECRET is required in production");
  }
  if (!secret) {
    return;
  }
  if (!input.timestamp || !input.nonce || !input.signature) {
    throw new UnauthorizedException("Missing channel callback signature fields");
  }
  const expected = createHmac("sha256", secret).update(channelSignaturePayload(input)).digest("hex");
  if (!safeEqualString(expected, input.signature)) {
    throw new UnauthorizedException("Invalid channel callback signature");
  }
}

function channelSignaturePayload(input: ChannelCallbackInput): string {
  return [
    input.channel ?? "wecom",
    input.timestamp ?? "",
    input.nonce ?? "",
    input.messageId ?? "",
    input.fromUser ?? "",
    input.text ?? "",
    input.action ?? "",
    input.taskId ?? "",
  ].join("\n");
}

function safeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function upsertChannelAccount(
  accounts: ChannelAccount[],
  input: {
    channelId: string;
    channelType: ChannelIntegration["type"];
    externalUserId: string;
    displayName: string;
    context: RequestContext;
  },
): { account: ChannelAccount; accounts: ChannelAccount[] } {
  const existing = accounts.find((account) => account.channelType === input.channelType && account.externalUserId === input.externalUserId);
  if (existing) {
    const updated = { ...existing, displayName: input.displayName, updatedAt: nowText() };
    return {
      account: updated,
      accounts: accounts.map((account) => account.id === existing.id ? updated : account),
    };
  }
  const account: ChannelAccount = {
    id: makeId("channel-account"),
    channelId: input.channelId,
    channelType: input.channelType,
    externalUserId: input.externalUserId,
    displayName: input.displayName,
    linkedUserId: input.context.userId,
    status: "bound",
    createdAt: nowText(),
    updatedAt: nowText(),
  };
  return { account, accounts: [account, ...accounts] };
}

function timeToMinutes(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function applyLedgerReadModels(state: AppSnapshot): AppSnapshot {
  return applyPaymentLedgerReadModel(applyLessonLedgerReadModel(state));
}

function applyLessonLedgerReadModel(state: AppSnapshot): AppSnapshot {
  const students = state.students.map((student) => {
    const ledgerDelta = sumLessonLedgerForStudent(state.lessonLedgerEntries, student.id);
    const baseRemainingHours = student.baseRemainingHours ?? student.remainingHours - ledgerDelta;
    const remainingHours = Math.max(0, baseRemainingHours + ledgerDelta);
    return {
      ...student,
      baseRemainingHours,
      remainingHours,
    };
  });
  const remainingByStudent = new Map(students.map((student) => [student.id, student.remainingHours]));
  const lessons = state.lessons.map((lesson) => {
    const remainingHours = remainingByStudent.get(lesson.studentId);
    if (remainingHours == null) {
      return lesson;
    }
    return { ...lesson, remaining: formatLessonRemaining(lesson.remaining, remainingHours) };
  });
  return { ...state, students, lessons };
}

function applyPaymentLedgerReadModel(state: AppSnapshot): AppSnapshot {
  return {
    ...state,
    orders: state.orders.map((order) => {
      const paid = clamp(sumPaymentLedgerForOrder(state.paymentLedgerEntries, order.id), 0, order.amount);
      return {
        ...order,
        paid,
        status: paid >= order.amount ? "已结清" : paid > 0 ? "部分已付" : "待收款",
        due: paid >= order.amount ? "已结清" : order.due === "已结清" ? "待确认" : order.due,
      };
    }),
  };
}

function sumLessonLedgerForStudent(entries: LessonLedgerEntry[], studentId: string): number {
  return entries
    .filter((entry) => entry.studentId === studentId)
    .reduce((sum, entry) => sum + entry.hoursDelta, 0);
}

function sumLessonLedger(entries: LessonLedgerEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.hoursDelta, 0);
}

function sumPaymentLedgerForOrder(entries: PaymentLedgerEntry[], orderId: string): number {
  return entries
    .filter((entry) => entry.orderId === orderId)
    .reduce((sum, entry) => sum + entry.amountDelta, 0);
}

function sumPaymentLedger(entries: PaymentLedgerEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.amountDelta, 0);
}

function aggregatePaymentTrend(entries: PaymentLedgerEntry[]): number[] {
  const byDate = new Map<string, number>();
  for (const entry of entries) {
    const key = dateKey(entry.occurredAt);
    byDate.set(key, (byDate.get(key) ?? 0) + entry.amountDelta);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, amount]) => amount);
}

function aggregateAttendance(state: AppSnapshot): { present: number; total: number } {
  const recordStatuses = state.students.flatMap((student) => student.records.map((record) => record.status));
  const statuses = recordStatuses.length
    ? recordStatuses
    : state.lessons.filter((lesson) => lesson.attendance !== "未开始").map((lesson) => lesson.attendance);
  return {
    present: statuses.filter(isPresentAttendanceStatus).length,
    total: statuses.length,
  };
}

function isPresentAttendanceStatus(status: string): boolean {
  return /已到课|已完成|准时|迟到/.test(status);
}

function aggregateTeacherPayroll(state: AppSnapshot): Array<{ teacher: string; lessons: number; pay: number }> {
  if ((state.payrollRecords ?? []).length) {
    const byTeacher = new Map<string, { teacher: string; lessons: number; pay: number }>();
    for (const record of state.payrollRecords ?? []) {
      const row = byTeacher.get(record.teacherName) ?? { teacher: record.teacherName, lessons: 0, pay: 0 };
      row.lessons += 1;
      row.pay += record.amount;
      byTeacher.set(record.teacherName, row);
    }
    return [...byTeacher.values()].sort((left, right) => right.pay - left.pay || left.teacher.localeCompare(right.teacher));
  }
  const byTeacher = new Map<string, { teacher: string; lessons: number; pay: number }>();
  for (const lesson of state.lessons) {
    if (!isBillableLesson(lesson)) {
      continue;
    }
    const row = byTeacher.get(lesson.teacher) ?? { teacher: lesson.teacher, lessons: 0, pay: 0 };
    row.lessons += 1;
    row.pay += lesson.price;
    byTeacher.set(lesson.teacher, row);
  }
  return [...byTeacher.values()].sort((left, right) => right.pay - left.pay || left.teacher.localeCompare(right.teacher));
}

function isBillableLesson(lesson: Lesson): boolean {
  return lesson.attendance === "已到课" || lesson.status === "已结束";
}

function dateKey(value: string): string {
  const match = value.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})[-/](\d{1,2})/);
  if (!match) {
    return value;
  }
  if (match[1]) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }
  return `0000-${match[4].padStart(2, "0")}-${match[5].padStart(2, "0")}`;
}

function formatLessonRemaining(current: string, remainingHours: number): string {
  const total = current.match(/\/\s*([0-9.]+)\s*课时/)?.[1];
  return total ? `${remainingHours} / ${total} 课时` : `${remainingHours} 课时`;
}

function createNotificationDelivery(note: NotificationDraft, actorId: string, attempts = 1, existingId?: string): NotificationDelivery {
  const now = nowText();
  const channel = notificationChannelState(note.channel);
  if (channel.kind === "internal") {
    return {
      id: existingId ?? makeId("delivery"),
      notificationId: note.id,
      channel: note.channel,
      recipient: note.recipient,
      status: "sent",
      providerMessageId: `local-${actorId}-${makeId("message")}`,
      attempts,
      createdAt: now,
      updatedAt: now,
    };
  }
  if (channel.connected) {
    return {
      id: existingId ?? makeId("delivery"),
      notificationId: note.id,
      channel: note.channel,
      recipient: note.recipient,
      status: "queued",
      attempts,
      createdAt: now,
      updatedAt: now,
    };
  }
  const retrying = attempts > 1 && attempts < 3;
  return {
    id: existingId ?? makeId("delivery"),
    notificationId: note.id,
    channel: note.channel,
    recipient: note.recipient,
    status: retrying ? "retry" : "failed",
    errorMessage: `${channel.name}未连接或缺少环境变量凭据`,
    attempts,
    nextRetryAt: retrying ? new Date(Date.now() + attempts * 5 * 60 * 1000).toISOString() : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

function createScheduledDelivery(note: NotificationDraft, actorId: string, scheduledFor: string): NotificationDelivery {
  const now = nowText();
  return {
    id: makeId("delivery"),
    notificationId: note.id,
    channel: note.channel,
    recipient: note.recipient,
    status: "scheduled",
    providerMessageId: `scheduled-${actorId}-${makeId("message")}`,
    attempts: 0,
    scheduledFor,
    createdAt: now,
    updatedAt: now,
  };
}

function notificationChannelState(channel: string): { connected: boolean; name: string; kind: "internal" | "external" } {
  if (channel === "站内") {
    return { connected: true, name: "站内通知", kind: "internal" };
  }
  if (/企业微信|企微/.test(channel)) {
    return { connected: isNotificationChannelConfigured(channel), name: "企业微信", kind: "external" };
  }
  if (/微信/.test(channel)) {
    return { connected: isNotificationChannelConfigured(channel), name: "微信", kind: "external" };
  }
  if (/飞书/.test(channel)) {
    return { connected: isNotificationChannelConfigured(channel), name: "飞书", kind: "external" };
  }
  if (/钉钉/.test(channel)) {
    return { connected: isNotificationChannelConfigured(channel), name: "钉钉", kind: "external" };
  }
  return { connected: false, name: channel || "未知渠道", kind: "external" };
}

function notificationPatchFromDelivery(delivery: NotificationDelivery): Pick<NotificationDraft, "status" | "sentRate"> {
  if (delivery.status === "sent") {
    return { status: "已发送", sentRate: "已送达" };
  }
  if (delivery.status === "queued" || delivery.status === "retry") {
    return { status: "待发送", sentRate: "队列中" };
  }
  return { status: "发送失败", sentRate: delivery.errorMessage ?? "发送失败" };
}

function auditStatusFromDelivery(delivery: NotificationDelivery): string {
  if (delivery.status === "sent") return "已发送";
  if (delivery.status === "queued" || delivery.status === "retry") return "已入队";
  return "发送失败";
}

function notificationSummary(note: NotificationDraft, delivery: NotificationDelivery): string {
  if (delivery.status === "sent") {
    return `${note.title}已通过${note.channel}发送`;
  }
  if (delivery.status === "queued") {
    return `${note.title}已进入${note.channel}发送队列`;
  }
  if (delivery.status === "retry") {
    return `${note.title}已进入重试队列`;
  }
  return `${note.title}投递失败：${delivery.errorMessage}`;
}

function markDeliverySent(delivery: NotificationDelivery, providerMessageId?: string): NotificationDelivery {
  return {
    ...delivery,
    status: "sent",
    providerMessageId: providerMessageId ?? delivery.providerMessageId,
    errorMessage: undefined,
    attempts: Math.max(1, delivery.attempts),
    nextRetryAt: undefined,
    updatedAt: nowText(),
  };
}

function markDeliveryFailed(delivery: NotificationDelivery, errorMessage: string): NotificationDelivery {
  const attempts = delivery.attempts + 1;
  const shouldRetry = attempts < 3;
  return {
    ...delivery,
    status: shouldRetry ? "retry" : "failed",
    errorMessage,
    attempts,
    nextRetryAt: shouldRetry ? new Date(Date.now() + attempts * 5 * 60 * 1000).toISOString() : undefined,
    updatedAt: nowText(),
  };
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  return [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")),
  ].join("\n");
}


function parseDate(text: string): Date {
  const parts = text.split(/[-/]/);
  if (parts.length === 3) {
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const day = Number(parts[2]);
    return new Date(year, month, day);
  }
  return new Date();
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function freshServiceForTests() {
  return {
    state: cloneSeedState(),
  };
}
