`docker-data/` 用于 Docker 运行时挂载，不提交真实运行数据。

- `.opencode/` 配置目录现在直接使用仓库根目录 `.opencode/` 持久化，不再走 `docker-data/config/`
- `opencode/`：运行时数据目录，包含数据库、日志、会话状态等
- `runtime-shell-opencode/`：`runtime-shell` 自己的 OpenCode 数据目录，避免与 `opencode-worker` 共享本地状态

仓库只保留目录骨架与占位文件：

- `docker-data/opencode/.gitignore`
- `docker-data/opencode/.gitkeep`
- `docker-data/runtime-shell-opencode/.gitkeep`

以下内容属于运行产物，不应提交：

- `docker-data/opencode/*.db`
- `docker-data/opencode/log/`
- `docker-data/opencode/storage/`
- `docker-data/opencode/tool-output/`
- `docker-data/runtime-shell-opencode/*.db`
- `docker-data/runtime-shell-opencode/log/`
- `docker-data/runtime-shell-opencode/storage/`
- `docker-data/runtime-shell-opencode/tool-output/`
