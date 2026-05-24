# OpenCode ACP 运行壳实施设计稿

## 1. 文档目标

本文档是在 [opencode-acp-runtime-shell-design.md](/d:/开发工作/opencode/docs/opencode-acp-runtime-shell-design.md:1) 基础上的实施设计稿，目标是把方案推进到可拆任务、可建表、可出接口、可起 Docker 的程度。

本文档聚焦第一版可落地实现，不追求一次性覆盖所有长期演进能力。

## 2. 实施目标

第一版目标只收敛为四条主链路：

1. 用户能登录运行壳平台。
2. 用户能创建、打开、恢复、关闭、分支一个 ACP 会话。
3. 前端能稳定看到 ACP 的消息流、计划、工具状态、权限请求和使用量更新。
4. 平台能通过 Docker 与 `opencode` 一起启动，并保持会话粘性路由。

## 3. 实施范围

### 3.1 本期包含

1. 平台登录与基础会话态
2. `runtime-shell-server`
3. `runtime-shell-web`
4. `opencode-worker`
5. ACP Bridge
6. 元数据数据库
7. 最小审计日志
8. Docker Compose 部署

### 3.2 本期不包含

1. 跨机透明恢复
2. 自动 Worker 迁移
3. 完整终端 IDE 体验
4. 复杂组织权限系统
5. 细粒度计费结算
6. 多 Region 部署

## 4. 总体实施结构

### 4.1 运行单元

第一版建议四个运行单元：

1. `runtime-shell-web`
   - SolidStart 前端
   - 登录页、会话页、管理页

2. `runtime-shell-server`
   - 平台 API
   - ACP Bridge
   - Worker 管理
   - 审计

3. `opencode-worker`
   - `opencode serve`
   - ACP Runtime Manager
   - 本地 workspace / pty / sqlite

4. `postgres`
   - 用户、会话、Worker、审计等元数据

### 4.2 第一版推荐工程落点

建议优先基于 `packages/enterprise` 扩展，而不是新开全新仓内包。

推荐拆法：

1. `packages/enterprise/src/routes`
   - 页面路由

2. `packages/enterprise/src/routes/api`
   - 平台 API 路由

3. `packages/enterprise/src/core/runtime-shell`
   - 平台核心逻辑

4. `packages/enterprise/src/core/runtime-shell/acp`
   - ACP Bridge

5. `packages/enterprise/src/core/runtime-shell/opencode`
   - `opencode` SDK/HTTP 适配

6. `packages/enterprise/src/core/runtime-shell/auth`
   - 登录、会话、角色

7. `packages/enterprise/src/core/runtime-shell/storage`
   - 元数据持久化

## 5. 核心运行时设计

### 5.1 runtime-shell-server 模块拆分

建议拆成下面几个模块：

1. `auth-service`
   - 登录
   - 当前用户
   - 角色判断

2. `worker-service`
   - Worker 注册
   - 心跳
   - Worker 选择
   - 摘流

3. `session-service`
   - 业务会话创建
   - 会话状态机
   - `business_session_id` / `worker_id` / `acp_session_id` 绑定

4. `acp-bridge-service`
   - 打开 ACP session
   - 输入转发
   - 事件流转发
   - 模型/模式切换
   - 权限响应

5. `opencode-adapter-service`
   - 调用 `opencode serve` 暴露的 HTTP 能力
   - 查询消息、diff、文件、PTY、MCP、permission

6. `audit-service`
   - 记录关键操作与事件摘要

### 5.2 opencode-worker 模块拆分

每个 Worker 建议包含：

1. `http-runtime`
   - 对外暴露 `opencode serve`

2. `acp-runtime-manager`
   - 管理 `opencode acp` 子进程
   - 维护会话到 ACP 通道的映射
   - 提供会话级打开/关闭/心跳能力

3. `workspace-runtime`
   - 本地目录
   - worktree
   - 文件状态

4. `pty-runtime`
   - PTY 创建、连接、销毁

5. `state-runtime`
   - 本地 SQLite
   - 日志
   - 临时文件

### 5.3 ACP Runtime Manager 设计

第一版建议在 Worker 内新增一个轻量 ACP 运行时管理器，职责如下：

1. 为会话分配 ACP 进程句柄。
2. 建立 `business_session_id -> acp_session_id -> process_handle` 映射。
3. 负责 ACP 进程启动、保活、清理。
4. 向 `runtime-shell-server` 暴露内部 RPC 或本地调用接口。

第一版不要求做复杂进程池，建议采用：

1. 新会话首次打开时拉起 ACP 进程。
2. 同一业务会话后续复用原 ACP 进程。
3. 会话关闭或长时间 idle 后回收。

## 6. 数据模型设计

### 6.1 表清单

建议第一版至少建下面 8 张表：

1. `user_account`
2. `tenant`
3. `project`
4. `worker_node`
5. `business_session`
6. `acp_session_binding`
7. `session_event_cursor`
8. `audit_log`

### 6.2 `user_account`

```sql
create table user_account (
  id bigint primary key,
  tenant_id bigint not null,
  username varchar(64) not null,
  display_name varchar(128) not null,
  email varchar(256),
  role varchar(32) not null,
  status varchar(32) not null default 'active',
  external_subject varchar(256),
  created_at timestamp not null,
  created_by bigint,
  updated_at timestamp not null,
  updated_by bigint
);
```

索引建议：

1. `uk_user_account_tenant_username (tenant_id, username)`
2. `idx_user_account_external_subject (external_subject)`

### 6.3 `tenant`

```sql
create table tenant (
  id bigint primary key,
  code varchar(64) not null,
  name varchar(128) not null,
  status varchar(32) not null default 'active',
  created_at timestamp not null,
  created_by bigint,
  updated_at timestamp not null,
  updated_by bigint
);
```

### 6.4 `project`

```sql
create table project (
  id bigint primary key,
  tenant_id bigint not null,
  code varchar(64) not null,
  name varchar(128) not null,
  default_workspace_path varchar(1024),
  status varchar(32) not null default 'active',
  created_at timestamp not null,
  created_by bigint,
  updated_at timestamp not null,
  updated_by bigint
);
```

索引建议：

1. `uk_project_tenant_code (tenant_id, code)`
2. `idx_project_tenant_id (tenant_id)`

### 6.5 `worker_node`

```sql
create table worker_node (
  id bigint primary key,
  worker_code varchar(64) not null,
  base_url varchar(512) not null,
  status varchar(32) not null,
  capacity int not null default 0,
  active_session_count int not null default 0,
  labels_json text,
  last_heartbeat_at timestamp,
  created_at timestamp not null,
  created_by bigint,
  updated_at timestamp not null,
  updated_by bigint
);
```

状态建议：

1. `starting`
2. `ready`
3. `busy`
4. `draining`
5. `offline`

### 6.6 `business_session`

```sql
create table business_session (
  id bigint primary key,
  tenant_id bigint not null,
  project_id bigint not null,
  user_id bigint not null,
  title varchar(256) not null,
  workspace_id varchar(128),
  workspace_path varchar(1024),
  worker_id bigint,
  status varchar(32) not null,
  mode_id varchar(128),
  model_id varchar(256),
  variant varchar(64),
  last_message_at timestamp,
  created_at timestamp not null,
  created_by bigint,
  updated_at timestamp not null,
  updated_by bigint
);
```

状态建议：

1. `created`
2. `binding`
3. `active`
4. `idle`
5. `completed`
6. `failed`

### 6.7 `acp_session_binding`

```sql
create table acp_session_binding (
  id bigint primary key,
  business_session_id bigint not null,
  worker_id bigint not null,
  acp_session_id varchar(128) not null,
  runtime_key varchar(256),
  status varchar(32) not null,
  opened_at timestamp,
  closed_at timestamp,
  created_at timestamp not null,
  created_by bigint,
  updated_at timestamp not null,
  updated_by bigint
);
```

索引建议：

1. `uk_acp_binding_business_session (business_session_id)`
2. `uk_acp_binding_worker_acp_session (worker_id, acp_session_id)`

### 6.8 `session_event_cursor`

```sql
create table session_event_cursor (
  id bigint primary key,
  business_session_id bigint not null,
  last_event_id varchar(128),
  last_event_time timestamp,
  created_at timestamp not null,
  created_by bigint,
  updated_at timestamp not null,
  updated_by bigint
);
```

用途：

1. 支持前端断线重连。
2. 支持事件续传起点。

### 6.9 `audit_log`

```sql
create table audit_log (
  id bigint primary key,
  tenant_id bigint not null,
  project_id bigint,
  user_id bigint,
  business_session_id bigint,
  worker_id bigint,
  action varchar(128) not null,
  resource_type varchar(64),
  resource_id varchar(128),
  request_id varchar(128),
  trace_id varchar(128),
  result_code varchar(32),
  detail_json text,
  created_at timestamp not null
);
```

## 7. 接口设计

### 7.1 统一响应结构

所有平台接口建议统一返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "requestId": "req_xxx"
}
```

### 7.2 鉴权设计

平台 API 统一使用平台登录态，不直接暴露 `opencode` Basic Auth 给浏览器。

服务端调用 Worker 时：

1. 服务端拼接 Basic Auth 头访问 `opencode serve`
2. 或在内网中通过网关注入

### 7.3 平台接口详细草案

#### `POST /api/auth/login`

用途：

1. 平台登录

请求：

```json
{
  "provider": "oidc",
  "code": "auth_code"
}
```

响应 `data`：

```json
{
  "user": {
    "id": "u_001",
    "displayName": "彦祖",
    "role": "admin"
  },
  "token": "jwt_xxx"
}
```

#### `GET /api/auth/me`

用途：

1. 获取当前登录用户

#### `POST /api/session/create`

用途：

1. 创建业务会话
2. 分配 Worker

请求：

```json
{
  "projectId": "p_001",
  "title": "新会话",
  "workspacePath": "/workspace/workspaces/demo"
}
```

响应 `data`：

```json
{
  "businessSessionId": "bs_001",
  "workerId": "w_001",
  "status": "created"
}
```

#### `GET /api/session/list`

查询参数建议：

1. `projectId`
2. `status`
3. `pageNo`
4. `pageSize`

#### `GET /api/session/detail`

查询参数：

1. `businessSessionId`

响应建议包含：

1. 会话元信息
2. 当前绑定 Worker
3. ACP 会话信息
4. 模型/模式
5. 最近事件游标

#### `POST /api/session/close`

请求：

```json
{
  "businessSessionId": "bs_001"
}
```

### 7.4 ACP Bridge 接口详细草案

#### `POST /api/acp/session/open`

用途：

1. 为业务会话打开 ACP 会话

请求：

```json
{
  "businessSessionId": "bs_001",
  "cwd": "/workspace/workspaces/demo",
  "mcpServers": []
}
```

响应 `data`：

```json
{
  "businessSessionId": "bs_001",
  "acpSessionId": "sess_001",
  "workerId": "w_001",
  "status": "active"
}
```

#### `POST /api/acp/session/load`

用途：

1. 打开已存在 ACP 会话并回放上下文

#### `POST /api/acp/session/resume`

用途：

1. 恢复业务会话到活跃态

#### `POST /api/acp/session/fork`

用途：

1. 从当前会话派生一个新会话

#### `POST /api/acp/session/input`

用途：

1. 向 ACP 会话写入用户输入

请求：

```json
{
  "businessSessionId": "bs_001",
  "parts": [
    {
      "type": "text",
      "text": "继续当前任务并总结风险"
    }
  ]
}
```

#### `POST /api/acp/session/model/update`

请求：

```json
{
  "businessSessionId": "bs_001",
  "modelId": "openai/gpt-5.5"
}
```

#### `POST /api/acp/session/mode/update`

请求：

```json
{
  "businessSessionId": "bs_001",
  "modeId": "code"
}
```

#### `POST /api/acp/session/config/update`

请求：

```json
{
  "businessSessionId": "bs_001",
  "configId": "effort",
  "value": "high"
}
```

#### `POST /api/acp/session/permission/respond`

请求：

```json
{
  "businessSessionId": "bs_001",
  "requestId": "perm_001",
  "reply": "allow",
  "message": "已批准"
}
```

#### `GET /api/acp/session/events`

建议同时支持：

1. `SSE`
2. `WebSocket`

查询参数：

1. `businessSessionId`
2. `afterEventId`

### 7.5 Worker 内部接口

第一版不建议暴露太多平台外可见接口，但建议至少有：

1. `POST /internal/worker/register`
2. `POST /internal/worker/heartbeat`
3. `POST /internal/acp/runtime/open`
4. `POST /internal/acp/runtime/close`
5. `GET /internal/acp/runtime/status`

这组接口可以放在 `runtime-shell-server` 内部管理，也可以由 Worker 自上报。

## 8. 事件模型设计

### 8.1 统一事件信封

建议平台事件流统一为：

```json
{
  "eventId": "evt_001",
  "eventType": "plan",
  "businessSessionId": "bs_001",
  "acpSessionId": "sess_001",
  "workerId": "w_001",
  "timestamp": "2026-05-21T12:00:00+08:00",
  "payload": {}
}
```

### 8.2 事件类型

第一版建议支持：

1. `session_opened`
2. `session_closed`
3. `agent_message_chunk`
4. `user_message_chunk`
5. `agent_thought_chunk`
6. `tool_call_update`
7. `plan`
8. `usage_update`
9. `available_commands_update`
10. `config_option_update`
11. `permission_requested`
12. `permission_resolved`
13. `worker_disconnected`
14. `session_failed`

### 8.3 关键事件 payload 设计

#### `plan`

```json
{
  "steps": [
    {
      "step": "分析代码结构",
      "status": "completed"
    },
    {
      "step": "输出实现方案",
      "status": "in_progress"
    }
  ]
}
```

#### `tool_call_update`

```json
{
  "toolCallId": "tool_001",
  "toolName": "shell_command",
  "status": "running",
  "title": "执行命令",
  "summary": "正在检查 session 路由实现"
}
```

#### `permission_requested`

```json
{
  "requestId": "perm_001",
  "toolName": "shell_command",
  "reason": "需要执行可能影响工作区的命令"
}
```

#### `usage_update`

```json
{
  "inputTokens": 1200,
  "outputTokens": 860,
  "totalTokens": 2060
}
```

## 9. 前端页面实施设计

### 9.1 页面树

建议页面路由如下：

1. `/login`
2. `/`
3. `/sessions`
4. `/sessions/:sessionId`
5. `/workers`
6. `/audit`
7. `/settings`

### 9.2 组件拆分建议

#### 会话页组件

1. `SessionSidebar`
2. `SessionThread`
3. `SessionComposer`
4. `SessionPlanPanel`
5. `SessionToolPanel`
6. `SessionPermissionPanel`
7. `SessionUsagePanel`
8. `SessionDiffPanel`

#### 管理页组件

1. `WorkerTable`
2. `AuditTable`
3. `ProjectSwitcher`
4. `UserMenu`

### 9.3 状态管理建议

建议分三类状态：

1. 页面初始化状态
   - 当前用户
   - 当前项目
   - 当前会话

2. 列表查询状态
   - 会话列表
   - Worker 列表
   - 审计列表

3. 实时流状态
   - 事件流
   - 工具执行状态
   - 权限请求状态

### 9.4 第一版前端交互闭环

会话页建议形成下面闭环：

1. 打开会话页
2. 拉取会话详情
3. 建立事件订阅
4. 用户发输入
5. 展示流式回复
6. 展示 Plan / Tool / Permission / Usage
7. 允许切模型、切模式、批权限

## 10. Docker Compose 草案

### 10.1 第一版最小草案

下面这份 Compose 草案定位为“本地联调 / 验证链路”版本，不是生产部署模板。

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16
    container_name: runtime-shell-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: runtime_shell
      POSTGRES_USER: runtime_shell
      POSTGRES_PASSWORD: change-me
    ports:
      - "5432:5432"
    volumes:
      - ./docker-data/postgres:/var/lib/postgresql/data

  opencode-worker:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: opencode-worker
    restart: unless-stopped
    environment:
      OPENCODE_SERVER_USERNAME: opencode
      OPENCODE_SERVER_PASSWORD: change-me
      OPENCODE_CONFIG_DIR: /workspace/.opencode
      OPENCODE_DISABLE_MODELS_FETCH: "0"
    ports:
      - "4096:4096"
    volumes:
      - ./docker-data/opencode:/root/.local/share/opencode
      - ./docker-data/config:/root/.config/opencode
      - ./.opencode/opencode.jsonc:/workspace/.opencode/opencode.jsonc:ro
      - ./.opencode/skills:/workspace/.opencode/skills:ro
      - ./workspaces:/workspace/workspaces
    working_dir: /workspace
    command: ["serve", "--hostname", "0.0.0.0", "--port", "4096"]

  runtime-shell:
    image: oven/bun:1.3.14
    container_name: runtime-shell
    restart: unless-stopped
    depends_on:
      - postgres
      - opencode-worker
    working_dir: /workspace
    volumes:
      - ./:/workspace
    environment:
      SHELL_DATABASE_URL: postgresql://runtime_shell:change-me@postgres:5432/runtime_shell
      SHELL_OPENCODE_BASE_URL: http://opencode-worker:4096
      SHELL_OPENCODE_USERNAME: opencode
      SHELL_OPENCODE_PASSWORD: change-me
      SHELL_JWT_SECRET: change-me
    ports:
      - "3000:3000"
    command: ["bun", "run", "--cwd", "packages/enterprise", "dev", "--host", "0.0.0.0", "--port", "3000"]
```

### 10.2 第二版演进

第二版再考虑拆成：

1. `runtime-shell-web`
2. `runtime-shell-server`
3. `opencode-worker`
4. `postgres`
5. `redis`

如果进入生产部署，`runtime-shell` 应改为：

1. 先执行 build
2. 再使用 `start` 或独立 Node/Bun 运行命令启动
3. 前后端最好拆成独立镜像，而不是继续使用开发态 `dev` 命令

## 11. 安全与审计设计

### 11.1 基本原则

1. 浏览器永远不直接持有 `opencode` 服务凭据。
2. 浏览器永远不直接连接 ACP stdio。
3. 平台接口统一做用户鉴权与数据范围校验。
4. Worker 凭据仅存在服务端环境变量。

### 11.2 审计记录范围

第一版至少记录：

1. 登录成功/失败
2. 会话创建/关闭/分支
3. 模型切换/模式切换
4. 权限批准/拒绝
5. 会话失败
6. Worker 摘流/离线

### 11.3 敏感信息处理

日志中禁止输出：

1. Basic Auth 原文
2. Provider 密钥
3. MCP OAuth token
4. 用户敏感文件内容全文

## 12. 失败处理设计

### 12.1 会话级失败

如果 ACP 运行时断开：

1. 先将 `business_session.status` 标记为 `failed` 或 `idle`
2. 向前端推送 `worker_disconnected` 或 `session_failed`
3. 前端提示用户可重试恢复

### 12.2 Worker 级失败

如果 Worker 心跳超时：

1. 标记 `worker_node.status = offline`
2. 阻止新会话继续分配到该 Worker
3. 关联会话标记异常

第一版不做自动迁移恢复。

## 13. 分阶段任务拆分建议

### 13.1 阶段一：基础设施

1. 建立 `packages/enterprise` 运行壳目录结构
2. 接入 PostgreSQL
3. 建表与基础 Repository
4. 接入登录态

### 13.2 阶段二：平台主链路

1. 实现 Worker 注册/心跳
2. 实现业务会话创建与绑定
3. 实现 `opencode serve` 适配层
4. 实现 ACP Bridge 打开/输入/订阅主链路

### 13.3 阶段三：前端工作台

1. 会话列表页
2. 会话详情页
3. 消息流组件
4. Plan / Tool / Permission / Usage 面板

### 13.4 阶段四：治理能力

1. Worker 管理页
2. 审计页
3. 错误提示与重试
4. 空状态/异常状态补齐

## 14. 验收口径

第一版建议按下面标准验收：

1. 用户登录后可创建新会话。
2. 新会话可成功打开 ACP session。
3. 用户输入后，前端可看到流式消息。
4. Plan、Tool、Permission、Usage 至少各能正确展示一条。
5. 会话关闭后能释放绑定关系。
6. Worker 下线后，新会话不会再分配到它。
7. 通过 Docker Compose 可一键拉起完整系统。

## 15. 最终建议

这份实施设计稿对应的最稳妥路径仍然是：

1. `packages/enterprise` 承载运行壳页面与平台 API。
2. `opencode-worker` 默认跑 `opencode serve`。
3. ACP 通过 Worker 内的 Runtime Manager 受控运行。
4. 平台侧用 PostgreSQL 管理元数据。
5. 第一版坚持粘性会话，不做跨机透明恢复。

如果要继续往下推进，下一步最合适的是直接输出：

1. 数据库 migration 草案
2. API schema 文件
3. `packages/enterprise` 目录初始化 patch
4. Docker Compose 初版修改
