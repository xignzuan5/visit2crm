import { summarize } from './dimension-summary';
import type { TeamSummary } from '../../../shared/dimension-summary';
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  NeedLogin,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { DataSource, Snapshot } from '../../../shared/persona';

const DEMO_AS_OF = '2026-11-25';

@NeedLogin()
@Controller('api/persona')
export class PersonaController {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  @Get('dimension-summary')
  async summary(
    @Query('days') days = '30',
    @Query('source') source?: string,
  ): Promise<TeamSummary & Pick<Snapshot, 'source' | 'hasRealVisits'>> {
    if (days !== '30' && days !== '90')
      throw new BadRequestException('时间范围仅支持 30 或 90 天');
    const windowDays = days === '30' ? 30 : 90;
    const snapshot = await this.snapshot(source, windowDays);
    return {
      ...summarize(snapshot, windowDays),
      source: snapshot.source,
      hasRealVisits: snapshot.hasRealVisits,
    };
  }

  @Get()
  read(@Query('source') source?: string): Promise<Snapshot> {
    return this.snapshot(source);
  }

  private async snapshot(requested?: string, days?: number): Promise<Snapshot> {
    if (requested !== undefined && requested !== 'demo' && requested !== 'real')
      throw new BadRequestException('来源仅支持 demo 或 real');
    const window = days
      ? sql`AND happened_on BETWEEN stat.day - ${days - 1}::integer AND stat.day`
      : sql``;
    const [row] = await this.db.execute(sql`
      SELECT src, present, day::text AS as_of,
             (SELECT json_agg(s ORDER BY id) FROM (SELECT id, name FROM persona_sellers WHERE source=stat.src) s) AS sellers,
             (SELECT json_agg(d ORDER BY id) FROM (
               SELECT id, seller_id AS "sellerId", company, industry, amount_wan AS amount,
                 customer_size AS size, stage, outcome, competitor, closed_on AS closed FROM persona_deals WHERE source=stat.src
             ) d) AS deals,
             (SELECT json_agg(v ORDER BY date DESC, id) FROM (
               SELECT id, deal_id AS "dealId", title, happened_on AS date, turns, fields FROM persona_visits WHERE source=stat.src ${window}
             ) v) AS visits FROM (
               SELECT choice.*, CASE WHEN src='real' THEN (now() AT TIME ZONE 'Asia/Shanghai')::date ELSE ${DEMO_AS_OF}::date END AS day
               FROM (SELECT present, CASE WHEN present AND ${requested ?? 'real'}::text = 'real' THEN 'real' ELSE 'demo' END AS src
                 FROM (SELECT EXISTS(SELECT FROM persona_visits WHERE source='real') AS present) availability) choice
             ) stat
    `);
    return {
      sellers: (row.sellers ?? []) as Snapshot['sellers'],
      deals: (row.deals ?? []) as Snapshot['deals'],
      visits: (row.visits ?? []) as Snapshot['visits'],
      asOf: String(row.as_of),
      source: row.src as DataSource,
      hasRealVisits: Boolean(row.present),
    };
  }
}
