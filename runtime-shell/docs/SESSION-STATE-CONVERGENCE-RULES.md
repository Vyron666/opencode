# runtime-shell 会话状态收敛规则

## 1. 文档目标

本文定义 `runtime-shell` 在会话页中的状态来源、合并优先级、不变量与刷新规则，用来约束以下链路：

1. `session summary` 轮询摘要。
2. `session detail` 详情加载。
3. SSE 实时事件流。
4. 前端本地 optimistic / responding 状态。

本文只聚焦“会话状态如何收敛”，不展开权限模型、worker 调度或完整架构设计。

## 2. 本次问题的根因

本轮修复前，前后端存在两类状态撕裂：

1. 服务端 `session detail` 会把“已持久化事件历史”和“运行时内存中的 pendingQuestions / pendingPermissions”直接拼在一起。
2. 前端 `loadSessionDetail()` 收到 detail 后，会整包重建 `eventBuffer / conversationBlocks / pending* / responding*`。

这会导致两个典型问题：

1. `pendingQuestions` 仍然存在，所以主区还能显示“等待问题回答中”，但 `detail.events` 里还没有 `question_requested`，于是重建后的 `conversationBlocks` 没有问题卡片。
2. 用户刚提交回答或审批时，本地 `respondingQuestionIds / respondingPermissionIds` 已经进入“等待上游确认”状态，但一次较旧的 detail 刷新会把它们清空，导致表单重新可点。

这类问题不是 `question` 独有，`permission` 和未来任何“暂停等待用户交互”的块都可能重复出现。

## 3. 状态来源与职责边界

### 3.1 Session Summary

来源：
1. `/api/session/list`

职责：
1. 驱动左侧会话列表。
2. 提供轻量忙闲判断。
3. 决定是否需要触发一次 detail 收敛。

不负责：
1. 直接重建聊天块。
2. 直接覆盖当前 `eventBuffer`。

### 3.2 Session Detail

来源：
1. `/api/session/detail`

职责：
1. 提供当前会话的已持久化事件历史。
2. 提供可用于冷启动/刷新后的完整重建依据。
3. 作为“重新收敛”入口，而不是“强制回退”入口。

不负责：
1. 回退已经在本地 live SSE 中看见、但 detail 尚未持久化完成的事件。
2. 清空本地已进入 `responding_*` 的交互过渡态。

### 3.3 Live SSE

来源：
1. `/api/acp/session/events`

职责：
1. 提供当前会话的实时增量事件。
2. 优先承载实时 UI 更新。
3. 在 detail 尚未来得及追平时，临时成为“比 detail 更完整”的状态源。

### 3.4 Local UI State

来源：
1. 前端 store 本地状态。

职责：
1. 承载 optimistic sending 状态。
2. 承载 `respondingPermissionIds / respondingQuestionIds` 这类“已提交、待上游确认”的过渡态。
3. 在短时间窗口内保护用户交互，避免被旧 detail 刷回。

## 4. 核心不变量

以下规则必须长期成立：

1. 只要 `phase.id === waiting_question`，界面中必须存在对应的 `question` 交互块，或者存在已提交后的 question 响应中状态。
2. 只要 `phase.id === waiting_permission`，界面中必须存在对应的 `permission` 交互块，或者存在已提交后的 permission 响应中状态。
3. detail 刷新不得丢掉本地已经看见的 live 事件。
4. detail 刷新不得把本地 `respondingQuestionIds / respondingPermissionIds` 刷回为空，除非对应 request 已经被 resolved event 关闭。
5. `pending*` 是否可见，必须与事件历史中的 “requested but not resolved” 集合一致。
6. 会话是否 busy 不能只看 `status`，也不能只看 `pending*`；必须综合 `isSubmitting / isRunning / isCancelling / pending* / responding*`。

## 5. 合并优先级

### 5.1 Event Buffer 合并规则

`loadSessionDetail()` 收到 detail 时，不能直接用 `detail.events` 覆盖当前 `eventBuffer`。

正确规则：
1. 先保留 detail 返回的持久化事件顺序。
2. 再把当前本地 `eventBuffer` 中 detail 尚未包含的事件补回。
3. 去重依据是 `eventId`。

中文/English：detail 是 persisted truth，live SSE 是 fresher truth；收敛时必须“以 persisted 为底，再补本地更近的 live event”，而不是反过来整包覆盖。

### 5.2 Pending Interaction 合并规则

`pendingPermissions / pendingQuestions` 不能直接信任 detail 或本地任一单侧值。

正确规则：
1. 先从合并后的 `eventBuffer` 计算“当前仍 open 的 requestId 集合”。
2. 只允许 open 集合中的 requestId 出现在 `pending*` 中。
3. 如果某个 requestId 已经处于本地 `responding*`，则不能再回到 `pending*` 可点击状态。

### 5.3 Responding Interaction 合并规则

`respondingPermissionIds / respondingQuestionIds` 的优先级高于 detail 中的 `pending*`。

正确规则：
1. 本地 `responding*` 应继续保留，只要它对应的 requestId 在事件历史里仍然是 open。
2. 一旦收到 `*_resolved` 事件，才允许从 `responding*` 中清除。

## 6. 刷新规则

### 6.1 允许 summary 触发 detail 收敛的场景

`session list` 轮询可以触发 `loadSessionDetail()`，但只用于“状态重新对齐”，不是每次 eventCount 变化都重放。

当前合理场景：
1. `status` 变化。
2. `modelId` 变化。
3. `pendingPermissions.length` 变化。
4. `pendingQuestions.length` 变化。
5. `eventCount` 增长，且本地 busy/idle 与 summary busy/idle 不一致。
6. 当前会话没有健康跟随 active SSE。

### 6.2 不应触发 detail 重放的场景

以下场景不应因为 summary 轮询而直接重放 detail：

1. 纯 `eventCount` 增长，但增长只是正常 chunk 流式输出。
2. 本地 SSE 仍健康，且本地 busy/idle 与 summary 一致。
3. 没有结构性状态变化，只有 assistant chunk 继续增长。

## 7. 服务端一致性规则

服务端 `session detail / session summary` 必须遵守：

1. 在生成 detail/summary 视图前，先等待该会话当前挂起的事件写入队列收敛。
2. `eventCount` 必须基于已持久化事件长度。
3. `pendingPermissions / pendingQuestions` 只允许暴露那些在已持久化事件历史中已出现 `requested` 且尚未 `resolved` 的 request。

这样做的目的不是“让 pending 绝对实时”，而是保证 detail/summary 是自洽快照，避免“等待态出现了，但事件历史还没跟上”。

## 8. 同类风险清单

这次暴露的问题可以举一反三到以下块类型：

1. `question`
   风险：等待态存在，但交互块消失；已提交后被刷回可重复提交。

2. `permission`
   风险：与 `question` 完全同类。

3. `tool`
   风险：如果 detail 回放覆盖 live tool update，可能出现 pending/completed 闪回。

4. `todo / plan`
   风险：如果 detail 与 live 版本交错，可能出现旧计划覆盖新计划。

5. `assistant`
   风险：不应因 detail 重放打断正在进行的流式渲染；chunk-only 进展不应触发 detail 重放。

6. `status / error`
   风险：如果以旧 detail 回退，可能造成“状态 banner 与实际块内容不一致”。

因此后续新增任何依赖事件重建的块时，都必须先回答一个问题：
“如果 detail 比 live SSE 旧，这个块会不会被刷丢、刷旧、刷回可交互态？”

## 9. 代码落点

本次规则主要收敛在以下文件：

### 服务端

1. [runtime-events.ts](../server/src/runtime/runtime-events.ts)
   暴露会话事件写入队列等待点。

2. [session-summary-service.ts](../server/src/services/session/session-summary-service.ts)
   让 summary 的 `eventCount / pending*` 与已持久化事件视图一致。

3. [session-application-service.ts](../server/src/services/session/session-application-service.ts)
   让 detail 先等待写入收敛，再返回事件与摘要视图。

### 前端

1. [session-detail-sync-support.js](../web/src/store/actions/session-detail-sync-support.js)
   负责 detail 与 live/local state 的收敛合并。

2. [session-events.js](../web/src/store/session-events.js)
   提供事件集合、open interaction 集合、pending/responding 合并工具。

3. [session-list-sync-support.js](../web/src/store/actions/session-list-sync-support.js)
   决定何时触发 detail 收敛。

4. [sse-runtime.js](../web/src/store/sse/sse-runtime.js)
   负责 live SSE 对本地状态的实时推进。

## 10. 回归验证

本次已补的关键回归包括：

1. `session_detail_reload_keeps_visible_question_request`
   旧 detail 不得吃掉已出现的 `question_requested` 卡片。

2. `session_detail_reload_keeps_responding_question_state`
   detail 刷新不得把本地 question 响应中状态刷回可重复提交。

3. `session_detail_reload_keeps_responding_permission_state`
   detail 刷新不得把本地 permission 响应中状态刷回可重复提交。

4. 浏览器级 `question convergence`
   问题出现、提交、等待态退出的整链路验证。

5. 浏览器级 `permission convergence`
   审批出现、提交、等待态退出的整链路验证。

6. 浏览器级 streaming 回归
   保证本次收敛修复不会破坏 assistant 流式链路。

## 11. 后续新增功能时的检查清单

后续如果继续改会话态，提交前至少检查：

1. 这个改动新增了哪些状态源？
2. summary、detail、live SSE、local optimistic 之间谁是 source of truth？
3. 如果 detail 比 live 旧，UI 会不会回退？
4. 如果用户刚点提交，UI 会不会被旧 detail 刷回可重复点击？
5. 如果刷新页面，历史回放和实时态是否一致？
6. 是否补到了脚本级或浏览器级回归？

## 12. 一句话原则

`runtime-shell` 的会话页必须遵守：

“detail 用来收敛，不用来回退；live 用来增量推进，不用来单独定义真相；本地 responding 态在 resolved 之前必须被保护。”
