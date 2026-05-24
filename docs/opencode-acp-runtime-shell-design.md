# OpenCode ACP 运行壳设计文档

## 1. 文档目标

本文档用于设计一个运行壳系统，使其能够：

1. 通过 ACP 调用 `opencode` 的服务能力。
2. 提供多用户登录的前端控制台。
3. 覆盖 ACP 当前已具备的全部核心能力。
4. 通过 Docker 与 `opencode` 一起启动。

本文档只做设计，不直接展开实现代码。

## 2. 结论先行

结合 `docs` 现有分析、`packages/opencode/src/acp/*`、`packages/opencode/src/server/*`、`packages/app`、`packages/enterprise` 的代码现状，比较稳妥的方案不是“前端直接连 `opencode acp`”，也不是“把 `opencode web` 直接改造成多用户平台”，而是新增一个独立的运行壳系统，放在 `opencode` 前面，形成下面这套结构：

1. `opencode-worker`
   作用：运行 `opencode serve` 作为默认 HTTP 服务面，并按需托管 ACP 专用运行时，承接真实会话、目录、工具、PTY、MCP、文件与执行状态。

2. `runtime-shell-server`
   作用：提供多用户登录、业务会话管理、ACP Bridge、权限编排、事件转发、审计与对 `opencode` 的统一适配。

3. `runtime-shell-web`
   作用：提供多用户前端控制台，展示会话、计划、权限请求、工具执行、文件变更、终端输出、共享产物等。

4. `metadata-db`
   作用：保存用户、会话绑定、Worker 归属、审计记录、分享信息、配置等平台级数据。

5. `artifact-store`
   作用：保存导出文件、会话快照、共享产物、日志归档。

核心原则只有一句话：`opencode` 继续做有状态执行内核，运行壳负责把它包装成多用户、可登录、可治理、可部署的平台。

## 3. 代码分析结论

### 3.1 ACP 当前真实边界

从 [packages/opencode/src/cli/cmd/acp.ts](/d:/开发工作/opencode/packages/opencode/src/cli/cmd/acp.ts:1) 可以确认：

1. `opencode acp` 对外是 `stdin/stdout` 上的 NDJSON/JSON-RPC。
2. 它启动后会先拉起内部 `opencode` HTTP server。
3. ACP 层通过 `@opencode-ai/sdk/v2` 反向调用内部 HTTP 能力。

这说明 ACP 当前适合被桥接，不适合被浏览器或公网客户端直接接入。

### 3.2 ACP 会话状态绑定单实例

从 [packages/opencode/src/acp/session.ts](/d:/开发工作/opencode/packages/opencode/src/acp/session.ts:1) 可以确认：

1. ACP session 由 `ACPSessionManager` 管理。
2. 会话状态保存在进程内 `Map<string, ACPSessionState>`。
3. session 记录了 `cwd`、`mcpServers`、`model`、`variant`、`modeId` 等状态。

这意味着 ACP session 天然依赖当前进程实例，不能当作无状态请求随意切到别的机器。

### 3.3 ACP 已实现能力

从 [packages/opencode/src/acp/agent.ts](/d:/开发工作/opencode/packages/opencode/src/acp/agent.ts:520) 可以确认 ACP 已实现下列能力：

1. 初始化与能力协商：
   - `protocolVersion: 1`
   - `loadSession`
   - `mcpCapabilities.http`
   - `mcpCapabilities.sse`
   - `promptCapabilities.embeddedContext`
   - `promptCapabilities.image`
   - `sessionCapabilities.close`
   - `sessionCapabilities.fork`
   - `sessionCapabilities.list`
   - `sessionCapabilities.resume`

2. 会话生命周期：
   - `newSession`
   - `loadSession`
   - `listSessions`
   - `resumeSession`
   - `closeSession`
   - `unstable_forkSession`

3. 会话配置控制：
   - `unstable_setSessionModel`
   - `setSessionMode`
   - `setSessionConfigOption`

4. 事件回传：
   - `usage_update`
   - `tool_call_update`
   - `plan`
   - `agent_message_chunk`
   - `agent_thought_chunk`
   - `user_message_chunk`
   - `available_commands_update`
   - `config_option_update`
   - `requestPermission`

5. 能力特性：
   - 支持图片输入
   - 支持嵌入上下文
   - 支持 MCP server 配置
   - 支持可用命令动态更新
   - 支持模式切换
   - 支持模型切换与 effort/variant 切换

### 3.4 ACP 能力与产品能力的差异

官方中文文档 [packages/web/src/content/docs/zh-CN/acp.mdx](/d:/开发工作/opencode/packages/web/src/content/docs/zh-CN/acp.mdx:1) 写得很明确：

1. ACP 下几乎等同终端能力。
2. 内置工具、MCP、自定义工具、自定义斜杠命令、项目规则、格式化/lint、权限系统都支持。
3. 少数内置斜杠命令如 `/undo`、`/redo` 当前暂不支持。

因此运行壳的设计口径应该是：

1. “所有 ACP 已有能力要支持”成立。
2. “所有 Web/TUI 现有体验一比一复刻”不成立。
3. 第一版壳层应优先覆盖 ACP 语义，不要追求把整个 `opencode app` UI 克隆一遍。

### 3.5 `opencode web` 当前边界

从 [packages/opencode/src/cli/cmd/web.ts](/d:/开发工作/opencode/packages/opencode/src/cli/cmd/web.ts:1) 和 [packages/opencode/src/server/auth.ts](/d:/开发工作/opencode/packages/opencode/src/server/auth.ts:1) 可以确认：

1. `opencode web` 当前是单服务 Web 入口，更偏面向现有内置 Web UI。
2. 登录保护依赖 `OPENCODE_SERVER_USERNAME` + `OPENCODE_SERVER_PASSWORD` 的 Basic Auth。
3. 这是服务级认证，不是平台级多用户身份系统。

所以不能直接拿 `opencode web` 当多用户登录平台。

### 3.6 `opencode serve` 更适合作为平台默认服务面

从 [packages/opencode/src/cli/cmd/serve.ts](/d:/开发工作/opencode/packages/opencode/src/cli/cmd/serve.ts:1) 可以确认：

1. `opencode serve` 是 headless server 入口。
2. 它直接启动 HTTP 服务，不带自动打开浏览器与内置 Web UI 的行为。
3. 对运行壳来说，它比 `opencode web` 更适合作为 Worker 默认 HTTP 服务面。

因此部署设计里更合适的默认口径应该是：

1. `opencode serve` 负责平台适配层的 HTTP 能力面。
2. `opencode web` 只作为现有单用户 UI 或调试/运维入口来参考，不作为多用户平台主入口。

### 3.7 ACP 运行时不宜被简单描述成“常驻双进程”

从 [packages/opencode/src/cli/cmd/acp.ts](/d:/开发工作/opencode/packages/opencode/src/cli/cmd/acp.ts:1) 可以确认：

1. `opencode acp` 启动时会自己先拉起内部 HTTP server。
2. 然后 ACP 层再通过 SDK 调它自己拉起的 server。

这意味着如果文档简单写成“每个 Worker 常驻跑一个 `opencode serve` 再常驻跑一个 `opencode acp`”，会把运行模型描述得过于理想化，因为：

1. ACP 进程本身就自带内部 server 启动逻辑。
2. ACP 与外部独立 `serve` 进程之间不是天然共享同一个内部会话上下文。
3. 运行壳真正需要的是“ACP Bridge 管理 ACP 专用运行时”，而不是“无脑并排起两个完全独立且长期常驻的入口进程”。

因此更稳妥的口径应当是：

1. Worker 默认暴露一个长期存活的 `opencode serve` 服务面。
2. ACP 语义由 Bridge/Worker 侧的 ACP Runtime Manager 按需拉起、复用、回收 ACP 进程。
3. 是否常驻某个 ACP 进程，属于实现优化项，不应在设计文档里写死。

### 3.8 现有前端可复用点

1. [packages/app/src/context/server.tsx](/d:/开发工作/opencode/packages/app/src/context/server.tsx:1)
   已具备“连接多个 server endpoint”的客户端抽象，但它更像客户端保存多个连接配置，不是服务端多租户登录模型。

2. [packages/app/src/utils/server.ts](/d:/开发工作/opencode/packages/app/src/utils/server.ts:1)
   已具备用 SDK 连接远程 `opencode` server 的能力，可复用其 SDK 连接方式。

3. [packages/enterprise](/d:/开发工作/opencode/packages/enterprise/package.json:1)
   当前只是一个很轻的 SolidStart 工程，已有 API 路由、分享页、对象存储适配，适合拿来做运行壳前端/中台骨架，但不是现成多用户平台。

## 4. 目标架构

### 4.1 总体分层

建议拆成五层：

1. 接入层
   - 浏览器前端
   - SSO / OAuth2 / OIDC
   - API Gateway / Ingress

2. 平台层
   - 用户与组织管理
   - 会话控制
   - ACP Bridge
   - 审计与权限

3. 适配层
   - `opencode` HTTP SDK 适配
   - ACP Runtime Manager / ACP Bridge 适配
   - PTY/文件/MCP/分享能力适配

4. 执行层
   - `opencode serve`
   - ACP 专用运行时
   - 工作目录/worktree
   - 本地 SQLite/WAL

5. 存储与观测层
   - 元数据数据库
   - 对象存储
   - 日志、指标、链路追踪

### 4.2 推荐部署拓扑

```text
Browser
  -> runtime-shell-web
  -> runtime-shell-server
       -> metadata-db
       -> artifact-store
       -> opencode-worker-1
       -> opencode-worker-2
       -> ...

opencode-worker
  -> opencode serve (default HTTP API)
  -> ACP runtime manager
  -> opencode acp (managed subprocess, on-demand or pooled)
  -> local workspace / worktree / pty / sqlite
```

## 5. 运行壳模块设计

### 5.1 runtime-shell-server

这是核心服务，建议职责如下：

1. 多用户认证
   - 对接企业 SSO
   - 维护用户、组织、角色、会话

2. 业务会话控制
   - 创建业务会话 `business_session_id`
   - 绑定 `worker_id`
   - 绑定 `acp_session_id`
   - 控制会话状态机

3. ACP Bridge
   - 为每个业务会话维护一条到目标 Worker 上 ACP 运行时的通道
   - 将外部 HTTP/WebSocket 请求转成 ACP 调用
   - 将 ACP 事件流转成前端可消费事件

4. OpenCode HTTP 适配
   - 通过 SDK 或 HTTP API 调用 `session`、`workspace`、`file`、`pty`、`provider`、`mcp` 等能力
   - 弥补 ACP 不直接暴露的平台管理动作

5. 权限与审计
   - 统一封装 `requestPermission` 审批流
   - 保存审批结果、工具调用、关键输入输出摘要

6. 资源治理
   - Worker 注册与心跳
   - 粘性路由
   - 容量统计
   - 异常摘流

### 5.2 runtime-shell-web

前端控制台建议职责如下：

1. 用户登录
   - 登录页
   - SSO 回调页
   - 组织/项目切换

2. 会话工作台
   - 新建会话
   - 会话列表
   - 会话详情
   - fork 分支
   - resume 恢复
   - close 关闭

3. ACP 交互区
   - 聊天输入
   - 图片/文件输入
   - 流式消息展示
   - 思考片段展示
   - 计划展示
   - 可用命令展示

4. 工具与执行区
   - 工具执行列表
   - 工具状态更新
   - 权限请求弹层
   - 终端输出查看
   - 文件变更/diff 查看

5. 平台管理区
   - 用户与角色
   - Worker 健康状态
   - MCP 能力配置
   - 模型/模式配置
   - 审计日志

### 5.3 opencode-worker

每个 Worker 建议只承接一组有限的有状态会话。

它内部包含：

1. `opencode serve`
   - 提供 HTTP API
   - 提供 session/workspace/file/pty/provider 等访问面

2. ACP Runtime Manager
   - 负责按需拉起、维护、复用、回收 `opencode acp` 进程
   - 为运行壳提供 ACP 协议能力
   - 按业务会话维持 ACP session

3. 本地执行资源
   - 工作区目录
   - worktree
   - PTY 进程
   - SQLite
   - 日志与产物目录

## 6. ACP 能力映射设计

### 6.1 映射原则

运行壳要做的不是“重新发明 Agent 协议”，而是把 ACP 语义翻译成平台 API 和前端事件模型。

### 6.2 能力映射表

| ACP 能力 | 运行壳后端接口 | 前端能力 |
|---|---|---|
| `newSession` | `POST /api/session/create` + `POST /api/acp/session/open` | 新建会话 |
| `loadSession` | `POST /api/acp/session/load` | 打开历史会话 |
| `listSessions` | `GET /api/session/list` | 会话列表 |
| `resumeSession` | `POST /api/acp/session/resume` | 恢复会话 |
| `closeSession` | `POST /api/acp/session/close` | 关闭会话 |
| `unstable_forkSession` | `POST /api/acp/session/fork` | 分支会话 |
| `setSessionMode` | `POST /api/acp/session/mode/update` | 模式切换 |
| `unstable_setSessionModel` | `POST /api/acp/session/model/update` | 模型切换 |
| `setSessionConfigOption` | `POST /api/acp/session/config/update` | 配置项切换 |
| `session/prompt` | `POST /api/acp/session/input` | 发送消息/图片/上下文 |
| `requestPermission` | `POST /api/acp/session/permission/respond` | 审批弹窗 |
| `tool_call_update` | `GET/WS /api/acp/session/events` | 工具执行卡片 |
| `plan` | `GET/WS /api/acp/session/events` | 计划面板 |
| `agent_message_chunk` | `GET/WS /api/acp/session/events` | 流式回复 |
| `agent_thought_chunk` | `GET/WS /api/acp/session/events` | 思考流 |
| `available_commands_update` | `GET/WS /api/acp/session/events` | 可用命令栏 |
| `usage_update` | `GET/WS /api/acp/session/events` | token/成本显示 |

### 6.3 非 ACP 但平台必须补的能力

运行壳还需要补充 ACP 之外的平台能力：

1. 用户登录登出
2. 组织与项目隔离
3. Worker 选择与路由
4. 会话权限校验
5. 终端连接代理
6. 文件下载/分享
7. 审计查询
8. 配额与限流

## 7. 多用户登录设计

### 7.1 推荐方案

建议运行壳使用真正的平台身份系统，不复用 `opencode web` / `opencode serve` 的 Basic Auth。

推荐链路：

1. `runtime-shell-web` 通过 OIDC/OAuth2 登录企业身份源。
2. `runtime-shell-server` 验证 Token，签发平台自己的会话 Cookie 或 JWT。
3. 后续所有平台接口都走平台级身份。
4. `runtime-shell-server` 再以内网身份去调用 `opencode-worker`。

### 7.2 角色模型

建议最小角色集：

1. `admin`
   - 管理用户、模型、Worker、全局配置

2. `operator`
   - 查看 Worker、日志、审计
   - 处理部分权限审批

3. `developer`
   - 使用会话、工具、文件、终端

4. `viewer`
   - 查看共享会话与产物

### 7.3 会话隔离模型

建议平台侧维护这些核心字段：

1. `tenant_id`
2. `project_id`
3. `user_id`
4. `business_session_id`
5. `worker_id`
6. `acp_session_id`
7. `workspace_id`
8. `status`

所有查询与写入都必须先做平台级权限校验，再做数据范围校验。

## 8. Docker 联合部署设计

### 8.1 容器组成

建议 `docker-compose` 至少包含这些服务：

1. `runtime-shell-web`
2. `runtime-shell-server`
3. `opencode-worker`
4. `postgres` 或 `mysql`
5. `minio` 可选
6. `redis` 可选

第一版如果想压缩复杂度，可以先用：

1. `runtime-shell`
   - 同时承载前端与后端
2. `opencode-worker`
3. `postgres`

### 8.2 推荐启动关系

```text
runtime-shell depends_on:
  - postgres
  - opencode-worker

opencode-worker:
  - 启动 opencode serve
  - 由 shell-server 或 worker 内部 runtime manager 按需拉起/管理 acp 子进程
```

### 8.3 为什么不建议只用一个容器

因为下面几件事职责不同：

1. 平台登录与业务治理是平台层逻辑。
2. ACP session 与 PTY 是执行层逻辑。
3. `opencode` 当前是单实例有状态模型。

把它们全塞进一个容器虽然能跑，但后面很难扩 Worker，也难做粘性会话和审计隔离。

### 8.4 卷与目录建议

`opencode-worker` 需要挂载：

1. `/root/.local/share/opencode`
2. `/root/.config/opencode`
3. `/workspace/workspaces`
4. `/workspace/.opencode`

`runtime-shell` 需要挂载：

1. 平台日志目录
2. 可选上传缓存目录

### 8.5 环境变量建议

`opencode-worker`

1. `OPENCODE_SERVER_USERNAME`
2. `OPENCODE_SERVER_PASSWORD`
3. `OPENCODE_CONFIG_DIR`
4. `OPENCODE_DISABLE_MODELS_FETCH`

`runtime-shell-server`

1. `SHELL_JWT_SECRET`
2. `SHELL_DATABASE_URL`
3. `SHELL_OPENCODE_BASE_URL`
4. `SHELL_OPENCODE_USERNAME`
5. `SHELL_OPENCODE_PASSWORD`
6. `SHELL_OIDC_ISSUER`
7. `SHELL_OIDC_CLIENT_ID`
8. `SHELL_OIDC_CLIENT_SECRET`

### 8.6 健康检查建议

1. `runtime-shell-server`
   - `/healthz`
   - `/readyz`

2. `opencode-worker`
   - `GET /` 或专用健康检查接口
   - 可补充会话数、PTY 数、负载信息

## 9. 接口草案

遵循你仓库里的接口规范，优先只用 `GET` 和 `POST`。

### 9.1 平台接口

1. `POST /api/auth/login`
2. `POST /api/auth/logout`
3. `GET /api/auth/me`
4. `GET /api/session/list`
5. `POST /api/session/create`
6. `GET /api/session/detail`
7. `POST /api/session/close`
8. `GET /api/worker/list`
9. `GET /api/audit/list`

### 9.2 ACP Bridge 接口

1. `POST /api/acp/session/open`
2. `POST /api/acp/session/load`
3. `POST /api/acp/session/resume`
4. `POST /api/acp/session/fork`
5. `POST /api/acp/session/input`
6. `POST /api/acp/session/model/update`
7. `POST /api/acp/session/mode/update`
8. `POST /api/acp/session/config/update`
9. `POST /api/acp/session/permission/respond`
10. `GET /api/acp/session/events`

### 9.3 OpenCode 适配接口

1. `GET /api/opencode/session/messages`
2. `GET /api/opencode/session/diff`
3. `POST /api/opencode/session/command`
4. `POST /api/opencode/session/shell`
5. `POST /api/opencode/workspace/create`
6. `GET /api/opencode/file/read`
7. `POST /api/opencode/file/write`
8. `GET /api/opencode/provider/list`
9. `GET /api/opencode/model/list`

## 10. 前端页面规划

### 10.1 页面结构

1. 登录页
2. 首页/会话列表页
3. 会话工作台页
4. Worker 管理页
5. 审计页
6. 设置页

### 10.2 会话工作台布局

建议采用三栏布局：

1. 左栏
   - 会话列表
   - 分支树
   - 项目/workspace 切换

2. 中栏
   - 聊天消息流
   - 输入框
   - 图片/文件上传

3. 右栏
   - Plan
   - Tool Calls
   - Permission Requests
   - Diff
   - Usage

### 10.3 第一版必须支持的交互状态

1. loading
2. empty
3. error
4. streaming
5. permission pending
6. tool running
7. tool success
8. tool failed
9. worker disconnected

## 11. 技术选型建议

### 11.1 前端

建议基于 `packages/enterprise` 扩展，原因：

1. 已经是 SolidStart。
2. 已有 API 路由模式。
3. 已有分享页与对象存储适配经验。
4. 可以复用 `@opencode-ai/ui` 组件。

不建议直接在 `packages/app` 上做平台壳，因为 `packages/app` 更偏“连接某个 server 的应用客户端”，不是“平台控制台”。

### 11.2 后端

建议新建独立服务，可选两种路径：

1. 继续沿用 SolidStart server route + Hono
   - 适合和 `packages/enterprise` 一体化

2. 新建独立 Node/Bun 服务
   - 适合后续独立扩容

第一版为了成本低，建议走第一种。

### 11.3 数据库

建议平台侧使用 `PostgreSQL`。

原因：

1. `opencode` 本地 SQLite 适合 Worker 内部会话态。
2. 平台元数据需要多用户并发和稳定事务能力。
3. 用户、会话、审计、Worker 注册不适合继续放在 Worker 本地 SQLite。

## 12. 风险与约束

### 12.1 最大约束

最大约束不是 API 不够，而是状态强绑定：

1. ACP session 在进程内。
2. PTY 绑定本地子进程。
3. worktree 绑定本地目录。
4. 局部缓存绑定实例与目录。

因此第一版必须坚持粘性路由，不能做无状态负载均衡。

### 12.2 不要误写的点

1. 不要写成“ACP 当前原生支持 HTTP 服务化”。
2. 不要写成“`opencode web` 可以直接承担多用户登录平台”。
3. 不要写成“每个 Worker 只要常驻跑 `serve + acp` 两个独立入口就天然能共享一套会话上下文”。
4. 不要写成“Worker 可被任意机器透明接手”。
5. 不要承诺第一版支持跨机透明恢复。

### 12.3 安全风险

1. 终端执行带来的命令风险。
2. 文件读写带来的数据泄露风险。
3. MCP 外部连接带来的网络边界风险。
4. 模型/provider 凭据管理风险。
5. 多租户数据串读风险。

## 13. MVP 范围建议

第一版建议只做下面这些：

1. 平台登录
2. 会话创建/打开/关闭/恢复/分支
3. ACP 消息输入与事件流展示
4. Plan / Tool / Permission / Usage 展示
5. Worker 粘性路由
6. Docker 联合部署
7. 基础审计日志

第一版先不做：

1. 跨机透明恢复
2. 自动 Worker 迁移
3. 完整终端 Web IDE 化
4. 复杂 RBAC
5. 精细配额计费

## 14. 实施顺序建议

### 阶段一：打通最小闭环

1. 新建 `runtime-shell` 工程骨架。
2. 接入登录。
3. 打通平台到 `opencode-worker` 的 SDK 调用。
4. 打通平台到 ACP 子进程的 Bridge。
5. 完成会话工作台最小页。

### 阶段二：补全 ACP 全能力展示

1. 模型/模式切换
2. 可用命令展示
3. 权限请求处理
4. Tool Call 展示
5. Plan/Usage 展示

### 阶段三：部署与治理

1. Docker Compose
2. PostgreSQL
3. 日志与监控
4. Worker 管理页
5. 审计页

## 15. 最终建议

最推荐的落地路径是：

1. 以 `packages/enterprise` 为前后端壳基础。
2. 新增 `runtime-shell-server` 逻辑模块。
3. 把 `opencode` 保持为独立 Worker。
4. 用 Bridge 把 ACP 网络化。
5. 用平台身份系统实现多用户登录。

这样做的好处是：

1. 不需要重写 `opencode` 的执行内核。
2. 不会破坏 ACP 当前能力。
3. 可以逐步扩展成多 Worker 平台。
4. Docker 部署模型清晰。

如果继续推进下一步，最值得先做的是一份更细的实施稿，拆成：

1. 表结构设计
2. API 详细定义
3. 事件模型定义
4. Docker Compose 草案
5. 前端页面原型
