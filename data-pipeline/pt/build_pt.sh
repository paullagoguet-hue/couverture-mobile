#!/usr/bin/env bash
# Construit les PMTiles portugais d'UNE techno (4g ou 5g), un fichier par opérateur.
#
#   ./build_pt.sh 5g
#   BBOX=-100000,-115000,-75000,-95000 ./build_pt.sh 5g     # essai (Lisbonne, EPSG:3763)
#
# Étapes, par opérateur (en parallèle) : reconstitution du raster à partir des
# images du service (download_pt.py) -> polygones par classe de débit
# (gdal_polygonize) -> WGS84 -> tippecanoe -> PMTiles.
# Attribut gardé dans les tuiles : « classe » (1 = > 0 Mbit/s … 6 = ≥ 1 Gbit/s, cf. pt_layers.py).
#
# Résultat : $TILES_DIR/pt/<operateur>-<techno>.pmtiles (+ .stats.json, .download.json)
set -euo pipefail
PT_DIR=$(cd "$(dirname "$0")" && pwd)
source "$PT_DIR/../env.sh"

TECHNO=${1:?usage: build_pt.sh <4g|5g>}
BBOX=${BBOX:-}
MIN_ZOOM=${MIN_ZOOM:-8}
MAX_ZOOM=${MAX_ZOOM:-12}
KEEP_WORK=${KEEP_WORK:-0}
# --simplify-only-low-zooms : contours exacts au zoom max (classes de débit voisines tous les 100 m).
TIPPECANOE_OPTS=${TIPPECANOE_OPTS:---no-simplification-of-shared-nodes --simplify-only-low-zooms --drop-smallest-as-needed}
OPERATORS=(meo nos vodafone digi)

work="$WORK_DIR/pt-$TECHNO"
out="$TILES_DIR/pt"
rm -rf "$work" && mkdir -p "$work" "$out"
SECONDS=0

build_operator() {
  local op=$1 layer="$1-$TECHNO" dir="$work/$1"
  mkdir -p "$dir"
  (cd "$PT_DIR" && "$PY" download_pt.py "$op" "$TECHNO" "$dir" "$out/$layer.download.json" ${BBOX:+"--bbox=$BBOX"})
  local parts=()
  for tif in "$dir"/*.tif; do
    local name; name=$(basename "$tif" .tif)
    # Une surface par zone de même classe ; -mask : seules les cellules couvertes.
    gdal_polygonize.py -q "$tif" -mask "$tif" -f GPKG "$dir/$name.gpkg" couverture classe
    ogr2ogr -f GeoJSONSeq "$dir/$name.geojsons" "$dir/$name.gpkg" -t_srs EPSG:4326 -lco COORDINATE_PRECISION=6
    parts+=("$dir/$name.geojsons")
  done
  cat "${parts[@]}" > "$dir/all.geojsons"
  log "[$layer] $(wc -l < "$dir/all.geojsons") polygones (à ${SECONDS} s)"

  # shellcheck disable=SC2086
  tippecanoe -o "$out/$layer.pmtiles" --force --quiet \
    --layer=couverture --include=classe \
    --minimum-zoom="$MIN_ZOOM" --maximum-zoom="$MAX_ZOOM" \
    --temporary-directory="$dir" \
    $TIPPECANOE_OPTS \
    --name="Cobertura móvel — $op $TECHNO" \
    --description="GEO.ANACOM, cobertura das redes móveis" \
    --attribution='© ANACOM' \
    "$dir/all.geojsons"
  pmtiles verify "$out/$layer.pmtiles" >&2
  "$PY" "$PIPELINE_DIR/tile_stats.py" "$out/$layer.pmtiles" > "$out/$layer.stats.json"
  [ "$KEEP_WORK" = 1 ] || rm -rf "$dir"
  log "[$layer] terminé : $(du -h "$out/$layer.pmtiles" | cut -f1) (à ${SECONDS} s)"
}

pids=()
for op in "${OPERATORS[@]}"; do
  build_operator "$op" & pids+=($!)
done
status=0
for pid in "${pids[@]}"; do wait "$pid" || status=1; done
[ "$status" = 0 ] || die "au moins un opérateur a échoué"
[ "$KEEP_WORK" = 1 ] || rm -rf "$work"
log "[pt-$TECHNO] terminé en $((SECONDS / 60)) min $((SECONDS % 60)) s"
