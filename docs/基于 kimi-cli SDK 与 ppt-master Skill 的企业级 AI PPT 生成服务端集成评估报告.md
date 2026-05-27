# 企业级 AI PPT 生成服务端集成评估报告

## 1. 文档目的与结论摘要

本文评估将 ppt-master Skill（SVG 中间格式路线）封装为面向企业端的 AI PPT 生成网页服务的可行性、架构方案与实施工作量。核心问题是：将一个原本在 Agent 环境中交互式运行的 PPT 生成管线，改造为具备用户体系、认证鉴权、任务调度、多节点部署能力的独立 Web 服务，需要解决哪些问题，以及分几步走。

先说明两个核心组件的关系。ppt-master 是一套完整的 SVG→PPTX 生成管线，采用 LLM 手写 SVG 页面 → Python 后处理 → 导出 PPTX 的技术路线。它本身不是服务端 API，而是在 Agent 工作流中运行的交互式工具集。因此集成方案的核心不是"选哪个 Agent 框架"，而是"如何把 ppt-master 的交互管线自动化，然后接上一层 Web 服务和用户体系"——Agent 框架只是一个用来驱动管线的工具，无论用 Kimi SDK、opencode 自带的 Agent 引擎，还是其他支持 function calling 的 SDK，原理上都能实现。

| 评估项 | 结论 | 说明 |
| --- | --- | --- |
| 技术可行性 | 可行 | 管线本身全 Python，可封装为服务端模块；Agent 框架选型不构成瓶颈 |
| 集成复杂度 | 中等偏高 | 核心难点：逐页 SVG 手写的交互流程需要自动化 |
| 核心风险 | LLM SVG 输出不稳定 | Executor 要求 LLM 手写 SVG，输出稳定性是最大隐患 |
| 用户体系 | 需从零构建 | ppt-master 不涉及用户管理 |
| 多用户并发 | 取决于 LLM 吞吐 + 存储 IOPS | 15 页 PPT 约需 16-21 次 LLM 调用，耗时 3-8 分钟 |
| 水平扩展 | 可分阶段实施 | 初期 NFS 共享存储 + 多 Worker，超 200 日任务后迁移无共享架构 |
| 预计工期 | 4-6 周 | 含用户体系、管线自动化、前端界面、并发治理、多节点部署 |

ppt-master 不是"调个 API 就能快速出稿"的轻量方案，而是依赖长上下文 Agent 循环的高质量路线。但如果只追求效率、容忍模板化风格，备选方案中有一条 PptxGenJS 快速渲染通道值得考虑。

---

## 2. 核心组件能力与框架选型

### 2.1 Agent 框架选择分析

驱动 ppt-master 管线的核心引擎是 Agent 框架——它负责编排 Strategist、Executor、QA 三个阶段的 LLM 调用循环。关键不在于选哪个特定 SDK，而在于框架必须支持两个能力：一次性生成（适合 Strategist 的设计分析输出）和多轮工具调用（适合 Executor 逐页生成 SVG + 校验 + 重试）。以下三个方案都满足要求：

**Kimi SDK**（MoonshotAI 开源）薄封装 Kosong 库，提供 `generate()` 和 `step()` 两个核心 API，支持流式回调和自定义工具注册。优点是接口简洁、依赖轻量、与内网 OpenAI 兼容模型天然适配。缺点是 skill 加载机制是 CLI 设计，服务端集成时需要将 SKILL.md 手动注入为 system prompt。

**opencode Agent 引擎**是当前开源的agent工具，已包含完整的 Agent 循环、Skills 系统和 LLM 调用能力。优势skill 加载机制天然适配，不需要移植指令——唯一需要做的是将交互式流程自动化。如果选择在 opencode 内构建服务，可以绕过一些管线移植工作，但需要解决 ACP 协议到 Web HTTP 的转换。

**其他 OpenAI 兼容 Agent 框架**（LangChain、Semantic Kernel、自定义实现等）同样可用。核心要求只有一个：支持 function calling 格式的工具调用，让 Agent 能自主决定逐页生成和修复循环。

三者的根本能力区别不大，下面以最通用的方式描述方案——不绑定具体框架，只描述 Agent 需要完成的 5 个工具调用和 3 个阶段转换。

### 2.2 ppt-master Skill 管线能力

ppt-master 的核心技术路线是 SVG 中间格式——LLM 手写 SVG 页面，Python 脚本后处理，最终导出 PPTX。所有脚本位于 `scripts/` 目录，全 Python。管线流程如下：

```
Source → Project Init → [Template] → Strategist → [Image_Gen] → Executor → QA → Finalize → Export PPTX
```

各阶段的职责和产出如下。

源处理阶段将用户提供的 PDF、DOCX、URL 或 Markdown 等源材料转换为统一的 Markdown 格式，无源材料时走 `topic-research` 工作流进行网络搜集。项目初始化阶段通过 `project_manager.py init` 创建完整的目录结构——`sources/`、`images/`、`svg_output/`、`svg_final/`、`notes/`、`exports/` 等子目录各司其职。模板阶段是可选的，仅在用户明确提供模板目录路径时触发，否则跳过走自由设计。

Strategist 阶段是整个管线最核心的设计环节。Agent 扮演"策略师"角色，输出两个产物。`design_spec.md` 是人可读的设计叙事文档，包含八项确认（画布格式、页数范围、目标受众、风格目标、配色方案、图标用法、字体系列、图片用法）和逐页内容大纲。`spec_lock.md` 是机器可读的执行契约，YAML 格式，包含色彩方案的精确 hex 值、字体方案的字体系列和字号、以及每页的 `page_rhythm`、`page_layouts` 和 `page_charts` 引用。spec_lock 是后续 Executor 阶段必须严格遵循的执行依据。

图片获取阶段按需执行——只有当 design_spec 的图片需求清单标明了需要 AI 生成或网络搜索时才触发。

Executor 阶段是最复杂也最耗时的环节。Agent 扮演"执行者"角色，逐页手写 SVG 代码。关键规则有四点。一是 Pre-generation batch read——在生成第一页 SVG 之前，一次性读入所有布局模板和图表模板。二是 Per-page spec_lock re-read——每生成一页前重新读取 spec_lock，抵抗长上下文中语义漂移。三是 Sequential page generation——逐页生成，不允许批量。四是 Main-agent only——SVG 生成必须在当前主 Agent 上下文中完成，不能委托给子 Agent。

Post-processing 阶段分三步依次执行：SVG 质量检查检测禁用特性、viewBox 不匹配、spec_lock 漂移等问题；SVG 后处理做图标嵌入、图片裁剪嵌入、文本展平、圆角矩形转路径；最后通过 `svg_to_pptx.py` 导出最终 PPTX。

设计系统定义在 `references/` 目录中，涵盖 SVG 禁用特性黑名单、PPTX 兼容约束、布局模式库、色域规则等。服务端集成时这个目录必须整个移植。

---

## 3. 企业级服务端架构设计

### 3.1 架构总览

ppt-master 的管线特性决定了这是一个 LLM 调用密集型和文件系统密集型的服务。每份 15 页 PPT 约需 16-21 次 LLM 调用，加上多次 Python 脚本执行，这些脚本都有本地文件系统依赖。架构设计必须考虑 Worker 的工作目录隔离和 I/O 性能。

推荐的五层架构如下：

```
┌──────────────────────────────────────────────────────────────┐
│                        用户交互层                              │
│  Web 前端（React + Vite）                                     │
│  注册/登录 | 主题输入 | 源文件上传 | 参数配置 | 进度 | 预览/下载  │
├──────────────────────────────────────────────────────────────┤
│                       API 网关层                               │
│  FastAPI                                                      │
│  用户认证（JWT）| 接口路由 | 文件上传 | SSE 进度推送 | 配额校验 │
├──────────────────────────────────────────────────────────────┤
│                      业务编排层                                │
│  任务调度（Celery + Redis）| Agent 引擎                        │
│  Strategist 设计 agent | Executor 逐页 agent | QA 修复 agent  │
├──────────────────────────────────────────────────────────────┤
│                      PPT 管线执行层                            │
│  ppt-master Python 脚本集（容器内虚拟环境）                    │
│  LibreOffice（PDF 预览转换）| ImageMagick（图片处理）          │
├──────────────────────────────────────────────────────────────┤
│                      基础设施层                                │
│  PostgreSQL | Redis | MinIO/S3 | LLM API Gateway              │
└──────────────────────────────────────────────────────────────┘
```

用户交互层是 React 前端，API 网关层负责鉴权和路由，业务编排层是核心——Agent 引擎（框架无关）驱动 Strategist 和 Executor 两个主要阶段，Celery 保证异步执行。管线执行层运行 ppt-master 的原生 Python 脚本，基础设施层提供数据库、缓存、存储和 LLM 接入。

### 3.2 用户体系设计

从零构建的话，以下按子系统展开。

**认证全流程**。注册走参数校验 → 重复性检查 → bcrypt 哈希 → 写入用户表（状态 pending）→ 发送 6 位验证码（有效期 15 分钟）→ 校验 → 激活。密码强度要求至少 8 位，包含大小写字母和数字。登录时先查用户是否存在，检查账户锁定状态，再 bcrypt 校验密码。连续 5 次失败锁定 15 分钟。成功后生成 Access Token 和 Refresh Token，记录审计日志。密码重置先生成一次性重置 Token（15 分钟有效），新密码 bcrypt 后更新，同时使所有已签发的 Refresh Token 失效。

**JWT 双 Token 机制**。Access Token 有效期 30 分钟，无状态自验证，不落库。Refresh Token 有效期 7 天，SHA256 哈希为键存储在 Redis 中，TTL 等于有效期。Refresh Token 绑定设备指纹（User-Agent 哈希），续期时指纹不匹配则拒绝。注销时从 Redis 删除键，立即失效。

**用户三层隔离**。数据库层通过 `user_id` 和 `team_id` 双键过滤，任何 SELECT 必须带 `WHERE user_id = :current_user_id`。文件系统层按 `{user_id}/{task_id}/` 组织目录。对象存储层通过路径前缀 `user_{id}/` 隔离，下载 URL 签名鉴权。

**多租户隔离**（企业版）。数据通过 `tenant_id` 索引 + WHERE 过滤。模板库按 `templates/{tenant_id}/` 路径前缀隔离。配额是租户级池子，Redis atomic DECR 扣减。任务队列支持租户标签，可配置优先级。计费按 tenant_id 聚合。

**API Key 管理**。第三方集成通过 API Key（格式 `ppt_sk_xxxxxxxx`），SHA256 哈希后存储，原始 Key 仅创建时展示一次。支持过期时间、权限范围和速率限制。

**安全防护**。IP 级限流 100 req/min，用户级 300 req/min，API Key 级按配置。文件上传只允许 pdf/docx/pptx/md/txt 五种类型，上限 50MB。日志中 API Key、密码、Token 仅保留前 4 位。所有敏感操作记录审计日志。

### 3.3 Agent 管线服务化方案

将 ppt-master 的交互式工作流改造为服务端自动管线，需要解决三个关键改造点。整个方案不依赖特定 Agent 框架——无论用 Kimi SDK、opencode Agent 引擎还是其他框架，核心逻辑一致。

**Strategist 自动化**。原生 ppt-master 的 Eight Confirmations 需要用户逐一回复确认。服务化改造后，用户在 Web 前端一次性预选设计参数（配色、字体、风格、页数），这些参数作为 API 请求传入，Agent 输出设计规范后自动进入 Executor。当用户未主动选择配色方案时，Agent 根据主题关键词自动推荐。

**Executor 后台化**。原生要求 Main Agent 在同一聊天上下文中逐页手写 SVG。服务化后需要一个支持多轮工具调用的 Agent 框架来驱动逐页生成循环：读 spec_lock 获取约束 → 生成该页 SVG → lxml 校验（禁用元素、色值精度、viewBox 范围）→ 校验通过则写文件并推送进度 → 不通过则追加纠错提示后重生成（最多 3 次）→ 进入下一页。整个循环自动执行，用户通过 SSE 看到进度。这是整个管线中 Agent 框架调用最密集的环节，因此框架的 tool calling 稳定性和并发能力是关键考量。

**QA 自动修复循环**。所有 SVG 生成完毕后，运行 `svg_quality_checker.py` 做完整检测。发现 error 项时，Agent 读取问题描述，定位到对应页面，修改 SVG 后重新校验。最多跑 3 轮。

### 3.4 任务调度与状态管理

PPT 生成是长耗时操作（一份 15 页 PPT 约需 3-8 分钟），必须异步处理。通过 Celery 任务队列加 Redis Broker 管理。任务状态机流转如下：

```
created → queued → strategist → image_acq → executor(逐页) →
qa_pass → finalize → export → completed
                                       ↘ failed → fix_loop → executor(重入)
```

每个任务维护完整的元数据——创建者、当前状态、进度百分比、SSE 事件通道、错误信息、Token 消耗统计。前端通过 EventSource 订阅 SSE 通道接收实时进度：

```
event: progress
data: {"phase": "executor", "message": "正在生成第 7/15 页...", "percent": 55}
```

任务完成后自动上传 PPTX 到对象存储，前端拿到下载 URL。

### 3.5 并发容量与多节点水平扩展

ppt-master 的本地文件系统依赖使得多节点部署不能简单地把所有服务无状态化后水平扩展。先看各组件状态：

| 组件 | 状态类型 | 多节点策略 |
| --- | --- | --- |
| FastAPI 网关 | 无状态 | Nginx 负载均衡，水平扩展 |
| Redis | 有状态（内存） | 主从 + Sentinel 集群 |
| PostgreSQL | 有状态（持久化） | 主从复制 + PgBouncer 连接池 |
| PPT Worker | 本地文件临时有状态 | 需共享存储或 S3 传递中间产物 |
| MinIO/S3 | 有状态（对象存储） | 自带分布式能力 |

Worker 层的文件系统问题有两个方案。

**共享存储方案**（推荐初期使用）。所有 Worker 挂载同一 NFS 或 GlusterFS，项目目录共享。零代码改造成本，但 NFS 有 IOPS 瓶颈。适合日并发 200 个任务以内。

**无共享架构**（高并发推荐）。每个 Worker 用本地 SSD，阶段间通过 S3 传递中间产物——Worker A 执行 Strategist 后上传设计产物，Worker B 下载后执行 Executor，Worker C 下载后做最终导出。彻底消除 NFS 瓶颈，但需改造 project_manager 等脚本增加 S3 后端，改造量约 1-2 周。

| 对比维度 | 共享存储 | 无共享架构 |
| --- | --- | --- |
| 原理 | 所有 Worker 挂载同一 NFS | 本地 SSD + S3 传递中间产物 |
| 优点 | 零代码改造 | 无 NFS 瓶颈，IOPS 高，支持跨地域 |
| 缺点 | NFS IOPS 有限 | 需改造脚本增加 S3 后端 |
| 适用规模 | 日并发 ≤ 200 | 日并发 200+ 或跨机房 |
| 改造量 | 0 | 约 1-2 周 |

---

## 4. ppt-master 管线移植的关键改造

| 改造项 | 说明 | 工作量 |
| --- | --- | --- |
| 环境容器化 | 脚本依赖（python:3.11-slim + LibreOffice + poppler）打包为 Docker 镜像 | 1-2 天 |
| Strategist 自动化 | Eight Confirmations 改为前端预选参数，Agent 输出后自动流转 | 3-5 天 |
| Executor 循环 | Agent 驱动后台逐页生成 SVG，含 spec_lock 重读 + 校验 + 重试 | 1-2 周 |
| QA 自动修复 | 质量检查 → 发现问题 → Agent 修复 → 重校验 | 3-5 天 |
| 项目文件管理 | 任务目录从创建到 24h 后自动清理的完整生命周期 | 1-2 天 |

文档参考方面，ppt-master 的 `references/` 目录定义了全部技术约束（SVG 禁用特性黑名单、PPTX 兼容约束、Executor 布局模式等），服务端集成时必须完整移入项目。

---

## 5. 实施路线图

| 阶段 | 内容 | 工期 |
| --- | --- | --- |
| 第一阶段 | 基础框架 + 用户体系（认证/配额/API Key/鉴权中间件/前端页面） | 1 周 |
| 第二阶段 | ppt-master 管线移植 + Agent 编排（Strategist/Executor/QA 自动化） | 1-2 周 |
| 第三阶段 | 前端生成页面 + 完整交互（风格配置/实时进度/预览下载/历史记录） | 1 周 |
| 第四阶段 | 并发治理 + 多节点部署（共享存储/Celery/HPA/监控/灰度/企业版） | 1-2 周 |

第一阶段搭建基础框架和用户体系。包括 FastAPI 项目骨架、PostgreSQL 加 Alembic 数据库初始化、完整的用户认证流程、JWT 鉴权中间件、配额管理、文件上传接口、React 前端项目搭建（Vite + shadcn/ui + TanStack Query）、登录注册和仪表盘页面。

第二阶段进行 ppt-master 管线移植和 Agent 编排实现。包括脚本依赖容器化打包、Agent 工具调用定义（Strategist/Executor/QA）、管线循环实现、SSE 进度推送、MinIO 对象存储集成。这个阶段产出一个可运行的 PPT 生成 API。

第三阶段开发前端生成页面和完整交互体验。包括主题输入和源文件上传、配色和字体可视化选择器、SSE 驱动的实时进度条、PPTX 加 PDF 预览下载、历史记录页面、配额不足提示。

第四阶段解决并发治理和多节点部署。包括 Celery 任务队列接入、共享存储 NFS 挂载、Worker 节点部署和健康检查、Nginx 负载均衡、PostgreSQL 主从复制加 PgBouncer、日志聚合加 Grafana 监控、告警规则、灰度发布、企业版功能。

---

## 6. 关键风险

最大的风险是 LLM SVG 输出不稳定。Executor 阶段要求 LLM 手写 SVG，模型可能在长上下文中忘记禁用元素规则或漂移颜色值。应对策略是每次生成后用 lxml 做 Schema 校验，校验失败后追加纠错提示重生成（最多 3 次），temperature 设为 0.3。

| 风险 | 等级 | 应对 |
| --- | --- | --- |
| Worker 崩溃任务中断 | 🟡 中 | Celery ack_late + 超时重入队 |
| LLM API 并发限制 | 🟡 中 | 任务队列控并发 + 内网模型部署 |
| 多节点运维复杂度 | 🟢 低 | Docker/K8s + 统一配置中心 |
