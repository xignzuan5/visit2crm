#!/usr/bin/env node
// 用法：
//   node src/cli.mjs init [--env production|sandbox] [--base <base_token> --table <table_id>] [--force]
//                                                 首次部署：检查登录、读取销售易信息、建表、生成 config/app.json
//   node src/cli.mjs add-user <姓名或邮箱>         把一个销售加进名单（飞书 ↔ 销售易自动对应）
//   node src/cli.mjs add <妙记链接或token...>   手动把妙记加入表格（=「转发给工作伙伴」兜底）
//   node src/cli.mjs sync [--since YYYY-MM-DD]   搜索销售名单里每个人的新妙记并入表
//   node src/cli.mjs process                     整理「待处理」行并发确认卡片
//   node src/cli.mjs write                       把「确认写入」行写进销售易
//   node src/cli.mjs tick [--since ...]          同步 + 整理 + 写入 + 超时处理（定时任务跑这个）
//   node src/cli.mjs listen                      常驻：监听卡片按钮回调，并每 N 分钟 tick 一次
import { spawn } from "node:child_process";
import readline from "node:readline";
import * as P from "./pipeline.mjs";
import * as Setup from "./setup.mjs";

const [cmd, ...args] = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
// 注意：+search 的 --start 传纯日期（YYYY-MM-DD）时实测会漏结果，必须传带时区的 ISO 时间
const today = () => new Date(Date.now() - 48 * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");

if (cmd === "init" || cmd === "add-user") {
  try {
    if (cmd === "init") await Setup.init({ env: flag("env", "production"), baseToken: flag("base"), tableId: flag("table"), force: args.includes("--force") });
    else await Setup.addUser(args.filter((a) => !a.startsWith("--")).join(" "));
  } catch (e) {
    console.error(`\n✗ ${e.message}`);
    process.exitCode = 1;
  }
  process.exit();
}

const ctx = await P.loadContext();

switch (cmd) {
  case "add": {
    const tokens = args.filter((a) => !a.startsWith("--")).map((a) => a.split("/minutes/").pop().split(/[?#]/)[0]);
    await P.syncMinutes(ctx, { tokens });
    break;
  }
  case "sync": await P.syncMinutes(ctx, { since: flag("since", today()) }); break;
  case "process": await P.processPending(ctx); break;
  case "write": await P.writeApproved(ctx); break;
  case "tick": await P.tick(ctx, { since: flag("since", today()) }); break;
  case "listen": await listen(Number(flag("every", 5))); break;
  default:
    console.log("命令：init | add-user | add | sync | process | write | tick | listen");
}
if (cmd !== "listen") await ctx.xsy.close();

async function listen(everyMin) {
  // 卡片回调：需要在飞书开发者后台「事件与回调 → 回调配置」开启长连接接收 card.action.trigger
  const child = spawn("lark-cli", ["event", "consume", "card.action.trigger", "--as", "bot"], { stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", (d) => process.stderr.write(`[card-listener] ${d}`));
  readline.createInterface({ input: child.stdout }).on("line", async (line) => {
    if (!line.trim()) return;
    try { await P.handleCardAction(ctx, JSON.parse(line)); } catch (e) { console.error("卡片回调处理失败：", e.message); }
  });
  const loop = async () => { try { await P.tick(ctx, { since: today() }); } catch (e) { console.error("tick 失败：", e.message); } };
  await loop();
  setInterval(loop, everyMin * 60e3);
  console.log(`监听中：卡片回调实时处理，每 ${everyMin} 分钟同步一次妙记。Ctrl+C 退出。`);
}
