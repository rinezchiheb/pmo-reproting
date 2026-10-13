/* PMO Reporting — rapport de synthèse imprimable : tous les chantiers, chacun avec ses indicateurs,
   ses burndowns DEV et QA et le détail de ses FEAT. Mêmes calculs que la Synthèse (kpi.js). JS natif. */
(() => {
  "use strict";

  const K = window.KPI;
  const { SIDE, LV, pctTxt, parse, addDays, sum } = K;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 1) => (n ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: d });
  const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
  const fmtDay = (iso) => parse(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const fmtShort = (iso) => parse(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const jLeft = (iso, today) => K.dayGap(iso, today, "ce jour");
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const state = { tasks: null, tempo: null, tempoErr: null };

  // Nom du sprint affiché : « Sprint 12 », mais « PI17 Sprint 3 » tel quel (pas de « Sprint PI17 Sprint 3 »)
  const sprintName = (n) => (/sprint/i.test(n || "") ? n : `Sprint ${n || "—"}`);
  async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || `erreur ${res.status}`);
    return data;
  }

  // ---- petites briques
  const chip = (w) => `<span class="rp-w ${w.lvl}"><i aria-hidden="true"></i>${esc(w.word)}</span>`;
  const gapOf = (st) => (st.capa == null ? null : st.capa - st.raf);
  const gapTxt = (g) => (g == null ? "—" : `${g > 0.005 ? "+" : g < -0.005 ? "−" : ""}${num(Math.abs(g))}`);
  const gapCls = (g) => (g == null ? "" : g < -0.005 ? "neg" : "pos");
  const pct = (p) => (p == null ? "—" : `${Math.round(p)} %`);
  function dueTxt(st, today) {
    const d = st.due;
    if (!d.last) return st.open ? "aucune échéance" : "—";
    return `${fmtDate(d.last)}${d.after ? ` <b class="neg">· ${d.after} après le jalon</b>` : ""}`;
  }
  function sentence(c) {
    const reds = [c.dev.w.lvl === "red" && K.overTxt("le développement", c.dev, num), c.qa.w.lvl === "red" && K.overTxt("la recette", c.qa, num)].filter(Boolean);
    if (reds.length) { const t = `${reds.join(" ; ")} d'ici le jalon.`; return t[0].toUpperCase() + t.slice(1); }
    if (c.w.lvl === "unknown") return "Capacité inconnue : Tempo n'a pas pu être lu, seuls le reste à faire et les retards sont jugés.";
    if (c.w.lvl === "amber") {
      const load = [c.dev.w.pct != null && `développement à ${pctTxt(c.dev.w.pct)}`, c.qa.w.pct != null && `recette à ${pctTxt(c.qa.w.pct)}`].filter(Boolean);
      return `Sous surveillance : ${plural(c.late, "tâche en retard ou bloquée", "tâches en retard ou bloquées")}${load.length ? `, ${load.join(", ")} de la capacité` : ""}.`;
    }
    return c.dev.raf + c.qa.raf < 0.005 ? "Plus de reste à faire sur ce chantier." : "Le reste à faire entre dans la capacité d'ici les jalons.";
  }

  // ---- burndown statique (impression) : reste à faire, trajectoire, capacité restante, consommé
  function burnSvg(st, m, ch) {
    const bs = K.burnSeries(st, m, state.tempo, ch, state.hist);
    if (!bs) return '<p class="rp-empty">Dates du sprint non renseignées.</p>';
    if (!state.tempo) return '<p class="rp-empty">Tempo indisponible : burndown non calculé.</p>';
    const { series, start, end, today, now, capNow, hasCap, ms } = bs;
    const W = 520, H = 180, L = 34, R = 10, T = 10, B = 22;
    const x = (iso) => L + ((W - L - R) * (parse(iso) - parse(start))) / (parse(end) - parse(start));
    const vmax = Math.max(1, ...series.flatMap((p) => [p.raf || 0, p.cap || 0, p.cons || 0, p.ideal]));
    const step = [1, 2, 5, 10, 20, 50, 100].find((k) => k * 4 >= vmax) || 200, ymax = step * Math.ceil(vmax / step);
    const y = (v) => T + (H - T - B) * (1 - v / ymax);
    const path = (k) => series.filter((p) => p[k] != null).map((p) => `${x(p.at).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Burndown ${SIDE[st.side].lbl.toLowerCase()} de ${esc(ch)}">`;
    for (let v = 0; v <= ymax; v += step) svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end" class="ax">${v}</text>`;
    for (let d = start; d <= ms; d = addDays(d, 1)) if (parse(d).getDay() % 6 === 0) svg += `<rect x="${x(d)}" y="${T}" width="${x(addDays(d, 1)) - x(d)}" height="${H - T - B}" class="we"/>`;
    svg += `<text x="${L}" y="${H - 6}" class="ax">${fmtDate(start)}</text><text x="${x(end)}" y="${H - 6}" text-anchor="end" class="ax">${SIDE[st.side].msLbl} ${fmtDate(ms)}</text>`;
    svg += `<line x1="${x(end)}" x2="${x(end)}" y1="${T}" y2="${H - B}" class="ms"/>`;
    if (today < end) svg += `<line x1="${x(addDays(today, 1))}" x2="${x(addDays(today, 1))}" y1="${T}" y2="${H - B}" class="today"/>`;
    svg += `<polyline points="${path("ideal")}" class="ideal"/>`;
    if (hasCap) svg += `<polyline points="${path("cap")}" class="cap"/>`;
    svg += `<polyline points="${path("cons")}" class="cons"/><polyline points="${path("raf")}" class="raf ${st.side}"/>`;
    const over = capNow != null && now.raf > capNow + 0.05, gap = now.raf - now.ideal;
    const verdict = over ? `<b class="neg">${num(now.raf - capNow)} JH au-delà de la capacité</b>` : gap > 0.05 ? `<b class="warn">${num(gap)} JH au-dessus de la trajectoire</b>` : `<b class="pos">dans la trajectoire</b>`;
    return `${svg}</svg>
      <p class="rp-legend"><span><i class="l-raf ${st.side}"></i>Reste à faire</span><span><i class="l-ideal"></i>Trajectoire idéale</span>${hasCap ? '<span><i class="l-cap"></i>Capacité restante</span>' : ""}<span><i class="l-cons"></i>Charge consommée</span></p>
      <p class="rp-burnval">${fmtShort(now.d < start ? start : now.d)} au soir : reste à faire ${num(now.raf)} JH · trajectoire ${num(now.ideal)} JH${capNow != null ? ` · capacité restante ${num(capNow)} JH` : ""} · consommé ${num(now.cons)} JH · ${verdict}</p>`;
  }

  function sideBlock(st, m, ch) {
    const S = SIDE[st.side], ms = m[S.ms], g = gapOf(st);
    const row = (k, v, cls = "") => `<tr><th>${k}</th><td class="${cls}">${v}</td></tr>`;
    return `<div class="rp-side ${st.side}">
      <h3>${S.lbl}<small>${ms ? `${S.until}, ${fmtShort(ms)} · ${jLeft(ms, m.today)}` : "jalon non renseigné"}</small></h3>
      <div class="rp-side-body">
        <table class="rp-kpis"><tbody>
          ${row("Météo", chip(st.w))}
          ${row("Reste à faire", `${num(st.raf)} JH`)}
          ${row("Capacité du sprint", st.capaSprint == null ? "—" : `${num(st.capaSprint)} JH`)}
          ${row("Capacité restante", st.capa == null ? "—" : `${num(st.capa)} JH`)}
          ${row("Écart", g == null ? "—" : `${gapTxt(g)} JH <small>${g < -0.005 ? "manque" : "marge"}</small>`, gapCls(g))}
          ${row("Charge / capa", pctTxt(st.w.pct))}
          ${row("Avancement", `${pct(st.progress)} <small>du temps · ${st.done} / ${st.total} tâches terminées</small>`)}
          ${(() => { // planifié vs consommé : estimation initiale face au consommé + reste à faire
            const e = K.effort(state.tasks.rows.filter((r) => r.chantier === ch && K.sideOf(r, m) === st.side));
            if (!e.n) return "";
            const pe = e.pct == null ? "non estimé" : `${e.pct > 0.5 ? "+" : e.pct < -0.5 ? "−" : ""}${Math.abs(Math.round(e.pct))} %`;
            return row("Effort", `${num(e.est)} JH estimés → ${num(e.fin)} JH à terminaison <small>${e.word} · ${pe}</small>`, e.lvl === "red" || e.lvl === "amber" ? "neg" : "");
          })()}
          ${row("Dernière échéance", dueTxt(st, m.today))}
          ${row("En retard / bloquées", st.late ? `<b class="neg">${st.late}</b>` : "0", "")}
          ${st.noest || st.unest ? row("À estimer", [st.noest && `${st.noest} sans estimation`, st.unest && `${st.unest} RAF à estimer`].filter(Boolean).join(" · ")) : ""}
        </tbody></table>
        <figure class="rp-burn">${burnSvg(st, m, ch)}</figure>
      </div>
    </div>`;
  }

  function featTable(c, m) {
    const groups = new Map();
    for (const r of c.rows) {
      const k = r.feat_key || r.feat || "(Sans FEAT)";
      if (!groups.has(k)) groups.set(k, { key: r.feat_key, name: r.feat || "(Sans FEAT)", rows: [] });
      groups.get(k).rows.push(r);
    }
    const lines = [...groups.values()].map((f) => {
      const dev = f.rows.filter((r) => K.sideOf(r, m) === "dev"), qa = f.rows.filter((r) => K.sideOf(r, m) === "qa");
      const open = f.rows.filter((r) => !r.done);
      const lastOf = (rs, k) => rs.filter((r) => !r.done && r[k]).map((r) => r[k]).sort().at(-1);
      const dDev = lastOf(dev, "due_dev"), dQa = lastOf(qa, "due_qa");
      return { ...f, rafDev: sum(dev, (r) => r.raf_dev), rafQa: sum(qa, (r) => r.raf_qa), prog: K.progress(f.rows),
        done: f.rows.filter((r) => r.done).length, total: f.rows.length,
        dDev, dQa, lateDev: dDev && m.freeze_code && dDev > m.freeze_code, lateQa: dQa && m.fin_test && dQa > m.fin_test,
        late: open.filter((r) => K.has(r, "RETARD", "BLOQUEE")).length };
    }).sort((a, b) => b.rafDev + b.rafQa - (a.rafDev + a.rafQa) || a.name.localeCompare(b.name, "fr"));
    return `<h3 class="rp-sub">Détail par FEAT <small>${plural(lines.length, "FEAT", "FEAT")}</small></h3>
      <table class="rp-table rp-feat">
        <thead><tr><th>FEAT</th><th class="num">Tâches terminées</th><th class="num">Avancement</th><th class="num">RAF DEV</th><th class="num">RAF QA</th><th class="num">Échéance DEV</th><th class="num">Échéance QA</th><th class="num">En retard</th></tr></thead>
        <tbody>${lines.map((f) => `<tr>
          <td><b>${esc(f.name)}</b>${f.key ? `<small>${esc(f.key)}</small>` : ""}</td>
          <td class="num">${f.done} / ${f.total}</td>
          <td class="num"><span class="rp-bar"><i style="width:${Math.round(f.prog ?? 0)}%"></i></span>${pct(f.prog)}</td>
          <td class="num">${f.rafDev > 0.005 ? num(f.rafDev) : "—"}</td>
          <td class="num">${f.rafQa > 0.005 ? num(f.rafQa) : "—"}</td>
          <td class="num ${f.lateDev ? "neg" : ""}">${fmtDate(f.dDev)}</td>
          <td class="num ${f.lateQa ? "neg" : ""}">${fmtDate(f.dQa)}</td>
          <td class="num ${f.late ? "neg" : ""}">${f.late || "—"}</td></tr>`).join("")}</tbody>
      </table>`;
  }

  function render() {
    const { tasks, tempo } = state, m = tasks.meta, today = m.today;
    const all = K.chantiers(tasks.rows, m, tempo).sort((a, b) => LV[b.w.lvl] - LV[a.w.lvl] || a.name.localeCompare(b.name, "fr"));
    const withFeat = $("withFeat").checked;
    const s0 = m.sprint_start, s1 = m.fin_test;
    const elapsed = s0 && s1 ? Math.max(0, Math.min(100, (100 * (parse(today) - parse(s0))) / (parse(s1) - parse(s0)))) : null;
    const at = (m.generated_at || "").slice(11, 16);
    const counts = ["red", "amber", "unknown", "green"].map((l) => [l, all.filter((c) => c.w.lvl === l).length]);
    const sideCells = (st) => `<td class="num">${num(st.raf)}</td><td class="num">${st.capaSprint == null ? "—" : num(st.capaSprint)}</td>
      <td class="num">${st.capa == null ? "—" : num(st.capa)}</td><td class="num ${gapCls(gapOf(st))}">${gapTxt(gapOf(st))}</td>
      <td class="num ${st.due.after ? "neg" : ""}">${fmtDate(st.due.last)}</td>`;

    if (!all.length) {
      $("doc").innerHTML = `<header class="rp-head"><h1>Rapport de synthèse · ${esc(sprintName(m.sprint))}</h1></header>
        <p class="rp-warn">Aucune tâche dans les filtres Jira du sprint : rien à rapporter. Vérifier les dates du sprint et les numéros de filtre dans les <a href="/parametres">Paramètres</a>.</p>`;
      return;
    }
    $("doc").innerHTML = `
      <header class="rp-head">
        <div class="rp-brand"><span class="logo-mark" aria-hidden="true"><i class="d1"></i><i class="d2"></i></span><span>be-ivs · PMO Reporting · stream BUILD</span></div>
        <h1>Rapport de synthèse · ${esc(sprintName(m.sprint))}</h1>
        <p class="rp-asof">Situation au <b>${esc(fmtDay(today))}</b>${m.as_of ? ` · image du relevé de ${at}` : ` · données en direct à ${at}`}</p>
        <dl class="rp-facts">
          <div><dt>Période</dt><dd>${s0 ? `${fmtShort(s0)} → ${fmtShort(s1)}` : "—"}${elapsed != null ? ` · ${Math.round(elapsed)} % écoulé` : ""}</dd></div>
          <div><dt>Freeze Code</dt><dd>${m.freeze_code ? `${fmtShort(m.freeze_code)} · ${jLeft(m.freeze_code, today)}` : "—"}</dd></div>
          <div><dt>Fin de test</dt><dd>${m.fin_test ? `${fmtShort(m.fin_test)} · ${jLeft(m.fin_test, today)}` : "—"}</dd></div>
          <div><dt>Chantiers</dt><dd>${all.length} · ${counts.filter(([, n]) => n).map(([l, n]) => `<span class="rp-w ${l}"><i aria-hidden="true"></i>${n} ${K.WORD[l].toLowerCase()}</span>`).join(" ")}</dd></div>
        </dl>
        ${tempo ? "" : `<p class="rp-warn">Tempo indisponible${state.tempoErr ? ` (${esc(state.tempoErr)})` : ""} : capacités, écarts et burndowns non calculés.</p>`}
      </header>

      <section class="rp-overview">
        <h2>Vue d'ensemble par chantier</h2>
        <p class="rp-note">Chaque chantier est jugé séparément, sans cumul. En JH ; écart = capacité restante − reste à faire (négatif : ce qui manque pour tenir le jalon).</p>
        <table class="rp-table rp-sum">
          <thead>
            <tr><th rowspan="2">Chantier</th><th rowspan="2">Météo</th><th colspan="5" class="grp dev">Développement · Freeze Code ${fmtDate(m.freeze_code)}</th><th colspan="5" class="grp qa">Recette · fin de test ${fmtDate(m.fin_test)}</th><th rowspan="2" class="num">Avancement</th><th rowspan="2" class="num">En retard</th></tr>
            <tr>${["dev", "qa"].map((sd) => `<th class="num ${sd} first">RAF</th><th class="num ${sd}">Capa. sprint</th><th class="num ${sd}">Capa. restante</th><th class="num ${sd}">Écart</th><th class="num ${sd}">Dern. échéance</th>`).join("")}</tr>
          </thead>
          <tbody>${all.map((c) => `<tr>
            <th scope="row"><a href="#ch-${encodeURIComponent(c.name)}">${esc(c.name)}</a></th><td>${chip(c.w)}</td>
            ${sideCells(c.dev)}${sideCells(c.qa)}
            <td class="num">${pct(c.progress)}</td><td class="num ${c.late ? "neg" : ""}">${c.late || "—"}</td></tr>`).join("")}</tbody>
        </table>
        <div class="rp-defs">
          <p><b>Capacité du sprint</b> : du premier jour au jalon (planning Tempo × disponibilité − absences − scrum events), × affectation au chantier.</p>
          <p><b>Capacité restante</b> : d'aujourd'hui au jalon, jour par jour : disponible − temps déjà imputé dans Tempo − scrum events, × affectation. Les jours passés non saisis n'en font pas partie.</p>
          <p><b>Météo</b> : rouge si le reste à faire dépasse la capacité restante ; orange au-delà de 80 % ou avec des tâches en retard ; vert sinon. <b>Avancement</b> : temps passé / (temps passé + reste à faire).</p>
          <p><b>Dernière échéance</b> : la plus tardive des tâches ouvertes, en rouge si elle dépasse le jalon.</p>
        </div>
      </section>

      ${all.map((c) => `
      <section class="rp-ch" id="ch-${encodeURIComponent(c.name)}">
        <header class="rp-ch-head">
          <h2>${esc(c.name)}</h2>${chip(c.w)}
          <p>${esc(sentence(c))} <span class="rp-muted">${c.done} / ${c.total} tâches terminées · avancement ${pct(c.progress)} du temps${c.late ? ` · ${plural(c.late, "tâche en retard ou bloquée", "tâches en retard ou bloquées")}` : ""}</span></p>
        </header>
        <div class="rp-sides">${sideBlock(c.dev, m, c.name)}${sideBlock(c.qa, m, c.name)}</div>
        ${withFeat ? featTable(c, m) : ""}
      </section>`).join("")}

      <footer class="rp-foot">Rapport généré le ${esc(new Date().toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }))} à partir de Jira (reste à faire, échéances, alertes) et de Tempo (capacité, temps imputés). Mêmes calculs que la page Synthèse.</footer>`;
    document.title = `Rapport de synthèse · ${m.sprint} · ${fmtDate(today)}`;
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
      // lus ensemble ; Tempo et l'historique sont facultatifs
      [tasks, tempo, hist] = await Promise.all([getJson("/api/reporting-tasks"),
        getJson("/api/tempo").catch((e) => { state.tempoErr = e instanceof TypeError ? "le serveur ne répond pas" : e.message; return null; }),
        getJson("/api/history?by=chantier").catch(() => null)]);
    } catch (e) {
      return fail("Impossible de préparer le rapport", e instanceof TypeError ? "Le serveur ne répond pas." : e.message, true);
    }
    Object.assign(state, { tasks, tempo, hist });
    try {
      render();
      $("loading").hidden = true;
    } catch (e) {
      console.error(e);
      fail("Impossible d'afficher le rapport", `Erreur inattendue dans la page (${e.message}). Recharger la page ; si l'erreur revient, la signaler.`, false);
    }
  }

  $("print").addEventListener("click", () => window.print());
  $("withFeat").addEventListener("change", () => state.tasks && render());
  load();
})();
