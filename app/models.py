"""Modèle normalisé, indépendant de la source (Jira ou Excel)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class Task:
    key: str
    type: str                      # issuetype Jira (Développement, Test/Recette Us, ...)
    status: str
    summary: str
    assignee: str = ""
    due: date | None = None
    remaining_h: float | None = None   # Σ Estimation restante (heures)
    spent_h: float | None = None       # Σ Temps consacré (heures)
    original_h: float | None = None    # Σ Estimation originale (heures)
    labels: list[str] = field(default_factory=list)
    sprint: str = ""
    project: str = ""
    updated: date | None = None
    created: date | None = None
    resolved: date | None = None       # date de résolution Jira (anomalies : délai de correction)
    priority: str = ""
    us_key: str = ""               # US mère (via lien ou parent)
    epic_key: str = ""             # FEAT portée par la tâche elle-même (Epic Link d'un bug de régression)
    linked_keys: list[str] = field(default_factory=list)
    link_kinds: dict[str, str] = field(default_factory=dict)  # clé liée → sens du lien vu depuis la tâche (« blocks »…)


@dataclass
class UserStory:
    key: str
    summary: str
    status: str
    labels: list[str] = field(default_factory=list)
    epic_key: str = ""             # FEAT mère (clé ou nom selon la source)
    linked_keys: list[str] = field(default_factory=list)


@dataclass
class Feature:
    key: str
    summary: str
    status: str


@dataclass
class Dataset:
    tasks: list[Task]
    stories: dict[str, UserStory]
    features: dict[str, Feature]
    source: str
