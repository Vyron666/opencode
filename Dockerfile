# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.14

WORKDIR /workspace

ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV OPENCODE_SERVER_USERNAME=opencode
ENV OPENCODE_SERVER_PASSWORD=

RUN apt-get update -o Acquire::Retries=3 \
  && apt-get install -y --no-install-recommends -o Acquire::Retries=3 ca-certificates libstdc++6 ripgrep git bash python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock bunfig.toml turbo.json ./
COPY .github/TEAM_MEMBERS ./.github/TEAM_MEMBERS
COPY packages ./packages
COPY patches ./patches

# 中文/English: install the workspace as-is and run opencode from source to avoid fragile single-binary packaging in Docker.
# /////// runtime-shell customization start ///////
# 中文/English: runtime-shell relies on the compose runtime volume mount for `.opencode`.
# Do not copy `.opencode` during image build, otherwise local builds can fail when `.dockerignore` excludes it.
# /////// runtime-shell customization end ///////
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --backend copyfile --linker hoisted --cache-dir /root/.bun/install/cache

# 中文/English: Bun hoisted workspace links may point at /workspace/node_modules/.bun/* even when that tree is missing in Docker.
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

EXPOSE 4096

ENTRYPOINT ["bun", "/workspace/packages/opencode/src/index.ts"]
CMD ["web", "--hostname", "0.0.0.0", "--port", "4096"]
