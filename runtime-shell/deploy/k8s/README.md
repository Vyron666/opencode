# runtime-shell Kubernetes Deploy

本目录提供 `runtime-shell` 企业生产部署骨架，目标架构是：

- `runtime-shell` 作为控制面 Deployment
- `worker-agent` 作为执行面 Deployment
- `sandbox runtimeClass` 通过 `gvisor` 或 `kata` 接入

使用方式：

1. 先根据实际镜像仓库修改 `runtime-shell.yaml` 与 `worker-agent.yaml` 中的镜像地址。
2. 根据集群环境选择 `sandbox-runtimeclass-gvisor.yaml` 或 `sandbox-runtimeclass-kata.yaml`。
3. 把数据库、对象存储、外部模型网关、MCP 网关等生产依赖替换为企业实际地址。
4. 生产默认应使用：
   - `RUNTIME_SHELL_SANDBOX_BACKEND=gvisor` 或 `kata`
   - `RUNTIME_SHELL_SANDBOX_RUNTIME_CLASS=gvisor` 或 `kata`
   - 受控 egress proxy / NetworkPolicy

说明：

- 这里交付的是 `P7` 的生产接入骨架，不是完整的 Kubernetes controller。
- `worker-agent` 仍通过统一的 ACP/HTTP 协议接入，不要求修改 `packages/opencode` 原代码。

## 当前实现边界

- `RUNTIME_SHELL_SANDBOX_BACKEND=gvisor|kata` 当前仍复用 Docker sandbox manager，并映射到 Docker runtime 参数。
- 本目录 YAML 是生产部署骨架和 runtimeClass 接入口，不代表已经实现 Kubernetes sandbox Pod 调度/controller。
- 如需完整生产执行面，还需要单独实现 Kubernetes backend，负责创建 sandbox Pod、挂载 workspace、回收 Pod、采集资源与同步状态。
