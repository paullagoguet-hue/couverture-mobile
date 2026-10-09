#!/usr/bin/env bash
# Construit les PMTiles luxembourgeois (Orange, POST, Proximus × 4G, 5G).
#
#   ./build_lu.sh
#
# Étapes : téléchargement des fichiers de l'ILR (data.public.lu) et de la grille
# de 100 m du cadastre -> raster par opérateur (rasterize_lu.py) -> polygones
# (gdal_polygonize) -> WGS84 -> tippecanoe -> PMTiles + manifest.json.
set -euo pipefail
LU_DIR=$(cd "$(dirname "$0")" && pwd)
source "$LU_DIR/../env.sh"

MIN_ZOOM=${MIN_ZOOM:-8}
MAX_ZOOM=${MAX_ZOOM:-12}
TIPPECANOE_OPTS=${TIPPECANOE_OPTS:---no-simplification-of-shared-nodes --simplify-only-low-zooms --drop-smallest-as-needed}
DATASET=https://data.public.lu/api/1/datasets/57ac7b415145222b525765bb/
GRID=https://download.data.public.lu/resources/bd-l-grid-grilles-de-decoupage-regular-grids/20200805-152650/luref100grid.zip

work="$WORK_DIR/lu"
out="$TILES_DIR/lu"
rm -rf "$work" && mkdir -p "$work" "$out"
SECONDS=0

curl -fsSL --retry 5 -o "$work/grid.zip" "$GRID"
(cd "$work" && 7z x -y -bd grid.zip >/dev/null)
dbf=$(find "$work" -name '*.dbf' -print -quit)
# Adresse du fichier le plus récent de chaque techno, lue dans la fiche du jeu de données.
curl -fsSL --retry 5 "$DATASET" > "$work/dataset.json"

for techno in 4g 5g; do
  url=$(jq -r --arg t "$techno" '[.resources[] | select(.title | test("^" + $t + "-vitesse-maximale"))] | sort_by(.last_modified) | last | .url' "$work/dataset.json")
  [ -n "$url" ] && [ "$url" != null ] || die "fichier $techno introuvable dans le jeu de données"
  log "[lu-$techno] $url"
  curl -fsSL --retry 5 -o "$work/$techno.csv" "$url"
  mkdir -p "$work/$techno"
  "$PY" "$LU_DIR/rasterize_lu.py" "$techno" "$work/$techno.csv" "$dbf" "$work/$techno" "$out/lu-$techno.download.json"
  for tif in "$work/$techno"/*.tif; do
    op=$(basename "$tif" .tif)
    id="$op-$techno"
    gdal_polygonize.py -q "$tif" -mask "$tif" -f GPKG "$work/$id.gpkg" couverture DN
    ogr2ogr -f GeoJSONSeq "$work/$id.geojsons" "$work/$id.gpkg" -t_srs EPSG:4326 -lco COORDINATE_PRECISION=6
    # shellcheck disable=SC2086
    tippecanoe -o "$out/$id.pmtiles" --force --quiet --layer=couverture --exclude-all \
      --minimum-zoom="$MIN_ZOOM" --maximum-zoom="$MAX_ZOOM" --temporary-directory="$work" $TIPPECANOE_OPTS \
      --name="Couverture mobile — $op $techno" --description="ILR, relevé géographique des réseaux" --attribution='© ILR' \
      "$work/$id.geojsons"
    pmtiles verify "$out/$id.pmtiles" >&2
    "$PY" "$PIPELINE_DIR/tile_stats.py" "$out/$id.pmtiles" > "$out/$id.stats.json"
    log "[$id] $(du -h "$out/$id.pmtiles" | cut -f1)"
  done
done

# Manifeste (même format que la France).
"$PY" - "$out" <<'PY'
import json, sys, time
from pathlib import Path
out = Path(sys.argv[1])
labels = {"post": "POST", "orange": "Orange", "proximus": "Proximus"}
layers = []
for techno in ("4g", "5g"):
    dl = json.loads((out / f"lu-{techno}.download.json").read_text())
    period = max(dl["period"])  # « 202602 »
    date = f"{period[:4]}-{period[4:6]}-01"
    for op, label in labels.items():
        p = out / f"{op}-{techno}.pmtiles"
        if not p.exists():
            continue
        zmin, zmax = json.loads((out / f"{op}-{techno}.stats.json").read_text())["zooms"]
        layers.append({
            "id": f"{op}-{techno}", "operator": op, "operator_label": label,
            "techno": techno, "techno_label": techno.upper(), "usage": "data", "has_levels": False,
            "quarter": f"{period[:4]}-{period[4:6]}", "date": date,
            "source": {"file": f"{techno}-vitesse-maximale-carte-couverture", "public_url": "https://data.public.lu/fr/datasets/57ac7b415145222b525765bb/"},
            "tiles": {"file": p.name, "size": p.stat().st_size, "minzoom": zmin, "maxzoom": zmax},
        })
manifest = {
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "country": "lu",
    "latest_quarter": max((l["quarter"] for l in layers), default=""),
    "source": {"producer": "ILR", "dataset": "Cartes de couverture des réseaux de communications électroniques",
               "dataset_url": "https://data.public.lu/fr/datasets/57ac7b415145222b525765bb/", "license": "CC BY 4.0 (ILR) ; grille : CC0 (ACT)"},
    "layers": layers,
}
(out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
print(f"manifest : {len(layers)} couche(s)", file=sys.stderr)
PY
log "[lu] terminé en $((SECONDS / 60)) min $((SECONDS % 60)) s"
