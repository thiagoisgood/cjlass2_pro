import React from "react";
import { Plus, Receipt, BellRing, History, MessageCircle, Send, CalendarDays } from "lucide-react";
import { PageHeader, StudentStat, Panel, EmptyState } from "../components/Common.jsx";
import { Button } from "../components/ui/Button.jsx";
import { api } from "../api.js";

function currency(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

export function StudentsPage({
  snapshot,
  selectedStudent,
  selectedStudentId,
  setSelectedStudentId,
  setModal,
  setView,
  runMutation,
}) {
  const students = snapshot?.students || [];

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
      
      {students.length ? (
        <div className="selector-row">
          {students.map((student) => (
            <button
              key={student.id}
              className={student.id === selectedStudentId ? "is-active" : ""}
              type="button"
              onClick={() => setSelectedStudentId(student.id)}
            >
              {student.name}
            </button>
          ))}
        </div>
      ) : null}

      {selectedStudent ? (
        <>
          <div className="student-hero">
            <div className="avatar-large">{selectedStudent.short || selectedStudent.name?.slice(0, 1)}</div>
            <div className="student-title">
              <h2>{selectedStudent.name}</h2>
              <p>{selectedStudent.grade} · {selectedStudent.status} · {selectedStudent.code}</p>
              <div className="tag-row">
                {(selectedStudent.tags || []).map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            </div>
            <div className="teacher-line">
              <span>授课老师：{selectedStudent.teacher}</span>
              <span>家长：{selectedStudent.guardian}</span>
              <span>电话：{selectedStudent.phone}</span>
            </div>
          </div>

          <div className="metric-grid four">
            <StudentStat label="剩余课时" value={`${selectedStudent.remainingHours ?? 0} 节`} action="去排课" onClick={() => setView("schedule")} />
            <StudentStat label="课包有效期" value={selectedStudent.packageValidTo || "无限制"} action="续费订单" onClick={() => setModal("order")} />
            <StudentStat label="到课记录" value={selectedStudent.attendanceRate || "0%"} action="查看课表" onClick={() => setView("schedule")} />
            <StudentStat label="待收款" value={currency(selectedStudent.dueAmount)} action="去收款" onClick={() => setView("billing")} />
          </div>

          <div className="student-grid">
            <Panel title="课时流水" icon={History}>
              <div className="record-list">
                {(selectedStudent.records || []).length ? (
                  selectedStudent.records.map((record, index) => (
                    <div className="record-row" key={`${record.date}-${record.title}-${index}`}>
                      <strong>{record.title}</strong>
                      <p>{record.date} · {record.teacher} · {record.status}</p>
                      <small>{record.note}</small>
                    </div>
                  ))
                ) : (
                  <EmptyState title="暂无课时流水" text="点名后会自动写入课时流水。" />
                )}
              </div>
            </Panel>
            <Panel title="家校沟通" icon={MessageCircle}>
              <div className="communication-list">
                {(selectedStudent.communications || []).length ? (
                  selectedStudent.communications.map((item, index) => (
                    <div className="communication-row" key={`${item.time}-${item.title}-${index}`}>
                      <strong>{item.title}</strong>
                      <p>{item.time} · {item.type}</p>
                      <small>{item.text}</small>
                    </div>
                  ))
                ) : (
                  <EmptyState title="暂无沟通记录" text="发送通知或课后反馈后会在此汇总。" />
                )}
              </div>
            </Panel>
          </div>

          <div className="button-row">
            <Button
              variant="primary"
              type="button"
              onClick={() =>
                runMutation(
                  () =>
                    api.createNotification({
                      title: `${selectedStudent.name}课后反馈`,
                      type: "课程反馈",
                      recipient: selectedStudent.guardian,
                      channel: "微信",
                      content: `${selectedStudent.guardian}您好，${selectedStudent.name}本次课程已完成，课堂表现积极，建议继续复盘错题。`,
                    }),
                  "课后反馈草稿已创建",
                )
              }
            >
              <Send size={16} /> 生成课后反馈
            </Button>
            <Button variant="secondary" type="button" onClick={() => setModal("lesson")}><CalendarDays size={16} /> 排一节课</Button>
            <Button variant="secondary" type="button" onClick={() => setModal("order")}><Receipt size={16} /> 创建续费订单</Button>
          </div>
        </>
      ) : (
        <EmptyState title="暂无学员档案" text="请先点击右上角新增学员档案。" />
      )}
    </section>
  );
}
