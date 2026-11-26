import type { Deal, Snapshot, Visit } from '../../../shared/persona';
import {
  dimensions,
  observation,
  evidenceScore,
  type Evidence,
} from '../../../shared/observations';
export { dimensions, customerQuote } from '../../../shared/observations';
export const stages = ['需求澄清', '方案验证', '商务采购'] as const;
export const buckets = ['50 万以下', '50–不足 100 万', '100 万及以上'];
export const bucket = (value: number) =>
  buckets[value < 50 ? 0 : value < 100 ? 1 : 2];
export function makeProfiles(data: Snapshot) {
  const from = new Date(data.asOf + 'T00:00:00Z');
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  const cutoff = from.toISOString().slice(0, 10);
  return data.sellers.map((person) => {
    const deals = data.deals.filter((d) => d.sellerId === person.id);
    const ids = new Set(deals.map((d) => d.id));
    const visits = data.visits
      .filter((v) => ids.has(v.dealId) && v.date <= data.asOf)
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const closed = deals.filter(
      (d) => d.outcome !== '在跟' && d.closed && d.closed <= data.asOf,
    );
    const historicWins = closed.filter((d) => d.outcome === '赢单');
    const recent = closed.filter((d) => d.closed! > cutoff);
    const won = recent.filter((d) => d.outcome === '赢单').length;
    const axes = dimensions.map((name, axis) => {
      const evidence = visits
        .map((v) => observation(v, axis))
        .filter((e): e is Evidence => e !== null);
      const score = evidenceScore(evidence);
      return { name, score, evidence };
    });
    const frequencies = (values: string[]) =>
      Array.from(new Set(values))
        .map((value) => ({
          value,
          n: values.filter((x) => x === value).length,
        }))
        .sort((a, b) => b.n - a.n || a.value.localeCompare(b.value, 'zh'));
    return {
      ...person,
      deals,
      visits,
      axes,
      closed,
      historicWins,
      industries: frequencies(historicWins.map((d) => d.industry)),
      amounts: frequencies(historicWins.map((d) => bucket(d.amount))),
      active: deals.filter((d) => d.outcome === '在跟').length,
      won,
      closedCount: recent.length,
      winRate: recent.length ? Math.round((won * 100) / recent.length) : null,
    };
  });
}
export type Profile = ReturnType<typeof makeProfiles>[number];
export interface Order {
  industry: string;
  amount: number;
  size: string;
  stage: string;
  competitor: string;
  need: string;
}
const vocabulary = [
  ['批次追溯', '批次', '追溯', '产线', '质检'],
  ['门店补货', '门店', '补货', '库存', '缺货'],
  ['权限审计', '权限', '审计', '导出', '复核'],
  ['异常交接', '异常', '交接', '运单', '仓储'],
];
export function recommend(profiles: Profile[], order: Order) {
  return profiles
    .map((p) => {
      const reasons: {
        label: string;
        points: number;
        deal?: Deal;
        visit?: Visit;
        quote?: string;
      }[] = [];
      const won = p.historicWins;
      function historical(
        label: string,
        weight: number,
        source: Deal[],
        match: (d: Deal) => boolean,
      ) {
        const hits = source
          .filter(match)
          .sort(
            (a, b) =>
              (b.closed ?? '').localeCompare(a.closed ?? '') ||
              a.id.localeCompare(b.id),
          );
        if (hits.length)
          reasons.push({
            label: `${label} · ${hits.length} 单`,
            points: weight,
            deal: hits[0],
          });
      }
      historical('同行业赢单', 23, won, (d) => d.industry === order.industry);
      historical(
        '同金额区间赢单',
        16,
        won,
        (d) => bucket(d.amount) === bucket(order.amount),
      );
      historical('同规模赢单', 10, won, (d) => d.size === order.size);
      const rivals = order.competitor
        .split(/[,，、；;\n]/)
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      if (rivals.length)
        historical('交手经验', 12, p.closed, (d) =>
          rivals.includes(d.competitor.toLowerCase()),
        );
      const axis =
        order.stage === stages[0] ? 0 : order.stage === stages[1] ? 5 : 2;
      const ability = p.axes[axis],
        first = ability.evidence[0];
      if (ability.score !== null && first)
        reasons.push({
          label: `${order.stage}需要${ability.name}`,
          points: (16 * ability.score) / 100,
          visit: first.visit,
          quote: first.turns.map((t) => t.text).join('／'),
        });
      const terms = vocabulary
        .filter((group) => group.some((word) => order.need.includes(word)))
        .flat();
      const words = [
        ...terms,
        ...order.need.split(/[，,、。\s；;]+/).filter((x) => x.length >= 2),
      ];
      for (const v of p.visits) {
        const found = v.turns.find(
          (t) => t.role === '客户' && words.some((w) => t.text.includes(w)),
        );
        if (found) {
          reasons.push({
            label: '关键需求相符',
            points: 17,
            visit: v,
            quote: found.text,
          });
          break;
        }
      }
      if (p.winRate !== null && p.winRate > 0)
        reasons.push({
          label: `近一年赢单 ${p.won}/${p.closedCount}`,
          points: (6 * p.won) / p.closedCount,
        });
      reasons.sort((a, b) => b.points - a.points);
      return {
        profile: p,
        points: reasons.reduce((sum, r) => sum + r.points, 0),
        reasons,
      };
    })
    .filter((x) => x.points > 0)
    .sort(
      (a, b) => b.points - a.points || a.profile.id.localeCompare(b.profile.id),
    )
    .slice(0, 3);
}
