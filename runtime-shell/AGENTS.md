# runtime-shell 工程规范（企业化演进）

本文件作用域：`runtime-shell/` 目录及其子目录。

目标：让 `runtime-shell` 从本地原型演进为企业级平台能力时，保持**一致的架构分层、接口口径、数据隔离边界、以及可审计性**。

> 中文/English: Follow repo-wide style rules from `AGENTS.md` at repo root. This file adds runtime-shell-specific constraints.

## 总原则（必须遵守）

- 只实现需求明确要求的内容；不做“顺手优化”、不引入推测性扩展。
- 不要引入“回退/兜底实现”：一旦接入数据库，禁止保留 JSON 主存储的兼容分支或双写逻辑。
- TypeScript：`strict: true`（见 `runtime-shell/tsconfig.json`），禁止使用 `any`。
- 优先 Bun API（如 `Bun.file()`、`Bun.write()`），除非必须使用 Node API。
- 控制变量数量：仅使用一次的值应内联，避免单用途 helper 过度抽象（遵循仓库根 `AGENTS.md` 风格指南）。
- 关键逻辑必须有**中文/English 注释**，用于解释非直观约束、隔离边界、以及审计口径；不要给显而易见的赋值/控制流写注释。
- 所有代码与文档统一使用 UTF-8 编码。

## 工程分层与目录约定（server）

`runtime-shell/server/src` 代码按以下责任边界组织（可渐进调整，但不得混用职责）：

1. `http/`（Controller/Handler）
   - 只做：鉴权/授权入口、入参校验、编排调用、响应组装、`requestId` 透传。
   - 不做：直接写 SQL/持久化细节、复杂业务规则、跨资源权限计算。

2. `services/`（Service/UseCase，后续新增目录）
   - 承载业务规则：会话生命周期、权限校验、工作区边界、审计事件生成。
   - 输入输出使用明确 DTO（可复用 `http/schemas` 的 zod 结果作为入参，但不要把 `Context` 传入 service）。

3. `repos/`（DAO/Repository，后续新增目录）
   - 只做数据访问：CRUD、事务边界、分页/排序、唯一约束冲突映射。
   - 不做业务规则：不得在 repo 里做“谁能看见什么”的判断。

4. `runtime/` / `acp/`（执行面与桥接）
   - 只负责 ACP 子进程管理与事件桥接，不承载元数据权限逻辑。

> 中文/English: Keep the happy path readable. Complex validation branches belong in small helpers close to the call site.

## 接口规范（HTTP）

- 方法限制：仅使用 GET 与 POST。
  - GET：只读查询且必须无副作用。
  - 写操作：统一 POST，并使用动作后缀表达语义，例如：
    - `/create`、`/update`、`/delete`、`/enable`、`/disable`、`/batch`
- 统一鉴权与授权：token 校验 + RBAC + 数据范围校验，未通过直接拒绝。
- 统一响应结构：`code`、`message`、`data`、`requestId`；字段级错误可返回 `details`。
- 统一状态码映射：400/401/403/404/409/429/500/503（与仓库总体规范一致）。
- 日志与审计：写接口必须落 `audit_log`（落库后），并关联 `requestId`、`userId`、核心业务 ID。

## 数据模型与数据库规范（MySQL + PostgreSQL 双兼容）

### 方言与能力约束（必须）

- runtime-shell 的 DB 实现必须同时支持 MySQL 与 PostgreSQL。
- 禁止写死单一方言特性（例如仅 PostgreSQL 的特定语法/类型，或仅 MySQL 的特定函数），除非形成明确的、可测试的双实现且在需求中被明确要求。
- 迁移与 schema 必须可重复执行、可审计；禁止运行时自动“修表/改表”。

### Schema 约定（推荐对齐仓库 Drizzle 风格）

- 表名与字段名：`snake_case`（小写+下划线）。
- 软删除字段统一：`deleted_at` 或 `is_deleted`（选型后全局一致）。
- 审计字段建议统一：`created_at`、`created_by`、`updated_at`、`updated_by`（选型后全局一致）。
- 唯一约束优先：用于保证幂等与去重（例如“业务唯一键”必须有唯一索引）。
- 索引命名与设计：为高频 where/排序字段建索引；联合索引按区分度从高到低。

### 多租户隔离（必须）

- 所有“平台元数据”表必须显式携带边界字段（至少 `tenant_id`，以及需要时的 `organization_id` / `project_id`）。
- 所有查询必须带边界过滤条件；不得依赖前端传参来“约定不越权”。

## 认证与会话（Auth Session）

- 认证会话必须持久化到数据库（落库后），不得依赖进程内 `Map` 或 JSON 文件状态。
- Cookie/JWT 等 token 本体不落库，仅落库 token 的 hash（避免泄露）。
- TTL/过期策略必须统一由服务端校验；不得由前端决定有效期。

## 工作空间边界（Workspace）

- 禁止前端直接提交任意 `workspacePath` 并被服务端直接采用。
- 工作空间必须“登记/绑定”（例如 `workspace_binding` 或同等概念），服务端只允许访问已绑定且在租户/项目边界内的 workspace。
- 所有 workspace 相关操作必须做：租户/项目边界校验 + 权限校验 + 数据范围校验。

## RBAC 与数据权限

- RBAC 校验必须在服务端完成，且必须覆盖：
  - 资源级（business_session、workspace、provider/mcp/skill 配置等）
  - 范围级（tenant/org/project/workspace/session）
- API 层不得“顺便放过”权限校验；任何越权访问都必须返回 403，并落审计（落库后）。

## 日志与敏感信息

- 必须记录：`requestId/traceId`、`userId`、`tenantId`、核心业务 ID（sessionId、workspaceId、workerId 等）。
- 禁止日志打印：密码、token 原文、密钥、私钥、上游供应商凭据等敏感信息。

## 运行与测试（本目录）

- 运行：
  - `bun run dev`（见 `runtime-shell/package.json`）
  - `bun run typecheck`
- 数据库迁移与联调测试应在 `runtime-shell/` 内执行，避免在仓库根目录执行耗时命令。

