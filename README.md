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

# API 单元测试（49 个）
npm run test -w @cjlass2/api

# 前端 E2E 测试（8 个，Playwright 会启动隔离 API/Web 服务）
npm run dev -w @cjlass2/web
npm run test:e2e -w @cjlass2/web
```

### 测试覆盖

- ✅ 完整业务流程（学员 → 订单 → 排课 → 考勤 → 收款 → 通知）
- ✅ 课时/收款流水账本（不可变、可逆）
- ✅ 幂等性控制和版本冲突
- ✅ 认证授权（Session + RBAC + RLS）
- ✅ 通知投递状态机
- ✅ Agent Gateway（16 个 MCP 工具 + 持久化审批流程）
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
│           ├── 0003_agent_tool_calls_and_approvals.sql
│           ├── 0004_mvp_business_objects_and_channels.sql
│           ├── 0005_rag_vector_operations.sql
│           └── 0006_finance_controls_and_data_scope.sql
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

16 个工具分为四类：

| 类别 | 工具 | 用途 |
|------|------|------|
| **查询** | `student_search`, `student_get_profile`, `schedule_query`, `package_get_balance`, `finance_get_summary`, `knowledge_search` | 只读查询 |
| **方案** | `schedule_propose`, `schedule_check_conflicts` | 预览不执行 |
| **执行** | `schedule_commit`, `attendance_mark`, `notification_draft`, `notification_send`, `invoice_issue`, `payroll_generate` | 写操作 |
| **高风险** | `refund_request`, `payroll_settle` | 生产环境需审批 |

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
POST /invoices/issue          # 开具发票并写入正式分录
POST /refunds                 # 提交退款申请
POST /refunds/exceptional     # 提交异常退款申请
POST /refunds/:id/approve     # 审批退款
POST /refunds/:id/settle      # 结算退款并追加退款流水
GET  /financial-ledger        # 正式财务分录
POST /financial-ledger/reconcile # 财务对账
GET  /financial-accounts      # 财务科目
POST /financial-accounts      # 新增或更新财务科目
GET  /accounting-period-locks # 锁账记录
POST /accounting-periods/:period/lock # 锁定会计期间
GET  /reconciliation-runs     # 对账记录
POST /payroll/generate        # 生成课酬记录
POST /payroll-records/batch-confirm # 批量确认课酬
POST /payroll-records/:id/confirm # 确认课酬
POST /payroll-records/:id/settle  # 结算课酬

# 通知
POST /notifications           # 创建通知
POST /notifications/:id/send  # 发送通知
GET  /notification-deliveries # 投递记录

# RAG 知识库
POST /knowledge-docs          # 手工创建并索引知识文档
POST /knowledge-docs/upload   # 上传解析文本/Markdown/CSV/JSON 并生成 embedding
POST /knowledge-search        # pgvector/embedding 优先的相似度搜索
POST /knowledge-docs/:id/reindex    # 重建文档向量索引
POST /knowledge-docs/:id/invalidate # 标记制度失效，搜索默认过滤

# Agent
GET  /mcp/tools               # MCP 工具列表
POST /mcp/execute             # 执行工具
GET  /mcp/approvals           # 审批列表
POST /mcp/approvals/:id/decide # 审批决策
POST /commands/interpret      # Hermes 优先、失败降级的自然语言入口
```

## 环境变量

```bash
# 数据库（必需）
DATABASE_URL=postgresql://user:pass@localhost:5432/cjlass2

# Redis（可选，未配置时降级为内存队列）
REDIS_URL=redis://localhost:6379

# 认证
API_AUTH_TOKEN=your-api-token          # API 访问令牌
API_AUTH_TOKEN_PREVIOUS=old-token      # 轮换窗口内仍可接受的旧 API token，逗号分隔
AUTH_SESSION_SECRET=your-secret        # Session 签名密钥
AUTH_SESSION_PREVIOUS_SECRETS=old-secret # 轮换窗口内仍可验签的旧 session secret，逗号分隔

# RAG / Embedding
EMBEDDING_PROVIDER=openai              # local | openai | openai-compatible
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_API_KEY=your-key             # 未配置时使用本地确定性向量降级
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSION=1536

# 通知渠道（可选）
WECOM_CORP_ID=your-corp-id             # 企业微信
WECHAT_H5_APP_ID=your-app-id           # 微信 H5
FEISHU_APP_ID=your-app-id              # 飞书
DINGTALK_CLIENT_ID=your-client-id      # 钉钉

# Agent
HERMES_AGENT_URL=http://localhost:8080 # Hermes Agent 地址
HERMES_AGENT_API_KEY=your-key          # Hermes/OpenAI-compatible API Key
HERMES_MODEL=hermes                    # 可选；未设置时使用 Hermes 环境默认模型
NOTIFICATION_PROVIDER_MODE=mock        # 测试模式
```

## 数据库迁移

迁移文件位于 `infra/postgres/migrations/`，API 启动时自动执行：

```bash
# 当前版本：6
# 0001 - 核心 schema（租户、用户、学员、课程、订单、账本等）
# 0002 - 通知投递状态机
# 0003 - Agent 工具调用和审批表
# 0004 - MVP 业务对象、渠道入口、发票、退款、课酬和正式财务分录
# 0005 - RAG 上传元数据、制度有效期/失效和 pgvector 向量索引
# 0006 - 财务科目、锁账、对账、异常退款和数据范围权限支撑
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

## 角色与数据范围

API 在租户隔离之上按角色裁剪快照和列表：

- `admin`：全量读写。
- `teacher`：只看自己关联学员、课程、课时流水和本人课酬；不可读取财务分录、订单、收款、发票和退款。
- `finance`：可处理订单、收款、发票、退款、科目、锁账、对账和课酬；学生档案只保留计费必要字段，隐藏学习记录正文。
- `assistant`：可处理学员、排课、通知等教务运营数据；财务数组清空。
- `readonly`：只读运营视图，隐藏学生敏感记录和财务明细。

知识库搜索会在 pgvector 结果返回后再次按角色过滤：学生知识只对管理员、关联教师和助教可见，财务知识只对管理员和财务可见。

## 备份恢复与密钥轮换

```bash
# pg_dump 备份，可选 OBJECT_STORAGE_URI=s3://bucket/path 上传对象存储
DATABASE_URL=postgresql://user:pass@localhost:5432/cjlass2 npm run ops:backup

# 恢复到指定数据库
BACKUP_FILE=backups/postgres/cjlass2.dump RESTORE_DATABASE_URL=postgresql://user:pass@localhost:5432/cjlass2_restore npm run ops:restore

# 恢复演练，必须使用隔离 drill 数据库
BACKUP_FILE=backups/postgres/cjlass2.dump DRILL_DATABASE_URL=postgresql://user:pass@localhost:5432/cjlass2_drill npm run ops:restore:drill

# 生成 session/API token 轮换 env patch
AUTH_SESSION_SECRET=current API_AUTH_TOKEN=current ROTATION_ENV_FILE=.secrets.rotation.env npm run ops:rotate-secrets
```

WAL 归档、对象存储保留策略和恢复演练步骤见 `docs/operations/backup-recovery.md`。

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

Compose 会同时启动 `edge`（Caddy）、`web`、`api`、`postgres`、`redis`。生产入口默认是 `https://<PUBLIC_DOMAIN>/`，Caddy 自动申请和续期 TLS 证书，将 `/api/` 反代到 API，其余请求反代到 Web；裸 IP 的 HTTP 访问会跳转到 `PUBLIC_DOMAIN`。前端生产构建建议使用同源 API：

```bash
VITE_API_BASE_URL=/api/v1
PUBLIC_DOMAIN=<your-domain>
PUBLIC_IP=<server-ip>
CORS_ORIGIN=https://<your-domain>
EDGE_HTTP_PORT=80
EDGE_HTTPS_PORT=443
```

提交信息会决定是否触发部署，规则见 [docs/operations/deployment-policy.md](docs/operations/deployment-policy.md)。摘要：`[deploy] xxx` 强制部署，`[skip-deploy] xxx` 跳过部署，`[docs] xxx` 仅文档且跳过部署，其他 `main` 分支 push 默认部署。

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
- ✅ 基础设施：~85%
- ✅ 测试覆盖：49 API + 8 Playwright

详见 [IMPLEMENTATION_COMPLETENESS_AUDIT.md](./IMPLEMENTATION_COMPLETENESS_AUDIT.md)

## 许可证

Private - 内部项目

## 相关链接

- [最终产品技术方案](./resource/独立教师与小机构智能教务系统_最终产品技术方案.md)
- [实现审计报告](./IMPLEMENTATION_COMPLETENESS_AUDIT.md)
- [Claude Code 指南](./CLAUDE.md)
