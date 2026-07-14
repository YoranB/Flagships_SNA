from collections import defaultdict
from itertools import combinations
from pathlib import Path

import pandas as pd

from ..config import INPUT_CONVERGENCE_CALLS_XLSX
from ..text_utils import clean_text, normalize_for_id
from .manual_programs import role_weight


SOURCE_NAMESPACE = "convergence-openmind-impuls"
CALLS = {
    "Open Mind": ("open-mind", "Open Mind Call"),
    "Impuls": ("impuls", "Impuls Call"),
}
REQUIRED_SHEETS = {
    "Projects_clean": {
        "project_uid", "call_name", "project_type", "title", "theme", "summary",
        "network_ready", "source_files", "data_quality",
    },
    "People_clean": {
        "person_uid", "full_name", "email", "position", "institution",
        "faculty_or_department", "source_files", "raw_notes", "data_quality",
    },
    "Person_Project_Edges": {
        "edge_uid", "person_uid", "project_uid", "roles", "source_files", "notes",
    },
}


def empty_bundle():
    return {
        "projects": pd.DataFrame(),
        "people": pd.DataFrame(),
        "memberships": pd.DataFrame(),
        "quality": pd.DataFrame(),
    }


def _clean_frame(frame):
    frame = frame.fillna("").copy()
    for column in frame.columns:
        frame[column] = frame[column].apply(clean_text)
    return frame


def read_convergence_workbook(path=INPUT_CONVERGENCE_CALLS_XLSX):
    path = Path(path)
    if not path.exists():
        return empty_bundle()

    bundle = {}
    with pd.ExcelFile(path) as workbook:
        missing_sheets = sorted(set(REQUIRED_SHEETS) - set(workbook.sheet_names))
        if missing_sheets:
            raise ValueError(f"Missing sheets in {path}: {', '.join(missing_sheets)}")

        sheet_to_key = {
            "Projects_clean": "projects",
            "People_clean": "people",
            "Person_Project_Edges": "memberships",
        }
        for sheet, required_columns in REQUIRED_SHEETS.items():
            frame = _clean_frame(pd.read_excel(workbook, sheet_name=sheet, dtype=str))
            missing_columns = sorted(required_columns - set(frame.columns))
            if missing_columns:
                raise ValueError(f"Missing columns in {path} [{sheet}]: {', '.join(missing_columns)}")
            bundle[sheet_to_key[sheet]] = frame

        bundle["quality"] = (
            _clean_frame(pd.read_excel(workbook, sheet_name="Data_Quality", dtype=str))
            if "Data_Quality" in workbook.sheet_names
            else pd.DataFrame()
        )

    projects = bundle["projects"]
    people = bundle["people"]
    memberships = bundle["memberships"]
    unknown_calls = sorted(set(projects["call_name"]) - set(CALLS))
    if unknown_calls:
        raise ValueError(f"Unsupported calls in {path}: {', '.join(unknown_calls)}")
    if not projects["project_uid"].is_unique:
        raise ValueError(f"Duplicate project_uid values in {path} [Projects_clean]")
    if not people["person_uid"].is_unique:
        raise ValueError(f"Duplicate person_uid values in {path} [People_clean]")
    if not memberships["edge_uid"].is_unique:
        raise ValueError(f"Duplicate edge_uid values in {path} [Person_Project_Edges]")

    missing_projects = sorted(set(memberships["project_uid"]) - set(projects["project_uid"]))
    missing_people = sorted(set(memberships["person_uid"]) - set(people["person_uid"]))
    if missing_projects or missing_people:
        parts = []
        if missing_projects:
            parts.append(f"unknown project refs: {', '.join(missing_projects[:8])}")
        if missing_people:
            parts.append(f"unknown person refs: {', '.join(missing_people[:8])}")
        raise ValueError(f"Broken references in {path}: {'; '.join(parts)}")
    return bundle


def _join_sources(*values):
    sources = []
    for value in values:
        for item in clean_text(value).split(";"):
            item = item.strip()
            if item and item not in sources:
                sources.append(item)
    return "; ".join(sources)


def build_convergence_applicants(bundle):
    if bundle["memberships"].empty:
        return pd.DataFrame()

    projects = bundle["projects"].rename(columns={
        "source_files": "project_source_files",
        "data_quality": "project_data_quality",
    })
    people = bundle["people"].rename(columns={
        "source_files": "person_source_files",
        "data_quality": "person_data_quality",
    })
    memberships = bundle["memberships"].rename(columns={"source_files": "membership_source_files"})
    merged = memberships.merge(projects, on="project_uid", how="left", validate="many_to_one")
    merged = merged.merge(people, on="person_uid", how="left", validate="many_to_one")

    rows = []
    for _, row in merged.iterrows():
        call_id, call_name = CALLS[row["call_name"]]
        person_quality = clean_text(row.get("person_data_quality", ""))
        project_quality = clean_text(row.get("project_data_quality", ""))
        rows.append({
            "call_id": call_id,
            "call_name": call_name,
            "proposal_id": row["project_uid"],
            "flagship_id": row["project_uid"],
            "proposal_title": row["title"],
            "flagship_title": row["title"],
            "source_project_id": row.get("source_project_id", ""),
            "project_type": row.get("project_type", ""),
            "project_theme": row.get("theme", ""),
            "project_summary": row.get("summary", ""),
            "project_network_ready": row.get("network_ready", ""),
            "program_description": row.get("summary", ""),
            "source_person_uid": row["person_uid"],
            "source_namespace": SOURCE_NAMESPACE,
            "dashboard_project_node": "false",
            "person_name_raw": row["full_name"],
            "person_name_clean": row["full_name"],
            "institution": row.get("institution", ""),
            "department": row.get("faculty_or_department", ""),
            "email": clean_text(row.get("email", "")).lower(),
            "position": row.get("position", ""),
            "role": row.get("roles", ""),
            "extraction_method": "structured_convergence_workbook",
            "confidence": "source_cleaned",
            "source_file": _join_sources(
                row.get("membership_source_files", ""),
                row.get("project_source_files", ""),
                row.get("person_source_files", ""),
            ),
            "page": "",
            "raw_row": row.get("notes", "") or row.get("raw_notes", ""),
            "data_quality": "; ".join(value for value in [person_quality, project_quality] if value),
        })
    return pd.DataFrame(rows)


def load_convergence_applicants(path=INPUT_CONVERGENCE_CALLS_XLSX):
    return build_convergence_applicants(read_convergence_workbook(path))


def append_convergence_applicants(applicants, path=INPUT_CONVERGENCE_CALLS_XLSX):
    imported = load_convergence_applicants(path)
    if imported.empty:
        return applicants.copy()
    columns = list(applicants.columns) + [column for column in imported.columns if column not in applicants.columns]
    return pd.concat(
        [applicants.reindex(columns=columns), imported.reindex(columns=columns)],
        ignore_index=True,
    ).fillna("")


def build_convergence_person_edges(applicants):
    if "source_namespace" not in applicants.columns:
        return pd.DataFrame()
    imported = applicants[applicants["source_namespace"] == SOURCE_NAMESPACE].copy()
    if imported.empty:
        return pd.DataFrame()

    rows = []
    for proposal_key, group in imported.groupby("proposal_key"):
        people = group.drop_duplicates("source_person_uid").to_dict("records")
        for left, right in combinations(people, 2):
            rows.append({
                "source": left.get("email", ""),
                "target": right.get("email", ""),
                "source_name": left.get("person_name_clean", ""),
                "target_name": right.get("person_name_clean", ""),
                "source_institution": left.get("institution_clean", left.get("institution", "")),
                "target_institution": right.get("institution_clean", right.get("institution", "")),
                "source_department": left.get("department_clean", left.get("department", "")),
                "target_department": right.get("department_clean", right.get("department", "")),
                "relation_type": "project_co_participant",
                "weight": role_weight(left.get("role", ""), right.get("role", "")),
                "flagships": left["proposal_id"],
                "flagship_titles": left["proposal_title"],
                "proposal_ids": left["proposal_id"],
                "proposal_keys": proposal_key,
                "call_ids": left["call_id"],
                "call_names": left["call_name"],
            })
    return pd.DataFrame(rows)


def build_project_catalog(bundle):
    records = []
    linked_projects = set(bundle["memberships"]["project_uid"]) if not bundle["memberships"].empty else set()
    for _, row in bundle["projects"].iterrows():
        call_id, call_name = CALLS[row["call_name"]]
        records.append({
            "id": row["project_uid"],
            "call_id": call_id,
            "call_name": call_name,
            "title": row["title"],
            "project_type": row.get("project_type", ""),
            "theme": row.get("theme", ""),
            "summary": row.get("summary", ""),
            "network_ready": row["project_uid"] in linked_projects,
            "n_people": int((bundle["memberships"]["project_uid"] == row["project_uid"]).sum()),
            "data_quality": row.get("data_quality", ""),
        })
    return records


def _person_call_lookup(bundle):
    project_calls = {
        row["project_uid"]: CALLS[row["call_name"]][0]
        for _, row in bundle["projects"].iterrows()
    }
    lookup = defaultdict(set)
    for _, row in bundle["memberships"].iterrows():
        lookup[row["person_uid"]].add(project_calls[row["project_uid"]])
    return lookup


def build_import_quality(bundle):
    if bundle["projects"].empty:
        return {"source": SOURCE_NAMESPACE, "totals": {}, "by_call": {}, "unresolved_projects": []}

    person_calls = _person_call_lookup(bundle)
    people_by_id = bundle["people"].set_index("person_uid").to_dict("index")
    linked_people = set(bundle["memberships"]["person_uid"])
    linked_projects = set(bundle["memberships"]["project_uid"])
    by_call = {}
    for source_name, (call_id, call_name) in CALLS.items():
        call_projects = set(bundle["projects"].loc[bundle["projects"]["call_name"] == source_name, "project_uid"])
        call_people = {person_id for person_id, calls in person_calls.items() if call_id in calls}
        by_call[call_id] = {
            "call_name": call_name,
            "projects": len(call_projects),
            "network_projects": len(call_projects & linked_projects),
            "people": len(call_people),
            "missing_email": sum(not clean_text(people_by_id[person_id].get("email", "")) for person_id in call_people),
            "fallback_identities": sum(not clean_text(people_by_id[person_id].get("email", "")) for person_id in call_people),
            "unknown_institution": sum(not clean_text(people_by_id[person_id].get("institution", "")) for person_id in call_people),
            "institution_conflicts": sum("conflict" in clean_text(people_by_id[person_id].get("data_quality", "")).lower() for person_id in call_people),
            "possible_duplicates": 0,
            "unlinked_projects": len(call_projects - linked_projects),
        }

    quality = bundle["quality"]
    if not quality.empty and "issue_type" in quality:
        for _, row in quality[quality["issue_type"] == "possible_duplicate_name"].iterrows():
            identifiers = [item.strip() for item in clean_text(row.get("current_value", "")).split(";") if item.strip()]
            calls = set()
            for identifier in identifiers:
                person_uid = f"email:{identifier.lower()}" if "@" in identifier and not identifier.startswith("email:") else identifier
                calls.update(person_calls.get(person_uid, set()))
            for call_id in calls:
                by_call[call_id]["possible_duplicates"] += 1

    unresolved = []
    for _, row in bundle["projects"].iterrows():
        if row["project_uid"] in linked_projects:
            continue
        call_id, call_name = CALLS[row["call_name"]]
        unresolved.append({
            "id": row["project_uid"],
            "call_id": call_id,
            "call_name": call_name,
            "title": row["title"],
            "issue": row.get("data_quality", "") or "No linked people",
        })

    return {
        "source": SOURCE_NAMESPACE,
        "totals": {
            "projects": int(len(bundle["projects"])),
            "network_projects": int(len(linked_projects)),
            "memberships": int(len(bundle["memberships"])),
            "source_people": int(len(bundle["people"])),
            "linked_people": int(len(linked_people)),
            "unlinked_people": int(len(bundle["people"]) - len(linked_people)),
        },
        "by_call": by_call,
        "unresolved_projects": unresolved,
    }


def load_convergence_dashboard_metadata(path=INPUT_CONVERGENCE_CALLS_XLSX):
    bundle = read_convergence_workbook(path)
    return build_project_catalog(bundle), build_import_quality(bundle)
