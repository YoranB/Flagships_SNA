import pandas as pd

from .config import CLEANED_APPLICANTS, INPUT_ORG_EDGES, INPUT_PERSON_EDGES, READY_APPLICANTS
from .text_utils import clean_text, is_placeholder_email, normalize_for_id, simplify_institution, split_semicolon_values


def make_person_id(row):
    email = clean_text(row["email"]).lower()
    name_key = normalize_for_id(row["person_name_clean"])
    if is_placeholder_email(email):
        return f"{email or 'missing-email'}|{row['flagship_id']}|{name_key}"
    return email

def add_person_ids(applicants):
    applicants = applicants.copy()
    applicants["email"] = applicants["email"].str.lower()
    applicants["person_id"] = applicants.apply(make_person_id, axis=1)
    applicants["is_placeholder_id"] = applicants["email"].apply(is_placeholder_email)
    return applicants

def build_edge_id_lookup(applicants):
    lookup = {}

    def set_if_unique(key, values):
        values = sorted(set(v for v in values if v))
        if len(values) == 1:
            lookup[key] = values[0]

    grouped = applicants.groupby(["email", "flagship_id", "person_name_clean"], dropna=False)["person_id"]
    for (email, flagship_id, name), ids in grouped:
        lookup[("email_flagship_name", email, flagship_id, normalize_for_id(name))] = ids.iloc[0]

    grouped = applicants.groupby(["email", "flagship_id"], dropna=False)["person_id"]
    for (email, flagship_id), ids in grouped:
        set_if_unique(("email_flagship", email, flagship_id), ids)

    grouped = applicants.groupby(["email", "person_name_clean"], dropna=False)["person_id"]
    for (email, name), ids in grouped:
        set_if_unique(("email_name", email, normalize_for_id(name)), ids)

    grouped = applicants[~applicants["is_placeholder_id"]].groupby("email", dropna=False)["person_id"]
    for email, ids in grouped:
        set_if_unique(("email", email), ids)

    return lookup

def resolve_edge_person_id(row, side, lookup):
    email = clean_text(row[side]).lower()
    name = clean_text(row.get(f"{side}_name", ""))
    flagship_ids = split_semicolon_values(row.get("flagships", ""))
    flagship_id = flagship_ids[0] if flagship_ids else ""

    candidates = [
        ("email_flagship_name", email, flagship_id, normalize_for_id(name)),
        ("email_flagship", email, flagship_id),
        ("email_name", email, normalize_for_id(name)),
        ("email", email),
    ]

    for candidate in candidates:
        if candidate in lookup:
            return lookup[candidate]

    if is_placeholder_email(email):
        return f"{email or 'missing-email'}|{flagship_id or 'unknown-flagship'}|{normalize_for_id(name)}"
    return email

def load_data():
    applicants_path = CLEANED_APPLICANTS if CLEANED_APPLICANTS.exists() else READY_APPLICANTS
    applicants = pd.read_csv(applicants_path, dtype=str).fillna("")
    person_edges = pd.read_csv(INPUT_PERSON_EDGES, dtype=str).fillna("")
    org_edges = pd.read_csv(INPUT_ORG_EDGES, dtype=str).fillna("")

    for df in [applicants, person_edges, org_edges]:
        for col in df.columns:
            df[col] = df[col].apply(clean_text)

    if "institution_raw" not in applicants.columns:
        applicants["institution_raw"] = applicants["institution"]
    if "institution_clean" not in applicants.columns:
        applicants["institution_clean"] = applicants["institution"].apply(simplify_institution)
    if "department_raw" not in applicants.columns:
        applicants["department_raw"] = applicants.get("department", "")
    if "department_clean" not in applicants.columns:
        applicants["department_clean"] = applicants.get("department", "")
    if "department_group" not in applicants.columns:
        applicants["department_group"] = applicants["department_clean"].where(applicants["department_clean"] != "", "Unknown")
    if "department_tokens" not in applicants.columns:
        applicants["department_tokens"] = ""

    applicants["institution_simplified"] = applicants["institution_clean"]
    applicants = add_person_ids(applicants)

    person_edges["weight"] = pd.to_numeric(person_edges["weight"], errors="coerce").fillna(1)
    lookup = build_edge_id_lookup(applicants)
    person_edges["source_id"] = person_edges.apply(lambda row: resolve_edge_person_id(row, "source", lookup), axis=1)
    person_edges["target_id"] = person_edges.apply(lambda row: resolve_edge_person_id(row, "target", lookup), axis=1)

    return applicants, person_edges, org_edges
