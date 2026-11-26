export const fieldNames = {
  pain: '痛点',
  metrics: '量化收益',
  economic_buyer: '经济决策人',
  decision_criteria: '决策标准',
  decision_process: '决策流程',
  paper_process: '采购／合同流程',
  champion: '内部支持者',
  competition: '竞争',
} as const;
export type FieldKey = keyof typeof fieldNames;
export interface Turn {
  role: '客户' | '销售';
  text: string;
  signal?: string;
}
export interface Field {
  known: boolean;
  summary: string;
  quote: string;
}
export interface Visit {
  id: string;
  dealId: string;
  title: string;
  date: string;
  turns: Turn[];
  fields: Record<FieldKey, Field>;
}
export interface Deal {
  id: string;
  sellerId: string;
  company: string;
  industry: string | null;
  amount: number | null;
  size: string | null;
  stage: string;
  outcome: '在跟' | '赢单' | '输单';
  competitor: string | null;
  closed: string | null;
}
export type DataSource = 'demo' | 'real';
export interface Snapshot {
  source: DataSource;
  hasRealVisits: boolean;
  sellers: { id: string; name: string }[];
  deals: Deal[];
  visits: Visit[];
  asOf: string;
}
