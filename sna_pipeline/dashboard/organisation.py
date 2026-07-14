from collections import defaultdict

from ..text_utils import clean_text, split_semicolon_values


def _value(value, default="Unknown"):
    return clean_text(value) or default


def build_proposal_records(applicants):
    proposals = []
    for proposal_key, group in applicants.groupby("proposal_key", sort=False):
        first = group.iloc[0]
        proposals.append({
            "id": _value(proposal_key),
            "proposal_id": _value(first.get("proposal_id", first.get("flagship_id", ""))),
            "title": _value(first.get("proposal_title", first.get("flagship_title", ""))),
            "call_id": _value(first.get("call_id", "")),
            "call_name": _value(first.get("call_name", "")),
            "theme": clean_text(first.get("project_theme", "")),
            "summary": clean_text(first.get("project_summary", first.get("program_description", ""))),
            "dashboard_project_node": clean_text(first.get("dashboard_project_node", "")).lower() != "false",
            "n_people": int(group["person_id"].nunique()),
        })
    return sorted(proposals, key=lambda item: (item["call_name"].lower(), item["title"].lower()))


def _top_level_units(row):
    faculty = clean_text(row.get("faculty_clean", ""))
    if faculty and faculty.lower() != "unknown":
        return split_semicolon_values(faculty) or [faculty]
    return split_semicolon_values(row.get("institution_units", "")) or [_value(row.get("institution_clean", ""))]


def _department_units(row):
    return split_semicolon_values(row.get("department_units", "")) or [_value(row.get("department_group", ""))]


def build_participation_records(applicants):
    records = {}
    for _, row in applicants.iterrows():
        proposal_key = _value(row.get("proposal_key", ""))
        proposal_title = _value(row.get("proposal_title", row.get("flagship_title", "")))
        for institution in _top_level_units(row):
            for department in _department_units(row):
                record = {
                    "person_id": _value(row.get("person_id", "")),
                    "person_name": _value(row.get("person_name_clean", "")),
                    "institution": _value(institution),
                    "department": _value(department),
                    "proposal_key": proposal_key,
                    "proposal_id": _value(row.get("proposal_id", row.get("flagship_id", ""))),
                    "proposal_title": proposal_title,
                    "call_id": _value(row.get("call_id", "")),
                    "call_name": _value(row.get("call_name", "")),
                }
                key = (
                    record["person_id"],
                    record["institution"],
                    record["department"],
                    record["proposal_key"],
                    record["call_id"],
                )
                records[key] = record
    return sorted(
        records.values(),
        key=lambda item: (
            item["institution"].lower(),
            item["department"].lower(),
            item["person_name"].lower(),
            item["proposal_title"].lower(),
        ),
    )


def aggregate_participation(records):
    institutions = defaultdict(lambda: {"people": set(), "departments": set(), "proposals": {}, "calls": {}})
    departments = defaultdict(lambda: {"people": set(), "proposals": {}, "calls": {}})

    for record in records:
        proposal = {"id": record["proposal_key"], "title": record["proposal_title"]}
        call = {"id": record["call_id"], "name": record["call_name"]}
        institution = institutions[record["institution"]]
        institution["people"].add(record["person_id"])
        institution["departments"].add(record["department"])
        institution["proposals"][proposal["id"]] = proposal
        institution["calls"][call["id"]] = call

        department = departments[(record["institution"], record["department"])]
        department["people"].add(record["person_id"])
        department["proposals"][proposal["id"]] = proposal
        department["calls"][call["id"]] = call

    institution_rows = [{
        "institution": name,
        "n_people": len(values["people"]),
        "n_departments": len(values["departments"]),
        "n_proposals": len(values["proposals"]),
        "n_calls": len(values["calls"]),
        "person_ids": sorted(values["people"]),
        "departments": sorted(values["departments"]),
        "proposals": sorted(values["proposals"].values(), key=lambda item: item["title"].lower()),
        "calls": sorted(values["calls"].values(), key=lambda item: item["name"].lower()),
    } for name, values in institutions.items()]

    department_rows = [{
        "institution": institution,
        "department": name,
        "n_people": len(values["people"]),
        "n_proposals": len(values["proposals"]),
        "n_calls": len(values["calls"]),
        "person_ids": sorted(values["people"]),
        "proposals": sorted(values["proposals"].values(), key=lambda item: item["title"].lower()),
        "calls": sorted(values["calls"].values(), key=lambda item: item["name"].lower()),
    } for (institution, name), values in departments.items()]

    institution_rows.sort(key=lambda item: (-item["n_people"], item["institution"].lower()))
    department_rows.sort(key=lambda item: (-item["n_people"], item["department"].lower(), item["institution"].lower()))
    return {
        "institutions": institution_rows,
        "departments": department_rows,
        "summary": {
            "n_institutions": len(institution_rows),
            "n_departments": len({row["department"] for row in department_rows}),
            "n_people": len({record["person_id"] for record in records}),
            "n_proposals": len({record["proposal_key"] for record in records}),
            "n_calls": len({record["call_id"] for record in records}),
        },
    }


def build_organisation_participation(applicants):
    records = build_participation_records(applicants)
    return {"records": records, **aggregate_participation(records)}
