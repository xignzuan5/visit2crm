import { fieldNames, type FieldKey, type Turn, type Visit } from './persona';
export const dimensions = [
  '需求挖掘',
  '关键人覆盖',
  '推进把控',
  '竞争应对',
  '倾听与提问',
  '专业度',
] as const;
export interface Evidence {
  visit: Visit;
  points: number;
  detail: string;
  turns: Turn[];
  signals: string[];
}

export function customerQuote(v: Visit, key: FieldKey) {
  const f = v.fields[key];
  return f?.known && f.summary && f.quote
    ? v.turns.find((t) => t.role === '客户' && t.text.includes(f.quote))
    : undefined;
}
const openQuestion = /什么|哪些|哪一|怎么|如何|谁|多少|哪一步/;
export function isOpenQuestion(t: Turn) {
  return t.role === '销售' && /[?？]/.test(t.text) && openQuestion.test(t.text);
}
export function observation(v: Visit, axis: number): Evidence | null {
  const recorded: Turn[] = [];
  const flags: string[] = [];
  const add = (label: string, ...turns: Turn[]) => {
    flags.push(label);
    recorded.push(...turns);
  };
  const field = (key: FieldKey, asked = false) => {
    const t = customerQuote(v, key);
    if (!t) return;
    const q = v.turns[v.turns.indexOf(t) - 1];
    if (asked && !(q?.role === '销售' && /[?？]/.test(q.text))) return;
    add(fieldNames[key], ...(asked ? [q, t] : [t]));
  };
  let possible = 2;
  if (axis === 0) {
    field('pain', true);
    field('metrics', true);
  }
  if (axis === 1) {
    field('economic_buyer');
    field('champion');
  }
  if (axis === 2) {
    possible = 3;
    field('decision_process');
    field('paper_process');
    const next = v.turns.find(
      (t) => t.role === '客户' && t.signal === 'next' && t.text.trim(),
    );
    if (next) add('客户确认下一步', next);
  }
  if (axis === 3) {
    field('competition');
    const rival = customerQuote(v, 'competition');
    const response = rival && v.turns[v.turns.indexOf(rival) + 1];
    if (
      response?.role === '销售' &&
      response.signal === 'comparison' &&
      response.text.trim()
    )
      add('提出可验证的比较方法', response);
  }
  if (axis === 4) {
    const chars = (list: Turn[]) =>
      list.reduce((n, t) => n + t.text.replace(/[\s\p{P}]/gu, '').length, 0);
    const customer = chars(v.turns.filter((t) => t.role === '客户'));
    const seller = chars(v.turns.filter((t) => t.role === '销售'));
    if (!customer || !seller) return null;
    const open = v.turns.filter(isOpenQuestion).length;
    const share = customer / (customer + seller);
    return {
      visit: v,
      points: 50 * Math.min(1, share / 0.6) + 50 * Math.min(1, open / 4),
      detail: `客户发言占 ${Math.round(share * 100)}%（按字数），开放式提问 ${open} 次`,
      turns: v.turns,
      signals: [
        ...(open >= 2 ? ['至少两次开放式提问'] : []),
        ...(share >= 0.5 ? ['客户发言过半或持平'] : []),
      ],
    };
  }
  if (axis === 5) {
    const idx = v.turns.findIndex(
      (t) =>
        t.role === '客户' && t.signal === 'technical_question' && t.text.trim(),
    );
    const answer = v.turns[idx + 1],
      validation = v.turns[idx + 2];
    if (
      idx >= 0 &&
      answer?.role === '销售' &&
      answer.signal === 'technical_answer' &&
      answer.text.trim()
    ) {
      add('具体解法', v.turns[idx], answer);
      if (
        validation?.role === '客户' &&
        validation.signal === 'validated' &&
        validation.text.trim()
      )
        add('客户实测确认', validation);
    }
  }
  return flags.length
    ? {
        visit: v,
        points: (100 * flags.length) / possible,
        detail: flags.join('、'),
        turns: recorded,
        signals: flags,
      }
    : null;
}

export function evidenceScore(evidence: Evidence[]): number | null {
  if (evidence.length < 2) return null;
  return Math.round(
    evidence.reduce((sum, e) => sum + e.points, 0) / evidence.length,
  );
}
