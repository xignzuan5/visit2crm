// 飞书确认卡片（Card 2.0）
const md = (content, extra = {}) => ({ tag: "markdown", content, ...extra });

function bg(elements) {
  return {
    tag: "column_set",
    background_style: "grey-50",
    horizontal_spacing: "8px",
    columns: [{ tag: "column", width: "weighted", weight: 1, padding: "10px 12px 10px 12px", vertical_spacing: "6px", elements }],
  };
}

function button(text, type, value, extra = {}) {
  return { tag: "button", text: { tag: "plain_text", content: text }, type, behaviors: [{ type: "callback", value }], ...extra };
}

/** 待确认卡片 */
export function confirmCard({ recordId, title, recordedAt, minuteUrl, account, opportunity, followupPreview, stage, tableUrl }) {
  const stageBlock = stage?.target
    ? md(`**建议阶段：**${stage.current} → <font color='blue'>**${stage.target}**</font>\n<font color='grey'>依据：“${stage.evidence}”</font>`)
    : md(`**商机阶段：**${stage?.current || "—"}（本次不建议变更）${stage?.note ? `\n<font color='grey'>${stage.note}</font>` : ""}`);

  const actions = [
    button("确认写入", "primary_filled", { action: "confirm", record_id: recordId }),
  ];
  if (stage?.target) actions.push(button("只写跟进，不改阶段", "default", { action: "confirm_no_stage", record_id: recordId }));
  actions.push(button("不是拜访，忽略", "danger", { action: "ignore", record_id: recordId }));

  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default", summary: { content: `拜访记录待确认：${account?.name || title}` } },
    header: {
      title: { tag: "plain_text", content: "📋 拜访记录待确认" },
      subtitle: { tag: "plain_text", content: `${recordedAt} · ${title}` },
      template: "blue",
    },
    body: {
      direction: "vertical",
      elements: [
        md(`**客户：**${account?.name || "<font color='red'>未匹配</font>"}\n**商机：**${opportunity?.name || "（无进行中商机，只挂客户）"}`),
        bg([md(followupPreview)]),
        stageBlock,
        { tag: "column_set", horizontal_spacing: "8px", columns: actions.map((b) => ({ tag: "column", width: "auto", elements: [b] })) },
        md(`<font color='grey'>要修改内容：直接在[多维表格](${tableUrl})里改「跟进内容 / 建议阶段」后再点确认。不确认不会写入；24 小时未处理会再提醒一次。[查看妙记](${minuteUrl})</font>`),
      ],
    },
  };
}

/** 处理完成后的卡片 */
export function doneCard({ title, account, opportunity, result, color = "green", detail = "", link }) {
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: {
      title: { tag: "plain_text", content: result },
      subtitle: { tag: "plain_text", content: title },
      template: color,
    },
    body: {
      direction: "vertical",
      elements: [
        md(`**客户：**${account || "—"}\n**商机：**${opportunity || "—"}`),
        ...(detail ? [bg([md(detail)])] : []),
        ...(link ? [md(`[在销售易中查看](${link})`)] : []),
      ],
    },
  };
}

/** 需要销售补充信息（未匹配到客户 / 多个候选） */
export function needInfoCard({ title, recordedAt, reason, candidates = [], tableUrl, minuteUrl }) {
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: {
      title: { tag: "plain_text", content: "❓ 拜访记录需要你补充" },
      subtitle: { tag: "plain_text", content: `${recordedAt} · ${title}` },
      template: "orange",
    },
    body: {
      direction: "vertical",
      elements: [
        md(reason),
        ...(candidates.length ? [bg([md(candidates.map((c, i) => `${i + 1}. ${c}`).join("\n"))])] : []),
        md(`<font color='grey'>请在[多维表格](${tableUrl})中填写「销售易商机ID」或「销售易客户ID」，并把状态改回「待处理」。[查看妙记](${minuteUrl})</font>`),
      ],
    },
  };
}
