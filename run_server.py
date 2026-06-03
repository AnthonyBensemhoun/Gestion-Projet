"""
Lanceur de l'application Atelier en exécutable autonome.

Démarre le serveur web qui héberge l'application. Une fois lancé, les
collègues accèdent à l'app via http://NOM-DU-PC dans leur navigateur.

Ce fichier est le point d'entrée utilisé pour construire atelier.exe
(voir build_exe.bat). Il n'est pas utilisé sur l'hébergement Render.
"""
import socket
import uvicorn

from main import app

# Port web. 80 = URL propre sans numéro (http://nom-du-pc).
# Repli automatique sur 8000 si le port 80 est déjà pris / refusé.
PREFERRED_PORT = 80
FALLBACK_PORT = 8000


def _local_hostname():
    try:
        return socket.gethostname()
    except Exception:
        return "ce-pc"


def _run(port):
    host = _local_hostname()
    suffix = "" if port == 80 else f":{port}"
    print("=" * 60)
    print("  Application ATELIER démarrée")
    print(f"  Vos collègues ouvrent dans leur navigateur :")
    print(f"      http://{host}{suffix}")
    print(f"  (Laissez cette fenêtre ouverte tant que l'app doit tourner)")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    try:
        _run(PREFERRED_PORT)
    except (PermissionError, OSError) as e:
        print(f"[Atelier] Port {PREFERRED_PORT} indisponible ({e}).")
        print(f"[Atelier] Bascule sur le port {FALLBACK_PORT}.")
        _run(FALLBACK_PORT)
