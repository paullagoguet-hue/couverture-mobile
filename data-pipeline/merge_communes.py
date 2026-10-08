#!/usr/bin/env python3
"""Fusionne les parts couvertes par commune de toutes les couches en un
fichier JSON par département (chargé à la demande par le site et l'extension).

Entrée : <dossier>/<couche>.communes.csv (commune_stats.py) + manifeste.
Sortie : <dossier_sortie>/<département>.json :
  {
    "layers": ["orange-4g", ...],
    "communes": {
      "37261": {"nom": "Tours", "hab": 119631, "orange-4g": [TBC, BC, CL], "orange-5g": [couvert], ...}
    }
  }
Valeurs en % des HABITANTS de la commune (Insee, Filosofi 2019), 1 décimale.
Communes sans habitants recensés : % de la SURFACE, signalé par "base": "surface".
Couches sans niveaux (5G…) : une seule valeur, la part couverte.

Usage : python3 merge_communes.py <manifest.json> <dossier_csv> <dossier_sortie>
"""

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

# En dessous, la population est trop faible pour être un indicateur fiable.
MIN_INHABITANTS = 1


def main():
    manifest_path, csv_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    depts: dict[str, dict] = defaultdict(dict)
    layers_done = []
    for layer in manifest["layers"]:
        path = csv_dir / f"{layer['id']}.communes.csv"
        if not path.exists():
            print(f"ATTENTION : {path.name} absent, couche ignorée", file=sys.stderr)
            continue
        layers_done.append(layer["id"])
        with path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                pop = float(row["pop"])
                by_pop = pop >= MIN_INHABITANTS
                total, prefix = (pop, "pop_") if by_pop else (float(row["pixels"]), "")
                pct = lambda level: round(100 * float(row[prefix + level]) / total, 1)  # noqa: E731
                values = [pct("tbc"), pct("bc"), pct("cl")] if layer["has_levels"] else [pct("tbc")]
                commune = depts[row["code"][:2]].setdefault(row["code"], {"nom": row["nom"], "hab": round(pop)})
                if not by_pop:
                    commune["base"] = "surface"
                commune[layer["id"]] = values

    if not layers_done:
        sys.exit("Aucune donnée par commune à fusionner.")
    out_dir.mkdir(parents=True, exist_ok=True)
    for dept, communes in sorted(depts.items()):
        data = {"layers": layers_done, "communes": dict(sorted(communes.items()))}
        (out_dir / f"{dept}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    total = sum(len(c) for c in depts.values())
    surface = sum(1 for c in depts.values() for x in c.values() if x.get("base") == "surface")
    print(f"{out_dir} : {len(depts)} départements, {total} communes ({surface} sans habitants recensés : surface), "
          f"couches : {', '.join(layers_done)}", file=sys.stderr)


if __name__ == "__main__":
    main()
