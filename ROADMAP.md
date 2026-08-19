# Roadmap

Where research-panel is going. Ordered by intent, not by promise.

## Shipped

- **Red-team pre-mortem** (v0.2): before sign-off, every seat attacks the winning recommendation through its persona ("it is 12 months later and this failed - tell the story"); the moderator consolidates a ranked risk table with early warning signs, mitigations, and proceed-only-if conditions. Seats sign with the risks in front of them.
- **Grounding gate** (v0.2): the moderator extracts the dossier's load-bearing checkable claims; each gets its own web-searched fact-check with a supported / contested / unverified verdict and cited sources. Contested claims lead the table, feed the red team, and sit in front of every seat at sign-off.
- **Eval harness** (v0.2): `research-panel eval <session-dir>` judges a finished session against a single-model baseline given the same brief - blind A/B judging against the session's rubric, run twice with candidates swapped to expose position bias, with costs compared and the caveats stated. Answers the honest question: did the debate buy anything?

## Next

- **Facet sub-panels**: the moderator splits a broad brief into 2-4 facets, mini-panels debate each in parallel, and a final round integrates the facet winners. For briefs too wide for one board.

## Later

- **Tournament mode**: more seats, elimination brackets, budget-aware seeding.
- **Session comparison**: diff two dossiers on the same topic run months apart - what changed in the world, what changed in the models.
- **Cost telemetry**: per-seat, per-phase spend breakdown in the dossier, so the expensive parts of a debate are visible.

Suggestions and issues welcome.
