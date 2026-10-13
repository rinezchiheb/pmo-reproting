/* PMO Reporting — calculs partagés par la Synthèse et le rapport : météo, indicateurs DEV / QA, burndown (JS natif) */
(() => {
  "use strict";

  const parse = (iso) => new Date(iso + "T00:00:00");
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (iso, n) => { const d = parse(iso); d.setDate(d.getDate() + n); return isoOf(d); };
  const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);

  // Météo : rouge au-delà de la capacité, orange sous tension (≥ 80 % ou tâches en retard), vert sinon
  // unknown : capacité non lue (Tempo indisponible) ; on ne conclut ni « Maîtrisé » ni « Hors capacité »
  const LV = { red: 2, amber: 1, unknown: 0.5, green: 0 };
  const WORD = { red: "Hors capacité", amber: "Sous tension", green: "Maîtrisé", unknown: "Capacité inconnue" };
  function weather(raf, capa, late) {
    if (raf < 0.005 && !late) return { lvl: "green", pct: null, word: "Soldé" };
    if (capa == null && !late) return { lvl: "unknown", pct: null, word: WORD.unknown };
    const pct = capa > 0.005 ? (100 * raf) / capa : capa == null ? null : Infinity;
    const lvl = pct != null && pct > 100 ? "red" : (pct != null && pct >= 80) || late ? "amber" : "green";
    return { lvl, pct, word: WORD[lvl] };
  }
  const worst = (...ws) => ws.reduce((a, w) => (LV[w.lvl] > LV[a.lvl] ? w : a));
  const pctTxt = (p) => (p == null ? "—" : p === Infinity ? "∞" : `${Math.round(p)} %`);
  const SIDE = { dev: { lbl: "Développement", ms: "freeze_code", msLbl: "Freeze Code", alert: "APRES_FREEZE" },
    qa: { lbl: "Recette", ms: "fin_test", msLbl: "fin de test", alert: "APRES_FIN_TEST" } };

  function sideOf(r, m) {
    const t = (r.type || "").toLowerCase();
    if ((m.raf_dev_types || []).some((x) => x.toLowerCase() === t)) return "dev";
    if ((m.raf_qa_types || []).some((x) => x.toLowerCase() === t)) return "qa";
    return null;
  }
  const has = (r, ...codes) => r.alerts.some((a) => codes.includes(a.code));
  // Avancement : temps passé / (temps passé + reste à faire), en JH
  const progress = (rows) => { const sp = sum(rows, (r) => r.spent_hj), raf = sum(rows, (r) => (r.done ? 0 : r.raf_hj)); return sp + raf > 0.005 ? (100 * sp) / (sp + raf) : rows.length && rows.every((r) => r.done) ? 100 : null; };
  // Échéances d'un côté : la plus tardive parmi les tâches ouvertes, et combien dépassent le jalon
  function dueOf(rows, side, m) {
    const ms = m[SIDE[side].ms], k = side === "dev" ? "due_dev" : "due_qa";
    const dues = rows.filter((r) => !r.done && r[k]).map((r) => r[k]).sort();
    return { last: dues.at(-1) || null, after: ms ? dues.filter((d) => d > ms).length : 0, none: rows.filter((r) => !r.done && !r[k]).length, ms };
  }

  // Indicateurs d'un côté (DEV ou QA) pour un chantier ; jamais de cumul entre chantiers
  function sideStats(side, rows, m, tempo, ch) {
    const mine = rows.filter((r) => sideOf(r, m) === side);
    const open = mine.filter((r) => !r.done);
    const raf = sum(mine, (r) => (side === "dev" ? r.raf_dev : r.raf_qa));
    const tc = tempo ? tempo.chantiers.find((c) => c.chantier === ch) : null;
    const capa = tempo ? tc?.[`capa_real_${side}`] ?? 0 : null;
    const burn = tempo ? tempo.burn.filter((b) => b.side === side && b.ch === ch) : [];
    const late = open.filter((r) => has(r, "RETARD", "BLOQUEE")).length;
    return { side, raf, capa, capaSprint: tempo ? tc?.[`capa_sprint_${side}`] ?? 0 : null,
      brute: tc?.[`brute_${side}`] ?? null, imputed: tc?.[`imputed_${side}`] ?? null,
      total: mine.length, done: mine.filter((r) => r.done).length, open: open.length, late,
      after: open.filter((r) => has(r, SIDE[side].alert)).length, unest: open.filter((r) => has(r, "RAF_A_ESTIMER")).length,
      noest: open.filter((r) => has(r, "SANS_ESTIMATION")).length, progress: progress(mine), due: dueOf(mine, side, m),
      consumed: sum(burn, (b) => b.jh), burn, w: weather(raf, capa, late) };
  }

  // Tous les chantiers, chacun jugé séparément
  function chantiers(rows, m, tempo) {
    const names = [...new Set(rows.map((r) => r.chantier))].sort((a, b) => a.localeCompare(b, "fr"));
    return names.map((name) => {
      const r = rows.filter((x) => x.chantier === name);
      const dev = sideStats("dev", r, m, tempo, name), qa = sideStats("qa", r, m, tempo, name);
      return { name, rows: r, dev, qa, total: r.length, done: r.filter((x) => x.done).length, late: dev.late + qa.late,
        progress: progress(r), w: worst(dev.w, qa.w) };
    });
  }

  // Burndown d'un côté : une entrée par fin de journée, de la veille du sprint au jalon.
  // RAF d'un jour passé : celui du relevé enregistré ce jour-là (réestimations comprises) ; sans relevé, celui du
  // relevé suivant (ou du jour affiché) + ce qui a été imputé entre-temps. Capacité restante des personnes affectées.
  // hist : /api/history?by=chantier (jours du sprint avec relevé).
  function burnSeries(st, m, tempo, ch, hist) {
    const ms = m[SIDE[st.side].ms];
    if (!m.sprint_start || !ms) return null;
    const today = m.today, start = m.sprint_start, end = addDays(ms, 1), hpd = m.hours_per_day || 8;
    const byDay = st.burn.reduce((a, b) => ((a[b.d] = (a[b.d] || 0) + b.jh), a), {});
    const snaps = (hist?.days || []).filter((h) => h.by_chantier && h.day < today)
      .map((h) => [h.day, (h.by_chantier[ch] || {})[`raf_${st.side}`] || 0]);
    const imputedIn = (lo, hi) => Object.entries(byDay).reduce((a, [k, v]) => a + (k > lo && k <= hi ? v : 0), 0);
    const rafAt = (d) => {
      const [day, v] = snaps.find(([x]) => x >= d) || [today, st.raf];
      return v + imputedIn(d, day);
    };
    const people = (tempo?.people || []).filter((p) => p.in_team && p.profile === st.side && (p.affectation || {})[ch]);
    const capDay = {};
    for (const p of people) for (const dd of p.days) if (dd.date >= start && dd.date <= ms) {
      capDay[dd.date] = (capDay[dd.date] || 0) + (dd.capa_h * p.affectation[ch]) / 100 / hpd;
    }
    const capAfter = (d) => Object.entries(capDay).reduce((a, [k, v]) => a + (k > d ? v : 0), 0);
    const startV = rafAt(addDays(start, -1));
    const series = [];
    let cum = 0;
    for (let d = addDays(start, -1); d <= ms; d = addDays(d, 1)) {
      if (d >= start) cum += byDay[d] || 0;
      const known = d <= today;
      const frac = (parse(addDays(d, 1)) - parse(start)) / (parse(end) - parse(start));
      series.push({ d, at: addDays(d, 1), raf: known ? rafAt(d) : null, ideal: Math.max(0, startV * (1 - frac)),
        cap: people.length ? capAfter(d) : null, cons: known ? cum : null });
    }
    const now = series.filter((p) => p.raf != null).at(-1) || series[0];
    const capNow = people.length ? capAfter(addDays(now.d, -1)) : null;
    return { series, start, end, ms, today, now, capNow, hasCap: people.length > 0 };
  }

  // Planifié vs consommé (effort) : estimé initial face au consommé + reste à faire (« à terminaison »).
  // Une tâche finie n'a plus de reste ; une tâche sans estimation compte comme travail non prévu.
  // Seuils de l'écart : jusqu'à +5 % conforme, jusqu'à +20 % dérive, au-delà forte dérive.
  const EFFORT_WORD = { ok: "Conforme", amber: "Dérive", red: "Forte dérive", none: "Rien d'estimé" };
  function effort(rows) {
    const est = sum(rows, (r) => r.estim_hj), spent = sum(rows, (r) => r.spent_hj), raf = sum(rows, (r) => (r.done ? 0 : r.raf_hj));
    const fin = spent + raf, gap = fin - est, pct = est > 0.005 ? (100 * gap) / est : null;
    const noest = rows.filter((r) => !(r.estim_hj > 0) && r.spent_hj + (r.done ? 0 : r.raf_hj) > 0.005);
    const lvl = est < 0.005 && fin < 0.005 ? "none" : pct == null ? "red" : pct > 20 ? "red" : pct > 5 ? "amber" : "ok";
    return { est, spent, raf, fin, gap, pct, lvl, word: EFFORT_WORD[lvl], n: rows.length, noest: noest.length, noestJh: sum(noest, (r) => r.spent_hj + (r.done ? 0 : r.raf_hj)) };
  }

  window.KPI = { LV, WORD, SIDE, weather, worst, pctTxt, sideOf, has, progress, sideStats, chantiers, burnSeries, parse, addDays, sum, effort, EFFORT_WORD };
})();
