// visit-brief 核对脚本的回归测试：node --test scripts/check-visit-brief.test.mjs
// 以 test-fixtures/brief/golden/ 里的合格速记为底，每条用例改一处，确认坏的被拦住、好的不误报。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCase, check, expectCase, parseTranscript, FIXTURES } from "./check-visit-brief.mjs";

const golden = (name) => readFileSync(path.join(FIXTURES, "golden", `${name}.txt`), "utf8");
const sub = (s, a, b) => {
  assert.ok(s.includes(a), `测试本身写错了：底稿里没有「${a}」`);
  return s.replace(a, b);
};
const setSummary = (s, text) => s.replace(/日报总结（\d+ 字）：\n.*\n/, `日报总结（${[...text].length} 字）：\n${text}\n`);
// 对调两行的内容，序号保持 1、2 不变
const swapLines = (s, a, b) => {
  const [na, nb] = [a.match(/^\d+\./)[0], b.match(/^\d+\./)[0]];
  return sub(sub(sub(s, a, "@@A@@"), b, a.replace(na, nb)), "@@A@@", b.replace(nb, na));
};

const QINGHE = "qinghe-product-intro", QIMING = "qiming-negotiation", NEEDS = "xinghe-needs-1123", ADV = "xinghe-advance-1124", HT = "hengtong-advance";
const QIMING_1 = "1. 00:00:13 你们这个报价里头，实施费是单独算的，\n   00:00:19 还是已经含在里面了？";

const bad = [
  // 原话被改
  ["删掉问句前半句背景", QINGHE, (s) => sub(s, "3. 00:00:44 我们现在工单系统是自己开发的，", "3. 00:00:44 ")],
  ["删掉话头「还有，」", QINGHE, (s) => sub(s, "00:01:26 还有，", "00:01:26 ")],
  ["数字空格被规范化", HT, (s) => sub(s, "尾款那 30 万", "尾款那30万")],
  ["问号改成半角", NEEDS, (s) => sub(s, "那价格方面呢？", "那价格方面呢?")],
  ["引文首尾加空格", NEEDS, (s) => sub(s, "1. 00:00:54 那价格方面呢？", "1. 00:00:54  那价格方面呢？ ")],
  ["用……拼成一行", QIMING, (s) => sub(s, QIMING_1, "1. 00:00:13 你们这个报价里头，实施费是单独算的，……还是已经含在里面了？")],
  // 多带别人的话
  ["连带销售的回答", QINGHE, (s) => sub(s, "9. 00:01:47 测一轮要多长时间？", "9. 00:01:47 测一轮要多长时间？大概一周。")],
  ["问句后多抄解释句", QIMING, (s) => sub(s, "3. 00:00:39 付款方式呢，你们能接受三三四吗？", "3. 00:00:39 付款方式呢，你们能接受三三四吗？验收以后再付最后那个 40%。")],
  ["续行接上销售的折扣答复", QIMING, (s) => sub(s, QIMING_1, QIMING_1 + "\n   00:00:32 按我的权限最多能到九折，再低要我们区域总批。")],
  ["多抄一句销售的话", NEEDS, (s) => sub(sub(s, "（1 条", "（2 条"), "1. 00:00:54 那价格方面呢？", "1. 00:00:54 那价格方面呢？\n2. 00:01:01 30 万的预算覆盖 200 坐席的方案是够的，我回去按私有化方案给您出一版正式报价。")],
  ["收了口头语「对吧」", QINGHE, (s) => sub(sub(sub(s, "（9 条", "（10 条"), "9. 00:01:47 测一轮要多长时间？", "9. 00:01:47 测一轮要多长时间？\n10. 00:01:55 最近也挺忙的，对吧，年底了。"), "", "")],
  // 重复、顺序、拼题
  ["同一处抄两次", NEEDS, (s) => sub(sub(s, "（1 条", "（2 条"), "1. 00:00:54 那价格方面呢？", "1. 00:00:54 那价格方面呢？\n2. 00:00:54 那价格方面呢？")],
  ["合列后又单列一次", QIMING, (s) => sub(sub(s, "（4 条", "（5 条"), "4. 00:00:51 还有就是培训，我们护士站人多，现场培训你们给几次，要不要另外收钱？", "4. 00:00:51 还有就是培训，我们护士站人多，现场培训你们给几次，要不要另外收钱？\n5. 00:00:25 最多能给到几折？")],
  ["前两问对调", QINGHE, (s) => swapLines(s, "1. 00:00:19 这个机器人是你们自己做的，还是接的别人家的大模型？", "2. 00:00:33 那私有话部署的话，对服务器有什么要求，要几张卡？")],
  ["两段倒序", QIMING, (s) => sub(s, QIMING_1, "1. 00:00:19 还是已经含在里面了？\n   00:00:13 你们这个报价里头，实施费是单独算的，")],
  ["不相干的两问写成一题", HT, (s) => sub(sub(sub(s, "3. 00:00:34 那配错了能回滚吗？\n", ""), "1. 00:00:06 你们这个系统过了等保三级没有？", "1. 00:00:06 你们这个系统过了等保三级没有？\n   00:00:34 那配错了能回滚吗？"), "（8 条", "（7 条").replace(/^(\d+)\. /gm, (m, n) => (Number(n) > 3 ? `${n - 1}. ` : m)).replace("第 5 条", "第 4 条")],
  ["时间写错", NEEDS, (s) => sub(s, "1. 00:00:54", "1. 00:00:34")],
  ["有时间的写成 --:--:--", NEEDS, (s) => sub(s, "1. 00:00:54", "1. --:--:--")],
  // 标注
  ["漏标拿不准", QINGHE, (s) => s.replace(/^拿不准是谁问的.*\n?/m, "")],
  ["漏标问同事", HT, (s) => s.replace(/^问的是客户自己同事.*\n?/m, "")],
  ["清楚的客户问题标成问同事", QINGHE, (s) => sub(s, "问的是客户自己同事：第 5 条", "问的是客户自己同事：第 1、5 条")],
  ["清楚的客户问题标成拿不准", QINGHE, (s) => sub(s, "拿不准是谁问的：第 9 条", "拿不准是谁问的：第 1、9 条")],
  ["同一条标两次", QINGHE, (s) => sub(s, "拿不准是谁问的：第 9 条", "拿不准是谁问的：第 9、9 条")],
  ["标注指向第 80 条", QINGHE, (s) => sub(s, "拿不准是谁问的：第 9 条", "拿不准是谁问的：第 80 条")],
  // 结构
  ["条数写成 99", QINGHE, (s) => sub(s, "（9 条", "（99 条")],
  ["没标条数和字数", QINGHE, (s) => sub(s.replace(/日报总结（\d+ 字）：/, "日报总结："), "客户提问（9 条，逐字原话）：", "客户提问：")],
  ["没有提问却列一条", ADV, (s) => s + "\n1. 00:01:38 好，那就这么定。\n"],
  ["零问声明改成别的话", ADV, (s) => sub(s, "客户提问：这次客户没有提问。", "客户提问：无法判断这次有没有提问。")],
  ["标题日期写错", NEEDS, (s) => sub(s, "拜访速记｜星河智能 · 11-23 13:24", "拜访速记｜别的公司 · 01-01 03:00")],
  ["两个拜访目的", NEEDS, (s) => sub(s, "\n日报总结", "\n拜访目的：商务谈判（客户谈了预算）\n\n日报总结")],
  ["目的没写依据", NEEDS, (s) => s.replace(/^拜访目的：需求调研（.*）$/m, "拜访目的：需求调研")],
  ["目的写错", NEEDS, (s) => s.replace(/^拜访目的：需求调研/m, "拜访目的：商务谈判")],
  // 日报
  ["日报清空", ADV, (s) => s.replace(/日报总结（\d+ 字）：\n.*\n/, "日报总结（0 字）：\n\n")],
  ["日报超 100 字", NEEDS, (s) => setSummary(s, "星".repeat(101))],
  ["日报字数标错", NEEDS, (s) => s.replace(/日报总结（\d+ 字）/, "日报总结（12 字）")],
  ["日报分两行", NEEDS, (s) => s.replace(/(日报总结（\d+ 字）：\n)(.{10})/, "$1$2\n")],
  ["已签约并全额付款", QIMING, (s) => setSummary(s, "报价28万，预算25万，客户已签约并全额付款，周四前发方案。")],
  ["报价和预算写反", QIMING, (s) => setSummary(s, "我方报价25万元，客户预算28万元，周四前发调整方案。")],
  ["基本通过写成审批通过", ADV, (s) => setSummary(s, "李工技术评估已通过审批，王总看投入产出。周五前发参观安排和招标资质材料。")],
  ["写成王总已签字、材料已发", ADV, (s) => setSummary(s, "技术评估基本通过，王总已经签字，周五的参观安排和招标材料已经发出。")],
  ["写成不用发、会已取消", HT, (s) => setSummary(s, "测评报告明天不用发了，下周三的会议已经取消。")],
];

const good = [
  ["底稿本身", QINGHE, (s) => s],
  ["让价两问分两条列", QIMING, (s) => sub(sub(s, "2. 00:00:25 那如果实施我们自己的信息科配合多做一点，这部分能不能再让一让？最多能给到几折？", "2. 00:00:25 那如果实施我们自己的信息科配合多做一点，这部分能不能再让一让？\n3. 00:00:25 最多能给到几折？"), "（4 条", "（5 条").replace("3. 00:00:39", "4. 00:00:39").replace("4. 00:00:51", "5. 00:00:51")],
  ["中文数字和星期四", QIMING, (s) => setSummary(s, "报价二十八万元，高于客户二十五万元预算，折扣待申请。我方星期四前发调整后的报价、付款及培训方案。")],
  ["预算已获批不算写反", ADV, (s) => setSummary(s, "技术评估基本通过，预算已获批32万元，采购仍需王总签字。我方周五前发参观安排和招标材料。")],
  ["Windows 换行", NEEDS, (s) => s.replace(/\n/g, "\r\n")],
  ["收了可选的「我刚才是不是问过了」", HT, (s) => sub(s, "4. 00:00:40 你们这个系统过了等保三级没有？", "4. 00:00:40 你们这个系统过了等保三级没有？我刚才是不是问过了，哈哈。")],
];

for (const [name, c, f] of bad) test(`拦住：${name}`, () => {
  const errs = checkCase(c, f(golden(c)));
  assert.ok(errs.length > 0, "应该报错却通过了");
});
for (const [name, c, f] of good) test(`不误报：${name}`, () => {
  assert.deepEqual(checkCase(c, f(golden(c))), []);
});

// 合成逐字稿
const brief = (rows, none = false) => [
  "拜访速记｜测试 · 11-01 10:00", "", "拜访目的：产品介绍（测试）", "", "日报总结（2 字）：", "测试", "",
  none ? "客户提问：这次客户没有提问。" : `客户提问（${rows.length} 条，逐字原话）：`, ...rows, "",
].join("\n");
const lark = (paras) => ["2026-11-01 10:00:00 CST|1min", "", "Keywords:", "测试", "", ...paras.flatMap(([t, x]) => [`Speaker 1 ${t} `, x, ""])].join("\n");

test("同一秒的两段各问一次：抄两次通过，只抄一次漏报", () => {
  const tr = lark([["00:00:01.100", "有案例吗？"], ["00:00:01.900", "有案例吗？"]]);
  const paras = check(tr, brief([])).paras;
  const exp = { questions: [{ at: "00:00:01.100", text: "有案例吗？" }, { at: "00:00:01.900", text: "有案例吗？" }] };
  const two = check(tr, brief(["1. 00:00:01 有案例吗？", "2. 00:00:01 有案例吗？"]));
  assert.deepEqual([...two.errors, ...expectCase(two.brief, paras, exp)], []);
  const one = check(tr, brief(["1. 00:00:01 有案例吗？"]));
  assert.ok(expectCase(one.brief, paras, exp).some((e) => e.startsWith("漏了")));
});

test("同一段连问两次：用 nth 区分", () => {
  const tr = lark([["00:00:01.000", "有案例吗？有案例吗？"]]);
  const paras = check(tr, brief([])).paras;
  const exp = { questions: [{ at: "00:00:01", text: "有案例吗？" }, { at: "00:00:01", text: "有案例吗？", nth: 1 }] };
  const two = check(tr, brief(["1. 00:00:01 有案例吗？", "2. 00:00:01 有案例吗？"]));
  assert.deepEqual([...two.errors, ...expectCase(two.brief, paras, exp)], []);
});

test("同一行格式、无时间格式、段头后空行都能读", () => {
  const { paras, unparsed } = parseTranscript("[00:00:01] 小谭：您好。\n刘总：支持私有化吗？\n\nSpeaker 1 00:00:05.000 \n\n能对接吗？\n");
  assert.deepEqual(paras.map((p) => [p.time, p.text]), [["00:00:01", "您好。"], [null, "支持私有化吗？"], ["00:00:05", "能对接吗？"]]);
  assert.deepEqual(unparsed, []);
});

test("逐字稿有认不出来的行：不能报没有提问", () => {
  const errs = check("[00:00:01] 小谭：您好。\n（这里有一段格式不认识的内容）支持私有化吗？\n", brief([], true)).errors;
  assert.ok(errs.some((e) => e.includes("不能下")));
});

test("--:--:-- 只能用在没有时间的段", () => {
  const tr = "[00:00:01] 小谭：您好。\n刘总：支持私有化吗？\n";
  assert.deepEqual(check(tr, brief(["1. --:--:-- 支持私有化吗？"])).errors.filter((e) => !e.includes("录音时间")), []);
  assert.ok(check(tr, brief(["1. --:--:-- 您好。"])).errors.length > 0);
});

test("通过符号链接调用也会核对并报错", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "brief-"));
  for (const name of Object.keys(JSON.parse(readFileSync(path.join(FIXTURES, "expected.json"), "utf8")).cases)) writeFileSync(path.join(dir, `${name}.txt`), "无效速记");
  const link = path.join(dir, "check.mjs");
  symlinkSync(fileURLToPath(new URL("./check-visit-brief.mjs", import.meta.url)), link);
  assert.throws(() => execFileSync(process.execPath, [link, "--suite", dir], { stdio: "pipe" }));
});
