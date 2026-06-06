# runtime-shell 企业级沙箱运行架构设计

## 1. 主结论与目标架构

主结论：

1. 最终目标方案不是“每个对话长期占用一个 Docker 容器”，而是 `Stateful Session + Ephemeral Sandbox`。
2. `session` 是持久化的逻辑会话，`sandbox` 是按需分配、可回收、可重建的执行租约。
3. 开发和验证阶段可以先使用 Docker/Podman 作为过渡执行后端。
4. 企业生产目标方案应演进到 `Kubernetes + Worker Pool + gVisor/Kata runtimeClass`。
5. 大规模运行必须配套 `lease/rebind`、`warm pool`、`queue`、`quota` 和 `diff/overlay`，而不是把用户会话与长期容器数量做 1:1 绑定。

### 1.1 方案选型结论

1. 推荐方案主结论：`Stateful Session + Ephemeral Sandbox` 是目标架构，不应再把“每个对话长期占用一个 Docker sandbox”视为推荐方案。
2. 开发/验证：使用 Docker/Podman 作为过渡执行后端，重点验证 `SandboxManager`、独立沙箱生命周期、挂载边界和主链路兼容性。
3. 企业生产：使用 `Kubernetes + Worker Pool + gVisor/Kata` 作为目标执行方案，由平台统一调度、隔离和恢复。
4. 大规模治理：必须补齐 `queue + quota + warm pool + lease/rebind`，避免退化为“每个逻辑会话长期绑定一个 Docker sandbox”的错误实现。

### 1.2 当前实现状态（2026-06-02）

当前 `runtime-shell` 已经完成并验证了第一阶段的 Docker 过渡沙箱后端，但它仍然只是过渡执行方案，不是最终企业生产执行模型。

已实现并验证的状态：

1. `SandboxManager` 抽象已经落地，`worker-agent` 可以通过独立 Docker sandbox 运行 ACP，而不是继续在 worker 容器内直接执行会话 ACP 子进程。
2. Docker sandbox 当前采用容器内 `bun` TCP bridge 方式承接 ACP stdin/stdout，而不是依赖 `docker exec -i` 或 hijack stdin。这样做的原因是 Bun + Docker Desktop + dockerode/docker-modem 组合下，交互式 exec 链路稳定性不足。
3. 当前安全边界已经包含：非 root 用户、只读 rootfs、`cap_drop=ALL`、`no-new-privileges`、独立 tmpfs 的 `/tmp` 与 runtime home、CPU/内存/pids 限制。
4. 当前挂载边界已经收紧为：只挂载当前 session 的 workspace，不暴露 `runtime-shell` 服务代码，不向 sandbox 暴露 Docker socket。
5. 当前配置注入方式已经调整为：由 worker 侧把运行配置 base64 注入 sandbox 环境，再在 sandbox 内写入临时配置文件，避免依赖宿主共享配置目录。
6. 当前网络模式是通过 `runtime-shell_default` Docker 网络让 worker 能连接 sandbox bridge，同时保留 sandbox 出站能力，便于继续验证真实模型访问和第三方工具访问。
7. 已验证主链路包括 `initialize`、`newSession`、`prompt`、`close`，并已通过 `bun run e2e:smoke`、`bun run typecheck`、`bun run typecheck:scripts` 与 `docker compose -f docker-compose.yml config --quiet`。

当前仍未完成的关键能力：

1. workspace 目前仍然是直接挂载给 sandbox 的可写目录，还没有切到企业级默认的 `copy workspace + diff 回写`。
2. 还没有补齐 `queue + quota + warm pool + lease/rebind` 的大规模治理闭环。
3. 还没有切到 `Kubernetes + gVisor/Kata` 的最终生产执行面。

## 2. 背景与目标

`runtime-shell` 当前已经具备会话、workspace、worker、runtime binding、lease 和基础治理能力，但 agent 运行时仍然不是强隔离环境。当前实现中，`runtime-shell` 或 `opencode-worker` 会在可见项目代码的进程/容器环境内启动 ACP runtime，agent 的 shell/file/MCP 能力理论上可以访问同一运行环境中的路径。对于企业级和大用户量场景，这会带来误改服务代码、误删工作区、越权访问配置、密钥泄漏、容量失控和故障扩散风险。

本文目标是给出一步到位的企业级沙箱方案，同时遵循以下约束：

1. 尽量不修改 `opencode` 原代码，优先通过 `runtime-shell` 侧编排、worker-agent 包装、部署拓扑和配置注入实现。
2. 不改变 ACP 协议交互语义，继续复用现有 `ManagedRuntimeClient`、`RemoteRuntimeClient`、worker-agent HTTP API 和 session event 流。
3. 不过度实现业务无关能力，先把隔离、安全、大并发、审计和恢复的关键边界设计清楚。
4. 保持后续可迁移到 Kubernetes、gVisor、Kata/Firecracker 等更强隔离后端。

### 实施优先级与语义守护

优化必须按以下顺序推进，避免把补救措施误当作根因修复：

1. 真正 warm runtime 复用。
2. 提高 warm runtime 命中容量。
3. 去掉 cold path `migration/init` 成本。
4. workspace 复制优化。
5. plugin/provider 瘦身。
6. 冷启动全局限速。

所有阶段都必须同时守住以下语义边界，任何性能优化都不能回退这些约束：

1. `provider` 隔离：
   `admin` 共享配置仍然全员可见；用户私有配置仍然只自己可见；不同 `workspace/session` 继续复用同一份用户设置，但绝不能串用户。
2. `mcp` 隔离：
   用户私有 MCP 配置只对本人会话生效；共享 MCP 的可见范围不能被 warm runtime 扩大；warm runtime 复用不能把前一个用户的 MCP 进程状态或配置带到下一个用户。
3. `skill` 隔离：
   用户私有 skill、共享 skill、启用状态和能力面继续按当前权限模型生效，不能因为 runtime 常驻而串会话、串用户。
4. 会话与工作区语义：
   继续保持“一个沙箱对应一个 workspace，不是一个 session 一个沙箱”；`orphaned -> reopen -> active`、关闭、回收、恢复链路不能退化。
5. runtime 复用边界：
   warm runtime 必须按配置指纹分池，不能把不同 `provider/mcp/skill` 配置的 runtime 混租。
6. 验证方式：
   每个阶段都要隔离验证，不能把压测、设置专项和恢复专项并行运行后再据此判断结果。

当前进展补充（2026-06-05）：

1. `真正 warm runtime 复用` 已从“warm 容器壳”升级为“worker 长驻 warm runtime”：
   warm slot 长期持有已初始化的 ACP runtime，会话租用时优先只做 `newSession/loadSession/resumeSession`，归还时只 `closeSession`。
2. `提高 warm runtime 命中容量` 已完成第一轮：
   warm runtime 继续按配置指纹分池，同时把 generic ready slot 的物化量收敛到当前 ready 预算内，避免补池反向挤占业务 open 的冷启动资源。
3. `去掉 cold path migration/init 成本` 已完成第一轮：
   runtime-home seed、fork session DB snapshot、slim model catalog 已接通；ACP `initialize/newSession/loadSession/resumeSession` 现在有阶段级耗时日志。
4. `workspace 复制优化` 已完成第一轮：
   brand-new workspace 首次 open 可跳过首次全量复制，warm slot prepare/back-sync 会跳过空目录无效复制；workspace copy 已并入统一冷启动门控。
5. `plugin/provider 瘦身` 已完成第一轮：
   容器冷路径只保留运行时必需 builtin config 与 slim models catalog；用户 provider / mcp / skill 继续走会话级配置注入，不改变 `admin` 共享与用户私有边界。
6. `冷启动全局限速` 已完成第一轮：
   workspace copy、runtime-home prepare、warm slot create、cold container boot 已共享同一背压预算；50 并发下目标是受控排队，而不是资源打死。
7. 以上内容目前只表示“代码已经接入该方向”，最终是否达标仍以后续镜像重建、E2E 和 10/20 并发复测结果为准。

## 3. 现有代码执行链路

### 2.1 session 到 runtime 的主链路

现有打开会话链路如下：

1. `createSessionForUser` 在 `runtime-shell/server/src/services/session/session-application-service.ts` 中创建业务 session，并保存 `workspacePath`、`workerId`。
2. `openSessionForUser` 通过 `requireRuntimeSessionWorkspace` 校验 workspace 是否存在、是否属于用户授权范围、路径是否是目录。
3. `ensureWorkerForSessionOpen` 在 `session-worker-assignment-service.ts` 中选择 worker，并创建或复用 runtime binding。
4. `openSessionWithFallback` 调用 `openRealRuntime`。
5. `openRealRuntime` 通过 `createClient(session)` 创建 runtime client，然后调用 `client.newSession(session.workspacePath)`。
6. `bindRuntime` 把 ACP session、runtime key、capability state 和 event 流绑定回业务 session。

这条链路已经提供了比较好的扩展点：`createClient(session)` 返回的是 `ManagedRuntimeClient`，可以替换为本地进程、远端 worker 或沙箱 worker，而不需要修改 `opencode` 的核心逻辑。

### 2.2 远端 worker 链路

当 `RUNTIME_SHELL_WORKER_EXECUTION_MODE=remote` 且 worker 存在 `agentBaseUrl` 时，`createClient` 会返回 `RemoteRuntimeClient`。`RemoteRuntimeClient` 把 `newSession/loadSession/resumeSession/forkSession/prompt/cancel/close` 转发给 worker-agent。

worker-agent 的入口在 `runtime-shell/server/src/worker-agent/index.ts`，核心实现位于：

1. `worker-agent-runtime.ts`：处理 `/runtime/open-session`、`/runtime/send-prompt` 等远程 runtime 生命周期请求。
2. `worker-agent-runtime-support.ts`：创建 `RuntimeEntry`，内部仍然直接创建 `AcpProcessClient`。
3. `acp/process-spawn.ts`：通过 `spawn(process.execPath, [entry, "acp", "--cwd=..."])` 启动 ACP 子进程。

当前远端 worker 只是把 ACP 进程移到 worker 容器内执行，并没有强沙箱边界。

### 2.3 当前 workspace 和挂载边界

workspace 创建逻辑在 `workspace-create-service.ts`，默认路径是：

```text
Config.workspaceRootDir / user.id / slug
```

默认 `Config.workspaceRootDir` 是 `/workspace/workspaces`。Docker compose 当前把宿主 `../workspaces` 挂载到 worker 和 runtime-shell 容器的 `/workspace/workspaces`，同时把 `../.opencode` 挂载到 `/workspace/.opencode`。

镜像内还存在 `/workspace/packages/opencode/src/index.ts`，并通过 `OPENCODE_ACP_ENTRY=/workspace/packages/opencode/src/index.ts` 启动 ACP。也就是说，agent 的执行环境能看到当前容器内的 opencode 代码和 workspace。即使这些代码未必是宿主实时 bind mount，仍然可能被 agent 误改，影响当前容器服务进程。

## 3. 现有能力与缺口

### 3.1 已具备的能力

现有代码已经具备以下企业化基础：

1. `ManagedRuntimeClient` 抽象：适合无侵入接入沙箱 runtime。
2. `RemoteRuntimeClient`：控制面和执行面已有初步分离。
3. worker 注册和心跳：`worker_node`、`worker_heartbeat` 已有基础表结构。
4. worker 容量调度：`selectWorkerForNewSession` 会按容量和 active session 数选择 worker。
5. session 粘性：`resolveStickyWorkerForSession` 会优先复用原 worker。
6. runtime binding：`business_session_runtime_binding` 保存 session 与 worker/runtime 的关系。
7. runtime lease：`runtime_lease` 提供 runtime 所有权和超时治理。
8. worker offline 和 orphaned 恢复：`runtime-governance-loop.ts` 已有基础治理逻辑。
9. workspace 权限校验：`workspace-access-service.ts` 会校验租户、组织、项目、共享关系和目录存在性。

### 3.2 企业级缺口

当前缺口主要集中在执行隔离和大规模治理：

1. ACP 子进程仍在 worker 容器内直接 `spawn`，不是独立沙箱。
2. agent 能看到 worker 容器内的服务代码、`.opencode` 和 workspace。
3. workspace 是直接挂载目录，不是 copy-on-write 或 diff 回写。
4. worker capacity 只按 session 数估算，不包含 CPU、内存、磁盘、容器数量、队列长度和预热池。
5. 没有沙箱实例表，无法追踪每个 sandbox 的生命周期、资源、镜像版本和退出原因。
6. 没有任务队列和削峰机制，高并发打开会话会直接冲击 worker。
7. 没有租户/用户/项目级资源配额模型。
8. 没有统一策略网关限制 shell 命令、文件路径、网络域名、MCP server 和依赖安装。
9. 审计日志当前仍主要通过 store JSON 路径写入，企业级目标应改为 DB 化并补齐 shell/file/network/diff 审计。
10. 密钥注入与模型访问需要平台代理化，避免 agent 直接持有长期密钥。

## 4. 目标架构

一步到位的目标架构分为五层：

```text
runtime-shell 控制面
  鉴权 / session / workspace / 配置 / 审计 / 策略 / API
        |
        v
调度治理面
  worker 池 / 队列 / 配额 / lease / 预热池 / 故障恢复
        |
        v
worker-agent 执行编排面
  sandbox manager / image 管理 / mount 管理 / 生命周期
        |
        v
agent sandbox 执行面
  ACP runtime / shell / file / MCP / 依赖安装
        |
        v
数据与观测面
  PostgreSQL / Redis or queue / object storage / metrics / logs / traces
```

核心原则：

1. `runtime-shell server` 不直接执行 agent shell 或 ACP 子进程。
2. `worker-agent` 不直接在自身容器内 spawn ACP，而是通过 `SandboxManager` 创建独立 sandbox。
3. sandbox 只看到当前 session 的 workspace 视图和必要只读配置。
4. 平台服务代码默认不可见；如果因 opencode 运行方式必须存在，也只能是镜像只读层，不允许写。
5. 用户修改先进入 sandbox 写层，经 diff 审核后再回写真实 workspace。
6. 逻辑 session 与执行 sandbox 必须解耦，sandbox 允许空闲回收、故障重建和跨 worker 重新绑定。

### 4.1 推荐执行模型

按本文档目标，推荐执行模型如下：

1. 控制面：
   `runtime-shell` 负责鉴权、session、workspace、配置、审计、策略、队列和调度。

2. 状态面：
   session、binding、lease、queue、quota、diff、audit 等状态持久化在数据库中。

3. 执行面：
   sandbox 是短生命周期执行单元，只在 open/prompt/interactive turn 需要时分配。

4. 恢复面：
   空闲 sandbox 会回收；重新进入会话时，根据 session 状态和 workspace 快照恢复执行上下文。

5. 生产承载面：
   多 worker 节点组成 sandbox worker pool，结合 warm pool、queue、quota 和资源向量调度。

这个模型直接面向企业规模和消费端规模，不把长期 Docker 容器当最终架构。

## 5. 沙箱执行模型

### 5.1 SandboxManager 抽象

在 `runtime-shell/server/src/worker-agent` 下新增 `sandbox/` 模块，不修改 `opencode` 原代码。建议抽象如下：

```ts
export type SandboxManager = {
  prepare(input: SandboxPrepareInput): Promise<SandboxHandle>
  attachAcp(input: SandboxAttachInput): Promise<SandboxAcpProcess>
  snapshot(input: SandboxSnapshotInput): Promise<SandboxSnapshotResult>
  diff(input: SandboxDiffInput): Promise<SandboxDiffResult>
  commit(input: SandboxCommitInput): Promise<SandboxCommitResult>
  close(input: SandboxCloseInput): Promise<void>
}
```

其中 `SandboxAcpProcess` 对外保持类似 `ChildProcessWithoutNullStreams` 的 stdin/stdout/stderr/exit 接口，让现有 `AcpProcessClient` 可以最小改动复用。理想落点是新增 `SandboxAcpClient` 或让 `spawnAcpProcess` 可注入 process factory，而不是修改 `opencode`。

### 6.2 后端选择

推荐支持多后端，但需要明确区分“开发/验证阶段的过渡后端”和“企业生产阶段的目标后端”：

1. Docker/Podman：
   用于本地开发、验证执行抽象、跑通 sandbox 生命周期，不应被视为最终大规模生产方案。

2. Kubernetes + gVisor `runsc`：
   作为企业生产默认目标方案，兼顾可扩展性和隔离性。

3. Kubernetes + Kata Containers：
   作为更高安全等级租户或敏感代码场景的增强隔离方案。

4. Firecracker / microVM：
   保留为更长期的强对抗或公网高风险场景演进选项，不作为当前文档的首选落地方向。

后端能力通过配置选择：

```text
RUNTIME_SHELL_SANDBOX_BACKEND=docker | gvisor | kata | firecracker
RUNTIME_SHELL_SANDBOX_IMAGE=opencode-agent-runtime:<version>
RUNTIME_SHELL_SANDBOX_WORKSPACE_MODE=overlay | copy | direct-readonly
```

### 5.3 沙箱容器边界

每个 active session 绑定一个 sandbox。sandbox 应满足：

1. 非 root 用户运行。
2. `read_only` rootfs。
3. `cap_drop=ALL`。
4. `no-new-privileges=true`。
5. 禁止挂载 Docker socket。
6. 只挂载当前 workspace 的 overlay 写层。
7. `.opencode`、skills、MCP 配置只读注入。
8. `/tmp`、包管理缓存、tool-output 使用 session 独立 tmpfs 或 volume。
9. CPU、内存、磁盘、pids、进程数、运行时长有限制。
10. 默认网络关闭或走 egress proxy 白名单。

### 5.4 workspace overlay 与 diff 回写

企业级默认不应让 agent 直接写真实 workspace。目标形态可以是 overlay/copy-on-write，但第一版应优先落地 `copy workspace + diff 回写`，原因是 Windows、本地 Docker Desktop、Linux overlayfs 的行为差异较大，而 copy 模式更容易跨平台验证和审计。

推荐的一阶段实现流程：

1. 打开 session 时，在受控 scratch 目录下创建当前 workspace 的 session copy。
2. sandbox 只把该 session copy 作为可写 workspace 挂载，真实 workspace 不再直接暴露给 sandbox。
3. agent 的所有文件修改都发生在 session copy 内。
4. prompt 完成、用户点击“查看变更”或平台策略要求提交时，生成真实 workspace 与 session copy 之间的 diff。
5. diff 进入策略检查：路径是否越界、是否删除大量文件、是否触碰敏感文件、是否修改平台配置、是否包含大体积二进制文件。
6. 审计记录 diff 摘要、变更文件数、删除数、命中策略和操作者。
7. 经自动策略或人工确认后，平台再把选中的 diff 回写到真实 workspace。

推荐的二阶段增强：

1. 在 Linux 生产集群中，把 `copy workspace` 升级为真正的 overlay lower/upper/workdir，以降低大仓库复制成本。
2. 保持 diff、审批、回写、审计语义不变，只替换底层 workspace 实现。

推荐的数据状态：

1. `created`：sandbox copy 已创建，但还未生成 diff。
2. `pending_review`：diff 已生成，等待自动策略或人工确认。
3. `applied`：diff 已成功回写真实 workspace。
4. `rejected`：diff 被人工或策略拒绝。
5. `expired`：会话关闭或超时后未处理。
6. `failed`：diff 生成或回写失败。

回写策略要求：

1. `apply` 必须幂等，使用 `diff_id + idempotency_key` 或业务唯一键避免重复回写。
2. 只允许回写 workspace 根目录内的相对路径，拒绝路径穿越和符号链接逃逸。
3. `.env`、私钥、平台配置、部署配置、密钥目录默认拒绝自动回写。
4. 大规模删除、批量重命名、二进制大文件改动默认进入人工确认。
5. diff artifact、审计记录和 apply/reject 结果必须保留 TTL 与可追溯链路。

开发环境可以支持 `direct` 模式，但生产默认应禁用。目标方案始终应围绕“持久化 session + 临时执行 sandbox”展开，而不是直接把真实 workspace 和长期容器绑定。

### 5.5 配置和密钥注入

当前 `buildSessionConfigOverride` 会把 provider/MCP/skill 配置合并为 `OPENCODE_CONFIG_CONTENT` 注入 ACP 子进程。企业级应调整为：

1. provider 长期密钥不直接进入 sandbox。
2. 模型请求优先走 runtime-shell 或企业网关代理。
3. sandbox 只拿短期 token、session-scoped token 或代理地址。
4. MCP server 分为平台共享和用户私有，必须经过策略审批。
5. 本地 MCP command 在 sandbox 内运行，不能运行在 server/worker 容器内。

## 6. 大用户量能力设计

### 6.1 Worker 池与容量模型

当前 worker capacity 是单一整数。企业级应扩展为资源向量：

```text
capacity_session_total
capacity_cpu_millicores
capacity_memory_mb
capacity_disk_mb
capacity_sandbox_total
capacity_warm_pool
```

worker 心跳上报：

```text
active_session_count
running_sandbox_count
warm_sandbox_count
queued_task_count
cpu_used
memory_used
disk_used
image_version
runtime_version
sandbox_backend
```

调度时按租户、资源、队列长度、worker 状态和亲和性综合评分，而不是只按 active session 数。

### 6.2 预热池

为了支持大用户量，不能每次打开 session 都冷启动镜像，也不能让每个逻辑 session 长期占用一个 sandbox。worker-agent 或 sandbox worker pool 应维护预热池：

1. worker 启动时预拉镜像。
2. 第一优先级不是继续堆 warm 容器壳，而是把 warm slot 升级为真正的 warm runtime：按配置指纹提前创建并长期持有已 `initialize` 完成的 ACP runtime。
3. session 打开时优先租用同配置指纹的 warm runtime，并只执行 `newSession/loadSession/resumeSession`；归还时只 `closeSession`，不销毁 ACP 进程。
4. 高峰期低水位自动补充。
5. 低峰期释放多余 warm runtime / warm sandbox。

预热池需要计入配额，避免空闲资源占满节点。

预热池优化必须按顺序推进，并且每一步都要带着语义验证一起做：

1. 先做真正 warm runtime 复用。
   验证：`provider/mcp/skill` 不串用户、不串配置；`orphaned -> reopen -> active` 继续成立。
2. 再提高 warm runtime 命中容量。
   验证：按配置指纹分池正确，不同配置不会混用，也不会把流量长期倾斜到单一 worker。
3. 再去掉 cold path `migration/init` 成本。
   验证：不影响自定义 `provider/model` 生效，不影响“前端统一配置一次，不同 workspace/session 直接使用”。
4. 再做 workspace 复制优化。
   验证：`diff`、关闭回写、`reopen` 语义保持不变。
5. 再做 plugin/provider 瘦身。
   验证：能力面不缺失，权限与可见性不回退。
6. 最后做冷启动全局限速。
   验证：体现为受控背压，而不是业务语义变化；不会因为限速破坏恢复、绑定和租约逻辑。

### 6.3 队列与削峰

新增 runtime operation queue，至少覆盖：

1. open session。
2. resume/load session。
3. fork session。
4. prompt execution。
5. diff commit。
6. sandbox cleanup。

队列需要支持：

1. 租户级优先级。
2. 用户级并发限制。
3. session 粘性。
4. 超时取消。
5. 幂等 key。
6. 可观测队列长度和等待时间。

实现方式可以先用 PostgreSQL 表，后续迁移 Redis Streams、BullMQ、NATS 或 Kafka。

### 6.4 配额治理

建议新增 quota 策略：

```text
tenant_max_running_sessions
tenant_max_running_sandboxes
tenant_max_cpu
tenant_max_memory
tenant_max_disk
user_max_running_sessions
project_max_running_sessions
session_max_duration
prompt_max_duration
network_max_bytes
```

创建 session、打开 sandbox、发送 prompt、安装依赖、执行 MCP 前都要做 quota check。

### 6.5 故障恢复

现有 orphaned/rebind 机制可以复用，但需要把 sandbox 状态纳入治理：

1. worker offline：标记该 worker 所有 running sandbox 为 lost。
2. sandbox exit：记录退出码、信号、最后日志摘要和资源用量。
3. lease 过期：关闭 sandbox，binding 标记 lost，session 标记 orphaned。
4. reopen orphaned session：重新选择 worker，从 workspace snapshot 或真实 workspace 重新创建 sandbox。
5. diff 未提交时 worker 崩溃：如果 write layer 在共享存储或对象存储中，允许恢复；否则标记为不可恢复并提示用户。

## 7. 企业级安全策略

### 7.1 策略网关

仅靠容器隔离不够，必须在 runtime-shell 侧维护策略中心：

1. shell 命令策略：禁止 `git clean`、危险 `rm -rf`、权限修改、磁盘扫描、容器控制、系统服务控制等。
2. 文件策略：限制写入 workspace；禁止写 `.env`、私钥、平台配置、系统目录；大规模删除需要审批。
3. 网络策略：默认白名单域名；包管理源、Git 源、MCP remote URL 需审批。
4. MCP 策略：只允许启用已登记 server；本地 command 必须在 sandbox 内运行。
5. diff 策略：敏感文件和删除操作进入人工确认。
6. 模型/工具策略：按租户、角色、项目控制可用模型、模式、工具。

### 7.2 审计要求

需要 DB 化并补齐审计事件：

1. `sandbox.create`
2. `sandbox.open`
3. `sandbox.close`
4. `sandbox.exit`
5. `sandbox.resource_exceeded`
6. `shell.execute`
7. `file.diff.generated`
8. `file.diff.applied`
9. `file.diff.rejected`
10. `network.request`
11. `mcp.invoke`
12. `policy.denied`

每条审计至少包含：

```text
tenantId
organizationId
projectId
workspaceId
businessSessionId
userId
workerId
sandboxId
requestId
action
resourceType
resourceId
summary
createdAt
```

敏感值必须脱敏，不允许记录 token、私钥、密码原文。

## 8. 数据模型建议

在现有表基础上新增：

### 8.1 sandbox_instance

```sql
CREATE TABLE sandbox_instance (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  business_session_id VARCHAR(64) NOT NULL,
  worker_node_id VARCHAR(64) NOT NULL,
  runtime_key VARCHAR(128) NOT NULL,
  backend VARCHAR(32) NOT NULL,
  image_ref TEXT NOT NULL,
  container_id TEXT,
  status VARCHAR(32) NOT NULL,
  workspace_mode VARCHAR(32) NOT NULL,
  resource_json TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  exited_at TIMESTAMPTZ,
  exit_code INTEGER,
  exit_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

### 8.2 runtime_operation_queue

```sql
CREATE TABLE runtime_operation_queue (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  business_session_id VARCHAR(64),
  operation_type VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  priority INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL,
  payload_json TEXT NOT NULL,
  result_json TEXT,
  error_message TEXT,
  available_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (idempotency_key)
);
```

### 8.3 quota_policy

```sql
CREATE TABLE quota_policy (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64),
  project_id VARCHAR(64),
  user_id VARCHAR(64),
  policy_json TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

### 8.4 sandbox_diff

```sql
CREATE TABLE sandbox_diff (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  business_session_id VARCHAR(64) NOT NULL,
  sandbox_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  workspace_mode VARCHAR(32) NOT NULL,
  summary_json TEXT NOT NULL,
  artifact_uri TEXT,
  idempotency_key VARCHAR(128),
  policy_result_json TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ
);
```

## 9. 代码改造建议

### 9.1 不改或少改 opencode 原代码

优先不修改 `packages/opencode`。需要的能力通过以下方式实现：

1. 构建独立 `opencode-agent-runtime` 镜像，镜像内运行现有 `opencode acp`。
2. 通过环境变量 `OPENCODE_CONFIG_CONTENT`、`OPENCODE_CLIENT=acp`、`--cwd` 继续驱动现有 ACP。
3. 在 worker-agent 中替换 ACP 子进程启动方式，而不是改 `packages/opencode/src/index.ts`。
4. shell/file/network 策略优先在 sandbox 外层和 runtime-shell permission 流中治理。
5. 如果必须修改 opencode，应限制在可注入 permission policy、tool adapter 或 cwd/path guard 这类小范围扩展点。

### 9.2 runtime-shell 侧新增模块

建议新增：

```text
runtime-shell/server/src/services/sandbox/
  sandbox-application-service.ts
  sandbox-policy-service.ts
  sandbox-quota-service.ts
  sandbox-diff-service.ts
  sandbox-observe-service.ts

runtime-shell/server/src/worker-agent/sandbox/
  sandbox-manager.ts
  docker-sandbox-manager.ts
  sandbox-process-adapter.ts
  sandbox-workspace.ts
  sandbox-network.ts
```

### 9.3 worker-agent 改造点

当前 `createRuntimeEntry` 直接创建 `AcpProcessClient`。改造后应变为：

1. `createRuntimeEntry` 调用 `SandboxManager.prepare()`。
2. `SandboxManager.attachAcp()` 返回 ACP process adapter。
3. `AcpProcessClient` 使用 adapter 的 stdin/stdout 连接 ACP。
4. `closeSession` 关闭 ACP session 后调用 `SandboxManager.close()`。
5. worker-agent 心跳上报 running/warm sandbox 数和资源用量。

这部分只改 `runtime-shell/server/src/worker-agent` 和 `runtime-shell/server/src/acp` 的进程启动适配，不触碰 `packages/opencode`。

### 9.4 调度改造点

`selectWorkerForNewSession` 应从按 active session 数调度，升级为：

1. 查询 worker resource heartbeat。
2. 查询 quota。
3. 检查 warm pool。
4. 计算 worker score。
5. 创建 runtime operation queue 记录。
6. 创建或复用 runtime binding。

### 9.5 审计和观测改造点

1. `audit_log` 改为 DB repo，不再只走 JSON store。
2. 增加 sandbox、diff、policy 审计 action。
3. 增加 worker/sandbox metrics endpoint。
4. 接入 OpenTelemetry traceId/requestId。

## 10. 部署拓扑

### 10.1 开发环境

```text
runtime-shell
postgres
opencode-worker
  worker-agent
  docker socket or podman service
  sandbox containers
```

开发环境可以用 Docker 后端，但仍建议 sandbox 独立容器。

### 10.2 生产环境

```text
Kubernetes
  runtime-shell deployment
  worker-agent daemonset/deployment
  sandbox pods with gVisor/Kata runtimeClass
  PostgreSQL
  Redis/NATS queue
  object storage
  egress proxy
  OpenTelemetry collector
```

生产建议：

1. runtime-shell 与 worker-agent 分不同 service account。
2. sandbox pod 使用独立 namespace 或 runtimeClass。
3. network policy 默认拒绝，按租户/策略放行。
4. workspace snapshot/diff 存对象存储。
5. worker 节点按租户或安全等级分池。

## 11. 分阶段落地计划

### 高层 Phase 1：沙箱抽象和过渡执行后端

目标：

1. 新增 `SandboxManager`。
2. 先接入 Docker/Podman 作为过渡执行后端，验证独立 sandbox 生命周期。
3. sandbox 只挂载 workspace 和只读配置。
4. 平台代码不以可写方式暴露给 sandbox。

验收：

1. agent 无法写入 `/workspace/packages`。
2. agent 无法访问 runtime-shell server 源码。
3. session open/prompt/cancel/close 行为与当前一致。
4. `bun typecheck` 在 `runtime-shell` 目录通过。

### 高层 Phase 2：overlay workspace 和 diff 回写

目标：

1. workspace 默认进入 `copy workspace + diff 回写`，不再直接写真实 workspace。
2. 生成 diff 并审计。
3. 路径越界和敏感文件策略生效。
4. 为后续 Linux overlayfs 升级保留同一套抽象与 API。

验收：

1. agent 修改不会直接影响真实 workspace。
2. diff 应用后真实 workspace 才变化。
3. 大规模删除默认阻断或要求审批。

### 高层 Phase 3：大并发调度治理

目标：

1. 增加 sandbox instance 和 operation queue。
2. 实现 warm pool。
3. 实现租户/用户/项目配额。
4. worker heartbeat 上报资源向量。

验收：

1. 高并发 open session 不打爆 worker。
2. 排队、超时、取消、重试可观测。
3. worker offline 后 session 正确 orphaned/rebind。

### 高层 Phase 4：企业级安全、观测与生产化执行后端

目标：

1. Kubernetes + gVisor/Kata runtimeClass。
2. egress proxy 和网络白名单。
3. DB 审计全量补齐。
4. OpenTelemetry metrics/logs/traces。

验收：

1. 安全策略命中可审计。
2. sandbox 资源超限可熔断。
3. 管理员能查看 worker、sandbox、queue、quota、failure 全链路状态。

## 12. 压测与容量指标

建议定义以下基准：

1. P95 session open latency：warm sandbox 小于 3 秒。
2. P95 cold sandbox start latency：小于 15 秒。
3. 单 worker 最大 running sandbox 数：按 CPU/内存实测设定。
4. queue wait P95：普通租户小于 30 秒，高优租户小于 10 秒。
5. worker offline 检测时间：小于 2 个 heartbeat timeout。
6. orphaned session rebind 成功率：大于 99%。
7. diff 生成耗时：中型 repo 小于 10 秒。
8. 审计写入失败不得影响主链路，但必须进入补偿队列。

## 13. 风险与决策点

### 13.1 是否必须完全不改 opencode

原则上可以不改。通过 sandbox 外层运行 `opencode acp`，并复用 ACP 协议即可。但以下能力如果要做到非常细，可能需要极小范围扩展：

1. shell 命令执行前策略拦截。
2. 文件写入前路径策略拦截。
3. tool-level 审计粒度。

这些扩展应优先做成可选 hook，避免侵入主逻辑。

### 13.2 direct workspace 是否保留

开发环境可以保留 direct 模式，生产默认不允许。企业级默认应使用 overlay/diff。

### 13.3 Docker 是否足够安全

普通 Docker 不应作为最终强安全边界。生产至少应使用 gVisor 或 Kata/Firecracker，并叠加 seccomp、AppArmor、非 root、只读 rootfs 和网络策略。

## 15. 推荐结论

基于现有代码，最合理的一步到位路线是：

1. 保留 `runtime-shell` 现有 session、worker、binding、lease 和 event 体系。
2. 不改或尽量少改 `packages/opencode`。
3. 在 worker-agent 后面新增 `SandboxManager`，把当前直接 `spawnAcpProcess` 替换为独立 sandbox 执行路径。
4. 用 Docker/Podman 作为开发/验证阶段的过渡执行后端，先把抽象和隔离边界跑通。
5. 把 workspace 从直接写升级为 overlay/diff 回写。
6. 把 worker capacity 升级为资源向量，并新增 queue、quota、warm pool。
7. 把审计、策略、沙箱实例和 diff 持久化到数据库。
8. 生产收敛到 `Kubernetes + Worker Pool + gVisor/Kata + Stateful Session + Ephemeral Sandbox`。

这样可以最大化复用现有架构，避免大改 opencode 原代码，同时从一开始就把目标方案定义为“持久化逻辑会话 + 临时执行沙箱”，避免团队误把长期 Docker 容器当成最终形态。

说明：

本文中的 `高层 Phase 1-4` 是架构层面的阶段合并视图，用于说明总体路线。后续实施时，可在实施计划文档中进一步细化为更多可执行阶段与 PR 粒度任务。
