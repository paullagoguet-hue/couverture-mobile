"""Définition des couches de couverture (opérateur × technologie).

Source unique de vérité pour le pipeline : `discover.py` s'en sert pour trouver
les fichiers Arcep, `build_layer.sh` (via le manifeste) pour les traiter.

Nomenclature Arcep des fichiers métropole :
    <AAAA>_T<n>_couv_Metropole_<CODE_OPERATEUR>_<TECHNO>_<USAGE>.gpkg.7z
cf. https://data.arcep.fr/mobile/couvertures_theoriques/documentation_couverture.md
"""

from dataclasses import dataclass

# Opérateurs métropolitains. Les codes Arcep ont changé au fil du temps
# (SFR -> SFR0, BYT -> BOUY) : on accepte les deux, le plus récent d'abord.
OPERATORS = {
    "orange": {"label": "Orange", "codes": ["OF"], "mcc_mnc": "20801"},
    "sfr": {"label": "SFR", "codes": ["SFR0", "SFR"], "mcc_mnc": "20810"},
    "bouygues": {"label": "Bouygues Telecom", "codes": ["BOUY", "BYT"], "mcc_mnc": "20820"},
    "free": {"label": "Free Mobile", "codes": ["FREE"], "mcc_mnc": "20815"},
}

# Technologies publiées. `levels` indique si l'Arcep fournit des niveaux
# de qualité (TBC / BC / CL) ; vérifié sur les fichiers 2025_T4 / 2026_T2.
TECHNOS = {
    "2g": {"label": "2G (voix)", "arcep": "2G", "usage": "voix", "levels": True},
    "2g3g": {"label": "2G/3G (voix)", "arcep": "2G3G", "usage": "voix", "levels": True},
    "3g": {"label": "3G (data)", "arcep": "3G", "usage": "data", "levels": False},
    "4g": {"label": "4G (data)", "arcep": "4G", "usage": "data", "levels": True},
    "5g": {"label": "5G (data)", "arcep": "5G", "usage": "data", "levels": False},
}

# Couches volontairement exclues.
EXCLUDED = {
    # L'Arcep ne publie plus la carte 2G de Free Mobile depuis 2024_T4
    # (service 2G non accessible par défaut lors des tests de vérification).
    ("free", "2g"),
}

# Niveaux de couverture définis par l'Arcep (du meilleur au moins bon).
LEVELS = ["TBC", "BC", "CL"]


@dataclass(frozen=True)
class Layer:
    operator: str
    techno: str

    @property
    def id(self) -> str:
        return f"{self.operator}-{self.techno}"


def all_layers() -> list[Layer]:
    return [
        Layer(op, tech)
        for op in OPERATORS
        for tech in TECHNOS
        if (op, tech) not in EXCLUDED
    ]


def parse_layer_id(layer_id: str) -> Layer:
    op, _, tech = layer_id.partition("-")
    layer = Layer(op, tech)
    if layer not in all_layers():
        valid = ", ".join(l.id for l in all_layers())
        raise ValueError(f"Couche inconnue : {layer_id!r}. Valeurs possibles : {valid}")
    return layer
