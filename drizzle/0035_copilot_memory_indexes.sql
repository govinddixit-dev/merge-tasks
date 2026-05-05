-- 0035_copilot_memory_indexes.sql
-- Issue 8: Add secondary indexes to copilot memory tables.
-- Without these, every copilot interaction does a full table scan at 100K+ rows.
-- Run during a low-traffic window; CREATE INDEX is non-blocking on InnoDB with
-- ALGORITHM=INPLACE but may briefly increase I/O.

-- copilot_conversations: queried by userId + ORDER BY createdAt DESC
CREATE INDEX idx_cc_user_created
  ON copilot_conversations (userId, createdAt);

-- copilot_conversations: also queried by organizationId for admin views
CREATE INDEX idx_cc_org_created
  ON copilot_conversations (organizationId, createdAt);

-- copilot_task_log: queried by userId + ORDER BY createdAt DESC
CREATE INDEX idx_ctl_user_created
  ON copilot_task_log (userId, createdAt);

-- copilot_task_log: also queried by organizationId
CREATE INDEX idx_ctl_org_created
  ON copilot_task_log (organizationId, createdAt);

-- copilot_memory: queried by userId + category for preference lookup
CREATE INDEX idx_cm_user_cat
  ON copilot_memory (userId, category);

-- copilot_memory: queried by userId + memoryKey for specific key lookup
CREATE INDEX idx_cm_user_key
  ON copilot_memory (userId, memoryKey);
