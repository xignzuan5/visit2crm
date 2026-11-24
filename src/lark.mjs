// 飞书侧：全部通过官方 lark-cli 调用（妙记 / 多维表格 / 消息卡片）
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const execFileP = promisify(execFile);

function parseJson(stdout) {
  const i = stdout.indexOf("{");
  if (i < 0) throw new Error(`lark-cli 输出不是 JSON: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(i));
}

export async function lark(args) {
  let stdout;
  try {
    ({ stdout } = await execFileP("lark-cli", args, { maxBuffer: 64 << 20 }));
  } catch (e) {
    const out = e.stdout || "";
    const err = e.stderr || e.message;
    throw new Error(`lark-cli ${args.slice(0, 3).join(" ")} 失败: ${(out + err).slice(0, 800)}`);
  }
  const json = parseJson(stdout);
  if (json.ok === false) throw new Error(`lark-cli ${args.slice(0, 3).join(" ")} 失败: ${JSON.stringify(json.error)}`);
  return json;
}

// ---------- 妙记 ----------

/** 搜索某个用户（默认当前登录用户）自 start 以来的妙记 */
export async function searchMinutes({ start, ownerIds = "me" }) {
  const items = [];
  let pageToken;
  for (let i = 0; i < 10; i++) {
    const args = ["minutes", "+search", "--as", "user", "--owner-ids", ownerIds, "--page-size", "30"];
    if (start) args.push("--start", start);
    if (pageToken) args.push("--page-token", pageToken);
    const res = await lark(args);
    items.push(...(res.data.items || []));
    if (!res.data.has_more) break;
    pageToken = res.data.page_token;
  }
  return items;
}

/** 妙记基础信息（标题、创建时间、所有者、链接） */
export async function getMinuteInfo(token) {
  const res = await lark(["minutes", "minutes", "get", "--as", "user", "--params", JSON.stringify({ minute_token: token })]);
  return res.data?.minute ?? res.data;
}

/** 妙记 AI 总结 + 逐字稿全文 */
export async function getMinuteContent(token, cacheDir = ".cache/minutes") {
  await mkdir(cacheDir, { recursive: true });
  const res = await lark([
    "minutes", "+detail", "--as", "user", "--minute-tokens", token,
    "--summary", "--transcript", "--output-dir", cacheDir, "--overwrite",
  ]);
  const m = res.data.minutes[0];
  const a = m.artifacts || {};
  const transcript = a.transcript_file ? await readFile(path.resolve(a.transcript_file), "utf8") : "";
  return { title: m.title, summary: a.summary || "", transcript };
}

// ---------- 多维表格 ----------

export class BaseTable {
  constructor({ baseToken, tableId }) {
    this.baseToken = baseToken;
    this.tableId = tableId;
  }

  async list(filter) {
    const args = ["base", "+record-list", "--as", "user", "--base-token", this.baseToken,
      "--table-id", this.tableId, "--format", "json", "--limit", "200"];
    if (filter) args.push("--filter-json", JSON.stringify(filter));
    const res = await lark(args);
    return matrixToRecords(res.data);
  }

  async create(fields) {
    const res = await lark(["base", "+record-batch-create", "--as", "user", "--base-token", this.baseToken,
      "--table-id", this.tableId, "--json", JSON.stringify({ create_records: [fields] })]);
    return firstRecordId(res.data);
  }

  async update(recordId, fields) {
    await lark(["base", "+record-batch-update", "--as", "user", "--base-token", this.baseToken,
      "--table-id", this.tableId, "--json", JSON.stringify({ update_records: { [recordId]: fields } })]);
  }

  /** 老表格升级：缺的列自动补上（只加不删） */
  async ensureFields(defs) {
    const res = await lark(["base", "+field-list", "--as", "user", "--base-token", this.baseToken, "--table-id", this.tableId]);
    const list = res.data?.fields ?? res.data?.items ?? res.data ?? [];
    const have = new Set((Array.isArray(list) ? list : []).map((f) => f.name ?? f.field_name));
    const missing = defs.filter((d) => !have.has(d.name));
    if (missing.length) {
      await lark(["base", "+field-create", "--as", "user", "--base-token", this.baseToken, "--table-id", this.tableId, "--json", JSON.stringify(missing)]);
    }
    return missing.map((d) => d.name);
  }
}

// +record-list --format json 返回 {fields:[...], data:[[...]], record_id_list:[...]} 一类的矩阵；兼容几种形态
function matrixToRecords(data) {
  if (Array.isArray(data?.records)) {
    return data.records.map((r) => ({ record_id: r.record_id ?? r.id, ...(r.fields ?? r) }));
  }
  const cols = data?.fields || data?.columns || data?.header;
  const rows = data?.data || data?.rows || data?.values;
  const ids = data?.record_id_list || data?.record_ids || [];
  if (!cols || !rows) return [];
  const names = cols.map((c) => (typeof c === "string" ? c : c.name ?? c.field_name));
  return rows.map((row, i) => {
    const rec = { record_id: ids[i] ?? row.record_id };
    names.forEach((n, j) => (rec[n] = Array.isArray(row) ? row[j] : row[n]));
    return rec;
  });
}

function firstRecordId(data) {
  const r = data?.records?.[0] ?? data?.record_id_list?.[0] ?? data?.record_ids?.[0];
  if (typeof r === "string") return r;
  return r?.record_id ?? r?.id ?? JSON.stringify(data).match(/rec[A-Za-z0-9]{6,}/)?.[0];
}

export function cellText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(cellText).join("");
  if (typeof v === "object") return v.text ?? v.name ?? v.link ?? v.id ?? JSON.stringify(v);
  return String(v);
}

// ---------- 消息卡片 ----------

export async function sendCard(openId, card) {
  const res = await lark(["im", "+messages-send", "--as", "bot", "--user-id", openId,
    "--msg-type", "interactive", "--content", JSON.stringify(card)]);
  return res.data?.message_id ?? res.data?.data?.message_id;
}

export async function updateCard(messageId, card) {
  await lark(["api", "PATCH", `/open-apis/im/v1/messages/${messageId}`, "--as", "bot",
    "--data", JSON.stringify({ content: JSON.stringify(card) })]);
}

export async function sendText(openId, text) {
  await lark(["im", "+messages-send", "--as", "bot", "--user-id", openId, "--msg-type", "text",
    "--content", JSON.stringify({ text })]);
}
