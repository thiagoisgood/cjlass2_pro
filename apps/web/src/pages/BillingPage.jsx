import React from "react";
import { Plus, Receipt, BellRing, Download, CircleDollarSign, AlertTriangle, WalletCards, FileText, Users, Database } from "lucide-react";
import { PageHeader, Panel, MetricCard } from "../components/Common.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { api } from "../api.js";

function currency(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

export function BillingPage({ snapshot, setModal, runMutation, openExport, setView }) {
  const orders = snapshot?.orders || [];
  const pendingOrders = orders.filter((order) => order.status !== "已结清");
  const totalAmount = orders.reduce((sum, order) => sum + (order.amount || 0), 0);
  const paidAmount = orders.reduce((sum, order) => sum + (order.paid || 0), 0);
  
  const invoices = snapshot?.invoices || [];
  const refunds = snapshot?.refunds || [];
  const payrollRecords = snapshot?.payrollRecords || [];
  const financialLedgerEntries = snapshot?.financialLedgerEntries || [];
  
  const payablePayroll = payrollRecords
    .filter((record) => record.status !== "settled")
    .reduce((sum, record) => sum + (record.amount || 0), 0);

  return (
    <section className="content page-stack">
      <PageHeader
        title="收费管理"
        description="订单、收款、发票、退款、课酬和正式分录在同一业务闭环里流转。"
        actions={[
          { label: "创建订单", icon: Plus, onClick: () => setModal("order"), primary: true },
          { label: "生成课酬", icon: Receipt, onClick: () => runMutation(() => api.generatePayroll(), "课酬记录已生成") },
          { label: "生成催缴草稿", icon: BellRing, onClick: () => runMutation(() => api.generateDunningDrafts(), "催缴草稿已生成") },
          { label: "导出账单", icon: Download, onClick: () => openExport("orders") },
        ]}
      />
      <div className="metric-grid four">
        <MetricCard icon={Receipt} tone="blue" label="订单总额" value={currency(totalAmount)} helper="数据库订单聚合" />
        <MetricCard icon={CircleDollarSign} tone="green" label="已收款" value={currency(paidAmount)} helper="支付流水聚合" />
        <MetricCard icon={AlertTriangle} tone="red" label="退款待处理" value={refunds.filter((refund) => refund.status !== "settled" && refund.status !== "rejected").length} helper="申请/审批/结算" />
        <MetricCard icon={Receipt} tone="orange" label="待付课酬" value={currency(payablePayroll)} helper="待确认或待结算" />
      </div>
      <div className="billing-grid">
        <Panel title="待收款" icon={WalletCards} className="pending-panel">
          <div className="pending-list">
            {pendingOrders.length ? (
              pendingOrders.map((order) => (
                <div className="pending-card" key={order.id}>
                  <small>{order.invoice || "未开票"}</small>
                  <strong>{order.student}</strong>
                  <p>{order.name}</p>
                  <b>{currency(order.amount - order.paid)}</b>
                  <div className="button-row">
                    <Button variant="primary" size="compact" type="button" onClick={() => runMutation(() => api.recordPayment(order.id), "支付流水已结清订单")}>记录收款</Button>
                    <Button variant="secondary" size="compact" type="button" onClick={() => runMutation(() => api.issueInvoice(order.id), "发票已开具并写入分录")}>开票</Button>
                    <Button
                      variant="secondary"
                      size="compact"
                      type="button"
                      onClick={() =>
                        runMutation(
                          () =>
                            api.createNotification({
                              title: `${order.student}缴费提醒`,
                              type: "缴费提醒",
                              recipient: `${order.student}家长`,
                              channel: "微信",
                              content: `您好，${order.student}的${order.name}还有待支付 ${currency(order.amount - order.paid)}，请您方便时完成支付。`,
                            }),
                          "缴费提醒草稿已创建",
                        )
                      }
                    >
                      催缴
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)" }}>暂无待收款项</div>
            )}
          </div>
        </Panel>
        <Panel title="订单流水" icon={FileText} className="orders-panel">
          <div className="table-toolbar">
            <Button variant="field" type="button" onClick={() => setView("reports")}><CircleDollarSign size={15} />查看报表</Button>
            <Button variant="field" type="button" onClick={() => openExport("orders")}><Download size={15} />导出 CSV</Button>
          </div>
          <table className="data-table compact-table">
            <thead><tr><th>学员</th><th>订单</th><th>金额</th><th>已收</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {orders.length ? (
                orders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.student}</td>
                    <td>{order.name}</td>
                    <td>{currency(order.amount)}</td>
                    <td>{currency(order.paid)}</td>
                    <td><Badge tone={order.status === "已结清" ? "green" : "orange"}>{order.status}</Badge></td>
                    <td>
                      <div className="inline-actions">
                        <Button variant="link" type="button" onClick={() => order.status === "已结清" ? setView("reports") : runMutation(() => api.recordPayment(order.id), "订单已结清")}>
                          {order.status === "align-green" || order.status === "已结清" ? "看报表" : "收款"}
                        </Button>
                        <Button variant="link" type="button" onClick={() => runMutation(() => api.issueInvoice(order.id), "发票已开具")}>开票</Button>
                        {order.paid > 0 ? <Button variant="link" tone="danger" type="button" onClick={() => runMutation(() => api.requestRefund({ orderId: order.id, amount: Math.min(order.paid, 300), reason: `${order.student}${order.name}退款申请` }), "退款申请已提交")}>退款</Button> : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)" }}>暂无订单数据</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
        <Panel title="发票与退款" icon={Receipt} className="finance-panel">
          <div className="finance-split">
            <div className="mini-ledger-list">
              {invoices.length ? (
                invoices.slice(0, 5).map((invoice) => {
                  const order = orders.find((item) => item.id === invoice.orderId);
                  return (
                    <div className="finance-row" key={invoice.id}>
                      <span className={`bullet-dot ${invoice.status === "issued" ? "green" : "orange"}`} />
                      <strong>{invoice.invoiceNo}</strong>
                      <small>{order?.student || invoice.orderId} · {currency(invoice.amount)} · {invoice.status}</small>
                    </div>
                  );
                })
              ) : (
                <div style={{ color: "var(--muted)", fontSize: "14px", padding: "8px" }}>暂无发票记录</div>
              )}
            </div>
            <div className="mini-ledger-list">
              {refunds.length ? (
                refunds.slice(0, 5).map((refund) => {
                  const order = orders.find((item) => item.id === refund.orderId);
                  return (
                    <div className="finance-row" key={refund.id}>
                      <span className={`bullet-dot ${refund.status === "settled" ? "green" : refund.status === "rejected" ? "red" : "orange"}`} />
                      <strong>{currency(refund.amount)}</strong>
                      <small>{order?.student || refund.orderId} · {refund.status}</small>
                      <div className="inline-actions">
                        {refund.status === "requested" ? <Button variant="link" type="button" onClick={() => runMutation(() => api.approveRefund(refund.id), "退款已审批")}>审批</Button> : null}
                        {refund.status === "approved" ? <Button variant="link" type="button" onClick={() => runMutation(() => api.settleRefund(refund.id), "退款已结算")}>结算</Button> : null}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ color: "var(--muted)", fontSize: "14px", padding: "8px" }}>暂无退款申请</div>
              )}
            </div>
          </div>
        </Panel>
        <Panel title="课酬确认与结算" icon={Users} className="payroll-panel">
          <table className="data-table compact-table">
            <thead><tr><th>教师</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {payrollRecords.length ? (
                payrollRecords.slice(0, 8).map((record) => (
                  <tr key={record.id}>
                    <td>{record.teacherName}</td>
                    <td>{currency(record.amount)}</td>
                    <td><Badge tone={record.status === "settled" ? "green" : "orange"}>{record.status}</Badge></td>
                    <td>
                      <div className="inline-actions">
                        {record.status === "pending" ? <Button variant="link" type="button" onClick={() => runMutation(() => api.confirmPayrollRecord(record.id), "课酬已确认")}>确认</Button> : null}
                        {record.status === "confirmed" ? <Button variant="link" type="button" onClick={() => runMutation(() => api.settlePayrollRecord(record.id), "课酬已结算")}>结算</Button> : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>暂无课酬记录</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
        <Panel title="正式财务分录" icon={Database} className="ledger-panel">
          <table className="data-table compact-table">
            <thead><tr><th>科目</th><th>方向</th><th>金额</th><th>来源</th></tr></thead>
            <tbody>
              {financialLedgerEntries.length ? (
                financialLedgerEntries.slice(0, 10).map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.account}</td>
                    <td>{entry.direction === "debit" ? "借" : "贷"}</td>
                    <td>{currency(entry.amount)}</td>
                    <td>{entry.sourceType}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>暂无分录数据</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>
    </section>
  );
}
