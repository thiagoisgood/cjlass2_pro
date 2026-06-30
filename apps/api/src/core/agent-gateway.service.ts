import { ConflictException, Injectable, OnModuleInit } from "@nestjs/common";
import { type AgentApproval, type AgentToolCall } from "@cjlass2/shared";
import { CoreService, type MutationMeta, type SchedulePreviewInput, makeId, nowText } from "./core.service.js";
import { JsonStateStore } from "./json-state.store.js";
import { assertScope, type RequestContext } from "./request-context.js";

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
  ): Promise<{ toolCall: AgentToolCall; result?: Record<string, unknown>; approval?: AgentApproval }> {
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
        toolCall.status = "pending";
        toolCall.errorMessage = `Approval ${approval.status}: ${approval.approvalNote ?? "Waiting for approval"}`;
        await this.persistToolCall(toolCall, context);
        return { toolCall, approval };
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

    await this.persistApproval(approval, context);
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
    const previous = await this.store.load();
    const existing = previous.agentApprovals.find((approval) => approval.id === approvalId);
    if (!existing) {
      return null;
    }
    const approval: AgentApproval = {
      ...existing,
      status: decision,
      approvedBy: context.userId,
      approvalNote: note,
      decidedAt: nowText(),
    };
    await this.store.saveIncremental(previous, {
      ...previous,
      agentApprovals: previous.agentApprovals.map((item) => item.id === approvalId ? approval : item),
      auditLogs: [
        {
          id: makeId("audit"),
          time: nowText(),
          actor: context.actorName,
          action: "处理 Agent 审批",
          summary: `${approval.toolName} 已${decision === "approved" ? "批准" : "拒绝"}`,
          status: decision,
        },
        ...previous.auditLogs,
      ],
    });
    return approval;
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

  async interpretCommand(
    input: { text: string; source?: string; lessonId?: string; studentId?: string },
    context: RequestContext,
    meta: MutationMeta = {},
  ): Promise<{ state: Awaited<ReturnType<CoreService["snapshot"]>>; result: { type: string; title: string; body: string; taskId?: string; agentRunId?: string; hermes?: string } }> {
    const agentRunId = makeId("agent-run");
    const hermesPlan = await this.planWithHermes(input, context);
    if (hermesPlan?.toolName) {
      const toolResult = await this.executeTool(hermesPlan.toolName, hermesPlan.input ?? {}, context, agentRunId);
      const state = await this.core.snapshot();
      return {
        state,
        result: {
          type: toolResult.toolCall.status === "completed" ? "done" : "approval",
          title: hermesPlan.title ?? `Hermes 已调用 ${hermesPlan.toolName}`,
          body: hermesPlan.body ?? (toolResult.toolCall.status === "completed" ? "工具调用已完成。" : "工具调用已进入审批或等待状态。"),
          agentRunId,
          hermes: "used",
        },
      };
    }

    const interpreted = await this.core.interpretCommand(input, { ...meta, context, idempotencyKey: meta.idempotencyKey ?? `agent-command-${agentRunId}` });
    const finalState = await this.persistAgentRunSummary(
      agentRunId,
      input.text,
      hermesPlan?.body ? `Hermes 降级：${hermesPlan.body}` : this.hermesUrl ? "Hermes 返回不可执行计划，已使用本地解释器" : "未配置 Hermes，已使用本地解释器",
      context,
    );
    return {
      state: finalState ?? interpreted.state,
      result: {
        ...interpreted.result,
        agentRunId,
        hermes: this.hermesUrl ? "fallback" : "not_configured",
      },
    };
  }

  private async planWithHermes(
    input: { text: string; source?: string; lessonId?: string; studentId?: string },
    context: RequestContext,
  ): Promise<{ toolName?: string; input?: Record<string, unknown>; title?: string; body?: string } | null> {
    if (!this.hermesUrl) {
      return null;
    }
    const endpoint = `${this.hermesUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.HERMES_TIMEOUT_MS ?? 8000));
    const hermesModel = process.env.HERMES_MODEL?.trim();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(process.env.HERMES_AGENT_API_KEY ? { authorization: `Bearer ${process.env.HERMES_AGENT_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          ...(hermesModel ? { model: hermesModel } : {}),
          temperature: 0,
          messages: [
            {
              role: "system",
              content: [
                "你是晓知教务系统的受控业务规划器。",
                "只返回 JSON，不要 Markdown。",
                "可调用 MCP 工具名必须来自：",
                this.listTools().map((tool) => tool.name).join(", "),
                "如不能确定工具和参数，返回 {\"body\":\"需要追问的内容\"}。",
              ].join("\n"),
            },
            {
              role: "user",
              content: JSON.stringify({
                text: input.text,
                source: input.source,
                selectedLessonId: input.lessonId,
                selectedStudentId: input.studentId,
                userId: context.userId,
                tenantId: context.tenantId,
              }),
            },
          ],
        }),
      });
      if (!response.ok) {
        return { body: `Hermes HTTP ${response.status}` };
      }
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content ?? "";
      return parseHermesJson(content);
    } catch (error) {
      return { body: error instanceof Error ? error.message : "Hermes request failed" };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async persistAgentRunSummary(agentRunId: string, task: string, status: string, context: RequestContext) {
    const previous = await this.store.load();
    const run = {
      id: agentRunId,
      agentRunId,
      status,
      task,
      startedAt: nowText(),
      toolCalls: previous.agentToolCalls.filter((call) => call.agentRunId === agentRunId).length,
    };
    const next = {
      ...previous,
      agentRuns: [run, ...previous.agentRuns.filter((item) => item.id !== agentRunId)],
      auditLogs: [
        {
          id: makeId("audit"),
          time: nowText(),
          actor: context.actorName,
          action: "执行自然语言 Agent",
          summary: `${task} · ${status}`,
          status: "完成",
        },
        ...previous.auditLogs,
      ],
    };
    return this.store.saveIncremental(previous, next);
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

  private async persistApproval(approval: AgentApproval, context: RequestContext): Promise<void> {
    const previous = await this.store.load();
    const exists = previous.agentApprovals.some((item) => item.id === approval.id);
    await this.store.saveIncremental(previous, {
      ...previous,
      agentApprovals: exists
        ? previous.agentApprovals.map((item) => item.id === approval.id ? approval : item)
        : [approval, ...previous.agentApprovals],
      auditLogs: [
        {
          id: makeId("audit"),
          time: nowText(),
          actor: context.actorName,
          action: "创建 Agent 审批",
          summary: `${approval.toolName} ${approval.status === "approved" ? "已自动批准" : "等待审批"}`,
          status: approval.status,
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
      handler: async (input, context) => {
        const snapshot = await this.core.scopedSnapshot(context.requestContext);
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
      handler: async (input, context) => {
        const studentId = asString(input.studentId);
        const snapshot = await this.core.scopedSnapshot(context.requestContext);
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
      handler: async (input, context) => {
        const snapshot = await this.core.scopedSnapshot(context.requestContext);
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
      handler: async (input, context) => {
        const studentId = asString(input.studentId);
        const snapshot = await this.core.scopedSnapshot(context.requestContext);
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
      handler: async (input, context) => {
        const [reports, paymentSummary] = await Promise.all([
          this.core.reports(context.requestContext),
          this.core.paymentLedgerSummary(context.requestContext),
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
        assertScope(context.requestContext, "write:lessons");
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
        assertScope(context.requestContext, "write:attendance");
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
        assertScope(context.requestContext, "write:notifications");
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
        assertScope(context.requestContext, "write:notifications");
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
      name: "invoice_issue",
      description: "Issue an invoice for an order and write formal accounting entries",
      category: "execute",
      inputSchema: {
        orderId: { type: "string", description: "Order ID", required: true },
        amount: { type: "number", description: "Invoice amount" },
        invoiceNo: { type: "string", description: "Invoice number" },
      },
      handler: async (input, context) => {
        assertScope(context.requestContext, "write:payments");
        const state = await this.core.issueInvoice(asString(input.orderId), {
          amount: input.amount == null ? undefined : asNumber(input.amount, 0),
          invoiceNo: asString(input.invoiceNo) || undefined,
        }, {
          context: context.requestContext,
          idempotencyKey: asString(input.idempotencyKey) || `mcp-invoice-${context.agentRunId}`,
        });
        const invoice = state.invoices.find((item) => item.orderId === asString(input.orderId));
        return { invoice, financialEntries: state.financialLedgerEntries.filter((entry) => entry.sourceType === "invoice" && entry.sourceId === invoice?.id) };
      },
    });

    this.registerTool({
      name: "refund_request",
      description: "Request a refund; high-risk and requires approval in production",
      category: "high_risk",
      inputSchema: {
        orderId: { type: "string", description: "Order ID", required: true },
        amount: { type: "number", description: "Refund amount", required: true },
        reason: { type: "string", description: "Refund reason" },
      },
      handler: async (input, context) => {
        assertScope(context.requestContext, "write:payments");
        const state = await this.core.requestRefund({
          orderId: asString(input.orderId),
          amount: asNumber(input.amount, 0),
          reason: asString(input.reason) || "MCP refund request",
        }, {
          context: context.requestContext,
          idempotencyKey: asString(input.idempotencyKey) || `mcp-refund-${context.agentRunId}`,
        });
        return { refund: state.refunds[0] };
      },
    });

    this.registerTool({
      name: "payroll_generate",
      description: "Generate pending teacher payroll records from billable lessons",
      category: "execute",
      inputSchema: {
        teacherName: { type: "string", description: "Optional teacher name" },
      },
      handler: async (input, context) => {
        assertScope(context.requestContext, "write:payments");
        const state = await this.core.generatePayrollRecords({
          teacherName: asString(input.teacherName) || undefined,
        }, {
          context: context.requestContext,
          idempotencyKey: asString(input.idempotencyKey) || `mcp-payroll-generate-${context.agentRunId}`,
        });
        return { payrollRecords: state.payrollRecords.slice(0, 5) };
      },
    });

    this.registerTool({
      name: "payroll_settle",
      description: "Settle a confirmed payroll record; high-risk and requires approval in production",
      category: "high_risk",
      inputSchema: {
        payrollRecordId: { type: "string", description: "Payroll record ID", required: true },
      },
      handler: async (input, context) => {
        assertScope(context.requestContext, "write:payments");
        const recordId = asString(input.payrollRecordId);
        const state = await this.core.settlePayrollRecord(recordId, {
          context: context.requestContext,
          idempotencyKey: asString(input.idempotencyKey) || `mcp-payroll-settle-${context.agentRunId}`,
        });
        return { payrollRecord: state.payrollRecords.find((record) => record.id === recordId) };
      },
    });

    this.registerTool({
      name: "knowledge_search",
      description: "Search institution knowledge base with source citations",
      category: "query",
      inputSchema: {
        query: { type: "string", description: "Search query", required: true },
        limit: { type: "number", description: "Maximum results" },
        scope: { type: "string", description: "Optional knowledge scope filter" },
        includeExpired: { type: "boolean", description: "Include expired policies when true" },
      },
      handler: async (input, context) => {
        return this.core.searchKnowledge(asString(input.query), asNumber(input.limit, 5), context.requestContext, {
          scope: asString(input.scope) || undefined,
          includeExpired: Boolean(input.includeExpired),
        });
      },
    });
  }
}

function parseHermesJson(content: string): { toolName?: string; input?: Record<string, unknown>; title?: string; body?: string } | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/```json\s*([\s\S]*?)```/)?.[1]?.trim()
      ?? trimmed.match(/({[\s\S]*})/)?.[1]?.trim();
  if (!jsonText) {
    return { body: trimmed.slice(0, 240) };
  }
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const input = parsed.input && typeof parsed.input === "object" && !Array.isArray(parsed.input)
      ? parsed.input as Record<string, unknown>
      : undefined;
    return {
      toolName: asString(parsed.toolName || parsed.tool),
      input,
      title: asString(parsed.title),
      body: asString(parsed.body || parsed.message),
    };
  } catch {
    return { body: trimmed.slice(0, 240) };
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
