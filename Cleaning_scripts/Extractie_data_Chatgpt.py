from pathlib import Path
import itertools
import re
import pandas as pd


INPUT_APPLICANTS = Path("output_v2/flagship_applicants_raw_v2.csv")

OUTPUT_FOLDER = Path("output_final")
OUTPUT_FOLDER.mkdir(exist_ok=True)

OUT_APPLICANTS = OUTPUT_FOLDER / "flagship_applicants_final.csv"
OUT_PERSON_EDGES = OUTPUT_FOLDER / "person_person_edges_final.csv"
OUT_ORG_EDGES = OUTPUT_FOLDER / "person_organisation_edges_final.csv"
OUT_FULL = OUTPUT_FOLDER / "flagship_sna_full_dataset.csv"
OUT_QUALITY = OUTPUT_FOLDER / "quality_report_final.csv"


TITLE_PARTS_RE = re.compile(
    r"\b(prof\.?|professor|dr\.?|ir\.?|ing\.?|msc\.?|mba\.?|phd\.?|md|mr\.?|drs\.?)\b",
    flags=re.IGNORECASE,
)


def clean_text(value):
    if pd.isna(value):
        return ""
    value = str(value)
    value = value.replace("\u00ad", "")
    value = value.replace("\n", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def normalize_person_name(name):
    name = clean_text(name)
    name = TITLE_PARTS_RE.sub("", name)
    name = re.sub(r"\s+", " ", name)
    return name.strip(" ,.;:")


def normalize_email(email):
    return clean_text(email).lower()


def make_record(
    flagship_id,
    flagship_title,
    source_file,
    page,
    person_name_raw,
    institution,
    department,
    email,
    position,
    emc_applicant_type,
    role,
):
    return {
        "flagship_id": str(flagship_id),
        "flagship_title": flagship_title,
        "source_file": source_file,
        "page": page,
        "person_name_raw": person_name_raw,
        "person_name_clean": normalize_person_name(person_name_raw),
        "institution": clean_text(institution),
        "department": clean_text(department),
        "email": normalize_email(email),
        "position": clean_text(position),
        "emc_applicant_type": clean_text(emc_applicant_type),
        "role": clean_text(role),
        "extraction_method": "manual_patch_from_applicant_table",
        "confidence": "verified_high",
        "raw_row": "",
    }


def manual_records_patient_centered_oncocare():
    fid = "2022032"
    title = "Patient-centered oncological care: New paradigms in understanding and treating cancer"
    source = "2022032_2022032_Full proposal_PatientCenteredOncoCare.pdf"

    rows = [
        (2, "Dr. Irene Grossmann", "TUD", "Centre for Safety in Healthcare", "i.grossmann@tudelft.nl", "tenure track", "", "Main lead, lead WP3"),
        (2, "Dr. Kateřina Staňková", "TUD", "ESS, TPM", "k.stankova@tudelft.nl", "Delft Technology fellowship", "", "Lead (core group), lead WP1"),
        (2, "Dr. Miao-Ping Chien", "EMC, TUD", "Molecular Genetics", "m.p.chien@erasmusmc.nl", "tenured", "researcher", "Main lead"),
        (2, "Dr. Marleen de Mul", "EUR", "ES Health Policy & Management", "demul@eshpm.eur.nl", "tenured", "", "Main lead"),
        (2, "Dr. Jan von der Thüsen", "EMC", "Pathology & bioinformatics", "j.vonderthusen@erasmusmc.nl", "tenured", "mix", "Lead (core group)"),
        (2, "Dr. Jafar Rezaei", "TUD", "ESS, TPM", "j.rezaei@tudelft.nl", "tenured", "", "Lead WP2"),
        (2, "Dr. Samantha Copeland", "TUD", "VTI, TPM", "s.m.copeland@tudelft.nl", "tenure track", "", "Lead WP4"),
        (2, "Prof. Dr. Anne-Marie Dingemans", "EMC", "Thoracic oncology", "a.dingemans@erasmusmc.nl", "tenured", "mix", "Clinical lead use case lung"),
        (2, "Prof. Dr. Kees Verhoef", "EMC", "Surgical Oncology", "c.verhoef@erasmusmc.nl", "tenured", "mix", "Clinical lead use case RC"),
        (2, "Dr. Jose Hardillo", "EMC", "ENT oncology", "j.hardillo@erasmusmc.nl", "tenure track", "mix", "Clinical lead use case ENT"),
        (2, "Prof. Dr. Pieter van Gelder", "TUD", "Safety & Security at VTI, TPM", "P.H.A.J.M.vanGelder@tudelft.nl", "tenured", "", "Applicant"),
        (2, "Dr. Amir Pooyan Afghari", "TUD", "Safety & Security at VTI, TPM", "A.P.Afghari-1@tudelft.nl", "tenure track", "", "Applicant"),
        (2, "Prof. Dr. Ir. Geurt Jongbloed", "TUD", "Delft Institute Applied Mathematics", "G.Jongbloed@tudelft.nl", "tenured", "", "Applicant"),
        (2, "Dr. Johan Dubbeldam", "TUD", "Delft Institute Applied Mathematics", "J.L.A.Dubbeldam@tudelft.nl", "tenured", "", "Applicant"),
        (2, "Dr. Monica Salvioli", "TUD", "Delft Institute Applied Mathematics", "m.salvioli@tudelft.nl", "PostDoc", "", "Applicant"),
        (2, "Dr. Claudia Werker", "TUD", "ETI at VTI, TPM", "C.Werker@tudelft.nl", "tenured", "", "Applicant"),
        (2, "Prof. Dr. Anne Stiggelbout", "EUR, LUMC", "ES Health Policy & Management", "stiggelbout@eshpm.eur.nl", "tenured", "", "Applicant"),
        (2, "Prof. Dr. Kees Ahaus", "EUR", "ES Health Policy & Management", "ahaus@eshpm.eur.nl", "tenured", "", "Applicant"),
        (2, "Pieter Vandekerckhove", "EUR", "ES Health Policy & Management", "vandekerckhove@eshpm.eur.nl", "PhD student", "", "Applicant"),
        (2, "Dr. Yunlei Li", "EMC", "Pathology & bioinformatics", "y.li.1@erasmusmc.nl", "tenured", "researcher", "Applicant"),
        (2, "Dr. Michail Doukas", "EMC", "Pathology & bioinformatics", "m.doukas@erasmusmc.nl", "tenured", "researcher", "Applicant"),
        (2, "Prof. Dr. Jan van Bussbach", "EMC", "Clinical psychology", "j.vanbusschbach@erasmusmc.nl", "tenured", "mix", "Applicant"),
        (2, "Dr. Leonieke Kranenburg", "EMC", "Clinical psychology", "l.kranenburg@erasmusmc.nl", "tenured", "researcher", "Applicant"),
        (2, "Dr. Esther van Meerten", "EMC", "Clinical oncology (ENT use case)", "e.vanmeerten@erasmusmc.nl", "tenured", "mix", "Applicant"),
    ]

    return [
        make_record(fid, title, source, *row)
        for row in rows
    ]


def manual_records_misafe():
    fid = "2022005"
    title = "Development of the microbial safe hospital: the MI-Safe-Hospital flagship"
    source = "2022005_2022005_Full proposal MI-SAFE.pdf"

    rows = [
        (1, "Prof. dr. Margreet Vos", "EMC", "MMIZ", "m.vos@erasmusmc.nl", "Tenured position", "mix", "Main Applicant-Project Lead"),
        (1, "Dr. Juliëtte Severin", "EMC", "MMIZ", "j.severin@erasmusmc.nl", "Tenured position", "mix", "Coordination Team"),
        (1, "Dr. Anne Voor in 't holt", "EMC", "MMIZ", "a.voorintholt@erasmusmc.nl", "Tenured position", "researcher", "Coordination Team"),
        (1, "Dr. John Hays", "EMC", "MMIZ", "j.hays@erasmusmc.nl", "Tenured position", "researcher", "Management Team"),
        (1, "Dr. L. Georgievska", "EMC", "MMIZ", "l.georgievska@erasmusmc.nl", "Tenured position", "researcher", "Management Team"),
        (1, "Dr. Robert Kraaij", "EMC", "Inwendige Geneeskunde", "r.kraaij@erasmusmc.nl", "Tenured position", "researcher", "Applicant"),
        (1, "Prof. dr. André Uitterlinden", "EMC", "Inwendige Geneeskunde", "a.g.uitterlinden@erasmusmc.nl", "Tenured position", "researcher", "Applicant"),
        (1, "Prof. dr. Monique van Dijk", "EMC", "Inwendige Geneeskunde / Kinderchirurgie", "m.vandijk.3@erasmusmc.nl", "Tenured position", "researcher", "Applicant"),

        (2, "Dr. Erwin Ista", "EMC", "Inwendige Geneeskunde / Kinderchirurgie", "w.ista@erasmusmc.nl", "Tenured position", "researcher", "Applicant"),
        (2, "Prof. dr. Marco Bruno", "EMC", "MDL", "m.bruno@erasmusmc.nl", "Tenured position", "mix", "Applicant"),
        (2, "Prof. Dr. Ed van Beeck", "EMC", "iMGZ", "e.vanbeeck@erasmusmc.nl", "Tenured position", "researcher", "Applicant"),
        (2, "Dr. Vicki Erasmus", "EMC", "iMGZ", "v.erasmus@erasmusmc.nl", "Tenured position", "researcher", "Applicant"),
        (2, "Liesbeth van Heel", "EMC; TUD", "Public Health & Fac. ABE", "m.vanheel@erasmusmc.nl", "Tenured position till June 2023 & PhD", "Researcher", "Applicant"),
        (2, "Dr. Jeroen van Kampen", "EMC", "Viroscience", "j.vankampen@erasmusmc.nl", "Tenured position", "mix", "Applicant"),
        (2, "Dr. ir. Nick van de Berg", "EMC; TUD", "Gynaecological Oncology & 3mE, dept. BMechE", "n.vandeberg@erasmusmc.nl", "Postdoc", "", "Applicant"),
        (2, "Dr. ir. Arjo J. Loeve", "TUD", "Fac. 3mE, dept. BMechE", "A.J.Loeve@tudelft.nl", "Tenured position", "", "Lead"),
        (2, "Prof. dr. ir. Atze Boerstra", "TUD", "Architecture & the Built Environment", "A.C.Boerstra@tudelft.nl", "Tenured position currently until March 2026", "", "Applicant"),
        (2, "Prof. ir. Peter Luscuere", "Inspired Ambitions", "", "pluscuere@gmail.com", "External", "", "Applicant"),
        (2, "Prof. dr. Jenny Dankelman", "TUD", "Fac. 3mE, dept. BMechE", "J.Dankelman@tudelft.nl", "Tenured position", "", "Applicant"),
        (2, "Ir. Daniel Robertson", "TUD", "Fac. 3mE, dept. BMechE", "P.D.Robertson@tudelft.nl", "PhD", "", "Applicant"),

        (3, "Dr. Ir. Sonja Paus-Buzing", "TUD", "Fac. Industrial Design Engineering", "S.N.Paus-Buzink@tudelft.nl", "Lecturer", "", "Applicant"),
        (3, "Dr. ir. Marian Loth", "TUD", "Fac. Industrial Design Engineering", "M.Loth@tudelft.nl", "PostDoc", "", "Applicant"),
        (3, "Drs. ing. Jos Lans", "TUD", "", "j.l.a.lans@tudelft.nl", "PhD", "", "Applicant"),
        (3, "Daan Hoek", "TUD", "", "daan.hoek@uvsmart.nl", "PhD", "", "Applicant"),
        (3, "Dr. Martina Buljac", "EUR", "ESHPM", "buljac@eshpm.eur.nl", "Tenured position", "", "Lead"),
        (3, "Prof. Dr. Kees Ahaus", "EUR", "ESHPM", "ahaus@eshpm.eur.nl", "Tenured position", "", "Applicant"),
        (3, "Dr. Catharina van Oostveen", "EUR", "ESHPM", "vanoostveen@eshpm.eur.nl", "Tenured position", "", "Applicant"),
        (3, "Dr. Jeroen van Wijngaarden", "EUR", "ESHPM", "vanwijngaarden@eshpm.eur.nl", "Tenured position", "", "Applicant"),
        (3, "Prof. dr. Marianne van Woerkom", "EUR", "ESSB", "vanwoerkom@essb.eur.nl", "Tenured position", "", "Applicant"),
        (3, "Prof. dr. Arnold Bakker", "EUR", "ESSB", "bakker@essb.eur.nl", "Tenured position", "", "Applicant"),
    ]

    return [
        make_record(fid, title, source, *row)
        for row in rows
    ]


def role_weight(role_a, role_b):
    role_a = clean_text(role_a).lower()
    role_b = clean_text(role_b).lower()

    weight = 1

    if "lead" in role_a or "lead" in role_b:
        weight = 2

    if "main" in role_a or "main" in role_b or "project lead" in role_a or "project lead" in role_b:
        weight = 3

    return weight


def create_person_person_edges(applicants_df):
    edges = []

    for flagship_id, group in applicants_df.groupby("flagship_id"):
        people = (
            group[
                [
                    "person_name_clean",
                    "email",
                    "institution",
                    "department",
                    "role",
                    "flagship_title",
                    "source_file",
                ]
            ]
            .drop_duplicates(subset=["email", "person_name_clean"])
            .to_dict("records")
        )

        for a, b in itertools.combinations(people, 2):
            source = a["email"] if clean_text(a["email"]) else a["person_name_clean"]
            target = b["email"] if clean_text(b["email"]) else b["person_name_clean"]

            edges.append({
                "source": source,
                "target": target,
                "source_name": a["person_name_clean"],
                "target_name": b["person_name_clean"],
                "source_institution": a["institution"],
                "target_institution": b["institution"],
                "source_department": a["department"],
                "target_department": b["department"],
                "relation_type": "co_applicant",
                "weight": role_weight(a["role"], b["role"]),
                "flagship_id": str(flagship_id),
                "flagship_title": a["flagship_title"],
                "source_file": a["source_file"],
            })

    edges_df = pd.DataFrame(edges)

    if edges_df.empty:
        return edges_df

    grouped = (
        edges_df
        .groupby(
            [
                "source",
                "target",
                "source_name",
                "target_name",
                "source_institution",
                "target_institution",
                "source_department",
                "target_department",
                "relation_type",
            ],
            as_index=False,
        )
        .agg(
            weight=("weight", "sum"),
            flagships=("flagship_id", lambda x: "; ".join(sorted(set(map(str, x))))),
            flagship_titles=("flagship_title", lambda x: "; ".join(sorted(set(map(str, x))))),
            source_files=("source_file", lambda x: "; ".join(sorted(set(map(str, x))))),
        )
    )

    return grouped


def create_person_organisation_edges(applicants_df):
    rows = []

    for _, row in applicants_df.iterrows():
        person_id = row["email"] if clean_text(row["email"]) else row["person_name_clean"]

        institutions = split_institutions(row["institution"])

        for institution in institutions:
            rows.append({
                "source": person_id,
                "target": institution,
                "source_name": row["person_name_clean"],
                "department": row["department"],
                "flagship_id": row["flagship_id"],
                "flagship_title": row["flagship_title"],
                "role": row["role"],
                "source_file": row["source_file"],
                "relation_type": "affiliated_with",
                "weight": 1,
            })

    return pd.DataFrame(rows)


def split_institutions(value):
    value = clean_text(value)

    if not value:
        return ["Unknown"]

    value = value.replace("/", ";")
    value = value.replace(",", ";")
    value = value.replace("&", ";")

    parts = [clean_text(p) for p in value.split(";") if clean_text(p)]

    cleaned = []
    for part in parts:
        lower = part.lower()

        if lower in {"emc", "erasmus mc", "erasmusmc"}:
            cleaned.append("Erasmus MC")
        elif lower in {"tud", "tu delft", "delft"}:
            cleaned.append("TU Delft")
        elif lower in {"eur", "erasmus university", "erasmus universiteit"}:
            cleaned.append("Erasmus University Rotterdam")
        else:
            cleaned.append(part)

    return sorted(set(cleaned))


def create_quality_report(applicants_df):
    rows = []

    for flagship_id, group in applicants_df.groupby("flagship_id"):
        names = group["person_name_clean"].fillna("").astype(str).str.strip()
        institutions = group["institution"].fillna("").astype(str).str.strip()
        roles = group["role"].fillna("").astype(str).str.strip()
        titles = group["flagship_title"].fillna("").astype(str).str.strip()
        emails = group["email"].fillna("").astype(str).str.strip()

        n = len(group)

        reasons = []

        if names[names != ""].nunique() < 8:
            reasons.append("less than 8 unique applicants")
        if (names == "").sum() > 0:
            reasons.append("missing person names")
        if (institutions == "").sum() / max(n, 1) > 0.25:
            reasons.append("many missing institutions")
        if (roles == "").sum() / max(n, 1) > 0.25:
            reasons.append("many missing roles")
        if (titles == "").sum() / max(n, 1) > 0.50:
            reasons.append("missing flagship title")
        if emails[emails != ""].duplicated().any():
            reasons.append("duplicate emails within flagship")

        rows.append({
            "flagship_id": str(flagship_id),
            "source_files": "; ".join(sorted(group["source_file"].dropna().astype(str).unique())),
            "flagship_titles": "; ".join(sorted(group["flagship_title"].dropna().astype(str).unique())),
            "applicant_rows": n,
            "unique_people_by_name": names[names != ""].nunique(),
            "unique_emails": emails[emails != ""].nunique(),
            "missing_names": int((names == "").sum()),
            "missing_institutions": int((institutions == "").sum()),
            "missing_roles": int((roles == "").sum()),
            "missing_flagship_titles": int((titles == "").sum()),
            "is_suspicious": len(reasons) > 0,
            "suspicious_reasons": "; ".join(reasons),
        })

    return pd.DataFrame(rows).sort_values(
        by=["is_suspicious", "unique_people_by_name"],
        ascending=[False, True],
    )


def build_full_dataset(applicants_df, person_edges_df, org_edges_df):
    applicants_full = applicants_df.copy()
    applicants_full.insert(0, "record_type", "applicant")

    person_edges_full = person_edges_df.copy()
    person_edges_full.insert(0, "record_type", "person_person_edge")

    org_edges_full = org_edges_df.copy()
    org_edges_full.insert(0, "record_type", "person_organisation_edge")

    all_cols = sorted(
        set(applicants_full.columns)
        | set(person_edges_full.columns)
        | set(org_edges_full.columns)
    )

    applicants_full = applicants_full.reindex(columns=all_cols)
    person_edges_full = person_edges_full.reindex(columns=all_cols)
    org_edges_full = org_edges_full.reindex(columns=all_cols)

    return pd.concat(
        [applicants_full, person_edges_full, org_edges_full],
        ignore_index=True,
    )


def main():
    df = pd.read_csv(INPUT_APPLICANTS, dtype=str).fillna("")

    df["flagship_id"] = df["flagship_id"].astype(str)

    before_rows = len(df)

    # Remove old, unreliable v2 extraction for the two problematic PDFs.
    df = df[~df["flagship_id"].isin(["2022032", "2022005"])].copy()

    patched = pd.DataFrame(
        manual_records_patient_centered_oncocare()
        + manual_records_misafe()
    )

    df = pd.concat([df, patched], ignore_index=True)

    # Basic cleaning
    text_cols = df.columns
    for col in text_cols:
        df[col] = df[col].apply(clean_text)

    df["person_name_clean"] = df["person_name_clean"].apply(normalize_person_name)
    df["email"] = df["email"].apply(normalize_email)
    df["flagship_id"] = df["flagship_id"].astype(str)

    # Remove unresolved names and obvious non-person rows.
    df = df[df["person_name_clean"] != ""].copy()
    df = df[~df["person_name_clean"].str.lower().isin(["name", "applicant", "applicants"])].copy()

    # Deduplicate within flagship, preferably by email.
    with_email = df[df["email"] != ""].drop_duplicates(
        subset=["flagship_id", "email"],
        keep="last",
    )

    without_email = df[df["email"] == ""].drop_duplicates(
        subset=["flagship_id", "person_name_clean"],
        keep="last",
    )

    df = pd.concat([with_email, without_email], ignore_index=True)

    df = df.sort_values(
        by=["flagship_id", "person_name_clean", "email"],
        na_position="last",
    )

    person_edges_df = create_person_person_edges(df)
    org_edges_df = create_person_organisation_edges(df)
    quality_df = create_quality_report(df)
    full_df = build_full_dataset(df, person_edges_df, org_edges_df)

    df.to_csv(OUT_APPLICANTS, index=False, encoding="utf-8-sig")
    person_edges_df.to_csv(OUT_PERSON_EDGES, index=False, encoding="utf-8-sig")
    org_edges_df.to_csv(OUT_ORG_EDGES, index=False, encoding="utf-8-sig")
    full_df.to_csv(OUT_FULL, index=False, encoding="utf-8-sig")
    quality_df.to_csv(OUT_QUALITY, index=False, encoding="utf-8-sig")

    print("Done")
    print(f"Input applicant rows: {before_rows}")
    print(f"Final applicant rows: {len(df)}")
    print(f"Unique flagships: {df['flagship_id'].nunique()}")
    print(f"Unique people by name: {df['person_name_clean'].nunique()}")
    print(f"Suspicious flagships: {int(quality_df['is_suspicious'].sum())}")
    print()
    print(f"Applicants: {OUT_APPLICANTS}")
    print(f"Person-person edges: {OUT_PERSON_EDGES}")
    print(f"Person-organisation edges: {OUT_ORG_EDGES}")
    print(f"Full combined dataset: {OUT_FULL}")
    print(f"Quality report: {OUT_QUALITY}")

    suspicious = quality_df[quality_df["is_suspicious"]]
    if not suspicious.empty:
        print()
        print("Remaining suspicious flagships:")
        print(
            suspicious[
                ["flagship_id", "unique_people_by_name", "suspicious_reasons", "source_files"]
            ].to_string(index=False)
        )


if __name__ == "__main__":
    main()