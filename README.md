# 录音豆拜访 → 销售易

销售用飞书**录音豆**录客户拜访 → 飞书妙记 → AI 整理成跟进记录、按 **MEDDPICC** 提取商机情报、判断商机阶段 → 销售在飞书确认 → 写入**销售易**（新增跟进记录 + 推进商机阶段 + 回填联系人角色 / 竞争对手 / 项目预算）。

两种运行方式，部署步骤见 **[DEPLOY.md](DEPLOY.md)**：

- **A. 豆包工作伙伴（推荐）**：一个工作伙伴「拜访录入助手」+ 官方「飞书妙记」「销售易 CRM」连接器 + 本仓库的两个技能（`visit-to-xsy` 拜访录入、`xsy-sales-assistant` 查商机/晨报/记一笔）+ 提示词 `aily/`。`node scripts/aily-deploy.mjs` 一键配置，无需服务器；`scripts/send-intro-card.mjs` 给销售发能力介绍卡片。
- **B. 自托管服务**：本仓库的 Node 程序，多维表格做状态和确认界面。`node src/cli.mjs init` 一键配置。

另有 **[销售画像工作台](workbench/)**：给销售总监看的团队六维画像、维度归纳和派单推荐，是飞书妙搭应用。目前用虚构演示数据，还没接真实拜访和销售易。

下面是方式 B 的说明。

## 流程

```
录音豆录音 ──自动同步──▶ 飞书妙记
                           │ ① 同步：工作配方 /「sync」命令把新妙记写进多维表格（状态=待处理）
                           ▼
                多维表格「拜访记录」── 每行一条妙记，用「状态」推进
                           │ ② 整理：读 AI 总结+逐字稿 → Claude 抽取要点 → 销售易查客户/商机 → 判断阶段
                           ▼
                  状态=待确认，飞书机器人给销售发确认卡片
                           │ ③ 确认：卡片按钮，或在表格里把状态改成「确认写入」（可先改跟进内容/建议阶段）
                           ▼
                  状态=确认写入 ──▶ ④ 写入销售易：新建活动记录 + 更新商机阶段 → 状态=已写入，卡片变绿
                  24 小时未确认 ──▶ 再提醒一次；不确认就不写（所有写入都必须销售确认）
```

## 运行

```bash
npm install
# 依赖：lark-cli 已登录（lark-cli auth status）、ANTHROPIC_API_KEY、销售易 MCP 授权（见下）

# 销售易 MCP 授权（一次性；之后自动续期）
node scripts/xsy-mcp-login.mjs start            # 打开输出的链接 → 选「沙箱环境」→ 登录
node scripts/xsy-mcp-login.mjs finish <回调URL>  # 浏览器跳到 localhost:8765/callback?... 时，把地址栏整段贴进来

node src/cli.mjs add <妙记链接>     # 手动加一条妙记（= 把妙记转给工作伙伴）
node src/cli.mjs process            # 整理并发确认卡片
node src/cli.mjs write              # 写入「确认写入」的行
node src/cli.mjs tick               # 同步 + 整理 + 写入 + 超时处理（定时任务跑这个）
node src/cli.mjs listen --every 3   # 常驻：卡片回调 + 每 3 分钟 tick
```

配置在 `config/app.json`：多维表格、销售易地址、活动记录类型、阶段列表、销售名单（飞书 open_id ↔ 销售易用户ID/部门）。

## 目录

| 路径 | 作用 |
|---|---|
| `src/lark.mjs` | 飞书：妙记搜索/读取、多维表格读写、卡片发送/更新（全部走 lark-cli） |
| `src/xsy-mcp-adapter.mjs` | 销售易 MCP（默认）：搜客户/商机、读阶段流程、建跟进记录、按规则逐级推进阶段、商机情报回写（先 dryRun） |
| `src/deal.mjs` | 商机情报 → 建议更新（项目预算、联系人角色、竞争对手），落不到字段的说明原因 |
| `src/xsy-mcp.mjs` | MCP 客户端（Streamable HTTP + OAuth，令牌自动续期） |
| `src/xsy.mjs` | 销售易 OpenAPI 备用通道（`config.xsy.mode = "openapi"`） |
| `scripts/xsy-mcp-login.mjs` | 销售易 MCP OAuth 登录 / 续期 |
| `src/extract.mjs` | Claude 抽取跟进要素 + 保守判断阶段（原话必须能在逐字稿里核对到） |
| `src/card.mjs` | 飞书确认卡片（Card 2.0） |
| `src/pipeline.mjs` | 状态机主流程 |
| `skills/visit-to-xsy/SKILL.md` | 同一流程的技能（方式 A 用），也可装进 OpenClaw / Claude Code |
| `aily/` | 豆包工作伙伴的提示词（伙伴档案、行为准则）和自动化任务配置 |
| `scripts/aily-deploy.mjs` | 方式 A 一键部署（驱动 aily 网页 + aily 内部接口） |
| `scripts/send-intro-card.mjs` + `aily/intro-card.mjs` + `aily/images/` | 能力介绍卡片：GPT 生成的设计图（头图、能力一览、三步开始，提示词见 `aily/images/PROMPTS.md`）；`scripts/preview-intro-card.mjs` 本地预览。录音豆按官方产品图作参考生成 |
| `scripts/verify-sales-assistant.mjs` | 在销售易里实测销售助手的每个查询口径 |
| `aily/automations.json` | 自动录入、销售晨报两个自动化的定义（部署脚本和技能共用） |
| `relay/aily-webhook-relay.mjs` | 可选：多维表格 → aily Webhook 的签名中转（实时触发） |
| `docs/USER-STORIES.md` | 用户故事与验收标准 |
| `src/setup.mjs` | 方式 B 的 `init` / `add-user` |
| `test-fixtures/` + `scripts/make-test-audio.sh` | 模拟拜访对话脚本，合成测试录音 |

## 版本号

整个仓库**一个发版号**，以下 4 处必须始终相同，改一处就要一起改：

| 位置 | 字段 |
|---|---|
| `package.json` / `package-lock.json` | `version` |
| `skills/visit-to-xsy/SKILL.md` | frontmatter `version` |
| `skills/xsy-sales-assistant/SKILL.md` | frontmatter `version` |
| `src/xsy-mcp.mjs` | MCP `Client({ name, version })` |

规则：语义化版本，`x.y.z`。技能内容变化（新增流程、改判断口径、修坑）记次版本 `y`，仅文案/措辞记补丁 `z`。两个技能不单独编号——它们是一套一起部署、一起验证的，各自编号只会让线上和仓库对不上（1.0.x 与 0.x 混用的教训）。

> 注意：aily 后台的技能版本号（`skillhub` 里显示的 1.0.11 之类）是**上传次数自动递增**，不读 frontmatter，和这里的发版号是两套，不要拿它对齐。

## 原型的已知限制

- **销售易接入**：默认走销售易 MCP（`https://mcp.xiaoshouyi.com/mcp`），身份是授权的那个销售本人。多个销售时，每人各自授权一次（原型目前只存一个人的令牌）。
- **阶段推进**：严格按销售易规则来。不允许跨阶段的租户会逐级推进，遇到阶段审批或必填关键信息就停下，表格里会写明原因。
- **卡片按钮回调 / 妙记生成事件**：需要在飞书开发者后台订阅（见下）。订阅前，确认改用表格改状态的方式；新妙记靠定时搜索发现（搜索索引有几分钟延迟）。
- **并发**：同一时间只能有一个 worker 在跑，否则可能重复写入。
