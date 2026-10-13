"""Chargement de la configuration : paramètres dans MongoDB, secrets et surcharges dans les variables d'environnement (.env)."""
from __future__ import annotations

import os
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Mini-lecteur .env (évite une dépendance). Ne remplace pas les variables déjà définies."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class Settings:
    def __init__(self, raw: dict[str, Any]):
        self.raw = raw
        self.source: str = os.getenv("DATA_SOURCE", raw.get("source", "jira")).lower()

        j = raw.get("jira", {})
        self.jira_base_url: str = os.getenv("JIRA_BASE_URL", j.get("base_url", "")).rstrip("/")
        self.jira_token: str = os.getenv("JIRA_TOKEN", "")
        verify = os.getenv("JIRA_VERIFY_SSL", j.get("verify_ssl", True))
        if isinstance(verify, str) and verify.lower() in ("false", "0", "no"):
            verify = False
        elif isinstance(verify, str) and verify.lower() in ("true", "1", "yes"):
            verify = True
        self.jira_verify_ssl: bool | str = verify
        self.jira_timeout: float = float(j.get("timeout_s", 30))
        self.filters: dict[str, int] = j.get("filters", {})
        self.fields: dict[str, str] = j.get("fields", {})

        e = raw.get("excel", {})
        self.excel_path: Path = BASE_DIR / os.getenv("EXCEL_PATH", e.get("path", "data/demo.xlsx"))
        self.excel_sheet: str = e.get("sheet", "Charge")

        self.cache_ttl: int = int(raw.get("cache_ttl_s", 120))

        h = raw.get("history", {})
        self.history_enabled: bool = bool(h.get("enabled", True))
        self.history_path: Path = BASE_DIR / os.getenv("HISTORY_PATH", h.get("path", "history/snapshots.db"))
        self.history_refresh_min: int = int(h.get("auto_refresh_min", 60))

        s = raw.get("sprint", {})
        self.sprint_name: str = s.get("name", "")
        self.sprint_start: date | None = _to_date(s.get("date_debut"))
        self.freeze_code: date | None = _to_date(s.get("freeze_code"))
        self.fin_test: date | None = _to_date(s.get("fin_test"))

        self.hours_per_day: float = float(raw.get("hours_per_day", 8))
        self.done_statuses: set[str] = {x.lower() for x in raw.get("done_statuses", [])}
        # Travail livré, en attente de recette ou de merge : une échéance dépassée n'est pas un retard
        self.no_delay_statuses: set[str] = {x.lower() for x in raw.get("no_delay_statuses", ["Ready for QA", "Merge Request"])}
        # Statuts où une tâche doit être estimée : sans estimation initiale ni restante → alerte « Sans estimation »
        self.estimate_required_statuses: set[str] = {
            x.lower() for x in raw.get("estimate_required_statuses", ["En progression", "Ouverte", "Ready to develop"])}
        it = raw.get("issue_types", {})
        self.types_dev = {x.lower() for x in it.get("dev", [])}
        self.types_qa = {x.lower() for x in it.get("qa", [])}
        self.types_bug = {x.lower() for x in it.get("bug", [])}
        self.types_ano = {x.lower() for x in it.get("ano", [])}
        self.raf_dev_types = {x.lower() for x in raw.get("raf_dev_types", [])}
        self.raf_qa_types = {x.lower() for x in raw.get("raf_qa_types", [])}
        self.chantiers: list[dict[str, str]] = raw.get("chantiers", [])
        # FEAT par défaut d'un chantier (clé Jira), pour les tâches et bugs rattachés à aucune FEAT dans Jira
        self.feat_par_chantier: dict[str, str] = {str(k): str(v) for k, v in (raw.get("feat_par_chantier", {}) or {}).items()}

        t = raw.get("tempo", {}) or {}
        self.tempo_enabled: bool = bool(t.get("enabled", False))
        self.tempo_team_id: int | None = int(t["team_id"]) if t.get("team_id") else None
        self.tempo_absence_issues: set[str] = {str(x).upper() for x in t.get("absence_issues", [])}
        sc = t.get("scrum_events", {}) or {}
        self.tempo_scrum_match: list[str] = [str(x).lower() for x in sc.get("match", ["scrum"])]
        self.tempo_scrum_issues: set[str] = {str(x).upper() for x in sc.get("issues", [])}
        pct = sc.get("percent", {}) or {}
        self.tempo_scrum_pct: dict[str, float] = {"lead": float(pct.get("lead", 0)), "team": float(pct.get("team", 0))}
        ro = t.get("roles", {}) or {}
        self.tempo_lead_roles: set[str] = {_norm(x) for x in ro.get("lead_roles", [])}
        self.tempo_lead_people: set[str] = {str(x) for x in ro.get("lead_people", [])}
        self.tempo_team_people: set[str] = {str(x) for x in ro.get("team_people", [])}
        self.tempo_dev_roles: set[str] = {_norm(x) for x in ro.get("dev_roles", ["Développeur", "DevOps"])}
        self.tempo_qa_roles: set[str] = {_norm(x) for x in ro.get("qa_roles", ["Testeur"])}
        self.tempo_dev_people: set[str] = {str(x) for x in ro.get("dev_people", [])}
        self.tempo_qa_people: set[str] = {str(x) for x in ro.get("qa_people", [])}
        # Présence sur le sprint : arrivée (debut) et départ (fin) inclus ; hors période, ni capacité ni saisie attendue
        self.tempo_presences: dict[str, tuple[date | None, date | None]] = {
            str(k): (_to_date((v or {}).get("debut")), _to_date((v or {}).get("fin"))) for k, v in (t.get("presences", {}) or {}).items()
        }
        # Congés hors Tempo : alternants (absents les 2 premiers mercredis du mois) et congés prévus (du … au …, inclus)
        self.tempo_alternants: set[str] = {str(x).strip() for x in (t.get("alternants") or []) if str(x).strip()}
        self.tempo_conges: list[tuple[str, date, date, str]] = [
            (str(c["p"]).strip(), _to_date(c["debut"]), _to_date(c.get("fin") or c["debut"]), str(c.get("motif") or ""))
            for c in (t.get("conges") or []) if (c or {}).get("p") and (c or {}).get("debut")
        ]
        self.tempo_affectations: dict[str, dict[str, float]] = {
            str(k): {str(c): float(v) for c, v in (d or {}).items()} for k, d in (t.get("affectations", {}) or {}).items()
        }


def validate(raw: dict[str, Any]) -> list[dict[str, str]]:
    """Contrôles avant enregistrement depuis la page Paramètres : [{path, msg}], vide si tout va bien."""
    errs: list[dict[str, str]] = []
    err = lambda path, msg: errs.append({"path": path, "msg": msg})  # noqa: E731

    def num(path: str, v: Any, lo: float | None = None, hi: float | None = None, integer: bool = False) -> None:
        if v in (None, ""):
            return
        try:
            x = int(v) if integer else float(v)
        except (TypeError, ValueError):
            return err(path, "nombre attendu")
        if (lo is not None and x < lo) or (hi is not None and x > hi):
            err(path, f"doit être entre {lo:g} et {hi:g}" if hi is not None else f"doit être au moins {lo:g}")

    def day(path: str, v: Any) -> date | None:
        try:
            return _to_date(v)
        except ValueError:
            err(path, "date attendue (AAAA-MM-JJ)")
            return None

    sp = raw.get("sprint") or {}
    if not str(sp.get("name") or "").strip():
        err("sprint.name", "nom du sprint obligatoire")
    d0, d1, d2 = day("sprint.date_debut", sp.get("date_debut")), day("sprint.freeze_code", sp.get("freeze_code")), day("sprint.fin_test", sp.get("fin_test"))
    if d0 and d1 and d1 < d0:
        err("sprint.freeze_code", "le Freeze Code est avant le début du sprint")
    if d1 and d2 and d2 < d1:
        err("sprint.fin_test", "la fin de test est avant le Freeze Code")
    for k in ("tasks", "us", "feat"):
        num(f"jira.filters.{k}", ((raw.get("jira") or {}).get("filters") or {}).get(k), 1, integer=True)
    num("hours_per_day", raw.get("hours_per_day"), 1, 24)
    num("cache_ttl_s", raw.get("cache_ttl_s"), 10)
    num("history.auto_refresh_min", (raw.get("history") or {}).get("auto_refresh_min"), 0)
    for i, c in enumerate(raw.get("chantiers") or []):
        if not str((c or {}).get("match") or "").strip() or not str((c or {}).get("name") or "").strip():
            err(f"chantiers.{i}", f"ligne {i + 1} : motif et nom du chantier obligatoires")
    t = raw.get("tempo") or {}
    num("tempo.team_id", t.get("team_id"), 1, integer=True)
    pct = ((t.get("scrum_events") or {}).get("percent") or {})
    num("tempo.scrum_events.percent.team", pct.get("team"), 0, 100)
    num("tempo.scrum_events.percent.lead", pct.get("lead"), 0, 100)
    for person, chs in (t.get("affectations") or {}).items():
        total = 0.0
        for ch, v in (chs or {}).items():
            try:
                x = float(v)
            except (TypeError, ValueError):
                err(f"tempo.affectations.{person}", f"{person} · {ch} : nombre attendu")
                continue
            if not 0 <= x <= 100:
                err(f"tempo.affectations.{person}", f"{person} · {ch} : part entre 0 et 100 % attendue")
            total += x
        if total > 100.0001:
            err(f"tempo.affectations.{person}", f"{person} : affectation totale de {total:g} %, au-delà de 100 %")
    for person, pr in (t.get("presences") or {}).items():
        a, b = day(f"tempo.presences.{person}", (pr or {}).get("debut")), day(f"tempo.presences.{person}", (pr or {}).get("fin"))
        if a and b and b < a:
            err(f"tempo.presences.{person}", f"{person} : départ avant l'arrivée")
    for i, c in enumerate(t.get("conges") or []):
        c = c or {}
        who = str(c.get("p") or "").strip()
        a, b = day(f"tempo.conges.{i}", c.get("debut")), day(f"tempo.conges.{i}", c.get("fin"))
        if not who or not c.get("debut"):
            err(f"tempo.conges.{i}", f"congé ligne {i + 1} : personne et date de début obligatoires")
        elif a and b and b < a:
            err(f"tempo.conges.{i}", f"{who} : congé qui finit avant de commencer")
    if not errs:
        try:
            Settings(raw)
        except Exception as e:  # dernier filet : la configuration doit se charger
            err("", f"paramètres illisibles : {e}")
    return errs


def _norm(v: Any) -> str:
    """Nom de rôle comparable : minuscules, lettres seules (Tempo écrit « Analyste daffaires »)."""
    return "".join(ch for ch in str(v).lower() if ch.isalnum())


def _to_date(v: Any) -> date | None:
    if v is None or v == "":
        return None
    if isinstance(v, date):
        return v
    return date.fromisoformat(str(v))


@lru_cache
def get_settings() -> Settings:
    """Paramètres en vigueur, lus dans MongoDB. Mis en cache jusqu'au prochain enregistrement depuis la page Paramètres.
    Base injoignable : store.SettingsUnavailable (jamais mise en cache, la lecture suivante réessaie)."""
    from . import store  # import local : store ne dépend pas de config

    _load_dotenv(BASE_DIR / ".env")
    raw, meta = store.load_settings()
    s = Settings(raw)
    s.meta = meta
    return s


def reload_settings() -> Settings:
    get_settings.cache_clear()
    return get_settings()
