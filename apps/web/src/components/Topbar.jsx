import React from "react";
import { Search, RefreshCcw, BellRing, MailCheck } from "lucide-react";

export function Topbar({
  snapshot,
  dashboard,
  commandText,
  setCommandText,
  runCommand,
  refreshAll,
  setView,
  busy,
  authSession,
  onLogout,
}) {
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
          <span>{snapshot?.organization?.user?.slice(0, 1) || "林"}</span>
          <div>
            <strong>{authSession?.user?.displayName || snapshot?.organization?.user || "林老师"}</strong>
            <small>{authSession?.user?.role || snapshot?.organization?.role || "管理员"}</small>
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
