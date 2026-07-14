import re
from pathlib import Path

import pandas as pd

from ..config import (
    CLEANED_APPLICANTS,
    CLEANED_FOLDER,
    OUT_DEPARTMENT_CLEANING_REPORT,
    OUT_INSTITUTION_CLEANING_REPORT,
    OUT_UNMAPPED_DEPARTMENTS,
    READY_APPLICANTS,
)
from ..text_utils import clean_text, compact_spaces, simplify_institution
from .manual_programs import append_manual_applicants
from .convergence_calls import append_convergence_applicants


KNOWN_DEPARTMENT_PATTERNS = [
    (r"\bradiology\s+and\s+nuclear\s+medicine\b", "Radiology and Nuclear Medicine"),
    (r"\bbiomechanical\s+engineering\b", "Biomechanical Engineering"),
    (r"\bbiomedical\s+engineering\b", "Biomedical Engineering"),
    (r"\bdelft\s+center\s+for\s+systems\s+and\s+control\b", "Delft Center for Systems and Control"),
    (r"\berasmus\s+school\s+of\s+health\s+policy\s+and\s+management\b", "Erasmus School of Health Policy and Management"),
    (r"\bneuroscience\b", "Neuroscience"),
    (r"\bneurosurgery\b", "Neurosurgery"),
    (r"\bneurology\b", "Neurology"),
    (r"\borthopaedics?\b", "Orthopaedics"),
    (r"\borthopedic\s+surgery\b", "Orthopaedic Surgery"),
    (r"\borthopaedic\s+surgery\b", "Orthopaedic Surgery"),
    (r"\binternal\s+medicine\b", "Internal Medicine"),
    (r"\bimmunology\b", "Immunology"),
    (r"\bcardiology\b", "Cardiology"),
    (r"\bsurgery\b", "Surgery"),
    (r"\bpublic\s+health\b", "Public Health"),
    (r"\bgeneral\s+practice\b", "General Practice"),
    (r"\bmedical\s+informatics\b", "Medical Informatics"),
    (r"\bclinical\s+genetics\b", "Clinical Genetics"),
    (r"\bpathology\b", "Pathology"),
    (r"\bpharmacy\b", "Pharmacy"),
    (r"\bpsychiatry\b", "Psychiatry"),
    (r"\bpsychology\b", "Psychology"),
    (r"\brheumatology\b", "Rheumatology"),
    (r"\burology\b", "Urology"),
]

CANONICAL_DEPARTMENTS = {canonical for _, canonical in KNOWN_DEPARTMENT_PATTERNS}

OCR_FIXES = {
    "neuroscie nce": "neuroscience",
    "systems &control": "systems and control",
    "systems andcontrol": "systems and control",
    "health policy & management": "health policy and management",
}


def normalize_department_text(value):
    text = compact_spaces(value)
    if not text:
        return ""

    text = text.replace("\n", " ").replace("\r", " ")
    text = re.sub(r"\s*&\s*", " and ", text)
    text = re.sub(r"\s+", " ", text).strip()

    low = text.lower()
    for source, target in OCR_FIXES.items():
        low = low.replace(source, target)

    low = re.sub(r"\bdept\.?\s+(of\s+)?", "", low)
    low = re.sub(r"\bdepartment\s+of\s+", "", low)
    low = re.sub(r"\bsection\s+of\s+", "", low)
    low = re.sub(r"\bsection\s+", "", low)
    low = re.sub(r"\s*/\s*", " / ", low)
    low = re.sub(r"\s*;\s*", "; ", low)
    low = re.sub(r"\s*,\s*", ", ", low)
    low = re.sub(r"\s+", " ", low).strip(" ,;")

    return low


def title_department(value):
    small_words = {"and", "of", "for", "in", "the", "to", "with"}
    acronyms = {"ai", "ic", "icu", "mri", "ct", "chmc", "umc", "emc", "ehr", "or"}
    words = []
    for token in re.split(r"(\W+)", value):
        if not token or re.fullmatch(r"\W+", token):
            words.append(token)
            continue
        low = token.lower()
        if low in acronyms:
            words.append(low.upper())
        elif low in small_words:
            words.append(low)
        else:
            words.append(low[:1].upper() + low[1:])
    titled = "".join(words).strip()
    if titled:
        titled = titled[:1].upper() + titled[1:]
    return titled


def clean_department_part(value):
    normalized = normalize_department_text(value)
    if not normalized:
        return ""

    for pattern, canonical in KNOWN_DEPARTMENT_PATTERNS:
        if re.search(pattern, normalized, flags=re.I):
            return canonical

    return title_department(normalized)


def split_department_parts(value):
    text = clean_text(value)
    if not text:
        return []
    return [part.strip() for part in re.split(r"\s*;\s*|\s*\|\s*", text) if part.strip()]


def clean_department(value):
    parts = split_department_parts(value)
    if not parts:
        return "Unknown"
    cleaned = []
    for part in parts:
        clean = clean_department_part(part)
        if clean and clean not in cleaned:
            cleaned.append(clean)
    return "; ".join(cleaned) if cleaned else "Unknown"


def department_group(value):
    cleaned = clean_department(value)
    if cleaned == "Unknown":
        return "Unknown"
    first = split_department_parts(cleaned)[0]
    for canonical in sorted(CANONICAL_DEPARTMENTS):
        if canonical.lower() in first.lower():
            return canonical
    return first or "Unknown"


def department_tokens(value):
    cleaned = clean_department(value)
    if cleaned == "Unknown":
        return ""
    tokens = sorted(set(re.findall(r"[a-z0-9]+", cleaned.lower())))
    return "; ".join(tokens)


def build_department_report(df):
    return (
        df.groupby(["department_raw", "department_clean", "department_group"], dropna=False)
        .size()
        .reset_index(name="count")
        .sort_values(["count", "department_raw"], ascending=[False, True])
    )


def build_institution_report(df):
    return (
        df.groupby(["institution_raw", "institution_clean"], dropna=False)
        .size()
        .reset_index(name="count")
        .sort_values(["count", "institution_raw"], ascending=[False, True])
    )


def build_unmapped_department_report(df):
    canonical = CANONICAL_DEPARTMENTS | {"Unknown"}
    unmapped = df[~df["department_group"].isin(canonical)].copy()
    if unmapped.empty:
        return pd.DataFrame(columns=["department_raw", "department_clean", "department_group", "count"])
    return build_department_report(unmapped)


def clean_applicants(input_path=READY_APPLICANTS, output_path=CLEANED_APPLICANTS):
    input_path = Path(input_path)
    output_path = Path(output_path)
    CLEANED_FOLDER.mkdir(exist_ok=True)

    applicants = pd.read_csv(input_path, dtype=str).fillna("")
    for col in applicants.columns:
        applicants[col] = applicants[col].apply(clean_text)
    applicants = append_manual_applicants(applicants)
    applicants = append_convergence_applicants(applicants)

    applicants["institution_raw"] = applicants.get("institution", "")
    applicants["institution_clean"] = applicants["institution_raw"].apply(simplify_institution)
    applicants["department_raw"] = applicants.get("department", "")
    applicants["department_clean"] = applicants["department_raw"].apply(clean_department)
    applicants["department_group"] = applicants["department_raw"].apply(department_group)
    applicants["department_tokens"] = applicants["department_raw"].apply(department_tokens)

    applicants.to_csv(output_path, index=False, encoding="utf-8-sig")
    build_department_report(applicants).to_csv(OUT_DEPARTMENT_CLEANING_REPORT, index=False, encoding="utf-8-sig")
    build_institution_report(applicants).to_csv(OUT_INSTITUTION_CLEANING_REPORT, index=False, encoding="utf-8-sig")
    build_unmapped_department_report(applicants).to_csv(OUT_UNMAPPED_DEPARTMENTS, index=False, encoding="utf-8-sig")

    return applicants


def main():
    applicants = clean_applicants()
    print("Done")
    print(f"Cleaned applicants: {CLEANED_APPLICANTS}")
    print(f"Rows: {len(applicants)}")
    print(f"Raw institutions: {applicants['institution_raw'].nunique()}")
    print(f"Clean institutions: {applicants['institution_clean'].nunique()}")
    print(f"Raw departments: {applicants['department_raw'].nunique()}")
    print(f"Clean departments: {applicants['department_clean'].nunique()}")
    print(f"Department groups: {applicants['department_group'].nunique()}")


if __name__ == "__main__":
    main()
