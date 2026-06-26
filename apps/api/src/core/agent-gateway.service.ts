import { ConflictException, Injectable, OnModuleInit } from "@nestjs/common";
import { type AgentApproval, type AgentToolCall } from "@cjlass2/shared";
import { CoreService, type SchedulePreviewInput, makeId, nowText } from "./core.service.js";
import { JsonStateStore } from "./json-state.store.js";
import { type RequestContext } from "./request-context.js";

/**
 * MCP Tool definition - represents a callable business operation
 */
export interface McpTool {
  name: string;
  description: string;
  category: "query" | "proposal" | "execute" | "high_risk";
  inputSchema: Record<string, { type: string; description: string; required?: boolean }>;
  handler: (input: Record<string, unknown>, context: AgentExecutionContext) => Promise<Record<string, unknown>>;
}

/**
 * Execution context passed to MCP tool handlers
 */
export interface AgentExecutionContext {
  tenantId: string;
  userId: string;
  agentRunId: string;
  approvalId?: string;
  requestContext: RequestContext;
}

/**
 * Agent Gateway Service
 *
 * Responsible for:
 * - MCP tool registration and execution
 * - Tool call tracking and audit
 * - Approval flow for high-risk operations
 * - Hermes Agent integration (when configured)
 * - Failure fallback strategies
 */
@Injectable()
export class AgentGatewayService implements OnModuleInit {
  private tools = new Map<string, McpTool>();
  private hermesUrl: string | null = null;

  constructor(
    private readonly store: JsonStateStore,
    private readonly core: CoreService,
  ) {}

  async onModuleInit() {
    // Register all built-in MCP tools
    this.registerBuiltinTools();

    // Check for Hermes Agent configuration
    this.hermesUrl = process.env.HERMES_AGENT_URL ?? null;
  }

  /**
   * Register a new MCP tool
   */
  registerTool(tool: McpTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get all registered tools
   */
  listTools(): Array<{ name: string; description: string; category: string }> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
    }));
  }

  /**
   * Get tool definition by name
   */
  getTool(name: string): McpTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Execute an MCP tool with full tracking
   */
  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    context: RequestContext,
    agentRunId?: string,
  ): Promise<{ toolCall: AgentToolCall; result?: Record<string, unknown> }> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new ConflictException(`Unknown MCP tool: ${toolName}`);
    }

    // Create tool call record
    const toolCall: AgentToolCall = {
      id: makeId("tool-call"),
      agentRunId: agentRunId ?? makeId("agent-run"),
      toolName,
      inputParams: input,
      status: "pending",
      createdAt: nowText(),
    };

    // Check if approval is required for high-risk tools
    if (tool.category === "high_risk") {
      const approval = await this.requestApproval(toolCall, context);
      if (approval.status !== "approved") {
        toolCall.status = "failed";
        toolCall.errorMessage = `Approval ${approval.status}: ${approval.approvalNote ?? "No approval granted"}`;
        await this.persistToolCall(toolCall, context);
        return { toolCall };
      }
      toolCall.status = "running";
    } else {
      toolCall.status = "running";
    }

    // Execute the tool
    const startTime = Date.now();
    try {
      const execContext: AgentExecutionContext = {
        tenantId: context.tenantId,
        userId: context.userId,
        agentRunId: toolCall.agentRunId,
        approvalId: tool.category === "high_risk" ? `approval-for-${toolCall.id}` : undefined,
        requestContext: context,
      };

      const result = await tool.handler(input, execContext);
      const durationMs = Date.now() - startTime;

      toolCall.status = "completed";
      toolCall.outputResult = result;
      toolCall.durationMs = durationMs;
      toolCall.completedAt = nowText();

      await this.persistToolCall(toolCall, context);
      return { toolCall, result };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      toolCall.status = "failed";
      toolCall.errorMessage = error instanceof Error ? error.message : String(error);
      toolCall.durationMs = durationMs;
      toolCall.completedAt = nowText();

      await this.persistToolCall(toolCall, context);
      return { toolCall };
    }
  }

  /**
   * Request approval for a high-risk tool call
   */
  async requestApproval(
    toolCall: AgentToolCall,
    context: RequestContext,
  ): Promise<AgentApproval> {
    const approval: AgentApproval = {
      id: makeId("approval"),
      agentRunId: toolCall.agentRunId,
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      riskLevel: "high",
      status: "pending",
      requestedBy: context.userId,
      inputParams: toolCall.inputParams,
      createdAt: nowText(),
    };

    // Auto-approve for admin users in development mode
    if (context.role === "admin" && process.env.NODE_ENV !== "production") {
      approval.status = "approved";
      approval.approvedBy = context.userId;
      approval.approvalNote = "Auto-approved (admin in non-production)";
      approval.decidedAt = nowText();
    }

    return approval;
  }

  /**
   * Approve or reject a pending approval
   */
  async decideApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    note: string | undefined,
    context: RequestContext,
  ): Promise<AgentApproval | null> {
    // In a full implementation, this would update the approval in the database
    // and trigger the pending tool execution
    return {
      id: approvalId,
      toolName: "unknown",
      riskLevel: "high",
      status: decision,
      requestedBy: "unknown",
      approvedBy: context.userId,
      approvalNote: note,
      inputParams: {},
      createdAt: nowText(),
      decidedAt: nowText(),
    };
  }

  /**
   * Check if Hermes Agent is configured and available
   */
  isHermesAvailable(): boolean {
    return this.hermesUrl !== null;
  }

  /**
   * Get Hermes Agent status
   */
  getHermesStatus(): { configured: boolean; url?: string } {
    return {
      configured: this.hermesUrl !== null,
      url: this.hermesUrl ?? undefined,
    };
  }

  private async persistToolCall(toolCall: AgentToolCall, context: RequestContext): Promise<void> {
    const previous = await this.store.load();
    const existingRun = previous.agentRuns.find((run) => run.id === toolCall.agentRunId || run.agentRunId === toolCall.agentRunId);
    const agentRun = existingRun
      ? {
        ...existingRun,
        status: toolCall.status === "failed" ? "失败" : toolCall.status === "completed" ? "完成" : existingRun.status,
        toolCalls: Math.max(existingRun.toolCalls, previous.agentToolCalls.filter((call) => call.agentRunId === toolCall.agentRunId).length + 1),
      }
      : {
        id: toolCall.agentRunId,
        agentRunId: toolCall.agentRunId,
        status: toolCall.status === "failed" ? "失败" : toolCall.status === "completed" ? "完成" : "运行中",
        task: `MCP ${toolCall.toolName}`,
        startedAt: toolCall.createdAt,
        toolCalls: 1,
      };
    const agentRuns = existingRun
      ? previous.agentRuns.map((run) => run.id === existingRun.id ? agentRun : run)
      : [agentRun, ...previous.agentRuns];
    const agentToolCalls = [
      toolCall,
      ...previous.agentToolCalls.filter((call) => call.id !== toolCall.id),
    ];
    await this.store.saveIncremental(previous, {
      ...previous,
      agentRuns,
      agentToolCalls,
      auditLogs: [
        {
          id: makeId("audit"),
          time: nowText(),
          actor: context.actorName,
          action: "执行 MCP 工具",
          summary: `${toolCall.toolName} ${toolCall.status === "completed" ? "执行完成" : toolCall.status === "failed" ? `执行失败：${toolCall.errorMessage ?? "unknown"}` : "已记录"}`,
          status: toolCall.status,
        },
        ...previous.auditLogs,
      ],
    });
  }

  /**
   * Register all built-in MCP tools
   */
  private registerBuiltinTools(): void {
    this.registerTool({
      name: "student_search",
      description: "Search for students by name, tag, or status",
      category: "query",
      inputSchema: {
        query: { type: "string", description: "Search query", required: true },
        limit: { type: "number", description: "Maximum results" },
      },
      handler: async (input) => {
        const snapshot = await this.core.snapshot();
        const query = asString(input.query).toLowerCase();
        const limit = asNumber(input.limit, 10);
        const students = snapshot.students
          .filter((student) => {
            const haystack = [
              student.name,
              student.grade,
              student.status,
              student.guardian,
              student.phone,
              student.teacher,
              student.teacherCourse,
              student.packageName,
              ...student.tags,
            ].join(" ").toLowerCase();
            return !query || haystack.includes(query);
          })
          .slice(0, limit)
          .map((student) => ({
            id: student.id,
            name: student.name,
            grade: student.grade,
            status: student.status,
            tags: student.tags,
            guardian: student.guardian,
            phone: student.phone,
            remainingHours: student.remainingHours,
            dueAmount: student.dueAmount,
          }));
        return { query: input.query, count: students.length, students };
      },
    });

    this.registerTool({
      name: "student_get_profile",
      description: "Get detailed student profile",
      category: "query",
      inputSchema: {
        studentId: { type: "string", description: "Student ID", required: true },
      },
      handler: async (input) => {
        const studentId = asString(input.studentId);
        const snapshot = await this.core.snapshot();
        const student = snapshot.students.find((item) => item.id === studentId);
        if (!student) {
          throw new ConflictException(`Student not found: ${studentId}`);
        }
        return {
          studentId,
          profile: student,
          lessons: snapshot.lessons.filter((lesson) => lesson.studentId === studentId),
          orders: snapshot.orders.filter((order) => order.studentId === studentId),
          lessonLedger: snapshot.lessonLedgerEntries.filter((entry) => entry.studentId === studentId),
          paymentLedger: snapshot.paymentLedgerEntries.filter((entry) => entry.studentId === studentId),
        };
      },
    });

    this.registerTool({
      name: "schedule_query",
      description: "Query schedule for a date range",
      category: "query",
      inputSchema: {
        from: { type: "string", description: "Start date (YYYY-MM-DD)", required: true },
        to: { type: "string", description: "End date (YYYY-MM-DD)", required: true },
        teacher: { type: "string", description: "Filter by teacher" },
        studentId: { type: "string", description: "Filter by student" },
      },
      handler: async (input) => {
        const snapshot = await this.core.snapshot();
        const from = normalizeToolDate(asString(input.from));
        const to = normalizeToolDate(asString(input.to));
        const teacher = asString(input.teacher);
        const studentId = asString(input.studentId);
        const lessons = snapshot.lessons.filter((lesson) => {
          const date = normalizeToolDate(lesson.date);
          const afterFrom = !from || !date || date >= from;
          const beforeTo = !to || !date || date <= to;
          const teacherMatches = !teacher || lesson.teacher === teacher;
          const studentMatches = !studentId || lesson.studentId === studentId;
          return afterFrom && beforeTo && teacherMatches && studentMatches;
        });
        return { from: input.from, to: input.to, count: lessons.length, lessons };
      },
    });

    this.registerTool({
      name: "package_get_balance",
      description: "Get student's remaining lesson balance",
      category: "query",
      inputSchema: {
        studentId: { type: "string", description: "Student ID", required: true },
      },
      handler: async (input) => {
        const studentId = asString(input.studentId);
        const snapshot = await this.core.snapshot();
        const student = snapshot.students.find((item) => item.id === studentId);
        if (!student) {
          throw new ConflictException(`Student not found: ${studentId}`);
        }
        const ledgerEntries = snapshot.lessonLedgerEntries.filter((entry) => entry.studentId === studentId);
        return {
          studentId,
          student: student.name,
          packageName: student.packageName,
          baseRemainingHours: student.baseRemainingHours ?? student.remainingHours,
          remainingHours: student.remainingHours,
          validTo: student.packageValidTo,
          ledgerEntries,
        };
      },
    });

    this.registerTool({
      name: "finance_get_summary",
      description: "Get financial summary for a period",
      category: "query",
      inputSchema: {
        month: { type: "string", description: "Month (YYYY-MM)" },
      },
      handler: async (input) => {
        const [reports, paymentSummary] = await Promise.all([
          this.core.reports(),
          this.core.paymentLedgerSummary(),
        ]);
        const outstanding = paymentSummary.reduce((sum, row) => sum + row.outstanding, 0);
        return {
          month: input.month,
          income: reports.income,
          outstanding,
          consumedLessons: reports.consumedLessons,
          attendanceRate: reports.attendanceRate,
          incomeTrend: reports.incomeTrend,
          teacherPayroll: reports.teacherPayroll,
        };
      },
    });

    this.registerTool({
      name: "schedule_propose",
      description: "Propose a new schedule (preview only)",
      category: "proposal",
      inputSchema: {
        studentId: { type: "string", description: "Student ID", required: true },
        teacher: { type: "string", description: "Teacher name", required: true },
        date: { type: "string", description: "Date", required: true },
        startTime: { type: "string", description: "Start time (HH:MM)", required: true },
        endTime: { type: "string", description: "End time (HH:MM)", required: true },
        room: { type: "string", description: "Room name" },
        title: { type: "string", description: "Course title" },
      },
      handler: async (input) => {
        return this.core.previewSchedule(schedulePreviewInput(input));
      },
    });

    this.registerTool({
      name: "schedule_check_conflicts",
      description: "Check for scheduling conflicts",
      category: "proposal",
      inputSchema: {
        teacher: { type: "string", description: "Teacher name" },
        room: { type: "string", description: "Room name" },
        studentId: { type: "string", description: "Student ID" },
        date: { type: "string", description: "Date", required: true },
        startTime: { type: "string", description: "Start time", required: true },
        endTime: { type: "string", description: "End time", required: true },
      },
      handler: async (input) => {
        return this.core.previewSchedule(schedulePreviewInput(input));
      },
    });

    this.registerTool({
      name: "schedule_commit",
      description: "Commit a scheduled lesson",
      category: "execute",
      inputSchema: {
        studentId: { type: "string", description: "Student ID", required: true },
        teacher: { type: "string", description: "Teacher name", required: true },
        room: { type: "string", description: "Room", required: true },
        date: { type: "string", description: "Date", required: true },
        startTime: { type: "string", description: "Start time", required: true },
        endTime: { type: "string", description: "End time", required: true },
      },
      handler: async (input, context) => {
        const created = await this.core.createLesson({
          studentId: asString(input.studentId),
          teacher: asString(input.teacher),
          room: asString(input.room),
          date: lessonDateFromToolInput(input.date),
          start: asString(input.startTime),
          end: asString(input.endTime),
          title: asString(input.title) || undefined,
          type: asString(input.type) || undefined,
          price: input.price == null ? undefined : asNumber(input.price, 180),
        }, {
          context: context.requestContext,
          idempotencyKey: asString(input.idempotencyKey) || `mcp-schedule-${context.agentRunId}`,
        });
        const lesson = created.lessons.at(-1);
        return { lessonId: lesson?.id, lesson, status: "confirmed" };
      },
    });

    this.registerTool({
      name: "attendance_mark",
      description: "Mark attendance for a lesson",
      category: "execute",
      inputSchema: {
        lessonId: { type: "string", description: "Lesson ID", required: true },
        status: { type: "string", description: "Attendance status", required: true },
      },
      handler: async (input, context) => {
        const state = await this.core.markAttendance({
          lessonId: asString(input.lessonId),
          status: asString(input.status),
        }, {
          context: context.requestContext,
          idempotencyKey: asString(input.idempotencyKey) || `mcp-attendance-${context.agentRunId}`,
        });
        const lesson = state.lessons.find((item) => item.id === asString(input.lessonId));
        const student = lesson ? state.students.find((item) => item.id === lesson.studentId) : undefined;
        return { lessonId: input.lessonId, status: lesson?.attendance, studentId: student?.id, remainingHours: student?.remainingHours, marked: true };
      },
    });

    this.registerTool({
      name: "notification_draft",
      description: "Create a notification draft",
      category: "execute",
      inputSchema: {
        recipient: { type: "string", description: "Recipient", required: true },
        channel: { type: "string", description: "Channel (微信/企微/etc)", required: true },
        content: { type: "string", description: "Message content", required: true },
        title: { type: "string", description: "Message title" },
        type: { type: "string", description: "Notification type" },
      },
      handler: async (input, context) => {
        const state = await this.core.createNotification({
          recipient: asString(input.recipient),
          channel: asString(input.channel) || "企业微信",
          content: asString(input.content),
          title: asString(input.title) || "业务通知",
          type: asString(input.type) || "业务通知",
          status: "草稿",
        }, {
          context: context.requestContext,
          idempotencyKey: asString(input.idempotencyKey) || `mcp-notification-draft-${context.agentRunId}`,
        });
        const notification = state.notifications[0];
        return { notificationId: notification.id, notification, status: notification.status };
      },
    });

    this.registerTool({
      name: "notification_send",
      description: "Send a notification",
      category: "execute",
      inputSchema: {
        notificationId: { type: "string", description: "Existing notification ID" },
        recipient: { type: "string", description: "Recipient" },
        channel: { type: "string", description: "Channel (微信/企微/etc)" },
        content: { type: "string", description: "Message content" },
        title: { type: "string", description: "Message title" },
      },
      handler: async (input, context) => {
        let notificationId = asString(input.notificationId);
        if (!notificationId) {
          const drafted = await this.core.createNotification({
            recipient: asString(input.recipient) || "相关家长",
            channel: asString(input.channel) || "企业微信",
            content: asString(input.content) || "请查看最新业务通知。",
            title: asString(input.title) || "业务通知",
            type: "业务通知",
            status: "待发送",
          }, {
            context: context.requestContext,
            idempotencyKey: `mcp-notification-create-${context.agentRunId}`,
          });
          notificationId = drafted.notifications[0].id;
        }
        const state = await this.core.sendNotification(notificationId, {
          context: context.requestContext,
          idempotencyKey: asString(input.idempotencyKey) || `mcp-notification-send-${context.agentRunId}`,
        });
        const notification = state.notifications.find((item) => item.id === notificationId);
        const delivery = state.notificationDeliveries.find((item) => item.notificationId === notificationId);
        return { notificationId, notification, delivery, sent: notification?.status === "已发送" || delivery?.status === "sent" };
      },
    });

    this.registerTool({
      name: "knowledge_search",
      description: "Search institution knowledge base with source citations",
      category: "query",
      inputSchema: {
        query: { type: "string", description: "Search query", required: true },
        limit: { type: "number", description: "Maximum results" },
      },
      handler: async (input, context) => {
        return this.core.searchKnowledge(asString(input.query), asNumber(input.limit, 5), context.requestContext);
      },
    });
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function schedulePreviewInput(input: Record<string, unknown>): SchedulePreviewInput {
  return {
    studentId: asString(input.studentId) || undefined,
    teacher: asString(input.teacher) || undefined,
    room: asString(input.room) || undefined,
    date: asString(input.date) || undefined,
    startTime: asString(input.startTime) || undefined,
    endTime: asString(input.endTime) || undefined,
    title: asString(input.title) || undefined,
    type: asString(input.type) || undefined,
    price: input.price == null ? undefined : asNumber(input.price, 180),
    ignoreLessonId: asString(input.ignoreLessonId) || undefined,
  };
}

function lessonDateFromToolInput(value: unknown): string {
  return normalizeToolDate(asString(value)) || "01/01";
}

function normalizeToolDate(value: string): string {
  const iso = value.match(/\d{4}[/-](\d{1,2})[/-](\d{1,2})/);
  if (iso) {
    return `${iso[1].padStart(2, "0")}/${iso[2].padStart(2, "0")}`;
  }
  const local = value.match(/(\d{1,2})[/-](\d{1,2})/);
  return local ? `${local[1].padStart(2, "0")}/${local[2].padStart(2, "0")}` : "";
}
