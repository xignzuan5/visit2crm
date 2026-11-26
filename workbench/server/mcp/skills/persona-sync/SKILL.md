---
name: persona-sync
description: 同步已确认的销售、商机和拜访记录，核对已写入的拜访及仍在跟的商机。
---

先用 persona_ingested 分页读取 visits 的 id、updatedAt 及 openDealIds。下一页传回 nextCursor，直到 null。跳过已同步且未修订的拜访，按需刷新在跟商机。

调用 persona_ingest 时可提供以下三个数组。每条均是完整记录，同一编号覆盖旧内容。销售和商机的 id 来自销售易，拜访 id 来自拜访台账。先提供被引用的销售和商机，也可在同一批里提供。

- sellers 每项含 id、name。
- deals 每项含 id、sellerId、company、stage、outcome。outcome 为在跟、赢单或输单。industry、amount（正数，万元）、size、competitor、closed 可以缺省或为 null。closed 为 YYYY-MM-DD。
- visits 每项含 id、dealId、title、date（YYYY-MM-DD）、turns 和 fields。turns 每项含 role（客户或销售）、text 和可选的 signal。fields 的八个键是 pain、metrics、economic_buyer、decision_criteria、decision_process、paper_process、champion、competition。每项传 known 布尔值及 summary、quote 字符串。已知项需要有摘要和可在一句客户发言中逐字定位的引文，未知项用空串。

next 标在客户确认下一步的发言上。comparison 标在竞争项首处客户引文紧随的销售回应上。technical_question 标在选作取证的一句客户技术提问上，technical_answer 标在紧随的销售解法上，validated 标在再下一句客户验证上。缺少后续时可以只传已有发言。

检查 written 与 skipped。每项有 collection、从零计的 index、id 和 reason。内容相同可跳过。校验失败时，根据字段路径修正并重提交对应条目。
