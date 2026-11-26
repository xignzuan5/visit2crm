#!/usr/bin/env node
// 一键把「拜访录入助手」部署到豆包工作伙伴（aily）。
// 通过 agent-browser 驱动 aily 网页（aily 没有开放「创建工作伙伴」的 API）。
//
// 用法：
//   XSY_ENV=production XSY_USER=<销售易账号> XSY_PASS=<销售易密码> node scripts/aily-deploy.mjs [--agent-id agent_xxx] [--subscribe]
//   --subscribe：同时为当前登录账号开启 aily/automations.json 里的自动化（自动录入、销售晨报）。
//   --new：不复用 .secrets/aily-deploy.json 里记录的工作伙伴，新建一个（默认只复用，打不开就报错，不会重复创建）。
//                自动化属于个人账号；其他销售在对话里说「开启自动录入」「订阅晨报」自己开启。
//
// 需要人做的只有一件事：脚本打开浏览器后，用飞书手机端扫码登录（登录态保存在 .secrets/aily-browser-profile，下次免扫）。
// 每一步可重复执行：已存在的连接器/自动化会跳过，技能会更新为新版本，提示词会覆盖为仓库里的版本。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkill } from "./build-skills.mjs";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SESSION = process.env.AILY_SESSION || "aily-deploy";
const PROFILE = process.env.AILY_PROFILE || path.join(ROOT, ".secrets/aily-browser-profile");
const STATE = path.join(ROOT, ".secrets/aily-deploy.json");
const AGENT_NAME = "拜访录入助手";
const SKILLS = ["visit-to-xsy", "xsy-sales-assistant"];
const ENV_LABEL = { production: "生产环境", sandbox: "沙箱环境" }[process.env.XSY_ENV || "production"];
const argv = process.argv.slice(2);
const argAgent = argv.includes("--agent-id") ? argv[argv.indexOf("--agent-id") + 1] : null;
const SUBSCRIBE = argv.includes("--subscribe");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

// ---------------- agent-browser 封装 ----------------
// 无头浏览器 + 持久化 profile（登录态）。只在需要扫码登录时临时开一个有界面的窗口。
// 注意：profile 会恢复上次的多个标签页，被驱动的页面若不在最前面会被浏览器视为「后台」，
// 动画帧停摆、菜单打不开——所以启动后先关掉多余标签页。
let launched = false;
let headed = false;
async function ab(...args) {
  const pre = ["--session", headed ? `${SESSION}-login` : SESSION];
  if (!launched) { pre.push("--profile", PROFILE); if (headed) pre.push("--headed"); launched = true; }
  const { stdout } = await run("agent-browser", [...pre, ...args], { maxBuffer: 32 << 20 }).catch((e) => ({ stdout: e.stdout || "" }));
  return stdout;
}
async function closeBrowser() {
  await run("agent-browser", ["--session", headed ? `${SESSION}-login` : SESSION, "close"]).catch(() => {});
  launched = false;
}
async function singleTab() {
  const list = await ab("tab", "list");
  const n = (list.match(/\[\d+\]/g) || []).length;
  for (let i = n - 1; i >= 1; i--) await ab("tab", "close", String(i));
  await ab("tab", "0");
}
const snapshot = () => ab("snapshot");
async function ref(pattern) {
  const snap = await snapshot();
  // pattern 里自带 ref=e\d+ 时直接在原处捕获，否则取 pattern 之后同一行的 ref
  const re = pattern.includes("ref=e") ? new RegExp(pattern.replace("ref=e\\d+", "ref=(e\\d+)")) : new RegExp(`${pattern}[^\\n]*?ref=(e\\d+)`);
  return snap.match(re)?.[1] ?? null;
}
async function click(pattern, { required = true, wait = 1200 } = {}) {
  const r = await ref(pattern);
  if (!r) { if (required) throw new Error(`页面上没找到：${pattern}`); return false; }
  await ab("click", `@${r}`);
  await sleep(wait);
  return true;
}
async function js(code) {
  const out = (await ab("eval", code)).trim().split("\n").pop();
  try { return JSON.parse(out); } catch { return out; }
}
const url = async () => (await ab("get", "url")).trim();
const bodyText = async () => ab("get", "text", "body");
// aily 页面偶尔只渲染出外框、正文显示「load failed / reload」：自动刷新，最多 3 次
async function open(u, wait = 4000) {
  await ab("open", u);
  await sleep(wait);
  for (let i = 0; i < 3 && /load failed/i.test(await ab("get", "text", "body")); i++) {
    await ab("reload");
    await sleep(wait + 2000);
  }
}
async function waitFor(fn, { timeout = 60000, every = 2000, what = "页面" } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); }
  throw new Error(`等待超时：${what}`);
}

/** 打开下拉菜单：先点，菜单没出来就聚焦按钮按回车（aily 的菜单偶尔不响应模拟点击） */
async function openMenu(buttonPattern, itemPattern) {
  for (let i = 0; i < 8; i++) {
    if (await ref(itemPattern)) return;
    const b = await ref(buttonPattern);
    if (!b) throw new Error(`页面上没找到：${buttonPattern}`);
    if (i % 2 === 0) { await ab("focus", `@${b}`); await ab("press", "Enter"); } else { await ab("click", `@${b}`); }
    await sleep(1500 + i * 500);
  }
  if (!(await ref(itemPattern))) throw new Error(`菜单没有展开：${buttonPattern}`);
}

/** 富文本编辑器整体替换为 Markdown（先真实按键清空，再模拟粘贴，编辑器会按 Markdown 解析） */
async function replaceEditor(markdown) {
  await js(`(()=>{const el=document.querySelector("[contenteditable=true]");el.focus();const r=document.createRange();r.setStart(el,0);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);
  await ab("press", "Meta+a"); await ab("press", "Delete"); await ab("press", "Backspace");
  const len = await js(`document.querySelector("[contenteditable=true]").innerText.trim().length`);
  if (len > 2) throw new Error("编辑器没有清空，停止以免把新旧内容混在一起");
  await js(`(()=>{const el=document.querySelector("[contenteditable=true]");el.focus();const dt=new DataTransfer();dt.setData("text/plain",${JSON.stringify(markdown)});el.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true}));return el.innerText.length})()`);
}

// ---------------- 步骤 ----------------
async function login() {
  await open("https://aily.feishu.cn/", 6000);
  await singleTab();
  // 登录过期时会被跳到 accounts.feishu.cn / accounts.doubao.com 的扫码页，那里没有「登录」按钮，所以要同时看地址
  // 页面刚打开时地址还在 aily，随后才被脚本跳到登录页：连续 3 次（约 7 秒）都停在 aily 且没有「登录」按钮才算已登录
  const loggedIn = async () => {
    for (let i = 0; i < 3; i++) {
      if (!(await url()).startsWith("https://aily.feishu.cn/") || (await ref('button "登录"'))) return false;
      if (i < 2) await sleep(3500);
    }
    return true;
  };
  if (await loggedIn()) { log("已登录 aily"); return; }
  // 无头模式里看不到二维码：关掉，开一个有界面的窗口让人扫码，登录态写进同一个 profile
  await closeBrowser();
  headed = true;
  await open("https://aily.feishu.cn/", 6000);
  if (await ref('button "登录"')) await click('button "登录"', { wait: 3000 });
  console.log("\n👉 请在弹出的浏览器窗口里，用飞书手机端扫码登录（最多等 5 分钟）\n");
  await waitFor(loggedIn, { timeout: 300000, every: 4000, what: "扫码登录" });
  log("登录成功");
  await closeBrowser();
  headed = false;
  await open("https://aily.feishu.cn/", 6000);
  await singleTab();
}

async function ensureAgent() {
  const state = JSON.parse(await readFile(STATE, "utf8").catch(() => "{}"));
  const id = argAgent || state.agentId;
  if (id && !argv.includes("--new")) {
    // 已经记录过工作伙伴：只复用，绝不因为页面没加载出来就新建一个重复的
    await open(`https://aily.feishu.cn/agents/${id}/detail/instruction`);
    const found = await waitFor(async () => (await bodyText()).includes(AGENT_NAME) || null, { timeout: 30000, every: 3000, what: "打开工作伙伴" }).catch(() => false);
    if (found) { log(`使用已有工作伙伴 ${AGENT_NAME}（${id}）`); return id; }
    if (!(await url()).startsWith("https://aily.feishu.cn/")) throw new Error("aily 登录已过期，请重新运行脚本扫码登录");
    throw new Error(`打不开已有工作伙伴 ${id}（可能已被删除或没有权限）。确认要新建一个，请加 --new 重新运行`);
  }
  log(`新建工作伙伴「${AGENT_NAME}」`);
  const identity = await readFile(path.join(ROOT, "aily/IDENTITY.md"), "utf8");
  const desc = `我想要一位「${AGENT_NAME}」：` + (identity.match(/\*\*身份\*\*：(.+)/)?.[1] ?? "") +
    "写入前先把草稿发给销售确认，确认后通过销售易 CRM 连接器新建跟进记录并推进商机阶段（租户不允许跨阶段时逐级推进）。";
  await open("https://aily.feishu.cn/market/buddies");
  await click('button "自定义工作伙伴"', { wait: 3000 });
  await click('button "个人使用"');
  await ab("fill", `@${await ref('textbox "例如')}`, desc);
  await click('button "创建"', { wait: 3000 });
  const newId = await waitFor(async () => (await url()).match(/agents\/(agent_\w+)\/detail/)?.[1], { timeout: 90000, what: "工作伙伴创建" });
  await mkdir(path.dirname(STATE), { recursive: true });
  await writeFile(STATE, JSON.stringify({ ...state, agentId: newId }, null, 2));
  log(`已创建：${newId}`);
  return newId;
}

async function connectorInstalled(agentId) {
  await open(`https://aily.feishu.cn/agents/${agentId}/detail/abilities/connector`);
  // 等连接器列表加载出来再判断，否则页面没渲染完会误判为「没装」
  const text = await waitFor(async () => { const t = await bodyText(); return t.includes("连接器") && (t.includes("官方") || t.includes("销售易 CRM")) ? t : null; }, { timeout: 30000, every: 2500, what: "连接器页面" });
  return text.includes("销售易 CRM");
}

async function ensureXsyConnector(agentId) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (await connectorInstalled(agentId)) { log("销售易 CRM 连接器已安装"); return; }
    log(`安装销售易 CRM 连接器（第 ${attempt} 次）`);
    for (let i = 0; i < 4 && !(await ref('searchbox "搜索名称"')); i++) {
    const b = await ref('button "添加连接器"');
    if (i % 2 === 0) await ab("click", `@${b}`); else { await ab("focus", `@${b}`); await ab("press", "Enter"); }
    await sleep(2500);
  }
    await ab("fill", `@${await ref('searchbox "搜索名称"')}`, "销售易");
    await sleep(2500);
    await click('button "销售易 CRM', { wait: 2500 });
    await click('button "安装"', { wait: 6000 });
    if ((await url()).includes("mcp.xiaoshouyi.com")) {
      if (!process.env.XSY_USER || !process.env.XSY_PASS) throw new Error("需要销售易授权：请设置 XSY_USER / XSY_PASS 环境变量");
      log(`销售易授权：选择「${ENV_LABEL}」并登录`);
      await ab("select", `@${await ref("combobox")}`, ENV_LABEL);
      await click('button "继续"', { wait: 5000 });
      await ab("fill", `@${await ref('textbox "手机号/邮箱"')}`, process.env.XSY_USER);
      await ab("fill", `@${await ref('textbox "密码"')}`, process.env.XSY_PASS);
      const agree = await ref("checkbox \\[checked=false");
      if (agree) await ab("check", `@${agree}`);
      await click('button "登 录"', { wait: 3000 });
      await waitFor(async () => (await url()).includes("oauth/result?status=success"), { timeout: 60000, what: "销售易授权" });
      log("销售易授权成功");
    }
  }
  if (!(await connectorInstalled(agentId))) throw new Error("销售易 CRM 连接器安装失败");
  log("销售易 CRM 连接器已安装");
}

async function uploadSkill(agentId, skill) {
  // 技能里的 {{…}} 占位符（表格编号等）在这里按 config/app.json 填好再打包
  const zip = await buildSkill(skill);
  log(`上传技能 ${skill}`);
  await open(`https://aily.feishu.cn/agents/${agentId}/detail/abilities`, 8000);
  await openMenu('button "添加技能"', 'menuitem "上传技能');
  await click('menuitem "上传技能');
  // 首次上传直接到「请确认新版本信息」；同名技能会先弹「技能名称重复」→ 替换
  // 上传框刚弹出时文件选择可能还没接上，没反应就重传（最多 3 次）
  let next = null;
  for (let i = 0; i < 3 && !next; i++) {
    await sleep(2000);
    await ab("upload", 'input[type=file][accept*=".zip"]', zip);
    next = await waitFor(async () => (await ref('button "完成"')) ? "done" : (await ref('button "替换"')) ? "replace" : null, { timeout: 25000, what: "技能解析" }).catch(() => null);
  }
  if (!next) throw new Error("等待超时：技能解析（上传 3 次都没有反应）");
  if (next === "replace") {
    await click('button "替换"', { wait: 3000 });
    await waitFor(() => ref('button "完成"'), { timeout: 60000, what: "技能解析" });
  }
  await click('button "完成"', { wait: 4000 });
  await open(`https://aily.feishu.cn/agents/${agentId}/detail/abilities`);
  if (!(await bodyText()).includes(skill)) throw new Error(`技能 ${skill} 上传后没有出现在列表里`);
  log(`技能 ${skill} 已就绪`);
}

async function writePrompts(agentId) {
  for (const [tab, file] of [["伙伴档案", "IDENTITY.md"], ["行为准则", "SOUL.md"]]) {
    log(`写入${tab}（aily/${file}）`);
    const md = await readFile(path.join(ROOT, "aily", file), "utf8");
    await open(`https://aily.feishu.cn/agents/${agentId}/detail/instruction`);
    await click(`tab "${tab}"`, { wait: 2000 });
    await click('button "编辑个性化"', { wait: 2000 });
    await replaceEditor(md);
    await click('button "保存"', { wait: 3000 });
    await open(`https://aily.feishu.cn/agents/${agentId}/detail/instruction`);
    await click(`tab "${tab}"`, { wait: 2000 });
    const firstRule = md.split("\n").find((l) => /^(- |\d+\. )/.test(l))?.replace(/^(- |\d+\. )|[*`_]/g, "").slice(0, 12);
    if (firstRule && !(await bodyText()).includes(firstRule)) throw new Error(`${tab}保存后校验失败`);
  }
}

/** 在 aily 页面里调它自己的接口（同源 + 登录 Cookie） */
async function api(method, p, body) {
  const code = `(async()=>{const r=await fetch(${JSON.stringify(p)},{method:${JSON.stringify(method)},credentials:"include",headers:{"Content-Type":"application/json"},body:${body ? JSON.stringify(JSON.stringify(body)) : "undefined"}});return await r.text()})()`;
  const out = await js(code);
  return typeof out === "string" ? JSON.parse(out) : out;
}
const schedulerConfig = (sc) => sc.type === "cron" ? { type: "cron", cron: sc.cron } : { type: "interval", intervalSeconds: sc.n * 3600 };

/** 打开下拉框并选中选项（aily 的下拉框点一次常常不展开，用键盘兜底） */
async function pick(comboPattern, optionLabel) {
  for (let i = 0; i < 4; i++) {
    const c = await ref(comboPattern);
    if (!c) throw new Error(`找不到下拉框：${comboPattern}`);
    if (i % 2 === 0) await ab("click", `@${c}`); else { await ab("focus", `@${c}`); await ab("press", "ArrowDown"); }
    await sleep(1200);
    const o = await ref(`option "${optionLabel}"`);
    if (o) { await ab("click", `@${o}`); await sleep(800); return; }
  }
  throw new Error(`下拉框里没出现选项：${optionLabel}`);
}

async function createAutomationUI(spec) {
  await open("https://aily.feishu.cn/autopilots", 5000);
  await openMenu('button "新建自动化"', 'menuitem "手动创建"');
  await click('menuitem "手动创建"', { wait: 2000 });
  await waitFor(() => ref('textbox "请输入标题"'), { timeout: 15000, what: "自动化表单" });
  await ab("fill", `@${await ref('textbox "请输入标题"')}`, spec.title);
  await pick('combobox "请选择"', AGENT_NAME);
  if (spec.schedule.type === "cron") {
    await pick("combobox \\[expanded=false, ref=e\\d+\\]: 每天", "自定义");
    await ab("fill", `@${await ref('textbox "请输入 cron 表达式"')}`, spec.schedule.cron);
  } else {
    await pick("combobox \\[expanded=false, ref=e\\d+\\]: 每天", "每隔 N 小时");
  }
  await ab("click", `@${await ref("generic \\[ref=e\\d+\\] editable")}`);
  await ab("keyboard", "type", spec.instruction);
  if (spec.push_condition) await ab("fill", `@${await ref('textbox "推送条件"')}`, spec.push_condition);
  await js(`(()=>{window.__cap=[];const o=XMLHttpRequest.prototype.open,s=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(m,u){this.__u=u;return o.apply(this,arguments)};XMLHttpRequest.prototype.send=function(b){this.addEventListener("load",()=>{if(String(this.__u).includes("autopilot/auto/create"))window.__cap.push(String(this.responseText))});return s.apply(this,arguments)};return 1})()`);
  await click('button "创建"', { wait: 6000 });
  const res = await js("JSON.stringify(window.__cap)");
  const first = JSON.parse(JSON.parse(res || "[]")[0] || "{}");
  if (first.code !== 0) throw new Error(`创建自动化「${spec.title}」失败：${first.msg || "未知错误"}`);
}

/** 为当前登录账号开启 aily/automations.json 里的自动化：已存在则用接口更新指令和频率，不存在则新建 */
async function ensureAutomations(agentId) {
  const specs = JSON.parse(await readFile(path.join(ROOT, "aily/automations.json"), "utf8"));
  await open("https://aily.feishu.cn/autopilots", 4000);
  const list = await api("GET", "/workbench/api/v1/autopilot/auto/list?pageSize=50");
  const autos = list.data?.autos ?? list.data?.items ?? list.data?.list ?? [];
  for (const spec of specs) {
    const found = autos.find((a) => a.name === spec.title);
    if (!found) {
      log(`新建自动化「${spec.title}」`);
      await createAutomationUI(spec);
      continue;
    }
    const d = await api("GET", `/workbench/api/v1/autopilot/auto/${found.autoUid}/detail`);
    const a = d.data?.auto ?? d.data;
    const trig = a.triggers?.[0] ?? {};
    // update 接口只收变化的字段；schedulerConfig 要带齐原有字段，只覆盖类型/频率
    const sc = { ...(trig.schedulerConfig ?? {}), ...schedulerConfig(spec.schedule) };
    if (spec.schedule.type !== "cron") delete sc.cron; else delete sc.intervalSeconds;
    const body = {
      instruction: { content: spec.instruction },
      trigger: { kind: trig.kind ?? 0, enabled: true, triggerId: trig.triggerId, schedulerConfig: sc },
    };
    const r = await api("POST", `/workbench/api/v1/autopilot/auto/${found.autoUid}/update`, body);
    if (r.code !== 0) throw new Error(`更新自动化「${spec.title}」失败：${r.msg}`);
    log(`已更新自动化「${spec.title}」`);
  }
}

// ---------------- 主流程 ----------------
try {
  await login();
  const agentId = await ensureAgent();
  await ensureXsyConnector(agentId);
  for (const skill of SKILLS) await uploadSkill(agentId, skill);
  await writePrompts(agentId);
  if (SUBSCRIBE) await ensureAutomations(agentId);
  else log("未加 --subscribe：不替当前账号开启自动化（销售在对话里说「开启自动录入」「订阅晨报」即可）");
  // 记下工作伙伴的飞书对话链接，给能力介绍卡片的「去对话」按钮用
  await open(`https://aily.feishu.cn/agents/${agentId}/detail/instruction`, 5000);
  await js(`(()=>{window.__opened=[];window.open=function(u){window.__opened.push(String(u));return null};return 1})()`);
  await click('button "去飞书对话"', { required: false, wait: 2500 });
  const chatLink = JSON.parse((await js("JSON.stringify(window.__opened||[])")) || "[]")[0];
  if (chatLink) {
    const st = JSON.parse(await readFile(STATE, "utf8").catch(() => "{}"));
    await writeFile(STATE, JSON.stringify({ ...st, agentId, chatLink }, null, 2));
    log(`工作伙伴对话链接：${chatLink}`);
  }
  await closeBrowser();
  console.log(`\n✅ 部署完成：https://aily.feishu.cn/agents/${agentId}/detail/instruction`);
  console.log("   给销售发能力介绍卡片：node scripts/send-intro-card.mjs --chat <销售群 chat_id>");
} catch (e) {
  console.error(`\n✗ ${e.message}\n   （可以重新运行脚本，已完成的步骤会自动跳过）`);
  process.exitCode = 1;
}
