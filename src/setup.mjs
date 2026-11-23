// 部署初始化：自动建多维表格、从销售易 MCP 读出当前用户和活动记录类型、生成 config/app.json
import { readFile, writeFile, access } from "node:fs/promises";
import { lark } from "./lark.mjs";
import { connectXsyMcp, callTool } from "./xsy-mcp.mjs";

export const CONFIG_PATH = "config/app.json";
const MCP_TOKEN = ".secrets/xsy-mcp-token.json";
const WEB_BASE = { production: "https://crm.xiaoshouyi.com", sandbox: "https://crm-sandbox.xiaoshouyi.com" };

export const TABLE_FIELDS = [
  { name: "妙记标题", type: "text" },
  { name: "状态", type: "select", multiple: false, options: ["待处理", "待确认", "确认写入", "已写入", "超时自动写入", "已忽略", "非客户拜访", "无匹配", "失败"].map((name) => ({ name })) },
  { name: "销售", type: "user", multiple: false },
  { name: "录音时间", type: "datetime" },
  { name: "妙记链接", type: "text", style: { type: "url" } },
  { name: "妙记Token", type: "text" },
  { name: "客户", type: "text" },
  { name: "商机", type: "text" },
  { name: "当前阶段", type: "text" },
  { name: "建议阶段", type: "text" },
  { name: "阶段依据", type: "text" },
  { name: "跟进方式", type: "select", multiple: false, options: [{ name: "拜访" }, { name: "线上会议" }, { name: "电话" }] },
  { name: "跟进内容", type: "text" },
  { name: "意向程度", type: "select", multiple: false, options: ["无意向", "略有意向", "意向一般", "意向较高", "意向极高"].map((name) => ({ name })) },
  { name: "销售易客户ID", type: "text" },
  { name: "销售易商机ID", type: "text" },
  { name: "销售易跟进记录ID", type: "text" },
  { name: "卡片消息ID", type: "text" },
  { name: "处理说明", type: "text" },
  { name: "创建时间", type: "created_at" },
];

const exists = (p) => access(p).then(() => true, () => false);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { throw new Error(msg); };

async function feishuSelf() {
  const st = await lark(["auth", "status"]).catch(() => null);
  const u = st?.identities?.user ?? st?.data?.identities?.user;
  if (!u?.available) fail("飞书未以用户身份登录：先执行 lark-cli config init（绑定企业自建应用），再执行 lark-cli auth login --recommend");
  return { openId: u.openId, name: u.userName };
}

async function mcpCall(name, args) {
  const c = await connectXsyMcp({ tokenFile: MCP_TOKEN });
  try {
    const r = await callTool(c, name, args);
    if (r?.success === false) fail(`销售易 MCP ${name} 失败：${JSON.stringify(r.error)}`);
    return r?.data?.result ?? r?.data ?? r;
  } finally {
    await c.close();
  }
}

/** 活动记录类型：按 apiKey / 名称映射 拜访、线上会议、电话 */
function mapActivityTypes(types) {
  const find = (pred) => types.find((t) => t.active !== false && pred(t));
  const visit = find((t) => t.apiKey === "busitype_visitsign") ?? find((t) => /拜访/.test(t.label));
  const call = find((t) => /电话/.test(t.label)) ?? find((t) => t.apiKey === "defaultBusiType");
  const meeting = find((t) => /会议/.test(t.label)) ?? visit;
  if (!visit) fail(`没找到「拜访」类的活动记录类型，现有类型：${types.map((t) => t.label).join("、")}。请在 config/app.json 手工填写 xsy.activity_entity_types`);
  return { 拜访: Number(visit.id), 线上会议: Number(meeting.id), 电话: Number((call ?? visit).id) };
}

export async function init({ env = "production", baseToken, tableId, force = false }) {
  if (!WEB_BASE[env]) fail(`--env 只能是 production 或 sandbox`);
  if ((await exists(CONFIG_PATH)) && !force) fail(`${CONFIG_PATH} 已存在。如需重新生成，加 --force`);

  console.log("1/5 检查飞书登录");
  const me = await feishuSelf();
  ok(`飞书用户：${me.name}`);

  console.log("2/5 检查 Claude API 密钥");
  if (!process.env.ANTHROPIC_API_KEY) console.log("  ! 未设置 ANTHROPIC_API_KEY，整理步骤会失败（可稍后再设置）");
  else ok("ANTHROPIC_API_KEY 已设置");

  console.log("3/5 检查销售易 MCP 授权");
  if (!(await exists(MCP_TOKEN))) fail("还没有销售易 MCP 授权：先执行 node scripts/xsy-mcp-login.mjs start，按提示登录后再 finish");
  const xsyMe = await mcpCall("user-detail", {});
  const types = (await mcpCall("metadata-entityBusinessTypes", { entity: "activityrecord" })).businessTypes ?? [];
  const activityTypes = mapActivityTypes(types);
  ok(`销售易用户：${xsyMe.name}（${xsyMe.department ?? "未知部门"}）`);
  ok(`活动记录类型：拜访=${activityTypes["拜访"]}，电话=${activityTypes["电话"]}`);

  console.log("4/5 准备多维表格");
  let base;
  if (baseToken && tableId) {
    base = { base_token: baseToken, table_id: tableId };
    ok("使用已有多维表格");
  } else {
    const res = await lark(["base", "+base-create", "--as", "user", "--name", "录音豆拜访 → 销售易", "--time-zone", "Asia/Shanghai",
      "--table-name", "拜访记录", "--fields", JSON.stringify(TABLE_FIELDS)]);
    const token = res.data.base.base_token;
    const tables = await lark(["base", "+table-list", "--as", "user", "--base-token", token]);
    base = { base_token: token, table_id: tables.data.tables[0].id, url: res.data.base.url };
    ok(`已新建多维表格：${res.data.base.url}`);
  }
  if (!base.url) {
    const info = await lark(["base", "+base-get", "--as", "user", "--base-token", base.base_token]).catch(() => null);
    base.url = info?.data?.base?.url ?? info?.data?.url ?? "";
  }
  if (base.url && !base.url.includes("table=")) base.url += `${base.url.includes("?") ? "&" : "?"}table=${base.table_id}`;

  console.log("5/5 写入配置");
  const cfg = {
    self_open_id: me.openId,
    base,
    xsy: {
      mode: "mcp",
      mcp_url: "https://mcp.xiaoshouyi.com/mcp",
      mcp_token_file: MCP_TOKEN,
      web_base: WEB_BASE[env],
      activity_entity_types: activityTypes,
      api_base: env === "sandbox" ? "https://api-sandbox.xiaoshouyi.com" : "https://api.xiaoshouyi.com",
      token_file: ".secrets/xsy-token.json",
      stages: [],
    },
    users: [{ feishu_open_id: me.openId, name: me.name, xsy_user_id: Number(xsyMe.userId), xsy_dept_id: Number(xsyMe.departmentId) }],
    match_only_own_accounts: true,
    timeouts: { remind_hours: 24, auto_write_hours: 48 },
  };
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
  ok(`已生成 ${CONFIG_PATH}`);
  console.log(`\n完成。试跑：node src/cli.mjs add <妙记链接> && node src/cli.mjs process`);
}

/** 把一个销售加进名单：按姓名/邮箱同时在飞书通讯录和销售易用户里查 */
export async function addUser(query) {
  const cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const fs = await lark(["contact", "+search-user", "--as", "user", "--query", query]);
  const fsUsers = (fs.data?.users ?? fs.data?.items ?? []).filter((u) => !u.is_cross_tenant);
  if (fsUsers.length !== 1) fail(`飞书通讯录里「${query}」匹配到 ${fsUsers.length} 人：${fsUsers.map((u) => `${u.localized_name}(${u.open_id})`).join("、") || "无"}。请换成更精确的姓名或邮箱`);
  const name = fsUsers[0].localized_name ?? query;
  const xs = (await mcpCall("user-search", { keyWord: name })).users ?? [];
  const exact = xs.filter((u) => u.name === name && u.status === 1);
  if (exact.length !== 1) fail(`销售易里「${name}」匹配到 ${exact.length} 个在职用户：${xs.map((u) => `${u.name}(${u.id})`).join("、") || "无"}`);
  const entry = { feishu_open_id: fsUsers[0].open_id, name, xsy_user_id: Number(exact[0].id), xsy_dept_id: Number(exact[0].depart) };
  cfg.users = cfg.users.filter((u) => u.feishu_open_id !== entry.feishu_open_id).concat(entry);
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
  ok(`已加入销售名单：${name}（飞书 ${entry.feishu_open_id} ↔ 销售易 ${entry.xsy_user_id}）`);
}
