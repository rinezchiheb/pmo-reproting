/* PMO Reporting — Pilotage « Cadrage » : analyse de début de sprint et son rapport PowerPoint (JS natif).
   1. macro-chiffrage initial (saisi ici, gardé dans le navigateur par sprint) vs chiffrage actualisé, par FEAT ;
   2. charge de test vs développement, par FEAT, face à l'hypothèse (30 % par défaut) ;
   3. charge planifiée vs capacité disponible, par ressource.
   Tous les calculs sont faits par le serveur (POST /api/cadrage), les mêmes que le PowerPoint (POST /api/cadrage.pptx). */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 2) => (n == null ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sgn = (n) => (n == null ? "—" : `${n > 0.005 ? "+" : n < -0.005 ? "−" : ""}${num(Math.abs(n))}`);
  const pct = (n) => (n == null ? "—" : `${Math.round(n)} %`);
  const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const sprintName = (n) => (/sprint/i.test(n || "") ? n : `Sprint ${n || "—"}`);
  const CLS = { red: "red", amber: "amber", green: "ok", info: "info", unknown: "none", none: "none" };
  const PROF = { dev: "DEV", qa: "QA" };

  const state = { data: null, macro: {}, pct: 30, loadView: "", ch: new URLSearchParams(location.search).get("ch") || "" };
  // filtre chantier : repris de l'adresse (commun au pilotage), envoyé au serveur
  const withCh = (url) => (state.ch ? `${url}${url.includes("?") ? "&" : "?"}chantier=${encodeURIComponent(state.ch)}` : url);
  function writeUrl() {
    const p = new URLSearchParams(location.search);
    state.ch ? p.set("ch", state.ch) : p.delete("ch");
    history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : ""));
  }
  function fillChantiers() {
    const list = [...state.data.chantiers];
    if (state.ch && !list.includes(state.ch)) list.unshift(state.ch);
    $("f-ch").innerHTML = `<option value="">Tous</option>` + list.map((c) => `<option value="${esc(c)}" ${c === state.ch ? "selected" : ""}>${esc(c)}</option>`).join("");
    $("f-ch").classList.toggle("set", !!state.ch);
  }

  // ---- macro-chiffrage et hypothèse : gardés dans ce navigateur, par sprint (date de début)
  const store = {
    key: () => `pmo-cadrage:${state.data?.milestones?.start || state.data?.sprint || "?"}`,
    load() { try { const v = JSON.parse(localStorage.getItem(this.key()) || "{}"); state.macro = v.macro || {}; state.pct = v.pct || 30; } catch { /* stockage indisponible */ } },
    save() { try { localStorage.setItem(this.key(), JSON.stringify({ macro: state.macro, pct: state.pct })); } catch { /* stockage indisponible */ } },
  };
  const body = () => JSON.stringify({ macro: state.macro, test_pct: state.pct });

  async function post(url) {
    const res = await fetch(withCh(url), { method: "POST", headers: { "Content-Type": "application/json" }, body: body() });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || d.detail || `erreur ${res.status}`); }
    return res;
  }

  // ---- rendu
  function render() {
    const a = state.data, m = a.meta;
    fillChantiers();
    writeUrl();
    $("cdSub").textContent = `${sprintName(a.sprint)}${a.chantier ? ` · ${a.chantier}` : ""} · au ${fmtDate(a.today)} · Freeze Code ${fmtDate(a.milestones.dev)} · fin de test ${fmtDate(a.milestones.qa)}`;
    $("cdPct").value = state.pct;
    const f = a.feats, over = f.filter((x) => x.macro_state.word === "dépassement"), missing = f.filter((x) => x.macro == null);
    const dev = f.reduce((s, x) => s + x.dev.fin, 0), qa = f.reduce((s, x) => s + x.qa.fin, 0);
    const ratio = dev > 0.005 ? (100 * qa) / dev : null;
    const red = a.people.filter((p) => p.state.lvl === "red"), tense = a.people.filter((p) => p.state.word === "tendu");
    const free = a.people.filter((p) => ["sous-chargé", "sans charge"].includes(p.state.word));
    const kpi = (lbl, val, sub, cls = "") => `<div class="kpi ${cls}"><span class="lbl">${lbl}</span><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
    $("cdKpis").innerHTML =
      kpi("FEAT au-delà du macro", `${over.length}<small>/ ${f.length}</small>`, missing.length ? `<b>${missing.length}</b> macro à saisir` : "macro saisi pour toutes", over.length ? "danger" : missing.length ? "warn" : "") +
      kpi("Test ÷ développement", pct(ratio), `hypothèse ${pct(state.pct)} · ${num(qa, 1)} JH de test pour ${num(dev, 1)} JH de dév`, ratio != null && Math.abs(ratio - state.pct) > a.rules.test_tol ? "warn" : "") +
      kpi("Ressources à arbitrer", `${red.length}`, `${tense.length ? `<b>${tense.length}</b> tendue${tense.length > 1 ? "s" : ""} · ` : ""}surcharge ou sans capacité`, red.length ? "danger" : tense.length ? "warn" : "") +
      kpi("Capacité disponible", `${free.length}<small>pers.</small>`, `sous-chargées ou sans charge · ${num(free.reduce((s, p) => s + (p.gap || 0), 0), 1)} JH libres`) +
      kpi("Préalable", a.ready.unassigned || a.ready.noest ? `${a.ready.unassigned + a.ready.noest}<small>tâches</small>` : "OK",
        a.ready.unassigned || a.ready.noest ? `${a.ready.unassigned} non affectée(s) · ${a.ready.noest} sans estimation` : `${a.ready.open} tâches ouvertes estimées et affectées`, a.ready.unassigned || a.ready.noest ? "warn" : "");

    const card = (t, lines, cls) => `<article class="cd-card ${cls}"><h2>${t}</h2><ul>${(lines.length ? lines : ["Rien à signaler."]).map((l) => `<li>${esc(l)}</li>`).join("")}</ul></article>`;
    const mm = a.messages;
    $("cdCards").innerHTML = card("1. Macro-chiffrage", mm.macro, over.length ? "red" : missing.length ? "amber" : "ok") +
      card("2. Test vs développement", mm.test, f.some((x) => ["red", "amber"].includes(x.test_state.lvl)) ? "amber" : "ok") +
      card("3. Charge vs capacité", mm.load, red.length ? "red" : tense.length ? "amber" : "ok") +
      card("Préalable : estimation et affectation", mm.ready, a.ready.unassigned || a.ready.noest ? "amber" : "ok");

    renderMacro(); renderTest(); renderLoad();
    $("loading").hidden = true;
  }

  const base = () => (state.data.meta.jira_base_url || "").replace(/\/$/, "");
  const featCell = (x) => `<td>${/^[A-Z][A-Z0-9]+-\d+$/.test(x.key) && base() ? `<a href="${esc(base())}/browse/${esc(x.key)}" target="_blank" rel="noopener">${esc(x.key)}</a>` : esc(x.key)}<span class="stack cd-wrap">${esc(x.name)}</span></td>`;
  const stateCell = (st) => `<td><span class="ef-state ${CLS[st.lvl]}">${esc(st.word)}</span></td>`;
  // barre : valeur pleine, trait = référence (macro, test attendu, capacité)
  const bar = (v, ref, max, lvl) => `<td class="sc-viz"><div class="sc-bar ${CLS[lvl]}" aria-hidden="true"><i style="width:${Math.min(100, (100 * (v || 0)) / max).toFixed(1)}%"></i>${ref != null ? `<b style="left:${Math.min(100, (100 * ref) / max).toFixed(1)}%"></b>` : ""}</div></td>`;

  function renderMacro() {
    const f = state.data.feats, max = Math.max(0.1, ...f.map((x) => Math.max(x.updated || 0, x.macro || 0)));
    const withM = f.filter((x) => x.macro != null), sm = withM.reduce((s, x) => s + x.macro, 0), su = withM.reduce((s, x) => s + x.updated, 0);
    $("cdMacro").innerHTML = `<thead><tr><th>Chantier</th><th>FEAT</th><th class="num">Macro</th><th class="num">Actualisé</th><th class="num">dont DEV</th><th class="num">dont QA</th><th class="num">Écart</th><th class="sc-viz">Actualisé <span class="muted">(trait : macro)</span></th><th>État</th></tr></thead><tbody>` +
      (f.length ? f.map((x) => { const o = x.macro_state.word === "dépassement"; return `<tr class="${o ? "cd-over" : ""}"><td>${esc(x.chantier)}</td>${featCell(x)}
        <td class="num">${x.macro == null ? '<button type="button" class="btn quiet small" data-open-macro>à saisir</button>' : num(x.macro)}</td><td class="num"><b>${num(x.updated)}</b></td>
        <td class="num muted">${num(x.dev.fin)}</td><td class="num muted">${num(x.qa.fin)}</td>
        <td class="num"><span class="ef-gap ${o ? CLS[x.macro_state.lvl] : x.gap != null ? "ok" : "none"}">${sgn(x.gap)}</span><span class="stack">${x.gap_pct == null ? "" : `${x.gap_pct > 0.5 ? "+" : x.gap_pct < -0.5 ? "−" : ""}${pct(Math.abs(x.gap_pct))}`}</span></td>
        ${bar(x.updated, x.macro, max, x.macro_state.lvl)}${stateCell(x.macro_state)}</tr>`; }).join("")
        : `<tr><td colspan="9" class="empty">Aucune tâche DEV ou QA dans le sprint.</td></tr>`) + "</tbody>" +
      (withM.length > 1 ? `<tfoot><tr><td colspan="2">Total des FEAT chiffrées</td><td class="num">${num(sm)}</td><td class="num">${num(su)}</td><td></td><td></td><td class="num">${sgn(su - sm)}</td><td></td><td></td></tr></tfoot>` : "");
  }

  function renderTest() {
    const a = state.data, tp = state.pct, f = a.feats.filter((x) => x.dev.fin > 0.005 || x.qa.fin > 0.005);
    $("cdTestSub").textContent = `Par FEAT · hypothèse : test = ${tp} % du développement · conforme à ±${a.rules.test_tol} points · en JH`;
    const max = Math.max(tp * 2, ...f.map((x) => x.test_ratio || 0));
    $("cdTest").innerHTML = `<thead><tr><th>Chantier</th><th>FEAT</th><th class="num">DEV</th><th class="num">QA</th><th class="num">QA ÷ DEV</th><th class="num">QA attendu (${tp} %)</th><th class="num">Écart QA</th><th class="sc-viz">QA ÷ DEV <span class="muted">(trait : ${tp} %)</span></th><th>État</th></tr></thead><tbody>` +
      (f.length ? f.map((x) => `<tr><td>${esc(x.chantier)}</td>${featCell(x)}<td class="num">${num(x.dev.fin)}</td><td class="num"><b>${num(x.qa.fin)}</b></td>
        <td class="num"><span class="ef-gap ${CLS[x.test_state.lvl]}">${pct(x.test_ratio)}</span></td><td class="num muted">${num(x.test_theo)}</td><td class="num">${sgn(x.test_gap)}</td>
        ${bar(x.test_ratio, tp, max, x.test_state.lvl)}${stateCell(x.test_state)}</tr>`).join("")
        : `<tr><td colspan="9" class="empty">Aucune charge de développement ou de test.</td></tr>`) + "</tbody>";
  }

  function renderLoad() {
    const a = state.data;
    if (a.tempo_error && !a.people.length) { $("cdLoad").innerHTML = `<tbody><tr><td class="empty">Capacité indisponible : ${esc(a.tempo_error)}</td></tr></tbody>`; return; }
    const act = (p) => ["red", "amber"].includes(p.state.lvl) || ["sous-chargé", "sans charge"].includes(p.state.word);
    const ppl = a.people.filter((p) => p.state.lvl !== "none" && (!state.loadView || act(p)));
    const max = Math.max(1, ...ppl.map((p) => Math.max(p.charge || 0, p.capa || 0)));
    let html = "";
    for (const sd of ["dev", "qa"]) {
      const mine = ppl.filter((p) => p.profile === sd);
      if (!mine.length) continue;
      const t = a.totals[sd];
      html += `<tr class="chantier"><td><b>${PROF[sd]}</b> <span class="muted">· jusqu'au ${fmtDate(a.milestones[sd])}</span></td><td class="num"><b>${num(t.capa)}</b></td><td class="num"><b>${num(t.charge)}</b></td>
        <td class="num"><b>${sgn((t.capa || 0) - (t.charge || 0))}</b></td><td class="num"><b>${t.capa ? pct((100 * t.charge) / t.capa) : "—"}</b></td><td class="num">${t.unassigned ? `<span class="warn-t">non affecté ${num(t.unassigned)}</span>` : ""}</td><td class="sc-viz"></td><td></td></tr>`;
      html += mine.map((p) => `<tr><td><b>${esc(p.name)}</b><span class="stack">${PROF[p.profile]}${p.role ? ` · ${esc(p.role)}` : ""}${p.in_team ? "" : " · hors équipe Tempo"}${Object.keys(p.affectation || {}).length ? ` · ${Object.entries(p.affectation).map(([c, v]) => `${esc(c)} ${v} %`).join(", ")}` : ""}</span></td>
        <td class="num">${num(p.capa)}</td><td class="num"><b>${num(p.charge)}</b></td>
        <td class="num"><span class="ef-gap ${(p.gap ?? 0) < -0.005 ? "red" : "ok"}">${sgn(p.gap)}</span></td><td class="num"><span class="ef-gap ${CLS[p.state.lvl]}">${pct(p.rate)}</span></td>
        <td class="num muted">${p.other > 0.005 ? num(p.other) : ""}</td>${bar(p.charge, p.capa, max, p.state.lvl)}${stateCell(p.state)}</tr>`).join("");
    }
    $("cdLoad").innerHTML = `<thead><tr><th>Ressource</th><th class="num">Capacité</th><th class="num">Charge</th><th class="num">Écart</th><th class="num">Charge ÷ capa</th><th class="num">Hors profil</th><th class="sc-viz">Charge <span class="muted">(trait : capacité)</span></th><th>État</th></tr></thead><tbody>` +
      (html || `<tr><td colspan="8" class="empty">${state.loadView ? "Aucune ressource à arbitrer ni à rééquilibrer." : "Aucune ressource."}</td></tr>`) + "</tbody>";
  }

  // ---- fenêtre de saisie du macro-chiffrage
  function openMacro() {
    const f = state.data.feats;
    $("macroTable").innerHTML = `<thead><tr><th>FEAT</th><th class="num">Actualisé</th><th class="num">Macro (JH)</th></tr></thead><tbody>` +
      (f.length ? f.map((x) => `<tr><td><b>${esc(x.key)}</b><span class="stack cd-wrap">${esc(x.chantier)} · ${esc(x.name)}</span></td><td class="num muted">${num(x.updated)}</td>
        <td class="num"><input type="text" inputmode="decimal" class="cd-in" data-feat="${esc(x.key)}" value="${state.macro[x.key] != null ? esc(String(state.macro[x.key]).replace(".", ",")) : ""}" aria-label="Macro-chiffrage de ${esc(x.key)}, en JH"></td></tr>`).join("")
        : `<tr><td colspan="3" class="empty">Aucune FEAT dans le sprint.</td></tr>`) + "</tbody>";
    $("macroImportMsg").textContent = "";
    $("macroDlg").showModal();
    $("macroTable").querySelector("input")?.focus();
  }
  // lignes copiées d'Excel : la clé de FEAT (ABC-123) et le dernier nombre de la ligne
  $("macroImport").addEventListener("click", () => {
    let ok = 0, unknown = [];
    for (const line of $("macroPaste").value.split(/\r?\n/)) {
      const key = (line.match(/[A-Z][A-Z0-9]+-\d+/) || [])[0];
      const nums = line.replace(key || "", "").match(/\d+(?:[.,]\d+)?/g);
      if (!key || !nums) continue;
      const input = document.querySelector(`#macroTable input[data-feat="${CSS.escape(key)}"]`);
      if (input) { input.value = nums[nums.length - 1]; ok++; } else unknown.push(key);
    }
    $("macroImportMsg").textContent = `${plural(ok, "valeur reprise", "valeurs reprises")}${unknown.length ? ` · hors sprint : ${unknown.slice(0, 4).join(", ")}${unknown.length > 4 ? "…" : ""}` : ""}`;
  });
  $("macroClear").addEventListener("click", () => document.querySelectorAll("#macroTable input").forEach((i) => (i.value = "")));
  $("macroForm").addEventListener("submit", (e) => {
    const bad = [...document.querySelectorAll("#macroTable input")].filter((i) => i.value.trim() && !/^\d+(?:[.,]\d+)?$/.test(i.value.trim()));
    document.querySelectorAll("#macroTable input").forEach((i) => i.classList.toggle("bad", bad.includes(i)));
    if (bad.length) { e.preventDefault(); bad[0].focus(); $("macroImportMsg").textContent = "Nombre attendu (par exemple 12,5)."; return; }
    const macro = { ...state.macro };
    document.querySelectorAll("#macroTable input").forEach((i) => { const v = i.value.trim(); if (v) macro[i.dataset.feat] = parseFloat(v.replace(",", ".")); else delete macro[i.dataset.feat]; });
    state.macro = macro;
    store.save();
    load();
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-macro]") || e.target.closest("#cdMacroBtn")) { if (state.data) openMacro(); return; }
    if (e.target.closest("#macroDlg [data-close]")) $("macroDlg").close();
  });
  $("macroDlg").addEventListener("click", (e) => { if (e.target === $("macroDlg")) $("macroDlg").close(); });

  // ---- hypothèse de test
  let pt;
  $("cdPct").addEventListener("input", () => {
    const v = parseFloat($("cdPct").value);
    if (!(v > 0 && v <= 200)) return;
    clearTimeout(pt);
    pt = setTimeout(() => { state.pct = v; store.save(); load(); }, 400);
  });

  // ---- téléchargement du PowerPoint (mêmes paramètres que l'écran)
  $("cdDownload").addEventListener("click", async () => {
    const btn = $("cdDownload"), txt = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Génération…";
    try {
      const res = await post("/api/cadrage.pptx");
      const cd = res.headers.get("Content-Disposition") || "";
      const name = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/) || [])[1] || "") || "Cadrage.pptx";
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      $("stale").innerHTML = `<span><b>Rapport non généré.</b> ${esc(e.message)}</span>`; $("stale").hidden = false;
    } finally {
      btn.disabled = false; btn.innerHTML = txt;
    }
  });

  $("cdLoadSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.loadView = b.dataset.v;
    document.querySelectorAll("#cdLoadSeg button").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
    renderLoad();
  });

  // ---- chargement
  async function load(refresh = false) {
    const btn = $("refresh"), first = !state.data;
    btn.disabled = true;
    try {
      if (first || refresh) {
        // premier passage : il faut le sprint pour retrouver le macro-chiffrage enregistré
        state.data = await (await post("/api/cadrage" + (refresh ? "?refresh=true" : ""))).json();
        const before = JSON.stringify([state.macro, state.pct]);
        store.load();
        if (JSON.stringify([state.macro, state.pct]) !== before) state.data = await (await post("/api/cadrage")).json();
      } else {
        state.data = await (await post("/api/cadrage")).json();
      }
      const m = state.data.meta;
      $("source").textContent = m.source === "jira" ? "Jira en direct" : "Démo (Excel)";
      $("source").className = "badge " + (m.source === "jira" ? "live" : "demo");
      $("lastSync").textContent = m.generated_at ? "Mis à jour à " + m.generated_at.slice(11, 16) : "";
      $("stale").hidden = !state.data.tempo_error;
      if (state.data.tempo_error) $("stale").innerHTML = `<span><b>Capacité indisponible</b> (Tempo) : ${esc(state.data.tempo_error)}. Les analyses 1 et 2 restent valables.</span>`;
      render();
    } catch (e) {
      console.error(e);
      const msg = e instanceof TypeError ? "le serveur ne répond pas" : e.message;
      if (first) {
        const c = $("loadingCard");
        c.setAttribute("role", "alert");
        c.innerHTML = `<div class="le"><b>Impossible de préparer le cadrage</b><p></p><p class="muted">Vérifier la connexion VPN ou le Wi-Fi entreprise, puis réessayer.</p><button type="button" class="btn primary" id="retryLoad">Réessayer</button></div>`;
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
  $("f-ch").addEventListener("change", (e) => { state.ch = e.target.value; load(); });
  $("refresh").addEventListener("click", () => load(true));
  load();
})();
