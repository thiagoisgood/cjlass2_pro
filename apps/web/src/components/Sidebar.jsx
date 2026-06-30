import React from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  WalletCards,
  BellRing,
  BarChart3,
  Settings,
  Smartphone,
  MessageCircle,
  BookOpen,
  ShieldCheck,
} from "lucide-react";

const navItems = [
  { id: "dashboard", label: "工作台", icon: LayoutDashboard },
  { id: "schedule", label: "课表", icon: CalendarDays },
  { id: "students", label: "学员", icon: Users },
  { id: "billing", label: "收费", icon: WalletCards },
  { id: "notifications", label: "通知", icon: BellRing },
  { id: "reports", label: "报表", icon: BarChart3 },
  { id: "settings", label: "设置", icon: Settings },
  { id: "mobile", label: "多端入口", icon: Smartphone },
  { id: "chat", label: "聊天确认", icon: MessageCircle },
];

export function Sidebar({ snapshot, view, onView, pendingCount }) {
  const connected = snapshot?.channelIntegrations?.filter((item) => item.status === "connected").length ?? 0;
  return (
    <aside className="sidebar">
      <button className="brand" type="button" onClick={() => onView("dashboard")}>
        <span className="brand-mark"><BookOpen size={19} /></span>
        <span>
          <strong>{snapshot?.organization?.name || "教务系统"}</strong>
          <small>{snapshot?.organization?.subtitle || ""}</small>
        </span>
      </button>
      <nav className="nav-list" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "is-active" : ""}`}
              type="button"
              onClick={() => onView(item.id)}
            >
              <Icon size={21} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <button className="channel-card" type="button" onClick={() => onView("settings")}>
        <ShieldCheck size={22} />
        <span>
          <strong>生产通道状态</strong>
          <small>{connected ? `${connected} 个通道已连接` : "未配置真实凭据，通道已隔离"}</small>
        </span>
        {pendingCount ? <span className="dot-count">{pendingCount}</span> : null}
      </button>
    </aside>
  );
}
