/* PMO Reporting — page Paramètres : la configuration de l'outil, éditable et tracée (JS natif) */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const get = (o, path) => path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
  function set(o, path, v) {
    const ks = path.split("."), last = ks.pop();
    let cur = o;
    for (const k of ks) { if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {}; cur = cur[k]; }
    cur[last] = v;
  }

  // ---------- les sections, dans l'ordre de la page
  const SECTIONS = [
    { id: "sprint", title: "Sprint", desc: "À mettre à jour à chaque sprint : tous les calculs (verdict, capacité, burndown) en dépendent.", fields: [
      { path: "sprint.name", label: "Nom du sprint", type: "text" },
      { path: "sprint.date_debut", label: "Début du sprint", type: "date" },
      { path: "sprint.freeze_code", label: "Freeze Code (fin du développement)", type: "date" },
      { path: "sprint.fin_test", label: "Fin de test (fin de la recette)", type: "date" },
    ] },
    { id: "jira", title: "Source Jira", desc: "D'où viennent les tâches. Le jeton d'accès reste dans le fichier .env du serveur.", fields: [
      { path: "source", label: "Source des données", type: "select", options: [["jira", "Jira en direct"], ["excel", "Démo (classeur Excel)"]] },
      { path: "jira.base_url", label: "Adresse de Jira", type: "text", locked: true, hint: "Réglée sur le serveur, dans .env (JIRA_BASE_URL) : le jeton Jira y est envoyé" },
      { path: "jira.filters.tasks", label: "Filtre Jira des sous-tâches", type: "number", hint: "Numéro du filtre" },
      { path: "jira.filters.us", label: "Filtre Jira des US", type: "number" },
      { path: "jira.filters.feat", label: "Filtre Jira des FEAT", type: "number" },
      { path: "jira.verify_ssl", label: "Vérifier le certificat de Jira", type: "bool", locked: true },
      { path: "jira.timeout_s", label: "Délai maximal d'une requête (secondes)", type: "number" },
    ] },
    { id: "chantiers", title: "Chantiers", desc: "Étiquette Jira → chantier. Le premier motif trouvé dans les étiquettes l'emporte : l'ordre compte.", fields: [
      { path: "chantiers", type: "list", columns: [{ key: "match", label: "Motif d'étiquette Jira" }, { key: "name", label: "Chantier", suggest: "chantiers" }], addLabel: "Ajouter un chantier" },
    ] },
    { id: "feat", title: "FEAT par défaut", desc: "Pour les tâches et bugs rattachés à aucune FEAT dans Jira. Sans réglage, la FEAT unique du chantier est utilisée.", fields: [
      { path: "feat_par_chantier", type: "map", keyLabel: "Chantier", keySuggest: "chantiers", valueLabel: "Clé de la FEAT (ex. EP0087-3477)", addLabel: "Ajouter une FEAT par défaut" },
    ] },
    { id: "statuts", title: "Statuts", desc: "Comment les statuts Jira sont interprétés. Les comparaisons ignorent les majuscules.", fields: [
      { path: "done_statuses", label: "Statuts « terminé »", type: "tags", suggest: "statuses" },
      { path: "no_delay_statuses", label: "Statuts « livré » : jamais en retard, pas de RAF à estimer", type: "tags", suggest: "statuses" },
      { path: "estimate_required_statuses", label: "Statuts où une tâche doit être estimée (alerte « Sans estimation »)", type: "tags", suggest: "statuses" },
    ] },
    { id: "types", title: "Types de tâches", desc: "Types Jira et leur rôle dans le reste à faire.", fields: [
      { path: "issue_types.dev", label: "Affichés DEV", type: "tags", suggest: "types" },
      { path: "issue_types.qa", label: "Affichés QA", type: "tags", suggest: "types" },
      { path: "issue_types.ano", label: "Affichés ANO (anomalies)", type: "tags", suggest: "types" },
      { path: "issue_types.bug", label: "Affichés BUG", type: "tags", suggest: "types" },
      { path: "raf_dev_types", label: "Comptent dans le RAF DEV (jusqu'au Freeze Code)", type: "tags", suggest: "types" },
      { path: "raf_qa_types", label: "Comptent dans le RAF QA (jusqu'à la fin de test)", type: "tags", suggest: "types" },
    ] },
    { id: "calcul", title: "Calcul et rafraîchissement", fields: [
      { path: "hours_per_day", label: "Heures dans un jour-homme (JH)", type: "number" },
      { path: "cache_ttl_s", label: "Durée de conservation des données lues (secondes)", type: "number" },
      { path: "history.enabled", label: "Enregistrer un relevé chaque jour (historique)", type: "bool" },
      { path: "history.auto_refresh_min", label: "Relecture automatique en arrière-plan (minutes, 0 = jamais)", type: "number" },
    ] },
    { id: "tempo", title: "Tempo", desc: "Capacité et temps saisis. Lu avec le même jeton que Jira.", fields: [
      { path: "tempo.enabled", label: "Lire Tempo", type: "bool" },
      { path: "tempo.team_id", label: "Équipe Tempo (identifiant)", type: "number" },
      { path: "tempo.absence_issues", label: "Tâches où les absences sont saisies", type: "tags", hint: "Clés Jira, ex. PINTERNE-70" },
      { path: "tempo.scrum_events.percent.team", label: "Part des scrum events, DEV / QA (%)", type: "number" },
      { path: "tempo.scrum_events.percent.lead", label: "Part des scrum events, TL / PO (%)", type: "number" },
      { path: "tempo.scrum_events.match", label: "Mots qui identifient un scrum event dans le résumé", type: "tags" },
      { path: "tempo.scrum_events.issues", label: "Tâches scrum events (clés)", type: "tags" },
    ] },
    { id: "roles", title: "Rôles", desc: "Le profil vient du rôle dans l'équipe Tempo ; les listes de personnes forcent une exception.", fields: [
      { path: "tempo.roles.lead_roles", label: "Rôles Tempo comptés TL / PO", type: "tags", suggest: "roles" },
      { path: "tempo.roles.dev_roles", label: "Rôles Tempo comptés DEV", type: "tags", suggest: "roles" },
      { path: "tempo.roles.qa_roles", label: "Rôles Tempo comptés QA", type: "tags", suggest: "roles" },
      { path: "tempo.roles.lead_people", label: "Personnes forcées en TL / PO", type: "tags", suggest: "people" },
      { path: "tempo.roles.dev_people", label: "Personnes forcées en DEV", type: "tags", suggest: "people" },
      { path: "tempo.roles.qa_people", label: "Personnes forcées en QA", type: "tags", suggest: "people" },
      { path: "tempo.roles.team_people", label: "Personnes forcées hors TL / PO", type: "tags", suggest: "people" },
    ] },
    { id: "affectations", title: "Affectations par chantier", desc: "Part du temps de chaque personne sur chaque chantier. Personne non listée : au prorata de son RAF. Total inférieur à 100 % : le reste va à d'autres sujets.", fields: [
      { path: "tempo.affectations", type: "affect" },
    ] },
    { id: "presences", title: "Présences sur le sprint", desc: "Arrivée ou départ en cours de sprint. Hors de cette période : ni capacité, ni saisie attendue.", fields: [
      { path: "tempo.presences", type: "presence" },
    ] },
    { id: "conges", title: "Congés", desc: "Absences connues d'avance, avant d'être saisies dans Tempo : ces jours-là, ni capacité ni saisie attendue. Une absence saisie dans Tempo le même jour n'est pas comptée deux fois.", fields: [
      { path: "tempo.alternants", label: "Alternants : absents les 2 premiers mercredis de chaque mois", type: "tags", suggest: "people", hint: "Noms tels qu'affichés dans Jira" },
      { path: "tempo.conges", label: "Congés prévus", type: "leave", addLabel: "Ajouter un congé" },
    ] },
  ];
  const LABELS = {};
  for (const s of SECTIONS) for (const f of s.fields) LABELS[f.path] = f.label || s.title;

  const state = { orig: null, work: null, editable: false, errors: {}, rows: {}, suggest: {}, meta: {}, filters: {}, hist: [], histQ: "" };
  // ---------- filtres des listes (tableaux de plus de FILTER_MIN lignes, historique)
  const LF = window.ListFilter, FILTER_MIN = 6, HIST_MAX = 30;
  // une ligne vide (en cours de saisie) reste toujours visible
  const blank = (r) => Object.values(r).every((v) => v === "" || v == null);
  const rowVisible = (r, q) => !q || blank(r) || LF.match(Object.values(r).join(" "), q);
  function applyTableFilter(path) {
    const box = document.querySelector(`[data-field="${CSS.escape(path)}"]`), rows = state.rows[path] || [];
    if (!box) return;
    const q = state.filters[path] || "";
    let shown = 0;
    box.querySelectorAll("tbody tr[data-r]").forEach((tr) => { const v = rowVisible(rows[+tr.dataset.r] || {}, q); tr.hidden = !v; shown += v; });
    const none = box.querySelector(".lf-none");
    if (none) { none.hidden = !(q && rows.length && !shown); none.textContent = `Aucune ligne ne correspond à « ${q.trim()} ».`; }
    box.classList.toggle("lf-on", !!q.trim()); // pas de déplacement ↑↓ pendant un filtre : les voisins sont masqués
    LF.count(`table:${path}`, shown, rows.length, q);
  }

  // ---------- lignes des tableaux (dictionnaires imbriqués ↔ lignes éditables)
  function rowsFrom(f, v) {
    if (f.type === "map") return Object.entries(v || {}).map(([k, x]) => ({ k, v: x }));
    if (f.type === "affect") return Object.entries(v || {}).flatMap(([p, chs]) => Object.entries(chs || {}).map(([c, pct]) => ({ p, c, pct })));
    if (f.type === "presence") return Object.entries(v || {}).map(([p, x]) => ({ p, debut: x?.debut || "", fin: x?.fin || "" }));
    if (f.type === "leave") return (v || []).map((x) => ({ p: x?.p || "", debut: x?.debut || "", fin: x?.fin || "", motif: x?.motif || "" }));
    return (v || []).map((x) => ({ ...x }));
  }
  function valueFrom(f, rows) {
    if (f.type === "map") return Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v.trim()]));
    if (f.type === "affect") {
      const o = {};
      for (const r of rows) if (r.p.trim() && r.c.trim()) (o[r.p.trim()] ||= {})[r.c.trim()] = r.pct === "" ? 0 : Number(r.pct);
      return o;
    }
    if (f.type === "presence") {
      const o = {};
      for (const r of rows) if (r.p.trim() && (r.debut || r.fin)) o[r.p.trim()] = { ...(r.debut ? { debut: r.debut } : {}), ...(r.fin ? { fin: r.fin } : {}) };
      return o;
    }
    if (f.type === "leave") {
      // ligne entièrement vide ignorée ; « au » vide = un seul jour
      return rows.filter((r) => r.p.trim() || r.debut || r.fin).map((r) => ({ p: r.p.trim(), debut: r.debut,
        ...(r.fin ? { fin: r.fin } : {}), ...(r.motif.trim() ? { motif: r.motif.trim() } : {}) }));
    }
    return rows.map((r) => ({ ...r }));
  }
  const ROWED = ["list", "map", "affect", "presence", "leave"];

  // ---------- rendu
  // locked : réglage serveur, affiché mais jamais modifiable ici
  const dis = (f) => (state.editable && !f?.locked ? "" : " disabled");
  const errOf = (path) => Object.entries(state.errors).filter(([p]) => p === path || p.startsWith(path + ".")).map(([, m]) => m);
  const list = (id) => (state.suggest[id] ? ` list="dl-${id}"` : "");

  function fieldHtml(f) {
    const v = get(state.work, f.path), errs = errOf(f.path);
    const dirty = !same(v, get(state.orig, f.path));
    const wrap = (inner, cls = "") => `<div class="st-field ${cls} ${dirty ? "dirty" : ""} ${errs.length ? "invalid" : ""}" data-field="${esc(f.path)}">${inner}${errs.map((m) => `<p class="st-err">${esc(m)}</p>`).join("")}</div>`;
    const lab = f.label ? `<span class="st-lbl">${esc(f.label)}${dirty ? ' <i class="st-mod">modifié</i>' : ""}</span>` : "";
    const hint = f.hint ? `<span class="st-hint">${esc(f.hint)}</span>` : "";
    if (f.type === "bool") {
      return wrap(`<label class="toggle"><input type="checkbox" data-path="${esc(f.path)}" ${v ? "checked" : ""}${dis(f)}><span class="tg"></span>${esc(f.label)}${dirty ? ' <i class="st-mod">modifié</i>' : ""}</label>`, "bool");
    }
    if (f.type === "select") {
      return wrap(`<label class="field">${lab}<select data-path="${esc(f.path)}"${dis(f)}>${f.options.map(([o, l]) => `<option value="${esc(o)}" ${o === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>${hint}</label>`);
    }
    if (f.type === "tags") {
      const tags = Array.isArray(v) ? v : [];
      return wrap(`<div class="field">${lab}<div class="st-tags">${tags.map((t, i) => `<span class="st-tag">${esc(t)}${state.editable ? `<button type="button" data-untag="${esc(f.path)}" data-i="${i}" aria-label="Retirer ${esc(t)}">×</button>` : ""}</span>`).join("")}${state.editable ? `<input type="text" data-tag="${esc(f.path)}" placeholder="Ajouter…" aria-label="${esc(f.label)} : ajouter une valeur"${list(f.suggest)}>` : ""}</div>${hint || (state.editable ? '<span class="st-hint">Entrée pour ajouter</span>' : "")}</div>`);
    }
    if (ROWED.includes(f.type)) return wrap(lab + tableHtml(f), "wide");  // intitulé au-dessus du tableau quand le champ en a un
    const val = v ?? "";
    return wrap(`<label class="field">${lab}<input type="${f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}" data-path="${esc(f.path)}" value="${esc(val)}"${f.type === "number" ? ' step="any"' : ""}${dis(f)}>${hint}</label>`);
  }

  function tableHtml(f) {
    const rows = (state.rows[f.path] ||= rowsFrom(f, get(state.work, f.path)));
    const cols = f.type === "list" ? f.columns.map((c) => ({ ...c, type: "text" }))
      : f.type === "map" ? [{ key: "k", label: f.keyLabel, suggest: f.keySuggest }, { key: "v", label: f.valueLabel }]
      : f.type === "affect" ? [{ key: "p", label: "Personne", suggest: "people" }, { key: "c", label: "Chantier", suggest: "chantiers" }, { key: "pct", label: "Part du temps (%)", type: "number" }]
      : f.type === "leave" ? [{ key: "p", label: "Personne", suggest: "people" }, { key: "debut", label: "Du", type: "date" }, { key: "fin", label: "Au (inclus, vide = un jour)", type: "date" }, { key: "motif", label: "Motif (facultatif)" }]
      : [{ key: "p", label: "Personne", suggest: "people" }, { key: "debut", label: "Arrivée", type: "date" }, { key: "fin", label: "Départ", type: "date" }];
    // total par personne pour les affectations
    const totals = f.type === "affect" ? rows.reduce((a, r) => ((a[r.p] = (a[r.p] || 0) + (Number(r.pct) || 0)), a), {}) : {};
    // ligne en erreur : par position (chantiers) ou par personne (affectations, présences)
    const rowErr = (r, i) => !!state.errors[`${f.path}.${f.type === "list" || f.type === "leave" ? i : (r.p || r.k || "").trim()}`];
    const body = rows.map((r, i) => `<tr data-r="${i}" class="${rowErr(r, i) ? "invalid" : ""}">${cols.map((c) => `<td><input type="${c.type || "text"}" data-row="${esc(f.path)}" data-i="${i}" data-k="${c.key}" value="${esc(r[c.key] ?? "")}"${c.type === "number" ? ' step="any" min="0" max="100"' : ""}${list(c.suggest)} aria-label="${esc(c.label)}"${dis()}></td>`).join("")}
      ${f.type === "affect" ? `<td class="num st-total ${totals[r.p] > 100 ? "over" : ""}">${r.p ? `${totals[r.p] || 0} %` : ""}</td>` : ""}
      ${state.editable ? `<td class="st-rowtools">${f.type === "list" ? `<button type="button" class="btn quiet small" data-move="${esc(f.path)}" data-i="${i}" data-d="-1" aria-label="Monter" ${i ? "" : "disabled"}>↑</button><button type="button" class="btn quiet small" data-move="${esc(f.path)}" data-i="${i}" data-d="1" aria-label="Descendre" ${i < rows.length - 1 ? "" : "disabled"}>↓</button>` : ""}<button type="button" class="btn quiet small" data-del="${esc(f.path)}" data-i="${i}" aria-label="Supprimer la ligne">Supprimer</button></td>` : ""}</tr>`).join("");
    const q = state.filters[f.path] || "";
    const filter = rows.length >= FILTER_MIN || q ? LF.fieldHtml({ key: `table:${f.path}`, label: `Filtrer : ${f.label || f.addLabel || "lignes"}`, placeholder: "Filtrer les lignes…", value: q }) : "";
    return `${filter}<table class="grid compact st-table"><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}${f.type === "affect" ? '<th class="num">Total de la personne</th>' : ""}${state.editable ? "<th></th>" : ""}</tr></thead>
      <tbody>${body || `<tr><td colspan="${cols.length + 2}" class="muted st-empty">Aucune ligne.</td></tr>`}</tbody></table>
      <p class="muted lf-none" hidden></p>
      ${state.editable ? `<button type="button" class="btn small" data-add="${esc(f.path)}">+ ${esc(f.addLabel || "Ajouter une ligne")}</button>` : ""}`;
  }

  function sectionDirty(s) { return s.fields.some((f) => !same(get(state.work, f.path), get(state.orig, f.path))); }
  function sectionHtml(s) {
    return `<section class="card st-sec" id="sec-${s.id}" aria-labelledby="h-${s.id}">
      <div class="st-sec-head"><h2 id="h-${s.id}">${esc(s.title)}</h2>${s.desc ? `<p class="muted">${esc(s.desc)}</p>` : ""}</div>
      <div class="st-grid">${s.fields.map(fieldHtml).join("")}</div></section>`;
  }
  function renderSection(id) {
    const s = SECTIONS.find((x) => x.id === id);
    const el = $(`sec-${id}`);
    if (s && el) el.outerHTML = sectionHtml(s);
    s?.fields.forEach((f) => ROWED.includes(f.type) && applyTableFilter(f.path));
  }
  function renderNav() {
    $("nav").innerHTML = SECTIONS.map((s) => `<a href="#sec-${s.id}" class="${sectionDirty(s) ? "dirty" : ""} ${s.fields.some((f) => errOf(f.path).length) ? "invalid" : ""}">${esc(s.title)}</a>`).join("");
  }
  function renderAll() {
    $("content").innerHTML = SECTIONS.map(sectionHtml).join("") + datalists();
    SECTIONS.flatMap((s) => s.fields).forEach((f) => ROWED.includes(f.type) && applyTableFilter(f.path));
    renderNav(); renderSaveBar();
  }
  function datalists() {
    return Object.entries(state.suggest).map(([id, vals]) => `<datalist id="dl-${id}">${vals.map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist>`).join("");
  }

  // ---------- modifications
  // mêmes règles que le serveur (store._flatten) : une entrée par personne ou par chantier pour les tableaux
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const flat = (v, pre = "") => (isObj(v) && /(affectations|presences|feat_par_chantier)$/.test(pre)
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [`${pre}.${k}`, x]))
    : isObj(v) && Object.keys(v).length
      ? Object.entries(v).reduce((a, [k, x]) => Object.assign(a, flat(x, pre ? `${pre}.${k}` : k)), {}) : { [pre]: v });
  function changes() {
    const a = flat(state.orig), b = flat(state.work);
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !same(a[k], b[k])).sort().map((k) => ({ path: k, before: a[k], after: b[k] }));
  }
  const item = (x) => (x && typeof x === "object" ? Object.values(x).filter((y) => y !== "" && y != null).join(" ") : x);
  const show = (v) => (v == null || v === "" ? "—" : Array.isArray(v) ? (v.length ? v.map(item).join(", ") : "—") : typeof v === "object" ? Object.entries(v).map(([k, x]) => `${k} : ${typeof x === "object" ? Object.entries(x).map(([a, b]) => `${a} ${b}`).join(", ") : x}`).join(" ; ") || "—" : String(v));
  function labelOf(path) {
    if (LABELS[path]) return LABELS[path];
    const base = Object.keys(LABELS).find((p) => path.startsWith(p + "."));
    return base ? `${LABELS[base]} · ${path.slice(base.length + 1)}` : path;
  }
  function renderSaveBar() {
    const ch = state.editable ? changes() : [];
    $("saveBar").hidden = !ch.length;
    document.body.classList.toggle("st-saving", !!ch.length);
    $("dirtyCount").textContent = `${ch.length} paramètre${ch.length > 1 ? "s" : ""} modifié${ch.length > 1 ? "s" : ""}, non enregistré${ch.length > 1 ? "s" : ""}`;
    $("diff").innerHTML = `<ul>${ch.map((c) => `<li><b>${esc(labelOf(c.path))}</b> : <s>${esc(show(c.before))}</s> → ${esc(show(c.after))}</li>`).join("")}</ul>`;
  }
  function touch(path, value, rerender) {
    set(state.work, path, value);
    // une correction efface les erreurs du champ ; le serveur revérifie à l'enregistrement
    for (const p of Object.keys(state.errors)) if (p === path || p.startsWith(path + ".")) delete state.errors[p];
    const sec = SECTIONS.find((s) => s.fields.some((f) => f.path === path));
    if (rerender && sec) renderSection(sec.id);
    else {
      // marquer le champ modifié sans perdre le focus
      const el = document.querySelector(`[data-field="${CSS.escape(path)}"]`);
      el?.classList.toggle("dirty", !same(value, get(state.orig, path)));
      el?.classList.remove("invalid");
      el?.querySelectorAll(".st-err").forEach((x) => x.remove());
      el?.querySelectorAll("tr.invalid").forEach((x) => x.classList.remove("invalid"));
    }
    renderNav(); renderSaveBar();
  }
  const fieldOf = (path) => SECTIONS.flatMap((s) => s.fields).find((f) => f.path === path);

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.lf) {
      if (t.dataset.lf === "hist") { state.histQ = t.value; renderHistory(); }
      else { const path = t.dataset.lf.slice("table:".length); state.filters[path] = t.value; applyTableFilter(path); }
      return;
    }
    if (t.dataset.path) {
      const f = fieldOf(t.dataset.path);
      const v = t.type === "checkbox" ? t.checked : f.type === "number" ? (t.value === "" ? null : Number(t.value)) : t.value;
      touch(t.dataset.path, v, false);
    } else if (t.dataset.row) {
      const f = fieldOf(t.dataset.row), rows = state.rows[t.dataset.row];
      rows[+t.dataset.i][t.dataset.k] = t.value;
      touch(t.dataset.row, valueFrom(f, rows), false);
      if (f.type === "affect") {
        // totaux par personne à jour sans perdre le focus
        const totals = rows.reduce((a, r) => ((a[r.p] = (a[r.p] || 0) + (Number(r.pct) || 0)), a), {});
        document.querySelectorAll(`[data-field="${CSS.escape(t.dataset.row)}"] tbody tr`).forEach((tr, i) => {
          const td = tr.querySelector(".st-total"), r = rows[i];
          if (td && r) { td.textContent = r.p ? `${totals[r.p] || 0} %` : ""; td.classList.toggle("over", totals[r.p] > 100); }
        });
      }
    }
  });
  document.addEventListener("change", (e) => { if (e.target.type === "checkbox" && e.target.dataset.path) touch(e.target.dataset.path, e.target.checked, true); });
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t.dataset.tag && (e.key === "Enter" || e.key === ",")) {
      e.preventDefault();
      const v = t.value.trim().replace(/,$/, "");
      if (!v) return;
      const cur = get(state.work, t.dataset.tag) || [];
      if (!cur.some((x) => String(x).toLowerCase() === v.toLowerCase())) touch(t.dataset.tag, [...cur, v], true);
      document.querySelector(`[data-tag="${CSS.escape(t.dataset.tag)}"]`)?.focus();
    }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.untag) {
      const cur = [...(get(state.work, b.dataset.untag) || [])];
      cur.splice(+b.dataset.i, 1);
      touch(b.dataset.untag, cur, true);
    } else if (b.dataset.add || b.dataset.del || b.dataset.move) {
      const path = b.dataset.add || b.dataset.del || b.dataset.move, f = fieldOf(path), rows = state.rows[path];
      if (b.dataset.add) rows.push(f.type === "list" ? Object.fromEntries(f.columns.map((c) => [c.key, ""])) : f.type === "map" ? { k: "", v: "" } : f.type === "affect" ? { p: "", c: "", pct: 100 } : f.type === "leave" ? { p: "", debut: "", fin: "", motif: "" } : { p: "", debut: "", fin: "" });
      if (b.dataset.del) rows.splice(+b.dataset.i, 1);
      if (b.dataset.move) { const i = +b.dataset.i, j = i + +b.dataset.d; [rows[i], rows[j]] = [rows[j], rows[i]]; }
      touch(path, valueFrom(f, rows), true);
      if (b.dataset.add) document.querySelector(`[data-field="${CSS.escape(path)}"] tbody tr:last-child input`)?.focus();
    }
  });

  // ---------- enregistrement
  function msg(text, kind = "err") { const m = $("saveMsg"); m.textContent = text; m.className = `st-msg ${kind}`; m.hidden = !text; }
  $("showDiff").addEventListener("click", () => { const d = $("diff"); d.hidden = !d.hidden; $("showDiff").setAttribute("aria-expanded", !d.hidden); $("showDiff").textContent = d.hidden ? "Voir le détail" : "Masquer le détail"; });
  $("cancel").addEventListener("click", () => {
    state.work = clone(state.orig); state.rows = {}; state.errors = {}; msg(""); renderAll();
  });
  try { $("who").value = localStorage.getItem("pmo-who") || ""; } catch { /* stockage indisponible */ }
  $("save").addEventListener("click", async () => {
    const who = $("who").value.trim(), code = $("code").value;
    if (!who) { msg("Indiquez votre nom : il figure dans l'historique des modifications."); $("who").focus(); return; }
    if (!code) { msg("Le code administrateur est nécessaire pour enregistrer."); $("code").focus(); return; }
    try { localStorage.setItem("pmo-who", who); } catch { /* stockage indisponible */ }
    $("save").disabled = true; msg("");
    try {
      const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", "X-Admin-Code": code }, body: JSON.stringify({ data: state.work, by: who }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 422) {
        state.errors = Object.fromEntries((data.errors || []).map((x) => [x.path, x.msg]));
        renderAll();
        const n = (data.errors || []).length;
        msg(`${n} point${n > 1 ? "s" : ""} à corriger avant d'enregistrer, signalé${n > 1 ? "s" : ""} en rouge : ${(data.errors || []).map((x) => x.msg).join(" · ")}`);
        document.querySelector(".st-field.invalid")?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (!res.ok) { msg(data.detail || data.error || `Erreur ${res.status}`); if (res.status === 403) $("code").select(); return; }
      $("code").value = "";
      apply(data);
      toast(`${data.changes.length} modification${data.changes.length > 1 ? "s" : ""} enregistrée${data.changes.length > 1 ? "s" : ""}. Les données sont relues avec les nouveaux paramètres.`);
      loadHistory();
    } catch (e) {
      msg(`Enregistrement impossible : ${e.message}`);
    } finally {
      $("save").disabled = false;
    }
  });
  window.addEventListener("beforeunload", (e) => { if (state.editable && changes().length) { e.preventDefault(); e.returnValue = ""; } });

  function toast(text) { const t = $("toast"); t.textContent = text; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 5000); }

  // ---------- chargement
  function apply(data) {
    state.orig = clone(data.data); state.work = clone(data.data); state.rows = {}; state.errors = {};
    state.editable = data.editable; state.meta = data.meta || {};
    const st = data.storage || {};
    $("storage").textContent = st.storage === "mongo" ? `MongoDB · ${st.db}` : "MongoDB injoignable";
    $("storage").className = `badge ${st.storage === "mongo" ? "live" : "demo"}`;
    $("updated").textContent = state.meta.updated_at ? `Modifié le ${new Date(state.meta.updated_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} par ${state.meta.updated_by}` : "";
    const b = $("banner");
    b.hidden = data.editable;
    b.innerHTML = data.editable ? "" : `<span><b>Lecture seule.</b> ${esc(data.reason || "")}</span>`;
    renderAll();
  }
  async function loadHistory() {
    try {
      state.hist = (await (await fetch("/api/settings/history?limit=200")).json()).history || [];
      renderHistory();
    } catch { $("history").innerHTML = '<p class="muted st-empty">Historique indisponible.</p>'; }
  }
  // Historique : filtré sur l'auteur, la date, le paramètre et les valeurs ; les HIST_MAX plus récentes affichées
  function renderHistory() {
    const when = (x) => new Date(x.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    const text = (x) => [x.by, when(x), x.note, ...(x.changes || []).map((c) => `${labelOf(c.path)} ${show(c.before)} ${show(c.after)}`)].join(" ");
    const all = state.hist, h = all.filter((x) => LF.match(text(x), state.histQ)), more = h.length - HIST_MAX;
    if (all.length >= FILTER_MIN && !$("histFilter").firstChild) $("histFilter").innerHTML = LF.fieldHtml({ key: "hist", label: "Filtrer l'historique", placeholder: "Personne, paramètre, valeur…", value: state.histQ });
    LF.count("hist", h.length, all.length, state.histQ);
    $("history").innerHTML = h.length ? `<ol class="st-hist">${h.slice(0, HIST_MAX).map((x) => `<li><div><b>${esc(x.by)}</b><span class="muted"> · ${esc(when(x))}</span></div>
        ${x.note ? `<p class="muted">${esc(x.note)}</p>` : ""}<ul>${(x.changes || []).map((c) => `<li><b>${esc(labelOf(c.path))}</b> : <s>${esc(show(c.before))}</s> → ${esc(show(c.after))}</li>`).join("")}</ul></li>`).join("")}</ol>` +
        (more > 0 ? `<p class="muted st-empty">${more} modification${more > 1 ? "s" : ""} plus ancienne${more > 1 ? "s" : ""} : filtrer pour les retrouver.</p>` : "")
      : all.length ? `<p class="muted st-empty">Aucune modification ne correspond à « ${esc(state.histQ.trim())} ».</p>`
      : `<p class="muted st-empty">${state.meta.origin === "mongo" ? "Aucune modification pour l'instant." : "L'historique des modifications est tenu dans MongoDB."}</p>`;
  }
  // Suggestions de saisie : statuts, types, chantiers et personnes lus dans les données de l'outil
  async function loadSuggestions() {
    const uniq = (a) => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, "fr"));
    try {
      const t = await (await fetch("/api/reporting-tasks")).json();
      Object.assign(state.suggest, { statuses: uniq(t.rows.map((r) => r.status)), types: uniq(t.rows.map((r) => r.type)), chantiers: uniq(t.rows.map((r) => r.chantier)) });
    } catch { /* suggestions facultatives */ }
    try {
      const tp = await (await fetch("/api/tempo")).json();
      Object.assign(state.suggest, { people: uniq(tp.people.map((p) => p.name)), roles: uniq(tp.people.map((p) => p.role)) });
    } catch { /* Tempo indisponible : pas de suggestion de personnes */ }
    const lists = $("content").querySelectorAll("datalist");
    lists.forEach((d) => d.remove());
    $("content").insertAdjacentHTML("beforeend", datalists());
    // les champs créés avant l'arrivée des suggestions reçoivent leur liste
    document.querySelectorAll("[data-tag], [data-row]").forEach((i) => {
      const f = fieldOf(i.dataset.tag || i.dataset.row);
      const sug = f?.suggest || (f?.type === "map" && i.dataset.k === "k" ? f.keySuggest : null) || ({ p: "people", c: "chantiers" })[i.dataset.k] || (f?.type === "list" ? f.columns.find((c) => c.key === i.dataset.k)?.suggest : null);
      if (sug && state.suggest[sug]) i.setAttribute("list", `dl-${sug}`);
    });
  }

  (async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.detail || `erreur ${res.status}`);  // ex. MongoDB injoignable : la raison du serveur
      apply(data);
      $("loading").hidden = true;
      loadHistory();
      loadSuggestions();
    } catch (e) {
      $("loadingCard").innerHTML = `<div class="le"><b>Impossible de charger les paramètres</b><p>${esc(e instanceof TypeError ? "Le serveur ne répond pas : vérifier qu'il est lancé (lancer.bat), puis réessayer." : e.message)}</p><button type="button" class="btn primary" onclick="location.reload()">Réessayer</button></div>`;
    }
  })();
})();
