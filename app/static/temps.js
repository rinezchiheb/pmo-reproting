/* PMO Reporting — page Temps passé : répartition du temps saisi dans Tempo (sprint en cours) */
(() => {
  "use strict";

  // filtres communs du pilotage (repris de l'adresse) : chantier, personne ; profil = boutons DEV / QA / TL-PO
  const URLP = new URLSearchParams(location.search);
  const state = { data: null, grp: ["dev", "qa", "lead"].includes(URLP.get("prof")) ? URLP.get("prof") : "", cat: "scrum", q: { people: "", issues: "" },
    f: { ch: URLP.get("ch") || "", who: URLP.get("who") || "" } };
  // Même règle que Capacité : un chantier retient les personnes qui y sont affectées
  const shared = (p) => (!state.f.ch || Object.keys(p.affectation || {}).includes(state.f.ch)) && (!state.f.who || p.name === state.f.who);
  function writeUrl() {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of [["ch", state.f.ch], ["who", state.f.who], ["prof", state.grp]]) v ? p.set(k, v) : p.delete(k);
    history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : ""));
  }
  function fillShared(team) {
    const opt = (id, vals, want, all) => {
      const list = [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
      if (want && !list.includes(want)) list.unshift(want);
      $(id).innerHTML = `<option value="">${all}</option>` + list.map((v) => `<option value="${esc(v)}" ${v === want ? "selected" : ""}>${esc(v)}</option>`).join("");
      $(id).classList.toggle("set", !!want);
    };
    opt("f-ch", team.flatMap((p) => Object.keys(p.affectation || {})), state.f.ch, "Tous");
    window.Pilotage.fillPeople("f-who", team.map((p) => p.name), state.f.who, "Toutes");
  }
  const LF = window.ListFilter;
  const ISSUES_MAX = 40; // tickets affichés au plus ; la recherche porte sur tous
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 1) => (n ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: d });
  const fmtDate = (iso) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const pct = (a, b) => (b > 0 ? (100 * a) / b : 0);
  // Tempo compte en heures : tout s'affiche en JH (heures ÷ heures par JH)
  const hj = (h, d = 1) => num(h / (state.data?.meta.hours_per_day || 8), d);

  const CATS = [
    ["sprint", "Tâches du sprint", "Saisies sur les tâches et US du reporting"],
    ["scrum", "Scrum events", ""],
    ["absence", "Absences", ""],
    ["autres", "Autres sujets", "Tout le reste : autres projets, gestion, support…"],
  ];
  const GRP = { lead: "TL / PO", team: "DEV / QA" };
  const PROF = { dev: "DEV", qa: "QA", lead: "TL / PO" };
  // Nom du sprint affiché : « Sprint 12 », mais « PI17 Sprint 3 » tel quel (pas de « Sprint PI17 Sprint 3 »)
  const sprintName = (n) => (/sprint/i.test(n || "") ? n : `Sprint ${n || "—"}`);

  function render() {
    const d = state.data, m = d.meta, team = d.people.filter((p) => p.in_team);
    const until = d.period.today < d.period.end ? d.period.today : d.period.end;
    $("tpSub").textContent = `${d.team.name} · ${sprintName(m.sprint)} · du ${fmtDate(d.period.start)} au ${fmtDate(until)}`;
    const desc = { scrum: `résumé contenant « ${d.scrum.match.map(esc).join(" », « ")} »${d.scrum.issues.length ? ` ou ${d.scrum.issues.map(esc).join(", ")}` : ""}`, absence: `saisies sur ${d.absence_issues.map(esc).join(", ")}` };
    $("tpRule").innerHTML = CATS.map(([k, l, t]) => `<li><span class="sw cat-${k}"></span><b>${l}</b> : ${t || desc[k]}</li>`).join("");

    // Totaux équipe
    const tot = Object.fromEntries(CATS.map(([k]) => [k, team.reduce((a, p) => a + p.time[k], 0)]));
    const all = CATS.reduce((a, [k]) => a + tot[k], 0), worked = all - tot.absence;
    const kpi = (lbl, val, sub, cls = "") => `<div class="kpi ${cls}"><span class="lbl">${lbl}</span><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
    $("tpKpis").innerHTML =
      kpi("Temps saisi", `${hj(all)}<small>JH</small>`, plural(team.length, "personne", "personnes")) +
      kpi(`<span class="sw cat-sprint"></span>Tâches du sprint`, `${hj(tot.sprint)}<small>JH</small>`, `${num(pct(tot.sprint, worked), 0)} % du temps travaillé`) +
      kpi(`<span class="sw cat-scrum"></span>Scrum events`, `${hj(tot.scrum)}<small>JH</small>`, `${num(pct(tot.scrum, worked), 1)} % du temps travaillé`) +
      kpi(`<span class="sw cat-absence"></span>Absences`, `${hj(tot.absence)}<small>JH</small>`, `${num(pct(tot.absence, all), 0)} % du temps saisi`) +
      kpi(`<span class="sw cat-autres"></span>Autres sujets`, `${hj(tot.autres)}<small>JH</small>`, `${num(pct(tot.autres, worked), 0)} % du temps travaillé`);

    // Scrum par rôle : mesuré vs paramétré
    $("roleTable").innerHTML = `<thead><tr><th>Rôle</th><th class="num">Personnes</th><th class="num">Temps travaillé</th><th class="num">Scrum events</th><th class="num">Part mesurée</th><th class="num">Paramètre capacité</th><th class="num">vs paramètre</th><th>État</th></tr></thead><tbody>` +
      ["lead", "team"].map((g) => {
        const ps = team.filter((p) => p.group === g);
        const w = ps.reduce((a, p) => a + p.time.sprint + p.time.scrum + p.time.autres, 0), sc = ps.reduce((a, p) => a + p.time.scrum, 0);
        const meas = pct(sc, w), par = d.scrum.percent[g], gap = meas - par;
        // mêmes seuils que la page Scrum events : « à la limite » jusqu'à +2 pts, « faible » sous la moitié
        const [cls, word] = !(w > 0) ? ["none", "—"] : gap > 2 ? ["red", "dépassé"] : gap > 0 ? ["amber", "à la limite"] : meas < par / 2 ? ["info", "faible, saisie à vérifier"] : ["ok", "respecté"];
        return `<tr><td><b>${GRP[g]}</b></td><td class="num">${ps.length}</td><td class="num">${hj(w)} JH</td><td class="num">${hj(sc)} JH</td>
          <td class="num"><b>${num(meas, 1)} %</b></td><td class="num">${num(par, 1)} %</td>
          <td class="num"><span class="dl ${Math.abs(gap) < 2 ? "same" : "bad"}">${gap > 0 ? "+" : gap < 0 ? "−" : ""}${num(Math.abs(gap), 1)} pt</span></td><td><span class="ef-state ${cls}">${word}</span></td></tr>`;
      }).join("") + "</tbody>";

    // Répartition par personne
    fillShared(team);
    writeUrl();
    const byGrp = team.filter((p) => (!state.grp || (p.categorie || p.profile) === state.grp) && shared(p));
    const list = byGrp.filter((p) => LF.match(`${p.name} ${p.role} ${p.label}`, state.q.people))
      .map((p) => ({ p, all: CATS.reduce((a, [k]) => a + p.time[k], 0) }))
      .sort((a, b) => b.all - a.all || a.p.name.localeCompare(b.p.name, "fr"));
    const max = Math.max(1, ...list.map((x) => x.all));
    const bar = (p, all) => `<div class="stack-bar" style="width:${(100 * all / max).toFixed(1)}%" aria-hidden="true">${CATS.map(([k]) => p.time[k] > 0 ? `<i class="cat-${k}" style="flex:${p.time[k]}"></i>` : "").join("")}</div>`;
    const cell = (p, k, w) => {
      const h = p.time[k];
      if (h < 0.01) return `<td class="num muted">—</td>`;
      const share = k === "absence" ? `${num(pct(h, w + h), 0)} % du saisi` : `${num(pct(h, w), 0)} %`;
      const flag = k === "scrum" && w > 0 && Math.abs(pct(h, w) - p.scrum_pct) >= 5 ? ` title="Paramètre : ${num(p.scrum_pct, 1)} %"` : "";
      return `<td class="num"${flag}>${hj(h, 2)} JH<span class="stack">${share}</span></td>`;
    };
    $("peopleTable").innerHTML = `<thead><tr><th>Personne</th><th class="num">Saisi</th><th class="bar-h">Répartition</th>${CATS.map(([k, l]) => `<th class="num"><span class="sw cat-${k}"></span>${l}</th>`).join("")}</tr></thead><tbody>` +
      (list.length ? list.map(({ p, all }) => {
        const w = all - p.time.absence;
        return `<tr><td><b>${esc(p.name)}</b><span class="stack">${esc(p.label || PROF[p.profile])}${p.role ? ` · ${esc(p.role)}` : ""}</span></td>
          <td class="num"><b>${hj(all, 2)} JH</b></td><td class="bar-c">${bar(p, all)}</td>${CATS.map(([k]) => cell(p, k, w)).join("")}</tr>`;
      }).join("") : byGrp.length ? LF.noneRow(7, state.q.people) : `<tr><td colspan="7" class="empty">Aucune saisie.</td></tr>`) + "</tbody>";
    LF.count("people", list.length, byGrp.length, state.q.people);

    // Où va le temps
    const base = (m.jira_base_url || "").replace(/\/$/, "");
    const who = new Set(team.filter(shared).map((p) => p.name));
    const inCat = d.issues.filter((i) => i.category === state.cat && (!state.f.ch && !state.f.who || i.people.some((n) => who.has(n))));
    const catTot = inCat.reduce((a, i) => a + i.hours, 0);
    const its = inCat.filter((i) => LF.match(`${i.key} ${i.summary} ${i.people.join(" ")}`, state.q.issues));
    $("issuesTable").innerHTML = `<thead><tr><th>Tâche</th><th>Résumé</th><th>Saisi par</th><th class="num">JH</th><th class="num">Part</th></tr></thead><tbody>` +
      (its.length ? its.slice(0, ISSUES_MAX).map((i) => `<tr>
        <td>${base ? `<a href="${esc(base)}/browse/${esc(i.key)}" target="_blank" rel="noopener">${esc(i.key)}</a>` : esc(i.key)}</td>
        <td>${esc(i.summary)}</td>
        <td class="ppl" title="${esc(i.people.join(", "))}">${i.people.length > 3 ? `${esc(i.people.slice(0, 3).join(", "))} <span class="muted">+${i.people.length - 3}</span>` : esc(i.people.join(", "))}</td>
        <td class="num"><b>${hj(i.hours, 2)}</b></td><td class="num muted">${num(pct(i.hours, catTot), 0)} %</td></tr>`).join("") +
        (its.length > ISSUES_MAX ? `<tr><td colspan="5" class="empty">${its.length - ISSUES_MAX} autres tâches, moins saisies : filtrer pour les retrouver.</td></tr>` : "")
        : inCat.length ? LF.noneRow(5, state.q.issues) : `<tr><td colspan="5" class="empty">Aucune saisie dans cette catégorie.</td></tr>`) + "</tbody>";
    LF.count("issues", its.length, inCat.length, state.q.issues);

    document.querySelectorAll("#grpSeg button").forEach((b) => { const on = b.dataset.g === state.grp; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    document.querySelectorAll("#catSeg button").forEach((b) => { const on = b.dataset.c === state.cat; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  }

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
        c.innerHTML = `<div class="le"><b>Impossible de lire Tempo</b><p></p><p class="muted">Vérifier la connexion VPN ou le Wi-Fi entreprise, et les réglages Tempo dans les Paramètres, puis réessayer.</p><button type="button" class="btn primary" id="retryLoad">Réessayer</button></div>`;
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

  // Filtres des listes : personne ou rôle ; clé, résumé ou personne d'une tâche
  $("peopleFilter").innerHTML = LF.fieldHtml({ key: "people", label: "Filtrer les personnes", placeholder: "Personne, rôle…" });
  $("issuesFilter").innerHTML = LF.fieldHtml({ key: "issues", label: "Filtrer les tâches", placeholder: "Clé, résumé, personne…" });
  let ft;
  document.addEventListener("input", (e) => {
    const k = e.target.dataset?.lf;
    if (!k) return;
    state.q[k] = e.target.value;
    clearTimeout(ft); ft = setTimeout(() => state.data && render(), 150);
  });
  ["f-ch", "f-who"].forEach((id) => $(id).addEventListener("change", (e) => { state.f[id.slice(2)] = e.target.value; state.data && render(); }));
  $("refresh").addEventListener("click", () => loadData(true));
  $("grpSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.grp = b.dataset.g; render(); } });  // profil commun avec Capacité
  $("catSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.cat = b.dataset.c; render(); } });
  loadData();
})();
