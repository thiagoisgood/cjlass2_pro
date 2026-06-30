CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version, name, checksum)
VALUES (1, 'initial_core_schema', '9095b140180aa8061e4c1559cf30fc8c11536dd7014801733bd8cd1f26db5727')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email_idx ON users(tenant_id, email) WHERE email <> '';

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  grade TEXT NOT NULL,
  status TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  code TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  guardian TEXT NOT NULL,
  phone TEXT NOT NULL,
  note TEXT NOT NULL,
  teacher TEXT NOT NULL,
  teacher_course TEXT NOT NULL,
  package_name TEXT NOT NULL,
  base_remaining_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  package_valid_to TEXT NOT NULL,
  attendance_rate TEXT NOT NULL,
  latest_attendance TEXT NOT NULL,
  due_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  growth_points INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date_text TEXT NOT NULL,
  title TEXT NOT NULL,
  teacher TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_communications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  time_text TEXT NOT NULL,
  body TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  default_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, title, type)
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL,
  date_text TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  student_name TEXT NOT NULL,
  teacher TEXT NOT NULL,
  room TEXT NOT NULL,
  status TEXT NOT NULL,
  color TEXT NOT NULL,
  attendance TEXT NOT NULL,
  package_name TEXT NOT NULL,
  remaining_text TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  selected BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lesson_ledger_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL,
  hours_delta NUMERIC(10,2) NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverses_entry_id TEXT REFERENCES lesson_ledger_entries(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  student_name TEXT NOT NULL,
  name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  paid_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  due TEXT NOT NULL,
  channel TEXT NOT NULL,
  invoice TEXT NOT NULL,
  created_at_text TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_ledger_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL,
  amount_delta NUMERIC(12,2) NOT NULL,
  channel TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverses_entry_id TEXT REFERENCES payment_ledger_entries(id)
);

CREATE TABLE IF NOT EXISTS notification_drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  recipient TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at_text TEXT NOT NULL,
  sent_rate TEXT,
  scheduled_for TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL REFERENCES notification_drafts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  scheduled_for_text TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS scheduled_for_text TEXT;

INSERT INTO schema_migrations (version, name, checksum)
VALUES (2, 'notification_delivery_state_machine', '8354fd92e35607bb825326cd32ed6af25346474e40b1d00f73a2688234b5d119')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS business_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  channel TEXT NOT NULL,
  source_text TEXT NOT NULL,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
  created_at_text TEXT NOT NULL,
  executed_at_text TEXT,
  proposal_original TEXT,
  proposal_target TEXT,
  proposal_course TEXT,
  proposal_teacher TEXT,
  proposal_room TEXT,
  proposal_amount NUMERIC(12,2),
  expected_version INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_task_checks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES business_tasks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS business_task_effects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES business_tasks(id) ON DELETE CASCADE,
  effect TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  time_text TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_docs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at_text TEXT NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  source_uri TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'text/plain',
  checksum TEXT NOT NULL DEFAULT '',
  parser TEXT NOT NULL DEFAULT '',
  effective_from TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  invalidated_at TIMESTAMPTZ,
  invalidated_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  embedding vector(1536),
  embedding_provider TEXT,
  embedding_model TEXT,
  embedding_dimension INTEGER,
  embedded_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_integrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  task TEXT NOT NULL,
  started_at_text TEXT NOT NULL,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  request_hash TEXT,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE INDEX IF NOT EXISTS students_tenant_idx ON students(tenant_id);
CREATE INDEX IF NOT EXISTS lessons_tenant_student_idx ON lessons(tenant_id, student_id);
CREATE INDEX IF NOT EXISTS orders_tenant_student_idx ON orders(tenant_id, student_id);
CREATE INDEX IF NOT EXISTS notification_tenant_status_idx ON notification_drafts(tenant_id, status);
CREATE INDEX IF NOT EXISTS business_tasks_tenant_status_idx ON business_tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_time_idx ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_chunks_tenant_doc_idx ON knowledge_chunks(tenant_id, doc_id);
CREATE INDEX IF NOT EXISTS knowledge_docs_validity_idx ON knowledge_docs(tenant_id, status, scope, effective_from, expires_at) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS knowledge_chunks_content_hash_idx ON knowledge_chunks(tenant_id, doc_id, content_hash);
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_ivfflat_idx ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100) WHERE embedding IS NOT NULL;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenants ON tenants;
CREATE POLICY tenant_isolation_tenants ON tenants USING (id = current_setting('app.tenant_id', true)) WITH CHECK (id = current_setting('app.tenant_id', true));

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_students ON students;
CREATE POLICY tenant_isolation_students ON students USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE student_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_student_records ON student_records;
CREATE POLICY tenant_isolation_student_records ON student_records USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE student_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_communications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_student_communications ON student_communications;
CREATE POLICY tenant_isolation_student_communications ON student_communications USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_courses ON courses;
CREATE POLICY tenant_isolation_courses ON courses USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lessons ON lessons;
CREATE POLICY tenant_isolation_lessons ON lessons USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE lesson_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_ledger_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lesson_ledger_entries ON lesson_ledger_entries;
CREATE POLICY tenant_isolation_lesson_ledger_entries ON lesson_ledger_entries USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_orders ON orders;
CREATE POLICY tenant_isolation_orders ON orders USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE payment_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_ledger_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_payment_ledger_entries ON payment_ledger_entries;
CREATE POLICY tenant_isolation_payment_ledger_entries ON payment_ledger_entries USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE notification_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_notification_drafts ON notification_drafts;
CREATE POLICY tenant_isolation_notification_drafts ON notification_drafts USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_notification_deliveries ON notification_deliveries;
CREATE POLICY tenant_isolation_notification_deliveries ON notification_deliveries USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE business_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_business_tasks ON business_tasks;
CREATE POLICY tenant_isolation_business_tasks ON business_tasks USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE business_task_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_task_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_business_task_checks ON business_task_checks;
CREATE POLICY tenant_isolation_business_task_checks ON business_task_checks USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE business_task_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_task_effects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_business_task_effects ON business_task_effects;
CREATE POLICY tenant_isolation_business_task_effects ON business_task_effects USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_notification_templates ON notification_templates;
CREATE POLICY tenant_isolation_notification_templates ON notification_templates USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;
CREATE POLICY tenant_isolation_audit_logs ON audit_logs USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE knowledge_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_docs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_knowledge_docs ON knowledge_docs;
CREATE POLICY tenant_isolation_knowledge_docs ON knowledge_docs USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_knowledge_chunks ON knowledge_chunks;
CREATE POLICY tenant_isolation_knowledge_chunks ON knowledge_chunks USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE channel_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_channel_integrations ON channel_integrations;
CREATE POLICY tenant_isolation_channel_integrations ON channel_integrations USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_agent_runs ON agent_runs;
CREATE POLICY tenant_isolation_agent_runs ON agent_runs USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_idempotency_keys ON idempotency_keys;
CREATE POLICY tenant_isolation_idempotency_keys ON idempotency_keys USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
