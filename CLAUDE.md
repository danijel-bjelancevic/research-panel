# research-panel

Multi-model AI research panel: a moderator plus N seats (any OpenRouter models) research one topic through blind divergence, adversarial debate rounds, rubric voting, and synthesis, converging on a recommendation with recorded dissents.

## Commands

```
pnpm dev -- <args>     # run CLI via tsx (e.g. pnpm dev -- run "topic" --ui)
pnpm build             # tsc -> dist/
pnpm typecheck         # tsc --noEmit
pnpm test              # vitest run
```

Requires `OPENROUTER_API_KEY` in env or `.env` (gitignored - never commit it).

## Architecture

The engine is a resumable state machine. `SessionState.nextPhase` drives a switch loop in `src/engine.ts`; each phase mutates state, then state is atomically saved so any crash or budget stop resumes exactly where it left off (`resume` command).

Phase order: `brief -> divergence -> personas -> checkpoint -> debate rounds -> vote -> synthesis -> grounding -> redteam -> signoff -> done`. Grounding runs only when web search is enabled; grounding and red team are individually toggleable in config.

- `src/cli.ts` - commander entry: `run`, `resume`, `report`.
- `src/engine.ts` - phase loop, checkpoint handling (terminal or browser bridge), budget/quit errors.
- `src/phases.ts` - one function per phase; all model interaction goes through `PhaseCtx`.
- `src/types.ts` - zod schemas for every record (ideas, critiques, votes, state). Schemas are the source of truth; types are inferred.
- `src/openrouter.ts` - own fetch client (no SDK): retries, timeouts, web-search plugin, cost accounting from usage data.
- `src/cost.ts` - `CostTracker`, hard `maxCostUsd` cap -> `BudgetExceededError` (session stays resumable).
- `src/board.ts` / `src/convergence.ts` - idea board operations; convergence = N-of-M seats ranking the same idea #1, else round-cap fallback to leaderboard leader (dossier states this honestly).
- `src/personas.ts` - moderator-designed personas, created AFTER divergence, aimed at the actual board.
- `src/grounding.ts` - pure logic for the fact-check gate (verdict ordering, mechanical summary, markdown); model calls live in phases.ts.
- `src/redteam.ts` - pure logic for the pre-mortem (risk scoring likelihood x severity, ordering, markdown); model calls live in phases.ts.
- `src/events.ts` - append-only `events.jsonl`; powers the live UI and the HTML report.
- `src/ui/` - localhost SSE server for `--ui` (live view + in-browser checkpoint).
- `src/report.ts` / `src/report-html.ts` - markdown dossier + self-contained report.html.
- `tests/` - vitest unit tests for pure logic (board, convergence, json, md, personas, events).

## Design decisions (do not regress)

1. **Divergence runs raw** - no personas at generation time; a breadth directive fights model homogeneity. Personas are validation, not generation: they drive debate, voting, and sign-off only.
2. **Convergence is honest** - if the round cap is hit, the leaderboard leader is selected and the dossier says so; dissents are recorded, never suppressed.
3. **Hard cost cap** - every model call goes through `CostTracker`; exceeding `maxCostUsd` halts cleanly into a resumable state.
4. **State is schema-validated** - `SessionState` parses through zod on load; unknown or corrupt state fails loudly, never silently.
5. **No SDK dependencies** - one small fetch client; the dependency list stays short (commander, zod, picocolors).

## Conventions

- TypeScript strict, no `any`. ESM (`"type": "module"`), imports end in `.js`.
- Every new record type gets a zod schema in `types.ts` first; infer the TS type from it.
- Pure logic (board math, convergence, parsing) lives in its own module with unit tests; phases stay thin orchestration.
- Session outputs go to `outputDir` (default `~/research-panels`), never inside the repo.
- Public repo: no em dashes in docs, no personal/strategic content (context `.md` inputs are gitignored on purpose - keep it that way).
