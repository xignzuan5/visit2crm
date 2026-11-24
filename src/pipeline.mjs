// 主流程：多维表格里的每一行 = 一条录音豆妙记，按「状态」一步步推进
//   待处理 → (AI 整理 + 匹配销售易) → 待确认 / 非客户拜访 / 无匹配
//   待确认 →(销售点确认 / 表格改状态)→ 确认写入 → 已写入
//   待确认 →(超过 remind_hours 未确认)→ 提醒一次，仍保持待确认（原则：所有写入都必须销售确认，绝不自动写）
import { readFile } from "node:fs/promises";
import * as lark from "./lark.mjs";
import { Xsy } from "./xsy.mjs";
import { XsyMcp } from "./xsy-mcp-adapter.mjs";
import { analyzeVisit, judgeStage, extractDeal, formatFollowup, intentionValue } from "./extract.mjs";
import { proposeUpdates, describeOp, parseOps } from "./deal.mjs";
import { confirmCard, doneCard, needInfoCard } from "./card.mjs";
import { TABLE_FIELDS } from "./setup.mjs";

export async function loadContext(configPath = "config/app.json") {
  const cfg = JSON.parse(await readFile(configPath, "utf8"));
  const table = new lark.BaseTable({ baseToken: cfg.base.base_token, tableId: cfg.base.table_id });
  // 默认走销售易 MCP（正式方案）；mode=openapi 时走 REST 备用通道
  const xsy = cfg.xsy.mode === "openapi"
    ? new Xsy({ apiBase: cfg.xsy.api_base, tokenFile: cfg.xsy.token_file, webBase: cfg.xsy.web_base, stages: cfg.xsy.stages })
    : new XsyMcp({ url: cfg.xsy.mcp_url, tokenFile: cfg.xsy.mcp_token_file, webBase: cfg.xsy.web_base });
  return { cfg, table, xsy };
}

const S = { pending: "待处理", confirming: "待确认", approved: "确认写入", done: "已写入", ignored: "已忽略", notVisit: "非客户拜访", noMatch: "无匹配", failed: "失败" };
const fmtTime = (ms) => new Date(Number(ms)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }).replace(/:\d\d$/, "");
const userOf = (cfg, openId) => cfg.users.find((u) => u.feishu_open_id === openId);
const tableUrl = (cfg) => cfg.base.url;
const rowStatus = (r) => lark.cellText(r["状态"]);
const rowSalesId = (r) => (Array.isArray(r["销售"]) ? r["销售"][0]?.id : undefined);
const rowMinuteUrl = (r) => (lark.cellText(r["妙记链接"]).match(/\((https?:[^)]+)\)/)?.[1] ?? lark.cellText(r["妙记链接"]));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------------------------------------------------------------- 1. 同步：新妙记 → 表格行
// 正式环境这一步可由飞书「工作配方」完成（录音豆纪要自动写入多维表格）；这里用 lark-cli 轮询代替。
export async function syncMinutes(ctx, { since, tokens = [] } = {}) {
  const { cfg, table } = ctx;
  const existing = new Set((await table.list()).map((r) => lark.cellText(r["妙记Token"])));
  let infos = [];
  for (const t of tokens) infos.push(await lark.getMinuteInfo(t));
  if (!tokens.length) {
    for (const u of cfg.users) {
      const found = await lark.searchMinutes({ start: since, ownerIds: u.feishu_open_id === cfg.self_open_id ? "me" : u.feishu_open_id });
      for (const it of found) infos.push(await lark.getMinuteInfo(it.token ?? it.minute_token));
    }
  }
  let added = 0;
  for (const m of infos) {
    if (!m?.token || existing.has(m.token)) continue;
    if (!userOf(cfg, m.owner_id)) { log(`跳过 ${m.title}：所有者不在销售名单内`); continue; }
    await table.create({
      "妙记标题": m.title,
      "状态": [S.pending],
      "销售": [{ id: m.owner_id }],
      "录音时间": Number(m.create_time),
      "妙记链接": m.url,
      "妙记Token": m.token,
    });
    existing.add(m.token);
    added++;
    log(`新妙记入表：${m.title}`);
  }
  return added;
}

// ---------------------------------------------------------------- 2. 整理 + 匹配 + 发确认卡片
/** 老表格缺新列（如「建议更新」）时自动补上；每个进程只检查一次 */
async function ensureTable(ctx) {
  if (ctx._tableChecked) return;
  const added = await ctx.table.ensureFields(TABLE_FIELDS.filter((f) => f.type !== "created_at"));
  if (added.length) log(`表格已补充新列：${added.join("、")}`);
  ctx._tableChecked = true;
}

export async function processPending(ctx) {
  const { cfg, table } = ctx;
  await ensureTable(ctx);
  const rows = (await table.list()).filter((r) => rowStatus(r) === S.pending);
  for (const r of rows) {
    try {
      await processRow(ctx, r);
    } catch (e) {
      log(`处理失败 ${lark.cellText(r["妙记标题"])}: ${e.message}`);
      await table.update(r.record_id, { "状态": [S.failed], "处理说明": e.message.slice(0, 500) });
    }
  }
  return rows.length;
}

async function processRow(ctx, r) {
  const { cfg, table, xsy } = ctx;
  const token = lark.cellText(r["妙记Token"]);
  const salesOpenId = rowSalesId(r);
  const sales = userOf(cfg, salesOpenId);
  if (!sales) throw new Error(`销售 ${salesOpenId} 不在 config/app.json 的 users 名单内`);
  const minuteUrl = rowMinuteUrl(r);
  log(`整理妙记：${lark.cellText(r["妙记标题"])}`);

  const content = await lark.getMinuteContent(token);
  const recordedAt = fmtTime(new Date(lark.cellText(r["录音时间"])).getTime() || Date.now());
  const visit = await analyzeVisit({ title: content.title, summary: content.summary, transcript: content.transcript, salesName: sales.name });

  if (!visit.is_customer_conversation) {
    await table.update(r.record_id, { "状态": [S.notVisit], "处理说明": visit.not_customer_reason });
    log(`  非客户沟通，跳过：${visit.not_customer_reason}`);
    return;
  }

  // ---- 匹配客户 / 商机（表格里人工填了 ID 的优先）
  const manualOpp = lark.cellText(r["销售易商机ID"]);
  const manualAcc = lark.cellText(r["销售易客户ID"]);
  let account, opportunity;
  if (manualOpp) {
    opportunity = await xsy.getOpportunity(manualOpp);
    account = { id: opportunity.accountId, name: opportunity.accountName };
  } else {
    let accounts;
    if (manualAcc) {
      accounts = [await xsy.getAccount(manualAcc)];
    } else {
      accounts = await xsy.findAccounts(visit.customer_company_names, cfg.match_only_own_accounts ? sales.xsy_user_id : null);
    }
    const followupPreview = formatFollowup(visit, { minuteUrl });
    if (accounts.length !== 1) {
      const reason = accounts.length
        ? `录音里提到「${visit.customer_company_names.join("、")}」，在销售易里找到 ${accounts.length} 个可能的客户，请指定一个。`
        : `录音里提到「${visit.customer_company_names.join("、") || "（未识别到公司名）"}」，在你负责的客户里没有找到对应客户。`;
      await table.update(r.record_id, {
        "状态": [S.noMatch], "跟进内容": followupPreview, "跟进方式": [visit.visit_type], "意向程度": [visit.intention],
        "处理说明": reason + (accounts.length ? "\n候选：" + accounts.map((a) => `${a.name}(${a.id})`).join("；") : ""),
      });
      await notify(sales, needInfoCard({ title: content.title, recordedAt, reason, candidates: accounts.map((a) => `${a.name}（客户ID ${a.id}）`), tableUrl: tableUrl(cfg), minuteUrl }));
      log(`  客户匹配结果 ${accounts.length} 个，已请销售补充`);
      return;
    }
    account = accounts[0];
    const opps = await xsy.openOpportunities(account.id);
    opportunity = opps[0]; // 多个进行中商机：取最近更新的一个，销售可在表格里改「销售易商机ID」
    if (opps.length > 1) log(`  客户下有 ${opps.length} 个进行中商机，默认取最近更新的「${opportunity.name}」`);
  }

  // ---- 阶段判断（只有挂到商机时才判断）与商机情报（MEDDPICC）提取，两件事并行
  const judge = async () => {
    if (!opportunity) return null;
    const stages = (await xsy.stages(opportunity.id)).filter((x) => !x.closed);
    const s = await judgeStage({ summary: content.summary, transcript: content.transcript, currentStage: opportunity.stageName, stages });
    return { current: opportunity.stageName, target: s.target?.name, targetId: s.target?.id, evidence: s.evidence_quote, note: s.note || (!s.should_change ? s.reason : "") };
  };
  const intel = async () => {
    if (typeof xsy.accountContacts !== "function") return { deal: null, updates: { ops: [], notes: [] } }; // OpenAPI 备用通道不做回写
    const contacts = await xsy.accountContacts(account.id);
    const deal = await extractDeal({ summary: content.summary, transcript: content.transcript, salesName: sales.name, accountName: account.name, opportunityName: opportunity?.name, contacts });
    return { deal, updates: await proposeUpdates(xsy, { deal, account, opportunity, contacts }) };
  };
  const [stage, { deal, updates }] = await Promise.all([judge(), intel()]);

  const followup = formatFollowup(visit, { minuteUrl, deal });
  const fields = {
    "状态": [S.confirming],
    "客户": account.name, "销售易客户ID": account.id,
    "商机": opportunity?.name ?? "", "销售易商机ID": opportunity?.id ?? "",
    "当前阶段": stage?.current ?? "", "建议阶段": stage?.target ?? "", "阶段依据": stage?.target ? stage.evidence : (stage?.note ?? ""),
    "跟进方式": [visit.visit_type], "意向程度": [visit.intention], "跟进内容": followup,
    "建议更新": updates.ops.length ? JSON.stringify(updates.ops) : "",
    "处理说明": [visit.multiple_customers ? "录音里涉及多个客户，只按第一个客户处理，请核对" : "", ...updates.notes].filter(Boolean).join("\n"),
  };
  await table.update(r.record_id, fields);
  const card = confirmCard({ recordId: r.record_id, title: content.title, recordedAt, minuteUrl, account, opportunity, followupPreview: followup, stage, updates, tableUrl: tableUrl(cfg) });
  const messageId = await notify(sales, card);
  if (messageId) await table.update(r.record_id, { "卡片消息ID": messageId });
  log(`  已生成草稿并发确认卡片：${account.name} / ${opportunity?.name ?? "（无商机）"}${stage?.target ? `，建议阶段 ${stage.current}→${stage.target}` : ""}${updates.ops.length ? `，建议更新 ${updates.ops.length} 项` : ""}`);
}

async function notify(sales, card) {
  try {
    return await lark.sendCard(sales.feishu_open_id, card);
  } catch (e) {
    log(`  发卡片失败（不影响表格流程）：${e.message.slice(0, 200)}`);
    return null;
  }
}

// ---------------------------------------------------------------- 3. 卡片按钮回调 → 改表格状态
export async function handleCardAction(ctx, ev) {
  const { table } = ctx;
  let v = ev.action_value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* keep */ } }
  if (!v?.record_id) return;
  const row = (await table.list()).find((r) => r.record_id === v.record_id);
  if (!row || rowStatus(row) !== S.confirming) { log(`卡片回调：记录 ${v.record_id} 不在待确认状态，忽略`); return; }
  if (v.action === "ignore") {
    await table.update(v.record_id, { "状态": [S.ignored], "处理说明": "销售在卡片上选择忽略" });
    await lark.updateCard(ev.message_id, doneCard({ title: lark.cellText(row["妙记标题"]), account: lark.cellText(row["客户"]), opportunity: lark.cellText(row["商机"]), result: "已忽略", color: "grey" }));
    return;
  }
  const fields = { "状态": [S.approved] };
  // 只写跟进记录：不改阶段，也不做商机情报回写（confirm_no_stage 是旧卡片上的按钮）
  if (v.action === "confirm_followup_only" || v.action === "confirm_no_stage") Object.assign(fields, { "建议阶段": "", "建议更新": "" });
  await table.update(v.record_id, fields);
  log(`卡片回调：${lark.cellText(row["妙记标题"])} → ${v.action}`);
  await writeApproved(ctx);
}

// ---------------------------------------------------------------- 4. 写入销售易
export async function writeApproved(ctx) {
  const { table } = ctx;
  const rows = await table.list();
  const approved = rows.filter((r) => rowStatus(r) === S.approved);
  for (const r of approved) await writeRow(ctx, r);
  return approved.length;
}

/** 超过 remind_hours 还没确认的草稿：提醒销售一次。只提醒，不写入。 */
export async function handleTimeouts(ctx) {
  const { cfg, table } = ctx;
  const hours = cfg.timeouts.remind_hours ?? 24;
  const rows = (await table.list()).filter((r) => rowStatus(r) === S.confirming && !lark.cellText(r["处理说明"]).includes("已提醒"));
  let n = 0;
  for (const r of rows) {
    const created = new Date(lark.cellText(r["创建时间"])).getTime();
    if (Date.now() - created < hours * 3600e3) continue;
    const sales = userOf(cfg, rowSalesId(r));
    if (sales) {
      await lark.sendText(sales.feishu_open_id, `「${lark.cellText(r["妙记标题"])}」的拜访记录还在等你确认，确认后才会写入销售易：${tableUrl(cfg)}`).catch((e) => log(`  提醒发送失败：${e.message.slice(0, 120)}`));
    }
    const note = lark.cellText(r["处理说明"]);
    await table.update(r.record_id, { "处理说明": `${note ? note + "\n" : ""}${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} 已提醒确认` });
    n++;
  }
  return n;
}

async function writeRow(ctx, r) {
  const { cfg, table, xsy } = ctx;
  const sales = userOf(cfg, rowSalesId(r));
  const title = lark.cellText(r["妙记标题"]);
  try {
    const accountId = lark.cellText(r["销售易客户ID"]);
    const oppId = lark.cellText(r["销售易商机ID"]);
    let content = lark.cellText(r["跟进内容"]);
    const visitType = lark.cellText(r["跟进方式"]) || "拜访";
    const startTime = new Date(lark.cellText(r["录音时间"])).getTime() || Date.now();
    if (!content.includes("拜访时间：")) content = `拜访时间：${fmtTime(startTime)}\n${content}`;

    const activityId = await xsy.createFollowup({
      content, accountId, opportunityId: oppId || null,
      entityType: cfg.xsy.activity_entity_types[visitType] ?? cfg.xsy.activity_entity_types["拜访"],
      startTime, ownerId: sales?.xsy_user_id, deptId: sales?.xsy_dept_id,
      intention: intentionValue(lark.cellText(r["意向程度"])),
    });

    let stageMsg = "商机阶段未变更";
    const targetName = lark.cellText(r["建议阶段"]);
    if (oppId && targetName) {
      const stages = await xsy.stages(oppId);
      const target = stages.find((s) => s.name === targetName && !s.closed);
      if (!target) throw new Error(`建议阶段「${targetName}」不在该商机的阶段流程中`);
      try {
        const after = await xsy.advanceStage(oppId, target.id);
        stageMsg = `商机阶段：${lark.cellText(r["当前阶段"])} → ${after.path.join(" → ")}`;
      } catch (e) {
        // 跟进记录已写入；阶段被销售易规则拦截（审批/关键字段等）时不强推，交给销售处理
        stageMsg = `跟进记录已写入，但商机阶段未能推进：${e.message}`;
      }
    }

    // 商机情报回写（预算 / 联系人角色 / 竞争对手）：逐条执行，某条失败不影响其他条，也不回滚已写的跟进记录
    const updateMsgs = [];
    let ops = [];
    try { ops = parseOps(lark.cellText(r["建议更新"])); } catch (e) { updateMsgs.push(`✗ ${e.message}`); }
    for (const op of ops) {
      try {
        await xsy.applyUpdate(op, { oppId, accountId });
        updateMsgs.push(`✓ ${describeOp(op)}`);
      } catch (e) {
        updateMsgs.push(`✗ ${describeOp(op)}：${e.message.slice(0, 150)}`);
      }
    }
    if (updateMsgs.length) stageMsg += `\n${updateMsgs.join("\n")}`;
    await table.update(r.record_id, {
      "状态": [S.done], "销售易跟进记录ID": activityId,
      "处理说明": `${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} 写入成功；${stageMsg}`,
    });
    log(`写入销售易成功：${title} → 跟进记录 ${activityId}；${stageMsg}`);
    const messageId = lark.cellText(r["卡片消息ID"]);
    if (messageId) {
      await lark.updateCard(messageId, doneCard({
        title, account: lark.cellText(r["客户"]), opportunity: lark.cellText(r["商机"]),
        result: "✅ 已写入销售易", color: "green", detail: stageMsg, link: oppId ? xsy.opportunityUrl(oppId) : undefined,
      })).catch((e) => log(`  更新卡片失败：${e.message.slice(0, 150)}`));
    }
  } catch (e) {
    log(`写入失败 ${title}: ${e.message}`);
    await table.update(r.record_id, { "状态": [S.failed], "处理说明": `写入销售易失败（未重试，避免重复写入）：${e.message}`.slice(0, 500) });
  }
}

// ---------------------------------------------------------------- 一次完整轮询
export async function tick(ctx, { since } = {}) {
  const added = await syncMinutes(ctx, { since });
  const processed = await processPending(ctx);
  const written = await writeApproved(ctx);
  const timedOut = await handleTimeouts(ctx);
  log(`本轮：新妙记 ${added}，整理 ${processed}，写入 ${written}，提醒确认 ${timedOut}`);
  await ctx.xsy.close();
}
