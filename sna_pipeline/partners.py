import pandas as pd

from .config import INPUT_PARTNERS_XLSX, OUT_PARTNERS_CLEANED
from .text_utils import compact_spaces, normalize_for_id


PARTNER_COLUMNS = [
    "source_row",
    "flagship_id",
    "flagship_title_raw",
    "partner_id",
    "partner_name",
    "partner_category",
    "partner_category_raw",
    "collaboration_types",
    "collaboration_type_raw",
    "start_year",
    "end_year",
    "reporting_period",
    "role_relevance",
]

COLLABORATION_ORDER = [
    "Onderzoek",
    "Co-creatie",
    "Onderwijs",
    "Beleid",
    "Contractresearch",
    "Implementatie",
    "Netwerk",
    "Valorisatie",
    "Data / biobanken",
    "Preventie",
    "Advisory",
]


def find_column(columns, exact=None, startswith=None):
    if exact:
        for column in columns:
            if column == exact:
                return column
    if startswith:
        for column in columns:
            if column.startswith(startswith):
                return column
    raise KeyError(f"Could not find expected partner column: {exact or startswith}")


def clean_year(value):
    text = compact_spaces(value)
    if not text:
        return ""
    if text.endswith(".0"):
        text = text[:-2]
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) >= 4:
        return digits[:4]
    return text


def clean_project_code(value):
    text = compact_spaces(value)
    if text.endswith(".0"):
        text = text[:-2]
    return text


def normalize_category(value):
    text = compact_spaces(value)
    if not text:
        return "Unknown"
    low = text.lower()
    if low == "privaat":
        return "Privaat"
    if low in {"publiek / maatschappelijk", "publiek/maatschappelijk"}:
        return "Publiek / Maatschappelijk"
    return text


def canonical_collaboration_types(value):
    text = compact_spaces(value)
    if not text:
        return []
    low = text.lower()
    matches = []
    checks = [
        ("Onderzoek", ["onderzoek", "r&d", "translatie"]),
        ("Co-creatie", ["co-creatie", "co-cre", "cocreatie"]),
        ("Onderwijs", ["onderwijs", "gastcollege", "stage", "curriculum"]),
        ("Beleid", ["beleid", "beleids", "beleidsdialoog"]),
        ("Contractresearch", ["contractresearch"]),
        ("Implementatie", ["implementatie", "commercialisatie"]),
        ("Netwerk", ["netwerk"]),
        ("Valorisatie", ["valorisatie", "funding"]),
        ("Data / biobanken", ["data", "biobank"]),
        ("Preventie", ["preventie"]),
        ("Advisory", ["advisory", "advies"]),
    ]
    for canonical, tokens in checks:
        if any(token in low for token in tokens):
            matches.append(canonical)
    if matches:
        order = {name: idx for idx, name in enumerate(COLLABORATION_ORDER)}
        return sorted(set(matches), key=lambda item: order.get(item, len(order)))
    return [text]


def empty_partners_frame():
    return pd.DataFrame(columns=PARTNER_COLUMNS)


def clean_partner_records(raw):
    raw = raw.fillna("").copy()
    for column in raw.columns:
        raw[column] = raw[column].apply(compact_spaces)

    columns = list(raw.columns)
    collaboration_column = find_column(columns, startswith="Type samenwerking")
    role_column = find_column(columns, startswith="Rol en relevantie")
    period_column = find_column(columns, startswith="Rapportage periode")

    records = []
    for idx, row in raw.iterrows():
        partner_name = compact_spaces(row["Naam partner"])
        flagship_id = clean_project_code(row["Meta_Project_Code"])
        collaboration_raw = compact_spaces(row[collaboration_column])
        collaboration_types = canonical_collaboration_types(collaboration_raw)
        records.append({
            "source_row": int(idx) + 2,
            "flagship_id": flagship_id,
            "flagship_title_raw": compact_spaces(row["Flagship"]),
            "partner_id": f"partner:{normalize_for_id(partner_name)}",
            "partner_name": partner_name,
            "partner_category": normalize_category(row["Categorie partner"]),
            "partner_category_raw": compact_spaces(row["Categorie partner"]),
            "collaboration_types": "; ".join(collaboration_types),
            "collaboration_type_raw": collaboration_raw,
            "start_year": clean_year(row["Startjaar"]),
            "end_year": clean_year(row["Eindjaar"]),
            "reporting_period": compact_spaces(row[period_column]),
            "role_relevance": compact_spaces(row[role_column]),
        })

    cleaned = pd.DataFrame(records, columns=PARTNER_COLUMNS)
    cleaned = cleaned[
        (cleaned["flagship_id"] != "") &
        (cleaned["partner_name"] != "")
    ].copy()
    return cleaned


def load_partners():
    if INPUT_PARTNERS_XLSX.exists():
        raw = pd.read_excel(INPUT_PARTNERS_XLSX, sheet_name="Partners", dtype=str)
        cleaned = clean_partner_records(raw)
        OUT_PARTNERS_CLEANED.parent.mkdir(exist_ok=True)
        cleaned.to_csv(OUT_PARTNERS_CLEANED, index=False, encoding="utf-8-sig")
        return cleaned

    if OUT_PARTNERS_CLEANED.exists():
        return pd.read_csv(OUT_PARTNERS_CLEANED, dtype=str).fillna("")

    return empty_partners_frame()
