---
name: coherence-ui-tuto-manuel
description: Quand on change une fonctionnalité, mettre à jour UI + visite guidée + manuel pour rester cohérent
metadata:
  type: feedback
---

À chaque changement de fonctionnalité dans l'app atelier (Helix), il faut traquer et corriger les références devenues fausses partout : interface (tuiles/bandeaux/libellés résiduels), **visite guidée** (`TOUR_STEPS` dans static/app.js — étapes pointant des sélecteurs/zones disparus) et **manuel intégré** (sections dans main.py).

**Pourquoi :** le user a constaté des « coquilles » après la suppression des signatures et des phases Approbation/Prêt QMS/Transmis au QMS — ex. tuile « Signatures attendues » encore dans le bandeau QMS, libellés « Workflow & signatures », étapes de tuto montrant des zones inexistantes.

**Comment l'appliquer :** après toute modif de workflow/feature, faire une passe de cohérence : grep des termes supprimés (ex. "signature", "Prêt QMS", "Approbation"), vérifier que chaque `sel:` de `TOUR_STEPS` existe encore, et aligner le manuel. Voir [[workflow-doc-revue-qa-terminale]].
