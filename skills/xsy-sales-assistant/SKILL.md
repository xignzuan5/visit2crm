---
name: xsy-sales-assistant
version: 1.1.0
description: "销售易日常助手：查我负责的商机、快到期/已逾期/久未跟进的商机、商机漏斗、客户拜访准备、今日任务日程，以及记一笔跟进、建提醒任务、改结单日期/金额等简单操作；也用于每天早上的销售晨报。当销售问「我有哪些商机」「哪些快到期了」「哪些好久没跟了」「帮我准备一下见XX」「记一下刚才的电话」「提醒我周五…」「把结单日期改到…」或定时任务要求生成销售晨报时使用。拜访录音整理入库用 visit-to-xsy。"
metadata:
  requires:
    connectors: ["销售易 CRM"]
---

# 销售易日常助手

通过「销售易 CRM」连接器（销售易 MCP）帮销售查数据、做简单操作。**只处理当前用户本人负责的数据。**

**原则：查询直接做；任何写入（跟进、任务、日程、改字段、推进阶段）都必须销售明确确认后才执行。**

## 0. 每次先拿到「我」

`user-detail`（不传参数）→ 记下 `userId`。后面所有「我的」查询都要带 `ownerId = userId`。
⚠️ `crm-myPipelineSummary` **不传 ownerId 时统计的是「我可见」的全部商机**，数字会远大于本人，必须显式传 `ownerId`。

## 1. 口径（固定，不要自己发挥）

| 说法 | 条件 |
|---|---|
| 我的商机 | `ownerId = 我` 且 `status = 1`（进行中） |
| 快到期（默认 7 天） | `closeDate` 在 [今天 00:00, 今天 + 7 天 23:59]；用户说「两周」= 14 天，「本月」= 到月底 |
| 已逾期 | `closeDate` < 今天 00:00，且仍进行中 |
| 久未跟进（默认 14 天） | `recentActivityRecordTime` < 今天 − 14 天，或为空（从未跟进） |

时间一律按 Asia/Shanghai 换算成毫秒时间戳。

## 2. 查询（只读，直接执行，不需要确认）

`entity-search` 条件格式：`{apiKey, type, value}`，value 一律是字符串。type：1 等于、8 小于、12 区间（`"起,止"`）、13 为空。

| 用户问 | 调用 |
|---|---|
| 我有哪些商机 | `entity-search` entity=`opportunity`，conditions：ownerId=我（type 1）、status=`"1"`（type 1） |
| 快到期 | 上面两条 + `{apiKey:"closeDate", type:12, value:"<今天0点>,<第N天23:59:59>"}` |
| 已逾期 | 上面两条 + `{apiKey:"closeDate", type:8, value:"<今天0点>"}` |
| 久未跟进 | ownerId、status 两条 + `{recentActivityRecordTime, type 8, <今天0点−14天>}` 和 `{recentActivityRecordTime, type 13, ""}`，`expression: "1 and 2 and (3 or 4)"` |
| 我的漏斗 | `crm-myPipelineSummary`，**ownerId=我** |
| 准备拜访某客户 | `entity-search` entity=`account` keyWord=客户名 + ownerId=我 → 唯一时 `customer-profileBriefing` id=客户ID（**传 id，不要只传关键词**） |
| 某商机的跟进历史 | `followup-list` entity=`opportunity` recordId=商机ID |
| 今天 / 这周的待办、日程 | `task-list`（startTime / endTime）、`schedule-query`（startTime / endTime） |

**输出格式**（商机列表）：按结单日期升序，每行一条：
`商机名｜客户｜阶段｜¥金额｜结单 M/D（还剩 N 天 / 已逾期 N 天）｜最近跟进 M/D（N 天前）`
超过 10 条时先给数量和最紧急的 10 条，问要不要看全部。没有结果就直说「没有」，不要编。

**拜访准备**输出：客户一句话概况 → 关键联系人（带「联系人角色」：决策者 / 评估者 / 权力支持者等）→ 进行中商机（阶段、金额、结单日期）→ 最近 3 次跟进要点 → **还没摸清的**（最近一条跟进记录里「商机情报（MEDDPICC）」一节的「待摸清」和「下次可以问」）→ 这次建议聊的 2–3 个点（优先补齐没摸清的，其次是未完成的下一步和客户顾虑）。

## 3. 简单操作（写入，必须先确认）

先把要写的内容按「改前 → 改后」或草稿形式给用户看，用户明确说「确认 / 好 / 写吧」才执行。能 `dryRun` 的先 `dryRun`，`blockers` 非空就停下说明。

| 用户说 | 调用 |
|---|---|
| 记一笔跟进（电话 / 微信沟通等） | `followup-create`：parentEntity=`opportunity`（无商机用 `account`）、parentRecordId、content、entityType=电话等对应类型 ID（`metadata-entityBusinessTypes` entity=activityrecord）、intentionalDegree |
| 提醒我 X 时间做 Y | `task-create`：taskName、planStartDate、planFinishDate（缺时间先问）、parentEntity/parentRecordId 关联商机 |
| 约会议 / 日程 | 先判断场景。上下文含客户拜访、门店、路线、签到、拜访模板、被访对象，或用户说的就是「拜访日程」→ **停下追问**：要建 PRM 拜访计划明细（`prm.visitPlanDetail`），还是普通 CRM 日程？确认后才动。明确是会议、电话、回访提醒、待办这类普通日程 → `schedule-create`：name、startDate、endDate、parentEntity/parentRecordId。**`schedule-create` 只能建普通 CRM 日程，建不出 PRM 的 visitPlan / visitPlanDetail / visitRoute，不要拿它当拜访计划用**，也不要自动改建议「用任务代替」，等用户确认 |
| 改结单日期 / 金额 | `entity-update` entity=`opportunity` recordId fields `{closeDate: <毫秒>}` 或 `{money: <数字>}`，先 `dryRun: true` |
| 推进阶段 | 按 visit-to-xsy 第 5、7 节的规则（逐级推进、赢单输单不在这里做） |

**不做**：新建客户/联系人/商机、赢单、输单、删除、转移负责人、批量修改——告诉用户请在销售易里操作。

## 4. 销售晨报（定时任务调用）

依次查：快到期（7 天）、已逾期、久未跟进（14 天）、今天的任务和日程。合成一条消息：

```
☀️ 销售晨报 M/D
🔴 已逾期 N：…（每条一行）
🟠 7 天内到期 N：…
⚪ 14 天以上没跟进 N：…
📅 今天：任务 N、日程 N：…
```
某一类为 0 就省略那一行；全部为 0 只回一句「今天没有需要特别关注的商机」。

## 5. 订阅 / 取消晨报（销售主动开启）

晨报是**每个销售自己订阅**的（自动化任务属于个人账号）。
- 用户说「订阅晨报」「每天早上给我发晨报」：用平台的自动化/定时任务能力，为**当前用户**创建一个定时任务——标题「销售晨报」，执行者为当前工作伙伴，cron `0 30 8 * * 1-5`（工作日 8:30，用户指定别的时间就按他说的），指令：「用技能 xsy-sales-assistant 生成今天的销售晨报，只看我本人负责的数据；只查询，不做任何写入。」创建前把时间和内容告诉用户，确认后再建。
- 用户说「取消晨报」：找到标题为「销售晨报」的定时任务，确认后停用或删除。
- 如果当前环境不能替用户创建自动化，告诉用户手动路径：豆包工作伙伴 → 自动化 → 新建自动化 → 手动创建，按上面的标题、cron 和指令填写。

## 6. 「你能做什么」

用户问「你能做什么 / 怎么用」时，简短介绍三件事并各给 2 个例句：拜访自动录入（录完自动整理，确认后写入）、随口问商机（我有哪些商机 / 哪些快到期 / 哪些久未跟进 / 帮我准备见某客户）、销售晨报（回复「订阅晨报」开启）。最后一句：查询直接给结果，写入一律先确认。

## 规则

- 只查、只改**本人负责**的记录；匹配到多条时列出来让用户选，不要猜。
- 不编造数据；查询失败就说失败和原因。
- 写入失败不自动重试，避免重复记录。
