#!/usr/bin/env python3
"""KML (zones couvertes) -> GeoJSONSeq, lu au fil de l'eau.

Les cartes de l'ACCC dépassent 500 Mo : le lecteur KML de GDAL les charge en
mémoire. Ici, chaque polygone est écrit dès qu'il est lu (anneau extérieur et
trous), sans attribut.

    python3 kml2geojsons.py couverture.kml sortie.geojsons
"""

import json
import sys
import xml.etree.ElementTree as ET


def ring(text):
    pts = []
    for tok in text.split():
        parts = tok.split(",")
        if len(parts) >= 2:
            pts.append([round(float(parts[0]), 6), round(float(parts[1]), 6)])
    if len(pts) >= 3 and pts[0] != pts[-1]:
        pts.append(pts[0])
    return pts if len(pts) >= 4 else None


def local(tag):
    return tag.rsplit("}", 1)[-1]


def main():
    src, dest = sys.argv[1], sys.argv[2]
    n = 0
    with open(dest, "w", encoding="utf-8") as out:
        for _, el in ET.iterparse(src, events=("end",)):
            if local(el.tag) != "Polygon":
                continue
            outer, holes = None, []
            for child in el:
                kind = local(child.tag)
                coords = next((c for c in child.iter() if local(c.tag) == "coordinates"), None)
                if coords is None or not coords.text:
                    continue
                r = ring(coords.text)
                if r is None:
                    continue
                if kind == "outerBoundaryIs":
                    outer = r
                elif kind == "innerBoundaryIs":
                    holes.append(r)
            el.clear()
            if outer:
                out.write(json.dumps({"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [outer, *holes]}}, separators=(",", ":")) + "\n")
                n += 1
    print(f"{src} : {n} polygones", file=sys.stderr)


if __name__ == "__main__":
    main()
