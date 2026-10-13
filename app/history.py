"""Historique quotidien : une photo des tâches par jour, pour comparer l'avancement de jour en jour.

Jira ne conserve pas l'historique du RAF sous une forme exploitable simplement : on enregistre donc
nous-mêmes l'état des tâches (dernière lecture de la journée). Stockage : MongoDB si elle est configurée,
sinon la base SQLite locale (voir store.py).
"""
from __future__ import annotations

from datetime import date

from . import store
from .reporting import solde_finies
from .config import Settings


def _cur(s: Settings) -> tuple[str, str | None]:
    """Sprint courant : son nom et sa date de début, qui l'identifie (le nom peut changer)."""
    return s.sprint_name, s.sprint_start.isoformat() if s.sprint_start else None


def save(s: Settings, rows: list[dict], day: date | None = None) -> None:
    """Enregistre (ou remplace) la photo du jour : la dernière lecture de la journée fait foi."""
    if not s.history_enabled:
        return
    store.snap_save(s.history_path, s.source, *_cur(s), (day or date.today()).isoformat(), rows)


def days(s: Settings) -> list[dict]:
    """Jours disponibles pour le sprint courant, du plus ancien au plus récent."""
    if not s.history_enabled:
        return []
    return [{"day": d["day"], "taken_at": d["taken_at"]} for d in store.snap_list(s.history_path, s.source, _cur(s), with_rows=False)]


def at(s: Settings, day: str) -> dict | None:
    """Photo d'un jour du sprint courant (image « au jour X »), ou None si ce jour n'a pas été relevé."""
    if not s.history_enabled:
        return None
    snaps = store.snap_list(s.history_path, s.source, _cur(s), day=day)
    return {"day": snaps[-1]["day"], "taken_at": snaps[-1]["taken_at"], "rows": solde_finies(snaps[-1]["rows"])} if snaps else None


def load(s: Settings, day: str) -> dict | None:
    if not s.history_enabled:
        return None
    # Tous sprints confondus : on peut se comparer à la fin d'un sprint précédent
    snaps = store.snap_list(s.history_path, s.source, day=day)
    if not snaps:
        return None
    last = snaps[-1]
    return {"day": last["day"], "taken_at": last["taken_at"], "rows": solde_finies(last["rows"])}


def load_all(s: Settings) -> list[dict]:
    if not s.history_enabled:
        return []
    return [{"day": d["day"], "taken_at": d["taken_at"], "rows": solde_finies(d["rows"])} for d in store.snap_list(s.history_path, s.source, _cur(s))]


def sprint_bounds(s: Settings) -> list[dict]:
    """Pour chaque sprint enregistré : première et dernière photo (comparaison entre sprints).
    Sprints regroupés par date de début ; libellé : le nom du dernier relevé (le nom actuel pour le sprint courant)."""
    if not s.history_enabled:
        return []
    name, start = _cur(s)
    by_sprint: dict[str, list[dict]] = {}
    for d in store.snap_list(s.history_path, s.source):
        key = d.get("sprint_start") or (start if d["sprint"] == name and start else None) or f"nom:{d['sprint']}"
        by_sprint.setdefault(key, []).append(d)
    cur_key = start or f"nom:{name}"
    out = [{"sprint": name if k == cur_key else ds[-1]["sprint"], "first_day": ds[0]["day"], "last_day": ds[-1]["day"],
            "first": solde_finies(ds[0]["rows"]), "last": solde_finies(ds[-1]["rows"])}
           for k, ds in by_sprint.items()]
    return sorted(out, key=lambda b: b["first_day"])


def by_chantier(rows: list[dict]) -> dict[str, dict[str, float]]:
    """RAF DEV / QA de chaque chantier ce jour-là (burndown de la Synthèse et du rapport)."""
    out: dict[str, dict[str, float]] = {}
    for r in rows:
        c = out.setdefault(r.get("chantier") or "", {"raf_dev": 0.0, "raf_qa": 0.0})
        c["raf_dev"] += r.get("raf_dev") or 0
        c["raf_qa"] += r.get("raf_qa") or 0
    return {ch: {k: round(v, 4) for k, v in c.items()} for ch, c in out.items()}


def side_of(r: dict) -> str | None:
    """Côté DEV / QA d'une tâche ; relevés anciens (sans « side ») : déduit du type de charge."""
    if "side" in r:
        return r["side"]
    return {"DEV": "dev", "ANO": "dev", "QA": "qa"}.get(r.get("type_charge") or "")


def effort(rows: list[dict]) -> dict[str, dict[str, float]]:
    """Planifié vs consommé par côté : estimé initial, consommé, et à terminaison (consommé + reste à faire)."""
    out = {sd: {"est": 0.0, "spent": 0.0, "fin": 0.0} for sd in ("dev", "qa")}
    for r in rows:
        e = out.get(side_of(r))
        if e is None:
            continue
        spent = r.get("spent_hj") or 0
        e["est"] += r.get("estim_hj") or 0
        e["spent"] += spent
        e["fin"] += spent + (0 if r.get("done") else (r.get("raf_hj") or 0))
    return {sd: {k: round(v, 4) for k, v in e.items()} for sd, e in out.items()}


def totals(rows: list[dict]) -> dict:
    """Indicateurs d'une journée (mêmes règles que les KPI de la page)."""
    return {
        "effort": effort(rows),
        "raf_dev": round(sum(r.get("raf_dev") or 0 for r in rows), 4),
        "raf_qa": round(sum(r.get("raf_qa") or 0 for r in rows), 4),
        "total": len(rows),
        "done": sum(1 for r in rows if r.get("done")),
        "late": sum(1 for r in rows if any(a["code"] == "RETARD" for a in r.get("alerts", []))),
        "danger": sum(1 for r in rows if any(a["level"] == "danger" for a in r.get("alerts", []))),
    }
