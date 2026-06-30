import React from "react";
import { TabletSmartphone } from "lucide-react";
import { api } from "../api.js";
import { Button } from "./ui/Button.jsx";
import { Badge } from "./ui/Badge.jsx";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/Card.jsx";

const toneClass = {
  blue: "tone-blue",
  green: "tone-green",
  orange: "tone-orange",
  purple: "tone-purple",
  red: "tone-red",
  gray: "tone-gray",
};

export function PageHeader({ title, description, actions = [] }) {
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
            <Button
              key={action.label}
              variant={action.primary ? "primary" : "secondary"}
              type="button"
              onClick={action.onClick}
            >
              {Icon && <Icon size={16} />}
              {action.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export function Panel({ title, icon: Icon, children, className = "" }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {Icon ? <span><Icon size={18} /></span> : null}
      </CardHeader>
      {children}
    </Card>
  );
}

export function MetricCard({ icon: Icon, tone, label, value, helper }) {
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

export function MiniStat({ label, value }) {
  return (
    <div className="mini-stat">
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

export function StudentStat({ label, value, action, onClick }) {
  return (
    <Card className="student-stat">
      <small>{label}</small>
      <strong>{value}</strong>
      <Button variant="ghost" type="button" onClick={onClick}>{action}</Button>
    </Card>
  );
}

export function SimpleRow({ title, text, action, onClick }) {
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

export function SettingRow({ title, text, icon: Icon }) {
  return (
    <div className="setting-row">
      <span>{Icon && <Icon size={18} />}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}

export function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

export function PhoneFrame({ title, subtitle, children }) {
  return (
    <div className="phone-frame">
      <div className="phone-top"><span>9:41</span><TabletSmartphone size={17} /></div>
      <h3>{title}</h3>
      <p>{subtitle}</p>
      {children}
    </div>
  );
}

export function TeacherPhone({ selectedLesson, dashboard, runMutation, setView }) {
  if (!selectedLesson) {
    return <EmptyState title="暂无今日课程" text="课表为空，无法展示教师端。" />;
  }
  return (
    <>
      <div className="phone-stat-grid">
        <div className="mini-phone-stat"><strong>{dashboard?.todayLessons ?? 0}</strong><small>今日课程</small></div>
        <div className="mini-phone-stat"><strong>{dashboard?.pendingAttendance ?? 0}</strong><small>待点名</small></div>
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

export function ParentPhone({ selectedLesson, selectedTask, pendingOrder, runMutation, runCommand }) {
  const currency = (val) => `¥${Number(val || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
  return (
    <>
      <div className="date-strip">
        {["今天", "明天", "周五", "周六", "周日"].map((day, index) => (
          <button key={day} className={index === 1 ? "active" : ""} type="button" onClick={() => runCommand("parent-h5", `${day}查看课程安排`)}>
            <span>{day}</span><small>{index + 6}</small>
          </button>
        ))}
      </div>
      {selectedLesson ? (
        <div className="phone-card">
          <strong>{selectedLesson.title}</strong>
          <p>{selectedLesson.date} {selectedLesson.start}-{selectedLesson.end} · {selectedLesson.room}</p>
        </div>
      ) : (
        <div className="phone-card"><strong>暂无课程安排</strong></div>
      )}
      <div className="phone-tool-grid">
        <button className="tool-square tone-0" type="button" disabled={!selectedTask} onClick={() => selectedTask && runMutation(() => api.confirmTask(selectedTask.id, selectedTask.expectedVersion), "家长端已确认调课")}>确认</button>
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
