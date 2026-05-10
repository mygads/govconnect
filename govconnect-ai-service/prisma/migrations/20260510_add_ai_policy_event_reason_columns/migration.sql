-- Durable reasoning columns for ai_tool_policy_events so that RCA can
-- reconstruct why a tool policy fired without parsing an encoded policy_source.
--
-- Audit note (2026-05-10): firstTurnToolChoiceReason and toolPolicyReason
-- were previously only in application logs, which made RCA slow and brittle.
-- `final_intent_source` captures which layer produced the final answer:
--   guardrail | agent | complaint_state | service_context | cache | fallback.
-- `state_resume_result` captures what happened to a pending transactional
-- state: resumed | skipped | overridden | released.

ALTER TABLE ai."ai_tool_policy_events"
  ADD COLUMN IF NOT EXISTS tool_policy_reason TEXT,
  ADD COLUMN IF NOT EXISTS first_turn_tool_choice TEXT,
  ADD COLUMN IF NOT EXISTS first_turn_tool_choice_reason TEXT,
  ADD COLUMN IF NOT EXISTS final_intent_source TEXT,
  ADD COLUMN IF NOT EXISTS state_resume_result TEXT,
  ADD COLUMN IF NOT EXISTS answer_policy_kind TEXT,
  ADD COLUMN IF NOT EXISTS answer_policy_rewritten BOOLEAN;

CREATE INDEX IF NOT EXISTS "ai_tool_policy_events_first_turn_tool_choice_idx"
  ON ai."ai_tool_policy_events" (first_turn_tool_choice, created_at);

CREATE INDEX IF NOT EXISTS "ai_tool_policy_events_final_intent_source_idx"
  ON ai."ai_tool_policy_events" (final_intent_source, created_at);

CREATE INDEX IF NOT EXISTS "ai_tool_policy_events_state_resume_result_idx"
  ON ai."ai_tool_policy_events" (state_resume_result, created_at);
