#!/usr/bin/env node
// 把 skills/<名字> 打成可上传的 zip：技能里的 {{a.b}} 占位符按 config/app.json 填入真实值。
// 仓库里只放占位符，租户内的表格编号只在本机的 config/app.json（不进仓库）。
//
// 用法：node scripts/build-skills.mjs [技能名…]   不传就打全部；产物在 .cache/<技能名>.zip
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir, mkdir, rm, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLACEHOLDER = /\{\{\s*([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+)\s*\}\}/gi;

async function loadConfig() {
  try {
    return JSON.parse(await readFile(path.join(ROOT, "config/app.json"), "utf8"));
  } catch {
    throw new Error("缺 config/app.json：照 config/app.example.json 建一份再打包技能");
  }
}

function lookup(config, key) {
  const value = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), config);
  return typeof value === "string" && value && !value.startsWith("<") && !/x{6,}/.test(value) ? value : null;
}

async function* files(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(md|json|ya?ml|txt|sh|mjs|js)$/.test(e.name)) yield p;
  }
}

export async function buildSkill(name, config) {
  config ??= await loadConfig();
  const src = path.join(ROOT, "skills", name);
  const stage = path.join(ROOT, ".cache/skills-build");
  const out = path.join(stage, name);
  await rm(out, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await cp(src, out, { recursive: true });
  const missing = new Set();
  for await (const f of files(out)) {
    const text = await readFile(f, "utf8");
    const filled = text.replace(PLACEHOLDER, (m, key) => lookup(config, key) ?? (missing.add(key), m));
    if (filled !== text) await writeFile(f, filled);
  }
  if (missing.size) throw new Error(`技能 ${name} 需要 config/app.json 里填上：${[...missing].join("、")}`);
  const zip = path.join(ROOT, `.cache/${name}.zip`);
  await rm(zip, { force: true });
  await run("zip", ["-qr", zip, name], { cwd: stage });
  return zip;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2);
  const all = (await readdir(path.join(ROOT, "skills"), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  const config = await loadConfig();
  for (const n of names.length ? names : all) console.log(`• ${n} → ${path.relative(ROOT, await buildSkill(n, config))}`);
}
