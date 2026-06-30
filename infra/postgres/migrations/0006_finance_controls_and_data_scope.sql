-- Migration 0006: finance controls and scoped finance metadata
-- Adds production finance control tables plus exceptional refund flags.

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS exceptional BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS exception_code TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS exception_note TEXT;

CREATE TABLE IF NOT EXISTS financial_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  normal_balance TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS accounting_period_locks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'locked',
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by TEXT NOT NULL DEFAULT '',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period)
);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  status TEXT NOT NULL,
  debit_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  difference NUMERIC(12,2) NOT NULL DEFAULT 0,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_by TEXT NOT NULL DEFAULT '',
  notes TEXT[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS financial_accounts_status_idx ON financial_accounts(tenant_id, status, code);
CREATE INDEX IF NOT EXISTS accounting_period_locks_period_idx ON accounting_period_locks(tenant_id, period);
CREATE INDEX IF NOT EXISTS reconciliation_runs_period_idx ON reconciliation_runs(tenant_id, period, checked_at DESC);
CREATE INDEX IF NOT EXISTS refunds_exceptional_idx ON refunds(tenant_id, exceptional, status);

INSERT INTO financial_accounts (id, tenant_id, code, name, type, normal_balance, status)
SELECT id || '-acct-bank', id, '1002', '银行存款', 'asset', 'debit', 'active'
FROM tenants
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO financial_accounts (id, tenant_id, code, name, type, normal_balance, status)
SELECT id || '-acct-receivable', id, '1122', '应收账款', 'asset', 'debit', 'active'
FROM tenants
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO financial_accounts (id, tenant_id, code, name, type, normal_balance, status)
SELECT id || '-acct-income', id, '6001', '课程收入', 'income', 'credit', 'active'
FROM tenants
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO financial_accounts (id, tenant_id, code, name, type, normal_balance, status)
SELECT id || '-acct-refund', id, '6603', '退款支出', 'expense', 'debit', 'active'
FROM tenants
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO financial_accounts (id, tenant_id, code, name, type, normal_balance, status)
SELECT id || '-acct-payroll-expense', id, '6401', '教师课酬', 'expense', 'debit', 'active'
FROM tenants
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO financial_accounts (id, tenant_id, code, name, type, normal_balance, status)
SELECT id || '-acct-payroll-payable', id, '2202', '应付课酬', 'liability', 'credit', 'active'
FROM tenants
ON CONFLICT (tenant_id, code) DO NOTHING;

ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_financial_accounts ON financial_accounts;
CREATE POLICY tenant_isolation_financial_accounts ON financial_accounts USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE accounting_period_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_period_locks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_accounting_period_locks ON accounting_period_locks;
CREATE POLICY tenant_isolation_accounting_period_locks ON accounting_period_locks USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_reconciliation_runs ON reconciliation_runs;
CREATE POLICY tenant_isolation_reconciliation_runs ON reconciliation_runs USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
