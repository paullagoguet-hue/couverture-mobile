#!/usr/bin/env python3
"""Trouve, pour chaque couche, le fichier Arcep le plus récent et écrit un manifeste.

Les fichiers de data.arcep.fr sont stockés dans un bucket S3 public (OVH) dont
le listing (API S3 ListObjectsV2) est accessible sans authentification. On s'en
sert plutôt que de parser les pages HTML : on obtient clés, tailles et ETag,
ce qui rend le téléchargement vérifiable.

Le rythme de publication diffère selon la techno (4G chaque trimestre, 2G/3G
aux T2 et T4, 5G irrégulière) : on prend donc le trimestre le plus récent
*par couche*, dans une fenêtre de MAX_AGE_QUARTERS trimestres pour ne pas
ressortir une couche que l'Arcep a cessé de publier.

Usage :
    python3 discover.py --out out/manifest.json              # toutes les couches
    python3 discover.py --out out/manifest.json orange-4g    # une sélection
"""

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from layers import OPERATORS, TECHNOS, all_layers, parse_layer_id

S3_ENDPOINT = "https://arcep.s3.rbx.io.cloud.ovh.net"
BUCKET_PREFIX = "mobile/couvertures_theoriques/"
PUBLIC_BASE = "https://data.arcep.fr/"  # URL publique documentée (redirige vers S3)
DATASET_PAGE = "https://www.data.gouv.fr/datasets/mon-reseau-mobile"

# Fenêtre d'acceptation : une couche plus vieille que (dernier trimestre - N)
# est considérée comme plus publiée et ignorée.
MAX_AGE_QUARTERS = 2

S3_NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
QUARTER_RE = re.compile(r"^(\d{4})_T([1-4])$")
QUARTER_END = {1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31"}


def s3_list(prefix: str, delimiter: str | None = None):
    """Itère sur un listing S3 (gère la pagination). Renvoie (objets, préfixes)."""
    objects, prefixes, token = [], [], None
    while True:
        params = {"list-type": "2", "prefix": prefix}
        if delimiter:
            params["delimiter"] = delimiter
        if token:
            params["continuation-token"] = token
        url = f"{S3_ENDPOINT}/?{urllib.parse.urlencode(params)}"
        with urllib.request.urlopen(url, timeout=60) as resp:
            root = ET.fromstring(resp.read())
        for c in root.findall("s3:Contents", S3_NS):
            objects.append({
                "key": c.findtext("s3:Key", namespaces=S3_NS),
                "size": int(c.findtext("s3:Size", namespaces=S3_NS)),
                "etag": c.findtext("s3:ETag", namespaces=S3_NS).strip('"'),
                "last_modified": c.findtext("s3:LastModified", namespaces=S3_NS),
            })
        for p in root.findall("s3:CommonPrefixes/s3:Prefix", S3_NS):
            prefixes.append(p.text)
        if root.findtext("s3:IsTruncated", namespaces=S3_NS) != "true":
            return objects, prefixes
        token = root.findtext("s3:NextContinuationToken", namespaces=S3_NS)


def quarter_index(q: str) -> int:
    m = QUARTER_RE.match(q)
    return int(m.group(1)) * 4 + int(m.group(2)) - 1


def list_quarters() -> list[str]:
    """Trimestres publiés (dossiers AAAA_Tn), du plus récent au plus ancien."""
    _, prefixes = s3_list(BUCKET_PREFIX, delimiter="/")
    names = [p[len(BUCKET_PREFIX):].rstrip("/") for p in prefixes]
    return sorted((n for n in names if QUARTER_RE.match(n)), key=quarter_index, reverse=True)


def filename_pattern(quarter: str, layer) -> re.Pattern:
    op_codes = "|".join(OPERATORS[layer.operator]["codes"])
    tech = TECHNOS[layer.techno]
    return re.compile(
        rf"^{quarter}_couv_Metropole_({op_codes})_{tech['arcep']}_{tech['usage']}\.gpkg\.7z$"
    )


def discover(layers) -> dict:
    quarters = list_quarters()
    if not quarters:
        sys.exit("Aucun trimestre trouvé dans le bucket Arcep.")
    latest = quarters[0]
    oldest_ok = quarter_index(latest) - MAX_AGE_QUARTERS
    print(f"Dernier trimestre publié : {latest}", file=sys.stderr)

    found, pending = {}, list(layers)
    for q in quarters:
        if not pending or quarter_index(q) < oldest_ok:
            break
        objects, _ = s3_list(f"{BUCKET_PREFIX}{q}/Metropole/00_Metropole/")
        for layer in list(pending):
            pat = filename_pattern(q, layer)
            match = next((o for o in objects if pat.match(o["key"].rsplit("/", 1)[-1])), None)
            if match:
                year, n = QUARTER_RE.match(q).groups()
                tech = TECHNOS[layer.techno]
                found[layer.id] = {
                    "id": layer.id,
                    "operator": layer.operator,
                    "operator_label": OPERATORS[layer.operator]["label"],
                    "mcc_mnc": OPERATORS[layer.operator]["mcc_mnc"],
                    "techno": layer.techno,
                    "techno_label": tech["label"],
                    "arcep_techno": tech["arcep"],
                    "usage": tech["usage"],
                    "has_levels": tech["levels"],
                    "minzoom": tech["minzoom"],
                    "quarter": q,
                    "date": f"{year}-{QUARTER_END[int(n)]}",
                    "source": {
                        "file": match["key"].rsplit("/", 1)[-1],
                        "url": f"{S3_ENDPOINT}/{match['key']}",
                        "public_url": f"{PUBLIC_BASE}{match['key']}",
                        "size": match["size"],
                        "etag": match["etag"],
                        "last_modified": match["last_modified"],
                    },
                }
                pending.remove(layer)

    for layer in pending:
        print(f"ATTENTION : aucune donnée récente (>= {quarters[0]} - {MAX_AGE_QUARTERS} trim.) "
              f"pour {layer.id}, couche ignorée.", file=sys.stderr)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "latest_quarter": latest,
        "source": {
            "producer": "Arcep",
            "dataset": "Mon Réseau Mobile — cartes de couverture théorique",
            "dataset_url": DATASET_PAGE,
            "license": "Licence Ouverte / Open Licence 2.0 (Etalab)",
        },
        "layers": [found[l.id] for l in layers if l.id in found],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("layers", nargs="*", help="ids de couches (ex. orange-4g) ; défaut : toutes")
    ap.add_argument("--out", required=True, type=Path, help="chemin du manifeste JSON")
    args = ap.parse_args()

    layers = [parse_layer_id(i) for i in args.layers] if args.layers else all_layers()
    manifest = discover(layers)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for l in manifest["layers"]:
        print(f"  {l['id']:<14} {l['quarter']}  {l['source']['file']}  "
              f"({l['source']['size'] / 1e6:.0f} Mo)", file=sys.stderr)


if __name__ == "__main__":
    main()
