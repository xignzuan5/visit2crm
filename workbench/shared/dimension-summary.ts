import type { Turn, Visit } from './persona';

export type WindowDays = 30 | 90;
export interface VisitSource {
  visit: Visit;
  sellerId: string;
  sellerName: string;
  company: string;
}
export interface Claim {
  // Visit IDs supporting this statement. Gaps are a subset of strengths.
  text: string;
  visitIds: string[];
}
export interface MemberEvidence {
  id: string;
  name: string;
  score: number | null;
  observed: string[];
  reviewed: string[];
}
export interface QuoteSource extends Turn {
  visitId: string;
  turnIndex: number;
}
export interface DimensionSummary {
  name: string;
  strengths: Claim;
  gaps: Claim;
  unaddressed: Claim;
  people: MemberEvidence[];
  strongest: string[];
  quotes: QuoteSource[];
  advice: Claim;
}
export interface TeamSummary {
  days: WindowDays;
  from: string;
  asOf: string;
  visits: VisitSource[];
  dimensions: DimensionSummary[];
}
