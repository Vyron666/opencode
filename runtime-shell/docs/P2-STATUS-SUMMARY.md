# P2 最终状态清单

本文用于给出 `runtime-shell` 当前 `P2` 的正式状态口径，明确区分：

1. 已完成
2. 还差什么
3. 哪些归 P3

本文只描述当前代码、部署方式和已完成回归所覆盖到的真实状态，不把未来设想、长期目标或未落地方案混入“已完成”。

## 1. P2 目标边界

`P2` 的核心目标是让系统具备“多节点运行时治理能力”，重点包括：

1. worker 注册、心跳、容量与可用状态治理
2. 会话与 worker 的绑定、调度、粘性路由与漂移收敛
3. 运行时 lease、failure、heartbeat 的完整治理链路
4. worker 故障后的会话收敛、恢复与透明继续使用
5. 用户重新打开自己的 `session` 和对应 `workspace` 后可以继续工作

`P2` 不要求一步到位做完所有平台化能力，但要求主链路真实可用、可观测、可恢复。

## 2. 已完成

### 2.1 多 worker 部署与调度

已完成：

1. 支持通过 `runtime-shell/config/local-workers.jsonc` 配置 worker 数量与容量。
2. 支持通过 `runtime-shell/scripts/sync-docker-compose-workers.ts` 生成多 worker compose。
3. 支持 `runtime-shell` 对多个 `opencode-worker` 进行调度、路由和基本治理。
4. 新会话会按容量和可用状态分配到不同 worker。
5. 已支持多用户、多会话分散到不同 worker。

当前状态：

1. 多个 `opencode-worker` 已真实参与会话承载。
2. `e2e:multi-worker-users` 已覆盖多用户、多 worker 分配链路。

### 2.2 会话绑定、粘性与历史恢复

已完成：

1. 新会话创建时会写入 worker 归属和 runtime binding。
2. 会话重开时优先走原 worker 粘性。
3. 历史会话支持 `open / load / resume`。
4. `created / completed / orphaned / failed` 等状态下有明确 reopen 行为。
5. 历史会话恢复时，已按最近有效 binding 同步恢复 `workerId + binding`，避免把旧 `acpSessionId` 漂到错误 worker。

当前状态：

1. 历史会话能力回填可用。
2. 历史会话重新打开、刷新、再次选中后可继续使用。
3. `e2e:web-history` 已通过。

### 2.3 lease / heartbeat / failure 治理

已完成：

1. runtime lease 创建、自动续租、释放。
2. worker heartbeat 采集与超时下线判定。
3. runtime failure 记录与详情查询。
4. 治理循环可将异常会话收敛到 `orphaned`。
5. worker 下线后，会话可恢复到其它可用 worker。

当前状态：

1. `e2e:governance` 已覆盖 lease 续租、worker 下线、会话 orphaned、跨 worker 恢复。
2. heartbeat / lease / failure 已有系统查询入口。

### 2.4 透明恢复与用户体验收口

已完成：

1. lease 时长已拉长。
2. 已增加 lease 自动续租。
3. 已把透明恢复接入会话打开链路。
4. prompt 完成或取消后的异步回调不会再错误把已关闭会话刷回 `active`。
5. 会话在打开或恢复过程中已限制重复发送，避免冷启动和首条消息重复叠加。
6. 创建会话后已做最小预热，减少首开冷启动成本。

当前状态：

1. 用户中途离开后，只要 `session` 和对应 `workspace` 还在，重新打开后可以继续工作。
2. 故障恢复已尽量朝“用户无感继续使用”收敛。

### 2.5 远端执行与最小观测

已完成：

1. `runtime-shell -> worker-agent -> worker 本地 ACP` 的远端执行链路已接通。
2. worker-agent 已支持远端查询：
   - `query-runtime`
   - `query-lease`
   - `query-heartbeat`
   - `query-failure`
3. `runtime-shell` 系统侧已能汇总 lease / heartbeat / failure / runtime detail。
4. 首开、首发、故障恢复链路已补充关键日志，便于定位性能瓶颈与治理异常。

当前状态：

1. 多 worker 治理与观测已对齐远端执行模式。
2. 运行时执行负载已经由远端 worker 实际承载，而不是只在 `runtime-shell` 本地执行。

### 2.6 权限与 workspace share

已完成：

1. 已从“共享 session”收敛为“共享 workspace”。
2. 共享 workspace 后，目标用户可看到该 workspace 下已有会话。
3. 被共享用户可 `read / open / load / resume / prompt / cancel / respond`。
4. 被共享用户不可 `close / fork / share / updateMode / updateModel / updateConfig`。
5. 共享工作区不会出现在被共享用户的新建会话工作区列表中。

当前状态：

1. `e2e:share`
2. `e2e:access`
3. `e2e:scope`

以上链路已完成回归覆盖。

### 2.7 前端 P2 收口

已完成：

1. 历史会话打开后的模式、模型、配置能力可正确回填。
2. Plan / Build 模式基础切换链路已接通。
3. 首条消息发送后的前端状态反馈已收口。
4. 会话切换、历史重开、刷新后回填等关键 UI 链路已覆盖。

## 3. 还差什么

以下项目不再属于 `P2` 主链路缺失，但仍然是当前系统的剩余整理项。

### 3.1 文档口径仍需继续统一

当前问题：

1. `ENTERPRISE-ROADMAP-P1-P3.md` 仍存在严重乱码。
2. 部分旧描述已经落后于当前实现。

影响：

1. 代码已完成能力与旧文档口径不完全一致。

结论：

1. `P2` 已完成，但文档仍需继续清理。

### 3.2 大文件仍需继续拆分

当前问题：

1. `runtime-shell/server/src/worker-agent/worker-agent-runtime.ts` 虽已首轮拆分，但仍可继续细化。
2. `runtime-shell/web/src/store/actions/session-actions.js` 仍然偏长。
3. `ChatView.jsx`、`chat-blocks.jsx`、`conversation-blocks.js` 也仍偏长。

结论：

1. 这是可维护性问题，不是 P2 功能缺失。

### 3.3 远端执行需要继续做更深回归

当前状态：

1. 远端执行主链路已经打通。
2. 多 worker 调度、故障切换、治理恢复已经可用。
3. 仍适合继续做更长时间、更高并发、更深故障注入的专项回归。

结论：

1. 这是 P2 完成后的持续增强，不是 P2 主目标未完成。

## 4. 哪些归 P3

以下内容不属于 P2，归入 P3 或 P3 前整理。

### 4.1 配置治理

包括：

1. provider / model / config 分层治理
2. 配置作用域与覆盖关系
3. 配置快照、审计、审批
4. 配置变更影响面分析

### 4.2 扩展治理

包括：

1. MCP / skill / provider 的启用策略
2. 扩展能力授权与审批
3. 扩展配置治理与审计

### 4.3 更平台化的观测与运维视图

包括：

1. 更系统的治理控制台
2. 指标、报表、长期趋势
3. 更细粒度告警与运维面板

## 5. 当前结论

当前结论如下：

1. `P2` 主目标已经完成。
2. 当前系统已经具备多 worker 部署、远端执行、运行时治理、lease 自动续租、worker 故障切换、透明恢复、workspace 共享访问、历史会话恢复等能力。
3. 剩余主要工作是：
   - 文档口径继续统一
   - 大文件继续拆分重构
   - 更深的专项回归与持续压测
4. 下一阶段应以 `P3 配置与扩展治理` 为主线，而不是继续无限扩张 P2 范围。
