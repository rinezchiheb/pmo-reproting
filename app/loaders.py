"""Chargement des données depuis Jira (réel) ou depuis le classeur Excel (démo)."""
from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from typing import Any

from .config import Settings
from .jira_client import JiraClient, JiraError
from .models import Dataset, Feature, Task, UserStory

log = logging.getLogger(__name__)

SPRINT_SCHEMA = "com.pyxis.greenhopper.jira:gh-sprint"
EPIC_LINK_SCHEMA = "com.pyxis.greenhopper.jira:gh-epic-link"


# ---------------------------------------------------------------- utilitaires
def _date(v: Any) -> date | None:
    if not v:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _hours(seconds: Any) -> float | None:
    return None if seconds is None else round(float(seconds) / 3600, 4)


def _first(*vals: Any) -> Any:
    return next((v for v in vals if v is not None), None)


def _sprint_name(value: Any) -> str:
    """Le champ Sprint de Jira DC est une liste de dicts ou de chaînes 'Sprint@..[..,name=XXX,..]'."""
    if not value:
        return ""
    items = value if isinstance(value, list) else [value]
    names = []
    for it in items:
        if isinstance(it, dict):
            names.append(it.get("name", ""))
        else:
            m = re.search(r"name=([^,\]]+)", str(it))
            names.append(m.group(1) if m else str(it))
    # le dernier sprint est le sprint courant
    return names[-1] if names else ""


def _linked(fields: dict[str, Any]) -> list[str]:
    keys = []
    for link in fields.get("issuelinks") or []:
        other = link.get("outwardIssue") or link.get("inwardIssue")
        if other and other.get("key"):
            keys.append(other["key"])
    parent = fields.get("parent")
    if parent and parent.get("key"):
        keys.insert(0, parent["key"])
    return keys


def _link_kinds(fields: dict[str, Any]) -> dict[str, str]:
    """Sens de chaque lien vu depuis le ticket : « blocks », « is blocked by », « relates to »…"""
    out: dict[str, str] = {}
    for link in fields.get("issuelinks") or []:
        t = link.get("type") or {}
        if (link.get("outwardIssue") or {}).get("key"):
            out[link["outwardIssue"]["key"]] = t.get("outward") or t.get("name") or ""
        elif (link.get("inwardIssue") or {}).get("key"):
            out[link["inwardIssue"]["key"]] = t.get("inward") or t.get("name") or ""
    return out


def _resolve_field(client: JiraClient, configured: str, schema: str, names: tuple[str, ...]) -> str | None:
    if configured and configured != "auto":
        return configured
    for f in client.fields():
        custom = (f.get("schema") or {}).get("custom")
        if custom == schema or f.get("name", "").lower() in names:
            return f["id"]
    return None


# ---------------------------------------------------------------- Jira
def load_from_jira(s: Settings, token: str | None = None) -> Dataset:
    client = JiraClient.shared(s.jira_base_url, token or s.jira_token, s.jira_verify_ssl, s.jira_timeout)
    sprint_f = _resolve_field(client, s.fields.get("sprint", "auto"), SPRINT_SCHEMA, ("sprint",))
    epic_f = _resolve_field(
        client, s.fields.get("epic_link", "auto"), EPIC_LINK_SCHEMA, ("epic link", "lien d'epic", "lien de l'epic")
    )

    base = ["summary", "status", "labels", "issuelinks", "assignee", "project"]
    task_fields = base + [
        "issuetype", "duedate", "updated", "created", "resolutiondate", "priority", "parent",
        "aggregatetimeestimate", "aggregatetimespent", "aggregatetimeoriginalestimate",
        "timeestimate", "timespent", "timeoriginalestimate",
    ] + ([sprint_f] if sprint_f else []) + ([epic_f] if epic_f else [])
    us_fields = base + ([epic_f] if epic_f else [])

    f_tasks, f_us, f_feat = s.filters.get("tasks"), s.filters.get("us"), s.filters.get("feat")
    if not f_tasks:
        raise JiraError("Filtre Jira des sous-tâches manquant : le renseigner dans la page Paramètres.")

    # Les trois recherches sont indépendantes : lancées ensemble, la relecture dure autant que la plus longue
    jobs = {"feat": (f_feat, ["summary", "status"]), "us": (f_us, us_fields), "tasks": (f_tasks, task_fields)}
    with ThreadPoolExecutor(3) as ex:
        futures = {k: ex.submit(lambda f, fl: list(client.search(f"filter={f}", fl)), f, fl) for k, (f, fl) in jobs.items() if f}
        found = {k: fu.result() for k, fu in futures.items()}

    features: dict[str, Feature] = {}
    for it in found.get("feat", []):
        fd = it["fields"]
        features[it["key"]] = Feature(it["key"], fd.get("summary", ""), (fd.get("status") or {}).get("name", ""))

    stories: dict[str, UserStory] = {}
    for it in found.get("us", []):
        fd = it["fields"]
        stories[it["key"]] = UserStory(
            key=it["key"],
            summary=fd.get("summary", ""),
            status=(fd.get("status") or {}).get("name", ""),
            labels=fd.get("labels") or [],
            epic_key=(fd.get(epic_f) or "") if epic_f else "",
            linked_keys=_linked(fd),
        )

    # lien sous-tâche -> US (vu depuis l'US, comme "Liens des demandes" dans Excel)
    child_to_us: dict[str, str] = {}
    for us in stories.values():
        for k in us.linked_keys:
            child_to_us.setdefault(k, us.key)

    tasks: list[Task] = []
    for it in found["tasks"]:
        fd = it["fields"]
        links = _linked(fd)
        us_key = child_to_us.get(it["key"]) or next((k for k in links if k in stories), "")
        tasks.append(Task(
            key=it["key"],
            type=(fd.get("issuetype") or {}).get("name", ""),
            status=(fd.get("status") or {}).get("name", ""),
            summary=fd.get("summary", ""),
            assignee=(fd.get("assignee") or {}).get("displayName", ""),
            due=_date(fd.get("duedate")),
            remaining_h=_hours(_first(fd.get("aggregatetimeestimate"), fd.get("timeestimate"))),
            spent_h=_hours(_first(fd.get("aggregatetimespent"), fd.get("timespent"))),
            original_h=_hours(_first(fd.get("aggregatetimeoriginalestimate"), fd.get("timeoriginalestimate"))),
            labels=fd.get("labels") or [],
            sprint=_sprint_name(fd.get(sprint_f)) if sprint_f else "",
            project=(fd.get("project") or {}).get("name", ""),
            updated=_date(fd.get("updated")),
            created=_date(fd.get("created")),
            resolved=_date(fd.get("resolutiondate")),
            priority=(fd.get("priority") or {}).get("name", ""),
            us_key=us_key,
            epic_key=((fd.get(epic_f) or "") if epic_f else "") or next((k for k in links if k in features), ""),
            linked_keys=links,
            link_kinds=_link_kinds(fd),
        ))
    return Dataset(tasks, stories, features, source="jira")


# ---------------------------------------------------------------- Excel (démo)
def load_from_excel(s: Settings) -> Dataset:
    """Lit la feuille 'Charge' (valeurs calculées) d'un classeur TEAM 1."""
    import openpyxl

    if not s.excel_path.exists():
        raise FileNotFoundError(f"Classeur démo introuvable : {s.excel_path}")
    wb = openpyxl.load_workbook(s.excel_path, data_only=True, read_only=True)
    ws = wb[s.excel_sheet]
    rows = ws.iter_rows(values_only=True)
    header = [str(h).strip() if h is not None else "" for h in next(rows)]
    idx = {h: i for i, h in enumerate(header)}

    def g(r: tuple, name: str) -> Any:
        i = idx.get(name)
        v = r[i] if i is not None and i < len(r) else None
        return None if isinstance(v, str) and v.strip() == "" else v

    def num(v: Any) -> float | None:
        return float(v) if isinstance(v, (int, float)) else None

    tasks: list[Task] = []
    stories: dict[str, UserStory] = {}
    features: dict[str, Feature] = {}
    for r in rows:
        key = g(r, "Clé")
        if not key:
            continue
        us_key = g(r, "Récit mère") or ""
        feat = g(r, "FEAT mère") or ""
        if us_key and us_key not in stories:
            stories[us_key] = UserStory(us_key, g(r, "Résumé US") or "", g(r, "Statut US mère") or "", epic_key=feat)
        if feat and feat not in features:
            features[feat] = Feature(feat, feat, g(r, "Statut feat mère") or "")
        labels = [x.strip() for x in str(g(r, "Étiquettes") or "").split(",") if x.strip()]
        tasks.append(Task(
            key=str(key),
            type=g(r, "T") or "",
            status=g(r, "État") or "",
            summary=g(r, "Résumé") or "",
            assignee=g(r, "Personne assignée") or "",
            due=_date(g(r, "Echéance")),
            remaining_h=num(g(r, "Σ Estimation restante")),
            spent_h=num(g(r, "Σ Temps consacré")),
            original_h=num(g(r, "Σ Estimation originale")),
            labels=labels,
            sprint=g(r, "Sprint") or "",
            project=g(r, "Projet") or "",
            updated=_date(g(r, "Mise à jour")),
            us_key=us_key,
        ))
    wb.close()
    return Dataset(tasks, stories, features, source="excel")


def load(s: Settings, token: str | None = None) -> Dataset:
    return load_from_excel(s) if s.source == "excel" else load_from_jira(s, token)
