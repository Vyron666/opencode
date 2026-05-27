# runtime-shell 企业化改造方案（P1 / P2 / P3）

本文档定义 `runtime-shell` 在 `P1 / P2 / P3` 三个阶段的企业化改造方案，用于承接当前 `P0` 已完成的数据库底座、基础分层与初步运行能力。

本文档只描述后续设计，不回溯 `P0` 已落地实现。所有方案均以当前仓库内的 `AGENTS.md` 与 `ARCHITECTURE.md` 为约束前提，目标是让系统继续沿着“可治理、可隔离、可审计、可扩展、可运维”的方向演进。

## 1. 文档范围

本文档覆盖以下三个阶段：

1. `P1`：身份、权限、隔离
2. `P2`：执行面治理
3. `P3`：配置与扩展治理

本文档不覆盖以下内容：

1. `P0` 已完成的 DB 接入、基础 repo 落库、会话主链路异步化
2. `P4+` 的完整可观测性平台、灰度发布平台、备份恢复系统
3. 超出当前 `runtime-shell` 产品定位的复杂组织协同能力

## 2. 总体演进原则

### 2.1 设计原则

1. 所有可见性边界必须在服务端校验，前端参数不构成授权依据。
2. 所有运行时对象必须可追踪到租户、组织、项目、工作区、用户与请求链路。
3. 业务规则放在 `services/`，数据访问放在 `repos/`，运行态桥接放在 `runtime/` 与 `acp/`。
4. 不引入“回退到 JSON / 进程内状态”的双轨兼容分支。
5. 所有改造优先做最小闭环，不做超前兜底实现。

### 2.2 阶段顺序

1. `P1` 先把“谁能看、谁能用、谁能改”说清楚。
2. `P2` 再把“谁在执行、如何调度、异常如何回收”治理清楚。
3. `P3` 最后把“配置从哪里来、谁能生效、谁能审批、影响谁”治理清楚。

### 2.3 当前前提

当前系统已经具备以下基础：

1. 核心元数据已进入数据库。
2. 会话、工作区、认证会话已具备基本持久化能力。
3. `services + repos + runtime` 分层已经成型。
4. `workspaceId` 已经替代任意路径输入，工作区边界已初步收紧。

后续所有设计均基于这个前提继续展开。

## 3. P1：身份、权限、隔离

## 3.1 目标

`P1` 的目标是让系统具备企业级最基本的访问控制与隔离能力，使任何会话、事件、工作区、配置访问都能在服务端被明确判定“允许”或“拒绝”。

需要达到的结果：

1. 认证会话完全持久化，脱离进程内状态依赖。
2. 引入最小角色模型、资源动作授权与数据范围模型。
3. 所有业务接口统一执行“认证 + 授权 + 数据范围 + 边界校验”。
4. 会话、事件、工作区、配置查询默认按租户与组织边界过滤。
5. 工作区只能使用登记过的 `workspace_binding`，不能接受任意路径。

## 3.2 非目标

`P1` 不做以下事情：

1. 不做复杂审批流。
2. 不做 Worker 调度算法优化。
3. 不做 provider / MCP 的分级配置合并计算。
4. 不做跨集群身份联邦或单点登录扩展。

## 3.3 架构落点

### 3.3.1 模块分层

建议新增或明确以下模块边界：

1. `services/auth/`
   - 负责认证会话恢复、用户身份上下文构建、鉴权入口编排。
2. `services/access/`
   - 负责角色判定、资源动作校验、范围授权判定与分享授权判定。
3. `services/workspace/`
   - 负责工作区绑定校验、路径合法性与边界校验。
4. `repos/auth-repo.ts`
   - 负责认证会话 CRUD。
5. `repos/access-repo.ts`
   - 负责角色、权限、授权范围、成员关系与分享关系查询。
6. `repos/workspace-binding-repo.ts`
   - 负责工作区绑定查询与注册信息读取。

### 3.3.1.1 与总架构目录对齐

为避免后续实施时目录继续发散，`P1 / P2 / P3` 对应模块应提前映射到统一目录规范：

1. `services/auth/`
   - 继续承接登录、认证会话、用户上下文。
2. `services/access/`
   - 新增，承接 RBAC、动作授权、范围授权。
3. `services/workspace/`
   - 新增，承接工作区绑定与路径边界校验。
4. `services/worker/`
   - 新增，承接 Worker 注册、心跳、状态管理。
5. `services/scheduler/`
   - 新增，承接新会话调度与粘性路由。
6. `services/runtime-governance/`
   - 新增，承接 runtime 生命周期、恢复、回收。
7. `services/configuration/`
   - 新增，承接配置分级读取、合并、快照。
8. `services/config-impact/`
   - 新增，承接配置影响范围分析。
9. `services/config-approval/`
   - 新增，承接配置审批编排。
10. `services/extension-policy/`
    - 新增，承接 MCP / skill / provider 启用策略。

如果在实施阶段为了降低改动面，不立即拆出独立目录，也必须先在现有 `services/` 内按同名文件或子模块收敛，禁止把这类逻辑继续散落回路由层和 runtime 层。

### 3.3.2 请求校验链路

所有业务写接口统一经过以下链路：

1. 认证会话恢复
2. 用户上下文加载
3. RBAC 动作校验
4. 数据范围校验
5. 资源边界校验
6. 业务服务执行
7. 审计记录落库

中文/English：The authorization chain must be explicit and ordered, so every denial reason is traceable and auditable.

## 3.4 核心数据模型

### 3.4.1 新增或补齐表

建议在 `P1` 落地以下核心表：

1. `role`
2. `permission`
3. `role_permission`
4. `user_role_binding`
5. `organization_member`
6. `project_member`
7. `workspace_binding`
8. `auth_session`

补充说明（落地口径）：

1. 所有表建议统一包含 `created_at / created_by / updated_at / updated_by`（如仓库已有统一字段口径则按现有实现对齐）。
2. 所有“归属边界”字段建议显式化：至少 `tenant_id`，需要组织/项目隔离时带 `organization_id / project_id`。
3. 设计优先满足“服务端可校验、可审计、可回溯”，避免把边界隐含在路径或进程内状态里。

### 3.4.2 关键字段建议

#### `role`

1. `id`
2. `tenant_id`
3. `organization_id`
4. `code`
5. `name`
6. `scope_level`
7. `created_at`
8. `updated_at`

建议约束与索引（最小可用）：

1. 唯一约束：`(tenant_id, organization_id, code)` 唯一，避免同组织下角色 code 冲突。
2. 索引：`(tenant_id, organization_id)` 用于列表与过滤。
3. 字段约束：`code` 仅允许 `[a-z0-9_:-]`（小写）以便稳定用于程序侧权限映射（中文/English：stable machine-readable identifier）。

#### `permission`

1. `id`
2. `resource_type`
3. `action`
4. `scope_level`
5. `description`

建议约束与索引（最小可用）：

1. 唯一约束：`(resource_type, action, scope_level)` 唯一。
2. 索引：`(resource_type, action)` 用于授权判定查找。

#### `user_role_binding`

1. `id`
2. `tenant_id`
3. `organization_id`
4. `project_id`
5. `user_id`
6. `role_id`
7. `scope_type`
8. `scope_id`

建议约束与索引（最小可用）：

1. 唯一约束：`(tenant_id, organization_id, project_id, user_id, role_id, scope_type, scope_id)` 唯一，用 DB 防重复绑定（幂等基础）。
2. 索引：`(tenant_id, user_id)` 用于加载用户角色。
3. 索引：`(tenant_id, organization_id, project_id)` 用于组织/项目成员管理查询。

#### `workspace_binding`

1. `id`
2. `tenant_id`
3. `organization_id`
4. `project_id`
5. `workspace_code`
6. `name`
7. `root_path`
8. `status`
9. `created_by`
10. `updated_by`

建议约束与索引（最小可用）：

1. 唯一约束：`(tenant_id, organization_id, project_id, workspace_code)` 唯一。
2. 索引：`(tenant_id, organization_id, project_id, status)` 用于列表与启用过滤。
3. 字段约束：`root_path` 只作为“绑定信息”存储，任何执行入口不接受客户端直传路径（中文/English：path is data, never auth）。

#### `auth_session`

建议字段（在现有基础上补齐落地口径）：

1. `id`
2. `tenant_id`
3. `user_id`
4. `token_hash`（只存 hash，不存明文；中文/English：store hash only）
5. `status`（`active / revoked / expired`）
6. `expires_at`
7. `last_seen_at`（可选，用于运维排障与会话回收）
8. `request_id`（可选，便于追踪来源登录请求）
9. `created_at / created_by / updated_at / updated_by`

建议约束与索引（最小可用）：

1. 索引：`(tenant_id, user_id, status)` 用于 `auth/me`、登出与查询。
2. 索引：`(expires_at)` 用于过期清理。

#### `session_share_binding`

建议字段（`P1-D` 最小新增）：

1. `id`
2. `tenant_id`
3. `organization_id`
4. `project_id`
5. `workspace_id`
6. `business_session_id`
7. `owner_user_id`
8. `target_user_id`
9. `status`
10. `created_at / created_by / updated_at / updated_by`

建议约束与索引（最小可用）：

1. 唯一约束：`(business_session_id, target_user_id)` 唯一，避免重复分享。
2. 索引：`(target_user_id, status)` 用于加载“我被分享了哪些会话”。
3. 索引：`(workspace_id, target_user_id)` 用于把分享出来的 `workspace` 访问权与 `session` 访问权保持一致。

### 3.4.3 权限模型

`P1-D` 第一版建议采用“最小角色 + 动作授权 + 范围 + 分享绑定”的模型，而不是一次性落完整复杂 RBAC。

1. 角色决定用户属于 `admin` 还是 `developer`。
2. 权限决定动作对应的资源类型。
3. 范围决定动作在哪个租户、组织、项目、工作区、会话边界内有效。
4. 分享绑定决定某个用户是否被额外授予“指定 `session` + 其所属 `workspace`”的联合访问权。

角色冻结口径：

1. `admin`
   - 拥有全部接口权限。
   - 唯一允许管理角色、权限与分享关系。
   - 唯一允许访问 `system/workers`。
2. `developer`
   - 拥有自己范围内的会话运行权限。
   - 可以分享自己拥有的 `session`。
   - 不具备平台级配置管理权限，不可访问 `system/workers`。

中文/English：sharing a session implicitly shares its bound workspace. Session and workspace are not split for share authorization.

分享权限矩阵（`P1-D` 第一版冻结）：

1. 被分享用户对 `session` 允许的动作：
   - `read/detail/events`
   - `open/load/resume`
   - `prompt/input`
   - `cancel`
   - `permission.respond`
   - `question.respond`
2. 被分享用户对 `session` 禁止的动作：
   - `close`
   - `delete`
   - `share.create`
   - `share.delete`
   - `provider/model/mode/config update`
   - `fork`
3. 被分享用户对 `workspace` 允许的动作：
   - 仅允许该被分享 `session` 在该 `workspace` 上继续运行
4. 被分享用户对 `workspace` 禁止的动作：
   - `session.create`
   - 独立打开或使用该 `workspace`
   - `workspace_binding` 管理
   - `enable/disable/delete`
   - 再次分享

资源类型建议先覆盖：

1. `business_session`
2. `workspace`
3. `session_share_binding`
3. `provider_config`
4. `custom_model`
5. `worker_node`
6. `audit_log`

动作建议先覆盖：

1. `read`
2. `create`
3. `update`
4. `delete`
5. `open`
6. `close`
7. `prompt`
8. `cancel`
9. `manage`

补充：范围口径（scope）如何落地成“可校验的规则”：

1. `scope_level` 决定“授权记录”属于租户/组织/项目/工作区哪一级。
2. `scope_type + scope_id` 决定在该级别下的具体对象（例如 `workspace` + 某个 `workspace_id`）。
3. Service 层授权判定建议按“动作允许 + 范围命中”两步做：先判断 action，再判断 scope（拒绝原因必须可解释）。

### 3.4.4 P1 枚举冻结口径

为避免实现阶段出现“同义不同名”或“不同模块各自扩展枚举”的问题，`P1` 第一版先冻结以下枚举口径。

#### `scope_level`

1. `tenant`
2. `organization`
3. `project`
4. `workspace`
5. `session`

#### `scope_type`

1. `tenant`
2. `organization`
3. `project`
4. `workspace`
5. `session`

`scope_level` 用于定义角色与权限的适用层级，`scope_type` 用于定义某条授权绑定具体挂在哪一类资源上。`P1` 第一版保持两者同口径，避免额外抽象。

#### `resource_type`

1. `business_session`
2. `workspace`
3. `provider_config`
4. `custom_model`
5. `worker_node`
6. `audit_log`
7. `auth_session`

#### `action`

1. `read`
2. `create`
3. `update`
4. `delete`
5. `open`
6. `close`
7. `prompt`
8. `cancel`
9. `manage`

#### `workspace_binding.status`

1. `active`
2. `disabled`
3. `deleted`

#### `auth_session.status`

1. `active`
2. `expired`
3. `revoked`

`P1` 第一版禁止继续新增自由枚举值。确需扩展时，必须先同步更新本文档与总架构文档。

## 3.5 关键流程

### 3.5.1 登录与认证会话

1. 用户提交用户名和密码。
2. 服务端验证身份。
3. 创建 `auth_session` 记录，持久化 `token_hash`、过期时间、用户边界信息。
4. Cookie 仅携带 token 原文，数据库不存 token 明文。
5. 后续请求通过 token hash 恢复用户上下文。

### 3.5.2 会话访问

1. 根据 `businessSessionId` 查询会话元数据。
2. 先判定当前用户是否为 `admin`。
3. 再判定当前用户是否为 `session owner`。
4. 再判定当前用户是否命中该 `session` 的分享绑定。
5. 若命中分享绑定，则默认同时授予该 `session` 所属 `workspace` 的访问权。
6. 若以上都不命中，再执行普通租户 / 组织 / 项目 / 工作区范围校验。
7. 校验当前用户是否具备对应动作权限。
8. 通过后才允许读取会话详情、事件流、运行时控制接口。

### 3.5.3 工作区访问

1. 前端只能传 `workspaceId`。
2. 服务端按 `workspace_binding` 查询工作区。
3. 若访问来自 `session share binding`，则该绑定自动构成该工作区的访问依据。
4. 若不存在分享绑定，再校验 `tenant_id + organization_id + project_id`。
5. 校验当前用户在该范围内是否有使用工作区的权限。
6. 校验 `root_path` 是否存在且仍为合法目录。

## 3.6 API 改造范围

### 3.6.1 HTTP 层

需要统一改造以下接口分类：

1. 登录 / 登出 / 当前用户
2. 会话创建 / 详情 / 列表 / 关闭 / 打开 / 继续
3. 事件流订阅
4. prompt / cancel / config update
5. provider save / custom model save
6. worker overview / health

`P1-D` 第一版角色口径：

1. `admin`
   - 可访问全部接口分类。
2. `developer`
   - 可访问认证接口、自身可见范围内的会话读写接口、交互接口。
   - 不可访问 `system/workers`。
   - 不可访问平台级 provider / custom model 管理接口，除非后续文档明确放开。

统一要求：

1. 鉴权失败返回 `401`。
2. 授权失败返回 `403`。
3. 资源不存在返回 `404`。
4. 边界冲突返回 `409`。

### 3.6.1.1 统一请求头与响应结构（建议补齐）

为便于排障与审计，建议所有 HTTP 请求至少包含以下请求头（如仓库已有规范则按现有实现对齐）：

1. `x-request-id`：请求唯一标识（或由服务端生成并回传）
2. `x-client-version`：客户端版本（便于灰度与兼容排障）
3. `x-timezone` / `x-locale`：时区与语言（可选）

统一响应结构（成功/失败都遵守）：

```jsonc
{
  "code": "OK", // 中文/English：machine-readable code
  "message": "success",
  "data": {},
  "requestId": "req_xxx"
}
```

字段级错误建议（仅在参数校验失败时返回，避免“失败但不可解释”）：

```jsonc
{
  "code": "VALIDATION_ERROR",
  "message": "invalid params",
  "data": null,
  "requestId": "req_xxx",
  "details": [
    { "field": "workspaceId", "reason": "required" }
  ]
}
```

### 3.6.1.2 写接口统一使用 POST + 动作后缀（落地口径）

为避免歧义，建议在 `runtime-shell` 的对外 HTTP 口径中，将所有“有副作用”的动作统一收敛为 `POST` 并用动作后缀表达，例如：

1. `POST /api/session/create`
2. `POST /api/session/open`
3. `POST /api/session/close`
4. `POST /api/session/prompt`
5. `POST /api/session/cancel`
6. `POST /api/workspace-binding/create`
7. `POST /api/workspace-binding/enable`
8. `POST /api/workspace-binding/disable`

中文/English：GET is read-only. All writes are POST with verb-like suffix.

### 3.6.2 Service 层

建议补齐以下服务能力：

1. `requireAuthenticatedUser()`
2. `authorizeResourceAction()`
3. `enforceProjectScope()`
4. `enforceWorkspaceBinding()`
5. `buildAccessContext()`

### 3.6.3 Repo 层

Repo 层只提供以下能力：

1. 查用户角色
2. 查角色权限
3. 查资源边界
4. 查工作区绑定
5. 查认证会话
6. 查 `session share binding`

Repo 层不承担“允许还是拒绝”的业务判定。

## 3.7 运维与审计要求

`P1` 完成后，每次授权决策至少应记录：

1. `request_id`
2. `user_id`
3. `tenant_id`
4. `resource_type`
5. `resource_id`
6. `action`
7. `decision`
8. `deny_reason`

审计日志中禁止记录：

1. token 明文
2. provider apiKey
3. 密码或私钥

## 3.8 上线顺序

建议按以下顺序上线：

1. 先引入 `auth_session` 全量持久化
2. 再引入 `workspace_binding` 强校验
3. 再引入会话与事件读取的数据范围过滤
4. 最后引入写接口 RBAC

## 3.8.1 P1 可执行任务清单

以下任务清单用于把 `P1` 从设计文档落到代码实施，口径按“先能上线内测，再逐步收严”组织。

### `P1-A`：认证会话全量持久化

目标：

1. 所有登录态都从 DB 恢复。
2. 彻底移除进程内认证会话作为主存储。

任务：

1. 补齐 `auth_session` 表字段与索引。
2. 统一 `createSession / clearSession / restoreSession` 仅走 repo。
3. token 仅存 hash，不存明文。
4. 增加过期、吊销状态字段。
5. 登录 / 登出 / `auth/me` 全链路回归测试。

验收：

1. 服务重启后登录态仍可恢复。
2. 手工删除或吊销 `auth_session` 后请求立即失效。
3. 同一 `token` 重放不会导致“创建多个会话”或“状态不一致”（幂等/一致性口径需明确）。

### `P1-B`：工作区绑定强校验

目标：

1. 任何执行入口都只能使用登记过的 `workspace_binding`。

任务：

1. 引入 `workspace_binding.status` 状态过滤。
2. 所有会话创建、会话打开入口统一只接收 `workspaceId`。
3. 服务端统一通过 `workspace_binding` 加载 `root_path`。
4. 禁止任何路径直传绕过绑定检查。
5. 对不存在、越权、禁用、路径失效四类失败原因分别返回明确结果。

验收：

1. 任意伪造路径都无法进入执行链路。
2. 禁用的工作区无法创建或打开会话。
3. `workspace_binding` 不存在时返回 `404`；存在但无权限返回 `403`（避免信息泄露可按具体口径调整，但必须在文档中固定）。

### `P1-C`：会话 / 事件读取边界过滤

目标：

1. 同租户、同组织、同项目边界外的数据不可见。

任务：

1. `session list/detail`
2. `event stream`
3. `pending permission/question list`
4. `worker overview`
5. `provider config list`

以上读取接口全部补统一访问上下文校验。

实现要求：

1. 在 service 层统一调用 `buildAccessContext()`。
2. Repo 只接受显式边界参数，不允许无边界全表读取。

验收：

1. 越权读取会话详情返回 `403` 或 `404`。
2. SSE 事件流只能收到当前用户有权限看到的会话事件。
3. `session list` 默认只返回当前范围内会话（tenant/org/project/workspace），且过滤条件可审计（记录 requestId + scope）。

### `P1-D`：RBAC 写接口接入

目标：

1. 所有接口都具备稳定角色口径，所有关键写接口都经过动作级授权。
2. `session` 分享能力进入正式授权链。

任务：

1. 收敛角色模型，只保留 `admin`、`developer`。
2. 为全部接口冻结角色访问矩阵。
3. 为 `session.create/open/close/prompt/cancel/load/resume/fork`
4. 为 `provider.save`
5. 为 `custom_model.save`
6. 为 `worker.manage`
7. 为 `session.share/create` 与 `session.share/delete`

补齐资源类型与动作映射。

实现要求：

1. 所有写接口统一先鉴权，再授权，再执行业务。
2. 所有拒绝结果都要落审计。
3. `developer` 只能分享自己拥有的 `session`。
4. 分享 `session` 时默认同时授予对应 `workspace` 访问权，不允许拆分授权。
5. `system/workers` 只允许 `admin` 访问。
6. 被分享用户获得的是“指定 `session` 的协作权限 + 该 `session` 所属 `workspace` 的附属使用权”。
7. 被分享用户不得因为一次分享而获得该 `workspace` 上的独立建会话权或管理权。

验收：

1. 未授权用户无法执行对应写操作。
2. 审计日志可追踪“谁在什么范围内被哪条规则拒绝”。
3. 每个拒绝必须包含 `deny_reason` 且与授权判定链路步骤一一对应（例如：未登录 / 无角色 / 无动作权限 / scope 不命中 / 资源不在边界）。
4. 被分享用户可以访问被分享 `session`，并默认可以访问其所属 `workspace`。
5. 被分享用户未获得其它无关 `session` 或 `workspace` 的访问权。

## 3.9 风险

1. 历史会话可能缺少完整范围字段，需要补数或约束回填。
2. 如果直接全量启用 RBAC，容易误伤现有管理用户默认能力。
3. 工作区绑定切严后，历史不合规路径可能无法继续打开。

---

## 4. P2：执行面治理

## 4.1 目标

`P2` 的目标是让 `runtime-shell` 从“单实例可跑”演进到“多 Worker 可治理、会话有归属、故障可恢复”的执行平台。

需要达到的结果：

1. Worker 有注册、心跳、状态、容量模型。
2. 会话创建时能做调度。
3. 已绑定会话能保持 Worker 粘性。
4. runtime / ACP 生命周期可见、可控、可回收。
5. 失效会话、僵尸绑定、异常关闭有明确治理逻辑。

## 4.2 非目标

`P2` 不做以下事情：

1. 不做跨地域调度。
2. 不做复杂弹性伸缩平台。
3. 不做全量消息队列化改造。
4. 不做高复杂度工作流引擎。

## 4.3 架构落点

### 4.3.1 模块划分

建议新增或明确以下模块：

1. `services/worker/`
   - Worker 注册、心跳、状态管理。
2. `services/scheduler/`
   - 新会话调度、粘性路由、故障转移判定。
3. `services/runtime-governance/`
   - runtime 生命周期、超时、回收、重试编排。
4. `repos/worker-repo.ts`
5. `repos/session-binding-repo.ts`
6. `repos/runtime-lease-repo.ts`

### 4.3.2 运行时治理边界

1. `runtime/` 负责进程级生命周期桥接。
2. `services/runtime-governance/` 负责业务级状态机。
3. `services/scheduler/` 负责选 Worker，不直接操作 ACP 协议细节。

## 4.4 核心数据模型

### 4.4.1 建议新增或补齐表

1. `worker_node`
2. `worker_heartbeat`
3. `business_session_runtime_binding`
4. `runtime_lease`
5. `runtime_failure_log`

### 4.4.2 关键字段建议

#### `worker_node`

1. `id`
2. `tenant_id`
3. `organization_id`
4. `node_code`
5. `endpoint`
6. `status`
7. `capacity_total`
8. `capacity_used`
9. `last_heartbeat_at`
10. `version`

#### `business_session_runtime_binding`

1. `id`
2. `business_session_id`
3. `worker_node_id`
4. `acp_session_id`
5. `runtime_key`
6. `binding_status`
7. `bound_at`
8. `released_at`

#### `runtime_lease`

1. `id`
2. `business_session_id`
3. `worker_node_id`
4. `lease_owner`
5. `lease_expires_at`
6. `version`

中文/English：Runtime binding and lease must be explicit DB records, so recovery never depends on in-memory state only.

### 4.4.3 P2 枚举冻结口径

#### `worker_node.status`

1. `registering`
2. `ready`
3. `busy`
4. `degraded`
5. `offline`
6. `draining`

#### `business_session.status`

1. `created`
2. `opening`
3. `active`
4. `waiting_input`
5. `cancelling`
6. `closing`
7. `completed`
8. `failed`
9. `orphaned`

#### `business_session_runtime_binding.binding_status`

1. `binding`
2. `bound`
3. `lost`
4. `releasing`
5. `released`

#### `runtime_failure_log.failure_type`

1. `worker_offline`
2. `runtime_exit`
3. `open_timeout`
4. `prompt_timeout`
5. `close_timeout`
6. `binding_conflict`

## 4.5 状态模型

### 4.5.1 Worker 状态

建议 Worker 状态至少包含：

1. `registering`
2. `ready`
3. `busy`
4. `degraded`
5. `offline`
6. `draining`

### 4.5.2 会话运行状态

建议会话生命周期细化为：

1. `created`
2. `opening`
3. `active`
4. `waiting_input`
5. `cancelling`
6. `closing`
7. `completed`
8. `failed`
9. `orphaned`

### 4.5.3 绑定状态

1. `binding`
2. `bound`
3. `lost`
4. `releasing`
5. `released`

## 4.6 关键流程

### 4.6.1 Worker 注册与心跳

1. Worker 启动后向平台注册。
2. 平台为 Worker 创建 `worker_node` 记录。
3. Worker 周期性发送心跳与容量信息。
4. 平台根据最近心跳更新 Worker 状态。
5. 超过心跳超时时间未上报则标记 `offline`。

### 4.6.2 新会话调度

1. 用户创建会话。
2. 调度服务查询当前可用 Worker。
3. 根据容量、状态、租户边界、版本兼容性选取目标 Worker。
4. 写入 `business_session_runtime_binding`。
5. 后续打开 / prompt 默认走已绑定 Worker。

### 4.6.3 会话粘性

1. 如果会话已有 `worker_node_id` 与活动绑定，则优先走原 Worker。
2. 只有在 Worker `offline / draining / lost` 时才进入重新调度。
3. 重新调度前必须显式将旧绑定标记为 `lost` 或 `released`。

### 4.6.4 故障恢复

1. 平台发现 Worker 失联。
2. 扫描该 Worker 下所有活跃绑定。
3. 将绑定状态标记为 `lost`。
4. 会话状态标记为 `orphaned` 或 `created`。
5. 根据策略决定自动恢复还是等待用户重新打开。

### 4.6.5 僵尸清理

平台定时任务需要处理：

1. 绑定已存在但 Worker 已离线
2. ACP 进程已退出但会话仍显示 `active`
3. lease 已过期但未释放
4. 关闭中的会话长期未完成

## 4.7 调度策略建议

第一版只实现简单可解释策略：

1. 仅从 `ready` Worker 中选择
2. 优先当前租户允许使用的 Worker
3. 优先容量余量大的 Worker
4. 并列时按最近最少分配选择

不建议在 `P2` 第一版就引入：

1. 复杂评分系统
2. 预测式调度
3. 动态抢占

## 4.8 API 改造范围

建议新增或改造以下接口：

1. `POST /api/worker/register`
2. `POST /api/worker/heartbeat`
3. `GET /api/system/workers`
4. `POST /api/session/recover`
5. `POST /api/session/rebind`

已有接口需要补充：

1. 会话创建时写入调度结果
2. 会话打开时执行粘性路由
3. 会话关闭时显式释放绑定
4. prompt / cancel / close 时校验运行状态机

### 4.8.1 P2 接口设计细化（示例）

补充说明：以下示例用于把“调度/绑定/恢复”从概念落到可实现的协议口径；字段名可按仓库现有 DTO 规范调整，但语义建议保持一致。

#### `POST /api/worker/register`

请求：

```jsonc
{
  "tenantId": "t_xxx",
  "organizationId": "o_xxx",
  "nodeCode": "worker-001",
  "endpoint": "http://10.0.0.1:1234",
  "version": "1.2.3",
  "capacityTotal": 10
}
```

校验要点：

1. 必须鉴权 + 授权（资源：`worker_node`，动作：`manage`）。
2. `nodeCode` 在同一范围内唯一（避免重复注册）。

响应：

```jsonc
{
  "code": "OK",
  "message": "success",
  "data": { "workerNodeId": "w_xxx", "status": "ready" },
  "requestId": "req_xxx"
}
```

#### `POST /api/worker/heartbeat`

请求：

```jsonc
{
  "workerNodeId": "w_xxx",
  "capacityUsed": 3,
  "status": "ready"
}
```

校验要点：

1. 心跳允许使用“Worker 自身身份”或“平台鉴权”两种模式其一（需要在实现阶段固定一种口径，避免双轨）。
2. 心跳只能更新自身记录，不允许跨 `tenant_id / organization_id` 更新其它 Worker。

#### `POST /api/session/rebind`

用途：对 `orphaned` 或 `lost` 绑定的会话触发重新绑定（可由平台定时任务或人工触发）。

请求：

```jsonc
{
  "sessionId": "s_xxx",
  "reason": "worker_offline"
}
```

校验要点：

1. 必须鉴权 + 授权（资源：`business_session`，动作：`update` 或单独定义 `rebind`）。
2. 会话必须处于允许 rebind 的状态（例如 `orphaned`），不允许对 `active` 强制迁移（除非后续明确支持）。

## 4.9 运维与审计要求

`P2` 完成后，至少需要可追踪以下数据：

1. 某会话当前绑定哪个 Worker
2. 某 Worker 当前承载多少会话
3. 某会话最近一次失败发生在哪个节点
4. 某次故障恢复是否成功
5. 某次自动清理影响了哪些会话

建议新增以下指标：

1. Worker 在线数
2. Worker 容量使用率
3. 活跃会话数
4. 僵尸会话数
5. 会话恢复成功率
6. 会话打开耗时

## 4.10 上线顺序

1. 先落 `worker_node` 与心跳
2. 再落会话绑定表
3. 再改新建 / 打开会话调度
4. 再补故障恢复与僵尸清理

## 4.11 风险

1. 如果 Worker 状态切换不稳，容易导致误判离线。
2. 如果粘性策略与恢复策略没有统一状态机，容易出现双绑定。
3. 如果恢复自动化过强，可能把本应人工确认的异常场景自动覆盖。

---

## 5. P3：配置与扩展治理

## 5.1 目标

`P3` 的目标是让 provider / model / skill / MCP 等运行配置从“本地文件 + 单点修改”演进为“分级配置 + 可审计 + 可审批 + 可控生效”的企业平台能力。

需要达到的结果：

1. 配置有层级来源与覆盖顺序。
2. 配置修改有影响范围分析。
3. 配置生效有明确策略，不再简单粗暴重置全部会话。
4. 敏感扩展能力有启用策略与审批能力。
5. 配置变更可审计、可回溯、可比较。

## 5.2 非目标

`P3` 不做以下事情：

1. 不做完整配置中心产品。
2. 不做跨环境一键发布平台。
3. 不做第三方 Secret Manager 的深度集成实现。
4. 不做任意插件市场能力。

## 5.3 架构落点

### 5.3.1 模块划分

建议新增或明确以下模块：

1. `services/configuration/`
   - 分级配置读取、合并、校验。
2. `services/config-impact/`
   - 配置变更影响范围分析。
3. `services/config-approval/`
   - 高风险配置审批编排。
4. `services/extension-policy/`
   - MCP / skill / provider 可用性策略。
5. `repos/config-repo.ts`
6. `repos/config-audit-repo.ts`
7. `repos/config-approval-repo.ts`

### 5.3.2 配置边界

配置治理必须覆盖以下对象：

1. provider
2. model
3. custom model
4. MCP server
5. skill
6. runtime capability flag

## 5.4 核心数据模型

### 5.4.1 建议新增或补齐表

1. `config_namespace`
2. `config_item`
3. `config_override`
4. `config_change_log`
5. `config_approval_request`
6. `extension_policy`

### 5.4.2 层级模型

建议配置层级按以下顺序生效：

1. 平台级
2. 租户级
3. 组织级
4. 项目级
5. 工作区级
6. 会话级

优先级规则：

1. 下层覆盖上层
2. 同层最后生效版本覆盖前版本
3. 禁止覆盖安全基线禁用项

### 5.4.3 P3 枚举与优先级冻结口径

#### `scope_level`

1. `platform`
2. `tenant`
3. `organization`
4. `project`
5. `workspace`
6. `session`

#### `config_change_log.change_type`

1. `create`
2. `update`
3. `delete`
4. `enable`
5. `disable`

#### `config_approval_request.status`

1. `pending`
2. `approved`
3. `rejected`
4. `cancelled`
5. `expired`

#### `extension_policy.policy_mode`

1. `allow`
2. `deny`
3. `approval_required`

#### 配置覆盖优先级

1. `session`
2. `workspace`
3. `project`
4. `organization`
5. `tenant`
6. `platform`

说明：

1. 解析顺序按自上而下合并。
2. 覆盖优先级按自下而上覆盖。
3. 文档、代码、测试、审计输出必须使用同一套层级名词。

### 5.4.4 配置项命名与约束（建议补齐）

为避免配置项扩张后不可治理，建议在 `P3` 固定以下口径：

1. `namespace`：按领域划分，例如 `provider` / `model` / `mcp` / `skill` / `runtime`。
2. `config_key`：小写 `snake_case` 或 `dot.case`，禁止临时拼写（中文/English：stable, searchable keys）。
3. `value_json`：必须可被 schema 校验（实现阶段可用仓库既有 schema 方案对齐）。
4. 敏感字段（例如 apiKey/token）禁止明文回显；审计只记录“是否变更/影响范围”，不记录明文内容。

### 5.4.3 关键字段建议

#### `config_item`

1. `id`
2. `namespace`
3. `config_key`
4. `config_type`
5. `value_json`
6. `scope_level`
7. `scope_id`
8. `status`
9. `version`
10. `created_by`
11. `updated_by`

#### `config_change_log`

1. `id`
2. `request_id`
3. `operator_user_id`
4. `scope_level`
5. `scope_id`
6. `config_key`
7. `before_value_json`
8. `after_value_json`
9. `change_type`
10. `impact_summary_json`
11. `approved_by`
12. `applied_at`

#### `extension_policy`

1. `id`
2. `tenant_id`
3. `organization_id`
4. `project_id`
5. `extension_type`
6. `extension_key`
7. `policy_mode`
8. `approval_required`
9. `enabled`

## 5.5 配置合并模型

### 5.5.1 合并原则

每次会话打开时，服务端统一计算“最终配置快照”：

1. 从平台级开始读取
2. 逐层向下合并
3. 对冲突项按优先级覆盖
4. 输出会话运行快照
5. 将快照版本号记录到会话元数据

中文/English：Session runtime must consume a resolved config snapshot, not query scattered config sources on every step.

### 5.5.2 配置快照

建议为运行态引入 `resolved_config_snapshot` 概念，至少记录：

1. 来源层级
2. 最终 provider 配置
3. 可用 model 列表
4. MCP / skill 策略结果
5. 快照版本

## 5.6 关键流程

### 5.6.1 provider 保存

1. 用户提交 provider 配置修改。
2. 服务端校验权限、范围、字段格式与敏感项。
3. 生成配置变更草案。
4. 计算受影响会话范围。
5. 如需审批则进入审批态。
6. 审批通过后落配置并生成 change log。
7. 按生效策略决定是否重载已有会话。

### 5.6.2 影响范围分析

每次配置修改都应明确输出：

1. 影响哪些租户 / 组织 / 项目 / 工作区
2. 影响哪些活跃会话
3. 影响哪些 Worker
4. 是否需要立即重载
5. 是否只影响新建会话

### 5.6.3 MCP / skill 启用

1. 用户提交启用请求。
2. 服务端校验当前范围策略。
3. 若为高风险扩展则发起审批。
4. 审批通过后落库启用。
5. 记录审批人与配置影响范围。

## 5.7 API 改造范围

建议新增或改造以下接口：

1. `GET /api/config/provider/list`
2. `POST /api/config/provider/save`
3. `GET /api/config/model/list`
4. `POST /api/config/model/save`
5. `GET /api/config/impact/preview`
6. `POST /api/config/approval/create`
7. `POST /api/config/approval/approve`
8. `GET /api/config/change-log/list`
9. `GET /api/extension/policy/list`
10. `POST /api/extension/policy/update`

接口统一要求：

1. 写接口返回变更摘要与影响范围摘要。
2. 高风险写接口必须返回是否进入审批流。
3. 任何配置变更必须带 `requestId` 并落审计。

### 5.7.1 P3 接口设计细化（示例）

#### `POST /api/config/provider/save`

用途：保存 provider 配置（写接口统一使用 `POST`，动作后缀为 `save` 或拆分为 `create/update/enable/disable`，实现阶段需固定一种口径，避免双轨）。

请求：

```jsonc
{
  "scopeLevel": "project",
  "scopeId": "p_xxx",
  "providerKey": "openai",
  "action": "update",
  "payload": {
    "baseUrl": "https://api.example.com",
    "apiKey": "***"
  },
  "idempotencyKey": "idem_xxx"
}
```

校验要点：

1. 必须鉴权 + 授权（资源：`provider_config`，动作：`update`）。
2. `scopeLevel/scopeId` 必须与当前用户数据范围匹配（越界直接拒绝）。
3. `payload` 必须通过 schema 校验；敏感字段禁止回显。

响应（如果进入审批流）：

```jsonc
{
  "code": "OK",
  "message": "approval required",
  "data": {
    "requiresApproval": true,
    "approvalRequestId": "apr_xxx",
    "impactSummary": { "affectedSessions": 12, "affectedWorkspaces": 3 }
  },
  "requestId": "req_xxx"
}
```

#### `GET /api/config/impact/preview`

用途：在“未真正生效”前预览影响范围，避免误伤线上会话。

返回建议至少包含：

1. 影响范围（tenant/org/project/workspace/session 维度）
2. 会话数量与关键会话 ID 列表（可分页）
3. 是否建议立即重载（布尔）与原因说明（字符串）

## 5.8 Service 与 Repo 改造重点

### 5.8.1 Service 层

建议补齐：

1. `resolveConfigSnapshot()`
2. `previewConfigImpact()`
3. `applyConfigChange()`
4. `requireConfigApproval()`
5. `enforceExtensionPolicy()`

### 5.8.2 Repo 层

Repo 只负责：

1. 存配置项
2. 查配置项
3. 存变更日志
4. 存审批记录
5. 查策略记录

Repo 不负责：

1. 计算最终配置快照
2. 判定是否需要审批
3. 判定应重载哪些会话

## 5.9 运维与审计要求

`P3` 完成后，平台必须能回答以下问题：

1. 某个 provider 是谁改的
2. 某次配置变更影响了哪些会话
3. 某个 MCP 为什么当前不可用
4. 某次审批是谁批的
5. 某个会话运行时拿到的是哪一版配置快照

建议最少提供：

1. 配置变更日志查询
2. 配置版本对比
3. 影响范围预览
4. 审批状态查询

## 5.10 上线顺序

1. 先落配置表与 change log
2. 再落配置分级合并
3. 再补影响范围预览
4. 最后补审批与扩展策略

## 5.11 风险

1. 如果先做配置写入，不做影响分析，容易误伤线上活跃会话。
2. 如果配置快照与实时配置读取混用，容易出现会话行为不一致。
3. 如果 MCP / skill 策略不分层，后续会出现组织级与项目级治理冲突。

---

## 6. 分阶段实施建议

## 6.1 P1 建议拆分

1. `P1-A`：认证会话全量持久化
2. `P1-B`：工作区绑定强校验
3. `P1-C`：会话 / 事件读取边界过滤
4. `P1-D`：RBAC 写接口接入

## 6.2 P2 建议拆分

1. `P2-A`：Worker 注册与心跳
2. `P2-B`：会话绑定与粘性路由
3. `P2-C`：运行时状态机治理
4. `P2-D`：故障恢复与僵尸清理

## 6.3 P3 建议拆分

1. `P3-A`：配置持久化与变更日志
2. `P3-B`：分级配置解析
3. `P3-C`：影响范围预览
4. `P3-D`：审批与扩展策略

## 7. 与当前代码结构的对齐要求

后续落地时必须遵守以下约束：

1. `http/routes/` 只做协议层编排，不内嵌权限与调度规则。
2. `services/` 负责访问控制、状态机、配置合并、影响分析。
3. `repos/` 只做持久化，不做授权决策。
4. `runtime/` 只负责 ACP / runtime 桥接，不负责租户和组织规则。
5. 新增表必须显式带范围字段，至少包含 `tenant_id`，需要时带 `organization_id / project_id`。

## 7.1 文档与实现同步要求

从本阶段开始，以下内容一旦变更，必须同步更新文档：

1. 目录新增正式服务模块
2. 核心状态枚举
3. 资源类型与动作类型
4. 配置层级与覆盖顺序
5. 对外接口的授权口径

如果代码实现和文档冲突，默认视为架构未对齐，不应直接忽略文档继续扩写实现。

## 8. 建议的下一步

在文档层面，建议下一步直接按以下顺序推进实施：

1. 先做 `P1-A + P1-B`
2. 再做 `P1-C + P1-D`
3. 然后进入 `P2-A + P2-B`
4. 最后推进 `P3-A`

原因很简单：

1. 没有稳定的身份与边界控制，后续 Worker 调度与配置治理都无法真正企业化。
2. 没有执行面治理，多节点和故障恢复就无法闭环。
3. 没有配置治理，provider / MCP / skill 的企业级启用边界就无法落地。

## 9. 验收口径

每个阶段完成后都应至少满足以下验收口径：

1. `bun run typecheck` 通过
2. 关键主链路集成测试通过
3. 越权访问有明确拒绝结果
4. 审计能定位操作者、资源、动作、影响范围
5. 文档与实现边界一致，不出现架构设计和代码实际行为相互背离
