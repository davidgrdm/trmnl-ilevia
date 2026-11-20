# Ilévia pour TRMNL

Plugin TRMNL (écran e-ink) qui affiche les prochains passages du réseau **Ilévia** (Lille) : métro, tram et bus, plus les perturbations sur les lignes suivies.

Configuration par défaut : **métro M1, République Beaux-Arts → CHU Eurasanté**, avec l'heure d'arrivée au CHU (environ 7 min de trajet).

## Ce que le plugin affiche

| Mode | Source | Temps réel ? |
|---|---|---|
| Bus, tram | API « prochains passages » de l'open data MEL | ✅ oui (mise à jour chaque minute côté Ilévia) |
| Métro M1/M2 | GTFS Ilévia → horaires théoriques pré-calculés chaque nuit | ❌ non : Ilévia ne publie **pas** le métro en temps réel en open data |
| Perturbations | Jeu « perturbations » de l'open data MEL (métro compris) | ✅ oui |

> J'ai vérifié les trois flux temps réel d'Ilévia (API prochains passages, GTFS-RT, SIRI). Aucun ne contient le métro en direct. Les rares entrées M1 du flux SIRI sont figées depuis septembre. Pour le métro, qui passe toutes les 1 à 4 min, on affiche donc les 3 prochains passages prévus et les perturbations en cours. Les fréquences et horaires de service sont indiqués dans la page de configuration.

**Rafraîchissement :** TRMNL interroge un plugin au plus toutes les **15 minutes**. L'écran affiche donc des **heures de passage** (« 17h23 ») et non des comptes à rebours (« dans 3 min »), avec l'heure de mise à jour dans la barre du bas.

## Ce que l'utilisateur peut régler (formulaire TRMNL)

- **Station de métro** : l'une des 60 stations M1/M2, ou « Aucune ».
- **Direction** : CHU Eurasanté, 4 Cantons, Saint-Philibert, C.H. Dron, ou toutes.
- **Station d'arrivée** : affiche l'heure d'arrivée estimée.
- **Arrêt de bus/tram** : nom libre, tolérant aux accents et aux tirets. Champ **commune** facultatif pour départager les homonymes.
- **Lignes** : liste de lignes de bus/tram, par exemple `L1, C1, TRAM`. Vide = toutes les lignes de l'arrêt.
- **Directions de bus/tram** : une partie du nom du terminus, par exemple `Faches, Porte des Postes`. Vide = toutes les directions. Si rien ne correspond, l'écran liste les directions disponibles à cet arrêt.

Pour suivre plusieurs trajets, créez plusieurs instances du plugin (une par arrêt), puis combinez-les dans un *mashup*.

L'écran montre toujours les **3 prochains passages** de chaque ligne, en gros caractères. Les 4 formats TRMNL sont gérés : `full`, `half_horizontal`, `half_vertical`, `quadrant`.

## Architecture

```
               chaque nuit (GitHub Actions)
gtfs.zip Ilévia ──► scripts/build_metro.py ──► GitHub Pages : metro/<station>.json
                                                       │
TRMNL (toutes les 15 min) ─► plugin/transform.js ◄─────┤  (Serverless, Node 20)
                                  │                    │
                                  ├── open data MEL : prochains_passages (bus/tram)
                                  └── open data MEL : perturbations
                                  ▼
                       objet `ilevia` ─► gabarits Liquid (full / half / quadrant)
```

- `plugin/` : le plugin TRMNL (`settings.yml`, gabarits `.liquid`, `transform.js`).
- `scripts/build_metro.py` : génère un JSON par station de métro (sans dépendance externe). Il couvre les 3 prochains jours de service et inclut les temps de trajet entre stations.
- `.github/workflows/metro.yml` : régénère et publie ces JSON chaque nuit sur GitHub Pages.
- `dev/` : banc d'essai local (transformation + rendu HTML avec le CSS officiel TRMNL).

## Mise en service

1. **Publier les horaires du métro.** Poussez ce dossier dans un dépôt GitHub public nommé `trmnl-ilevia`. Dans *Settings → Pages → Source*, choisissez **GitHub Actions**, puis lancez le workflow « Horaires métro » (onglet *Actions → Run workflow*). Vérifiez ensuite que `https://<compte>.github.io/trmnl-ilevia/metro/index.json` répond.
2. **Construire le plugin.**
   ```bash
   scripts/package.sh <compte-github>
   ```
   Cela produit `dist/trmnl-ilevia.zip`, avec l'URL GitHub Pages injectée.
3. **Importer dans TRMNL.** Allez dans *Plugins → Private Plugin → Import*, choisissez le zip, réglez la station et les lignes, puis ajoutez le plugin à votre playlist.

Si l'import ne prend pas le fichier `transform.js`, ouvrez l'onglet **Serverless** de l'éditeur de markup, choisissez **Node** et collez-y le contenu de `plugin/transform.js` (avec votre URL à la place de `REPLACE_ME`).

## Développement local

```bash
cd dev && npm install && cd ..
```

```bash
python3 scripts/build_metro.py <dossier_gtfs_dézippé> docs
```

```bash
node dev/run-transform.mjs dev/settings.example.json > dev/data.json
```

```bash
node dev/render.mjs dev/data.json
```

La dernière commande écrit `dev/preview/index.html` (aperçu des 4 formats). `run-transform.mjs` lit les horaires du métro dans `docs/metro/` et interroge l'open data MEL en direct.

## Particularités des données à connaître

- `heure_estimee_depart` (bus/tram) porte un suffixe `Z` mais c'est en réalité l'**heure locale** de Lille. Le code la traite comme telle.
- Les noms d'arrêts de l'API sont en majuscules sans accents (`REPUBLIQUE BEAUX ARTS`), et plusieurs communes partagent le même nom d'arrêt.
- Le bus et le tram ne nomment pas toujours un arrêt pareil : `GARE LILLE FLANDRES` côté bus, `LILLE FLANDRES` côté tram. La recherche ignore donc les mots génériques (gare, station, arrêt…).
- Il n'y a pas d'heure d'arrivée pour le bus et le tram : l'API ne donne que les départs à chaque arrêt, sans identifiant de course pour suivre un véhicule.
- Le jour de service du métro court jusqu'à ~1h du matin : avant 4h, on lit les horaires de la veille.
- Les perturbations ciblent une ligne (`ILEVIA:LineRef::ME1:LOC` pour M1). Les emojis et liens sont retirés, car illisibles en e-ink.

Données : © Ilévia / Métropole Européenne de Lille, open data ([data.gouv.fr](https://www.data.gouv.fr/datasets/ilevia-prochains-passages-bus-et-tramway)).
