@echo off
cd /d "%~dp0"
if not exist .venv (
  echo Installation de l environnement Python...
  python -m venv .venv
)
rem Dependances a jour a chaque lancement (rapide quand rien n a change)
.venv\Scripts\pip install -q -r requirements.txt
if not exist .env copy .env.example .env
start "" http://localhost:8000
.venv\Scripts\python -m uvicorn app.main:app --port 8000
