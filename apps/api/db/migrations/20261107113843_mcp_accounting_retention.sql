-- Paid attempts and rate counters belong to the workspace's accounting history.
-- Removing/re-adding a membership must not refund consumed budget or release an
-- in-flight provider slot. Admission still verifies the current membership.
ALTER TABLE workspace_mcp_call_usage
  DROP CONSTRAINT workspace_mcp_call_usage_tenant_id_user_id_fkey,
  ADD CONSTRAINT workspace_mcp_call_usage_tenant_fk FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE workspace_mcp_provider_usage
  DROP CONSTRAINT workspace_mcp_provider_usage_tenant_id_user_id_fkey,
  ADD CONSTRAINT workspace_mcp_provider_usage_tenant_fk FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE workspace_mcp_provider_reservations
  DROP CONSTRAINT workspace_mcp_provider_reservations_tenant_id_user_id_fkey,
  ADD CONSTRAINT workspace_mcp_provider_reservations_tenant_fk FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
