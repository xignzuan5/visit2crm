BEGIN;
CREATE TABLE persona_sellers (
  id text PRIMARY KEY, name text NOT NULL,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (CASE WHEN nullif(current_setting('app.user_id',TRUE),'') IS NOT NULL THEN ROW(current_setting('app.user_id',TRUE))::user_profile END),
  _updated_by user_profile DEFAULT (CASE WHEN nullif(current_setting('app.user_id',TRUE),'') IS NOT NULL THEN ROW(current_setting('app.user_id',TRUE))::user_profile END)
);
ALTER TABLE persona_sellers ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON persona_sellers TO service_role USING (true);
CREATE POLICY persona_read ON persona_sellers FOR SELECT TO authenticated USING (true);
CREATE POLICY persona_insert ON persona_sellers FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY persona_update ON persona_sellers FOR UPDATE TO authenticated USING (false);
CREATE TABLE persona_deals (
  id text PRIMARY KEY, seller_id text NOT NULL REFERENCES persona_sellers(id), company text NOT NULL, industry text NOT NULL, amount_wan integer NOT NULL CHECK (amount_wan > 0), customer_size text NOT NULL, stage text NOT NULL, outcome text NOT NULL CHECK (outcome IN ('在跟','赢单','输单')), competitor text NOT NULL, closed_on date,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (CASE WHEN nullif(current_setting('app.user_id',TRUE),'') IS NOT NULL THEN ROW(current_setting('app.user_id',TRUE))::user_profile END),
  _updated_by user_profile DEFAULT (CASE WHEN nullif(current_setting('app.user_id',TRUE),'') IS NOT NULL THEN ROW(current_setting('app.user_id',TRUE))::user_profile END)
);
ALTER TABLE persona_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON persona_deals TO service_role USING (true);
CREATE POLICY persona_read ON persona_deals FOR SELECT TO authenticated USING (true);
CREATE POLICY persona_insert ON persona_deals FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY persona_update ON persona_deals FOR UPDATE TO authenticated USING (false);
CREATE TABLE persona_visits (
  id text PRIMARY KEY, deal_id text NOT NULL REFERENCES persona_deals(id), title text NOT NULL, happened_on date NOT NULL, turns jsonb NOT NULL, fields jsonb NOT NULL,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (CASE WHEN nullif(current_setting('app.user_id',TRUE),'') IS NOT NULL THEN ROW(current_setting('app.user_id',TRUE))::user_profile END),
  _updated_by user_profile DEFAULT (CASE WHEN nullif(current_setting('app.user_id',TRUE),'') IS NOT NULL THEN ROW(current_setting('app.user_id',TRUE))::user_profile END)
);
ALTER TABLE persona_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON persona_visits TO service_role USING (true);
CREATE POLICY persona_read ON persona_visits FOR SELECT TO authenticated USING (true);
CREATE POLICY persona_insert ON persona_visits FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY persona_update ON persona_visits FOR UPDATE TO authenticated USING (false);
COMMENT ON COLUMN persona_visits.turns IS '@type { Array<{ role: string; text: string; signal?: string }> }';
COMMENT ON COLUMN persona_visits.fields IS '@type { Record<string, {known: boolean; summary: string; quote: string}> }';
COMMIT;
