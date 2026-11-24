// 销售易 MCP 适配层（正式方案）：与 src/xsy.mjs（OpenAPI 版）提供同一组方法
import { connectXsyMcp, callTool } from "./xsy-mcp.mjs";
import { nameKeywords } from "./xsy.mjs";

const isClosedStage = (s) => /赢单|输单/.test(s.name) || s.percent === 100;

export class XsyMcp {
  constructor({ url, tokenFile, webBase }) {
    this.url = url;
    this.tokenFile = tokenFile;
    this.webBase = webBase;
  }

  async call(name, args) {
    if (!this._client) this._client = await connectXsyMcp({ url: this.url, tokenFile: this.tokenFile });
    const r = await callTool(this._client, name, args);
    if (r && typeof r === "object" && r.success === false) {
      throw new Error(`销售易 MCP ${name} 失败：${JSON.stringify(r.error ?? r).slice(0, 500)}`);
    }
    return r;
  }

  async close() {
    await this._client?.close();
    this._client = null;
  }

  async stageInfo(oppId) {
    return (await this.call("opportunity-stageInfo", { id: String(oppId) })).data.result;
  }

  async getOpportunity(id) {
    const info = await this.stageInfo(id);
    const o = info.opportunity;
    const acc = await this.getAccount(o.accountId);
    return { id: String(o.id), name: o.opportunityName, stageId: String(o.saleStageId), stageName: o.saleStageName, accountId: acc.id, accountName: acc.name };
  }

  async getAccount(id) {
    const r = await this.call("entity-detail", { entity: "account", recordId: String(id) });
    const rec = r.data?.result?.record ?? r.data?.result ?? {};
    return { id: String(id), name: rec.accountName ?? rec.name };
  }

  /** 该商机所属阶段流程的全部阶段（含赢单/输单；由调用方过滤） */
  async stages(oppId) {
    const info = await this.stageInfo(oppId);
    return info.stages.map((s) => ({ id: String(s.id), name: s.stageName, order: s.order, percent: s.percent, closed: isClosedStage({ name: s.stageName, percent: s.percent }) }));
  }

  /** 按公司名模糊搜客户；ownerId 不为空时只在该销售负责的客户里找 */
  async findAccounts(names, ownerId) {
    const seen = new Map();
    for (const raw of names) {
      for (const kw of nameKeywords(raw)) {
        const args = { entity: "account", keyWord: kw };
        if (ownerId) args.conditions = [{ apiKey: "ownerId", type: 1, value: String(ownerId) }];
        const recs = (await this.call("entity-search", args)).data?.result?.records ?? [];
        for (const r of recs) if (!seen.has(String(r.id))) seen.set(String(r.id), { id: String(r.id), name: r.accountName ?? r.name, keyword: kw, query: raw });
        if (recs.length) break;
      }
    }
    return [...seen.values()];
  }

  /** 客户下进行中的商机（排除赢单/输单），按最近更新排序 */
  async openOpportunities(accountId) {
    const r = await this.call("entity-search", {
      entity: "opportunity",
      conditions: [{ apiKey: "accountId", type: 1, value: String(accountId) }],
    });
    return (r.data?.result?.records ?? [])
      .filter((o) => o.status === 1 || o.status == null)
      .map((o) => ({ id: String(o.id), name: o.opportunityName, stageId: String(o.saleStageId?.id ?? o.saleStageId), stageName: o.saleStageId?.name ?? "", updatedAt: o.updatedAt ?? 0 }))
      .filter((o) => !/赢单|输单/.test(o.stageName))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 新建跟进记录（activityrecord），挂商机；没有商机时挂客户 */
  async createFollowup({ content, accountId, opportunityId, entityType, ownerId, intention }) {
    const args = {
      content,
      parentEntity: opportunityId ? "opportunity" : "account",
      parentRecordId: String(opportunityId || accountId),
      entityType: String(entityType),
    };
    if (intention != null) args.intentionalDegree = String(intention);
    if (ownerId) args.ownerId = String(ownerId);
    const r = await this.call("followup-create", args);
    const d = r.data?.result ?? r.data ?? {};
    const id = d.id ?? d.recordId ?? d.data?.id ?? JSON.stringify(r).match(/"(?:id|recordId)"\s*:\s*"?(\d{10,})/)?.[1];
    if (!id) throw new Error(`followup-create 未返回记录 ID：${JSON.stringify(r).slice(0, 300)}`);
    return String(id);
  }

  /**
   * 推进商机阶段。租户不允许跨阶段（adminSetting.canGoto=0）时逐阶段推进；
   * 每一步先 dryRun，有 blockers（审批、必填关键信息等）就停下并报告，不强推。
   */
  async advanceStage(oppId, targetStageId) {
    const info = await this.stageInfo(oppId);
    const stages = info.stages.map((s) => ({ id: String(s.id), name: s.stageName, order: s.order }));
    const cur = stages.find((s) => s.id === String(info.currentStageId));
    const target = stages.find((s) => s.id === String(targetStageId));
    if (!cur || !target) throw new Error("阶段不在该商机的阶段流程中");
    if (cur.id === target.id) return { stageId: cur.id, stageName: cur.name, path: [] };
    const step = target.order > cur.order ? 1 : -1;
    const canJump = info.adminSetting?.canGoto !== 0;
    const path = canJump ? [target] : stages.filter((s) => (step > 0 ? s.order > cur.order && s.order <= target.order : s.order < cur.order && s.order >= target.order)).sort((a, b) => step * (a.order - b.order));
    const passed = [];
    for (const s of path) {
      const dry = await this.call("opportunity-advanceStage", { id: String(oppId), stageId: s.id, dryRun: true });
      const blockers = dry.data?.blockers ?? [];
      if (blockers.length || dry.data?.canExecute === false) {
        throw new Error(`推进到「${s.name}」被拦截：${JSON.stringify(blockers).slice(0, 300)}（已推进：${passed.join("→") || "无"}）`);
      }
      const res = await this.call("opportunity-advanceStage", { id: String(oppId), stageId: s.id });
      const st = res.data?.result?.status;
      if (st != null && st !== 0) throw new Error(`推进到「${s.name}」失败：${JSON.stringify(res.data?.result).slice(0, 300)}`);
      passed.push(s.name);
    }
    const after = await this.stageInfo(oppId);
    return { stageId: String(after.currentStageId), stageName: after.currentStage, path: passed };
  }

  // ---------------------------------------------------------------- 商机情报回写（MEDDPICC）
  // 只支持三种写回：项目预算、联系人角色、关联竞争对手。参数全部由代码拼装，不执行表格里传来的任意调用。

  /** 客户下的联系人 [{id, name, post, role}]，role 为「联系人角色」的选项名（未填为空） */
  async accountContacts(accountId) {
    const r = await this.call("entity-search", { entity: "contact", conditions: [{ apiKey: "accountId", type: 1, value: String(accountId) }] });
    const labels = await this.pickLabels("contact", "contactRole");
    return (r.data?.result?.records ?? []).map((c) => ({
      id: String(c.id), name: c.contactName ?? c.name, post: c.post ?? "",
      role: c["contactRole-label"] ?? labels[c.contactRole] ?? "",
    }));
  }

  /** 字段选项 code → 名称（按租户实际配置读，不硬编码） */
  async pickLabels(entity, field) {
    this._labels ??= {};
    const key = `${entity}.${field}`;
    if (!this._labels[key]) {
      const r = await this.call("metadata-entityDescribe", { entity });
      const f = (r.data?.result?.fields ?? []).find((x) => x.apiKey === field);
      this._labels[key] = Object.fromEntries((f?.pickOption ?? []).map((o) => [o.optionCode, o.optionLabel]));
    }
    return this._labels[key];
  }

  async opportunityBudget(oppId) {
    const r = await this.call("entity-detail", { entity: "opportunity", recordId: String(oppId) });
    return (r.data?.result?.record ?? r.data?.result ?? {}).projectBudget ?? null;
  }

  /** 商机已关联的竞争对手 [{id, competitorProfileId, name}] */
  async opportunityCompetitors(oppId) {
    const r = await this.call("entity-search", { entity: "opportunityCompetitor", conditions: [{ apiKey: "opportunityId", type: 1, value: String(oppId) }] });
    return (r.data?.result?.records ?? []).map((c) => ({ id: String(c.id), competitorProfileId: String(c.competitorProfileId?.id ?? c.competitorProfileId ?? ""), name: c.competitorProfileId?.name ?? c.name }));
  }

  /** 在销售易竞争对手库里按名称找 [{id, name}] */
  async findCompetitors(name) {
    for (const kw of nameKeywords(name)) {
      const recs = (await this.call("entity-search", { entity: "competitorProfile", keyWord: kw })).data?.result?.records ?? [];
      if (recs.length) return recs.map((c) => ({ id: String(c.id), name: c.name }));
    }
    return [];
  }

  /** 把一条建议更新变成具体的 MCP 调用；oppId / accountId 取自当前这条拜访记录，不信任 op 里的 ID */
  updateCall(op, { oppId, accountId }) {
    if (op.kind === "budget") return ["entity-update", { entity: "opportunity", recordId: String(oppId), fields: { projectBudget: Number(op.value) } }];
    if (op.kind === "contactRole") return ["entity-update", { entity: "contact", recordId: String(op.contactId), fields: { contactRole: op.to } }];
    if (op.kind === "competitor") return ["entity-create", { entity: "opportunityCompetitor", fields: { name: op.name, opportunityId: String(oppId), competitorProfileId: String(op.competitorProfileId), accountId: String(accountId), competitiveStatus: "活跃" } }];
    throw new Error(`不支持的更新类型：${op.kind}`);
  }

  /** 预检：返回 null 表示可以执行，否则返回不能执行的原因 */
  async checkUpdate(op, ids) {
    const [name, args] = this.updateCall(op, ids);
    try {
      const r = await this.call(name, { ...args, dryRun: true });
      const d = r.data ?? {};
      if (d.canExecute === false || d.blockers?.length || d.requiredInputs?.length) {
        return JSON.stringify(d.blockers?.length ? d.blockers : d.requiredInputs).slice(0, 200);
      }
      return null;
    } catch (e) {
      return e.message.match(/"message":\s*"([^"]+)"/)?.[1] ?? e.message.slice(0, 200);
    }
  }

  /** 执行一条已确认的建议更新：再预检一次，通过才写 */
  async applyUpdate(op, { oppId, accountId }) {
    if (op.kind === "contactRole") {
      // 联系人必须属于这条拜访的客户，防止表格里被改成别的联系人
      const ok = (await this.accountContacts(accountId)).some((c) => c.id === String(op.contactId));
      if (!ok) throw new Error("该联系人不属于这个客户");
    }
    const why = await this.checkUpdate(op, { oppId, accountId });
    if (why) throw new Error(why);
    const [name, args] = this.updateCall(op, { oppId, accountId });
    await this.call(name, args);
  }

  opportunityUrl(id) {
    return `${this.webBase}/bff/neoweb#/entity/opportunity/detail/${id}`;
  }
}
