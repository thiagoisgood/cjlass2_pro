export type Tone = "blue" | "green" | "orange" | "purple" | "red" | "gray";

export interface Organization {
  id: string;
  name: string;
  subtitle: string;
  user: string;
  role: string;
}

export interface StudentRecord {
  date: string;
  title: string;
  teacher: string;
  status: string;
  note: string;
}

export interface CommunicationRecord {
  type: string;
  title: string;
  time: string;
  text: string;
}

export interface Student {
  id: string;
  name: string;
  short: string;
  grade: string;
  status: string;
  tags: string[];
  code: string;
  joinedAt: string;
  guardian: string;
  phone: string;
  note: string;
  teacher: string;
  teacherCourse: string;
  packageName: string;
  baseRemainingHours?: number;
  remainingHours: number;
  packageValidTo: string;
  attendanceRate: string;
  latestAttendance: string;
  dueAmount: number;
  growthPoints: number;
  records: StudentRecord[];
  communications: CommunicationRecord[];
}

export interface Lesson {
  id: string;
  day: number;
  date: string;
  start: string;
  end: string;
  title: string;
  type: string;
  studentId: string;
  studentName: string;
  teacher: string;
  room: string;
  status: string;
  color: "green" | "orange" | "purple" | "gray";
  attendance: string;
  package: string;
  remaining: string;
  price: number;
  selected?: boolean;
}

export interface Order {
  id: string;
  studentId: string;
  student: string;
  name: string;
  amount: number;
  paid: number;
  status: string;
  due: string;
  channel: string;
  invoice: string;
  createdAt: string;
}

export interface LessonLedgerEntry {
  id: string;
  studentId: string;
  studentName: string;
  lessonId?: string;
  entryType: "deduct" | "restore" | "adjustment";
  hoursDelta: number;
  reason: string;
  source: string;
  actorId: string;
  occurredAt: string;
  reversesEntryId?: string;
}

export interface PaymentLedgerEntry {
  id: string;
  orderId: string;
  studentId: string;
  studentName: string;
  entryType: "payment" | "refund" | "adjustment";
  amountDelta: number;
  channel: string;
  reason: string;
  actorId: string;
  occurredAt: string;
  reversesEntryId?: string;
}

export interface Invoice {
  id: string;
  orderId: string;
  invoiceNo: string;
  amount: number;
  status: "draft" | "issued" | "void";
  issuedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Refund {
  id: string;
  orderId: string;
  paymentLedgerEntryId?: string;
  amount: number;
  reason: string;
  status: "requested" | "approved" | "settled" | "rejected";
  requestedBy: string;
  approvedBy?: string;
  exceptional?: boolean;
  exceptionCode?: string;
  exceptionNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialLedgerEntry {
  id: string;
  sourceType: "invoice" | "payment" | "refund" | "payroll_confirm" | "payroll_settle" | "adjustment";
  sourceId: string;
  studentId?: string;
  account: string;
  direction: "debit" | "credit";
  amount: number;
  occurredAt: string;
  createdAt: string;
}

export interface FinancialAccount {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "income" | "expense" | "equity";
  normalBalance: "debit" | "credit";
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}

export interface AccountingPeriodLock {
  id: string;
  period: string;
  status: "locked";
  lockedAt: string;
  lockedBy: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationRun {
  id: string;
  period: string;
  status: "balanced" | "out_of_balance";
  debitTotal: number;
  creditTotal: number;
  difference: number;
  checkedAt: string;
  checkedBy: string;
  notes: string[];
}

export interface PayrollRule {
  id: string;
  teacherId?: string;
  teacherName: string;
  courseId?: string;
  courseName?: string;
  ruleType: "fixed_per_lesson" | "percent_of_lesson_price";
  amount: number;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRecord {
  id: string;
  teacherId?: string;
  teacherName: string;
  lessonId?: string;
  ruleId?: string;
  amount: number;
  status: "pending" | "confirmed" | "settled";
  confirmedAt?: string;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDraft {
  id: string;
  type: string;
  title: string;
  recipient: string;
  channel: string;
  status: "待发送" | "草稿" | "已发送" | "预约发送" | "发送失败";
  content: string;
  createdAt: string;
  sentRate?: string;
  scheduledFor?: string;
}

export interface NotificationDelivery {
  id: string;
  notificationId: string;
  channel: string;
  recipient: string;
  status: "queued" | "sent" | "failed" | "retry" | "cancelled" | "scheduled";
  providerMessageId?: string;
  errorMessage?: string;
  attempts: number;
  scheduledFor?: string;
  nextRetryAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessTaskCheck {
  label: string;
  ok: boolean;
}

export interface BusinessTask {
  id: string;
  type: "reschedule" | "payment" | "attendance" | "notification" | "refund" | "payroll";
  title: string;
  status: "等待确认" | "处理中" | "执行成功" | "执行失败" | "已取消" | "已撤销";
  channel: string;
  sourceText: string;
  lessonId?: string;
  studentId?: string;
  createdAt: string;
  executedAt?: string;
  proposal: {
    original?: string;
    target?: string;
    course?: string;
    teacher?: string;
    room?: string;
    amount?: number;
  };
  checks: BusinessTaskCheck[];
  effects: string[];
  expectedVersion: number;
  idempotencyKey: string;
}

export interface Template {
  id: string;
  title: string;
  type: string;
  content: string;
}

export interface AuditLog {
  id: string;
  time: string;
  actor: string;
  action: string;
  summary: string;
  status: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  scope: string;
  status: string;
  updatedAt: string;
  sourceCount: number;
  sourceUri?: string;
  mimeType?: string;
  checksum?: string;
  parser?: string;
  effectiveFrom?: string;
  expiresAt?: string;
  invalidatedAt?: string;
  invalidatedBy?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface KnowledgeChunk {
  id: string;
  docId: string;
  chunkIndex: number;
  title: string;
  scope: string;
  content: string;
  sourceLabel: string;
  metadata: Record<string, string | number | boolean>;
  contentHash?: string;
  embedding?: number[];
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimension?: number;
  embeddedAt?: string;
}

export interface ChannelIntegration {
  id: string;
  name: string;
  type: "wecom" | "wechat_h5" | "feishu" | "dingtalk";
  status: "connected" | "not_configured";
  description: string;
}

export interface ChannelAccount {
  id: string;
  channelId: string;
  channelType: ChannelIntegration["type"];
  externalUserId: string;
  displayName: string;
  linkedUserId?: string;
  linkedStudentId?: string;
  status: "bound" | "unbound";
  createdAt: string;
  updatedAt: string;
}

export interface ChannelMessage {
  id: string;
  channelType: ChannelIntegration["type"];
  messageId: string;
  fromUser: string;
  text: string;
  eventType: "message" | "card_action" | "verification";
  status: "received" | "deduplicated" | "processed" | "failed";
  taskId?: string;
  responseText?: string;
  receivedAt: string;
}

export interface AgentRun {
  id: string;
  status: string;
  task: string;
  startedAt: string;
  toolCalls: number;
  agentRunId?: string;
}

export interface AgentToolCall {
  id: string;
  agentRunId: string;
  toolName: string;
  inputParams: Record<string, unknown>;
  outputResult?: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed";
  errorMessage?: string;
  durationMs?: number;
  createdAt: string;
  completedAt?: string;
}

export interface AgentApproval {
  id: string;
  agentRunId?: string;
  toolCallId?: string;
  toolName: string;
  riskLevel: "high" | "medium" | "low";
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedBy: string;
  approvedBy?: string;
  approvalNote?: string;
  inputParams: Record<string, unknown>;
  createdAt: string;
  decidedAt?: string;
}

export interface AppSnapshot {
  organization: Organization;
  students: Student[];
  lessons: Lesson[];
  orders: Order[];
  lessonLedgerEntries: LessonLedgerEntry[];
  paymentLedgerEntries: PaymentLedgerEntry[];
  invoices: Invoice[];
  refunds: Refund[];
  financialLedgerEntries: FinancialLedgerEntry[];
  financialAccounts: FinancialAccount[];
  accountingPeriodLocks: AccountingPeriodLock[];
  reconciliationRuns: ReconciliationRun[];
  payrollRules: PayrollRule[];
  payrollRecords: PayrollRecord[];
  notifications: NotificationDraft[];
  notificationDeliveries: NotificationDelivery[];
  tasks: BusinessTask[];
  templates: Template[];
  auditLogs: AuditLog[];
  ragDocs: KnowledgeDoc[];
  knowledgeChunks: KnowledgeChunk[];
  channelIntegrations: ChannelIntegration[];
  channelAccounts: ChannelAccount[];
  channelMessages: ChannelMessage[];
  agentRuns: AgentRun[];
  agentToolCalls: AgentToolCall[];
  agentApprovals: AgentApproval[];
}

export interface ReportSummary {
  income: number;
  consumedLessons: number;
  newStudents: number;
  attendanceRate: number;
  incomeTrend: number[];
  teacherPayroll: Array<{ teacher: string; lessons: number; pay: number }>;
  reminders: Array<{ tone: Tone; title: string; text: string; action: string }>;
}

export interface DashboardSummary {
  todayLessons: number;
  pendingAttendance: number;
  pendingNotifications: number;
  pendingReschedules: number;
  lowBalanceStudents: number;
  overdueOrders: number;
  todos: Array<{ id: string; category: string; title: string; subtitle: string; action: string; tone: Tone; view: string }>;
  week: {
    lessons: number;
    visits: number;
    newStudents: number;
    revenue: number;
  };
}

export const TENANT_ID = "tenant-xiaozhi";

export function createSeedState(): AppSnapshot {
  return {
    organization: {
      id: TENANT_ID,
      name: "晓知教育工作室",
      subtitle: "轻量教务与经营",
      user: "林老师",
      role: "机构管理员",
    },
    students: [
      {
        id: "stu-zhang",
        name: "张子涵",
        short: "张",
        grade: "五年级",
        status: "在读学员",
        tags: ["英语", "数学", "阅读理解"],
        code: "XS20240408",
        joinedAt: "2024-03-15",
        guardian: "张先生（爸爸）",
        phone: "138 8888 1234",
        note: "非常配合，学习积极主动。",
        teacher: "林老师",
        teacherCourse: "英语",
        packageName: "数学培优班（春季）",
        baseRemainingHours: 13,
        remainingHours: 12,
        packageValidTo: "2024-06-30",
        attendanceRate: "3 / 3",
        latestAttendance: "04-28（周日）准时",
        dueAmount: 1680,
        growthPoints: 320,
        records: [
          { date: "04-28 周日 10:30 - 11:30", title: "英语阅读理解专项训练", teacher: "林老师", status: "已完成", note: "课堂表现积极，完成练习质量高。" },
          { date: "04-26 周五 19:00 - 20:00", title: "英语语法强化训练", teacher: "林老师", status: "已完成", note: "掌握一般过去时用法，作业完成良好。" },
          { date: "04-24 周三 19:00 - 20:00", title: "英语口语口语练习", teacher: "林老师", status: "请假", note: "家长请假（因病），已恢复课时。" },
        ],
        communications: [
          { type: "家长微信", title: "张先生（爸爸）", time: "04-27 21:35", text: "谢谢老师反馈，我们会在家里加强阅读练习。" },
          { type: "课程反馈", title: "课后反馈", time: "04-26 20:05", text: "反馈：张子涵 04-26 课堂表现良好，语法掌握进步明显。" },
        ],
      },
      {
        id: "stu-li",
        name: "李同学",
        short: "李",
        grade: "初一",
        status: "在读学员",
        tags: ["数学", "小组课"],
        code: "XS20240213",
        joinedAt: "2024-02-13",
        guardian: "李女士（妈妈）",
        phone: "136 2222 9801",
        note: "需要规律复盘错题。",
        teacher: "李老师",
        teacherCourse: "数学",
        packageName: "数学培优 10 课时包",
        baseRemainingHours: 4,
        remainingHours: 3,
        packageValidTo: "2024-05-31",
        attendanceRate: "2 / 3",
        latestAttendance: "04-27 迟到 5 分钟",
        dueAmount: 860,
        growthPoints: 185,
        records: [],
        communications: [],
      },
      {
        id: "stu-wang",
        name: "王艺森",
        short: "王",
        grade: "初三",
        status: "在读学员",
        tags: ["书法", "固定班"],
        code: "XS20240122",
        joinedAt: "2024-01-22",
        guardian: "王先生（爸爸）",
        phone: "135 6000 7821",
        note: "考试前需要稳定出勤。",
        teacher: "林老师",
        teacherCourse: "书法",
        packageName: "书法硬笔 12 课时",
        baseRemainingHours: 5,
        remainingHours: 5,
        packageValidTo: "2024-06-15",
        attendanceRate: "4 / 4",
        latestAttendance: "04-26 准时",
        dueAmount: 720,
        growthPoints: 260,
        records: [],
        communications: [],
      },
      {
        id: "stu-liu",
        name: "刘小雨",
        short: "刘",
        grade: "初二",
        status: "在读学员",
        tags: ["口语", "一对一"],
        code: "XS20240302",
        joinedAt: "2024-03-02",
        guardian: "刘女士（妈妈）",
        phone: "137 8999 6042",
        note: "家长关注续费和口语提升。",
        teacher: "王老师",
        teacherCourse: "口语",
        packageName: "口语一对一续费",
        baseRemainingHours: 1,
        remainingHours: 1,
        packageValidTo: "2024-05-20",
        attendanceRate: "3 / 4",
        latestAttendance: "04-25 请假",
        dueAmount: 2360,
        growthPoints: 150,
        records: [],
        communications: [],
      },
    ],
    lessons: [
      { id: "lesson-1", day: 0, date: "05/06", start: "09:00", end: "10:00", title: "英语一对一", type: "一对一", studentId: "stu-liu", studentName: "小雨同学", teacher: "王老师", room: "教室A", status: "进行中", color: "green", attendance: "未开始", package: "英语一对一 20课时包", remaining: "12 / 20 课时", price: 180 },
      { id: "lesson-2", day: 2, date: "05/08", start: "09:00", end: "10:00", title: "英语一对一", type: "一对一", studentId: "stu-zhang", studentName: "张子涵", teacher: "王老师", room: "教室A", status: "已确认", color: "green", attendance: "未开始", package: "英语一对一 20课时包", remaining: "12 / 20 课时", price: 180, selected: true },
      { id: "lesson-3", day: 1, date: "05/07", start: "10:30", end: "11:30", title: "初二数学小组课", type: "小组课", studentId: "stu-li", studentName: "李同学", teacher: "李老师", room: "教室B", status: "未开始", color: "orange", attendance: "未开始", package: "数学培优 10课时包", remaining: "3 / 10 课时", price: 120 },
      { id: "lesson-4", day: 3, date: "05/09", start: "09:00", end: "10:00", title: "英语一对一", type: "一对一", studentId: "stu-liu", studentName: "小雨同学", teacher: "王老师", room: "教室A", status: "进行中", color: "green", attendance: "未开始", package: "英语一对一 20课时包", remaining: "12 / 20 课时", price: 180 },
      { id: "lesson-5", day: 4, date: "05/10", start: "10:30", end: "11:30", title: "英语一对一", type: "一对一", studentId: "stu-liu", studentName: "小雨同学", teacher: "王老师", room: "教室A", status: "未开始", color: "green", attendance: "未开始", package: "英语一对一 20课时包", remaining: "11 / 20 课时", price: 180 },
      { id: "lesson-6", day: 2, date: "05/08", start: "14:00", end: "15:00", title: "书法硬笔班", type: "固定班", studentId: "stu-wang", studentName: "王艺森", teacher: "林老师", room: "教室C", status: "未开始", color: "purple", attendance: "未开始", package: "书法硬笔 12课时", remaining: "5 / 12 课时", price: 160 },
      { id: "lesson-7", day: 3, date: "05/09", start: "16:00", end: "17:00", title: "高一物理小组课", type: "小组课", studentId: "stu-li", studentName: "2/4", teacher: "陈老师", room: "教室A", status: "未开始", color: "orange", attendance: "未开始", package: "物理冲刺 8课时", remaining: "6 / 8 课时", price: 140 },
      { id: "lesson-8", day: 2, date: "05/08", start: "19:00", end: "20:00", title: "英语一对一", type: "一对一", studentId: "stu-liu", studentName: "小华同学", teacher: "王老师", room: "教室A", status: "未开始", color: "green", attendance: "未开始", package: "英语一对一 20课时包", remaining: "10 / 20 课时", price: 180 },
      { id: "lesson-9", day: 6, date: "05/12", start: "09:00", end: "10:00", title: "书法毛笔班", type: "固定班", studentId: "stu-wang", studentName: "5/8", teacher: "林老师", room: "教室C", status: "未开始", color: "purple", attendance: "未开始", package: "书法硬笔 12课时", remaining: "5 / 12 课时", price: 160 },
    ],
    orders: [
      { id: "order-1", studentId: "stu-zhang", student: "张同学", name: "英语一对一 20课时包", amount: 4800, paid: 3120, status: "部分已付", due: "逾期 5 天", channel: "微信支付", invoice: "SO20240415001", createdAt: "2024-04-15 09:30" },
      { id: "order-2", studentId: "stu-li", student: "李同学", name: "数学培优 10课时包", amount: 2600, paid: 1740, status: "部分已付", due: "今天到期", channel: "银行转账", invoice: "SO20240421002", createdAt: "2024-04-21 14:20" },
      { id: "order-3", studentId: "stu-wang", student: "王艺森", name: "书法硬笔 12课时", amount: 1920, paid: 1920, status: "已结清", due: "已结清", channel: "微信支付", invoice: "SO20240407009", createdAt: "2024-04-07 18:00" },
      { id: "order-4", studentId: "stu-liu", student: "刘小雨", name: "口语一对一续费", amount: 3600, paid: 0, status: "待收款", due: "待确认", channel: "未收款", invoice: "SO20240428004", createdAt: "2024-04-28 10:15" },
    ],
    lessonLedgerEntries: [
      { id: "lle-seed-1", studentId: "stu-zhang", studentName: "张子涵", lessonId: "lesson-1", entryType: "deduct", hoursDelta: -1, reason: "历史到课课消", source: "seed", actorId: "system", occurredAt: "2026-06-23 14:00" },
      { id: "lle-seed-2", studentId: "stu-li", studentName: "李同学", lessonId: "lesson-3", entryType: "deduct", hoursDelta: -1, reason: "历史到课课消", source: "seed", actorId: "system", occurredAt: "2026-06-23 14:05" },
    ],
    paymentLedgerEntries: [
      { id: "ple-seed-1", orderId: "order-1", studentId: "stu-zhang", studentName: "张同学", entryType: "payment", amountDelta: 3120, channel: "微信支付", reason: "历史收款导入", actorId: "system", occurredAt: "2024-04-15 09:30" },
      { id: "ple-seed-2", orderId: "order-2", studentId: "stu-li", studentName: "李同学", entryType: "payment", amountDelta: 1740, channel: "银行转账", reason: "历史收款导入", actorId: "system", occurredAt: "2024-04-21 14:20" },
      { id: "ple-seed-3", orderId: "order-3", studentId: "stu-wang", studentName: "王艺森", entryType: "payment", amountDelta: 1920, channel: "微信支付", reason: "历史收款导入", actorId: "system", occurredAt: "2024-04-07 18:00" },
    ],
    invoices: [
      { id: "invoice-seed-1", orderId: "order-3", invoiceNo: "FP20240407009", amount: 1920, status: "issued", issuedAt: "2024-04-07 18:05", createdAt: "2024-04-07 18:00", updatedAt: "2024-04-07 18:05" },
      { id: "invoice-seed-2", orderId: "order-1", invoiceNo: "FP20240415001", amount: 4800, status: "draft", createdAt: "2024-04-15 09:30", updatedAt: "2024-04-15 09:30" },
    ],
    refunds: [
      { id: "refund-seed-1", orderId: "order-1", paymentLedgerEntryId: "ple-seed-1", amount: 300, reason: "家长申请调整课包尾款", status: "requested", requestedBy: "user-lin", createdAt: "2024-04-20 10:00", updatedAt: "2024-04-20 10:00" },
    ],
    financialLedgerEntries: [
      { id: "fin-seed-1d", sourceType: "invoice", sourceId: "invoice-seed-1", studentId: "stu-wang", account: "应收账款", direction: "debit", amount: 1920, occurredAt: "2024-04-07 18:05", createdAt: "2024-04-07 18:05" },
      { id: "fin-seed-1c", sourceType: "invoice", sourceId: "invoice-seed-1", studentId: "stu-wang", account: "课程收入", direction: "credit", amount: 1920, occurredAt: "2024-04-07 18:05", createdAt: "2024-04-07 18:05" },
      { id: "fin-seed-2d", sourceType: "payment", sourceId: "ple-seed-3", studentId: "stu-wang", account: "银行存款", direction: "debit", amount: 1920, occurredAt: "2024-04-07 18:00", createdAt: "2024-04-07 18:00" },
      { id: "fin-seed-2c", sourceType: "payment", sourceId: "ple-seed-3", studentId: "stu-wang", account: "应收账款", direction: "credit", amount: 1920, occurredAt: "2024-04-07 18:00", createdAt: "2024-04-07 18:00" },
    ],
    financialAccounts: [
      { id: "acct-bank", code: "1002", name: "银行存款", type: "asset", normalBalance: "debit", status: "active", createdAt: "2024-04-01 09:00", updatedAt: "2024-04-01 09:00" },
      { id: "acct-receivable", code: "1122", name: "应收账款", type: "asset", normalBalance: "debit", status: "active", createdAt: "2024-04-01 09:00", updatedAt: "2024-04-01 09:00" },
      { id: "acct-income", code: "6001", name: "课程收入", type: "income", normalBalance: "credit", status: "active", createdAt: "2024-04-01 09:00", updatedAt: "2024-04-01 09:00" },
      { id: "acct-refund", code: "6603", name: "退款支出", type: "expense", normalBalance: "debit", status: "active", createdAt: "2024-04-01 09:00", updatedAt: "2024-04-01 09:00" },
      { id: "acct-payroll-expense", code: "6401", name: "教师课酬", type: "expense", normalBalance: "debit", status: "active", createdAt: "2024-04-01 09:00", updatedAt: "2024-04-01 09:00" },
      { id: "acct-payroll-payable", code: "2202", name: "应付课酬", type: "liability", normalBalance: "credit", status: "active", createdAt: "2024-04-01 09:00", updatedAt: "2024-04-01 09:00" },
    ],
    accountingPeriodLocks: [],
    reconciliationRuns: [],
    payrollRules: [
      { id: "payroll-rule-wang", teacherId: "teacher-wang-lao-shi", teacherName: "王老师", ruleType: "fixed_per_lesson", amount: 120, status: "active", createdAt: "2024-04-01 09:00", updatedAt: "2024-04-01 09:00" },
      { id: "payroll-rule-lin", teacherId: "teacher-lin-lao-shi", teacherName: "林老师", ruleType: "percent_of_lesson_price", amount: 0.55, status: "active", createdAt: "2024-04-01 09:00", updatedAt: "2024-04-01 09:00" },
    ],
    payrollRecords: [
      { id: "payroll-record-seed-1", teacherId: "teacher-lin-lao-shi", teacherName: "林老师", lessonId: "lesson-1", ruleId: "payroll-rule-lin", amount: 88, status: "confirmed", confirmedAt: "2024-04-28 18:30", createdAt: "2024-04-28 18:00", updatedAt: "2024-04-28 18:30" },
    ],
    notifications: [
      { id: "note-1", type: "调课通知", title: "调课通知", recipient: "张同学家长", channel: "微信", status: "待发送", content: "张先生您好，张子涵同学原定 05/08（周三）09:00 的英语一对一课程，因老师时间调整，建议改为 05/08（周三）10:30-11:30，教室不变。请您确认是否方便，如需其他时间也可以回复。", createdAt: "04-28 15:30" },
      { id: "note-2", type: "课堂提醒", title: "课堂提醒", recipient: "4 位学员", channel: "微信", status: "待发送", content: "明天有课程，请提前 15 分钟到达教室。", createdAt: "04-28 09:20" },
      { id: "note-3", type: "续费提醒", title: "续费提醒", recipient: "1 位家长", channel: "微信", status: "待发送", content: "您的课时即将用完，建议本周完成续费安排。", createdAt: "04-27 19:10" },
      { id: "note-4", type: "课程安排", title: "五一期间课程安排调整", recipient: "全体家长", channel: "微信", status: "已发送", content: "五一期间课程安排已同步，请在家长端查看。", createdAt: "04-28 15:30", sentRate: "已送达" },
    ],
    notificationDeliveries: [
      {
        id: "delivery-seed-1",
        notificationId: "note-4",
        channel: "微信",
        recipient: "全体家长",
        status: "sent",
        providerMessageId: "seed-message-1",
        attempts: 1,
        createdAt: "2026-06-23 15:30",
        updatedAt: "2026-06-23 15:30",
      },
    ],
    tasks: [
      {
        id: "task-001",
        type: "reschedule",
        title: "张子涵英语一对一调课确认",
        status: "等待确认",
        channel: "网页与聊天同步",
        sourceText: "帮我把今天下午 3:30 的课调到明天下午",
        lessonId: "lesson-2",
        studentId: "stu-zhang",
        createdAt: "2026-06-23 15:30",
        proposal: {
          original: "05/08（周三）09:00 - 10:00",
          target: "05/08（周三）10:30 - 11:30",
          course: "英语一对一",
          teacher: "王老师",
          room: "教室A",
        },
        checks: [
          { label: "教师可用", ok: true },
          { label: "学员无冲突", ok: true },
          { label: "教室可用", ok: true },
          { label: "不改变已扣课时", ok: true },
        ],
        effects: ["修改 1 节课程", "生成 2 条通知草稿", "在审计流水中记录操作人和入口"],
        expectedVersion: 1,
        idempotencyKey: "seed-task-001",
      },
    ],
    templates: [
      { id: "tpl-1", title: "课程调整", type: "调课通知", content: "您好，课程时间有调整，请查看新的上课安排并确认是否方便。" },
      { id: "tpl-2", title: "课前提醒", type: "课堂提醒", content: "明天有课程，请提前 15 分钟到达教室，记得携带教材。" },
      { id: "tpl-3", title: "课后反馈", type: "课程反馈", content: "本次课程已完成，课堂表现良好，建议在家完成配套练习。" },
      { id: "tpl-4", title: "续费催缴", type: "缴费提醒", content: "课时即将用完或账单待支付，请您方便时完成续费或缴费。" },
    ],
    auditLogs: [
      { id: "audit-1", time: "2026-06-23 15:30", actor: "林老师", action: "创建调课预览", summary: "生成张子涵英语一对一调课业务任务", status: "等待确认" },
      { id: "audit-2", time: "2026-06-23 14:22", actor: "系统", action: "余额阈值检查", summary: "识别 3 位学员剩余课时不足", status: "已完成" },
    ],
    ragDocs: [
      { id: "doc-1", title: "请假和调课制度", scope: "机构知识库", status: "生效中", updatedAt: "2026-06-12", sourceCount: 8 },
      { id: "doc-2", title: "退款规则与课时恢复", scope: "机构知识库", status: "生效中", updatedAt: "2026-06-10", sourceCount: 6 },
      { id: "doc-3", title: "英语阅读理解课程大纲", scope: "课程知识库", status: "生效中", updatedAt: "2026-05-28", sourceCount: 12 },
    ],
    knowledgeChunks: [
      {
        id: "chunk-doc-1-1",
        docId: "doc-1",
        chunkIndex: 0,
        title: "请假和调课制度",
        scope: "机构知识库",
        content: "学员请假需至少提前 24 小时提交。因病临时请假可补充说明后恢复课时。调课需要检查教师、教室和学员时间冲突，并由管理员确认后生成通知。",
        sourceLabel: "请假和调课制度#1",
        metadata: { source: "seed", policy: "leave_reschedule" },
      },
      {
        id: "chunk-doc-2-1",
        docId: "doc-2",
        chunkIndex: 0,
        title: "退款规则与课时恢复",
        scope: "机构知识库",
        content: "退款需要保留原始订单、收款流水和反向退款流水。已课消课时不可直接删除，应通过恢复或冲销流水留痕。",
        sourceLabel: "退款规则与课时恢复#1",
        metadata: { source: "seed", policy: "refund_ledger" },
      },
      {
        id: "chunk-doc-3-1",
        docId: "doc-3",
        chunkIndex: 0,
        title: "英语阅读理解课程大纲",
        scope: "课程知识库",
        content: "英语阅读理解课程重点覆盖主旨题、细节题、推断题和词义猜测。课后反馈需记录课堂表现、薄弱题型和下次练习建议。",
        sourceLabel: "英语阅读理解课程大纲#1",
        metadata: { source: "seed", course: "english_reading" },
      },
    ],
    channelIntegrations: [
      { id: "channel-wecom", name: "企业微信入口", type: "wecom", status: "not_configured", description: "内部轻量任务、通知审批和教师工作台。" },
      { id: "channel-h5", name: "家长 H5 / 小程序", type: "wechat_h5", status: "not_configured", description: "课表、请假、缴费、课堂反馈和成长记录。" },
      { id: "channel-feishu", name: "飞书入口", type: "feishu", status: "not_configured", description: "后续多渠道协作入口。" },
      { id: "channel-dingtalk", name: "钉钉入口", type: "dingtalk", status: "not_configured", description: "后续多渠道协作入口。" },
    ],
    channelAccounts: [
      {
        id: "channel-account-wecom-lin",
        channelId: "channel-wecom",
        channelType: "wecom",
        externalUserId: "wecom-lin",
        displayName: "林老师",
        linkedUserId: "user-lin",
        status: "bound",
        createdAt: "2026-06-23 15:30",
        updatedAt: "2026-06-23 15:30",
      },
    ],
    channelMessages: [],
    agentRuns: [
      { id: "agent-1", status: "完成", task: "生成调课方案", startedAt: "2026-06-23 15:30", toolCalls: 3 },
    ],
    agentToolCalls: [],
    agentApprovals: [],
  };
}

export function cloneSeedState(): AppSnapshot {
  return JSON.parse(JSON.stringify(createSeedState())) as AppSnapshot;
}
