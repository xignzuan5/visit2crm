#!/usr/bin/env node
// 把「拜访录入助手」能力介绍卡片发给销售或销售群（用 lark-cli 绑定应用的机器人发送）。
// 用法：
//   node scripts/send-intro-card.mjs --user ou_xxx     发给某个人
//   node scripts/send-intro-card.mjs --chat oc_xxx     发到群
//   node scripts/send-intro-card.mjs --dry             只打印卡片 JSON
// 配图放在 aily/images/{hero,features,start}.png（GPT 生成的设计图），按内容哈希上传并缓存 image_key，换图会自动重新上传。
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lark } from "../src/lark.mjs";
import { introCard } from "../aily/intro-card.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache/intro-image-keys.json");
const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const exists = (p) => access(p).then(() => true, () => false);

async function imageKey(name, cache) {
  const file = path.join(ROOT, "aily/images", `${name}.png`);
  if (!(await exists(file))) return null;
  const hash = createHash("sha256").update(await readFile(file)).digest("hex").slice(0, 16);
  if (cache[hash]) return cache[hash];
  const res = await lark(["im", "images", "create", "--as", "bot", "--data", JSON.stringify({ image_type: "message" }), "--file", `image=${file}`]);
  cache[hash] = res.data?.image_key ?? res.data?.data?.image_key;
  return cache[hash];
}

const cache = JSON.parse(await readFile(CACHE, "utf8").catch(() => "{}"));
const state = JSON.parse(await readFile(path.join(ROOT, ".secrets/aily-deploy.json"), "utf8").catch(() => "{}"));
const chatLink = opt("--chat-link") || state.chatLink; // 部署脚本会自动记录工作伙伴的飞书对话链接
if (!chatLink) console.warn("提示：没有工作伙伴的对话链接，卡片里不会有「去对话」按钮（先跑 scripts/aily-deploy.mjs，或用 --chat-link 指定）");
const images = { hero: await imageKey("hero", cache), features: await imageKey("features", cache), start: await imageKey("start", cache) };
const card = introCard({ images, chatLink });
await writeFile(CACHE, JSON.stringify(cache, null, 2)).catch(() => {});

if (argv.includes("--dry")) { console.log(JSON.stringify(card, null, 2)); process.exit(); }
const user = opt("--user"), chat = opt("--chat");
if (!user && !chat) { console.error("用 --user ou_xxx 或 --chat oc_xxx 指定发给谁"); process.exit(1); }
const res = await lark(["im", "+messages-send", "--as", "bot", ...(user ? ["--user-id", user] : ["--chat-id", chat]), "--msg-type", "interactive", "--content", JSON.stringify(card)]);
console.log("已发送：", res.data?.message_id ?? JSON.stringify(res.data).slice(0, 120));
