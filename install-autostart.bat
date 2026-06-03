@echo off
REM ============================================================
REM   HELIX - Installer le demarrage automatique (tache planifiee)
REM   A LANCER EN ADMINISTRATEUR : clic droit -> "Executer en tant
REM   qu'administrateur". A faire UNE SEULE FOIS sur le PC hote.
REM   L'app demarrera alors au boot et tournera en arriere-plan
REM   (meme deconnecte / sans session ouverte).
REM ============================================================
setlocal

REM Verifie les droits admin
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [ERREUR] Ce script doit etre lance EN ADMINISTRATEUR.
  echo  Clic droit sur install-autostart.bat -^> "Executer en tant qu'administrateur".
  echo.
  pause
  exit /b 1
)

set "TASK=Helix"
set "SCRIPT=%~dp0start-helix.bat"

echo Creation de la tache planifiee "%TASK%" (demarrage au boot, compte SYSTEM)...
schtasks /create /tn "%TASK%" /tr "\"%SCRIPT%\"" /sc onstart /ru SYSTEM /rl HIGHEST /f
if errorlevel 1 (
  echo  [ERREUR] Creation de la tache echouee.
  pause
  exit /b 1
)

echo.
echo  Tache "%TASK%" creee.
echo  -^> Ferme d'abord la fenetre noire Helix en cours (pour liberer le port 80),
echo     puis lance la tache maintenant avec :  schtasks /run /tn "%TASK%"
echo  -^> A chaque demarrage de DCHEYS006, Helix se relancera tout seul.
echo.
echo  Pour ARRETER :   schtasks /end /tn "%TASK%"
echo  Pour SUPPRIMER : schtasks /delete /tn "%TASK%" /f
echo.
pause
