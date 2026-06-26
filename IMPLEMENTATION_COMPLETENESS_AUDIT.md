# 项目完成度审计

检查时间：2026-06-25

依据文档：[resource/独立教师与小机构智能教务系统_最终产品技术方案.md](resource/独立教师与小机构智能教务系统_最终产品技术方案.md)

## 结论

当前项目不是空壳，已经具备一个可运行的 Web + NestJS API + 部分 PostgreSQL/Redis 基础设施的业务 MVP。但如果严格按照需求文档中的“第一阶段 MVP”验收，完成度应判断为 **约 60%-65%**；如果按照最终产品/生产级要求判断，完成度约 **40%-45%**。

更准确地说：

- **可演示内部 MVP：约 75%**。主页面可渲染，API 可运行，核心闭环在服务层单测中通过。
- **需求文档第一阶段 MVP：约 60%-65%**。学员、排课、点名课消、订单收款、通知、报表、审计、幂等已有基础，但企业微信入口、12 个核心 MCP 工具、机构制度 RAG、完整备份与真实生产可靠性仍未完成。
- **生产可上线版本：约 40%-45%**。数据模型、权限、渠道、Agent、RAG、备份恢复、真实容器 e2e 和完整浏览器业务流仍有明显缺口。

旧版审计报告中“AgentGateway 完整实现”“ChannelGateway 已完成”“RAG 已完成”等结论偏乐观。当前代码更接近“接口和页面骨架 + 部分演示行为 + 服务层核心闭环”。

## 本次实际验证

已通过：

| 检查项 | 结果 |
| --- | --- |
| `node -v` / `npm -v` | Node `v18.20.7`，npm `10.8.2`。注意项目声明 `engines.node >=20`，本机低于声明版本。 |
| `npm run build` | 通过，shared/api/web 均完成构建。 |
| `npm run lint` | 通过，shared/api TypeScript 检查与 web build 检查通过。 |
| `npm run test` | 通过，API `46` 个 node:test 单测全部通过；Web 工作区的 `test` 只是提示需单独跑 e2e。 |
| `npm run test:e2e -w @cjlass2/web` | 通过，Playwright `7` 项通过。覆盖页面加载、交互元素、登录表单、API 可达性、无原型截图依赖。 |
| `docker compose config --quiet` | 通过，Compose 配置有效。 |
| `npm audit --omit=dev --json` | 生产依赖漏洞为 `0`。 |

未验证：

- 未执行 `docker compose up`，因此未完成真实 PostgreSQL + Redis 容器 e2e。
- 未执行 `docker compose build api web`。
- 未验证真实企业微信/微信 H5/飞书/钉钉通道。
- 未验证 Hermes Agent 真实调用。
- 未验证 pgvector embedding/RAG 检索链路。

## 需求矩阵

| 需求模块 | 当前状态 | 完成度 | 证据与主要缺口 |
| --- | --- | ---: | --- |
| Web 管理端 | 部分完成 | 75% | `apps/web/src/App.jsx` 已有工作台、课表、学员、收费、通知、报表、设置、多端入口、聊天确认等页面；数据通过 `apps/web/src/api.js` 调用 `/api/v1`。缺少完整浏览器业务流测试，移动端是 Web 内模拟入口，不是独立小程序/H5。 |
| 第一阶段业务闭环 | 部分完成 | 70% | API 单测覆盖“创建学员 -> 创建订单 -> 排课 -> 点名扣课时 -> 收款 -> 创建/发送通知 -> 审计”。缺少教师课时/课酬的正式账务闭环，余额不足提醒主要是工作台统计和催缴草稿，不是完整后台规则引擎。 |
| 学员与家庭账户 | 部分完成 | 50% | 有 `students`、记录、沟通和家长字段；`/households` 只是从 student 临时映射，数据库没有正式 households/household_members 表。 |
| 课程、课包、排课 | 部分完成 | 60% | 有 lessons、周期排课、批量排课、教师/教室/学员冲突校验和可用性查询。缺少正式 course_packages、enrollments、lesson_series/session_participants；前端没有真实拖拽调课、节假日/不可用时间管理。 |
| 考勤与课消 | 基本完成 | 75% | 到课会追加 lesson ledger，余额由流水聚合；支持反向纠错。缺少更完整的请假、缺课、补课、课时恢复规则和并发版本控制。 |
| 订单、收款、财务流水 | 部分完成 | 60% | 有 orders、payment ledger、收款结清和反向纠错；报表读取 ledger 聚合。缺少 invoices/payments/refunds/financial_ledger_entries 的完整拆分，退款和课消收入/课时负债/教师成本仍不完整。 |
| 教师课酬 | 很弱 | 25% | 报表里有基于课程价格的 `teacherPayroll` 汇总，但没有 payroll_rules/payroll_records、课酬确认、结算和审计流程。 |
| 通知 | 部分完成 | 65% | 有草稿、发送、预约、失败、重试、取消、Redis Streams/内存队列路径和 mock provider。真实渠道凭据、回调、模板变量审计、送达回执、限流与去重未完成。 |
| 报表 | 部分完成 | 45% | 有收入、课消、到课率、低课时、欠费提醒等聚合。缺少 SQL/读模型级报表、退款/欠费/教师课酬/教室利用率/续费情况等完整指标与明细钻取。 |
| Auth/RBAC/Tenant | 部分完成 | 60% | 有登录、PBKDF2 密码哈希、签名 session、Bearer token、角色 scope、RLS schema 和 `app.tenant_id`。但不是完整 JWT/成员关系/可轮换密钥/登录审计/数据范围权限体系；本地默认密钥仍用于开发兜底。 |
| 审计、幂等、可靠性 | 部分完成 | 55% | 多数 mutation 进入 `withIdempotency`，任务确认支持 `expectedVersion`，ledger/audit 追加。缺口是所有写操作并未统一执行前影响预览，部分 `saveWithAudit` 未传 previous 时 DB 模式会退回全量保存，业务对象版本控制覆盖不完整。 |
| PostgreSQL/Redis 基础设施 | 部分完成 | 60% | 有 Compose、规范化表、RLS、迁移文件、Redis queue 抽象。未做真实容器 e2e；数据模型覆盖不完整；迁移回滚、影子库验证、备份恢复缺失。 |
| 12 个 MVP MCP 工具 | 骨架完成 | 30% | 当前注册了 15 个工具，但与文档清单不完全一致，缺 `notification_draft`、`knowledge_search`，多了高风险工具。多数 handler 返回模拟数据，没有调用 CoreService，也没有真正写业务库。 |
| Agent Gateway / Hermes | 骨架完成 | 25% | 有 `/mcp/tools`、`/mcp/execute`、审批端点和 Hermes 配置状态；但 tool call/approval 没有持久化，审批决策是占位返回，Hermes 未实际调用。 |
| 自然语言操作 | 部分演示 | 35% | `/commands/interpret` 用关键词识别调课、催缴、通知、点名，能生成 BusinessTask 或草稿。未达到“常见单项业务 70% 一句话发起”，没有大模型理解、多轮追问、已识别字段预填到复杂表单的完整实现。 |
| RAG | 很弱 | 20% | 有 knowledge docs 创建/删除/标题搜索，schema 有 `knowledge_chunks`。没有上传、chunk 内容持久化、embedding、pgvector 检索、来源引用、失效制度过滤。 |
| Channel Gateway / 聊天渠道 | 很弱 | 20% | 有 channel integration 状态和通知 provider env 检测。没有平台签名验证、回调、用户绑定、消息去重、群聊敏感限制、卡片按钮回调和聊天/网页共享任务的真实外部链路。 |
| 备份与恢复 | 未完成 | 10% | 需求要求备份、恢复演练、WAL 等；当前没有可执行备份/恢复流程。 |
| 测试覆盖 | 中等 | 65% | API 单测较强，覆盖 ledger、幂等、RBAC、通知队列、业务流、Agent 工具注册等。前端 Playwright 测试偏浅，没有覆盖真实登录后全流程点击、表单提交、通知发送、任务确认和报表断言。 |

## 主要已完成能力

1. Monorepo workspace、NestJS API、React/Vite Web、shared types 已可构建。
2. API 目前暴露 67 个控制器路由，覆盖核心业务入口。
3. 服务层支持学员、课程、订单、收款、点名、通知、业务任务、知识文档、渠道配置、用户管理等操作。
4. 课时和收款已从简单覆盖推进到 ledger 聚合读模型，并支持反向纠错。
5. PostgreSQL schema 不再只是 `app_state` 快照，已有一批规范化表、schema migration 与 RLS policy。
6. 通知具备失败/重试/预约/队列处理的基础状态机。
7. 构建、lint、API 单测、Playwright 浅层 e2e、Compose config 和生产依赖 audit 均通过。

## 主要风险与缺口

### P0：会影响 MVP 验收

1. **MCP 工具不是可用业务工具**
   - 当前工具大多返回空数组、`profile: null`、`remainingHours: 0`、`income: 0` 或新生成 id，没有真实查询/写入 CoreService。
   - 需求文档要求首版 12 个核心工具可查询学生/课表/课时/账务、创建调整课程、点名课消、草拟发送通知、查询制度资料。

2. **RAG 只是文档标题搜索**
   - 没有 chunk、embedding、pgvector 查询、来源引用、权限过滤实测。
   - `knowledge_chunks` 表存在不等于 RAG 完成。

3. **聊天渠道没有真实入口闭环**
   - 需求中的企业微信第一阶段入口尚未具备签名回调、账号绑定、消息去重、卡片按钮和高风险确认。
   - 当前更像 Web 内“聊天确认”页面和渠道配置状态。

4. **数据模型仍缺关键业务对象**
   - 缺正式 households、teachers、course_packages、student_package_accounts、invoices、refunds、financial_ledger_entries、payroll_rules/payroll_records、learning_records、documents、channel_accounts/messages 等。

5. **真实数据库/队列运行态未验收**
   - 单测主要在内存模式和 fake Redis/静态 schema 读取下通过。
   - 需要跑真实 PostgreSQL + Redis e2e，验证 migration、RLS、事务、队列消费和并发写入。

### P1：会影响生产可信度

1. **部分写操作没有统一 previous snapshot**
   - `saveWithAudit` 只有在 DB 模式且传入 `previous` 时才走 `saveIncremental`；部分路径未传 previous，会退回全量保存。

2. **权限与安全仍是基础版**
   - 角色 scope 有，但数据范围权限、租户成员关系、登录审计、密钥轮换、生产 JWT 策略不完整。

3. **前端 e2e 覆盖不够**
   - 现有 7 个 Playwright 测试不能证明主业务流程可通过 UI 完成，只证明页面基本可加载。

4. **报表仍偏摘要**
   - 缺少完整 SQL 统计、明细入口、退款/欠费/课消收入/课时负债/教师成本的严肃口径。

5. **备份恢复未实现**
   - 没有 `pg_dump`/WAL/对象存储/恢复演练脚本或文档。

## 建议完成顺序

1. **先把 12 个 MCP 工具接到 CoreService**
   - 对齐文档清单：`student_search`、`student_get_profile`、`schedule_query`、`schedule_propose`、`schedule_check_conflicts`、`schedule_commit`、`attendance_mark`、`package_get_balance`、`finance_get_summary`、`notification_draft`、`notification_send`、`knowledge_search`。
   - 所有执行工具必须复用现有业务 API、幂等、审计和权限。

2. **补 RAG 最小闭环**
   - 文档上传/录入 -> chunk -> embedding -> pgvector -> tenant/permission filter -> 返回来源。

3. **做真实 PostgreSQL + Redis e2e**
   - `docker compose up` 后跑 API flow、RLS 隔离、Redis Streams 消费、migration checksum。

4. **补企业微信第一阶段 Channel Gateway**
   - 签名验证、账号绑定、消息去重、按钮回调、网页深链、高风险二次确认。

5. **补完整前端业务流 Playwright**
   - 登录 -> 新增学员 -> 创建订单 -> 排课 -> 点名 -> 收款 -> 生成/发送通知 -> 查看审计/报表。

6. **收敛数据模型**
   - 优先补 households、course_packages/student_package_accounts、invoices/refunds/financial ledger、payroll、learning_records、channel accounts/messages。

7. **补备份恢复和生产安全**
   - 备份脚本、恢复演练、密钥策略、登录审计、真实 JWT/会话轮换。

## 当前可交付判断

可以把当前项目作为“可运行业务 MVP 原型”继续迭代，也可以用于演示核心教务闭环。但还不能按需求文档判定为第一阶段完整交付，更不能视为生产可上线版本。

下一步最值得做的是：**MCP 工具真实化 + RAG 最小闭环 + Docker Postgres/Redis e2e + 完整前端业务流测试**。这四件事补上后，第一阶段 MVP 完成度会明显接近可验收状态。
