# QA-only database regression scripts

These scripts validate employee module permissions, edit/delete separation, profile self-escalation protection, audit capture, and guarded undo.

**Run only against the Supabase QA project** (bpkkzyjfkktkaadhmbdi) using the SQL editor or the connected QA SQL tool. They use the QA owner fixture ID and intentionally roll back their test fixtures. Do not run these scripts against Production.

Files:
- employee-permissions-qa.sql: module read scopes, edit/delete enforcement, and self-permission update denial.
- factory-safe-undo-qa.sql: latest-entry-only undo, immutable audit trail, and hard-delete guard.
- profile-audit-qa.sql: confirms profile changes are recorded in the audit trail.
- profile-self-escalation-qa.sql: blocks employees from granting themselves permissions or admin status.
