# Variables communes, sourcées par les autres scripts (ne pas exécuter directement).
#
# Toutes les valeurs sont surchargeables par variable d'environnement.

PIPELINE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Versions épinglées des outils (reproductibilité).
TIPPECANOE_VERSION=${TIPPECANOE_VERSION:-2.79.0}
PMTILES_VERSION=${PMTILES_VERSION:-1.31.2}

# Outils compilés/téléchargés localement (tippecanoe, pmtiles) + venv Python.
TOOLS_DIR=${TOOLS_DIR:-$PIPELINE_DIR/.tools}
VENV_DIR=${VENV_DIR:-$PIPELINE_DIR/.venv}
export PATH="$TOOLS_DIR/bin:$PATH"
PY="$VENV_DIR/bin/python"
[ -x "$PY" ] || PY=python3

# Répertoires de travail : WORK_DIR contient les fichiers intermédiaires
# volumineux (plusieurs Go par couche), OUT_DIR les livrables.
WORK_DIR=${WORK_DIR:-$PIPELINE_DIR/work}
OUT_DIR=${OUT_DIR:-$PIPELINE_DIR/out}
MANIFEST=${MANIFEST:-$OUT_DIR/manifest.json}
TILES_DIR=${TILES_DIR:-$OUT_DIR/tiles}

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die() { log "ERREUR : $*"; exit 1; }
