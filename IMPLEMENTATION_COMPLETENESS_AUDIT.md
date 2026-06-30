# 项目完成度审计

检查时间：2026-06-29  
检查对象：本地当前工作树 `/Users/thiago/program/AL/cjlass2_pro`  
依据文档：[resource/独立教师与小机构智能教务系统_最终产品技术方案.md](resource/独立教师与小机构智能教务系统_最终产品技术方案.md)

## 结论

项目已经从 2026-06-26 的“第一阶段 MVP 可验收候选版本”推进到 **第一阶段 MVP 基本完成、可进入生产化验收前准备**。

- **内部可演示 MVP：约 95%**。Web/API/PostgreSQL/Redis/RAG/财务/课酬/MCP/完整浏览器业务流均有本地代码和测试证据。
- **需求文档第一阶段 MVP：约 88%-92%**。第一阶段核心业务、审计、RAG、MCP、备份恢复脚本已基本闭环；剩余主要是外部真实渠道、真实 Hermes 编排和更细的数据范围权限。
- **生产上线准备度：约 72%-78%**。已有备份恢复脚本、密钥轮换、登录审计、恢复演练脚本和本地演练证据；仍需在真实生产 PostgreSQL 16 + pgvector、对象存储、WAL 和真实渠道凭据上完成演练。
- **最终产品完成度：约 62%-68%**。最终产品要求多端、完整渠道网关、复杂 Agent/Hermes、多角色数据权限、深度报表和运营体验，目前仍是模块化单体 MVP。

重要说明：

- 当前审计基于**本地当前工作树**。存在未提交变更，且未重新验证远端 `47.100.87.41` 是否已部署这些最新本地改动。
- 2026-06-29 本地验证通过：`npm run build`、`npm run test -w @cjlass2/api`、`npm run test:e2e -w @cjlass2/web`。
- API 单测当前为 **49 个**，Web Playwright 当前为 **8 个**。

## 本次实际验证

| 检查项 | 结果 |
| --- | --- |
| `npm run build` | 通过，shared/api/web 均完成构建。 |
| `npm run test -w @cjlass2/api` | 通过，API `51` 个 node:test 单测全部通过。 |
| `npm run test:e2e -w @cjlass2/web` | 通过，Playwright `8` 项通过，包含完整浏览器业务流。 |
| 财务与权限 schema | 迁移版本已到 `0006_finance_controls_and_data_scope.sql`，`POSTGRES_SCHEMA_VERSION = 6`。 |
| RAG 行为 | 单测覆盖上传解析、embedding、本地向量降级、搜索、失效过滤和删除。 |
| 完整浏览器业务流 | 覆盖登录、新增学员、创建订单、排课、点名、收款、通知、报表、审计。 |
| 备份恢复脚本 | `ops:backup`、`ops:restore`、`ops:restore:drill`、`ops:rotate-secrets` 已加入 root scripts。 |
| 恢复演练 | 已用本机临时 PostgreSQL 库跑通 `pg_dump -> pg_restore drill` 和 `tenants/audit_logs/knowledge_docs` 计数检查。 |
| pgvector 容器演练 | 未完成，Docker 拉取 `pgvector/pgvector:pg16` 时 Docker Hub 返回 EOF；需在可拉取镜像的环境重跑。 |
| 测试端口清理 | e2e 隔离端口 `3011/5183` 测试结束后无残留监听。 |

## 与上一版审计相比的变化

已从未完成推进为基本完成：

1. **财务/课酬闭环**
   - 已有 `invoices`、`refunds`、`financial_ledger_entries`、`payroll_rules`、`payroll_records` 的读写持久化。
   - 后端已有开票、退款申请/审批/结算、正式财务分录、课酬生成/确认/结算。
   - 新增 `financial_accounts`、`accounting_period_locks`、`reconciliation_runs`，支持财务科目、锁账、对账、异常退款和批量课酬确认。
   - 前端收费页已有发票、退款、课酬确认与结算、正式分录展示和操作。
   - MCP 新增 `invoice_issue`、`refund_request`、`payroll_generate`、`payroll_settle`。

2. **RAG 正式化**
   - 新增 OpenAI-compatible embedding provider，未配置远端时用本地确定性向量降级。
   - PostgreSQL 模式支持 `knowledge_chunks.embedding <=> query_embedding` 的 pgvector 相似度排序。
   - 新增上传解析：文本、Markdown、CSV、JSON。
   - 新增制度有效期、失效、来源 URI、mime、checksum、parser、metadata。
   - 搜索默认过滤未生效、已过期、已失效文档。
   - 设置页可上传制度样本、重建索引、标记失效。

3. **完整浏览器业务流 e2e**
   - Playwright 现在使用隔离 API/Web 端口和专用 e2e server harness。
   - 新增完整业务链：登录 -> 新增学员 -> 创建订单 -> 排课 -> 点名 -> 收款 -> 通知 -> 报表/审计。

4. **备份恢复与上线运维**
   - 新增 `pg_dump` custom-format 备份脚本和 SHA-256 manifest。
   - 新增对象存储上传入口，支持 `s3://` 和 `rclone` 目标。
   - 新增恢复脚本和恢复演练脚本。
   - 新增 WAL/对象存储/恢复演练 runbook。
   - 新增 session/API token 轮换脚本和 previous secret/token 兼容窗口。
   - 登录成功/失败写入审计流水。

5. **README 口径**
   - README 已更新为 16 个 MCP 工具、迁移版本 5、API 单测 49、Web e2e 8。

## 需求矩阵

| 需求模块 | 当前状态 | 完成度 | 证据与主要缺口 |
| --- | --- | ---: | --- |
| Web 管理端 | 基本完成 | 86% | 主工作台、课表、学员、收费、通知、报表、设置均可用；完整业务流 e2e 通过。缺更精细的移动端/家长端真实形态。 |
| 第一阶段业务闭环 | 基本完成 | 88% | 学员、订单、排课、点名课消、收款、通知、报表、审计已闭环。复杂请假/补课/转班规则仍需深化。 |
| 学员与家庭账户 | 部分完成 | 68% | 有家庭账户表和学生档案；业务 UI 仍以 student 为中心，家庭/多监护人流程不完整。 |
| 课程、课包、排课 | 基本完成 | 82% | 排课、周期课、批量排课、冲突校验、教师/教室可用性、MCP 排课工具可用。缺完整 enrollment/series 管理 UI。 |
| 考勤与课消 | 基本完成 | 86% | 不可变课时流水、反向纠错、点名课消、报表聚合、浏览器 e2e 覆盖。 |
| 订单、收款、财务流水 | 基本完成 | 82% | 订单、收款、发票、退款、正式财务分录已有流程和 UI。仍需真实支付渠道、发票号码规则、财务科目配置和对账锁账。 |
| 教师课酬 | 基本完成 | 78% | 课酬规则、生成、确认、结算、正式分录和前端操作已实现。仍需更复杂规则、批量审核、导出和异常处理。 |
| 通知 | 部分完成 | 76% | 草稿、发送、预约、失败、重试、Redis queue、MCP 工具可用。真实渠道凭据、送达回执和模板审核未接完。 |
| 报表 | 部分完成 | 64% | 收入、课消、到课率、课酬、账本核对可用。缺更多经营分析、钻取、SQL 读模型和导出格式。 |
| Auth/RBAC/Tenant | 部分完成 | 72% | Bearer/session/RBAC/RLS、密钥轮换窗口、登录审计可用。缺完整组织成员、班级/教师/财务数据范围权限。 |
| 审计、幂等、可靠性 | 基本完成 | 80% | 核心 mutation 走幂等，关键业务写审计，登录审计已补。仍需更多异常路径和批处理任务审计。 |
| PostgreSQL/Redis 基础设施 | 基本完成 | 82% | migration 1..5、RLS、Redis queue、pgvector schema 已有。需在生产 PG16+pgvector 上重跑恢复演练。 |
| MCP 工具 | 基本完成 | 86% | 16 个工具，覆盖查询、方案、执行、高风险财务/课酬。缺更严格 JSON Schema、权限矩阵和真实 Agent 多轮编排。 |
| Agent Gateway / Hermes | 部分完成 | 58% | Hermes/OpenAI-compatible 调用路径存在，失败降级本地解释；审批持久化和工具调用审计可用。真实 Hermes 服务、SSE 事件、多轮追问和复杂槽位填充仍不足。 |
| 自然语言操作 | 部分完成 | 56% | 支持排课、发票、退款、课酬等关键词命令；缺真实大模型驱动、多轮确认和歧义消解。 |
| RAG | 基本完成 | 82% | embedding provider、pgvector 排序、上传解析、有效期/失效过滤、source 引用均有实现和测试。需接真实 embedding key 并用生产 pgvector 数据量压测。 |
| Channel Gateway / 聊天渠道 | 部分完成 | 58% | 企业微信回调、签名、去重、账号绑定、卡片确认最小闭环。缺真实企微/飞书/钉钉全协议、AES、回执和运维配置页。 |
| 备份与恢复 | 部分完成 | 70% | 脚本、manifest、对象存储入口、runbook、本地 pg_dump/restore drill 已有。缺生产 WAL 配置落地、对象存储真实账号演练、PG16+pgvector 完整恢复演练。 |
| 测试覆盖 | 较好 | 82% | API 49 单测 + Web 8 Playwright 通过。缺真实外部渠道、真实 embedding provider、生产数据库恢复和压力/并发测试。 |

## 验收标准对照

| 验收项 | 当前判断 | 说明 |
| --- | --- | --- |
| 表单操作和自然语言操作最终进入同一确定性服务 | 基本达成 | Web/API/MCP/NL 多数路径复用 `CoreService`。Hermes 多轮仍不足。 |
| 财务、课时和课酬由确定性服务计算 | 基本达成 | 账本聚合、财务分录、课酬规则已在服务层实现。 |
| 所有修改有审计记录 | 大部分达成 | 主要 mutation、登录、Agent 审批有审计。仍需逐步补齐批处理/配置变更细节。 |
| Agent 无生产数据库直接写权限 | 基本达成 | MCP 通过服务层执行；高风险工具有审批机制。 |
| RAG 检索先应用租户和权限过滤 | 部分达成 | tenant/scope/status/有效期过滤已做；细粒度用户/学生知识库权限仍不足。 |
| 备份成功可恢复 | 部分达成 | 本地脚本和轻量 drill 通过；生产 PG16+pgvector/WAL/object storage 演练仍未完成。 |

## 剩余高优先级事项

1. **真实外部集成**
   - 配置并验证真实企业微信/微信 H5/飞书/钉钉凭据。
   - 补平台原生 AES/签名、送达回执、模板审核和失败告警。

2. **真实 Hermes / 大模型闭环**
   - 接真实 Hermes Agent 或 OpenAI-compatible 服务。
   - 增加多轮追问、复杂槽位填充、歧义消解和审批上下文。

3. **生产恢复演练**
   - 在可拉取 `pgvector/pgvector:pg16` 或真实 PG16+pgvector 环境重跑完整 backup/restore drill。
   - 配置 WAL 归档和对象存储真实 bucket，并做一次从 dump + WAL 的演练。

4. **权限和数据范围**
   - 已补教师/财务/助教/只读用户的数据范围权限。
   - `snapshot`、列表、报表、导出、知识库搜索和 MCP 查询工具均按角色裁剪。
   - 学生知识库和财务数据已加入二次过滤：学生知识限定管理员/关联教师/助教，财务知识限定管理员/财务。

5. **生产化财务与课酬**
   - 已增加财务科目配置、锁账、对账、批量课酬审核、异常退款和导出。

6. **部署与发布**
   - 将当前本地工作树提交并重新部署到远端环境。
   - 远端执行 migration 0006、health、Hermes status、RAG smoke、完整 e2e 或等价生产 smoke。

## 当前可交付判断

当前本地项目已经可以作为 **第一阶段 MVP 验收版本** 使用：核心业务闭环、RAG 正式化、财务/课酬、MCP、浏览器 e2e、备份恢复脚本均已具备实质实现和测试证据。

若要作为正式生产系统长期运行，还需要完成真实渠道凭据、真实 Hermes/embedding 配置、生产 PG16+pgvector 恢复演练、对象存储/WAL 落地、细粒度权限和远端重新部署验证。
