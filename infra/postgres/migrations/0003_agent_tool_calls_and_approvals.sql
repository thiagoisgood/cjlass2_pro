-- Migration 0003: Agent tool calls and approvals
-- Adds tracking for Agent tool executions and approval workflows

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  input_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_result JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  tool_call_id TEXT REFERENCES agent_tool_calls(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'high',
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  approval_note TEXT,
  input_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS agent_tool_calls_run_idx ON agent_tool_calls(tenant_id, agent_run_id);
CREATE INDEX IF NOT EXISTS agent_tool_calls_status_idx ON agent_tool_calls(tenant_id, status);
CREATE INDEX IF NOT EXISTS agent_approvals_run_idx ON agent_approvals(tenant_id, agent_run_id);
CREATE INDEX IF NOT EXISTS agent_approvals_status_idx ON agent_approvals(tenant_id, status);
CREATE INDEX IF NOT EXISTS agent_approvals_requested_by_idx ON agent_approvals(tenant_id, requested_by);

-- Row Level Security
ALTER TABLE agent_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_calls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_agent_tool_calls ON agent_tool_calls;
CREATE POLICY tenant_isolation_agent_tool_calls ON agent_tool_calls
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_agent_approvals ON agent_approvals;
CREATE POLICY tenant_isolation_agent_approvals ON agent_approvals
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
