#!/usr/bin/env python3
"""Reconstitue le raster de couverture d'un opérateur portugais (4G ou 5G).

Le service de l'ANACOM ne permet que d'exporter des images : on les demande
par tuiles (4096 pixels au plus), alignées sur la grille d'origine, puis on
retraduit chaque couleur en classe de débit (cf. CLASSES). Une couleur
inconnue arrête le traitement (le service aurait changé de légende).

    python3 download_pt.py meo 5g out_dir stats.json
    python3 download_pt.py meo 5g out_dir stats.json --bbox=-100000,-115000,-75000,-95000   # essai (EPSG:3763)

Produit <out_dir>/<région>.tif : Byte, 0 = pas de couverture, 1..6 = classe.
"""

import argparse
import io
import json
import math
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from osgeo import gdal, osr

from pt_layers import CLASSES, MAX_IMAGE, OPERATORS, REGIONS, SERVICE

gdal.UseExceptions()
USER_AGENT = "couverture-mobile/1.0 (+https://github.com/paullagoguet-hue/couverture-mobile)"


def fetch(url: str, params: dict, attempts: int = 6) -> bytes:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    for i in range(attempts):
        try:
            req = urllib.request.Request(full, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as resp:
                body = resp.read()
                if not resp.headers.get("Content-Type", "").startswith("image/png"):
                    raise RuntimeError(f"réponse inattendue : {body[:200]!r}")
                return body
        except Exception as err:
            if i == attempts - 1:
                raise
            wait = 10 * 2**i
            print(f"  nouvel essai dans {wait} s ({err})", file=sys.stderr)
            time.sleep(wait)
    raise AssertionError


def classify(png: bytes, unknown: dict) -> np.ndarray:
    """Image RVBA -> classes (0 = transparent / non couvert)."""
    gdal.FileFromMemBuffer("/vsimem/tile.png", png)
    ds = gdal.Open("/vsimem/tile.png")
    rgba = np.stack([ds.GetRasterBand(b + 1).ReadAsArray() for b in range(4)]).astype(np.int16)
    ds = None
    gdal.Unlink("/vsimem/tile.png")
    out = np.zeros(rgba.shape[1:], dtype=np.uint8)
    opaque = rgba[3] > 0
    matched = np.zeros_like(opaque)
    for code, (r, g, b), _ in CLASSES:
        # Tolérance de quelques unités (arrondis de l'opacité 204/255).
        m = opaque & (np.abs(rgba[0] - r) <= 3) & (np.abs(rgba[1] - g) <= 3) & (np.abs(rgba[2] - b) <= 3)
        out[m] = code
        matched |= m
    left = opaque & ~matched
    if left.any():
        colors, counts = np.unique(rgba[:3, left].T, axis=0, return_counts=True)
        for c, n in zip(colors, counts):
            unknown[str(tuple(int(v) for v in c))] = unknown.get(str(tuple(int(v) for v in c)), 0) + int(n)
    return out


def region_raster(layer_id: int, name: str, sr: int, x0: float, y0: float, x1: float, y1: float, px: float, out_path: str, unknown: dict) -> dict:
    width, height = round((x1 - x0) / px), round((y1 - y0) / px)
    grid = np.zeros((height, width), dtype=np.uint8)
    cols, rows = math.ceil(width / MAX_IMAGE), math.ceil(height / MAX_IMAGE)
    for row in range(rows):
        for col in range(cols):
            c0, r0 = col * MAX_IMAGE, row * MAX_IMAGE
            w, h = min(MAX_IMAGE, width - c0), min(MAX_IMAGE, height - r0)
            # Ligne 0 du raster = bord nord.
            bx0, bx1 = x0 + c0 * px, x0 + (c0 + w) * px
            by1, by0 = y1 - r0 * px, y1 - (r0 + h) * px
            png = fetch(f"{SERVICE}/export", {
                "bbox": f"{bx0},{by0},{bx1},{by1}", "bboxSR": sr, "imageSR": sr,
                "size": f"{w},{h}", "format": "png32", "transparent": "true",
                "layers": f"show:{layer_id}", "dpi": 96, "f": "image",
            })
            tile = classify(png, unknown)
            if tile.shape != (h, w):
                raise RuntimeError(f"{name} : image {tile.shape} au lieu de {(h, w)}")
            grid[r0:r0 + h, c0:c0 + w] = tile
    drv = gdal.GetDriverByName("GTiff")
    ds = drv.Create(out_path, width, height, 1, gdal.GDT_Byte, ["COMPRESS=DEFLATE", "TILED=YES"])
    ds.SetGeoTransform((x0, px, 0, y1, 0, -px))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(sr)
    ds.SetProjection(srs.ExportToWkt())
    band = ds.GetRasterBand(1)
    band.WriteArray(grid)
    band.SetNoDataValue(0)
    ds = None
    counts = np.bincount(grid.ravel(), minlength=7)
    return {"tiles": rows * cols, "size": [width, height], "pixels_by_class": {str(i): int(counts[i]) for i in range(1, 7) if counts[i]}}


def data_quarter(layer_id: int) -> str | None:
    """Trimestre des données, lu dans un attribut du service (« Data da informação: 2026T2 »)."""
    params = {
        "geometry": "-9.1393,38.7223", "geometryType": "esriGeometryPoint", "sr": 4326,
        "layers": f"all:{layer_id}", "tolerance": 0, "mapExtent": "-9.2,38.7,-9.1,38.8",
        "imageDisplay": "400,400,96", "returnGeometry": "false", "f": "json",
    }
    req = urllib.request.Request(f"{SERVICE}/identify?{urllib.parse.urlencode(params)}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    for r in data.get("results", []):
        for key in r.get("attributes", {}):
            if "Data da informa" in key:
                return key.split(":")[-1].strip()  # « 2026T2 »
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("operator", choices=list(OPERATORS))
    ap.add_argument("techno", choices=["4g", "5g"])
    ap.add_argument("out_dir")
    ap.add_argument("stats")
    ap.add_argument("--bbox", help="essai : xmin,ymin,xmax,ymax en EPSG:3763 (continent seulement)")
    args = ap.parse_args()

    layer_id = OPERATORS[args.operator]["layers"][args.techno]
    regions = REGIONS
    if args.bbox:
        x0, y0, x1, y1 = (float(v) for v in args.bbox.split(","))
        regions = {"essai": (3763, x0, y0, x1, y1, 100)}

    t0 = time.time()
    unknown: dict = {}
    by_region = {}
    for name, (sr, x0, y0, x1, y1, px) in regions.items():
        print(f"{args.operator}-{args.techno} : {name}", file=sys.stderr)
        by_region[name] = region_raster(layer_id, name, sr, x0, y0, x1, y1, px, f"{args.out_dir}/{name}.tif", unknown)

    stats = {
        "operator": args.operator, "techno": args.techno, "layer_id": layer_id,
        "quarter": data_quarter(layer_id), "regions": by_region, "unknown_colors": unknown,
        "seconds": round(time.time() - t0),
    }
    json.dump(stats, open(args.stats, "w", encoding="utf-8"), indent=2)
    print(json.dumps(stats, indent=2), file=sys.stderr)
    total = sum(sum(r["pixels_by_class"].values()) for r in by_region.values())
    if sum(unknown.values()) > total * 0.001:
        sys.exit(f"ERREUR : couleurs inconnues {unknown} (légende du service modifiée ?)")


if __name__ == "__main__":
    main()
