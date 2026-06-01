# Atelier — Guide de déploiement

Application web de gestion de projet collaborative. Tes collègues s'y connectent avec un email et un mot de passe que tu leur transmets.

## Ce que tu auras à la fin

- Une URL du type `https://atelier-tonnom.onrender.com`
- Toi : compte administrateur (tout est modifiable)
- Tes collègues : ils modifient uniquement leurs tâches
- Données partagées entre tous
- **Coût : 0 €**

---

## Étape 1 — Tester l'application en local (10 min)

Avant de déployer en ligne, vérifie que tout fonctionne sur ton PC.

1. **Installe Python 3.11+** depuis [python.org](https://www.python.org/downloads/) si ce n'est pas déjà fait. Pendant l'installation, coche **« Add Python to PATH »**.

2. **Ouvre un terminal** dans le dossier où tu as posé les fichiers (Windows : maintiens Shift + clic droit → "Ouvrir PowerShell ici").

3. Installe les dépendances :
   ```bash
   pip install -r requirements.txt
   ```

4. Lance l'app :
   ```bash
   uvicorn main:app --reload
   ```

5. Ouvre [http://localhost:8000](http://localhost:8000) dans ton navigateur.

6. Connecte-toi avec :
   - Email : `admin@atelier.local`
   - Mot de passe : `admin`

Tu peux jouer avec l'app, créer des projets, des tâches, ajouter des personnes. Quand tu es prêt, passe à l'étape 2.

> **Si quelque chose plante au lancement** : copie le message d'erreur, c'est presque toujours une version de Python incompatible ou un module manquant. Réessaie `pip install -r requirements.txt`.

---

## Étape 2 — Créer un compte GitHub (5 min)

GitHub stocke ton code et permet à Render de le déployer.

1. Va sur [github.com](https://github.com) → **Sign up** (si tu n'as pas de compte).
2. Choisis un nom d'utilisateur, un email, un mot de passe.
3. Confirme ton email.

---

## Étape 3 — Publier le code sur GitHub (10 min)

1. Sur GitHub, clique sur **+** (en haut à droite) → **New repository**.
2. Nom du dépôt : `atelier` (ou ce que tu veux).
3. Coche **Private** (recommandé : ton code reste privé).
4. **Ne coche pas** "Add a README".
5. Clique sur **Create repository**.

GitHub affiche maintenant une page avec des commandes. Tu vas y revenir.

**Sur ton PC, dans le terminal, dans le dossier du projet** :

```bash
git init
git add .
git commit -m "Version initiale"
git branch -M main
```

Puis copie les deux lignes que GitHub te montre (section "…or push an existing repository"), elles ressemblent à :

```bash
git remote add origin https://github.com/TON-PSEUDO/atelier.git
git push -u origin main
```

> **Première utilisation de Git ?** Installe Git depuis [git-scm.com](https://git-scm.com/downloads). Quand il te demande tes identifiants au push, utilise ton compte GitHub. Pour le mot de passe, utilise un **token** : sur GitHub, Settings → Developer settings → Personal access tokens → Generate new token (classic) → coche `repo`, copie le token et utilise-le à la place du mot de passe.

Recharge la page GitHub : ton code est en ligne.

---

## Étape 4 — Déployer sur Render (10 min)

1. Va sur [render.com](https://render.com) → **Get Started** → **Sign in with GitHub**.
2. Autorise Render à voir tes dépôts.
3. Sur le tableau de bord Render, clique sur **New +** → **Web Service**.
4. Choisis le dépôt `atelier`.
5. Configure :
   - **Name** : `atelier-tonnom` (ce sera dans l'URL)
   - **Region** : choisis Frankfurt (le plus proche)
   - **Branch** : `main`
   - **Runtime** : Python
   - **Build Command** : `pip install -r requirements.txt`
   - **Start Command** : `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type** : **Free**

6. Clique sur **Advanced** → **Add Environment Variable** et ajoute :
   - `ADMIN_EMAIL` = ton vrai email
   - `ADMIN_PASSWORD` = un mot de passe que toi seul connais (note-le quelque part)

7. **Sans persistance** (plan gratuit) : tes données seront stockées dans la base SQLite locale du serveur, qui **peut être réinitialisée à chaque redéploiement**. Pour des données vraiment persistantes, il faudra plus tard ajouter PostgreSQL gratuit ou passer au plan payant (5-7 €/mois avec disque persistant).

8. Clique sur **Create Web Service**.

Render télécharge ton code, installe Python, lance l'app. Compte 3-5 minutes la première fois. Quand tu vois "Live", clique sur l'URL en haut (`https://atelier-tonnom.onrender.com`).

Connecte-toi avec l'email et le mot de passe que tu as définis à l'étape 6.

---

## Étape 5 — Ajouter tes collègues (2 min)

1. Une fois connecté en admin, va sur l'onglet **Équipe**.
2. Clique **+ Ajouter une personne**.
3. Entre son nom, son email, choisis le rôle **Utilisateur**.
4. Laisse le mot de passe vide → l'app en génère un automatiquement.
5. Note le mot de passe affiché et transmets-le à ton collègue.

Ton collègue ouvre l'URL, se connecte. Il voit tous les projets et toutes les tâches, mais ne peut modifier **que les tâches qui lui sont assignées**.

---

## Particularités du plan gratuit

- **L'app s'endort** après 15 minutes sans visite. Quand quelqu'un revient, le premier chargement prend 30-50 secondes. Les suivants sont instantanés.
- **Données** : par défaut sur le plan gratuit, la base est éphémère. Pour ne rien perdre, on peut soit :
  - passer au plan payant Render (5 €/mois) avec disque persistant
  - ou ajouter une base PostgreSQL gratuite (gratuite 30 jours, 7 €/mois ensuite chez Render)
  - ou héberger ailleurs (Railway, Fly.io ont des options similaires)
- **Pour des sauvegardes**, l'app a un format JSON exportable manuellement (à venir si nécessaire).

---

## Mise à jour du code

Après une modification sur ton PC :

```bash
git add .
git commit -m "Description du changement"
git push
```

Render redéploie automatiquement. Compte 2-3 minutes.

---

## En cas de souci

- **« Application Error » sur Render** : clique sur **Logs** dans le tableau de bord Render. L'erreur Python y apparaît.
- **« Bad gateway »** : l'app est en train de démarrer (réveil après mise en veille). Attends 30 secondes.
- **Mot de passe admin oublié** : sur Render, modifie la variable `ADMIN_PASSWORD` et redémarre le service. ATTENTION : ça ne marche que si la base est encore vide. Sinon, il faut se connecter à la base et modifier le hash.

---

## Fonctionnalités

- Authentification email + mot de passe
- Projets : création, renommage, suppression (admin)
- Tâches : création par tous, modification de ses propres tâches (utilisateur) ou toutes (admin)
- Équipe : gestion des comptes (admin)
- Absences : déclaration par chacun pour soi-même (par admin pour les autres)
- Alertes automatiques : retards, échéances proches, conflit avec absences
- Acquittement individuel ou en masse des alertes
- Relance par email : bouton sur les tâches en retard, ouvre Outlook/Mail avec message pré-rédigé
- Synthèse projet : santé, avancement pondéré par priorité, Gantt visuel
- Export PDF de la synthèse complète avec Gantt
- Import de document (PDF, DOCX, TXT) avec détection automatique des tâches et personnes
- Logo et nom de l'application personnalisables (admin)
