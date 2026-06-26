# 项目完成度审计

检查时间：2026-06-26

依据文档：[resource/独立教师与小机构智能教务系统_最终产品技术方案.md](resource/独立教师与小机构智能教务系统_最终产品技术方案.md)

## 结论

本轮已完成上一版报告列出的 P0 问题，并已部署到 `root@47.100.87.41` 的 Docker 环境。项目现在从“可运行 MVP 原型”推进为 **第一阶段 MVP 可验收候选版本**。

- **可演示内部 MVP：约 90%**。Web、API、PostgreSQL、Redis、MCP、RAG 最小闭环、企业微信入口最小闭环均可运行。
- **需求文档第一阶段 MVP：约 78%-82%**。12 个核心 MCP 工具、RAG chunk/source、企业微信签名回调/去重/账号绑定、关键业务数据表、真实容器运行态已补齐。
- **生产可上线版本：约 55%-60%**。仍缺真实外部渠道凭据、完整备份恢复、严肃财务/课酬口径、完整 UI 业务流 e2e、密钥轮换和更完整权限模型。

部署入口：

- Web：`http://47.100.87.41`
- API health：`http://47.100.87.41/api/v1/health`
- 代码提交：`6265559`、`127fe23`、`f24b587`
- 远端目录：`/opt/cjlass2_pro`

## 本次实际验证

已通过：

| 检查项 | 结果 |
| --- | --- |
| `npm run build` | 通过，shared/api/web 均完成构建。 |
| `npm run lint` | 通过，shared/api TypeScript 检查与 web build 检查通过。 |
| `npm run test` / `npm run test -w @cjlass2/api` | 通过，API `47` 个 node:test 单测全部通过。 |
| `npm run test:e2e -w @cjlass2/web` | 通过，Playwright `7` 项通过。 |
| `docker compose config --quiet` | 本地和远端均通过。 |
| 远端 `docker compose build api web` | 通过。 |
| 远端 `docker compose up -d` | 通过，PostgreSQL/Redis/API/Web 均 healthy。 |
| PostgreSQL migration | 远端 `schema_migrations` 为 `1..4`，最新 `mvp_business_objects_and_channels`。 |
| Redis queue | `/api/v1/health` 显示 `backend=redis`、`redisConfigured=true`。 |
| MCP smoke | `/mcp/tools` 返回 12 个 MVP 工具；`student_search` 返回真实学员数据并写入 tool call。 |
| RAG smoke | `/knowledge-search` 返回 chunk excerpt 和 source 引用。 |
| 企业微信入口 | 单测覆盖 HMAC 签名、消息去重、账号绑定、自然语言生成业务任务。 |
| Nginx 网关 | `http://47.100.87.41` 和 `/api/v1/health` 通过公网访问。 |
| 资源占用 | 远端稳定后约：web `40MiB/384MiB`，api `49MiB/512MiB`，postgres `52MiB/768MiB`，redis `15MiB/256MiB`；CPU 接近空闲。 |

未完成或受限：

- `npm audit --omit=dev --json`：本机默认 `npmmirror` audit endpoint 返回 404；切官方 registry 时 TLS 连接中断，未取得新审计结果。
- 真实企业微信/微信 H5/飞书/钉钉外部凭据未配置，本轮验证的是签名回调和 mock provider。
- RAG 当前是 chunk + 本地文本检索 + source 引用；尚未接真实 embedding provider 和 pgvector 相似度排序。
- 未做备份恢复演练。

## P0 完成情况

1. **MCP 工具真实化：已完成**
   - 已对齐 12 个 MVP 工具：`student_search`、`student_get_profile`、`schedule_query`、`schedule_propose`、`schedule_check_conflicts`、`schedule_commit`、`attendance_mark`、`package_get_balance`、`finance_get_summary`、`notification_draft`、`notification_send`、`knowledge_search`。
   - 查询工具返回真实 snapshot/ledger/report 数据。
   - 执行工具复用 `CoreService` 的排课、点名、通知、幂等和审计逻辑。
   - `agent_runs` / `agent_tool_calls` 已持久化到 PostgreSQL。

2. **RAG 最小闭环：已完成**
   - `KnowledgeDoc` 创建时会生成 `knowledgeChunks`。
   - 检索从标题搜索升级为 chunk 内容检索，返回 excerpt、relevance 和 sources。
   - PostgreSQL 持久化 `knowledge_docs` / `knowledge_chunks`，保留 pgvector 字段作为后续真实 embedding 接入点。

3. **聊天渠道入口闭环：已完成最小版本**
   - 新增企业微信 callback：`/api/v1/channels/wecom/callback`。
   - 支持 HMAC-SHA256 签名校验、消息去重、渠道账号绑定、文本消息解释为业务任务、卡片确认/取消任务。
   - 新增 `channel_accounts`、`channel_messages` 持久化和查询入口。

4. **关键业务数据模型：已完成 P0 骨架**
   - 新增 migration `0004_mvp_business_objects_and_channels.sql`。
   - 补齐 `households`、`household_members`、`teachers`、`course_packages`、`student_package_accounts`、`invoices`、`refunds`、`financial_ledger_entries`、`payroll_rules`、`payroll_records`、`learning_records`、`documents`、`channel_accounts`、`channel_messages`。
   - 所有新增表启用 RLS，并加入 reset 清理顺序。

5. **真实数据库/队列运行态：已完成**
   - 远端 Docker 中运行 `pgvector/pgvector:pg16`、`redis:7`、API、Web。
   - health 显示 `databaseMode=true`、Redis Streams backend 生效。
   - Compose 增加 `restart`、healthcheck、内存/CPU/pids 限制；PostgreSQL/Redis 仅绑定 `127.0.0.1`。

## 需求矩阵

| 需求模块 | 当前状态 | 完成度 | 证据与主要缺口 |
| --- | --- | ---: | --- |
| Web 管理端 | 部分完成 | 78% | 主页面和浅层 e2e 可用，已部署公网 Web。缺完整 UI 业务流测试、移动端独立 H5/小程序。 |
| 第一阶段业务闭环 | 基本完成 | 78% | 服务层覆盖创建学员、订单、排课、点名课消、收款、通知、审计；仍缺教师课酬正式结算闭环。 |
| 学员与家庭账户 | 部分完成 | 62% | 已有正式 households/household_members 表；业务 API 仍主要从 student 映射家庭账户。 |
| 课程、课包、排课 | 部分完成 | 70% | 排课、周期排课、冲突校验、MCP 排课工具可用；课包账户表已补，缺完整 enrollment/series UI。 |
| 考勤与课消 | 基本完成 | 78% | ledger 聚合、反向纠错、MCP 点名可用；复杂请假/补课规则仍需加强。 |
| 订单、收款、财务流水 | 部分完成 | 68% | payment ledger 可用，发票/退款/财务流水表已补；严肃财务分录和退款流程仍未产品化。 |
| 教师课酬 | 部分完成 | 40% | payroll_rules/payroll_records 表已补，报表有基础汇总；缺课酬确认/结算 UI 与流程。 |
| 通知 | 部分完成 | 72% | 草稿/发送/预约/失败/重试/Redis queue/MCP 工具可用；真实渠道凭据和回执未接。 |
| 报表 | 部分完成 | 50% | 收入、课消、到课率、课酬摘要可用；缺明细钻取和完整 SQL 读模型。 |
| Auth/RBAC/Tenant | 部分完成 | 63% | Bearer/session/RBAC/RLS 可用；缺密钥轮换、登录审计、成员关系和数据范围权限。 |
| 审计、幂等、可靠性 | 部分完成 | 65% | 关键 mutation 走幂等，MCP/tool call 持久化；部分旧写路径仍需继续统一 previous snapshot。 |
| PostgreSQL/Redis 基础设施 | 基本完成 | 78% | 真实远端容器已验证，migration 1..4 通过，Redis backend 生效；缺备份恢复演练。 |
| 12 个 MVP MCP 工具 | 基本完成 | 82% | 12 个工具已真实接 CoreService，smoke 通过；缺更严格参数 schema 和端到端 Agent 编排。 |
| Agent Gateway / Hermes | 部分完成 | 45% | MCP 执行和 tool call 持久化可用；Hermes 未真实调用，审批队列仍是基础实现。 |
| 自然语言操作 | 部分完成 | 45% | 渠道回调可触发关键词解释和业务任务；尚未接真实大模型、多轮追问和复杂槽位填充。 |
| RAG | 部分完成 | 50% | chunk/source 检索可用；缺真实 embedding、pgvector 排序、上传解析和失效制度过滤。 |
| Channel Gateway / 聊天渠道 | 部分完成 | 55% | 企业微信签名回调、去重、账号绑定、卡片确认最小闭环可用；缺真实平台 AES/回调协议全量适配。 |
| 备份与恢复 | 未完成 | 10% | 仍缺 `pg_dump`/WAL/对象存储/恢复演练脚本。 |
| 测试覆盖 | 中等 | 70% | API 47 单测 + Web 7 Playwright 通过；缺完整浏览器业务流。 |

## 剩余高优先级事项

1. 配置真实企业微信/微信 H5 凭据，补平台原生签名/AES、回调事件和送达回执。
2. 接入真实 embedding provider，把 `knowledge_chunks.embedding` 用于 pgvector 相似度检索。
3. 补完整 UI e2e：登录 -> 新增学员 -> 创建订单 -> 排课 -> 点名 -> 收款 -> 通知 -> 报表/审计。
4. 补 `pg_dump` 备份、恢复演练、密钥轮换和登录审计。
5. 将 payroll、invoice、refund、financial ledger 从表结构推进到完整业务流程。

## 当前可交付判断

当前项目可作为第一阶段 MVP 候选版本交付演示和继续验收。它已经具备真实 Docker 运行态、数据库迁移、Redis 队列、核心 MCP 工具、RAG 最小检索和企业微信入口最小闭环。

仍不建议直接作为正式生产系统长期运行，除非先完成备份恢复、真实渠道凭据、密钥策略和关键财务/课酬流程。
