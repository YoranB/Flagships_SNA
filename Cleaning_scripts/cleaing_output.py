from pathlib import Path
import pandas as pd
import itertools
import re

INPUT = Path("output_final_clean/flagship_applicants_final_clean.csv")
OUT = Path("../output_ready")
OUT.mkdir(exist_ok=True)

OUT_APP = OUT / "flagship_applicants_sna_ready.csv"
OUT_PP = OUT / "person_person_edges_sna_ready.csv"
OUT_PO = OUT / "person_organisation_edges_sna_ready.csv"
OUT_FULL = OUT / "flagship_sna_full_dataset_sna_ready.csv"
OUT_REMOVED = OUT / "final_removed_rows.csv"


def clean_text(x):
    if pd.isna(x):
        return ""
    return re.sub(r"\s+", " ", str(x)).strip()


def is_bad_row(row):
    name = clean_text(row["person_name_clean"]).lower()
    email = clean_text(row["email"]).lower()

    # name should not literally be an email address
    if "@" in name:
        return True

    # final known false positives
    if email in {
        "cedric.steenbeke@microsoft.co",
        "conradi@erasmusmc.nl",
    }:
        return True

    return False


def role_weight(role_a, role_b):
    role_a = clean_text(role_a).lower()
    role_b = clean_text(role_b).lower()

    weight = 1
    if "lead" in role_a or "lead" in role_b:
        weight = 2
    if "main" in role_a or "main" in role_b or "project lead" in role_a or "project lead" in role_b:
        weight = 3

    return weight


def split_institutions(value):
    value = clean_text(value)

    if not value:
        return ["Unknown"]

    value = value.replace("/", ";").replace(",", ";").replace("&", ";")
    parts = [clean_text(p) for p in value.split(";") if clean_text(p)]

    out = []
    for p in parts:
        low = p.lower()
        if low in {"emc", "erasmus mc", "erasmusmc"}:
            out.append("Erasmus MC")
        elif low in {"tud", "tu delft", "tudelft", "tu delft "}:
            out.append("TU Delft")
        elif low in {"eur", "erasmus university", "erasmus universiteit"}:
            out.append("Erasmus University Rotterdam")
        else:
            out.append(p)

    return sorted(set(out))


def make_person_person_edges(df):
    rows = []

    for flagship_id, g in df.groupby("flagship_id"):
        people = (
            g[
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
            .drop_duplicates(subset=["email"])
            .to_dict("records")
        )

        for a, b in itertools.combinations(people, 2):
            rows.append({
                "source": a["email"],
                "target": b["email"],
                "source_name": a["person_name_clean"],
                "target_name": b["person_name_clean"],
                "source_institution": a["institution"],
                "target_institution": b["institution"],
                "source_department": a["department"],
                "target_department": b["department"],
                "relation_type": "co_applicant",
                "weight": role_weight(a["role"], b["role"]),
                "flagship_id": flagship_id,
                "flagship_title": a["flagship_title"],
                "source_file": a["source_file"],
            })

    edges = pd.DataFrame(rows)

    return (
        edges.groupby(
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


def make_person_org_edges(df):
    rows = []

    for _, r in df.iterrows():
        for inst in split_institutions(r["institution"]):
            rows.append({
                "source": r["email"],
                "target": inst,
                "source_name": r["person_name_clean"],
                "department": r["department"],
                "flagship_id": r["flagship_id"],
                "flagship_title": r["flagship_title"],
                "role": r["role"],
                "source_file": r["source_file"],
                "relation_type": "affiliated_with",
                "weight": 1,
            })

    return pd.DataFrame(rows)


def build_full(app, pp, po):
    app = app.copy()
    pp = pp.copy()
    po = po.copy()

    app.insert(0, "record_type", "applicant")
    pp.insert(0, "record_type", "person_person_edge")
    po.insert(0, "record_type", "person_organisation_edge")

    all_cols = sorted(set(app.columns) | set(pp.columns) | set(po.columns))

    return pd.concat(
        [
            app.reindex(columns=all_cols),
            pp.reindex(columns=all_cols),
            po.reindex(columns=all_cols),
        ],
        ignore_index=True,
    )


df = pd.read_csv(INPUT, dtype=str).fillna("")

for col in df.columns:
    df[col] = df[col].apply(clean_text)

bad = df[df.apply(is_bad_row, axis=1)].copy()
df = df[~df.apply(is_bad_row, axis=1)].copy()

df = df.drop_duplicates(subset=["flagship_id", "email"], keep="first")

pp = make_person_person_edges(df)
po = make_person_org_edges(df)
full = build_full(df, pp, po)

df.to_csv(OUT_APP, index=False, encoding="utf-8-sig")
pp.to_csv(OUT_PP, index=False, encoding="utf-8-sig")
po.to_csv(OUT_PO, index=False, encoding="utf-8-sig")
full.to_csv(OUT_FULL, index=False, encoding="utf-8-sig")
bad.to_csv(OUT_REMOVED, index=False, encoding="utf-8-sig")

print("Done")
print(f"Final applicants: {len(df)}")
print(f"Removed final bad rows: {len(bad)}")
print(f"Flagships: {df['flagship_id'].nunique()}")
print(f"Unique people by email: {df['email'].nunique()}")
print(f"Person-person edges: {len(pp)}")
print(f"Person-organisation edges: {len(po)}")
print()
print(f"Ready applicants: {OUT_APP}")
print(f"Ready person-person edges: {OUT_PP}")
print(f"Ready person-organisation edges: {OUT_PO}")
print(f"Ready full dataset: {OUT_FULL}")