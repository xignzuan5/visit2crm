// 商机情报 → 建议更新：把 MEDDPICC 提取结果里能落到销售易字段的部分（项目预算、联系人角色、竞争对手）
// 变成「改前 → 改后」的建议，每条先在销售易里预检（dryRun）。销售确认后才写入。
// 落不到字段的（没有这个联系人、竞争对手库里没有、租户表单没有该字段）只写进跟进记录正文，并在卡片上说明原因。

const money = (v) => (v == null || v === "" ? "未填" : `${Number(v).toLocaleString("zh-CN")} 元`);

/** 一条建议更新的可读描述（卡片、处理说明共用） */
export function describeOp(op) {
  if (op.kind === "budget") return `项目预算：${money(op.from)} → ${money(op.value)}`;
  if (op.kind === "contactRole") return `联系人「${op.name}」的角色：${op.from || "未填"} → ${op.to}`;
  if (op.kind === "competitor") return `关联竞争对手：${op.name}`;
  return JSON.stringify(op);
}

export function parseOps(text) {
  if (!text?.trim()) return [];
  try {
    const ops = JSON.parse(text);
    return Array.isArray(ops) ? ops : [];
  } catch {
    throw new Error("「建议更新」不是有效内容；不想更新就把这一格清空");
  }
}

/**
 * xsy 需要提供：opportunityBudget / opportunityCompetitors / findCompetitors / checkUpdate（见 xsy-mcp-adapter.mjs）
 * 返回 { ops: 可执行的建议更新, notes: 没法自动更新的说明 }
 */
export async function proposeUpdates(xsy, { deal, account, opportunity, contacts }) {
  const ops = [], notes = [];
  if (!deal || !opportunity) return { ops, notes };
  const ids = { oppId: opportunity.id, accountId: account.id };
  const tryAdd = async (op, failNote) => {
    let why = await xsy.checkUpdate(op, ids);
    // 字段不在租户的编辑表单上 → 换成销售看得懂的说法
    if (why && /不存在|unknown-field/.test(why)) why = "销售易的编辑表单里没有这个字段，请管理员把它加到页面布局后即可自动回填";
    if (why) notes.push(`${failNote}：${why}`);
    else ops.push(op);
  };

  // 预算
  if (deal.budget_yuan) {
    const cur = await xsy.opportunityBudget(opportunity.id);
    if (Number(cur) !== Number(deal.budget_yuan)) {
      await tryAdd({ kind: "budget", from: cur, value: deal.budget_yuan, quote: deal.budget_quote }, `项目预算 ${money(deal.budget_yuan)} 没法自动回填（已写进跟进记录）`);
    }
  }

  // 联系人角色：只更新销售易里已有的联系人，不新建
  for (const p of deal.people) {
    if (p.role === "其它") continue;
    const c = contacts.find((x) => x.id === p.crm_contact_id);
    if (!c) { notes.push(`${p.mention}（${p.role}）：销售易里没有对应的联系人，没有新建`); continue; }
    if (c.role === p.role) continue;
    await tryAdd({ kind: "contactRole", contactId: c.id, name: c.name, from: c.role, to: p.role, quote: p.quote }, `联系人「${c.name}」的角色没法更新`);
  }

  // 竞争对手：只关联竞争对手库里已有的，不新建
  if (deal.competitors.length) {
    const linked = await xsy.opportunityCompetitors(opportunity.id);
    for (const comp of deal.competitors) {
      const found = await xsy.findCompetitors(comp.name);
      if (!found.length) { notes.push(`竞争对手「${comp.name}」不在销售易竞争对手库里，没有新建`); continue; }
      if (found.length > 1) { notes.push(`竞争对手「${comp.name}」在库里有多个同名候选（${found.map((f) => f.name).join("、")}），请在销售易里手动关联`); continue; }
      if (linked.some((l) => l.competitorProfileId === found[0].id)) continue;
      await tryAdd({ kind: "competitor", competitorProfileId: found[0].id, name: found[0].name, quote: comp.quote }, `竞争对手「${found[0].name}」没法关联`);
    }
  }
  return { ops, notes };
}
