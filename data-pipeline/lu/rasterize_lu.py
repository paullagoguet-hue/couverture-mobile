#!/usr/bin/env python3
"""Rasters de couverture par opérateur pour le Luxembourg (4G ou 5G).

Source : ILR (régulateur), « Cartes de couverture des réseaux de communications
électroniques » sur data.public.lu (CC BY) : pour chaque carré de 100 m
(IdGrid), la liste des opérateurs qui le couvrent. Les carrés sont ceux de la
grille LUREF de 100 m du cadastre (BD-L-GRID, CC0), dont le fichier .dbf donne
les bords (left, top) de chaque identifiant.

    python3 rasterize_lu.py 5g couverture-5g.csv luref100_grid.dbf out_dir stats.json

Produit <out_dir>/<operateur>.tif (Byte, 1 = couvert) en EPSG:2169.
"""

import csv
import json
import sys
from collections import Counter

import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()

# Raison sociale (telle qu'écrite dans le fichier) -> identifiant.
OPERATORS = {
    "Orange Communications Luxembourg S.A.": "orange",
    "POST Luxembourg": "post",
    "Proximus Luxembourg S.A.": "proximus",
}
CELL = 100


def main():
    techno, csv_path, dbf_path, out_dir, stats_path = sys.argv[1:6]

    # Bords de chaque carré de la grille.
    ds = ogr.Open(dbf_path)
    layer = ds.GetLayer(0)
    cells = {}
    for f in layer:
        cells[int(f.GetField("id"))] = (round(float(f.GetField("left"))), round(float(f.GetField("top"))))
    ds = None
    lefts = [c[0] for c in cells.values()]
    tops = [c[1] for c in cells.values()]
    x0, y1 = min(lefts), max(tops)
    width = (max(lefts) - x0) // CELL + 1
    height = (y1 - min(tops)) // CELL + 1
    grids = {op: np.zeros((height, width), dtype=np.uint8) for op in OPERATORS.values()}

    counts, unknown, period, missing = Counter(), Counter(), set(), 0
    with open(csv_path, encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            if row["Technologie"].strip().upper() != techno.upper():
                continue
            period.add(row["Periode"])
            cell = cells.get(int(row["IdGrid"]))
            if cell is None:
                missing += 1
                continue
            col, r = (cell[0] - x0) // CELL, (y1 - cell[1]) // CELL
            for name in (n.strip() for n in row["operateur"].split(",")):
                if not name:
                    continue
                op = OPERATORS.get(name)
                if op is None:
                    unknown[name] += 1
                    continue
                grids[op][r, col] = 1
                counts[op] += 1

    srs = osr.SpatialReference()
    srs.ImportFromEPSG(2169)
    for op, grid in grids.items():
        out = gdal.GetDriverByName("GTiff").Create(f"{out_dir}/{op}.tif", width, height, 1, gdal.GDT_Byte, ["COMPRESS=DEFLATE"])
        out.SetGeoTransform((x0, CELL, 0, y1, 0, -CELL))
        out.SetProjection(srs.ExportToWkt())
        out.GetRasterBand(1).WriteArray(grid)
        out.GetRasterBand(1).SetNoDataValue(0)
        out = None

    stats = {"techno": techno, "period": sorted(period), "cells_by_operator": dict(counts),
             "unknown_operators": dict(unknown), "cells_not_in_grid": missing, "grid": [width, height]}
    json.dump(stats, open(stats_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(json.dumps(stats, ensure_ascii=False), file=sys.stderr)
    if unknown or not counts:
        sys.exit(f"ERREUR : opérateurs inconnus {dict(unknown)} ou aucune donnée")


if __name__ == "__main__":
    main()
