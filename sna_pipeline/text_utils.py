import math
import re

import pandas as pd


UNKNOWN_TEXT_VALUES = {
    "",
    "-",
    "n a",
    "na",
    "none",
    "not available",
    "not applicable",
    "null",
    "onbekend",
    "unknown",
}


def clean_text(value):
    if pd.isna(value):
        return ""
    return str(value).strip()

def compact_spaces(value):
    return re.sub(r"\s+", " ", clean_text(value))

def is_unknown_text(value):
    normalized = re.sub(r"[^a-z0-9]+", " ", compact_spaces(value).lower()).strip()
    return normalized in UNKNOWN_TEXT_VALUES

def normalize_for_id(value):
    value = compact_spaces(value).lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "unknown"

def split_semicolon_values(value):
    return [part.strip() for part in clean_text(value).split(";") if part.strip()]

def is_placeholder_email(value):
    value = clean_text(value).lower()
    if not value or "@" not in value:
        return True
    local = value.split("@", 1)[0]
    return bool(re.fullmatch(r"-?\d+", local))

def simplify_institution(value):
    value = compact_spaces(value)
    if is_unknown_text(value):
        return "Unknown"

    low = value.lower()
    low_clean = re.sub(r"[^a-z0-9]+", " ", low).strip()
    low_compact = re.sub(r"[^a-z0-9]+", "", low)
    padded = f" {low_clean} "

    def contains_phrase(phrase):
        return f" {phrase} " in padded

    has_emc = any(contains_phrase(phrase) for phrase in ["erasmus mc", "erasmusmc", "eramsus mc", "emc"])

    has_tud = any(
        contains_phrase(phrase)
        for phrase in [
            "tu delft",
            "tudelft",
            "delft university of technology",
            "tud",
        ]
    )

    has_eur = any(
        contains_phrase(phrase)
        for phrase in [
            "erasmus university rotterdam",
            "erasmus university",
            "erasmus universiteit",
            "eshpm",
            "eur",
            "erasmus u",
            "erasmus ur",
        ]
    )

    if low_clean in {"emc", "erasmus mc", "erasmusmc", "eramsus mc"} or low_compact in {"erasmusmc", "eramsusmc"}:
        return "Erasmus MC"
    if low_clean in {
        "tud",
        "tu delft",
        "tudelft",
        "tu delft tud",
        "delft university of technology",
    }:
        return "TU Delft"
    if low_clean in {
        "eur",
        "eshpm",
        "erasmus",
        "erasmus u",
        "erasmus university",
        "erasmus universiteit",
        "erasmus university rotterdam",
        "erasmus ur",
    }:
        return "Erasmus University Rotterdam"
    if low_clean in {"eur emc", "emc eur"}:
        return "Multiple core institutions"

    matches = [has_emc, has_tud, has_eur]
    if sum(matches) > 1:
        return "Multiple core institutions"
    if has_emc:
        return "Erasmus MC"
    if has_tud:
        return "TU Delft"
    if has_eur:
        return "Erasmus University Rotterdam"

    return value

def institution_units(value):
    """Return the explicit institution units represented by a raw affiliation."""
    value = compact_spaces(value)
    if is_unknown_text(value):
        return ["Unknown"]

    low_clean = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    padded = f" {low_clean} "

    def contains_any(phrases):
        return any(f" {phrase} " in padded for phrase in phrases)

    units = []
    if contains_any(["erasmus mc", "erasmusmc", "eramsus mc", "emc"]):
        units.append("Erasmus MC")
    if contains_any(["tu delft", "tudelft", "delft university of technology", "tud"]):
        units.append("TU Delft")
    if contains_any([
        "erasmus university rotterdam",
        "erasmus university",
        "erasmus universiteit",
        "eshpm",
        "eur",
        "erasmus u",
        "erasmus ur",
    ]):
        units.append("Erasmus University Rotterdam")

    if units:
        return list(dict.fromkeys(units))
    return [simplify_institution(value)]

def choose_display_name(names):
    values = [compact_spaces(v) for v in names if compact_spaces(v)]
    if not values:
        return ""

    def score(value):
        base = re.sub(r"\s*\([^)]*\)", "", value).strip()
        tokens = base.split()
        initial_tokens = sum(1 for token in tokens if "." in token or re.fullmatch(r"[A-Z]\.?", token))
        lower = value.lower()
        return (
            len(tokens) > 1,
            "(" not in value and "wp" not in lower,
            -initial_tokens,
            len(base),
            -len(value),
        )

    best = sorted(values, key=lambda item: (score(item), item.lower()), reverse=True)[0]
    return re.sub(r"\s*\([^)]*\)", "", best).strip()

def choose_institution(values):
    cleaned = [compact_spaces(v) for v in values if compact_spaces(v)]
    if not cleaned:
        return "Unknown"
    counts = pd.Series(cleaned).value_counts()
    top_count = counts.iloc[0]
    tied = sorted(counts[counts == top_count].index)
    for institution in ["Erasmus MC", "TU Delft", "Erasmus University Rotterdam", "Multiple core institutions"]:
        if institution in tied:
            return institution
    return tied[0]

def safe_float(value, default=0.0):
    if value is None:
        return default
    try:
        if math.isnan(value):
            return default
    except TypeError:
        pass
    return float(value)
