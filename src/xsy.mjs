// 销售易侧：标准 OpenAPI（REST v2.0）。
// 原型阶段用沙箱登录态令牌；正式环境换成销售易 MCP（或 OAuth 连接器令牌），调用面保持这几个函数不变。
import { readFile } from "node:fs/promises";

const OBJECT_ID = { account: 1, opportunity: 3 }; // activityrecord.activityRecordFrom 用的对象编号

export class Xsy {
  constructor({ apiBase, tokenFile, webBase, stages = [] }) {
    this.apiBase = apiBase;
    this.tokenFile = tokenFile;
    this.webBase = webBase;
    this.configStages = stages;
    this._stages = null;
  }

  async close() {}

  async getOpportunity(id) {
    const d = await this.get("opportunity", id);
    return { id: String(id), name: d.opportunityName, stageId: String(d.saleStageId), stageName: d["saleStageId-label"], accountId: String(d.accountId), accountName: d["accountId-label"] };
  }

  async getAccount(id) {
    const d = await this.get("account", id);
    return { id: String(id), name: d.accountName };
  }

  /** 新建跟进记录（OpenAPI 版） */
  async createFollowup({ content, accountId, opportunityId, entityType, ownerId, deptId, intention, startTime }) {
    let stageId = null;
    if (opportunityId) stageId = String((await this.get("opportunity", opportunityId)).saleStageId);
    return this.createActivity({ content, accountId, opportunityId, stageId, entityType, startTime: startTime ?? Date.now(), ownerId, deptId, intention });
  }

  /** OpenAPI 版直接改字段：不会经过销售易的阶段规则（跨阶段、审批、关键字段），仅作 MCP 不可用时的备用 */
  async advanceStage(oppId, targetStageId) {
    const r = await this.updateOpportunityStage(oppId, targetStageId);
    return { ...r, path: [r.stageName] };
  }

  async token() {
    if (!this._token) {
      const t = JSON.parse(await readFile(this.tokenFile, "utf8"));
      if (t.expiration_time && Date.now() > Number(t.expiration_time)) {
        throw new Error("销售易令牌已过期，请重新登录沙箱获取（见 README）");
      }
      this._token = t.access_token;
    }
    return this._token;
  }

  async req(method, path, { json, form } = {}) {
    const headers = { Authorization: await this.token() };
    let body;
    if (json) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(this.apiBase + path, { method, headers, body });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`销售易 ${method} ${path} 返回非 JSON (${res.status}): ${text.slice(0, 200)}`); }
    if (String(data.code) !== "200" && String(data.code) !== "0") {
      throw new Error(`销售易 ${method} ${path} 失败: ${data.code} ${data.msg || ""} ${JSON.stringify(data.errorInfo || data.data || "")}`.slice(0, 500));
    }
    return data.data;
  }

  async xoql(q) {
    const d = await this.req("POST", "/rest/data/v2.0/query/xoql", { form: { xoql: q } });
    return d?.records ?? [];
  }

  get(objectApiKey, id) {
    return this.req("GET", `/rest/data/v2.0/xobjects/${objectApiKey}/${id}`);
  }

  /** 商机阶段列表。优先直接读 stage 对象；无权限时退回「从现有商机里汇总出现过的阶段」 */
  async stages(_oppId) {
    if (this._stages) return this._stages;
    const configStages = this.configStages;
    let list = [];
    try {
      const rows = await this.xoql("select id,stageName,stageOrder,percent from stage order by stageOrder limit 200");
      list = rows.map((r) => ({ id: String(r.id), name: r.stageName, order: Number(r.stageOrder), percent: Number(r.percent) }));
    } catch { /* 当前账号没有 stage 对象的查询权限 */ }
    if (!list.length) list = configStages.map((s) => ({ ...s, id: String(s.id) }));
    this._stages = list.sort((a, b) => a.order - b.order).map((s) => ({ ...s, closed: /赢单|输单/.test(s.name) || s.percent === 100 }));
    return this._stages;
  }

  /** 按公司名（模糊）找客户；ownerId 不为空时只在该销售负责的客户里找 */
  async findAccounts(names, ownerId) {
    const seen = new Map();
    for (const raw of names) {
      for (const kw of nameKeywords(raw)) {
        const where = [`accountName like '%${kw.replace(/'/g, "")}%'`];
        if (ownerId) where.push(`ownerId = ${ownerId}`);
        const rows = await this.xoql(`select id,accountName,ownerId from account where ${where.join(" and ")} limit 10`);
        for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, { id: String(r.id), name: r.accountName, keyword: kw, query: raw });
        if (rows.length) break; // 这个名字用最长关键词已命中，不再放宽
      }
    }
    return [...seen.values()];
  }

  /** 客户下进行中的商机（排除赢单/输单阶段） */
  async openOpportunities(accountId) {
    const rows = await this.xoql(
      `select id,opportunityName,saleStageId,ownerId,closeDate,money from opportunity where accountId = ${accountId} order by updatedAt desc limit 50`);
    const out = [];
    for (const r of rows) {
      const detail = await this.get("opportunity", r.id);
      const stageName = detail["saleStageId-label"] || "";
      if (/赢单|输单|关闭/.test(stageName)) continue;
      out.push({ id: String(r.id), name: r.opportunityName, stageId: String(r.saleStageId), stageName, money: r.money });
    }
    return out;
  }

  /** 新增跟进记录（活动记录），挂到商机（无商机时挂客户） */
  async createActivity({ content, accountId, opportunityId, stageId, entityType, startTime, ownerId, deptId, intention }) {
    const data = {
      entityType,
      content,
      startTime,
      dimDepart: deptId,
      dbcRelation26: Number(accountId),
      activityRecordFrom: opportunityId ? OBJECT_ID.opportunity : OBJECT_ID.account,
      activityRecordFrom_data: Number(opportunityId || accountId),
    };
    if (ownerId) data.ownerId = Number(ownerId);
    if (stageId) data.saleStageId = Number(stageId);
    if (intention != null) data.intentionalDegree = intention;
    const d = await this.req("POST", "/rest/data/v2.0/xobjects/activityrecord", { json: { data } });
    return String(d.id);
  }

  /** 更新商机阶段 */
  async updateOpportunityStage(opportunityId, stageId) {
    await this.req("PATCH", `/rest/data/v2.0/xobjects/opportunity/${opportunityId}`, { json: { data: { saleStageId: Number(stageId) } } });
    const after = await this.get("opportunity", opportunityId);
    return { stageId: String(after.saleStageId), stageName: after["saleStageId-label"] };
  }

  opportunityUrl(id) {
    return `${this.webBase}/bff/neoweb#/entity/opportunity/detail/${id}`;
  }
}

/** 「星河智能科技有限公司」→ ["星河智能科技", "星河智能", "星河"]：去掉常见后缀后由长到短尝试 */
export function nameKeywords(name) {
  let s = String(name).replace(/【[^】]*】|\(.*?\)|（.*?）/g, "").trim();
  s = s.replace(/(股份)?有限(责任)?公司$|集团$|公司$/g, "");
  const out = [s];
  const suffix = /(科技|技术|信息|网络|智能|软件|实业|贸易|电子|数据|控股)$/;
  let cur = s;
  while (suffix.test(cur)) {
    cur = cur.replace(suffix, "");
    if (cur.length >= 2) out.push(cur);
  }
  return [...new Set(out.filter((k) => k.length >= 2))];
}
