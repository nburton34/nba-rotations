(function () {
  "use strict";

  const S = window.SEASON;
  const MINUTES = 48; // regulation; overtime minutes (if present) are noted, not drawn
  const byAbbr = Object.fromEntries(S.teams.map(t => [t.abbr, t]));
  const byId = Object.fromEntries(S.teams.filter(t => t.id).map(t => [t.id, t]));

  // One panel per open team; render functions read the panel being drawn via `state` and `$el`
  const panels = [];
  let state = null;
  const newPanel = abbr => ({ team: abbr, last: "all", loc: "all", res: "all", opp: "all", game: null, el: null });

  const $ = id => document.getElementById(id);
  // Heatmap minute labels: game clock 12…1 (default) or minute count 1…12
  let clockMinutes = (() => { try { return localStorage.getItem("minuteMode") !== "count"; } catch (_) { return true; } })();
  const $el = id => state.el.querySelector(`[data-el="${id}"]`);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sum = a => a.reduce((x, y) => x + y, 0);
  const pct = (w, l) => (w + l ? w / (w + l) : 0);
  const oppAbbr = id => (byId[id] ? byId[id].abbr : "—");
  const fmtDate = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

  // Team logos live in logos/<ABBR>.svg (downloaded by the scraper); hide quietly if one is missing
  const logo = (abbr, cls = "") => (abbr ? `<img class="logo ${cls}" src="logos/${abbr}.svg" alt="" loading="lazy" onerror="this.remove()">` : "");
  const oppLogo = id => (byId[id] ? logo(byId[id].abbr) : "");
  // Jersey number before the name, position after (from ESPN rosters; blank if unknown)
  function playerLabel(team, pid, name) {
    const r = (team.roster || {})[pid] || {};
    return `<span class="jersey">${r.num ? esc(r.num) : ""}</span>${esc(name)}` +
      (r.pos ? ` <span class="pos">${esc(r.pos)}</span>` : "") + injBadge(injuryOf(team.abbr, pid)) + returnBadge(team, pid);
  }

  // ---------- injuries & today's lineups (saved by the scraper) ----------
  const INJ = S.injuries || {};
  const LINEUPS = S.lineups || {};
  const CHANGES = S.changes || [];
  const LTIMES = S.lineupTimes || {};
  const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const luPill = st => st === "Confirmed" ? `<span class="lu lu-ok">✓ Confirmed</span>`
    : st ? `<span class="lu lu-exp">${esc(st)}</span>` : `<span class="lu lu-none">Not posted</span>`;
  // Today's NBA lineup status for a matchup: { away, home } statuses, or null if the NBA hasn't posted it
  function matchupLineups(away, home) {
    for (const g of Object.values(LINEUPS)) {
      if (g.date === todayStr() && g.away.abbr === away && g.home.abbr === home) {
        return { away: g.away.lineupStatus || "", home: g.home.lineupStatus || "" };
      }
    }
    return null;
  }
  const injuryOf = (abbr, pid) => (pid ? (INJ[abbr] || []).find(i => i.pid === pid) : null) || null;
  // Statuses: NBA official (OUT / DOUBT / QUES / PROB / AVAIL) for today's games, else ESPN (OUT / GTD / OFS)
  const isGLeague = i => /G League/i.test(i.nbaReason || "");
  const injShort = i => (isGLeague(i) ? "G LEAGUE" : (i.short || (i.status === "Out" ? "OUT" : "GTD")).toUpperCase());
  const isOut = i => !!i && (["OUT", "OFS", "G LEAGUE"].includes(injShort(i)));
  const INJ_CLASS = { OUT: "inj-out", OFS: "inj-out", DOUBT: "inj-doubt", QUES: "inj-gtd", GTD: "inj-gtd", PROB: "inj-prob", "G LEAGUE": "inj-gl" };
  const dayLabelSafe = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  function injBadge(i) {
    if (!i || injShort(i) === "AVAIL") return "";
    const s = injShort(i);
    const forGame = i.nbaGame && i.nbaGame !== todayStr() ? ` (for ${dayLabelSafe(i.nbaGame)})` : " (tonight)";
    const tip = [i.nba ? `NBA injury report: ${i.nba}${forGame}` : `ESPN: ${i.status}`, i.nbaReason || i.type, i.returnDate ? `est. return ${i.returnDate}` : "", i.comment]
      .filter(Boolean).join(" · ");
    return ` <span class="inj ${INJ_CLASS[s] || "inj-gtd"}" title="${esc(tip)}">${esc(s)}</span>`;
  }
  // Today's NBA lineup for a team, if the scraper saved one for today
  function officialLineup(abbr) {
    for (const [gid, g] of Object.entries(LINEUPS)) {
      if (g.date !== todayStr()) continue;
      for (const [side, other] of [["away", "home"], ["home", "away"]]) {
        if (g[side].abbr === abbr) return { gid, status: g.status, side, ...g[side], opp: g[other].abbr };
      }
    }
    return null;
  }
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function clockLabel(i) {
    const q = Math.floor(i / 12) + 1;
    const start = 12 - (i % 12);
    return `Q${q} min ${(i % 12) + 1} (${start}:00–${start - 1}:00)`;
  }
  // Short form for analysis text, e.g. "Q2 min 7"
  const minLabel = i => `Q${Math.floor(i / 12) + 1} min ${(i % 12) + 1}`;

  // ---------- colour scales ----------
  // Strong fills get white text so in-cell numbers stay readable
  const ink = a => (a > 0.55 ? "; color: #fff" : "");
  function heatColor(v) {
    if (v <= 0.001) return "";
    const a = 0.12 + 0.88 * Math.min(1, v);
    return `background: rgba(var(--heat), ${a.toFixed(3)})${ink(a)}`;
  }
  function pmColor(v, cap) {
    if (Math.abs(v) < 0.05) return "";
    const a = 0.15 + 0.85 * Math.min(1, Math.abs(v) / cap);
    return `background: rgba(var(${v > 0 ? "--pos" : "--neg"}), ${a.toFixed(3)})${ink(a)}`;
  }

  // In-cell labels: blank for zero to keep the grid scannable
  const pctLabel = v => (v > 0.004 ? String(Math.round(v * 100)) : "");
  const pmLabel = v => {
    if (Math.abs(v) < 0.05) return "";
    if (Number.isInteger(v)) return String(v); // single-game values are whole points
    const s = Math.abs(v) >= 10 ? Math.round(v).toString() : v.toFixed(1).replace(/^(-?)0\./, "$1.");
    return s; // sign is carried by colour; minus stays for negatives
  };

  // ---------- data helpers ----------
  function filteredGames(team) {
    let g = team.games.filter(x =>
      (state.loc === "all" || x.loc === state.loc) &&
      (state.res === "all" || x.result === state.res) &&
      (state.opp === "all" || String(x.opp) === state.opp));
    if (state.last !== "all") g = g.slice(-Number(state.last));
    return g;
  }

  function playerStats(games) {
    const players = {};
    for (const g of games) {
      for (const [pid, p] of Object.entries(g.players)) {
        const h = p.h.slice(0, MINUTES);
        const mins = sum(h);
        if (mins <= 0) continue;
        const s = players[pid] || (players[pid] = { pid, name: p.name, gp: 0, gs: 0, mins: 0, gameMins: [], rests: [], backs: [], entries: [], share: new Array(MINUTES).fill(0) });
        s.gp += 1;
        if (h[0] >= 0.5) {
          s.gs += 1;
          const r = h.findIndex(v => v < 0.5);
          if (r > 0) {
            s.rests.push(r);
            const b = h.findIndex((v, i) => i > r && v >= 0.5);
            if (b > 0) s.backs.push(b);
          }
        } else {
          const e = h.findIndex(v => v >= 0.5);
          if (e >= 0) s.entries.push(e);
        }
        s.mins += sum(p.h); // includes any overtime minutes
        s.gameMins.push(sum(p.h));
        h.forEach((v, i) => { s.share[i] += v; });
      }
    }
    // Share is per game the player actually played, so missed games don't dilute it
    return Object.values(players)
      .map(s => ({ ...s, mpg: s.mins / s.gp, share: s.share.map(v => v / s.gp) }))
      .sort((a, b) => b.mins - a.mins);
  }

  function mpgOver(games, pid) {
    let mins = 0, gp = 0;
    for (const g of games) {
      const p = g.players[pid];
      if (p && sum(p.h) > 0) { mins += sum(p.h); gp += 1; }
    }
    return gp ? mins / gp : null;
  }

  // Five players with the most starts in the given (recent) games; ties go to the most recent start
  function projectedStarters(recent) {
    const s = {};
    recent.forEach((g, idx) => {
      for (const [pid, p] of Object.entries(g.players)) {
        if (p.h[0] < 0.5) continue;
        const e = s[pid] || (s[pid] = { pid, starts: 0, last: -1 });
        e.starts += 1;
        e.last = idx;
      }
    });
    return new Set(Object.values(s)
      .sort((a, b) => b.starts - a.starts || b.last - a.last)
      .slice(0, 5).map(e => e.pid));
  }

  // ---------- tonight's starting five ----------
  // 1. NBA lineup Confirmed            -> exactly that five
  // 2. NBA lineup Expected             -> that five, with anyone since ruled out swapped for the likeliest fill-in
  // 3. No NBA lineup yet / later games -> starters from the last 5 games, ruled-out players swapped the same way
  const posGroup = s => (!s ? "" : /C/.test(s) ? "C" : /F/.test(s) ? "F" : "G");
  function startingFive(team, g) {
    const recent = team.games.slice(-5);
    const stats = Object.fromEntries(playerStats(team.games).map(p => [p.pid, p]));
    const nameOf = pid => (stats[pid] ? stats[pid].name : pid);
    const startsL5 = pid => recent.filter(x => x.players[pid] && x.players[pid].h[0] >= 0.5).length;
    const mpgL5 = pid => mpgOver(recent, pid) || 0;
    const today = !!g && g.date === todayStr();
    const official = today ? officialLineup(team.abbr) : null;
    const inactive = new Set(official ? official.inactive.map(x => x.pid) : []);
    const out = pid => isOut(injuryOf(team.abbr, pid)) || inactive.has(pid);

    let base, status;
    if (official && official.starters.length === 5) {
      base = official.starters.map(x => ({ pid: x.pid, name: x.name, slot: x.pos }));
      status = official.lineupStatus === "Confirmed" ? "confirmed" : "expected";
    } else {
      base = [...projectedStarters(recent)].map(pid => ({ pid, name: nameOf(pid), slot: (team.roster[pid] || {}).pos || "" }));
      status = "projected";
    }
    if (status === "confirmed") return { five: base, status, swaps: [], official };

    // Replace anyone ruled out: same position first, then most recent starts, then recent minutes
    const taken = new Set(base.map(x => x.pid));
    const pool = Object.values(stats).filter(x => !taken.has(x.pid) && !out(x.pid) && mpgOver(recent, x.pid) !== null);
    const swaps = [];
    const five = base.map(x => {
      if (!out(x.pid)) return x;
      const want = posGroup(x.slot || (team.roster[x.pid] || {}).pos);
      pool.sort((a, b) =>
        Number(posGroup((team.roster[b.pid] || {}).pos) === want) - Number(posGroup((team.roster[a.pid] || {}).pos) === want) ||
        startsL5(b.pid) - startsL5(a.pid) || mpgL5(b.pid) - mpgL5(a.pid));
      const sub = pool.shift();
      if (!sub) return x;
      const inj = injuryOf(team.abbr, x.pid);
      swaps.push({ out: x.name, in: sub.name, why: inj ? injShort(inj) : "INACTIVE" });
      return { pid: sub.pid, name: sub.name, slot: x.slot, replacing: { name: x.name, why: inj ? injShort(inj) : "INACTIVE" } };
    });
    return { five, status: swaps.length ? "projected" : status, fromNba: status === "expected", swaps, official };
  }

  // Starters / bench / out, always projected from the team's real last 5 games
  // Order is fixed: [starters, bench, out, not in recent rotation] — callers rely on [0] and [1]
  function rotationGroups(team, players) {
    const recent = team.games.slice(-5);
    const g = upcomingGame(team.abbr);
    const sf = startingFive(team, g);
    const official = sf.official;
    const inactive = new Set(official ? official.inactive.map(p => p.pid) : []);
    const out = pid => isOut(injuryOf(team.abbr, pid)) || inactive.has(pid);
    const starters = new Set(sf.five.map(p => p.pid));
    const last5Of = p => mpgOver(recent, p.pid);
    const rest = players.filter(p => !starters.has(p.pid));
    const tonight = g && g.date === todayStr();
    return [
      [sf.status === "confirmed" ? "Starting tonight (✓ Confirmed)" : tonight ? "Starting tonight (projected)" : "Projected starters",
        players.filter(p => starters.has(p.pid)).sort((a, b) => b.mpg - a.mpg)],
      ["Bench", rest.filter(p => !out(p.pid) && last5Of(p) !== null).sort((a, b) => last5Of(b) - last5Of(a))],
      ["Out (injured / inactive)", rest.filter(p => out(p.pid)).sort((a, b) => b.mpg - a.mpg)],
      ["Not in recent rotation", rest.filter(p => !out(p.pid) && last5Of(p) === null)],
    ];
  }

  // ---------- rotation analysis ----------
  // Runs of minutes (within each quarter) where share >= thr, as [startIdx, endIdx]
  function runs(share, thr) {
    const out = [];
    for (let q = 0; q < 4; q++) {
      let start = null;
      for (let m = 0; m <= 12; m++) {
        const i = q * 12 + m;
        const on = m < 12 && share[i] >= thr;
        if (on && start === null) start = i;
        if (!on && start !== null) { out.push([start, i - 1]); start = null; }
      }
    }
    return out;
  }
  // Game-clock form: minutes 1-4 of a quarter read "12–8" (on court from 12:00 down to 8:00)
  const fmtRun = ([a, b]) => `Q${Math.floor(a / 12) + 1} ${12 - (a % 12)}–${11 - (b % 12)}`;

  function describeStints(share) {
    const regular = runs(share, 0.5);
    if (regular.length) return regular.map(fmtRun).join(" · ");
    const loose = runs(share, 0.25);
    if (!loose.length) return '<span class="muted">No set stint</span>';
    const best = loose.reduce((x, y) => (sum(share.slice(y[0], y[1] + 1)) > sum(share.slice(x[0], x[1] + 1)) ? y : x));
    const peak = Math.max(...share.slice(best[0], best[1] + 1));
    return `<span class="muted">No set stint; most often ${fmtRun(best)} (up to ${Math.round(peak * 100)}%)</span>`;
  }

  const closingShare = p => sum(p.share.slice(45, 48)) / 3;          // last 3 minutes of Q4
  const median = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor((b.length - 1) / 2)]; };
  const firstRest = p => median(p.rests);     // typical first sub-out, in games started
  const firstEntry = p => median(p.entries);  // typical check-in, in games off the bench
  const stdev = a => { const m = sum(a) / a.length; return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / a.length); };

  // Clock time at the start of minute index i, e.g. 6 -> "Q1 6:00"
  const clockAt = i => `Q${Math.floor(i / 12) + 1} ${12 - (i % 12)}:00`;
  const shortNm = p => esc(p.name.replace(/^(\S)\S*\s+/, "$1. "));

  // Four quick-read lines: who closes, how subs start, rotation size/role changes, best/worst stretch
  function teamInsights(team, games, players, groups) {
    const [starters, bench] = [groups[0][1], groups[1][1]];
    const recent = team.games.slice(-5);
    const rows = [];

    // Blowouts put garbage-time players on court late, so prefer close games for the closing group
    const close = games.filter(g => Math.abs(g.pts - g.oppPts) <= 10);
    const closePool = close.length >= 2 ? playerStats(close) : players;
    const closers = closePool.filter(p => p.gp >= Math.min(2, close.length >= 2 ? close.length : games.length))
      .sort((a, b) => closingShare(b) - closingShare(a)).slice(0, 5);
    if (closers.length) rows.push(["Closes", closers.map(shortNm).join(", ")]);

    const rests = starters.map(p => [p, firstRest(p)]).filter(([, i]) => i !== null).sort((a, b) => a[1] - b[1]);
    const entries = bench.map(p => [p, firstEntry(p)]).filter(([, i]) => i !== null).sort((a, b) => a[1] - b[1]).slice(0, 3);
    const subs = [];
    if (rests.length) subs.push(`${shortNm(rests[0][0])} sits first (~${clockAt(rests[0][1])})`);
    if (entries.length) subs.push(`first in: ${entries.map(([p]) => shortNm(p)).join(", ")}`);
    if (subs.length) rows.push(["Subs", subs.join(" · ")]);

    const deep = players.filter(p => p.mpg >= 10 && mpgOver(recent, p.pid) !== null).length;
    const moves = players.map(p => [p, mpgOver(recent, p.pid), mpgOver(team.games, p.pid)])
      .filter(([, r, s]) => r !== null && s !== null).map(([p, r, s]) => [p, r - s]);
    const up = moves.filter(m => m[1] >= 3).sort((a, b) => b[1] - a[1]).slice(0, 2);
    const down = moves.filter(m => m[1] <= -3).sort((a, b) => a[1] - b[1]).slice(0, 2);
    rows.push(["Rotation", `${deep} deep` +
      (up.length ? ` · <span class="trend-up">▲</span> ${up.map(([p, d]) => `${shortNm(p)} +${d.toFixed(0)}`).join(", ")}` : "") +
      (down.length ? ` · <span class="trend-down">▼</span> ${down.map(([p, d]) => `${shortNm(p)} ${d.toFixed(0)}`).join(", ")}` : "") +
      (up.length || down.length ? ` <span class="muted">min (last 5 vs season)</span>` : "")]);

    // Best/worst 3-minute windows by average plus-minus
    const pm = new Array(MINUTES).fill(0);
    for (const g of games) g.pm.slice(0, MINUTES).forEach((v, i) => { pm[i] += v / games.length; });
    const windows = [];
    for (let q = 0; q < 4; q++) for (let m = 0; m <= 9; m++) { const x = q * 12 + m; windows.push([x, x + 2, pm[x] + pm[x + 1] + pm[x + 2]]); }
    const best = windows.reduce((x, y) => (y[2] > x[2] ? y : x));
    const worst = windows.reduce((x, y) => (y[2] < x[2] ? y : x));
    const sign = v => (v >= 0 ? "+" : "") + v.toFixed(1);
    rows.push(["Best / worst", `<span class="trend-up">${fmtRun(best)} (${sign(best[2])})</span> · <span class="trend-down">${fmtRun(worst)} (${sign(worst[2])})</span> <span class="muted">per game</span>`]);
    return rows;
  }

  function renderAnalysis(team, games) {
    if (!games.length) { $el("teamInsights").innerHTML = ""; $el("analysis").innerHTML = ""; return; }
    const players = playerStats(games);
    const groups = rotationGroups(team, players);
    $el("teamInsights").innerHTML = teamInsights(team, games, players, groups)
      .map(([k, v]) => `<div class="glance-row"><span class="glance-k">${k}</span><span>${v}</span></div>`).join("");

    let rows = "";
    for (const [label, members] of groups.slice(0, 2)) {  // starters and bench only
      if (!members.length) continue;
      rows += `<tr class="grp"><td colspan="4">${label}</td></tr>`;
      for (const p of members) {
        rows += `<tr><td>${playerLabel(team, p.pid, p.name)}</td><td class="n">${p.mpg.toFixed(1)}</td>` +
          `<td>${describeStints(p.share)}</td><td class="n">${Math.round(closingShare(p) * 100)}%</td></tr>`;
      }
    }
    $el("analysis").innerHTML =
      `<thead><tr><th>Player</th><th class="n">MPG</th><th title="Game clock, counting down from 12:00 each quarter; on court in 50%+ of games">Usual stints</th>` +
      `<th class="n" title="On court in the last 3 minutes of Q4">Closes</th></tr></thead><tbody>${rows}</tbody>`;
  }

  // ---------- rendering ----------
  function strip(values, styleFn, tipFn, labelFn) {
    let html = '<div class="strip">';
    for (let q = 0; q < 4; q++) {
      html += '<div class="qtr">';
      for (let m = 0; m < 12; m++) {
        const i = q * 12 + m;
        const v = values[i] ?? 0;
        const label = labelFn ? `<span class="val">${labelFn(v)}</span>` : "";
        html += `<div class="cell" style="${styleFn(v)}" data-tip="${esc(tipFn(v, i))}">${label}</div>`;
      }
      html += "</div>";
    }
    return html + "</div>";
  }

  function quarterHeader(cls, cols, nCols) {
    const q = [1, 2, 3, 4].map(n => `<div class="qtr-label">Q${n}</div>`).join("");
    // Game clock (12 … 1, the minute starting at 12:00, 11:00 …) or minute count (1 … 12)
    const minLabelText = m => (clockMinutes ? 12 - m : m + 1);
    const mins = [1, 2, 3, 4].map(() => `<div class="qtr">${Array.from({ length: 12 }, (_, m) =>
      `<div class="min-label" title="${clockMinutes ? `${12 - m}:00 to ${11 - m}:00 on the clock` : `minute ${m + 1} of the quarter`}">${minLabelText(m)}</div>`).join("")}</div>`).join("");
    const blanks = "<div></div>".repeat(nCols);
    return `<div class="rot-row ${cls} header">${cols}<div class="strip">${q}</div></div>` +
      `<div class="rot-row ${cls} header mins">${blanks}<div class="strip">${mins}</div></div>`;
  }

  function renderStandings() {
    const term = $("teamSearch").value.trim().toLowerCase();
    const html = ["East", "West"].map(conf => {
      const teams = S.teams.filter(t => t.conference === conf)
        .sort((a, b) => pct(b.wins, b.losses) - pct(a.wins, a.losses) || b.wins - a.wins);
      const rows = teams.map((t, i) => {
        if (term && !(`${t.name} ${t.abbr}`.toLowerCase().includes(term))) return "";
        const open = panels.some(ps => ps.team === t.abbr);
        return `<div class="team-row ${open ? "active" : ""}" data-team="${t.abbr}">
          <span class="rank">${i + 1}</span>${logo(t.abbr) || "<span></span>"}<span>${esc(t.nickname)}</span><span class="rec">${t.wins}-${t.losses}</span>` +
          (open ? `<span></span>` : `<button class="add" data-add="${t.abbr}" title="Add ${esc(t.nickname)} alongside the open teams">+</button>`) + `</div>`;
      }).join("");
      return `<div class="conf"><h3>${conf}</h3>${rows}</div>`;
    }).join("");
    $("standings").innerHTML = html;
  }

  function renderFilters(team) {
    const seg = (key, opts) => `<div class="seg" data-key="${key}">` +
      opts.map(([v, label]) => `<button data-val="${v}" class="${state[key] === v ? "on" : ""}">${label}</button>`).join("") + "</div>";
    const opps = [...new Set(team.games.map(g => g.opp))]
      .map(id => [String(id), oppAbbr(id)]).sort((a, b) => a[1].localeCompare(b[1]));
    $el("filters").innerHTML =
      seg("last", [["all", "Season"], ["10", "Last 10"], ["5", "Last 5"]]) +
      seg("loc", [["all", "All"], ["home", "Home"], ["away", "Away"]]) +
      seg("res", [["all", "All"], ["win", "Wins"], ["loss", "Losses"]]) +
      `<select data-el="oppSelect"><option value="all">All opponents</option>` +
      opps.map(([id, a]) => `<option value="${id}" ${state.opp === id ? "selected" : ""}>vs ${a}</option>`).join("") +
      `</select>`;
  }

  function renderHeader(team, games) {
    const last10 = team.games.slice(-10);
    const w10 = last10.filter(g => g.result === "win").length;
    const avg = k => games.length ? (sum(games.map(g => g[k])) / games.length).toFixed(1) : "–";
    const streak = (() => {
      const g = team.games; if (!g.length) return "";
      const r = g[g.length - 1].result; let n = 0;
      for (let i = g.length - 1; i >= 0 && g[i].result === r; i--) n++;
      return `${r === "win" ? "W" : "L"}${n}`;
    })();
    $el("teamName").innerHTML = `${logo(team.abbr, "big")}${esc(team.name)}`;
    $el("teamSummary").innerHTML =
      `${team.wins}-${team.losses} · ${team.conference} · Last 10: ${w10}-${last10.length - w10} · Streak ${streak}` +
      ` · Filtered: ${games.length} games, ${avg("pts")} PPG, ${avg("oppPts")} allowed`;
  }

  function renderHeatmap(team, games) {
    $el("heatCaption").textContent = games.length
      ? `Numbers = % of each player's games played (out of ${games.length} selected) where they were on court that minute`
      : "";
    if (!games.length) { $el("heatmap").innerHTML = '<div class="empty muted">No games match these filters.</div>'; return; }

    const players = playerStats(games);
    const recent = team.games.slice(-5);
    let html = quarterHeader("season",
      `<div class="name">Player</div><div class="num" title="Games played">GP</div><div class="num" title="Games started (on court at tip-off)">GS</div>` +
      `<div class="num" title="Minutes per game in selected games">MPG</div><div class="num" title="Last 5 games MPG minus full-season MPG">Trend</div>`, 5);

    for (const [label, members] of rotationGroups(team, players)) {
      if (!members.length) continue;
      html += `<div class="rot-row group">${label}</div>`;
      for (const p of members) html += playerRow(p);
    }

    function playerRow(p) {
      const season = mpgOver(team.games, p.pid);
      const last5 = mpgOver(recent, p.pid);
      let trend = "";
      if (season !== null) {
        const d = (last5 ?? 0) - season;
        if (Math.abs(d) >= 0.5) trend = `<span class="${d > 0 ? "trend-up" : "trend-down"}">${d > 0 ? "▲" : "▼"}${Math.abs(d).toFixed(1)}</span>`;
        if (last5 === null) trend = `<span class="trend-down" title="Has not played in the last 5 games">DNP</span>`;
      }
      return `<div class="rot-row season">
        <div class="name" title="${esc(p.name)}">${playerLabel(team, p.pid, p.name)}</div>
        <div class="num">${p.gp}</div><div class="num">${p.gs}</div>
        <div class="num">${p.mpg.toFixed(1)}</div><div class="num">${trend}</div>
        ${strip(p.share, heatColor, (v, i) => `${p.name}\n${clockLabel(i)}\nOn court in ${Math.round(v * 100)}% of the ${p.gp} game${p.gp === 1 ? "" : "s"} played`, pctLabel)}
      </div>`;
    }

    const pm = new Array(MINUTES).fill(0);
    for (const g of games) g.pm.slice(0, MINUTES).forEach((v, i) => { pm[i] += v; });
    const avgPm = pm.map(v => v / games.length);
    const cap = Math.max(1, ...avgPm.map(Math.abs));
    html += `<div class="rot-row season divider">
      <div class="name"><strong>Team +/-</strong></div><div></div><div></div>
      <div class="num">${(sum(avgPm) >= 0 ? "+" : "") + sum(avgPm).toFixed(1)}</div><div></div>
      ${strip(avgPm, v => pmColor(v, cap), (v, i) => `${clockLabel(i)}\nAverage point differential: ${v >= 0 ? "+" : ""}${v.toFixed(2)}`, pmLabel)}
    </div>`;
    $el("heatmap").innerHTML = html;
  }

  // ---------- trends (full season, game by game; ignores filters) ----------
  const gameMins = (g, pid) => (g.players[pid] ? sum(g.players[pid].h) : 0);
  const startersOf = g => Object.entries(g.players).filter(([, p]) => p.h[0] >= 0.5).map(([pid]) => pid).sort();
  const gameTag = g => `${fmtDate(g.date)} ${g.loc === "home" ? "vs" : "@"} ${oppAbbr(g.opp)}`;
  const avgOf = (a, f) => (a.length ? sum(a.map(f)) / a.length : 0);
  const depthOf = g => Object.values(g.players).filter(p => sum(p.h) >= 10).length;
  const starterShareOf = g => {
    const all = sum(Object.values(g.players).map(p => sum(p.h)));
    return all ? sum(startersOf(g).map(pid => gameMins(g, pid))) / all : 0;
  };
  // Average Q4 minutes over the games in which the player appeared
  const q4Mins = (games, pid) => {
    const pl = games.filter(g => gameMins(g, pid) > 0);
    return pl.length ? avgOf(pl, g => sum(g.players[pid].h.slice(36, 48))) : null;
  };

  // Least-squares slope of minutes against team game number, over games actually played
  function slope(points) {
    if (points.length < 4) return null;
    const n = points.length, mx = sum(points.map(p => p[0])) / n, my = sum(points.map(p => p[1])) / n;
    const den = sum(points.map(([x]) => (x - mx) ** 2));
    return den ? sum(points.map(([x, y]) => (x - mx) * (y - my))) / den : null;
  }
  const minutesSlope = (G, pid) => slope(G.map((g, i) => [i, gameMins(g, pid)]).filter(([, m]) => m > 0));

  // One bar per game. value(g) returns a number, or null for a baseline dot (e.g. DNP)
  function sparkBars(games, value, { max, style, tip, height = 40, mid = false }) {
    // Bars widen when there are few games and narrow toward 82, keeping charts ~360px wide
    const step = Math.max(4, Math.min(16, Math.floor(360 / Math.max(1, games.length)))), bw = Math.max(3, Math.round(step * 0.7));
    const w = Math.max(games.length * step, 60);
    const bars = games.map(g => {
      const v = value(g);
      const i = games.indexOf(g);
      if (v === null) {
        return `<rect x="${i * step}" y="${mid ? height / 2 - 0.75 : height - 1.5}" width="${bw}" height="1.5" style="fill: var(--muted)"><title>${esc(tip(g, null))}</title></rect>`;
      }
      const h = Math.max(1.5, (Math.abs(v) / max) * (mid ? height / 2 : height));
      const y = mid ? (v >= 0 ? height / 2 - h : height / 2) : height - h;
      return `<rect x="${i * step}" y="${y.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="1" style="${style(g, v)}"><title>${esc(tip(g, v))}</title></rect>`;
    }).join("");
    const axis = mid ? `<line x1="0" x2="${w}" y1="${height / 2}" y2="${height / 2}" style="stroke: var(--line)"/>` : "";
    return `<svg class="spark" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}">${axis}${bars}</svg>`;
  }

  // Trends as quick-read rows: lineup stability, minutes over the season, Q4 roles, rotation shape
  function trendInsights(team, groups) {
    const G = team.games, recent = G.slice(-5), rows = [];
    if (G.length < 3) return [["Trends", "Not enough games yet."]];
    const nameOf = pid => { for (const g of G) if (g.players[pid]) return g.players[pid].name; return pid; };
    const sn = n => esc(n.replace(/^(\S)\S*\s+/, "$1. "));

    // Starting lineup continuity, and the most recent change
    const lineups = G.map(startersOf).map(l => l.join(","));
    let streak = 1;
    while (streak < G.length && lineups[G.length - 1 - streak] === lineups[G.length - 1]) streak++;
    const cur = G.slice(-streak), w = cur.filter(g => g.result === "win").length;
    let lineup = `Same five for ${streak} game${streak === 1 ? "" : "s"} (${w}-${cur.length - w}) · ${new Set(lineups).size} lineups this season`;
    if (streak < G.length) {
      const i = G.length - streak, before = new Set(lineups[i - 1].split(",")), now = new Set(lineups[i].split(","));
      const ins = [...now].filter(x => !before.has(x)).map(x => sn(nameOf(x)));
      const outs = [...before].filter(x => !now.has(x)).map(x => sn(nameOf(x)));
      lineup += ` · last change ${fmtDate(G[i].date)}: <span class="trend-up">+${ins.join(", +")}</span> <span class="trend-down">−${outs.join(", −")}</span>`;
    }
    rows.push(["Lineup", lineup]);

    // Season-long minute trends for players still in the rotation
    const active = groups.slice(0, 2).flatMap(([, m]) => m);
    const sl = active.map(x => [x, minutesSlope(G, x.pid)]).filter(([, v]) => v !== null);
    const up = sl.filter(([, v]) => v >= 0.5).sort((x, y) => y[1] - x[1]).slice(0, 3);
    const down = sl.filter(([, v]) => v <= -0.5).sort((x, y) => x[1] - y[1]).slice(0, 3);
    if (up.length || down.length) rows.push(["Minutes", [
      up.length ? `<span class="trend-up">▲</span> ${up.map(([x]) => sn(x.name)).join(", ")}` : "",
      down.length ? `<span class="trend-down">▼</span> ${down.map(([x]) => sn(x.name)).join(", ")}` : ""].filter(Boolean).join(" · ") +
      ` <span class="muted">over the season</span>`]);

    const q4d = active.map(x => [x, q4Mins(recent, x.pid), q4Mins(G, x.pid)])
      .filter(([, r, v]) => r !== null && v !== null).map(([x, r, v]) => [x, r - v]);
    const more = q4d.filter(([, d]) => d >= 1.5).sort((x, y) => y[1] - x[1]).slice(0, 2);
    const less = q4d.filter(([, d]) => d <= -1.5).sort((x, y) => x[1] - y[1]).slice(0, 2);
    if (more.length || less.length) rows.push(["Q4 role", [
      more.length ? `<span class="trend-up">more</span> ${more.map(([x, d]) => `${sn(x.name)} +${d.toFixed(1)}`).join(", ")}` : "",
      less.length ? `<span class="trend-down">less</span> ${less.map(([x, d]) => `${sn(x.name)} ${d.toFixed(1)}`).join(", ")}` : ""].filter(Boolean).join(" · ") +
      ` <span class="muted">min (last 5 vs season)</span>`]);

    const [dS, dR] = [avgOf(G, depthOf), avgOf(recent, depthOf)];
    const [sS, sR] = [avgOf(G, starterShareOf), avgOf(recent, starterShareOf)];
    const arrow = (r, v, tol) => (r > v + tol ? " ▲" : r < v - tol ? " ▼" : "");
    rows.push(["Shape", `${dR.toFixed(0)} players with 10+ min${arrow(dR, dS, 0.4)} · starters play ${Math.round(sR * 100)}% of minutes${arrow(sR, sS, 0.02)}` +
      ` <span class="muted">(last 5; ▲▼ vs season)</span>`]);
    return rows;
  }

  // Trends section: written notes only (the per-game mini-charts and player table were removed)
  function renderTrends(team) {
    const groups = rotationGroups(team, playerStats(team.games));
    $el("trendInsights").innerHTML = trendInsights(team, groups)
      .map(([k, v]) => `<div class="glance-row"><span class="glance-k">${k}</span><span>${v}</span></div>`).join("");
  }

  // ---------- pulling starters (full season) ----------
  // Running margin is rebuilt from per-minute +/-, which is usually within ~2 pts of the real score
  const PULL_FROM = 30;   // look from Q3 min 7 onward
  const BLOWOUT = 10;     // only call it a pull if the margin is at least this big
  const leftLabel = m => `${48 - m}:00 left`;
  const signed0 = v => (v > 0 ? "+" : "") + v;

  function pullInfo(g) {
    const st = Object.values(g.players).filter(p => p.h[0] >= 0.5);
    if (st.length < 4) return null;
    const on = i => st.filter(p => p.h[i] >= 0.5).length;
    const cum = [0];
    g.pm.slice(0, MINUTES).forEach(v => cum.push(cum[cum.length - 1] + v));
    // Pull = first minute after which at most one starter is on court for the rest of regulation
    for (let m = PULL_FROM; m < MINUTES; m++) {
      let rest = true;
      for (let i = m; i < MINUTES && rest; i++) rest = on(i) <= 1;
      if (rest) return Math.abs(cum[m]) >= BLOWOUT ? { g, pulled: true, m, margin: cum[m] } : null;
    }
    // Not pulled: biggest margin seen in Q4 with 3+ starters still on court
    let best = null;
    for (let i = 36; i < MINUTES; i++) {
      if (on(i) >= 3 && Math.abs(cum[i + 1]) >= BLOWOUT && (!best || Math.abs(cum[i + 1]) >= Math.abs(best.margin))) {
        best = { g, pulled: false, m: i + 1, margin: cum[i + 1] };
      }
    }
    return best;
  }

  let leaguePulls = null;
  const allPulls = () => leaguePulls || (leaguePulls = S.teams.flatMap(t => t.games.map(pullInfo).filter(x => x && x.pulled)));

  // Every Q4 minute with a 10+ margin, marked "out" once starters are done for the night
  // (at most one on court for the rest of regulation) or "in" while 3+ are still on court
  function pullSituations(g) {
    const st = Object.values(g.players).filter(p => p.h[0] >= 0.5);
    if (st.length < 4) return [];
    const on = st.length ? g.pm.slice(0, MINUTES).map((_, i) => st.filter(p => p.h[i] >= 0.5).length) : [];
    const done = new Array(MINUTES).fill(false);
    for (let i = MINUTES - 1, ok = true; i >= 0; i--) { ok = ok && on[i] <= 1; done[i] = ok; }
    let margin = sum(g.pm.slice(0, 36));
    const out = [];
    for (let i = 36; i < MINUTES; i++) {
      const abs = Math.abs(margin);   // margin entering this minute
      margin += g.pm[i] || 0;
      if (abs < BLOWOUT) continue;
      if (done[i]) out.push({ left: 48 - i, abs, out: true });
      else if (on[i] >= 3) out.push({ left: 48 - i, abs, out: false });
    }
    return out;
  }
  let leagueSit = null;
  const allSituations = () => leagueSit || (leagueSit = S.teams.flatMap(t => t.games.flatMap(pullSituations)));

  const PULL_WINDOWS = [["9–12 min left", 9, 12], ["5–8 min left", 5, 8], ["Final 4 min", 1, 4]];
  const MARGIN_BUCKETS = [[10, 14], [15, 19], [20, 24], [25, 29], [30, 99]];
  const bucketLabel = ([lo, hi]) => (hi >= 99 ? `${lo}+` : `${lo}–${hi}`);

  // Share of situations with starters already out, for one time window and margin bucket
  function outRate(sits, [, lo, hi], [mlo, mhi]) {
    const xs = sits.filter(x => x.left >= lo && x.left <= hi && x.abs >= mlo && x.abs <= mhi);
    return { n: xs.length, rate: xs.length ? xs.filter(x => x.out).length / xs.length : null };
  }
  // Smallest margin bucket where starters are out at least half the time (needs a few observations)
  function threshold(sits, win, minN) {
    for (const b of MARGIN_BUCKETS) {
      const r = outRate(sits, win, b);
      if (r.n >= minN && r.rate >= 0.5) return `${b[0]}+`;
    }
    return null;
  }

  // Simplified: one rule-of-thumb line, one summary line, and the last few blowouts
  function renderPulls(team) {
    const G = team.games;
    const events = G.map(pullInfo).filter(Boolean);
    const pulls = events.filter(e => e.pulled);
    const league = allPulls();

    const rule = PULL_WINDOWS.map(w => [w[0], threshold(G.flatMap(pullSituations), w, 2), threshold(allSituations(), w, 10)]);
    const seen = rule.filter(([, t]) => t);
    const leagueRule = rule.filter(([, , l]) => l).map(([w, , l]) => `${l} with ${w.toLowerCase()}`).join(" · ");
    const headline = seen.length
      ? `Usually pulls starters at ` + seen.map(([w, t]) => `<b>${t} pts</b> with ${w.toLowerCase()}`).join(" · ")
      : `Not enough blowouts yet to tell when they pull starters`;

    let summary = `Pulled starters in <b>${pulls.length} of ${G.length}</b> games`;
    if (pulls.length) {
      const mm = median(pulls.map(e => Math.abs(e.margin))), ml = median(pulls.map(e => 48 - e.m));
      summary += ` · typically at about ${mm} pts with ${ml}:00 left`;
      if (league.length) {
        const ll = median(league.map(e => 48 - e.m));
        summary += ml > ll + 1 ? " · <b>earlier</b> than most teams" : ml < ll - 1 ? " · <b>later</b> than most teams" : " · in line with the league";
      }
    }

    const recent = [...events].sort((x, y) => y.g.num - x.g.num).slice(0, 5).map(e =>
      `<div class="pull-row"><span class="muted">${fmtDate(e.g.date)}</span> ${e.g.loc === "home" ? "vs" : "@"} ${oppAbbr(e.g.opp)} ` +
      `<span class="${e.g.result === "win" ? "res-w" : "res-l"}">${e.g.result === "win" ? "W" : "L"} ${e.g.pts}-${e.g.oppPts}</span> · ` +
      (e.pulled ? `pulled with ${leftLabel(e.m)} at ${signed0(e.margin)}` : `<span class="muted">kept in at ${signed0(e.margin)}</span>`) + `</div>`).join("");

    $el("pullBody").innerHTML =
      `<div class="pull-headline">${headline}</div>` +
      (leagueRule ? `<div class="muted pull-league">League: ${leagueRule}</div>` : "") +
      `<div class="pull-summary">${summary}</div>` +
      (recent ? `<div class="pull-recent"><div class="pull-label">Recent blowouts (${BLOWOUT}+ pts in Q4)</div>${recent}</div>` : "") +
      `<div class="muted pull-note">Margins rebuilt from minute-by-minute +/- (usually within ~2 pts).</div>`;
  }

  function renderLegend() {
    const heat = [0.1, 0.3, 0.5, 0.7, 0.9, 1].map(v => `<span style="${heatColor(v)}"></span>`).join("");
    const pm = [-1, -0.6, -0.2, 0.2, 0.6, 1].map(v => `<span style="${pmColor(v, 1)}"></span>`).join("");
    $el("legend").innerHTML =
      `<span>On court: rarely<span class="scale">${heat}</span>always</span>` +
      `<span>Team +/-: losing<span class="scale">${pm}</span>winning the minute</span>`;
  }

  function renderGameLog(team, games) {
    const inFilter = new Set(games.map(g => g.id));
    const rows = [...team.games].reverse().map(g => {
      const diff = g.pts - g.oppPts;
      return `<tr class="g ${state.game === g.id ? "active" : ""} ${inFilter.has(g.id) ? "" : "filtered-out"}" data-game="${g.id}">
        <td>${g.num}</td><td>${fmtDate(g.date)}</td>
        <td class="opp">${g.loc === "home" ? "vs" : "@"} ${oppLogo(g.opp)}${oppAbbr(g.opp)}</td>
        <td class="${g.result === "win" ? "res-w" : "res-l"}">${g.result === "win" ? "W" : "L"}</td>
        <td>${g.pts}-${g.oppPts}</td><td>${diff > 0 ? "+" : ""}${diff}</td>
        <td>${(r => (r.b2b ? '<span class="b2b">B2B</span>' : r.restDays === null ? '<span class="muted">—</span>' : `${r.restDays}d`))(restInfo(state.team, g.date))}</td>
        <td>${Object.values(g.players).filter(p => p.h[0] >= 0.5).map(p => esc(p.name.replace(/^(\S)\S*\s+/, "$1. "))).join(", ")}</td>
      </tr>`;
    }).join("");
    $el("gamelog").innerHTML = `<thead><tr><th>#</th><th>Date</th><th>Opponent</th><th></th><th>Score</th><th>+/-</th><th title="Days off before this game; B2B = 2nd night of a back-to-back">Rest</th><th>Starters</th></tr></thead><tbody>${rows}</tbody>`;
  }

  function renderGame(team) {
    const g = team.games.find(x => x.id === state.game);
    $el("gameCard").hidden = !g;
    if (!g) return;
    $el("gameTitle").innerHTML =
      `${fmtDate(g.date)} · ${g.loc === "home" ? "vs" : "@"} ${oppLogo(g.opp)}${oppAbbr(g.opp)} · ` +
      `<span class="${g.result === "win" ? "res-w" : "res-l"}">${g.result === "win" ? "W" : "L"} ${g.pts}-${g.oppPts}</span>`;
    const players = Object.entries(g.players)
      .map(([pid, p]) => ({ pid, name: p.name, h: p.h, mins: sum(p.h) }))
      .filter(p => p.mins > 0).sort((a, b) => b.mins - a.mins);
    let html = quarterHeader("game", `<div class="name">Player</div><div class="num">MIN</div>`, 2);
    for (const p of players) {
      html += `<div class="rot-row game"><div class="name">${playerLabel(team, p.pid, p.name)}</div><div class="num">${p.mins.toFixed(1)}</div>
        ${strip(p.h, heatColor, (v, i) => `${p.name}\n${clockLabel(i)}\nOn court ${Math.round(v * 60)} of 60 seconds`)}</div>`;
    }
    const cap = Math.max(2, ...g.pm.map(Math.abs));
    html += `<div class="rot-row game divider"><div class="name"><strong>Team +/-</strong></div>
      <div class="num">${g.pts - g.oppPts > 0 ? "+" : ""}${g.pts - g.oppPts}</div>
      ${strip(g.pm, v => pmColor(v, cap), (v, i) => `${clockLabel(i)}\nPoint differential: ${v > 0 ? "+" : ""}${v}`, pmLabel)}</div>`;
    if (g.pm.length > MINUTES) html += `<div class="ot-note muted">This game went to overtime; minutes beyond regulation are counted in MIN but not drawn.</div>`;
    $el("gameChart").innerHTML = html;
  }

  // ---------- games by day ----------
  // Played games come from the rotation data (so they link to that game's rotation);
  // today and upcoming games come from the ESPN schedule saved by the scraper.
  const SCHEDULE = (() => {
    const byDay = {}, seen = new Set();
    for (const t of S.teams) for (const g of t.games) {
      const opp = byId[g.opp];
      if (seen.has(g.id) || !opp) continue;
      seen.add(g.id);
      const home = g.loc === "home";
      (byDay[g.date] = byDay[g.date] || []).push({
        date: g.date, gid: g.id, status: "final", hasRotation: true,
        away: home ? opp.abbr : t.abbr, home: home ? t.abbr : opp.abbr,
        awayPts: home ? g.oppPts : g.pts, homePts: home ? g.pts : g.oppPts,
      });
    }
    for (const s of S.schedule || []) {
      const list = byDay[s.date] = byDay[s.date] || [];
      if (!list.some(x => x.away === s.away && x.home === s.home)) list.push({ ...s, gid: null, hasRotation: false });
    }
    for (const list of Object.values(byDay)) list.sort((a, b) => (a.tip || "").localeCompare(b.tip || "") || a.home.localeCompare(b.home));
    return byDay;
  })();
  const DAYS = Object.keys(SCHEDULE).sort();
  const localToday = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  let selectedDay = DAYS.includes(localToday) ? localToday : (DAYS.find(d => d > localToday) || DAYS[DAYS.length - 1]);
  const dayLabel = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  // ---------- rest days / back-to-backs (from the combined schedule: played + upcoming) ----------
  const shiftDate = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const gameOn = (abbr, date) => (SCHEDULE[date] || []).find(g => g.away === abbr || g.home === abbr) || null;
  const vsLabel = (abbr, g) => (g.away === abbr ? `@ ${g.home}` : `vs ${g.away}`);
  function restInfo(abbr, date) {
    let restDays = null;
    for (let k = 1; k <= 10 && restDays === null; k++) if (gameOn(abbr, shiftDate(date, -k))) restDays = k - 1;
    const prev = gameOn(abbr, shiftDate(date, -1));
    return { b2b: !!prev, prev, restDays, front: !!gameOn(abbr, shiftDate(date, 1)) };
  }
  function b2bBadge(abbr, date) {
    const r = restInfo(abbr, date);
    return r.b2b ? ` <span class="b2b" title="2nd night of a back-to-back (played ${esc(vsLabel(abbr, r.prev))} the day before)">B2B</span>` : "";
  }

  // How this team has handled the 2nd night of back-to-backs so far: record, who sat, whose minutes fell
  function b2bHistory(team, stats) {
    const second = team.games.filter(g => restInfo(team.abbr, g.date).b2b);
    if (!second.length) return `<b>Back-to-back history:</b> no 2nd nights yet this season.`;
    const byDate = Object.fromEntries(team.games.map(g => [g.date, g]));
    const w = second.filter(g => g.result === "win").length;
    const core = Object.values(stats).filter(p => p.gp >= 3).sort((a, b) => b.mpg - a.mpg).slice(0, 8);
    const sat = [], dropped = [];
    for (const p of core) {
      // Count only nights where the player played the night before, so injuries don't read as rest
      const chances = second.filter(g => { const prev = byDate[shiftDate(g.date, -1)]; return prev && gameMins(prev, p.pid) > 0; });
      if (!chances.length) continue;
      const missed = chances.filter(g => gameMins(g, p.pid) === 0).length;
      if (missed) sat.push(`${esc(p.name)} (${missed} of ${chances.length})`);
      const on = chances.filter(g => gameMins(g, p.pid) > 0);
      const other = team.games.filter(g => !second.includes(g) && gameMins(g, p.pid) > 0);
      if (on.length && other.length) {
        const d = avgOf(on, g => gameMins(g, p.pid)) - avgOf(other, g => gameMins(g, p.pid));
        if (d <= -3) dropped.push(`${esc(p.name)} ${d.toFixed(1)}`);
      }
    }
    return `<b>Back-to-back history (2nd nights):</b> ${w}-${second.length - w} in ${second.length} game${second.length === 1 ? "" : "s"}` +
      (sat.length ? ` · sat: ${sat.join(", ")}` : " · no rotation players sat") +
      (dropped.length ? ` · fewer minutes: ${dropped.join(", ")} MPG vs other games` : "") + `.`;
  }

  function tileLineups(g) {
    if (g.status === "final" || g.date !== todayStr()) return "";
    const lu = matchupLineups(g.away, g.home);
    if (!lu) return `<div class="gt-lu">${luPill("")}</div>`;
    if (lu.away === "Confirmed" && lu.home === "Confirmed") return `<div class="gt-lu"><span class="lu lu-ok">✓ Lineups confirmed</span></div>`;
    return `<div class="gt-lu">${g.away} ${luPill(lu.away)} ${g.home} ${luPill(lu.home)}</div>`;
  }

  // ---------- league-wide "ruled out" board ----------
  const OUT_SINCE = S.outSince || {};
  const NBA_REPORT = S.nbaInjury || {};
  let boardOpen = false;
  const localDateOf = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const nameKey = n => n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/-/g, " ").replace(/[^a-z ]/g, "")
    .split(" ").filter(w => w && !["jr", "sr", "ii", "iii", "iv"].includes(w)).join(" ");
  const outSince = (abbr, i) => (OUT_SINCE[abbr] || {})[nameKey(i.name)] || null;
  const newlyOutToday = (abbr, i) => { const t = outSince(abbr, i); return !!t && localDateOf(t) === todayStr(); };

  function boardTeam(abbr) {
    const team = byAbbr[abbr];
    const items = (INJ[abbr] || []).filter(i => injShort(i) !== "AVAIL");
    const injured = items.filter(i => !isGLeague(i));
    const groups = [
      ["Out", injured.filter(isOut)],
      ["Doubtful", injured.filter(i => injShort(i) === "DOUBT")],
      ["Questionable / GTD", injured.filter(i => ["QUES", "GTD"].includes(injShort(i)))],
      ["Probable", injured.filter(i => injShort(i) === "PROB")],
    ];
    const gl = items.filter(isGLeague);
    const row = i => {
      const fresh = newlyOutToday(abbr, i);
      const since = outSince(abbr, i);
      return `<div class="ob-row ${fresh ? "ob-new" : ""}">${injBadge(i)} ${i.pid ? playerLabel(team, i.pid, i.name).replace(/ <span class="(inj|ret|lim)[^>]*>[^<]*<\/span>/g, "") : esc(i.name)}` +
        `<span class="muted"> · ${esc(i.nbaReason || i.type || i.status)}</span>` +
        (fresh ? ` <span class="ob-time">ruled out ${fmtTime(since)}</span>` : "") + `</div>`;
    };
    const body = groups.filter(([, list]) => list.length).map(([label, list]) =>
      `<div class="ob-group"><div class="ob-label">${label}</div>${list.map(row).join("")}</div>`).join("");
    return `<div class="ob-team"><button class="link ob-name" data-open-team="${abbr}">${logo(abbr)}${esc(team.nickname)}</button>` +
      (NBA_REPORT.notSubmitted && NBA_REPORT.notSubmitted.includes(abbr) ? ` <span class="muted">· NBA report not submitted yet</span>` : "") +
      (body || `<div class="muted ob-none">No one listed</div>`) +
      (gl.length ? `<div class="muted ob-gl">G League / two-way: ${gl.map(i => esc(i.name)).join(", ")}</div>` : "") + `</div>`;
  }

  function renderOutBoard() {
    const freshCount = Object.entries(INJ).reduce((n, [abbr, items]) => n + items.filter(i => isOut(i) && !isGLeague(i) && newlyOutToday(abbr, i)).length, 0);
    $("boardToggle").innerHTML = `Ruled out${freshCount ? ` <span class="ob-count">${freshCount} new today</span>` : ""} ${boardOpen ? "▴" : "▾"}`;
    $("boardToggle").classList.toggle("on", boardOpen);
    const board = $("outBoard");
    board.hidden = !boardOpen;
    if (!boardOpen) return;
    const today = (SCHEDULE[todayStr()] || []).filter(g => g.status !== "final" || true);
    const playing = new Set(today.flatMap(g => [g.away, g.home]));
    const games = today.map(g => `<div class="ob-game"><div class="ob-head">${logo(g.away)}${g.away} @ ${logo(g.home)}${g.home} <span class="muted">· ` +
      `${g.status === "final" ? "Final" : g.status === "live" ? esc(g.detail) : new Date(g.tip).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>` +
      `${tileLineups(g)}</div><div class="ob-sides">${boardTeam(g.away)}${boardTeam(g.home)}</div></div>`).join("");
    const others = S.teams.map(t => t.abbr).filter(a => !playing.has(a)).sort();
    board.innerHTML =
      `<div class="drawer-head"><h2>Ruled out · every team</h2><button class="link" data-board-close>✕ Close</button></div>` +
      `<div class="ob-meta muted">NBA official injury report: ${NBA_REPORT.time ? `<b>${esc(NBA_REPORT.time)}</b> (${esc(NBA_REPORT.date)})` : "not posted yet today"}` +
      ` · checked ${S.checkedAt ? fmtTime(S.checkedAt) : "—"}, re-checked every 15 min (every 2 min near tip-off); <span class="ob-new-key">highlighted</span> = ruled out today</div>` +
      (games ? `<h3>Playing today</h3><div class="ob-games">${games}</div>` : "") +
      `<h3>Not playing today <span class="muted ob-sub">· NBA statuses here are for each team's next game once its report is filed; otherwise ESPN</span></h3><div class="ob-others">${others.map(boardTeam).join("")}</div>`;
  }

  function renderGamesBar() {
    if (!DAYS.length) { $("gamesBar").hidden = true; return; }
    const i = DAYS.indexOf(selectedDay);
    const from = Math.max(0, Math.min(i - 3, DAYS.length - 7));
    const chips = DAYS.slice(from, from + 7).map(d =>
      `<button class="day-chip ${d === selectedDay ? "on" : ""}" data-day="${d}">${d === localToday ? "Today" : dayLabel(d)}` +
      `<span class="muted">${SCHEDULE[d].length}</span></button>`).join("");
    $("dayNav").innerHTML =
      `<button class="day-step" data-shift="-1" ${i <= 0 ? "disabled" : ""} title="Previous day">◀</button>${chips}` +
      `<button class="day-step" data-shift="1" ${i >= DAYS.length - 1 ? "disabled" : ""} title="Next day">▶</button>`;
    // keep the selected day in view in the narrow sidebar row (without scrolling the page)
    const nav = $("dayNav"), on = nav.querySelector(".day-chip.on");
    if (on) nav.scrollLeft = on.offsetLeft - nav.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
    renderOutBoard();

    const openSet = panels.map(ps => ps.team).join(",");
    const rec = a => `${byAbbr[a].wins}-${byAbbr[a].losses}`;
    $("dayGames").innerHTML = SCHEDULE[selectedDay].map(g => {
      const played = g.awayPts !== null && g.awayPts !== undefined;
      const win = side => played && g.status === "final" && (side === "away" ? g.awayPts > g.homePts : g.homePts > g.awayPts);
      const line = (abbr, pts, side) => `<div class="gt-row ${win(side) ? "win" : ""}">${logo(abbr)}<span class="gt-abbr">${abbr}</span>` +
        `<span class="muted gt-rec">${rec(abbr)}${b2bBadge(abbr, g.date)}</span><span class="gt-pts">${played ? pts : ""}</span></div>`;
      const status = g.status === "final" ? (g.hasRotation ? "Final · rotation ready" : "Final · rotation not loaded yet")
        : g.status === "live" ? `<span class="live">● ${esc(g.detail)}</span>`
        : new Date(g.tip).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `<button class="game-tile ${openSet === `${g.away},${g.home}` ? "on" : ""}" data-away="${g.away}" data-home="${g.home}" data-gid="${g.gid || ""}" data-date="${g.date}"
        title="Open ${byAbbr[g.away].nickname} and ${byAbbr[g.home].nickname} side by side">` +
        line(g.away, g.awayPts, "away") + line(g.home, g.homePts, "home") + `<div class="gt-status muted">${status}</div>` +
        tileLineups(g) + `</button>`;
    }).join("");
  }

  $("outBoard").addEventListener("click", e => {
    if (e.target.closest("[data-board-close]")) { boardOpen = false; renderOutBoard(); return; }
    const openTeam = e.target.closest("[data-open-team]");
    if (openTeam) {
      boardOpen = false;
      renderOutBoard();
      location.hash = `#/${openTeam.dataset.openTeam}`;
    }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && boardOpen) { boardOpen = false; renderOutBoard(); } });

  $("gamesBar").addEventListener("click", e => {
    if (e.target.closest("#boardToggle")) { boardOpen = !boardOpen; renderOutBoard(); return; }
    const openTeam = e.target.closest("[data-open-team]");
    if (openTeam) { location.hash = `#/${openTeam.dataset.openTeam}`; setTimeout(() => $("tabs").scrollIntoView({ behavior: "smooth", block: "start" }), 50); return; }
    const day = e.target.closest("[data-day]");
    const step = e.target.closest("[data-shift]");
    if (day) { selectedDay = day.dataset.day; renderGamesBar(); return; }
    if (step) {
      const i = DAYS.indexOf(selectedDay) + Number(step.dataset.shift);
      if (i >= 0 && i < DAYS.length) { selectedDay = DAYS[i]; renderGamesBar(); }
      return;
    }
    const tile = e.target.closest(".game-tile");
    if (!tile) return;
    const { away, home, gid, date } = tile.dataset;
    focusDay = date;
    location.hash = "#/" + [away, home].map(a => a + (gid ? ":" + gid : "")).join(",") + ";compare";
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  });

  // ---------- returns from long absences & minutes restrictions ----------
  const PREV = S.prevSeason || {};           // last season per player: lastDate, missedAfter, mpg
  const RESTRICT = S.restrictions || {};     // minutes-restriction mentions in ESPN team news
  const RESTRICT_RE = /minutes?[\s-]+(restriction|limit|cap)|restricted minutes|limited minutes|minutes (will be )?(monitored|managed)|pitch count|ramp(ing)?[\s-]+up|on a (minutes|playing[\s-]time) (limit|restriction)/i;
  const LONG_ABSENCE = 15;    // straight team games missed (about a month of the schedule)
  const RECENT_RETURN = 6;    // only flag returns within the team's last N games
  const LIMIT_RATIO = 0.75;   // since-return MPG below this share of the usual MPG = likely limited
  const ROTATION_MPG = 15;    // ignore deep-bench players, whose "absences" are usually DNPs
  const returnsCache = {};

  function returnsFor(team) {
    if (returnsCache[team.abbr]) return returnsCache[team.abbr];
    const G = team.games, out = { returned: [], limits: [], upcoming: [], flags: {} };
    const appsOf = pid => G.map((g, i) => (gameMins(g, pid) > 0 ? i : -1)).filter(i => i >= 0);
    const nameOf = pid => { for (const g of G) if (g.players[pid]) return g.players[pid].name; return PREV[pid] ? PREV[pid].name : pid; };

    for (const pid of new Set(G.flatMap(g => Object.keys(g.players)))) {
      const apps = appsOf(pid);
      if (!apps.length) continue;
      let gap = null;
      // Most recent long gap inside this season...
      for (let k = apps.length - 1; k >= 1 && !gap; k--) {
        const missed = apps[k] - apps[k - 1] - 1;
        if (missed >= LONG_ABSENCE) {
          const before = apps.slice(0, k).map(i => gameMins(G[i], pid));
          gap = { missed, at: apps[k], lastBefore: G[apps[k - 1]].date, pre: sum(before) / before.length, preLabel: "before the absence" };
        }
      }
      // ...or one that started last season (games missed at the end of last season + before his debut now)
      const prev = PREV[pid];
      if (!gap && prev && prev.missedAfter + apps[0] >= LONG_ABSENCE) {
        gap = { missed: prev.missedAfter + apps[0], at: apps[0], lastBefore: prev.lastDate, pre: prev.mpg, preLabel: "last season" };
      }
      if (!gap || gap.pre < ROTATION_MPG || G.length - gap.at > RECENT_RETURN) continue;
      const since = apps.filter(i => i >= gap.at).map(i => gameMins(G[i], pid));
      const mpgSince = sum(since) / since.length;
      // Under ~8 MPG is more often a smaller role (garbage time) than a restriction
      const fringe = mpgSince < 8;
      const limited = !fringe && mpgSince < LIMIT_RATIO * gap.pre;
      out.returned.push({ pid, name: nameOf(pid), ...gap, since, mpgSince, limited, fringe, firstBack: G[gap.at].date });
      out.flags[pid] = limited ? "LIMIT" : "RET";
    }

    // Reported restrictions: ESPN news and the injury report notes
    for (const h of RESTRICT[team.abbr] || []) {
      out.limits.push({ pid: h.pid, name: h.name, source: "ESPN news", text: h.text, at: h.published });
      if (h.pid) out.flags[h.pid] = "LIMIT";
    }
    for (const i of INJ[team.abbr] || []) {
      if (!RESTRICT_RE.test(i.comment || "")) continue;
      out.limits.push({ pid: i.pid, name: i.name, source: "Injury report", text: i.comment, at: i.updated });
      if (i.pid) out.flags[i.pid] = "LIMIT";
    }

    // Long-absent players who could be back by the next game (they usually return on a limit)
    const next = upcomingGame(team.abbr);
    for (const i of INJ[team.abbr] || []) {
      if (!i.pid) continue;
      const apps = appsOf(i.pid);
      const prev = PREV[i.pid];
      const missed = apps.length ? G.length - 1 - apps[apps.length - 1] : prev ? prev.missedAfter + G.length : 0;
      const pre = apps.length ? sum(apps.map(k => gameMins(G[k], i.pid))) / apps.length : prev ? prev.mpg : 0;
      if (missed < LONG_ABSENCE || pre < ROTATION_MPG) continue;
      const soon = !isOut(i) || (i.returnDate && next && i.returnDate <= shiftDate(next.date, 1));
      if (soon) out.upcoming.push({ pid: i.pid, name: i.name, missed, pre, inj: i, next });
    }
    return (returnsCache[team.abbr] = out);
  }

  function returnBadge(team, pid) {
    const f = returnsFor(team).flags[pid];
    if (!f) return "";
    return f === "LIMIT"
      ? ` <span class="lim" title="On a minutes restriction (reported, or playing well under usual minutes since returning)">LIMIT</span>`
      : ` <span class="ret" title="Recently back from missing ${LONG_ABSENCE}+ straight games">RET</span>`;
  }

  function renderReturns(team) {
    const r = returnsFor(team);
    const parts = [];
    if (r.returned.length) {
      parts.push(`<h3>Back from a long absence <span class="muted">(${LONG_ABSENCE}+ straight games missed, returned in the last ${RECENT_RETURN})</span></h3>` +
        `<table class="analysis"><thead><tr><th>Player</th><th class="n">Missed</th><th>Last played</th><th>Back since</th>` +
        `<th class="n">Usual MPG</th><th class="n">MPG since</th><th>Minutes by game since return</th></tr></thead><tbody>` +
        r.returned.sort((a, b) => b.pre - a.pre).map(x => `<tr><td>${playerLabel(team, x.pid, x.name)}</td>` +
          `<td class="n">${x.missed} games</td><td>${fmtDate(x.lastBefore)}${x.preLabel === "last season" ? ' <span class="muted">(last season)</span>' : ""}</td>` +
          `<td>${fmtDate(x.firstBack)}</td><td class="n">${x.pre.toFixed(1)} <span class="muted">${x.preLabel === "last season" ? "last season" : "before"}</span></td>` +
          `<td class="n ${x.limited ? "trend-down" : ""}">${x.mpgSince.toFixed(1)}</td>` +
          `<td>${x.since.map(m => Math.round(m)).join(" → ")}${x.limited ? ' <span class="lim">LIKELY LIMITED</span>' : x.fringe ? ' <span class="muted">fringe minutes — smaller role or limit</span>' : ""}</td></tr>`).join("") +
        `</tbody></table>`);
    }
    if (r.limits.length) {
      parts.push(`<h3>Reported minutes restrictions</h3>` + r.limits.map(x => `<div class="inj-row"><div><span class="lim">LIMIT</span> ` +
        `${x.pid ? playerLabel(team, x.pid, x.name).replace(/ <span class="lim"[^>]*>LIMIT<\/span>/, "") : esc(x.name)} <span class="muted">· ${esc(x.source)}` +
        `${x.at ? `, ${fmtDate(x.at.slice(0, 10))}` : ""}</span></div><div class="inj-note muted">${esc(x.text)}</div></div>`).join(""));
    }
    if (r.upcoming.length) {
      parts.push(`<h3>Could return soon after a long absence <span class="muted">(expect a minutes limit)</span></h3>` +
        r.upcoming.map(x => `<div class="inj-row"><div>${injBadge(x.inj)} ${playerLabel(team, x.pid, x.name).replace(/ <span class="inj[^>]*>[^<]*<\/span>/, "")}` +
          ` <span class="muted">· has missed ${x.missed} straight games · ${x.pre.toFixed(1)} MPG before` +
          `${x.inj.returnDate ? ` · est. return ${esc(dayLabel(x.inj.returnDate))}` : ""}</span></div>` +
          `${x.inj.comment ? `<div class="inj-note muted">${esc(x.inj.comment)}</div>` : ""}</div>`).join(""));
    }
    $el("returnsBody").innerHTML = parts.length ? parts.join("")
      : `<div class="muted">No rotation players back from a ${LONG_ABSENCE}+ game absence, on a reported minutes limit, or due back soon.</div>`;
  }

  // ---------- next game: starting five + injury report ----------
  let focusDay = null; // set when a game is clicked in the Games bar

  function upcomingGame(abbr) {
    const mine = DAYS.flatMap(d => SCHEDULE[d]).filter(g => (g.away === abbr || g.home === abbr) && g.status !== "final");
    return (focusDay && mine.find(g => g.date === focusDay)) || mine.find(g => g.date >= todayStr()) || null;
  }

  function renderLineup(team) {
    const g = upcomingGame(team.abbr);
    const official = officialLineup(team.abbr);
    const useOfficial = official && g && g.date === todayStr() && official.starters.length === 5;
    const stats = Object.fromEntries(playerStats(team.games).map(p => [p.pid, p]));
    const recent = team.games.slice(-5);
    const startsL5 = pid => recent.filter(x => x.players[pid] && x.players[pid].h[0] >= 0.5).length;
    const mpg = pid => (stats[pid] ? stats[pid].mpg.toFixed(1) : "–");

    if (g) {
      const home = g.home === team.abbr, opp = home ? g.away : g.home;
      const when = g.date === todayStr() ? "Tonight" : dayLabel(g.date);
      const tip = g.status === "live" ? `<span class="live">● ${esc(g.detail)}</span>` : new Date(g.tip).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const r = restInfo(team.abbr, g.date);
      const rest = r.b2b ? ` · <span class="b2b">2nd night of back-to-back</span> <span class="muted rest-note">played ${esc(vsLabel(team.abbr, r.prev))} the day before</span>`
        : `<span class="muted rest-note"> · ${r.restDays === null ? "first game" : `${r.restDays} day${r.restDays === 1 ? "" : "s"} rest`}${r.front ? " · front end of a back-to-back" : ""}</span>`;
      $el("lineupTitle").innerHTML = `${when} ${home ? "vs" : "@"} ${logo(opp)}${opp} · ${tip}${rest}`;
    } else {
      $el("lineupTitle").textContent = "Next game";
    }

    // Starting five: confirmed NBA lineup, else NBA expected / our projection with ruled-out players replaced
    const sf = startingFive(team, g);
    const five = sf.five;
    const swaps = sf.swaps.map(x => `${esc(x.out)} (${esc(x.why)}) → ${esc(x.in)}`);
    const lt = sf.official ? (LTIMES[sf.official.gid] || {})[sf.official.side] || {} : {};
    let source;
    if (sf.status === "confirmed") {
      source = `<span class="lu lu-ok">✓ Confirmed</span> Official starting lineup${lt.confirmedAt ? ` <span class="muted">· confirmed ${fmtTime(lt.confirmedAt)}</span>` : ""}`;
    } else if (sf.status === "expected") {
      source = `${luPill("Expected")} NBA expected lineup${lt.expectedAt ? ` <span class="muted">· posted ${fmtTime(lt.expectedAt)}</span>` : ""}` +
        ` <span class="muted">· switches to ✓ Confirmed when the team announces it</span>`;
    } else if (sf.fromNba) {
      source = `<span class="lu lu-proj">Projected</span> NBA expected lineup, updated for players ruled out since` +
        ` <span class="muted">· switches to ✓ Confirmed when the team announces it</span>`;
    } else {
      source = `<span class="lu lu-proj">Projected</span> ${g && g.date === todayStr() ? "Our projection until the NBA posts a lineup" : "Our projection"}` +
        ` <span class="muted">· last 5 starts, ruled-out starters replaced${g && g.date === todayStr() ? " · checked every 2 min from 45 min before tip" : ""}</span>`;
    }
    $el("lineupMeta").innerHTML = source;
    $el("lineupTable").innerHTML =
      `<thead><tr><th>Pos</th><th>Player</th><th class="n">MPG</th><th class="n">Starts L5</th></tr></thead><tbody>` +
      five.map(p => `<tr class="${p.replacing ? "lu-swap" : ""}"><td class="muted">${esc(p.slot)}</td><td>${playerLabel(team, p.pid, p.name)}` +
        `${p.replacing ? ` <span class="swap-note">replacing ${esc(p.replacing.name)} (${esc(p.replacing.why)})</span>` : ""}</td>` +
        `<td class="n">${mpg(p.pid)}</td><td class="n">${stats[p.pid] ? startsL5(p.pid) + "/5" : '<span class="muted">new</span>'}</td></tr>`).join("") + `</tbody>`;

    // Injury report, most important first
    const inj = [...(INJ[team.abbr] || [])].filter(i => injShort(i) !== "AVAIL" && !isGLeague(i)).sort((a, b) =>
      Number(isOut(b)) - Number(isOut(a)) || (stats[b.pid] ? stats[b.pid].mpg : 0) - (stats[a.pid] ? stats[a.pid].mpg : 0));
    $el("injuryList").innerHTML = inj.length ? inj.map(i => `<div class="inj-row">
        <div>${injBadge(i)} ${i.pid ? playerLabel(team, i.pid, i.name).replace(/ <span class="inj [^>]*>[^<]*<\/span>/, "") : esc(i.name)}
          <span class="muted">· ${esc(i.nbaReason || i.type || i.status)}${i.returnDate ? ` · est. return ${esc(dayLabel(i.returnDate))}` : ""}${i.pid && stats[i.pid] ? ` · ${mpg(i.pid)} MPG` : ""}</span></div>
        ${i.comment ? `<div class="inj-note muted">${esc(i.comment)}</div>` : ""}</div>`).join("")
      : `<div class="muted">No injuries listed.</div>`;

    // What the absences cost, in minutes from players who were actually in the recent rotation
    const missing = inj.filter(i => isOut(i) && i.pid && mpgOver(recent, i.pid) !== null);
    const lostMins = sum(missing.map(i => mpgOver(recent, i.pid)));
    const gtd = inj.filter(i => !isOut(i));
    const notes = [];
    if (missing.length) notes.push(`<b>${lostMins.toFixed(1)} minutes a game</b> to replace from recent-rotation players who are out (${missing.map(i => esc(i.name)).join(", ")}).`);
    if (gtd.length) notes.push(`<b>Game-time decisions:</b> ${gtd.map(i => esc(i.name)).join(", ")}.`);
    if (swaps.length) notes.push(`<b>Projected lineup changes:</b> ${swaps.join("; ")}.`);
    if (g && restInfo(team.abbr, g.date).b2b) notes.push(b2bHistory(team, stats));
    if (useOfficial && official.inactive.length) notes.push(`<b>Inactive tonight (NBA):</b> ${official.inactive.map(p => esc(p.name)).join(", ")}.`);
    // Only updates logged on game day, for that game (nothing carried over from previous games)
    const gameDay = g && g.date === todayStr();
    const localDate = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const mine = gameDay ? CHANGES.filter(c => c.team === team.abbr && localDate(c.at) === g.date).slice(0, 6) : [];
    if (mine.length) notes.push(`<b>Recent updates:</b><div class="team-feed">` +
      mine.map(c => `<div class="feed-row feed-${c.kind}"><span class="muted feed-time">${fmtTime(c.at)}</span>${esc(c.text)}</div>`).join("") + `</div>`);
    notes.push(`<span class="muted">Lineups from NBA.com, injuries from ESPN · last checked ${S.checkedAt ? fmtTime(S.checkedAt) : "—"}.</span>`);
    $el("lineupNotes").innerHTML = notes.map(n => `<li>${n}</li>`).join("");
  }

  function renderPanel(ps) {
    state = ps;
    const team = byAbbr[ps.team];
    const games = filteredGames(team);
    renderFilters(team);
    renderHeader(team, games);
    renderLineup(team);
    renderReturns(team);
    renderLegend();
    renderHeatmap(team, games);
    renderAnalysis(team, games);
    renderTrends(team);
    renderPulls(team);
    renderGameLog(team, games);
    renderGame(team);
    $el("closePanel").hidden = panels.length < 2;
    syncNums();
    syncMinuteMode();
  }

  function renderTabs() {
    const tabs = $("tabs");
    tabs.hidden = panels.length < 2;
    tabs.innerHTML = panels.map(ps => {
      const t = byAbbr[ps.team];
      return `<span class="tab" data-tab="${t.abbr}">${logo(t.abbr)}${esc(t.nickname)}` +
        `<button class="tab-x" data-close="${t.abbr}" title="Close">✕</button></span>`;
    }).join("") +
      `<span class="seg tab-tools"><button data-action="compare" class="${compare ? "on" : ""}" title="Show the open teams in columns, section by section">⇆ Side by side</button>` +
      (compare ? `<button data-action="sidebar" class="${sidebarOpen ? "on" : ""}" title="Show or hide today's games and the standings">☰ Games &amp; standings</button>` : "") + `</span>` +
      `<span class="muted tabs-hint">Use + in the standings to add teams</span>`;
  }

  function renderAll() {
    const host = $("panels");
    if (panels.length < 2) compare = false;
    $("welcome").hidden = panels.length > 0;
    $("tabs").style.display = panels.length ? "" : "none";
    panels.forEach((ps, i) => {
      if (!ps.el) ps.el = $("panelTpl").content.firstElementChild.cloneNode(true);
      ps.el.style.setProperty("--col", i + 1);
      host.appendChild(ps.el); // also restores the order given by the URL
    });
    for (const el of [...host.children]) if (!panels.some(ps => ps.el === el)) el.remove();
    host.style.setProperty("--n", panels.length);
    document.body.classList.toggle("compare", compare);
    document.body.classList.toggle("show-sidebar", compare && sidebarOpen);
    panels.forEach(renderPanel);
    renderStandings();
    renderTabs();
    renderGamesBar();
  }

  // Side-by-side columns (2+ teams); the standings fold away unless reopened
  let compare = false;
  let sidebarOpen = false;

  // ---------- routing: #/OKC  ·  #/OKC,BOS  ·  #/OKC:0022600002,BOS  ·  #/OKC,BOS;compare ----------
  function readHash() {
    const [list, flag] = location.hash.replace(/^#\/?/, "").split(";");
    compare = flag === "compare";
    const want = list.split(",").map(x => x.split(/[:/]/))
      .map(([abbr, game]) => [(abbr || "").toUpperCase(), game])
      .filter(([abbr], i, all) => byAbbr[abbr] && all.findIndex(([x]) => x === abbr) === i);
    if (!want.length) return false;
    const next = want.map(([abbr, game]) => {
      const ps = panels.find(x => x.team === abbr) || newPanel(abbr);
      ps.game = game && byAbbr[abbr].games.some(g => g.id === game) ? game : null;
      return ps;
    });
    panels.splice(0, panels.length, ...next);
    return true;
  }
  function writeHash() {
    location.hash = "#/" + panels.map(ps => ps.team + (ps.game ? ":" + ps.game : "")).join(",") +
      (compare && panels.length > 1 ? ";compare" : "");
  }
  const panelOf = node => panels.find(ps => ps.el === node.closest(".panel"));
  const scrollToPanel = abbr => {
    const ps = panels.find(x => x.team === abbr);
    // In columns the panel box itself is display: contents, so scroll to its first section
    const target = ps && ps.el && (compare ? ps.el.querySelector("section") : ps.el);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
  };
  function closePanel(abbr) {
    if (panels.length < 2) return;
    panels.splice(panels.findIndex(ps => ps.team === abbr), 1);
    writeHash();
  }

  // ---------- events ----------
  $("standings").addEventListener("click", e => {
    const add = e.target.closest("[data-add]");
    if (add) {
      if (!panels.some(ps => ps.team === add.dataset.add)) panels.push(newPanel(add.dataset.add));
      writeHash();
      setTimeout(() => scrollToPanel(add.dataset.add), 50);
      return;
    }
    const row = e.target.closest("[data-team]");
    if (!row) return;
    // Already open alongside others: jump to it instead of closing the rest
    if (panels.length > 1 && panels.some(ps => ps.team === row.dataset.team)) { scrollToPanel(row.dataset.team); return; }
    location.hash = `#/${row.dataset.team}`;
  });
  $("teamSearch").addEventListener("input", renderStandings);

  $("tabs").addEventListener("click", e => {
    const action = e.target.closest("[data-action]");
    if (action && action.dataset.action === "compare") { compare = !compare; sidebarOpen = false; writeHash(); return; }
    if (action && action.dataset.action === "sidebar") { sidebarOpen = !sidebarOpen; renderAll(); return; }
    const x = e.target.closest("[data-close]");
    if (x) { closePanel(x.dataset.close); return; }
    const tab = e.target.closest("[data-tab]");
    if (tab) scrollToPanel(tab.dataset.tab);
  });

  const panelsHost = $("panels");
  panelsHost.addEventListener("click", e => {
    const ps = panelOf(e.target);
    if (!ps) return;
    const seg = e.target.closest("[data-el='filters'] button[data-val]");
    if (seg) { ps[seg.parentElement.dataset.key] = seg.dataset.val; renderPanel(ps); return; }
    if (e.target.closest("[data-el='closePanel']")) { closePanel(ps.team); return; }
    if (e.target.closest("[data-el='closeGame']")) { ps.game = null; writeHash(); return; }
    if (e.target.closest("[data-el='numToggle']")) { setNums(!showNums); return; }
    const mm = e.target.closest("[data-mm]");
    if (mm) { setClockMinutes(mm.dataset.mm === "clock"); return; }
    const row = e.target.closest("[data-el='gamelog'] [data-game]");
    if (row) {
      const opening = row.dataset.game !== ps.game;
      ps.game = opening ? row.dataset.game : null;
      writeHash();
      if (opening) setTimeout(() => ps.el.querySelector("[data-el='gameCard']").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  });
  panelsHost.addEventListener("change", e => {
    if (e.target.dataset.el !== "oppSelect") return;
    const ps = panelOf(e.target);
    ps.opp = e.target.value;
    renderPanel(ps);
  });

  let showNums = (() => { try { return localStorage.getItem("showNums") !== "0"; } catch (_) { return true; } })();
  function syncMinuteMode() {
    document.querySelectorAll("[data-mm]").forEach(b => b.classList.toggle("on", (b.dataset.mm === "clock") === clockMinutes));
  }
  function setClockMinutes(on) {
    clockMinutes = on;
    try { localStorage.setItem("minuteMode", on ? "clock" : "count"); } catch (_) { /* file:// may block storage */ }
    panels.forEach(renderPanel);
  }
  function syncNums() {
    document.body.classList.toggle("show-nums", showNums);
    document.querySelectorAll("[data-el='numToggle']").forEach(b => b.classList.toggle("on", showNums));
  }
  function setNums(on) {
    showNums = on;
    try { localStorage.setItem("showNums", on ? "1" : "0"); } catch (_) { /* file:// may block storage */ }
    syncNums();
  }

  window.addEventListener("hashchange", () => { if (readHash()) renderAll(); });

  const tip = $("tooltip");
  document.addEventListener("mouseover", e => {
    const cell = e.target.closest(".cell[data-tip]");
    if (!cell) { tip.hidden = true; return; }
    tip.innerHTML = esc(cell.dataset.tip).replace(/\n/g, "<br>");
    tip.hidden = false;
  });
  document.addEventListener("mousemove", e => {
    if (tip.hidden) return;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + "px";
    tip.style.top = (e.clientY + 16) + "px";
  });

  // ---------- boot ----------
  $("season").textContent = `${S.season}-${String(S.season + 1).slice(-2)}`;
  const ageMin = S.checkedAt ? (Date.now() - new Date(S.checkedAt)) / 60000 : Infinity;
  $("meta").innerHTML = `Rotations ${new Date(S.updated).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ` +
    `Lineups & injuries checked ${S.checkedAt ? fmtTime(S.checkedAt) : "—"} ` +
    (ageMin > 75 ? `<span class="stale" title="Lineups and injuries haven't been refreshed in over an hour (owner: run scripts/start-updater.cmd)">⚠ data may be out of date</span>`
      : `<span class="live-dot" title="The page reloads itself when new data arrives">● auto-updating</span>`);

  // After an automatic reload, put the user back where they were
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem("viewState") || "null"); } catch (_) { return null; } })();
  if (saved) {
    sessionStorage.removeItem("viewState");
    if (DAYS.includes(saved.day)) selectedDay = saved.day;
    focusDay = saved.focusDay || null;
    sidebarOpen = !!saved.sidebarOpen;
    boardOpen = !!saved.boardOpen;
  }
  readHash(); // no team in the link -> start on the welcome message, not a default team
  if (saved && saved.filters) {
    for (const ps of panels) Object.assign(ps, saved.filters[ps.team] || {});
  }
  renderAll();
  if (saved) window.scrollTo(0, saved.y || 0);

  // The updater rewrites stamp.js after every check; reload when it differs from the data we loaded
  function pollStamp() {
    const tag = document.createElement("script");
    tag.src = `stamp.js?t=${Date.now()}`;
    tag.onload = () => {
      tag.remove();
      if (window.DATA_STAMP && window.DATA_STAMP !== S.checkedAt) {
        const filters = Object.fromEntries(panels.map(ps => [ps.team, { last: ps.last, loc: ps.loc, res: ps.res, opp: ps.opp }]));
        sessionStorage.setItem("viewState", JSON.stringify({ y: window.scrollY, day: selectedDay, focusDay, sidebarOpen, boardOpen, filters }));
        location.reload();
      }
    };
    tag.onerror = () => tag.remove();
    document.head.appendChild(tag);
  }
  setInterval(pollStamp, 60 * 1000);
})();
