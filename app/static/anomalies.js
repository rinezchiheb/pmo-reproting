/* PMO Reporting — Pilotage « Anomalies » : bogues (BUG) et anomalies de test US (ANO) du sprint (JS natif).
   Récapitulatif, évolution d'après les relevés quotidiens, coût de la non-qualité, liste. Données : /api/anomalies. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 1) => (n ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtDate = (iso) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const sprintName = (n) => (/sprint/i.test(n || "") ? n : `Sprint ${n || "—"}`);
  const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5);
  const LF = window.ListFilter;
  const TYPES = { BUG: "Bogues", ANO: "Anomalies de test" };

  const URLP = new URLSearchParams(location.search);
  const state = {
    data: null, list: "open", q: "",
    f: { ch: URLP.get("ch") || "", who: URLP.get("who") || "", type: ["BUG", "ANO"].includes(URLP.get("type")) ? URLP.get("type") : "" },
  };

  function statusClass(s) {
    const x = (s || "").toLowerCase();
    if (["fini", "fermée", "résolue", "done", "closed"].includes(x)) return "s-fini";
    if (x.includes("blocked") || x.includes("bloqu")) return "s-blocked";
    if (x.includes("progress") || x.includes("running")) return "s-progress";
    if (x.includes("ready for qa") || x.includes("merge")) return "s-review";
    return "";
  }
  const pill = (s) => (s ? `<span class="pill ${statusClass(s)}">${esc(s)}</span>` : "");
  const ok = (x) => (!state.f.ch || x.chantier === state.f.ch || x.ch === state.f.ch) && (!state.f.who || (x.assignee ?? x.who) === state.f.who) && (!state.f.type || (x.type_charge ?? x.t) === state.f.type);
  // anomalie bloquante : liée à une US du sprint par un lien « Bloque »
  const blocking = (r) => (r.linked_us || []).some((u) => u.rel === "Bloque");
  const age = (r) => (r.created ? daysBetween(r.created, r.done && r.resolved ? r.resolved : state.data.today) : null);

  function writeUrl() {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(state.f)) v ? p.set(k, v) : p.delete(k);
    history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : ""));
  }
  function fillSelects() {
    const it = state.data.items;
    const opt = (id, vals, want, all) => {
      const list = [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
      if (want && !list.includes(want)) list.unshift(want);
      $(id).innerHTML = `<option value="">${all}</option>` + list.map((v) => `<option ${v === want ? "selected" : ""}>${esc(v)}</option>`).join("");
      $(id).classList.toggle("set", !!want);
    };
    opt("f-ch", [...it.map((r) => r.chantier), ...Object.keys(state.data.ref)].filter((c) => c !== "(Sans chantier)" || it.some((r) => r.chantier === c)), state.f.ch, "Tous");
    window.Pilotage.fillPeople("f-who", it.map((r) => r.assignee), state.f.who, "Toutes");
    $("f-type").value = state.f.type;
    $("f-type").classList.toggle("set", !!state.f.type);
  }
  const sum = (list, k) => list.reduce((a, r) => a + (r[k] || 0), 0);
  const rafOf = (r) => (r.done ? 0 : r.raf_hj || 0);

  function render() {
    const d = state.data, m = d.meta;
    fillSelects();
    writeUrl();
    const items = d.items.filter(ok);
    const open = items.filter((r) => !r.done), closed = items.filter((r) => r.done);
    const spent = sum(items, "spent_hj"), est = sum(items, "estim_hj"), raf = open.reduce((a, r) => a + rafOf(r), 0);
    // référence : développement et US des chantiers retenus (le filtre personne ne s'applique pas à la référence)
    const refs = Object.entries(d.ref).filter(([ch]) => !state.f.ch || ch === state.f.ch).map(([, v]) => v);
    const devSpent = refs.reduce((a, v) => a + v.dev_spent, 0), usN = refs.reduce((a, v) => a + v.us, 0);
    const anoN = items.filter((r) => r.type_charge === "ANO").length;
    const block = open.filter(blocking);
    const ages = open.map(age).filter((x) => x != null);
    const delays = closed.map(age).filter((x) => x != null);
    const series = d.series.map((s) => ({ day: s.day, g: s.groups.filter(ok) }));
    const lastS = series[series.length - 1], prevS = series[series.length - 2];

    $("anSub").textContent = `${sprintName(m.sprint)} · au ${fmtDate(d.today)}${state.f.type ? ` · ${TYPES[state.f.type]}` : ""}${state.f.ch ? ` · ${state.f.ch}` : ""}${state.f.who ? ` · ${state.f.who}` : ""}`;

    // ---- indicateurs
    const kpi = (lbl, val, sub, cls = "") => `<div class="kpi ${cls}"><span class="lbl">${lbl}</span><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
    const nBug = items.filter((r) => r.type_charge === "BUG").length;
    const cost = devSpent > 0.05 ? (100 * spent) / devSpent : null;
    const newN = lastS && prevS ? sum(lastS.g, "new") : null, closedN = lastS && prevS ? sum(lastS.g, "closed") : null;
    $("anKpis").innerHTML =
      kpi("Anomalies", `${items.length}`, `<b>${nBug}</b> bogue${nBug > 1 ? "s" : ""} · <b>${anoN}</b> anomalie${anoN > 1 ? "s" : ""} de test`) +
      kpi("Ouvertes", `${open.length}`, `${block.length ? `<b>${block.length}</b> bloquent une US · ` : ""}${ages.length ? `âge moyen ${num(ages.reduce((a, b) => a + b, 0) / ages.length, 0)} j` : "à corriger ou à retester"}`, block.length ? "danger" : open.length ? "warn" : "") +
      kpi("Closes", `${closed.length}`, items.length ? `${num((100 * closed.length) / items.length, 0)} % résolues${delays.length ? ` · délai moyen ${num(delays.reduce((a, b) => a + b, 0) / delays.length, 0)} j` : ""}` : "—") +
      kpi("Temps consommé", `${num(spent)}<small>JH</small>`, items.length ? `${num(spent / items.length, 2)} JH par anomalie · estimé ${num(est)} JH` : "—", est > 0.05 && spent > est * 1.2 ? "warn" : "") +
      kpi("Reste à faire", `${num(raf)}<small>JH</small>`, `sur ${plural(open.length, "anomalie ouverte", "anomalies ouvertes")}`) +
      kpi("Coût de la non-qualité", cost == null ? "—" : `${num(cost, 0)} %`, `${num(spent)} JH d'anomalies pour ${num(devSpent)} JH de développement`, cost != null && cost > 25 ? "danger" : cost != null && cost > 15 ? "warn" : "") +
      kpi("Densité", usN ? `${num(anoN / usN, 2)}` : "—", usN ? `anomalie de test par US (${plural(usN, "US", "US")})` : "aucune US de référence") +
      kpi("Dernier relevé", newN == null ? "—" : `+${newN}<small>nouvelle${newN > 1 ? "s" : ""}</small>`, newN == null ? "un seul relevé pour l'instant" : `${closedN} close${closedN > 1 ? "s" : ""} depuis le ${fmtDate(prevS.day)}`);

    // ---- points d'attention
    const attn = [], keys = (list) => list.slice(0, 4).map((r) => esc(r.key)).join(", ") + (list.length > 4 ? "…" : "");
    const stuck = open.filter((r) => statusClass(r.status) === "s-blocked");
    if (stuck.length) attn.push({ lvl: "danger", txt: `${plural(stuck.length, "anomalie bloquée", "anomalies bloquées")} (statut Blocked) : ${keys(stuck)}.` });
    if (block.length) attn.push({ lvl: "danger", txt: `${plural(block.length, "anomalie ouverte bloque", "anomalies ouvertes bloquent")} une US : ${keys(block)}.` });
    const old = open.filter((r) => (age(r) ?? 0) > 5).sort((a, b) => age(b) - age(a));
    if (old.length) attn.push({ lvl: "warn", txt: `${plural(old.length, "anomalie ouverte depuis", "anomalies ouvertes depuis")} plus de 5 jours : ${old.slice(0, 4).map((r) => `${esc(r.key)} (${age(r)} j)`).join(", ")}${old.length > 4 ? "…" : ""}.` });
    const over = items.filter((r) => r.estim_hj > 0.05 && r.spent_hj + rafOf(r) > r.estim_hj * 1.2 + 0.05);
    if (over.length) attn.push({ lvl: "warn", txt: `${over.length > 1 ? `${over.length} anomalies dépassent leur` : "1 anomalie dépasse son"} estimation de plus de 20 % : ${keys(over)}.` });
    const noEst = open.filter((r) => !(r.estim_hj > 0) && !(r.raf_hj > 0));
    if (noEst.length) attn.push({ lvl: "info", txt: `${plural(noEst.length, "anomalie ouverte sans estimation", "anomalies ouvertes sans estimation")} : ${keys(noEst)}.` });
    const unassigned = open.filter((r) => !r.assignee);
    if (unassigned.length) attn.push({ lvl: "warn", txt: `${plural(unassigned.length, "anomalie ouverte non assignée", "anomalies ouvertes non assignées")} : ${keys(unassigned)}.` });
    const noTime = closed.filter((r) => !(r.spent_hj > 0));
    if (noTime.length) attn.push({ lvl: "info", txt: `${plural(noTime.length, "anomalie close sans temps saisi", "anomalies closes sans temps saisi")} : ${keys(noTime)} (temps de correction non mesuré).` });
    const rafDone = closed.filter((r) => r.raf_residuel > 0);
    if (rafDone.length) attn.push({ lvl: "info", txt: `Reste à faire non soldé sur ${plural(rafDone.length, "anomalie close", "anomalies closes")} : ${keys(rafDone)}.` });
    const reopened = series.length > 1 ? series.slice(1).reduce((a, s) => a + sum(s.g, "reopened"), 0) : 0;
    if (reopened) attn.push({ lvl: "warn", txt: `${plural(reopened, "réouverture", "réouvertures")} d'anomalie depuis le début des relevés.` });
    if (!attn.length) attn.push({ lvl: "ok", txt: items.length ? "Aucun point d'attention : anomalies estimées, assignées et sans blocage." : "Aucune anomalie dans le sprint pour ces filtres." });
    $("anAttn").innerHTML = attn.map((a) => `<li class="${a.lvl}">${a.txt}</li>`).join("");

    renderEvo(series);
    renderCh(items);
    renderWho(items);
    renderList(items);
  }

  // ---- au fil du sprint : ouvertes / closes (barres empilées) et consommé cumulé (ligne, axe de droite)
  function renderEvo(series) {
    const pts = series.map((s, i) => ({
      day: s.day, first: i === 0, total: sum(s.g, "total"), open: sum(s.g, "open"), done: sum(s.g, "done"),
      nw: sum(s.g, "new"), cl: sum(s.g, "closed"), ro: sum(s.g, "reopened"), spent: sum(s.g, "spent"), raf: sum(s.g, "raf"),
    }));
    pts.forEach((p, i) => { p.dSpent = i ? p.spent - pts[i - 1].spent : null; });
    if (!pts.length) { $("anChart").innerHTML = `<p class="empty">Aucun relevé pour ce sprint.</p>`; $("anEvo").innerHTML = ""; return; }
    const W = 900, H = 230, L = 40, R = 52, T = 14, B = 30, n = pts.length;
    const maxN = Math.max(1, ...pts.map((p) => p.total)) * 1.12, maxJ = Math.max(1, ...pts.map((p) => p.spent)) * 1.12;
    const x = (i) => L + ((W - L - R) * (i + 0.5)) / n, yN = (v) => T + (H - T - B) * (1 - v / maxN), yJ = (v) => T + (H - T - B) * (1 - v / maxJ);
    const bw = Math.min(46, ((W - L - R) / n) * 0.62);
    const ticks = [0, 0.5, 1].map((f) => Math.round(maxN * f / 1.12)).filter((v, i, a) => a.indexOf(v) === i)
      .map((v) => `<line class="g" x1="${L}" x2="${W - R}" y1="${yN(v)}" y2="${yN(v)}"/><text class="ax" x="${L - 6}" y="${yN(v) + 4}" text-anchor="end">${v}</text>`).join("") +
      [0.5, 1].map((f) => maxJ * f / 1.12).map((v) => `<text class="ax" x="${W - R + 6}" y="${yJ(v) + 4}">${num(v, 0)} JH</text>`).join("");
    const bars = pts.map((p, i) => `<g><title>${fmtDate(p.day)} : ${p.open} ouvertes, ${p.done} closes, ${num(p.spent)} JH consommés</title>
      <rect class="b done" x="${(x(i) - bw / 2).toFixed(1)}" y="${yN(p.done).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - B - yN(p.done)).toFixed(1)}"/>
      <rect class="b open" x="${(x(i) - bw / 2).toFixed(1)}" y="${yN(p.total).toFixed(1)}" width="${bw.toFixed(1)}" height="${(yN(p.done) - yN(p.total)).toFixed(1)}" rx="3"/></g>`).join("");
    const line = `<path class="cum" d="${pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yJ(p.spent).toFixed(1)}`).join("")}"/>` + pts.map((p, i) => `<circle class="cum" cx="${x(i).toFixed(1)}" cy="${yJ(p.spent).toFixed(1)}" r="3"/>`).join("");
    const every = Math.max(1, Math.ceil(n / 12));
    const xl = pts.map((p, i) => (i % every === 0 || i === n - 1 ? `<text class="ax" x="${x(i)}" y="${H - 10}" text-anchor="middle">${fmtDate(p.day)}</text>` : "")).join("");
    const last = pts[n - 1];
    $("anChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Au ${fmtDate(last.day)} : ${last.open} anomalies ouvertes, ${last.done} closes, ${num(last.spent)} JH consommés`)}">${ticks}${bars}${line}${xl}</svg>
      <p class="ef-legend muted"><span class="k open"></span>Ouvertes <span class="k done"></span>Closes <span class="k cum"></span>Temps consommé cumulé (axe de droite) · un jour sans relevé n'apparaît pas</p>`;
    const dash = (p, v) => (p.first ? '<span class="muted">—</span>' : v ? `${v}` : '<span class="muted">0</span>');
    $("anEvo").innerHTML = `<thead><tr><th>Relevé</th><th class="num">Total</th><th class="num">Ouvertes</th><th class="num">Closes</th><th class="num">Nouvelles</th><th class="num">Résolues</th><th class="num">Réouvertes</th><th class="num">Consommé</th><th class="num">Consommé cumulé</th><th class="num">Reste à faire</th></tr></thead><tbody>` +
      pts.slice().reverse().map((p) => `<tr><td><b>${fmtDate(p.day)}</b></td><td class="num">${p.total}</td><td class="num">${p.open}</td><td class="num">${p.done}</td>
        <td class="num">${dash(p, p.nw)}</td><td class="num">${dash(p, p.cl)}</td><td class="num">${dash(p, p.ro)}</td>
        <td class="num">${p.dSpent == null ? '<span class="muted">—</span>' : num(p.dSpent, 2)}</td><td class="num"><b>${num(p.spent, 2)}</b></td><td class="num">${num(p.raf, 2)}</td></tr>`).join("") +
      `</tbody><tfoot><tr><td colspan="10" class="muted">Du plus récent au plus ancien, temps en JH. Nouvelles, résolues, réouvertes et consommé : depuis le relevé précédent (consommé = hausse du temps passé Jira).</td></tr></tfoot>`;
  }

  // ---- par chantier
  function renderCh(items) {
    const g = new Map();
    for (const r of items) { if (!g.has(r.chantier)) g.set(r.chantier, []); g.get(r.chantier).push(r); }
    const rows = [...g.entries()].map(([ch, rs]) => {
      const ref = state.data.ref[ch] || { dev_spent: 0, us: 0 }, spent = sum(rs, "spent_hj");
      return { ch, rs, spent, cost: ref.dev_spent > 0.05 ? (100 * spent) / ref.dev_spent : null, dens: ref.us ? rs.filter((r) => r.type_charge === "ANO").length / ref.us : null };
    }).sort((a, b) => b.rs.length - a.rs.length);
    $("anCh").innerHTML = `<thead><tr><th>Chantier</th><th class="num">BUG</th><th class="num">ANO</th><th class="num">Ouvertes</th><th class="num">Consommé</th><th class="num">Reste</th><th class="num">Non-qualité</th><th class="num">ANO / US</th></tr></thead><tbody>` +
      (rows.length ? rows.map((x) => `<tr><td><b>${esc(x.ch)}</b></td><td class="num">${x.rs.filter((r) => r.type_charge === "BUG").length}</td><td class="num">${x.rs.filter((r) => r.type_charge === "ANO").length}</td>
        <td class="num">${x.rs.filter((r) => !r.done).length}</td><td class="num"><b>${num(x.spent, 2)}</b></td><td class="num">${num(x.rs.reduce((a, r) => a + rafOf(r), 0), 2)}</td>
        <td class="num">${x.cost == null ? '<span class="muted">—</span>' : `<span class="ef-gap ${x.cost > 25 ? "red" : x.cost > 15 ? "amber" : "ok"}">${num(x.cost, 0)} %</span>`}</td><td class="num">${x.dens == null ? '<span class="muted">—</span>' : num(x.dens, 2)}</td></tr>`).join("")
        : `<tr><td colspan="8" class="empty">Aucune anomalie pour ces filtres.</td></tr>`) + "</tbody>";
  }

  // ---- par personne
  function renderWho(items) {
    const g = new Map();
    for (const r of items) { const k = r.assignee || ""; if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    const rows = [...g.entries()].map(([who, rs]) => ({ who, rs, spent: sum(rs, "spent_hj") })).sort((a, b) => b.spent - a.spent || b.rs.length - a.rs.length);
    $("anWho").innerHTML = `<thead><tr><th>Personne</th><th class="num">Anomalies</th><th class="num">Ouvertes</th><th class="num">Closes</th><th class="num">Consommé</th><th class="num">Par anomalie</th></tr></thead><tbody>` +
      (rows.length ? rows.map((x) => `<tr><td>${x.who ? `<b>${esc(x.who)}</b>` : '<span class="warn-t">Non assignée</span>'}</td><td class="num">${x.rs.length}</td><td class="num">${x.rs.filter((r) => !r.done).length}</td><td class="num">${x.rs.filter((r) => r.done).length}</td>
        <td class="num"><b>${num(x.spent, 2)}</b></td><td class="num">${num(x.spent / x.rs.length, 2)}</td></tr>`).join("")
        : `<tr><td colspan="6" class="empty">Aucune anomalie pour ces filtres.</td></tr>`) + "</tbody>";
  }

  // ---- liste
  function renderList(items) {
    const base = (state.data.meta.jira_base_url || "").replace(/\/$/, "");
    const link = (k, url) => (url || base ? `<a href="${esc(url || `${base}/browse/${k}`)}" target="_blank" rel="noopener">${esc(k)}</a>` : esc(k));
    const inState = items.filter((r) => (state.list === "open" ? !r.done : state.list === "done" ? r.done : true));
    const list = inState.filter((r) => LF.match(`${r.key} ${r.summary} ${r.assignee} ${r.status} ${r.chantier} ${(r.linked_us || []).map((u) => u.key).join(" ")}`, state.q))
      .sort((a, b) => (a.done - b.done) || blocking(b) - blocking(a) || (b.spent_hj || 0) - (a.spent_hj || 0));
    const ageCell = (r) => {
      const a = age(r);
      if (a == null) return `<td class="num muted" title="Date de création inconnue${r.first_seen ? ` ; vue depuis le ${fmtDate(r.first_seen)}` : ""}">—</td>`;
      return `<td class="num${!r.done && a > 5 ? " warn-t" : ""}" title="${r.done ? "Délai de correction (création → résolution)" : "Ouverte depuis (création → aujourd'hui)"}">${a} j<span class="stack">${r.done ? "délai" : "âge"}</span></td>`;
    };
    $("anList").innerHTML = `<thead><tr><th>Anomalie</th><th class="wide">Résumé</th><th>Personne</th><th>État</th><th class="num">Âge</th><th class="num">Consommé</th><th class="num">Estimé</th><th class="num">Reste</th></tr></thead><tbody>` +
      (list.length ? list.map((r) => {
        const us = (r.linked_us || []).map((u) => `${esc(u.rel)} ${link(u.key, u.url)}`).join(" · ");
        const drift = r.estim_hj > 0.05 && r.spent_hj + rafOf(r) > r.estim_hj * 1.2 + 0.05;
        return `<tr class="${r.done ? "done" : ""}"><td><span class="type ${esc(r.type_charge)}">${esc(r.type_charge)}</span> ${link(r.key, r.url)}<span class="stack">${esc(r.chantier)}${r.priority ? ` · ${esc(r.priority)}` : ""}</span></td>
          <td>${esc(r.summary)}${us ? `<span class="stack an-us">${us}</span>` : ""}</td><td>${r.assignee ? esc(r.assignee) : '<span class="warn-t">Non assignée</span>'}</td><td>${pill(r.status)}</td>${ageCell(r)}
          <td class="num"><b class="${drift ? "warn-t" : ""}">${num(r.spent_hj, 2)}</b></td><td class="num">${r.estim_hj > 0 ? num(r.estim_hj, 2) : '<span class="muted">—</span>'}</td><td class="num">${num(rafOf(r), 2)}</td></tr>`;
      }).join("") : inState.length ? LF.noneRow(8, state.q) : `<tr><td colspan="8" class="empty">${state.list === "open" ? "Aucune anomalie ouverte." : "Aucune anomalie."}</td></tr>`) + "</tbody>";
    LF.count("an", list.length, inState.length, state.q);
    document.querySelectorAll("#anState button").forEach((b) => { const on = b.dataset.v === state.list; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  }

  // ---- chargement
  async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || `erreur ${res.status}`);
    return data;
  }
  async function load(refresh = false) {
    const btn = $("refresh"), first = !state.data;
    btn.disabled = true;
    try {
      state.data = await getJson("/api/anomalies" + (refresh ? "?refresh=true" : ""));
      const m = state.data.meta;
      $("source").textContent = m.source === "jira" ? "Jira en direct" : "Démo (Excel)";
      $("source").className = "badge " + (m.source === "jira" ? "live" : "demo");
      $("lastSync").textContent = m.generated_at ? "Mis à jour à " + m.generated_at.slice(11, 16) : "";
      render();
      $("loading").hidden = true; $("stale").hidden = true;
    } catch (e) {
      console.error(e);
      const msg = e instanceof TypeError ? "le serveur ne répond pas" : e.message;
      if (first) {
        const c = $("loadingCard");
        c.setAttribute("role", "alert");
        c.innerHTML = `<div class="le"><b>Impossible de charger les anomalies</b><p></p><p class="muted">Vérifier la connexion VPN ou le Wi-Fi entreprise, puis réessayer.</p><button type="button" class="btn primary" id="retryLoad">Réessayer</button></div>`;
        c.querySelector(".le p").textContent = msg;
        $("retryLoad").addEventListener("click", () => location.reload());
      } else {
        $("stale").innerHTML = `<span><b>Données précédentes affichées.</b> Actualisation impossible : ${esc(msg)}.</span>`;
        $("stale").hidden = false;
      }
    } finally {
      btn.disabled = false;
    }
  }

  $("anFilter").innerHTML = LF.fieldHtml({ key: "an", label: "Filtrer les anomalies", placeholder: "Clé, résumé, personne, US…" });
  let ft;
  document.addEventListener("input", (e) => {
    if (e.target.dataset?.lf !== "an") return;
    state.q = e.target.value;
    clearTimeout(ft); ft = setTimeout(() => state.data && render(), 150);
  });
  ["f-ch", "f-who", "f-type"].forEach((id) => $(id).addEventListener("change", (e) => { state.f[id.slice(2)] = e.target.value; render(); }));
  $("anState").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.list = b.dataset.v; render(); } });
  $("refresh").addEventListener("click", () => load(true));
  load();
})();
