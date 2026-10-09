#!/usr/bin/env python3
"""Télécharge une couche de couverture espagnole (4G ou 5G) en GeoJSONSeq.

Chaque zone est écrite avec un attribut par opérateur (movistar, vodafone…,
valant 1 ou 0), lu ensuite par gdal_rasterize (-where "movistar = 1").

    python3 download.py 5g out.geojsons stats.json
    python3 download.py 5g out.geojsons stats.json --bbox -3.9,40.3,-3.5,40.6   # essai sur une zone

Sans --bbox : tranches de 2 000 identifiants (OBJECTID), téléchargées en
parallèle avec un nombre limité de requêtes simultanées (service public du
ministère : on reste raisonnable), puis contrôle du total. Avec --bbox :
pagination simple sur l'emprise. Aucune dépendance hors bibliothèque standard.
"""

import argparse
import json
import sys
import threading
import time
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

from es_layers import GRID_STEP, OPERATORS, service_url

PAGE = 2000
USER_AGENT = "couverture-mobile/1.0 (+https://github.com/paullagoguet-hue/couverture-mobile)"
CIF_TO_OP = {o["cif"]: op for op, o in OPERATORS.items()}


def get(url: str, params: dict, attempts: int = 6, path: str = "/query") -> dict:
    """GET JSON avec reprises (délai croissant) ; les erreurs ArcGIS arrivent en HTTP 200."""
    full = f"{url}{path}?{urllib.parse.urlencode(params)}"
    for i in range(attempts):
        try:
            req = urllib.request.Request(full, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.load(resp)
            if "error" in data:
                raise RuntimeError(data["error"])
            return data
        except Exception as err:  # réseau, délai, erreur ArcGIS
            if i == attempts - 1:
                raise
            wait = 10 * 2**i
            print(f"  nouvel essai dans {wait} s ({err})", file=sys.stderr)
            time.sleep(wait)
    raise AssertionError("inaccessible")


class Writer:
    """Écrit les zones (thread-safe) et tient les comptes."""

    def __init__(self, path: str):
        self.out = open(path, "w", encoding="utf-8")
        self.lock = threading.Lock()
        self.features = 0
        self.by_operator = Counter()
        self.unknown_cif = Counter()
        self.widths = Counter()
        self.frac_x = Counter()
        self.frac_y = Counter()

    def write(self, features: list) -> int:
        lines = []
        for f in features:
            cifs = [c.strip() for c in (f["properties"].get("COBERTURA") or "").split(";") if c.strip()]
            props = {op: 0 for op in OPERATORS}
            for cif in cifs:
                op = CIF_TO_OP.get(cif)
                if op:
                    props[op] = 1
                else:
                    self.unknown_cif[cif] += 1
            if f.get("geometry") is None:
                continue
            lines.append(json.dumps({"type": "Feature", "properties": props, "geometry": f["geometry"]}, separators=(",", ":")))
            self.sample_grid(f["geometry"])
            for op, v in props.items():
                self.by_operator[op] += v
        with self.lock:
            self.out.write("\n".join(lines) + ("\n" if lines else ""))
            self.features += len(lines)
        return len(lines)

    def sample_grid(self, geom: dict):
        """Mesure le pas et le calage de la grille (largeur des zones, position des sommets)."""
        if len(self.widths) > 20000 or geom["type"] != "Polygon":
            return
        ring = geom["coordinates"][0]
        xs = [p[0] for p in ring]
        self.widths[round(max(xs) - min(xs), 8)] += 1
        for x, y in ring[:4]:
            self.frac_x[round((x / GRID_STEP) % 1, 2) % 1] += 1
            self.frac_y[round((y / GRID_STEP) % 1, 2) % 1] += 1


def page_params(**extra) -> dict:
    return {
        "outFields": "COBERTURA",
        "outSR": 4326,
        "geometryPrecision": 7,  # ~1 cm
        "returnGeometry": "true",
        "f": "geojson",
        **extra,
    }


def download_all(url: str, writer: Writer, workers: int) -> int:
    stats = get(url, {
        "where": "1=1",
        "outStatistics": json.dumps([
            {"statisticType": "min", "onStatisticField": "OBJECTID", "outStatisticFieldName": "mn"},
            {"statisticType": "max", "onStatisticField": "OBJECTID", "outStatisticFieldName": "mx"},
        ]),
        "f": "json",
    })["features"][0]["attributes"]
    expected = get(url, {"where": "1=1", "returnCountOnly": "true", "f": "json"})["count"]
    starts = range(stats["mn"], stats["mx"] + 1, PAGE)
    print(f"{expected} zones, OBJECTID {stats['mn']}..{stats['mx']}, {len(starts)} pages", file=sys.stderr)

    def fetch(start: int) -> int:
        data = get(url, page_params(where=f"OBJECTID >= {start} AND OBJECTID < {start + PAGE}"))
        return writer.write(data.get("features", []))

    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for fut in as_completed(pool.submit(fetch, s) for s in starts):
            fut.result()
            done += 1
            if done % 200 == 0:
                rate = done / (time.time() - t0)
                print(f"  {done}/{len(starts)} pages, {writer.features} zones, ~{(len(starts) - done) / rate / 60:.0f} min restantes", file=sys.stderr)
    return expected


def download_bbox(url: str, writer: Writer, bbox: str) -> int:
    xmin, ymin, xmax, ymax = (float(v) for v in bbox.split(","))
    geom = {"geometry": f"{xmin},{ymin},{xmax},{ymax}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects"}
    expected = get(url, {"where": "1=1", "returnCountOnly": "true", "f": "json", **geom})["count"]
    print(f"{expected} zones dans l'emprise", file=sys.stderr)
    offset = 0
    while offset < expected:
        data = get(url, page_params(where="1=1", orderByFields="OBJECTID", resultOffset=offset, resultRecordCount=PAGE, **geom))
        n = len(data.get("features", []))
        writer.write(data.get("features", []))
        if n == 0:
            break
        offset += n
    return expected


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("techno", choices=["4g", "5g"])
    ap.add_argument("out")
    ap.add_argument("stats")
    ap.add_argument("--bbox", help="lon_min,lat_min,lon_max,lat_max (essai sur une zone)")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    url = service_url(args.techno)
    # Date de dernière mise à jour des données par le ministère (millisecondes).
    info = get(url, {"f": "json"}, path="")
    edited_ms = info.get("editingInfo", {}).get("dataLastEditDate")
    writer = Writer(args.out)
    t0 = time.time()
    expected = download_bbox(url, writer, args.bbox) if args.bbox else download_all(url, writer, args.workers)
    writer.out.close()

    stats = {
        "techno": args.techno,
        "service": url,
        "data_last_edit": time.strftime("%Y-%m-%d", time.gmtime(edited_ms / 1000)) if edited_ms else None,
        "bbox": args.bbox,
        "expected": expected,
        "features": writer.features,
        "by_operator": dict(writer.by_operator),
        "unknown_cif": dict(writer.unknown_cif),
        "grid": {
            "step": GRID_STEP,
            "common_widths": writer.widths.most_common(5),
            "offset_x": writer.frac_x.most_common(1)[0][0] if writer.frac_x else 0,
            "offset_y": writer.frac_y.most_common(1)[0][0] if writer.frac_y else 0,
        },
        "seconds": round(time.time() - t0),
    }
    json.dump(stats, open(args.stats, "w", encoding="utf-8"), indent=2)
    print(json.dumps(stats, indent=2), file=sys.stderr)

    # Contrôles : tout est arrivé, aucun opérateur inconnu en quantité.
    if writer.features < expected * 0.999:
        sys.exit(f"ERREUR : {writer.features} zones reçues pour {expected} annoncées")
    if sum(writer.unknown_cif.values()) > expected * 0.001:
        sys.exit(f"ERREUR : opérateurs inconnus {dict(writer.unknown_cif)}")
    widths = [w for w, _ in writer.widths.most_common(3)]
    if widths and not any(abs(w - GRID_STEP) < 2e-7 for w in widths):
        print(f"ATTENTION : pas de grille inattendu {widths} (attendu {GRID_STEP})", file=sys.stderr)


if __name__ == "__main__":
    main()
