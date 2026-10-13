"""PMO Reporting — API + page web « Reporting Tasks »."""
from __future__ import annotations

import logging
import threading
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from urllib.parse import quote
from pathlib import Path

import hmac
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import cadrage, dnf, history, loaders, rapports, reporting, store, tempo
from .config import get_settings, reload_settings, validate
from .jira_client import JiraError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("pmo")

STATIC = Path(__file__).parent / "static"

# Cache mémoire partagé. Quand l'authentification par utilisateur arrivera,
# la clé de cache inclura l'identité de l'utilisateur.
_cache: dict[str, object] = {"rows": None, "at": 0.0, "generated_at": None}
_lock = threading.Lock()
_tempo: dict[str, object] = {"data": None, "at": 0.0, "generated_at": None}
_tempo_lock = threading.Lock()
# Version des paramètres : un enregistrement l'incrémente et les caches se périment sans attendre une lecture en cours
_ver = {"n": 0}
# Images de jours passés pour Tempo : (jour, version des paramètres) → données, quelques jours gardés en mémoire
_tempo_days: dict[tuple[str, int], dict] = {}
_tempo_days_lock = threading.Lock()


def _auto_refresh(stop: threading.Event) -> None:
    """Relecture périodique en arrière-plan : garantit une photo quotidienne même si personne n'ouvre la page.
    Le délai est relu à chaque passage : une modification dans la page Paramètres s'applique sans redémarrer."""
    last = time.monotonic()
    while not stop.wait(30):
        try:
            s = get_settings()
        except store.SettingsUnavailable:  # base injoignable : on attend qu'elle revienne
            continue
        if not s.history_enabled or s.history_refresh_min <= 0 or time.monotonic() - last < s.history_refresh_min * 60:
            continue
        last = time.monotonic()
        try:
            _get_rows(force=True)
        except Exception as e:  # Jira injoignable (VPN coupé…) : on retentera au prochain passage
            log.warning("Relecture automatique impossible : %s", e)


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop = threading.Event()
    threading.Thread(target=_auto_refresh, args=(stop,), daemon=True, name="auto-refresh").start()
    yield
    stop.set()


app = FastAPI(title="PMO Reporting", version="0.1.0", lifespan=lifespan)
# Réponses JSON compressées : /api/reporting-tasks 70 → 5 Ko, /api/tempo 150 → 15 Ko (utile via le VPN)
app.add_middleware(GZipMiddleware, minimum_size=1000)
# Pages et fichiers statiques : le navigateur revérifie à chaque chargement (réponse 304 si rien n'a changé).
# Sans cela, il garde l'ancien JavaScript plusieurs jours après une mise à jour.
NO_CACHE = {"Cache-Control": "no-cache"}


class _Static(StaticFiles):
    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers.update(NO_CACHE)
        return resp


def _page(name: str) -> FileResponse:
    return FileResponse(STATIC / name, headers=NO_CACHE)


app.mount("/static", _Static(directory=STATIC), name="static")


def _get_rows(force: bool = False) -> tuple[list[dict], str]:
    v = _ver["n"]  # lu avant les paramètres : au pire une relecture de trop, jamais des données périmées
    s = get_settings()
    with _lock:
        fresh = (_cache["rows"] is not None and (time.time() - float(_cache["at"])) < s.cache_ttl
                 and _cache.get("ver") == _ver["n"])
        if fresh and not force:
            return _cache["rows"], _cache["generated_at"]  # type: ignore[return-value]
        t0 = time.time()
        ds = loaders.load(s)
        browse = s.jira_base_url
        rows = reporting.build_rows(ds, s, browse)
        _cache.update(rows=rows, at=time.time(), generated_at=datetime.now().isoformat(timespec="seconds"), ver=v)
        try:
            history.save(s, rows)
        except Exception:
            log.exception("Enregistrement de l'historique impossible")
        log.info("Données rechargées depuis %s : %d tâches en %.1fs", ds.source, len(rows), time.time() - t0)
        return rows, _cache["generated_at"]  # type: ignore[return-value]


def _meta(generated_at: str, day: str | None = None) -> dict:
    s = get_settings()
    return {
        # image d'un jour passé : « aujourd'hui » devient ce jour-là pour tous les calculs des pages
        "as_of": day,
        "source": s.source,
        "sprint": s.sprint_name,
        "sprint_start": s.sprint_start.isoformat() if s.sprint_start else None,
        "freeze_code": s.freeze_code.isoformat() if s.freeze_code else None,
        "fin_test": s.fin_test.isoformat() if s.fin_test else None,
        "generated_at": generated_at,
        "cache_ttl_s": s.cache_ttl,
        "jira_base_url": s.jira_base_url,
        "today": day or datetime.now().date().isoformat(),
        "history_enabled": s.history_enabled,
        # Règles de calcul du RAF, affichées dans la légende
        "hours_per_day": s.hours_per_day,
        "raf_dev_types": s.raw.get("raf_dev_types", []),
        "raf_qa_types": s.raw.get("raf_qa_types", []),
    }


@app.exception_handler(JiraError)
async def jira_error(_: Request, exc: JiraError):
    return JSONResponse(status_code=502, content={"error": str(exc)})


@app.exception_handler(store.SettingsUnavailable)
async def settings_unavailable(_: Request, exc: store.SettingsUnavailable):
    return JSONResponse(status_code=503, content={"error": str(exc)})


@app.exception_handler(FileNotFoundError)
async def missing_file(_: Request, exc: FileNotFoundError):
    return JSONResponse(status_code=500, content={"error": str(exc)})


@app.get("/", include_in_schema=False)
def index():
    return _page("index.html")


@app.get("/capa", include_in_schema=False)
def capa_page():
    return _page("capa.html")


@app.get("/recap", include_in_schema=False)
def recap_page():
    """Synthèse du sprint pour les managers : météo, indicateurs clés, chantiers, points d'attention."""
    return _page("recap.html")


@app.get("/temps", include_in_schema=False)
def temps_page():
    return _page("temps.html")


@app.get("/effort", include_in_schema=False)
def effort_page():
    """Pilotage « Effort » : planifié (estimation initiale) vs consommé + reste à faire."""
    return _page("effort.html")


@app.get("/scrum", include_in_schema=False)
def scrum_page():
    """Pilotage « Scrum events » : part des cérémonies face au développement et au test, au fil du sprint."""
    return _page("scrum.html")


@app.get("/cadrage", include_in_schema=False)
def cadrage_page():
    """Pilotage « Cadrage » : analyse de début de sprint (macro-chiffrage, test vs dév, charge vs capacité)."""
    return _page("cadrage.html")


@app.get("/anomalies", include_in_schema=False)
def anomalies_page():
    """Pilotage « Anomalies » : bogues et anomalies de test, nombre, évolution et temps consommé."""
    return _page("anomalies.html")


def _day_rows(day: str) -> tuple[list[dict], str]:
    """Tâches telles que relevées le jour « day » (sprint courant). 404 si ce jour n'a pas de relevé."""
    try:
        date.fromisoformat(day)
    except ValueError:
        raise HTTPException(400, "Date attendue au format AAAA-MM-JJ.")
    snap = history.at(get_settings(), day)
    if not snap:
        raise HTTPException(404, f"Aucun relevé enregistré le {day} pour ce sprint.")
    return snap["rows"], snap["taken_at"]


def _as_of(day: str | None) -> str | None:
    """Jour passé demandé, ou None pour aujourd'hui (données en direct)."""
    return day if day and day != date.today().isoformat() else None


def _rows_for(day: str | None, refresh: bool = False) -> tuple[list[dict], str]:
    """Jour courant (Jira en direct, avec cache) ou image d'un jour passé."""
    return _day_rows(day) if _as_of(day) else _get_rows(force=refresh)  # type: ignore[arg-type]


@app.get("/api/days")
def days_available():
    """Jours du sprint courant dont on peut afficher l'image (un relevé par jour)."""
    s = get_settings()
    _get_rows()  # s'assure que le relevé du jour existe
    return {"sprint": s.sprint_name, "today": date.today().isoformat(), "days": history.days(s)}


@app.get("/api/tempo")
def tempo_capacity(refresh: bool = False, day: str | None = None):
    """Capacité restante (planning Tempo, absences) et temps saisis de l'équipe, confrontés au RAF.
    Avec day=AAAA-MM-JJ : image de ce jour (RAF relevé ce jour-là, temps saisis jusqu'à ce jour)."""
    if _as_of(day):
        rows, taken = _day_rows(day)  # type: ignore[arg-type]
        s, key = get_settings(), (day, _ver["n"])
        with _tempo_days_lock:
            hit = _tempo_days.get(key)
            if refresh or not hit or time.time() - hit["at"] > s.cache_ttl:
                t0 = time.time()
                hit = {"data": tempo.build(s, rows, today=date.fromisoformat(day), as_of=True, force=refresh), "at": time.time(),  # type: ignore[arg-type]
                       "generated_at": datetime.now().isoformat(timespec="seconds")}
                _tempo_days[key] = hit
                for k in sorted(_tempo_days, key=lambda k: _tempo_days[k]["at"])[:-6]:
                    del _tempo_days[k]
                log.info("Tempo au %s relu en %.1fs", day, time.time() - t0)
        return {"meta": {**_meta(taken, day), "tempo_generated_at": hit["generated_at"]}, **hit["data"]}
    v = _ver["n"]
    s = get_settings()
    rows, gen = _get_rows(force=refresh)
    with _tempo_lock:
        # Imputations et RAF lus ensemble : dès que le RAF Jira est relu, Tempo l'est aussi
        fresh = (_tempo["data"] is not None and (time.time() - float(_tempo["at"])) < s.cache_ttl
                 and _tempo.get("rows_gen") == gen and _tempo.get("ver") == _ver["n"])
        if refresh or not fresh:
            _tempo["rows_gen"] = gen
            t0 = time.time()
            _tempo.update(data=tempo.build(s, rows, force=refresh), at=time.time(), generated_at=datetime.now().isoformat(timespec="seconds"), ver=v)
            log.info("Tempo relu en %.1fs", time.time() - t0)
        return {"meta": {**_meta(gen), "tempo_generated_at": _tempo["generated_at"]}, **_tempo["data"]}  # type: ignore[dict-item]


@app.get("/api/scrum-events")
def scrum_events(refresh: bool = False, day: str | None = None):
    """Temps saisi dans Tempo jour par jour (scrum events, développement, test…), pour le rapport Scrum events."""
    tp = tempo_capacity(refresh=refresh, day=day)
    rows, _ = _rows_for(day)
    return {"meta": tp["meta"], **rapports.scrum(get_settings(), tp, rows)}


@app.get("/api/people")
def people_api(day: str | None = None):
    """Liste commune des personnes du pilotage : équipe Tempo et personnes assignées dans Jira, avec un seul
    classement (DEV, QA ou TL / PO) affiché et filtré de la même façon sur toutes les sous-vues."""
    rows, _ = _rows_for(day)
    out: dict[str, dict] = {}
    try:
        for p in tempo_capacity(day=day)["people"]:
            out[p["name"]] = {"name": p["name"], "categorie": p.get("categorie"), "label": p.get("label") or "",
                              "role": p.get("role") or "", "in_team": p.get("in_team", False)}
    except Exception as e:  # Tempo indisponible : les personnes assignées dans Jira, sans classement
        log.warning("Liste des personnes sans Tempo : %s", e)
    for r in rows:
        n = r.get("assignee")
        if n and n not in out:
            out[n] = {"name": n, "categorie": None, "label": "hors équipe Tempo", "role": "", "in_team": False}
    return {"people": sorted(out.values(), key=lambda p: p["name"].lower())}


@app.get("/api/anomalies")
def anomalies_api(refresh: bool = False, day: str | None = None):
    """Bogues et anomalies de test du sprint : état au jour affiché et évolution d'après les relevés quotidiens."""
    s, target = get_settings(), _as_of(day)
    rows, gen = _rows_for(target, refresh)
    today = target or date.today().isoformat()
    hist = [(h["day"], h["rows"]) for h in history.load_all(s) if h["day"] < today] + [(today, rows)]
    return {"meta": _meta(gen, target), **rapports.anomalies(s, rows, hist, today)}


async def _cadrage(request: Request, day: str | None, refresh: bool = False, chantier: str | None = None) -> dict:
    """Analyse de cadrage au jour affiché. Corps JSON : {macro: {FEAT: JH}, test_pct: 30}."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    macro = {}
    for k, v in ((body or {}).get("macro") or {}).items():
        try:
            if v not in (None, ""):
                macro[str(k)] = float(str(v).replace(",", "."))
        except ValueError:
            raise HTTPException(400, f"Macro-chiffrage invalide pour {k} : {v!r}")
    try:
        test_pct = float((body or {}).get("test_pct") or cadrage.DEFAULT_TEST_PCT)
    except (TypeError, ValueError):
        raise HTTPException(400, "Hypothèse de test invalide (pourcentage attendu).")
    if not 1 <= test_pct <= 200:
        raise HTTPException(400, "Hypothèse de test : entre 1 et 200 %.")
    target = _as_of(day)
    rows, gen = await run_in_threadpool(_rows_for, target, refresh)
    meta = _meta(gen, target)
    tp, err = None, None
    try:  # capacité Tempo ; indisponible : les analyses 1 et 2 restent possibles
        tp = await run_in_threadpool(tempo_capacity, refresh=refresh, day=target)
    except Exception as e:  # noqa: BLE001
        err = str(getattr(e, "detail", None) or e)
        log.warning("Cadrage : capacité indisponible (%s)", err)
    a = cadrage.analyse(meta, rows, tp, macro, test_pct, err, chantier or None)
    return {"meta": meta, **a, "messages": cadrage.messages(a)}


@app.post("/api/cadrage")
async def cadrage_api(request: Request, day: str | None = None, refresh: bool = False, chantier: str | None = None):
    """Analyse de début de sprint, mêmes chiffres que le rapport PowerPoint. chantier : limitée à ce chantier."""
    return await _cadrage(request, day, refresh, chantier)


@app.post("/api/cadrage.pptx")
async def cadrage_pptx(request: Request, day: str | None = None, chantier: str | None = None):
    """Rapport « Cadrage du sprint » (PowerPoint) : synthèse, macro-chiffrage, test vs dév, charge vs capacité."""
    a = await _cadrage(request, day, chantier=chantier)
    data = await run_in_threadpool(cadrage.build_pptx, a)
    name = f"BUILD {a['sprint']}_Cadrage{'_' + a['chantier'] if a.get('chantier') else ''}_{date.fromisoformat(a['today']):%d.%m.%Y}.pptx"
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    headers={"Content-Disposition": f"attachment; filename=\"{name.encode('ascii', 'replace').decode()}\"; filename*=UTF-8''{quote(name)}"})


@app.get("/rapport", include_in_schema=False)
def report_page():
    """Rapport de synthèse imprimable (A4) : chaque chantier, ses indicateurs, ses burndowns et ses FEAT."""
    return _page("rapport.html")


@app.get("/parametres", include_in_schema=False)
def settings_page():
    return _page("parametres.html")


def _settings_payload() -> dict:
    s = get_settings()
    st = store.status()
    admin = bool(os.getenv("ADMIN_CODE", "").strip())
    editable = st["storage"] == "mongo" and admin
    reason = None if editable else (
        st["error"] or "MongoDB n'est pas configurée : renseigner MONGO_URI (ou MONGODB_URI) dans .env pour modifier les paramètres ici."
        if st["storage"] != "mongo" else "Aucun code administrateur : renseigner ADMIN_CODE dans .env pour autoriser les modifications.")
    return {"data": store.jsonable(s.raw), "meta": getattr(s, "meta", {}), "storage": st, "editable": editable, "reason": reason}


@app.get("/api/settings")
def get_settings_api():
    """Paramètres de l'outil (sans aucun secret : jeton, adresse Mongo et code restent dans .env)."""
    return _settings_payload()


# Code administrateur : après MAX_FAILS erreurs, l'adresse est bloquée LOCK_S secondes (essais au hasard)
MAX_FAILS, LOCK_S = 5, 300
_fails: dict[str, tuple[int, float]] = {}
_fails_lock = threading.Lock()
# Réglages qui décident où part le jeton Jira : jamais depuis la page (surcharge possible dans .env)
LOCKED_SETTINGS = (("jira", "base_url"), ("jira", "verify_ssl"))


def _check_admin(request: Request, code: str) -> None:
    ip = request.client.host if request.client else "?"
    now = time.time()
    with _fails_lock:
        n, until = _fails.get(ip, (0, 0.0))
        if until > now:
            raise HTTPException(429, f"Trop d'essais de code : réessayer dans {int(until - now) // 60 + 1} min.")
        if hmac.compare_digest(request.headers.get("X-Admin-Code", ""), code):
            _fails.pop(ip, None)
            return
        n += 1
        _fails[ip] = (0, now + LOCK_S) if n >= MAX_FAILS else (n, 0.0)
    log.warning("Code administrateur incorrect depuis %s (%d essai(s))", ip, n)
    raise HTTPException(403, "Code administrateur incorrect.")


@app.put("/api/settings")
async def put_settings_api(request: Request):
    """Enregistre les paramètres. Code administrateur dans l'en-tête X-Admin-Code ; effet immédiat, sans redémarrage."""
    code = os.getenv("ADMIN_CODE", "").strip()
    if store.status()["storage"] != "mongo":
        raise HTTPException(409, "MongoDB n'est pas configurée : les paramètres ne peuvent pas être modifiés depuis l'application.")
    if not code:
        raise HTTPException(403, "Aucun code administrateur n'est défini (ADMIN_CODE dans .env).")
    _check_admin(request, code)
    body = await request.json()
    data, by = body.get("data"), str(body.get("by") or "").strip()[:80] or "anonyme"
    if not isinstance(data, dict):
        raise HTTPException(400, "Paramètres manquants.")
    cur = get_settings().raw
    locked = [f"{a}.{b}" for a, b in LOCKED_SETTINGS
              if (data.get(a) or {}).get(b) != (cur.get(a) or {}).get(b)]
    if locked:
        return JSONResponse(status_code=422, content={"error": "Paramètres invalides.", "errors": [
            {"path": p, "msg": "réglé uniquement sur le serveur, dans .env (JIRA_BASE_URL, JIRA_VERIFY_SSL) : le jeton Jira y est envoyé"} for p in locked]})
    errors = validate(data)
    if errors:
        return JSONResponse(status_code=422, content={"error": "Paramètres invalides.", "errors": errors})
    res = store.save_settings(data, by)
    if res["changes"]:
        reload_settings()
        # données relues avec les nouveaux paramètres (filtres, dates, chantiers, Tempo…) à la prochaine demande
        _ver["n"] += 1
        log.info("Paramètres modifiés par %s : %s", by, ", ".join(c["path"] for c in res["changes"]))
    return {**_settings_payload(), "changes": res["changes"]}


@app.get("/api/settings/history")
def settings_history_api(limit: int = 30):
    return {"history": store.settings_history(min(max(limit, 1), 200))}


@app.get("/api/health")
def health():
    try:
        s = get_settings()
    except store.SettingsUnavailable as e:
        return JSONResponse(status_code=503, content={"status": "degraded", "error": str(e)})
    return {"status": "ok", "source": s.source, "cached": _cache["rows"] is not None, "generated_at": _cache["generated_at"]}


@app.get("/api/reporting-tasks")
def reporting_tasks(refresh: bool = False, day: str | None = None):
    """Tâches du sprint. Avec day=AAAA-MM-JJ : image de ce jour (relevé enregistré ce jour-là)."""
    rows, gen = _rows_for(day, refresh)
    return {"meta": _meta(gen, _as_of(day)), "rows": rows}


@app.get("/api/reporting-tasks.xlsx")
def export_xlsx(request: Request):
    params = dict(request.query_params)
    day = _as_of(params.get("day"))
    rows, gen = _rows_for(day)
    data = reporting.to_xlsx(reporting.filter_rows(rows, params), _meta(gen, day))
    stamp = day.replace("-", "") if day else f"{datetime.now():%Y%m%d_%H%M}"
    name = f"Reporting_Tasks_{get_settings().sprint_name}_{stamp}.xlsx"
    return Response(
        data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.get("/api/daily-new-feat.pptx")
def daily_new_feat(day: str | None = None):
    """Rapport « Daily New FEAT » (PowerPoint) au jour choisi : vue d'ensemble des chantiers, puis par chantier synthèse
    CAPA / RAF / écart sur la semaine, indicateurs et tendances (graphiques), détail par FEAT → US → tâche, bogues et TNR."""
    s, target = get_settings(), _as_of(day)
    rows, gen = _rows_for(target)
    today = date.fromisoformat(target) if target else date.today()
    snaps = {h["day"]: h["rows"] for h in history.load_all(s)}
    # jours ouvrés de la semaine du jour affiché, bornés au sprint (colonnes 05/10 … 09/10 du rapport)
    monday = today - timedelta(today.weekday())
    week = [monday + timedelta(i) for i in range(5)]
    week = [d for d in week if (not s.sprint_start or d >= s.sprint_start) and (not s.fin_test or d <= max(s.fin_test, today))]
    days = []
    for d in week:
        iso = d.isoformat()
        drows = rows if d == today else snaps.get(iso)
        if d > today or drows is None:
            days.append({"day": iso})  # à venir, ou pas de relevé ce jour-là
            continue
        raf: dict[tuple[str, str], float] = {}
        for r in drows:
            sd = history.side_of(r)
            if sd:  # même règle que partout : une tâche finie n'a plus de RAF (reporting.solde_finies)
                raf[(r["chantier"], sd)] = raf.get((r["chantier"], sd), 0.0) + (r.get(f"raf_{sd}") or 0)
        capa: dict[tuple[str, str], float] = {}
        try:  # capacité restante ce jour-là (Tempo, image du jour) ; Tempo indisponible : CAPA « — »
            tp = tempo_capacity(day=None if iso == date.today().isoformat() else iso)
            for c in tp.get("chantiers", []):
                for sd in ("dev", "qa"):
                    capa[(c["chantier"], sd)] = c.get(f"capa_real_{sd}") or 0.0  # capacité restante, même définition que l'outil
        except Exception as e:  # noqa: BLE001
            log.warning("Daily New FEAT : capacité du %s indisponible (%s)", iso, e)
        days.append({"day": iso, "raf": raf, "capa": capa})
    meta = _meta(gen, target)
    # relevés des jours précédents : burndown, flux de tâches et variations depuis la veille
    data = dnf.build(meta, rows, days, today.isoformat(), hist=sorted(snaps.items()))
    name = f"BUILD {s.sprint_name}_D.N.F_{today:%d.%m.%Y}.pptx"
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    headers={"Content-Disposition": f"attachment; filename=\"{name.encode('ascii', 'replace').decode()}\"; filename*=UTF-8''{quote(name)}"})


@app.get("/api/history")
def history_days(request: Request):
    """Évolution jour par jour du sprint courant (indicateurs calculés avec les filtres de l'écran).
    by=chantier : ajoute le RAF DEV / QA de chaque chantier, jour par jour (burndown)."""
    s = get_settings()
    _get_rows()  # s'assure que la photo du jour existe
    params = dict(request.query_params)
    until = _as_of(params.get("day"))  # image d'un jour passé : rien après ce jour
    per_ch = params.get("by") == "chantier"
    days = []
    for h in history.load_all(s):
        if until and h["day"] > until:
            continue
        rows = reporting.filter_rows(h["rows"], params)
        days.append({"day": h["day"], "taken_at": h["taken_at"], **history.totals(rows),
                     **({"by_chantier": history.by_chantier(rows)} if per_ch else {})})
    return {"sprint": s.sprint_name, "days": days}


@app.get("/api/history/sprints")
def history_sprints(request: Request):
    """Un point par sprint enregistré : indicateurs au premier et au dernier jour (mêmes filtres que l'écran)."""
    s = get_settings()
    _get_rows()
    params = dict(request.query_params)
    until = _as_of(params.get("day"))
    bounds = history.sprint_bounds(s)
    if until:  # image d'un jour passé : le sprint courant s'arrête à ce jour
        cur = [h for h in history.load_all(s) if h["day"] <= until]
        bounds = [b for b in bounds if b["sprint"] != s.sprint_name and b["first_day"] <= until] + (
            [{"sprint": s.sprint_name, "first_day": cur[0]["day"], "last_day": cur[-1]["day"], "first": cur[0]["rows"], "last": cur[-1]["rows"]}]
            if cur else [])
    return {
        "current": s.sprint_name,
        "sprints": [
            {"sprint": b["sprint"], "first_day": b["first_day"], "last_day": b["last_day"],
             "start": history.totals(reporting.filter_rows(b["first"], params)),
             "end": history.totals(reporting.filter_rows(b["last"], params))}
            for b in bounds
        ],
    }


@app.get("/api/history/{day}")
def history_day(day: str):
    """Photo des tâches d'un jour donné (même format que /api/reporting-tasks)."""
    snap = history.load(get_settings(), day)
    if not snap:
        raise HTTPException(404, f"Aucune photo enregistrée le {day}")
    return snap


@app.get("/api/check-jira")
def check_jira():
    """Vérifie la connexion Jira (jeton + réseau)."""
    s = get_settings()
    from .jira_client import JiraClient

    c = JiraClient(s.jira_base_url, s.jira_token, s.jira_verify_ssl, s.jira_timeout)
    try:
        me = c.myself()
    finally:
        c.close()
    if not isinstance(me, dict):
        raise HTTPException(502, "Réponse Jira inattendue")
    return {"ok": True, "user": me.get("displayName"), "name": me.get("name")}
