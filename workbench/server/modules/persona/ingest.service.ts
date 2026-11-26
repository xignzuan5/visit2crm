import { Injectable, Inject } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql, type SQL } from 'drizzle-orm';
import { ingest, type Batch, type Collection, type SaveResult } from './ingest';

@Injectable()
export class IngestService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  write(input: Batch, userId: string) {
    // Each statement upserts one key and reports
    // a no-op without moving the timestamp used by the caller's sync cursor.
    const save = async (
      collection: Collection,
      id: string,
      fields: Record<string, unknown>,
    ): Promise<SaveResult> => {
      const table = sql.identifier('persona_' + collection);
      const columns = Object.keys(fields).map((k) => sql.identifier(k));
      const join = (parts: SQL[]) => sql.join(parts, sql`, `);
      const excluded = columns.map((c) => sql`EXCLUDED.${c}`);
      const actor = sql`ROW(${userId}::varchar)::user_profile`;
      try {
        const rows = await this.db.execute(sql`
          INSERT INTO ${table} (source,id,${sql.join(columns, sql`, `)},_created_by,_updated_by)
          VALUES ('real',${id},${join(Object.values(fields).map((v) => sql`${v}`))},${actor},${actor})
          ON CONFLICT (source,id) DO UPDATE SET
            ${join(columns.map((c, i) => sql`${c} = EXCLUDED.${c}`))},
            _updated_by=EXCLUDED._updated_by, _updated_at=clock_timestamp()
          WHERE ROW(${join(columns.map((c) => sql`${table}.${c}`))}) IS DISTINCT FROM ROW(${join(excluded)})
          RETURNING id
        `);
        return rows.length ? 'written' : 'unchanged';
      } catch (error) {
        // Composite foreign keys also enforce same-source references during concurrent writes.
        const cause = (error as { cause?: { code?: string; message?: string } })
          .cause;
        if (cause?.code === '23503') return 'missingParent';
        throw error;
      }
    };
    return ingest(input, {
      sellers: (s) => save('sellers', s.id, { name: s.name }),
      deals: (d) =>
        save('deals', d.id, {
          seller_id: d.sellerId,
          company: d.company,
          industry: d.industry,
          amount_wan: d.amount,
          customer_size: d.size,
          stage: d.stage,
          outcome: d.outcome,
          competitor: d.competitor,
          closed_on: d.closed,
        }),
      visits: (v) =>
        save('visits', v.id, {
          deal_id: v.dealId,
          title: v.title,
          happened_on: v.date,
          turns: JSON.stringify(v.turns),
          fields: JSON.stringify(v.fields),
        }),
    });
  }

  async list(limit: number, cursor: string) {
    // Prefix separates visit and deal IDs even when the external IDs coincide.
    const rows = await this.db.execute(sql`
      SELECT * FROM (
        SELECT 'v' || id AS key, id, _updated_at AS stamp FROM persona_visits WHERE source='real'
        UNION ALL SELECT 'd' || id, id, NULL FROM persona_deals WHERE source='real' AND outcome='在跟'
      ) inventory WHERE key > ${cursor} ORDER BY key LIMIT ${limit + 1}
    `);
    const page = rows.slice(0, limit);
    return {
      visits: page
        .filter((r) => r.stamp != null)
        .map((r) => ({
          id: String(r.id),
          updatedAt: new Date(r.stamp as string).toISOString(),
        })),
      openDealIds: page.filter((r) => r.stamp == null).map((r) => String(r.id)),
      nextCursor: rows.length > limit ? String(page[limit - 1].key) : null,
    };
  }
}
