import React from "react";
import { Route, Receipt, CircleDollarSign, SquarePen, Bot, Send, CheckCircle2, AlertTriangle, Database, XCircle } from "lucide-react";
import { PageHeader, Panel, EmptyState, SettingRow } from "../components/Common.jsx";
import { api } from "../api.js";

export function ChatPage({
  snapshot,
  selectedTask,
  selectedTaskId,
  setSelectedTaskId,
  setModal,
  runMutation,
  commandText,
  setCommandText,
  runCommand,
  commandResult,
}) {
  const tasks = snapshot?.tasks || [];
  const agentApprovals = snapshot?.agentApprovals || [];
  const agentToolCalls = snapshot?.agentToolCalls || [];

  function submitChat(event) {
    event.preventDefault();
    void runCommand("chat", commandText || "帮我把今天下午 3:30 的课调到明天下午");
  }

  return (
    <section className="content page-stack">
      <PageHeader
        title="聊天确认"
        description="自然语言先经 Agent 规划，再进入受控工具、审批、业务任务或财务流程。"
        actions={[
          { label: "生成调课预览", icon: Route, onClick: () => runCommand("chat", "帮我把张子涵的英语课调到明天上午"), primary: true },
          { label: "退款追问", icon: Receipt, onClick: () => runCommand("chat", "给张子涵订单退款 300 元") },
          { label: "课酬结算", icon: CircleDollarSign, onClick: () => runCommand("chat", "生成并确认本周课酬") },
          { label: "使用表单", icon: SquarePen, onClick: () => setModal("proposal") },
        ]}
      />
      <div className="chat-layout">
        <div className="chat-phone">
          <div className="chat-title">
            <span>教务助手</span>
            <Bot size={20} />
          </div>
          <div className="chat-body">
            <div className="bubble user">帮我把今天下午 3:30 的课调到明天下午</div>
            <div className="assistant-line">
              <span><Bot size={18} /></span>
              <p>我会先生成影响预览，不会直接改课表。</p>
            </div>
            {selectedTask ? (
              <div className="chat-card">
                <strong>{selectedTask.title}</strong>
                <p>{selectedTask.proposal?.original || "无"} → {selectedTask.proposal?.target || "无"}</p>
                <small>{selectedTask.status}</small>
              </div>
            ) : (
              <div className="chat-card">
                <strong>暂无调课预览</strong>
                <p>输入业务指令可自动生成调课预览</p>
              </div>
            )}
            {commandResult ? (
              <div className="command-result">
                <CheckCircle2 size={20} />
                <div>
                  <strong>{commandResult.title}</strong>
                  <p>{commandResult.body}</p>
                  {commandResult.hermes ? <small>Agent: {commandResult.hermes} · {commandResult.agentRunId}</small> : null}
                </div>
              </div>
            ) : null}
          </div>
          <form className="chat-input" onSubmit={submitChat}>
            <input value={commandText} onChange={(event) => setCommandText(event.target.value)} placeholder="输入调课、催缴或点名指令" />
            <button type="submit" aria-label="发送"><Send size={16} /></button>
          </form>
        </div>
        
        <Panel title="业务任务确认" icon={Route} className="task-panel">
          {tasks.length ? (
            <div className="task-selector">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  className={task.id === selectedTaskId ? "is-active" : ""}
                  type="button"
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  {task.title} · {task.status}
                </button>
              ))}
            </div>
          ) : null}

          {selectedTask ? (
            <div className="business-card">
              <h3>{selectedTask.title}</h3>
              <p>{selectedTask.sourceText}</p>
              <dl className="info-list">
                <div><dt>原安排</dt><dd>{selectedTask.proposal?.original || "无"}</dd></div>
                <div><dt>目标安排</dt><dd>{selectedTask.proposal?.target || "无"}</dd></div>
                <div><dt>幂等键</dt><dd>{selectedTask.idempotencyKey}</dd></div>
                <div><dt>版本检查</dt><dd>expected v{selectedTask.expectedVersion}</dd></div>
              </dl>
              <div className="check-grid">
                {(selectedTask.checks || []).map((check) => (
                  <span key={check.label}>
                    {check.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                    {check.label}
                  </span>
                ))}
              </div>
              <ul>
                {(selectedTask.effects || []).map((effect) => <li key={effect}>{effect}</li>)}
              </ul>
              <div className="button-row">
                <button className="primary-button" type="button" disabled={selectedTask.status !== "等待确认"} onClick={() => runMutation(() => api.confirmTask(selectedTask.id, selectedTask.expectedVersion), "业务任务已确认执行")}>
                  <CheckCircle2 size={16} /> 确认执行
                </button>
                <button className="secondary-button" type="button" disabled={selectedTask.status !== "等待确认"} onClick={() => runMutation(() => api.cancelTask(selectedTask.id, selectedTask.expectedVersion), "业务任务已取消")}>
                  <XCircle size={16} /> 取消任务
                </button>
                <button className="secondary-button" type="button" onClick={() => setModal("proposal")}>
                  <SquarePen size={16} /> 修改内容
                </button>
              </div>
            </div>
          ) : (
            <EmptyState title="暂无业务确认流程" text="当前无可供执行的调课或排课业务任务。" />
          )}
        </Panel>

        <Panel title="Agent 审批与工具调用" icon={Bot} className="task-panel">
          <div className="setting-list">
            {agentApprovals.length ? (
              agentApprovals.slice(0, 5).map((approval) => (
                <SettingRow
                  key={approval.id}
                  title={`${approval.toolName} · ${approval.status}`}
                  text={`${approval.riskLevel} · ${approval.createdAt}`}
                  icon={approval.status === "approved" ? CheckCircle2 : AlertTriangle}
                />
              ))
            ) : (
              <div style={{ color: "var(--muted)", padding: "8px" }}>暂无审批请求</div>
            )}
            {agentToolCalls.length ? (
              agentToolCalls.slice(0, 5).map((call) => (
                <SettingRow
                  key={call.id}
                  title={`${call.toolName} · ${call.status}`}
                  text={`${call.agentRunId} · ${call.durationMs || 0}ms`}
                  icon={Database}
                />
              ))
            ) : (
              <div style={{ color: "var(--muted)", padding: "8px" }}>暂无工具调用记录</div>
            )}
          </div>
        </Panel>
      </div>
    </section>
  );
}
