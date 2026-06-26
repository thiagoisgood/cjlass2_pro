# 晓知教育工作室 - 智能教务系统

面向独立教师和小机构的轻量教务与经营系统，融合自然语言交互和传统表单操作。

## 产品定位

为独立教师、工作室、1-20 人小型培训机构提供完整的教务管理解决方案：

- **学员管理**：档案、家庭、课时、出勤记录
- **排课系统**：日历视图、冲突检测、周期课、批量排课
- **考勤课消**：自动扣减课时、不可变流水账本
- **收费管理**：订单、收款、退款、对账
- **通知中心**：多渠道通知（微信/企微/飞书/钉钉）
- **报表分析**：收入、课消、出勤率、教师课酬
- **AI 助手**：自然语言命令、Agent 工具调用、审批流程

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    用户入口层                            │
│  Web 管理端  |  移动端 H5  |  企微/飞书/钉钉 Bot         │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                  API Gateway (NestJS)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Auth/RBAC│  │ Request  │  │Idempotency│              │
│  │  Context │  │ Validation│ │  Control │               │
│  └──────────┘  └──────────┘  └──────────┘              │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              Core Business Service                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Students │  │ Lessons  │  │ Payments │               │
│  │& Families│  │& Schedule│  │& Billing │               │
│  └──────────┘  └──────────┘  └──────────┘              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │Attendance│  │Notifications│ │ Reports │              │
│  │& Ledger  │  │& Delivery │  │& Audit  │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              Agent Gateway (MCP Tools)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  Query   │  │ Proposal │  │ Execute  │              │
│  │  Tools   │  │  Tools   │  │  Tools   │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│  ┌──────────────────────┐                              │
│  │   Approval Flow      │  ← 高风险操作审批             │
│  └──────────────────────┘                              │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                 Persistence Layer                        │
│  ┌──────────────────┐    ┌──────────────────┐          │
│  │ PostgreSQL + RLS │    │  Redis (Queue)   │          │
│  │  - 增量写入模式   │    │  - Streams 队列  │          │
│  │  - 租户隔离策略   │    │  - 内存降级模式  │          │
│  │  - 不可变账本     │    │  - 通知投递      │          │
│  └──────────────────┘    └──────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

### 核心技术栈

- **后端**：NestJS + Fastify + TypeScript
- **前端**：React 19 + Vite + Lucide Icons
- **数据库**：PostgreSQL 16 + pgvector + RLS
- **缓存/队列**：Redis 7 + Streams
- **测试**：Node.js test runner + Playwright
- **部署**：Docker Compose

## 快速开始

### 环境要求

- Node.js >= 20
- PostgreSQL 16（或 Docker）
- Redis 7（可选，可用内存队列降级）

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
# 启动数据库（推荐）
npm run docker:up

# 或配置环境变量
export DATABASE_URL="postgresql://user:pass@localhost:5432/cjlass2"
export REDIS_URL="redis://localhost:6379"  # 可选
```

### 启动服务

```bash
# 启动 API 服务（端口 3001）
npm run dev -w @cjlass2/api

# 启动 Web 服务（端口 5173，新终端）
npm run dev -w @cjlass2/web
```

访问 http://127.0.0.1:5173

默认管理员账号：
- 邮箱：`admin@cjlass.local`
- 密码：`ChangeMe123!`

### 构建生产版本

```bash
npm run build
```

## 测试

```bash
# 运行所有测试
npm run test

# API 单元测试（46 个）
npm run test -w @cjlass2/api

# 前端 E2E 测试（7 个，需先启动 dev server）
npm run dev -w @cjlass2/web
npm run test:e2e -w @cjlass2/web
```

### 测试覆盖

- ✅ 完整业务流程（学员 → 订单 → 排课 → 考勤 → 收款 → 通知）
- ✅ 课时/收款流水账本（不可变、可逆）
- ✅ 幂等性控制和版本冲突
- ✅ 认证授权（Session + RBAC + RLS）
- ✅ 通知投递状态机
- ✅ Agent Gateway（15 个 MCP 工具 + 审批流程）
- ✅ 周期课生成和批量排课
- ✅ 数据库迁移和 schema 校验

## 项目结构

```
cjlass2-pro/
├── apps/
│   ├── api/                    # NestJS 后端
│   │   ├── src/core/
│   │   │   ├── core.service.ts       # 业务逻辑
│   │   │   ├── core.controller.ts    # HTTP 端点
│   │   │   ├── json-state.store.ts   # 持久化层
│   │   │   ├── agent-gateway.service.ts  # MCP 工具
│   │   │   ├── auth.service.ts       # 认证服务
│   │   │   └── request-context.ts    # 请求上下文
│   │   └── test/
│   │       └── core.service.test.ts  # API 测试
│   └── web/                    # React 前端
│       ├── src/
│       │   ├── App.jsx               # 主应用组件
│       │   └── api.js                # API 客户端
│       └── tests/
│           └── frontend.spec.ts      # E2E 测试
├── packages/
│   └── shared/                 # 共享类型定义
│       └── src/index.ts              # TypeScript 接口
├── infra/
│   └── postgres/
│       ├── init.sql                  # 初始化脚本
│       └── migrations/               # 数据库迁移
│           ├── 0001_initial_core_schema.sql
│           ├── 0002_notification_delivery_state_machine.sql
│           └── 0003_agent_tool_calls_and_approvals.sql
├── CLAUDE.md                   # Claude Code 指南
└── IMPLEMENTATION_COMPLETENESS_AUDIT.md  # 实现审计
```

## 核心概念

### 不可变账本模型

所有课时和财务数据使用追加式流水账本，不允许修改历史记录：

```typescript
// ✅ 正确：追加流水
ledger.push({
  studentId: 'stu-123',
  entryType: 'deduct',      // deduct | restore | adjustment
  hoursDelta: -1,
  reason: '课程课消',
  source: 'attendance'
});

// ❌ 错误：直接修改余额
student.remainingHours = 10;  // 禁止！
```

余额通过聚合计算：`baseRemainingHours + sum(hoursDelta)`

### 增量写入模式

数据库模式下使用 diff-based upsert，只更新变更的行：

```typescript
// 内存模式：全量替换
const state = await service.snapshot();
state.students.push(newStudent);
await store.save(state);

// 数据库模式：增量写入
const previous = await service.snapshot();
const next = { ...previous, students: [...previous.students, newStudent] };
await store.saveIncremental(previous, next);  // 只 upsert 变更行
```

### Agent Gateway (MCP 工具)

15 个工具分为四类：

| 类别 | 工具 | 用途 |
|------|------|------|
| **查询** | `student_search`, `schedule_query`, `teacher_availability` | 只读查询 |
| **方案** | `schedule_propose`, `refund_preview` | 预览不执行 |
| **执行** | `schedule_commit`, `attendance_mark`, `notification_send` | 写操作 |
| **高风险** | `refund_request`, `lesson_ledger_adjust` | 需审批 |

高风险操作自动触发审批流程，非生产环境下 admin 自动批准。

## API 文档

启动服务后访问：http://127.0.0.1:3001/api/v1/openapi.json

### 主要端点

```
# 认证
POST /auth/login              # 登录获取 token
GET  /auth/session            # 获取当前会话

# 学员管理
GET  /students                # 学员列表
POST /students                # 创建学员

# 排课
GET  /lessons                 # 课程列表
POST /lessons                 # 创建课程
POST /schedule/periodic       # 周期课生成
POST /schedule/batch          # 批量排课
GET  /availability/teacher/:name  # 教师可用性
GET  /availability/room/:name     # 教室可用性

# 考勤
POST /attendance              # 点名
GET  /lesson-ledger           # 课时流水
POST /lesson-ledger/:id/reverse   # 课时纠错

# 收费
POST /orders                  # 创建订单
POST /payments                # 记录收款
GET  /payment-ledger          # 收款流水

# 通知
POST /notifications           # 创建通知
POST /notifications/:id/send  # 发送通知
GET  /notification-deliveries # 投递记录

# Agent
GET  /mcp/tools               # MCP 工具列表
POST /mcp/execute             # 执行工具
GET  /mcp/approvals           # 审批列表
POST /mcp/approvals/:id/decide # 审批决策
```

## 环境变量

```bash
# 数据库（必需）
DATABASE_URL=postgresql://user:pass@localhost:5432/cjlass2

# Redis（可选，未配置时降级为内存队列）
REDIS_URL=redis://localhost:6379

# 认证
API_AUTH_TOKEN=your-api-token          # API 访问令牌
AUTH_SESSION_SECRET=your-secret        # Session 签名密钥

# 通知渠道（可选）
WECOM_CORP_ID=your-corp-id             # 企业微信
WECHAT_H5_APP_ID=your-app-id           # 微信 H5
FEISHU_APP_ID=your-app-id              # 飞书
DINGTALK_CLIENT_ID=your-client-id      # 钉钉

# Agent
HERMES_AGENT_URL=http://localhost:8080 # Hermes Agent 地址
NOTIFICATION_PROVIDER_MODE=mock        # 测试模式
```

## 数据库迁移

迁移文件位于 `infra/postgres/migrations/`，API 启动时自动执行：

```bash
# 当前版本：3
# 0001 - 核心 schema（租户、用户、学员、课程、订单、账本等）
# 0002 - 通知投递状态机
# 0003 - Agent 工具调用和审批表
```

迁移使用 SHA256 校验和防止篡改。

## 多租户隔离

所有业务表启用 PostgreSQL RLS（Row Level Security）：

```sql
-- 自动过滤当前租户数据
CREATE POLICY tenant_isolation_students ON students
  USING (tenant_id = current_setting('app.tenant_id', true));
```

事务上下文中自动设置 `app.tenant_id`，确保数据隔离。

## 开发指南

### 添加新业务操作

1. **Service 层**：在 `core.service.ts` 添加方法
2. **Controller 层**：在 `core.controller.ts` 添加端点
3. **OpenAPI**：在 `main.ts` 注册路由
4. **测试**：在 `core.service.test.ts` 添加测试用例

### 使用幂等性

```typescript
// 客户端发送
POST /api/v1/payments
Idempotency-Key: unique-request-id

// 服务端处理
return this.withMutation('recordPayment', input, { 
  idempotencyKey: 'unique-request-id' 
}, ...);
```

### 添加新的 MCP 工具

在 `agent-gateway.service.ts` 的 `registerBuiltinTools()` 中注册：

```typescript
this.registerTool({
  name: 'new_tool',
  description: '工具描述',
  category: 'query',  // query | proposal | execute | high_risk
  inputSchema: { /* JSON Schema */ },
  handler: async (input, context) => {
    // 实现逻辑
    return { result: '...' };
  }
});
```

## 部署

### Docker 部署

```bash
# 构建镜像
npm run build
docker compose build

# 启动服务
docker compose up -d

# 查看日志
docker compose logs -f api
```

### 生产配置

```bash
# 必需环境变量
DATABASE_URL=postgresql://...
AUTH_SESSION_SECRET=<随机生成的强密钥>
API_AUTH_TOKEN=<随机生成的强令牌>

# 推荐配置
NODE_ENV=production
REDIS_URL=redis://...
```

## 状态

- ✅ 后端生产化：~95%
- ✅ 前端真实化：~90%
- ✅ 基础设施：~80%
- ✅ 测试覆盖：46 API + 7 Playwright

详见 [IMPLEMENTATION_COMPLETENESS_AUDIT.md](./IMPLEMENTATION_COMPLETENESS_AUDIT.md)

## 许可证

Private - 内部项目

## 相关链接

- [最终产品技术方案](./resource/独立教师与小机构智能教务系统_最终产品技术方案.md)
- [实现审计报告](./IMPLEMENTATION_COMPLETENESS_AUDIT.md)
- [Claude Code 指南](./CLAUDE.md)
