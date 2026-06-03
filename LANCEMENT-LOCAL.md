# Héberger Helix en local sur le réseau AliveDx

Objectif : faire tourner l'application sur **un PC de l'atelier** (qui reste allumé),
et permettre aux collègues d'y accéder via un **lien** dans leur navigateur —
sans rien installer chez eux. Toutes les données restent **chez vous**.

---

## 1. Préparer le PC hôte (une seule fois)

1. **Installer Python 3.11+** depuis https://www.python.org/downloads/
   → pendant l'installation, cocher **« Add Python to PATH »**.
2. **Copier le dossier du projet** sur ce PC, idéalement **hors OneDrive**
   (ex. `C:\Helix\`). OneDrive peut corrompre la base de données ouverte.
3. Lancer **`start-helix.bat`** (double-clic). La 1re fois, il installe
   automatiquement l'environnement (1-2 min), puis démarre l'app.
   - Les données sont stockées dans **`C:\helix-data\atelier.db`** (hors OneDrive).

## 2. Autoriser l'accès réseau (une seule fois, en administrateur)

Ouvrir **PowerShell en administrateur** et coller :

```
netsh advfirewall firewall add rule name="Helix" dir=in action=allow protocol=TCP localport=80
```

(Si tu utilises un autre port que 80, remplace `80`.)

## 3. Le lien pour les collègues

Une fois `start-helix.bat` lancé, la fenêtre affiche l'adresse. Les collègues ouvrent :

```
http://NOM-DU-PC
```

`NOM-DU-PC` = le nom du PC hôte (visible dans la fenêtre, ou *Paramètres → Système →
Informations système → Nom de l'appareil*). Exemple : `http://PC-ATELIER`.

> Astuce : pour une adresse encore plus propre (ex. `http://helix`), demande à
> l'IT un **alias DNS** pointant vers ce PC.

## 4. Première connexion

- Identifiant : **admin@alivedx.local** · mot de passe : **admin**
- L'app **impose de changer le mot de passe** à la première connexion.
- Ensuite, crée les comptes des collègues (section Équipe) et le 1er projet.

## 5. Démarrage automatique (recommandé)

Pour que l'app redémarre toute seule si le PC redémarre :

1. Ouvrir le **Planificateur de tâches** Windows → *Créer une tâche*.
2. **Déclencheur** : « Au démarrage de l'ordinateur ».
3. **Action** : démarrer le programme → `start-helix.bat` (chemin complet).
4. Cocher *« Exécuter même si l'utilisateur n'est pas connecté »*.

---

## Notes importantes

- **D.O.T / QMS** : le bouton « Ouvrir D.O.T / QMS » ouvre Salesforce dans le
  navigateur du collègue (il s'y connecte avec son compte). Pas d'intégration de
  données entre Helix et Salesforce.
- **HTTPS interne** : on tourne en HTTP sur le réseau interne (cookies `Secure`
  désactivés via `COOKIE_SECURE=0`). Si l'IT fournit un certificat interne, on
  pourra passer en HTTPS et réactiver `COOKIE_SECURE=1`.
- **Sauvegarde** : copier régulièrement `C:\helix-data\atelier.db` (ex. tâche
  planifiée vers un partage réseau sauvegardé par l'IT).
- **Mises à jour de l'app** : remplacer les fichiers du projet (ou `git pull`),
  puis relancer `start-helix.bat`. La base `atelier.db` n'est pas touchée.
- **Port 80 occupé ?** Modifier `set "PORT=80"` en `set "PORT=8000"` dans
  `start-helix.bat` ; l'URL devient `http://NOM-DU-PC:8000`.
