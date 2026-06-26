import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  BookOpen,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Command,
  Database,
  Download,
  FileText,
  Globe2,
  History,
  LayoutDashboard,
  ListChecks,
  MailCheck,
  MessageCircle,
  Plus,
  Receipt,
  RefreshCcw,
  Route,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  SquarePen,
  TabletSmartphone,
  Users,
  WalletCards,
  WifiOff,
  XCircle,
  Zap,
} from "lucide-react";
import { API_BASE_URL, api, clearAuthSession, getAuthSession } from "./api.js";

const UI_VIEW_KEY = "cjlass2-ui-last-view";

const navItems = [
  { id: "dashboard", label: "工作台", icon: LayoutDashboard },
  { id: "schedule", label: "课表", icon: CalendarDays },
  { id: "students", label: "学员", icon: Users },
  { id: "billing", label: "收费", icon: WalletCards },
  { id: "notifications", label: "通知", icon: BellRing },
  { id: "reports", label: "报表", icon: BarChart3 },
  { id: "settings", label: "设置", icon: Settings },
  { id: "mobile", label: "多端入口", icon: Smartphone },
  { id: "chat", label: "聊天确认", icon: MessageCircle },
];

const toneClass = {
  blue: "tone-blue",
  green: "tone-green",
  orange: "tone-orange",
  purple: "tone-purple",
  red: "tone-red",
  gray: "tone-gray",
};

const weekdays = ["周一\n05/06", "周二\n05/07", "周三\n05/08", "周四\n05/09", "周五\n05/10", "周六\n05/11", "周日\n05/12"];
const hours = ["09:00", "10:30", "14:00", "16:00", "19:00"];

function currency(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function signedNumber(value) {
  const number = Number(value || 0);
  return `${number > 0 ? "+" : ""}${number}`;
}

function pickFirst(items, fallback = null) {
  return items?.length ? items[0] : fallback;
}

function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [authSession, setAuthSessionState] = useState(() => getAuthSession());
  const [authRequired, setAuthRequired] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [reports, setReports] = useState(null);
  const [ledgerSummaries, setLedgerSummaries] = useState({ lessons: [], payments: [] });
  const [view, setView] = useState(() => localStorage.getItem(UI_VIEW_KEY) || "dashboard");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [commandText, setCommandText] = useState("");
  const [commandResult, setCommandResult] = useState(null);
  const [modal, setModal] = useState(null);
  const [selectedLessonId, setSelectedLessonId] = useState("lesson-2");
  const [selectedStudentId, setSelectedStudentId] = useState("stu-zhang");
  const [selectedNotificationId, setSelectedNotificationId] = useState("note-1");
  const [selectedTaskId, setSelectedTaskId] = useState("task-001");
  const [month, setMonth] = useState("2024-04");
  const [mobileMode, setMobileMode] = useState("teacher");

  useEffect(() => {
    localStorage.setItem(UI_VIEW_KEY, view);
  }, [view]);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedLesson = useMemo(
    () => snapshot?.lessons.find((lesson) => lesson.id === selectedLessonId) || pickFirst(snapshot?.lessons),
    [snapshot, selectedLessonId],
  );
  const selectedStudent = useMemo(
    () => snapshot?.students.find((student) => student.id === selectedStudentId) || pickFirst(snapshot?.students),
    [snapshot, selectedStudentId],
  );
  const selectedNotification = useMemo(
    () => snapshot?.notifications.find((note) => note.id === selectedNotificationId) || pickFirst(snapshot?.notifications),
    [snapshot, selectedNotificationId],
  );
  const selectedTask = useMemo(
    () => snapshot?.tasks.find((task) => task.id === selectedTaskId) || pickFirst(snapshot?.tasks),
    [snapshot, selectedTaskId],
  );

  async function refreshAll() {
    setError("");
    setLoading(true);
    try {
      const [state, nextDashboard, nextReports, lessonLedgerSummary, paymentLedgerSummary] = await Promise.all([
        api.snapshot(),
        api.dashboard(),
        api.reports(),
        api.lessonLedgerSummary(),
        api.paymentLedgerSummary(),
      ]);
      setSnapshot(state);
      setDashboard(nextDashboard);
      setReports(nextReports);
      setLedgerSummaries({ lessons: lessonLedgerSummary, payments: paymentLedgerSummary });
      setAuthRequired(false);
      ensureSelections(state);
    } catch (err) {
      if (err?.status === 401) {
        setAuthRequired(true);
        setSnapshot(null);
        setLedgerSummaries({ lessons: [], payments: [] });
        setError("");
      } else {
        setError(err instanceof Error ? err.message : "无法连接 Core API");
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitLogin(formData) {
    setBusy(true);
    setError("");
    try {
      const session = await api.login(Object.fromEntries(formData.entries()));
      setAuthSessionState(session);
      setAuthRequired(false);
      setToast(`已登录：${session.user.displayName}`);
      await refreshAll();
    } catch (err) {
      const message = err instanceof Error ? err.message : "登录失败";
      setError(message);
      setToast(message);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    clearAuthSession();
    setAuthSessionState(null);
    setSnapshot(null);
    setLedgerSummaries({ lessons: [], payments: [] });
    setAuthRequired(true);
    setToast("已退出登录");
  }

  async function refreshSummaries(nextState) {
    setSnapshot(nextState);
    ensureSelections(nextState);
    const [nextDashboard, nextReports, lessonLedgerSummary, paymentLedgerSummary] = await Promise.all([
      api.dashboard(),
      api.reports(),
      api.lessonLedgerSummary(),
      api.paymentLedgerSummary(),
    ]);
    setDashboard(nextDashboard);
    setReports(nextReports);
    setLedgerSummaries({ lessons: lessonLedgerSummary, payments: paymentLedgerSummary });
  }

  function ensureSelections(state) {
    if (state.lessons.length && !state.lessons.some((lesson) => lesson.id === selectedLessonId)) setSelectedLessonId(state.lessons[0].id);
    if (state.students.length && !state.students.some((student) => student.id === selectedStudentId)) setSelectedStudentId(state.students[0].id);
    if (state.notifications.length && !state.notifications.some((note) => note.id === selectedNotificationId)) setSelectedNotificationId(state.notifications[0].id);
    if (state.tasks.length && !state.tasks.some((task) => task.id === selectedTaskId)) setSelectedTaskId(state.tasks[0].id);
  }

  async function runMutation(action, successMessage) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (result?.state) {
        await refreshSummaries(result.state);
        setCommandResult(result.result);
        if (result.result?.taskId) setSelectedTaskId(result.result.taskId);
      } else {
        await refreshSummaries(result);
      }
      if (successMessage) setToast(successMessage);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败";
      setError(message);
      setToast(message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function runCommand(source = "web", text = commandText) {
    const value = text.trim();
    if (!value) {
      setToast("请输入一条业务指令");
      return;
    }
    const result = await runMutation(
      () => api.interpretCommand({ text: value, source, lessonId: selectedLesson?.id, studentId: selectedStudent?.id }),
      "指令已进入受控业务流程",
    );
    if (result?.result?.type === "proposal") {
      setView(source === "chat" ? "chat" : "schedule");
    } else if (result?.result?.type === "draft") {
      setView("notifications");
    }
    setCommandText("");
  }

  async function openExport(type) {
    setBusy(true);
    setError("");
    try {
      await api.exportCsv(type);
      setToast(`${type === "orders" ? "账单" : type === "audit" ? "审计" : "报表"} CSV 已生成`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "导出失败";
      setError(message);
      setToast(message);
    } finally {
      setBusy(false);
    }
  }

  async function submitForm(type, formData) {
    const body = Object.fromEntries(formData.entries());
    const handlers = {
      student: () => api.createStudent({
        ...body,
        tags: String(body.tags || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
        remainingHours: Number(body.remainingHours || 10),
        dueAmount: Number(body.dueAmount || 0),
      }),
      lesson: () => api.createLesson({
        ...body,
        day: Number(body.day || 2),
        price: Number(body.price || 180),
      }),
      order: () => api.createOrder({
        ...body,
        amount: Number(body.amount || 0),
        paid: Number(body.paid || 0),
      }),
      notification: () => api.createNotification(body),
      proposal: () => api.proposeSchedule({ text: body.text, lessonId: body.lessonId || selectedLesson?.id, source: "web-form" }),
    };
    const result = await runMutation(handlers[type], "表单已提交，数据库和审计流水已更新");
    if (result) setModal(null);
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (authRequired && !authSession) {
    return <LoginScreen error={error} busy={busy} onSubmit={submitLogin} />;
  }

  if (!snapshot || error && !snapshot) {
    return <ApiError error={error} onRetry={refreshAll} />;
  }

  const pageProps = {
    snapshot,
    dashboard,
    reports,
    ledgerSummaries,
    selectedLesson,
    selectedStudent,
    selectedNotification,
    selectedTask,
    selectedLessonId,
    selectedStudentId,
    selectedNotificationId,
    selectedTaskId,
    month,
    mobileMode,
    busy,
    commandResult,
    setView,
    setModal,
    setSelectedLessonId,
    setSelectedStudentId,
    setSelectedNotificationId,
    setSelectedTaskId,
    setMonth,
    setMobileMode,
    runCommand,
    runMutation,
    openExport,
    setToast,
    setCommandResult,
  };

  return (
    <div className="app-shell">
      <Sidebar
        snapshot={snapshot}
        view={view}
        onView={setView}
        pendingCount={(dashboard?.pendingNotifications || 0) + (dashboard?.pendingReschedules || 0)}
      />
      <main className="workspace">
        <Topbar
          snapshot={snapshot}
          dashboard={dashboard}
          commandText={commandText}
          setCommandText={setCommandText}
          runCommand={runCommand}
          refreshAll={refreshAll}
          setView={setView}
          busy={busy}
          authSession={authSession}
          onLogout={logout}
        />
        {error ? (
          <div className="content compact-content">
            <div className="command-result danger-result">
              <AlertTriangle size={22} />
              <div>
                <strong>最近一次 API 请求失败</strong>
                <p>{error}</p>
              </div>
            </div>
          </div>
        ) : null}
        {view === "dashboard" && <DashboardPage {...pageProps} />}
        {view === "schedule" && <SchedulePage {...pageProps} />}
        {view === "students" && <StudentsPage {...pageProps} />}
        {view === "billing" && <BillingPage {...pageProps} />}
        {view === "notifications" && <NotificationsPage {...pageProps} />}
        {view === "reports" && <ReportsPage {...pageProps} />}
        {view === "settings" && <SettingsPage {...pageProps} refreshAll={refreshAll} />}
        {view === "mobile" && <MobileEntryPage {...pageProps} />}
        {view === "chat" && <ChatPage {...pageProps} commandText={commandText} setCommandText={setCommandText} />}
      </main>
      {modal ? (
        <FormModal
          type={modal}
          snapshot={snapshot}
          selectedLesson={selectedLesson}
          onClose={() => setModal(null)}
          onSubmit={submitForm}
        />
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function LoginScreen({ error, busy, onSubmit }) {
  function handleSubmit(event) {
    event.preventDefault();
    void onSubmit(new FormData(event.currentTarget));
  }
  return (
    <div className="loading-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <span className="login-mark"><ShieldCheck size={24} /></span>
        <div>
          <strong>登录晓知教育工作台</strong>
          <p>使用机构账号进入教务、收费、通知和审计系统。</p>
        </div>
        <label>
          <span>邮箱</span>
          <input name="email" type="email" autoComplete="username" placeholder="admin@cjlass.local" required />
        </label>
        <label>
          <span>密码</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error ? <p className="login-error">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={busy}>
          <ShieldCheck size={16} /> {busy ? "正在登录" : "登录"}
        </button>
      </form>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-card">
        <Database size={32} />
        <strong>正在连接 Core API</strong>
        <span>{API_BASE_URL}</span>
      </div>
    </div>
  );
}

function ApiError({ error, onRetry }) {
  return (
    <div className="loading-screen">
      <div className="loading-card">
        <WifiOff size={34} />
        <strong>Core API 未连接</strong>
        <p>{error || "请启动 NestJS API 服务后重试。"}</p>
        <button className="primary-button" type="button" onClick={onRetry}>
          <RefreshCcw size={16} /> 重新连接
        </button>
      </div>
    </div>
  );
}

function Sidebar({ snapshot, view, onView, pendingCount }) {
  const connected = snapshot.channelIntegrations.filter((item) => item.status === "connected").length;
  return (
    <aside className="sidebar">
      <button className="brand" type="button" onClick={() => onView("dashboard")}>
        <span className="brand-mark"><BookOpen size={19} /></span>
        <span>
          <strong>{snapshot.organization.name}</strong>
          <small>{snapshot.organization.subtitle}</small>
        </span>
      </button>
      <nav className="nav-list" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "is-active" : ""}`}
              type="button"
              onClick={() => onView(item.id)}
            >
              <Icon size={21} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <button className="channel-card" type="button" onClick={() => onView("settings")}>
        <ShieldCheck size={22} />
        <span>
          <strong>生产通道状态</strong>
          <small>{connected ? `${connected} 个通道已连接` : "未配置真实凭据，通道已隔离"}</small>
        </span>
        {pendingCount ? <span className="dot-count">{pendingCount}</span> : null}
      </button>
    </aside>
  );
}

function Topbar({ snapshot, dashboard, commandText, setCommandText, runCommand, refreshAll, setView, busy, authSession, onLogout }) {
  function handleSubmit(event) {
    event.preventDefault();
    void runCommand("web");
  }
  return (
    <header className="topbar">
      <form className="command-bar" onSubmit={handleSubmit}>
        <Search size={17} />
        <input
          value={commandText}
          onChange={(event) => setCommandText(event.target.value)}
          placeholder="输入业务指令：调课、点名、催缴、发送通知..."
        />
        <kbd>Enter</kbd>
      </form>
      <div className="top-actions">
        <button className="icon-button" type="button" title="刷新实时数据" onClick={refreshAll} disabled={busy}>
          <RefreshCcw size={18} />
        </button>
        <button className="icon-button" type="button" title="打开待确认任务" onClick={() => setView("chat")}>
          <BellRing size={18} />
          {dashboard?.pendingReschedules ? <span className="dot-count">{dashboard.pendingReschedules}</span> : null}
        </button>
        <button className="icon-button" type="button" title="打开通知中心" onClick={() => setView("notifications")}>
          <MailCheck size={18} />
          {dashboard?.pendingNotifications ? <span className="dot-count">{dashboard.pendingNotifications}</span> : null}
        </button>
        <div className="profile">
          <span>{snapshot.organization.user.slice(0, 1)}</span>
          <div>
            <strong>{authSession?.user?.displayName || snapshot.organization.user}</strong>
            <small>{authSession?.user?.role || snapshot.organization.role}</small>
          </div>
        </div>
        {authSession ? (
          <button className="secondary-button compact" type="button" onClick={onLogout}>
            退出
          </button>
        ) : null}
      </div>
    </header>
  );
}

function DashboardPage({
  snapshot,
  dashboard,
  reports,
  setView,
  setModal,
  runMutation,
  runCommand,
  openExport,
  selectedLesson,
}) {
  const pendingOrder = snapshot.orders.find((order) => order.status !== "已结清");
  return (
    <section className="content page-stack">
      <PageHeader
        title="工作台"
        description="所有摘要来自 Core API，待办操作会写入数据库与审计流水。"
        actions={[
          { label: "新增学员", icon: Plus, onClick: () => setModal("student"), primary: true },
          { label: "批量排课", icon: CalendarDays, onClick: () => setModal("proposal") },
          { label: "导出报表", icon: Download, onClick: () => openExport("reports") },
        ]}
      />
      <div className="metric-grid six">
        <MetricCard icon={CalendarDays} tone="blue" label="今日课程" value={dashboard.todayLessons} helper="实时课程数量" />
        <MetricCard icon={ListChecks} tone="green" label="待点名" value={dashboard.pendingAttendance} helper="未完成考勤" />
        <MetricCard icon={BellRing} tone="orange" label="待发送通知" value={dashboard.pendingNotifications} helper="草稿和待发送" />
        <MetricCard icon={Route} tone="purple" label="待确认业务" value={dashboard.pendingReschedules} helper="Proposal 流程" />
        <MetricCard icon={AlertTriangle} tone="red" label="低课时学员" value={dashboard.lowBalanceStudents} helper="小于等于 3 节" />
        <MetricCard icon={CircleDollarSign} tone="gray" label="已收款" value={currency(dashboard.week.revenue)} helper="订单流水聚合" />
      </div>

      <div className="dashboard-grid">
        <Panel title="经营待办" icon={Zap}>
          <div className="todo-list">
            {dashboard.todos.map((todo) => (
              <button key={todo.id} className="todo-row" type="button" onClick={() => setView(todo.view)}>
                <span className={`metric-icon ${toneClass[todo.tone]}`}><ChevronRight size={18} /></span>
                <span>
                  <strong>{todo.title}</strong>
                  <p>{todo.subtitle}</p>
                </span>
                <b>{todo.action}</b>
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="本周业务曲线" icon={BarChart3}>
          <LineChart data={reports.incomeTrend} />
          <div className="mini-stat-grid">
            <MiniStat label="课次" value={dashboard.week.lessons} />
            <MiniStat label="触达家长" value={dashboard.week.visits} />
            <MiniStat label="新增学员" value={dashboard.week.newStudents} />
          </div>
        </Panel>
      </div>

      <div className="two-column">
        <Panel title="快速业务入口" icon={Command}>
          <div className="quick-create">
            <button type="button" onClick={() => setModal("student")}><Users size={18} />新增学员档案</button>
            <button type="button" onClick={() => setModal("lesson")}><CalendarDays size={18} />创建真实课程</button>
            <button type="button" onClick={() => setModal("order")}><Receipt size={18} />创建收款订单</button>
            <button type="button" onClick={() => setModal("notification")}><BellRing size={18} />写通知草稿</button>
            <button type="button" onClick={() => runCommand("web", "帮我把张子涵的英语课调到明天上午")}><Route size={18} />生成调课预览</button>
            <button type="button" onClick={() => runMutation(() => api.generateDunningDrafts(), "已生成催缴草稿")}><WalletCards size={18} />生成催缴草稿</button>
          </div>
        </Panel>
        <Panel title="即时处理" icon={Clock}>
          <div className="simple-list">
            <SimpleRow title="下一节课" text={`${selectedLesson.title} · ${selectedLesson.studentName} · ${selectedLesson.start}-${selectedLesson.end}`} action="点名到课" onClick={() => runMutation(() => api.markAttendance(selectedLesson.id, "已到课"), "点名已记录并扣减课时")} />
            <SimpleRow title="待收账单" text={pendingOrder ? `${pendingOrder.student} ${currency(pendingOrder.amount - pendingOrder.paid)} 待收` : "暂无待收账单"} action="记录收款" onClick={() => pendingOrder ? runMutation(() => api.recordPayment(pendingOrder.id), "收款流水已写入") : setView("billing")} />
            <SimpleRow title="通知中心" text={`${dashboard.pendingNotifications} 条通知等待人工确认`} action="去发送" onClick={() => setView("notifications")} />
          </div>
        </Panel>
      </div>
    </section>
  );
}

function SchedulePage({
  snapshot,
  selectedLesson,
  selectedTask,
  setSelectedLessonId,
  setSelectedTaskId,
  setModal,
  runMutation,
  runCommand,
  setView,
}) {
  const pendingTasks = snapshot.tasks.filter((task) => task.status === "等待确认");
  return (
    <section className="content page-stack">
      <PageHeader
        title="课表"
        description="排课、冲突校验和调课确认全部通过 BusinessTask/Proposal 流程执行。"
        actions={[
          { label: "新增课程", icon: Plus, onClick: () => setModal("lesson"), primary: true },
          { label: "批量排课", icon: CalendarDays, onClick: () => setModal("proposal") },
          { label: "生成调课预览", icon: Route, onClick: () => runCommand("web", "把当前选中的课调到明天上午") },
        ]}
      />
      <div className="schedule-layout">
        <div className="calendar-panel">
          <div className="toolbar-row">
            <button className="field-button small" type="button" onClick={() => setModal("lesson")}><Plus size={15} />课程</button>
            <button className="field-button small" type="button" onClick={() => runMutation(() => api.markAttendance(selectedLesson.id, "已到课"), "已完成点名和课消")}><CheckCircle2 size={15} />点名</button>
            <button className="field-button small" type="button" onClick={() => runCommand("web", "请为这节课生成课前提醒")}><BellRing size={15} />提醒</button>
            <span className="spacer" />
            <button className="secondary-button compact" type="button" onClick={() => setView("chat")}><MessageCircle size={15} />聊天确认</button>
          </div>
          <CalendarGrid lessons={snapshot.lessons} selectedLessonId={selectedLesson.id} onSelect={setSelectedLessonId} />
        </div>
        <aside className="detail-panel">
          <div className="detail-header">
            <div>
              <h2>{selectedLesson.title}</h2>
              <p>{selectedLesson.studentName} · {selectedLesson.status}</p>
            </div>
            <span className={`status-pill ${selectedLesson.attendance === "已到课" ? "tone-green" : "tone-orange"}`}>{selectedLesson.attendance}</span>
          </div>
          <dl className="info-list">
            <div><dt>时间</dt><dd>{selectedLesson.date} {selectedLesson.start} - {selectedLesson.end}</dd></div>
            <div><dt>老师</dt><dd>{selectedLesson.teacher}</dd></div>
            <div><dt>教室</dt><dd>{selectedLesson.room}</dd></div>
            <div><dt>课包</dt><dd>{selectedLesson.package} · {selectedLesson.remaining}</dd></div>
            <div><dt>课消</dt><dd>{currency(selectedLesson.price)}</dd></div>
          </dl>
          <div className="action-strip">
            <button type="button" onClick={() => runMutation(() => api.markAttendance(selectedLesson.id, "已到课"), "已记录到课并扣减 1 课时")}>确认到课</button>
            <button type="button" onClick={() => runMutation(() => api.markAttendance(selectedLesson.id, "请假"), "已记录请假，课时未扣减")}>请假</button>
            <button type="button" onClick={() => runMutation(() => api.markAttendance(selectedLesson.id, "缺课"), "已记录缺课，等待人工复核")}>缺课</button>
          </div>
          {pendingTasks.length ? (
            <div className="proposal-card">
              <strong>待确认调课</strong>
              <p>{selectedTask.title}</p>
              <div className="button-row">
                <button className="primary-button compact" type="button" onClick={() => { setSelectedTaskId(selectedTask.id); void runMutation(() => api.confirmTask(selectedTask.id, selectedTask.expectedVersion), "调课已确认并生成通知草稿"); }}>确认执行</button>
                <button className="secondary-button compact" type="button" onClick={() => runMutation(() => api.cancelTask(selectedTask.id, selectedTask.expectedVersion), "调课任务已取消")}>取消</button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function StudentsPage({ snapshot, selectedStudent, selectedStudentId, setSelectedStudentId, setModal, setView, runMutation }) {
  return (
    <section className="content page-stack">
      <PageHeader
        title="学员详情"
        description="学员档案、课时、沟通记录与财务状态来自数据库快照。"
        actions={[
          { label: "新增学员", icon: Plus, onClick: () => setModal("student"), primary: true },
          { label: "创建订单", icon: Receipt, onClick: () => setModal("order") },
          { label: "发送提醒", icon: BellRing, onClick: () => setView("notifications") },
        ]}
      />
      <div className="selector-row">
        {snapshot.students.map((student) => (
          <button key={student.id} className={student.id === selectedStudentId ? "is-active" : ""} type="button" onClick={() => setSelectedStudentId(student.id)}>
            {student.name}
          </button>
        ))}
      </div>
      <div className="student-hero">
        <div className="avatar-large">{selectedStudent.short}</div>
        <div className="student-title">
          <h2>{selectedStudent.name}</h2>
          <p>{selectedStudent.grade} · {selectedStudent.status} · {selectedStudent.code}</p>
          <div className="tag-row">{selectedStudent.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        </div>
        <div className="teacher-line">
          <span>授课老师：{selectedStudent.teacher}</span>
          <span>家长：{selectedStudent.guardian}</span>
          <span>电话：{selectedStudent.phone}</span>
        </div>
      </div>
      <div className="metric-grid four">
        <StudentStat label="剩余课时" value={`${selectedStudent.remainingHours} 节`} action="去排课" onClick={() => setView("schedule")} />
        <StudentStat label="课包有效期" value={selectedStudent.packageValidTo} action="续费订单" onClick={() => setModal("order")} />
        <StudentStat label="到课记录" value={selectedStudent.attendanceRate} action="查看课表" onClick={() => setView("schedule")} />
        <StudentStat label="待收款" value={currency(selectedStudent.dueAmount)} action="去收款" onClick={() => setView("billing")} />
      </div>
      <div className="student-grid">
        <Panel title="课时流水" icon={History}>
          <div className="record-list">
            {selectedStudent.records.length ? selectedStudent.records.map((record) => (
              <div className="record-row" key={`${record.date}-${record.title}`}>
                <strong>{record.title}</strong>
                <p>{record.date} · {record.teacher} · {record.status}</p>
                <small>{record.note}</small>
              </div>
            )) : <EmptyState title="暂无课时流水" text="点名后会自动写入课时流水。" />}
          </div>
        </Panel>
        <Panel title="家校沟通" icon={MessageCircle}>
          <div className="communication-list">
            {selectedStudent.communications.length ? selectedStudent.communications.map((item) => (
              <div className="communication-row" key={`${item.time}-${item.title}`}>
                <strong>{item.title}</strong>
                <p>{item.time} · {item.type}</p>
                <small>{item.text}</small>
              </div>
            )) : <EmptyState title="暂无沟通记录" text="发送通知或课后反馈后会在此汇总。" />}
          </div>
        </Panel>
      </div>
      <div className="button-row">
        <button className="primary-button" type="button" onClick={() => runMutation(() => api.createNotification({ title: `${selectedStudent.name}课后反馈`, type: "课程反馈", recipient: selectedStudent.guardian, channel: "微信", content: `${selectedStudent.guardian}您好，${selectedStudent.name}本次课程已完成，课堂表现积极，建议继续复盘错题。` }), "课后反馈草稿已创建")}>
          <Send size={16} /> 生成课后反馈
        </button>
        <button className="secondary-button" type="button" onClick={() => setModal("lesson")}><CalendarDays size={16} /> 排一节课</button>
        <button className="secondary-button" type="button" onClick={() => setModal("order")}><Receipt size={16} /> 创建续费订单</button>
      </div>
    </section>
  );
}

function BillingPage({ snapshot, setModal, runMutation, openExport, setView }) {
  const pendingOrders = snapshot.orders.filter((order) => order.status !== "已结清");
  const totalAmount = snapshot.orders.reduce((sum, order) => sum + order.amount, 0);
  const paidAmount = snapshot.orders.reduce((sum, order) => sum + order.paid, 0);
  return (
    <section className="content page-stack">
      <PageHeader
        title="收费管理"
        description="收款只通过支付流水结清订单，不直接覆盖余额。"
        actions={[
          { label: "创建订单", icon: Plus, onClick: () => setModal("order"), primary: true },
          { label: "生成催缴草稿", icon: BellRing, onClick: () => runMutation(() => api.generateDunningDrafts(), "催缴草稿已生成") },
          { label: "导出账单", icon: Download, onClick: () => openExport("orders") },
        ]}
      />
      <div className="metric-grid four">
        <MetricCard icon={Receipt} tone="blue" label="订单总额" value={currency(totalAmount)} helper="数据库订单聚合" />
        <MetricCard icon={CircleDollarSign} tone="green" label="已收款" value={currency(paidAmount)} helper="支付流水聚合" />
        <MetricCard icon={AlertTriangle} tone="red" label="待收笔数" value={pendingOrders.length} helper="未结清订单" />
        <MetricCard icon={BellRing} tone="orange" label="催缴对象" value={pendingOrders.length} helper="可生成通知草稿" />
      </div>
      <div className="billing-grid">
        <Panel title="待收款" icon={WalletCards} className="pending-panel">
          <div className="pending-list">
            {pendingOrders.map((order) => (
              <div className="pending-card" key={order.id}>
                <small>{order.invoice}</small>
                <strong>{order.student}</strong>
                <p>{order.name}</p>
                <b>{currency(order.amount - order.paid)}</b>
                <div className="button-row">
                  <button className="primary-button compact" type="button" onClick={() => runMutation(() => api.recordPayment(order.id), "支付流水已结清订单")}>记录收款</button>
                  <button className="secondary-button compact" type="button" onClick={() => runMutation(() => api.createNotification({ title: `${order.student}缴费提醒`, type: "缴费提醒", recipient: `${order.student}家长`, channel: "微信", content: `您好，${order.student}的${order.name}还有待支付 ${currency(order.amount - order.paid)}，请您方便时完成支付。` }), "缴费提醒草稿已创建")}>催缴</button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="订单流水" icon={FileText} className="orders-panel">
          <div className="table-toolbar">
            <button className="field-button" type="button" onClick={() => setView("reports")}><BarChart3 size={15} />查看报表</button>
            <button className="field-button" type="button" onClick={() => openExport("orders")}><Download size={15} />导出 CSV</button>
          </div>
          <table className="data-table compact-table">
            <thead><tr><th>学员</th><th>订单</th><th>金额</th><th>已收</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {snapshot.orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.student}</td>
                  <td>{order.name}</td>
                  <td>{currency(order.amount)}</td>
                  <td>{currency(order.paid)}</td>
                  <td><span className={`status-pill ${order.status === "已结清" ? "tone-green" : "tone-orange"}`}>{order.status}</span></td>
                  <td>
                    <button className="link-button" type="button" onClick={() => order.status === "已结清" ? setView("reports") : runMutation(() => api.recordPayment(order.id), "订单已结清")}>
                      {order.status === "已结清" ? "看报表" : "收款"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </section>
  );
}

function NotificationsPage({ snapshot, selectedNotification, selectedNotificationId, setSelectedNotificationId, setModal, runMutation }) {
  return (
    <section className="content page-stack">
      <PageHeader
        title="通知中心"
        description="通知草稿、预约和发送状态由 API 管理，渠道未配置时保持未连接状态。"
        actions={[
          { label: "新建通知", icon: Plus, onClick: () => setModal("notification"), primary: true },
          { label: "全部发送", icon: Send, onClick: () => runMutation(() => api.sendAllNotifications(), "待发送通知已批量发送") },
          { label: "催缴草稿", icon: Receipt, onClick: () => runMutation(() => api.generateDunningDrafts(), "催缴草稿已生成") },
        ]}
      />
      <div className="notification-grid">
        <Panel title="编辑与发送" icon={SquarePen} className="editor-panel">
          <div className="draft-box">
            <strong>{selectedNotification.title}</strong>
            <p>{selectedNotification.content}</p>
          </div>
          <div className="editor-fields">
            <label>接收人<input value={selectedNotification.recipient} readOnly /></label>
            <label>渠道<input value={selectedNotification.channel} readOnly /></label>
            <label className="textarea-label">
              正文
              <textarea value={selectedNotification.content} onChange={(event) => runMutation(() => api.updateNotification(selectedNotification.id, { content: event.target.value }), "通知正文已保存")} />
            </label>
          </div>
          <div className="editor-actions">
            <button className="primary-button" type="button" onClick={() => runMutation(() => api.sendNotification(selectedNotification.id), "通知已发送")}>
              <Send size={16} /> 立即发送
            </button>
            <button className="secondary-button" type="button" onClick={() => runMutation(() => api.updateNotification(selectedNotification.id, { status: "草稿" }), "草稿已保存")}>
              <Save size={16} /> 保存草稿
            </button>
            <button className="secondary-button" type="button" onClick={() => runMutation(() => api.scheduleNotification(selectedNotification.id, "明日 09:00"), "通知已预约发送")}>
              <Clock size={16} /> 预约发送
            </button>
          </div>
          <div className="wechat-preview">
            <span>微信预览</span>
            <div>{selectedNotification.content}</div>
          </div>
        </Panel>
        <Panel title="通知列表" icon={BellRing}>
          <div className="notification-list">
            {snapshot.notifications.map((note) => (
              <button
                key={note.id}
                className={`notification-card ${note.id === selectedNotificationId ? "is-selected" : ""}`}
                type="button"
                onClick={() => setSelectedNotificationId(note.id)}
              >
                <span className={`round-icon ${note.status === "已发送" ? "green" : note.status === "预约发送" ? "blue" : "orange"}`}><BellRing size={16} /></span>
                <span className="notification-select">
                  <strong>{note.title}</strong>
                  <small>{note.recipient} · {note.channel} · {note.createdAt}</small>
                </span>
                <b>{note.status}</b>
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </section>
  );
}

function ReportsPage({ snapshot, dashboard, reports, ledgerSummaries, month, setMonth, openExport, setView }) {
  const months = ["2024-04", "2024-05", "2024-06"];
  const lessonLedgerRows = ledgerSummaries.lessons.slice(0, 5);
  const paymentLedgerRows = ledgerSummaries.payments.slice(0, 5);
  return (
    <section className="content page-stack">
      <PageHeader
        title="报表"
        description="收入、课消、到课和教师课酬由订单与课程流水聚合生成。"
        actions={[
          { label: "导出报表", icon: Download, onClick: () => openExport("reports"), primary: true },
          { label: "导出审计", icon: History, onClick: () => openExport("audit") },
        ]}
      />
      <div className="segmented">
        {months.map((item) => (
          <button key={item} className={month === item ? "is-active" : ""} type="button" onClick={() => setMonth(item)}>
            {item}
          </button>
        ))}
      </div>
      <div className="metric-grid four">
        <MetricCard icon={CircleDollarSign} tone="green" label="收入" value={currency(reports.income)} helper={`${month} 已收款`} />
        <MetricCard icon={ListChecks} tone="blue" label="课消" value={`${reports.consumedLessons} 节`} helper="完成课次聚合" />
        <MetricCard icon={Users} tone="purple" label="学员" value={reports.newStudents} helper="当前活跃档案" />
        <MetricCard icon={CheckCircle2} tone="orange" label="到课率" value={percent(reports.attendanceRate)} helper="考勤流水计算" />
      </div>
      <div className="reports-grid">
        <Panel title="收入趋势" icon={BarChart3} className="revenue-panel">
          <LineChart data={reports.incomeTrend} />
          <div className="chart-labels"><span>周一</span><span>周三</span><span>周五</span><span>周日</span></div>
        </Panel>
        <Panel title="课酬与提醒" icon={Receipt}>
          <div className="progress-list">
            {reports.teacherPayroll.map((row) => (
              <div className="progress-row" key={row.teacher}>
                <div>
                  <strong>{row.teacher}</strong>
                  <small>{row.lessons} 节课 · {currency(row.pay)}</small>
                </div>
                <i style={{ width: `${Math.min(100, row.lessons * 8)}%` }} />
              </div>
            ))}
          </div>
          <div className="insight-list">
            {reports.reminders.map((item) => (
              <button key={item.title} className="insight-row" type="button" onClick={() => setView(item.action.includes("学员") ? "students" : item.action.includes("订单") ? "billing" : "schedule")}>
                <span className={`bullet-dot ${item.tone}`} />
                <span>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </span>
              </button>
            ))}
          </div>
        </Panel>
      </div>
      <Panel title="账本核对" icon={ListChecks}>
        <div className="ledger-grid">
          <table className="data-table audit-table">
            <thead><tr><th>学员</th><th>基础课时</th><th>流水变动</th><th>当前余额</th></tr></thead>
            <tbody>
              {lessonLedgerRows.map((row) => (
                <tr key={row.studentId}>
                  <td>{row.student}</td>
                  <td>{row.baseRemainingHours}</td>
                  <td>{signedNumber(row.ledgerDelta)}</td>
                  <td>{row.remainingHours} 节</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="data-table audit-table">
            <thead><tr><th>订单</th><th>应收</th><th>流水已收</th><th>未收</th></tr></thead>
            <tbody>
              {paymentLedgerRows.map((row) => (
                <tr key={row.orderId}>
                  <td>{row.student}</td>
                  <td>{currency(row.amount)}</td>
                  <td>{currency(row.paidFromLedger)}</td>
                  <td>{currency(row.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="经营底表" icon={Database}>
        <table className="data-table audit-table">
          <thead><tr><th>指标</th><th>数值</th><th>来源</th><th>操作</th></tr></thead>
          <tbody>
            <tr><td>课程数</td><td>{snapshot.lessons.length}</td><td>/lessons</td><td><button className="link-button" type="button" onClick={() => setView("schedule")}>查看</button></td></tr>
            <tr><td>学员数</td><td>{snapshot.students.length}</td><td>/students</td><td><button className="link-button" type="button" onClick={() => setView("students")}>查看</button></td></tr>
            <tr><td>待办数</td><td>{dashboard.pendingReschedules}</td><td>/business-tasks</td><td><button className="link-button" type="button" onClick={() => setView("chat")}>处理</button></td></tr>
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

function SettingsPage({ snapshot, dashboard, refreshAll, openExport, runMutation, setView }) {
  return (
    <section className="content page-stack">
      <PageHeader
        title="设置"
        description="Auth/RBAC/Tenant、RAG、Agent Gateway、渠道网关和审计都通过后端接口暴露。"
        actions={[
          { label: "刷新状态", icon: RefreshCcw, onClick: refreshAll, primary: true },
          { label: "导出审计", icon: Download, onClick: () => openExport("audit") },
        ]}
      />
      <div className="settings-grid">
        <Panel title="租户与权限" icon={ShieldCheck}>
          <div className="setting-list">
            <SettingRow title="当前租户" text={snapshot.organization.id} icon={Database} />
            <SettingRow title="当前用户" text={`${snapshot.organization.user} · ${snapshot.organization.role}`} icon={Users} />
            <SettingRow title="RBAC 范围" text="admin scopes: *；所有写操作进入审计流水" icon={ShieldCheck} />
          </div>
          <div className="button-row">
            <button className="secondary-button compact" type="button" onClick={() => setView("reports")}><BarChart3 size={15} />查看经营报表</button>
            <button className="secondary-button compact" type="button" onClick={() => setView("chat")}><Route size={15} />查看待确认任务</button>
          </div>
        </Panel>
        <Panel title="渠道网关" icon={Globe2}>
          <div className="setting-list">
            {snapshot.channelIntegrations.map((channel) => (
              <SettingRow
                key={channel.id}
                title={channel.name}
                text={`${channel.description} · ${channel.status === "connected" ? "已连接" : "未连接"}`}
                icon={channel.status === "connected" ? CheckCircle2 : WifiOff}
              />
            ))}
          </div>
          <button className="secondary-button compact" type="button" onClick={refreshAll}><RefreshCcw size={15} />重新检测连接</button>
        </Panel>
        <Panel title="RAG 知识库" icon={BookOpen}>
          <div className="setting-list">
            {snapshot.ragDocs.map((doc) => (
              <SettingRow key={doc.id} title={doc.title} text={`${doc.scope} · ${doc.status} · ${doc.sourceCount} 个片段`} icon={BookOpen} />
            ))}
          </div>
          <button className="secondary-button compact" type="button" onClick={() => runMutation(() => api.createNotification({ title: "知识库索引完成", type: "系统通知", recipient: "机构管理员", channel: "站内", content: "RAG 知识库索引任务已完成，本次仅通过服务层记录状态通知。" }), "知识库索引状态已写入通知流")}>
            <Database size={15} />记录索引任务
          </button>
        </Panel>
        <Panel title="Agent Gateway" icon={Bot}>
          <div className="setting-list">
            {snapshot.agentRuns.map((run) => (
              <SettingRow key={run.id} title={run.task} text={`${run.status} · ${run.startedAt} · ${run.toolCalls} 次受控工具调用`} icon={Bot} />
            ))}
            <SettingRow title="今日待办" text={`${dashboard.pendingReschedules} 个 Proposal 等待人工确认`} icon={Route} />
          </div>
          <button className="secondary-button compact" type="button" onClick={() => setView("chat")}><MessageCircle size={15} />打开 Agent 入口</button>
        </Panel>
      </div>
      <Panel title="审计流水" icon={History}>
        <table className="data-table audit-table">
          <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>摘要</th><th>状态</th></tr></thead>
          <tbody>
            {snapshot.auditLogs.slice(0, 10).map((log) => (
              <tr key={log.id}><td>{log.time}</td><td>{log.actor}</td><td>{log.action}</td><td>{log.summary}</td><td>{log.status}</td></tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

function MobileEntryPage({
  snapshot,
  dashboard,
  selectedLesson,
  selectedTask,
  mobileMode,
  setMobileMode,
  setView,
  runMutation,
  runCommand,
  openExport,
}) {
  const pendingOrder = snapshot.orders.find((order) => order.status !== "已结清");
  return (
    <section className="content page-stack">
      <PageHeader
        title="多端入口"
        description="统一查看网页工作台、教师授课端和家长服务端的实时业务状态。"
        actions={[
          { label: "刷新摘要", icon: RefreshCcw, onClick: () => runCommand("web", "生成今日课程提醒") },
          { label: "导出运营 CSV", icon: Download, onClick: () => openExport("reports") },
        ]}
      />
      <div className="entry-layout">
        <Panel title="网页实时工作台" icon={Globe2}>
          <div className="mobile-live-panel">
            <div>
              <strong>{snapshot.organization.name}</strong>
              <p>今日 {dashboard.todayLessons} 节课 · {dashboard.pendingAttendance} 节待点名 · {dashboard.pendingNotifications} 条通知待确认</p>
            </div>
            <div className="metric-grid four">
              <MiniStat label="课程" value={dashboard.todayLessons} />
              <MiniStat label="待办" value={dashboard.pendingReschedules} />
              <MiniStat label="低课时" value={dashboard.lowBalanceStudents} />
              <MiniStat label="逾期" value={dashboard.overdueOrders} />
            </div>
            <div className="button-row">
              <button className="primary-button compact" type="button" onClick={() => setView("dashboard")}>打开工作台</button>
              <button className="secondary-button compact" type="button" onClick={() => setView("notifications")}>处理通知</button>
            </div>
          </div>
        </Panel>
        <div>
          <div className="segmented">
            <button className={mobileMode === "teacher" ? "is-active" : ""} type="button" onClick={() => setMobileMode("teacher")}>教师端</button>
            <button className={mobileMode === "parent" ? "is-active" : ""} type="button" onClick={() => setMobileMode("parent")}>家长端</button>
          </div>
          <div className="phone-row">
            <PhoneFrame title={mobileMode === "teacher" ? "教师移动端" : "家长移动端"} subtitle={mobileMode === "teacher" ? `${selectedLesson.teacher} 今日课程` : `${selectedLesson.studentName} 家长服务`}>
              {mobileMode === "teacher" ? (
                <TeacherPhone selectedLesson={selectedLesson} dashboard={dashboard} runMutation={runMutation} setView={setView} />
              ) : (
                <ParentPhone selectedLesson={selectedLesson} selectedTask={selectedTask} pendingOrder={pendingOrder} runMutation={runMutation} runCommand={runCommand} />
              )}
            </PhoneFrame>
            <Panel title="入口原则" icon={TabletSmartphone} className="entry-principles">
              <button type="button" onClick={() => setView("schedule")}>教师端授课<small>点名、请假、课后反馈集中处理</small></button>
              <button type="button" onClick={() => setView("billing")}>家长端服务<small>课程确认、缴费和联系老师一屏完成</small></button>
              <button type="button" onClick={() => setView("settings")}>渠道连接状态<small>未开通的渠道会明确标记为未连接</small></button>
            </Panel>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChatPage({
  snapshot,
  selectedTask,
  selectedTaskId,
  setSelectedTaskId,
  setModal,
  runMutation,
  commandText,
  setCommandText,
  runCommand,
  commandResult,
}) {
  function submitChat(event) {
    event.preventDefault();
    void runCommand("chat", commandText || "帮我把今天下午 3:30 的课调到明天下午");
  }
  return (
    <section className="content page-stack">
      <PageHeader
        title="聊天确认"
        description="先预览影响，再人工确认调课、通知和缴费相关操作。"
        actions={[
          { label: "生成调课预览", icon: Route, onClick: () => runCommand("chat", "帮我把张子涵的英语课调到明天上午"), primary: true },
          { label: "使用表单", icon: SquarePen, onClick: () => setModal("proposal") },
        ]}
      />
      <div className="chat-layout">
        <div className="chat-phone">
          <div className="chat-title">
            <span>教务助手</span>
            <Bot size={20} />
          </div>
          <div className="chat-body">
            <div className="bubble user">帮我把今天下午 3:30 的课调到明天下午</div>
            <div className="assistant-line">
              <span><Bot size={18} /></span>
              <p>我会先生成影响预览，不会直接改课表。</p>
            </div>
            <div className="chat-card">
              <strong>{selectedTask.title}</strong>
              <p>{selectedTask.proposal.original} → {selectedTask.proposal.target}</p>
              <small>{selectedTask.status}</small>
            </div>
            {commandResult ? (
              <div className="command-result">
                <CheckCircle2 size={20} />
                <div>
                  <strong>{commandResult.title}</strong>
                  <p>{commandResult.body}</p>
                </div>
              </div>
            ) : null}
          </div>
          <form className="chat-input" onSubmit={submitChat}>
            <input value={commandText} onChange={(event) => setCommandText(event.target.value)} placeholder="输入调课、催缴或点名指令" />
            <button type="submit"><Send size={16} /></button>
          </form>
        </div>
        <Panel title="业务任务确认" icon={Route} className="task-panel">
          <div className="task-selector">
            {snapshot.tasks.map((task) => (
              <button key={task.id} className={task.id === selectedTaskId ? "is-active" : ""} type="button" onClick={() => setSelectedTaskId(task.id)}>
                {task.title} · {task.status}
              </button>
            ))}
          </div>
          <div className="business-card">
            <h3>{selectedTask.title}</h3>
            <p>{selectedTask.sourceText}</p>
            <dl className="info-list">
              <div><dt>原安排</dt><dd>{selectedTask.proposal.original}</dd></div>
              <div><dt>目标安排</dt><dd>{selectedTask.proposal.target}</dd></div>
              <div><dt>幂等键</dt><dd>{selectedTask.idempotencyKey}</dd></div>
              <div><dt>版本检查</dt><dd>expected v{selectedTask.expectedVersion}</dd></div>
            </dl>
            <div className="check-grid">
              {selectedTask.checks.map((check) => (
                <span key={check.label}>{check.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}{check.label}</span>
              ))}
            </div>
            <ul>{selectedTask.effects.map((effect) => <li key={effect}>{effect}</li>)}</ul>
            <div className="button-row">
              <button className="primary-button" type="button" disabled={selectedTask.status !== "等待确认"} onClick={() => runMutation(() => api.confirmTask(selectedTask.id, selectedTask.expectedVersion), "业务任务已确认执行")}>
                <CheckCircle2 size={16} /> 确认执行
              </button>
              <button className="secondary-button" type="button" disabled={selectedTask.status !== "等待确认"} onClick={() => runMutation(() => api.cancelTask(selectedTask.id, selectedTask.expectedVersion), "业务任务已取消")}>
                <XCircle size={16} /> 取消任务
              </button>
              <button className="secondary-button" type="button" onClick={() => setModal("proposal")}>
                <SquarePen size={16} /> 修改内容
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </section>
  );
}

function CalendarGrid({ lessons, selectedLessonId, onSelect }) {
  return (
    <>
      <div className="week-grid">
        <div className="calendar-corner" />
        {weekdays.map((day) => (
          <div className="day-head" key={day}>{day.split("\n").map((part) => <span key={part}>{part}</span>)}</div>
        ))}
        {hours.map((hour) => (
          <div className="hour-row" key={hour}>
            <div className="hour-label">{hour}</div>
            {Array.from({ length: 7 }).map((_, day) => {
              const cellLessons = lessons.filter((lesson) => lesson.day === day && lesson.start === hour);
              return (
                <div className="calendar-cell" key={`${hour}-${day}`}>
                  {hour === "14:00" && day === 2 ? <span className="now-line" /> : null}
                  {cellLessons.map((lesson) => (
                    <button
                      key={lesson.id}
                      className={`lesson-chip ${lesson.color} ${lesson.id === selectedLessonId ? "is-selected" : ""}`}
                      type="button"
                      onClick={() => onSelect(lesson.id)}
                    >
                      <strong>{lesson.title}</strong>
                      <span>{lesson.studentName}</span>
                      <small>{lesson.teacher} · {lesson.room}</small>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="legend">
        <span><i className="legend-dot green" />一对一</span>
        <span><i className="legend-dot orange" />小组课</span>
        <span><i className="legend-dot purple" />固定班</span>
      </div>
    </>
  );
}

function TeacherPhone({ selectedLesson, dashboard, runMutation, setView }) {
  return (
    <>
      <div className="phone-stat-grid">
        <div className="mini-phone-stat"><strong>{dashboard.todayLessons}</strong><small>今日课程</small></div>
        <div className="mini-phone-stat"><strong>{dashboard.pendingAttendance}</strong><small>待点名</small></div>
      </div>
      <div className="phone-tool-grid">
        <button className="tool-square tone-0" type="button" onClick={() => runMutation(() => api.markAttendance(selectedLesson.id, "已到课"), "教师端点名已完成")}>点名</button>
        <button className="tool-square tone-1" type="button" onClick={() => runMutation(() => api.markAttendance(selectedLesson.id, "请假"), "教师端已记录请假")}>请假</button>
        <button className="tool-square tone-2" type="button" onClick={() => runMutation(() => api.createNotification({ title: `${selectedLesson.studentName}课后反馈`, type: "课程反馈", recipient: `${selectedLesson.studentName}家长`, channel: "微信", content: `${selectedLesson.studentName}本次${selectedLesson.title}已完成，课堂表现良好。` }), "课后反馈草稿已创建")}>反馈</button>
        <button className="tool-square tone-3" type="button" onClick={() => setView("schedule")}>课表</button>
      </div>
      <div className="phone-lesson">
        <span>{selectedLesson.start}</span>
        <strong>{selectedLesson.title}</strong>
        <small>{selectedLesson.room}</small>
      </div>
      <div className="phone-card hero-next">
        <small>下一步</small>
        <strong>{selectedLesson.studentName} · {selectedLesson.teacher}</strong>
        <button type="button" onClick={() => runMutation(() => api.markAttendance(selectedLesson.id, "已到课"), "移动端已记录到课")}>开始上课</button>
      </div>
    </>
  );
}

function ParentPhone({ selectedLesson, selectedTask, pendingOrder, runMutation, runCommand }) {
  return (
    <>
      <div className="date-strip">
        {["今天", "明天", "周五", "周六", "周日"].map((day, index) => (
          <button key={day} className={index === 1 ? "active" : ""} type="button" onClick={() => runCommand("parent-h5", `${day}查看课程安排`)}>
            <span>{day}</span><small>{index + 6}</small>
          </button>
        ))}
      </div>
      <div className="phone-card">
        <strong>{selectedLesson.title}</strong>
        <p>{selectedLesson.date} {selectedLesson.start}-{selectedLesson.end} · {selectedLesson.room}</p>
      </div>
      <div className="phone-tool-grid">
        <button className="tool-square tone-0" type="button" onClick={() => runMutation(() => api.confirmTask(selectedTask.id, selectedTask.expectedVersion), "家长端已确认调课")}>确认</button>
        <button className="tool-square tone-1" type="button" onClick={() => runCommand("parent-h5", "我要请假并保留课时")}>请假</button>
        <button className="tool-square tone-2" type="button" onClick={() => pendingOrder ? runMutation(() => api.recordPayment(pendingOrder.id), "家长端支付已结清订单") : runCommand("parent-h5", "查看账单")}>缴费</button>
        <button className="tool-square tone-4" type="button" onClick={() => runCommand("parent-h5", "需要联系老师调整课程")}>联系</button>
      </div>
      <div className="phone-lesson">
        <span>{pendingOrder ? currency(pendingOrder.amount - pendingOrder.paid) : "0"}</span>
        <strong>{pendingOrder ? pendingOrder.name : "暂无待支付账单"}</strong>
        <small>{pendingOrder ? pendingOrder.status : "已结清"}</small>
      </div>
    </>
  );
}

function PhoneFrame({ title, subtitle, children }) {
  return (
    <div className="phone-frame">
      <div className="phone-top"><span>9:41</span><TabletSmartphone size={17} /></div>
      <h3>{title}</h3>
      <p>{subtitle}</p>
      {children}
    </div>
  );
}

function PageHeader({ title, description, actions = [] }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="header-actions">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              className={action.primary ? "primary-button" : "secondary-button"}
              type="button"
              onClick={action.onClick}
            >
              <Icon size={16} />
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-title">
        <h2>{title}</h2>
        {Icon ? <span><Icon size={18} /></span> : null}
      </div>
      {children}
    </section>
  );
}

function MetricCard({ icon: Icon, tone, label, value, helper }) {
  return (
    <div className="metric-card">
      <span className={`metric-icon ${toneClass[tone] || "tone-gray"}`}><Icon size={20} /></span>
      <span className="metric-copy">
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{helper}</em>
      </span>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="mini-stat">
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function StudentStat({ label, value, action, onClick }) {
  return (
    <div className="student-stat">
      <small>{label}</small>
      <strong>{value}</strong>
      <button type="button" onClick={onClick}>{action}</button>
    </div>
  );
}

function SimpleRow({ title, text, action, onClick }) {
  return (
    <button className="simple-row" type="button" onClick={onClick}>
      <span className="bullet" />
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <b>{action}</b>
    </button>
  );
}

function SettingRow({ title, text, icon: Icon }) {
  return (
    <div className="setting-row">
      <span><Icon size={18} /></span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function LineChart({ data }) {
  const width = 520;
  const height = 190;
  const max = Math.max(...data, 1);
  const points = data.map((value, index) => {
    const x = 24 + (index * (width - 48)) / Math.max(1, data.length - 1);
    const y = height - 24 - (value / max) * (height - 54);
    return [x, y];
  });
  return (
    <div className="line-chart-wrap">
      <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="收入趋势图">
        {[0, 1, 2, 3].map((line) => (
          <line key={line} x1="20" x2={width - 20} y1={28 + line * 40} y2={28 + line * 40} />
        ))}
        <polyline points={points.map(([x, y]) => `${x},${y}`).join(" ")} />
        {points.map(([x, y], index) => <circle key={`${x}-${index}`} cx={x} cy={y} r="4" />)}
      </svg>
    </div>
  );
}

function FormModal({ type, snapshot, selectedLesson, onClose, onSubmit }) {
  const titles = {
    student: "新增学员",
    lesson: "新增课程",
    order: "创建订单",
    notification: "新建通知",
    proposal: "创建业务任务",
  };
  function handleSubmit(event) {
    event.preventDefault();
    void onSubmit(type, new FormData(event.currentTarget));
  }
  return (
    <div className="modal-backdrop">
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-header">
          <h2>{titles[type]}</h2>
          <button className="icon-button" type="button" onClick={onClose}><XCircle size={18} /></button>
        </div>
        {type === "student" && <StudentFields />}
        {type === "lesson" && <LessonFields snapshot={snapshot} />}
        {type === "order" && <OrderFields snapshot={snapshot} />}
        {type === "notification" && <NotificationFields snapshot={snapshot} />}
        {type === "proposal" && <ProposalFields snapshot={snapshot} selectedLesson={selectedLesson} />}
        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="primary-button" type="submit"><Save size={16} /> 提交</button>
        </div>
      </form>
    </div>
  );
}

function StudentFields() {
  return (
    <div className="form-grid">
      <label>姓名<input name="name" defaultValue="新学员" required /></label>
      <label>年级<input name="grade" defaultValue="初一" required /></label>
      <label>家长<input name="guardian" defaultValue="家长" required /></label>
      <label>电话<input name="phone" defaultValue="138 0000 0000" required /></label>
      <label>老师<input name="teacher" defaultValue="林老师" /></label>
      <label>课程<input name="teacherCourse" defaultValue="数学" /></label>
      <label>剩余课时<input name="remainingHours" type="number" min="0" defaultValue="10" /></label>
      <label>待收款<input name="dueAmount" type="number" min="0" defaultValue="0" /></label>
      <label className="wide-field">标签<input name="tags" defaultValue="数学,一对一" /></label>
      <label className="wide-field">备注<textarea name="note" defaultValue="通过生产表单创建。" /></label>
    </div>
  );
}

function LessonFields({ snapshot }) {
  return (
    <div className="form-grid">
      <label>学员<select name="studentId" defaultValue={snapshot.students[0]?.id}>{snapshot.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
      <label>课程标题<input name="title" defaultValue="英语一对一" required /></label>
      <label>课程类型<select name="type" defaultValue="一对一"><option>一对一</option><option>小组课</option><option>固定班</option></select></label>
      <label>星期<select name="day" defaultValue="2"><option value="0">周一</option><option value="1">周二</option><option value="2">周三</option><option value="3">周四</option><option value="4">周五</option><option value="5">周六</option><option value="6">周日</option></select></label>
      <label>日期<input name="date" defaultValue="05/08" /></label>
      <label>开始<input name="start" defaultValue="15:30" /></label>
      <label>结束<input name="end" defaultValue="16:30" /></label>
      <label>老师<input name="teacher" defaultValue="林老师" /></label>
      <label>教室<input name="room" defaultValue="教室A" /></label>
      <label>课消金额<input name="price" type="number" min="0" defaultValue="180" /></label>
    </div>
  );
}

function OrderFields({ snapshot }) {
  return (
    <div className="form-grid">
      <label>学员<select name="studentId" defaultValue={snapshot.students[0]?.id}>{snapshot.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
      <label>订单名称<input name="name" defaultValue="数学培优 10课时包" required /></label>
      <label>总金额<input name="amount" type="number" min="0" defaultValue="2600" required /></label>
      <label>已收金额<input name="paid" type="number" min="0" defaultValue="0" /></label>
      <label>渠道<select name="channel" defaultValue="未收款"><option>未收款</option><option>微信支付</option><option>银行转账</option></select></label>
      <label>到期状态<input name="due" defaultValue="待确认" /></label>
    </div>
  );
}

function NotificationFields({ snapshot }) {
  return (
    <div className="form-grid">
      <label>类型<select name="type" defaultValue="课程提醒"><option>课程提醒</option><option>缴费提醒</option><option>调课通知</option><option>课程反馈</option></select></label>
      <label>标题<input name="title" defaultValue="课程提醒" required /></label>
      <label>接收人<select name="recipient" defaultValue={snapshot.students[0]?.guardian}>{snapshot.students.map((student) => <option key={student.id} value={student.guardian}>{student.guardian}</option>)}</select></label>
      <label>渠道<select name="channel" defaultValue="微信"><option>微信</option><option>企业微信</option><option>站内</option></select></label>
      <label className="wide-field">内容<textarea name="content" defaultValue="明天有课程，请提前 15 分钟到达教室，记得携带教材。" required /></label>
    </div>
  );
}

function ProposalFields({ snapshot, selectedLesson }) {
  return (
    <div className="form-grid">
      <label>关联课程<select name="lessonId" defaultValue={selectedLesson?.id}>{snapshot.lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.studentName} · {lesson.title} · {lesson.start}</option>)}</select></label>
      <label className="wide-field">业务指令<textarea name="text" defaultValue="把这节课调到明天上午 10:30，并通知家长和老师。" required /></label>
    </div>
  );
}

export default App;
