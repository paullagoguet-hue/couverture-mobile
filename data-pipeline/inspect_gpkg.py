#!/usr/bin/env python3
"""Vérifie qu'un GeoPackage Arcep correspond à ce que le manifeste annonce.

Un GeoPackage est une base SQLite : on l'interroge avec le module `sqlite3`
de la bibliothèque standard, sans dépendance. Le script échoue (code 1) si
le fichier ne respecte pas le format attendu, plutôt que de produire des
tuiles silencieusement fausses (changement de schéma, de projection, etc.).

Sortie (stdout) : JSON avec le nom de la table, la projection et des comptes,
réutilisé par build_layer.sh et archivé avec les tuiles.

Usage : python3 inspect_gpkg.py <fichier.gpkg> <manifest.json> <layer_id>
"""

import json
import sqlite3
import sys

from layers import LEVELS


def fail(msg: str):
    sys.exit(f"ERREUR ({sys.argv[1]}) : {msg}")


def main():
    gpkg, manifest_path, layer_id = sys.argv[1:4]
    with open(manifest_path, encoding="utf-8") as f:
        layer = next((l for l in json.load(f)["layers"] if l["id"] == layer_id), None)
    if layer is None:
        fail(f"couche {layer_id} absente du manifeste")

    db = sqlite3.connect(f"file:{gpkg}?mode=ro", uri=True)
    tables = db.execute("SELECT table_name FROM gpkg_contents WHERE data_type = 'features'").fetchall()
    if len(tables) != 1:
        fail(f"une seule table de features attendue, trouvé : {tables}")
    table = tables[0][0]

    # Projection : la métropole est en Lambert-93, mais les fichiers récents la
    # déclarent avec un SRS « maison » (srs_id 100000, organisation NONE).
    # On vérifie la définition WKT, et build_layer.sh force EPSG:2154.
    srs_id, srs_name, srs_def, geom_col = db.execute(
        "SELECT s.srs_id, s.srs_name, s.definition, g.column_name "
        "FROM gpkg_geometry_columns g JOIN gpkg_spatial_ref_sys s USING (srs_id) "
        "WHERE g.table_name = ?", (table,)).fetchone()
    if srs_id != 2154 and "Lambert-93" not in (srs_name or "") + (srs_def or ""):
        fail(f"projection inattendue : {srs_id} / {srs_name}")

    columns = {r[1] for r in db.execute(f'PRAGMA table_info("{table}")')}
    required = {"operateur", "date", "techno", "usage", "niveau", "dept"}
    if missing := required - columns:
        fail(f"colonnes manquantes : {sorted(missing)}")

    def distinct(col):
        return sorted({r[0] for r in db.execute(f'SELECT DISTINCT "{col}" FROM "{table}"')}, key=str)

    checks = {
        "techno": [layer["arcep_techno"]],
        "usage": [layer["usage"]],
        "operateur": [int(layer["mcc_mnc"])],
        "date": [layer["date"]],
    }
    for col, expected in checks.items():
        got = distinct(col)
        if got != expected:
            fail(f"{col} : attendu {expected}, trouvé {got}")

    # Niveaux : TBC/BC/CL pour les couches qui en ont, vide sinon.
    levels = distinct("niveau")
    expected_levels = set(LEVELS) if layer["has_levels"] else {None, ""}
    if not set(levels) <= expected_levels or (layer["has_levels"] and not levels):
        fail(f"niveaux inattendus : {levels} (has_levels={layer['has_levels']})")

    counts = dict(db.execute(f'SELECT COALESCE(NULLIF(niveau, \'\'), \'-\'), COUNT(*) FROM "{table}" GROUP BY 1'))
    n_dept = db.execute(f'SELECT COUNT(DISTINCT dept) FROM "{table}"').fetchone()[0]
    geom_bytes = db.execute(f'SELECT SUM(LENGTH("{geom_col}")) FROM "{table}"').fetchone()[0]

    json.dump({
        "table": table,
        "geometry_column": geom_col,
        "srs": {"id": srs_id, "name": srs_name},
        "features_by_level": counts,
        "departments": n_dept,
        "geometry_bytes": geom_bytes,
    }, sys.stdout, ensure_ascii=False, indent=2)
    print()


if __name__ == "__main__":
    main()
