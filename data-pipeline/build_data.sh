#!/usr/bin/env bash
# Point d'entrée unique : refait toutes les données de A à Z.
#
#   ./build_data.sh                 toutes les couches
#   ./build_data.sh orange-4g ...   une sélection de couches
#
# Résultat dans out/tiles/ : un <couche>.pmtiles par couche + manifest.json
# (dates, sources, tailles) lu par le front.
#
# Espace disque : prévoir ~10 Go de libre dans WORK_DIR pour la plus grosse
# couche (les intermédiaires sont supprimés couche par couche).
set -euo pipefail
source "$(dirname "$0")/env.sh"

# Scripts appelés via `bash` : le bit exécutable peut manquer (dépôt créé sous Windows).
bash "$PIPELINE_DIR/install_deps.sh" --check

log "Recherche des fichiers Arcep les plus récents"
"$PY" "$PIPELINE_DIR/discover.py" --out "$MANIFEST" "$@"

for layer in $(jq -r '.layers[].id' "$MANIFEST"); do
  bash "$PIPELINE_DIR/build_layer.sh" "$layer"
done

"$PY" "$PIPELINE_DIR/finalize_manifest.py" "$MANIFEST" "$TILES_DIR"
"$PY" "$PIPELINE_DIR/merge_communes.py" "$MANIFEST" "$TILES_DIR" "$TILES_DIR/communes"
log "Terminé : $TILES_DIR"
