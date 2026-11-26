BEGIN;
ALTER TABLE persona_sellers ADD COLUMN source text NOT NULL DEFAULT 'demo' CHECK (source IN ('demo','real'));
ALTER TABLE persona_deals ADD COLUMN source text NOT NULL DEFAULT 'demo' CHECK (source IN ('demo','real'));
ALTER TABLE persona_visits ADD COLUMN source text NOT NULL DEFAULT 'demo' CHECK (source IN ('demo','real'));
ALTER TABLE persona_visits DROP CONSTRAINT persona_visits_deal_id_fkey;
ALTER TABLE persona_deals DROP CONSTRAINT persona_deals_seller_id_fkey;
ALTER TABLE persona_sellers DROP CONSTRAINT persona_sellers_pkey, ADD PRIMARY KEY (source,id);
ALTER TABLE persona_deals DROP CONSTRAINT persona_deals_pkey, ADD PRIMARY KEY (source,id),
  ADD FOREIGN KEY (source,seller_id) REFERENCES persona_sellers(source,id),
  ALTER COLUMN industry DROP NOT NULL, ALTER COLUMN customer_size DROP NOT NULL,
  ALTER COLUMN competitor DROP NOT NULL, ALTER COLUMN amount_wan DROP NOT NULL,
  ALTER COLUMN amount_wan TYPE numeric;
ALTER TABLE persona_visits DROP CONSTRAINT persona_visits_pkey, ADD PRIMARY KEY (source,id),
  ADD FOREIGN KEY (source,deal_id) REFERENCES persona_deals(source,id);
CREATE POLICY persona_real_insert ON persona_sellers FOR INSERT TO authenticated WITH CHECK (source='real' AND (_updated_by).user_id = nullif(current_setting('app.user_id',true),'') AND (_created_by).user_id = (_updated_by).user_id);
ALTER POLICY persona_update ON persona_sellers USING (false) WITH CHECK (false);
CREATE POLICY persona_real_update ON persona_sellers FOR UPDATE TO authenticated USING (source='real') WITH CHECK (source='real' AND (_updated_by).user_id = nullif(current_setting('app.user_id',true),''));
CREATE POLICY persona_real_insert ON persona_deals FOR INSERT TO authenticated WITH CHECK (source='real' AND (_updated_by).user_id = nullif(current_setting('app.user_id',true),'') AND (_created_by).user_id = (_updated_by).user_id);
ALTER POLICY persona_update ON persona_deals USING (false) WITH CHECK (false);
CREATE POLICY persona_real_update ON persona_deals FOR UPDATE TO authenticated USING (source='real') WITH CHECK (source='real' AND (_updated_by).user_id = nullif(current_setting('app.user_id',true),''));
CREATE POLICY persona_real_insert ON persona_visits FOR INSERT TO authenticated WITH CHECK (source='real' AND (_updated_by).user_id = nullif(current_setting('app.user_id',true),'') AND (_created_by).user_id = (_updated_by).user_id);
ALTER POLICY persona_update ON persona_visits USING (false) WITH CHECK (false);
CREATE POLICY persona_real_update ON persona_visits FOR UPDATE TO authenticated USING (source='real') WITH CHECK (source='real' AND (_updated_by).user_id = nullif(current_setting('app.user_id',true),''));
COMMIT;
