#!/usr/bin/env python3
"""Statistiques de taille des tuiles d'un fichier PMTiles, par niveau de zoom.

Sert à calibrer le pipeline (zoom max, simplification) : on regarde le poids
total, et surtout les tuiles les plus lourdes, qui conditionnent la fluidité
côté navigateur (au-delà de ~500 Ko compressés, l'affichage rame).

Usage : python3 tile_stats.py <fichier.pmtiles>   (dépendance : pip install pmtiles)
"""

import json
import math
import os
import sys
from collections import defaultdict

from pmtiles.reader import MmapSource, Reader, all_tiles


def main():
    path = sys.argv[1]
    sizes = defaultdict(list)
    with open(path, "rb") as f:
        get_bytes = MmapSource(f)
        header = Reader(get_bytes).header()
        for (z, _x, _y), data in all_tiles(get_bytes):
            sizes[z].append(len(data))

    by_zoom = {}
    for z in sorted(sizes):
        s = sorted(sizes[z])
        by_zoom[z] = {
            "tiles": len(s),
            "total_kb": round(sum(s) / 1024),
            "avg_kb": round(sum(s) / len(s) / 1024, 1),
            "p95_kb": round(s[math.ceil(0.95 * len(s)) - 1] / 1024, 1),  # rang le plus proche
            "max_kb": round(s[-1] / 1024, 1),
        }

    report = {
        "file": os.path.basename(path),
        "file_mb": round(os.path.getsize(path) / 1e6, 1),
        "zooms": [header["min_zoom"], header["max_zoom"]],
        "by_zoom": by_zoom,
    }
    json.dump(report, sys.stdout, indent=2)
    print()

    # Résumé lisible sur stderr (visible dans les logs de CI).
    print(f"\n{report['file']} : {report['file_mb']} Mo", file=sys.stderr)
    print(f"{'z':>3} {'tuiles':>8} {'total Mo':>9} {'moy Ko':>7} {'p95 Ko':>7} {'max Ko':>7}", file=sys.stderr)
    for z, st in by_zoom.items():
        print(f"{z:>3} {st['tiles']:>8} {st['total_kb'] / 1024:>9.1f} {st['avg_kb']:>7} "
              f"{st['p95_kb']:>7} {st['max_kb']:>7}", file=sys.stderr)


if __name__ == "__main__":
    main()
