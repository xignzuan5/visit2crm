#!/usr/bin/env node
// 用本地销售易 MCP 授权，把 skills/xsy-sales-assistant 里的每个只读查询实际跑一遍，验证工具名和条件写法。
// 用法：node scripts/verify-sales-assistant.mjs [客户关键词]
import { connectXsyMcp, callTool } from "../src/xsy-mcp.mjs";

const DAY = 86400e3;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmt = (ms) => (ms ? new Date(Number(ms)).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—");
const c = await connectXsyMcp();
const call = async (name, args) => {
  const r = await callTool(c, name, args);
  if (r?.success === false) throw new Error(`${name}: ${JSON.stringify(r.error).slice(0, 200)}`);
  return r?.data?.result ?? r?.data ?? r;
};
const show = (title, rows) => { console.log(`\n■ ${title}（${rows.length}）`); rows.slice(0, 8).forEach((r) => console.log("  -", r)); };
const oppLine = (o) => `${o.opportunityName}｜${o.accountId?.name ?? ""}｜${o.saleStageId?.name ?? ""}｜¥${o.money ?? "—"}｜结单 ${fmt(o.closeDate)}｜最近跟进 ${fmt(o.recentActivityRecordTime)}`;
const myOpps = async (extra = []) => (await call("entity-search", {
  entity: "opportunity",
  conditions: [{ apiKey: "ownerId", type: 1, value: me.userId }, { apiKey: "status", type: 1, value: "1" }, ...extra],
})).records ?? [];

const me = await call("user-detail", {});
console.log(`当前用户：${me.name}（${me.department ?? ""}）`);

// 注意：不传 ownerId 时统计的是「我可见」的全部商机，必须显式传本人 ID
const pipe = await call("crm-myPipelineSummary", { ownerId: me.userId });
show("我的商机漏斗", (pipe.stages ?? []).map((s) => `${s.stageName}：${s.count} 个，¥${s.totalAmount}`));

show("我进行中的商机", (await myOpps()).map(oppLine));

const t0 = startOfToday();
show("7 天内到结单日期", (await myOpps([{ apiKey: "closeDate", type: 12, value: `${t0},${t0 + 8 * DAY - 1}` }])).map(oppLine));
show("已过结单日期仍未关闭", (await myOpps([{ apiKey: "closeDate", type: 8, value: String(t0) }])).map(oppLine));

const stale = await call("entity-search", {
  entity: "opportunity",
  conditions: [
    { apiKey: "ownerId", type: 1, value: me.userId }, { apiKey: "status", type: 1, value: "1" },
    { apiKey: "recentActivityRecordTime", type: 8, value: String(t0 - 14 * DAY) },
    { apiKey: "recentActivityRecordTime", type: 13, value: "" },
  ],
  expression: "1 and 2 and (3 or 4)",
});
show("超过 14 天没跟进", (stale.records ?? []).map(oppLine));

const kw = process.argv[2] || "星河";
const acc = (await call("entity-search", { entity: "account", keyWord: kw, conditions: [{ apiKey: "ownerId", type: 1, value: me.userId }] })).records ?? [];
if (acc.length) {
  const b = await call("customer-profileBriefing", { id: String(acc[0].id) });
  console.log(`\n■ 客户简报「${acc[0].accountName}」：联系人 ${b.contactsTotalSize ?? 0}，商机 ${b.opportunitiesTotalSize ?? 0}，跟进 ${b.followupsTotalSize ?? 0}`);
}

const tasks = await call("task-list", { startTime: t0, endTime: t0 + 7 * DAY - 1 });
show("未来 7 天的任务", (tasks.records ?? tasks.list ?? []).map((t) => `${t.taskName ?? t.name}｜${fmt(t.planFinishDate)}`));
const sched = await call("schedule-query", { startTime: t0, endTime: t0 + DAY - 1 });
show("今天的日程", (sched.records ?? sched.list ?? sched.schedules ?? []).map((s) => `${s.name ?? s.title}｜${fmt(s.startDate)}`));

await c.close();
console.log("\n全部查询执行成功");
