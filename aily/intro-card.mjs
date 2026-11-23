// 「拜访录入助手」能力介绍卡片（Card 2.0）。img_* 是上传到飞书后得到的 image_key。
export function introCard({ imgHero, imgFlow, imgBrief, chatLink, agentName = "拜访录入助手" }) {
  const md = (content, extra = {}) => ({ tag: "markdown", content, ...extra });
  const img = (key, alt) => ({ tag: "img", img_key: key, alt: { tag: "plain_text", content: alt }, scale_type: "fit_horizontal", corner_radius: "8px", preview: false });
  const section = (icon, title, body, image) => ({
    tag: "column_set",
    background_style: "grey-50",
    horizontal_spacing: "12px",
    columns: [
      { tag: "column", width: "weighted", weight: 3, padding: "12px 12px 12px 12px", vertical_spacing: "6px", elements: [md(`**${icon} ${title}**`), md(body, { text_size: "notation" })] },
      ...(image ? [{ tag: "column", width: "weighted", weight: 2, vertical_align: "center", padding: "8px 8px 8px 0px", elements: [image] }] : []),
    ],
  });
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default", summary: { content: `${agentName}：你只管拜访，CRM 我来录` } },
    header: {
      title: { tag: "plain_text", content: `👋 我是「${agentName}」` },
      subtitle: { tag: "plain_text", content: "你只管拜访，销售易我来录" },
      template: "blue",
    },
    body: {
      direction: "vertical",
      vertical_spacing: "12px",
      elements: [
        ...(imgHero ? [img(imgHero, "AI 销售搭档")] : []),
        section("🎙️", "拜访自动录入",
          "录音豆录完客户拜访，我会把要点整理成跟进记录，找到你负责的客户和商机，客户明确表态时建议推进阶段。**你确认后才写进销售易。**跟我说「**开启自动录入**」后每小时自动处理新录音。",
          imgFlow ? img(imgFlow, "录音豆 → 妙记 → 销售易") : null),
        section("🔍", "随口问商机",
          "直接问我就行：\n· 我手上有哪些商机？\n· 哪些这周要结单 / 已经逾期？\n· 哪些超过两周没跟进了？\n· 明天见星河智能，帮我准备一下"),
        section("☀️", "每天早上的销售晨报",
          "工作日 8:30 把快到期、已逾期、久未跟进的商机和今天的日程发给你。跟我说「**订阅晨报**」开启，「**取消晨报**」关闭。",
          imgBrief ? img(imgBrief, "销售晨报") : null),
        section("✍️", "顺手记一笔",
          "「刚给张总打了电话，预算下周批」「提醒我周五发报价」「结单日期改到 3 月底」——我先给你看草稿，**你确认了才写**。"),
        ...(chatLink ? [{ tag: "button", text: { tag: "plain_text", content: `和「${agentName}」对话` }, type: "primary_filled", width: "fill",
          behaviors: [{ type: "open_url", default_url: chatLink, pc_url: chatLink, ios_url: chatLink, android_url: chatLink }] }] : []),
        md("<font color='grey'>只处理你本人负责的数据 · 查询直接给结果，写入一律先确认 · 新建客户/商机、赢单输单请在销售易里操作</font>", { text_size: "notation" }),
      ],
    },
  };
}
