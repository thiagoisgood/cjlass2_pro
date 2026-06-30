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
    const context = this.context(headers, "read:snapshot");
    return this.core.scopedSnapshot(context);
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
    const context = this.context(headers, "read:dashboard");
    return this.core.dashboard(context);
  }

  @Get("students")
  async students(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:students");
    return (await this.core.scopedSnapshot(context)).students;
  }

  @Post("students")
  createStudent(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:students");
    return this.scopedResult(this.core.createStudent(body as never, this.meta(headers, body, context)), context);
  }

  @Get("households")
  async households(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:households");
    return (await this.core.scopedSnapshot(context)).students.map((student) => ({ id: `household-${student.id}`, studentId: student.id, guardian: student.guardian, phone: student.phone }));
  }

  @Get("courses")
  async courses(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:courses");
    const snapshot = await this.core.scopedSnapshot(context);
    return [...new Set(snapshot.lessons.map((lesson) => lesson.title))].map((title, index) => ({ id: `course-${index + 1}`, title }));
  }

  @Get("lessons")
  async lessons(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:lessons");
    return (await this.core.scopedSnapshot(context)).lessons;
  }

  @Post("lessons")
  createLesson(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:lessons");
    return this.scopedResult(this.core.createLesson(body as never, this.meta(headers, body, context)), context);
  }

  @Post("schedule/proposals")
  proposeSchedule(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:business_tasks");
    return this.scopedResult(this.core.proposeSchedule(body as never, this.meta(headers, body, context)), context);
  }

  @Post("schedule/proposals/:id/confirm")
  confirmSchedule(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:business_tasks");
    return this.scopedResult(this.core.confirmTask(id, this.meta(headers, body, context)), context);
  }

  @Post("schedule/proposals/:id/cancel")
  cancelSchedule(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:business_tasks");
    return this.scopedResult(this.core.cancelTask(id, this.meta(headers, body, context)), context);
  }

  @Post("attendance")
  markAttendance(@Headers() headers: HeaderBag, @Body() body: { lessonId: string; status: string; idempotencyKey?: string }) {
    const context = this.context(headers, "write:attendance");
    return this.scopedResult(this.core.markAttendance(body, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Get("lesson-ledger")
  async lessonLedger(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:lesson_ledger");
    return (await this.core.scopedSnapshot(context)).lessonLedgerEntries;
  }

  @Get("lesson-ledger/summary")
  lessonLedgerSummary(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:lesson_ledger");
    return this.core.lessonLedgerSummary(context);
  }

  @Post("lesson-ledger/:id/reverse")
  reverseLessonLedger(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: { reason?: string; idempotencyKey?: string } = {}) {
    const context = this.context(headers, "write:attendance");
    return this.scopedResult(this.core.reverseLessonLedgerEntry(id, body, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Get("orders")
  async orders(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:orders");
    return (await this.core.scopedSnapshot(context)).orders;
  }

  @Post("orders")
  createOrder(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:orders");
    return this.scopedResult(this.core.createOrder(body as never, this.meta(headers, body, context)), context);
  }

  @Post("payments")
  recordPayment(@Headers() headers: HeaderBag, @Body() body: { orderId: string; idempotencyKey?: string }) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.recordPayment(body.orderId, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Get("invoices")
  async invoices(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:payments");
    return (await this.core.scopedSnapshot(context)).invoices;
  }

  @Post("invoices/issue")
  issueInvoice(@Headers() headers: HeaderBag, @Body() body: { orderId: string; amount?: number; invoiceNo?: string; idempotencyKey?: string }) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.issueInvoice(body.orderId, body, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Get("refunds")
  async refunds(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:payments");
    return (await this.core.scopedSnapshot(context)).refunds;
  }

  @Post("refunds")
  requestRefund(@Headers() headers: HeaderBag, @Body() body: { orderId: string; amount?: number; reason?: string; idempotencyKey?: string }) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.requestRefund(body, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Post("refunds/exceptional")
  requestExceptionalRefund(@Headers() headers: HeaderBag, @Body() body: { orderId: string; amount?: number; reason?: string; exceptionCode?: string; exceptionNote?: string; idempotencyKey?: string }) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.requestExceptionalRefund(body, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Post("refunds/:id/approve")
  approveRefund(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: { decision?: "approved" | "rejected"; idempotencyKey?: string } = {}) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.approveRefund(id, body.decision ?? "approved", this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Post("refunds/:id/settle")
  settleRefund(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.settleRefund(id, this.meta(headers, body, context)), context);
  }

  @Get("payment-ledger")
  async paymentLedger(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:payments");
    return (await this.core.scopedSnapshot(context)).paymentLedgerEntries;
  }

  @Get("payment-ledger/summary")
  paymentLedgerSummary(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:payments");
    return this.core.paymentLedgerSummary(context);
  }

  @Post("payment-ledger/:id/reverse")
  reversePaymentLedger(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: { reason?: string; idempotencyKey?: string } = {}) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.reversePaymentLedgerEntry(id, body, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Get("financial-ledger")
  async financialLedger(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:payments");
    return (await this.core.scopedSnapshot(context)).financialLedgerEntries;
  }

  @Get("financial-ledger/summary")
  financialLedgerSummary(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:payments");
    return this.core.financialLedgerSummary(context);
  }

  @Post("financial-ledger/reconcile")
  reconcileFinancialLedger(@Headers() headers: HeaderBag, @Body() body: { period?: string; idempotencyKey?: string } = {}) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.reconcileFinancialLedger(body, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Get("financial-accounts")
  async financialAccounts(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:payments");
    return (await this.core.scopedSnapshot(context)).financialAccounts;
  }

  @Post("financial-accounts")
  upsertFinancialAccount(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.upsertFinancialAccount(body as never, this.meta(headers, body, context)), context);
  }

  @Get("accounting-period-locks")
  async accountingPeriodLocks(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:payments");
    return (await this.core.scopedSnapshot(context)).accountingPeriodLocks;
  }

  @Post("accounting-periods/:period/lock")
  lockAccountingPeriod(@Headers() headers: HeaderBag, @Param("period") period: string, @Body() body: { note?: string; idempotencyKey?: string } = {}) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.lockAccountingPeriod(period, body, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Get("reconciliation-runs")
  async reconciliationRuns(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:payments");
    return (await this.core.scopedSnapshot(context)).reconciliationRuns;
  }

  @Get("payroll-rules")
  async payrollRules(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:payments");
    return (await this.core.scopedSnapshot(context)).payrollRules;
  }

  @Post("payroll-rules")
  createPayrollRule(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.createPayrollRule(body as never, this.meta(headers, body, context)), context);
  }

  @Post("payroll/generate")
  generatePayroll(@Headers() headers: HeaderBag, @Body() body: { teacherName?: string; idempotencyKey?: string } = {}) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.generatePayrollRecords(body, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Get("payroll-records")
  async payrollRecords(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:payments");
    return (await this.core.scopedSnapshot(context)).payrollRecords;
  }

  @Post("payroll-records/batch-confirm")
  batchConfirmPayrollRecords(@Headers() headers: HeaderBag, @Body() body: { recordIds?: string[]; teacherName?: string; idempotencyKey?: string } = {}) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.batchConfirmPayrollRecords(body, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Post("payroll-records/:id/confirm")
  confirmPayrollRecord(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.confirmPayrollRecord(id, this.meta(headers, body, context)), context);
  }

  @Post("payroll-records/:id/settle")
  settlePayrollRecord(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:payments");
    return this.scopedResult(this.core.settlePayrollRecord(id, this.meta(headers, body, context)), context);
  }

  @Get("notifications")
  async notifications(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:notifications");
    return (await this.core.scopedSnapshot(context)).notifications;
  }

  @Post("notifications")
  createNotification(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:notifications");
    return this.scopedResult(this.core.createNotification(body as never, this.meta(headers, body, context)), context);
  }

  @Patch("notifications/:id")
  updateNotification(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const context = this.context(headers, "write:notifications");
    return this.scopedResult(this.core.updateNotification(id, body as never, this.meta(headers, body, context)), context);
  }

  @Post("notifications/:id/send")
  sendNotification(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:notifications");
    return this.scopedResult(this.core.sendNotification(id, this.meta(headers, body, context)), context);
  }

  @Post("notifications/send-all")
  sendAllNotifications(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:notifications");
    return this.scopedResult(this.core.sendAllNotifications(this.meta(headers, body, context)), context);
  }

  @Post("notifications/:id/schedule")
  scheduleNotification(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: { scheduledFor?: string; idempotencyKey?: string }) {
    const context = this.context(headers, "write:notifications");
    return this.scopedResult(this.core.scheduleNotification(id, body.scheduledFor, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Post("notifications/dunning-drafts")
  dunningDrafts(@Headers() headers: HeaderBag, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:notifications");
    return this.scopedResult(this.core.generateDunningDrafts(this.meta(headers, body, context)), context);
  }

  @Get("notification-deliveries")
  async notificationDeliveries(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:notifications");
    return (await this.core.scopedSnapshot(context)).notificationDeliveries;
  }

  @Post("notification-deliveries/:id/retry")
  retryNotificationDelivery(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:notifications");
    return this.scopedResult(this.core.retryNotificationDelivery(id, this.meta(headers, body, context)), context);
  }

  @Post("notification-deliveries/:id/cancel")
  cancelNotificationDelivery(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:notifications");
    return this.scopedResult(this.core.cancelNotificationDelivery(id, this.meta(headers, body, context)), context);
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
    const context = this.context(headers, "read:reports");
    return this.core.reports(context);
  }

  @Get("reports/summary")
  reportsSummary(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:reports");
    return this.core.reports(context);
  }

  @Get("business-tasks")
  async businessTasks(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:business_tasks");
    return (await this.core.scopedSnapshot(context)).tasks;
  }

  @Post("business-tasks/:id/confirm")
  confirmTask(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:business_tasks");
    return this.scopedResult(this.core.confirmTask(id, this.meta(headers, body, context)), context);
  }

  @Post("business-tasks/:id/cancel")
  cancelTask(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: Record<string, unknown> = {}) {
    const context = this.context(headers, "write:business_tasks");
    return this.scopedResult(this.core.cancelTask(id, this.meta(headers, body, context)), context);
  }

  @Get("audit-logs")
  async auditLogs(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:audit_logs");
    return (await this.core.scopedSnapshot(context)).auditLogs;
  }

  @Get("knowledge-docs")
  async knowledgeDocs(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:knowledge_docs");
    return (await this.core.scopedSnapshot(context)).ragDocs;
  }

  @Get("agent-runs")
  async agentRuns(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:agent_runs");
    return (await this.core.scopedSnapshot(context)).agentRuns;
  }

  @Get("channel-integrations")
  async channelIntegrations(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:channel_integrations");
    return (await this.core.scopedSnapshot(context)).channelIntegrations;
  }

  @Post("commands/interpret")
  interpretCommand(@Headers() headers: HeaderBag, @Body() body: { text: string; source?: string; lessonId?: string; studentId?: string; idempotencyKey?: string }) {
    const context = this.context(headers, "write:business_tasks");
    return this.scopedCommandResult(this.agentGateway.interpretCommand(body, context, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Get("exports/:type")
  @Header("content-type", "text/csv; charset=utf-8")
  exportCsv(@Headers() headers: HeaderBag, @Param("type") type: string, @Query("month") _month?: string) {
    const context = this.context(headers, "read:exports");
    return this.core.exportCsv(type, context);
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
  async createKnowledgeDoc(@Headers() headers: HeaderBag, @Body() body: { title: string; scope: string; content?: string; sourceUri?: string; mimeType?: string; effectiveFrom?: string; expiresAt?: string; metadata?: Record<string, string | number | boolean> }) {
    const context = this.context(headers, "write:knowledge_docs");
    return this.scopedResult(this.core.createKnowledgeDoc(body, context), context);
  }

  @Post("knowledge-docs/upload")
  async uploadKnowledgeDoc(@Headers() headers: HeaderBag, @Body() body: { fileName: string; scope?: string; mimeType?: string; contentBase64?: string; text?: string; sourceUri?: string; effectiveFrom?: string; expiresAt?: string; metadata?: Record<string, string | number | boolean> }) {
    const context = this.context(headers, "write:knowledge_docs");
    return this.scopedResult(this.core.uploadKnowledgeDoc(body, context), context);
  }

  @Delete("knowledge-docs/:id")
  async deleteKnowledgeDoc(@Headers() headers: HeaderBag, @Param("id") id: string) {
    const context = this.context(headers, "write:knowledge_docs");
    return this.scopedResult(this.core.deleteKnowledgeDoc(id, context), context);
  }

  @Post("knowledge-docs/:id/invalidate")
  async invalidateKnowledgeDoc(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: { reason?: string } = {}) {
    const context = this.context(headers, "write:knowledge_docs");
    return this.scopedResult(this.core.invalidateKnowledgeDoc(id, body, context), context);
  }

  @Post("knowledge-docs/:id/reindex")
  async reindexKnowledgeDoc(@Headers() headers: HeaderBag, @Param("id") id: string) {
    const context = this.context(headers, "write:knowledge_docs");
    return this.scopedResult(this.core.reindexKnowledgeDoc(id, context), context);
  }

  @Post("knowledge-docs/:id/search")
  async searchKnowledge(@Headers() headers: HeaderBag, @Param("id") _id: string, @Body() body: { query: string; limit?: number; scope?: string; status?: string; includeExpired?: boolean; asOf?: string }) {
    const context = this.context(headers, "read:knowledge_docs");
    return this.core.searchKnowledge(body.query, body.limit, context, body);
  }

  @Post("knowledge-search")
  async searchKnowledgeGlobal(@Headers() headers: HeaderBag, @Body() body: { query: string; limit?: number; scope?: string; status?: string; includeExpired?: boolean; asOf?: string }) {
    const context = this.context(headers, "read:knowledge_docs");
    return this.core.searchKnowledge(body.query, body.limit, context, body);
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
    const context = this.context(headers, "read:agent_runs");
    const snapshot = await this.core.scopedSnapshot(context);
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
    return this.scopedResult(this.core.createChannelIntegration(body, context), context);
  }

  @Patch("channel-integrations/:id")
  async updateChannelIntegration(@Headers() headers: HeaderBag, @Param("id") id: string, @Body() body: { status?: string; description?: string }) {
    const context = this.context(headers, "write:channel_integrations");
    return this.scopedResult(this.core.updateChannelIntegration(id, body, context), context);
  }

  @Get("channel-accounts")
  async channelAccounts(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:channel_integrations");
    return (await this.core.scopedSnapshot(context)).channelAccounts;
  }

  @Get("channel-messages")
  async channelMessages(@Headers() headers: HeaderBag) {
    const context = this.context(headers, "read:channel_integrations");
    return (await this.core.scopedSnapshot(context)).channelMessages;
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
    return this.scopedResult(this.core.createPeriodicLessons(body, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Post("schedule/batch")
  batchSchedule(@Headers() headers: HeaderBag, @Body() body: { lessons: Array<Record<string, unknown>> }) {
    const context = this.context(headers, "write:lessons");
    return this.scopedResult(this.core.batchSchedule(body.lessons, this.meta(headers, body as Record<string, unknown>, context)), context);
  }

  @Get("availability/teacher/:name")
  teacherAvailability(@Headers() headers: HeaderBag, @Param("name") name: string) {
    const context = this.context(headers, "read:lessons");
    return this.core.teacherAvailability(name, context);
  }

  @Get("availability/room/:name")
  roomAvailability(@Headers() headers: HeaderBag, @Param("name") name: string) {
    const context = this.context(headers, "read:lessons");
    return this.core.roomAvailability(name, context);
  }

  private async scopedResult(result: Promise<Awaited<ReturnType<CoreService["snapshot"]>>>, context: RequestContext) {
    return this.core.scopeSnapshot(await result, context);
  }

  private async scopedCommandResult(
    result: Promise<{ state: Awaited<ReturnType<CoreService["snapshot"]>>; result: Record<string, unknown> }>,
    context: RequestContext,
  ) {
    const value = await result;
    return { ...value, state: this.core.scopeSnapshot(value.state, context) };
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
