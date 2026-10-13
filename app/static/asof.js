/* PMO Reporting — « image d'un jour X » : sélecteur de jour commun à tous les onglets (JS natif).
   Chargé avant le script de la page. Avec ?jour=AAAA-MM-JJ dans l'adresse, toutes les lectures /api/ de la page
   portent sur ce jour (relevé enregistré ce jour-là, temps Tempo saisis jusqu'à ce jour), et le jour suit la navigation. */
(() => {
  "use strict";

  const pad = (n) => String(n).padStart(2, "0");
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (iso) => new Date(iso + "T00:00:00");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = isoOf(new Date());
  const PAGES = ["/", "/recap", "/capa", "/temps", "/effort", "/scrum", "/anomalies", "/cadrage", "/rapport"];

  const params = new URLSearchParams(location.search);
  let day = params.get("jour");
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= today) day = null; // aujourd'hui : données en direct
  window.ASOF = { day, today };

  // ---- lectures et liens au jour choisi
  const SKIP = /^\/api\/(settings|days|health|check-jira|history\/\d)/; // ces lectures ne dépendent pas du jour affiché
  function withDay(u) {
    const url = new URL(u, location.origin);
    if (url.origin !== location.origin) return u;
    if (url.pathname.startsWith("/api/")) {
      if (SKIP.test(url.pathname)) return u;
      url.searchParams.set("day", day);
    } else if (PAGES.includes(url.pathname)) {
      url.searchParams.set("jour", day);
    } else return u;
    return url.pathname + url.search + url.hash;
  }
  if (day) {
    document.documentElement.classList.add("as-of");
    const orig = window.fetch.bind(window);
    window.fetch = (input, init) => orig(typeof input === "string" ? withDay(input) : input, init);
    // onglets, liens internes et exports : le jour suit (lien posé au moment du clic, y compris ceux créés par la page)
    const follow = (e) => {
      const a = e.target.closest?.("a[href]");
      if (a && !a.dataset.live) a.setAttribute("href", withDay(a.getAttribute("href")));
    };
    document.addEventListener("click", follow, true);
    document.addEventListener("auxclick", follow, true);
    document.addEventListener("contextmenu", follow, true);
  }

  // ---- sélecteur de jour dans l'en-tête
  const long = (iso) => parse(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const short = (iso) => parse(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const go = (d) => {
    const p = new URLSearchParams(location.search);
    if (d) p.set("jour", d); else p.delete("jour");
    location.assign(location.pathname + (p.toString() ? "?" + p : "") + location.hash);
  };
  const sync = document.querySelector(".topbar .sync");
  if (sync) {
    sync.insertAdjacentHTML("afterbegin", `
      <label class="asof-pick" title="Afficher l'image d'un jour passé du sprint">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
        <select id="asofSel" aria-label="Jour affiché"><option value="">${day ? esc(short(day)) : "Aujourd'hui"}</option></select>
      </label>`);
    const sel = document.getElementById("asofSel");
    sel.addEventListener("change", () => go(sel.value === today ? "" : sel.value));
    fetch("/api/days").then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => {
      const past = d.days.map((x) => x.day).filter((x) => x < today).reverse();
      const taken = Object.fromEntries(d.days.map((x) => [x.day, x.taken_at]));
      sel.innerHTML = `<option value="${today}" ${day ? "" : "selected"}>Aujourd'hui</option>` +
        (past.length ? `<optgroup label="Image d'un jour passé (${esc(d.sprint)})">${past.map((x) => `<option value="${x}" ${x === day ? "selected" : ""}>${esc(short(x))}</option>`).join("")}</optgroup>`
          : `<option disabled>Aucun jour passé enregistré</option>`);
      const at = day && taken[day] ? taken[day].slice(11, 16) : "";
      const t = document.getElementById("asofTaken");
      if (t && at) t.textContent = ` · relevé de ${at}`;
    }).catch(() => { /* liste indisponible : le sélecteur garde le jour courant */ });
  }

  // ---- bandeau : on ne regarde pas le direct
  if (day) {
    const main = document.querySelector("main");
    const back = new URLSearchParams(location.search);
    back.delete("jour");
    main?.insertAdjacentHTML("afterbegin", `
      <div class="asof-banner" role="status">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        <span><b>Image du ${esc(long(day))}</b><span id="asofTaken"></span>. Chiffres de ce jour-là : reste à faire et alertes relevés ce jour, temps Tempo saisis jusqu'à ce jour.</span>
        <a class="btn small" data-live="1" href="${location.pathname}${back.toString() ? "?" + back : ""}">Revenir à aujourd'hui</a>
      </div>`);
  }
})();
