import { Body, Controller, Delete, Get, Header, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { AgentGatewayService } from "./agent-gateway.service.js";
import { AuthService, type LoginRequest } from "./auth.service.js";
import { CoreService, type MutationMeta } from "./core.service.js";
import {
  assertScope,
  defaultRequestContext,
  expectedVersionFrom,
  type HeaderBag,
  idempotencyKeyFrom,
  requestContextFromHeaders,
  type RequestContext,
} from "./request-context.js";

@Controller()
export class CoreController {
  constructor(
    private readonly agentGateway: AgentGatewayService,
    private readonly auth: AuthService,
    private readonly core: CoreService,
  ) {}

  @Post("auth/login")
  login(@Body() body: LoginRequest) {
    return this.auth.login(body);
  }

  @Get("health")
  health() {
    return this.core.health();
  }

  @Get("snapshot")
  snapshot(@Headers() headers: HeaderBag) {
    this.context(headers, "read:snapshot");
    return this.core.snapshot();
  }

  @Post("dev/reset")
  reset(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "write:admin");
    return this.core.reset(context);
  }

  @Get("auth/session")
  session(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:session");
    return { userId: context.userId, tenantId: context.tenantId, role: context.role, scopes: context.scopes };
  }

  @Get("dashboard")
  dashboard(@Headers() headers: HeaderBag) {
    this.context(headers, "read:dashboard");
    return this.core.dashboard();
  }

  @Get("students")
  async students(@Headers() headers: HeaderBag) {
    this.context(headers, "read:students");
    return (await this.core.snapshot()).students;
  }

  @Post("students")
  createStudent(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:students");
    return this.core.createStudent(body as never, this.meta(headers, body, context));
  }

  @Get("households")
  async households(@Headers() headers: HeaderBag) {
    this.context(headers, "read:households");
    return (await this.core.snapshot()).students.map((student) => ({ id: `household-${student.id}`, studentId: student.id, guardian: student.guardian, phone: student.phone }));
  }

  @Get("courses")
  async courses(@Headers() headers: HeaderBag) {
    this.context(headers, "read:courses");
    const snapshot = await this.core.snapshot();
    return [...new Set(snapshot.lessons.map((lesson) => lesson.title))].map((title, index) => ({ id: `course-${index + 1}`, title }));
  }

  @Get("lessons")
  async lessons(@Headers() headers: HeaderBag) {
    this.context(headers, "read:lessons");
    return (await this.core.snapshot()).lessons;
  }

  @Post("lessons")
  createLesson(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:lessons");
    return this.core.createLesson(body as never, this.meta(headers, body, context));
  }

  @Post("schedule/proposals")
  proposeSchedule(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:business_tasks");
    return this.core.proposeSchedule(body as never, this.meta(headers, body, context));
  }

  @Post("schedule/proposals/:id/confirm")
  confirmSchedule(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:business_tasks");
    return this.core.confirmTask(id, this.meta(headers, body, context));
  }

  @Post("schedule/proposals/:id/cancel")
  cancelSchedule(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:business_tasks");
    return this.core.cancelTask(id, this.meta(headers, body, context));
  }

  @Post("attendance")
  markAttendance(@Headers() headers: HeaderBag, @Body() body: { lessonId: string; status: string; idempotencyKey?: string }) {
    const context = this.context(headers, "write:attendance");
    return this.core.markAttendance(body, this.meta(headers, body as Record<string, unknown>, context));
  }

  @Get("lesson-ledger")
  async lessonLedger(@Headers() headers: HeaderBag) {
    this.context(headers, "read:lesson_ledger");
    return (await this.core.snapshot()).lessonLedgerEntries;
  }

  @Get("lesson-ledger/summary")
  lessonLedgerSummary(@Headers() headers: HeaderBag) {
    this.context(headers, "read:lesson_ledger");
    return this.core.lessonLedgerSummary();
  }

  @Post("lesson-ledger/:id/reverse")
  reverseLessonLedger(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: { reason?: string; idempotencyKey?: string } = {}) {
    const context = this.context(headers, "write:attendance");
    return this.core.reverseLessonLedgerEntry(id, body, this.meta(headers, body as Record<string, unknown>, context));
  }

  @Get("orders")
  async orders(@Headers() headers: HeaderBag) {
    this.context(headers, "read:orders");
    return (await this.core.snapshot()).orders;
  }

  @Post("orders")
  createOrder(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:orders");
    return this.core.createOrder(body as never, this.meta(headers, body, context));
  }

  @Post("payments")
  recordPayment(@Headers() headers: HeaderBag, @Body() body: { orderId: string; idempotencyKey?: string }) {
    const context = this.context(headers, "write:payments");
    return this.core.recordPayment(body.orderId, this.meta(headers, body as Record<string, unknown>, context));
  }

  @Get("payment-ledger")
  async paymentLedger(@Headers() headers: HeaderBag) {
    this.context(headers, "read:payments");
    return (await this.core.snapshot()).paymentLedgerEntries;
  }

  @Get("payment-ledger/summary")
  paymentLedgerSummary(@Headers() headers: HeaderBag) {
    this.context(headers, "read:payments");
    return this.core.paymentLedgerSummary();
  }

  @Post("payment-ledger/:id/reverse")
  reversePaymentLedger(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: { reason?: string; idempotencyKey?: string } = {}) {
    const context = this.context(headers, "write:payments");
    return this.core.reversePaymentLedgerEntry(id, body, this.meta(headers, body as Record<string, unknown>, context));
  }

  @Get("notifications")
  async notifications(@Headers() headers: HeaderBag) {
    this.context(headers, "read:notifications");
    return (await this.core.snapshot()).notifications;
  }

  @Post("notifications")
  createNotification(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:notifications");
    return this.core.createNotification(body as never, this.meta(headers, body, context));
  }

  @Patch("notifications/:id")
  updateNotification(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:notifications");
    return this.core.updateNotification(id, body as never, this.meta(headers, body, context));
  }

  @Post("notifications/:id/send")
  sendNotification(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:notifications");
    return this.core.sendNotification(id, this.meta(headers, body, context));
  }

  @Post("notifications/send-all")
  sendAllNotifications(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:notifications");
    return this.core.sendAllNotifications(this.meta(headers, body, context));
  }

  @Post("notifications/:id/schedule")
  scheduleNotification(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: { scheduledFor?: string; idempotencyKey?: string }) {
    const context = this.context(headers, "write:notifications");
    return this.core.scheduleNotification(id, body.scheduledFor, this.meta(headers, body as Record<string, unknown>, context));
  }

  @Post("notifications/dunning-drafts")
  dunningDrafts(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:notifications");
    return this.core.generateDunningDrafts(this.meta(headers, body, context));
  }

  @Get("notification-deliveries")
  async notificationDeliveries(@Headers() headers: HeaderBag) {
    this.context(headers, "read:notifications");
    return (await this.core.snapshot()).notificationDeliveries;
  }

  @Post("notification-deliveries/:id/retry")
  retryNotificationDelivery(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:notifications");
    return this.core.retryNotificationDelivery(id, this.meta(headers, body, context));
  }

  @Post("notification-deliveries/:id/cancel")
  cancelNotificationDelivery(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:notifications");
    return this.core.cancelNotificationDelivery(id, this.meta(headers, body, context));
  }

  @Get("notification-queue/status")
  notificationQueueStatus(@Headers() headers: HeaderBag) {
    this.context(headers, "read:notifications");
    return this.core.notificationQueueStatus();
  }

  @Post("notification-queue/process")
  processNotificationQueue(@Headers() headers: HeaderBag, @Body() body: { limit?: number } = {}) {
    const context = this.context(headers, "write:notifications");
    return this.core.processNotificationQueue(body.limit, context);
  }

  @Get("reports")
  reports(@Headers() headers: HeaderBag) {
    this.context(headers, "read:reports");
    return this.core.reports();
  }

  @Get("reports/summary")
  reportsSummary(@Headers() headers: HeaderBag) {
    this.context(headers, "read:reports");
    return this.core.reports();
  }

  @Get("business-tasks")
  async businessTasks(@Headers() headers: HeaderBag) {
    this.context(headers, "read:business_tasks");
    return (await this.core.snapshot()).tasks;
  }

  @Post("business-tasks/:id/confirm")
  confirmTask(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:business_tasks");
    return this.core.confirmTask(id, this.meta(headers, body, context));
  }

  @Post("business-tasks/:id/cancel")
  cancelTask(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:business_tasks");
    return this.core.cancelTask(id, this.meta(headers, body, context));
  }

  @Get("audit-logs")
  async auditLogs(@Headers() headers: HeaderBag) {
    this.context(headers, "read:audit_logs");
    return (await this.core.snapshot()).auditLogs;
  }

  @Get("knowledge-docs")
  async knowledgeDocs(@Headers() headers: HeaderBag) {
    this.context(headers, "read:knowledge_docs");
    return (await this.core.snapshot()).ragDocs;
  }

  @Get("agent-runs")
  async agentRuns(@Headers() headers: HeaderBag) {
    this.context(headers, "read:agent_runs");
    return (await this.core.snapshot()).agentRuns;
  }

  @Get("channel-integrations")
  async channelIntegrations(@Headers() headers: HeaderBag) {
    this.context(headers, "read:channel_integrations");
    return (await this.core.snapshot()).channelIntegrations;
  }

  @Post("commands/interpret")
  interpretCommand(@Headers() headers: HeaderBag, @Body() body: { text: string; source?: string; lessonId?: string; studentId?: string; idempotencyKey?: string }) {
    const context = this.context(headers, "write:business_tasks");
    return this.core.interpretCommand(body, this.meta(headers, body as Record<string, unknown>, context));
  }

  @Get("exports/:type")
  @Header("content-type", "text/csv; charset=utf-8")
  exportCsv(@Headers() headers: HeaderBag, @Param("type") type: string, @Query("month") _month?: string) {
    this.context(headers, "read:exports");
    return this.core.exportCsv(type);
  }

  @Get("users")
  async users(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:users");
    return this.core.listUsers(context.tenantId);
  }

  @Post("users")
  async createUser(@Headers() headers: HeaderBag, @Body() body: { email: string; password: string; displayName: string; role?: string }) {
    const context = this.context(headers, "write:users");
    return this.core.createUser(body, context);
  }

  @Patch("users/:id")
  async updateUser(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: { displayName?: string; role?: string; status?: string }) {
    const context = this.context(headers, "write:users");
    return this.core.updateUser(id, body, context);
  }

  @Post("users/:id/reset-password")
  async resetPassword(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: { newPassword: string }) {
    const context = this.context(headers, "write:users");
    return this.core.resetUserPassword(id, body.newPassword, context);
  }

  @Post("knowledge-docs")
  async createKnowledgeDoc(@Headers() headers: HeaderBag, @Body() body: { title: string; scope: string; content?: string }) {
    const context = this.context(headers, "write:knowledge_docs");
    return this.core.createKnowledgeDoc(body, context);
  }

  @Delete("knowledge-docs/:id")
  async deleteKnowledgeDoc(@Headers() headers: HeaderBag, @Param("id") id: string) {
    const context = this.context(headers, "write:knowledge_docs");
    return this.core.deleteKnowledgeDoc(id, context);
  }

  @Post("knowledge-docs/:id/search")
  async searchKnowledge(@Headers() headers: HeaderBag, @Param("id") _id: string, @Body() body: { query: string; limit?: number }) {
    const context = this.context(headers, "read:knowledge_docs");
    return this.core.searchKnowledge(body.query, body.limit, context);
  }

  @Post("knowledge-search")
  async searchKnowledgeGlobal(@Headers() headers: HeaderBag, @Body() body: { query: string; limit?: number }) {
    const context = this.context(headers, "read:knowledge_docs");
    return this.core.searchKnowledge(body.query, body.limit, context);
  }

  @Post("agent-runs")
  async createAgentRun(@Headers() headers: HeaderBag, @Body() body: { task: string; toolCalls?: number }) {
    const context = this.context(headers, "write:agent_runs");
    return this.core.createAgentRun(body, context);
  }

  @Get("mcp/tools")
  listMcpTools(@Headers() headers: HeaderBag) {
    this.context(headers, "read:agent_runs");
    return this.agentGateway.listTools();
  }

  @Get("mcp/tools/:name")
  getMcpTool(@Headers() headers: HeaderBag, @Param("name") name: string) {
    this.context(headers, "read:agent_runs");
    const tool = this.agentGateway.getTool(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return { name: tool.name, description: tool.description, category: tool.category, inputSchema: tool.inputSchema };
  }

  @Post("mcp/execute")
  async executeMcpTool(
    @Headers() headers: HeaderBag,
    @Body() body: { toolName: string; input: Record<string, unknown>; agentRunId?: string },
  ) {
    const context = this.context(headers, "write:agent_runs");
    const result = await this.agentGateway.executeTool(body.toolName, body.input, context, body.agentRunId);
    return result;
  }

  @Get("mcp/approvals")
  async listApprovals(@Headers() headers: HeaderBag) {
    this.context(headers, "read:agent_runs");
    const snapshot = await this.core.snapshot();
    return snapshot.agentApprovals;
  }

  @Post("mcp/approvals/:id/decide")
  async decideApproval(
    @Headers() headers: HeaderBag,
    @Param("id") id: string,
    @Body() body: { decision: "approved" | "rejected"; note?: string },
  ) {
    const context = this.context(headers, "write:agent_runs");
    return this.agentGateway.decideApproval(id, body.decision, body.note, context);
  }

  @Get("agent/hermes-status")
  getHermesStatus(@Headers() headers: HeaderBag) {
    this.context(headers, "read:agent_runs");
    return this.agentGateway.getHermesStatus();
  }

  @Post("channel-integrations")
  async createChannelIntegration(@Headers() headers: HeaderBag, @Body() body: { name: string; type: string; description?: string }) {
    const context = this.context(headers, "write:channel_integrations");
    return this.core.createChannelIntegration(body, context);
  }

  @Patch("channel-integrations/:id")
  async updateChannelIntegration(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: { status?: string; description?: string }) {
    const context = this.context(headers, "write:channel_integrations");
    return this.core.updateChannelIntegration(id, body, context);
  }

  @Get("channel-accounts")
  async channelAccounts(@Headers() headers: HeaderBag) {
    this.context(headers, "read:channel_integrations");
    return (await this.core.snapshot()).channelAccounts;
  }

  @Get("channel-messages")
  async channelMessages(@Headers() headers: HeaderBag) {
    this.context(headers, "read:channel_integrations");
    return (await this.core.snapshot()).channelMessages;
  }

  @Post("channels/wecom/callback")
  async wecomCallback(
    @Headers() headers: HeaderBag,
    @Query() query: Record<string, string | undefined>,
    @Body() body: Record<string, unknown> = {},
  ) {
    const context = {
      ...defaultRequestContext(),
      userId: "channel-wecom",
      actorName: "企业微信入口",
    };
    return this.core.handleChannelCallback({
      ...body,
      channel: "wecom",
      timestamp: String(body.timestamp ?? query.timestamp ?? headerText(headers, "x-wecom-timestamp") ?? ""),
      nonce: String(body.nonce ?? query.nonce ?? headerText(headers, "x-wecom-nonce") ?? ""),
      signature: String(body.signature ?? query.signature ?? query.msg_signature ?? headerText(headers, "x-wecom-signature") ?? ""),
    }, context);
  }

  @Post("schedule/periodic")
  createPeriodicLessons(@Headers() headers: HeaderBag, @Body() body: {
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
  }) {
    const context = this.context(headers, "write:lessons");
    return this.core.createPeriodicLessons(body, this.meta(headers, body as Record<string, unknown>, context));
  }

  @Post("schedule/batch")
  batchSchedule(@Headers() headers: HeaderBag, @Body() body: { lessons: Array<Record<string, unknown>> }) {
    const context = this.context(headers, "write:lessons");
    return this.core.batchSchedule(body.lessons, this.meta(headers, body as Record<string, unknown>, context));
  }

  @Get("availability/teacher/:name")
  teacherAvailability(@Headers() headers: HeaderBag, @Param("name") name: string) {
    const context = this.context(headers, "read:lessons");
    return this.core.teacherAvailability(name);
  }

  @Get("availability/room/:name")
  roomAvailability(@Headers() headers: HeaderBag, @Param("name") name: string) {
    const context = this.context(headers, "read:lessons");
    return this.core.roomAvailability(name);
  }

  private context(headers: HeaderBag, scope: string): RequestContext {
    const context = requestContextFromHeaders(headers);
    assertScope(context, scope);
    return context;
  }

  private meta(headers: HeaderBag, body: Record<string, unknown>, context: RequestContext): MutationMeta {
    return {
      context,
      idempotencyKey: idempotencyKeyFrom(headers, body),
      expectedVersion: expectedVersionFrom(body),
    };
  }
}

function headerText(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
