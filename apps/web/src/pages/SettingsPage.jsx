import React from "react";
import { RefreshCcw, Download, ShieldCheck, Database, Users, BarChart3, Route, Globe2, CheckCircle2, WifiOff, BookOpen, Bot, MessageCircle, History } from "lucide-react";
import { PageHeader, Panel, SettingRow } from "../components/Common.jsx";
import { api } from "../api.js";

export function SettingsPage({ snapshot, dashboard, refreshAll, openExport, runMutation, setView }) {
  const integrations = snapshot?.channelIntegrations || [];
  const ragDocs = snapshot?.ragDocs || [];
  const agentRuns = snapshot?.agentRuns || [];
  const auditLogs = snapshot?.auditLogs || [];

  return (
    <section className="content page-stack">
      <PageHeader
        title="设置"
        description="Auth/RBAC/Tenant、RAG、Agent Gateway、渠道网关和审计都通过后端接口暴露。"
        actions={[
          { label: "刷新状态", icon: RefreshCcw, onClick: refreshAll, primary: true },
          { label: "导出审计", icon: Download, onClick: () => openExport("audit") },
        ]}
      />
      <div className="settings-grid">
        <Panel title="租户与权限" icon={ShieldCheck}>
          <div className="setting-list">
            <SettingRow title="当前租户" text={snapshot?.organization?.id || "N/A"} icon={Database} />
            <SettingRow title="当前用户" text={`${snapshot?.organization?.user || "N/A"} · ${snapshot?.organization?.role || "N/A"}`} icon={Users} />
            <SettingRow title="RBAC 范围" text="admin scopes: *；所有写操作进入审计流水" icon={ShieldCheck} />
          </div>
          <div className="button-row">
            <button className="secondary-button compact" type="button" onClick={() => setView("reports")}><BarChart3 size={15} />查看经营报表</button>
            <button className="secondary-button compact" type="button" onClick={() => setView("chat")}><Route size={15} />查看待确认任务</button>
          </div>
        </Panel>
        <Panel title="渠道网关" icon={Globe2}>
          <div className="setting-list">
            {integrations.length ? (
              integrations.map((channel) => (
                <SettingRow
                  key={channel.id}
                  title={channel.name}
                  text={`${channel.description} · ${channel.status === "connected" ? "已连接" : "未连接"}`}
                  icon={channel.status === "connected" ? CheckCircle2 : WifiOff}
                />
              ))
            ) : (
              <div style={{ color: "var(--muted)", padding: "8px" }}>暂无渠道配置</div>
            )}
          </div>
          <button className="secondary-button compact" type="button" onClick={refreshAll}><RefreshCcw size={15} />重新检测连接</button>
        </Panel>
        <Panel title="RAG 知识库" icon={BookOpen}>
          <div className="setting-list">
            {ragDocs.length ? (
              ragDocs.map((doc) => (
                <div className="setting-row with-actions" key={doc.id}>
                  <span><BookOpen size={18} /></span>
                  <div>
                    <strong>{doc.title}</strong>
                    <p>{doc.scope} · {doc.status} · {doc.sourceCount ?? 0} 个片段 · {doc.parser || "seed"}{doc.expiresAt ? ` · 有效至 ${doc.expiresAt}` : ""}</p>
                    <div className="inline-actions">
                      <button className="link-button" type="button" onClick={() => runMutation(() => api.reindexKnowledgeDoc(doc.id), "知识库向量索引已重建")}>重建索引</button>
                      {doc.status === "生效中" ? <button className="link-button danger-link" type="button" onClick={() => runMutation(() => api.invalidateKnowledgeDoc(doc.id, "前台手动失效"), "知识文档已标记失效")}>标记失效</button> : null}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: "var(--muted)", padding: "8px" }}>暂无知识文档</div>
            )}
          </div>
          <button
            className="secondary-button compact"
            type="button"
            onClick={() =>
              runMutation(
                () =>
                  api.uploadKnowledgeDoc({
                    fileName: "退费与请假制度.md",
                    scope: "机构知识库",
                    mimeType: "text/markdown",
                    text: "请假需提前 24 小时提交；过期制度应标记失效。退款需保留订单、收款、退款和正式财务分录。",
                    sourceUri: "settings://sample-policy",
                  }),
                "知识文档已上传并生成向量索引",
              )
            }
          >
            <Database size={15} />上传制度样本
          </button>
        </Panel>
        <Panel title="Agent Gateway" icon={Bot}>
          <div className="setting-list">
            {agentRuns.length ? (
              agentRuns.map((run) => (
                <SettingRow key={run.id} title={run.task} text={`${run.status} · ${run.startedAt} · ${run.toolCalls ?? 0} 次受控工具调用`} icon={Bot} />
              ))
            ) : (
              <div style={{ color: "var(--muted)", padding: "8px" }}>暂无 Agent 运行记录</div>
            )}
            <SettingRow title="今日待办" text={`${dashboard?.pendingReschedules ?? 0} 个 Proposal 等待人工确认`} icon={Route} />
          </div>
          <button className="secondary-button compact" type="button" onClick={() => setView("chat")}><MessageCircle size={15} />打开 Agent 入口</button>
        </Panel>
      </div>
      <Panel title="审计流水" icon={History}>
        <table className="data-table audit-table">
          <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>摘要</th><th>状态</th></tr></thead>
          <tbody>
            {auditLogs.length ? (
              auditLogs.slice(0, 10).map((log) => (
                <tr key={log.id}>
                  <td>{log.time}</td>
                  <td>{log.actor}</td>
                  <td>{log.action}</td>
                  <td>{log.summary}</td>
                  <td>{log.status}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>暂无审计日志</td></tr>
            )}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}
