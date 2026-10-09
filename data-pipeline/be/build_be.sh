#!/usr/bin/env bash
# Construit les PMTiles belges (Orange, Proximus, Telenet × 4G, 5G).
#
#   ./build_be.sh
#
# Source : atlas mobile de l'IBPT (régulateur belge), carte détaillée, service
# WFS public (GeoServer) : par couche, 4 multipolygones selon le niveau de
# signal (« Layer ») : 0 pas de signal, 1 suffisant (extérieur), 2 bon
# (intérieur), 3 très bon (intérieur profond). Les niveaux 3, 2, 1 sont
# repris comme TBC, BC, CL (même attribut « niveau » que les cartes de l'Arcep) ;
# le niveau 0 est écarté.
#
# Résultat : $TILES_DIR/be/<operateur>-<techno>.pmtiles (+ .stats.json) et manifest.json.
set -euo pipefail
BE_DIR=$(cd "$(dirname "$0")" && pwd)
source "$BE_DIR/../env.sh"

WFS=https://geo.bipt-data.be/geoserver/dp_mobile_detailed_overview/wfs
MIN_ZOOM=${MIN_ZOOM:-8}
MAX_ZOOM=${MAX_ZOOM:-12}
TIPPECANOE_OPTS=${TIPPECANOE_OPTS:---no-simplification-of-shared-nodes --simplify-only-low-zooms --drop-smallest-as-needed}
LAYERS=(Orange Proximus Telenet)

work="$WORK_DIR/be"
out="$TILES_DIR/be"
rm -rf "$work" && mkdir -p "$work" "$out"
SECONDS=0

build_layer() {
  local op=$1 techno=$2 name="$1_$2"
  local id; id="$(tr '[:upper:]' '[:lower:]' <<< "$op")-$(tr '[:upper:]' '[:lower:]' <<< "$techno")"
  curl -fsS --retry 5 --retry-delay 15 --retry-all-errors -o "$work/$id.json" \
    "$WFS?service=WFS&version=2.0.0&request=GetFeature&typeNames=dp_mobile_detailed_overview:$name&outputFormat=application/json"
  # Contrôle : les 4 niveaux attendus, rien d'autre.
  local levels; levels=$(jq -c '[.features[].properties.Layer] | sort' "$work/$id.json")
  [ "$levels" = "[0,1,2,3]" ] || die "[$id] niveaux inattendus : $levels"
  ogr2ogr -f GeoJSONSeq "$work/$id.geojsons" "$work/$id.json" \
    -s_srs EPSG:3857 -t_srs EPSG:4326 -explodecollections -lco COORDINATE_PRECISION=6 \
    -dialect SQLite -sql "SELECT geometry, CASE Layer WHEN 3 THEN 'TBC' WHEN 2 THEN 'BC' WHEN 1 THEN 'CL' END AS niveau FROM \"$id\" WHERE Layer > 0"
  rm -f "$work/$id.json"
  # shellcheck disable=SC2086
  tippecanoe -o "$out/$id.pmtiles" --force --quiet \
    --layer=couverture --include=niveau \
    --minimum-zoom="$MIN_ZOOM" --maximum-zoom="$MAX_ZOOM" \
    --temporary-directory="$work" \
    $TIPPECANOE_OPTS \
    --name="Couverture mobile — $op $techno" \
    --description="IBPT/BIPT, atlas mobile, carte détaillée" \
    --attribution='© IBPT-BIPT' \
    "$work/$id.geojsons"
  rm -f "$work/$id.geojsons"
  pmtiles verify "$out/$id.pmtiles" >&2
  "$PY" "$PIPELINE_DIR/tile_stats.py" "$out/$id.pmtiles" > "$out/$id.stats.json"
  log "[$id] $(du -h "$out/$id.pmtiles" | cut -f1) (à ${SECONDS} s)"
}

pids=()
for op in "${LAYERS[@]}"; do
  for techno in 4G 5G; do
    build_layer "$op" "$techno" & pids+=($!)
  done
done
status=0
for pid in "${pids[@]}"; do wait "$pid" || status=1; done
[ "$status" = 0 ] || die "au moins une couche a échoué"

# Manifeste (même format que la France).
"$PY" - "$out" <<'PY'
import json, sys, time
from pathlib import Path
out = Path(sys.argv[1])
labels = {"orange": "Orange", "proximus": "Proximus", "telenet": "Telenet"}
layers = []
for techno in ("4g", "5g"):
    for op, label in labels.items():
        p = out / f"{op}-{techno}.pmtiles"
        if not p.exists():
            continue
        zmin, zmax = json.loads((out / f"{op}-{techno}.stats.json").read_text())["zooms"]
        layers.append({
            "id": f"{op}-{techno}", "operator": op, "operator_label": label,
            "techno": techno, "techno_label": techno.upper(), "usage": "data", "has_levels": True,
            "quarter": time.strftime("%Y"), "date": time.strftime("%Y-%m-%d"),
            "source": {"file": f"dp_mobile_detailed_overview:{label}_{techno.upper()}", "public_url": "https://www.bipt-data.be/fr/projects/atlas/mobile"},
            "tiles": {"file": p.name, "size": p.stat().st_size, "minzoom": zmin, "maxzoom": zmax},
        })
manifest = {
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "country": "be",
    "latest_quarter": time.strftime("%Y"),
    "source": {"producer": "IBPT-BIPT", "dataset": "Atlas mobile — carte détaillée", "dataset_url": "https://www.bipt-data.be/fr/projects/atlas/mobile",
               "license": "Portail de données de l'IBPT (Creative Commons BY) — à confirmer"},
    "layers": layers,
}
(out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
print(f"manifest : {len(layers)} couche(s)", file=sys.stderr)
PY
log "[be] terminé en $((SECONDS / 60)) min $((SECONDS % 60)) s"
