import { z } from 'zod';
import {
  McpTool,
  McpTools,
  type Infer,
  type McpContext,
  type McpToolResult,
} from '@lark-apaas/fullstack-nestjs-core';
import { IngestService } from '../../modules/persona/ingest.service';

// Validate elements inside ingest so a bad row cannot reject a valid sibling.
const In = {
  sellers: z
    .array(z.unknown())
    .optional()
    .describe('销售数组，每项含销售易用户 id、name'),
  deals: z
    .array(z.unknown())
    .optional()
    .describe(
      '商机数组，每项含 id、sellerId、company、stage、outcome（在跟/赢单/输单），closed 为结案日期 YYYY-MM-DD。industry、amount（万元）、size、competitor、closed 可省略或传 null',
    ),
  visits: z
    .array(z.unknown())
    .optional()
    .describe(
      '拜访数组，每项含台账 id、dealId、title、date（YYYY-MM-DD）、turns（role、text、可选 signal）、fields（MEDDPICC 八项，每项含 known、summary、quote）；完整键名及标注见 persona-sync',
    ),
};
const resultRow = z.object({
  collection: z.enum(['sellers', 'deals', 'visits']),
  index: z.number().int(),
  id: z.string().nullable(),
  reason: z.string(),
});
const Out = {
  written: z.array(resultRow).describe('成功新增或更新的条目'),
  skipped: z.array(resultRow).describe('跳过的条目及原因，index 从零开始'),
};
const ListIn = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('每页商机和拜访合计条数，默认 20'),
  cursor: z.string().optional().describe('上一页返回的 nextCursor，首页省略'),
};
const ListOut = {
  visits: z
    .array(z.object({ id: z.string(), updatedAt: z.string() }))
    .describe('真实拜访及其最后写入时间（UTC）'),
  openDealIds: z.array(z.string()).describe('仍在跟的真实商机编号'),
  nextCursor: z.string().nullable().describe('下一页游标，null 表示结束'),
};

@McpTools({ prefix: 'persona_' })
export class PersonaTools {
  constructor(private readonly service: IngestService) {}

  @McpTool({
    title: '写入已确认拜访',
    description:
      '按来源编号逐条新增或覆盖已确认的完整记录，先销售、再商机、最后拜访。先用 persona_ingested 核对已有编号。按 skipped 的原因修正对应记录再重试。',
    inputSchema: In,
    outputSchema: Out,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  async ingest(
    input: Infer<typeof In>,
    ctx: McpContext,
  ): Promise<McpToolResult<typeof Out>> {
    return {
      structuredContent: await this.service.write(input, ctx.user.userId!),
    };
  }

  @McpTool({
    title: '查询已写入拜访和在跟商机',
    description:
      '同步前分页读取真实拜访编号、更新时间及在跟商机编号。继续传 nextCursor 直到为空，然后跳过已同步拜访，刷新在跟商机结果。',
    inputSchema: ListIn,
    outputSchema: ListOut,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  async ingested(
    input: Infer<typeof ListIn>,
    _ctx: McpContext,
  ): Promise<McpToolResult<typeof ListOut>> {
    return {
      structuredContent: await this.service.list(
        input.limit,
        input.cursor ?? '',
      ),
    };
  }
}
