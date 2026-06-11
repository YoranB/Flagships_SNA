from collections import OrderedDict

import pandas as pd

from .config import INPUT_MANUAL_EXPERTISE, OUT_PERSON_EXPERTISE
from .text_utils import clean_text, split_semicolon_values


ONLINE_COLUMNS = [
    "person_id",
    "person_name",
    "institution",
    "department",
    "profile_url",
    "expertise_keywords",
    "expertise_summary",
    "source_type",
    "confidence",
    "last_checked",
    "match_notes",
    "manual_override",
]

MANUAL_COLUMNS = [
    "person_id",
    "person_name",
    "expertise_keywords",
    "expertise_summary",
    "source_note",
    "confidence",
    "edited_at",
]

EMPTY_EXPERTISE = {
    "expertise_keywords": "",
    "expertise_summary": "",
    "expertise_source_url": "",
    "expertise_source_type": "",
    "expertise_confidence": "",
    "expertise_last_checked": "",
    "expertise_manual_note": "",
    "expertise_origin": "",
}


def normalize_keywords(value):
    seen = OrderedDict()
    for keyword in split_semicolon_values(value):
        key = keyword.lower()
        if key and key not in seen:
            seen[key] = keyword
    return "; ".join(seen.values())


def merge_keywords(*values):
    return normalize_keywords("; ".join(clean_text(value) for value in values if clean_text(value)))


def read_optional_csv(path, columns):
    if not path.exists():
        return pd.DataFrame(columns=columns)
    data = pd.read_csv(path, dtype=str).fillna("")
    for column in columns:
        if column not in data.columns:
            data[column] = ""
    return data[columns].copy()


def truthy(value):
    return clean_text(value).lower() in {"1", "true", "yes", "ja", "y"}


def load_expertise_map():
    online = read_optional_csv(OUT_PERSON_EXPERTISE, ONLINE_COLUMNS)
    manual = read_optional_csv(INPUT_MANUAL_EXPERTISE, MANUAL_COLUMNS)
    expertise = {}

    for _, row in online.iterrows():
        person_id = clean_text(row["person_id"])
        if not person_id:
            continue
        has_online = bool(clean_text(row["expertise_keywords"]) or clean_text(row["expertise_summary"]) or clean_text(row["profile_url"]))
        expertise[person_id] = {
            "expertise_keywords": normalize_keywords(row["expertise_keywords"]),
            "expertise_summary": clean_text(row["expertise_summary"]),
            "expertise_source_url": clean_text(row["profile_url"]),
            "expertise_source_type": clean_text(row["source_type"]),
            "expertise_confidence": clean_text(row["confidence"]),
            "expertise_last_checked": clean_text(row["last_checked"]),
            "expertise_manual_note": "",
            "expertise_origin": "online_enriched" if has_online else "",
            "_manual_override": truthy(row.get("manual_override", "")),
        }

    for _, row in manual.iterrows():
        person_id = clean_text(row["person_id"])
        if not person_id:
            continue
        current = expertise.get(person_id, EMPTY_EXPERTISE.copy())
        online_exists = current.get("expertise_origin") == "online_enriched"
        manual_keywords = normalize_keywords(row["expertise_keywords"])
        manual_summary = clean_text(row["expertise_summary"])
        manual_confidence = clean_text(row["confidence"])
        manual_note = clean_text(row["source_note"])
        edited_at = clean_text(row["edited_at"])

        expertise[person_id] = {
            "expertise_keywords": merge_keywords(current.get("expertise_keywords", ""), manual_keywords),
            "expertise_summary": manual_summary or current.get("expertise_summary", ""),
            "expertise_source_url": current.get("expertise_source_url", ""),
            "expertise_source_type": "manual" if not online_exists else current.get("expertise_source_type", ""),
            "expertise_confidence": manual_confidence or current.get("expertise_confidence", ""),
            "expertise_last_checked": current.get("expertise_last_checked", ""),
            "expertise_manual_note": manual_note,
            "expertise_origin": "online_plus_manual" if online_exists else "manual",
            "_manual_override": True,
            "_manual_edited_at": edited_at,
        }

    for item in expertise.values():
        item.pop("_manual_override", None)
        item.pop("_manual_edited_at", None)

    return expertise


def empty_expertise():
    return EMPTY_EXPERTISE.copy()
