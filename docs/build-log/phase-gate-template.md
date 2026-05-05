# Phase Gate Criteria — Template

Copy this checklist into the build log at the close of each phase. Every item is a hard gate: partial gates are not gates. The next phase does not start until every box is ticked and Yan has signed off in writing.

## Phase: ___
## Phase name: ___
## Close date: ___

### Completion
- [ ] All phase tasks complete (per the task list declared at phase open)
- [ ] No phase tasks deferred to a later phase without an entry in "Intentional Compromises with Resolution Dates"

### Quality
- [ ] All tests passing: unit, integration, regression
- [ ] Regression protocol executed: baseline tests, typecheck, build, audit of touched files
- [ ] No `@ts-ignore`, no `as any`, no skipped or `.only` tests introduced in this phase
- [ ] No new lint warnings introduced

### Debt
- [ ] Zero dead code at merge — every replaced handler, component, column, and helper deleted in the same PR that replaces it
- [ ] Zero orphaned schema columns from this phase (every added column is read; every deprecated column is dropped or has a dated drop plan)
- [ ] No parallel code paths surviving past their refactor
- [ ] Every new migration SQL file has a matching `_journal.json` entry in the same commit

### Architecture
- [ ] Every new domain action has an agent-accessible programmatic equivalent (tRPC procedure or documented tool)
- [ ] Every new policy/constraint is declarative, not hardcoded in UI
- [ ] Apple-for-enterprise UX standard met on all surfaces touched this phase; surrounding off-bar UI fixed in the same pass

### Build log updates
- [ ] Phase summary written into `rebuild-2026-q2.md` (what shipped, what was deleted, what decisions were made)
- [ ] "Architectural Decisions" updated with any decisions made this phase
- [ ] "Intentional Compromises" updated with any compromises logged, each with resolution date and target phase
- [ ] "Bugs Discovered Mid-Phase" updated — every bug either fixed in-phase or filed with a ticket and target phase
- [ ] "Dead Code Deleted" updated with the concrete list of files / columns / routes removed

### Review
- [ ] Code review complete (reviewer named in the phase summary)
- [ ] Yan has signed off in writing before next phase begins (dual convention — both required, see below)

### Sign-off (dual convention — both required)

Written sign-off requires BOTH of the following, and neither substitutes for the other:

**a) Dated entry in `rebuild-2026-q2.md`** under this phase's row, formatted exactly as:

> Phase N sign-off: Yan, 2026-MM-DD — gate criteria verified: [list]. Approved to proceed to Phase N+1.

**b) PR approval comment** on the phase's merge PR, formatted exactly as:

> Phase N gate criteria met. Approved for merge. See rebuild-2026-q2.md entry dated 2026-MM-DD.

- [ ] (a) Dated build-log entry added
- [ ] (b) PR approval comment posted with matching date

- Reviewer: ___
- Yan sign-off date: ___
- PR number: ___
- Next phase unblock: ___
