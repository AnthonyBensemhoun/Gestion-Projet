---
name: cycle-en-v-validation
description: Modèle métier du Cycle en V (validation pharma) — phases, chrono projet, modularité
metadata:
  type: project
---

Le Cycle en V est la vue de validation pharma par projet (onglet « Cycle en V »).

**Modèle** : table `VPhase` (1 ligne par phase × projet), champs sur `Project` (`cc_number`, `cra_ref`, `cra_deposit_date`, `vcycle_template`). Gabarit `V_TEMPLATES["complet"]` = vp, urs, sf, sd (branche descendante = specs), fat, sat (bas), iq, oq, pq (branche montante = qualif). Défini dans `V_PHASE_DEFS` (label, branch, slots) dans main.py.

**Règles métier (validées avec le user, pharma AliveDx) :**
- Tout changement = ouverture d'un **CRA** + **Change Control (CC n°)**.
- **Chrono projet** : départ = dépôt du CRA (`cra_deposit_date`) ; fin = approbation du **rapport PQ** (slot doc2 de la phase `V_FINAL_PHASE="pq"`). Si PQ désactivée, on prend la dernière phase activée.
- **Modularité** : chaque phase a un interrupteur `enabled` — on n'active que les phases retenues (ex. capitalisation des SAT → refaire seulement la PQ). C'est au user de moduler.
- Chaque phase de qualif a 2 slots : **Protocole** (doc1, approuvé avant exécution) + **Rapport** (doc2, approuvé après). Les phases de specs n'ont qu'1 slot.
- **Approbation réelle = dans le QMS/D.O.T (externe)** : la date d'appro est saisie à la main, le document lié vient du module Documents (réutilisation, pas de pièce jointe indépendante).

API : `GET/PUT /api/projects/{pid}/vcycle`, `PUT /api/vphases/{vid}`. Front : `renderVCycle`/`drawVCycle` dans static/app.js.

Toute évolution doit respecter [[coherence-ui-tuto-manuel]] (visite guidée `TOUR_STEPS` + manuel `MANUAL_FEATURES`).
