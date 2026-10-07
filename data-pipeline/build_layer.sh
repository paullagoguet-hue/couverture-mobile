#!/usr/bin/env bash
# Construit le fichier PMTiles d'UNE couche (opérateur × techno).
#
#   ./build_layer.sh orange-4g
#
# Prérequis : le manifeste produit par discover.py ($MANIFEST).
# Étapes : téléchargement -> extraction -> contrôle du GeoPackage ->
#          reprojection EPSG:4326 (GeoJSONSeq) -> tippecanoe -> PMTiles.
#
# Réglages (variables d'environnement) :
#   MIN_ZOOM / MAX_ZOOM   plage de zoom des tuiles (défaut 4 / 12 ; MapLibre
#                         sur-zoome au-delà du zoom max)
#   TIPPECANOE_EXTRA      options supplémentaires passées à tippecanoe
#   KEEP_RAW=0            supprime l'archive téléchargée après usage
#   KEEP_WORK=1           conserve les fichiers intermédiaires (debug)
set -euo pipefail
source "$(dirname "$0")/env.sh"

LAYER=${1:?usage: build_layer.sh <layer_id>}
MIN_ZOOM=${MIN_ZOOM:-4}
MAX_ZOOM=${MAX_ZOOM:-12}
KEEP_RAW=${KEEP_RAW:-1}
KEEP_WORK=${KEEP_WORK:-0}

[ -f "$MANIFEST" ] || die "manifeste introuvable ($MANIFEST), lancer discover.py"
layer_json=$(jq -c --arg id "$LAYER" '.layers[] | select(.id == $id)' "$MANIFEST")
[ -n "$layer_json" ] || die "couche $LAYER absente de $MANIFEST"
field() { jq -r "$1" <<<"$layer_json"; }

src_file=$(field .source.file)
src_url=$(field .source.url)
src_size=$(field .source.size)
label="$(field .operator_label) — $(field .techno_label)"

layer_work="$WORK_DIR/$LAYER"
archive="$WORK_DIR/raw/$src_file"
mkdir -p "$WORK_DIR/raw" "$TILES_DIR"
rm -rf "$layer_work" && mkdir -p "$layer_work"
SECONDS=0

# --- 1. Téléchargement (reprise possible) + contrôle de la taille annoncée par S3.
if [ -f "$archive" ] && [ "$(stat -c%s "$archive")" = "$src_size" ]; then
  log "[$LAYER] archive déjà présente : $src_file"
else
  log "[$LAYER] téléchargement de $src_file ($((src_size / 1000000)) Mo)"
  curl -fL --retry 5 --retry-delay 15 --retry-all-errors -C - -sS -o "$archive" "$src_url"
fi
[ "$(stat -c%s "$archive")" = "$src_size" ] || die "taille inattendue pour $archive"

# --- 2. Extraction de l'archive 7z.
log "[$LAYER] extraction"
7z x -y -bd -o"$layer_work" "$archive" >/dev/null
gpkg=$(find "$layer_work" -name '*.gpkg' -print -quit)
[ -n "$gpkg" ] || die "aucun .gpkg dans $src_file"
[ "$KEEP_RAW" = 1 ] || rm -f "$archive"

# --- 3. Contrôle du contenu (schéma, projection, valeurs) ; échoue si inattendu.
log "[$LAYER] contrôle du GeoPackage"
"$PY" "$PIPELINE_DIR/inspect_gpkg.py" "$gpkg" "$MANIFEST" "$LAYER" > "$TILES_DIR/$LAYER.source.json"
table=$(jq -r .table "$TILES_DIR/$LAYER.source.json")
geom_col=$(jq -r .geometry_column "$TILES_DIR/$LAYER.source.json")
log "[$LAYER] $(jq -c .features_by_level "$TILES_DIR/$LAYER.source.json")"

# --- 4. Reprojection en WGS84 + nettoyage.
#  - Lambert-93 forcé : le fichier le déclare via un SRS « maison » (id 100000).
#  - On ne garde que `niveau` (vide -> NULL pour les couches sans niveau).
#  - -makevalid répare les géométries invalides éventuelles.
#  - -explodecollections découpe les multipolygones départementaux (jusqu'à
#    ~9 Mo pièce) en polygones simples, beaucoup plus efficaces pour tippecanoe.
#  - 6 décimales ≈ 10 cm, largement sous la précision de la donnée.
log "[$LAYER] reprojection EPSG:2154 -> EPSG:4326"
geojsons="$layer_work/$LAYER.geojsons"
ogr2ogr -f GeoJSONSeq "$geojsons" "$gpkg" \
  -sql "SELECT \"$geom_col\", NULLIF(niveau, '') AS niveau FROM \"$table\"" \
  -s_srs EPSG:2154 -t_srs EPSG:4326 \
  -makevalid -explodecollections \
  -lco COORDINATE_PRECISION=6
[ "$KEEP_WORK" = 1 ] || rm -f "$gpkg"
log "[$LAYER] $(wc -l < "$geojsons") polygones, $(du -h "$geojsons" | cut -f1)"

# --- 5. Tuilage vectoriel.
#  - une seule couche « couverture » par fichier : le front utilise le même
#    style pour tous les fichiers ;
#  - --no-simplification-of-shared-nodes : les niveaux TBC/BC/CL et les
#    départements sont des polygones jointifs ; on garde leurs frontières
#    communes identiques pour éviter trous et chevauchements aux bas zooms ;
#  - --drop-smallest-as-needed : si une tuile dépasse 500 Ko, on sacrifie
#    les plus petits îlots plutôt que de déformer les grandes zones.
log "[$LAYER] tippecanoe z$MIN_ZOOM-z$MAX_ZOOM"
# shellcheck disable=SC2086
tippecanoe -o "$TILES_DIR/$LAYER.pmtiles" --force --quiet \
  --layer=couverture --include=niveau \
  --minimum-zoom="$MIN_ZOOM" --maximum-zoom="$MAX_ZOOM" \
  --read-parallel --temporary-directory="$layer_work" \
  --no-simplification-of-shared-nodes \
  --drop-smallest-as-needed \
  --name="Couverture mobile théorique — $label" \
  --description="$(field .quarter) ($(field .date)), source Arcep / Mon Réseau Mobile" \
  --attribution='<a href="https://www.arcep.fr/cartes-et-donnees.html">© Arcep — Mon Réseau Mobile</a>' \
  ${TIPPECANOE_EXTRA:-} \
  "$geojsons"

# --- 6. Vérification et statistiques.
pmtiles verify "$TILES_DIR/$LAYER.pmtiles" >&2
"$PY" "$PIPELINE_DIR/tile_stats.py" "$TILES_DIR/$LAYER.pmtiles" > "$TILES_DIR/$LAYER.stats.json"

[ "$KEEP_WORK" = 1 ] || rm -rf "$layer_work"
log "[$LAYER] terminé en $((SECONDS / 60)) min $((SECONDS % 60)) s"
