#!/usr/bin/env python3
"""Produit le manifeste publié avec les tuiles (lu par le front).

Reprend le manifeste de discover.py et n'y garde que les couches dont le
PMTiles a bien été construit, en ajoutant le nom et la taille du fichier.

Usage : python3 finalize_manifest.py <manifest.json> <dossier_tuiles>
"""

import json
import sys
from pathlib import Path


def main():
    manifest_path, tiles_dir = Path(sys.argv[1]), Path(sys.argv[2])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    layers = []
    for layer in manifest["layers"]:
        pmtiles = tiles_dir / f"{layer['id']}.pmtiles"
        if not pmtiles.exists():
            print(f"ATTENTION : {pmtiles.name} absent, couche retirée du manifeste", file=sys.stderr)
            continue
        layer["tiles"] = {"file": pmtiles.name, "size": pmtiles.stat().st_size}
        stats = tiles_dir / f"{layer['id']}.stats.json"
        if stats.exists():  # zooms réels, pour que le front sache quand afficher la couche
            zmin, zmax = json.loads(stats.read_text(encoding="utf-8"))["zooms"]
            layer["tiles"].update(minzoom=zmin, maxzoom=zmax)
        layers.append(layer)
    manifest["layers"] = layers

    out = tiles_dir / "manifest.json"
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{out} : {len(layers)} couche(s)", file=sys.stderr)


if __name__ == "__main__":
    main()
