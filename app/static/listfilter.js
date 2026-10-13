/* PMO Reporting — filtre de liste commun à toutes les pages (JS natif).
   Même comportement partout : accents et majuscules ignorés, plusieurs mots dans n'importe quel ordre,
   compteur « n / N », Échap pour vider. Le filtrage porte sur les données de la page (pas seulement
   sur les lignes affichées), la page appelle match() puis count(). */
(() => {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = (q) => norm(q).split(/\s+/).filter(Boolean);

  // Vrai si tous les mots de la recherche figurent dans le texte (vide : tout passe)
  function match(text, q) {
    const w = words(q);
    if (!w.length) return true;
    const t = norm(text);
    return w.every((x) => t.includes(x));
  }

  // Champ de recherche : key identifie la liste (data-lf), à relire dans l'évènement « input »
  function fieldHtml({ key, label, placeholder, value = "" }) {
    return `<div class="lf"><label class="lf-in"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>` +
      `<input type="search" data-lf="${esc(key)}" value="${esc(value)}" placeholder="${esc(placeholder || "Filtrer…")}" aria-label="${esc(label)}" autocomplete="off" spellcheck="false"></label>` +
      `<span class="lf-count" data-lf-count="${esc(key)}" role="status" aria-live="polite"></span></div>`;
  }

  // Compteur « n / N » quand un filtre est actif ; rien sinon
  function count(key, shown, total, q) {
    const el = document.querySelector(`[data-lf-count="${CSS.escape(key)}"]`);
    if (el) el.textContent = words(q).length ? `${shown} / ${total}` : "";
  }

  // Ligne « rien ne correspond » d'un tableau
  const noneRow = (cols, q) => `<tr><td colspan="${cols}" class="empty">Aucune ligne ne correspond à « ${esc(q.trim())} ».</td></tr>`;

  // Échap vide le champ (et ne ferme pas le bloc agrandi au passage)
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (e.key !== "Escape" || !t.matches?.("input[data-lf]") || !t.value) return;
    e.preventDefault(); e.stopPropagation();
    t.value = "";
    t.dispatchEvent(new Event("input", { bubbles: true }));
  }, true);

  window.ListFilter = { norm, match, fieldHtml, count, noneRow };
})();
