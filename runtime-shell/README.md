# Runtime Shell

`runtime-shell` 是仓库外置的 ACP 运行壳，用来通过 `opencode` 提供多用户会话工作台。

默认情况下，`runtime-shell` 拉起的 ACP 子进程会启用 `OPENCODE_ACP_NEXT=1`，优先走 `acp-next` 入口。
如果需要临时回退，可以在运行环境里显式设置 `OPENCODE_ACP_NEXT=0`。

## 功能

- 本地多用户登录
- 会话创建、打开、恢复、关闭、分支
- 真实 ACP 子进程接入
- 模式 / 模型 / 配置切换
- SSE 事件流
- 附件上传（图片/文本/二进制资源）
- 交互提问（ACP Elicitation / QuestionTool）

## 本地启动

```bash
cd runtime-shell
bun install
bun run dev
```

访问 `http://localhost:3000`

## Docker

```bash
cd runtime-shell
docker compose up --build
```

访问 `http://localhost:3100`（runtime-shell），`opencode-worker` 仅在容器网络内暴露 `4096`。

首次启动时，`runtime-shell` 会在仓库根目录的 `.opencode/opencode.jsonc` 中自动初始化运行时配置；
该目录已通过 Docker 挂载持久化，前端保存的 `apiKey` 和 Provider 配置在容器重建后仍会保留。

## 默认账号

- `admin / change-me`
- `developer / change-me`
- `developer-secondary / change-me`

## E2E

当前仓库内置了 4 组可重复执行的端到端脚本：

- `bun run e2e:smoke`
  - 服务端基础链路：登录、创建会话、打开、发送消息、读取详情、关闭
- `bun run e2e:scope`
  - 多用户作用域边界：工作区隔离、会话不可见、事件流不可越权访问
- `bun run e2e:share`
  - 工作区共享权限：共享前不可见、共享后可协作、共享工作区不允许新建会话、受限动作禁止
- `bun run e2e:web`
  - 前端浏览器联调：登录、创建会话、`工作区共享` 面板、`Worker 运行视图`、共享后协作受限提示

前端联调脚本依赖 `playwright`：

```bash
cd runtime-shell
bun install
bun run e2e:web
```

如需指定部署地址或账号，可使用环境变量：

```bash
RUNTIME_SHELL_WEB_BASE_URL=http://127.0.0.1:3100 \
RUNTIME_SHELL_WEB_ADMIN_USERNAME=admin \
RUNTIME_SHELL_WEB_ADMIN_PASSWORD=change-me \
RUNTIME_SHELL_WEB_SHARED_USERNAME=developer-secondary \
RUNTIME_SHELL_WEB_SHARED_PASSWORD=change-me \
bun run e2e:web
```
