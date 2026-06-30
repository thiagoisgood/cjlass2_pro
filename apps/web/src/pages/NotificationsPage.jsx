import React from "react";
import { Plus, Send, BellRing, SquarePen, Save, Clock, Receipt } from "lucide-react";
import { PageHeader, Panel, EmptyState } from "../components/Common.jsx";
import { Button } from "../components/ui/Button.jsx";
import { api } from "../api.js";

export function NotificationsPage({
  snapshot,
  selectedNotification,
  selectedNotificationId,
  setSelectedNotificationId,
  setModal,
  runMutation,
}) {
  const notifications = snapshot?.notifications || [];

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
          {selectedNotification ? (
            <>
              <div className="draft-box">
                <strong>{selectedNotification.title}</strong>
                <p>{selectedNotification.content}</p>
              </div>
              <div className="editor-fields">
                <label>接收人<input value={selectedNotification.recipient || ""} readOnly /></label>
                <label>渠道<input value={selectedNotification.channel || ""} readOnly /></label>
                <label className="textarea-label">
                  正文
                  <textarea
                    value={selectedNotification.content || ""}
                    onChange={(event) =>
                      runMutation(
                        () => api.updateNotification(selectedNotification.id, { content: event.target.value }),
                        "通知正文已保存",
                      )
                    }
                  />
                </label>
              </div>
              <div className="editor-actions">
                <Button variant="primary" type="button" onClick={() => runMutation(() => api.sendNotification(selectedNotification.id), "通知已发送")}>
                  <Send size={16} /> 立即发送
                </Button>
                <Button variant="secondary" type="button" onClick={() => runMutation(() => api.updateNotification(selectedNotification.id, { status: "草稿" }), "草稿已保存")}>
                  <Save size={16} /> 保存草稿
                </Button>
                <Button variant="secondary" type="button" onClick={() => runMutation(() => api.scheduleNotification(selectedNotification.id, "明日 09:00"), "通知已预约发送")}>
                  <Clock size={16} /> 预约发送
                </Button>
              </div>
              <div className="wechat-preview">
                <span>微信预览</span>
                <div>{selectedNotification.content}</div>
              </div>
            </>
          ) : (
            <EmptyState title="未选择通知" text="请在右侧列表中选择一条通知草稿进行编辑。" />
          )}
        </Panel>
        
        <Panel title="通知列表" icon={BellRing}>
          <div className="notification-list">
            {notifications.length ? (
              notifications.map((note) => (
                <button
                  key={note.id}
                  className={`notification-card ${note.id === selectedNotificationId ? "is-selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedNotificationId(note.id)}
                >
                  <span className={`round-icon ${note.status === "已发送" ? "green" : note.status === "预约发送" ? "blue" : "orange"}`}>
                    <BellRing size={16} />
                  </span>
                  <span className="notification-select">
                    <strong>{note.title}</strong>
                    <small>{note.recipient} · {note.channel} · {note.createdAt}</small>
                  </span>
                  <b>{note.status}</b>
                </button>
              ))
            ) : (
              <EmptyState title="暂无通知记录" text="点击新建通知可以起草新内容。" />
            )}
          </div>
        </Panel>
      </div>
    </section>
  );
}
