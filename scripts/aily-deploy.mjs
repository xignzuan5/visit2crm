#!/usr/bin/env node
// 一键把「拜访录入助手」部署到豆包工作伙伴（aily）。
// 通过 agent-browser 驱动 aily 网页（aily 没有开放「创建工作伙伴」的 API）。
//
// 用法：
//   XSY_ENV=production XSY_USER=<销售易账号> XSY_PASS=<销售易密码> node scripts/aily-deploy.mjs [--agent-id agent_xxx]
//
// 需要人做的只有一件事：脚本打开浏览器后，用飞书手机端扫码登录（登录态保存在 .secrets/aily-browser-profile，下次免扫）。
// 每一步可重复执行：已存在的连接器/自动化会跳过，技能会更新为新版本，提示词会覆盖为仓库里的版本。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SESSION = process.env.AILY_SESSION || "aily-deploy";
const PROFILE = process.env.AILY_PROFILE || path.join(ROOT, ".secrets/aily-browser-profile");
const STATE = path.join(ROOT, ".secrets/aily-deploy.json");
const AGENT_NAME = "拜访录入助手";
const AUTOMATION_TITLE = "拜访记录自动录入";
const ENV_LABEL = { production: "生产环境", sandbox: "沙箱环境" }[process.env.XSY_ENV || "production"];
const argv = process.argv.slice(2);
const argAgent = argv.includes("--agent-id") ? argv[argv.indexOf("--agent-id") + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

// ---------------- agent-browser 封装 ----------------
let launched = false;
async function ab(...args) {
  const pre = ["--session", SESSION];
  if (!launched) { pre.push("--headed", "--profile", PROFILE); launched = true; }
  const { stdout } = await run("agent-browser", [...pre, ...args], { maxBuffer: 32 << 20 }).catch((e) => ({ stdout: e.stdout || "" }));
  return stdout;
}
const snapshot = () => ab("snapshot");
async function ref(pattern) {
  const snap = await snapshot();
  const re = new RegExp(`${pattern}[^\\n]*?ref=(e\\d+)`);
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
async function open(u, wait = 4000) { await ab("open", u); await sleep(wait); }
async function waitFor(fn, { timeout = 60000, every = 2000, what = "页面" } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); }
  throw new Error(`等待超时：${what}`);
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
  if (!(await ref('button "登录"'))) { log("已登录 aily"); return; }
  await click('button "登录"', { wait: 3000 });
  console.log("\n👉 请在弹出的浏览器窗口里，用飞书手机端扫码登录（最多等 5 分钟）\n");
  await waitFor(async () => (await url()).startsWith("https://aily.feishu.cn/") && !(await ref('button "登录"')), { timeout: 300000, every: 4000, what: "扫码登录" });
  log("登录成功");
}

async function ensureAgent() {
  const state = JSON.parse(await readFile(STATE, "utf8").catch(() => "{}"));
  const id = argAgent || state.agentId;
  if (id) {
    await open(`https://aily.feishu.cn/agents/${id}/detail/instruction`);
    if ((await bodyText()).includes(AGENT_NAME)) { log(`使用已有工作伙伴 ${AGENT_NAME}（${id}）`); return id; }
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
  return (await bodyText()).includes("销售易 CRM");
}

async function ensureXsyConnector(agentId) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (await connectorInstalled(agentId)) { log("销售易 CRM 连接器已安装"); return; }
    log(`安装销售易 CRM 连接器（第 ${attempt} 次）`);
    await click('button "添加连接器"', { wait: 2500 });
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

async function uploadSkill(agentId) {
  const zip = path.join(ROOT, ".cache/visit-to-xsy.zip");
  await mkdir(path.dirname(zip), { recursive: true });
  await rm(zip, { force: true });
  await run("zip", ["-r", zip, "visit-to-xsy"], { cwd: path.join(ROOT, "skills") });
  log("上传技能 visit-to-xsy");
  await open(`https://aily.feishu.cn/agents/${agentId}/detail/abilities`);
  await click('button "添加技能"');
  await click('menuitem "上传技能');
  await ab("upload", 'input[type=file][accept*=".zip"]', zip);
  // 首次上传直接到「请确认新版本信息」；同名技能会先弹「技能名称重复」→ 替换
  const next = await waitFor(async () => (await ref('button "完成"')) ? "done" : (await ref('button "替换"')) ? "replace" : null, { timeout: 60000, what: "技能解析" });
  if (next === "replace") {
    await click('button "替换"', { wait: 3000 });
    await waitFor(() => ref('button "完成"'), { timeout: 60000, what: "技能解析" });
  }
  await click('button "完成"', { wait: 4000 });
  await open(`https://aily.feishu.cn/agents/${agentId}/detail/abilities`);
  if (!(await bodyText()).includes("visit-to-xsy")) throw new Error("技能上传后没有出现在列表里");
  log("技能已就绪");
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
    const firstRule = md.split("\n").find((l) => /^(- |\d+\. )/.test(l))?.replace(/^(- |\d+\. )|\*\*/g, "").slice(0, 12);
    if (firstRule && !(await bodyText()).includes(firstRule)) throw new Error(`${tab}保存后校验失败`);
  }
}

async function ensureAutomation() {
  await open("https://aily.feishu.cn/autopilots");
  if ((await bodyText()).includes(AUTOMATION_TITLE)) { log("自动化任务已存在"); return; }
  log("创建自动化任务（每小时处理新妙记）");
  const spec = await readFile(path.join(ROOT, "aily/AUTOMATION.md"), "utf8");
  const instruction = spec.match(/描述（任务指令）：\s*\n\s*> (.+)/)?.[1]?.trim();
  const pushCond = spec.match(/\| 推送条件 \| (.+?) \|/)?.[1]?.trim();
  await click('button "新建自动化"');
  await click('menuitem "手动创建"', { wait: 3000 });
  await ab("fill", `@${await ref('textbox "请输入标题"')}`, AUTOMATION_TITLE);
  await click('combobox "请选择"');
  await click(`option "${AGENT_NAME}"`);
  await click('combobox \\[expanded=false, ref=e\\d+\\]: 每天');
  await click('option "每隔 N 小时"');
  await ab("click", `@${await ref("generic \\[ref=e\\d+\\] editable")}`);
  await ab("keyboard", "type", instruction);
  if (pushCond) await ab("fill", `@${await ref('textbox "推送条件"')}`, pushCond);
  await js(`(()=>{window.__cap=[];const o=XMLHttpRequest.prototype.open,s=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(m,u){this.__u=u;return o.apply(this,arguments)};XMLHttpRequest.prototype.send=function(b){this.addEventListener("load",()=>{if(String(this.__u).includes("autopilot/auto/create"))window.__cap.push(String(this.responseText))});return s.apply(this,arguments)};return 1})()`);
  await click('button "创建"', { wait: 6000 });
  const res = await js("JSON.stringify(window.__cap)");
  const first = JSON.parse(JSON.parse(res || "[]")[0] || "{}");
  if (first.code !== 0) throw new Error(`创建自动化失败：${first.msg || "未知错误"}`);
  log("自动化任务已创建");
}

// ---------------- 主流程 ----------------
try {
  await login();
  const agentId = await ensureAgent();
  await ensureXsyConnector(agentId);
  await uploadSkill(agentId);
  await writePrompts(agentId);
  await ensureAutomation();
  console.log(`\n✅ 部署完成：https://aily.feishu.cn/agents/${agentId}/detail/instruction`);
  console.log("   销售把妙记链接转给「拜访录入助手」即可，或等每小时的自动化任务处理。");
} catch (e) {
  console.error(`\n✗ ${e.message}\n   （可以重新运行脚本，已完成的步骤会自动跳过）`);
  process.exitCode = 1;
}
