# Couverture mobile en France par opérateur

Carte web statique de la couverture mobile théorique (2G, 2G/3G, 3G, 4G, 5G)
d'Orange, SFR, Bouygues Telecom et Free Mobile en France métropolitaine.

> Projet en cours : étape 1 (pipeline de données sur une couche).

## Données

Source : [Arcep, « Mon Réseau Mobile »](https://www.data.gouv.fr/datasets/mon-reseau-mobile),
cartes de couverture théorique, Licence Ouverte 2.0.

- Un GeoPackage (archivé en 7z) par opérateur × techno, en Lambert-93.
- Niveaux de couverture (TBC / BC / CL) pour la 2G, la 2G/3G et la 4G ; aucun
  niveau pour la 3G data et la 5G. L'open data ne distingue pas la 5G 3,5 GHz.
- La 2G de Free Mobile n'est plus publiée par l'Arcep depuis 2024_T4.
- Le rythme de publication varie selon la techno : le pipeline prend le
  trimestre le plus récent **pour chaque couche**, et la date de chaque couche
  est conservée dans `manifest.json`.

## Pipeline (`data-pipeline/`)

| Script | Rôle |
|---|---|
| `build_data.sh` | point d'entrée unique, refait tout |
| `discover.py` | liste le bucket S3 de l'Arcep, choisit les fichiers, écrit le manifeste |
| `build_layer.sh` | une couche : téléchargement → contrôle → reprojection → tippecanoe → PMTiles |
| `inspect_gpkg.py` | vérifie schéma, projection et valeurs du GeoPackage source |
| `tile_stats.py` | taille des tuiles par zoom (calibrage) |
| `install_deps.sh` | GDAL, 7-Zip, tippecanoe et pmtiles (versions épinglées) |

### Lancer sur GitHub Actions (recommandé, rien à installer)

Onglet **Actions** → **Données de couverture** → **Run workflow**. Le champ
« Couches » prend des ids comme `orange-4g` (vide = toutes). Les PMTiles sont
disponibles en artefacts du run, et les statistiques de tuiles dans son résumé.

### Lancer en local (Linux ou WSL2)

```bash
cd data-pipeline
bash install_deps.sh
bash build_data.sh orange-4g    # ou sans argument pour toutes les couches
```

Les tuiles sont écrites dans `data-pipeline/out/tiles/`.
