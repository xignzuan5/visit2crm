// AI 整理：从妙记（AI 总结 + 逐字稿）中抽取跟进记录要素；判断商机阶段是否该变
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const client = new Anthropic();

const INTENTIONS = ["无意向", "略有意向", "意向一般", "意向较高", "意向极高"];

const VisitSchema = z.object({
  is_customer_conversation: z.boolean().describe("是否为销售与外部客户的沟通（拜访/会议/电话）。内部会议、培训、闲聊为 false"),
  not_customer_reason: z.string().describe("is_customer_conversation 为 false 时说明原因，否则为空字符串"),
  customer_company_names: z.array(z.string()).describe("对话中出现的客户公司名，按可能性从高到低；用对话中的原始说法，可补全为常见全称"),
  multiple_customers: z.boolean().describe("录音里是否涉及多家不同客户的独立沟通"),
  contacts: z.array(z.object({ name: z.string(), title: z.string() })).describe("客户方出现的联系人，title 不清楚则为空字符串"),
  visit_type: z.enum(["拜访", "线上会议", "电话"]),
  key_points: z.array(z.string()).describe("沟通要点，每条一句话"),
  needs_and_concerns: z.array(z.string()).describe("客户需求与顾虑"),
  agreements: z.array(z.string()).describe("双方达成的共识；没有则为空数组"),
  next_steps: z.array(z.string()).describe("下一步安排，尽量包含时间和负责人"),
  intention: z.enum(INTENTIONS).describe("客户意向程度"),
});

const StageSchema = z.object({
  should_change: z.boolean(),
  target_stage: z.string().describe("should_change 为 true 时必须是候选阶段名之一；否则为空字符串"),
  evidence_quote: z.string().describe("支撑判断的客户原话，必须逐字摘自逐字稿；没有则为空字符串"),
  reason: z.string().describe("一句话说明理由"),
});

async function parse(schema, system, user) {
  const msg = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (msg.stop_reason === "refusal") throw new Error(`模型拒绝处理该妙记: ${JSON.stringify(msg.stop_details)}`);
  if (msg.stop_reason === "max_tokens") throw new Error("模型输出被截断（max_tokens）");
  if (!msg.parsed_output) throw new Error("模型输出无法解析为预期结构");
  return msg.parsed_output;
}

export async function analyzeVisit({ title, summary, transcript, salesName }) {
  const system = [
    "你是销售团队的拜访记录整理助手。输入是一条飞书妙记（来自录音豆等录音设备）的 AI 总结和逐字稿。",
    "逐字稿是语音识别结果，说话人标签可能不准、可能有错别字；以语义判断谁是销售、谁是客户。",
    `本条录音的销售是「${salesName}」。`,
    "只写录音里真实出现的信息，不要编造数字、时间、人名。要点要具体、可执行，避免空话。",
  ].join("\n");
  const user = `# 妙记标题\n${title}\n\n# 妙记 AI 总结\n${summary || "（无）"}\n\n# 逐字稿\n${transcript}`;
  return parse(VisitSchema, system, user);
}

export async function judgeStage({ summary, transcript, currentStage, stages }) {
  const candidates = stages.map((s) => `${s.order}. ${s.name}（赢率 ${s.percent ?? "?"}%）`).join("\n");
  const system = [
    "你负责判断一次客户沟通后，CRM 中商机的销售阶段是否应该变化。公司没有成文的阶段推进标准，因此要保守：",
    "- 只有客户明确表态（例如明确要求正式报价、确认预算并要走采购、确认进入商务谈判）时才建议变更；模糊意向一律不变。",
    "- 只能从候选阶段中选择；不得建议赢单、输单等关闭类阶段。",
    "- evidence_quote 必须逐字摘自逐字稿中客户说的话；找不到这样的原话就不建议变更。",
  ].join("\n");
  const user = `# 当前阶段\n${currentStage}\n\n# 候选阶段（按推进顺序）\n${candidates}\n\n# 妙记 AI 总结\n${summary || "（无）"}\n\n# 逐字稿\n${transcript}`;
  const r = await parse(StageSchema, system, user);
  // 兜底校验：不在候选里、与当前相同、或原话不在逐字稿中 → 不建议
  const target = stages.find((s) => s.name === r.target_stage);
  const quoteOk = quoted(transcript, r.evidence_quote);
  if (!r.should_change || !target || target.name === currentStage || !quoteOk) {
    return { ...r, should_change: false, target: null, note: !quoteOk && r.should_change ? "依据原话未能在逐字稿中核对到，已取消建议" : "" };
  }
  return { ...r, target };
}

const normalize = (s) => String(s).replace(/[\s，。,.！!？?、：:；;“”"'‘’]/g, "");
/** 原话能否在逐字稿里核对到（取前 12 个字比对，容忍标点和空格差异） */
const quoted = (transcript, q) => Boolean(q) && normalize(transcript).includes(normalize(q).slice(0, 12));

// ---------------------------------------------------------------- 商机情报（MEDDPICC）
// 顺序按销售聊单子的自然顺序排，不按缩写字母
export const DEAL_ITEMS = [
  ["pain", "痛点"],
  ["metrics", "量化收益"],
  ["economic_buyer", "经济决策人"],
  ["decision_criteria", "决策标准"],
  ["decision_process", "决策流程"],
  ["paper_process", "采购/合同流程"],
  ["champion", "内部支持者"],
  ["competition", "竞争"],
];
const ROLES = ["决策者", "审批者", "评估者", "用户", "权力支持者", "其它"]; // 与销售易「联系人角色」选项一致

const item = (desc) => z.object({
  known: z.boolean().describe("客户在录音里是否明确谈到"),
  summary: z.string().describe("一句话概括，具体到人名、数字、时间；known=false 时为空字符串"),
  quote: z.string().describe("支撑的客户原话，必须逐字摘自逐字稿；known=false 时为空字符串"),
}).describe(desc);

const DealSchema = z.object({
  pain: item("痛点：客户现在遇到的问题，以及不解决的后果"),
  metrics: item("量化收益：客户希望达到的可衡量结果，如排队时长、人力成本、转化率"),
  economic_buyer: item("经济决策人：最终拍板、掌握预算的人是谁"),
  decision_criteria: item("决策标准：客户用来评估方案的标准，如技术、价格、交付周期、安全"),
  decision_process: item("决策流程：从评估到拍板要经过哪些人、哪些步骤、什么时间"),
  paper_process: item("采购/合同流程：招标、采购、法务审合同、盖章付款等环节和周期"),
  champion: item("内部支持者：客户内部谁明确表示支持我们、愿意帮我们推动"),
  competition: item("竞争：客户同时在看的其他供应商，或自研、维持现状等替代方案"),
  budget_yuan: z.number().nullable().describe("客户明确说出的项目预算（元）。「三十万左右」=300000；没说具体数字为 null"),
  budget_quote: z.string().describe("说出预算的客户原话，逐字摘自逐字稿；budget_yuan 为 null 时为空字符串"),
  people: z.array(z.object({
    mention: z.string().describe("录音里的称呼，如 张总、李工、王总"),
    crm_contact_id: z.string().describe("对应的销售易联系人 ID，只能从给出的联系人列表里选；对不上或拿不准为空字符串"),
    role: z.enum(ROLES).describe("此人在这单里的角色"),
    quote: z.string().describe("能直接看出此人是这个角色的那句客户原话，逐字摘自逐字稿（如权力支持者要摘表示支持我们的那句，决策者要摘说明他拍板的那句）"),
  })).describe("客户方在这单决策里角色明确的人；角色说不清的不要列"),
  competitors: z.array(z.object({
    name: z.string().describe("竞争对手的公司或产品名，用录音里的说法"),
    quote: z.string().describe("提到它的客户原话，逐字摘自逐字稿"),
  })).describe("客户明确提到在对比的其他供应商"),
  next_questions: z.array(z.string()).describe("针对还没摸清的项里最要紧的 2–3 项，下次拜访可以直接开口问的问题；全摸清了为空数组"),
});

/**
 * 按 MEDDPICC 从一次客户沟通里提取商机情报。
 * contacts：该客户在销售易里已有的联系人 [{id, name, post}]，用来把「张总」「李工」对应到具体联系人。
 * 每一项都要有能在逐字稿里核对到的客户原话，核对不到的一律当作「未知」。
 */
export async function extractDeal({ summary, transcript, salesName, accountName, opportunityName, contacts = [] }) {
  const system = [
    "你是 B2B 销售教练，按 MEDDPICC 方法论从一次客户沟通里提取商机情报。",
    `本次沟通的销售是「${salesName}」，客户是「${accountName}」${opportunityName ? `，商机是「${opportunityName}」` : ""}。`,
    "逐字稿是语音识别结果，说话人标签可能不准；按语义判断哪些话是客户说的。",
    "- 只记录客户在录音里明确说出的信息。没谈到、只能推测、或只是销售自己说的，known=false。",
    "- 每一项都要给出逐字摘自逐字稿的客户原话；找不到原话就当作没谈到。",
    "- 人物角色：决策者=最终拍板或掌握预算的人；审批者=要签字审批但不主导选型的人（如法务、采购、财务审批）；评估者=做技术或业务评估的人；用户=实际使用的人；权力支持者=有影响力并明确支持我们的人（内部支持者）；其它=以上都不是。",
    "- 联系人对应：只能从给出的销售易联系人列表里选 ID。按姓氏和职务判断（如「李工」对应姓李的技术负责人）；同姓多人或职务明显不符时留空。",
    "- next_questions 要具体、口语化，销售下次见面可以直接问出口。",
  ].join("\n");
  const contactList = contacts.length ? contacts.map((c) => `- ${c.id}｜${c.name}｜${c.post || "职务未填"}`).join("\n") : "（该客户在销售易里还没有联系人）";
  const user = `# 销售易里该客户的联系人（ID｜姓名｜职务）\n${contactList}\n\n# 妙记 AI 总结\n${summary || "（无）"}\n\n# 逐字稿\n${transcript}`;
  const d = await parse(DealSchema, system, user);

  // 兜底校验：原话核对不到 → 当作未知；联系人 ID 必须来自给定列表
  const ids = new Set(contacts.map((c) => String(c.id)));
  for (const [k] of DEAL_ITEMS) if (d[k].known && !quoted(transcript, d[k].quote)) d[k] = { known: false, summary: "", quote: "" };
  if (d.budget_yuan != null && !(d.budget_yuan > 0 && quoted(transcript, d.budget_quote))) { d.budget_yuan = null; d.budget_quote = ""; }
  d.people = d.people.filter((p) => quoted(transcript, p.quote)).map((p) => ({ ...p, crm_contact_id: ids.has(String(p.crm_contact_id)) ? String(p.crm_contact_id) : "" }));
  d.competitors = d.competitors.filter((c) => c.name && quoted(transcript, c.quote));
  return d;
}

/** 跟进记录里的「商机情报」一节：摸清的逐项列出，没摸清的列名字 + 下次建议问的问题 */
export function formatDeal(d) {
  if (!d) return "";
  const known = DEAL_ITEMS.filter(([k]) => d[k]?.known).map(([k, label]) => `· ${label}：${d[k].summary}`);
  const unknown = DEAL_ITEMS.filter(([k]) => !d[k]?.known).map(([, label]) => label);
  return [
    "商机情报（MEDDPICC）：",
    ...(known.length ? known : ["· 这次沟通没有谈到明确的商机信息"]),
    unknown.length ? `待摸清：${unknown.join("、")}` : "",
    d.next_questions?.length ? `下次可以问：\n${d.next_questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

export function intentionValue(label) {
  const i = INTENTIONS.indexOf(label);
  return i < 0 ? null : i;
}

/** 写进销售易「活动记录内容」的正文 */
export function formatFollowup(v, { minuteUrl, deal } = {}) {
  const sec = (title, items) => (items?.length ? `${title}\n${items.map((x, i) => `${i + 1}. ${x}`).join("\n")}` : "");
  return [
    `【${v.visit_type}纪要】（AI 整理自录音豆妙记）`,
    v.contacts?.length ? `客户联系人：${v.contacts.map((c) => (c.title ? `${c.name}（${c.title}）` : c.name)).join("、")}` : "",
    sec("沟通要点：", v.key_points),
    sec("客户需求与顾虑：", v.needs_and_concerns),
    sec("达成共识：", v.agreements),
    sec("下一步：", v.next_steps),
    formatDeal(deal),
    minuteUrl ? `妙记：${minuteUrl}` : "",
  ].filter(Boolean).join("\n\n");
}
