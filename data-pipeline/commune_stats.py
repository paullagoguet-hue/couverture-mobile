#!/usr/bin/env python3
"""Part de la surface de chaque commune couverte, par niveau, pour une couche.

La donnée Arcep est un raster de 50 m vectorisé (sommets sur une grille de
50 m, vérifié sur les GeoPackages) : on la rastérise sur cette même grille, en
Lambert-93, ce qui est exact, ainsi que les communes. Puis on compte, bloc par
bloc, les pixels de chaque niveau dans chaque commune.

Contours des communes : Etalab « contours administratifs » (issus d'ADMIN
EXPRESS, IGN), version simplifiée à 50 m, Licence Ouverte. Arrondissements
municipaux (Paris, Lyon, Marseille) et DROM exclus : la commune entière suffit
et le périmètre est la métropole.

Usage : python3 commune_stats.py <couverture.gpkg> <table> <colonne_geom> <sortie.csv> <dossier_cache>
Sortie CSV : code,nom,pixels,cl,bc,tbc  (5G et autres couches sans niveau : tout en « tbc »)
"""

import csv
import sys
import urllib.request
from pathlib import Path

import numpy as np
from osgeo import gdal, ogr

gdal.UseExceptions()

COMMUNES_URL = "https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2026/geojson/communes-50m.geojson.gz"

# Grille : métropole en Lambert-93, alignée sur des multiples de 50 m comme la donnée Arcep.
RES = 50
XMIN, YMIN, XMAX, YMAX = 50_000, 6_030_000, 1_250_000, 7_130_000

# Arrondissements municipaux : en double avec la commune entière (75056, 69123, 13055).
ARRONDISSEMENTS = "code BETWEEN '75101' AND '75120' OR code BETWEEN '69381' AND '69389' OR code BETWEEN '13201' AND '13216'"


def prepare_communes(cache: Path) -> tuple[Path, list[tuple[str, str]]]:
    """Télécharge (une fois) les communes, les passe en Lambert-93 et les numérote."""
    cache.mkdir(parents=True, exist_ok=True)
    gz = cache / "communes-50m.geojson.gz"
    gpkg = cache / "communes-l93.gpkg"
    if not gz.exists():
        urllib.request.urlretrieve(COMMUNES_URL, gz)
    if not gpkg.exists():
        src = gdal.OpenEx(f"/vsigzip/{gz}", gdal.OF_VECTOR)
        name = src.GetLayer(0).GetName()  # nom attribué par le pilote GeoJSON
        gdal.VectorTranslate(
            str(gpkg), src, format="GPKG", dstSRS="EPSG:2154", layerName="communes",
            SQLDialect="SQLite",
            SQLStatement=f"SELECT * FROM \"{name}\" WHERE code NOT LIKE '97%' AND NOT ({ARRONDISSEMENTS})",
        )
    ds = ogr.Open(str(gpkg))
    layer = ds.GetLayer("communes")
    # Index = FID (1..N, 0 = hors commune) ; on garde la correspondance FID -> code.
    codes = {f.GetFID(): (f.GetField("code"), f.GetField("nom")) for f in layer}
    if not 30_000 < len(codes) < 36_000:
        sys.exit(f"Nombre de communes inattendu : {len(codes)}")
    max_fid = max(codes)
    return gpkg, [codes.get(i, ("", "")) for i in range(max_fid + 1)]


def rasterize(dst: Path, src: str, sql: str, output_type: int):
    gdal.Rasterize(
        str(dst), src, format="GTiff", outputType=output_type,
        outputBounds=[XMIN, YMIN, XMAX, YMAX], xRes=RES, yRes=RES, outputSRS="EPSG:2154",
        SQLStatement=sql, attribute="v", initValues=0,
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=IF_SAFER"],
    )


def main():
    cover_gpkg, table, geom_col, out_csv, cache = sys.argv[1:6]
    cache = Path(cache)
    communes_gpkg, codes = prepare_communes(cache)

    communes_tif = cache / "communes.tif"
    if not communes_tif.exists():
        rasterize(communes_tif, str(communes_gpkg), "SELECT geom, fid AS v FROM communes", gdal.GDT_Int32)

    # Couverture : 3 = TBC (ou couvert sans niveau), 2 = BC, 1 = CL, 0 = rien.
    # Le GeoPackage Arcep déclare un SRS « maison » équivalent à Lambert-93 :
    # la transformation vers EPSG:2154 est l'identité.
    cover_tif = cache / "couverture.tif"
    rasterize(
        cover_tif, cover_gpkg,
        f"SELECT \"{geom_col}\", CASE niveau WHEN 'BC' THEN 2 WHEN 'CL' THEN 1 ELSE 3 END AS v FROM \"{table}\"",
        gdal.GDT_Byte,
    )

    # Comptage par blocs de lignes : (commune, niveau) -> nombre de pixels.
    c_ds, v_ds = gdal.Open(str(communes_tif)), gdal.Open(str(cover_tif))
    c_band, v_band = c_ds.GetRasterBand(1), v_ds.GetRasterBand(1)
    width, height = c_ds.RasterXSize, c_ds.RasterYSize
    n = len(codes)
    counts = np.zeros(n * 4, dtype=np.int64)
    for y in range(0, height, 512):
        rows = min(512, height - y)
        c = c_band.ReadAsArray(0, y, width, rows).astype(np.int64).ravel()
        v = v_band.ReadAsArray(0, y, width, rows).astype(np.int64).ravel()
        counts += np.bincount(c * 4 + v, minlength=n * 4)
    counts = counts.reshape(n, 4)

    covered_total = int(counts[1:, 1:].sum())
    if covered_total == 0:
        sys.exit("Aucun pixel couvert : rastérisation de la couverture en échec ?")

    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["code", "nom", "pixels", "cl", "bc", "tbc"])
        for idx in range(1, n):
            code, nom = codes[idx]
            total = int(counts[idx].sum())
            if code and total:
                w.writerow([code, nom, total, *map(int, counts[idx, 1:])])
    print(f"{out_csv} : {n - 1} communes, {covered_total * RES * RES / 1e6:.0f} km² couverts", file=sys.stderr)


if __name__ == "__main__":
    main()
