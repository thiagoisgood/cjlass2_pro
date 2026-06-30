import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck, Database, RefreshCcw } from "lucide-react";
import { API_BASE_URL, api, clearAuthSession, getAuthSession } from "./api.js";
import { Sidebar } from "./components/Sidebar.jsx";
import { Topbar } from "./components/Topbar.jsx";
import { FormModal } from "./components/FormModal.jsx";

import { DashboardPage } from "./pages/DashboardPage.jsx";
import { SchedulePage } from "./pages/SchedulePage.jsx";
import { StudentsPage } from "./pages/StudentsPage.jsx";
import { BillingPage } from "./pages/BillingPage.jsx";
import { NotificationsPage } from "./pages/NotificationsPage.jsx";
import { ReportsPage } from "./pages/ReportsPage.jsx";
import { SettingsPage } from "./pages/SettingsPage.jsx";
import { MobileEntryPage } from "./pages/MobileEntryPage.jsx";
import { ChatPage } from "./pages/ChatPage.jsx";
import { Button } from "./components/ui/Button.jsx";

const UI_VIEW_KEY = "cjlass2-ui-last-view";

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
    () => snapshot?.lessons?.find((lesson) => lesson.id === selectedLessonId) || pickFirst(snapshot?.lessons),
    [snapshot, selectedLessonId],
  );
  const selectedStudent = useMemo(
    () => snapshot?.students?.find((student) => student.id === selectedStudentId) || pickFirst(snapshot?.students),
    [snapshot, selectedStudentId],
  );
  const selectedNotification = useMemo(
    () => snapshot?.notifications?.find((note) => note.id === selectedNotificationId) || pickFirst(snapshot?.notifications),
    [snapshot, selectedNotificationId],
  );
  const selectedTask = useMemo(
    () => snapshot?.tasks?.find((task) => task.id === selectedTaskId) || pickFirst(snapshot?.tasks),
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
    if (state?.lessons?.length && !state.lessons.some((lesson) => lesson.id === selectedLessonId)) setSelectedLessonId(state.lessons[0].id);
    if (state?.students?.length && !state.students.some((student) => student.id === selectedStudentId)) setSelectedStudentId(state.students[0].id);
    if (state?.notifications?.length && !state.notifications.some((note) => note.id === selectedNotificationId)) setSelectedNotificationId(state.notifications[0].id);
    if (state?.tasks?.length && !state.tasks.some((task) => task.id === selectedTaskId)) setSelectedTaskId(state.tasks[0].id);
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
      if (err?.status === 401) {
        setAuthRequired(true);
        setSnapshot(null);
        setLedgerSummaries({ lessons: [], payments: [] });
        setError("");
        setToast("登录已过期，请重新登录");
      } else {
        const message = err instanceof Error ? err.message : "操作失败";
        setError(message);
        setToast(message);
      }
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
    } else if (/退款|课酬|发票/.test(result?.result?.title || "")) {
      setView("billing");
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
        <Button variant="primary" type="submit" disabled={busy}>
          <ShieldCheck size={16} /> {busy ? "正在登录" : "登录"}
        </Button>
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
        <Database size={34} style={{ color: "var(--red)" }} />
        <strong>Core API 未连接</strong>
        <p>{error || "请启动 NestJS API 服务后重试。"}</p>
        <Button variant="primary" type="button" onClick={onRetry}>
          <RefreshCcw size={16} /> 重新连接
        </Button>
      </div>
    </div>
  );
}

export default App;
