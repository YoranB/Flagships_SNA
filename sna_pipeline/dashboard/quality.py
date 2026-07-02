from ..text_utils import clean_text


def build_quality_summary(applicants, persons, edges, flagships):
    raw_institutions = sorted(set(applicants["institution"].dropna().map(clean_text)) - {""})
    simplified_institutions = sorted(set(applicants["institution_simplified"].dropna().map(clean_text)) - {""})
    raw_departments = sorted(set(applicants["department_raw"].dropna().map(clean_text)) - {""}) if "department_raw" in applicants else []
    department_groups = sorted(set(applicants["department_group"].dropna().map(clean_text)) - {""}) if "department_group" in applicants else []

    return {
        "people": len(persons),
        "edges": len(edges),
        "flagships": len(flagships),
        "placeholder_person_ids": int(sum(person["is_placeholder"] for person in persons)),
        "raw_institution_values": len(raw_institutions),
        "simplified_institution_values": len(simplified_institutions),
        "raw_department_values": len(raw_departments),
        "department_groups": len(department_groups),
        "raw_institution_examples": raw_institutions[:20],
    }, department_groups
