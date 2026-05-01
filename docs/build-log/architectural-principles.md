# Architectural Principles — 2026 Q2 Rebuild

These principles govern every prompt, PR, and phase of this rebuild. When two principles conflict, escalate to Yan rather than picking one silently.

## 1. Zero technical debt at end of build
Every compromise has a resolution date and a phase that retires it. No open-ended TODOs. Intentional compromises are logged in `rebuild-2026-q2.md` with a target phase and date; unresolved entries are gate-blocking at phase close.

## 2. No dead code at merge time
Every PR deletes what it replaces in the same PR. Legacy columns, legacy handlers, legacy components — gone, not deprecated. Record deletions under "Dead Code Deleted" for the phase.

## 3. No parallel code paths surviving past their refactor
Two functions doing the same thing is a bug. A migration that introduces a new path must retire the old path within the same phase.

## 4. Schema migrations include their deprecation plan
Any migration that adds a column destined to replace another must, in the same commit, name the column it replaces and the migration number that will drop it. The drizzle journal is updated in the same commit as the SQL file.

## 5. Every domain action has an agent-accessible programmatic equivalent
If a distributor can do it through the UI, an agent must be able to do it through tRPC / a documented tool. UI-only side effects are banned. This is what "AI-native architecture" means for this rebuild.

## 6. Every policy/constraint is declarative, not hardcoded in UI
Imprint zone allow-lists, decoration method constraints, quantity tiers, markup rules, decoration cost formulas — all live in the data model or a policy layer that both the UI and agents read. If a rule only exists inside a React component, it's a bug.

## 7. Apple-for-enterprise UX standard
Every visible surface meets the "$50K/year software" bar. Fix off-bar surroundings in the same pass — do not leave a polished component next to a janky one. Typography, spacing, interaction states, keyboard support, empty states, loading states are all part of "done."

## 8. Sequential track only, one phase at a time
No parallel phase work. No starting Phase N+1 while Phase N is in gate review. The single-track constraint is what keeps dead-code and parallel-path rules enforceable.

## 9. Phase gate criteria must be met before next phase starts
`phase-gate-template.md` is the authoritative checklist. Every item is a hard gate. Partial gates are not gates.

## 10. Regression protocol run at every phase boundary
Baseline tests, typecheck, build, and audit of every touched file before close. No `@ts-ignore`, no `as any`, no skipped tests. This applies at phase open (to prove the branch starts green) and at phase close (to prove the phase delivered green).

## 11. Mid-phase bugs are deferred unless they block the gate
Bugs discovered mid-phase are fixed inline only if they block that phase's gate criteria. Non-blocking bugs are logged under "Bugs Discovered Mid-Phase" and resolved in Phase 6 unless otherwise scheduled.
