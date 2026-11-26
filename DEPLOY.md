# 部署指南

把「录音豆拜访 → 销售易」部署到一家新公司。有两种方式：

| 方式 | 适合 | 身份 | 需要的东西 |
|---|---|---|---|
| **A. 豆包工作伙伴（推荐）** | 全员使用 | 每个销售用自己的飞书 + 销售易身份 | 飞书租户开通豆包工作伙伴；`scripts/aily-deploy.mjs` 自动配置 |
| B. 自托管服务 | 试点、或没有豆包工作伙伴 | 一个销售易授权账号 | 一台常开的机器；`node src/cli.mjs init` 自动配置 |

---

## A. 豆包工作伙伴（aily）

豆包工作伙伴里已经有官方的「销售易 CRM」连接器（走销售易 MCP，每个人用 OAuth 自己授权）和「飞书妙记」连接器，所以这一方式**不需要任何服务器**：建一个工作伙伴，装上连接器和本仓库的两个技能，写好提示词。

**总原则：查询直接执行；任何写入销售易的操作都必须销售本人明确确认。**（技能和提示词里都写死了，草稿没人确认只会提醒，不会自动写入。）

### 一键配置

```bash
git clone https://github.com/xignzuan5/visit2crm.git && cd visit2crm
npm install && npm install -g agent-browser   # 脚本用 agent-browser 驱动浏览器
XSY_ENV=production XSY_USER=<销售易账号> XSY_PASS=<销售易密码> node scripts/aily-deploy.mjs [--subscribe]
```
脚本第一次运行会弹出浏览器窗口，**用飞书手机端扫一次码**（登录态存在 `.secrets/aily-browser-profile`，之后在后台无界面运行）。然后自动完成：

1. 新建工作伙伴「拜访录入助手」（个人使用）
2. 安装「销售易 CRM」连接器，用上面的销售易账号完成 OAuth 授权（`XSY_ENV`：`production` / `sandbox`）
3. 上传技能 `skills/visit-to-xsy`（拜访录入）和 `skills/xsy-sales-assistant`（查商机、快到期/久未跟进、拜访准备、记一笔、晨报）。技能里的表格编号在仓库里是 `{{recording_base.…}}` 占位符，上传前按 `config/app.json` 的 `recording_base` 段填好（缺了会直接报错，不会把占位符传上去）
4. 写入提示词：伙伴档案 `aily/IDENTITY.md`、行为准则 `aily/SOUL.md`
5. 加 `--subscribe` 时，为**当前登录账号**开启 `aily/automations.json` 里的两个自动化（已存在则更新）
6. 记下工作伙伴的飞书对话链接（给介绍卡片的按钮用）

每一步可重复执行：已有的连接器跳过、技能更新为新版本、提示词覆盖、自动化更新。

### 让销售用起来

1. **发能力介绍卡片**（三张配图在 `aily/images/`，由 GPT 生成）：
   ```bash
   node scripts/send-intro-card.mjs --chat <销售群 chat_id>     # 或 --user <open_id>
   ```
   卡片介绍四项能力，并带「和拜访录入助手对话」按钮。
2. **每个销售自己开启**（自动化属于个人账号，只处理本人的数据）：在和「拜访录入助手」的对话里说
   - 「**开启自动录入**」：每小时处理自己的新录音豆妙记（`aily/automations.json` 第 1 项）
   - 「**订阅晨报**」：工作日 8:30 收销售晨报（第 2 项）；「取消晨报」关闭
3. 第一次用到销售易时，工作伙伴会请他授权一次销售易（OAuth），之后都以他本人身份读写。

用户故事和验收标准见 [docs/USER-STORIES.md](docs/USER-STORIES.md)；查询口径用 `node scripts/verify-sales-assistant.mjs` 在自己的销售易里跑一遍验证。

### 手工配置（脚本失效时照做，界面以实际为准）

1. aily.feishu.cn → 市场 → 工作伙伴 →「+ 自定义工作伙伴」→「个人使用」→ 描述填 `aily/IDENTITY.md` 里「身份」那一句 → 创建。
2. 详情 → 能力 → 连接器 →「+」→ 搜「销售易 CRM」→ 安装 → 选环境 → 登录授权；确认同时有官方「飞书妙记」。
3. 能力 → 技能 →「+」→「上传技能」→ 先运行 `node scripts/build-skills.mjs visit-to-xsy xsy-sales-assistant`，再分别上传生成的 `.cache/visit-to-xsy.zip`、`.cache/xsy-sales-assistant.zip`。**不要直接打包 `skills/` 目录**，那里的表格编号是占位符。
4. 指令 → 伙伴档案 / 行为准则 →「编辑个性化」→ 全部替换为 `aily/IDENTITY.md` / `aily/SOUL.md` → 保存。
5. 自动化 → 新建 → 手动创建，按 `aily/automations.json` 填（定时：每隔 1 小时 / 自定义 cron `0 30 8 * * 1-5`）。

### 可选：实时触发（多维表格 → 工作伙伴）

默认每小时处理一次。要做到录完即处理：工作配方把录音豆纪要写进多维表格 → 多维表格工作流（新增记录 → HTTP 请求）→ **签名中转** `relay/aily-webhook-relay.mjs` → aily 自动化「Webhook 触发」。
aily Webhook 要求每次请求做 HMAC 签名，多维表格的 HTTP 节点算不了，所以中间必须有这个中转（部署成 Cloudflare Worker 或任意云函数，环境变量 `AILY_WEBHOOK_URL` / `AILY_WEBHOOK_SECRET` / `RELAY_TOKEN`）。签名请求已实测能触发（`dispatched: true`）。

---

## B. 自托管服务

代码不用改，要换的只有三样：飞书登录、销售易授权、`config/app.json`（由 `init` 命令自动生成）。

### 0. 先确认三件事

| 事项 | 为什么要先确认 | 找谁 |
|---|---|---|
| 销售易租户已开通 **MCP** | 写跟进记录、推进商机阶段都通过销售易 MCP（`https://mcp.xiaoshouyi.com/mcp`），并遵守租户的阶段规则（不可跨阶段、阶段审批、关键字段） | 销售易客户成功 |
| 客户录音可以交给 **Claude** 处理 | 拜访录音含客户信息，涉及数据出境合规。不允许的话，把 `src/extract.mjs` 换成国内模型（只改这一个文件） | 法务 / IT |
| 飞书管理员能**审核发布企业自建应用** | 读妙记、写多维表格、发卡片都需要应用权限 | 飞书管理员 |

### 1. 准备环境

- Node.js ≥ 20
- [lark-cli](https://github.com/larksuite/cli)：`npm install -g @larksuite/cli`
- 本项目：`git clone https://github.com/xignzuan5/visit2crm.git && cd visit2crm && npm install`

### 2. 飞书

1. 在 [飞书开放平台](https://open.feishu.cn/app) 创建**企业自建应用**，开启**机器人**能力。
2. 绑定到 lark-cli：
   ```bash
   lark-cli config init            # 填 App ID / App Secret
   lark-cli auth login --recommend # 用试点销售本人的飞书账号授权
   ```
3. 确认应用有这些权限，并提交管理员审核发布：
   | 用途 | 权限 |
   |---|---|
   | 搜索、读取妙记 | `minutes:minutes.search:read` `minutes:minutes.basic:read` `minutes:minutes.artifacts:read` |
   | 多维表格 | `base:app:create` `base:table:read` `base:record:read` `base:record:create` `base:record:update` |
   | 发 / 更新确认卡片 | `im:message`（机器人身份） |
   | 通讯录查人（`add-user`） | `contact:user:search` |
4. （可选）在开放平台「事件与回调」订阅：
   - `card.action.trigger`：卡片上的「确认写入 / 忽略」按钮生效。不订阅的话，销售在多维表格里改状态确认。
   - `minutes.minute.generated_v1`：妙记生成后实时处理。不订阅的话，每隔几分钟搜索一次新妙记。

### 3. 销售易 MCP 授权

```bash
node scripts/xsy-mcp-login.mjs start
```
打开输出的链接 → 选环境（**生产环境**；有企业标识的选「企业标识登录」；测试用「沙箱环境」）→ 登录销售易。
浏览器会跳到一个打不开的 `http://localhost:8765/callback?code=…` 页面，复制地址栏整段：
```bash
node scripts/xsy-mcp-login.mjs finish '<复制的地址>'
```
令牌保存在 `.secrets/xsy-mcp-token.json`，有效期 6 小时，程序会自动续期。

### 4. 初始化

```bash
export ANTHROPIC_API_KEY=...
node src/cli.mjs init --env production        # 测试环境用 --env sandbox
```
`init` 会依次：检查飞书登录 → 检查 Claude 密钥 → 用销售易 MCP 读出你的销售易用户 / 部门和「拜访、电话」活动记录类型 → 新建多维表格「录音豆拜访 → 销售易」→ 生成 `config/app.json`。
已有表格可以用 `--base <base_token> --table <table_id>` 指定。

加其他销售：
```bash
node src/cli.mjs add-user 张三      # 姓名或邮箱；在飞书通讯录和销售易用户里各找到唯一一人才会加入
```

### 5. 试跑

```bash
node src/cli.mjs add <妙记链接>   # 用一条真实的录音豆拜访妙记
node src/cli.mjs process          # AI 整理 + 匹配客户商机 + 发确认卡片
# 在多维表格里检查「跟进内容 / 建议阶段」，把状态改成「确认写入」
node src/cli.mjs write            # 写入销售易
```
到销售易里核对：商机下多一条跟进记录；如果有建议阶段，商机已经推进过去（不可跨阶段的租户会逐级推进）。

没有真实录音时，用 `scripts/make-test-audio.sh` 合成一段模拟拜访（macOS），上传生成妙记后再试。注意：AI 匹配客户时只会在**该销售自己负责的客户**里找，测试前先在销售易里建好对应的客户和商机。

### 6. 常驻运行

```bash
node src/cli.mjs listen --every 5   # 卡片回调实时处理 + 每 5 分钟同步/整理/写入/超时处理
```
用 pm2、launchd 或 systemd 守护，只跑一个实例，多个实例可能重复写入。

### 7. 安全

- `.secrets/` 里是飞书以外的全部凭证（销售易令牌），文件权限 600，不要提交、不要拷给别人。
- `config/app.json` 含租户内的表格和人员 ID，已在 `.gitignore` 里。
- 当前版本只保存**一个**销售易授权（`init` 时登录的人），所有跟进记录以这个账号写入（会尝试把负责人设为名单里的实际销售，是否允许取决于该账号在销售易的权限）。草稿超过 24 小时没确认只提醒一次，不会自动写入。要让每个销售各自授权，用方式 A。
