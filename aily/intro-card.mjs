// 「拜访录入助手」能力介绍卡片（Card 2.0）。以 GPT 生成的设计图为主，卡片文字只保留按钮和一行说明。
// images：{ hero, features, start } 为上传到飞书后得到的 image_key；缺图时退回纯文字版。
export function introCard({ images = {}, chatLink, agentName = "拜访录入助手" }) {
  const md = (content, extra = {}) => ({ tag: "markdown", content, ...extra });
  // 负 margin 让图片撑满卡片宽度（Card 2.0 的通栏写法）
  const img = (key, alt) => ({ tag: "img", img_key: key, alt: { tag: "plain_text", content: alt }, scale_type: "fit_horizontal", preview: true, margin: "0px -12px 0px -12px" });

  const fallback = [
    md(`**👋 我是「${agentName}」**\n你只管拜访，销售易我来录。`),
    md("· **拜访自动录入**：录完自动整理，确认后写进销售易\n· **随口问商机**：「这周哪些商机要结单？」\n· **每日销售晨报**：工作日 8:30，快到期、久未跟进一目了然\n· **顺手记一笔**：「提醒我周五给客户发报价」"),
    md("开始：打开对话，说「**开启自动录入**」「**订阅晨报**」"),
  ];

  const visuals = [
    images.hero && img(images.hero, `${agentName}：你只管拜访，销售易我来录`),
    images.features && img(images.features, "我能帮你做什么"),
    images.start && img(images.start, "三步开始：打开拜访录入助手 → 说「开启自动录入」→ 说「订阅晨报」"),
  ].filter(Boolean);

  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default", summary: { content: `${agentName}：你只管拜访，销售易我来录` } },
    body: {
      direction: "vertical",
      padding: "0px 12px 16px 12px",
      vertical_spacing: "12px",
      elements: [
        ...(visuals.length ? visuals : fallback),
        ...(chatLink ? [{
          tag: "button", text: { tag: "plain_text", content: `打开「${agentName}」` }, type: "primary_filled", width: "fill", size: "large",
          behaviors: [{ type: "open_url", default_url: chatLink, pc_url: chatLink, ios_url: chatLink, android_url: chatLink }],
        }] : []),
        md("<font color='grey'>只处理你本人负责的数据</font>", { text_align: "center", text_size: "notation" }),
      ],
    },
  };
}
