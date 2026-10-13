/* PMO Reporting — glossaire commun (JS natif). Chargé sur toutes les pages, après pilotage.js.
   Un seul mot par notion, une seule définition : chaque libellé d'indicateur (en-tête de tableau, titre de tuile,
   nom de filtre) reconnu ci-dessous reçoit la définition en info-bulle et un soulignement pointillé.
   Les pages se redessinent souvent : un observateur applique le glossaire à chaque rendu.
   Pour ajouter ou corriger une définition : modifier TERMS (motif sur le libellé, définition). */
(() => {
  "use strict";

  const TERMS = [
    [/^(raf|reste à faire)( (dev|qa))?$/i, "Reste à faire : estimation restante dans Jira des tâches non finies, en JH (1 JH = 8 h). DEV = développement et anomalies de test ; QA = recette. Une tâche finie ne compte plus (son reste éventuel est « à solder dans Jira »)."],
    [/^(capacité du sprint|capa\. sprint)$/i, "Capacité du sprint : du 1er jour au jalon, (planning Tempo × disponibilité − absences − scrum events) × affectation au chantier."],
    [/^(capacité( (dev|qa))? restante|capa\. restante)\b/i, "Capacité restante : d'aujourd'hui au jalon, jour par jour, (disponible − temps déjà imputé − scrum events) × affectation. C'est elle qui se compare au reste à faire. Les jours passés non saisis n'en font pas partie."],
    [/^écart( (dev|qa))?$/i, "Écart = capacité restante − reste à faire. Positif : marge ; négatif : ce qui manque pour tenir le jalon."],
    [/^charge( \/ capa)?$/i, "Charge = reste à faire ÷ capacité restante. Maîtrisé sous 80 %, sous tension de 80 à 100 %, hors capacité au-delà."],
    [/^météo$/i, "Météo : hors capacité si le reste à faire dépasse la capacité restante ; sous tension au-delà de 80 % ou avec des tâches en retard ; maîtrisé sinon."],
    [/^variation( raf)?$/i, "Variation : différence avec le relevé de comparaison (date affichée), ou avec le relevé précédent dans le suivi jour par jour."],
    [/^dérive$/i, "Dérive (effort) = à terminaison − estimé initial. Conforme jusqu'à +5 %, dérive jusqu'à +20 %, forte dérive au-delà."],
    [/^estimé$/i, "Estimé : estimation initiale saisie dans Jira."],
    [/^consommé$/i, "Consommé : temps passé saisi sur la tâche dans Jira."],
    [/^à terminaison$/i, "À terminaison = consommé + reste à faire : l'effort total prévu aujourd'hui."],
    [/^décalage$/i, "Décalage = part réellement imputée sur le chantier − part prévue (affectation), en points. Signalé à partir de 20 points."],
    [/^imputé$/i, "Imputé : temps saisi dans Tempo (hors absences), depuis le 1er jour du sprint."],
    [/^avancement$/i, "Avancement = temps passé ÷ (temps passé + reste à faire)."],
    [/^profil$/i, "Profil : DEV, QA ou TL / PO, le même classement sur toutes les pages (un TL / PO qui a du reste à faire est signalé « réalise du DEV » ou « du QA »)."],
    [/^(scrum ÷ temps travaillé|part mesurée|ratio)$/i, "Part des scrum events = scrum events ÷ temps travaillé (tâches du sprint + scrum events + autres sujets ; absences exclues). Objectif : paramètre de capacité (10 % pour les DEV / QA)."],
    [/^temps travaillé$/i, "Temps travaillé = tâches du sprint + scrum events + autres sujets saisis dans Tempo ; absences exclues."],
    [/^temps non saisis$/i, "Temps non saisis : heures dues au planning Tempo, sur les jours passés, qui n'ont été saisies ni en travail ni en absence."],
    [/^coût de la non-qualité$/i, "Coût de la non-qualité = temps passé sur les anomalies (BUG + ANO) ÷ temps de développement des US."],
    [/^densité$/i, "Densité = anomalies de test (ANO) par US développée."],
    [/^alertes critiques$/i, "Alertes critiques : tâches en retard (hors Ready for QA et Merge Request), bloquées, ou avec une échéance après le Freeze Code ou la fin de test."],
    [/^vs paramètre$/i, "Part mesurée − paramètre de capacité, en points."],
    [/^par rapport au budget$/i, "Scrum events saisis − budget (objectif × temps travaillé), en JH. Positif : au-delà du budget."],
  ];
  const SEL = "th, .kpi .lbl, .rc-tile .lbl, .field > span, .rp-table th";

  const labelOf = (el) => (el.innerText || el.textContent || "").split("\n")[0].replace(/\s+/g, " ").replace(/[\s:]+$/, "").trim();
  function apply(root) {
    for (const el of root.querySelectorAll(SEL)) {
      if (el.dataset.gl) continue;
      const def = TERMS.find(([re]) => re.test(labelOf(el)))?.[1];
      el.dataset.gl = def ? "1" : "0";
      if (!def) continue;
      el.classList.add("gl");
      // une info-bulle propre à la page (formule, date) est gardée, la définition commune vient d'abord
      el.title = el.title ? `${def}\n\n${el.title}` : def;
    }
  }
  let queued = false;
  const run = () => { queued = false; apply(document); };
  new MutationObserver(() => { if (!queued) { queued = true; setTimeout(run, 30); } })  // pas requestAnimationFrame : suspendu quand l'onglet est masqué (impression, aperçu)
    .observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
  window.Glossaire = { TERMS, apply };
})();
