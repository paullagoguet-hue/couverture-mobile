#!/usr/bin/env python3
"""Manifeste des tuiles portugaises (même format que le manifeste français).

Usage : python3 manifest_pt.py <dossier tiles/pt>
Lit les <op>-<techno>.pmtiles, .stats.json et .download.json produits par
build_pt.sh ; écrit <dossier>/manifest.json.
"""

import json
import re
import sys
import time
from pathlib import Path

from pt_layers import CLASSES, DATASET, DATASET_URL, OPERATORS, PRODUCER, TECHNOS


def quarter_end(quarter: str) -> str:
    """« 2026T2 » -> « 2026-06-30 »."""
    m = re.match(r"(\d{4})\s*T(\d)", quarter or "")
    if not m:
        return time.strftime("%Y-%m-%d", time.gmtime())
    year, q = int(m[1]), int(m[2])
    return f"{year}-{['03-31', '06-30', '09-30', '12-31'][q - 1]}"


def main():
    tiles_dir = Path(sys.argv[1])
    tiles_dir.mkdir(parents=True, exist_ok=True)
    layers = []
    for techno, techno_label in TECHNOS.items():
        for op, o in OPERATORS.items():
            layer_id = f"{op}-{techno}"
            pmtiles = tiles_dir / f"{layer_id}.pmtiles"
            download = tiles_dir / f"{layer_id}.download.json"
            if not pmtiles.exists() or not download.exists():
                print(f"ATTENTION : {layer_id} incomplet, couche retirée", file=sys.stderr)
                continue
            dl = json.loads(download.read_text(encoding="utf-8"))
            tiles = {"file": pmtiles.name, "size": pmtiles.stat().st_size}
            stats = tiles_dir / f"{layer_id}.stats.json"
            if stats.exists():
                zmin, zmax = json.loads(stats.read_text(encoding="utf-8"))["zooms"]
                tiles.update(minzoom=zmin, maxzoom=zmax)
            quarter = dl.get("quarter") or ""
            layers.append({
                "id": layer_id,
                "operator": op,
                "operator_label": o["label"],
                "techno": techno,
                "techno_label": techno_label,
                "usage": "data",
                "has_levels": False,
                "quarter": quarter.replace("T", "_T"),
                "date": quarter_end(quarter),
                "source": {"file": f"layer {dl['layer_id']}", "public_url": DATASET_URL},
                "tiles": tiles,
            })

    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "country": "pt",
        "latest_quarter": max((l["quarter"] for l in layers), default=""),
        "source": {
            "producer": PRODUCER,
            "dataset": DATASET,
            "dataset_url": DATASET_URL,
            # Mention « © ANACOM » sur le service ; conditions de réutilisation à confirmer.
            "license": "© ANACOM — conditions de réutilisation à confirmer",
        },
        # Attribut « classe » des tuiles -> débit minimal estimé (Mbit/s).
        "speed_classes": {str(code): mbps for code, _, mbps in CLASSES},
        "layers": layers,
    }
    out = tiles_dir / "manifest.json"
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{out} : {len(layers)} couche(s)", file=sys.stderr)


if __name__ == "__main__":
    main()
