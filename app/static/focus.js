/* Mode focus partagé par les pages Tempo : un bloc passe en grand ; Échap, clic à côté ou « Réduire » pour revenir */
(() => {
  "use strict";
  const backdrop = document.getElementById("focusBackdrop");
  let focused = null;
  const setBtn = (panel, on) => {
    const b = panel.querySelector("[data-focus]"); if (!b) return;
    b.setAttribute("aria-pressed", on);
    b.title = on ? "Revenir à la page (Échap)" : "Agrandir ce bloc (Échap pour revenir)";
    b.querySelector("span").textContent = on ? "Réduire" : "Agrandir";
    b.querySelector("path").setAttribute("d", on ? "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" : "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7");
  };
  function setFocus(el) {
    const prev = focused;
    if (prev) { prev.classList.remove("focused"); setBtn(prev, false); }
    focused = el && el !== prev ? el : null;
    if (focused) { focused.classList.add("focused"); setBtn(focused, true); }
    backdrop.hidden = !focused;
    document.documentElement.classList.toggle("has-focus", !!focused);
    (focused || prev)?.querySelector("[data-focus]")?.focus({ preventScroll: true });
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-focus]"); if (b) setFocus(b.closest(".panel, .card")); });
  backdrop.addEventListener("click", () => setFocus(null));
  // Échap ferme d'abord une fenêtre de détail ouverte, pas le bloc agrandi
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && focused && !document.querySelector("dialog[open]")) setFocus(null); });
})();
