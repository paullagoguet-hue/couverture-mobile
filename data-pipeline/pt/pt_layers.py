"""Couches de couverture mobile pour le Portugal.

Source : ANACOM (régulateur), portail GEO.ANACOM, service ArcGIS public
« CoberturaQoS_Pub » : une couche raster par opérateur et techno, dont chaque
pixel (grille de 100 m) porte une classe de débit estimé. Pas de
téléchargement direct : on reconstitue les rasters à partir des images du
service (export), couleur par couleur (cf. download_pt.py).
"""

SERVICE = "https://geo.anacom.pt/server/rest/services/publico/CoberturaQoS_Pub/MapServer"

PRODUCER = "ANACOM — Autoridade Nacional de Comunicações"
DATASET = "GEO.ANACOM — Cobertura das redes móveis"
DATASET_URL = "https://geo.anacom.pt/publico/home"

# Opérateurs (ordre d'affichage) et identifiants des couches du service.
OPERATORS = {
    "meo": {"label": "MEO", "layers": {"4g": 176, "5g": 177}},
    "nos": {"label": "NOS", "layers": {"4g": 180, "5g": 181}},
    "vodafone": {"label": "Vodafone", "layers": {"4g": 186, "5g": 187}},
    "digi": {"label": "DIGI", "layers": {"4g": 171, "5g": 172}},
}

TECHNOS = {"4g": "4G", "5g": "5G"}

# Classes de débit : couleur du service (RVB) -> code de classe et débit minimal (Mbit/s).
# « Não disponível » est transparent.
CLASSES = [
    # (code, rvb, débit minimal)
    (1, (230, 0, 0), 0),  # > 0 Mbit/s
    (2, (255, 170, 0), 2),
    (3, (255, 255, 0), 30),
    (4, (126, 213, 0), 100),
    (5, (28, 193, 218), 300),
    (6, (223, 115, 255), 1000),  # 5G seulement
]

# Zones exportées : (projection, emprise xmin, ymin, xmax, ymax, taille de pixel).
#  - continent : grille d'origine de 100 m calée sur PT-TM06 (EPSG:3763) : pixels
#    exportés alignés sur cette grille, donc identiques à l'original ;
#  - îles : grille inconnue, exportées à 25 m en WGS84 (sur-échantillonnage).
REGIONS = {
    "continent": (3763, -120000, -310000, 180000, 290000, 100),
    "madere": (4326, -17.35, 32.35, -16.20, 33.15, 0.00025),
    "acores": (4326, -31.35, 36.85, -24.95, 39.80, 0.0003),
}

MAX_IMAGE = 4096  # taille maximale d'une image du service
