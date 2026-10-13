/* PMO Reporting — Pilotage « Effort » : planifié (estimation initiale) vs consommé + reste à faire (JS natif).
   Par côté DEV / QA (jamais additionnés), puis chantier → FEAT → US → tâche. Calculs : kpi.js (effort). */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const K = window.KPI;
  const num = (n, d = 1) => (n ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const signed = (g) => `${g > 0.05 ? "+" : g < -0.05 ? "−" : ""}${num(Math.abs(g))}`;
  const pctTxt = (p) => (p == null ? "non estimé" : `${p > 0.5 ? "+" : p < -0.5 ? "−" : ""}${Math.abs(Math.round(p))} %`);
  const fmtDate = (iso) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const sprintName = (n) => (/sprint/i.test(n || "") ? n : `Sprint ${n || "—"}`);
  const SIDES = { dev: { lbl: "DEV", long: "Développement", ms: "freeze_code" }, qa: { lbl: "QA", long: "Recette", ms: "fin_test" } };

  // filtres communs du pilotage (adresse) : chantier, personne, profil DEV / QA
  const URLP = new URLSearchParams(location.search);
  const state = {
    tasks: null, hist: null, open: new Set(), opened: false,
    f: { ch: URLP.get("ch") || "", who: URLP.get("who") || "", prof: ["dev", "qa"].includes(URLP.get("prof")) ? URLP.get("prof") : "" },
  };

  async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || `erreur ${res.status}`);
    return data;
  }
  function writeUrl() {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(state.f)) v ? p.set(k, v) : p.delete(k);
    history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : ""));
  }
  function fillSelects(rows) {
    const opt = (id, vals, want, all) => {
      const list = [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
      if (want && !list.includes(want)) list.unshift(want);
      $(id).innerHTML = `<option value="">${all}</option>` + list.map((v) => `<option value="${esc(v)}" ${v === want ? "selected" : ""}>${esc(v)}</option>`).join("");
      $(id).classList.toggle("set", !!want);
    };
    opt("f-ch", rows.map((r) => r.chantier), state.f.ch, "Tous");
    window.Pilotage.fillPeople("f-who", rows.map((r) => r.assignee), state.f.who, "Toutes");
    $("f-prof").value = state.f.prof;
    $("f-prof").classList.toggle("set", !!state.f.prof);
  }

  // ---- barre : consommé (plein) + reste (clair), trait = estimé
  function bar(e, max) {
    if (max < 0.005) return "";
    const w = (v) => `${Math.min(100, (100 * v) / max).toFixed(1)}%`;
    return `<div class="ef-bar ${e.lvl}" aria-hidden="true"><i class="sp" style="width:${w(e.spent)}"></i><i class="rf" style="width:${w(e.raf)}"></i>` +
      (e.est > 0.005 ? `<b style="left:${w(e.est)}"></b>` : "") + "</div>";
  }
  const gapCell = (e) => `<td class="num"><span class="ef-gap ${e.lvl}">${signed(e.gap)}</span><span class="stack">${pctTxt(e.pct)}</span></td>`;
  // ef-opt : colonnes masquées sur téléphone (le prévu à terminaison les résume)
  const cells = (e, max) => `<td class="num">${num(e.est)}</td><td class="num ef-opt">${num(e.spent)}</td><td class="num ef-opt">${num(e.raf)}</td><td class="num"><b>${num(e.fin)}</b></td>${gapCell(e)}<td class="ef-viz">${bar(e, max)}</td>`;

  function render() {
    const { tasks, hist } = state, m = tasks.meta;
    const all = tasks.rows.filter((r) => K.sideOf(r, m));
    fillSelects(all);
    writeUrl();
    const sides = state.f.prof ? [state.f.prof] : ["dev", "qa"];
    const rows = all.filter((r) => (!state.f.ch || r.chantier === state.f.ch) && (!state.f.who || r.assignee === state.f.who) && sides.includes(K.sideOf(r, m)));
    $("efSub").textContent = `${sprintName(m.sprint)} · ${plural(rows.length, "tâche DEV ou QA", "tâches DEV ou QA")}${state.f.ch ? ` · ${state.f.ch}` : ""}${state.f.who ? ` · ${state.f.who}` : ""}`;

    // ---- synthèse par côté (jamais de total DEV + QA)
    const per = Object.fromEntries(sides.map((sd) => [sd, K.effort(rows.filter((r) => K.sideOf(r, m) === sd))]));
    const sumMax = Math.max(...sides.map((sd) => Math.max(per[sd].est, per[sd].fin)), 0);
    $("efSum").innerHTML = `<thead><tr><th>Profil</th><th class="num">Estimé</th><th class="num ef-opt">Consommé</th><th class="num ef-opt">Reste à faire</th><th class="num">À terminaison</th><th class="num">Dérive</th><th class="ef-viz">Consommé + reste <span class="muted">(trait : estimé)</span></th><th class="ef-opt">État</th></tr></thead><tbody>` +
      sides.map((sd) => { const e = per[sd]; return `<tr><td><b>${SIDES[sd].long}</b>${e.noest ? `<span class="stack">${plural(e.noest, "tâche sans estimation", "tâches sans estimation")} · ${num(e.noestJh)} JH</span>` : ""}</td>${cells(e, sumMax)}<td class="ef-opt"><span class="ef-state ${e.lvl}">${e.word}</span></td></tr>`; }).join("") + "</tbody>";

    renderCurves(sides);
    renderTree(rows, sides);
    renderTop(rows);
  }

  // ---- courbes jour par jour : estimé, consommé cumulé, prévu à terminaison (d'après les relevés)
  function renderCurves(sides) {
    const days = (state.hist?.days || []).filter((d) => d.effort);
    if (days.length < 2) { $("efCurves").innerHTML = `<p class="empty">${days.length ? "Un seul relevé pour l'instant : la courbe apparaîtra dès le deuxième jour." : "Historique indisponible."}</p>`; return; }
    $("efCurves").innerHTML = sides.map((sd) => {
      const pts = days.map((d) => ({ day: d.day, ...d.effort[sd] }));
      const W = 560, H = 190, L = 40, R = 14, T = 12, B = 26;
      // axe resserré sur les valeurs (courbes, pas des barres) : l'écart entre estimé et prévu reste lisible
      const vals = pts.flatMap((p) => [p.est, p.fin, p.spent]), hi = Math.max(1, ...vals), lo0 = Math.min(...vals);
      const span = Math.max(hi - lo0, hi * 0.1), min = Math.max(0, lo0 - span * 0.15), max = hi + span * 0.1;
      const x = (i) => L + ((W - L - R) * i) / Math.max(1, pts.length - 1), y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min));
      const line = (k, cls) => `<path class="${cls}" d="${pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("")}"/>`;
      const ticks = [0, 0.5, 1].map((t) => min + (max - min) * t).map((v) => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join("");
      const every = Math.max(1, Math.ceil(pts.length / 7));
      const xl = pts.map((p, i) => (i % every === 0 || i === pts.length - 1 ? `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmtDate(p.day)}</text>` : "")).join("");
      const last = pts[pts.length - 1], e = { gap: last.fin - last.est, pct: last.est > 0.005 ? (100 * (last.fin - last.est)) / last.est : null };
      const summary = `${SIDES[sd].long} : estimé ${num(last.est)} JH, consommé ${num(last.spent)} JH, prévu à terminaison ${num(last.fin)} JH au ${fmtDate(last.day)}`;
      return `<figure class="ef-curve"><figcaption><b>${SIDES[sd].long}</b> <span class="muted">· dérive au ${fmtDate(last.day)} : ${signed(e.gap)} JH (${pctTxt(e.pct)})</span></figcaption>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary)}">${ticks}${line("est", "est")}${line("spent", "spent")}${line("fin", "fin")}${xl}</svg></figure>`;
    }).join("") + `<p class="ef-legend muted"><span class="k est"></span>Estimé <span class="k fin"></span>Prévu à terminaison <span class="k spent"></span>Consommé cumulé · un estimé qui monte = tâches ajoutées en cours de sprint</p>`;
  }

  // ---- arbre : chantier · côté → FEAT → US → tâche, chaque niveau trié par écart décroissant
  function renderTree(rows, sides) {
    const m = state.tasks.meta, base = (m.jira_base_url || "").replace(/\/$/, "");
    const link = (key) => (base ? `<a href="${esc(base)}/browse/${esc(key)}" target="_blank" rel="noopener">${esc(key)}</a>` : esc(key));
    const group = (list, keyOf) => { const g = new Map(); for (const r of list) { const k = keyOf(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); } return [...g.entries()].map(([k, rs]) => ({ k, rs, e: K.effort(rs) })).sort((a, b) => b.e.gap - a.e.gap); };
    const top = [];
    for (const sd of sides) for (const c of group(rows.filter((r) => K.sideOf(r, m) === sd), (r) => r.chantier)) top.push({ ...c, sd });
    top.sort((a, b) => b.e.gap - a.e.gap);
    if (!state.opened) { top.forEach((c) => state.open.add(`${c.k}|${c.sd}`)); state.opened = true; }   // au départ : chantiers dépliés jusqu'aux FEAT
    const max = Math.max(0, ...top.map((c) => Math.max(c.e.est, c.e.fin)));
    const tgl = (id, label) => `<button type="button" class="tgl" data-ef="${esc(id)}" aria-expanded="${state.open.has(id)}" aria-label="${state.open.has(id) ? "Replier" : "Déplier"} ${esc(label)}"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>`;
    let html = "";
    for (const c of top) {
      const id0 = `${c.k}|${c.sd}`;
      html += `<tr class="chantier ef-l0"><td>${tgl(id0, c.k)}${esc(c.k)} · ${SIDES[c.sd].lbl}<span class="stack">${plural(c.rs.length, "tâche", "tâches")}</span></td>${cells(c.e, max)}</tr>`;
      if (!state.open.has(id0)) continue;
      for (const f of group(c.rs, (r) => r.feat || "(Sans FEAT)")) {
        const id1 = `${id0}|${f.k}`;
        html += `<tr class="us ef-l1"><td>${tgl(id1, f.k)}${esc(f.k)}</td>${cells(f.e, max)}</tr>`;
        if (!state.open.has(id1)) continue;
        for (const u of group(f.rs, (r) => r.us_key || "")) {
          const id2 = `${id1}|${u.k}`, us = u.rs[0];
          html += `<tr class="ef-l2"><td>${tgl(id2, u.k || "Sans US")}${u.k ? `${link(u.k)} <span class="ef-sum-txt">${esc(us.us_summary)}</span>` : '<span class="muted">Sans US</span>'}</td>${cells(u.e, max)}</tr>`;
          if (!state.open.has(id2)) continue;
          for (const t of group(u.rs, (r) => r.key)) {
            const r = t.rs[0];
            html += `<tr class="task ef-l3"><td>${link(r.key)} <span class="ef-sum-txt">${esc(r.summary)}</span><span class="stack">${esc(r.assignee || "Non assignée")} · ${esc(r.status)}${r.estim_hj > 0 ? "" : " · sans estimation"}</span></td>${cells(t.e, max)}</tr>`;
          }
        }
      }
    }
    $("efTree").innerHTML = `<thead><tr><th>Chantier · FEAT · US · tâche</th><th class="num">Estimé</th><th class="num ef-opt">Consommé</th><th class="num ef-opt">Reste</th><th class="num">À terminaison</th><th class="num">Dérive</th><th class="ef-viz">Consommé + reste</th></tr></thead><tbody>` +
      (html || `<tr><td colspan="7" class="empty">${state.tasks.rows.length ? "Aucune tâche DEV ou QA ne correspond aux filtres." : "Aucune tâche dans les filtres Jira du sprint."}</td></tr>`) + "</tbody>";
    // même règle que la synthèse : sans estimation initiale, avec du temps passé ou à passer
    const noest = rows.filter((r) => !(r.estim_hj > 0) && r.spent_hj + (r.done ? 0 : r.raf_hj) > 0.005);
    $("efNote").textContent = `En JH. Une tâche finie n'a plus de reste à faire. ${noest.length ? `${plural(noest.length, "tâche n'a", "tâches n'ont")} pas d'estimation initiale : leur temps compte comme travail non prévu.` : "Toutes les tâches ont une estimation initiale."}`;
  }

  // ---- plus fortes dérives (tâches)
  function renderTop(rows) {
    const m = state.tasks.meta, base = (m.jira_base_url || "").replace(/\/$/, "");
    const list = rows.map((r) => ({ r, e: K.effort([r]) })).filter((x) => x.e.gap > 0.05).sort((a, b) => b.e.gap - a.e.gap).slice(0, 8);
    $("efTop").innerHTML = `<thead><tr><th>Tâche</th><th>Résumé</th><th>Personne</th><th class="num">Estimé</th><th class="num">À terminaison</th><th class="num">Dérive</th></tr></thead><tbody>` +
      (list.length ? list.map(({ r, e }) => `<tr><td>${base ? `<a href="${esc(base)}/browse/${esc(r.key)}" target="_blank" rel="noopener">${esc(r.key)}</a>` : esc(r.key)}<span class="stack">${SIDES[K.sideOf(r, m)].lbl} · ${esc(r.chantier)}</span></td>
        <td>${esc(r.summary)}</td><td>${esc(r.assignee || "—")}</td><td class="num">${r.estim_hj > 0 ? num(e.est) : '<span class="muted">aucune</span>'}</td><td class="num"><b>${num(e.fin)}</b></td>${gapCell(e)}</tr>`).join("")
        : `<tr><td colspan="6" class="empty">Aucune tâche ne dépasse son estimation.</td></tr>`) + "</tbody>";
  }

  // ---- chargement
  function fail(msg, network) {
    const c = $("loadingCard");
    c.setAttribute("role", "alert");
    c.innerHTML = `<div class="le"><b>Impossible de charger l'effort</b><p></p>${network ? '<p class="muted">Vérifier la connexion VPN ou le Wi-Fi entreprise, puis réessayer.</p>' : ""}<button type="button" class="btn primary" id="retryLoad">Réessayer</button></div>`;
    c.querySelector(".le p").textContent = msg;
    $("loading").hidden = false;
    $("retryLoad").addEventListener("click", () => location.reload());
  }
  async function load(refresh = false) {
    const btn = $("refresh");
    btn.disabled = true;
    try {
      const histUrl = "/api/history" + (state.f.ch || state.f.who ? "?" + new URLSearchParams({ ...(state.f.ch ? { chantier: state.f.ch } : {}), ...(state.f.who ? { assignee: state.f.who } : {}) }) : "");
      [state.tasks, state.hist] = await Promise.all([getJson("/api/reporting-tasks" + (refresh ? "?refresh=true" : "")), getJson(histUrl).catch(() => null)]);
    } catch (e) {
      btn.disabled = false;
      return fail(e instanceof TypeError ? "Le serveur ne répond pas." : e.message, true);
    }
    const m = state.tasks.meta;
    $("source").textContent = m.source === "jira" ? "Jira en direct" : "Démo (Excel)";
    $("source").className = "badge " + (m.source === "jira" ? "live" : "demo");
    $("lastSync").textContent = m.generated_at ? "Mis à jour à " + m.generated_at.slice(11, 16) : "";
    try {
      render();
      $("loading").hidden = true;
    } catch (e) {
      console.error(e);
      fail(`Erreur inattendue dans la page (${e.message}). Recharger la page ; si l'erreur revient, la signaler.`, false);
    } finally {
      btn.disabled = false;
    }
  }

  // ---- évènements
  ["f-ch", "f-who", "f-prof"].forEach((id) => $(id).addEventListener("change", (e) => {
    const k = id.slice(2), histChanged = k !== "prof";
    state.f[k] = e.target.value;
    if (histChanged) { state.hist = null; load(); } else render();   // l'historique est filtré côté serveur (chantier, personne)
  }));
  $("efTree").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ef]"); if (!b) return;
    const id = b.dataset.ef; state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    render();
    document.querySelector(`[data-ef="${CSS.escape(id)}"]`)?.focus();
  });
  // tout déplier : chaque rendu fait apparaître le niveau suivant (chantier → FEAT → US → tâche)
  $("efOpenAll").addEventListener("click", () => {
    for (let level = 0; level < 4; level++) { document.querySelectorAll("#efTree [data-ef]").forEach((b) => state.open.add(b.dataset.ef)); render(); }
  });
  $("efCloseAll").addEventListener("click", () => { state.open.clear(); render(); });
  $("refresh").addEventListener("click", () => load(true));
  load();
})();
