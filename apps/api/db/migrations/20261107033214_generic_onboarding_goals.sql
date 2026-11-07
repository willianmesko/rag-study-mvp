-- Keep earlier selections valid when an existing guide resumes on another device.
ALTER TABLE workspace_onboarding
  DROP CONSTRAINT workspace_onboarding_goal_check;

ALTER TABLE workspace_onboarding
  ADD CONSTRAINT workspace_onboarding_goal_check
  CHECK (goal IN ('knowledge', 'support', 'learning', 'legal', 'it', 'custom'));
