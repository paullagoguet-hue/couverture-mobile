#!/usr/bin/env python3
"""Part de la surface de chaque commune couverte, par niveau, pour une couche.

La donnée Arcep est un raster de 50 m vectorisé (sommets sur une grille de
50 m, vérifié sur les GeoPackages) : on la rastérise sur cette même grille, en
Lambert-93, ce qui est exact, ainsi que les communes. Puis on compte, bloc par
bloc, les pixels de chaque niveau dans chaque commune.

Contours des communes : Etalab « contours administratifs » (issus d'ADMIN
EXPRESS, IGN), version simplifiée à 50 m, Licence Ouverte. Arrondissements
municipaux (Paris, Lyon, Marseille) et DROM exclus : la commune entière suffit
et le périmètre est la métropole (DROM 97x et collectivités 98x exclus).

Population : Insee, Filosofi 2019, données carroyées à 200 m (variable « ind »,
y compris valeurs imputées), Licence Ouverte. Chaque carreau est réparti sur
16 points de 50 m, projetés en Lambert-93 : on compte ainsi les HABITANTS
couverts, pas seulement la surface (les sommets et forêts vides ne pèsent rien).

Usage : python3 commune_stats.py <couverture.gpkg> <table> <colonne_geom> <sortie.csv> <dossier_cache>
Sortie CSV : code,nom,pixels,cl,bc,tbc,pop,pop_cl,pop_bc,pop_tbc
  (5G et autres couches sans niveau : tout en « tbc »)
"""

import csv
import re
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from osgeo import gdal, ogr
from pyproj import Transformer

gdal.UseExceptions()

COMMUNES_URL = "https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2026/geojson/communes-50m.geojson.gz"

POPULATION_URL = "https://www.insee.fr/fr/statistiques/fichier/7655475/Filosofi2019_carreaux_200m_csv.zip"

# Grille : métropole en Lambert-93, alignée sur des multiples de 50 m comme la donnée Arcep.
RES = 50
XMIN, YMIN, XMAX, YMAX = 50_000, 6_030_000, 1_250_000, 7_130_000

# Arrondissements municipaux : en double avec la commune entière (75056, 69123, 13055).
ARRONDISSEMENTS = "code BETWEEN '75101' AND '75120' OR code BETWEEN '69381' AND '69389' OR code BETWEEN '13201' AND '13216'"


def prepare_communes(cache: Path) -> tuple[Path, str, list[tuple[str, str]]]:
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
            SQLStatement=f"SELECT * FROM \"{name}\" WHERE code NOT LIKE '97%' AND code NOT LIKE '98%' AND NOT ({ARRONDISSEMENTS})",
        )
    ds = ogr.Open(str(gpkg))
    layer = ds.GetLayer("communes")
    # Noms des colonnes géométrie et identifiant tels que créés par GDAL (pas de supposition).
    # « fid + 0 » : un simple alias serait traité comme identifiant, pas comme champ à rastériser.
    sql = f'SELECT "{layer.GetGeometryColumn()}", "{layer.GetFIDColumn() or "fid"}" + 0 AS v FROM communes'
    # Index = FID (1..N, 0 = hors commune) ; on garde la correspondance FID -> code.
    codes = {f.GetFID(): (f.GetField("code"), f.GetField("nom")) for f in layer}
    if not 30_000 < len(codes) < 36_000:
        sys.exit(f"Nombre de communes inattendu : {len(codes)}")
    max_fid = max(codes)
    return gpkg, sql, [codes.get(i, ("", "")) for i in range(max_fid + 1)]


def prepare_population(cache: Path, width: int) -> tuple[np.ndarray, np.ndarray]:
    """Habitants par pixel de 50 m : (index de pixel trié, poids), mis en cache."""
    out = cache / "population.npz"
    if out.exists():
        d = np.load(out)
        return d["idx"], d["w"]
    csv_path = cache / "carreaux_200m_met.csv"
    if not csv_path.exists():
        zip_path = cache / "filosofi.zip"
        urllib.request.urlretrieve(POPULATION_URL, zip_path)
        with zipfile.ZipFile(zip_path) as z:  # zip -> archive 7z -> CSV
            seven = z.extract(next(n for n in z.namelist() if n.endswith(".7z")), cache)
        subprocess.run(["7z", "e", "-y", f"-o{cache}", seven, "carreaux_200m_met.csv"], check=True, stdout=subprocess.DEVNULL)

    # Identifiant « CRS3035RES200mN2029800E4252400 » : coin sud-ouest en EPSG:3035.
    pattern = re.compile(r"N(\d+)E(\d+)")
    xs, ys, pops = [], [], []
    with open(csv_path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            m = pattern.search(row["idcar_200m"])
            xs.append(int(m.group(2)))
            ys.append(int(m.group(1)))
            pops.append(float(row["ind"]))
    x0, y0, pop = np.array(xs, float), np.array(ys, float), np.array(pops, np.float32)
    total = float(pop.sum())
    if not 55e6 < total < 70e6:
        sys.exit(f"Population totale inattendue : {total:.0f}")

    # 16 sous-points par carreau (centres des cases de 50 m), chacun 1/16 de la population.
    off = 25 + 50 * np.arange(4)
    dx, dy = np.meshgrid(off, off)
    px = (x0[:, None] + dx.ravel()).ravel()
    py = (y0[:, None] + dy.ravel()).ravel()
    w = np.repeat(pop / 16, 16)
    lx, ly = Transformer.from_crs("EPSG:3035", "EPSG:2154", always_xy=True).transform(px, py)
    col = np.floor((lx - XMIN) / RES).astype(np.int64)
    row = np.floor((YMAX - ly) / RES).astype(np.int64)
    ok = (col >= 0) & (col < width) & (row >= 0) & (row < (YMAX - YMIN) // RES)
    idx, w = row[ok] * width + col[ok], w[ok]
    order = np.argsort(idx, kind="stable")
    idx, w = idx[order], w[order]
    np.savez(out, idx=idx, w=w)
    print(f"population : {total / 1e6:.1f} M habitants, {len(x0)} carreaux", file=sys.stderr)
    return idx, w


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
    communes_gpkg, communes_sql, codes = prepare_communes(cache)

    communes_tif = cache / "communes.tif"
    if not communes_tif.exists():
        rasterize(communes_tif, str(communes_gpkg), communes_sql, gdal.GDT_Int32)

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
    pop_idx, pop_w = prepare_population(cache, width)
    counts = np.zeros(n * 4, dtype=np.int64)
    pop_counts = np.zeros(n * 4, dtype=np.float64)
    for y in range(0, height, 512):
        rows = min(512, height - y)
        c = c_band.ReadAsArray(0, y, width, rows).astype(np.int64).ravel()
        v = v_band.ReadAsArray(0, y, width, rows).astype(np.int64).ravel()
        key = c * 4 + v
        counts += np.bincount(key, minlength=n * 4)
        # Habitants situés dans ce bloc de lignes (index triés : simple tranche).
        lo, hi = np.searchsorted(pop_idx, [y * width, (y + rows) * width])
        local = pop_idx[lo:hi] - y * width
        pop_counts += np.bincount(key[local], weights=pop_w[lo:hi], minlength=n * 4)
    counts = counts.reshape(n, 4)
    pop_counts = pop_counts.reshape(n, 4)

    covered_total = int(counts[1:, 1:].sum())
    if covered_total == 0:
        sys.exit("Aucun pixel couvert : rastérisation de la couverture en échec ?")

    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["code", "nom", "pixels", "cl", "bc", "tbc", "pop", "pop_cl", "pop_bc", "pop_tbc"])
        for idx in range(1, n):
            code, nom = codes[idx]
            total = int(counts[idx].sum())
            if code and total:
                pop = pop_counts[idx]
                w.writerow([code, nom, total, *map(int, counts[idx, 1:]), *(round(float(x), 1) for x in (pop.sum(), *pop[1:]))])
    print(f"{out_csv} : {n - 1} communes, {covered_total * RES * RES / 1e6:.0f} km² couverts, "
          f"{pop_counts[1:, 1:].sum() / pop_counts[1:].sum():.1%} des habitants couverts", file=sys.stderr)


if __name__ == "__main__":
    main()
