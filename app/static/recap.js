/* PMO Reporting — Synthèse sprint pour les managers : l'essentiel en un écran (JS natif) */
(() => {
  "use strict";

  const state = { tasks: null, tempo: null, ch: new URLSearchParams(location.search).get("ch") || "" };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 1) => (n ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: d });
  const parse = (iso) => new Date(iso + "T00:00:00");
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (iso, n) => { const d = parse(iso); d.setDate(d.getDate() + n); return isoOf(d); };
  const fmtDate = (iso) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
  const fmtDay = (iso) => parse(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const daysTo = (iso, today) => Math.round((parse(iso) - parse(today)) / 86400000);
  const jLabel = (iso, today) => window.KPI.dayGap(iso, today, window.ASOF?.day ? "ce jour" : "aujourd'hui");
  const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);

  // Météo, indicateurs DEV / QA et burndown : calculs partagés avec le rapport (kpi.js)
  const { LV, WORD, SIDE, weather, worst, pctTxt, has } = window.KPI;
  const dot = (w) => `<span class="rc-dot ${w.lvl}" aria-hidden="true"></span>`;
  const sideStats = (side, rows, m, tempo, ch) => window.KPI.sideStats(side, rows, m, tempo, ch);
  const sideOf = window.KPI.sideOf;

  // Nom du sprint affiché : « Sprint 12 », mais « PI17 Sprint 3 » tel quel (pas de « Sprint PI17 Sprint 3 »)
  const sprintName = (n) => (/sprint/i.test(n || "") ? n : `Sprint ${n || "—"}`);
  async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || `erreur ${res.status}`);
    return data;
  }

  function render() {
    const { tasks, tempo } = state, m = tasks.meta, today = m.today;
    const allRows = tasks.rows;
    const chantiers = [...new Set(allRows.map((r) => r.chantier))].sort((a, b) => a.localeCompare(b, "fr"));
    [...document.querySelector("main").children].forEach((el) => { if (el.id !== "hero" && el.id !== "stale") el.hidden = !allRows.length; });
    if (!allRows.length) {
      $("hero").innerHTML = `<div class="rc-id"><h1>${esc(sprintName(m.sprint))}</h1>
        <div class="empty"><p><b>Aucune tâche dans les filtres Jira du sprint.</b></p><p>Vérifier les dates du sprint et les numéros de filtre Jira.</p>
        <a class="btn small" href="/parametres">Ouvrir les paramètres</a></div></div>`;
      $("stale").hidden = true;
      return;
    }
    // Tempo illisible : la capacité manque, on le dit au lieu de laisser croire que tout va bien
    $("stale").hidden = !!tempo;
    if (!tempo) $("stale").innerHTML = `<span><b>Capacité inconnue.</b> Tempo n'a pas pu être lu${state.tempoErr ? ` (${esc(state.tempoErr)})` : ""} : les états ne reposent que sur le reste à faire et les retards.</span>`;

    // ---- chaque chantier jugé séparément ; jamais de cumul entre chantiers
    const perCh = chantiers.map((name) => {
      const r = allRows.filter((x) => x.chantier === name);
      const dev = sideStats("dev", r, m, tempo, name), qa = sideStats("qa", r, m, tempo, name);
      return { name, dev, qa, total: r.length, done: r.filter((x) => x.done).length, late: dev.late + qa.late, w: worst(dev.w, qa.w) };
    });
    // par défaut : le chantier le plus en difficulté
    if (!chantiers.includes(state.ch)) state.ch = [...perCh].sort((a, b) => LV[b.w.lvl] - LV[a.w.lvl])[0]?.name || "";
    const ch = state.ch, cur = perCh.find((c) => c.name === ch);
    const rows = allRows.filter((r) => r.chantier === ch);
    const { dev, qa } = cur;

    // ---- sélecteur de chantier
    $("chSeg").innerHTML = perCh.map((c) => `<button type="button" data-ch="${esc(c.name)}" class="${c.name === ch ? "on" : ""}" aria-pressed="${c.name === ch}">${dot(c.w)}${esc(c.name)}</button>`).join("");

    // ---- en-tête : le sprint, puis la météo de chaque chantier, une ligne chacun
    const s0 = m.sprint_start, s1 = m.fin_test;
    const elapsed = s0 && s1 ? Math.max(0, Math.min(100, (100 * (parse(today) - parse(s0))) / (parse(s1) - parse(s0)))) : 0;
    const sentence = (c) => {
      const reds = [c.dev.w.lvl === "red" && window.KPI.overTxt("le développement", c.dev, num), c.qa.w.lvl === "red" && window.KPI.overTxt("la recette", c.qa, num)].filter(Boolean);
      if (reds.length) return `${reds.join(" ; ")}.`;
      if (c.w.lvl === "unknown") return "capacité inconnue : Tempo n'a pas pu être lu.";
      if (c.w.lvl === "amber") return `sous surveillance : ${[plural(c.late, "tâche en retard", "tâches en retard"),
        c.dev.w.pct != null && `développement ${pctTxt(c.dev.w.pct)}`, c.qa.w.pct != null && `recette ${pctTxt(c.qa.w.pct)}`].filter(Boolean).join(", ")}.`;
      return "le reste à faire entre dans la capacité d'ici les jalons.";
    };
    $("hero").innerHTML = `
      <div class="rc-id">
        <h1>${esc(sprintName(m.sprint))}</h1>
        <p class="muted">${s0 ? `Du ${fmtDate(s0)} au ${fmtDate(s1)} · ${Math.round(elapsed)} % du sprint écoulé` : ""}</p>
        <div class="rc-ms">
          ${m.freeze_code ? `<span><b>Freeze Code</b> ${esc(fmtDay(m.freeze_code))} · ${jLabel(m.freeze_code, today)}</span>` : ""}
          ${m.fin_test ? `<span><b>Fin de test</b> ${esc(fmtDay(m.fin_test))} · ${jLabel(m.fin_test, today)}</span>` : ""}
        </div>
        <div class="rc-bar" aria-hidden="true"><i style="width:${elapsed.toFixed(1)}%"></i></div>
      </div>
      <ul class="rc-wlist" aria-label="Météo par chantier">${[...perCh].sort((a, b) => LV[b.w.lvl] - LV[a.w.lvl] || a.name.localeCompare(b.name, "fr")).map((c) => `
        <li class="${c.w.lvl} ${c.name === ch ? "sel" : ""}">
          <button type="button" class="rc-wcard" data-ch="${esc(c.name)}" aria-pressed="${c.name === ch}" title="Afficher ${esc(c.name)}">
            <span class="rc-wname">${esc(c.name)}</span>
            <span class="rc-badge">${dot(c.w)}${WORD[c.w.lvl]}</span>
            <span class="rc-wtxt">${esc(sentence(c).charAt(0).toUpperCase() + sentence(c).slice(1))}</span>
          </button>
        </li>`).join("")}
      </ul>`;

    // ---- indicateurs DEV et QA
    for (const st of [dev, qa]) {
      const S = SIDE[st.side], ms = m[S.ms];
      $(`${st.side}Sub`).textContent = `${ch}${ms ? ` · ${S.until}, ${fmtDay(ms)} · ${jLabel(ms, today)}` : ""}`;
      const tile = (lbl, val, sub, cls = "") => `<div class="rc-tile ${cls}"><span class="lbl">${lbl}</span><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
      $(`${st.side}Kpis`).innerHTML =
        // Écart = capacité restante − reste à faire : positif = marge, négatif = ce qui manque pour tenir le jalon
        (st.capa == null ? tile("Écart", "—", "capacité indisponible") : (() => {
          const gap = st.capa - st.raf;
          return tile("Écart", `${gap > 0.005 ? "+" : gap < -0.005 ? "−" : ""}${num(Math.abs(gap))}<small>JH</small>`,
            `${gap < -0.005 ? `il manque ${num(-gap)} JH` : `marge de ${num(gap)} JH`} · ${num(st.capa)} JH de capacité pour ${num(st.raf)} JH à faire`, st.w.lvl);
        })()) +
        tile("Reste à faire", `${num(st.raf)}<small>JH</small>`, `${num(st.consumed)} JH déjà imputés depuis le ${fmtDate(m.sprint_start)}`) +
        tile("Capacité restante", st.capa == null ? "—" : `${num(st.capa)}<small>JH</small>`, (() => {
          // d'aujourd'hui au jalon, des personnes affectées au chantier ; la capacité du sprint entier pour repère
          const c = state.tempo?.chantiers.find((x) => x.chantier === ch);
          return c ? `d'aujourd'hui au jalon, scrum déduit · capacité du sprint ${num(c[`capa_sprint_${st.side}`])} JH` : "Tempo indisponible";
        })()) +
        tile("En retard", st.late, [st.late ? "ou bloquées" : "aucune en retard", st.after && `${st.after} après le jalon`, st.noest && `${st.noest} sans estimation`, st.unest && `${st.unest} RAF à estimer`].filter(Boolean).join(" · "), st.late || st.after ? "amber" : "green");
      // météo du côté : état, reste à faire face à la capacité, retards
      $(`${st.side}State`).innerHTML = `<span class="rc-state ${st.w.lvl}">${dot(st.w)}${st.w.word}</span>` +
        `<span class="stack">${st.raf < 0.005 ? `plus de ${st.side === "dev" ? "développement" : "recette"} à faire` : st.capa == null ? `${num(st.raf)} JH à faire` : (st.w.pct === Infinity ? `${num(st.raf)} JH à faire · aucune capacité restante` : `${num(st.raf)} JH pour ${num(st.capa)} JH · ${pctTxt(st.w.pct)}`)}</span>` +
        (st.late ? `<span class="stack warn-t">${plural(st.late, "tâche en retard", "tâches en retard")}</span>` : "");
      burndown($(`${st.side}Burn`), st, m);
    }
    $("burnNote").textContent = "Survoler un graphique (ou le sélectionner puis utiliser les flèches) pour lire les valeurs du jour. Reste à faire reconstitué à partir des imputations Tempo.";

    // ---- points d'attention
    const att = [];
    for (const c of ch ? perCh.filter((x) => x.name === ch) : perCh) {
      if (c.qa.w.lvl === "red") att.push(["red", `<b>Recette ${esc(c.name)}</b> : ${num(c.qa.raf)} JH à faire pour ${num(c.qa.capa)} JH de capacité d'ici la fin de test${c.qa.w.pct === Infinity ? "" : ` (${pctTxt(c.qa.w.pct)})`}. Décision attendue : renfort, réduction ou décalage.`]);
      if (c.dev.w.lvl === "red") att.push(["red", `<b>Développement ${esc(c.name)}</b> : ${num(c.dev.raf)} JH à faire pour ${num(c.dev.capa)} JH de capacité d'ici le Freeze Code${c.dev.w.pct === Infinity ? "" : ` (${pctTxt(c.dev.w.pct)})`}.`]);
    }
    const open = rows.filter((r) => !r.done);
    const late = open.filter((r) => has(r, "RETARD", "BLOQUEE"));
    if (late.length) {
      const by = Object.entries(late.reduce((a, r) => ((a[r.chantier] = (a[r.chantier] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]);
      // même découpage que les cartes Développement et Recette ; le reste (bogues…) est nommé pour que les totaux se recoupent
      const n = (side) => late.filter((r) => sideOf(r, m) === side).length;
      const others = late.filter((r) => !sideOf(r, m));
      const types = [...new Set(others.map((r) => r.type).filter(Boolean))].join(", ");
      const split = [n("dev") && `${n("dev")} en développement`, n("qa") && `${n("qa")} en recette`,
        others.length && `${others.length} hors développement et recette${types ? ` (${esc(types)})` : ""}`].filter(Boolean).join(", ");
      att.push(["amber", `<b>${plural(late.length, "tâche en retard ou bloquée", "tâches en retard ou bloquées")}</b> : ${split}${ch ? "" : ` · ${by.map(([c, k]) => `${k} sur ${esc(c)}`).join(", ")}`}.`]);
    }
    const afterMs = open.filter((r) => has(r, "APRES_FREEZE", "APRES_FIN_TEST"));
    if (afterMs.length) att.push(["amber", `<b>${plural(afterMs.length, "tâche a son échéance", "tâches ont leur échéance")} après le jalon</b> : à replanifier ou à sortir du sprint.`]);
    const unest = open.filter((r) => has(r, "RAF_A_ESTIMER"));
    const noest = open.filter((r) => has(r, "SANS_ESTIMATION"));
    if (noest.length) att.push(["amber", `<b>${plural(noest.length, "tâche à faire ou en cours n'a", "tâches à faire ou en cours n'ont")} aucune estimation</b> (${noest.map((r) => esc(r.key)).join(", ")}) : leur charge n'est pas dans le reste à faire.`]);
    if (unest.length) att.push(["amber", `<b>${plural(unest.length, "tâche n'a", "tâches n'ont")} pas de reste à faire estimé</b> : la charge est sous-évaluée d'autant.`]);
    const team = scopePeople();
    const missing = team.filter((p) => p.missing_h > 0.01);
    // affectation prévue vs part réellement imputée sur ce chantier depuis le début du sprint
    const hpd = m.hours_per_day || 8;
    for (const p of team.filter((q) => q.profile !== "lead")) {
      const planned = (p.affectation || {})[ch];
      const worked = (p.time?.sprint || 0) + (p.time?.autres || 0);
      if (!planned || worked <= 0) continue;
      const real = (100 * ((p.real_by_chantier || {})[ch] || 0) * hpd) / worked;
      if (planned - real >= 20) att.push([planned - real >= 50 ? "red" : "amber", `<b>${esc(p.name)}</b> (${esc(p.label || (p.profile === "qa" ? "QA" : "DEV"))}) : affecté${p.profile === "qa" ? "e" : ""} à ${Math.round(planned)} %, ${Math.round(real)} % de son temps réellement imputé sur le chantier depuis le ${fmtDate(m.sprint_start)}.`]);
    }
    att.sort((a, b) => LV[b[0]] - LV[a[0]]); // rouge d'abord, ordre conservé sinon
    if (missing.length) att.push(["amber", `<b>Saisie des temps incomplète</b> pour ${missing.map((p) => esc(p.name)).join(", ")} : la capacité affichée en dépend.`]);
    if (!att.length) att.push(["green", "Aucun point bloquant : charge dans la capacité, pas de retard."]);
    $("attSub").textContent = `${ch} · ce qui demande une décision ou un suivi`;
    $("attention").innerHTML = att.slice(0, 6).map(([lvl, t]) => `<li class="${lvl}">${t}</li>`).join("");

    // ---- diagrammes
    peopleChart($("pplChart"));
    statusChart($("stChart"), rows, ch ? null : chantiers, m);
    timeChart($("tmChart"));

    const gen = (tempo?.meta.tempo_generated_at || m.generated_at || "").slice(11, 16);
    $("source").textContent = m.source === "jira" ? "Jira et Tempo en direct" : "Démo (Excel)";
    $("source").className = "badge " + (m.source === "jira" ? "live" : "demo");
    $("lastSync").textContent = gen ? `Mis à jour à ${gen}` : "";
    // ---- planifié vs consommé (effort) du chantier, DEV et QA séparés
    const fx = (n) => (n ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }), sg = (g) => `${g > 0.05 ? "+" : g < -0.05 ? "−" : ""}${fx(Math.abs(g))}`;
    const effRows = ["dev", "qa"].map((sd) => [sd, window.KPI.effort(rows.filter((r) => sideOf(r, m) === sd))]).filter(([, e]) => e.n);
    $("effSub").textContent = `${ch} · estimation initiale face au consommé + reste à faire`;
    $("effLink").href = `/effort?ch=${encodeURIComponent(ch)}`;
    $("effSum").innerHTML = `<thead><tr><th>Profil</th><th class="num">Estimé</th><th class="num ef-opt">Consommé</th><th class="num ef-opt">Reste</th><th class="num">À terminaison</th><th class="num">Dérive</th><th class="ef-opt">État</th></tr></thead><tbody>` +
      (effRows.length ? effRows.map(([sd, e]) => `<tr><td><b>${sd === "dev" ? "Développement" : "Recette"}</b>${e.noest ? `<span class="stack">${e.noest} sans estimation</span>` : ""}</td>
        <td class="num">${fx(e.est)}</td><td class="num ef-opt">${fx(e.spent)}</td><td class="num ef-opt">${fx(e.raf)}</td><td class="num"><b>${fx(e.fin)}</b></td>
        <td class="num"><span class="ef-gap ${e.lvl}">${sg(e.gap)} JH</span><span class="stack">${e.pct == null ? "non estimé" : `${e.pct > 0.5 ? "+" : e.pct < -0.5 ? "−" : ""}${Math.abs(Math.round(e.pct))} %`}</span></td>
        <td class="ef-opt"><span class="ef-state ${e.lvl}">${e.word}</span></td></tr>`).join("") : `<tr><td colspan="7" class="empty">Aucune tâche DEV ou QA sur ce chantier.</td></tr>`) + "</tbody>";

    $("foot").innerHTML = `Synthèse calculée le ${esc(fmtDay(today))} à ${gen} à partir de Jira (reste à faire, alertes) et de Tempo (capacité restante, d'aujourd'hui au jalon : planning − temps déjà imputé − scrum events, × affectation). Détail dans le pilotage : <a href="/">Tâches</a> · <a href="/capa">Capacité</a> · <a href="/temps">Temps</a> · <a href="/effort">Effort</a>.` +
      (tempo ? "" : " <b>Tempo indisponible : charges et burndown non calculés.</b>");
  }

  // Personnes du périmètre : affectées au chantier choisi, sinon toute l'équipe
  function scopePeople() {
    const t = state.tempo;
    if (!t) return [];
    return t.people.filter((p) => p.in_team && (!state.ch || Object.keys(p.affectation || {}).includes(state.ch)));
  }

  // ---------- burndown d'un côté : reste à faire, trajectoire, capacité restante, charge consommée.
  // Le graphique ne porte que les courbes ; les valeurs se lisent au survol (souris ou flèches du clavier).
  function burndown(el, st, m) {
    const ms = m[SIDE[st.side].ms];
    if (!m.sprint_start || !ms) { el.innerHTML = '<p class="empty">Dates du sprint non renseignées.</p>'; return; }
    const bs = window.KPI.burnSeries(st, m, state.tempo, state.ch, state.hist);
    const { series, start, end, today, now, capNow } = bs, people = bs.hasCap ? [1] : [];
    const W = Math.max(320, Math.round(el.clientWidth - 32)), H = 200, L = 36, R = 12, T = 12, B = 24;
    const x = (iso) => L + ((W - L - R) * (parse(iso) - parse(start))) / (parse(end) - parse(start));
    const vmax = Math.max(1, ...series.flatMap((p) => [p.raf || 0, p.cap || 0, p.cons || 0, p.ideal]));
    const stepOf = (v) => [1, 2, 5, 10, 20, 50, 100].find((k) => k * 4 >= v) || 200;
    const step = stepOf(vmax), ymax = step * Math.ceil(vmax / step);
    const y = (v) => T + (H - T - B) * (1 - v / ymax);
    const path = (k) => series.filter((p) => p[k] != null).map((p) => `${x(p.at).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
    const cls = st.side;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Burndown ${SIDE[st.side].lbl.toLowerCase()} de ${esc(state.ch)}">`;
    for (let v = 0; v <= ymax; v += step) svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}</text>`;
    for (let d = start; d <= ms; d = addDays(d, 1)) if (parse(d).getDay() % 6 === 0) svg += `<rect x="${x(d)}" y="${T}" width="${x(addDays(d, 1)) - x(d)}" height="${H - T - B}" class="we"/>`;
    svg += `<text x="${L}" y="${H - 6}" class="ax">${fmtDate(start)}</text>`;
    svg += `<line x1="${x(end)}" x2="${x(end)}" y1="${T}" y2="${H - B}" class="ms"/><text x="${x(end)}" y="${H - 6}" text-anchor="end" class="ax">${SIDE[st.side].msLbl} ${fmtDate(ms)}</text>`;
    if (today < end) svg += `<line x1="${x(addDays(today, 1))}" x2="${x(addDays(today, 1))}" y1="${T}" y2="${H - B}" class="today"/>`;
    svg += `<polyline points="${path("ideal")}" class="ideal"/>`;
    if (people.length) svg += `<polyline points="${path("cap")}" class="cap"/>`;
    svg += `<polyline points="${path("cons")}" class="cons"/>`;
    const rafPts = path("raf");
    svg += `<path d="M${rafPts.split(" ").join("L")}L${rafPts.split(" ").at(-1).split(",")[0]},${y(0)}L${x(start)},${y(0)}Z" class="area ${cls}"/>`;
    svg += `<polyline points="${rafPts}" class="ln ${cls}"/>`;
    svg += `<g class="hover" visibility="hidden"><line class="xh" y1="${T}" y2="${H - B}"/>` +
      ["raf", "ideal", "cap", "cons"].map((k) => `<circle r="4" class="hp ${k} ${cls}" data-k="${k}"/>`).join("") + "</g>";
    svg += `<rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>`;

    // un seul état, sous le graphique
    const over = capNow != null && now.raf > capNow + 0.05, gap = now.raf - now.ideal;
    const chip = over ? `<span class="rc-flag red">${num(now.raf - capNow)} JH au-delà de la capacité</span>`
      : gap > 0.05 ? `<span class="rc-flag amber">${num(gap)} JH au-dessus de la trajectoire</span>` : `<span class="rc-flag green">Dans la trajectoire</span>`;
    el.innerHTML = `<div class="rc-plot" tabindex="0" aria-label="Burndown : flèches gauche et droite pour lire les valeurs jour par jour">${svg}</svg><div class="rc-tip" role="status" hidden></div></div>` +
      legend([[`ln-${cls}`, "Reste à faire"], ["ln-ideal", "Trajectoire idéale"], ["ln-cap", "Capacité restante"], ["ln-cons", "Charge consommée"]], chip);

    // survol : ligne verticale, points sur les courbes, valeurs du jour
    const plot = el.querySelector(".rc-plot"), g = el.querySelector(".hover"), tip = el.querySelector(".rc-tip"), hit = el.querySelector(".hit");
    const show = (i) => {
      const p = series[Math.max(0, Math.min(series.length - 1, i))];
      plot.dataset.i = series.indexOf(p);
      g.setAttribute("visibility", "visible");
      const xx = x(p.at);
      g.querySelector(".xh").setAttribute("x1", xx); g.querySelector(".xh").setAttribute("x2", xx);
      g.querySelectorAll(".hp").forEach((c) => { const v = p[c.dataset.k]; c.setAttribute("cx", xx); c.setAttribute("cy", v == null ? -99 : y(v)); });
      const row = (k, lbl, v) => (v == null ? "" : `<div><i class="ln-${k}"></i>${lbl}<b>${num(v)} JH</b></div>`);
      tip.innerHTML = `<p>${p.d < start ? `Début du sprint, ${fmtDate(start)}` : `${parse(p.d).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" })} au soir${p.d === today ? (window.ASOF?.day ? " (jour affiché)" : " (aujourd'hui)") : p.d > today ? " (à venir)" : ""}`}</p>` +
        row(cls, "Reste à faire", p.raf) + row("ideal", "Trajectoire", p.ideal) + row("cap", "Capacité restante", p.cap) + row("cons", "Consommé", p.cons);
      tip.hidden = false;
      const left = xx + 14 + tip.offsetWidth > W ? xx - tip.offsetWidth - 14 : xx + 14;
      tip.style.left = `${left}px`;
    };
    const hide = () => { g.setAttribute("visibility", "hidden"); tip.hidden = true; };
    const idxAt = (e) => {
      const px = ((e.clientX - plot.getBoundingClientRect().left) / plot.getBoundingClientRect().width) * W;
      let best = 0;
      series.forEach((p, k) => { if (Math.abs(x(p.at) - px) < Math.abs(x(series[best].at) - px)) best = k; });
      return best;
    };
    hit.addEventListener("mousemove", (e) => show(idxAt(e)));
    hit.addEventListener("mouseleave", () => { if (document.activeElement !== plot) hide(); });
    plot.addEventListener("focus", () => show(series.indexOf(now)));
    plot.addEventListener("blur", hide);
    plot.addEventListener("keydown", (e) => {
      const i = Number(plot.dataset.i ?? series.indexOf(now));
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); show(i + (e.key === "ArrowRight" ? 1 : -1)); }
      else if (e.key === "Escape") hide();
    });
  }

  // ---------- charge par personne : capacité (barre claire) et reste à faire (barre pleine)
  function peopleChart(el) {
    const ps = scopePeople().filter((p) => p.profile === "dev" || p.profile === "qa")
      .map((p) => ({ p, raf: p.profile === "qa" ? p.raf_qa : p.raf_dev, capa: p.capa_real || 0 }))
      .filter((x) => x.raf > 0.005 || x.capa > 0.005)
      .sort((a, b) => (b.capa ? b.raf / b.capa : 9) - (a.capa ? a.raf / a.capa : 9) || b.raf - a.raf);
    if (!ps.length) { el.innerHTML = '<p class="empty">Aucune donnée de capacité.</p>'; return; }
    // Large : texte « x JH à faire · y JH de capacité » au bout de la barre ; étroit (téléphone) : texte sous la barre
    const W = Math.max(320, Math.round(el.clientWidth - 32)), narrow = W < 640, L = 150, R = narrow ? 12 : 250, rowH = narrow ? 44 : 30, H = ps.length * rowH + 30;
    const vmax = Math.max(1, ...ps.flatMap((x) => [x.raf, x.capa]));
    const xs = (v) => L + ((W - L - R) * v) / vmax;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Charge par personne">`;
    ps.forEach(({ p, raf, capa }, i) => {
      const yy = 10 + i * rowH, over = raf > capa + 0.005;
      svg += `<text x="${L - 8}" y="${yy + 15}" text-anchor="end" class="nm">${esc(p.name)}<tspan class="ax"> ${p.categorie === "lead" ? "TL / PO" : p.profile === "qa" ? "QA" : "DEV"}</tspan></text>`;
      svg += `<rect x="${L}" y="${yy + 2}" width="${xs(capa) - L}" height="18" rx="3" class="capa"><title>${esc(p.name)} : capacité ${num(capa)} JH</title></rect>`;
      svg += `<rect x="${L}" y="${yy + 7}" width="${Math.max(1, xs(raf) - L)}" height="8" rx="2" class="raf ${over ? "over" : p.profile}"><title>${esc(p.name)} : reste à faire ${num(raf)} JH</title></rect>`;
      svg += `<text x="${narrow ? 8 : Math.max(xs(raf), xs(capa)) + 8}" y="${narrow ? yy + 34 : yy + 15}" class="val ${over ? "over" : ""}">${num(raf)} JH à faire · ${capa > 0.005 ? `${num(capa)} JH de capacité · ${Math.round((100 * raf) / capa)} %` : "aucune capacité restante"}</text>`;
    });
    svg += `<text x="${L}" y="${H - 6}" class="ax">Barre claire : capacité restante · trait plein : reste à faire (rouge au-delà de la capacité)</text>`;
    el.innerHTML = svg + "</svg>";
  }

  // ---------- état des tâches : barres empilées par chantier (ou DEV / QA du chantier choisi)
  const STATES = [["todo", "À faire"], ["prog", "En cours"], ["deliv", "Livrées (Ready for QA, MR)"], ["done", "Terminées"], ["block", "Bloquées"]];
  function stateOf(r) {
    if (r.done) return "done";
    if ((r.status || "").toLowerCase().includes("block") || has(r, "BLOQUEE")) return "block";
    if (r.delivered) return "deliv";
    const s = (r.status || "").toLowerCase();
    return s.includes("progress") || s.includes("running") || s.includes("cours") ? "prog" : "todo";
  }
  function statusChart(el, rows, chantiers, m) {
    const groups = chantiers ? chantiers.map((c) => [c, rows.filter((r) => r.chantier === c)])
      : [["Développement", rows.filter((r) => sideOf(r, m) === "dev")], ["Recette", rows.filter((r) => sideOf(r, m) === "qa")], ["Bogues", rows.filter((r) => !sideOf(r, m))]].filter(([, r]) => r.length);
    const W = Math.max(320, Math.round(el.clientWidth - 32)), L = 170, R = 20, rowH = 34, H = groups.length * rowH + 12;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="État des tâches">`;
    groups.forEach(([name, rs], i) => {
      const yy = 8 + i * rowH, n = rs.length || 1;
      svg += `<text x="${L - 8}" y="${yy + 16}" text-anchor="end" class="nm">${esc(name)}<tspan class="ax"> ${rs.length}</tspan></text>`;
      let x0 = L;
      for (const [k, lbl] of STATES) {
        const c = rs.filter((r) => stateOf(r) === k).length;
        if (!c) continue;
        const w = ((W - L - R) * c) / n;
        svg += `<rect x="${x0}" y="${yy + 2}" width="${Math.max(0, w - 1)}" height="22" class="st ${k}"><title>${esc(name)} · ${lbl} : ${c}</title></rect>`;
        if (w > 26) svg += `<text x="${x0 + w / 2}" y="${yy + 17}" text-anchor="middle" class="in ${k}">${c}</text>`;
        x0 += w;
      }
    });
    el.innerHTML = svg + "</svg>" + legend(STATES.map(([k, l]) => [`st-${k}`, l]));
  }

  const legend = (items, extra = "") => `<p class="rc-legend">${items.map(([cls, l]) => `<span><i class="${cls}"></i>${esc(l)}</span>`).join("")}${extra}</p>`;

  // ---------- où va le temps : barres 100 % par profil
  const CATS = [["sprint", "Tâches du sprint"], ["scrum", "Scrum events"], ["autres", "Autres sujets"], ["absence", "Absences"]];
  function timeChart(el) {
    const ps = scopePeople();
    if (!ps.length) { el.innerHTML = '<p class="empty">Tempo indisponible.</p>'; return; }
    // classement unique (DEV / QA / TL / PO), comme Temps et Scrum events : un TL / PO qui réalise du DEV reste TL / PO
    const cat = (p) => p.categorie || p.profile;
    const groups = [["DEV", ps.filter((p) => cat(p) === "dev")], ["QA", ps.filter((p) => cat(p) === "qa")], ["TL / PO", ps.filter((p) => cat(p) === "lead")]].filter(([, g]) => g.length);
    const hpd = state.tasks.meta.hours_per_day || 8;
    const W = Math.max(320, Math.round(el.clientWidth - 32)), L = 120, R = 20, rowH = 36, H = groups.length * rowH + 12;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Répartition du temps saisi par profil">`;
    groups.forEach(([name, g], i) => {
      const yy = 8 + i * rowH, tot = sum(CATS, ([k]) => sum(g, (p) => p.time[k])) || 1;
      svg += `<text x="${L - 8}" y="${yy + 17}" text-anchor="end" class="nm">${name}<tspan class="ax"> ${g.length} pers.</tspan></text>`;
      let x0 = L;
      for (const [k, lbl] of CATS) {
        const h = sum(g, (p) => p.time[k]), w = ((W - L - R) * h) / tot;
        if (w < 0.5) continue;
        svg += `<rect x="${x0}" y="${yy + 2}" width="${Math.max(0, w - 1)}" height="24" class="cat-${k}"><title>${name} · ${lbl} : ${num(h / hpd)} JH (${Math.round((100 * h) / tot)} %)</title></rect>`;
        if (w > 44) svg += `<text x="${x0 + w / 2}" y="${yy + 18}" text-anchor="middle" class="in">${Math.round((100 * h) / tot)} %</text>`;
        x0 += w;
      }
    });
    // Scrum events de toute l'équipe DEV / QA (TL / PO exclus, quel que soit le chantier affiché) :
    // même population, même ratio et mêmes seuils que les pages Scrum events et Temps
    const team = state.tempo.people.filter((p) => p.in_team && p.group !== "lead" && (p.profile === "dev" || p.profile === "qa"));
    const wk = sum(team, (p) => p.time.sprint + p.time.scrum + p.time.autres), sc = sum(team, (p) => p.time.scrum);
    const goal = state.tempo.scrum?.percent?.team;
    let note = "";
    if (wk > 0.5 && goal != null) {
      const r = (100 * sc) / wk, word = r > goal + 2 ? "dépassé" : r > goal ? "à la limite" : r < goal / 2 ? "faible, saisie à vérifier" : "respecté";
      note = `<p class="rc-note" style="margin-top:10px">Scrum events de l'équipe DEV / QA : <b>${num(r)} % du temps travaillé</b> pour un objectif de ${num(goal, 0)} % · ${word}. <a href="/scrum">Détail</a></p>`;
    }
    el.innerHTML = svg + "</svg>" + legend(CATS.map(([k, l]) => [`cat-${k}`, l])) + note;
  }

  // Échec : réseau ou API (avec le conseil VPN), ou erreur d'affichage (sans faux diagnostic réseau)
  function fail(title, msg, network) {
    const c = $("loadingCard");
    c.setAttribute("role", "alert");
    c.innerHTML = `<div class="le"><b>${title}</b><p></p>${network ? '<p class="muted">Vérifier la connexion VPN ou le Wi-Fi entreprise, puis réessayer.</p>' : ""}<button type="button" class="btn primary" id="retryLoad">Réessayer</button></div>`;
    c.querySelector(".le p").textContent = msg;
    $("loading").hidden = false;
    $("retryLoad").addEventListener("click", () => location.reload());
  }
  async function load() {
    let tasks, tempo, hist;
    try {
      // lus ensemble ; Tempo et l'historique sont facultatifs (sans eux : pas de capacité, burndown reconstitué)
      [tasks, tempo, hist] = await Promise.all([getJson("/api/reporting-tasks"),
        getJson("/api/tempo").catch((e) => { state.tempoErr = e instanceof TypeError ? "le serveur ne répond pas" : e.message; return null; }),
        getJson("/api/history?by=chantier").catch(() => null)]);
    } catch (e) {
      return fail("Impossible de préparer la synthèse", e instanceof TypeError ? "Le serveur ne répond pas." : e.message, true);
    }
    Object.assign(state, { tasks, tempo, hist });
    if (state.ch && !tasks.rows.some((r) => r.chantier === state.ch)) state.ch = "";
    try {
      render();
      $("loading").hidden = true;
    } catch (e) {
      console.error(e);
      fail("Impossible d'afficher la synthèse", `Erreur inattendue dans la page (${e.message}). Recharger la page ; si l'erreur revient, la signaler.`, false);
    }
  }

  // Choix du périmètre : sélecteur ou clic sur un chantier du tableau ; repris dans l'URL
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ch]");
    if (!b || !state.tasks) return;
    state.ch = b.dataset.ch;
    history.replaceState(null, "", state.ch ? `?ch=${encodeURIComponent(state.ch)}` : location.pathname);
    render();
  });
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => state.tasks && render(), 150); });
  load();
})();
