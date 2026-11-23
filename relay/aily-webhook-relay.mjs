// 多维表格 → aily Webhook 签名中转
//
// 为什么需要：aily 自动化的 Webhook 要求每次请求带 HMAC-SHA256 签名（时间戳 + 随机数 + 请求体哈希现算），
// 而多维表格工作流的「HTTP 请求」节点只能发固定请求头，算不了签名。这个中转收到表格的请求后补上签名再转发。
//
// 运行方式（二选一）：
//   1) Node：AILY_WEBHOOK_URL=... AILY_WEBHOOK_SECRET=... RELAY_TOKEN=... node relay/aily-webhook-relay.mjs   （监听 :8787）
//   2) Cloudflare Worker：wrangler deploy relay/aily-webhook-relay.mjs，三个变量配成 secret
//
// 表格侧请求：POST /visit，请求头 X-Relay-Token: <RELAY_TOKEN>，JSON 体：
//   { "record_id": "...", "minute_url": "...", "title": "...", "sales_name": "..." }

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

/** 按 aily 规则签名并转发；返回 aily 的响应 JSON */
export async function sendToAily({ webhookUrl, secret, eventType, eventId, data, source = "feishu-base" }) {
  const id = eventId || `evt_${crypto.randomUUID()}`;
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const body = JSON.stringify({ event_id: id, event_type: eventType, event_time: ts, source, data });
  const path = new URL(webhookUrl).pathname;
  const sig = await hmacHex(secret, `${ts}\n${nonce}\nPOST\n${path}\n${await sha256Hex(body)}`);
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Id": id,
      "X-Webhook-Timestamp": String(ts),
      "X-Webhook-Nonce": nonce,
      "X-Webhook-Signature": `v1,sha256=${sig}`,
      "X-Webhook-Event-Type": eventType,
    },
    body,
  });
  const text = await res.text();
  try { return { status: res.status, ...JSON.parse(text) }; } catch { return { status: res.status, raw: text }; }
}

async function handle(request, env) {
  const u = new URL(request.url);
  if (request.method === "GET" && u.pathname === "/health") return Response.json({ ok: true });
  if (request.method !== "POST" || u.pathname !== "/visit") return new Response("not found", { status: 404 });
  if (!env.RELAY_TOKEN || request.headers.get("X-Relay-Token") !== env.RELAY_TOKEN) return new Response("unauthorized", { status: 401 });
  let p;
  try { p = await request.json(); } catch { return new Response("bad json", { status: 400 }); }
  if (!p.minute_url) return new Response("minute_url required", { status: 400 });
  const r = await sendToAily({
    webhookUrl: env.AILY_WEBHOOK_URL,
    secret: env.AILY_WEBHOOK_SECRET,
    eventType: "visit.minute.added",
    // 同一条记录重复推送时用同一个 event_id，aily 会去重，不会重复处理
    eventId: p.record_id ? `evt_base_${p.record_id}` : undefined,
    data: { minute_url: p.minute_url, title: p.title ?? "", sales_name: p.sales_name ?? "", record_id: p.record_id ?? "" },
  });
  return Response.json(r, { status: r.status >= 400 ? 502 : 200 });
}

export default { fetch: handle };

// ---- Node 直接运行 ----
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("aily-webhook-relay.mjs")) {
  const { createServer } = await import("node:http");
  const env = process.env;
  for (const k of ["AILY_WEBHOOK_URL", "AILY_WEBHOOK_SECRET", "RELAY_TOKEN"]) if (!env[k]) { console.error(`缺少环境变量 ${k}`); process.exit(1); }
  const port = Number(env.PORT || 8787);
  createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined });
    const r = await handle(request, env).catch((e) => Response.json({ error: e.message }, { status: 500 }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(port, () => console.log(`relay listening on :${port}`));
}
