import { startOfWindow, summarize } from './dimension-summary';
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
import type { Snapshot } from '../../../shared/persona';

const DEMO_AS_OF = '2026-11-25';

@NeedLogin()
@Controller('api/persona')
export class PersonaController {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  @Get('dimension-summary')
  async summary(@Query('days') days = '30'): Promise<TeamSummary> {
    if (days !== '30' && days !== '90')
      throw new BadRequestException('时间范围仅支持 30 或 90 天');
    const windowDays = days === '30' ? 30 : 90;
    return summarize(
      await this.snapshot(startOfWindow(DEMO_AS_OF, windowDays)),
      windowDays,
    );
  }

  @Get()
  read(): Promise<Snapshot> {
    return this.snapshot();
  }

  private async snapshot(from?: string): Promise<Snapshot> {
    const visitFilter = from
      ? sql`WHERE happened_on BETWEEN ${from}::date AND ${DEMO_AS_OF}::date`
      : sql``;
    // One statement keeps the three collections consistent during an import.
    const [row] = await this.db.execute(sql`
      SELECT (SELECT json_agg(s ORDER BY id) FROM (SELECT id, name FROM persona_sellers) s) AS sellers,
             (SELECT json_agg(d ORDER BY id) FROM (
               SELECT id, seller_id AS "sellerId", company, industry, amount_wan AS amount,
                 customer_size AS size, stage, outcome, competitor, closed_on AS closed FROM persona_deals
             ) d) AS deals,
             (SELECT json_agg(v ORDER BY date DESC, id) FROM (
               SELECT id, deal_id AS "dealId", title, happened_on AS date, turns, fields FROM persona_visits ${visitFilter}
             ) v) AS visits
    `);
    return {
      sellers: (row.sellers ?? []) as Snapshot['sellers'],
      deals: (row.deals ?? []) as Snapshot['deals'],
      visits: (row.visits ?? []) as Snapshot['visits'],
      asOf: DEMO_AS_OF,
    };
  }
}
