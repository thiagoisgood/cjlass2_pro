import React from "react";
import { Download, History, CircleDollarSign, ListChecks, Users, CheckCircle2, BarChart3, Receipt, Database } from "lucide-react";
import { PageHeader, Panel } from "../components/Common.jsx";
import { LineChart } from "../components/LineChart.jsx";

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

export function ReportsPage({ snapshot, dashboard, reports, ledgerSummaries, month, setMonth, openExport, setView }) {
  const months = ["2024-04", "2024-05", "2024-06"];
  const lessons = snapshot?.lessons || [];
  const students = snapshot?.students || [];
  
  const lessonLedgerRows = ledgerSummaries?.lessons || [];
  const paymentLedgerRows = ledgerSummaries?.payments || [];
  
  const teacherPayroll = reports?.teacherPayroll || [];
  const reminders = reports?.reminders || [];
  const trendData = reports?.incomeTrend || [];

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
        <MetricCard icon={CircleDollarSign} tone="green" label="收入" value={currency(reports?.income ?? 0)} helper={`${month} 已收款`} />
        <MetricCard icon={ListChecks} tone="blue" label="课消" value={`${reports?.consumedLessons ?? 0} 节`} helper="完成课次聚合" />
        <MetricCard icon={Users} tone="purple" label="学员" value={reports?.newStudents ?? 0} helper="当前活跃档案" />
        <MetricCard icon={CheckCircle2} tone="orange" label="到课率" value={percent(reports?.attendanceRate ?? 0)} helper="考勤流水计算" />
      </div>
      <div className="reports-grid">
        <Panel title="收入趋势" icon={BarChart3} className="revenue-panel">
          <LineChart data={trendData} />
          <div className="chart-labels"><span>周一</span><span>周三</span><span>周五</span><span>周日</span></div>
        </Panel>
        <Panel title="课酬与提醒" icon={Receipt}>
          <div className="progress-list">
            {teacherPayroll.length ? (
              teacherPayroll.map((row) => (
                <div className="progress-row" key={row.teacher}>
                  <div>
                    <strong>{row.teacher}</strong>
                    <small>{row.lessons} 节课 · {currency(row.pay)}</small>
                  </div>
                  <i style={{ width: `${Math.min(100, (row.lessons || 0) * 8)}%` }} />
                </div>
              ))
            ) : (
              <div style={{ color: "var(--muted)", padding: "8px" }}>暂无课酬汇总</div>
            )}
          </div>
          <div className="insight-list">
            {reminders.length ? (
              reminders.map((item) => (
                <button
                  key={item.title}
                  className="insight-row"
                  type="button"
                  onClick={() =>
                    setView(
                      item.action?.includes("学员")
                        ? "students"
                        : item.action?.includes("订单")
                        ? "billing"
                        : "schedule",
                    )
                  }
                >
                  <span className={`bullet-dot ${item.tone || "gray"}`} />
                  <span>
                    <strong>{item.title}</strong>
                    <p>{item.text}</p>
                  </span>
                </button>
              ))
            ) : (
              <div style={{ color: "var(--muted)", padding: "8px" }}>暂无预警信息</div>
            )}
          </div>
        </Panel>
      </div>
      <Panel title="账本核对" icon={ListChecks}>
        <div className="ledger-grid">
          <table className="data-table audit-table">
            <thead><tr><th>学员</th><th>基础课时</th><th>流水变动</th><th>当前余额</th></tr></thead>
            <tbody>
              {lessonLedgerRows.length ? (
                lessonLedgerRows.slice(0, 5).map((row) => (
                  <tr key={row.studentId}>
                    <td>{row.student}</td>
                    <td>{row.baseRemainingHours}</td>
                    <td>{signedNumber(row.ledgerDelta)}</td>
                    <td>{row.remainingHours} 节</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>暂无课时变动数据</td></tr>
              )}
            </tbody>
          </table>
          <table className="data-table audit-table">
            <thead><tr><th>订单</th><th>应收</th><th>流水已收</th><th>未收</th></tr></thead>
            <tbody>
              {paymentLedgerRows.length ? (
                paymentLedgerRows.slice(0, 5).map((row) => (
                  <tr key={row.orderId}>
                    <td>{row.student}</td>
                    <td>{currency(row.amount)}</td>
                    <td>{currency(row.paidFromLedger)}</td>
                    <td>{currency(row.outstanding)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>暂无收款核查数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="经营底表" icon={Database}>
        <table className="data-table audit-table">
          <thead><tr><th>指标</th><th>数值</th><th>来源</th><th>操作</th></tr></thead>
          <tbody>
            <tr>
              <td>课程数</td>
              <td>{lessons.length}</td>
              <td>/lessons</td>
              <td><button className="link-button" type="button" onClick={() => setView("schedule")}>查看</button></td>
            </tr>
            <tr>
              <td>学员数</td>
              <td>{students.length}</td>
              <td>/students</td>
              <td><button className="link-button" type="button" onClick={() => setView("students")}>查看</button></td>
            </tr>
            <tr>
              <td>待办数</td>
              <td>{dashboard?.pendingReschedules ?? 0}</td>
              <td>/business-tasks</td>
              <td><button className="link-button" type="button" onClick={() => setView("chat")}>处理</button></td>
            </tr>
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

const toneClass = {
  blue: "tone-blue",
  green: "tone-green",
  orange: "tone-orange",
  purple: "tone-purple",
  red: "tone-red",
  gray: "tone-gray",
};

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
