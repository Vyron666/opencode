# runtime-shell 远端 Worker 执行改造方案

## 1. 文档目标

本文定义 `runtime-shell` 从“多节点调度与治理”演进到“多节点真实执行承载”的最小改造方案。

目标是：

1. 让多个 `opencode-worker` 真正分担多用户对话、思考、工具调用和子进程负载。
2. 优先不修改 `opencode` 原有核心代码，只改 `runtime-shell` 和 worker 包装层。
3. 保持现有 P2 的调度、lease、heartbeat、failure、透明恢复能力继续成立。

本文不追求一次性做全量平台化，只定义最小可落地闭环。

## 2. 当前现状

当前多节点能力已经真实做到：

1. `runtime-shell` 可以按 worker 状态、容量、心跳、会话负载分配会话。
2. `worker` 节点已经真实存在，heartbeat / lease / failure / failover / transparent recovery 已打通。
3. 多个 `opencode-worker` 可以作为独立节点参与调度与治理。

当前还没有做到：

1. 对话运行的 ACP runtime 没有在目标 `opencode-worker` 节点内启动。
2. 模型调用、思考过程、工具调用、文件扫描、子进程执行等负载没有真正分摊到不同 worker。
3. `session.workerId` 当前更多是“归属和治理口径”，不是“真实执行位置”。

通俗解释：

1. 现在是 `runtime-shell` 负责“真正干活”。
2. `opencode-worker` 当前负责“被调度、被探活、被治理”。
3. 会话虽然记账到不同 worker，但实际 ACP 进程仍由 `runtime-shell` 本地拉起。

所以如果目标是“多用户时不同 worker 真实承担对话和工具负载”，当前实现还不够，必须继续改造。

## 3. 设计原则

### 3.1 总原则

1. 优先不改 `opencode` 原代码。
2. 优先复用现有 `opencode` CLI / serve / ACP 能力。
3. 新增一层 worker 执行代理，把 `runtime-shell` 与真实执行隔开。
4. 先做最小闭环，再补恢复、观测、故障治理深水区。

### 3.2 不改 `opencode` 的边界定义

本文中的“不改 `opencode` 原代码优先”指：

1. 不优先修改 `packages/opencode` 现有核心业务逻辑。
2. 不把远端执行能力直接侵入现有 `opencode` 会话流程。
3. 优先通过新增 worker 代理层来调用现有能力。

允许的改造范围优先级：

1. 只改 `runtime-shell`。
2. 新增独立的 `runtime-worker-agent` 包装层。
3. 调整 docker / 部署 / 配置 / 脚本。
4. 只有在现有能力完全不够时，才考虑给 `opencode` 增加极小暴露面。

### 3.3 成功定义

只有同时满足下面条件，才能算“多 worker 真实分担执行负载”：

1. 一个会话被调度到哪个 worker，ACP runtime 就真正在哪个 worker 上启动。
2. 这个会话的 prompt、模型调用、工具调用、文件操作、取消、关闭都由该 worker 执行。
3. `runtime-shell` 只做控制面、会话治理、持久化、SSE 广播，不再承担主要执行负载。
4. worker 挂掉后，会话能被收敛并在需要时透明恢复。

## 4. 目标架构

### 4.1 目标职责边界

#### runtime-shell

`runtime-shell` 继续承担：

1. 用户登录、权限校验、workspace 访问边界。
2. session 元数据持久化。
3. worker 调度、lease 治理、failure 治理。
4. 会话事件落库与 SSE 广播。
5. 透明恢复编排。

`runtime-shell` 不再承担：

1. 本地拉起 ACP runtime。
2. 持有本地 `AcpProcessClient` 作为执行主句柄。
3. 执行 prompt、工具调用、子进程运行。

#### runtime-worker-agent

每个 worker 节点新增一个轻量执行代理，建议命名为 `runtime-worker-agent`。

它承担：

1. 在 worker 本机拉起和持有 ACP runtime。
2. 对外暴露远端执行 API。
3. 管理远端 runtime 生命周期、事件流和租约。
4. 向 `runtime-shell` 提供 runtime 查询和重连入口。

#### opencode

`opencode` 优先保持不变，只作为被复用的现有执行能力提供方。

### 4.2 目标调用链路

目标链路从：

`runtime-shell -> 本地 AcpProcessClient -> 本地 ACP runtime`

改成：

`runtime-shell -> runtime-worker-agent -> worker 本地 AcpProcessClient -> worker 本地 ACP runtime`

这里最关键的变化是：

1. `runtime-shell` 从“执行者”变成“编排者”。
2. `opencode-worker` 从“治理节点”升级为“真实执行节点”。

## 5. 推荐落地方式

## 5.1 推荐方案：新增 runtime-worker-agent

推荐在每个 worker 节点旁边新增一个代理层，而不是直接侵入 `opencode`。

推荐原因：

1. 改动面最小。
2. 回滚最简单。
3. 可以渐进切换，先保留本地执行路径作为开发期 fallback。
4. 远端协议、租约、事件流、恢复逻辑都可以沉淀在代理层，不污染 `opencode` 核心。

### 5.2 worker-agent 的部署形态

优先顺序建议如下：

1. 与 `runtime-shell` 同仓新增 `runtime-worker-agent` 服务目录。
2. 跟 `opencode-worker` 一起打到同一个镜像里，以不同进程启动。
3. 也可以独立容器部署，但第一阶段不建议把部署复杂度拉太高。

建议第一阶段采用：

1. 一个 worker 节点内保留现有 `opencode-worker`。
2. 新增一个本地 HTTP 代理 `runtime-worker-agent`。
3. `runtime-shell` 只访问 `runtime-worker-agent`，不直接访问本地 ACP client。

## 6. 远端执行协议

## 6.1 会话执行协议

第一阶段最小协议建议如下。

### `POST /runtime/openSession`

用途：

1. 在 worker 本机创建新的 ACP runtime。
2. 返回远端 runtime 引用和能力信息。

请求建议字段：

```json
{
  "businessSessionId": "sess_xxx",
  "workspacePath": "/workspace/workspaces/u_xxx/ws_xxx",
  "workerId": "worker_local_2",
  "requestedBy": "user_xxx",
  "requestId": "req_xxx"
}
```

响应建议字段：

```json
{
  "remoteRuntimeId": "rrt_xxx",
  "remoteSessionId": "acp_xxx",
  "leaseOwner": "runtime-shell",
  "leaseExpireAt": "2026-05-29T12:00:00.000Z",
  "models": [],
  "modes": [],
  "configOptions": []
}
```

### `POST /runtime/loadSession`

用途：

1. 在 worker 本机加载已存在的 ACP session。
2. 场景是会话重新打开，但 worker 上已有可继续使用的 session 标识。

### `POST /runtime/resumeSession`

用途：

1. 恢复远端 runtime 执行态。
2. 用于会话 reopen / transparent recovery。

### `POST /runtime/forkSession`

用途：

1. 在目标 worker 上基于源 session 创建 fork。
2. 第一阶段可限制为“仅同 worker fork”，避免跨 worker 状态复制过早复杂化。

### `POST /runtime/sendPrompt`

用途：

1. 将用户输入发送给远端 runtime。
2. prompt 的真正执行、思考、模型调用、工具调用都在该 worker 侧发生。

### `POST /runtime/cancelPrompt`

用途：

1. 取消当前 prompt。
2. 由远端 worker 真正向本机 ACP runtime 发 cancel。

### `POST /runtime/closeSession`

用途：

1. 关闭远端 runtime。
2. 释放 worker 本地占用的进程、句柄和租约。

## 6.2 事件流协议

事件流是远端化成败的关键，建议优先采用“worker 推送到 runtime-shell”的模式。

### `POST /runtime/events/push`

用途：

1. worker 将 ACP 上游事件推送给 `runtime-shell`。
2. `runtime-shell` 统一做 `persistAndFanout`，保持现有 SSE 口径不变。

请求建议字段：

```json
{
  "workerId": "worker_local_2",
  "remoteRuntimeId": "rrt_xxx",
  "businessSessionId": "sess_xxx",
  "events": []
}
```

优点：

1. `runtime-shell` 仍然保持事件入库和广播中心地位。
2. 前端不需要感知 worker 变化。
3. 现有 session event 体系可以最大程度复用。

备选方案：

1. `runtime-shell` 拉 worker 事件流。
2. 第一阶段不建议优先做拉模式，因为长连接管理和断线重连会更复杂。

## 6.3 运行态查询协议

这些接口主要服务治理、恢复和观测。

### `GET /runtime/:remoteRuntimeId`

返回：

1. 当前 runtime 是否存在。
2. 当前是否有 active prompt。
3. 最近事件时间。
4. leaseOwner / leaseExpireAt。
5. worker 本地 runtime 状态。

### `POST /runtime/:remoteRuntimeId/lease/renew`

用途：

1. 由 `runtime-shell` 定时续租。
2. 明确 runtime 仍归当前控制面持有。

### `GET /runtime/:remoteRuntimeId/heartbeat`

返回：

1. runtime 级最后活动时间。
2. worker 本地存活信息。

### `GET /runtime/:remoteRuntimeId/failure`

返回：

1. 最近失败原因。
2. 最近退出码。
3. 最近异常时间。

## 7. 远端 binding 结构改造

当前 binding 更偏向本地 runtime 视角，后续要改成远端引用视角。

建议将 session binding 扩展为下面结构：

```ts
{
  workerId: "worker_local_2",
  transport: "remote",
  remoteRuntimeId: "rrt_xxx",
  remoteSessionId: "acp_xxx",
  leaseOwner: "runtime-shell",
  leaseExpireAt: "2026-05-29T12:00:00.000Z",
  recoverToken: "rct_xxx",
  openedAt: "2026-05-29T11:00:00.000Z"
}
```

关键变化：

1. 不再依赖本地进程句柄作为唯一事实来源。
2. `workerId` 和真实执行位置一致。
3. `remoteRuntimeId` 成为后续 open / resume / cancel / close / query 的核心锚点。
4. `recoverToken` 预留给透明恢复和重连鉴权。

## 8. 事件流改造建议

## 8.1 改造目标

从：

1. 本地 `AcpProcessClient` 直接把事件交给 `persistAndFanout`

改成：

1. worker 本地 ACP runtime 产出事件。
2. `runtime-worker-agent` 收集事件并打包。
3. 事件推送给 `runtime-shell`。
4. `runtime-shell` 统一落库、广播、更新 session 状态。

## 8.2 保持不变的部分

下面这些尽量保持在 `runtime-shell` 不变：

1. session event schema。
2. SSE 对前端的出流方式。
3. `persistAndFanout` 的中心位置。
4. session lifecycle service 的状态收敛逻辑。

这样能把远端化的影响面收敛在 runtime 边界，不扩散到前端和大量业务服务。

## 9. 恢复链路改造建议

## 9.1 恢复判定

透明恢复需要明确区分两类情况。

### 情况 A：worker 还活着

这时优先做：

1. 查询 `remoteRuntimeId` 是否仍存在。
2. 若存在，则走 `loadSession` 或 `resumeSession`。
3. 成功后延续原 worker，不做跨节点漂移。

### 情况 B：worker 已离线

这时做：

1. 治理循环把会话收敛到 `orphaned`。
2. 用户重新打开会话时重新调度到其他 ready worker。
3. 新 worker 上重建 runtime。

## 9.2 恢复原则

1. 优先原 worker 重连，减少无意义漂移。
2. 只有原 worker 不可用时才做跨 worker 重建。
3. 前端感知应尽量收敛为“重新打开后继续工作”，避免让用户理解底层节点细节。

## 10. 哪些地方优先不改 opencode

优先不改 `opencode` 的部分：

1. 对话执行逻辑。
2. 工具调用逻辑。
3. ACP runtime 具体内部行为。
4. 现有 OpenCode 服务主流程。

优先新增的部分：

1. `runtime-shell` 远端执行客户端。
2. `runtime-worker-agent` 服务。
3. 远端 runtime 注册表。
4. 远端 lease / heartbeat / failure 接口。
5. 远端事件转发与恢复编排。

## 11. 可能卡住的边界

如果坚持不改 `opencode`，必须先验证下面能力是否已足够复用：

1. worker 本机是否能稳定编程式创建 ACP session。
2. worker 本机是否能稳定 load / resume 已有 session。
3. worker 本机是否能稳定拿到持续事件流。
4. worker 本机是否能可靠 cancel / close。
5. worker 本机是否能给外层代理提供足够稳定的 session 标识。

如果这些能力不能稳定复用，才考虑最小补口，补口原则如下：

1. 只补导出入口，不改原有业务行为。
2. 只补执行代理所需的最小编程接口。
3. 不把多租户、lease、调度、恢复治理逻辑塞进 `opencode`。

## 12. 分阶段改造建议

## 12.1 第一阶段：真实远端 open / close 最小闭环

目标：

1. `runtime-shell` 不再本地 `new AcpProcessClient`。
2. 会话被分配到哪个 worker，就在哪个 worker 打开 runtime。
3. close 也由该 worker 真正执行。

范围：

1. 新增 `runtime-worker-agent`。
2. 新增 `openSession / closeSession / runtime query`。
3. `runtime-shell` 新增远端 runtime client。
4. session binding 落远端引用字段。

验收：

1. 两个用户同时开会话时，可以看到两个不同 worker 各自拉起本地 ACP runtime。
2. `runtime-shell` 容器内不再出现这些会话对应的 ACP 子进程。

## 12.2 第二阶段：sendPrompt / cancel / 事件转发闭环

目标：

1. prompt 真正在目标 worker 执行。
2. 工具调用和思考负载真正分散。
3. `runtime-shell` 仍保持统一事件中心。

范围：

1. 新增 `sendPrompt / cancelPrompt / events/push`。
2. 把当前本地 runtime 事件监听改成远端事件推送接入。

验收：

1. 多用户并发发 prompt 时，不同 worker 的 CPU / 子进程 / 工具调用负载有明显分担。
2. 前端会话流式事件显示与现在保持一致。

## 12.3 第三阶段：resume / load / lease renew / 透明恢复

目标：

1. 用户打开已有会话时尽量无感恢复。
2. worker 活着时优先重连，worker 挂了时可重建。

范围：

1. 新增 `loadSession / resumeSession / lease/renew`。
2. 治理循环接入远端 runtime 查询口径。
3. 恢复逻辑区分“重连”和“重建”。

验收：

1. 用户停几分钟再回来，原会话能继续。
2. 单个 worker 挂掉后，会话可被收敛并恢复。

## 12.4 第四阶段：fork、故障注入与治理深水区

目标：

1. 补齐 fork 等边界能力。
2. 覆盖长期驻留、竞争恢复、重复 close、重复 cancel 等治理复杂场景。

## 13. 代码改造落点建议

建议优先改这些位置：

1. `runtime-shell/server/src/runtime`
   - 把本地 `AcpProcessClient` 直连改成远端 runtime client 抽象。
2. `runtime-shell/server/src/services/runtime-governance`
   - 接入远端 lease renew / remote runtime query / recovery 编排。
3. `runtime-shell/server/src/services/scheduler`
   - 保持现有能力为主，只补“远端执行能力可用性”判断。
4. `runtime-shell/server/src/http/routes`
   - 新增 worker 回推事件入口和必要治理查询入口。
5. 新增 `runtime-shell/worker-agent` 或等价目录
   - 实现远端执行代理。

## 14. 测试与验收口径

必须新增的专项验证：

1. 多 worker 真执行验证
   - 确认 ACP 子进程真实出现在目标 worker，而不是 `runtime-shell`。
2. 多用户并发验证
   - 多人同时发 prompt，确认思考和工具负载跨 worker 分散。
3. 故障注入验证
   - kill 单个 worker，验证收敛和恢复。
4. lease 验证
   - 续租正常、过期收敛正常、恢复后 lease 重新绑定正常。
5. 事件一致性验证
   - 前端看到的事件顺序、session 状态、permission/question 流程不能乱。

建议验收标准：

1. `runtime-shell` 只剩控制面负载，没有主要 ACP 执行负载。
2. 至少 3 个 worker 节点下，多用户会话可以真实分散执行。
3. 单节点故障不会导致整个系统不可继续使用。
4. 用户重新打开已有 session + 对应 workspace 后，可以继续工作。

## 15. 风险与取舍

主要风险：

1. 现有 `opencode` 编程入口可能不足以支撑完整代理层。
2. 事件推送的可靠性和顺序性要专门验证。
3. 跨 worker fork 和跨 worker 恢复比基础远端执行更复杂，不应过早做大。

建议取舍：

1. 先解决“真实执行位置”和“真实负载分担”。
2. 再补治理深水区。
3. 不要第一阶段就追求全功能跨 worker 漂移。

## 16. 结论

如果目标是让 `opencode-worker` 真正分担用户对话、思考和工具调用负载，当前必须继续改造。

最稳妥、最符合现阶段约束的方案是：

1. 不优先改 `opencode` 原代码。
2. 新增 `runtime-worker-agent` 作为 worker 本地执行代理。
3. 把 `runtime-shell` 从本地执行者改造成远端编排者。
4. 先完成远端 open / prompt / cancel / close / event push / resume 的最小闭环。

只有完成这一步，才能真正保证：

1. 不同会话被分配到不同 worker。
2. 不同 worker 真实承担对话运行、思考和工具调用工作。
