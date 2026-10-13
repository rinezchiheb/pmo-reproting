/* PMO Reporting — page Reporting Tasks (JS natif, sans dépendance externe) */
(() => {
  "use strict";

  const FILTERS = ["chantier", "feat", "assignee", "status", "type_charge"];
  const state = {
    rows: [], meta: {}, collapsed: new Set(), autoTimer: null, allRows: [],
    // comparatif jour par jour
    days: [], histKey: null, cmpDay: "", ref: null, refCache: new Map(), chgKind: "", evoCollapsed: true,
    // suivi du RAF : jour / semaine / sprint
    gran: "jour", aff: "tableau", sprints: [], sprintKey: null, chartCur: null,
    // verdict : explications dépliées (chantier|côté), conservées d'un rafraîchissement à l'autre
    vdOpen: new Set(),
  };
  const $ = (id) => document.getElementById(id);

  // ---------- utilitaires
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtNum = (n) => (n ? n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : "–");
  const fmt1 = (n) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt2 = (n) => (n == null ? "" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  // Un seul format de date dans les tableaux : jj/mm (tout se passe dans le sprint)
  const fmtDate = (iso) => { if (!iso) return ""; const [, m, d] = iso.split("-"); return `${d}/${m}`; };
  const parse = (iso) => (iso ? new Date(iso + "T00:00:00") : null);
  const fmtDay = (iso) => parse(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const maxDate = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const isWorkday = (d) => d.getDay() % 6 !== 0;
  // Jours ouvrés dans ]from, to]
  function workdays(fromIso, toIso) {
    let n = 0;
    const d = parse(fromIso), end = parse(toIso);
    for (d.setDate(d.getDate() + 1); d <= end; d.setDate(d.getDate() + 1)) if (isWorkday(d)) n++;
    return n;
  }
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  // Nom du sprint affiché : « Sprint 12 », mais « PI17 Sprint 3 » tel quel (pas de « Sprint PI17 Sprint 3 »)
  const sprintName = (n) => (/sprint/i.test(n || "") ? n : `Sprint ${n || "—"}`);
  const total = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const EPS = 1e-6;
  // Écart signé, même notation partout (+ / −). lowerIsBetter : une baisse s'affiche en vert (RAF, retards…).
  function delta(n, { unit = "", lowerIsBetter = true, digits = 2 } = {}) {
    if (Math.abs(n) < EPS) return `<span class="dl same">0</span>`;
    const good = lowerIsBetter ? n < 0 : n > 0;
    const txt = Math.abs(n).toLocaleString("fr-FR", { maximumFractionDigits: digits });
    return `<span class="dl ${good ? "good" : "bad"}">${n < 0 ? "−" : "+"}${txt}${unit}</span>`;
  }
  function signed(n, title = "") {
    if (n == null) return "";
    const t = title ? ` title="${esc(title)}"` : "";
    if (Math.abs(n) < 0.005) return `<span class="dl same"${t}>0,00</span>`;
    return `<span class="dl ${n < 0 ? "good" : "bad"}"${t}>${n > 0 ? "+" : "−"}${fmt2(Math.abs(n))}</span>`;
  }

  const ICONS = {
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
  };
  const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  function statusClass(s) {
    const x = (s || "").toLowerCase();
    if (["fini", "fermée", "résolue", "done", "closed"].includes(x)) return "s-fini";
    if (x.includes("blocked") || x.includes("bloqu")) return "s-blocked";
    if (x.includes("progress") || x.includes("running")) return "s-progress";
    if (x.includes("ready for qa") || x.includes("merge")) return "s-review";
    return "";
  }
  const pill = (s) => (s ? `<span class="pill ${statusClass(s)}">${esc(s)}</span>` : "");

  // ---------- réseau et messages
  const why = (e) => (e instanceof TypeError ? "le serveur ne répond pas" : e.message);
  // point final seulement si le message n'en a pas déjà un (« actif ? » ne devient pas « actif ?. »)
  const endDot = (s) => (/[.?!…]\s*$/.test(s) ? s : s + ".");
  async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || `erreur ${res.status}`);
    return data;
  }
  // Message d'erreur : reste affiché jusqu'à fermeture, avec « Réessayer » quand c'est possible
  function notify(msg, retry) {
    const t = $("toast");
    t.innerHTML = `${icon("alert", "t-ico")}<span class="t-msg"></span>` +
      (retry ? `<button type="button" class="btn small" data-act="retry">Réessayer</button>` : "") +
      `<button type="button" class="t-close" data-act="close" aria-label="Fermer le message">${icon("close")}</button>`;
    t.querySelector(".t-msg").textContent = msg;
    notify.retry = retry;
    t.hidden = false;
  }
  const retryHistory = () => { state.histKey = state.sprintKey = null; render(); };

  // ---------- état des filtres <-> URL
  function readFilters() {
    const f = {};
    FILTERS.forEach((k) => (f[k] = $("f-" + k).value));
    f.q = $("f-q").value.trim();
    f.alerts = $("f-alerts").checked;
    f.hideDone = $("f-hideDone").checked;
    return f;
  }
  function writeUrl(f) {
    const p = new URLSearchParams();
    FILTERS.forEach((k) => f[k] && p.set(k, f[k]));
    if (f.q) p.set("q", f.q);
    if (f.alerts) p.set("alerts", "1");
    if (f.hideDone) p.set("hideDone", "1");
    if (state.cmpDay) p.set("cmp", state.cmpDay);
    if (state.gran !== "jour") p.set("vue", state.gran);
    if (state.aff !== "tableau") p.set("aff", state.aff);
    if (!state.evoCollapsed) p.set("raf", "1");
    history.replaceState(null, "", p.toString() ? "?" + p : location.pathname);
    // L'export reprend exactement l'écran, y compris « masquer terminées »
    const ex = new URLSearchParams(serverParams(f));
    if (f.hideDone) ex.set("hideDone", "1");
    $("export").href = $("exportMini").href = "/api/reporting-tasks.xlsx" + (ex.toString() ? "?" + ex : "");
  }
  // Filtres transmis à l'historique : mêmes que l'écran, sauf « masquer terminées »
  function serverParams(f) {
    const p = new URLSearchParams();
    FILTERS.forEach((k) => f[k] && p.set(k, f[k]));
    if (f.q) p.set("q", f.q);
    if (f.alerts) p.set("alerts", "1");
    return p.toString();
  }
  function applyUrl() {
    const p = new URLSearchParams(location.search);
    FILTERS.forEach((k) => { if (p.get(k)) $("f-" + k).dataset.want = p.get(k); });
    $("f-q").value = p.get("q") || "";
    $("f-alerts").checked = p.get("alerts") === "1";
    $("f-hideDone").checked = p.get("hideDone") === "1";
    state.cmpDay = p.get("cmp") || "";
    if (["jour", "semaine", "sprint"].includes(p.get("vue"))) state.gran = p.get("vue");
    if (p.get("aff") === "courbe") state.aff = "courbe";
    state.evoCollapsed = p.get("raf") !== "1";
  }

  function matches(r, f, skip) {
    for (const k of FILTERS) if (k !== skip && f[k] && r[k] !== f[k]) return false;
    if (f.q && !`${r.key} ${r.summary} ${r.us_key} ${r.us_summary} ${r.assignee}`.toLowerCase().includes(f.q.toLowerCase())) return false;
    if (f.alerts && !r.alerts.some((a) => a.level !== "info")) return false;
    if (f.hideDone && r.done) return false;
    return true;
  }

  // Options des listes : dépendantes des autres filtres (ex. FEAT selon chantier)
  function fillSelects(f) {
    const labels = { chantier: "Tous", feat: "Toutes", assignee: "Toutes", status: "Tous", type_charge: "Tous" };
    FILTERS.forEach((k) => {
      const sel = $("f-" + k);
      const want = sel.dataset.want ?? sel.value;
      delete sel.dataset.want;
      const vals = [...new Set(state.rows.filter((r) => matches(r, f, k)).map((r) => r[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
      if (k === "assignee") return window.Pilotage.fillPeople(sel, vals, want, labels[k]);  // liste commune du pilotage
      if (want && !vals.includes(want)) vals.unshift(want);
      sel.innerHTML = `<option value="">${labels[k]}</option>` + vals.map((v) => `<option value="${esc(v)}" ${v === want ? "selected" : ""}>${esc(v)}</option>`).join("");
    });
  }

  // Bouton « Agrandir / Réduire » d'un bloc (mode focus)
  const FOCUS_ICONS = { on: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>', off: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>' };
  const focusBtn = (on) => `<button type="button" class="btn quiet small focus-btn" data-focus aria-pressed="${on}" title="${on ? "Revenir à la page (Échap)" : "Agrandir ce bloc (Échap pour revenir)"}"><svg class="i" viewBox="0 0 24 24" aria-hidden="true">${FOCUS_ICONS[on ? "on" : "off"]}</svg><span>${on ? "Réduire" : "Agrandir"}</span></button>`;

  // ---------- rendu
  function renderSprint() {
    const m = state.meta;
    // Frise du sprint : début → Freeze Code → fin de test, avec la position du jour
    let tl = "", pctTxt = "";
    if (m.sprint_start && m.fin_test) {
      const s = parse(m.sprint_start), e = parse(m.fin_test);
      const pos = (iso) => Math.max(0, Math.min(100, (100 * (parse(iso) - s)) / (e - s)));
      const pct = pos(m.today);
      pctTxt = ` · ${pct.toFixed(0)} % écoulé`;
      const mark = (cls, iso, lbl) => `<span class="tl-mark ${cls}" style="left:${pos(iso)}%"><b>${lbl}<span>${esc(fmtDay(iso))}</span></b></span>`;
      tl = `<div class="timeline" aria-hidden="true"><div class="tl-track">
          <div class="tl-fill" style="width:${pct.toFixed(1)}%"></div>
          ${mark("start", m.sprint_start, "Début")}
          ${m.freeze_code && m.freeze_code !== m.fin_test ? mark("freeze", m.freeze_code, "Freeze Code") : ""}
          ${mark("end", m.fin_test, m.freeze_code === m.fin_test ? "Freeze Code et fin de test" : "Fin de test")}
          ${m.today >= m.sprint_start && m.today <= m.fin_test ? `<span class="tl-today" style="left:${pct}%"><em>${m.as_of ? "Jour affiché" : "Aujourd'hui"}</em></span>` : ""}
        </div></div>`;
    }
    const range = m.sprint_start && m.fin_test ? `${fmtDate(m.sprint_start)} → ${fmtDate(m.fin_test)}${pctTxt}` : "";
    $("sprint").innerHTML = `<div class="sp-id"><h1 class="sp-name">${esc(sprintName(m.sprint))}</h1><span class="sp-dates">${range}</span>${focusBtn($("sprint").classList.contains("focused"))}</div>
      ${tl || "<div></div>"}
      <div class="verdicts" id="verdict"></div>
      <div class="kpis" id="kpis" aria-label="Indicateurs"></div>`;
    const src = $("source");
    src.textContent = m.source === "jira" ? "Jira en direct" : "Démo (Excel)";
    src.className = "badge " + (m.source === "jira" ? "live" : "demo");
    $("lastSync").textContent = m.generated_at ? "Mis à jour à " + m.generated_at.slice(11, 16) : "";
    // Règles de calcul du RAF (légende)
    $("rafCalc").textContent = m.hours_per_day
      ? ` 1 JH = ${m.hours_per_day.toLocaleString("fr-FR")} h. Comptent en DEV : ${(m.raf_dev_types || []).join(", ") || "—"}. Comptent en QA : ${(m.raf_qa_types || []).join(", ") || "—"}. Les autres types ne comptent pas.`
      : "";
  }

  // Côté d'une tâche (DEV ou QA) d'après les types qui comptent dans le RAF, même quand son RAF est à 0
  function isSide(r, side) {
    const types = (state.meta[`raf_${side}_types`] || []).map((t) => t.toLowerCase());
    return types.length ? types.includes((r.type || "").toLowerCase()) : side === "qa" ? r.type_charge === "QA" : r.type_charge !== "QA";
  }

  // Verdict par chantier : chaque chantier a ses propres ressources et compétences (DEV, QA),
  // qui ne se partagent pas. On juge donc chaque chantier sur son propre rythme, jamais sur un total.
  const LVL_ORDER = { late: 0, risk: 1, neutral: 2, ok: 3, none: 4 };
  function judge(raf, baseRaf, target, what, ctx) {
    if (raf < 0.005) return { lvl: baseRaf == null || baseRaf < 0.005 ? "none" : "ok", status: "Soldé", tip: `Plus de RAF ${what}.` };
    const d = daysBetween(parse(ctx.today), parse(target));
    if (d < 0) return { lvl: "late", status: `Dépassé · ${fmtNum(raf)} JH`, tip: `Échéance dépassée : ${fmtNum(raf)} JH de ${what} restent à solder.` };
    const need = `${fmtNum(raf)} JH de ${what} à solder en ${plural(ctx.left(target), "jour ouvré", "jours ouvrés")}, soit ${fmt1(raf / Math.max(1, ctx.left(target)))} JH par jour.`;
    if (baseRaf == null) return { lvl: "neutral", status: "Rythme à confirmer", tip: `${need} Pas encore de relevé antérieur pour ce chantier.` };
    const pace = (baseRaf - raf) / ctx.span, rest = raf - pace * ctx.left(target);
    const since = `Rythme observé depuis le ${fmtDate(ctx.baseDay)} : ${fmt1(pace)} JH par jour.`;
    if (rest <= 0.05) return { lvl: "ok", status: "En bonne voie", tip: `${need} ${since}` };
    if (pace <= 0.005) return { lvl: "risk", status: "À risque · RAF stable", tip: `${need} Le RAF ${what} ne baisse pas depuis le ${fmtDate(ctx.baseDay)}.` };
    return { lvl: "risk", status: `À risque · ≈ ${fmt1(rest)} JH restants`, tip: `${need} ${since} À ce rythme, environ ${fmt1(rest)} JH resteraient à l'échéance.` };
  }

  // Ce que la somme du RAF ne dit pas : tâches ouvertes sans estimation, en retard, bloquées
  // ou dont l'échéance dépasse le jalon. Un RAF à 0 n'est « Soldé » que s'il ne reste rien à faire :
  // une tâche livrée (Ready for QA, Merge Request) sans RAF n'est pas un problème.
  function sideIssues(tasks, milestoneCode) {
    const open = tasks.filter((r) => !r.done && !r.delivered);
    const all = tasks.filter((r) => !r.done);
    const has = (r, ...codes) => r.alerts.some((a) => codes.includes(a.code));
    return {
      open: open.length,
      unest: open.filter((r) => r.raf_hj < 0.005).length,
      late: open.filter((r) => has(r, "RETARD", "BLOQUEE")).length,
      after: all.filter((r) => has(r, milestoneCode)).length,
    };
  }
  function flag(v, raf, iss, milestone) {
    if (!v) return v;
    const parts = [
      iss.late && plural(iss.late, "en retard ou bloquée", "en retard ou bloquées"),
      iss.after && `${iss.after} après ${milestone}`,
      iss.unest && plural(iss.unest, "non estimée", "non estimées"),
    ].filter(Boolean);
    if (raf < 0.005) {
      if (!iss.open) return v; // vraiment soldé
      return { lvl: iss.late || iss.after ? "late" : "risk", status: "RAF non estimé", issues: parts.join(" · "),
        tip: `RAF à 0, mais ${plural(iss.open, "tâche reste ouverte", "tâches restent ouvertes")} : le reste à faire n'est pas saisi dans Jira.` };
    }
    if (!parts.length) return v;
    const bad = iss.late || iss.after;
    const lvl = bad ? "late" : v.lvl === "ok" || v.lvl === "neutral" ? "risk" : v.lvl;
    const status = v.lvl === "ok" || v.lvl === "neutral" ? (bad ? "Tâches en retard" : "RAF incomplet") : v.status;
    return { ...v, lvl, status, issues: parts.join(" · "), tip: v.tip };  // l'état est affiché juste au-dessus de l'explication
  }

  function renderVerdict(rows) {
    const m = state.meta, el = $("verdict");
    if (!el || !m.today) return;
    // Rythme mesuré sur les 5 derniers jours ouvrés au plus (le plus ancien relevé de cette fenêtre)
    const base = state.days.filter((d) => d.day < m.today).find((d) => workdays(d.day, m.today) <= 5) || null;
    if (base && !state.refCache.has(base.day)) loadBase(base.day);
    const baseRows = base && state.refCache.has(base.day) ? state.refCache.get(base.day).filter((r) => matches(r, state.allF)) : null;
    const ctx = {
      today: m.today, baseDay: base?.day, span: base ? Math.max(1, workdays(base.day, m.today)) : 1,
      left: (target) => workdays(m.today, target) + (isWorkday(parse(m.today)) ? 1 : 0),
    };
    const byCh = (src) => src.reduce((acc, r) => {
      const a = acc.get(r.chantier) || { dev: 0, qa: 0, devTasks: [], qaTasks: [] };
      a.dev += r.raf_dev; a.qa += r.raf_qa;
      if (isSide(r, "dev")) a.devTasks.push(r);
      if (isSide(r, "qa")) a.qaTasks.push(r);
      acc.set(r.chantier, a); return acc;
    }, new Map());
    const now = byCh(rows), before = baseRows ? byCh(baseRows) : null;
    const lines = [...now.entries()].map(([ch, a]) => {
      const b = before ? before.get(ch) || { dev: 0, qa: 0 } : null;
      const dev = m.freeze_code ? flag(judge(a.dev, b?.dev, m.freeze_code, "DEV", ctx), a.dev, sideIssues(a.devTasks, "APRES_FREEZE"), "Freeze") : null;
      const qa = m.fin_test ? flag(judge(a.qa, b?.qa, m.fin_test, "QA", ctx), a.qa, sideIssues(a.qaTasks, "APRES_FIN_TEST"), "fin de test") : null;
      const worst = Math.min(LVL_ORDER[dev?.lvl ?? "none"], LVL_ORDER[qa?.lvl ?? "none"]);
      return { ch, a, dev, qa, worst };
    }).sort((x, y) => x.worst - y.worst || x.ch.localeCompare(y.ch, "fr"));
    const head = (lbl, iso) => {
      if (!iso) return "";
      const d = daysBetween(parse(m.today), parse(iso));
      return `<th><span class="vd-j">${d < 0 ? `passé de ${-d} j` : d === 0 ? "aujourd'hui" : `dans ${d} j`}</span>${lbl}<small>${esc(fmtDay(iso))}</small></th>`;
    };
    // L'état est un bouton qui déplie son explication : lisible au clavier, au toucher et par un lecteur d'écran
    const cell = (v, raf, key, id) => {
      if (!v) return "";
      const open = state.vdOpen.has(key);
      return `<td class="vd-${v.lvl}"><button type="button" class="vd-why" data-vd="${esc(key)}" data-fk="vd:${esc(key)}" aria-expanded="${open}" aria-controls="${id}">` +
        `<span>${v.status}</span><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>` +
        `${raf >= 0.005 ? `<small>${fmtNum(raf)} JH</small>` : ""}${v.issues ? `<span class="vd-iss">${esc(v.issues)}</span>` : ""}` +
        `<p class="vd-tip" id="${id}"${open ? "" : " hidden"}>${esc(v.tip)}</p></td>`;
    };
    el.innerHTML = lines.length ? `<table class="vd-table">
        <thead><tr><th>Chantier</th>${head("Rythme DEV → Freeze Code", m.freeze_code)}${head("Rythme QA → Fin de test", m.fin_test)}</tr></thead>
        <tbody>${lines.map((l, i) => `<tr><td><button type="button" class="vd-ch" data-ch="${esc(l.ch)}" title="Filtrer sur ce chantier">${esc(l.ch)}</button></td>${cell(l.dev, l.a.dev, `${l.ch}|dev`, `vd-tip-${i}-dev`)}${cell(l.qa, l.a.qa, `${l.ch}|qa`, `vd-tip-${i}-qa`)}</tr>`).join("")}</tbody>
      </table>
      <p class="vd-note">Rythme : baisse du RAF sur les 5 derniers jours ouvrés, prolongée jusqu'au jalon. La charge face à la capacité de l'équipe est sur la <a href="/recap">Synthèse</a>.</p>` : "";
  }
  async function loadBase(day) {
    if (state.baseLoading === day) return;
    state.baseLoading = day;
    try { state.refCache.set(day, (await getJson("/api/history/" + day)).rows); renderVerdict(state.allRows); }
    catch { /* sans relevé de base, le verdict affiche « Rythme à confirmer » */ }
    finally { state.baseLoading = null; }
  }

  function kpiValues(rows) {
    return {
      raf_dev: total(rows, "raf_dev"), raf_qa: total(rows, "raf_qa"), total: rows.length,
      done: rows.filter((r) => r.done).length,
      danger: rows.filter((r) => r.alerts.some((a) => a.level === "danger")).length,
      warn: rows.filter((r) => r.alerts.some((a) => a.level === "warn")).length,
      late: rows.filter((r) => r.alerts.some((a) => a.code === "RETARD")).length,
    };
  }

  function renderKpis(rows, refRows) {
    const k = kpiValues(rows), b = refRows ? kpiValues(refRows) : null;
    const el = $("kpis");
    if (!el) return;
    const d = (key, opt) => (b ? `<span class="kdelta">${delta(k[key] - b[key], opt)}</span>` : "");
    const jh = (n) => `${n >= 0.005 ? fmtNum(n) : 0}<small>JH</small>`;
    const donePct = k.total ? (100 * k.done) / k.total : 0;
    el.innerHTML = [
      ["RAF DEV", jh(k.raf_dev), d("raf_dev", { unit: " JH" }), "reste à faire en développement", ""],
      ["RAF QA", jh(k.raf_qa), d("raf_qa", { unit: " JH" }), "reste à faire en recette", ""],
      ["Terminées", `${k.done}<small>/ ${k.total}</small>`, d("done", { digits: 0, lowerIsBetter: false }), `${donePct.toFixed(0)} % des tâches · ${plural(k.total - k.done, "ouverte", "ouvertes")}`, ""],
      ["Alertes critiques", k.danger, d("danger", { digits: 0 }), `<b>dont ${k.late} en retard</b> · ${k.warn} à surveiller`, k.danger ? "danger" : ""],
    ].map(([l, v, dl, sub, c]) => `<div class="kpi ${c}"><span class="lbl">${l}</span><div class="val">${v}${dl}</div><div class="sub">${sub}</div></div>`).join("") +
      (b ? `<p class="kpi-ref">Variations calculées par rapport au relevé du ${fmtDate(state.cmpDay)}</p>` : "");
  }

  const LEVEL_ORDER = { danger: 0, warn: 1, info: 2 };
  function alertTags(alerts) {
    const sorted = [...alerts].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    return `<div class="alerts">${sorted.map((a) => `<span class="al-tag ${a.level}">${esc(a.label)}</span>`).join("")}</div>`;
  }
  const alCount = (n) => `<span class="al-count" title="${plural(n, "tâche avec alerte critique", "tâches avec alerte critique")}">${icon("alert")}${plural(n, "critique", "critiques")}</span>`;
  const jiraLink = (url, key) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(key)}</a>` : esc(key));

  // « Bloque A, B · Lié à C » : US du sprint liées à un bug, regroupées par sens du lien Jira
  function linksBySense(us) {
    const by = new Map();
    for (const u of us) { const k = u.rel || "Lié à"; if (!by.has(k)) by.set(k, []); by.get(k).push(u); }
    return [...by].sort(([a], [b]) => (a === "Bloque" ? -1 : b === "Bloque" ? 1 : 0))
      .map(([rel, xs]) => `${esc(rel)} ${xs.map((u) => `<span title="${esc(u.summary)}">${jiraLink(u.url, u.key)}</span>`).join(", ")}`).join(" · ");
  }

  function renderGrid(rows) {
    const m = state.meta;
    // Chantier -> US -> tâches
    const byCh = new Map();
    for (const r of rows) {
      if (!byCh.has(r.chantier)) byCh.set(r.chantier, new Map());
      // Bugs : tous dans « Liste des bugs » du chantier, même liés à une US (les US bloquées sont citées sur la ligne)
      const usKey = r.type_charge === "BUG" ? "(bugs)" : r.us_key || `(sans US · ${r.feat_src || "-"})`;
      const g = byCh.get(r.chantier);
      // sans US : bugs de régression et tâches rattachés directement à la FEAT
      const noUs = r.feat_src === "tache" ? "Rattachés directement à la FEAT" : r.feat_src === "chantier" ? "Sans US ni FEAT dans Jira (FEAT déduite du chantier)" : "(Sans US mère)";
      if (!g.has(usKey)) g.set(usKey, usKey === "(bugs)" ? { key: "", url: "", summary: "Liste des bugs", status: "", feat: r.feat, featSrc: r.feat_src, tasks: [] }
        : { key: r.us_key, url: r.us_url, summary: r.us_summary || noUs, status: r.us_status, feat: r.feat, featSrc: r.feat_src, tasks: [] });
      // FEAT du groupe de bugs : la FEAT commune, sinon « plusieurs FEAT »
      if (usKey === "(bugs)" && g.get(usKey).feat !== r.feat) g.get(usKey).feat = "Plusieurs FEAT";
      g.get(usKey).tasks.push(r);
    }
    const typeOrder = { DEV: 0, ANO: 1, BUG: 2, QA: 3 };
    let html = "";
    [...byCh.keys()].sort((a, b) => a.localeCompare(b, "fr")).forEach((ch) => {
      const groups = [...byCh.get(ch).values()].sort((a, b) => a.summary.localeCompare(b.summary, "fr"));
      const chRows = groups.flatMap((g) => g.tasks);
      html += `<tr class="chantier"><td colspan="6">${esc(ch)} · ${groups.length} US</td><td class="num">${fmtNum(total(chRows, "raf_dev"))}</td><td class="num">${fmtNum(total(chRows, "raf_qa"))}</td></tr>`;
      for (const g of groups) {
        const id = ch + "|" + (g.key || g.summary);
        const collapsed = state.collapsed.has(id);
        const dDev = g.tasks.reduce((a, r) => maxDate(a, r.due_dev), null), dQa = g.tasks.reduce((a, r) => maxDate(a, r.due_qa), null);
        const nAl = g.tasks.filter((r) => r.alerts.some((a) => a.level === "danger")).length;
        const devBad = dDev && m.freeze_code && dDev > m.freeze_code, qaBad = dQa && m.fin_test && dQa > m.fin_test;
        // groupe sans US composé uniquement de bugs ou d'anomalies : « Liste des bugs » / « Liste des anomalies »
        const kinds = new Set(g.tasks.map((t) => t.type_charge));
        const bugList = !g.key && [...kinds].every((k) => k === "BUG" || k === "ANO");
        const listName = kinds.size === 1 && kinds.has("ANO") ? "Liste des anomalies" : kinds.has("ANO") ? "Liste des bugs et anomalies" : "Liste des bugs";
        const listTag = kinds.size === 1 && kinds.has("ANO") ? ["ANO", "ANOS"] : ["BUG", "BUGS"];
        const label = g.key || (bugList ? listName : g.summary);
        const dates = [dDev && `<span class="stack ${devBad ? "date-bad" : ""}">DEV ${fmtDate(dDev)}</span>`,
          dQa && `<span class="stack ${qaBad ? "date-bad" : ""}">QA ${fmtDate(dQa)}</span>`].filter(Boolean).join("");
        html += `<tr class="us ${collapsed ? "collapsed" : ""}" data-id="${esc(id)}">
          <td><button type="button" class="tgl" aria-expanded="${!collapsed}" aria-label="${collapsed ? "Déplier" : "Replier"} ${esc(label)}" data-fk="us:${esc(id)}">${icon("chevron")}</button>${g.key ? jiraLink(g.url, g.key) : `<span class="muted">${bugList ? (listTag[0] === "ANO" ? "Anomalies" : "Bugs") : "Sans US"}</span>`}</td>
          <td>${bugList ? `<span class="type ${listTag[0]}" title="${listTag[0] === "BUG" ? "Tous les bugs du chantier ; les US qu'ils bloquent sont citées sur chaque ligne" : "Rattachées à aucune US"}">${listTag[1]}</span>` : '<span class="type US" title="Récit (US)">US</span>'}</td>
          <td class="sum">${esc(bugList ? listName : g.summary)}${nAl ? alCount(nAl) : ""}<span class="feat">${esc(g.feat)}${!g.key && g.featSrc === "chantier" ? " · FEAT déduite du chantier" : ""}</span></td>
          <td>${pill(g.status)}</td><td class="muted">${plural(g.tasks.length, "tâche", "tâches")}</td>
          <td class="num">${dates}</td>
          <td class="num">${fmtNum(total(g.tasks, "raf_dev"))}</td><td class="num">${fmtNum(total(g.tasks, "raf_qa"))}</td></tr>`;
        if (collapsed) continue;
        g.tasks.sort((a, b) => (typeOrder[a.type_charge] ?? 9) - (typeOrder[b.type_charge] ?? 9) || a.key.localeCompare(b.key));
        for (const r of g.tasks) {
          const has = (code) => r.alerts.some((a) => a.code === code);
          const due = r.due_dev || r.due_qa || r.due;
          const bad = !r.done && (has("RETARD") || has("APRES_FREEZE") || has("APRES_FIN_TEST"));
          html += `<tr class="task ${r.done ? "done" : ""}">
            <td>${jiraLink(r.url, r.key)}</td>
            <td>${r.type_charge ? `<span class="type ${r.type_charge}" title="${esc(r.type)}">${r.type_charge}</span>` : esc(r.type)}</td>
            <td class="sum">${esc(r.summary)}${r.type_charge === "BUG" && r.linked_us?.length ? `<span class="lk">${linksBySense(r.linked_us)}</span>` : ""}${r.alerts.length ? alertTags(r.alerts) : ""}</td>
            <td>${pill(r.status)}</td><td>${esc(r.assignee) || '<span class="muted">Non assignée</span>'}</td>
            <td class="num ${bad ? "date-bad" : ""}">${fmtDate(due)}</td>
            <td class="num">${r.raf_dev ? fmtNum(r.raf_dev) : ""}</td><td class="num">${r.raf_qa ? fmtNum(r.raf_qa) : ""}</td></tr>`;
        }
      }
    });
    $("rows").innerHTML = html;
    $("empty").hidden = rows.length > 0;
    // sprint sans aucune tâche : rien à réinitialiser, on dit où regarder
    const none = !state.rows.length;
    $("empty").querySelector("p").innerHTML = none ? '<b>Aucune tâche dans les filtres Jira du sprint.</b> Vérifier les dates du sprint et les numéros de filtre dans les <a href="/parametres">Paramètres</a>.' : "Aucune tâche ne correspond aux filtres.";
    $("emptyReset").hidden = none;
    $("count").textContent = `${plural(rows.length, "tâche", "tâches")}, regroupées par chantier et par US`;
  }

  function renderSide(rows, refRows) {
    const agg = (key, src = rows) => {
      const m = new Map();
      for (const r of src) {
        const k = r[key] || "(Non assignée)";
        const a = m.get(k) || { dev: 0, qa: 0 };
        a.dev += r.raf_dev; a.qa += r.raf_qa;
        m.set(k, a);
      }
      return m;
    };
    const pe = agg("assignee");
    const peRef = refRows ? agg("assignee", refRows) : null;
    const tot2 = (a) => (a ? a.dev + a.qa : 0);
    const dCell = (k, a) => (peRef ? `<td class="num">${delta(tot2(a) - tot2(peRef.get(k)))}</td>` : "");
    const names = new Set([...pe.keys(), ...(peRef ? peRef.keys() : [])]);
    $("byPerson").innerHTML = `<thead><tr><th>Personne</th><th class="num">RAF DEV</th><th class="num">RAF QA</th><th class="num">Total</th>${peRef ? `<th class="num" title="Variation depuis le ${fmtDate(state.cmpDay)}">Variation</th>` : ""}</tr></thead><tbody>` +
      [...names].map((k) => [k, pe.get(k) || { dev: 0, qa: 0 }])
        .filter(([k, a]) => tot2(a) > 0 || (peRef && tot2(peRef.get(k)) > 0))
        .sort((a, b) => tot2(b[1]) - tot2(a[1])).map(([k, a]) =>
        `<tr><td>${esc(k)}</td><td class="num">${fmtNum(a.dev)}</td><td class="num">${fmtNum(a.qa)}</td><td class="num"><b>${fmtNum(a.dev + a.qa)}</b></td>${dCell(k, a)}</tr>`).join("") + "</tbody>";
  }

  // ---------- comparatif jour par jour
  async function loadHistory(f) {
    const key = serverParams(f);
    if (key === state.histKey) return;
    state.histKey = key;
    try {
      const data = await getJson("/api/history" + (key ? "?" + key : ""));
      if (state.histKey !== key) return; // filtres modifiés entre-temps
      state.days = data.days;
      renderCmpSelect(); renderRaf(); rafNote(); evoStrip(); renderVerdict(state.allRows);
    } catch (e) {
      state.histKey = null;
      notify(`Historique indisponible : ${endDot(why(e))}`, retryHistory);
    }
  }

  function renderCmpSelect() {
    const today = state.meta.today;
    const past = state.days.map((d) => d.day).filter((d) => d < today).reverse();
    // Fins des sprints précédents (vue par sprint) : comparables aussi
    const older = state.sprints.filter((s) => s.sprint !== state.meta.sprint && s.last_day < today)
      .map((s) => [s.last_day, s.sprint]).filter(([d]) => !past.includes(d)).reverse();
    const all = [...past, ...older.map(([d]) => d)];
    // Par défaut : le dernier jour enregistré avant aujourd'hui (la veille ouvrée en général)
    // (en vue sprint, on attend la liste des sprints avant d'écarter une référence d'un sprint précédent)
    const waiting = state.gran === "sprint" && !state.sprints.length && state.cmpDay;
    const valid = all.includes(state.cmpDay) || waiting ? state.cmpDay : past[0] || "";
    if (valid !== state.cmpDay || (valid && !state.ref)) { state.cmpDay = valid; loadRef(); }
    const opt = (d, lbl) => `<option value="${d}" ${d === state.cmpDay ? "selected" : ""}>${esc(lbl)}</option>`;
    $("cmp-day").innerHTML = all.length
      ? past.map((d) => opt(d, fmtDay(d))).join("") +
        (older.length ? `<optgroup label="Sprints précédents">${older.map(([d, s]) => opt(d, `Fin ${s} (${fmtDate(d)})`)).join("")}</optgroup>` : "")
      : `<option value="">aucun relevé antérieur</option>`;
    $("cmp-day").disabled = !all.length;
  }

  async function loadRef() {
    const day = state.cmpDay;
    if (!day) { state.ref = null; render(); return; }
    if (!state.refCache.has(day)) {
      try {
        const data = await getJson("/api/history/" + day);
        state.refCache.set(day, data.rows);
      } catch (e) {
        notify(`Impossible de charger le relevé du ${fmtDate(day)} : ${endDot(why(e))}`, () => { if (state.cmpDay === day) loadRef(); });
        return;
      }
    }
    if (state.cmpDay !== day) return;
    state.ref = state.refCache.get(day);
    render();
  }

  // Changements tâche par tâche entre la photo de référence et maintenant
  function diffRows(cur, ref) {
    const before = new Map(ref.map((r) => [r.key, r]));
    const now = new Map(cur.map((r) => [r.key, r]));
    const raf = (r) => (r ? r.raf_dev + r.raf_qa : 0);
    const out = [];
    for (const key of new Set([...before.keys(), ...now.keys()])) {
      const a = now.get(key), b = before.get(key);
      const tags = [];
      if (!b) tags.push(["new", "Nouvelle"]);
      else if (!a) tags.push(["gone", "Sortie du périmètre"]);
      else {
        if (a.done && !b.done) tags.push(["done", "Terminée"]);
        else if (!a.done && b.done) tags.push(["reopen", "Rouverte"]);
        else if (a.status !== b.status) tags.push(["status", "Statut"]);
        if (Math.abs(raf(a) - raf(b)) > EPS) tags.push(["raf", raf(a) < raf(b) ? "RAF en baisse" : "RAF en hausse"]);
        if (a.assignee !== b.assignee) tags.push(["assignee", "Réassignée"]);
        if (a.due !== b.due) tags.push(["due", "Échéance modifiée"]);
      }
      if (tags.length) out.push({ key, a, b, r: a || b, tags, d: raf(a) - raf(b) });
    }
    return out.sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || x.key.localeCompare(y.key));
  }

  const KINDS = [["done", "terminée", "terminées"], ["reopen", "rouverte", "rouvertes"], ["new", "nouvelle", "nouvelles"],
    ["gone", "sortie", "sorties"], ["status", "changement de statut", "changements de statut"], ["raf", "RAF modifié", "RAF modifiés"],
    ["assignee", "réassignée", "réassignées"], ["due", "échéance modifiée", "échéances modifiées"]];

  function renderChanges(rows, refRows) {
    state.chgCount = null;
    if (!refRows) {
      const msg = state.days.length <= 1
        ? "L'historique démarre aujourd'hui : un relevé est enregistré chaque jour, la comparaison sera disponible dès demain."
        : "Sélectionner un jour de comparaison.";
      $("chgSummary").innerHTML = `<div class="muted">${msg}</div>`;
      $("chgTable").innerHTML = "";
      return;
    }
    const all = diffRows(rows, refRows);
    state.chgCount = all.length;
    const count = (k) => all.filter((c) => c.tags.some((t) => t[0] === k)).length;
    const chips = KINDS.map(([k, one, many]) => [k, one, many, count(k)]).filter(([, , , n]) => n);
    if (state.chgKind && !count(state.chgKind)) state.chgKind = "";
    const chip = (k, lbl) => `<button type="button" class="chip ${state.chgKind === k ? "on" : ""}" aria-pressed="${state.chgKind === k}" data-kind="${k}" data-fk="chip:${k}">${lbl}</button>`;
    $("chgSummary").innerHTML = all.length
      ? chip("", `Tout (${all.length})`) + chips.map(([k, one, many, n]) => chip(k, plural(n, one, many))).join("")
      : `<span class="muted">Aucun changement depuis le ${fmtDate(state.cmpDay)}.</span>`;
    const list = state.chgKind ? all.filter((c) => c.tags.some((t) => t[0] === state.chgKind)) : all;
    const rafTxt = (r) => (r ? fmtNum(r.raf_dev + r.raf_qa) : "–");
    const stTxt = (c) => (c.a && c.b && c.a.status !== c.b.status ? `${pill(c.b.status)} → ${pill(c.a.status)}` : pill(c.r.status));
    $("chgTable").innerHTML = list.length ? `<thead><tr><th>Clé</th><th>Résumé</th><th>Personne</th><th>État</th>
        <th class="num">RAF avant</th><th class="num">RAF</th><th class="num">Variation RAF</th><th>Changement</th></tr></thead><tbody>` +
      list.map((c) => `<tr>
        <td>${jiraLink(c.r.url, c.key)}</td>
        <td>${esc(c.r.summary)}<span class="stack">${esc(c.r.chantier)}</span></td>
        <td>${c.a && c.b && c.a.assignee !== c.b.assignee ? `${esc(c.b.assignee || "—")} → ${esc(c.a.assignee || "—")}` : esc(c.r.assignee) || '<span class="muted">Non assignée</span>'}</td>
        <td>${stTxt(c)}</td>
        <td class="num muted">${rafTxt(c.b)}</td><td class="num">${rafTxt(c.a)}</td><td class="num">${delta(c.d)}</td>
        <td><div class="alerts">${c.tags.map(([k, l]) => `<span class="chg-tag ${k}">${l}</span>`).join("")}</div></td></tr>`).join("") + "</tbody>"
      : "";
  }

  // Courbe RAF DEV / RAF QA : mêmes colonnes que le tableau (jour, semaine ou sprint), SVG natif.
  // Utilisable à la souris (survol, clic) et au clavier (flèches, Entrée).
  let chart = null;
  function renderChart(cols, bases) {
    const el = $("evoChart"), g = state.gran;
    const pts = cols.map((c, i) => [c, i]).filter(([c]) => c.end);
    if (!pts.length) { chart = null; el.innerHTML = `<div class="empty">Pas encore d'historique.</div>`; return; }
    const W = Math.max(320, el.clientWidth || 800), H = 250, L = 44, R = 76, T = 18, B = 34;
    const n = cols.length, x = (i) => L + ((W - L - R) * (i + 0.5)) / n;
    const vmax = Math.max(1, ...pts.flatMap(([c]) => [c.end.raf_dev, c.end.raf_qa, ...(g === "sprint" ? [c.start.raf_dev, c.start.raf_qa] : [])]));
    const stepRaw = vmax / 4, mag = 10 ** Math.floor(Math.log10(stepRaw));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= stepRaw);
    const ymax = step * Math.ceil(vmax / step);
    const y = (v) => T + (H - T - B) * (1 - v / ymax);

    const [fc] = pts[0], [lc, li] = pts[pts.length - 1];
    const summary = `RAF DEV de ${fmt2(fc.end.raf_dev)} à ${fmt2(lc.end.raf_dev)} JH, RAF QA de ${fmt2(fc.end.raf_qa)} à ${fmt2(lc.end.raf_qa)} JH, du ${fc.label} ${fc.sub} au ${lc.label} ${lc.sub}`;
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary)}">`;
    for (let v = 0; v <= ymax + EPS; v += step) {
      svg += `<line class="grid-l" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>` +
        `<text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString("fr-FR")}</text>`;
    }
    // Libellés de l'axe X : au plus ~12
    const every = Math.max(1, Math.ceil(n / 12));
    cols.forEach((c, i) => {
      if (c.ref) svg += `<rect class="ref-band" x="${x(i) - (W - L - R) / n / 2}" y="${T}" width="${(W - L - R) / n}" height="${H - T - B}"/>`;
      if (c.today) svg += `<line class="today-l" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/>`;
      if (c.mark) svg += `<line class="ms-l" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/><text class="ms-t" x="${x(i) + 4}" y="${T + 8}">${c.mark}</text>`;
      if (i % every === 0 || c.today || c.ref) {
        svg += `<text class="axis ${c.today ? "strong" : ""}" x="${x(i)}" y="${H - 18}" text-anchor="middle">${esc(c.label)}</text>` +
          `<text class="axis" x="${x(i)}" y="${H - 4}" text-anchor="middle">${esc(c.sub.split(" → ")[0])}</text>`;
      }
    });
    // Lignes interrompues quand un jour n'a pas de relevé
    for (const [k, cls] of [["raf_dev", "dev"], ["raf_qa", "qa"]]) {
      let d = "", prevI = -2;
      for (const [c, i] of pts) { d += `${i === prevI + 1 ? "L" : "M"}${x(i).toFixed(1)},${y(c.end[k]).toFixed(1)}`; prevI = i; }
      svg += `<path class="ln-${cls}" fill="none" d="${d}"/>` + pts.map(([c, i]) => `<circle class="pt-${cls}" cx="${x(i)}" cy="${y(c.end[k])}" r="4"/>`).join("");
    }
    // Étiquettes directes en bout de courbe, écartées si elles se chevauchent
    let yd = y(lc.end.raf_dev) + 4, yq = y(lc.end.raf_qa) + 4;
    if (Math.abs(yd - yq) < 14) { const mid = (yd + yq) / 2, up = lc.end.raf_dev >= lc.end.raf_qa; yd = mid + (up ? -7 : 7); yq = mid + (up ? 7 : -7); }
    svg += `<text class="dlabel" x="${x(li) + 8}" y="${yd}">DEV ${fmt2(lc.end.raf_dev)}</text>` +
      `<text class="dlabel" x="${x(li) + 8}" y="${yq}">QA ${fmt2(lc.end.raf_qa)}</text>`;
    svg += `<line id="xhair" class="xhair" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
    svg += `<rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></svg>`;
    el.innerHTML = svg;

    const tip = $("evoTip"), hit = el.querySelector(".hit"), xh = el.querySelector("#xhair");
    const colAt = (e) => {
      const i = Math.floor(((e.clientX - el.getBoundingClientRect().left - L) / (W - L - R)) * n);
      return Math.max(0, Math.min(n - 1, i));
    };
    const show = (i) => {
      const c = cols[i], b = bases[i];
      state.chartCur = i;
      xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.setAttribute("visibility", "visible");
      const line = (k, cls, lbl) => `<div><span class="sw ${cls}"></span>RAF ${lbl} <b>${fmt2(c.end[k])}</b> JH ${b ? signed(c.end[k] - b[k]) : ""}</div>`;
      tip.innerHTML = `<b>${esc(c.label)} ${esc(c.sub)}</b>` + (c.end
        ? line("raf_dev", "dev", "DEV") + line("raf_qa", "qa", "QA") +
          `<div class="muted">${c.end.done} / ${c.end.total} tâches terminées · ${c.end.late} en retard</div>` +
          (c.refDay && !c.ref ? `<div class="muted">Clic ou Entrée : comparer avec ce relevé</div>` : "")
        : `<div class="muted">${c.future ? "À venir" : "Pas de relevé"}</div>`);
      tip.hidden = false;
      const left = x(i) + 12 + tip.offsetWidth > W ? x(i) - tip.offsetWidth - 12 : x(i) + 12;
      tip.style.left = el.offsetLeft + left + "px"; tip.style.top = el.offsetTop + T + "px";
      hit.style.cursor = c.refDay ? "pointer" : "crosshair";
    };
    const hide = () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); };
    chart = { n, cols, show, hide, last: li };
    hit.addEventListener("mousemove", (e) => show(colAt(e)));
    hit.addEventListener("mouseleave", () => { if (document.activeElement !== el) hide(); });
    hit.addEventListener("click", (e) => { const c = cols[colAt(e)]; if (c.refDay) setRef(c.refDay); });
    if (document.activeElement === el) show(Math.min(state.chartCur ?? li, n - 1));
  }

  // ---------- suivi du RAF : tableau par jour / semaine / sprint
  async function loadSprints(f) {
    const key = serverParams(f);
    if (key === state.sprintKey) return;
    state.sprintKey = key;
    try {
      const data = await getJson("/api/history/sprints" + (key ? "?" + key : ""));
      if (state.sprintKey !== key) return;
      state.sprints = data.sprints;
      renderCmpSelect(); renderRaf();
    } catch (e) {
      state.sprintKey = null;
      notify(`Historique des sprints indisponible : ${endDot(why(e))}`, retryHistory);
    }
  }

  function weekNo(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  }
  const mondayOf = (iso) => { const d = parse(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoOf(d); };

  // Jours du sprint courant : jours ouvrés du premier relevé (ou du début du sprint) à la fin de test.
  // Les jours antérieurs au premier relevé n'apportent rien : on ne les affiche pas.
  function sprintDates() {
    const m = state.meta, snapDays = state.days.map((d) => d.day);
    const start = snapDays.length && (!m.sprint_start || snapDays[0] > m.sprint_start) ? snapDays[0] : m.sprint_start;
    const bounds = [start, m.fin_test, ...snapDays].filter(Boolean).sort();
    if (!bounds.length) return [];
    const out = [], has = new Set(snapDays);
    for (const d = parse(bounds[0]), end = parse(bounds[bounds.length - 1]); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = isoOf(d);
      if (isWorkday(d) || has.has(iso)) out.push(iso);
    }
    return out;
  }

  // Colonnes communes au tableau et à la courbe. refDay = relevé utilisable comme point de comparaison.
  function rafColumns() {
    const m = state.meta, today = m.today, byDay = new Map(state.days.map((d) => [d.day, d]));
    const mark = (isos) => [isos.includes(m.freeze_code) && "Freeze", isos.includes(m.fin_test) && "Fin test"].filter(Boolean).join(" · ");
    const past = (d) => (d && d < today ? d : null);
    if (state.gran === "sprint") {
      return state.sprints.map((s) => ({
        label: s.sprint, sub: `${fmtDate(s.first_day)} → ${fmtDate(s.last_day)}`,
        start: s.start, end: s.end, today: s.sprint === m.sprint, refDay: past(s.last_day),
        ref: s.sprint !== m.sprint && state.cmpDay === s.last_day,
      }));
    }
    if (state.gran === "jour") {
      return sprintDates().map((iso) => ({
        label: parse(iso).toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", ""), sub: fmtDate(iso),
        end: byDay.get(iso) || null, day: iso, future: iso > today, today: iso === today, mark: mark([iso]),
        refDay: byDay.has(iso) ? past(iso) : null, ref: iso === state.cmpDay,
      }));
    }
    const weeks = new Map();
    for (const iso of sprintDates()) { const k = mondayOf(iso); if (!weeks.has(k)) weeks.set(k, []); weeks.get(k).push(iso); }
    return [...weeks.values()].map((ds) => {
      const snaps = ds.map((d) => byDay.get(d)).filter(Boolean), last = snaps[snaps.length - 1];
      return {
        label: `S${weekNo(parse(ds[0]))}`, sub: `${fmtDate(ds[0])} → ${fmtDate(ds[ds.length - 1])}`,
        start: snaps[0] || null, end: last || null, future: ds[0] > today, today: ds.includes(today), mark: mark(ds),
        refDay: past(last?.day), ref: ds.includes(state.cmpDay),
      };
    });
  }

  // Base de l'écart de chaque colonne : relevé précédent (jour/semaine) ou début du sprint (sprint)
  function rafBases(cols) {
    if (state.gran === "sprint") return cols.map((c) => c.start);
    let prev = null;
    return cols.map((c) => {
      if (!c.end) return null;
      const b = prev || (state.gran === "semaine" && c.start !== c.end ? c.start : null);
      prev = c.end;
      return b;
    });
  }

  function renderRaf() {
    const cols = rafColumns(), bases = rafBases(cols);
    document.querySelectorAll("#gran button").forEach((b) => { const on = b.dataset.g === state.gran; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    document.querySelectorAll("#aff button").forEach((b) => { const on = b.dataset.a === state.aff; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    $("rafTableView").hidden = state.aff !== "tableau";
    $("rafChartView").hidden = state.aff !== "courbe";
    if (state.evoCollapsed) return; // rien à dessiner tant que le détail est replié
    if (state.aff === "courbe") renderChart(cols, bases); else renderRafTable(cols, bases);
  }

  function renderRafTable(cols, bases) {
    const g = state.gran;
    if (!cols.length) { $("rafTable").innerHTML = ""; $("rafNote").textContent = "Pas encore d'historique."; return; }
    const cls = (c) => [c.future && "future", c.today && "today", c.ref && "ref"].filter(Boolean).join(" ");
    const head = `<thead><tr><th class="rowh"></th>${cols.map((c) => {
      const inner = `<span class="c-lbl">${esc(c.label)}</span><span class="c-sub">${esc(c.sub)}</span>` +
        `${c.mark ? `<span class="c-mark">${c.mark}</span>` : ""}${c.ref ? `<span class="c-ref">réf.</span>` : ""}`;
      return `<th class="num ${cls(c)}">` + (c.refDay
        ? `<button type="button" class="pick" data-ref="${c.refDay}" aria-pressed="${!!c.ref}" data-fk="ref:${c.refDay}" title="Comparer avec le relevé du ${fmtDate(c.refDay)}">${inner}</button>`
        : inner) + "</th>";
    }).join("")}</tr></thead>`;
    const cell = (c, html, title = "") => `<td class="num ${cls(c)}"${title ? ` title="${esc(title)}"` : ""}>${html}</td>`;
    const missing = (c) => cell(c, c.future ? "" : '<span class="muted">·</span>', c.future ? "" : "Pas de relevé ce jour-là");
    const block = (k, title) => {
      let html = `<tr class="grp"><td colspan="${cols.length + 1}">${title} <span class="muted">(JH)</span></td></tr>`;
      if (g === "sprint") {
        html += `<tr><th class="rowh">RAF début</th>${cols.map((c) => cell(c, fmt2(c.start[k]))).join("")}</tr>`;
        html += `<tr><th class="rowh">RAF fin</th>${cols.map((c) => cell(c, `<b>${fmt2(c.end[k])}</b>`, c.today ? "Sprint en cours : valeur du jour" : "")).join("")}</tr>`;
        html += `<tr><th class="rowh">Variation</th>${cols.map((c) => cell(c, signed(c.end[k] - c.start[k], "RAF fin − RAF début"))).join("")}</tr>`;
        return html;
      }
      html += `<tr><th class="rowh">RAF</th>${cols.map((c) => (c.end ? cell(c, `<b>${fmt2(c.end[k])}</b>`) : missing(c))).join("")}</tr>`;
      html += `<tr><th class="rowh">Variation</th>${cols.map((c, i) => {
        if (!c.end) return missing(c);
        const b = bases[i];
        return b ? cell(c, signed(c.end[k] - b[k], `vs ${fmtDate(b.day)}`)) : cell(c, '<span class="muted">–</span>');
      }).join("")}</tr>`;
      return html;
    };
    $("rafTable").innerHTML = head + "<tbody>" + block("raf_dev", "DEV") + block("raf_qa", "QA") + "</tbody>";
  }

  function rafNote() {
    const g = state.gran, first = state.days[0]?.day;
    $("rafNote").innerHTML = {
      jour: "RAF en fin de journée (dernier relevé du jour). Variation = depuis le relevé précédent.",
      semaine: "RAF au dernier relevé de la semaine. Variation = depuis la semaine précédente (ou depuis le début de la semaine).",
      sprint: "Un relevé par sprint enregistré : premier et dernier jour. Le sprint en cours affiche la valeur du jour.",
    }[g] + ` <span class="dl good">−</span> le RAF baisse, <span class="dl bad">+</span> il augmente.` +
      (g !== "sprint" && first && state.meta.sprint_start && first > state.meta.sprint_start ? ` Historique disponible depuis le ${fmtDate(first)}.` : "") +
      " Sélectionner une colonne pour en faire la référence des changements ci-dessous.";
  }

  // Résumé d'une ligne affiché quand le détail du suivi est replié
  function evoStrip() {
    const ds = state.days, el = $("evoStrip");
    if (!ds.length) { el.textContent = "Reste à faire DEV et QA, jour après jour"; return; }
    const last = ds[ds.length - 1], prev = ds[ds.length - 2];
    const part = (k, l) => `${l} <b>${fmt2(last[k])}</b> JH${prev ? " " + signed(last[k] - prev[k]) : ""}`;
    const chg = state.chgCount == null ? "" : ` · <b>${plural(state.chgCount, "changement", "changements")}</b> <span>vs ${fmtDate(state.cmpDay)}</span>`;
    el.innerHTML = `${part("raf_dev", "DEV")} · ${part("raf_qa", "QA")}${prev ? ` <span>depuis le ${fmtDate(prev.day)}</span>` : ""}${chg}`;
  }

  function setRef(day) {
    if (!day || day === state.cmpDay) return;
    state.cmpDay = day; state.ref = null; renderCmpSelect(); loadRef();
  }

  function renderEvolution(f, rows, refRows) {
    $("evo").hidden = !state.meta.history_enabled;
    if (!state.meta.history_enabled) return;
    $("evoBody").hidden = state.evoCollapsed;
    $("evoToggle").setAttribute("aria-expanded", !state.evoCollapsed);
    $("evoHint").textContent = state.evoCollapsed ? "Voir le détail jour par jour" : "Réduire";
    document.querySelectorAll("#gran, #aff").forEach((el) => (el.hidden = state.evoCollapsed));
    loadHistory(f);
    if (state.gran === "sprint") loadSprints(f);
    renderRaf(); rafNote();
    renderChanges(rows, refRows); evoStrip();
  }

  function render() {
    // Le rendu remplace le HTML des tableaux : on rend le focus clavier à l'élément équivalent
    const fk = document.activeElement?.dataset?.fk;
    let f = readFilters();
    fillSelects(f);
    f = readFilters();
    writeUrl(f);
    const rows = state.rows.filter((r) => matches(r, f));
    const refRows = state.ref ? state.ref.filter((r) => matches(r, f)) : null;
    // Filtres actifs : sélecteurs mis en évidence + compteur
    FILTERS.forEach((k) => $("f-" + k).classList.toggle("set", !!f[k]));
    const nActive = FILTERS.filter((k) => f[k]).length + (f.q ? 1 : 0) + (f.alerts ? 1 : 0) + (f.hideDone ? 1 : 0);
    $("fCount").innerHTML = nActive
      ? `<b>${plural(nActive, "filtre", "filtres")}</b> · ${rows.length} / ${state.rows.length} tâches`
      : `${state.rows.length} tâches`;
    $("reset").hidden = !nActive;
    renderMini(f, nActive, rows.length);
    // Verdict et changements ignorent « masquer terminées » : le RAF d'une tâche terminée compte toujours
    const all = { ...f, hideDone: false };
    state.allF = all;
    state.allRows = state.rows.filter((r) => matches(r, all));
    renderVerdict(state.allRows);
    renderKpis(rows, refRows); renderGrid(rows); renderSide(rows, refRows);
    renderEvolution(f, state.allRows, state.ref ? state.ref.filter((r) => matches(r, all)) : null);
    if (fk) {
      const el = document.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
      if (el && el !== document.activeElement) el.focus({ preventScroll: true });
    }
  }

  // Barre compacte : un bouton par filtre actif, qui le retire
  const F_LABELS = { chantier: "Chantier", feat: "FEAT", assignee: "Personne", status: "État", type_charge: "Type" };
  function renderMini(f, nActive, n) {
    const chip = (k, txt) => `<button type="button" class="f-chip" data-clear="${k}" data-fk="clear:${k}" title="Retirer ce filtre" aria-label="Retirer le filtre ${esc(txt)}"><span>${esc(txt)}</span>${icon("close")}</button>`;
    $("fChips").innerHTML = nActive
      ? FILTERS.filter((k) => f[k]).map((k) => chip(k, `${F_LABELS[k]} : ${f[k]}`)).join("") +
        (f.q ? chip("q", `« ${f.q} »`) : "") + (f.alerts ? chip("alerts", "Avec alertes") : "") + (f.hideDone ? chip("hideDone", "Terminées masquées") : "")
      : `<span class="muted">Aucun filtre</span>`;
    $("fN").hidden = !nActive;
    $("fN").textContent = nActive;
    $("fMiniCount").innerHTML = nActive ? `<b>${n}</b> / ${plural(state.rows.length, "tâche", "tâches")}` : plural(state.rows.length, "tâche", "tâches");
  }
  function clearFilter(k) {
    if (FILTERS.includes(k)) $("f-" + k).value = "";
    else if (k === "q") $("f-q").value = "";
    else $("f-" + k).checked = false;
    render();
  }

  // ---------- données
  function showLoading() {
    $("loadingCard").removeAttribute("role");
    $("loadingCard").innerHTML = `<div class="spinner" aria-hidden="true"></div><span>Chargement des tâches…</span>`;
    $("loading").hidden = false;
  }
  function showLoadError(msg) {
    const c = $("loadingCard");
    c.setAttribute("role", "alert");
    c.innerHTML = `${icon("alert", "le-ico")}<div class="le">
        <b>Impossible de charger les tâches</b>
        <p></p>
        <p class="muted">Avec la source Jira, vérifier la connexion VPN ou le Wi-Fi entreprise, puis réessayer.</p>
        <button type="button" class="btn primary" id="retryLoad">Réessayer</button>
      </div>`;
    c.querySelector(".le p").textContent = endDot(msg.charAt(0).toUpperCase() + msg.slice(1));
    $("loading").hidden = false;
    $("retryLoad").addEventListener("click", () => load(true));
    $("retryLoad").focus();
  }
  // Données conservées mais plus fraîches : bandeau persistant jusqu'à la prochaine lecture réussie
  function showStale(msg) {
    const at = state.meta.generated_at ? state.meta.generated_at.slice(11, 16) : "";
    $("stale").innerHTML = `${icon("alert")}<span><b>Données de ${at} affichées.</b> Actualisation impossible : ${esc(msg)}.</span>
      <button type="button" class="btn small" id="staleRetry">Réessayer</button>`;
    $("stale").hidden = false;
    $("staleRetry").addEventListener("click", () => load(true));
  }

  async function load(refresh = false) {
    const btn = $("refresh"), first = !state.rows.length;
    btn.disabled = true;
    $("main").setAttribute("aria-busy", "true");
    if (first) showLoading();
    try {
      const data = await getJson("/api/reporting-tasks" + (refresh ? "?refresh=true" : ""));
      state.rows = data.rows; state.meta = data.meta;
      state.histKey = state.sprintKey = null; // la photo du jour vient d'être mise à jour : on relit l'historique
      $("stale").hidden = true;
      $("loading").hidden = true;
      renderSprint(); render();
      if (refresh) { $("lastSync").textContent = "Actualisé à " + state.meta.generated_at.slice(11, 16); $("lastSync").classList.add("flash"); }
    } catch (e) {
      if (first) showLoadError(why(e)); else showStale(why(e));
    } finally {
      btn.disabled = false;
      $("main").removeAttribute("aria-busy");
      scheduleAuto();
    }
  }
  function scheduleAuto() {
    clearTimeout(state.autoTimer);
    const s = Math.max(60, state.meta.cache_ttl_s || 120);
    state.autoTimer = setTimeout(() => { if (!document.hidden) load(false); else scheduleAuto(); }, s * 1000);
  }

  // ---------- événements
  const resetFilters = () => {
    FILTERS.forEach((k) => ($("f-" + k).value = "")); $("f-q").value = ""; $("f-alerts").checked = false; $("f-hideDone").checked = false; render();
  };
  FILTERS.forEach((k) => $("f-" + k).addEventListener("change", render));
  ["f-alerts", "f-hideDone"].forEach((id) => $(id).addEventListener("change", render));
  let qt; $("f-q").addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(render, 200); });
  $("reset").addEventListener("click", resetFilters);
  // Nom de chantier dans le verdict : filtre la page sur ce chantier
  $("sprint").addEventListener("click", (e) => {
    // déplier / replier l'explication d'un état, sans redessiner (le focus reste sur le bouton)
    const w = e.target.closest(".vd-why");
    if (w) {
      const open = !state.vdOpen.has(w.dataset.vd);
      open ? state.vdOpen.add(w.dataset.vd) : state.vdOpen.delete(w.dataset.vd);
      w.setAttribute("aria-expanded", open);
      document.getElementById(w.getAttribute("aria-controls")).hidden = !open;
      return;
    }
    const b = e.target.closest(".vd-ch"); if (!b) return;
    $("f-chantier").value = b.dataset.ch; render();
  });
  $("emptyReset").addEventListener("click", resetFilters);
  $("refresh").addEventListener("click", () => load(true));
  $("lastSync").addEventListener("animationend", () => $("lastSync").classList.remove("flash"));
  $("toast").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act; if (!act) return;
    $("toast").hidden = true;
    if (act === "retry") notify.retry?.();
  });
  // Ligne d'US : clic sur la ligne, ou bouton déplier/replier (clavier)
  $("rows").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const tr = e.target.closest("tr.us"); if (!tr) return;
    const id = tr.dataset.id; state.collapsed.has(id) ? state.collapsed.delete(id) : state.collapsed.add(id); render();
  });
  $("expandAll").addEventListener("click", () => { state.collapsed.clear(); render(); });
  $("collapseAll").addEventListener("click", () => {
    document.querySelectorAll("tr.us").forEach((tr) => state.collapsed.add(tr.dataset.id)); render();
  });
  $("gran").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.gran = b.dataset.g; render();
  });
  $("aff").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.aff = b.dataset.a; render();
  });
  $("rafTable").addEventListener("click", (e) => { const b = e.target.closest("[data-ref]"); if (b) setRef(b.dataset.ref); });
  $("cmp-day").addEventListener("change", (e) => setRef(e.target.value));
  $("chgSummary").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    state.chgKind = b.dataset.kind; render();
  });
  $("evoToggle").addEventListener("click", () => {
    state.evoCollapsed = !state.evoCollapsed; render();
  });
  // Courbe au clavier
  const evoChart = $("evoChart");
  evoChart.addEventListener("focus", () => chart && chart.show(Math.min(state.chartCur ?? chart.last, chart.n - 1)));
  evoChart.addEventListener("blur", () => chart && chart.hide());
  evoChart.addEventListener("keydown", (e) => {
    if (!chart) return;
    const cur = state.chartCur ?? chart.last;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      chart.show(Math.max(0, Math.min(chart.n - 1, cur + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault(); chart.show(e.key === "Home" ? 0 : chart.n - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const c = chart.cols[cur]; if (c?.refDay) setRef(c.refDay);
    } else if (e.key === "Escape") chart.hide();
  });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => state.aff === "courbe" && renderRaf(), 150); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.meta.generated_at) scheduleAuto(); });

  // Filtres toujours accessibles : quand le bloc complet sort de l'écran, une barre compacte prend le relais
  // sous l'en-tête ; « Filtres » y rouvre le bloc complet en surimpression, sans perdre la position de lecture.
  const topbar = document.querySelector(".topbar"), slot = $("fSlot"), fCard = $("filters"), mini = $("fMini"), fOpen = $("fOpen");
  const phone = matchMedia("(max-width: 700px)");
  // hauteur de l'en-tête collant (0 sur téléphone, où il défile avec la page : la barre de filtres prend le haut)
  new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h",
    (getComputedStyle(topbar).position === "sticky" ? topbar.offsetHeight : 0) + "px")).observe(topbar);
  const popOpen = () => fCard.classList.contains("pop");
  function setPop(open, focusBack) {
    if (open === popOpen()) return;
    // Le bloc sort du flux : on fige la hauteur de son emplacement pour que la page ne saute pas
    slot.style.height = open && !phone.matches ? slot.offsetHeight + "px" : "";
    fCard.classList.toggle("pop", open);
    fOpen.setAttribute("aria-expanded", open);
    if (open) fCard.querySelector("select, input")?.focus({ preventScroll: true });
    else if (focusBack) fOpen.focus();
  }
  function syncMini() {
    const out = phone.matches || slot.getBoundingClientRect().bottom < topbar.offsetHeight + 4;
    mini.classList.toggle("on", out);
    if (!out) setPop(false);
  }
  let sf; window.addEventListener("scroll", () => { cancelAnimationFrame(sf); sf = requestAnimationFrame(syncMini); }, { passive: true });
  phone.addEventListener("change", () => { setPop(false); syncMini(); });
  fOpen.addEventListener("click", () => setPop(!popOpen()));
  $("fChips").addEventListener("click", (e) => { const b = e.target.closest("[data-clear]"); if (b) clearFilter(b.dataset.clear); });
  document.addEventListener("mousedown", (e) => { if (popOpen() && !fCard.contains(e.target) && !fOpen.contains(e.target)) setPop(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && popOpen()) { setPop(false, true); return; }
    // « / » : aller à la recherche depuis n'importe où
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest("input, select, textarea, [contenteditable]")) {
      e.preventDefault();
      if (mini.classList.contains("on")) setPop(true);
      $("f-q").focus(); $("f-q").select();
    }
  });
  syncMini();

  // Mode focus : un bloc passe en grand, par-dessus la page ; Échap, clic à côté ou « Réduire » pour revenir
  let focused = null;
  function setFocus(el) {
    const prev = focused;
    const swapBtn = (panel, on) => { const b = panel.querySelector("[data-focus]"); if (b) b.outerHTML = focusBtn(on); };
    if (prev) { prev.classList.remove("focused"); swapBtn(prev, false); }
    focused = el && el !== prev ? el : null;
    if (focused) {
      focused.classList.add("focused");
      swapBtn(focused, true);
      // Le suivi du RAF n'a d'intérêt en grand que déplié
      if (focused.id === "evo" && state.evoCollapsed) { state.evoCollapsed = false; render(); }
    }
    $("focusBackdrop").hidden = !focused;
    document.documentElement.classList.toggle("has-focus", !!focused);
    if (state.aff === "courbe") renderRaf(); // la courbe se redessine à la nouvelle largeur
    (focused || prev)?.querySelector("[data-focus]")?.focus({ preventScroll: true });
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-focus]");
    if (b) setFocus(b.closest(".panel, .card"));
  });
  $("focusBackdrop").addEventListener("click", () => setFocus(null));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && focused && !popOpen()) { e.preventDefault(); setFocus(null); }
  });

  applyUrl();
  load();
})();
