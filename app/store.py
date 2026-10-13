"""Stockage des paramètres et de l'historique quotidien.

- MONGO_URI (ou MONGODB_URI) renseignée dans .env → MongoDB (base MONGO_DB, « pmo_reporting » par défaut) :
    settings          un document « current » : les paramètres de l'outil (seule source, il n'y a plus de config.yaml)
    settings_history  une entrée par modification : qui, quand, quels champs, avant → après
    snapshots         une photo des tâches par jour et par sprint
  Au premier démarrage, l'historique SQLite existant est recopié dans la base.
- Base injoignable : les paramètres sont indisponibles (erreur explicite, nouvel essai toutes les minutes) ;
  l'historique se range en attendant dans la base SQLite locale.
- MONGO_URI=mongomock:// → base en mémoire, pour les tests uniquement.

Les secrets (jeton Jira, adresse Mongo, code administrateur) restent dans .env, jamais en base.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)
_lock = threading.Lock()
_db = None
_state: dict[str, Any] = {"storage": "fichier", "error": None}
# Serveur injoignable : on ne retente qu'après ce délai, sinon chaque lecture attendrait le délai de connexion (3 s)
RETRY_S = 60
_retry_at = 0.0
_migrated = False


# ---------------------------------------------------------------- connexion
def mongo():
    """Base Mongo, ou None quand MONGO_URI n'est pas renseignée ou que le serveur ne répond pas."""
    global _db, _retry_at
    uri = (os.getenv("MONGO_URI") or os.getenv("MONGODB_URI") or "").strip()
    if not uri:
        _state.update(storage="fichier", error=None)
        return None
    if _db is not None:
        return _db
    if time.monotonic() < _retry_at:
        return None
    try:
        if uri.startswith("mongomock://"):
            import mongomock
            client = mongomock.MongoClient()
        else:
            from pymongo import MongoClient
            # Identifiants fournis à part (MONGODB_USERNAME / MONGODB_PASSWORD) quand l'adresse n'en contient pas
            user = (os.getenv("MONGO_USER") or os.getenv("MONGODB_USERNAME") or "").strip()
            pwd = os.getenv("MONGO_PASSWORD") or os.getenv("MONGODB_PASSWORD") or ""
            auth = {"username": user, "password": pwd} if user and "@" not in uri.split("://", 1)[-1].split("/", 1)[0] else {}
            if auth and os.getenv("MONGODB_AUTH_SOURCE"):
                auth["authSource"] = os.getenv("MONGODB_AUTH_SOURCE")
            client = MongoClient(uri, serverSelectionTimeoutMS=3000, **auth)
            client.admin.command("ping")
        db = client[os.getenv("MONGO_DB", "pmo_reporting")]
        # lectures de l'historique : par source et sprint, triées par jour
        db.snapshots.create_index([("source", 1), ("sprint_start", 1), ("day", 1)])
        db.snapshots.create_index([("source", 1), ("sprint", 1), ("day", 1)])
        _db = db
        _state.update(storage="mongo", error=None)
        return _db
    except Exception as e:  # serveur arrêté, adresse fausse… : on retombe sur les fichiers
        _retry_at = time.monotonic() + RETRY_S
        _state.update(storage="fichier", error=f"MongoDB injoignable ({e.__class__.__name__})")
        log.warning("MongoDB injoignable, paramètres indisponibles (nouvel essai dans %d s) : %s", RETRY_S, e)
        return None


def status() -> dict[str, Any]:
    mongo()
    return {"storage": _state["storage"], "error": _state["error"], "db": os.getenv("MONGO_DB", "pmo_reporting") if _state["storage"] == "mongo" else None}


def jsonable(v: Any) -> Any:
    """Dates en texte ISO, pour un stockage identique en YAML, JSON et BSON."""
    if isinstance(v, dict):
        return {str(k): jsonable(x) for k, x in v.items()}
    if isinstance(v, list):
        return [jsonable(x) for x in v]
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


# ---------------------------------------------------------------- paramètres
class SettingsUnavailable(RuntimeError):
    """Paramètres illisibles : MongoDB non configurée, injoignable, ou sans document de paramètres."""


def load_settings() -> tuple[dict[str, Any], dict[str, Any]]:
    """(paramètres, méta) : le document « current » de MongoDB, seule source des paramètres."""
    db = mongo()
    if db is None:
        if not (os.getenv("MONGO_URI") or os.getenv("MONGODB_URI") or "").strip():
            raise SettingsUnavailable("MongoDB n'est pas configurée : renseigner MONGODB_URI dans le fichier .env du serveur.")
        raise SettingsUnavailable(f"{_state['error'] or 'MongoDB injoignable'} : paramètres indisponibles. "
                                  "Vérifier le réseau et, pour Atlas, que l'adresse IP du serveur est autorisée (Network Access). "
                                  "Nouvel essai automatique dans la minute.")
    doc = db.settings.find_one({"_id": "current"})
    if not doc:
        raise SettingsUnavailable(f"Aucun paramètre dans la base {os.getenv('MONGO_DB', 'pmo_reporting')} (document settings « current » absent).")
    return doc["data"], {"updated_at": doc.get("updated_at"), "updated_by": doc.get("updated_by"), "version": doc.get("version"), "origin": "mongo"}


PER_KEY = ("affectations", "presences", "feat_par_chantier")


def _flatten(v: Any, prefix: str = "") -> dict[str, Any]:
    """Chemins « a.b.c » → valeur. Affectations, présences, FEAT par défaut : une entrée par personne
    ou par chantier ; listes gardées entières. L'historique reste lisible."""
    if isinstance(v, dict) and prefix.endswith(PER_KEY):
        return {f"{prefix}.{k}": x for k, x in v.items()}
    if isinstance(v, dict) and v:
        out: dict[str, Any] = {}
        for k, x in v.items():
            out.update(_flatten(x, f"{prefix}.{k}" if prefix else str(k)))
        return out
    return {prefix: v}


def diff(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    a, b = _flatten(before), _flatten(after)
    return [{"path": k, "before": a.get(k), "after": b.get(k)} for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)]


def save_settings(data: dict[str, Any], by: str) -> dict[str, Any]:
    db = mongo()
    if db is None:
        raise RuntimeError("MongoDB n'est pas configurée : les paramètres ne peuvent pas être modifiés depuis l'application.")
    data = jsonable(data)
    with _lock:
        cur = db.settings.find_one({"_id": "current"}) or {"data": {}, "version": 0}
        changes = diff(cur["data"], data)
        now = datetime.now().isoformat(timespec="seconds")
        if changes:
            db.settings.replace_one({"_id": "current"}, {"_id": "current", "data": data, "updated_at": now, "updated_by": by,
                                                         "version": int(cur.get("version") or 0) + 1}, upsert=True)
            db.settings_history.insert_one({"at": now, "by": by, "changes": changes})
    return {"changes": changes, "updated_at": now if changes else cur.get("updated_at")}


def settings_history(limit: int = 30) -> list[dict[str, Any]]:
    db = mongo()
    if db is None:
        return []
    return [{k: v for k, v in h.items() if k != "_id"} for h in db.settings_history.find().sort([("at", -1), ("_id", -1)]).limit(limit)]


# ---------------------------------------------------------------- historique quotidien (photos des tâches)
# Un relevé appartient au sprint identifié par sa date de début (sprint_start), pas par son nom :
# renommer le sprint dans les paramètres ne coupe pas l'historique, et deux sprints qui se chevauchent
# (recette du sprint N pendant le développement du N+1) restent distincts. Le nom ne sert que de libellé.
# Anciens relevés sans date : rattachés par leur nom, puis datés au premier enregistrement du sprint.
SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    source       TEXT NOT NULL,
    sprint       TEXT NOT NULL,
    day          TEXT NOT NULL,
    taken_at     TEXT NOT NULL,
    rows         TEXT NOT NULL,
    sprint_start TEXT,
    PRIMARY KEY (source, sprint, day)
)
"""


def _sqlite(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.execute(SCHEMA)
    if "sprint_start" not in {c[1] for c in con.execute("PRAGMA table_info(snapshots)")}:
        con.execute("ALTER TABLE snapshots ADD COLUMN sprint_start TEXT")  # base créée avant les dates de sprint
    return con


def _migrate_snapshots(db, sqlite_path: Path) -> None:
    """Premier démarrage avec Mongo : on recopie l'historique SQLite existant (vérifié une fois par lancement)."""
    global _migrated
    if _migrated:
        return
    if db.snapshots.find_one({}, {"_id": 1}) or not sqlite_path.exists():
        _migrated = True
        return
    with _sqlite(sqlite_path) as con:
        rows = con.execute("SELECT source, sprint, day, taken_at, rows, sprint_start FROM snapshots").fetchall()
    for src, sprint, day, taken, data, start in rows:
        db.snapshots.replace_one({"_id": f"{src}|{sprint}|{day}"},
                                 {"_id": f"{src}|{sprint}|{day}", "source": src, "sprint": sprint, "sprint_start": start,
                                  "day": day, "taken_at": taken, "rows": json.loads(data)}, upsert=True)
    _migrated = True
    log.info("Historique SQLite recopié dans MongoDB : %d relevés", len(rows))


def _mongo_sprint(sprint: str, start: str | None) -> dict[str, Any]:
    """Relevés du sprint : même date de début, ou sans date et du même nom (anciens relevés)."""
    if not start:
        return {"sprint": sprint}
    return {"$or": [{"sprint_start": start}, {"sprint_start": None, "sprint": sprint}]}


def _sql_sprint(sprint: str, start: str | None) -> tuple[str, list[str]]:
    if not start:
        return "sprint = ?", [sprint]
    return "(sprint_start = ? OR (sprint_start IS NULL AND sprint = ?))", [start, sprint]


def snap_save(sqlite_path: Path, source: str, sprint: str, sprint_start: str | None, day: str, rows: list[dict]) -> None:
    """Relevé du jour pour ce sprint ; remplace celui du même jour, même s'il portait un autre nom de sprint."""
    taken = datetime.now().isoformat(timespec="seconds")
    db = mongo()
    with _lock:
        if db is not None:
            _migrate_snapshots(db, sqlite_path)
            if sprint_start:  # anciens relevés de ce sprint : datés
                db.snapshots.update_many({"source": source, "sprint": sprint, "sprint_start": None}, {"$set": {"sprint_start": sprint_start}})
            db.snapshots.delete_many({"source": source, "day": day, **_mongo_sprint(sprint, sprint_start)})
            db.snapshots.replace_one({"_id": f"{source}|{sprint}|{day}"},
                                     {"_id": f"{source}|{sprint}|{day}", "source": source, "sprint": sprint, "sprint_start": sprint_start,
                                      "day": day, "taken_at": taken, "rows": jsonable(rows)}, upsert=True)
            return
        with _sqlite(sqlite_path) as con:
            if sprint_start:
                con.execute("UPDATE snapshots SET sprint_start = ? WHERE source = ? AND sprint = ? AND sprint_start IS NULL",
                            (sprint_start, source, sprint))
            cond, args = _sql_sprint(sprint, sprint_start)
            con.execute(f"DELETE FROM snapshots WHERE source = ? AND day = ? AND {cond}", [source, day, *args])
            con.execute("INSERT OR REPLACE INTO snapshots (source, sprint, sprint_start, day, taken_at, rows) VALUES (?, ?, ?, ?, ?, ?)",
                        (source, sprint, sprint_start, day, taken, json.dumps(rows, ensure_ascii=False)))


def snap_list(sqlite_path: Path, source: str, sprint: tuple[str, str | None] | None = None, day: str | None = None,
              with_rows: bool = True) -> list[dict]:
    """Photos triées par jour, filtrées par sprint (nom, date de début) et/ou jour."""
    db = mongo()
    if db is not None:
        with _lock:
            _migrate_snapshots(db, sqlite_path)
        q: dict[str, Any] = {"source": source, **(_mongo_sprint(*sprint) if sprint else {})}
        if day is not None:
            q["day"] = day
        proj = None if with_rows else {"rows": 0}
        return [{"sprint_start": None, **{k: v for k, v in d.items() if k != "_id"}}
                for d in db.snapshots.find(q, proj).sort([("day", 1), ("taken_at", 1)])]
    if not sqlite_path.exists():
        return []
    sql, args = "SELECT sprint, sprint_start, day, taken_at, rows FROM snapshots WHERE source = ?", [source]
    if sprint is not None:
        cond, more = _sql_sprint(*sprint)
        sql += f" AND {cond}"; args += more  # noqa: E702
    if day is not None:
        sql += " AND day = ?"; args.append(day)  # noqa: E702
    with _lock, _sqlite(sqlite_path) as con:
        out = con.execute(sql + " ORDER BY day, taken_at", args).fetchall()
    return [{"sprint": sp, "sprint_start": st, "day": d, "taken_at": t, **({"rows": json.loads(r)} if with_rows else {})}
            for sp, st, d, t, r in out]
