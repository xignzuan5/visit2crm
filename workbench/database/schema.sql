BEGIN;
CREATE TABLE persona_sellers (
  source text NOT NULL DEFAULT 'demo' CHECK (source IN ('demo','real')), id text NOT NULL, PRIMARY KEY (source,id), name text NOT NULL,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (CASE WHEN nullif(current_setting('app.user_id',TRUE),'') IS NOT NULL THEN ROW(current_setting('app.user_id',TRUE))::user_profile END),
  _updated_by user_profile DEFAULT (CASE WHEN nullif(current_setting('app.user_id',TRUE),'') IS NOT NULL THEN ROW(current_setting('app.user_id',TRUE))::user_profile END)
);
ALTER TABLE persona_sellers ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON persona_sellers TO service_role USING (true);
CREATE POLICY persona_read ON persona_sellers FOR SELECT TO authenticated USING (true);
CREATE POLICY persona_insert ON persona_sellers FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY persona_real_insert ON persona_sellers FOR INSERT TO authenticated WITH CHECK (source='real' AND (_updated_by).user_id = nullif(current_setting('app.user_id',true),'') AND (_created_by).user_id = (_updated_by).user_id);
CREATE POLICY persona_update ON persona_sellers FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY persona_real_update ON persona_sellers FOR UPDATE TO authenticated USING (source='real') WITH CHECK (source='real' AND (_updated_by).user_id = nullif(current_setting('app.user_id',true),''));
CREATE TABLE persona_deals (
  source text NOT NULL DEFAULT 'demo' CHECK (source IN ('demo','real')), id text NOT NULL, PRIMARY KEY (source,id), seller_id text NOT NULL, FOREIGN KEY (source,seller_id) REFERENCES persona_sellers(source,id), company text NOT NULL, industry text, amount_wan numeric CHECK (amount_wan > 0), customer_size text, stage text NOT NULL, outcome text NOT NULL CHECK (outcome IN ('在跟','赢单','输单')), competitor text, closed_on date,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (CASE WHEN nullif(current_setting('app.user_id',TRUE),'') IS NOT NULL THEN ROW(current_setting('app.user_id',TRUE))::user_profile END),
  _updated_by user_profile DEFAULT (CASE WHEN nullif(current_setting('app.user_id',TRUE),'') IS NOT NULL THEN ROW(current_setting('app.user_id',TRUE))::user_profile END)
);
ALTER TABLE persona_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON persona_deals TO service_role USING (true);
CREATE POLICY persona_read ON persona_deals FOR SELECT TO authenticated USING (true);
CREATE POLICY persona_insert ON persona_deals FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY persona_real_insert ON persona_deals FOR INSERT TO authenticated WITH CHECK (source='real' AND (_updated_by).user_id = nullif(current_setting('app.user_id',true),'') AND (_created_by).user_id = (_updated_by).user_id);
CREATE POLICY persona_update ON persona_deals FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY persona_real_update ON persona_deals FOR UPDATE TO authenticated USING (source='real') WITH CHECK (source='real' AND (_updated_by).user_id = nullif(current_setting('app.user_id',true),''));
CREATE TABLE persona_visits (
  source text NOT NULL DEFAULT 'demo' CHECK (source IN ('demo','real')), id text NOT NULL, PRIMARY KEY (source,id), deal_id text NOT NULL, FOREIGN KEY (source,deal_id) REFERENCES persona_deals(source,id), title text NOT NULL, happened_on date NOT NULL, turns jsonb NOT NULL, fields jsonb NOT NULL,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (CASE WHEN nullif(current_setting('app.user_id',TRUE),'') IS NOT NULL THEN ROW(current_setting('app.user_id',TRUE))::user_profile END),
  _updated_by user_profile DEFAULT (CASE WHEN nullif(current_setting('app.user_id',TRUE),'') IS NOT NULL THEN ROW(current_setting('app.user_id',TRUE))::user_profile END)
);
ALTER TABLE persona_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON persona_visits TO service_role USING (true);
CREATE POLICY persona_read ON persona_visits FOR SELECT TO authenticated USING (true);
CREATE POLICY persona_insert ON persona_visits FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY persona_real_insert ON persona_visits FOR INSERT TO authenticated WITH CHECK (source='real' AND (_updated_by).user_id = nullif(current_setting('app.user_id',true),'') AND (_created_by).user_id = (_updated_by).user_id);
CREATE POLICY persona_update ON persona_visits FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY persona_real_update ON persona_visits FOR UPDATE TO authenticated USING (source='real') WITH CHECK (source='real' AND (_updated_by).user_id = nullif(current_setting('app.user_id',true),''));
COMMENT ON COLUMN persona_visits.turns IS '@type { Array<{ role: string; text: string; signal?: string }> }';
COMMENT ON COLUMN persona_visits.fields IS '@type { Record<string, {known: boolean; summary: string; quote: string}> }';
COMMIT;
