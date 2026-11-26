// 销售易 MCP 客户端（Streamable HTTP + OAuth Bearer）
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFile, writeFile } from "node:fs/promises";

const AS = "https://mcp.xiaoshouyi.com";

/** 用 refresh_token 续期并写回文件（销售易 MCP access_token 有效期 6 小时） */
async function refresh(t, tokenFile) {
  if (!t.refresh_token) throw new Error("销售易 MCP 令牌已过期且没有 refresh_token：重新运行 node scripts/xsy-mcp-login.mjs start");
  const res = await fetch(`${AS}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id, resource: `${AS}/mcp` }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`销售易 MCP 令牌续期失败 ${res.status}: ${JSON.stringify(data)}（需重新登录授权）`);
  const next = { ...t, ...data, obtained_at: Date.now(), expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : null };
  await writeFile(tokenFile, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export async function connectXsyMcp({ url = "https://mcp.xiaoshouyi.com/mcp", tokenFile = ".secrets/xsy-mcp-token.json" } = {}) {
  let t = JSON.parse(await readFile(tokenFile, "utf8"));
  if (t.expires_at && Date.now() > t.expires_at - 5 * 60e3) t = await refresh(t, tokenFile);
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${t.access_token}` } },
  });
  const client = new Client({ name: "visit2crm-prototype", version: "1.2.0" });
  await client.connect(transport);
  return client;
}

/** 调工具并把文本结果解析成 JSON（解析不了就返回原文） */
export async function callTool(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (res.isError) throw new Error(`销售易 MCP 工具 ${name} 出错：${text.slice(0, 500)}`);
  if (res.structuredContent) return res.structuredContent;
  try { return JSON.parse(text); } catch { return text; }
}
