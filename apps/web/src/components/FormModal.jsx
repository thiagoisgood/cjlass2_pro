import React from "react";
import { XCircle, Save } from "lucide-react";

export function FormModal({ type, snapshot, selectedLesson, onClose, onSubmit }) {
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
          <h2>{titles[type] || "提交表单"}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <XCircle size={18} />
          </button>
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

export function StudentFields() {
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

export function LessonFields({ snapshot }) {
  const students = snapshot?.students || [];
  return (
    <div className="form-grid">
      <label>
        学员
        <select name="studentId" defaultValue={students[0]?.id}>
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.name}</option>
          ))}
        </select>
      </label>
      <label>课程标题<input name="title" defaultValue="英语一对一" required /></label>
      <label>
        课程类型
        <select name="type" defaultValue="一对一">
          <option>一对一</option>
          <option>小组课</option>
          <option>固定班</option>
        </select>
      </label>
      <label>
        星期
        <select name="day" defaultValue="2">
          <option value="0">周一</option>
          <option value="1">周二</option>
          <option value="2">周三</option>
          <option value="3">周四</option>
          <option value="4">周五</option>
          <option value="5">周六</option>
          <option value="6">周日</option>
        </select>
      </label>
      <label>日期<input name="date" defaultValue="05/08" /></label>
      <label>开始<input name="start" defaultValue="15:30" /></label>
      <label>结束<input name="end" defaultValue="16:30" /></label>
      <label>老师<input name="teacher" defaultValue="林老师" /></label>
      <label>教室<input name="room" defaultValue="教室A" /></label>
      <label>课消金额<input name="price" type="number" min="0" defaultValue="180" /></label>
    </div>
  );
}

export function OrderFields({ snapshot }) {
  const students = snapshot?.students || [];
  return (
    <div className="form-grid">
      <label>
        学员
        <select name="studentId" defaultValue={students[0]?.id}>
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.name}</option>
          ))}
        </select>
      </label>
      <label>订单名称<input name="name" defaultValue="数学培优 10课时包" required /></label>
      <label>总金额<input name="amount" type="number" min="0" defaultValue="2600" required /></label>
      <label>已收金额<input name="paid" type="number" min="0" defaultValue="0" /></label>
      <label>
        渠道
        <select name="channel" defaultValue="未收款">
          <option>未收款</option>
          <option>微信支付</option>
          <option>银行转账</option>
        </select>
      </label>
      <label>到期状态<input name="due" defaultValue="待确认" /></label>
    </div>
  );
}

export function NotificationFields({ snapshot }) {
  const students = snapshot?.students || [];
  return (
    <div className="form-grid">
      <label>
        类型
        <select name="type" defaultValue="课程提醒">
          <option>课程提醒</option>
          <option>缴费提醒</option>
          <option>调课通知</option>
          <option>课程反馈</option>
        </select>
      </label>
      <label>标题<input name="title" defaultValue="课程提醒" required /></label>
      <label>
        接收人
        <select name="recipient" defaultValue={students[0]?.guardian}>
          {students.map((student) => (
            <option key={student.id} value={student.guardian}>{student.guardian}</option>
          ))}
        </select>
      </label>
      <label>
        渠道
        <select name="channel" defaultValue="微信">
          <option>微信</option>
          <option>企业微信</option>
          <option>站内</option>
        </select>
      </label>
      <label className="wide-field">内容<textarea name="content" defaultValue="明天有课程，请提前 15 分钟到达教室，记得携带教材。" required /></label>
    </div>
  );
}

export function ProposalFields({ snapshot, selectedLesson }) {
  const lessons = snapshot?.lessons || [];
  return (
    <div className="form-grid">
      <label>
        关联课程
        <select name="lessonId" defaultValue={selectedLesson?.id}>
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>{lesson.studentName} · {lesson.title} · {lesson.start}</option>
          ))}
        </select>
      </label>
      <label className="wide-field">业务指令<textarea name="text" defaultValue="把这节课调到明天上午 10:30，并通知家长和老师。" required /></label>
    </div>
  );
}
