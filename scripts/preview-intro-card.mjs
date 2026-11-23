#!/usr/bin/env node
// 本地预览能力介绍卡片：按飞书卡片的通栏样式把 aily/images 里的图叠起来，生成 HTML（手机 375px / 桌面 600px 两栏）。
// 用法：node scripts/preview-intro-card.mjs [输出路径，默认 .cache/intro-preview.html]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] || path.join(ROOT, ".cache/intro-preview.html");
const imgs = [];
for (const n of ["hero", "features", "start"]) {
  try { imgs.push(`data:image/png;base64,${(await readFile(path.join(ROOT, "aily/images", `${n}.png`))).toString("base64")}`); } catch {}
}
const card = (w) => `<div class="card" style="width:${w}px">${imgs.map((src) => `<img src="${src}">`).join("")}
  <div class="btn">打开「拜访录入助手」</div><div class="foot">只处理你本人负责的数据</div></div>`;
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:24px;background:#f2f3f5;font-family:-apple-system,"PingFang SC",sans-serif;display:flex;gap:32px;align-items:flex-start}
.card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);padding-bottom:16px}
.card img{display:block;width:100%;margin-bottom:12px}
.btn{margin:0 12px;background:#3370ff;color:#fff;text-align:center;border-radius:8px;padding:10px;font-size:15px}
.foot{margin:10px 12px 0;color:#8f959e;font-size:12px;text-align:center}
.label{font-size:12px;color:#646a73;margin-bottom:6px}</style>
<div><div class="label">手机（375px）</div>${card(375)}</div><div><div class="label">桌面（600px）</div>${card(600)}</div>`;
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, html);
console.log(out);
