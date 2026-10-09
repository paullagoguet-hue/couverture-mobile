#!/usr/bin/env bash
# Construit les PMTiles espagnols d'UNE techno (4g ou 5g), un fichier par opérateur.
#
#   ./build_es.sh 5g
#   BBOX=-3.9,40.3,-3.5,40.6 ./build_es.sh 5g     # essai rapide sur une zone
#
# Étapes : téléchargement (download.py) -> par opérateur et par zone :
#   rasterisation sur la grille source (gdal_rasterize) -> fusion des cellules
#   en polygones (gdal_polygonize) -> tippecanoe -> PMTiles.
# La rasterisation sur la grille d'origine regroupe les millions de petites
# zones en surfaces continues, comme les cartes de l'Arcep pour la France.
#
# Résultat : $TILES_DIR/es/<operateur>-<techno>.pmtiles (+ .stats.json)
#            et $TILES_DIR/es/es-<techno>.download.json (contrôles du téléchargement).
set -euo pipefail
ES_DIR=$(cd "$(dirname "$0")" && pwd)
source "$ES_DIR/../env.sh"

TECHNO=${1:?usage: build_es.sh <4g|5g>}
BBOX=${BBOX:-}
MIN_ZOOM=${MIN_ZOOM:-10}
MAX_ZOOM=${MAX_ZOOM:-12}
KEEP_WORK=${KEEP_WORK:-0}
TIPPECANOE_OPTS=${TIPPECANOE_OPTS:---no-simplification-of-shared-nodes --drop-smallest-as-needed}
OPERATORS=(movistar vodafone orange yoigo)
export GDAL_CACHEMAX=${GDAL_CACHEMAX:-512}

work="$WORK_DIR/es-$TECHNO"
out="$TILES_DIR/es"
rm -rf "$work" && mkdir -p "$work" "$out"
SECONDS=0

# --- 1. Téléchargement.
log "[es-$TECHNO] téléchargement${BBOX:+ (emprise $BBOX)}"
src="$work/src.geojsons"
"$PY" "$ES_DIR/download.py" "$TECHNO" "$src" "$out/es-$TECHNO.download.json" ${BBOX:+--bbox "$BBOX"}
log "[es-$TECHNO] $(wc -l < "$src") zones, $(du -h "$src" | cut -f1) (étape terminée à ${SECONDS} s)"

# --- 2. Zones à rasteriser, calées sur la grille source (pas et décalage mesurés au téléchargement).
regions=$(cd "$ES_DIR" && "$PY" -c '
import json, math, sys
from es_layers import GRID_STEP, REGIONS
stats = json.load(open(sys.argv[1]))
ox, oy = stats["grid"]["offset_x"], stats["grid"]["offset_y"]
step = GRID_STEP
zones = {"essai": tuple(float(v) for v in sys.argv[2].split(","))} if sys.argv[2] else REGIONS
for name, (x0, y0, x1, y1) in zones.items():
    # Bords alignés sur les lignes de la grille : x = (k + ox) * step.
    snap_lo = lambda v, o: (math.floor(v / step - o) + o) * step
    snap_hi = lambda v, o: (math.ceil(v / step - o) + o) * step
    print(name, f"{snap_lo(x0, ox):.9f}", f"{snap_lo(y0, oy):.9f}", f"{snap_hi(x1, ox):.9f}", f"{snap_hi(y1, oy):.9f}", f"{step:.9f}")
' "$out/es-$TECHNO.download.json" "$BBOX")
log "[es-$TECHNO] zones : $(echo "$regions" | cut -d' ' -f1 | xargs)"

# --- 3. Par opérateur (en parallèle) : rasterisation, polygonisation, tuilage.
build_operator() {
  local op=$1 layer="$1-$TECHNO" parts=()
  while read -r name x0 y0 x1 y1 step; do
    local tif="$work/$op-$name.tif" polys="$work/$op-$name.geojsons"
    gdal_rasterize -q -l src -where "$op = 1" -burn 1 -init 0 -ot Byte \
      -te "$x0" "$y0" "$x1" "$y1" -tr "$step" "$step" \
      -co COMPRESS=DEFLATE -co TILED=YES -co BIGTIFF=IF_SAFER "$src" "$tif"
    # -mask : seules les cellules couvertes (valeur 1) deviennent des polygones.
    gdal_polygonize.py -q "$tif" -mask "$tif" -f GeoJSONSeq "$polys" couverture DN
    [ "$KEEP_WORK" = 1 ] || rm -f "$tif"
    parts+=("$polys")
  done <<< "$regions"
  cat "${parts[@]}" > "$work/$op.geojsons"
  rm -f "${parts[@]}"
  log "[$layer] $(wc -l < "$work/$op.geojsons") polygones après fusion (à ${SECONDS} s)"

  # shellcheck disable=SC2086
  tippecanoe -o "$out/$layer.pmtiles" --force --quiet \
    --layer=couverture --exclude-all \
    --minimum-zoom="$MIN_ZOOM" --maximum-zoom="$MAX_ZOOM" \
    --temporary-directory="$work" \
    $TIPPECANOE_OPTS \
    --name="Cobertura móvil teórica — $op $TECHNO" \
    --description="Mapa de servicios de banda ancha, Ministerio para la Transformación Digital" \
    --attribution='© Ministerio para la Transformación Digital y de la Función Pública' \
    "$work/$op.geojsons"
  [ "$KEEP_WORK" = 1 ] || rm -f "$work/$op.geojsons"
  pmtiles verify "$out/$layer.pmtiles" >&2
  "$PY" "$PIPELINE_DIR/tile_stats.py" "$out/$layer.pmtiles" > "$out/$layer.stats.json"
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
log "[es-$TECHNO] terminé en $((SECONDS / 60)) min $((SECONDS % 60)) s"
