#!/usr/bin/env node
// 销售易 MCP OAuth 登录（MCP 标准：动态注册客户端 + 授权码 + PKCE）
//   node scripts/xsy-mcp-login.mjs start            → 注册客户端，打印授权链接（state/verifier 存 .secrets）
//   node scripts/xsy-mcp-login.mjs finish <回调URL> → 用回调里的 code 换令牌，存 .secrets/xsy-mcp-token.json
//   node scripts/xsy-mcp-login.mjs refresh          → 用 refresh_token 续期
import crypto from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const AS = "https://mcp.xiaoshouyi.com";
const RESOURCE = "https://mcp.xiaoshouyi.com/mcp";
const REDIRECT = "http://localhost:8765/callback";
const PENDING = ".secrets/xsy-mcp-pending.json";
const TOKEN = ".secrets/xsy-mcp-token.json";
const b64url = (buf) => Buffer.from(buf).toString("base64url");

async function save(path, obj) {
  await mkdir(".secrets", { recursive: true });
  await writeFile(path, JSON.stringify(obj, null, 2), { mode: 0o600 });
}

async function token(params) {
  const res = await fetch(`${AS}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`换取令牌失败 ${res.status}: ${JSON.stringify(data)}`);
  return { ...data, obtained_at: Date.now(), expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : null };
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "start") {
  const reg = await fetch(`${AS}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "visit2crm-prototype",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(`注册客户端失败 ${r.status}: ${JSON.stringify(j)}`); return j; });
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  await save(PENDING, { client_id: reg.client_id, verifier, state });
  const url = new URL(`${AS}/oauth/authorize`);
  Object.entries({
    response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope: "offline_access",
    code_challenge: challenge, code_challenge_method: "S256", state, resource: RESOURCE,
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  console.log(url.toString());
} else if (cmd === "finish") {
  const p = JSON.parse(await readFile(PENDING, "utf8"));
  const cb = new URL(arg);
  if (cb.searchParams.get("state") !== p.state) throw new Error("state 不匹配");
  if (cb.searchParams.get("error")) throw new Error(`授权失败: ${cb.searchParams.get("error")} ${cb.searchParams.get("error_description") || ""}`);
  const t = await token({
    grant_type: "authorization_code", code: cb.searchParams.get("code"), redirect_uri: REDIRECT,
    client_id: p.client_id, code_verifier: p.verifier, resource: RESOURCE,
  });
  await save(TOKEN, { ...t, client_id: p.client_id });
  console.log(`令牌已保存；有效期 ${t.expires_in ?? "?"} 秒；refresh_token ${t.refresh_token ? "有" : "无"}`);
} else if (cmd === "refresh") {
  const old = JSON.parse(await readFile(TOKEN, "utf8"));
  const t = await token({ grant_type: "refresh_token", refresh_token: old.refresh_token, client_id: old.client_id, resource: RESOURCE });
  await save(TOKEN, { ...old, ...t });
  console.log("令牌已续期");
} else {
  console.log("用法：start | finish <回调URL> | refresh");
}
