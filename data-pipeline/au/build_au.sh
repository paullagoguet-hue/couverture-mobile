#!/usr/bin/env bash
# Construit les PMTiles australiens (Telstra, Optus, TPG × 4G, 5G).
#
#   ./build_au.sh
#
# Source : ACCC (autorité de la concurrence), « Mobile Infrastructure Report –
# data release » sur data.gov.au (CC BY 2.5 AU) : cartes de couverture
# déclarées par chaque opérateur, en KML (zones couvertes, sans niveau ni
# débit). Variante « Outdoor » (téléphone à l'extérieur), comme ailleurs ;
# les variantes « Ext Ant » (antenne externe) et « Wholesale » sont écartées.
#
# TPG (marque Vodafone) = son propre réseau + le réseau régional partagé avec
# Optus (« Optus-TPG MOCN »), que ses clients utilisent aussi.
#
# Résultat : $TILES_DIR/au/<operateur>-<techno>.pmtiles (+ .stats.json) et manifest.json.
set -euo pipefail
AU_DIR=$(cd "$(dirname "$0")" && pwd)
source "$AU_DIR/../env.sh"

DATASET=https://data.gov.au/data/api/3/action/package_show?id=accc-mobile-infrastructure-report-data-release
MIN_ZOOM=${MIN_ZOOM:-8}
MAX_ZOOM=${MAX_ZOOM:-12}
TIPPECANOE_OPTS=${TIPPECANOE_OPTS:---no-simplification-of-shared-nodes --simplify-only-low-zooms --drop-smallest-as-needed}

work="$WORK_DIR/au"
out="$TILES_DIR/au"
rm -rf "$work" && mkdir -p "$work" "$out"
SECONDS=0

curl -fsSL --retry 5 "$DATASET" > "$work/dataset.json"
# Année la plus récente publiée (« Coverage map - Telstra - 4G - Outdoor - 2026 »).
YEAR=$(jq -r '[.result.resources[].name | capture("^Coverage map - .* - Outdoor - (?<y>[0-9]{4})$").y] | max' "$work/dataset.json")
[ -n "$YEAR" ] && [ "$YEAR" != null ] || die "aucune carte « Outdoor » dans le jeu de données"
log "[au] année $YEAR"

# Fichier d'un réseau (« Telstra », « Optus-TPG MOCN »…) -> GeoJSONSeq (une ligne par polygone).
fetch() {
  local network=$1 techno=$2 dest=$3
  local name="Coverage map - $network - $techno - Outdoor - $YEAR"
  local url; url=$(jq -r --arg n "$name" '.result.resources[] | select(.name == $n) | .url' "$work/dataset.json" | head -1)
  [ -n "$url" ] || die "« $name » introuvable"
  local dir; dir=$(mktemp -d -p "$work")
  curl -fsSL --retry 5 --retry-delay 15 --retry-all-errors -o "$dir/source" "$url"
  if [[ "$url" == *.zip ]]; then (cd "$dir" && 7z x -y -bd source >/dev/null); fi
  local kml; kml=$(find "$dir" -iname '*.kml' -print -quit)
  [ -n "$kml" ] || kml="$dir/source"
  # Lecture au fil de l'eau : fichiers de plusieurs centaines de Mo (cf. kml2geojsons.py).
  "$PY" "$AU_DIR/kml2geojsons.py" "$kml" "$dest.geojsons"
  rm -rf "$dir"
  [ -s "$dest.geojsons" ] || die "« $name » : aucun polygone"
}

build_layer() {
  local op=$1 techno=$2; shift 2
  local id; id="$op-$(tr '[:upper:]' '[:lower:]' <<< "$techno")"
  local network
  for network in "$@"; do fetch "$network" "$techno" "$work/$id.$(tr -c 'A-Za-z0-9' '_' <<< "$network")"; done
  # shellcheck disable=SC2086
  tippecanoe -o "$out/$id.pmtiles" --force --quiet --layer=couverture --exclude-all \
    --minimum-zoom="$MIN_ZOOM" --maximum-zoom="$MAX_ZOOM" --temporary-directory="$work" $TIPPECANOE_OPTS \
    --name="Couverture mobile — $op $techno" --description="ACCC, Mobile Infrastructure Report $YEAR" --attribution='© ACCC' \
    "$work/$id".*.geojsons
  rm -f "$work/$id".*.geojsons
  pmtiles verify "$out/$id.pmtiles" >&2
  "$PY" "$PIPELINE_DIR/tile_stats.py" "$out/$id.pmtiles" > "$out/$id.stats.json"
  log "[$id] $(du -h "$out/$id.pmtiles" | cut -f1) (à ${SECONDS} s)"
}

# Une techno à la fois (3 couches en parallèle) : mémoire et disque du runner.
for techno in 4G 5G; do
  pids=()
  build_layer telstra "$techno" Telstra & pids+=($!)
  build_layer optus "$techno" Optus & pids+=($!)
  build_layer tpg "$techno" TPG "Optus-TPG MOCN" & pids+=($!)
  status=0
  for pid in "${pids[@]}"; do wait "$pid" || status=1; done
  [ "$status" = 0 ] || die "au moins une couche a échoué ($techno)"
done

# Manifeste (même format que la France) ; date : publication des fichiers par l'ACCC.
"$PY" - "$out" "$work/dataset.json" "$YEAR" <<'PY'
import json, sys, time
from pathlib import Path
out, dataset, year = Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text()), sys.argv[3]
created = max((r.get("created") or "")[:10] for r in dataset["result"]["resources"] if r["name"].endswith(f"Outdoor - {year}"))
labels = {"telstra": "Telstra", "optus": "Optus", "tpg": "Vodafone (TPG)"}
layers = []
for techno in ("4g", "5g"):
    for op, label in labels.items():
        p = out / f"{op}-{techno}.pmtiles"
        if not p.exists():
            continue
        zmin, zmax = json.loads((out / f"{op}-{techno}.stats.json").read_text())["zooms"]
        layers.append({
            "id": f"{op}-{techno}", "operator": op, "operator_label": label,
            "techno": techno, "techno_label": techno.upper(), "usage": "data", "has_levels": False,
            "quarter": year, "date": created,
            "source": {"file": f"Coverage map - {label} - {techno.upper()} - Outdoor - {year}",
                       "public_url": "https://data.gov.au/data/dataset/accc-mobile-infrastructure-report-data-release"},
            "tiles": {"file": p.name, "size": p.stat().st_size, "minzoom": zmin, "maxzoom": zmax},
        })
manifest = {
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "country": "au",
    "latest_quarter": year,
    "source": {"producer": "ACCC", "dataset": "Mobile Infrastructure Report – data release",
               "dataset_url": "https://data.gov.au/data/dataset/accc-mobile-infrastructure-report-data-release",
               "license": "CC BY 2.5 AU"},
    "layers": layers,
}
(out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
print(f"manifest : {len(layers)} couche(s)", file=sys.stderr)
PY
log "[au] terminé en $((SECONDS / 60)) min $((SECONDS % 60)) s"
