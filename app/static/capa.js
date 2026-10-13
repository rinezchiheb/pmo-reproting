/* PMO Reporting — page Capa vs RAF : capacité et temps saisis lus dans Tempo (JS natif) */
(() => {
  "use strict";

  const state = { data: null };
  // Filtres de la page (repris dans l'URL, comme sur Reporting Tasks)
  const FILTERS = ["ch", "prof", "who", "load"];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 2) => (n ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: d });
  const jh = (n) => (n == null ? "—" : n >= 0.005 ? num(n) : "0");
  // Tempo compte en heures : tout s'affiche en JH (heures ÷ heures par JH)
  const hj = (h) => num(h / (state.data?.meta.hours_per_day || 8), 2);
  const parse = (iso) => new Date(iso + "T00:00:00");
  const fmtDay = (iso) => parse(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const fmtDate = (iso) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const daysTo = (iso, today) => Math.round((parse(iso) - parse(today)) / 86400000);
  const jLabel = (iso, today) => { const d = daysTo(iso, today); return d < 0 ? `passé de ${-d} j` : d === 0 ? "aujourd'hui" : `dans ${d} j`; };

  // Charge = RAF / capacité. Au-delà de 100 % le RAF ne tient pas dans le temps disponible.
  // Mêmes mots et mêmes seuils que la Synthèse et le rapport (kpi.js) : Maîtrisé, Sous tension, Hors capacité.
  const LOAD_WORD = { ok: "Maîtrisé", warn: "Sous tension", danger: "Hors capacité", free: "Sans RAF" };
  function load(raf, capa) {
    if (capa == null) return { lvl: "none", pct: null, txt: "Hors équipe" };
    if (raf < 0.005) return { lvl: "free", pct: 0, txt: LOAD_WORD.free };
    if (capa < 0.005) return { lvl: "danger", pct: Infinity, txt: "Aucune capacité restante" };
    const pct = (100 * raf) / capa, lvl = pct > 100 ? "danger" : pct >= 80 ? "warn" : "ok";
    return { lvl, pct, txt: LOAD_WORD[lvl] };
  }
  const LVL = { danger: 0, warn: 1, ok: 2, free: 3, none: 4 };
  // Nom du sprint affiché : « Sprint 12 », mais « PI17 Sprint 3 » tel quel (pas de « Sprint PI17 Sprint 3 »)
  const sprintName = (n) => (/sprint/i.test(n || "") ? n : `Sprint ${n || "—"}`);
  const PROF = { dev: "DEV", qa: "QA", lead: "TL / PO" };
  const loadCell = (l) => {
    if (l.pct == null) return `<td class="ld none" colspan="1"><span class="muted">${l.txt}</span></td>`;
    const w = l.pct === Infinity ? 100 : Math.min(100, l.pct);
    const pctTxt = l.pct === Infinity ? "—" : `${Math.round(l.pct)} %`;  // le texte dessous dit « Aucune capacité restante »
    return `<td class="ld ${l.lvl}"><div class="ld-row"><span class="ld-bar" aria-hidden="true"><i style="width:${w.toFixed(0)}%"></i></span><b>${l.lvl === "free" ? "—" : pctTxt}</b></div><span class="ld-txt">${l.txt}</span></td>`;
  };

  function render() {
    const d = state.data, m = d.meta, today = m.today;
    const f = readFilters();
    fillSelects(f);
    writeUrl(f);
    const matchP = (p) => personMatch(p, f);
    const team = d.people.filter((p) => p.in_team && matchP(p));
    const sp = fmtDate(d.period.start);
    $("capaSub").textContent = `${d.team.name} · ${plural(d.team.members, "membre", "membres")} · ${sprintName(m.sprint)} · planning et temps Tempo`;
    $("capaRule").innerHTML = `<b>DEV</b> jusqu'au Freeze Code face au RAF DEV, <b>QA</b> jusqu'à la fin de test face au RAF QA, jamais additionnées. ` +
      `<b>Capacité du sprint</b> = du ${sp} au jalon, (planning × disponibilité − absences − scrum events) × affectation. ` +
      `<b>Capacité restante</b> = d'aujourd'hui au jalon, jour par jour, (disponible − temps déjà imputé ce jour-là − scrum events) × affectation : c'est elle qui se compare au RAF. Les jours passés non saisis n'en font pas partie (voir « Temps non saisis »).`;
    const capOf = (p) => p.capa_real;
    const chCap = (c, prof) => c[`capa_real_${prof}`];

    // Une ligne par personne : sa capacité (DEV ou QA) face au RAF de son profil
    const rafOf = (p) => (p.profile === "qa" ? p.raf_qa : p.profile === "dev" ? p.raf_dev : p.raf_dev + p.raf_qa);
    const rows = d.people.map((p) => ({
      p, raf: rafOf(p), other: p.profile === "qa" ? p.raf_dev : p.profile === "dev" ? p.raf_qa : 0,
      l: p.profile === "lead" ? { lvl: "none", pct: null, txt: "Pas de capacité de réalisation" } : load(rafOf(p), capOf(p)),
    }));
    const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
    // Synthèse : chantier choisi (et pas de personne) → chiffres du chantier ; sinon personnes filtrées
    const chSel = f.ch && !f.who && !f.q ? d.chantiers.find((c) => c.chantier === f.ch) : null;
    const side = (prof) => {
      if (chSel) {
        return { n: chSel.people.filter((x) => x.profile === prof).length, sprint: chSel[`capa_sprint_${prof}`], imp: chSel[`imputed_${prof}`],
          cap: chSel[`capa_real_${prof}`], raf: prof === "dev" ? chSel.raf_dev : chSel.raf_qa, key: `ch:${prof}:${chSel.chantier}` };
      }
      const ps = team.filter((p) => p.profile === prof);
      return { n: ps.length, sprint: sum(ps, (p) => p.capa_sprint), imp: sum(ps, (p) => p.imputed),
        cap: sum(ps, capOf), raf: sum(d.people.filter(matchP), (p) => (prof === "dev" ? p.raf_dev : p.raf_qa)), key: `team:${prof}` };
    };
    state.teamFilter = matchP;
    const over = rows.filter((r) => matchP(r.p) && r.l.lvl === "danger").length;
    const missing = team.filter((p) => p.missing_h > 0.01);
    const kpi = (lbl, val, sub, cls = "") => `<div class="kpi ${cls}"><span class="lbl">${lbl}</span><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
    const sideKpi = (lbl, iso, prof) => {
      const x = side(prof), pct = x.cap > 0.005 ? Math.round((100 * x.raf) / x.cap) : null;
      return kpi(`${lbl} <small class="kj">${jLabel(iso, today)}</small>`,
        `${capaBtn(x.cap, x.key, `Détail du calcul de la capacité ${PROF[prof]}${chSel ? ` de ${chSel.chantier}` : " de l'équipe"}`)}<small>JH</small>`,
        `<b>${jh(x.raf)} JH</b> de RAF ${PROF[prof]}${pct != null ? ` · ${pct} %` : ""}<br>Capacité du sprint ${jh(x.sprint)} JH · déjà imputé ${jh(x.imp)} JH`,
        x.raf > x.cap ? "danger" : x.raf >= 0.8 * x.cap ? "warn" : "");
    };
    $("capaKpis").innerHTML =
      (m.freeze_code && f.prof !== "qa" && f.prof !== "lead" ? sideKpi(`Capacité DEV restante${chSel ? ` · ${esc(chSel.chantier)}` : ""} → Freeze`, m.freeze_code, "dev") : "") +
      (m.fin_test && f.prof !== "dev" && f.prof !== "lead" ? sideKpi(`Capacité QA restante${chSel ? ` · ${esc(chSel.chantier)}` : ""} → Fin de test`, m.fin_test, "qa") : "") +
      kpi("Hors capacité", over, over ? `<b>${plural(over, "personne a plus de RAF que de capacité", "personnes ont plus de RAF que de capacité")}</b>` : "personne au-delà de sa capacité", over ? "danger" : "") +
      kpi("Temps non saisis", `${hj(sum(missing, (p) => p.missing_h))}<small>JH</small>`, missing.length ? `<b>${plural(missing.length, "personne", "personnes")}</b> en retard de saisie` : "saisie à jour", missing.length ? "warn" : "");

    const grpHead = (lbl, iso, span) => `<th colspan="${span}" class="grp-h">${iso ? `<span class="vd-j">${jLabel(iso, today)}</span>` : ""}${lbl}${iso ? `<small>${esc(fmtDay(iso))}</small>` : ""}</th>`;
    const capLbl = "Capacité restante";
    // Charge par chantier : côté DEV et côté QA séparés, sur tout le sprint
    const chRows = d.chantiers.filter((c) => (!f.ch || c.chantier === f.ch) && (!f.who || c.people.some((x) => x.name === f.who)))
      .map((c) => ({ c, dev: load(c.raf_dev, chCap(c, "dev")), qa: load(c.raf_qa, chCap(c, "qa")) }))
      .filter(({ dev, qa }) => !f.load || (f.prof !== "qa" && dev.lvl === f.load) || (f.prof !== "dev" && qa.lvl === f.load))
      .sort((a, b) => Math.min(LVL[a.dev.lvl], LVL[a.qa.lvl]) - Math.min(LVL[b.dev.lvl], LVL[b.qa.lvl]) || a.c.chantier.localeCompare(b.c.chantier, "fr"));
    const who = (c, prof) => c.people.filter((x) => x.profile === prof)
      .map((x) => `<span class="aff-chip ${x.src}" title="${PROF[prof]} · ${x.src === "config" ? "affectation paramétrée" : "au prorata de son RAF (pas d'affectation paramétrée)"}">${esc(x.name)} ${x.pct} %</span>`).join("");
    const chSide = (c, prof, l) => `
        <td class="num gs">${jh(c[`capa_sprint_${prof}`])}</td>
        <td class="num">${jh(c[`imputed_${prof}`])}<span class="stack">dont chantier ${jh(c[`real_past_${prof}`])}</span></td>
        <td class="num">${capaBtn(chCap(c, prof), `ch:${prof}:${c.chantier}`, `Détail de la capacité ${PROF[prof]} de ${c.chantier}`)}</td>
        <td class="num">${jh(prof === "dev" ? c.raf_dev : c.raf_qa)}</td>${loadCell(l)}`;
    const subHead = `<th class="num gs" title="Du 1er jour au jalon : (planning × disponibilité − absences − scrum events) × affectation, pour les personnes affectées">Capacité du sprint</th><th class="num" title="Tout le temps imputé dans Tempo par les personnes affectées (× leur part), depuis le 1er jour">Imputé</th><th class="num" title="D'aujourd'hui au jalon : (disponible − déjà imputé − scrum events) × affectation">${capLbl}</th><th class="num">RAF</th><th>Charge</th>`;
    $("chTable").innerHTML = `<thead>
        <tr><th rowspan="2">Chantier<span class="stack">personnes affectées</span></th>${grpHead("DEV → Freeze Code", m.freeze_code, 5)}${grpHead("QA → Fin de test", m.fin_test, 5)}</tr>
        <tr>${subHead}${subHead}</tr>
      </thead><tbody>` + chRows.map(({ c, dev, qa: q }) => `<tr>
        <td class="ch-name"><b>${esc(c.chantier)}</b>${who(c, "dev") ? `<div class="aff"><span class="aff-lbl">DEV</span>${who(c, "dev")}</div>` : ""}${who(c, "qa") ? `<div class="aff"><span class="aff-lbl">QA</span>${who(c, "qa")}</div>` : ""}</td>
        ${chSide(c, "dev", dev)}${chSide(c, "qa", q)}</tr>`).join("") + (chRows.length ? "" : `<tr><td colspan="11" class="empty">Aucun chantier ne correspond aux filtres.</td></tr>`) + "</tbody>";

    // Charge par personne, regroupée par profil, sur tout le sprint
    const only = $("onlyRaf").checked;
    const groups = [
      ["dev", "DEV · jusqu'au Freeze Code", m.freeze_code],
      ["qa", "QA · jusqu'à la fin de test", m.fin_test],
      ["lead", "TL / PO · sans RAF, pas de capacité de réalisation comptée", null],
    ];
    const head = `<thead>
      <tr><th rowspan="2">Personne</th><th rowspan="2">Affectation</th><th rowspan="2" class="num">Dispo</th><th rowspan="2" class="num">Scrum</th>
        <th colspan="3" class="grp-h">Sprint<small>du ${esc(fmtDay(d.period.start))} au jalon, en JH</small></th><th rowspan="2" class="num">RAF</th><th rowspan="2">Charge</th><th rowspan="2" class="num">Absences<br>à venir</th></tr>
      <tr><th class="num gs" title="Du 1er jour au jalon : (planning × disponibilité − absences − scrum events) × affectation">Capacité du sprint</th><th class="num" title="Tout le temps imputé dans Tempo (hors absences), du 1er jour à maintenant, aujourd'hui compris">Imputé</th><th class="num" title="D'aujourd'hui au jalon : (disponible − déjà imputé − scrum events) × affectation">${capLbl}</th></tr>
    </thead>`;
    const srcTxt = { raf: " · profil déduit du RAF", config: " · profil paramétré", role: "" };
    const work = (p) => p.in_team && p.profile !== "lead";
    const line = ({ p, raf, other, l }) => `<tr class="${p.in_team ? "" : "out"}">
        <td><b>${esc(p.name)}</b><span class="stack">${p.in_team ? `${esc(p.label)}${p.role ? ` · ${esc(p.role)}` : ""}${p.categorie !== "lead" ? srcTxt[p.profile_src] || "" : ""}` : `hors ${esc(d.team.name)}`}</span>${presence(p)}</td>
        <td class="aff">${affCell(p)}</td>
        <td class="num">${p.in_team ? `${p.availability} %` : "—"}</td>
        <td class="num">${p.in_team ? `−${num(p.scrum_pct, 1)} %` : "—"}</td>
        <td class="num gs">${work(p) ? jh(p.capa_sprint) : "—"}</td>
        <td class="num">${work(p) ? `${jh(p.imputed)}<span class="stack">dont sprint ${jh(p.imputed_sprint)}</span>` : "—"}</td>
        <td class="num">${capOf(p) == null ? "—" : capaBtn(capOf(p), `p:${p.name}`, `Détail du calcul de la capacité de ${p.name}`)}</td>
        <td class="num">${jh(raf)}${other >= 0.005 ? `<span class="stack warn-t" title="RAF de l'autre profil, non compté dans cette charge">+ ${jh(other)} ${p.profile === "dev" ? "QA" : "DEV"} hors profil</span>` : ""}</td>${loadCell(l)}
        <td class="num">${p.absence_future_jh ? `<span class="abs-chip">${jh(p.absence_future_jh)} JH</span>` : '<span class="muted">—</span>'}</td>
      </tr>`;
    let body = "";
    for (const [prof, title, iso] of groups) {
      const list = rows.filter((r) => r.p.profile === prof && matchP(r.p) && (!f.load || r.l.lvl === f.load) && (!only || r.p.raf_dev + r.p.raf_qa >= 0.005))
        .sort((a, b) => LVL[a.l.lvl] - LVL[b.l.lvl] || b.raf - a.raf || a.p.name.localeCompare(b.p.name, "fr"));
      if (!list.length) continue;
      body += `<tr class="prof-h"><td colspan="10">${iso ? `<span class="vd-j">${jLabel(iso, today)}</span>` : ""}${title}${iso ? `<small>${esc(fmtDay(iso))}</small>` : ""}<span class="muted"> · ${plural(list.length, "personne", "personnes")}</span></td></tr>` + list.map(line).join("");
    }
    $("loadTable").innerHTML = head + "<tbody>" + (body || `<tr><td colspan="10" class="empty">${activeCount(f) ? "Personne ne correspond aux filtres." : "Personne n'a de RAF ouvert."}</td></tr>`) + "</tbody>";
    renderFilterState(f, rows.filter((r) => matchP(r.p) && (!f.load || r.l.lvl === f.load) && (!only || r.p.raf_dev + r.p.raf_qa >= 0.005)).length, d.people.length);

    renderAffectation(d.people.filter((p) => p.in_team && p.profile !== "lead" && matchP(p)), f);
    renderTime(team, today);
  }

  // ---------- filtres
  const PROF_OPTS = [["", "Tous"], ["dev", "DEV"], ["qa", "QA"], ["lead", "TL / PO"]];
  const LOAD_OPTS = [["", "Toutes"], ...["danger", "warn", "ok", "free"].map((k) => [k, LOAD_WORD[k]])];
  const F_LABELS = { ch: "Chantier", prof: "Profil", who: "Personne", load: "Charge" };
  const labelOf = (k, v) => (k === "prof" ? PROF_OPTS : k === "load" ? LOAD_OPTS : []).find(([x]) => x === v)?.[1] || v;

  function readFilters() {
    const f = {};
    FILTERS.forEach((k) => (f[k] = $("f-" + k).dataset.want ?? $("f-" + k).value));
    f.q = $("f-q").value.trim();
    f.onlyRaf = $("onlyRaf").checked;
    return f;
  }
  function personMatch(p, f) {
    if (f.ch && !Object.keys(p.affectation || {}).includes(f.ch)) return false;
    if (f.prof && (p.categorie || p.profile) !== f.prof) return false;  // classement unique DEV / QA / TL / PO, comme Temps
    if (f.who && p.name !== f.who) return false;
    if (f.q && !`${p.name} ${p.role || ""}`.toLowerCase().includes(f.q.toLowerCase())) return false;
    return true;
  }
  function fillSelects(f) {
    const d = state.data;
    const opts = (id, list, val) => {
      const sel = $(id);
      delete sel.dataset.want;
      sel.innerHTML = list.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(l)}</option>`).join("");
      sel.classList.toggle("set", !!val);
    };
    const chs = [...new Set(d.chantiers.map((c) => c.chantier))].sort((a, b) => a.localeCompare(b, "fr"));
    if (f.ch && !chs.includes(f.ch)) chs.unshift(f.ch);
    opts("f-ch", [["", "Tous"], ...chs.map((c) => [c, c])], f.ch);
    opts("f-prof", PROF_OPTS, f.prof);
    // Personnes : selon le chantier et le profil choisis
    const names = [...new Set(d.people.filter((p) => personMatch(p, { ...f, who: "", q: "" })).map((p) => p.name))].sort((a, b) => a.localeCompare(b, "fr"));
    window.Pilotage.fillPeople("f-who", names, f.who, "Toutes");  // liste commune du pilotage
    opts("f-load", LOAD_OPTS, f.load);
  }
  const activeCount = (f) => FILTERS.filter((k) => f[k]).length + (f.q ? 1 : 0) + (f.onlyRaf ? 0 : 1);
  function writeUrl(f) {
    const p = new URLSearchParams();
    FILTERS.forEach((k) => f[k] && p.set(k, f[k]));
    if (f.q) p.set("q", f.q);
    if (!f.onlyRaf) p.set("raf", "0");
    history.replaceState(null, "", p.toString() ? "?" + p : location.pathname);
  }
  function applyUrl() {
    const p = new URLSearchParams(location.search);
    FILTERS.forEach((k) => { if (p.get(k)) $("f-" + k).dataset.want = p.get(k); });
    $("f-q").value = p.get("q") || "";
    $("onlyRaf").checked = p.get("raf") !== "0";
  }
  function renderFilterState(f, n, total) {
    const nAct = activeCount(f);
    $("fCount").innerHTML = nAct ? `<b>${plural(nAct, "filtre", "filtres")}</b> · ${plural(n, "personne", "personnes")}` : `${plural(n, "personne", "personnes")} avec du RAF`;
    $("reset").hidden = !nAct;
    const chip = (k, txt) => `<button type="button" class="f-chip" data-clear="${k}" data-fk="clear:${k}" title="Retirer ce filtre" aria-label="Retirer le filtre ${esc(txt)}"><span>${esc(txt)}</span><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;
    $("fChips").innerHTML = nAct
      ? FILTERS.filter((k) => f[k]).map((k) => chip(k, `${F_LABELS[k]} : ${labelOf(k, f[k])}`)).join("") +
        (f.q ? chip("q", `« ${f.q} »`) : "") + (f.onlyRaf ? "" : chip("raf", "Avec les personnes sans RAF"))
      : `<span class="muted">Aucun filtre</span>`;
    $("fN").hidden = !nAct;
    $("fN").textContent = nAct;
    $("fMiniCount").innerHTML = nAct ? `<b>${n}</b> / ${plural(total, "personne", "personnes")}` : `${plural(n, "personne", "personnes")} avec du RAF`;
  }
  function clearFilter(k) {
    if (FILTERS.includes(k)) $("f-" + k).value = "";
    else if (k === "q") $("f-q").value = "";
    else if (k === "raf") $("onlyRaf").checked = true;
    render();
  }
  function resetFilters() {
    FILTERS.forEach((k) => ($("f-" + k).value = "")); $("f-q").value = ""; $("onlyRaf").checked = true; render();
  }

  // ---------- transparence : détail de chaque capacité
  const capaBtn = (v, key, label) => `<button type="button" class="capa-btn" data-explain="${esc(key)}" title="${esc(label)}" aria-label="${esc(label)} : ${jh(v)} JH">${jh(v)}</button>`;
  const H2J = (h) => h / state.data.meta.hours_per_day;
  const MILESTONE = { dev: "Freeze Code", qa: "fin de test" };
  const UNTIL = { dev: "jusqu'au Freeze Code", qa: "jusqu'à la fin de test" }, TO = { dev: "au Freeze Code", qa: "à la fin de test" };

  // Jours du sprint : disponible, imputé, reste (base de la capacité restante, à partir d'aujourd'hui)
  function sprintRows(p) {
    const m = state.data.meta;
    return (p.days || []).filter((x) => x.date <= p.milestone && (x.required_h > 0 || x.logged_h > 0 || x.absence_h > 0)).map((x) => {
      const dispo = x.planning ? 0 : Math.max(0, x.avail_h - x.absence_h);
      return `<tr class="${x.date > m.today ? "fut" : ""}"><td>${esc(fmtDay(x.date))}${x.date === m.today ? ` <span class="muted">(${m.as_of ? "jour affiché" : "auj."})</span>` : ""}</td>
        <td class="num">${x.planning && x.required_h > 0 ? `<span class="muted" title="1er jour du sprint : sprint planning, sans capacité">sprint planning</span>` : x.required_h > 0 ? num(H2J(dispo)) : `<span class="muted">${x.leave ? esc(LEAVE[x.leave].toLowerCase()) : "non dû"}</span>`}${x.absence_h > 0 ? ` <span class="abs-chip">abs ${num(H2J(x.absence_h))}</span>` : ""}</td>
        <td class="num">${x.logged_h > 0 ? (x.planning ? `<span class="muted" title="Non retiré : ce jour ne porte pas de capacité">${num(H2J(x.logged_h))}</span>` : num(H2J(x.logged_h))) : ""}</td>
        <td class="num">${x.rest_h > 0 ? num(H2J(x.rest_h)) : "0"}</td>
        <td class="num">${x.scrum_h > 0 ? `<span class="muted" title="Scrum déjà imputé ce jour-là">${num(H2J(x.scrum_h))} imputé</span> ` : ""}${x.scrum_res_h > 0 ? `− ${num(H2J(x.scrum_res_h))}` : ""}</td>
        <td class="num">${x.date < m.today ? `<span class="muted" title="Jour passé : hors capacité restante">${x.capa_h > 0 ? num(H2J(x.capa_h)) : "0"}</span>` : `<b>${x.capa_h > 0 ? num(H2J(x.capa_h)) : "0"}</b>`}</td></tr>`;
    }).join("");
  }

  function explainPerson(p) {
    const d = state.data, m = d.meta;
    const raf = p.profile === "qa" ? p.raf_qa : p.raf_dev;
    const row = (lbl, op, val, cls = "") => `<tr class="${cls}"><th scope="row">${lbl}</th><td class="op">${op}</td><td class="num">${val}</td></tr>`;
    const affTxt = p.affectation_src === "config"
      ? `paramétrée dans les Paramètres : ${Object.entries(p.affectation).map(([c, v]) => `${esc(c)} ${v} %`).join(", ")}`
      : p.affectation_src === "prorata"
        ? `pas d'affectation paramétrée : 100 %, réparti entre ses chantiers au prorata de son RAF ${PROF[p.profile]} (${Object.entries(p.affectation).map(([c, v]) => `${esc(c)} ${v} %`).join(", ")})`
        : "pas d'affectation paramétrée et pas de RAF : 100 %";
    return {
      title: `Capacité de ${esc(p.name)} · ${PROF[p.profile]} ${UNTIL[p.profile]}`,
      body: `<p class="ex-lead"><b>${esc(p.name)}</b> est ${PROF[p.profile]} (${p.profile_src === "role" ? `rôle Tempo « ${esc(p.role)} »` : p.profile_src === "config" ? "profil fixé dans les Paramètres" : "profil déduit de son RAF"}). ${p.join || p.leave ? `Présent sur le sprint ${p.join ? `à partir du <b>${esc(fmtDay(p.join))}</b>` : ""}${p.join && p.leave ? " et " : ""}${p.leave ? `jusqu'au <b>${esc(fmtDay(p.leave))}</b>` : ""} : en dehors, ni capacité ni saisie attendue. ` : ""}Sa capacité restante court d'aujourd'hui au <b>${esc(fmtDay(p.milestone))}</b> (${MILESTONE[p.profile]}) inclus et se compare à son RAF ${PROF[p.profile]}. Capacité du sprint entier (depuis le ${esc(fmtDay(d.period.start))}) : <b>${num(p.capa_sprint)} JH</b>, dont ${num(p.imputed)} JH déjà imputés.</p>
        <table class="ex-steps">
          ${row("Disponible d'ici le jalon", `planning Tempo × disponibilité ${p.availability} % − absences (${d.absence_issues.map(esc).join(", ")}), d'aujourd'hui au jalon, jour par jour`, `${num(p.brute_ahead)} JH`)}
          ${row("− Déjà imputé", "temps saisi dans Tempo sur ces jours-là (aujourd'hui surtout)", `${num(p.imputed_ahead)} JH`)}
          ${row("= Reste non imputé", "disponible − imputé, jour par jour (un jour plein ne laisse rien)", `${num(p.rest_ahead)} JH`)}
          ${row("− Scrum events encore à réserver", `prévu ${num(p.scrum_planned)} JH (${num(p.scrum_pct, 1)} % du disponible, ${p.group === "lead" ? "TL / PO" : "DEV / QA"}) − déjà imputé ${num(p.scrum_logged)} JH, jour par jour : ${num(p.scrum_reserved)} JH réservés`, `${num(p.capa_real_full)} JH`)}
          ${row("× Affectation", affTxt, `${num(p.capa_real)} JH`)}
          ${row("= Capacité restante", "d'aujourd'hui au jalon, pour le stream / projet", `${num(p.capa_real)} JH`, "res")}
        </table>
        <table class="ex-steps ex-result">
          ${row(`RAF ${PROF[p.profile]} à solder`, "", `${num(raf)} JH`)}
          ${row("Charge", "RAF ÷ capacité restante", p.capa_real > 0.005 ? `${Math.round((100 * raf) / p.capa_real)} %` : raf > 0.005 ? "aucune capacité restante" : "—", "res")}
        </table>
        <h3>Jour par jour <small>sur tout le sprint, en JH ; seuls les jours à partir d'aujourd'hui comptent dans la capacité restante</small></h3>
        <div class="ex-days"><table class="grid compact"><thead><tr><th>Jour</th><th class="num">Disponible</th><th class="num">Imputé</th><th class="num">Reste</th><th class="num">Scrum à réserver</th><th class="num">Capacité</th></tr></thead><tbody>${sprintRows(p)}</tbody>
        <tfoot><tr><td>Total d'aujourd'hui au jalon</td><td class="num">${num(p.brute_ahead)}</td><td class="num">${num(p.imputed_ahead)}</td><td class="num">${num(p.rest_ahead)}</td><td class="num">− ${num(p.scrum_reserved)}</td><td class="num">${num(p.capa_real_full)}</td></tr></tfoot></table></div>`,
    };
  }

  function explainChantierReal(c, prof) {
    const d = state.data;
    const aff = c.people.filter((y) => y.profile === prof);
    const rows = aff.map((y) => {
      const p = d.people.find((q) => q.name === y.name && q.in_team);
      if (!p) return "";
      const full = p.capa_real_full;
      return `<tr><td><b>${esc(y.name)}</b></td><td class="num">${num(p.brute_ahead)}</td><td class="num">− ${num(p.imputed_ahead)}</td><td class="num">${num(p.rest_ahead)}</td>
        <td class="num">${num(full)}<span class="stack">− ${num(p.scrum_reserved)} scrum à réserver</span></td><td class="num">× ${y.pct} %</td>
        <td class="num"><b><button type="button" class="capa-btn" data-explain="${esc(`p:${y.name}`)}">${num((full * y.pct) / 100)}</button></b></td></tr>`;
    }).join("");
    const raf = prof === "dev" ? c.raf_dev : c.raf_qa;
    return {
      title: `Capacité ${PROF[prof]} · ${esc(c.chantier)}`,
      body: `<p class="ex-lead">Pour chaque ${PROF[prof]} affecté au chantier, d'aujourd'hui ${TO[prof]} : disponible − temps déjà imputé, jour par jour ; moins la part scrum events ; multiplié par sa part sur ce chantier.</p>
        <div class="ex-days"><table class="grid compact"><thead><tr><th>Personne</th><th class="num">Disponible d'ici le jalon</th><th class="num">Déjà imputé</th><th class="num">Reste</th><th class="num">Après scrum</th><th class="num">Part</th><th class="num">Contribution</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">Personne n'y est affecté.</td></tr>`}</tbody>
        <tfoot><tr><td colspan="6">Capacité ${PROF[prof]} restante</td><td class="num">${num(c[`capa_real_${prof}`])} JH</td></tr>
        <tr><td colspan="6">RAF ${PROF[prof]} à solder</td><td class="num">${num(raf)} JH</td></tr></tfoot></table></div>
        <p class="muted ex-note">Dont ${num(c[`real_past_${prof}`])} JH imputés sur les tâches de ce chantier depuis le début du sprint, aujourd'hui compris. Cliquer une contribution pour le détail jour par jour.</p>`,
    };
  }

  function explainTeamReal(ps, prof) {
    const d = state.data;
    const rows = ps.map((p) => `<tr><td><b>${esc(p.name)}</b><span class="stack">${esc(p.role)}</span></td>
      <td class="num">${num(p.brute_ahead)}</td>
      <td class="num">− ${num(p.imputed_ahead)}</td>
      <td class="num"><button type="button" class="capa-btn" data-explain="${esc(`p:${p.name}`)}">${num(p.capa_real)}</button></td></tr>`).join("");
    return {
      title: `Capacité ${PROF[prof]} de l'équipe`,
      body: `<p class="ex-lead">Somme des capacités restantes des ${PROF[prof]} de ${esc(d.team.name)} : pour chacun, d'aujourd'hui au jalon, (disponible − temps déjà imputé, jour par jour) × (1 − scrum events) × affectation.</p>
        <div class="ex-days"><table class="grid compact"><thead><tr><th>Personne</th><th class="num">Disponible d'ici le jalon</th><th class="num">Déjà imputé</th><th class="num">Capacité restante</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">Capacité ${PROF[prof]} restante</td><td class="num">${num(ps.reduce((a, p) => a + (p.capa_real || 0), 0))} JH</td></tr>
        <tr><td colspan="3">RAF ${PROF[prof]} à solder</td><td class="num">${num(d.people.reduce((a, p) => a + (prof === "dev" ? p.raf_dev : p.raf_qa), 0))} JH</td></tr></tfoot></table></div>`,
    };
  }

  function explainMethod() {
    const d = state.data;
    return {
      title: "Comment la capacité est calculée",
      body: `<p class="ex-lead">Deux notions seulement. <b>Capacité du sprint</b> : ce que l'équipe pouvait donner du 1er jour au jalon, scrum events déduits, × affectation. <b>Capacité restante</b> : ce qu'elle peut encore donner d'aujourd'hui au jalon pour solder le RAF ; c'est elle qui fait la charge et la météo, partout dans l'outil (Synthèse, Rapport, burndown, Daily New FEAT). Tout est recalculé à chaque actualisation.</p>
        <ol class="ex-method">
          <li><b>DEV et QA séparés.</b> Un DEV est compté jusqu'au <b>Freeze Code</b> et comparé au RAF DEV ; un QA jusqu'à la <b>fin de test</b> et comparé au RAF QA. Les deux ne s'additionnent jamais. Le profil vient du rôle dans l'équipe Tempo (Développeur, Testeur…) ; à défaut, du RAF de la personne. Un TL / PO sans RAF n'a pas de capacité de réalisation.</li>
          <li><b>Jour par jour, d'aujourd'hui au jalon</b> (du ${esc(fmtDay(d.period.start))} pour la capacité du sprint) : disponible = heures dues au planning Tempo (week-ends et jours fériés à 0) × disponibilité dans l'équipe ${esc(d.team.name)} − absences saisies sur ${d.absence_issues.map(esc).join(", ")}. Le 1er jour du sprint (sprint planning) ne porte aucune capacité.</li>
          <li><b>− Tout le temps imputé</b> dans Tempo ce jour-là (hors absences). Exemple : 8 h dues, 6 h imputées, il reste 2 h. Un jour à venir, sans imputation, reste entier. Un jour passé ne compte plus : du temps non saisi n'est pas de la capacité (il apparaît dans « Temps non saisis »). Les imputations du jour comptent, comme dans le RAF de Jira : 2 h imputées aujourd'hui sur une tâche, c'est 2 h d'imputé en plus et 2 h de RAF en moins.</li>
          <li><b>− Scrum events encore à réserver</b> : chaque jour, la part prévue (${num(d.scrum.percent.team, 1)} % du disponible pour les DEV / QA, ${num(d.scrum.percent.lead, 1)} % pour les TL / PO) moins le scrum déjà imputé ce jour-là. Le scrum déjà imputé est compté une seule fois, dans l'imputé. Le mesuré est visible dans l'onglet Temps passé.</li>
          <li><b>× Affectation</b> : ce qui reste est la capacité pour le stream / projet, répartie entre les chantiers selon les affectations des Paramètres ; à défaut, 100 % au prorata du RAF. Un total inférieur à 100 % réduit la capacité.</li>
          <li><b>Par chantier</b> : somme des capacités des personnes affectées × leur part.</li>
          <li><b>Présence</b> : une personne arrivée ou partie en cours de sprint (Paramètres, « Présences sur le sprint ») n'a ni capacité ni saisie attendue en dehors de sa période.</li>
          <li><b>Congés</b> (Paramètres, section Congés) : un alternant est absent les 2 premiers mercredis de chaque mois ; un congé prévu couvre ses dates. Ces jours-là, ni capacité ni saisie attendue, sans double compte avec une absence saisie dans Tempo.</li>
          <li><b>Conversion</b> : 1 JH = ${num(d.meta.hours_per_day)} h.</li>
        </ol>
        <p class="ex-lead"><b>Charge</b> = RAF ÷ capacité. Maîtrisé sous 80 %, <span class="warn-t">Sous tension</span> de 80 à 100 %, <span class="danger-t">Hors capacité</span> au-delà, comme sur la Synthèse.</p>
        <p class="muted ex-note">Chaque valeur de capacité de la page est cliquable et montre son propre calcul. Réglages : page Paramètres, sections Tempo, Rôles, Affectations, Présences et Congés (effet immédiat).</p>`,
    };
  }

  // Tickets imputés par une personne un jour donné
  const CAT_LBL = { sprint: "Tâche du sprint", scrum: "Scrum event", absence: "Absence", autres: "Autre sujet" };
  function explainLogs(p, day) {
    const base = (state.data.meta.jira_base_url || "").replace(/\/$/, "");
    const tot = (day.logs || []).reduce((a, l) => a + l.h, 0);
    return {
      title: `${esc(p.name)} · ${esc(parse(day.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }))}`,
      body: `<p class="ex-lead">${hj(tot)} JH saisis dans Tempo${day.required_h > 0 ? ` pour ${hj(day.required_h)} JH dus` : day.type === "HORS_PERIODE" ? `, hors de sa période de présence sur le sprint${p.join ? ` (arrivée le ${fmtDate(p.join)})` : ""}${p.leave ? ` (départ le ${fmtDate(p.leave)})` : ""}` : ", jour non travaillé"}.</p>
        <div class="ex-days"><table class="grid compact"><thead><tr><th>Ticket</th><th>Résumé</th><th>Catégorie</th><th class="num">JH</th></tr></thead><tbody>` +
        (day.logs || []).map((l) => `<tr><td>${base ? `<a href="${esc(base)}/browse/${esc(l.key)}" target="_blank" rel="noopener">${esc(l.key)}</a>` : esc(l.key)}</td>
          <td>${esc(l.summary)}</td><td><span class="cat-tag ${l.cat}">${CAT_LBL[l.cat] || l.cat}</span></td><td class="num"><b>${hj(l.h)}</b></td></tr>`).join("") +
        `</tbody><tfoot><tr><td colspan="3">Total</td><td class="num">${hj(tot)} JH</td></tr></tfoot></table></div>`,
    };
  }

  function openExplain(key) {
    const d = state.data;
    let x = null;
    if (key === "method") x = explainMethod();
    else if (key.startsWith("p:")) {
      const p = d.people.find((q) => q.name === key.slice(2) && q.in_team);
      if (p) x = explainPerson(p);
    } else if (key.startsWith("ch:")) {
      const [, prof, ...rest] = key.split(":");
      const c = d.chantiers.find((y) => y.chantier === rest.join(":"));
      if (c) x = explainChantierReal(c, prof);
    } else if (key.startsWith("log:")) {
      const [, ...rest] = key.split(":");
      const date = rest.pop(), name = rest.join(":");
      const p = d.people.find((q) => q.name === name && q.in_team);
      const day = p?.days.find((y) => y.date === date);
      if (day) x = explainLogs(p, day);
    } else if (key.startsWith("team:")) {
      const prof = key.slice(5);
      const ps = d.people.filter((q) => q.in_team && q.profile === prof && (!state.teamFilter || state.teamFilter(q)));
      x = explainTeamReal(ps, prof);
    }
    if (!x) return;
    $("exTitle").innerHTML = x.title;
    $("exBody").innerHTML = x.body;
    const dlg = $("explain");
    if (!dlg.open) dlg.showModal();
    $("exBody").scrollTop = 0;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-explain]");
    if (b && state.data) { openExplain(b.dataset.explain); return; }
    if (e.target.closest("[data-close]")) $("explain").close();
  });
  // Clic sur le fond : ferme
  $("explain").addEventListener("click", (e) => { if (e.target === $("explain")) $("explain").close(); });

  // Congés hors Tempo (Paramètres, section Congés)
  const LEAVE = { ALTERNANCE: "Alternance", CONGE: "Congé prévu" }, LEAVE_SHORT = { ALTERNANCE: "Alt.", CONGE: "Congé" };

  // Période de présence sur le sprint (arrivée / départ)
  const presence = (p) => (p.join || p.leave
    ? `<span class="stack presence" title="Hors de cette période : ni capacité, ni saisie attendue">${p.join ? `arrivée le ${fmtDate(p.join)}` : ""}${p.join && p.leave ? " · " : ""}${p.leave ? `départ le ${fmtDate(p.leave)}` : ""}</span>`
    : "");

  function affCell(p) {
    const e = Object.entries(p.affectation || {});
    if (!e.length) return '<span class="muted">—</span>';
    const tip = p.affectation_src === "config" ? "Affectation paramétrée" : "Au prorata de son RAF (pas d'affectation paramétrée)";
    return e.map(([ch, v]) => `<span class="aff-chip ${p.affectation_src}" title="${tip}">${esc(ch)} ${v} %</span>`).join("");
  }

  // Temps saisis : une ligne par membre, une colonne par jour ouvré du sprint
  // ---------- affectation prévue vs réelle
  // Réelle = temps imputé sur les tâches du chantier ÷ temps travaillé (saisies Tempo hors absences et scrum events),
  // depuis le début du sprint. Un écart de 20 points ou plus est signalé, 50 points ou plus en rouge.
  function affComparison(p) {
    const hpd = state.data.meta.hours_per_day || 8;
    const worked = (p.time?.sprint || 0) + (p.time?.autres || 0);
    const real = Object.fromEntries(Object.entries(p.real_by_chantier || {}).filter(([c]) => c !== "?").map(([c, jh]) => [c, worked > 0 ? (100 * jh * hpd) / worked : 0]));
    const planned = p.affectation || {};
    const chs = [...new Set([...Object.keys(planned), ...Object.keys(real)])].sort((a, b) => a.localeCompare(b, "fr"));
    const lines = chs.map((c) => ({ ch: c, planned: planned[c] ?? 0, real: real[c] ?? 0, gap: (real[c] ?? 0) - (planned[c] ?? 0) }));
    const other = worked > 0 ? (100 * (p.time?.autres || 0)) / worked : 0;
    return { worked, lines, other, src: p.affectation_src };
  }
  const gapLvl = (g) => (Math.abs(g) >= 50 ? "red" : Math.abs(g) >= 20 ? "amber" : "ok");

  function renderAffectation(people, f) {
    const hpd = state.data.meta.hours_per_day || 8;
    const rows = people.map((p) => ({ p, a: affComparison(p) }))
      .map(({ p, a }) => ({ p, a, lines: a.lines.filter((l) => !f.ch || l.ch === f.ch) }))
      .filter(({ lines }) => lines.length)
      .sort((x, y) => Math.max(...y.lines.map((l) => Math.abs(l.gap))) - Math.max(...x.lines.map((l) => Math.abs(l.gap))) || x.p.name.localeCompare(y.p.name, "fr"));
    const bar = (l) => `<div class="aff-bar" aria-hidden="true"><i class="${gapLvl(l.gap)}" style="width:${Math.min(100, l.real).toFixed(0)}%"></i><b style="left:${Math.min(100, l.planned)}%" title="Prévu : ${l.planned} %"></b></div>`;
    $("affTable").innerHTML = `<thead><tr><th>Personne</th><th>Chantier</th><th class="num">Prévue</th><th class="num">Réelle</th><th class="num">Décalage</th><th class="aff-viz">Réel <span class="muted">(trait : prévu)</span></th></tr></thead><tbody>` +
      (rows.length ? rows.map(({ p, a, lines }) => lines.map((l, i) => `<tr class="${i ? "cont" : ""}">
        ${i ? "<td></td>" : `<td rowspan="${lines.length}"><b>${esc(p.name)}</b><span class="stack">${esc(p.label || PROF[p.profile])} · ${num(a.worked / hpd, 1)} JH travaillés</span><span class="stack">${Math.round(a.other)} % hors chantiers du sprint</span></td>`}
        <td>${esc(l.ch)}${a.src === "prorata" && l.planned ? '<span class="stack">prévu au prorata du RAF</span>' : ""}</td>
        <td class="num">${l.planned ? `${Math.round(l.planned)} %` : '<span class="muted">—</span>'}</td>
        <td class="num"><b>${Math.round(l.real)} %</b></td>
        <td class="num"><span class="aff-gap ${gapLvl(l.gap)}">${l.gap > 0 ? "+" : l.gap < 0 ? "−" : ""}${Math.abs(Math.round(l.gap))} pts</span></td>
        <td class="aff-viz">${bar(l)}</td></tr>`).join("")).join("")
        : `<tr><td colspan="6" class="empty">Aucune personne ne correspond aux filtres.</td></tr>`) + "</tbody>";
    $("affNote").innerHTML = `Réelle = temps imputé sur les tâches du chantier ÷ temps travaillé (saisies Tempo hors absences et scrum events), depuis le ${fmtDate(state.data.period.start)}. Décalage (réelle − prévue) signalé à partir de 20 points, en rouge à partir de 50. Les tickets du chantier hors des filtres Jira comptent en « hors chantiers ».`;
  }

  function renderTime(team, today) {
    const all = team[0]?.days || [];
    // Jours affichés : jours dus par au moins une personne, ou avec une saisie
    const cols = all.map((x, i) => i).filter((i) => team.some((p) => p.days[i].required_h > 0 || p.days[i].logged_h > 0 || p.days[i].absence_h > 0));
    const onlyMissing = $("onlyMissing").checked;
    const list = team.filter((p) => !onlyMissing || p.missing_h > 0.01)
      .sort((a, b) => b.missing_h - a.missing_h || a.name.localeCompare(b.name, "fr"));
    const colCls = (iso) => [iso > today && "future", iso === today && "today"].filter(Boolean).join(" ");
    const head = `<thead><tr><th class="rowh">Personne</th>${cols.map((i) => {
      const iso = all[i].date;
      return `<th class="num ${colCls(iso)}"><span class="c-lbl">${parse(iso).toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "")}</span><span class="c-sub">${fmtDate(iso)}</span></th>`;
    }).join("")}<th class="num tot">Saisi</th><th class="num tot">Dû</th><th class="num tot">Manque</th></tr></thead>`;
    const cell = (x) => {
      const cls = colCls(x.date), past = x.date < today;
      if (x.leave && !(x.logged_h > 0)) return `<td class="num off lv ${cls}" title="${esc(x.leave_motif || LEAVE[x.leave])} : ni capacité ni saisie attendue"><span class="lv-chip">${LEAVE_SHORT[x.leave]}</span></td>`;
      const abs = x.absence_h > 0 ? `<span class="abs-chip" title="Absence saisie : ${hj(x.absence_h)} JH">Abs ${hj(x.absence_h)}</span>` : "";
      const logged = x.logged_h > 0 ? hj(x.logged_h) : "";
      const short = past && x.required_h > 0 && x.logged_h + x.absence_h < x.required_h - 0.01;
      const title = x.required_h > 0 ? `${hj(x.logged_h + x.absence_h)} JH saisi sur ${hj(x.required_h)} JH dû` : "Jour non travaillé";
      if (x.type === "HORS_PERIODE" && !logged && !abs) return `<td class="num off hp ${cls}" title="Hors période de présence"></td>`;
      if (x.required_h === 0 && !logged && !abs) return `<td class="num off ${cls}" title="${title}"></td>`;
      const inner = `${logged}${abs}${short && !logged && !abs ? "0" : ""}`;
      return (x.logs || []).length
        ? `<td class="num ${cls} ${short ? "miss" : ""}"><button type="button" class="log-btn" data-explain="${esc(`log:${pname}:${x.date}`)}" title="${title} · voir les tickets">${inner}</button></td>`
        : `<td class="num ${cls} ${short ? "miss" : ""}" title="${title}">${inner}</td>`;
    };
    let pname = "";
    $("timeTable").innerHTML = head + "<tbody>" + (list.length ? list.map((p) => (pname = p.name, `<tr>
        <th class="rowh">${esc(p.name)}${presence(p)}</th>${cols.map((i) => cell(p.days[i])).join("")}
        <td class="num tot">${hj(p.logged_h)}</td><td class="num tot muted">${hj(p.due_h)}</td>
        <td class="num tot">${p.missing_h > 0.01 ? `<b class="miss-v">${hj(p.missing_h)} JH</b>` : '<span class="dl good">0</span>'}</td></tr>`)).join("")
      : `<tr><td colspan="${cols.length + 4}" class="empty">Toutes les saisies sont à jour.</td></tr>`) + "</tbody>";
    $("timeSub").textContent = `Temps saisi par jour en JH, du ${fmtDate(state.data.period.start)} à aujourd'hui · absences prévues jusqu'au ${fmtDate(state.data.period.end)}`;
    $("timeNote").innerHTML = `Une case <span class="miss-key">teintée</span> = jour passé où la saisie (travail + absences) n'atteint pas les heures dues. « Abs » = absence saisie sur ${state.data.absence_issues.map(esc).join(", ")}. Le jour en cours n'est pas compté dans les manques.`;
  }

  // ---------- chargement
  async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || `erreur ${res.status}`);
    return data;
  }
  async function loadData(refresh = false) {
    const btn = $("refresh"), first = !state.data;
    btn.disabled = true;
    try {
      state.data = await getJson("/api/tempo" + (refresh ? "?refresh=true" : ""));
      const m = state.data.meta;
      $("source").textContent = "Tempo en direct"; $("source").className = "badge live";
      $("lastSync").textContent = "Mis à jour à " + (m.tempo_generated_at || m.generated_at).slice(11, 16);
      $("loading").hidden = true; $("stale").hidden = true;
      render();
    } catch (e) {
      const msg = e instanceof TypeError ? "le serveur ne répond pas" : e.message;
      if (first) {
        const c = $("loadingCard");
        c.setAttribute("role", "alert");
        c.innerHTML = `<div class="le"><b>Impossible de lire Tempo</b><p></p><p class="muted">Vérifier la connexion VPN ou le Wi-Fi entreprise, et l'équipe Tempo dans les Paramètres, puis réessayer.</p><button type="button" class="btn primary" id="retryLoad">Réessayer</button></div>`;
        c.querySelector(".le p").textContent = msg;
        $("retryLoad").addEventListener("click", () => { c.removeAttribute("role"); c.innerHTML = `<div class="spinner" aria-hidden="true"></div><span>Lecture de Tempo…</span>`; loadData(true); });
      } else {
        $("stale").innerHTML = `<span><b>Données précédentes affichées.</b> Actualisation impossible : ${esc(msg)}.</span>`;
        $("stale").hidden = false;
      }
    } finally {
      btn.disabled = false;
    }
  }

  $("refresh").addEventListener("click", () => loadData(true));
  $("onlyRaf").addEventListener("change", () => state.data && render());
  FILTERS.forEach((k) => $("f-" + k).addEventListener("change", () => state.data && render()));
  let qt; $("f-q").addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(() => state.data && render(), 200); });
  $("reset").addEventListener("click", resetFilters);
  $("fChips").addEventListener("click", (e) => { const b = e.target.closest("[data-clear]"); if (b) clearFilter(b.dataset.clear); });

  // Barre compacte des filtres (même comportement que Reporting Tasks)
  const topbar = document.querySelector(".topbar"), slot = $("fSlot"), fCard = $("filters"), mini = $("fMini"), fOpen = $("fOpen");
  const phone = matchMedia("(max-width: 700px)");
  // hauteur de l'en-tête collant (0 sur téléphone, où il défile avec la page : la barre de filtres prend le haut)
  new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h",
    (getComputedStyle(topbar).position === "sticky" ? topbar.offsetHeight : 0) + "px")).observe(topbar);
  const popOpen = () => fCard.classList.contains("pop");
  function setPop(open, focusBack) {
    if (open === popOpen()) return;
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
  document.addEventListener("mousedown", (e) => { if (popOpen() && !fCard.contains(e.target) && !fOpen.contains(e.target)) setPop(false); });
  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "Escape" && popOpen()) { setPop(false, true); return; }
    // « / » : aller à la recherche depuis n'importe où
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest("input, select, textarea, [contenteditable]")) {
      e.preventDefault();
      if (mini.classList.contains("on")) setPop(true);
      $("f-q").focus(); $("f-q").select();
    }
  });
  syncMini();
  applyUrl();
  $("onlyMissing").addEventListener("change", () => state.data && render());
  loadData();
})();
