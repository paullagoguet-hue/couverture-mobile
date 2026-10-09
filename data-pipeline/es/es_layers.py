"""Couches de couverture mobile pour l'Espagne.

Source : « Mapa de servicios de banda ancha » du ministère espagnol pour la
Transformation numérique (Secretaría de Estado de Telecomunicaciones), publiée
sur ArcGIS Online. Chaque zone (cellules d'une grille d'environ 38 x 28 m)
porte dans le champ COBERTURA la liste des opérateurs qui la couvrent,
identifiés par leur numéro fiscal (CIF), séparés par « ; ».
"""

SERVICE_ROOT = "https://services-eu1.arcgis.com/3LqdsBPalJaUFvo1/arcgis/rest/services"

PRODUCER = "Ministerio para la Transformación Digital y de la Función Pública (Secretaría de Estado de Telecomunicaciones)"
DATASET = "Mapa de servicios de banda ancha — cobertura móvil"
DATASET_URL = "https://digital.gob.es/telecomunicaciones-infraestructuras-digitales/areas-interes/banda-ancha/informacion-cobertura/mapas-servicios-banda-ancha"

# Opérateurs de réseau (ordre d'affichage). Orange et Yoigo (Xfera) appartiennent
# au groupe MasOrange depuis 2024 mais leurs réseaux sont déclarés séparément.
OPERATORS = {
    "movistar": {"label": "Movistar", "cif": "A78923125", "company": "Telefónica Móviles España"},
    "vodafone": {"label": "Vodafone", "cif": "A80907397", "company": "Vodafone España"},
    "orange": {"label": "Orange", "cif": "A82009812", "company": "Orange Espagne"},
    "yoigo": {"label": "Yoigo", "cif": "A82528548", "company": "Xfera Móviles"},
}

TECHNOS = {
    "4g": {"label": "4G", "service": "InfoCob4G_2024", "year": "2025"},
    "5g": {"label": "5G", "service": "InfoCob5G_2025", "year": "2025"},
}

# Zones rasterisées séparément (les Canaries sont loin de la péninsule) :
# lon_min, lat_min, lon_max, lat_max. La péninsule inclut les Baléares, Ceuta et Melilla.
REGIONS = {
    "peninsule": (-9.6, 35.1, 4.6, 44.0),
    "canaries": (-18.4, 27.4, -13.2, 29.6),
}

# Pas de la grille source, en degrés (mesuré sur les données, cf. download.py).
GRID_STEP = 0.00034612


def service_url(techno: str) -> str:
    return f"{SERVICE_ROOT}/{TECHNOS[techno]['service']}/FeatureServer/0"
