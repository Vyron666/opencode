# 企业级 OpenCode ACP 执行内核实施设计稿

## 1. 实施结论

如果上一份部署方案回答的是“为什么企业应该把 `opencode` 放在 ACP agent 执行内核的位置上”，那么这份实施设计稿要回答的，就是“这件事第一版具体怎么落地，哪些能力该放在哪一层，哪些边界不能写错”。结合当前代码，比较稳妥的实施方式不是把 `ACP`、控制面、接入层和 Worker 混成一个大服务，而是明确拆成 `Session Control Plane`、`ACP Bridge`、`OpenCode Worker` 三个核心运行角色，再配一套独立的元数据存储、产物存储和观测体系。这样做的根本原因不在于架构图更漂亮，而在于 OpenCode 当前的会话、PTY、worktree 和实例缓存都明显绑定单实例执行环境，必须通过控制面和桥接层来组织，而不是直接暴露给所有接入方。

第一版实施目标不宜过大。更现实的目标，是先让三条关键链路完整闭环。第一条是会话链路，业务 session 可以稳定映射到 ACP session 和具体 Worker；第二条是执行链路，Bridge 能把外部输入可靠转成 ACP 交互并命中正确 Worker；第三条是反馈链路，Worker 产生的计划、命令、权限请求、工具状态和结果事件能够回流到外部前端或门户，并且全程带有业务会话上下文。只要这三条链路打通，企业就已经拥有了一套可生产化演进的 Agent 执行底座。

### 小结

实施设计的重点不是把所有能力一次铺满，而是先把“会话归属、桥接转发、Worker 执行、事件回流”四件事稳定接通。

## 2. 部署组件拆分

### 2.1 核心组件

建议第一版至少拆成下面六个部署组件：

| 组件 | 作用 | 部署建议 |
|---|---|---|
| API Gateway | 承接外部 Web、IDE、门户、鉴权与限流 | 统一接入层，独立部署 |
| Session Control Plane | 维护业务会话、Worker 归属、粘性路由、生命周期状态 | 独立服务，建议无状态 + 外置元数据 |
| ACP Bridge | 对外提供 HTTP/WebSocket，会话流与 ACP 协议双向转换 | 独立服务，可多实例 |
| OpenCode Worker | 运行 `opencode`、ACP 进程、OpenCode server、PTY、worktree | 有状态执行节点，多实例部署 |
| Metadata Store | 保存业务 session、Worker 注册、路由映射、审计索引 | 建议中心化数据库 |
| Artifact / Observability Stack | 保存产物、日志、指标与事件归档 | 对象存储 + 日志/指标系统 |

这六个组件里，真正和当前代码直接对应的是 `ACP Bridge` 与 `OpenCode Worker` 之间的协作关系。Bridge 不直接承载 PTY、目录和实例缓存，它只做桥接；Worker 不直接承载最外层身份和租户治理，它只做执行。Control Plane 则处于中间，负责把企业业务 session 变成一个可被路由、可被绑定、可被恢复的执行会话。

### 2.2 OpenCode Worker 内部模块

Worker 内部不建议再拆成太多微服务，但在职责上应该至少分清几块内部模块：

| 模块 | 关联代码 | 职责 |
|---|---|---|
| ACP Runtime | `packages/opencode/src/cli/cmd/acp.ts` | 启动 ACP 协议进程，承接 session 与事件流 |
| Session Runtime | `packages/opencode/src/acp/session.ts` | 维护 ACP session 的实例内运行状态 |
| OpenCode HTTP Runtime | `packages/opencode/src/server/server.ts` | 提供内部 HTTP 能力面，供 ACP 调 SDK 使用 |
| PTY Runtime | `packages/opencode/src/pty/index.ts` | 执行本地命令与终端流转发 |
| Worktree Runtime | `packages/opencode/src/worktree/index.ts` | 管理目录副本、git worktree 和启动脚本 |
| Instance Cache | `packages/opencode/src/effect/instance-state.ts` | 按目录维持 scoped cache 与实例局部状态 |

这种拆法的价值不在于要把它们全部物理分离，而在于实施时能明确知道哪些能力一定跟 Worker 实例绑定，不能假装它们天然可漂移。

### 2.3 Session Control Plane 的最小职责

第一版的控制面不需要做成“大而全调度平台”，但至少要把下面几件事稳定承担起来：

| 职责 | 说明 |
|---|---|
| Worker 注册 | 维护可用 Worker 列表、容量、标签、健康状态 |
| 会话绑定 | 记录 `business_session_id -> acp_session_id -> worker_id` |
| 路由决策 | 新会话分配 Worker，老会话坚持粘性路由 |
| 生命周期管理 | 跟踪 `created / active / idle / completed / failed` |
| 恢复入口 | Worker 失活后提供“重建或人工接管”的流程入口 |

这里需要特别强调，控制面不应该越位去接管 OpenCode 内部执行逻辑。它不负责 PTY，不负责 worktree，不负责工具调用细节。它只负责“知道这个会话应该去哪里、当前状态是什么、是否还能继续发往原实例”。

### 小结

组件拆分的核心不是追求微服务化，而是先把“控制”和“执行”切开，再把“桥接”和“业务接入”切开。

## 3. 接口草案

### 3.1 设计原则

从企业接入角度看，不建议把外部系统直接暴露到 ACP 的 `stdio` 协议面前。更合适的方式，是由 `ACP Bridge` 对外暴露统一 HTTP/WebSocket 接口，由 `Session Control Plane` 提供会话查询和路由决策接口。这样一来，外部系统只需要理解业务会话和流式事件，不需要直接理解 ACP 进程管理和实例绑定细节。

同时，这里也要把边界说清楚：下面这些接口草案是企业部署层的接口，不是说 ACP 当前代码已经原生提供这些 HTTP 能力。它们本质上是围绕现有 ACP 和 Worker 边界补出来的企业接入面。

### 3.2 Session Control Plane 接口草案

| 接口 | 方法 | 作用 |
|---|---|---|
| `/session/create` | `POST` | 创建业务会话并分配目标 Worker |
| `/session/get` | `GET` | 查询业务会话、Worker 归属和当前状态 |
| `/session/bind` | `POST` | 绑定或修正 `business_session_id` 与 `acp_session_id` |
| `/session/close` | `POST` | 关闭业务会话并标记释放 |
| `/worker/register` | `POST` | Worker 启动后注册元数据与容量 |
| `/worker/heartbeat` | `POST` | Worker 定期上报健康和负载 |
| `/worker/list` | `GET` | 查询当前可用 Worker 池 |

创建会话示例：

```json
POST /session/create
{
  "tenantId": "tenant_001",
  "userId": "user_123",
  "projectId": "proj_456",
  "workspaceId": "ws_789",
  "entry": "web-console",
  "title": "需求评审会话"
}
```

建议返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "businessSessionId": "bsess_001",
    "workerId": "worker_03",
    "bridgeRouteKey": "worker_03",
    "status": "created"
  },
  "requestId": "req_xxx"
}
```

### 3.3 ACP Bridge 接口草案

| 接口 | 方法 | 作用 |
|---|---|---|
| `/acp/session/open` | `POST` | 为业务会话打开或恢复 ACP session |
| `/acp/session/input` | `POST` | 向指定业务会话写入一条输入 |
| `/acp/session/events` | `GET` / `WS` | 订阅业务会话事件流 |
| `/acp/session/command` | `POST` | 执行会话命令，如继续、分支、关闭 |
| `/acp/session/permission/respond` | `POST` | 响应权限请求 |

发送输入示例：

```json
POST /acp/session/input
{
  "businessSessionId": "bsess_001",
  "message": "继续当前会话，并重新整理大纲",
  "client": {
    "name": "enterprise-web",
    "version": "1.0.0"
  }
}
```

事件流建议统一包装为：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "businessSessionId": "bsess_001",
    "acpSessionId": "sess_abc",
    "eventType": "plan",
    "payload": {
      "summary": "已进入策略确认阶段"
    },
    "timestamp": "2026-05-20T10:00:00+08:00"
  },
  "requestId": "req_evt_001"
}
```

### 3.4 Worker 内部接入约定

OpenCode Worker 不一定需要对企业外部开放很多 API，但至少应该对 Bridge 或控制面具备以下内部约定：

| 接口 / 约定 | 作用 |
|---|---|
| `ACP process bootstrap` | 启动并保持 ACP 进程存活 |
| `worker health endpoint` | 返回进程健康、负载和容量摘要 |
| `session local lookup` | 查询本机是否持有某个 `acp_session_id` |
| `artifact root report` | 报告当前 Worker 产物根目录或对象存储前缀 |

这里不建议在第一版里为 Worker 设计过多业务 API。它的关键是被控制面和 Bridge 管起来，而不是自己长成第二个控制平面。

### 小结

接口设计的重点不是让 ACP 直接对外 HTTP 化，而是通过 Control Plane 和 Bridge 把它正确网络化、业务化和会话化。

## 4. 会话路由状态机

### 4.1 业务会话状态机

建议第一版把部署侧业务会话收敛成下面六个状态：

| 状态 | 含义 |
|---|---|
| `created` | 已创建业务会话，尚未打开 ACP 会话 |
| `binding` | 正在绑定或恢复到具体 Worker |
| `active` | 会话已命中 Worker，处于活跃交互态 |
| `idle` | 会话已存在但暂时空闲，可继续恢复 |
| `completed` | 会话已完成并归档 |
| `failed` | Worker 失活、桥接失败或执行不可恢复 |

这套状态机的重点不在于把所有边角状态都写全，而在于控制面能够清楚判断“当前该继续路由到原 Worker、允许恢复、还是需要人工干预”。

### 4.2 路由状态转移

建议按下面这条主路径来实现：

1. `created -> binding`
   - 控制面为新会话分配 Worker。
2. `binding -> active`
   - Bridge 已成功打开 ACP session 并建立事件流。
3. `active -> idle`
   - 会话一段时间无输入，但 Worker 仍保留本地状态。
4. `idle -> active`
   - 用户恢复会话，控制面继续路由到原 Worker。
5. `active -> completed`
   - 会话关闭、产物归档、Worker 本地状态允许清理。
6. `binding -> failed`
   - Worker 不可用或 ACP 启动失败。
7. `active -> failed`
   - 运行中实例失活或桥接链路断裂，且无法透明恢复。

### 4.3 Worker 路由状态机

Worker 侧也建议维护一个简化的容量与接单状态：

| 状态 | 含义 |
|---|---|
| `starting` | Worker 启动中，尚未接单 |
| `ready` | 可分配新会话 |
| `busy` | 可继续承接已绑定会话，但不再接新会话 |
| `draining` | 仅维持存量会话，不接新流量 |
| `offline` | 不可路由 |

这种状态对多实例生产部署非常关键，因为它决定控制面能否安全摘除某个 Worker，或者在扩容时逐步放量，而不是硬切流量。

### 4.4 为什么不能做无状态重试

第一版里最需要明确禁止的一件事，就是把 Worker 失败处理成“普通 HTTP 请求失败，自动换台机器重试”。这样做和当前代码事实相冲突。由于 ACP session、PTY、worktree、实例缓存都附着本地状态，跨机重试往往只会得到一个“形式上成功命中、实际上上下文已丢”的假恢复。因此部署层更稳妥的选择应是：先做失败显式化，再做恢复策略，而不是假设请求漂移一定可行。

### 小结

会话路由状态机的作用，不是把部署讲复杂，而是把“哪些情况能继续、哪些情况必须停下来”讲清楚。对有状态 Worker 来说，这比纯吞吐更重要。

## 5. 运维指标与告警建议

### 5.1 最小指标面

第一版不需要铺天盖地上指标，但至少应该把下面几类指标打出来：

| 指标 | 说明 |
|---|---|
| `worker_alive_count` | 当前健康 Worker 数量 |
| `worker_session_count` | 每个 Worker 上绑定的活跃会话数 |
| `worker_pty_count` | 每个 Worker 上活跃 PTY 数量 |
| `worker_cpu_usage` / `worker_memory_usage` | Worker 资源压力 |
| `bridge_active_streams` | Bridge 当前活跃事件流数量 |
| `session_bind_latency_ms` | 会话从创建到绑定成功耗时 |
| `event_delivery_latency_ms` | Worker 事件到前端可见的链路延迟 |
| `session_recover_success_rate` | 空闲会话恢复成功率 |
| `worker_bind_failure_count` | 绑定失败次数 |
| `artifact_upload_failure_count` | 产物归档失败次数 |

这些指标里，最关键的不是机器资源，而是“会话是否真的被稳定接住”。因为这类系统的生产风险往往不先表现为 CPU 打满，而是表现为会话漂移、桥接断流、恢复失败和事件丢失。

### 5.2 建议告警项

| 告警项 | 触发建议 |
|---|---|
| Worker 心跳中断 | 连续 3 个心跳周期未上报 |
| 会话绑定失败率升高 | 5 分钟窗口内超过阈值 |
| Bridge 事件流中断率升高 | WebSocket/流式连接异常增多 |
| 单 Worker 会话过载 | 活跃会话数超过配置阈值 |
| Worker PTY 异常堆积 | PTY 数量持续增长且无回收 |
| 本地产物写入失败 | 文件系统或对象存储写入异常 |
| SQLite 锁等待异常 | 本地数据库 busy timeout 频繁触发 |

### 5.3 日志与审计建议

日志和审计至少要做到“按业务会话串起来”。建议所有关键链路统一携带这些字段：

| 字段 | 作用 |
|---|---|
| `request_id` | 单次请求排障 |
| `trace_id` | 跨层链路跟踪 |
| `business_session_id` | 业务主会话关联 |
| `acp_session_id` | ACP 会话关联 |
| `worker_id` | 命中实例 |
| `workspace_id` | 工作区定位 |
| `tenant_id` / `user_id` | 企业身份审计 |

只要这些字段在网关、控制面、Bridge 和 Worker 四层都能贯通，后续排查“为什么这个会话恢复错了”“为什么事件没回来”“为什么产物落错目录”会轻松很多。

### 小结

运维指标的重点不是追求数量，而是围绕会话稳定性、桥接稳定性和 Worker 承载稳定性建立最小闭环。

## 6. 实施顺序与演进建议

### 6.1 MVP 推进顺序

建议第一版按下面顺序推进：

1. 先建设 `Metadata Store` 和 `Session Control Plane` 的基础表结构与 Worker 注册机制。
2. 再实现 `ACP Bridge` 的会话打开、输入转发和事件订阅三条主链路。
3. 建立 `business_session_id -> worker_id -> acp_session_id` 的稳定映射。
4. 将 OpenCode Worker 封装成可注册、可心跳、可被摘流的有状态执行节点。
5. 打通产物归档、关键日志和最小指标。
6. 最后再补空闲恢复、Worker draining 和失败显式化处理。

这条顺序的好处是很克制。它不要求一开始就做完整多租户编排，也不要求一开始就做跨机恢复，只要求先把真实会话稳定承接住。

### 6.2 第二阶段演进

当第一版稳定后，再考虑下面这些演进会更合理：

- 将 Worker 运行环境容器化，补强执行隔离。
- 为 Control Plane 增加更细的容量调度与标签路由。
- 为 Bridge 增加多接入端协议支持，例如企业 IM 或 IDE 插件。
- 把会话快照与恢复语义做得更细，而不是只依赖本地存活状态。
- 将产物、日志、审计和成本核算真正打通。

### 6.3 实施上的几个边界提醒

第一，不要把 `ACP` 直接写成“原生 HTTP 协议服务”，这和当前代码不符。第二，不要把 OpenCode Worker 写成“天然无状态服务”，这和 `acp/session.ts`、`pty/index.ts`、`worktree/index.ts`、`instance-state.ts` 的实现不符。第三，不要把控制面写成“现成已具备完整调度平台能力”，当前代码里的 control-plane 更接近工作区与目标抽象，不等于企业级会话调度中心已经现成存在。第四，不要在第一版里承诺跨机透明恢复，因为这需要比当前实现更强的会话快照与执行恢复能力。

### 小结

实施设计的关键，不是把图画得多大，而是让每一层承担它当前代码真的撑得住的职责。只要这条线守住，部署方案就既现实，又有演进空间。
