# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.14

WORKDIR /workspace

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  -o Acquire::Retries=3 \
  && apt-get install -y --no-install-recommends -o Acquire::Retries=3 ca-certificates libstdc++6 ripgrep git bash python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock bunfig.toml turbo.json ./
COPY .github/TEAM_MEMBERS ./.github/TEAM_MEMBERS
COPY packages ./packages
COPY patches ./patches

RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --backend copyfile --linker hoisted --cache-dir /root/.bun/install/cache

# 中文/English: mirror missing .bun targets so runtime ACP imports can resolve workspace symlinks inside Docker.
RUN mkdir -p /workspace/node_modules/.bun \
  && find /workspace/packages -path '*/node_modules/*' -type l | while read -r link; do \
    target="$(readlink "$link")"; \
    case "$target" in \
      *node_modules/.bun/*/node_modules/*) \
        bun_path="${target#*node_modules/.bun/}"; \
        bun_key="${bun_path%%/node_modules/*}"; \
        pkg_path="${bun_path#*/node_modules/}"; \
        if [ ! -e "/workspace/node_modules/.bun/$bun_key/node_modules/$pkg_path" ] && [ -e "/workspace/node_modules/$pkg_path" ]; then \
          mkdir -p "/workspace/node_modules/.bun/$bun_key/node_modules/$(dirname "$pkg_path")"; \
          ln -s "/workspace/node_modules/$pkg_path" "/workspace/node_modules/.bun/$bun_key/node_modules/$pkg_path"; \
        fi; \
      ;; \
    esac; \
  done

WORKDIR /app

COPY runtime-shell/package.json runtime-shell/bun.lock runtime-shell/tsconfig.json ./
RUN bun install

COPY runtime-shell/server ./server
COPY runtime-shell/web ./web
COPY runtime-shell/config ./config
COPY runtime-shell/.env.example ./.env.example

# Build the React frontend (Vite)
WORKDIR /app/web
RUN bun install && bun run build

WORKDIR /app

ENV OPENCODE_ACP_ENTRY=/workspace/packages/opencode/src/index.ts
ENV OPENCODE_ACP_SPAWN_CWD=/workspace

EXPOSE 3000

# 中文/English: always migrate before boot so DB-backed session bootstrap never races schema rollout.
CMD ["sh", "-lc", "bun server/src/db/migrate.ts && bun server/src/index.ts"]
