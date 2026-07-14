from itertools import combinations
from pathlib import Path

import pandas as pd

from ..config import INPUT_MANUAL_SUSTAINABLE_HEALTH_PROGRAMS
from ..text_utils import clean_text, normalize_for_id


SUSTAINABLE_HEALTH_CALL_ID = "sustainable-health-programs"
SUSTAINABLE_HEALTH_CALL_NAME = "Sustainable Health Programs (SHP)"
MANUAL_EXTRACTION_METHOD = "manual_sustainable_health_programs"
MANUAL_CONFIDENCE = "verified_manual"
MANUAL_SOURCE_FILE = "manual:sustainable_health_programs"

MANUAL_PROGRAM_COLUMNS = [
    "call_id",
    "call_name",
    "proposal_id",
    "flagship_id",
    "proposal_title",
    "flagship_title",
    "program_description",
    "person_name_raw",
    "person_name_clean",
    "institution",
    "department",
    "email",
    "position",
    "role",
    "extraction_method",
    "confidence",
    "source_file",
    "page",
    "raw_row",
]

MANUAL_PROGRAM_DEFAULTS = {
    "call_id": SUSTAINABLE_HEALTH_CALL_ID,
    "call_name": SUSTAINABLE_HEALTH_CALL_NAME,
    "role": "Lead",
    "extraction_method": MANUAL_EXTRACTION_METHOD,
    "confidence": MANUAL_CONFIDENCE,
    "source_file": MANUAL_SOURCE_FILE,
}


def make_manual_proposal_key(call_id, proposal_id):
    return f"{clean_text(call_id)}::{clean_text(proposal_id)}"


def manual_identity_key(row):
    email = clean_text(row.get("email", "")).lower()
    if email:
        return email
    return normalize_for_id(row.get("person_name_clean", row.get("person_name_raw", "")))


def empty_manual_applicants():
    return pd.DataFrame(columns=MANUAL_PROGRAM_COLUMNS)


def load_manual_applicants(path=INPUT_MANUAL_SUSTAINABLE_HEALTH_PROGRAMS):
    path = Path(path)
    if not path.exists():
        return empty_manual_applicants()

    manual = pd.read_csv(path, dtype=str).fillna("")
    missing = [column for column in MANUAL_PROGRAM_COLUMNS if column not in manual.columns]
    if missing:
        raise ValueError(f"Missing columns in {path}: {', '.join(missing)}")

    manual = manual[MANUAL_PROGRAM_COLUMNS].copy()
    for column in manual.columns:
        manual[column] = manual[column].apply(clean_text)

    for column, default in MANUAL_PROGRAM_DEFAULTS.items():
        manual[column] = manual[column].replace("", default)
    manual["call_id"] = SUSTAINABLE_HEALTH_CALL_ID
    manual["call_name"] = SUSTAINABLE_HEALTH_CALL_NAME

    manual["email"] = manual["email"].str.lower()
    manual["proposal_id"] = manual["proposal_id"].where(manual["proposal_id"] != "", manual["flagship_id"])
    manual["flagship_id"] = manual["flagship_id"].where(manual["flagship_id"] != "", manual["proposal_id"])
    manual["proposal_title"] = manual["proposal_title"].where(manual["proposal_title"] != "", manual["flagship_title"])
    manual["flagship_title"] = manual["flagship_title"].where(manual["flagship_title"] != "", manual["proposal_title"])
    manual["person_name_clean"] = manual["person_name_clean"].where(
        manual["person_name_clean"] != "",
        manual["person_name_raw"],
    )
    manual["raw_row"] = manual.apply(build_raw_row, axis=1)
    manual["_identity_key"] = manual.apply(manual_identity_key, axis=1)
    manual = manual.drop_duplicates(subset=["proposal_id", "_identity_key"], keep="first")
    return manual.drop(columns=["_identity_key"]).reset_index(drop=True)


def build_raw_row(row):
    if clean_text(row.get("raw_row", "")):
        return row["raw_row"]
    return " | ".join(
        value
        for value in [
            row.get("proposal_title", ""),
            row.get("person_name_clean", ""),
            row.get("institution", ""),
            row.get("department", ""),
            row.get("email", ""),
            row.get("position", ""),
            row.get("role", ""),
        ]
        if clean_text(value)
    )


def append_manual_applicants(applicants, manual_applicants=None):
    manual = load_manual_applicants() if manual_applicants is None else manual_applicants
    if manual.empty:
        return applicants.copy()

    columns = list(applicants.columns) + [column for column in manual.columns if column not in applicants.columns]
    return pd.concat(
        [
            applicants.reindex(columns=columns),
            manual.reindex(columns=columns),
        ],
        ignore_index=True,
    ).fillna("")


def role_weight(role_a, role_b):
    role_a = clean_text(role_a).lower()
    role_b = clean_text(role_b).lower()
    weight = 1
    if "lead" in role_a or "lead" in role_b:
        weight = 2
    if "main" in role_a or "main" in role_b or "project lead" in role_a or "project lead" in role_b:
        weight = 3
    return weight


def manual_program_rows(applicants):
    if "call_id" not in applicants.columns:
        return empty_manual_applicants()
    return applicants[applicants["call_id"] == SUSTAINABLE_HEALTH_CALL_ID].copy()


def build_manual_person_edges(applicants):
    manual = manual_program_rows(applicants)
    rows = []

    if manual.empty:
        return pd.DataFrame(columns=[
            "source",
            "target",
            "source_name",
            "target_name",
            "source_institution",
            "target_institution",
            "source_department",
            "target_department",
            "relation_type",
            "weight",
            "flagships",
            "flagship_titles",
            "source_files",
            "proposal_ids",
            "call_ids",
            "call_names",
            "proposal_keys",
        ])

    for _, group in manual.groupby("proposal_key"):
        people = group[
            [
                "person_name_clean",
                "email",
                "institution",
                "department",
                "role",
                "proposal_id",
                "proposal_key",
                "flagship_title",
                "source_file",
                "call_id",
                "call_name",
            ]
        ].copy()
        people["_identity_key"] = people.apply(manual_identity_key, axis=1)
        people = people.drop_duplicates(subset=["_identity_key"]).to_dict("records")

        for person_a, person_b in combinations(people, 2):
            rows.append({
                "source": person_a["email"],
                "target": person_b["email"],
                "source_name": person_a["person_name_clean"],
                "target_name": person_b["person_name_clean"],
                "source_institution": person_a["institution"],
                "target_institution": person_b["institution"],
                "source_department": person_a["department"],
                "target_department": person_b["department"],
                "relation_type": "co_applicant",
                "weight": role_weight(person_a["role"], person_b["role"]),
                "flagships": person_a["proposal_id"],
                "flagship_titles": person_a["flagship_title"],
                "source_files": person_a["source_file"],
                "proposal_ids": person_a["proposal_id"],
                "call_ids": person_a["call_id"],
                "call_names": person_a["call_name"],
                "proposal_keys": person_a["proposal_key"],
            })

    return pd.DataFrame(rows)


def build_manual_org_edges(applicants):
    manual = manual_program_rows(applicants)
    rows = []

    for _, row in manual.iterrows():
        rows.append({
            "source": row["email"],
            "target": row["institution"],
            "source_name": row["person_name_clean"],
            "department": row["department"],
            "flagship_id": row["flagship_id"],
            "flagship_title": row["flagship_title"],
            "proposal_id": row["proposal_id"],
            "proposal_title": row["proposal_title"],
            "proposal_key": row.get("proposal_key", make_manual_proposal_key(row["call_id"], row["proposal_id"])),
            "call_id": row["call_id"],
            "call_name": row["call_name"],
            "role": row["role"],
            "source_file": row["source_file"],
            "relation_type": "affiliated_with",
            "weight": 1,
        })

    return pd.DataFrame(rows)
