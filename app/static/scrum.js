/* PMO Reporting — Pilotage « Scrum events » : respect de la part réservée aux cérémonies (JS natif).
   DEV et QA seulement. Ratio = scrum events ÷ temps travaillé (tâches du sprint + scrum events + autres sujets, absences exclues),
   jour par jour et en cumul, face à l'objectif (paramètre de capacité tempo.scrum_events.percent.team, qui retire la même part
   du temps disponible dans la capacité : une seule définition, mêmes chiffres que la page Temps et la Synthèse).
   Scrum ÷ (dév + test) reste affiché pour information, sans verdict. Données : /api/scrum-events (faits Tempo). */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 1) => (n ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtDate = (iso) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const sprintName = (n) => (/sprint/i.test(n || "") ? n : `Sprint ${n || "—"}`);
  const PROF = { dev: "DEV", qa: "QA" };
  const KINDS = [["daily", "Daily"], ["planning", "Sprint planning"], ["review", "Sprint review, démo"], ["retro", "Rétrospective"], ["affinage", "Affinage du backlog"], ["autre", "Non précisé"]];
  const TRANSVERSE = "Transverse";
  const TOL = 2; // points de tolérance au-dessus de l'objectif avant « dépassé »
  const MIN_PERSON_JH = 2; // ratio individuel calculé à partir de 2 JH travaillés sur le sprint

  const URLP = new URLSearchParams(location.search);
  const state = {
    data: null, step: "day",
    f: { ch: URLP.get("ch") || "", who: URLP.get("who") || "", prof: ["dev", "qa"].includes(URLP.get("prof")) ? URLP.get("prof") : "" },
  };

  // ---- règles
  const jh = (h) => h / (state.data?.meta.hours_per_day || 8);
  const target = () => state.data.target;
  const empty = () => ({ scrum: 0, dev: 0, qa: 0, us: 0, autres: 0, absence: 0 });
  function add(a, cat, h) { a[cat] = (a[cat] || 0) + h; return a; }
  const real = (a) => a.dev + a.qa + a.us;
  const worked = (a) => real(a) + a.scrum + a.autres;
  const base = worked;
  // en dessous de min heures de base, pas de ratio
  const ratio = (a, min = 0.5) => (base(a) >= min ? (100 * a.scrum) / base(a) : null);
  // information seulement (ancien ratio) : scrum ÷ développement + test
  const ratioReal = (a) => (real(a) >= 0.5 ? (100 * a.scrum) / real(a) : null);
  function status(r) {
    const t = target();
    if (r == null) return { cls: "none", word: "—" };
    if (r > t + TOL) return { cls: "red", word: "dépassé" };
    if (r > t) return { cls: "amber", word: "à la limite" };
    if (r < t / 2) return { cls: "info", word: "faible, saisie à vérifier" };
    return { cls: "ok", word: "respecté" };
  }
  const pctTxt = (r) => (r == null ? "—" : `${num(r)} %`);

  // ---- filtres
  function inPop(i) {
    const p = state.data.people[i];
    const prof = state.f.prof;
    const okProf = !prof || p.profile === prof;  // le serveur ne renvoie que les DEV et QA
    return okProf && (!state.f.who || p.name === state.f.who);
  }
  const okCh = (ch) => !state.f.ch || ch === state.f.ch;
  function writeUrl() {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(state.f)) v ? p.set(k, v) : p.delete(k);
    history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : ""));
  }
  function fillSelects() {
    const d = state.data;
    const opt = (id, vals, want, all) => {
      const list = [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
      if (want && !list.includes(want)) list.unshift(want);
      $(id).innerHTML = `<option value="">${all}</option>` + list.map((v) => `<option value="${esc(v)}" ${v === want ? "selected" : ""}>${esc(v)}</option>`).join("");
      $(id).classList.toggle("set", !!want);
    };
    opt("f-ch", d.facts.filter((f) => f[2] !== "scrum").map((f) => f[3]), state.f.ch, "Tous");
    const prof = state.f.prof;
    window.Pilotage.fillPeople("f-who", d.people.filter((p) => !prof || p.profile === prof).map((p) => p.name), state.f.who, "Toutes");
    $("f-prof").value = state.f.prof;
    $("f-prof").classList.toggle("set", !!state.f.prof);
  }

  // ---- rendu
  function render() {
    const d = state.data, m = d.meta, t = target();
    fillSelects();
    writeUrl();
    const facts = d.facts.filter((f) => inPop(f[1]) && okCh(f[3]));
    const kinds = d.kinds.filter((f) => inPop(f[1]) && okCh(f[3]));
    const tot = facts.reduce((a, f) => add(a, f[2], f[4]), empty());
    const days = [...new Set(facts.map((f) => f[0]))].sort();
    const perDay = new Map(days.map((x) => [x, empty()]));
    for (const f of facts) add(perDay.get(f[0]), f[2], f[4]);
    const until = d.period.today < d.period.end ? d.period.today : d.period.end;
    $("scSub").textContent = `${d.team.name} · ${sprintName(m.sprint)} · du ${fmtDate(d.period.start)} au ${fmtDate(until)}` +
      `${state.f.ch ? ` · ${state.f.ch}` : ""}${state.f.who ? ` · ${state.f.who}` : ""}`;
    $("scRule").innerHTML = `<b>Ratio</b> = scrum events ÷ temps travaillé (tâches du sprint + scrum events + autres sujets, absences exclues), sur les DEV et QA (TL / PO exclus) : même base que le paramètre de capacité et la page Temps. ` +
      `<b>Objectif</b> : ${num(t, 0)} % au plus (paramètre de capacité DEV / QA) ; « à la limite » jusqu'à +${TOL} pts. ` +
      `Développement = tâches DEV, anomalies de test et bogues ; scrum events = tâches Tempo dont le résumé contient « ${d.scrum_rule.match.map(esc).join(" », « ")} ».`;

    // ---- indicateurs
    const r = ratio(tot), st = status(r);
    const budget = (t / 100) * base(tot), gap = tot.scrum - budget;
    const pDays = new Set(facts.filter((f) => f[2] !== "absence").map((f) => `${f[0]}|${f[1]}`)).size;
    const last = days.slice(-5).reduce((a, x) => { for (const k in a) a[k] += perDay.get(x)[k]; return a; }, empty());
    const rl = ratio(last);
    const over = days.filter((x) => (ratio(perDay.get(x)) ?? 0) > t);
    const kpi = (lbl, val, sub, cls = "") => `<div class="kpi ${cls}"><span class="lbl">${lbl}</span><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
    const cls = { red: "danger", amber: "warn" };
    $("scKpis").innerHTML =
      kpi("Scrum ÷ temps travaillé", `${pctTxt(r)}`, `objectif ≤ ${num(t, 0)} % · <b>${st.word}</b> · pour info ${pctTxt(ratioReal(tot))} du dév + test`, cls[st.cls] || "") +
      kpi("Scrum events", `${num(jh(tot.scrum))}<small>JH</small>`, pDays ? `${num(tot.scrum / pDays, 2)} h par personne et par jour` : "aucune saisie") +
      kpi("Temps travaillé", `${num(jh(base(tot)))}<small>JH</small>`, `dév <b>${num(jh(tot.dev))}</b> · test <b>${num(jh(tot.qa))}</b>${tot.us > 0.05 ? ` · US ${num(jh(tot.us))}` : ""} · autres sujets <b>${num(jh(tot.autres))}</b>`) +
      kpi("Écart au budget", `${jh(gap) >= 0.05 ? "+" : jh(gap) <= -0.05 ? "−" : ""}${num(Math.abs(jh(gap)))}<small>JH</small>`, `budget ${num(t, 0)} % = ${num(jh(budget))} JH`, jh(gap) >= 0.05 ? "danger" : "") +
      kpi("5 derniers jours", pctTxt(rl), rl == null || r == null ? "pas assez de saisies" : `<span class="dl ${rl > r + 0.5 ? "bad" : rl < r - 0.5 ? "good" : "same"}">${rl > r + 0.5 ? "en hausse" : rl < r - 0.5 ? "en baisse" : "stable"}</span> face au cumul`, (status(rl).cls === "red" ? "danger" : "")) +
      kpi("Jours au-dessus de l'objectif", `${over.length}<small>/ ${days.length}</small>`, over.length ? `dernier : ${fmtDate(over[over.length - 1])}` : "aucun", over.length > days.length / 2 ? "warn" : "");

    // ---- personnes (indicateurs individuels, réutilisés par les points d'attention)
    const ppl = d.people.map((p, i) => ({ p, i })).filter(({ i }) => inPop(i)).map(({ p, i }) => {
      const mine = facts.filter((f) => f[1] === i);
      const a = mine.reduce((acc, f) => add(acc, f[2], f[4]), empty());
      const pd = new Set(mine.filter((f) => f[2] !== "absence").map((f) => f[0])).size;
      return { p, a, pd, r: ratio(a, MIN_PERSON_JH * (state.data.meta.hours_per_day || 8)) };
    }).filter((x) => worked(x.a) > 0.05);
    const kindTot = kinds.reduce((acc, f) => ((acc[f[2]] = (acc[f[2]] || 0) + f[4]), acc), {});
    const kindSum = Object.values(kindTot).reduce((a, b) => a + b, 0);

    // ---- points d'attention
    const attn = [];
    if (r != null) attn.push(st.cls === "red" || st.cls === "amber"
      ? { lvl: st.cls === "red" ? "danger" : "warn", txt: `Objectif ${st.cls === "red" ? "dépassé" : "à la limite"} : ${num(r)} % pour ${num(t, 0)} %, soit ${num(jh(gap))} JH au-delà du budget.` }
      : st.cls === "info" ? { lvl: "info", txt: `Part très basse (${num(r)} %) : les scrum events sont peut-être saisis ailleurs (vérifier les saisies Tempo).` }
      : { lvl: "ok", txt: `Objectif respecté : ${num(r)} % pour ${num(t, 0)} % (marge de ${num(jh(-gap))} JH).` });
    if (rl != null && r != null && Math.abs(rl - r) >= 1) attn.push({ lvl: rl > r ? "warn" : "ok", txt: `${rl > r ? "En hausse" : "En baisse"} sur les 5 derniers jours : ${num(rl)} % contre ${num(r)} % en cumul.` });
    const hi = ppl.filter((x) => x.r != null && x.r > t + 5).sort((a, b) => b.r - a.r);
    if (hi.length) attn.push({ lvl: "warn", txt: `${plural(hi.length, "personne", "personnes")} au-delà de ${num(t + 5, 0)} % : ${hi.slice(0, 4).map((x) => `${esc(x.p.name)} (${num(x.r, 0)} %)`).join(", ")}${hi.length > 4 ? "…" : ""}.` });
    const none = ppl.filter((x) => x.a.scrum < 0.05 && jh(worked(x.a)) >= 2);
    if (none.length) attn.push({ lvl: "info", txt: `Aucun scrum event saisi par ${none.slice(0, 4).map((x) => esc(x.p.name)).join(", ")}${none.length > 4 ? "…" : ""} : saisie à vérifier.` });
    if (kindSum > 0.5 && (kindTot.autre || 0) / kindSum > 0.5) attn.push({ lvl: "info", txt: `${num((100 * (kindTot.autre || 0)) / kindSum, 0)} % des scrum events sans nature dans le commentaire Tempo : préciser « daily », « planning », « review », « rétro » ou « affinage » pour suivre chaque cérémonie.` });
    $("scAttn").innerHTML = attn.map((a) => `<li class="${a.lvl}">${a.txt}</li>`).join("");

    renderEvo(days, perDay);
    renderPeople(ppl);
    renderCh(facts);
    renderKinds(kindTot, kindSum);
  }

  // ---- au fil du sprint : graphique + tableau (par jour ou par semaine)
  const monday = (iso) => { const x = new Date(iso + "T00:00:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  function renderEvo(days, perDay) {
    const t = target(), m = state.data.meta;
    let periods = days.map((x) => ({ key: x, lbl: fmtDate(x), a: perDay.get(x) }));
    if (state.step === "week") {
      const g = new Map();
      for (const p of periods) { const k = monday(p.key); if (!g.has(k)) g.set(k, { key: k, lbl: `sem. du ${fmtDate(k)}`, a: empty() }); const a = g.get(k).a; for (const c in a) a[c] += p.a[c]; }
      periods = [...g.values()];
    }
    const cum = empty();
    for (const p of periods) { for (const c in cum) cum[c] += p.a[c]; p.r = ratio(p.a); p.rc = ratio(cum); }
    if (!periods.length) { $("scChart").innerHTML = `<p class="empty">Aucune saisie pour ces filtres.</p>`; $("scEvo").innerHTML = ""; return; }

    // graphique : barres = ratio de la période, ligne = ratio cumulé, pointillé = objectif
    const W = 900, H = 230, L = 44, R = 16, T = 14, B = 30;
    const vals = periods.flatMap((p) => [p.r ?? 0, p.rc ?? 0]);
    const max = Math.max(t * 1.8, ...vals) * 1.08;
    const n = periods.length, bw = Math.min(46, ((W - L - R) / n) * 0.62);
    const x = (i) => L + ((W - L - R) * (i + 0.5)) / n, y = (v) => T + (H - T - B) * (1 - v / max);
    const ticks = [0, t, Math.round(max * 0.95 / 5) * 5].filter((v, i, a) => a.indexOf(v) === i && v <= max)
      .map((v) => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v} %</text>`).join("");
    const bars = periods.map((p, i) => p.r == null ? "" : `<rect class="b ${status(p.r).cls}" x="${(x(i) - bw / 2).toFixed(1)}" y="${y(p.r).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - B - y(p.r)).toFixed(1)}" rx="3"><title>${esc(p.lbl)} : ${pctTxt(p.r)} (cumul ${pctTxt(p.rc)})</title></rect>`).join("");
    const pts = periods.map((p, i) => [x(i), p.rc]).filter((q) => q[1] != null);
    const line = pts.length ? `<path class="cum" d="${pts.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)},${y(q[1]).toFixed(1)}`).join("")}"/>` + pts.map((q) => `<circle class="cum" cx="${q[0].toFixed(1)}" cy="${y(q[1]).toFixed(1)}" r="3"/>`).join("") : "";
    const every = Math.max(1, Math.ceil(n / 12));
    const xl = periods.map((p, i) => (i % every === 0 || i === n - 1 ? `<text class="ax" x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(state.step === "week" ? fmtDate(p.key) : p.lbl)}</text>` : "")).join("");
    // jalons du sprint (Freeze Code, fin de test) sur la vue par jour
    const msDays = new Map();  // Freeze Code et fin de test le même jour : un seul repère
    if (state.step === "day") for (const [k, l] of [["freeze_code", "Freeze Code"], ["fin_test", "fin de test"]]) if (m[k]) msDays.set(m[k], msDays.has(m[k]) ? `${msDays.get(m[k])} · ${l}` : l);
    const ms = [...msDays].map(([day, l]) => { const i = periods.findIndex((p) => p.key === day); return i < 0 ? "" : `<line class="ms" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/><text class="ax ms-t" x="${x(i) - 4}" y="${T + 10}" text-anchor="end">${l}</text>`; }).join("");
    const lastRc = periods[n - 1].rc;
    $("scChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Part des scrum events par ${state.step === "week" ? "semaine" : "jour"} ; cumul ${pctTxt(lastRc)} pour un objectif de ${t} %`)}">
      ${ticks}${bars}<line class="target" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>${ms}${line}${xl}</svg>
      <p class="ef-legend muted"><span class="k bar"></span>Ratio de la période (vert : respecté, orange : à la limite, rouge : dépassé) <span class="k cum"></span>Ratio cumulé <span class="k target"></span>Objectif ${num(t, 0)} %</p>`;

    $("scEvo").innerHTML = `<thead><tr><th>${state.step === "week" ? "Semaine" : "Jour"}</th><th class="num">Scrum</th><th class="num">Dév</th><th class="num">Test</th><th class="num">Autres US</th><th class="num">Autres sujets</th><th class="num">Ratio</th><th class="num">Cumul</th><th>État (cumul)</th></tr></thead><tbody>` +
      periods.map((p) => { const s = status(p.rc); return `<tr><td><b>${esc(p.lbl)}</b></td><td class="num">${num(jh(p.a.scrum), 2)}</td><td class="num">${num(jh(p.a.dev), 2)}</td><td class="num">${num(jh(p.a.qa), 2)}</td><td class="num muted">${num(jh(p.a.us), 2)}</td><td class="num muted">${num(jh(p.a.autres), 2)}</td>
        <td class="num"><span class="ef-gap ${status(p.r).cls}">${pctTxt(p.r)}</span></td><td class="num"><b>${pctTxt(p.rc)}</b></td><td><span class="ef-state ${s.cls}">${s.word}</span></td></tr>`; }).join("") +
      `</tbody><tfoot><tr><td colspan="9" class="muted">En JH. Ratio = scrum ÷ (scrum + dév + test + autres US + autres sujets). Jours sans saisie non affichés.</td></tr></tfoot>`;
  }

  // ---- par personne
  function bar(r) {
    if (r == null) return "";
    const t = target(), max = t * 2.5;
    return `<div class="sc-bar ${status(r).cls}" aria-hidden="true"><i style="width:${Math.min(100, (100 * r) / max).toFixed(1)}%"></i><b style="left:${((100 * t) / max).toFixed(1)}%"></b></div>`;
  }
  function renderPeople(ppl) {
    ppl.sort((a, b) => (b.r ?? -1) - (a.r ?? -1) || a.p.name.localeCompare(b.p.name, "fr"));
    $("scPeople").innerHTML = `<thead><tr><th>Personne</th><th class="num">Scrum</th><th class="num">Dév</th><th class="num">Test</th><th class="num">Autres sujets</th><th class="num">Ratio</th><th class="sc-viz">Face à l'objectif</th><th class="num">Pour info : ÷ dév + test</th><th class="num">Scrum par jour</th><th>État</th></tr></thead><tbody>` +
      (ppl.length ? ppl.map(({ p, a, pd, r }) => { const s = status(r); return `<tr><td><b>${esc(p.name)}</b><span class="stack">${esc(p.label || PROF[p.profile] || "")}${p.role ? ` · ${esc(p.role)}` : ""}</span></td>
        <td class="num"><b>${num(jh(a.scrum), 2)}</b></td><td class="num">${num(jh(a.dev), 2)}</td><td class="num">${num(jh(a.qa), 2)}</td><td class="num muted">${num(jh(a.autres), 2)}</td>
        <td class="num">${r == null ? `<span class="muted" title="Moins de ${MIN_PERSON_JH} JH travaillés sur le sprint">peu de temps saisi</span>` : `<span class="ef-gap ${s.cls}">${pctTxt(r)}</span>`}</td><td class="sc-viz">${bar(r)}</td>
        <td class="num muted">${pctTxt(ratioReal(a))}</td><td class="num">${pd ? `${num(a.scrum / pd, 2)} h` : "—"}</td>
        <td><span class="ef-state ${s.cls}">${s.word}</span></td></tr>`; }).join("")
        : `<tr><td colspan="10" class="empty">Aucune saisie pour ces filtres.</td></tr>`) + "</tbody>";
  }

  // ---- par chantier : scrum de la tâche Tempo du chantier ÷ temps travaillé sur le chantier (ses tâches + ce scrum ;
  //      les autres sujets ne se rattachent à aucun chantier)
  function renderCh(facts) {
    const g = new Map();
    for (const f of facts) { if (!f[3]) continue; if (!g.has(f[3])) g.set(f[3], empty()); add(g.get(f[3]), f[2], f[4]); }
    const list = [...g.entries()].filter(([ch]) => ch !== TRANSVERSE).map(([ch, a]) => ({ ch, a, r: real(a) >= 0.5 ? (100 * a.scrum) / (real(a) + a.scrum) : null }))  // pas de ratio sans tâche saisie sur le chantier
      .sort((a, b) => (b.r ?? -1) - (a.r ?? -1));
    const tr = g.get(TRANSVERSE);
    $("scCh").innerHTML = `<thead><tr><th>Chantier</th><th class="num">Scrum</th><th class="num">Tâches du chantier</th><th class="num">Ratio</th><th>État</th></tr></thead><tbody>` +
      (list.length ? list.map(({ ch, a, r }) => { const s = status(r); return `<tr><td><b>${esc(ch)}</b></td><td class="num">${num(jh(a.scrum), 2)}</td><td class="num">${num(jh(real(a)), 2)}</td><td class="num"><span class="ef-gap ${s.cls}">${pctTxt(r)}</span></td><td><span class="ef-state ${s.cls}">${s.word}</span></td></tr>`; }).join("")
        : `<tr><td colspan="5" class="empty">Aucune saisie pour ces filtres.</td></tr>`) +
      (tr && tr.scrum > 0.05 ? `<tr><td>${TRANSVERSE}<span class="stack">tâches scrum sans chantier dans le résumé</span></td><td class="num">${num(jh(tr.scrum), 2)}</td><td class="num muted">—</td><td class="num muted">—</td><td class="muted">non réparti</td></tr>` : "") + "</tbody>";
  }

  // ---- nature des events
  function renderKinds(tot, sum) {
    $("scKind").innerHTML = `<thead><tr><th>Cérémonie</th><th class="num">JH</th><th class="num">Part</th><th class="sc-viz"></th></tr></thead><tbody>` +
      (sum > 0.05 ? KINDS.filter(([k]) => tot[k] > 0.005).map(([k, l]) => `<tr><td>${k === "autre" ? `<span class="muted">${l}</span>` : `<b>${l}</b>`}</td><td class="num">${num(jh(tot[k]), 2)}</td><td class="num">${num((100 * tot[k]) / sum, 0)} %</td>
        <td class="sc-viz"><div class="sc-bar ${k === "autre" ? "none" : "ok"}" aria-hidden="true"><i style="width:${((100 * tot[k]) / sum).toFixed(1)}%"></i></div></td></tr>`).join("")
        : `<tr><td colspan="4" class="empty">Aucun scrum event saisi pour ces filtres.</td></tr>`) + "</tbody>";
    $("scKindNote").textContent = "Nature lue dans le commentaire de la saisie Tempo (daily, planning, review ou démo, rétro, affinage ou backlog). Le commentaire par défaut « Working on issue … » compte en « Non précisé ».";
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
      state.data = await getJson("/api/scrum-events" + (refresh ? "?refresh=true" : ""));
      const m = state.data.meta;
      $("source").textContent = "Tempo en direct"; $("source").className = "badge live";
      $("lastSync").textContent = "Mis à jour à " + (m.tempo_generated_at || m.generated_at).slice(11, 16);
      render();
      $("loading").hidden = true; $("stale").hidden = true;
    } catch (e) {
      console.error(e);
      const msg = e instanceof TypeError ? "le serveur ne répond pas" : e.message;
      if (first) {
        const c = $("loadingCard");
        c.setAttribute("role", "alert");
        c.innerHTML = `<div class="le"><b>Impossible de lire Tempo</b><p></p><p class="muted">Vérifier la connexion VPN ou le Wi-Fi entreprise, et les réglages Tempo dans les Paramètres, puis réessayer.</p><button type="button" class="btn primary" id="retryLoad">Réessayer</button></div>`;
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

  ["f-ch", "f-who", "f-prof"].forEach((id) => $(id).addEventListener("change", (e) => {
    state.f[id.slice(2)] = e.target.value;
    if (id === "f-prof") state.f.who = "";  // la personne choisie peut sortir du profil
    render();
  }));
  $("scStep").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.step = b.dataset.s;
    document.querySelectorAll("#scStep button").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
    render();
  });
  $("refresh").addEventListener("click", () => load(true));
  load();
})();
