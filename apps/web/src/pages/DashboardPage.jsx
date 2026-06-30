import React from "react";
import {
  CalendarDays,
  ListChecks,
  BellRing,
  Route,
  AlertTriangle,
  CircleDollarSign,
  Zap,
  ChevronRight,
  BarChart3,
  Command,
  Users,
  Receipt,
  WalletCards,
  Clock,
  Plus,
  Download,
} from "lucide-react";
import { PageHeader, MetricCard, Panel, MiniStat, SimpleRow } from "../components/Common.jsx";
import { LineChart } from "../components/LineChart.jsx";
import { api } from "../api.js";

const toneClass = {
  blue: "tone-blue",
  green: "tone-green",
  orange: "tone-orange",
  purple: "tone-purple",
  red: "tone-red",
  gray: "tone-gray",
};

function currency(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

export function DashboardPage({
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
  const pendingOrder = (snapshot?.orders || []).find((order) => order.status !== "已结清");
  const todos = dashboard?.todos || [];
  const weekStats = dashboard?.week || { lessons: 0, visits: 0, newStudents: 0, revenue: 0 };
  const trendData = reports?.incomeTrend || [];

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
        <MetricCard icon={CalendarDays} tone="blue" label="今日课程" value={dashboard?.todayLessons ?? 0} helper="实时课程数量" />
        <MetricCard icon={ListChecks} tone="green" label="待点名" value={dashboard?.pendingAttendance ?? 0} helper="未完成考勤" />
        <MetricCard icon={BellRing} tone="orange" label="待发送通知" value={dashboard?.pendingNotifications ?? 0} helper="草稿和待发送" />
        <MetricCard icon={Route} tone="purple" label="待确认业务" value={dashboard?.pendingReschedules ?? 0} helper="Proposal 流程" />
        <MetricCard icon={AlertTriangle} tone="red" label="低课时学员" value={dashboard?.lowBalanceStudents ?? 0} helper="小于等于 3 节" />
        <MetricCard icon={CircleDollarSign} tone="gray" label="已收款" value={currency(weekStats.revenue)} helper="订单流水聚合" />
      </div>

      <div className="dashboard-grid">
        <Panel title="经营待办" icon={Zap}>
          <div className="todo-list">
            {todos.length ? (
              todos.map((todo) => (
                <button key={todo.id} className="todo-row" type="button" onClick={() => setView(todo.view)}>
                  <span className={`metric-icon ${toneClass[todo.tone] || "tone-gray"}`}><ChevronRight size={18} /></span>
                  <span>
                    <strong>{todo.title}</strong>
                    <p>{todo.subtitle}</p>
                  </span>
                  <b>{todo.action}</b>
                </button>
              ))
            ) : (
              <div style={{ padding: "20px", textAlign: "center", color: "var(--muted)" }}>暂无待办事项</div>
            )}
          </div>
        </Panel>
        <Panel title="本周业务曲线" icon={BarChart3}>
          <LineChart data={trendData} />
          <div className="mini-stat-grid">
            <MiniStat label="课次" value={weekStats.lessons} />
            <MiniStat label="触达家长" value={weekStats.visits} />
            <MiniStat label="新增学员" value={weekStats.newStudents} />
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
            <SimpleRow
              title="下一节课"
              text={selectedLesson ? `${selectedLesson.title} · ${selectedLesson.studentName} · ${selectedLesson.start}-${selectedLesson.end}` : "暂无排课安排"}
              action="点名到课"
              onClick={() => selectedLesson ? runMutation(() => api.markAttendance(selectedLesson.id, "已到课"), "点名已记录并扣减课时") : setView("schedule")}
            />
            <SimpleRow
              title="待收账单"
              text={pendingOrder ? `${pendingOrder.student} ${currency(pendingOrder.amount - pendingOrder.paid)} 待收` : "暂无待收账单"}
              action="记录收款"
              onClick={() => pendingOrder ? runMutation(() => api.recordPayment(pendingOrder.id), "收款流水已写入") : setView("billing")}
            />
            <SimpleRow
              title="通知中心"
              text={`${dashboard?.pendingNotifications ?? 0} 条通知等待人工确认`}
              action="去发送"
              onClick={() => setView("notifications")}
            />
          </div>
        </Panel>
      </div>
    </section>
  );
}
