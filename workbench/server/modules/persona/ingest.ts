import { z } from 'zod';
import { fieldNames, type FieldKey, type Visit } from '../../../shared/persona';
import { customerQuote } from '../../../shared/observations';

// PostgreSQL text/jsonb cannot represent NUL or unpaired surrogate code units.
const text = z.string().regex(/^[^\u0000\uD800-\uDFFF]*$/u, '文本包含无效字符');
const required = text.refine((s) => s.trim().length > 0, '不能为空');
const id = required.refine((s) => Buffer.byteLength(s) <= 2000, '编号过长');
const optionalText = text.nullish().transform((s) => s?.trim() || null);
const date = z.iso
  .date()
  .refine((s) => !s.startsWith('0000'), '年份必须大于零');
export const seller = z.object({ id, name: required });
export const deal = z.object({
  id,
  sellerId: id,
  company: required,
  industry: optionalText,
  size: optionalText,
  amount: z
    .number()
    .positive()
    .nullish()
    .transform((n) => n ?? null),
  competitor: optionalText,
  stage: required,
  outcome: z.enum(['在跟', '赢单', '输单']),
  closed: date.nullish().transform((s) => s ?? null),
});
const field = z.object({ known: z.boolean(), summary: text, quote: text });
const signals = [
  'next',
  'comparison',
  'technical_question',
  'technical_answer',
  'validated',
] as const;
export const visit = z
  .object({
    id,
    dealId: id,
    title: required,
    date,
    turns: z
      .array(
        z.object({
          role: z.enum(['客户', '销售']),
          text: required,
          signal: z.enum(signals).optional(),
        }),
      )
      .min(1),
    fields: z.record(z.enum(Object.keys(fieldNames) as FieldKey[]), field),
  })
  .superRefine((v, ctx) => {
    const add = (path: (number | string)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    for (const key of Object.keys(fieldNames) as FieldKey[]) {
      const item = v.fields[key];
      if (!item?.known) continue;
      if (!item.summary.trim())
        add(['fields', key, 'summary'], '已知项需要摘要');
      if (
        !item.quote.trim() ||
        !v.turns.some((t) => t.role === '客户' && t.text.includes(item.quote))
      )
        add(['fields', key, 'quote'], '引文必须逐字出现在一句客户发言里');
    }
    // The observer uses the first matching competition quote and technical question.
    const turns = v.turns;
    const rival = customerQuote(v as Visit, 'competition');
    const question = turns.findIndex((t) => t.signal === 'technical_question');
    turns.forEach((t, i) => {
      let problem: string | undefined;
      switch (t.signal) {
        case 'next':
          if (t.role !== '客户') problem = '下一步必须由客户确认';
          break;
        case 'comparison':
          if (t.role !== '销售' || !rival || turns[i - 1] !== rival)
            problem = '销售比较必须紧跟竞争项对应的客户原话';
          break;
        case 'technical_question':
          if (t.role !== '客户' || i !== question)
            problem = '请只标记评分采用的第一句客户技术提问';
          break;
        case 'technical_answer':
          if (t.role !== '销售' || question < 0 || i !== question + 1)
            problem = '销售解法必须紧跟客户技术提问';
          break;
        case 'validated':
          if (
            t.role !== '客户' ||
            turns[i - 1]?.signal !== 'technical_answer' ||
            question < 0 ||
            i !== question + 2
          )
            problem = '客户验证必须紧跟已标记的销售解法';
          break;
      }
      if (problem) add(['turns', i, 'signal'], problem);
    });
  });

export type Collection = 'sellers' | 'deals' | 'visits';
export type Batch = Partial<Record<Collection, unknown[]>>;
type ResultRow = {
  collection: Collection;
  index: number;
  id: string | null;
  reason: string;
};
export type SaveResult = 'written' | 'unchanged' | 'missingParent';
export interface IngestStore {
  sellers(row: z.output<typeof seller>): Promise<SaveResult>;
  deals(row: z.output<typeof deal>): Promise<SaveResult>;
  visits(row: z.output<typeof visit>): Promise<SaveResult>;
}

export async function ingest(input: Batch, store: IngestStore) {
  const written: ResultRow[] = [],
    skipped: ResultRow[] = [];
  async function processRows<T>(
    collection: Collection,
    schema: z.ZodType<T>,
    save: (row: T) => Promise<SaveResult>,
    missing = '',
  ) {
    for (const [index, raw] of (input[collection] ?? []).entries()) {
      const entry = {
        collection,
        index,
        id:
          raw &&
          typeof raw === 'object' &&
          'id' in raw &&
          typeof raw.id === 'string'
            ? raw.id
            : null,
      };
      const checked = schema.safeParse(raw);
      if (!checked.success) {
        skipped.push({
          ...entry,
          reason: checked.error.issues
            .map((e) => `${e.path.join('.') || '记录'}：${e.message}`)
            .join('；'),
        });
        continue;
      }
      const result = await save(checked.data);
      if (result === 'written')
        written.push({ ...entry, reason: '已新增或更新' });
      else
        skipped.push({
          ...entry,
          reason: result === 'unchanged' ? '内容相同' : missing,
        });
    }
  }
  await processRows('sellers', seller, store.sellers);
  await processRows(
    'deals',
    deal,
    store.deals,
    'sellerId：找不到对应的真实销售',
  );
  await processRows(
    'visits',
    visit,
    store.visits,
    'dealId：找不到对应的真实商机',
  );
  return { written, skipped };
}
