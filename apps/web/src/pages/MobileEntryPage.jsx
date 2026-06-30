import React from "react";
import { RefreshCcw, Download, Globe2, TabletSmartphone } from "lucide-react";
import { PageHeader, Panel, MiniStat, PhoneFrame, TeacherPhone, ParentPhone } from "../components/Common.jsx";
import { Button } from "../components/ui/Button.jsx";

export function MobileEntryPage({
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
  const orders = snapshot?.orders || [];
  const pendingOrder = orders.find((order) => order.status !== "已结清");
  const todayLessons = dashboard?.todayLessons ?? 0;
  const pendingAttendance = dashboard?.pendingAttendance ?? 0;
  const pendingNotifications = dashboard?.pendingNotifications ?? 0;

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
              <strong>{snapshot?.organization?.name || "教务系统"}</strong>
              <p>今日 {todayLessons} 节课 · {pendingAttendance} 节待点名 · {pendingNotifications} 条通知待确认</p>
            </div>
            <div className="metric-grid four">
              <MiniStat label="课程" value={todayLessons} />
              <MiniStat label="待办" value={dashboard?.pendingReschedules ?? 0} />
              <MiniStat label="低课时" value={dashboard?.lowBalanceStudents ?? 0} />
              <MiniStat label="逾期" value={dashboard?.overdueOrders ?? 0} />
            </div>
            <div className="button-row">
              <Button variant="primary" size="compact" type="button" onClick={() => setView("dashboard")}>打开工作台</Button>
              <Button variant="secondary" size="compact" type="button" onClick={() => setView("notifications")}>处理通知</Button>
            </div>
          </div>
        </Panel>
        <div>
          <div className="segmented">
            <button className={mobileMode === "teacher" ? "is-active" : ""} type="button" onClick={() => setMobileMode("teacher")}>教师端</button>
            <button className={mobileMode === "parent" ? "is-active" : ""} type="button" onClick={() => setMobileMode("parent")}>家长端</button>
          </div>
          <div className="phone-row">
            <PhoneFrame
              title={mobileMode === "teacher" ? "教师移动端" : "家长移动端"}
              subtitle={
                mobileMode === "teacher"
                  ? `${selectedLesson?.teacher || "老师"} 今日课程`
                  : `${selectedLesson?.studentName || "学生"} 家长服务`
              }
            >
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
