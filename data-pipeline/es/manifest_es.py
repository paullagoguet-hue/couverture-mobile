#!/usr/bin/env python3
"""Manifeste des tuiles espagnoles (même format que le manifeste français).

Usage : python3 manifest_es.py <dossier tiles/es>
Lit les <op>-<techno>.pmtiles, .stats.json et es-<techno>.download.json
produits par build_es.sh ; écrit <dossier>/manifest.json.
"""

import json
import sys
import time
from pathlib import Path

from es_layers import DATASET, DATASET_URL, OPERATORS, PRODUCER, TECHNOS


def main():
    tiles_dir = Path(sys.argv[1])
    layers = []
    for techno, t in TECHNOS.items():
        download = tiles_dir / f"es-{techno}.download.json"
        if not download.exists():
            print(f"ATTENTION : {download.name} absent, techno {techno} ignorée", file=sys.stderr)
            continue
        dl = json.loads(download.read_text(encoding="utf-8"))
        for op, o in OPERATORS.items():
            layer_id = f"{op}-{techno}"
            pmtiles = tiles_dir / f"{layer_id}.pmtiles"
            if not pmtiles.exists():
                print(f"ATTENTION : {pmtiles.name} absent, couche retirée", file=sys.stderr)
                continue
            tiles = {"file": pmtiles.name, "size": pmtiles.stat().st_size}
            stats = tiles_dir / f"{layer_id}.stats.json"
            if stats.exists():
                zmin, zmax = json.loads(stats.read_text(encoding="utf-8"))["zooms"]
                tiles.update(minzoom=zmin, maxzoom=zmax)
            layers.append({
                "id": layer_id,
                "operator": op,
                "operator_label": o["label"],
                "techno": techno,
                "techno_label": t["label"],
                "usage": "data",
                "has_levels": False,
                "quarter": t["year"],
                # Date de publication par le ministère (les données portent sur l'année « quarter »).
                "date": dl.get("data_last_edit") or f"{t['year']}-12-31",
                "date_label": f"données {t['year']}",
                "source": {"file": t["service"], "public_url": dl["service"]},
                "tiles": tiles,
            })

    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "country": "es",
        "latest_quarter": max((l["quarter"] for l in layers), default=""),
        "source": {
            "producer": PRODUCER,
            "dataset": DATASET,
            "dataset_url": DATASET_URL,
            # Aucune licence affichée sur le service : régime général espagnol de réutilisation
            # (Ley 37/2007), à confirmer par écrit auprès du ministère avant publication.
            "license": "Reutilización de información del sector público (Ley 37/2007), citando la fuente — à confirmer",
        },
        "layers": layers,
    }
    out = tiles_dir / "manifest.json"
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{out} : {len(layers)} couche(s)", file=sys.stderr)


if __name__ == "__main__":
    main()
