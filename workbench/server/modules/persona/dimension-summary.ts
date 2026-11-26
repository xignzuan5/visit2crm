import {
  dimensions,
  customerQuote,
  isOpenQuestion,
  evidenceScore,
  observation,
  type Evidence,
} from '../../../shared/observations';
import type { Snapshot, Turn } from '../../../shared/persona';
import type {
  TeamSummary,
  VisitSource,
  WindowDays,
} from '../../../shared/dimension-summary';

// Each pair describes an observable move and the follow-through to look for.
const criteria = [
  {
    good: '痛点',
    unaddressedText: '没涉及现场痛点的确认',
    goodText: '问到了现场痛点',
    follow: '量化收益',
    gapText: '未取得客户确认的量化目标',
    advice: '例会可以拿一个已确认的痛点，练习追问现状数字和目标值。',
  },
  {
    good: '内部支持者',
    unaddressedText: '没涉及内部支持者的确认',
    goodText: '确认了愿意推动的内部支持者',
    follow: '经济决策人',
    gapText: '缺少客户对预算决策人的指认',
    advice: '下次讨论试点时，请销售追问谁有预算决定权，并记下客户的回答。',
  },
  {
    good: '决策流程',
    unaddressedText: '没涉及客户决策步骤的梳理',
    goodText: '理清了客户的决策步骤',
    follow: '客户确认下一步',
    gapText: '缺少客户对下一步安排的确认',
    advice: '复盘这些拜访的结尾，练习请客户确认下一步的负责人和时间。',
  },
  {
    good: '竞争',
    unaddressedText: '没涉及替代方案的识别',
    goodText: '识别了客户正在考虑的替代方案',
    follow: '提出可验证的比较方法',
    gapText: '没有留下可验证的对照方法',
    advice: '选一份客户样本，让销售演练如何约定双方都能复核的比较标准。',
  },
  {
    good: '客户发言过半或持平',
    unaddressedText: '没涉及客户发言占一半或以上的情形',
    goodText: '客户的发言字数至少占一半',
    follow: '至少两次开放式提问',
    gapText: '缺少至少两次开放式提问的记录',
    advice: '用一段封闭问答练习改写两个开放问题，再听客户如何展开。',
  },
  {
    good: '具体解法',
    unaddressedText: '没涉及具体技术解法',
    goodText: '对客户技术问题给出了具体解法',
    follow: '客户实测确认',
    gapText: '缺少客户对解法的实测确认',
    advice: '演示结束时请客户用自己的样本验证，并记录客户如何描述结果。',
  },
] as const;

// Compare adjacent character pairs so changing a department, date or punctuation
// in a repeated Chinese sentence does not use up another quotation slot.
function quoteBigrams(text: string): Set<string> {
  const chars = Array.from(
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]/gu, '')
      .replace(/\d+/g, '0'),
  );
  if (chars.length < 2) return new Set(chars);
  return new Set(chars.slice(1).map((ch, i) => chars[i] + ch));
}

function similarQuotes(a: Set<string>, b: Set<string>): boolean {
  let common = 0;
  for (const pair of a) if (b.has(pair)) common++;
  return 2 * common >= 0.7 * (a.size + b.size);
}

function representativeQuotes(
  entries: { source: VisitSource; e: Evidence | null }[],
  axis: number,
) {
  const candidates = entries.flatMap(({ source, e }) => {
    if (!e) return [];
    let turns: Turn[];
    if (axis === 4) {
      turns = e.turns.filter((t) => t.role === '销售' && /[?？]/.test(t.text));
    } else {
      turns = e.turns.filter(
        (t) => axis === 3 || axis === 5 || t.role === '客户',
      );
    }
    turns.reverse();
    const followThrough = e.signals.includes(criteria[axis].follow);
    // Quote the move itself when the transcript contains several related statements.
    if (axis === 1 && followThrough) {
      const buyer = customerQuote(source.visit, 'economic_buyer');
      if (buyer) turns = [buyer, ...turns.filter((t) => t !== buyer)];
    }
    if (axis === 4) {
      const preferred = turns.filter(
        (t) => isOpenQuestion(t) === followThrough,
      );
      turns = [...preferred, ...turns.filter((t) => !preferred.includes(t))];
    }
    return turns.map((t) => ({
      ...t,
      bigrams: quoteBigrams(t.text),
      visitId: source.visit.id,
      turnIndex: source.visit.turns.indexOf(t),
      followThrough,
      sellerId: source.sellerId,
    }));
  });
  const quotes: typeof candidates = [];
  // Where available, sample both complete and partial conversations before filling other slots.
  const completed = candidates.find((q) => q.followThrough);
  const partial =
    candidates.find(
      (q) => !q.followThrough && q.sellerId !== completed?.sellerId,
    ) ?? candidates.find((q) => !q.followThrough);
  const pool = [
    ...(completed ? [completed] : []),
    ...(partial ? [partial] : []),
    ...candidates,
  ];
  for (const distinctPerson of [true, false]) {
    for (const q of pool) {
      if (quotes.length === 3) break;
      if (
        quotes.some(
          (x) =>
            x.visitId === q.visitId ||
            similarQuotes(x.bigrams, q.bigrams) ||
            (distinctPerson && x.sellerId === q.sellerId),
        )
      )
        continue;
      quotes.push(q);
    }
  }
  return quotes.map(({ role, text, visitId, turnIndex }) => ({
    role,
    text,
    visitId,
    turnIndex,
  }));
}

export function startOfWindow(asOf: string, days: WindowDays) {
  const start = new Date(asOf + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - days + 1);
  return start.toISOString().slice(0, 10);
}

export function summarize(data: Snapshot, days: WindowDays): TeamSummary {
  const from = startOfWindow(data.asOf, days);
  const sellers = new Map(data.sellers.map((s) => [s.id, s]));
  const deals = new Map(data.deals.map((d) => [d.id, d]));
  const visits: VisitSource[] = data.visits
    .filter((v) => v.date >= from && v.date <= data.asOf)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .map((visit) => {
      const deal = deals.get(visit.dealId);
      const seller = deal && sellers.get(deal.sellerId);
      if (!deal || !seller) throw Error('拜访的商机或销售关联缺失');
      return {
        visit,
        company: deal.company,
        sellerId: seller.id,
        sellerName: seller.name,
      };
    });
  return {
    days,
    from,
    asOf: data.asOf,
    visits,
    dimensions: dimensions.map((name, axis) => {
      const c = criteria[axis];
      const entries = visits.map((source) => ({
        source,
        e: observation(source.visit, axis),
      }));
      const strengths = { text: c.goodText, visitIds: [] as string[] };
      const gaps = { text: c.gapText, visitIds: [] as string[] };
      const unaddressed = { text: c.unaddressedText, visitIds: [] as string[] };
      for (const { source, e } of entries) {
        const id = source.visit.id;
        if (!e?.signals.includes(c.good)) {
          unaddressed.visitIds.push(id);
          continue;
        }
        strengths.visitIds.push(id);
        if (!e.signals.includes(c.follow)) gaps.visitIds.push(id);
      }
      const people = data.sellers.map((s) => {
        const group = entries.filter((x) => x.source.sellerId === s.id);
        const ev = group.flatMap((x) => (x.e ? [x.e] : []));
        return {
          ...s,
          score: evidenceScore(ev),
          observed: ev.map((e) => e.visit.id),
          reviewed: group.map((x) => x.source.visit.id),
        };
      });
      const best = Math.max(75, ...people.map((p) => p.score ?? 0));
      const strongest = people.filter((p) => p.score === best).map((p) => p.id);
      const advice = {
        text: gaps.visitIds.length
          ? c.advice
          : strengths.visitIds.length
            ? '已涉及这一步的拜访均有后续记录。'
            : '本期缺少可用于判断这一缺口的拜访。',
        visitIds: gaps.visitIds,
      };
      return {
        name,
        strengths,
        gaps,
        unaddressed,
        people,
        strongest,
        quotes: representativeQuotes(entries, axis),
        advice,
      };
    }),
  };
}
