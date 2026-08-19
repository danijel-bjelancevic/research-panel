# research-panel

A reusable CLI that puts a **panel of AI models** (Claude, GPT, Gemini - any OpenRouter model) to work on one research question. The models propose ideas blind, attack each other's proposals over several debate rounds, vote against a rubric, and converge on a single recommendation - with recorded dissents when a model genuinely disagrees.

Everything goes through **OpenRouter** (one API key, one bill), and every seat can use **web search** during research via OpenRouter's web plugin, with citations collected into the final report.

## How a session works

```
brief ──▶ blind divergence ──▶ personas ──▶ human checkpoint ──▶ debate rounds ──▶ synthesis ──▶ red team ──▶ sign-off
 (moderator   (raw models        (moderator     (you drop ideas      (attack/defend/     (dossier)    (pre-mortem    (sign or
  expands the  propose ideas      designs the    or add steering      revise + vote                    on the         dissent)
  topic)       independently)     panel lenses)  notes)               each round)                      winner)
```

1. **Brief** - the moderator model expands your topic into a research brief (web-searched).
2. **Blind divergence** - each seat proposes ideas *without seeing the others* and **without a persona**: raw models, their own judgment and priors, plus a breadth directive so the sets don't converge on the obvious answer. Personas at generation time would filter what each model dares to propose.
3. **Personas** - the moderator designs an adversarial, mutually orthogonal persona for each seat, fitted to the topic *and aimed at the actual proposals on the board* (see below). Personas drive the debate, voting, and sign-off - they are the validation layer, not the generation layer.
4. **Checkpoint** - personas and the board are shown to you. Drop ideas, add binding steering notes, or just continue.
5. **Debate** - each round, every seat must attack the two strongest ideas that aren't its own, then defend/revise/abandon its own. A moderator merges duplicates, drops killed ideas, and summarizes.
6. **Vote** - from the minimum round onward, seats score every idea against the rubric and rank a top 3. The panel converges when enough seats agree on #1 (default 2 of 3).
7. **Synthesis** - the moderator writes the recommendation dossier, faithful to the debate: where an objection was never convincingly answered, the dossier says so.
8. **Red team** - before anyone signs, every seat runs a pre-mortem on the winner through its persona: "it is 12 months later and this failed - tell the story." The moderator consolidates the failure stories into a ranked risk table (likelihood x severity), each risk with its earliest observable warning sign and a concrete mitigation, plus explicit proceed-only-if conditions. Disable with `"redTeam": { "enabled": false }` in the config.
9. **Sign-off** - every seat signs or files a recorded dissent *with the pre-mortem risks in front of it*. Dissents don't block - they're some of the most useful output.

If the round cap is hit without convergence, the leaderboard leader is selected and the dossier says so honestly.

## Setup

```bash
cd research-panel
pnpm install
pnpm build

# your OpenRouter key (https://openrouter.ai/keys) - or put it in a .env file
export OPENROUTER_API_KEY=sk-or-...

# optional: make the command available everywhere
pnpm link --global
```

## Usage

```bash
research-panel init                        # writes panel.config.json with defaults
research-panel run "Find me a SaaS project idea in the European legal-tech space"
research-panel run "..." --ui                        # watch the debate live in your browser
research-panel run "..." --notes my-constraints.md   # give the panel your constraints
research-panel run "..." --rounds 3 --max-cost 5     # tighter run
research-panel run "..." --yes                       # skip the checkpoint (non-interactive)
research-panel resume ~/research-panels/2026-07-31-find-me-a-saas-...   # continue a paused/crashed run
research-panel report <session-dir>                  # (re)generate report.html for any session
research-panel models anthropic/                     # browse models + pricing
```

Without a global link, use `pnpm dev -- run "topic"` from the project directory, or `node dist/cli.js run "topic"`.

### Output

Each session gets a directory under `~/research-panels/` (configurable):

- `dossier.md` - the final report: recommendation, why it won, objections, risks, a 2–4 week validation experiment, leaderboard, dissents, idea graveyard, sources.
- `report.html` - the whole session as a self-contained page: the debate rendered as a deliberation-chamber feed (each seat in its own ink), board, leaderboard, and the dossier at the end. Written automatically when a run finishes or fails; open it in any browser, no server needed.
- `transcript.md` - the full debate, appended live as the run progresses.
- `events.jsonl` - the structured event stream powering the viewer and report.
- `state.json` - machine-readable state; enables `resume` after a crash, `quit`, or a blown cost cap.

### The live viewer (`--ui`)

`run --ui` (or `resume --ui`) starts a local server (localhost only, port `--port`/4820 by default, walks upward if taken) and opens the session in your browser. You watch seats "compose" and argue in real time, with the board, leaderboard, and running cost alongside. The checkpoint moves into the page: drop ideas with a click, type steering notes, continue, or pause the run. When the run finishes, the dossier renders at the end of the feed; the viewer stays up until you Ctrl+C the terminal. Reconnecting (or opening a second tab) replays the whole session from the event log.

### The checkpoint

After divergence the run pauses (unless `--yes`):

```
[Enter] continue · drop <id[,id]> · steer <note> · quit >
```

- `drop claude-2,gpt-1` - remove ideas you'd never pursue before the panel wastes rounds on them.
- `steer only ideas I can run solo next to a day job` - becomes a binding constraint for every seat.
- `quit` - pause; `resume` later.

## Configuration (`panel.config.json`)

| Field | Default | Meaning |
|---|---|---|
| `seats` | Claude Sonnet 5, GPT-5.2, Gemini 3.1 Pro | 2–6 panelists: `id`, OpenRouter `model`, optional `persona` |
| `moderator.model` | Claude Sonnet 5 | Runs the brief, board tidying, and synthesis |
| `ideasPerSeat` | 4 | Ideas each seat proposes during divergence |
| `rounds` | min 2, max 5 | Voting starts at `min`; cap at `max` |
| `convergence.agreeSeats` | 2 | Seats that must rank the same idea #1 |
| `webSearch` | on, engine `exa`, 5 results | Same engine for every seat keeps the panel fair |
| `rubric` | feasibility, demand, differentiation, fit, upside | Scoring keys with weights - edit freely per domain |
| `maxCostUsd` | 10 | Hard cap; the run stops and stays resumable |
| `outputDir` | `~/research-panels` | Where sessions are stored |
| `requestTimeoutMs` | 300000 | Per-request timeout (reasoning models can be slow) |

### Personas

The **personas** are what make seats disagree substantively - each is told to care about a failure mode the others would forgive.

Personas apply **only from the debate onward** - divergence always runs raw, so each model proposes from its own priors. By default a seat has **no persona**, and the moderator designs one per seat *after divergence*, fitted to the topic and aimed at the failure modes of the ideas actually proposed: a legal-tech board gets a different skeptic than a hiking-route board. Generated personas must be mutually orthogonal, at least one must be a designated skeptic, and they are generated **once per session** - stored in `state.json` (so `resume` keeps the same panel), shown at the checkpoint, and recorded in the dossier under "The panel".

To pin a lens you always want, set `persona` on that seat in the config (e.g. `"persona": "The solo-founder realist. You reject anything that can't be run alone next to a day job."`) - a pinned persona always wins over generation. `"persona": "auto"` is the same as omitting it. If the moderator's persona choice at the checkpoint looks wrong, `quit`, pin the persona in the config, and start a fresh run.

Model slugs are validated against OpenRouter's live model list at startup, so a renamed model fails fast with suggestions instead of mid-run.

## Cost

Every response reports its cost; the CLI shows a running total and enforces `maxCostUsd`. Ballpark with the default panel: **roughly $1–5 per session**, dominated by debate rounds (long context) - plus ~$0.005 per web search request. Cheap experiments: `--rounds 2 --no-search`, or put budget models in the seats and keep a strong moderator for synthesis.

## Development

```bash
pnpm dev -- run "topic"   # run from source (tsx)
pnpm typecheck
pnpm test                 # vitest: board rules, convergence math, JSON extraction
pnpm build
```

Notes:
- Panel seats may only revise/abandon their **own** ideas; the moderator can merge/drop any - but the board never falls below 2 active ideas, and every invalid model instruction is ignored with a recorded warning rather than a crash.
- Model JSON output is validated with Zod; one automatic repair round-trip is attempted before a seat is marked failed. A round survives individual seat failures as long as 2 seats remain.
- State is written atomically after every phase, so `resume` never sees a half-written session.
