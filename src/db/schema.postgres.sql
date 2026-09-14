-- ════════════════════════════════════════════════════════════════════════════
--  AutoDemo — schéma PostgreSQL (consolidé des migrations SQLite v1→v10)
--  Cible de la migration multi-instance (cf docs/scaling.md). Les ids restent
--  TEXT (UUID générés applicativement). Les horodatages passent en TIMESTAMPTZ.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  email              TEXT UNIQUE NOT NULL,
  name               TEXT,
  password_hash      TEXT,
  credits            INTEGER NOT NULL DEFAULT 0,
  unsubscribed       INTEGER NOT NULL DEFAULT 0,
  email_verified     INTEGER NOT NULL DEFAULT 0,
  verify_token       TEXT,
  reset_token        TEXT,
  reset_expires      TIMESTAMPTZ,
  tokens_valid_after TIMESTAMPTZ,
  is_admin           INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  plan               TEXT,
  sub_status         TEXT,
  period_end         TIMESTAMPTZ,
  billing_name       TEXT,
  billing_address    TEXT,
  billing_country    TEXT,
  vat_number         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  activity     TEXT NOT NULL,
  city         TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','error')),
  pipeline     TEXT NOT NULL DEFAULT 'nouveau',
  note         TEXT,
  email_source TEXT,
  website      TEXT,
  source       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_user_status  ON leads(user_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_user_created ON leads(user_id, created_at);
-- Déduplication : un même téléphone ne peut exister deux fois par compte
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_user_phone
  ON leads(user_id, phone) WHERE phone IS NOT NULL AND phone <> '';

CREATE TABLE IF NOT EXISTS sites (
  id          TEXT PRIMARY KEY,
  lead_id     TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL UNIQUE,
  output_path TEXT NOT NULL,
  url         TEXT NOT NULL,
  template    TEXT NOT NULL DEFAULT 'moderne',
  views       INTEGER NOT NULL DEFAULT 0,
  last_viewed TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  lead_id    TEXT REFERENCES leads(id) ON DELETE SET NULL,
  site_id    TEXT REFERENCES sites(id) ON DELETE SET NULL,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  meta       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_type      ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_user_type ON events(user_id, type, created_at);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','retrying','done','error')),
  data        TEXT NOT NULL,
  result      TEXT,
  error       TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  retry_delay INTEGER NOT NULL DEFAULT 5000,
  retry_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(type, status);

CREATE TABLE IF NOT EXISTS email_events (
  id         TEXT PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  site_id    TEXT REFERENCES sites(id) ON DELETE SET NULL,
  lead_id    TEXT REFERENCES leads(id) ON DELETE SET NULL,
  variant    TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('sent','open','click','click_registered')),
  url        TEXT,
  ip         TEXT,
  user_agent TEXT,
  is_machine INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ee_lead      ON email_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_ee_analytics ON email_events(site_id, event_type, created_at);

CREATE TABLE IF NOT EXISTS email_sends (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  lead_id     TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  variant_id  TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  is_followup INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_es_site ON email_sends(site_id);

CREATE TABLE IF NOT EXISTS email_blacklist (
  email      TEXT PRIMARY KEY,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_sequence (
  id           TEXT PRIMARY KEY,
  site_id      TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  lead_id      TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  step         INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','done','unsubscribed')),
  channel      TEXT NOT NULL DEFAULT 'email',
  next_send_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  score        INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seq_next ON email_sequence(next_send_at, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seq_site ON email_sequence(site_id);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id   TEXT PRIMARY KEY,
  type       TEXT,
  user_id    TEXT,
  credits    INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  description   TEXT,
  currency      TEXT NOT NULL DEFAULT 'eur',
  amount_ht     INTEGER NOT NULL,
  vat_rate      REAL NOT NULL,
  vat_amount    INTEGER NOT NULL,
  amount_ttc    INTEGER NOT NULL,
  vat_note      TEXT,
  buyer_name    TEXT,
  buyer_address TEXT,
  buyer_country TEXT,
  buyer_vat     TEXT,
  stripe_ref    TEXT,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id, issued_at);

CREATE TABLE IF NOT EXISTS email_bounces (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  type       TEXT NOT NULL CHECK(type IN ('hard','soft')),
  code       TEXT,
  diagnostic TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bounces_email ON email_bounces(email, created_at);

CREATE TABLE IF NOT EXISTS events_daily (
  day     TEXT NOT NULL,
  user_id TEXT,
  type    TEXT NOT NULL,
  count   INTEGER NOT NULL,
  PRIMARY KEY (day, user_id, type)
);

CREATE TABLE IF NOT EXISTS ai_calls (
  id             TEXT PRIMARY KEY,
  user_id        TEXT,
  lead_id        TEXT,
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  tokens_in      INTEGER NOT NULL DEFAULT 0,
  tokens_out     INTEGER NOT NULL DEFAULT 0,
  cost_cents     REAL NOT NULL DEFAULT 0,
  cost_known     INTEGER NOT NULL DEFAULT 1,
  duration_ms    INTEGER,
  attempt        INTEGER NOT NULL DEFAULT 1,
  outcome        TEXT NOT NULL,
  fallbacks      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_created ON ai_calls(created_at);
