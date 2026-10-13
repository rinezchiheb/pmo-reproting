"""Capacité, temps saisis et temps passé, lus dans Tempo (Jira DC) et confrontés au RAF du reporting.

Capacité prévisionnelle restante d'une personne jusqu'à une échéance, en JH (du jour à l'échéance incluse) :
    heures dues au planning Tempo (week-ends et jours fériés exclus) × disponibilité dans l'équipe
    − absences saisies sur les tâches d'absence
    × (1 − part des scrum events, selon le rôle : TL / PO ou DEV / QA)
    × affectation aux chantiers (config, sinon 100 % réparti au prorata du RAF)

Le 1er jour du sprint est consacré au sprint planning : il ne compte dans aucune capacité (prévue ou réelle).
Il reste un jour dû (la saisie du planning est attendue) ; son temps imputé n'entre pas dans l'imputé de la capacité restante.

Capacité du sprint (capa_sprint) : du 1er jour au jalon, disponible × (1 − scrum events) × affectation.

Capacité restante (capa_real, définition unique de l'outil depuis le 13/10/2026), jour par jour d'aujourd'hui au jalon :
    disponible = planning × disponibilité − absences
    scrum à réserver = max(0, disponible × part des scrum events − scrum déjà imputé ce jour-là)
    capacité du jour = max(0, disponible − tout le temps imputé − scrum à réserver)
    capacité restante = somme des capacités du jour × affectation (les jours passés non saisis n'en font pas partie).
Le scrum déjà imputé est dans « tout le temps imputé » : il n'est donc pas retiré une deuxième fois.

Présence : en dehors de la période d'arrivée / départ d'une personne (config « presences », sinon dates
d'appartenance à l'équipe Tempo), elle n'a ni heures dues, ni capacité, ni saisie manquante.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any

from .config import Settings, _norm
from .jira_client import JiraClient, JiraError

log = logging.getLogger(__name__)

CATEGORIES = ("sprint", "scrum", "absence", "autres")

# Temps saisis : la recherche Tempo dure ~15 ms par saisie (10 s pour un sprint complet). Les saisies des jours
# passés changent rarement : on les garde, et on ne relit que les derniers jours. Une relecture complète a lieu
# au plus tard toutes les heures (saisies tardives, corrections), ou sur « Actualiser ».
RECENT_DAYS = 3
FULL_EVERY_S = 3600
_wl_cache: dict[tuple, dict[str, Any]] = {}
_wl_lock = threading.Lock()


def _worklogs(c: JiraClient, team_id: int, f: str, t: str, force: bool = False) -> list[dict[str, Any]]:
    """Saisies de l'équipe sur [f, t] : anciennes gardées en mémoire, jours récents relus."""
    key = (c.base_url, team_id, f, t)
    cutoff = (date.today() - timedelta(RECENT_DAYS)).isoformat()
    with _wl_lock:
        hit = _wl_cache.get(key)
    if not force and hit and time.time() - hit["full_at"] < FULL_EVERY_S and hit["cutoff"] <= cutoff:
        recent = c.tempo_worklogs(team_id, max(f, hit["cutoff"]), t)
        return hit["past"] + [w for w in recent if (w.get("started") or "")[:10] >= hit["cutoff"]]
    every = c.tempo_worklogs(team_id, f, t)
    with _wl_lock:
        _wl_cache[key] = {"full_at": time.time(), "cutoff": cutoff,
                          "past": [w for w in every if (w.get("started") or "")[:10] < cutoff]}
        for k in [k for k in _wl_cache if k[:2] == key[:2] and k != key]:  # autre fenêtre (sprint précédent…)
            del _wl_cache[k]
    return every


def _iso(v: Any) -> date | None:
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


def _days(start: date, end: date) -> list[date]:
    return [start + timedelta(n) for n in range((end - start).days + 1)]


def _leave_of(name: str, d: date, s: Settings) -> tuple[str, str] | None:
    """Congé hors Tempo de la personne ce jour-là : (« ALTERNANCE » | « CONGE », motif), ou None.
    Alternance : les 2 premiers mercredis du mois, soit tout mercredi du 1er au 14."""
    for who, a, b, motif in s.tempo_conges:
        if who == name and a <= d <= b:
            return "CONGE", motif
    if name in s.tempo_alternants and d.weekday() == 2 and d.day <= 14:
        return "ALTERNANCE", "Alternance (école)"
    return None


def _cap_base(x: dict[str, Any]) -> float:
    """Heures d'un jour qui portent de la capacité : planning × disponibilité − absences ; 0 le jour du sprint planning."""
    return 0.0 if x.get("planning") else max(0.0, x["avail_h"] - x["absence_h"])


def _group(name: str, role: str, s: Settings) -> str:
    if name in s.tempo_lead_people:
        return "lead"
    if name in s.tempo_team_people:
        return "team"
    return "lead" if _norm(role) in s.tempo_lead_roles else "team"


def _profile(name: str, role: str, group: str, dev: float, qa: float, s: Settings) -> tuple[str, str]:
    """DEV, QA ou TL / PO (lead) ; et d'où vient ce classement : config, rôle Tempo, ou déduit du RAF."""
    if name in s.tempo_dev_people:
        return "dev", "config"
    if name in s.tempo_qa_people:
        return "qa", "config"
    if group == "lead" and dev + qa < 0.005:
        return "lead", "role"
    r = _norm(role)
    if r in s.tempo_qa_roles:
        return "qa", "role"
    if r in s.tempo_dev_roles:
        return "dev", "role"
    return ("qa" if qa > dev else "dev"), "raf"


CAT_LABEL = {"dev": "DEV", "qa": "QA", "lead": "TL / PO"}


def categorie(group: str, prof: str) -> tuple[str, str]:
    """Classement unique d'une personne, affiché et filtré de la même façon sur toutes les pages :
    TL / PO (rôle Tempo ou paramètre), sinon DEV ou QA. Un TL / PO qui a du RAF garde sa capacité
    côté DEV ou QA (profile), signalée dans le libellé : « TL / PO · réalise du DEV »."""
    if group == "lead":
        return "lead", "TL / PO" + (f" · réalise du {CAT_LABEL[prof]}" if prof in ("dev", "qa") else "")
    return prof, CAT_LABEL.get(prof, prof)


# Nature d'un scrum event, d'après le commentaire de la saisie Tempo (premier motif trouvé).
# Sans motif reconnu (commentaire par défaut « Working on issue … ») : « autre ».
SCRUM_KINDS = (
    ("daily", ("daily", "stand-up", "standup", "mêlée", "melee")),
    ("planning", ("planning", "planif")),
    ("review", ("review", "démo", "demo")),
    ("retro", ("rétro", "retro")),
    ("affinage", ("affinage", "raffinement", "refinement", "grooming", "backlog")),
)


def scrum_kind(comment: str) -> str:
    c = (comment or "").lower()
    return next((k for k, words in SCRUM_KINDS if any(w in c for w in words)), "autre")


def _category(issue: dict[str, Any], sprint_keys: set[str], s: Settings) -> str:
    key = (issue.get("key") or "").upper()
    if key in s.tempo_absence_issues:
        return "absence"
    summary = (issue.get("summary") or "").lower()
    if key in s.tempo_scrum_issues or any(m in summary for m in s.tempo_scrum_match):
        return "scrum"
    return "sprint" if key in sprint_keys else "autres"


def build(s: Settings, rows: list[dict[str, Any]], today: date | None = None, as_of: bool = False,
          force: bool = False) -> dict[str, Any]:
    """as_of : image d'un jour passé (« today »). Les temps saisis après ce jour sont ignorés, comme s'ils n'existaient pas encore.
    force : relit toutes les saisies du sprint dans Tempo (sinon, seulement les derniers jours)."""
    if s.source != "jira":
        raise JiraError("Tempo n'est disponible qu'avec la source Jira (pas en mode démo Excel).")
    if not s.tempo_enabled or not s.tempo_team_id:
        raise JiraError("Tempo n'est pas configuré : renseigner l'équipe Tempo dans la page Paramètres.")
    today = today or date.today()
    iso_today = today.isoformat()
    start = s.sprint_start or today
    end = max(d for d in (s.fin_test, s.freeze_code, today) if d)
    f, t = start.isoformat(), end.isoformat()
    hpd = s.hours_per_day

    c = JiraClient.shared(s.jira_base_url, s.jira_token, s.jira_verify_ssl, s.jira_timeout)
    with ThreadPoolExecutor(8) as ex:
        # la recherche des saisies (la plus longue) part pendant qu'on lit l'équipe et les plannings
        wl_job = ex.submit(_worklogs, c, s.tempo_team_id, f, t, force)
        try:
            team_name = c.tempo_team(s.tempo_team_id).get("name") or f"Équipe {s.tempo_team_id}"
        except JiraError:
            team_name = f"Équipe {s.tempo_team_id}"
        members = [
            # Comptes désactivés dans Jira (suffixe « [X] ») : partis, ni capacité ni saisie attendue
            m for m in c.tempo_team_members(s.tempo_team_id)
            if m.get("member", {}).get("type") == "USER" and m["member"].get("activeInJira", True)
            and m.get("membership", {}).get("status", "active") == "active"
        ]
        schedules = list(ex.map(lambda m: c.tempo_schedule(m["member"]["name"], f, t), members))
        worklogs = wl_job.result()

    # ---- temps saisis : par personne, jour et catégorie ; détail par tâche pour l'analyse
    sprint_keys = {r["key"].upper() for r in rows} | {(r.get("us_key") or "").upper() for r in rows}
    chantier_of = {r["key"].upper(): r["chantier"] for r in rows} | {(r.get("us_key") or "").upper(): r["chantier"] for r in rows if r.get("us_key")}
    # imputé sur les tâches du sprint, par personne et par chantier, jour en cours compris :
    # le RAF lu dans Jira tient déjà compte des imputations du jour, l'imputé doit faire de même
    real_by_ch: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    logged: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    # détail des imputations : personne → jour → ticket (pour lire les tickets derrière une case du tableau)
    logs: dict[str, dict[str, dict[str, dict[str, Any]]]] = defaultdict(lambda: defaultdict(dict))
    by_issue: dict[str, dict[str, Any]] = {}
    # Burndown : temps imputé chaque jour sur les tâches du sprint, par chantier et par côté (DEV / QA).
    # Le RAF d'un jour passé se reconstitue en ajoutant au RAF actuel ce qui a été imputé depuis.
    side_of = {r["key"].upper(): ("dev" if (r.get("type") or "").lower() in s.raf_dev_types
                                  else "qa" if (r.get("type") or "").lower() in s.raf_qa_types else None) for r in rows}
    burn: dict[tuple[str, str, str], float] = defaultdict(float)
    for w in worklogs:
        day, hours = (w.get("started") or "")[:10], (w.get("timeSpentSeconds") or 0) / 3600
        if as_of and day > iso_today:
            continue
        issue = w.get("issue") or {}
        cat = _category(issue, sprint_keys, s)
        logged[w.get("worker", "")][day][cat] += hours
        lg = logs[w.get("worker", "")][day].setdefault(issue.get("key", "?"), {"key": issue.get("key", "?"), "summary": issue.get("summary", ""), "cat": cat, "h": 0.0})
        lg["h"] += hours
        if cat == "scrum":  # nature de l'event (daily, planning…) d'après le commentaire
            kinds = lg.setdefault("kinds", {})
            kind = scrum_kind(w.get("comment") or "")
            kinds[kind] = kinds.get(kind, 0.0) + hours
        side = side_of.get((issue.get("key") or "").upper())
        if side and f <= day <= iso_today:
            burn[(day, chantier_of.get((issue.get("key") or "").upper(), "?"), side)] += hours / s.hours_per_day
        if cat == "sprint" and day <= iso_today:
            real_by_ch[w.get("worker", "")][chantier_of.get((issue.get("key") or "").upper(), "?")] += hours
        if day <= iso_today:
            k = issue.get("key", "?")
            it = by_issue.setdefault(k, {"key": k, "summary": issue.get("summary", ""), "category": cat, "hours": 0.0, "people": set()})
            it["hours"] += hours
            it["people"].add(w.get("worker", ""))

    # ---- RAF ouvert par personne et par chantier (nom affiché, comme dans le reporting)
    raf: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(lambda: {"dev": 0.0, "qa": 0.0}))
    for r in rows:
        if r.get("assignee") and not r.get("done"):
            raf[r["assignee"]][r["chantier"]]["dev"] += r.get("raf_dev") or 0
            raf[r["assignee"]][r["chantier"]]["qa"] += r.get("raf_qa") or 0

    def affectation(name: str, prof: str) -> tuple[dict[str, float], str]:
        """Part du temps de la personne par chantier (0..1), et d'où elle vient.
        À défaut de paramètre : au prorata de son RAF de profil (DEV pour un DEV, QA pour un QA)."""
        if name in s.tempo_affectations:
            return {ch: v / 100 for ch, v in s.tempo_affectations[name].items()}, "config"
        mine = raf.get(name, {})
        w = {ch: (v[prof] if prof in ("dev", "qa") else 0.0) for ch, v in mine.items()}
        if sum(w.values()) < 0.005:  # rien dans son profil : tout son RAF
            w = {ch: v["dev"] + v["qa"] for ch, v in mine.items()}
        tot = sum(w.values())
        if tot < 0.005:
            return {}, "aucune"
        return {ch: x / tot for ch, x in w.items() if x >= 0.005}, "prorata"

    milestone = {"dev": s.freeze_code, "qa": s.fin_test}

    people: list[dict[str, Any]] = []
    seen: set[str] = set()
    chantiers: dict[str, dict[str, Any]] = defaultdict(lambda: {"capa_dev": 0.0, "capa_qa": 0.0, "people": []})
    for m, sched in zip(members, schedules):
        mem, ship = m["member"], m.get("membership", {})
        name, key = mem.get("displayname") or mem.get("name"), mem.get("key") or mem.get("name")
        role = (ship.get("role") or {}).get("name", "")
        group = _group(name, role, s)
        scrum = s.tempo_scrum_pct[group] / 100
        avail = float(ship.get("availability") or 100) / 100
        req = {d["date"]: (d.get("requiredSeconds") or 0) / 3600 for d in sched.get("days", [])}
        # présence : config, sinon dates d'appartenance à l'équipe Tempo
        join, leave = s.tempo_presences.get(name, (None, None))
        join = join or _iso(ship.get("dateFromANSI") or ship.get("dateFrom"))
        leave = leave or _iso(ship.get("dateToANSI") or ship.get("dateTo"))
        present = lambda iso: (not join or iso >= join.isoformat()) and (not leave or iso <= leave.isoformat())  # noqa: E731
        typ = {d["date"]: d.get("type", "") for d in sched.get("days", [])}
        days = []
        for d in _days(start, end):
            iso, lg = d.isoformat(), logged[key].get(d.isoformat(), {})
            due = req.get(iso, 0.0) if present(iso) else 0.0
            # congé hors Tempo (alternance, congé prévu) : comme un jour non travaillé ; ses heures dues deviennent un congé.
            # Une absence saisie dans Tempo le même jour n'est pas retirée une deuxième fois (disponible déjà à 0).
            off = _leave_of(name, d, s) if due > 0 else None
            leave_h = round(due * avail, 2) if off else 0.0
            if off:
                due = 0.0
            days.append({
                "date": iso, "type": off[0] if off else typ.get(iso, "") if present(iso) else "HORS_PERIODE", "required_h": round(due, 2),
                "avail_h": round(due * avail, 2), "leave_h": leave_h, **({"leave": off[0], "leave_motif": off[1]} if off else {}),
                "logged_h": round(sum(v for k, v in lg.items() if k != "absence"), 2),
                "sprint_h": round(lg.get("sprint", 0.0), 2),
                "scrum_h": round(lg.get("scrum", 0.0), 2),
                "absence_h": round(lg.get("absence", 0.0), 2),
            })
            x = days[-1]
            # 1er jour du sprint : sprint planning, aucune capacité
            if s.sprint_start and d == s.sprint_start:
                x["planning"] = True
            base = _cap_base(x)
            # reste non imputé du jour : disponible − absences − tout ce qui a été imputé
            x["rest_h"] = round(max(0.0, base - x["logged_h"]), 2)
            # scrum à réserver : la part prévue du jour, moins le scrum déjà imputé (qui est déjà dans l'imputé)
            x["scrum_res_h"] = round(min(x["rest_h"], max(0.0, base * scrum - x["scrum_h"])), 2)
            x["capa_h"] = round(x["rest_h"] - x["scrum_res_h"], 2)
            days[-1]["logs"] = sorted(({**v, "h": round(v["h"], 2)} for v in logs[key].get(iso, {}).values()), key=lambda v: -v["h"])
            for v in days[-1]["logs"]:
                if "kinds" in v:
                    v["kinds"] = {k: round(h, 2) for k, h in v["kinds"].items()}
        mine = raf.get(name, {})
        p_dev, p_qa = sum(v["dev"] for v in mine.values()), sum(v["qa"] for v in mine.values())
        prof, prof_src = _profile(name, role, group, p_dev, p_qa, s)
        aff, aff_src = affectation(name, prof)
        aff_total = sum(aff.values()) if aff_src == "config" else 1.0
        until = milestone.get(prof)

        def capa(until: date | None, factor: float = 1.0, net_scrum: bool = True, since: str | None = None) -> float | None:
            """Capacité prévisionnelle en JH sur [since, until] (par défaut : d'aujourd'hui à l'échéance)."""
            if not until:
                return None
            lo, hi = since or iso_today, until.isoformat()
            h = sum(_cap_base(x) for x in days if lo <= x["date"] <= hi)
            return round(h * ((1 - scrum) if net_scrum else 1) * factor / hpd, 4)

        # Réalisé : ce qui a vraiment été imputé sur le sprint, comparé à ce qui était prévu sur la même période
        yesterday = (today - timedelta(1))
        prev_past = capa(yesterday, aff_total, since=f) if yesterday >= start else 0.0
        real_past = sum(real_by_ch[key].values()) / hpd
        rate = real_past / prev_past if prev_past and prev_past >= 0.05 else None
        capa_prev = capa(until, aff_total) if until else None

        # Capacité réelle, sur tout le sprint (1er jour → jalon)
        span = [x for x in days if until and f <= x["date"] <= until.isoformat()]
        brute_h = sum(_cap_base(x) for x in span)
        # imputé compté sur la période de présence, comme le disponible (disponible − imputé = reste)
        imputed_h = sum(x["logged_h"] for x in span if x["type"] != "HORS_PERIODE" and not x.get("planning"))
        rest_h = sum(x["rest_h"] for x in span)
        # Capacité restante (définition unique depuis le 13/10/2026) : d'aujourd'hui au jalon, jour par jour,
        # (disponible − déjà imputé ce jour-là − scrum à réserver) × affectation. Les jours passés non saisis
        # n'en font plus partie (ils restent dans « temps non saisis »).
        ahead = [x for x in span if x["date"] >= iso_today]
        brute_ahead_h = sum(_cap_base(x) for x in ahead)
        rest_ahead_h = sum(x["rest_h"] for x in ahead)
        scrum_res_h = sum(x["scrum_res_h"] for x in ahead)
        real_full = sum(x["capa_h"] for x in ahead) / hpd  # avant affectation

        past = [x for x in days if x["date"] < iso_today]
        due_h = sum(x["required_h"] for x in past)
        done_h = sum(x["logged_h"] + x["absence_h"] for x in past)
        cat, cat_label = categorie(group, prof)
        p = {
            "name": name, "key": key, "in_team": True, "role": role, "group": group, "categorie": cat, "label": cat_label,
            # DEV : capacité jusqu'au Freeze Code, face au RAF DEV ; QA : jusqu'à la fin de test, face au RAF QA
            "profile": prof, "profile_src": prof_src, "milestone": until.isoformat() if until else None,
            "availability": round(avail * 100), "scrum_pct": round(scrum * 100, 1),
            "affectation": {ch: round(v * 100) for ch, v in aff.items()}, "affectation_src": aff_src,
            "raf_dev": round(p_dev, 2), "raf_qa": round(p_qa, 2),
            # avant scrum events et affectation : planning × disponibilité − absences
            "capa_brute": capa(until, net_scrum=False) if until else None,
            "capa": round(capa_prev, 2) if capa_prev is not None else None,
            # sprint complet, du 1er jour au jalon (planning × dispo − absences − scrum × affectation)
            "capa_sprint": round(capa(until, aff_total, since=f), 2) if until else None,
            "prev_past": round(prev_past or 0.0, 2), "real_past": round(real_past, 2),
            "real_by_chantier": {ch: round(h / hpd, 2) for ch, h in real_by_ch[key].items()},
            "rate": round(rate, 4) if rate is not None else None,
            # réalisé sur le sprint (1er jour → jalon) : disponible, imputé, reste non imputé
            "brute_sprint": round(brute_h / hpd, 2) if until else None,
            "imputed": round(imputed_h / hpd, 2) if until else None,
            "imputed_sprint": round(sum(x["sprint_h"] for x in span) / hpd, 2) if until else None,
            "rest": round(rest_h / hpd, 2) if until else None,
            # capacité restante, d'aujourd'hui au jalon : disponible, déjà imputé, scrum events à réserver
            "brute_ahead": round(brute_ahead_h / hpd, 2) if until else None,
            "imputed_ahead": round((brute_ahead_h - rest_ahead_h) / hpd, 2) if until else None,
            "rest_ahead": round(rest_ahead_h / hpd, 2) if until else None,
            "scrum_planned": round(sum(_cap_base(x) * scrum for x in ahead) / hpd, 2) if until else None,
            "scrum_logged": round(sum(x["scrum_h"] for x in ahead) / hpd, 2) if until else None,
            "scrum_reserved": round(scrum_res_h / hpd, 2) if until else None,
            "capa_real_full": round(real_full, 2) if until else None,
            "capa_real": round(real_full * aff_total, 2) if until else None,
            "join": join.isoformat() if join else None, "leave": leave.isoformat() if leave else None,
            # absences à venir : saisies dans Tempo ou congés hors Tempo (le plus grand des deux chaque jour, jamais additionnés)
            "absence_future_jh": round(sum(max(x["absence_h"], x["leave_h"]) for x in days if x["date"] >= iso_today) / hpd, 2),
            "leaves": [{"date": x["date"], "kind": x["leave"], "motif": x["leave_motif"]} for x in days if x.get("leave")],
            "due_h": round(due_h, 2), "logged_h": round(done_h, 2), "missing_h": round(max(0.0, due_h - done_h), 2),
            # temps passé depuis le début du sprint, jour en cours compris
            "time": {cat: round(sum(lg.get(cat, 0.0) for day, lg in logged[key].items() if day <= iso_today), 2) for cat in CATEGORIES},
            "days": days,
        }
        people.append(p)
        seen.add(name)
        # capacité par chantier : celle de la personne × sa part sur le chantier, côté DEV ou côté QA
        if prof in ("dev", "qa") and until:
            full = capa(until) or 0.0
            full_past = (capa(yesterday, since=f) or 0.0) if yesterday >= start else 0.0
            full_sprint = capa(until, since=f) or 0.0
            for ch, share in aff.items():
                cc = chantiers[ch]
                cc[f"capa_{prof}"] += full * share
                for k, v in (("brute", brute_h / hpd), ("imputed", imputed_h / hpd), ("rest", rest_h / hpd), ("real", real_full),
                             ("brute_ahead", brute_ahead_h / hpd), ("rest_ahead", rest_ahead_h / hpd)):
                    cc[f"{k}_sum_{prof}"] = cc.get(f"{k}_sum_{prof}", 0.0) + v * share
                cc[f"capa_sprint_{prof}"] = cc.get(f"capa_sprint_{prof}", 0.0) + full_sprint * share
                cc[f"prev_past_{prof}"] = cc.get(f"prev_past_{prof}", 0.0) + full_past * share
                cc["people"].append({"name": name, "pct": round(share * 100), "src": aff_src, "profile": prof})
            # Charge imputée sur un chantier : tout ce que les personnes du profil y ont imputé (affectées ou non)
            for ch, h in real_by_ch[key].items():
                chantiers[ch].setdefault(f"real_{prof}", []).append({"name": name, "real_past": round(h / hpd, 2)})

    # Personnes avec du RAF hors de l'équipe Tempo : pas de capacité connue
    for name, mine in raf.items():
        dev, qa = sum(v["dev"] for v in mine.values()), sum(v["qa"] for v in mine.values())
        if name not in seen and (dev or qa):
            prof = "qa" if qa > dev else "dev"
            people.append({"name": name, "in_team": False, "group": "team", "categorie": prof, "label": f"{CAT_LABEL[prof]} · hors équipe Tempo",
                           "raf_dev": round(dev, 2), "raf_qa": round(qa, 2),
                           "profile": prof, "profile_src": "raf", "milestone": (milestone[prof].isoformat() if milestone[prof] else None),
                           "capa": None, "affectation": {}})

    # RAF par chantier (toutes personnes, assignées ou non)
    for r in rows:
        if not r.get("done"):
            cc = chantiers[r["chantier"]]
            cc["raf_dev"] = cc.get("raf_dev", 0.0) + (r.get("raf_dev") or 0)
            cc["raf_qa"] = cc.get("raf_qa", 0.0) + (r.get("raf_qa") or 0)
    def real_side(v: dict[str, Any], prof: str) -> dict[str, Any]:
        contribs = sorted(v.get(f"real_{prof}", []), key=lambda x: -x["real_past"])
        real_past = sum(x["real_past"] for x in contribs)
        sprint = v.get(f"capa_sprint_{prof}", 0.0)
        # capacité restante du chantier : somme, pour les personnes affectées, de leur capacité restante × leur part
        return {f"real_{prof}": contribs, f"real_past_{prof}": round(real_past, 2),
                f"capa_real_{prof}": round(v.get(f"real_sum_{prof}", 0.0), 2),
                f"brute_{prof}": round(v.get(f"brute_sum_{prof}", 0.0), 2), f"imputed_{prof}": round(v.get(f"imputed_sum_{prof}", 0.0), 2),
                f"rest_{prof}": round(v.get(f"rest_sum_{prof}", 0.0), 2),
                f"brute_ahead_{prof}": round(v.get(f"brute_ahead_sum_{prof}", 0.0), 2),
                f"imputed_ahead_{prof}": round(v.get(f"brute_ahead_sum_{prof}", 0.0) - v.get(f"rest_ahead_sum_{prof}", 0.0), 2),
                f"capa_sprint_{prof}": round(sprint, 2), f"prev_past_{prof}": round(v.get(f"prev_past_{prof}", 0.0), 2)}

    ch_list = [{"chantier": ch, "raf_dev": round(v.get("raf_dev", 0.0), 2), "raf_qa": round(v.get("raf_qa", 0.0), 2),
                "capa_dev": round(v["capa_dev"], 2), "capa_qa": round(v["capa_qa"], 2),
                **real_side(v, "dev"), **real_side(v, "qa"),
                "people": sorted(v["people"], key=lambda x: -x["pct"])}
               for ch, v in chantiers.items() if ch != "?"]

    names = {p["key"]: p["name"] for p in people if p.get("in_team")}
    issues = sorted(
        ({**it, "hours": round(it["hours"], 2), "people": sorted(names.get(k, k) for k in it["people"])} for it in by_issue.values()),
        key=lambda x: -x["hours"])

    return {
        "team": {"id": s.tempo_team_id, "name": team_name, "members": len(members)},
        "period": {"start": f, "end": t, "today": iso_today},
        "absence_issues": sorted(s.tempo_absence_issues),
        "scrum": {"percent": s.tempo_scrum_pct, "match": s.tempo_scrum_match, "issues": sorted(s.tempo_scrum_issues)},
        "people": people,
        "chantiers": sorted(ch_list, key=lambda x: x["chantier"]),
        "issues": issues,
        "burn": [{"d": d, "ch": ch, "side": sd, "jh": round(v, 3)} for (d, ch, sd), v in sorted(burn.items())],
    }
