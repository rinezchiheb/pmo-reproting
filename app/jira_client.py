"""Client minimal pour l'API REST v2 de Jira Data Center.

Le jeton est passé au constructeur : aujourd'hui un PAT (variable JIRA_TOKEN),
demain le jeton OAuth 2.0 de l'utilisateur connecté, sans rien changer d'autre.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Iterator

import httpx

log = logging.getLogger(__name__)


class JiraError(RuntimeError):
    pass


class JiraClient:
    PAGE_SIZE = 200
    # Clients partagés : créer un client HTTP coûte 0,2 à 0,4 s (certificats) et perd les connexions ouvertes
    _shared: dict[tuple, "JiraClient"] = {}
    _shared_lock = threading.Lock()
    # Liste des champs Jira (/rest/api/2/field, ~80 Ko) : elle ne change pas pendant la vie du serveur
    _fields: dict[str, list[dict[str, Any]]] = {}

    @classmethod
    def shared(cls, base_url: str, token: str, verify: bool | str = True, timeout: float = 30) -> "JiraClient":
        """Client réutilisé d'une lecture à l'autre (httpx.Client est sûr entre threads). Ne pas le fermer."""
        key = (base_url, token, verify, timeout)
        with cls._shared_lock:
            if key not in cls._shared:
                cls._shared[key] = cls(base_url, token, verify, timeout)
            return cls._shared[key]

    def __init__(self, base_url: str, token: str, verify: bool | str = True, timeout: float = 30):
        if not base_url:
            raise JiraError("JIRA_BASE_URL non configurée")
        if not token:
            raise JiraError("JIRA_TOKEN manquant (voir .env)")
        self.base_url = base_url.rstrip("/")
        self._http = httpx.Client(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            verify=verify,
            timeout=timeout,
        )

    def close(self) -> None:
        self._http.close()

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        return self._send("GET", path, params=params)

    def _send(self, method: str, path: str, **kw: Any) -> Any:
        try:
            r = self._http.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise JiraError(f"Jira injoignable ({e.__class__.__name__}). VPN / réseau entreprise actif ?") from e
        if r.status_code == 401:
            raise JiraError("Jira a refusé le jeton (401). Jeton expiré ou invalide ?")
        if r.status_code == 403:
            raise JiraError("Accès refusé par Jira (403).")
        if r.status_code >= 400:
            raise JiraError(f"Erreur Jira {r.status_code} sur {path} : {r.text[:300]}")
        return r.json()

    def myself(self) -> dict[str, Any]:
        return self._get("/rest/api/2/myself")

    def fields(self) -> list[dict[str, Any]]:
        if self.base_url not in JiraClient._fields:
            JiraClient._fields[self.base_url] = self._get("/rest/api/2/field")
        return JiraClient._fields[self.base_url]

    def search(self, jql: str, fields: list[str]) -> Iterator[dict[str, Any]]:
        """Toutes les issues d'une JQL, pagination gérée."""
        start = 0
        while True:
            data = self._get(
                "/rest/api/2/search",
                {"jql": jql, "fields": ",".join(fields), "startAt": start, "maxResults": self.PAGE_SIZE},
            )
            issues = data.get("issues", [])
            yield from issues
            start += len(issues)
            if not issues or start >= data.get("total", 0):
                break

    # ---- Tempo (Jira DC) : mêmes jeton et réseau que Jira
    def tempo_team(self, team_id: int) -> dict[str, Any]:
        return self._get(f"/rest/tempo-teams/2/team/{team_id}")

    def tempo_team_members(self, team_id: int) -> list[dict[str, Any]]:
        return self._get(f"/rest/tempo-teams/2/team/{team_id}/member")

    def tempo_schedule(self, username: str, date_from: str, date_to: str) -> dict[str, Any]:
        """Planning d'une personne : heures dues par jour (week-ends et jours fériés à 0)."""
        return self._get("/rest/tempo-core/1/user/schedule", {"user": username, "from": date_from, "to": date_to})

    def tempo_worklogs(self, team_id: int, date_from: str, date_to: str) -> list[dict[str, Any]]:
        """Temps saisis par les membres d'une équipe (recherche en lecture, d'où le POST)."""
        return self._send("POST", "/rest/tempo-timesheets/4/worklogs/search",
                          json={"from": date_from, "to": date_to, "teamId": [team_id]})

    def browse_url(self, key: str) -> str:
        return f"{self.base_url}/browse/{key}"
