import { escapeHtml } from '../md.js';
import type { WireEvent } from '../events.js';

export interface PageOpts {
  mode: 'live' | 'static';
  title: string;
  /** static mode only: the full event history, embedded into the page */
  events?: WireEvent[];
  /** static mode only: pre-rendered dossier HTML */
  dossierHtml?: string;
}

/**
 * The deliberation chamber: one self-contained HTML page, no external
 * requests. Serif carries the arguments, mono carries the chamber's
 * machinery, and each seat writes in its own ink along a speaker rail.
 * Served live (SSE) by the local server and written to report.html when a
 * session finishes.
 */
export function renderPageHtml(opts: PageOpts): string {
  const eventsJson = JSON.stringify(opts.events ?? []).replace(/</g, '\\u003c');
  const dossierJson = JSON.stringify(opts.dossierHtml ?? '').replace(/</g, '\\u003c');
  const modeJson = JSON.stringify(opts.mode);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>${escapeHtml(opts.title)} — research panel</title>
<style>
  :root {
    --bg: #14181f;
    --surface: #1c222c;
    --raised: #232b37;
    --line: #2b3442;
    --text: #e8e4da;
    --muted: #8b93a1;
    --ok: #6fc276;
    --warn: #d9a441;
    --err: #d96b5a;
    --link: #8fb8c9;
    --mono: ui-monospace, "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace;
    --serif: "Iowan Old Style", Charter, Georgia, "Times New Roman", serif;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--serif);
    -webkit-font-smoothing: antialiased;
  }
  button, input { font-family: var(--mono); }
  :focus-visible { outline: 2px solid var(--warn); outline-offset: 2px; }

  header {
    position: sticky; top: 0; z-index: 10;
    background: rgba(20, 24, 31, 0.94);
    backdrop-filter: blur(6px);
    border-bottom: 1px solid var(--line);
  }
  .head-inner {
    max-width: 1200px; margin: 0 auto; padding: 12px 20px;
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  }
  .mast { margin-right: 6px; }
  .eyebrow {
    font-family: var(--mono); font-size: 10px; letter-spacing: 0.22em;
    color: var(--muted); text-transform: uppercase;
  }
  h1 { font-size: 16px; font-weight: 600; margin: 2px 0 0; max-width: 46ch; }
  #lamps { display: flex; gap: 6px; flex-wrap: wrap; }
  .lamp {
    font-family: var(--mono); font-size: 11px; padding: 3px 9px;
    border: 1px solid var(--ink); border-radius: 999px; color: var(--ink);
    opacity: 0.5; transition: opacity 0.2s;
  }
  .lamp.on { opacity: 1; animation: pulse 1.5s ease-in-out infinite; }
  @keyframes pulse { 50% { box-shadow: 0 0 9px 0 var(--ink); } }
  .chip {
    font-family: var(--mono); font-size: 11px; padding: 3px 10px;
    border-radius: 999px; border: 1px solid var(--line); color: var(--muted);
    white-space: nowrap;
  }
  .chip.ok { color: var(--ok); border-color: var(--ok); }
  .chip.warn { color: var(--warn); border-color: var(--warn); }
  .chip.err { color: var(--err); border-color: var(--err); }
  #cost { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-left: auto; }

  main {
    max-width: 1200px; margin: 0 auto; padding: 22px 20px 150px;
    display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 30px;
    align-items: start;
  }
  #side { position: sticky; top: 74px; max-height: calc(100vh - 96px); overflow: auto; }

  .session {
    display: flex; align-items: center; gap: 12px; margin: 30px 0 6px;
    color: var(--muted); font-family: var(--mono); font-size: 11px;
    letter-spacing: 0.16em; text-transform: uppercase; text-align: center;
  }
  .session::before, .session::after { content: ""; flex: 1; height: 1px; background: var(--line); }
  .session.winner { color: var(--ok); }
  .session.ck { color: var(--warn); }

  .entry { display: flex; gap: 14px; margin: 16px 0; animation: rise 0.18s ease-out; }
  @keyframes rise { from { opacity: 0; transform: translateY(4px); } }
  .rail { width: 3px; border-radius: 2px; background: var(--ink); flex: none; opacity: 0.9; }
  .entry-main { min-width: 0; flex: 1; }
  .entry-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
  .actor { font-family: var(--mono); font-size: 13px; font-weight: 700; color: var(--ink); letter-spacing: 0.03em; }
  .kind { font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .ts { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-left: auto; }
  .entry.typing .prose { color: var(--muted); font-style: italic; }
  .entry.typing .dots::after { content: "…"; animation: blink 1.2s steps(4) infinite; }
  @keyframes blink { 50% { opacity: 0.2; } }

  .prose { font-size: 15.5px; line-height: 1.62; overflow-wrap: break-word; }
  .prose p { margin: 0.5em 0; }
  .prose h1, .prose h2, .prose h3, .prose h4 {
    font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--muted); margin: 1.3em 0 0.4em;
  }
  .prose ul, .prose ol { margin: 0.5em 0; padding-left: 1.4em; }
  .prose li { margin: 0.25em 0; }
  .prose a { color: var(--link); text-decoration-color: rgba(143, 184, 201, 0.4); }
  .prose code {
    font-family: var(--mono); font-size: 0.85em;
    background: rgba(139, 147, 161, 0.14); padding: 1px 5px; border-radius: 4px;
  }
  .prose pre { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow-x: auto; }
  .prose pre code { background: none; padding: 0; }
  .prose blockquote { margin: 0.6em 0; padding-left: 12px; border-left: 2px solid var(--line); color: var(--muted); }
  .prose table { border-collapse: collapse; margin: 0.7em 0; width: 100%; font-size: 13.5px; }
  .prose th { font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .prose th, .prose td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
  .prose hr { border: 0; border-top: 1px solid var(--line); margin: 1.2em 0; }

  .sys { font-family: var(--mono); font-size: 12px; margin: 10px 0 10px 17px; color: var(--warn); }
  .sys.err { color: var(--err); }

  .verdict { margin: 36px 0 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 26px 30px; }
  .verdict-head {
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.18em;
    color: var(--ok); margin-bottom: 16px; padding-bottom: 12px;
    border-bottom: 1px solid var(--line); text-transform: uppercase;
  }
  .prose.doc { font-size: 15.5px; }
  .prose.doc h1 { font-family: var(--serif); font-size: 22px; letter-spacing: 0; text-transform: none; color: var(--text); }
  .prose.doc h2 { font-family: var(--serif); font-size: 18px; letter-spacing: 0; text-transform: none; color: var(--text); margin-top: 1.6em; }

  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 16px; }
  .panel-title { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.18em; color: var(--muted); margin-bottom: 8px; text-transform: uppercase; }
  .empty { color: var(--muted); font-size: 13px; font-style: italic; margin: 4px 0; }
  .idea { display: flex; gap: 9px; padding: 9px 2px; border-top: 1px solid var(--line); align-items: flex-start; }
  .idea:first-of-type { border-top: 0; }
  .idea .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex: none; }
  .idea-body { min-width: 0; flex: 1; }
  .idea-title { font-family: var(--mono); font-size: 12px; line-height: 1.35; }
  .idea-sub { color: var(--muted); font-size: 12.5px; line-height: 1.4; margin-top: 2px; }
  .idea.dead { opacity: 0.45; }
  .idea.dead .idea-title { text-decoration: line-through; }
  .lb-row { padding: 8px 2px; border-top: 1px solid var(--line); }
  .lb-row:first-of-type { border-top: 0; }
  .lb-head { display: flex; gap: 8px; align-items: baseline; font-family: var(--mono); font-size: 12px; }
  .lb-rank { color: var(--muted); }
  .lb-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .lb-score { color: var(--muted); }
  .lb-bar { height: 3px; background: var(--line); border-radius: 2px; margin-top: 6px; }
  .lb-fill { height: 100%; background: var(--muted); border-radius: 2px; }
  .lb-votes { font-family: var(--mono); font-size: 10.5px; color: var(--ok); margin-top: 4px; }

  button {
    font-size: 12px; padding: 8px 14px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--line); background: transparent; color: var(--text);
  }
  button:hover { border-color: var(--muted); }
  button.primary { background: var(--ok); border-color: var(--ok); color: #10141a; font-weight: 700; }
  button.primary:hover { filter: brightness(1.08); }
  button.ghost { color: var(--muted); }
  button.drop { font-size: 10.5px; padding: 3px 8px; color: var(--err); border-color: rgba(217, 107, 90, 0.5); flex: none; }
  button.drop:hover { border-color: var(--err); }

  #checkpoint {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 20;
    background: var(--raised); border-top: 1px solid var(--warn);
    padding: 12px 20px 10px;
  }
  .ck-inner { max-width: 1200px; margin: 0 auto; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .ck-label { font-family: var(--mono); font-size: 11px; letter-spacing: 0.16em; color: var(--warn); }
  #steer {
    flex: 1; min-width: 220px; background: var(--bg); border: 1px solid var(--line);
    color: var(--text); padding: 9px 12px; border-radius: 6px; font-size: 13px;
  }
  #steer::placeholder { color: var(--muted); }
  .ck-hint { max-width: 1200px; margin: 6px auto 0; font-family: var(--mono); font-size: 11px; color: var(--muted); }

  @media (max-width: 940px) {
    main { grid-template-columns: 1fr; padding-bottom: 190px; }
    #side { position: static; max-height: none; order: 2; }
    #cost { margin-left: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .entry, .lamp.on, .entry.typing .dots::after { animation: none; }
  }
</style>
</head>
<body>
<header>
  <div class="head-inner">
    <div class="mast">
      <div class="eyebrow">Research panel</div>
      <h1>${escapeHtml(opts.title)}</h1>
    </div>
    <div id="lamps"></div>
    <span id="phase" class="chip">starting</span>
    <span id="cost"></span>
    <span id="live" class="chip">connecting</span>
  </div>
</header>
<main>
  <section id="feed" aria-live="polite"></section>
  <aside id="side">
    <div class="panel">
      <div class="panel-title">Idea board</div>
      <div id="board"><p class="empty">No ideas yet — divergence has not started.</p></div>
    </div>
    <div class="panel">
      <div class="panel-title">Leaderboard</div>
      <div id="leaderboard"><p class="empty">Appears after the first vote.</p></div>
    </div>
  </aside>
</main>
<div id="checkpoint" hidden>
  <div class="ck-inner">
    <span class="ck-label">CHECKPOINT</span>
    <input id="steer" placeholder="Add a binding instruction for the panel…" maxlength="1000">
    <button id="steerBtn">Steer</button>
    <button id="continueBtn" class="primary">Continue debate</button>
    <button id="quitBtn" class="ghost">Pause run</button>
  </div>
  <p class="ck-hint">Drop ideas from the board panel on the right. Steering notes bind every seat for the rest of the run.</p>
</div>
<script>
window.__EVENTS__ = ${eventsJson};
window.__DOSSIER_HTML__ = ${dossierJson};
var MODE = ${modeJson};

var SEAT_INKS = ["#e0a458", "#56b3c9", "#c9707e", "#7fa66a", "#9a86c9", "#b0813e"];
var inks = {};
var nextInk = 0;
var typingRows = {};
var lampEls = {};
var boardCards = [];
var checkpointActive = false;
var finished = false;
var feed = document.getElementById("feed");

function el(tag, cls, html) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function esc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}
function ink(actor) {
  if (actor === "moderator") return "#8b93a1";
  if (actor === "owner") return "#e8e4da";
  if (!inks[actor]) {
    inks[actor] = SEAT_INKS[nextInk % SEAT_INKS.length];
    nextInk++;
    var lamp = el("span", "lamp", esc(actor));
    lamp.style.setProperty("--ink", inks[actor]);
    document.getElementById("lamps").appendChild(lamp);
    lampEls[actor] = lamp;
  }
  return inks[actor];
}
function lampOn(actor, on) {
  ink(actor);
  if (lampEls[actor]) lampEls[actor].className = on ? "lamp on" : "lamp";
}
function nearBottom() {
  return window.innerHeight + window.scrollY >= document.body.scrollHeight - 320;
}
function append(node) {
  var stick = MODE === "live" && nearBottom();
  feed.appendChild(node);
  if (stick) window.scrollTo(0, document.body.scrollHeight);
}
function fmtTime(ts) {
  try {
    var d = new Date(ts);
    return d.toTimeString().slice(0, 8);
  } catch (e) { return ""; }
}
function setChip(id, text, tone) {
  var c = document.getElementById(id);
  c.textContent = text;
  c.className = "chip" + (tone ? " " + tone : "");
}
function addSession(label, cls) {
  var s = el("div", "session" + (cls ? " " + cls : ""));
  s.appendChild(el("span", "", esc(label)));
  append(s);
}
function addSys(text, tone) {
  append(el("div", "sys" + (tone === "err" ? " err" : ""), esc(text)));
}
function clearTyping() {
  Object.keys(typingRows).forEach(function (actor) { removeTyping(actor); lampOn(actor, false); });
}
function removeTyping(actor) {
  if (typingRows[actor]) { typingRows[actor].remove(); delete typingRows[actor]; }
}
function showTyping(actor, activity) {
  removeTyping(actor);
  var color = ink(actor);
  var entry = el("article", "entry typing");
  entry.style.setProperty("--ink", color);
  entry.appendChild(el("div", "rail"));
  var main = el("div", "entry-main");
  var head = el("div", "entry-head");
  head.appendChild(el("span", "actor", esc(actor)));
  main.appendChild(head);
  main.appendChild(el("div", "prose dots", esc(activity)));
  entry.appendChild(main);
  typingRows[actor] = entry;
  append(entry);
}
function addMessage(e) {
  var color = ink(e.actor);
  var entry = el("article", "entry");
  entry.style.setProperty("--ink", color);
  entry.appendChild(el("div", "rail"));
  var main = el("div", "entry-main");
  var head = el("div", "entry-head");
  head.appendChild(el("span", "actor", esc(e.actor)));
  head.appendChild(el("span", "kind", esc(e.kind + (e.round ? " · round " + e.round : ""))));
  head.appendChild(el("span", "ts", esc(fmtTime(e.ts))));
  main.appendChild(head);
  main.appendChild(el("div", "prose", e.html !== undefined ? e.html : esc(e.markdown)));
  entry.appendChild(main);
  append(entry);
}
function renderBoard() {
  var host = document.getElementById("board");
  host.innerHTML = "";
  if (!boardCards.length) {
    host.appendChild(el("p", "empty", "No ideas yet — divergence has not started."));
    return;
  }
  boardCards.forEach(function (card) {
    var row = el("div", "idea" + (card.status !== "active" ? " dead" : ""));
    var dot = el("span", "dot");
    dot.style.background = ink(card.seatId);
    row.appendChild(dot);
    var body = el("div", "idea-body");
    body.appendChild(el("div", "idea-title", esc(card.id + " · " + card.title)));
    body.appendChild(el("div", "idea-sub", esc(card.status === "active" ? card.one_liner : (card.statusReason || card.status))));
    row.appendChild(body);
    if (card.status === "active" && checkpointActive && MODE === "live" && !finished) {
      var btn = el("button", "drop", "Drop");
      btn.onclick = function () { post({ action: "drop", ids: [card.id] }); };
      row.appendChild(btn);
    }
    host.appendChild(row);
  });
}
function renderLeaderboard(entries) {
  var host = document.getElementById("leaderboard");
  host.innerHTML = "";
  if (!entries.length) {
    host.appendChild(el("p", "empty", "Appears after the first vote."));
    return;
  }
  entries.forEach(function (entry, i) {
    var row = el("div", "lb-row");
    var head = el("div", "lb-head");
    head.appendChild(el("span", "lb-rank", esc(String(i + 1))));
    head.appendChild(el("span", "lb-name", esc(entry.ideaId + " · " + entry.title)));
    head.appendChild(el("span", "lb-score", esc(entry.weightedScore.toFixed(2))));
    row.appendChild(head);
    var bar = el("div", "lb-bar");
    var fill = el("div", "lb-fill");
    fill.style.width = Math.max(2, Math.min(100, entry.weightedScore * 10)) + "%";
    bar.appendChild(fill);
    row.appendChild(bar);
    if (entry.firstPlaceVotes > 0) {
      var marks = "";
      for (var v = 0; v < entry.firstPlaceVotes; v++) marks += "\\u25cf ";
      row.appendChild(el("div", "lb-votes", esc(marks + "first-place vote" + (entry.firstPlaceVotes > 1 ? "s" : ""))));
    }
    host.appendChild(row);
  });
}
function closeCheckpoint() {
  checkpointActive = false;
  document.getElementById("checkpoint").hidden = true;
  renderBoard();
}
function post(body) {
  fetch("/checkpoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).catch(function () {});
}
function loadDossier() {
  if (MODE === "static") { showDossier(window.__DOSSIER_HTML__); return; }
  fetch("/dossier.html").then(function (r) { return r.text(); }).then(showDossier).catch(function () {});
}
function showDossier(html) {
  if (!html) return;
  var v = el("section", "verdict");
  v.appendChild(el("div", "verdict-head", "Verdict · Recommendation dossier"));
  v.appendChild(el("div", "prose doc", html));
  feed.appendChild(v);
  if (MODE === "live") v.scrollIntoView({ behavior: "smooth" });
}
function handle(e) {
  switch (e.type) {
    case "phase":
      clearTyping();
      addSession(e.label);
      setChip("phase", e.label);
      break;
    case "seat_working":
      showTyping(e.actor, e.activity);
      lampOn(e.actor, true);
      break;
    case "message":
      removeTyping(e.actor);
      lampOn(e.actor, false);
      addMessage(e);
      break;
    case "board":
      boardCards = e.ideas;
      renderBoard();
      break;
    case "leaderboard":
      renderLeaderboard(e.entries);
      break;
    case "cost":
      document.getElementById("cost").textContent = "$" + e.spentUsd.toFixed(2) + " / $" + e.limitUsd.toFixed(0);
      break;
    case "checkpoint":
      clearTyping();
      checkpointActive = true;
      addSession("Checkpoint — the panel waits for you", "ck");
      if (MODE === "live") {
        document.getElementById("checkpoint").hidden = false;
        setChip("phase", "checkpoint", "warn");
      }
      renderBoard();
      break;
    case "checkpoint_done":
      closeCheckpoint();
      addSession("Debate resumes");
      break;
    case "winner":
      addSession(
        (e.converged ? "Converged · " : "Round cap · leader selected · ") + e.ideaId + (e.title ? " — " + e.title : ""),
        "winner"
      );
      break;
    case "warning":
      addSys(e.text);
      break;
    case "paused":
      closeCheckpoint();
      setChip("live", "PAUSED", "warn");
      addSys("Run paused — resume it from the terminal with: research-panel resume <session-dir>");
      break;
    case "error":
      closeCheckpoint();
      setChip("live", "ERROR", "err");
      addSys(e.text, "err");
      break;
    case "done":
      finished = true;
      closeCheckpoint();
      setChip("live", "FINISHED", "ok");
      setChip("phase", "complete", "ok");
      loadDossier();
      break;
  }
}

if (MODE === "static") {
  setChip("live", "REPLAY", "ok");
  (window.__EVENTS__ || []).forEach(handle);
  window.scrollTo(0, 0);
} else {
  document.getElementById("continueBtn").onclick = function () { post({ action: "continue" }); };
  document.getElementById("quitBtn").onclick = function () {
    if (confirm("Pause the run? You can resume it later from the terminal.")) post({ action: "quit" });
  };
  var sendSteer = function () {
    var input = document.getElementById("steer");
    var note = input.value.trim();
    if (note) { post({ action: "steer", note: note }); input.value = ""; }
  };
  document.getElementById("steerBtn").onclick = sendSteer;
  document.getElementById("steer").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") sendSteer();
  });
  var source = new EventSource("/events");
  source.onopen = function () { if (!finished) setChip("live", "LIVE", "ok"); };
  source.onerror = function () { if (!finished) setChip("live", "RECONNECTING", "warn"); };
  source.onmessage = function (msg) {
    try { handle(JSON.parse(msg.data)); } catch (err) { /* skip malformed frame */ }
  };
}
</script>
</body>
</html>
`;
}
