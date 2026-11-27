#!/usr/bin/env node
// 核对 visit-brief 技能的输出。
// 单条（只需逐字稿）：
//   - 格式：标题、唯一的拜访目的及依据、单段日报总结（≤100 字、字数标得对）、客户提问列表或「这次客户没有提问。」
//   - 每一行提问都能在逐字稿那个时间的那一段里原样找到，而且是整句（从句首抄到句末）
//   - 不重复抄同一处、按逐字稿顺序、被插话切开的问题分行抄
//   - 逐字稿有认不出来的行时报错（没读全就不能下「没有提问」的结论）
// 整套（另按 test-fixtures/brief/expected.json 的逐处标注）：
//   - 每一行必须正好是标注过的一句或相邻几句，不多带别人的话；不漏收、不重复收
//   - 「问的是客户自己同事」「拿不准是谁问的」不漏标、不错标
//   - 日报总结的几条关键事实和几类常见的写反。日报是概括，最终以人工复核为准
//
// 单条：node scripts/check-visit-brief.mjs <逐字稿.txt> <速记.txt>
// 整套：node scripts/check-visit-brief.mjs --suite <速记所在目录>   （速记文件名 = 用例名.txt）
import { readFileSync, existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURES = path.join(ROOT, "test-fixtures/brief");
const SUMMARY_MAX = 100;
const SENTENCE_END = /[。？！?!；;…]$/;
const NO_TIME = "--:--:--";
const TIME = String.raw`(\d{2}:\d{2}:\d{2}|--:--:--)`;
const NONE_LINE = "客户提问：这次客户没有提问。";

const lf = (s) => s.replace(/\r\n?/g, "\n");
const pad = (t) => {
  const p = t.split(":").map((x) => x.padStart(2, "0"));
  return (p.length === 2 ? ["00", ...p] : p).join(":");
};

// 逐字稿，支持：
//   妙记导出：「Speaker 2 00:01:42.600」一行，下面是原文，空行分段（段头和正文之间多空行也行）
//   同一行：「[00:01:42] 刘总：原文」「00:01:42 刘总：原文」，没有时间的「刘总：原文」
// 开头的「日期|时长」和 Keywords 段是元数据；其余认不出来的非空行记进 unparsed。
export function parseTranscript(text) {
  const lines = lf(text).split("\n");
  const paras = [];
  const unparsed = [];
  let meta = {};
  let cur = null;
  let inKeywords = false;
  lines.forEach((line, i) => {
    const blank = !line.trim();
    if (inKeywords) { if (blank) inKeywords = false; return; }
    if (cur) {
      if (!blank) { cur.text += line; return; }
      if (cur.text) cur = null; // 段落结束；段头后的空行不分段
      return;
    }
    if (blank) return;
    let m;
    if (!paras.length && !meta.date && (m = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/))) meta = { date: `${m[2]}-${m[3]} ${m[4]}` };
    else if (/^Keywords[:：]?\s*$/i.test(line)) inKeywords = true;
    else if ((m = line.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)(\.\d+)?\]?\s+([^:：\s]{1,20})[:：](.*)$/)))
      paras.push({ speaker: m[3], time: pad(m[1]), stamp: pad(m[1]) + (m[2] ?? ""), text: m[4], line: i + 1 });
    else if ((m = line.match(/^(.{1,40}?)\s+(\d{1,2}:\d{2}:\d{2})(\.\d+)?\s*$/)))
      paras.push((cur = { speaker: m[1], time: pad(m[2]), stamp: pad(m[2]) + (m[3] ?? ""), text: "", line: i + 1 }));
    else if ((m = line.match(/^([^:：\s[\]]{1,20})[:：](.*)$/)))
      paras.push({ speaker: m[1], time: null, stamp: null, text: m[2], line: i + 1 });
    else unparsed.push({ line: i + 1, text: line });
  });
  return { paras: paras.map((p, index) => ({ ...p, index })), meta, unparsed };
}

export function parseBrief(text) {
  const lines = lf(text).split("\n");
  const out = { title: null, purposes: [], summaryHeaders: [], summaryLines: [], declaredCount: null,
    questionHeaders: [], none: false, declaredItems: null, items: [], colleague: [], unsure: [], junk: [] };
  let section = "head";
  const nums = (s) => s.split(/[、,，\s]+/).filter(Boolean).map(Number);
  lines.forEach((l, i) => {
    const ln = i + 1;
    if (!l.trim()) return;
    let m;
    if (out.title == null) { out.title = l.trim(); return; }
    if (/^拜访目的/.test(l)) {
      m = l.match(/^拜访目的[:：]\s*([^（(]+?)\s*[（(](.*)[）)]\s*$/);
      out.purposes.push(m ? { purpose: m[1].trim(), basis: m[2].trim() } : { purpose: l.replace(/^拜访目的[:：]?/, "").trim(), basis: "" });
      return;
    }
    if (/^日报总结/.test(l)) {
      section = "summary";
      out.summaryHeaders.push(ln);
      if ((m = l.match(/[（(]\s*(\d+)\s*字\s*[）)]/))) out.declaredCount = Number(m[1]);
      return;
    }
    if (/^客户提问/.test(l)) {
      section = "questions";
      out.questionHeaders.push(ln);
      if (l.trim() === NONE_LINE) out.none = true;
      else if ((m = l.match(/^客户提问[（(]\s*(\d+)\s*条[^）)]*[）)][:：]\s*$/))) out.declaredItems = Number(m[1]);
      else out.junk.push({ line: ln, text: l, why: "「客户提问」这一行格式不对" });
      return;
    }
    if (section === "summary") { out.summaryLines.push(l); return; }
    if (section === "questions") {
      if ((m = l.match(new RegExp(`^(\\d+)\\. ${TIME} (.*)$`)))) out.items.push({ no: Number(m[1]), line: ln, segs: [{ time: m[2], text: m[3], line: ln }] });
      else if ((m = l.match(new RegExp(`^[ \\t\\u3000]+${TIME} (.*)$`))) && out.items.length) out.items.at(-1).segs.push({ time: m[1], text: m[2], line: ln });
      else if ((m = l.match(/^问的是客户自己同事[:：]\s*第\s*(.+?)\s*条\s*$/))) out.colleague.push(...nums(m[1]));
      else if ((m = l.match(/^拿不准是谁问的[:：]\s*第\s*(.+?)\s*条\s*$/))) out.unsure.push(...nums(m[1]));
      else out.junk.push({ line: ln, text: l });
      return;
    }
    out.junk.push({ line: ln, text: l });
  });
  out.summary = out.summaryLines.join("");
  return out;
}

const before = (a, b) => a.para < b.para || (a.para === b.para && a.start < b.start);

// 在这段里找 needle 的每一处出现，并判断是不是整句
function hitsIn(para, needle, { headOnly, tailOnly }) {
  const hits = [];
  if (!needle) return hits;
  for (let at = para.text.indexOf(needle); at >= 0; at = para.text.indexOf(needle, at + 1)) {
    const pre = para.text.slice(0, at).trimEnd();
    const post = para.text.slice(at + needle.length).trim();
    const startOk = pre === "" || (!headOnly && SENTENCE_END.test(pre));
    const endOk = post === "" || (!tailOnly && SENTENCE_END.test(needle.trimEnd()));
    hits.push({ para: para.index, start: at, end: at + needle.length, startOk, endOk });
  }
  return hits;
}

export function check(transcriptText, briefText) {
  const { paras, meta, unparsed } = parseTranscript(transcriptText);
  const brief = parseBrief(briefText);
  const errors = [];
  const spoken = paras.filter((p) => p.text.trim());
  if (!spoken.length) errors.push("逐字稿没解析出任何发言，不能据此出速记");
  for (const u of unparsed.slice(0, 5)) errors.push(`逐字稿第 ${u.line} 行没认出来，可能没读全：「${u.text.slice(0, 30)}」`);
  if (unparsed.length && brief.none) errors.push("逐字稿有没认出来的行，不能下「这次客户没有提问」的结论");

  // 结构
  if (!brief.title?.startsWith("拜访速记｜")) errors.push("第一行应是「拜访速记｜…」标题");
  else {
    if (/未提|没提|不详|未知|没有提到/.test(brief.title)) errors.push(`标题里写了说明文字：「${brief.title}」`);
    if (meta.date && !brief.title.includes(meta.date)) errors.push(`标题里的录音时间应为 ${meta.date}：「${brief.title}」`);
  }
  if (brief.purposes.length !== 1) errors.push(`「拜访目的」应出现一次，现在 ${brief.purposes.length} 次`);
  else if (!brief.purposes[0].basis) errors.push("拜访目的后面没写依据");
  if (brief.summaryHeaders.length !== 1) errors.push(`「日报总结」应出现一次，现在 ${brief.summaryHeaders.length} 次`);
  else {
    const n = [...brief.summary].length;
    if (!n) errors.push("日报总结是空的");
    if (brief.summaryLines.length > 1) errors.push(`日报总结应是一段话，现在有 ${brief.summaryLines.length} 行`);
    if (n > SUMMARY_MAX) errors.push(`日报总结 ${n} 字，超过 ${SUMMARY_MAX}`);
    if (brief.declaredCount == null) errors.push("「日报总结」后面没标字数");
    else if (brief.declaredCount !== n) errors.push(`日报总结标的是 ${brief.declaredCount} 字，实际 ${n} 字`);
  }
  if (brief.questionHeaders.length !== 1) errors.push(`「客户提问」应出现一次，现在 ${brief.questionHeaders.length} 次`);
  else if (brief.none && brief.items.length) errors.push("写了「这次客户没有提问」，下面却列了条目");
  else if (!brief.none) {
    if (!brief.items.length) errors.push("「客户提问」既没有条目，也没写「这次客户没有提问。」");
    if (brief.declaredItems != null && brief.declaredItems !== brief.items.length) errors.push(`标的是 ${brief.declaredItems} 条，实际列了 ${brief.items.length} 条`);
  }
  for (const j of brief.junk) errors.push(`速记第 ${j.line} 行${j.why ? j.why : "看不懂"}：「${j.text}」`);
  for (const [label, list] of [["问的是客户自己同事", brief.colleague], ["拿不准是谁问的", brief.unsure]]) {
    if (new Set(list).size !== list.length) errors.push(`「${label}」里有重复的条号`);
    for (const k of new Set(list)) if (!brief.items.some((it) => it.no === k)) errors.push(`「${label}」指向不存在的第 ${k} 条`);
  }

  // 每一行原话：那个时间的那一段里、整句、不重叠、按顺序
  const taken = [];
  let last = { para: -1, start: -1, end: -1 };
  brief.items.forEach((item, i) => {
    if (item.no !== i + 1) errors.push(`第 ${i + 1} 条的序号写成了 ${item.no}`);
    item.segs.forEach((seg, k) => {
      const where = item.segs.length > 1 ? `第 ${item.no} 条第 ${k + 1} 行` : `第 ${item.no} 条`;
      const opts = { headOnly: k > 0, tailOnly: k < item.segs.length - 1 };
      const sameTime = spoken.filter((p) => (seg.time === NO_TIME ? p.time === null : p.time === seg.time));
      const all = sameTime.flatMap((p) => hitsIn(p, seg.text, opts));
      const ahead = all.filter((h) => before(last, h) && h.start >= (h.para === last.para ? last.end : 0));
      const hit = ahead.find((h) => h.startOk && h.endOk) ?? ahead[0];
      if (!hit) {
        if (all.length) errors.push(`${where}的位置和前面的重了，或者排在了前面（应按出现顺序、每处只抄一次）`);
        else {
          const other = spoken.find((p) => p.text.includes(seg.text));
          if (other) errors.push(`${where}时间写的 ${seg.time}，原话在 ${other.time ?? NO_TIME} 那段`);
          else errors.push(`${where}在逐字稿里找不到原样的「${seg.text}」`);
        }
        return;
      }
      if (!hit.startOk) errors.push(`${where}没从句子开头抄（${k > 0 ? "后一段要从那段开头抄" : "前面还有同一句的话"}）：「${seg.text}」`);
      if (!hit.endOk) errors.push(`${where}没抄到句子结尾${k < item.segs.length - 1 ? "（前一段要抄到那段结尾）" : ""}：「${seg.text}」`);
      if (k > 0 && hit.para <= item.segs[k - 1].hit?.para) errors.push(`${where}和上一行在同一段，不用分行`);
      seg.hit = hit;
      taken.push(hit);
      last = hit;
    });
  });
  return { brief, paras: spoken, meta, errors };
}

// ---------- 整套：按逐处标注核对 ----------

function locate(paras, q) {
  const [sec, ms] = q.at.split(".");
  const found = [];
  for (const p of paras) {
    if (p.time !== sec || (ms && !p.stamp?.endsWith("." + ms))) continue;
    for (let at = p.text.indexOf(q.text); at >= 0; at = p.text.indexOf(q.text, at + 1)) found.push({ para: p.index, start: at, end: at + q.text.length });
  }
  const span = found[q.nth ?? 0];
  if (!span) throw new Error(`expected.json 的标注在逐字稿里找不到：${q.at} 「${q.text}」`);
  return span;
}

export function expectCase(brief, paras, exp) {
  const errors = [];
  const purpose = brief.purposes[0]?.purpose;
  if (exp.purpose && purpose !== exp.purpose) errors.push(`拜访目的应为「${exp.purpose}」，写的是「${purpose}」`);
  if (exp.noQuestions && !brief.none) errors.push("这次客户没有提问，应写「这次客户没有提问。」");

  const units = [...exp.questions.map((q) => ({ q })), ...(exp.optional ?? []).map((q) => ({ q, optional: true }))]
    .map((u, id) => ({ ...u, id, spans: (u.q.parts ?? [u.q]).map((x) => locate(paras, x)), items: [] }));
  const name = (u) => `${(u.q.parts?.[0] ?? u.q).at} 「${(u.q.parts ?? [u.q]).map((x) => x.text).join(" / ")}」`;
  const textOf = (para, a, b) => paras.find((p) => p.index === para).text.slice(a, b);

  for (const item of brief.items) {
    if (item.segs.some((s) => !s.hit)) continue; // 原文都找不到的，前面已报错
    if (item.segs.length > 1) {
      // 分行的一题：必须正好是某个被插话切开的问题，逐段相等
      const u = units.find((x) => x.spans.length === item.segs.length && x.spans.every((s, k) => {
        const h = item.segs[k].hit;
        return h.para === s.para && h.start === s.start && h.end === s.end;
      }));
      if (!u) errors.push(`第 ${item.no} 条把不是同一个问题的几段写成了一题，或者分段抄得不完整`);
      else u.items.push(item.no);
      continue;
    }
    // 一行：必须正好是标注过的一句或相邻几句（中间只隔空白），不多带别人的话
    const h = item.segs[0].hit;
    const inside = units.filter((u) => u.spans.length === 1 && u.spans[0].para === h.para && u.spans[0].start >= h.start && u.spans[0].end <= h.end);
    const partial = units.filter((u) => u.spans.some((s) => s.para === h.para && s.start < h.end && s.end > h.start) && !inside.includes(u));
    let rest = textOf(h.para, h.start, h.end);
    const offset = h.start;
    for (const u of inside) {
      const s = u.spans[0];
      rest = rest.slice(0, s.start - offset) + " ".repeat(s.end - s.start) + rest.slice(s.end - offset);
    }
    if (!inside.length && !partial.length) errors.push(`第 ${item.no} 条不该抄（不是客户提问）：「${item.segs[0].text}」`);
    else if (rest.trim() && !partial.length) errors.push(`第 ${item.no} 条多带了不是提问的话：「${rest.trim().replace(/\s+/g, "…")}」`);
    for (const u of partial) errors.push(u.spans.length > 1 ? `第 ${item.no} 条只抄了被插话切开的问题的一段：${name(u)}` : `第 ${item.no} 条和标注的问题只重了一部分：${name(u)}`);
    for (const u of inside) u.items.push(item.no);
  }

  for (const u of units) {
    if (u.items.length > 1) errors.push(`同一个问题抄了 ${u.items.length} 次（第 ${u.items.join("、")} 条）：${name(u)}`);
    if (!u.items.length && !u.optional) errors.push(`漏了：${name(u)}`);
  }
  for (const [flag, list, label] of [["colleague", brief.colleague, "问客户同事"], ["unsure", brief.unsure, "说话人拿不准"]]) {
    for (const u of units) if (u.q[flag] && u.items.length && !u.items.some((no) => list.includes(no))) errors.push(`第 ${u.items[0]} 条是${label}，没标出来`);
    for (const no of new Set(list)) {
      const owners = units.filter((u) => u.items.includes(no));
      if (owners.length && !owners.some((u) => u.q[flag])) errors.push(`第 ${no} 条不是${label}，标错了`);
    }
  }

  for (const group of exp.summaryMust ?? []) if (!group.some((re) => new RegExp(re).test(brief.summary))) errors.push(`日报总结没写到「${group.join(" 或 ")}」`);
  for (const re of exp.summaryNot ?? []) if (new RegExp(re).test(brief.summary)) errors.push(`日报总结里有录音里没有的结论（${re}）`);
  return errors;
}

export function loadCases() {
  return JSON.parse(readFileSync(path.join(FIXTURES, "expected.json"), "utf8")).cases;
}

export function checkCase(name, briefText, cases = loadCases()) {
  const { brief, paras, errors } = check(readFileSync(path.join(FIXTURES, `${name}.txt`), "utf8"), briefText);
  return [...errors, ...expectCase(brief, paras, cases[name])];
}

function report(name, errors) {
  console.log(errors.length ? `✗ ${name}` : `✓ ${name}`);
  for (const e of errors) console.log(`    ${e}`);
  return errors.length ? 1 : 0;
}

const isMain = (() => {
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
})();

if (isMain) {
  const args = process.argv.slice(2);
  let failed = 0;
  let checked = 0;
  if (args[0] === "--suite") {
    const dir = args[1];
    if (!dir) { console.log("用法：--suite <速记所在目录>"); process.exit(2); }
    const cases = loadCases();
    for (const name of Object.keys(cases)) {
      const file = path.join(dir, `${name}.txt`);
      failed += report(name, existsSync(file) ? checkCase(name, readFileSync(file, "utf8"), cases) : [`缺少 ${file}`]);
      checked++;
    }
  } else if (args.length === 2) {
    // 单条只能核格式、原文位置和字数；漏收错收要有人工标注，用 --suite
    failed += report(args[1], check(readFileSync(args[0], "utf8"), readFileSync(args[1], "utf8")).errors);
    checked++;
  } else {
    console.log("用法：node scripts/check-visit-brief.mjs <逐字稿.txt> <速记.txt>\n      node scripts/check-visit-brief.mjs --suite <速记所在目录>");
    process.exit(2);
  }
  console.log(`\n核对 ${checked} 份，${failed ? `${failed} 份有问题` : "全部通过"}`);
  process.exit(failed || !checked ? 1 : 0);
}
