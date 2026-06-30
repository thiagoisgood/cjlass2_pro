import React from "react";
import { Plus, CalendarDays, Route, CheckCircle2, BellRing, MessageCircle, XCircle } from "lucide-react";
import { PageHeader, EmptyState } from "../components/Common.jsx";
import { CalendarGrid } from "../components/CalendarGrid.jsx";
import { api } from "../api.js";

function currency(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

export function SchedulePage({
  snapshot,
  selectedLesson,
  selectedTask,
  setSelectedLessonId,
  setSelectedTaskId,
  setModal,
  runMutation,
  runCommand,
  setView,
  selectedLessonId,
}) {
  const lessons = snapshot?.lessons || [];
  const tasks = snapshot?.tasks || [];
  const pendingTasks = tasks.filter((task) => task.status === "等待确认");

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
            <button
              className="field-button small"
              type="button"
              disabled={!selectedLesson}
              onClick={() => selectedLesson && runMutation(() => api.markAttendance(selectedLesson.id, "已到课"), "已完成点名和课消")}
            >
              <CheckCircle2 size={15} />点名
            </button>
            <button
              className="field-button small"
              type="button"
              disabled={!selectedLesson}
              onClick={() => runCommand("web", "请为这节课生成课前提醒")}
            >
              <BellRing size={15} />提醒
            </button>
            <span className="spacer" />
            <button className="secondary-button compact" type="button" onClick={() => setView("chat")}><MessageCircle size={15} />聊天确认</button>
          </div>
          <CalendarGrid lessons={lessons} selectedLessonId={selectedLessonId} onSelect={setSelectedLessonId} />
        </div>
        <aside className="detail-panel">
          {selectedLesson ? (
            <>
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
            </>
          ) : (
            <EmptyState title="未选择课程" text="周历中暂无课程，或尚未点击选择一节课。" />
          )}

          {pendingTasks.length && selectedTask ? (
            <div className="proposal-card">
              <strong>待确认调课</strong>
              <p>{selectedTask.title}</p>
              <div className="button-row">
                <button
                  className="primary-button compact"
                  type="button"
                  onClick={() => {
                    setSelectedTaskId(selectedTask.id);
                    void runMutation(() => api.confirmTask(selectedTask.id, selectedTask.expectedVersion), "调课已确认并生成通知草稿");
                  }}
                >
                  确认执行
                </button>
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => runMutation(() => api.cancelTask(selectedTask.id, selectedTask.expectedVersion), "调课任务已取消")}
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
