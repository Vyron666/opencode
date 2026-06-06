# runtime-shell 企业级沙箱实施计划

## 1. 实施目标

本文基于 `docs/runtime-shell-enterprise-sandbox-design.md` 拆解落地计划，目标是在尽量不修改 `packages/opencode` 原代码的前提下，把 `runtime-shell` 的 agent 执行面升级为企业级、安全可控、可横向扩展的沙箱运行平台。

本文默认接受以下前提：

1. 最终目标方案是 `Stateful Session + Ephemeral Sandbox`。
2. Docker/Podman 只是过渡执行后端，用于验证 `SandboxManager` 和隔离边界。
3. 最终生产方案是 `Kubernetes + Worker Pool + gVisor/Kata`，而不是长期“每会话一个常驻 Docker 容器”。

### 1.1 方案选型结论

1. 推荐方案主结论：本实施计划服务于 `Stateful Session + Ephemeral Sandbox` 目标架构，而不是服务于“每个对话长期运行一个 Docker sandbox”。
2. 开发/验证：使用 Docker/Podman 跑通独立沙箱、资源限制、挂载边界和 ACP 生命周期。
3. 企业生产：收敛到 `Kubernetes + Worker Pool + gVisor/Kata`，由平台负责调度、隔离与故障恢复。
4. 大规模治理：补齐 `queue + quota + warm pool + lease/rebind`，把执行面从“朴素一会话一容器”推进到“持久化 session + 临时执行 sandbox”。

### 1.2 当前已完成状态（2026-06-02）

当前已经完成并验证了 Docker/Podman 过渡沙箱后端，但它仍然只是开发/验证阶段的执行方案，不是最终企业生产执行模型。

已完成并验证：

1. `SandboxManager` 抽象和 Docker 后端已经接入 `worker-agent`。
2. ACP 已经在独立 sandbox 容器中运行，主链路 `initialize`、`newSession`、`prompt`、`close` 已跑通。
3. Docker 后端当前通过 sandbox 容器内 `bun` TCP bridge 承接 ACP stdin/stdout，而不是依赖交互式 `docker exec -i`。
4. 当前基础隔离约束已经落地：非 root、只读 rootfs、`cap_drop=ALL`、`no-new-privileges`、独立 tmpfs runtime home、CPU/内存/pids 限制。
5. 当前挂载边界已经收敛到当前 session workspace，并避免向 sandbox 暴露平台服务代码和 Docker socket。
6. 当前已验证命令包括 `bun run e2e:smoke`、`bun run typecheck`、`bun run typecheck:scripts`、`docker compose -f docker-compose.yml config --quiet`。

仍待完成：

1. workspace 还没有切到企业默认的 `copy workspace + diff 回写`。
2. 还没有补齐 `queue + quota + warm pool + lease/rebind` 的大规模治理。
3. 还没有切换到 `Kubernetes + gVisor/Kata` 的最终生产执行面。

核心目标：

1. `runtime-shell server` 不直接执行 agent shell 或 ACP 子进程。
2. worker-agent 不再直接在自身容器内 `spawn` ACP，而是通过 `SandboxManager` 创建独立沙箱。
3. agent 默认只能看到当前 session 的 workspace 视图和必要只读配置。
4. 平台代码默认不可见或只读，避免 agent 误改服务代码。
5. 支持大用户量下的 worker 池、预热池、队列、配额、故障恢复和观测。
6. 保留现有 ACP 协议、`ManagedRuntimeClient`、`RemoteRuntimeClient`、session event 流和 runtime governance 体系。

非目标：

1. 不重写 `packages/opencode`。
2. 不一次性引入 Kubernetes 专属实现，先保证 Docker/Podman 后端可落地，再保留 gVisor/Kata 扩展点。
3. 不在实施第一阶段引入复杂策略 DSL，先使用明确的配置项和白名单/黑名单表。
4. 不改变当前用户侧 session/prompt 基本交互语义。

## 2. 总体实施原则

1. 优先改 `runtime-shell`，尽量不改 `packages/opencode`。
2. 改造入口优先放在 `runtime-shell/server/src/worker-agent` 和 `runtime-shell/server/src/acp`，因为现有远端执行链路已经通过 worker-agent 转发。
3. 保持小步可验证，每个阶段都必须能 `bun run typecheck` 并至少有一条 e2e 或脚本验证主链路。
4. 所有新增数据库迁移必须同时提供 MySQL 和 PostgreSQL 版本。
5. 所有新增接口只使用 GET/POST，写操作使用动作后缀。
6. 关键安全边界必须写中文/English 注释。
7. 生产安全默认值必须偏保守；开发环境可通过显式配置开启 direct 或低隔离模式。

## 3. 现有代码接入点

优先复用以下现有模块：

1. `runtime-shell/server/src/runtime/runtime-client.ts`
   `ManagedRuntimeClient` 已定义 runtime 生命周期接口，不需要改 ACP 协议。

2. `runtime-shell/server/src/runtime/remote-runtime-client.ts`
   已将 runtime 生命周期请求转发给 worker-agent，是控制面和执行面的主要分界。

3. `runtime-shell/server/src/worker-agent/worker-agent-runtime.ts`
   现有 worker-agent API 可继续保持，内部从直接创建 ACP 进程改为创建沙箱。

4. `runtime-shell/server/src/worker-agent/worker-agent-runtime-support.ts`
   当前 `createRuntimeEntry` 直接创建 `AcpProcessClient`，这是接入 `SandboxManager` 的核心点。

5. `runtime-shell/server/src/acp/process-spawn.ts`
   当前 `spawnAcpProcess` 直接 `spawn(process.execPath, args)`，后续应抽象为可注入 process adapter。

6. `runtime-shell/server/src/services/scheduler/scheduler-service.ts`
   当前按 active session 调度 worker，后续升级为资源向量调度。

7. `runtime-shell/server/src/services/runtime-governance/*`
   现有 binding、lease、failure、recovery 逻辑可扩展到 sandbox 生命周期。

8. `runtime-shell/server/src/db/migrations/*`
   新增 sandbox、queue、quota、diff、resource heartbeat 迁移。

## 4. 阶段总览

建议实施顺序：

1. Phase 0：准备与基线确认。
2. Phase 1：沙箱抽象和进程适配。
3. Phase 2：Docker/Podman 过渡沙箱后端。
4. Phase 3：只读配置和平台代码隔离。
5. Phase 4：workspace overlay/diff 回写。
6. Phase 5：队列、配额、资源容量和预热池。
7. Phase 6：审计、策略和观测。
8. Phase 7：gVisor/Kata 生产加固与压测。

每个阶段都要保持主链路可运行，不能把系统长期停在半接入状态。

说明：

本实施计划中的 `Phase 0-7` 是对设计文档中 `高层 Phase 1-4` 的细化拆分，用于落地执行、排期和拆 PR。两份文档的阶段编号粒度不同，但目标一致，不构成冲突。
其中 Phase 1-2 主要用于跑通过渡执行后端，Phase 5-7 才逐步收敛到面向企业规模和消费端规模的目标方案。

### 4.1 实际执行优先级

进入并发与性能治理阶段后，实施顺序固定为：

1. 真正 warm runtime 复用。
2. 提高 warm runtime 命中容量。
3. 去掉 cold path `migration/init` 成本。
4. workspace 复制优化。
5. plugin/provider 瘦身。
6. 冷启动全局限速。

这个顺序的含义是：先消除运行时启动链路上的真实冷启动根因，再扩大命中率、缩短 cold path，最后才做全局背压；不能把限速、补池或兜底回收当成首要性能修复。

当前进展补充（2026-06-05）：

1. `真正 warm runtime 复用` 已接通主链路：
   warm slot 长驻 `AcpProcessClient`；业务会话租用时优先走 `newSession/loadSession/resumeSession`；归还时只 `closeSession`，不销毁 ACP 进程。
2. `提高 warm runtime 命中容量` 已完成第一轮闭环：
   `warmPoolTarget=3`、按配置指纹分池、ready slot 回填、generic slot 物化已落地；并额外限制只在当前 ready 预算内做 runtime 物化，避免补池自身放大冷启动压力。
3. `去掉 cold path migration/init 成本` 已完成第一轮：
   runtime-home seed 与 fork snapshot 复用已落地，ACP 默认模型目录切到精简版 `models-api.runtime.json`，并补上 `initialize/newSession/loadSession/resumeSession` 阶段耗时观测。
4. `workspace 复制优化` 已完成第一轮：
   新建空工作区首开支持跳过首次全量复制；warm slot prepare/back-sync 会跳过空目录无效复制；workspace copy 已纳入全局冷启动门控。
5. `plugin/provider 瘦身` 已完成第一轮：
   冷路径默认只挂载运行时必需的 builtin config + slim model catalog；用户 provider / mcp / skill 继续通过会话级 `configContent` 注入，不扩大共享边界。
6. `冷启动全局限速` 已完成第一轮：
   workspace copy、runtime-home prepare、warm slot create、cold container boot 已共享同一冷启动并发预算；目标是让高并发表现为受控等待，而不是资源失控。
7. 上述 2-6 项目前都属于“代码已落地、仍需镜像重建和 10/20 并发复测确认”的状态，不能直接视为最终验收完成。

### 4.2 语义守护项

所有阶段必须同时满足以下约束：

1. `provider` 隔离：
   `admin` 共享仍然全员可见；用户私有仍然只自己可见；不同 `workspace/session` 继续复用同一份用户设置，不会串用户。
2. `mcp` 隔离：
   用户私有 MCP 配置只对本人会话生效；共享配置的可见范围不扩大；warm runtime 复用不会把前一个用户的 MCP 状态带到下一个用户。
3. `skill` 隔离：
   用户私有 skill、共享 skill、启用状态、能力面继续按当前权限模型生效，不能因为 runtime 常驻而串会话、串用户。
4. 会话与工作区语义：
   仍然保持“一个沙箱对应一个 workspace，不是一个 session 一个沙箱”；`orphaned -> reopen -> active`、关闭、回收、恢复链路不能退化。
5. 配置指纹边界：
   warm runtime 必须按配置指纹分池，不能把不同 `provider/mcp/skill` 配置的 runtime 混租。
6. 验证纪律：
   设置专项、恢复专项、并发压测必须顺序隔离执行，不能并行抢同一批 worker / warm slot / provider 初始化资源。

## 5. Phase 0：准备与基线确认

### 5.1 目标

确认当前 runtime-shell 主链路行为、测试命令、Docker compose 形态和基线指标，避免沙箱改造后无法判断是否回归。

### 5.2 任务

1. 梳理当前远端 worker 模式启动方式：
   `runtime-shell/docker-compose.yml`、`runtime-shell/server/src/worker-agent/start-worker.sh`。

2. 记录当前主链路：
   session create、open、prompt、cancel、close、worker offline、orphaned recovery。

3. 建立验证脚本清单：
   `bun run typecheck`
   `bun run e2e:smoke`
   `bun run e2e:worker-routing`
   `bun run e2e:governance`
   `bun run e2e:concurrency`

4. 记录当前风险基线：
   agent 是否能看到 `/workspace/packages`
   agent 是否能写 `/workspace/packages`
   agent 是否能直接写真实 workspace
   agent 是否能读取 `.opencode`

### 5.3 涉及文件

只读为主：

```text
runtime-shell/docker-compose.yml
runtime-shell/server/src/worker-agent/start-worker.sh
runtime-shell/server/src/worker-agent/*
runtime-shell/server/src/runtime/*
runtime-shell/server/src/services/runtime-governance/*
runtime-shell/package.json
```

### 5.4 验收标准

1. 当前主链路测试命令可运行或已记录失败原因。
2. 当前执行环境风险点已记录。
3. 后续阶段的回归对照清楚。

### 5.5 回滚策略

Phase 0 不改业务代码，无需回滚。

## 6. Phase 1：沙箱抽象和进程适配

### 6.1 目标

在 worker-agent 内引入 `SandboxManager` 抽象，但第一步可使用 `local-process` 后端保持原行为。这样先完成接口解耦，再切换 Docker 后端，降低一次性改动风险。

### 6.2 任务

1. 新增 worker-agent 沙箱目录：

```text
runtime-shell/server/src/worker-agent/sandbox/
  sandbox-manager.ts
  local-process-sandbox-manager.ts
  sandbox-process-adapter.ts
  sandbox-types.ts
```

2. 定义 `SandboxManager`：

```ts
export type SandboxManager = {
  prepare: (input: SandboxPrepareInput) => Promise<SandboxHandle>
  attachAcp: (input: SandboxAttachInput) => Promise<SandboxAcpProcess>
  close: (input: SandboxCloseInput) => Promise<void>
}
```

3. `SandboxAcpProcess` 对齐现有 `ChildProcessWithoutNullStreams` 需要的最小能力：
   `stdin`、`stdout`、`stderr`、`once("exit")`、`kill()`。

4. 改造 `AcpProcessClient` 或新增构造参数，让它可以接收外部 process factory。

5. 改造 `createRuntimeEntry`：
   先 `sandboxManager.prepare()`，再 `sandboxManager.attachAcp()`，最后创建 ACP client。

6. `local-process` 后端内部仍复用现有 `spawnAcpProcess`，保证行为不变。

### 6.3 涉及文件

新增：

```text
runtime-shell/server/src/worker-agent/sandbox/sandbox-manager.ts
runtime-shell/server/src/worker-agent/sandbox/local-process-sandbox-manager.ts
runtime-shell/server/src/worker-agent/sandbox/sandbox-process-adapter.ts
runtime-shell/server/src/worker-agent/sandbox/sandbox-types.ts
```

修改：

```text
runtime-shell/server/src/worker-agent/worker-agent-runtime-support.ts
runtime-shell/server/src/acp/acp-process-client.ts
runtime-shell/server/src/acp/process-spawn.ts
runtime-shell/server/src/config.ts
```

### 6.4 配置项

```text
RUNTIME_SHELL_SANDBOX_BACKEND=local-process
```

### 6.5 验收标准

1. 默认 `local-process` 后端下，session open/prompt/cancel/close 行为与现有一致。
2. `RemoteRuntimeClient` 和 worker-agent HTTP API 不变。
3. `packages/opencode` 无修改。
4. `bun run typecheck` 通过。

### 6.6 测试建议

在 `runtime-shell/` 目录执行：

```bash
bun run typecheck
bun run e2e:smoke
bun run e2e:worker-routing
```

### 6.7 回滚策略

保留 `local-process` 后端作为显式兼容模式。如果沙箱后端异常，可配置回 `RUNTIME_SHELL_SANDBOX_BACKEND=local-process`，但生产环境不得长期使用该模式。

## 7. Phase 2：Docker/Podman 过渡沙箱后端

### 7.1 目标

实现首个真实沙箱后端，让 ACP 在独立容器中运行，而不是在 worker-agent 容器内直接运行。
注意：本阶段的 Docker/Podman 只是开发/验证阶段的过渡执行后端，不是最终执行模型，也不是最终大规模生产方案。

### 7.2 任务

1. 新增 Docker 后端：

```text
runtime-shell/server/src/worker-agent/sandbox/docker-sandbox-manager.ts
runtime-shell/server/src/worker-agent/sandbox/docker-command.ts
runtime-shell/server/src/worker-agent/sandbox/sandbox-container-names.ts
```

2. 新增 agent runtime 镜像：

```text
runtime-shell/agent-runtime.Dockerfile
```

3. 镜像内只包含运行 `opencode acp` 所需内容，不复制 `runtime-shell/server` 源码。

4. 容器启动约束：
   非 root、只读 rootfs、drop capabilities、no-new-privileges、独立 tmpfs、CPU/内存/pids 限制。

5. `attachAcp()` 使用 sandbox 容器内 `bun` TCP bridge 接入 ACP stdin/stdout，避免依赖不稳定的交互式 `docker exec` 链路。

6. `close()` 确保停止并删除对应容器。

7. worker-agent 启动时检测 Docker/Podman 可用性，并在不可用时明确报错。

### 7.3 涉及文件

新增：

```text
runtime-shell/agent-runtime.Dockerfile
runtime-shell/server/src/worker-agent/sandbox/docker-sandbox-manager.ts
runtime-shell/server/src/worker-agent/sandbox/docker-command.ts
runtime-shell/server/src/worker-agent/sandbox/sandbox-container-names.ts
```

修改：

```text
runtime-shell/docker-compose.yml
runtime-shell/server/src/config.ts
runtime-shell/server/src/worker-agent/sandbox/sandbox-manager.ts
```

### 7.4 配置项

```text
RUNTIME_SHELL_SANDBOX_BACKEND=docker
RUNTIME_SHELL_SANDBOX_IMAGE=opencode-agent-runtime:local
RUNTIME_SHELL_SANDBOX_RUNTIME=
RUNTIME_SHELL_SANDBOX_CPU=2
RUNTIME_SHELL_SANDBOX_MEMORY=4096m
RUNTIME_SHELL_SANDBOX_PIDS_LIMIT=512
```

### 7.5 验收标准

1. ACP 进程运行在独立 sandbox 容器中。
2. worker-agent 容器内没有直接运行 session ACP 子进程。
3. agent 无法写入 worker-agent 或 runtime-shell server 源码。
4. `packages/opencode` 无修改。
5. session 主链路功能不变。

### 7.6 测试建议

```bash
bun run typecheck
bun run docker:up
bun run e2e:smoke
bun run e2e:worker-routing
```

额外手工验证：

1. 在 agent 中尝试写 `/workspace/packages`，应失败或不可见。
2. 在 agent 中查看 runtime-shell server 路径，应不可见。
3. `docker ps` 可看到 session sandbox 容器生命周期。

### 7.7 回滚策略

1. 配置切回 `RUNTIME_SHELL_SANDBOX_BACKEND=local-process`。
2. 保留 Docker 后端代码但不启用。
3. 旧 compose worker 可继续启动。

## 8. Phase 3：只读配置和平台代码隔离

### 8.1 目标

收紧 sandbox mount，确保 agent 只拿到必要配置和 workspace，不能看到或写入平台服务代码。

### 8.2 任务

1. 拆分 `.opencode` 注入：
   skills、MCP、provider 配置按需注入，默认只读。

2. 生成 session-scoped config：
   继续使用 `OPENCODE_CONFIG_CONTENT`，但避免长期密钥直接进入 sandbox。

3. 新增 sandbox mount 规划：

```text
/workspace/current        可写 workspace 视图
/workspace/.opencode      只读必要配置
/tmp                      session tmpfs
/cache                    session cache volume
```

4. 禁止 sandbox 挂载：

```text
/workspace/packages
/app
/root/.local/share/opencode 的平台共享数据
Docker socket
宿主项目根目录
```

5. 调整 `runtime-shell/docker-compose.yml`，避免 worker 容器把非必要宿主路径传给 sandbox。

### 8.3 涉及文件

```text
runtime-shell/server/src/services/configuration/configuration-service.ts
runtime-shell/server/src/worker-agent/sandbox/docker-sandbox-manager.ts
runtime-shell/server/src/worker-agent/sandbox/sandbox-workspace.ts
runtime-shell/docker-compose.yml
runtime-shell/agent-runtime.Dockerfile
```

### 8.4 验收标准

1. sandbox 内只能看到当前 workspace 和必要配置。
2. `.opencode` 为只读，或配置通过 env 注入。
3. 长期 provider key 不直接进入 sandbox 日志或文件。
4. agent 无法访问 Docker socket。

### 8.5 回滚策略

保留旧 mount 配置模板，但生产环境不允许启用。回滚只允许回到 Phase 2 的独立容器，不回到服务容器内执行。

## 9. Phase 4：workspace overlay 与 diff 回写

### 9.1 目标

让 agent 默认不直接写真实 workspace。Phase 4 第一版以 `copy workspace + diff 回写` 为准，所有修改先进入 sandbox 工作层，再由 diff 审核回写；Linux 生产环境后续可再升级为真正 overlayfs。

### 9.2 任务

1. Phase 4A：新增 workspace 工作层管理，第一版使用 session copy：

```text
runtime-shell/server/src/worker-agent/sandbox/sandbox-workspace.ts
runtime-shell/server/src/services/sandbox/sandbox-diff-service.ts
```

要求：

1. 在受控 scratch 目录下创建 `session copy workspace`。
2. sandbox 只挂载 session copy 为可写目录。
3. 真实 workspace 不再直接以可写方式挂载到 sandbox。
4. session close 后 session copy 按 TTL 回收。

2. Phase 4B：新增 `sandbox_diff` 表和 repo：

```text
runtime-shell/server/src/repos/sandbox-diff-repo.ts
runtime-shell/server/src/db/migrations/0009_sandbox.postgres.sql
runtime-shell/server/src/db/migrations/0009_sandbox.mysql.sql
```

建议字段至少包含：

1. `id`
2. `tenant_id`、`organization_id`、`project_id`、`workspace_id`
3. `business_session_id`、`sandbox_id`
4. `workspace_mode`
5. `status`
6. `summary_json`
7. `artifact_uri`
8. `policy_result_json`
9. `idempotency_key`
10. `expires_at`
11. `created_at`、`applied_at`、`rejected_at`

3. Phase 4C：新增 diff API：

```text
POST /api/session/:id/diff/create
POST /api/session/:id/diff/apply
POST /api/session/:id/diff/reject
GET  /api/session/:id/diff
```

要求：

1. `create` 负责生成 diff 摘要、artifact 和策略检查结果。
2. `apply` 负责幂等回写真实 workspace。
3. `reject` 负责标记拒绝并保留审计链路。
4. `GET` 返回当前 session 最近一次或指定 diff 的摘要与状态。

4. Phase 4D：实现 diff 策略检查与回写策略：

1. 拒绝路径越界、符号链接逃逸、workspace 外写入。
2. 默认阻断 `.env`、私钥、平台配置、部署配置、密钥目录。
3. 大规模删除、批量重命名、二进制大文件默认进入人工确认。
4. `apply` 必须基于 `diff_id + idempotency_key` 幂等。
5. `apply` 失败后状态必须可恢复、可重试、可审计。

5. Phase 4E：补齐 E2E 与清理逻辑。

### 9.3 涉及文件

新增：

```text
runtime-shell/server/src/services/sandbox/sandbox-diff-service.ts
runtime-shell/server/src/services/sandbox/sandbox-policy-service.ts
runtime-shell/server/src/repos/sandbox-diff-repo.ts
runtime-shell/server/src/http/routes/sandbox-diff-routes.ts
runtime-shell/server/src/db/migrations/0009_sandbox.postgres.sql
runtime-shell/server/src/db/migrations/0009_sandbox.mysql.sql
runtime-shell/scripts/e2e-sandbox-diff.ts
```

修改：

```text
runtime-shell/server/src/http/routes/session-routes.ts
runtime-shell/server/src/types.ts
runtime-shell/server/src/worker-agent/sandbox/docker-sandbox-manager.ts
runtime-shell/server/src/config.ts
```

### 9.4 验收标准

1. agent 修改文件不会立即影响真实 workspace。
2. session copy 中的修改能稳定生成 diff 摘要。
3. diff apply 后真实 workspace 才变化。
4. 敏感路径和大规模删除默认阻断或进入人工确认。
5. apply 重试不会重复应用或产生脏状态。
6. session close 或 worker 异常退出后，未处理 diff 和 session copy 状态可恢复或可清理。

### 9.5 测试建议

新增脚本：

```text
runtime-shell/scripts/e2e-sandbox-diff.ts
```

验证：

1. 创建文件、修改文件、删除文件都只发生在 session copy。
2. `diff/create` 能生成文件摘要、删除摘要和策略结果。
3. 敏感文件阻断。
4. `diff/apply` 幂等。
5. worker 异常退出后 diff 状态正确。
6. session close 后 session copy 按 TTL 清理。

### 9.6 回滚策略

1. 可通过配置临时切换 `RUNTIME_SHELL_SANDBOX_WORKSPACE_MODE=direct`，但仅限开发或紧急诊断。
2. 生产回滚时保留 sandbox 容器隔离，不回滚到直接服务容器执行。

## 10. Phase 5：队列、配额、资源容量和预热池

### 10.1 目标

让系统在大用户量下可控运行，避免高并发 open/prompt 直接打爆 worker，并把执行模式从“朴素一会话一容器”推进到“持久化 session + 临时执行 sandbox”的目标模型。

### 10.2 任务

1. 新增队列表：

```text
runtime_operation_queue
```

2. 新增 quota 表：

```text
quota_policy
```

3. 新增 sandbox instance 表：

```text
sandbox_instance
```

4. 扩展 worker heartbeat：
   running sandbox、warm sandbox、queue length、CPU、内存、磁盘、镜像版本。

5. 改造 `selectWorkerForNewSession`：
   从 active session 数调度升级为资源评分调度。

6. worker-agent 实现 warm pool：
   预拉镜像、预建空闲 sandbox、高低水位维护、空闲回收。

7. open/load/resume/fork/prompt/diff commit 进入队列或受队列保护。

在 Phase 5 内，具体实施顺序与验证要求如下：

1. 先做真正 warm runtime 复用。
   目标：warm slot 长驻 `AcpProcessClient`；业务会话租用时只执行 `newSession/loadSession/resumeSession`；归还时只 `closeSession`，不销毁运行时。
   验证：`provider/mcp/skill` 不串用户、不串配置；`orphaned -> reopen -> active`、关闭、回收、恢复链路不回退。
2. 再提高 warm runtime 命中容量。
   目标：扩容命中率，但继续按配置指纹分池，并维持 worker 负载分布合理。
   验证：不同配置不会混用，不会因为扩容把请求长期热点倾斜到单一 worker。
3. 再去掉 cold path `migration/init` 成本。
   目标：缩短未命中 warm runtime 时的首启耗时。
   验证：不影响自定义 `provider/model` 生效，不影响“前端统一配置一次 -> 不同 workspace/session 直接使用”。
4. 再做 workspace 复制优化。
   目标：降低大仓库复制与回写成本。
   验证：`diff`、关闭回写、`reopen` 语义保持不变。
5. 再做 plugin/provider 瘦身。
   目标：减少首启链路中非必要初始化负担。
   验证：能力面不缺失，权限与可见性不回退。
6. 最后做冷启动全局限速。
   目标：为 workspace 复制、容器启动、ACP 启动提供受控背压。
   验证：高并发下表现为受控等待，而不是资源失控；业务语义、绑定、租约和恢复逻辑不改变。

### 10.3 涉及文件

新增：

```text
runtime-shell/server/src/services/sandbox/sandbox-quota-service.ts
runtime-shell/server/src/services/sandbox/sandbox-queue-service.ts
runtime-shell/server/src/services/sandbox/sandbox-observe-service.ts
runtime-shell/server/src/repos/sandbox-instance-repo.ts
runtime-shell/server/src/repos/runtime-operation-queue-repo.ts
runtime-shell/server/src/repos/quota-policy-repo.ts
runtime-shell/server/src/db/migrations/0010_sandbox_capacity.postgres.sql
runtime-shell/server/src/db/migrations/0010_sandbox_capacity.mysql.sql
```

修改：

```text
runtime-shell/server/src/services/scheduler/scheduler-service.ts
runtime-shell/server/src/services/worker/local-worker-heartbeat-loop.ts
runtime-shell/server/src/services/worker/worker-service.ts
runtime-shell/server/src/repos/worker-heartbeat-repo.ts
runtime-shell/server/src/types.ts
runtime-shell/server/src/worker-agent/index.ts
```

### 10.4 验收标准

1. 并发 open session 超出容量时进入队列或返回明确限流错误。
2. 单租户、单用户、单项目配额生效。
3. warm sandbox 能显著降低 P95 open latency。
4. worker offline 后 running sandbox 状态正确标记。
5. 管理员可查询 worker、sandbox、queue、quota 状态。

### 10.5 测试建议

新增：

```text
runtime-shell/scripts/e2e-sandbox-capacity.ts
runtime-shell/scripts/e2e-sandbox-warm-pool.ts
runtime-shell/scripts/e2e-sandbox-quota.ts
```

执行：

```bash
bun run typecheck
bun run e2e:concurrency
bun run e2e:governance
```

### 10.6 回滚策略

1. 保留队列 bypass 配置用于紧急诊断，但生产默认关闭。
2. quota 策略失败时默认拒绝新运行任务，不影响已运行 session。
3. warm pool 可单独关闭，不影响 Docker sandbox 基本运行。

## 11. Phase 6：审计、策略和观测

### 11.1 目标

补齐企业级审计、策略命中记录、指标、日志和 trace。

### 11.2 任务

1. 审计 DB 化：
   当前 `StoreAuditService` 仍主要通过 JSON store 写审计，目标是迁移到 DB repo。

2. 增加审计 action：
   `sandbox.create`、`sandbox.close`、`sandbox.exit`、`shell.execute`、`file.diff.generated`、`file.diff.applied`、`policy.denied`。

3. 增加策略服务：
   shell 命令策略、文件策略、网络策略、MCP 策略、diff 策略。

4. 增加观测接口：

```text
GET /api/system/sandboxes
GET /api/system/queues
GET /api/system/quotas
GET /api/system/runtime/failures
```

5. 接入 requestId/traceId 透传。

6. 敏感字段脱敏：
   token、provider key、private key、password、authorization header。

### 11.3 涉及文件

新增：

```text
runtime-shell/server/src/services/sandbox/sandbox-policy-service.ts
runtime-shell/server/src/services/system/sandbox-observe-query-service.ts
runtime-shell/server/src/repos/audit-db-repo.ts
runtime-shell/server/src/http/routes/sandbox-system-routes.ts
```

修改：

```text
runtime-shell/server/src/services/store/store-audit-service.ts
runtime-shell/server/src/http/routes/system-routes.ts
runtime-shell/server/src/types.ts
runtime-shell/server/src/log.ts
```

### 11.4 验收标准

1. 沙箱生命周期事件可审计。
2. diff apply/reject 可审计。
3. 策略拒绝可审计。
4. 管理员能查看 sandbox、queue、quota、worker 状态。
5. 日志不输出敏感明文。

### 11.5 回滚策略

审计 DB 写入失败不得阻塞主链路，但必须进入补偿队列或 failure log。策略服务异常时，生产默认拒绝高风险写操作。

## 12. Phase 7：gVisor/Kata 加固与压测

### 12.1 目标

把前期验证过的沙箱抽象演进到生产安全边界，并完成容量压测和故障演练，最终收敛到 `Kubernetes + Worker Pool + gVisor/Kata`。Docker/Podman 在这里不再被视为最终执行模型，而只是前序验证阶段的过渡实现。

### 12.2 任务

1. 支持 Docker runtime 参数：

```text
RUNTIME_SHELL_SANDBOX_RUNTIME=runsc
```

2. 支持 Kubernetes runtimeClass：

```text
gvisor
kata
```

3. 增加生产部署模板：

```text
runtime-shell/deploy/k8s/
```

4. 压测场景：
   多租户并发 open、长 prompt、worker offline、sandbox OOM、diff 大文件、队列堆积。

5. 安全验证：
   逃逸路径、Docker socket、宿主路径、平台代码、密钥文件、网络白名单。

### 12.3 涉及文件

新增：

```text
runtime-shell/deploy/k8s/runtime-shell.yaml
runtime-shell/deploy/k8s/worker-agent.yaml
runtime-shell/deploy/k8s/sandbox-runtimeclass.yaml
runtime-shell/scripts/bench-sandbox-capacity.ts
runtime-shell/scripts/e2e-sandbox-security.ts
```

修改：

```text
runtime-shell/server/src/worker-agent/sandbox/docker-sandbox-manager.ts
runtime-shell/server/src/config.ts
runtime-shell/README.md 或 runtime-shell/ARCHITECTURE.md
```

### 12.4 验收标准

1. gVisor/Kata 模式下主链路可用。
2. warm sandbox P95 open latency 小于 3 秒。
3. cold sandbox P95 start latency 小于 15 秒。
4. worker offline 后 session 正确 orphaned/rebind。
5. agent 无法访问平台代码、Docker socket、宿主敏感路径。
6. 安全策略命中有审计记录。

### 12.5 回滚策略

1. runtimeClass 可从 Kata 回滚到 gVisor，或从 gVisor 回滚到普通 Docker。
2. 回滚不得关闭 sandbox 独立容器边界。
3. 如果队列异常，可暂停新 session open，保留已运行 session。

## 13. 数据库迁移计划

建议迁移编号：

```text
0009_sandbox.postgres.sql
0009_sandbox.mysql.sql
0010_sandbox_capacity.postgres.sql
0010_sandbox_capacity.mysql.sql
0011_audit_db.postgres.sql
0011_audit_db.mysql.sql
```

表职责：

1. `sandbox_instance`：记录沙箱生命周期、worker、runtimeKey、容器 ID、资源、状态。
2. `sandbox_diff`：记录 diff 摘要、artifact 地址、apply/reject 状态。
3. `runtime_operation_queue`：记录 open/prompt/diff 等异步任务。
4. `quota_policy`：记录租户/项目/用户配额。
5. `audit_log` DB 化：统一审计落库。

注意事项：

1. MySQL 和 PostgreSQL 迁移必须同时提交。
2. 所有表必须包含租户边界字段。
3. 高频查询必须建索引。
4. 幂等字段必须有唯一约束。
5. 不允许运行时自动修表。

## 14. 接口计划

新增或扩展接口必须遵循 GET/POST：

```text
GET  /api/system/sandboxes
GET  /api/system/queues
GET  /api/system/quotas
POST /api/system/quotas/update
POST /api/session/:id/diff/create
GET  /api/session/:id/diff
POST /api/session/:id/diff/apply
POST /api/session/:id/diff/reject
POST /api/system/sandbox/:id/close
```

权限：

1. `/api/system/*` 默认仅 admin。
2. session diff 查询和应用必须经过 session action 授权。
3. workspace share 用户默认不能 apply diff，除非后续产品明确授权。

## 15. 测试计划

### 15.1 单元和类型检查

```bash
bun run typecheck
```

重点覆盖：

1. sandbox manager 类型。
2. quota policy 计算。
3. worker score 计算。
4. diff 策略检查。
5. audit 脱敏。

### 15.2 E2E

新增脚本：

```text
runtime-shell/scripts/e2e-sandbox-basic.ts
runtime-shell/scripts/e2e-sandbox-diff.ts
runtime-shell/scripts/e2e-sandbox-quota.ts
runtime-shell/scripts/e2e-sandbox-security.ts
runtime-shell/scripts/e2e-sandbox-warm-pool.ts
```

覆盖：

1. 创建 session 并打开 sandbox。
2. prompt 后生成文件变更。
3. diff apply 后真实 workspace 变化。
4. 敏感文件阻断。
5. 容量超限进入队列或拒绝。
6. worker offline 后恢复。

### 15.3 压测

新增：

```text
runtime-shell/scripts/bench-sandbox-capacity.ts
```

指标：

1. warm open P95。
2. cold open P95。
3. prompt 并发 P95。
4. queue wait P95。
5. worker CPU/内存/磁盘。
6. sandbox OOM 后恢复时间。

## 16. 风险清单

1. Docker socket 风险：
   worker-agent 如需控制 Docker，必须限制部署环境；生产优先使用 Kubernetes API 或 rootless Podman，不把 Docker socket 暴露给 sandbox。

2. overlay/diff 复杂度：
   Windows、本地 Docker、Linux overlayfs 行为不同。第一版应先实现 copy workspace 模式，再升级 overlay。

3. 密钥泄漏：
   `OPENCODE_CONFIG_CONTENT` 可能包含 provider key。生产应尽快切换到平台代理或短期 token。

4. 队列一致性：
   PostgreSQL 队列要处理锁、超时和重复消费。第一版必须有幂等 key。

5. 审计性能：
   高并发 shell/file/network 审计可能放大写入压力。需要批量写入或异步补偿。

6. 不改 opencode 的边界：
   外层沙箱能保证进程和文件系统隔离，但 tool-level 精细审计可能需要 opencode hook。该类改动应单独评审。

## 17. 交付物清单

阶段完成后应具备：

1. 沙箱抽象代码。
2. Docker/Podman 沙箱后端。
3. agent runtime 镜像。
4. sandbox DB 表和 repo。
5. worker resource heartbeat。
6. runtime operation queue。
7. quota policy。
8. workspace diff 回写。
9. 审计 DB 化。
10. system 管理接口。
11. e2e 和压测脚本。
12. 部署文档和回滚说明。

## 18. 推荐执行顺序

优先顺序如下：

1. Phase 0 和 Phase 1 先做，确保抽象层稳定。
2. Phase 2 做出真实独立容器，先解决服务代码误改风险。
3. Phase 3 收紧 mount 和配置，降低密钥和平台代码暴露。
4. Phase 4 做 overlay/diff，解决真实 workspace 误改误删。
   第一版以 `copy workspace + diff 回写` 落地，后续再升级 Linux overlayfs。
5. Phase 5 再做大用户量治理。
6. Phase 6 和 Phase 7 做企业级完善和生产加固。

如果资源有限，最低可交付企业安全 MVP 是：

1. `SandboxManager`
2. Docker 独立容器后端
3. 平台代码不可见或只读
4. workspace 只挂载当前目录
5. 容器资源限制
6. sandbox 生命周期审计
7. worker offline 清理

这个 MVP 不能完全解决 diff 回写和大规模治理，但能先把“agent 误改服务代码”的最高风险降下来。

补充说明：

这个 MVP 也不是最终生产执行方案。它只是通向 `Stateful Session + Ephemeral Sandbox + Worker Pool + Queue + Quota + Kubernetes/gVisor/Kata` 的过渡落地版本。
