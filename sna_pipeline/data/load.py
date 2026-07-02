import pandas as pd

from ..config import CLEANED_APPLICANTS, INPUT_ORG_EDGES, INPUT_PERSON_EDGES, READY_APPLICANTS
from ..text_utils import clean_text, is_placeholder_email, normalize_for_id, simplify_institution, split_semicolon_values


DEFAULT_CALL_ID = "flagship"
DEFAULT_CALL_NAME = "Flagship Call"


def ensure_call_columns(df, default_call_id=DEFAULT_CALL_ID, default_call_name=DEFAULT_CALL_NAME):
    df = df.copy()
    if "call_id" not in df.columns:
        df["call_id"] = default_call_id
    if "call_name" not in df.columns:
        df["call_name"] = default_call_name

    df["call_id"] = df["call_id"].apply(clean_text).replace("", default_call_id)
    df["call_name"] = df["call_name"].apply(clean_text).replace("", default_call_name)
    return df


def ensure_proposal_columns(df):
    df = df.copy()
    if "proposal_id" not in df.columns:
        if "flagship_id" in df.columns:
            df["proposal_id"] = df["flagship_id"]
        else:
            df["proposal_id"] = ""
    df["proposal_id"] = df["proposal_id"].apply(clean_text)
    return df


def repeat_value_for_items(value, items):
    count = max(1, len(items))
    return "; ".join([value] * count)


def ensure_person_edge_call_columns(person_edges):
    person_edges = person_edges.copy()
    if "proposal_ids" not in person_edges.columns:
        person_edges["proposal_ids"] = person_edges.get("flagships", "")
    person_edges["proposal_ids"] = person_edges["proposal_ids"].apply(clean_text)

    if "call_ids" not in person_edges.columns:
        person_edges["call_ids"] = person_edges["proposal_ids"].apply(
            lambda value: repeat_value_for_items(DEFAULT_CALL_ID, split_semicolon_values(value))
        )
    if "call_names" not in person_edges.columns:
        person_edges["call_names"] = person_edges["proposal_ids"].apply(
            lambda value: repeat_value_for_items(DEFAULT_CALL_NAME, split_semicolon_values(value))
        )

    person_edges["call_ids"] = person_edges["call_ids"].apply(clean_text).replace("", DEFAULT_CALL_ID)
    person_edges["call_names"] = person_edges["call_names"].apply(clean_text).replace("", DEFAULT_CALL_NAME)
    return person_edges


def make_person_id(row):
    email = clean_text(row["email"]).lower()
    name_key = normalize_for_id(row["person_name_clean"])
    if is_placeholder_email(email):
        call_id = clean_text(row.get("call_id", DEFAULT_CALL_ID)) or DEFAULT_CALL_ID
        proposal_id = clean_text(row.get("proposal_id", row.get("flagship_id", ""))) or "unknown-proposal"
        return f"{email or 'missing-email'}|{call_id}|{proposal_id}|{name_key}"
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

    grouped = applicants.groupby(["email", "call_id", "proposal_id", "person_name_clean"], dropna=False)["person_id"]
    for (email, call_id, proposal_id, name), ids in grouped:
        lookup[("email_call_proposal_name", email, call_id, proposal_id, normalize_for_id(name))] = ids.iloc[0]

    grouped = applicants.groupby(["email", "call_id", "proposal_id"], dropna=False)["person_id"]
    for (email, call_id, proposal_id), ids in grouped:
        set_if_unique(("email_call_proposal", email, call_id, proposal_id), ids)

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
    proposal_ids = split_semicolon_values(row.get("proposal_ids", ""))
    proposal_id = proposal_ids[0] if proposal_ids else flagship_id
    call_ids = split_semicolon_values(row.get("call_ids", ""))
    call_id = call_ids[0] if call_ids else DEFAULT_CALL_ID

    candidates = [
        ("email_call_proposal_name", email, call_id, proposal_id, normalize_for_id(name)),
        ("email_call_proposal", email, call_id, proposal_id),
        ("email_flagship_name", email, flagship_id, normalize_for_id(name)),
        ("email_flagship", email, flagship_id),
        ("email_name", email, normalize_for_id(name)),
        ("email", email),
    ]

    for candidate in candidates:
        if candidate in lookup:
            return lookup[candidate]

    if is_placeholder_email(email):
        return f"{email or 'missing-email'}|{call_id or DEFAULT_CALL_ID}|{proposal_id or 'unknown-proposal'}|{normalize_for_id(name)}"
    return email

def load_data():
    applicants_path = CLEANED_APPLICANTS if CLEANED_APPLICANTS.exists() else READY_APPLICANTS
    applicants = pd.read_csv(applicants_path, dtype=str).fillna("")
    person_edges = pd.read_csv(INPUT_PERSON_EDGES, dtype=str).fillna("")
    org_edges = pd.read_csv(INPUT_ORG_EDGES, dtype=str).fillna("")

    for df in [applicants, person_edges, org_edges]:
        for col in df.columns:
            df[col] = df[col].apply(clean_text)

    applicants = ensure_call_columns(applicants)
    applicants = ensure_proposal_columns(applicants)
    org_edges = ensure_call_columns(org_edges)
    org_edges = ensure_proposal_columns(org_edges)
    person_edges = ensure_person_edge_call_columns(person_edges)

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
