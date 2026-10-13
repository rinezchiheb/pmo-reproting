"""Rapports « Scrum events » et « Suivi des anomalies » (Pilotage).

Scrum events — respect de la part réservée aux cérémonies, DEV et QA seulement (paramètre tempo.scrum_events.percent.team, 10 %) :
    temps saisi dans Tempo, jour par jour, réparti en scrum events, développement (tâches DEV, anomalies de test US,
    bogues), test (tâches de recette), autres tâches du sprint (saisies sur l'US), autres sujets et absences.
    Ratio = scrum ÷ temps travaillé (tâches du sprint + scrum + autres sujets, absences exclues), comme le paramètre
    de capacité et la page Temps ; scrum ÷ (dév + test) affiché pour information. La page agrège selon ses filtres :
    le serveur renvoie des faits élémentaires (jour, personne, catégorie, chantier, heures).
    Chantier d'un scrum event : d'après le résumé de la tâche Tempo (« [ETAB_BENEF] PI17 SP3 Scrum Event »),
    même règle que les étiquettes des tâches ; sinon « Transverse ».

Anomalies — bogues (BUG) et anomalies de test US (ANO) du sprint :
    état actuel (Jira), et évolution jour par jour d'après les relevés quotidiens (nombre, ouvertes, closes,
    nouvelles, réouvertes, temps passé, reste à faire), par chantier et par type.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

from . import history
from .config import Settings
from .reporting import chantier_of

TRANSVERSE = "Transverse"
ANO_TYPES = ("BUG", "ANO")


# ---------------------------------------------------------------- scrum events
def _work_cat(r: dict[str, Any] | None) -> str:
    """Catégorie de réalisation d'une saisie sur une tâche du sprint."""
    if r is None:
        return "us"  # saisie sur l'US elle-même (ou une tâche hors du reporting rattachée au sprint)
    if r.get("type_charge") == "BUG":
        return "dev"  # correction d'un bogue : du développement
    return history.side_of(r) or "us"  # relevés anciens sans « side » : déduit du type de charge


def scrum(s: Settings, tp: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_key = {r["key"].upper(): r for r in rows}
    ch_of = {r["key"].upper(): r["chantier"] for r in rows} | {(r.get("us_key") or "").upper(): r["chantier"] for r in rows if r.get("us_key")}
    today = tp["period"]["today"]
    people, facts, kinds = [], [], []
    scrum_ch: dict[str, str] = {}
    for p in tp["people"]:
        # DEV et QA seulement : les TL / PO (rôle Tempo ou paramètre) ne comptent pas, même avec du RAF
        if not p.get("in_team") or p.get("group") == "lead" or p.get("profile") not in ("dev", "qa"):
            continue
        i = len(people)
        people.append({k: p.get(k) for k in ("name", "role", "group", "profile", "categorie", "label", "scrum_pct", "affectation")})
        cell: dict[tuple, float] = defaultdict(float)
        kcell: dict[tuple, float] = defaultdict(float)
        for d in p.get("days", []):
            if d["date"] > today:
                continue
            for lg in d.get("logs", []):
                key = (lg.get("key") or "").upper()
                cat = lg.get("cat")
                if cat == "scrum":
                    ch = scrum_ch.setdefault(key, chantier_of([lg.get("summary") or ""], s) or TRANSVERSE)
                    for kd, h in (lg.get("kinds") or {"autre": lg["h"]}).items():
                        kcell[(d["date"], kd, ch)] += h
                elif cat == "sprint":
                    cat, ch = _work_cat(by_key.get(key)), ch_of.get(key, TRANSVERSE)
                else:
                    ch = ""
                cell[(d["date"], cat, ch)] += lg["h"]
        facts += [[dd, i, c, ch, round(h, 2)] for (dd, c, ch), h in sorted(cell.items()) if h >= 0.005]
        kinds += [[dd, i, k, ch, round(h, 2)] for (dd, k, ch), h in sorted(kcell.items()) if h >= 0.005]
    return {
        "team": tp["team"], "period": tp["period"],
        "target": s.tempo_scrum_pct["team"],
        "scrum_rule": tp["scrum"],
        "people": people,
        # [jour, n° de personne, catégorie, chantier, heures] ; catégories : scrum, dev, qa, us, autres, absence
        "facts": facts,
        # [jour, n° de personne, nature (daily, planning…), chantier, heures] : détail des scrum events
        "kinds": kinds,
        "scrum_issues": [{"key": k, "chantier": ch} for k, ch in sorted(scrum_ch.items())],
    }


# ---------------------------------------------------------------- anomalies
def _is_ano(r: dict[str, Any]) -> bool:
    return r.get("type_charge") in ANO_TYPES


def _day_stats(rows: list[dict[str, Any]], prev: dict[str, dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Indicateurs d'un relevé, par chantier, type et personne assignée ; prev = anomalies du relevé précédent (clé → ligne)."""
    out: dict[tuple[str, str, str], dict[str, float]] = {}
    for r in rows:
        if not _is_ano(r):
            continue
        g = out.setdefault((r["chantier"], r["type_charge"], r.get("assignee") or ""), dict.fromkeys(
            ("total", "open", "done", "new", "closed", "reopened", "spent", "raf", "est"), 0.0))
        g["total"] += 1
        g["done" if r.get("done") else "open"] += 1
        g["spent"] += r.get("spent_hj") or 0
        g["est"] += r.get("estim_hj") or 0
        g["raf"] += 0 if r.get("done") else (r.get("raf_hj") or 0)
        if prev is not None:
            before = prev.get(r["key"])
            if before is None:
                g["new"] += 1
            elif r.get("done") and not before.get("done"):
                g["closed"] += 1
            elif not r.get("done") and before.get("done"):
                g["reopened"] += 1
    return [{"ch": ch, "t": t, "who": who, **{k: round(v, 4) for k, v in g.items()}} for (ch, t, who), g in sorted(out.items())]


def anomalies(s: Settings, rows: list[dict[str, Any]], hist: list[tuple[str, list[dict[str, Any]]]], today: str) -> dict[str, Any]:
    """rows : tâches du jour affiché ; hist : relevés (jour, tâches) du sprint jusqu'à ce jour inclus."""
    series, prev = [], None
    for day, snap in hist:
        series.append({"day": day, "groups": _day_stats(snap, prev)})
        prev = {r["key"]: r for r in snap if _is_ano(r)}
    # référence pour le coût de la non-qualité et la densité : développement et US du sprint, par chantier
    ref: dict[str, dict[str, Any]] = defaultdict(lambda: {"dev_spent": 0.0, "qa_spent": 0.0, "us": set()})
    for r in rows:
        c = ref[r["chantier"]]
        if r.get("type_charge") == "DEV":
            c["dev_spent"] += r.get("spent_hj") or 0
        elif r.get("type_charge") == "QA":
            c["qa_spent"] += r.get("spent_hj") or 0
        if r.get("us_key") and r.get("type_charge") in ("DEV", "QA"):
            c["us"].add(r["us_key"])
    items = []
    for r in rows:
        if not _is_ano(r):
            continue
        first = next((d for d, snap in hist if any(x["key"] == r["key"] for x in snap)), None)
        items.append({k: r.get(k) for k in (
            "key", "url", "type", "type_charge", "summary", "status", "done", "delivered", "assignee", "chantier", "feat",
            "us_key", "us_summary", "linked_us", "spent_hj", "estim_hj", "raf_hj", "created", "resolved", "priority", "alerts")}
            | {"first_seen": first})
    return {
        "today": today,
        "hours_per_day": s.hours_per_day,
        "items": items,
        "series": series,
        "ref": {ch: {"dev_spent": round(v["dev_spent"], 4), "qa_spent": round(v["qa_spent"], 4), "us": len(v["us"])} for ch, v in ref.items()},
    }
