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
  const quoteOk = r.evidence_quote && normalize(transcript).includes(normalize(r.evidence_quote).slice(0, 12));
  if (!r.should_change || !target || target.name === currentStage || !quoteOk) {
    return { ...r, should_change: false, target: null, note: !quoteOk && r.should_change ? "依据原话未能在逐字稿中核对到，已取消建议" : "" };
  }
  return { ...r, target };
}

const normalize = (s) => String(s).replace(/[\s，。,.！!？?、：:；;“”"'‘’]/g, "");

export function intentionValue(label) {
  const i = INTENTIONS.indexOf(label);
  return i < 0 ? null : i;
}

/** 写进销售易「活动记录内容」的正文 */
export function formatFollowup(v, { minuteUrl }) {
  const sec = (title, items) => (items?.length ? `${title}\n${items.map((x, i) => `${i + 1}. ${x}`).join("\n")}` : "");
  return [
    `【${v.visit_type}纪要】（AI 整理自录音豆妙记）`,
    v.contacts?.length ? `客户联系人：${v.contacts.map((c) => (c.title ? `${c.name}（${c.title}）` : c.name)).join("、")}` : "",
    sec("沟通要点：", v.key_points),
    sec("客户需求与顾虑：", v.needs_and_concerns),
    sec("达成共识：", v.agreements),
    sec("下一步：", v.next_steps),
    minuteUrl ? `妙记：${minuteUrl}` : "",
  ].filter(Boolean).join("\n\n");
}
