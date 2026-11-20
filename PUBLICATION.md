# Publier le plugin comme « recipe » TRMNL

Une recipe est un plugin public : n'importe quel utilisateur TRMNL peut l'installer depuis https://trmnl.com/recipes et choisir sa station, ses lignes et ses directions dans le formulaire. Les installations reçoivent automatiquement tes mises à jour.

## Avant de soumettre

- [ ] Le workflow « Horaires métro » tourne chaque nuit sans erreur (onglet Actions de GitHub). Ton GitHub Pages devient une dépendance pour tous les utilisateurs.
- [ ] Le zip est reconstruit avec la dernière version :
  ```bash
  scripts/package.sh davidgrdm
  ```
- [ ] Le plugin est importé et testé sur ton propre TRMNL, avec un affichage correct en plein écran et dans au moins un mashup.
- [ ] L'onglet **Serverless** contient bien le code de `transform.js` (Node).

## Étapes sur trmnl.com

1. **Préparer une copie « vitrine ».** Garde un plugin privé dédié à la publication, la *Recipe Master*, réglé sur la configuration par défaut (République Beaux-Arts → CHU Eurasanté). Ce sont des données publiques, sans information personnelle. Pour ton usage quotidien, installe ensuite la recipe comme n'importe quel utilisateur, plutôt que de modifier la Master.
2. **Image d'aperçu.** Dans les réglages de la recipe, utilise le bouton *set as preview image* (Featured Image) sur un rendu « full » réussi.
3. **Revue automatique.** Sur la page du plugin, clique sur l'icône à côté de **« Publish plugin? »**, puis sur **« Ask trmy »**. L'agent de revue teste le rendu sur TRMNL OG et TRMNL X, en paysage et en portrait, avec chaque option. Il répond en général en moins d'une heure. Corrige ce qu'il signale ; tu peux me transmettre son retour.
4. **Soumission.** Envoie le plugin en revue (statut *In Review*). L'équipe TRMNL valide manuellement, en visant 2 à 3 jours. Une partie de leur documentation demande aussi un e-mail à team@trmnl.com (texte ci-dessous). Fais-le si l'interface ne le prend pas en charge.

**Alternative rapide :** le statut **Unlisted** donne un lien de partage immédiat, sans modération, mais la recipe n'apparaît pas dans la recherche. C'est pratique pour faire tester par des amis avant la publication publique.

> D'après une page de leur documentation, publier peut nécessiter une licence TRMNL payante : la publication n'est pas disponible pendant un essai gratuit BYOD.

## Texte de soumission (anglais, pour l'équipe TRMNL)

**Objet :** Public plugin submission - Ilévia Lille — métro, tram, bus

> **Plugin ID:** <numéro visible dans l'URL quand tu cliques sur Edit>
>
> **Why public:** Lille (France) has ~1.2M inhabitants in its metro area and the Ilévia network (2 automated metro lines, 2 tram lines, ~70 bus lines) has no TRMNL plugin yet. This recipe lets any Lille user pick a metro station, direction and arrival station, plus a bus/tram stop filtered by line and direction, and see live service disruptions. Everything is configurable from the form; no account or API key is needed.
>
> **Data sources:** official open data from Métropole Européenne de Lille: real-time bus/tram departures and disruptions (data.lillemetropole.fr OGC API), and the Ilévia GTFS for metro schedules. Ilévia does not publish real-time metro data, so metro times are scheduled times, precomputed nightly by a GitHub Action and served from GitHub Pages (source: github.com/davidgrdm/trmnl-ilevia). A Serverless (Node) transform merges the three sources.
>
> **How to test:** install and keep the defaults (République Beaux-Arts → CHU Eurasanté), or try "Gare Lille Flandres" with lines "TRAM" and direction "Tourcoing". No login required.
>
> **Promotion:** I'll share it with Lille TRMNL owners and in the repository README.

## Après la publication

- Chaque modification de la Recipe Master est envoyée automatiquement à tous les utilisateurs. Teste d'abord sur un clone privé, puis reporte les changements dans la Master.
- Les horaires du métro dépendent du workflow GitHub de chaque nuit. Si Ilévia change le format de son GTFS, le workflow échoue et GitHub t'envoie un e-mail. Les horaires déjà publiés couvrent 3 jours, ce qui laisse le temps de corriger.
