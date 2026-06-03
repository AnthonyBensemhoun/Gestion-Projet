@echo off
REM ============================================================
REM   HELIX - Lancement local sur le reseau AliveDx
REM   Double-cliquer ce fichier sur le PC qui doit heberger l'app.
REM   Les collegues y accedent via http://NOM-DU-PC depuis leur
REM   navigateur (aucune installation cote collegue).
REM ============================================================
setlocal
cd /d "%~dp0"

REM ---- Reglages ----
set "PORT=80"
REM Dossier des donnees HORS OneDrive (la base SQLite ne doit jamais etre synchronisee)
set "HELIX_DATA=C:\helix-data"
set "DATABASE_URL=sqlite:///%HELIX_DATA:\=/%/atelier.db"
REM Reseau interne en HTTP : les cookies "Secure" (HTTPS) sont desactives.
set "COOKIE_SECURE=0"
REM Admin initial : admin / admin  -> mot de passe a changer a la 1re connexion.
set "ADMIN_EMAIL=admin@alivedx.local"
set "ADMIN_PASSWORD=admin"

if not exist "%HELIX_DATA%" mkdir "%HELIX_DATA%"

REM ---- Python + dependances (installation auto la 1re fois) ----
REM Reseaux d'entreprise avec proxy SSL (Zscaler...) : on fait confiance aux
REM serveurs de paquets Python (sinon "CERTIFICATE_VERIFY_FAILED").
set "PIP_TRUST=--trusted-host pypi.org --trusted-host files.pythonhosted.org --trusted-host pypi.python.org"
if not exist ".venv\Scripts\python.exe" (
  echo Premiere utilisation : installation de l'environnement ^(1-2 min^)...
  py -m venv .venv 2>nul || python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install --upgrade pip %PIP_TRUST%
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt %PIP_TRUST%
)

echo.
echo ================================================================
echo   HELIX demarre.
echo   Les collegues ouvrent dans leur navigateur :
echo        http://%COMPUTERNAME%
echo   ^(laisse cette fenetre ouverte tant que l'app doit tourner^)
echo ================================================================
echo.
".venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port %PORT%
echo.
echo L'application s'est arretee. Appuie sur une touche pour fermer.
pause >nul
