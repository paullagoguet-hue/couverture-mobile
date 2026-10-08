#!/usr/bin/env bash
# Installe les dépendances du pipeline sur Ubuntu/Debian (testé : ubuntu-24.04).
#
#   ./install_deps.sh           paquets système + tippecanoe + pmtiles + venv Python
#   ./install_deps.sh --check   vérifie seulement que tout est présent
#
# tippecanoe n'est pas compilé pour Windows : sous Windows, utiliser WSL2 ou
# la CI GitHub Actions (.github/workflows/build-data.yml).
set -euo pipefail
source "$(dirname "$0")/env.sh"

check() {
  local missing=0
  for cmd in curl jq 7z ogr2ogr tippecanoe pmtiles; do
    command -v "$cmd" >/dev/null || { log "manquant : $cmd"; missing=1; }
  done
  "$PY" -c 'import pmtiles' 2>/dev/null || { log "manquant : module Python pmtiles"; missing=1; }
  "$PY" -c 'import numpy, pyproj; from osgeo import gdal' 2>/dev/null || { log "manquant : GDAL Python / NumPy / pyproj"; missing=1; }
  return $missing
}

if [ "${1:-}" = "--check" ]; then
  check || die "dépendances manquantes, lancer ./install_deps.sh"
  log "ogr2ogr : $(ogr2ogr --version)"
  log "tippecanoe : $(tippecanoe --version 2>&1)"
  exit 0
fi

SUDO=; [ "$(id -u)" -eq 0 ] || SUDO=sudo

# --- Paquets système : GDAL (ogr2ogr), 7-Zip, jq, chaîne de compilation.
log "Paquets système"
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq --no-install-recommends \
  gdal-bin python3-gdal python3-numpy python3-pyproj p7zip-full jq curl ca-certificates python3 python3-venv \
  build-essential libsqlite3-dev zlib1g-dev

mkdir -p "$TOOLS_DIR/bin"

# --- tippecanoe (felt/tippecanoe), compilé depuis les sources à une version fixe.
if ! tippecanoe --version 2>&1 | grep -q "v$TIPPECANOE_VERSION"; then
  log "Compilation de tippecanoe $TIPPECANOE_VERSION"
  src=$(mktemp -d)
  curl -fsSL "https://github.com/felt/tippecanoe/archive/refs/tags/$TIPPECANOE_VERSION.tar.gz" \
    | tar -xz -C "$src" --strip-components=1
  make -C "$src" -j"$(nproc)" >/dev/null
  make -C "$src" install PREFIX="$TOOLS_DIR" >/dev/null
  rm -rf "$src"
fi

# --- pmtiles CLI (protomaps/go-pmtiles) : vérification et inspection des archives.
if ! pmtiles version 2>/dev/null | grep -q "$PMTILES_VERSION"; then
  log "Téléchargement de pmtiles $PMTILES_VERSION"
  curl -fsSL "https://github.com/protomaps/go-pmtiles/releases/download/v$PMTILES_VERSION/go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz" \
    | tar -xz -C "$TOOLS_DIR/bin" pmtiles
fi

# --- Environnement Python isolé (pmtiles pour tile_stats.py ; GDAL et NumPy système pour commune_stats.py).
if [ ! -x "$VENV_DIR/bin/python" ]; then
  # --system-site-packages : GDAL (osgeo) et NumPy viennent des paquets système.
  python3 -m venv --system-site-packages "$VENV_DIR"
fi
"$VENV_DIR/bin/pip" install -q -r "$PIPELINE_DIR/requirements.txt"
PY="$VENV_DIR/bin/python"

check
log "Dépendances OK"
