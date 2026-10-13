/* PMO Reporting — espace « Pilotage » : sous-vues (Tâches · Capacité · Temps · Effort · Scrum events · Anomalies) et filtres communs (JS natif).
   Chargé sur toutes les pages, avant le script de la page. Chaque sous-vue garde son adresse (/, /capa, /temps, /effort, /scrum, /anomalies) ;
   en passant de l'une à l'autre, le chantier, la personne et le profil choisis suivent, ainsi que le jour affiché.
   L'onglet « Pilotage » de l'en-tête rouvre la dernière sous-vue consultée, avec ses filtres. */
(() => {
  "use strict";

  const ICON = {
    "/": '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5L8 4.5M3.5 12l1.5 1.5L8 10.5M3.5 18l1.5 1.5L8 16.5"/>',
    "/capa": '<path d="M5 20V11M12 20V5M19 20v-6M3 20h18"/>',
    "/temps": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "/effort": '<path d="M12 4v16M6 20h12M4 8h16"/><path d="m4 8-2 6a3 3 0 0 0 4 0zM20 8l-2 6a3 3 0 0 0 4 0z"/>',
    "/scrum": '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 20a5 5 0 0 1 10 0M11 20a5 5 0 0 1 10 0"/>',
    "/cadrage": '<path d="M9 4h6v3H9z"/><path d="M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    "/anomalies": '<path d="M9 9a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z"/><path d="M12 12v3M4 13h5M15 13h5M5 8l4 2M19 8l-4 2M5 19l4-2M19 19l-4-2"/>',
  };
  const VIEWS = [
    { path: "/", label: "Tâches", title: "Reporting Tasks : tâches, retards et reste à faire" },
    { path: "/capa", label: "Capacité", title: "Capa vs RAF : capacité face au reste à faire" },
    { path: "/temps", label: "Temps", title: "Temps passé : où va le temps de l'équipe" },
    { path: "/effort", label: "Effort", title: "Planifié vs consommé : estimation, consommé et reste à faire" },
    { path: "/scrum", label: "Scrum events", title: "Scrum events : part des cérémonies face au développement et au test" },
    { path: "/anomalies", label: "Anomalies", title: "Suivi des anomalies : bogues et anomalies de test, temps consommé" },
    { path: "/cadrage", label: "Cadrage", title: "Cadrage du sprint : macro-chiffrage, test vs développement, charge vs capacité ; rapport PowerPoint" },
  ];
  // Filtres communs : nom du paramètre d'adresse dans chaque sous-vue (absent = filtre sans objet dans cette vue)
  const SHARED = {
    chantier: { "/": "chantier", "/capa": "ch", "/temps": "ch", "/effort": "ch", "/scrum": "ch", "/anomalies": "ch", "/cadrage": "ch" },
    personne: { "/": "assignee", "/capa": "who", "/temps": "who", "/effort": "who", "/scrum": "who", "/anomalies": "who" },
    profil: { "/capa": "prof", "/temps": "prof", "/effort": "prof", "/scrum": "prof" },
  };
  const KEY = "pmo-pilotage";
  const memo = {
    get() { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { return null; } },
    set(v) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
  };
  const here = location.pathname, inPilotage = VIEWS.some((v) => v.path === here);

  // Filtres communs de la page courante, lus dans son adresse (chaque sous-vue y écrit ses filtres)
  function current() {
    const p = new URLSearchParams(location.search), out = {};
    for (const [k, names] of Object.entries(SHARED)) if (names[here] && p.get(names[here])) out[k] = p.get(names[here]);
    return out;
  }
  // Adresse d'une sous-vue avec les filtres communs (et le jour affiché, s'il y en a un)
  function urlFor(path, shared) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(shared || {})) if (SHARED[k][path] && v) p.set(SHARED[k][path], v);
    const jour = new URLSearchParams(location.search).get("jour");
    if (jour) p.set("jour", jour);
    return path + (p.toString() ? "?" + p : "");
  }

  if (inPilotage) {
    const main = document.querySelector("main");
    main.insertAdjacentHTML("afterbegin", `<nav class="subtabs" aria-label="Vues du pilotage">${VIEWS.map((v) =>
      `<a href="${v.path}" data-view="${v.path}" title="${v.title}"${v.path === here ? ' class="on" aria-current="page"' : ""}>` +
      `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[v.path]}</svg>${v.label}</a>`).join("")}</nav>`);
    // au clic, la sous-vue cible reprend les filtres communs de celle-ci
    main.querySelector(".subtabs").addEventListener("click", (e) => {
      const a = e.target.closest("a[data-view]");
      if (a && a.dataset.view !== here) a.href = urlFor(a.dataset.view, current());
    }, true);
    // dernière sous-vue consultée et ses filtres, pour l'onglet « Pilotage »
    const save = () => memo.set({ path: here, shared: current() });
    save();
    addEventListener("pagehide", save);
  }

  // Liste commune des personnes (/api/people) : chaque sous-vue propose toutes les personnes, celles qui ont des données
  // sur la vue d'abord, les autres dans un groupe « Sans donnée sur cette vue » (choisir l'une d'elles garde le filtre
  // d'une vue à l'autre). Classement unique DEV / QA / TL / PO : Pilotage.label(nom).
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const byFr = (a, b) => a.localeCompare(b, "fr");
  let everyone = null;
  const pending = new Map();  // select → derniers arguments, pour compléter la liste quand elle arrive
  function fillPeople(sel, present, want, allLabel) {
    if (typeof sel === "string") sel = document.getElementById(sel);
    if (!sel) return;
    pending.set(sel, [present, want, allLabel]);
    const here_ = [...new Set(present.filter(Boolean))].sort(byFr);
    const rest = (everyone || []).map((p) => p.name).filter((n) => !here_.includes(n));
    if (want && !here_.includes(want) && !rest.includes(want)) rest.unshift(want);
    const o = (n) => `<option value="${esc(n)}" ${n === want ? "selected" : ""}>${esc(n)}</option>`;
    sel.innerHTML = `<option value="">${esc(allLabel)}</option>` + here_.map(o).join("") +
      (rest.length ? `<optgroup label="Sans donnée sur cette vue">${rest.map(o).join("")}</optgroup>` : "");
    sel.value = want || "";
    sel.classList.toggle("set", !!want);
  }
  window.Pilotage = {
    fillPeople,
    label: (name) => everyone?.find((p) => p.name === name)?.label || "",
  };
  if (inPilotage) {
    const jour = new URLSearchParams(location.search).get("jour");
    fetch("/api/people" + (jour ? `?day=${encodeURIComponent(jour)}` : "")).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      everyone = d.people;
      for (const [sel, args] of pending) fillPeople(sel, ...args);
    }).catch(() => { /* liste locale de la vue seulement */ });
  }

  // Onglet « Pilotage » (depuis Synthèse ou Paramètres) : retour à la dernière sous-vue, filtres compris
  const tab = document.querySelector(".topbar .tab[data-pilotage]");
  if (tab && !inPilotage) {
    tab.addEventListener("click", () => { const last = memo.get(); if (last) tab.href = urlFor(last.path, last.shared); }, true);
  }
})();
