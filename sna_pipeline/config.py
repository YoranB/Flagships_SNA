from pathlib import Path


READY_APPLICANTS = Path("output_ready/flagship_applicants_sna_ready.csv")
CLEANED_FOLDER = Path("output_cleaned")
CLEANED_APPLICANTS = CLEANED_FOLDER / "flagship_applicants_sna_cleaned.csv"
OUT_DEPARTMENT_CLEANING_REPORT = CLEANED_FOLDER / "department_cleaning_report.csv"
OUT_INSTITUTION_CLEANING_REPORT = CLEANED_FOLDER / "institution_cleaning_report.csv"
OUT_UNMAPPED_DEPARTMENTS = CLEANED_FOLDER / "unmapped_departments.csv"

INPUT_APPLICANTS = CLEANED_APPLICANTS if CLEANED_APPLICANTS.exists() else READY_APPLICANTS
INPUT_PERSON_EDGES = Path("output_ready/person_person_edges_sna_ready.csv")
INPUT_ORG_EDGES = Path("output_ready/person_organisation_edges_sna_ready.csv")

OUTPUT_FOLDER = Path("output_sna")
OUTPUT_FOLDER.mkdir(exist_ok=True)

OUT_PERSON_METRICS = OUTPUT_FOLDER / "person_metrics.csv"
OUT_FLAGSHIP_METRICS = OUTPUT_FOLDER / "flagship_metrics.csv"
OUT_INSTITUTION_MATRIX = OUTPUT_FOLDER / "institution_collaboration_matrix.csv"
OUT_TOP_CONNECTORS = OUTPUT_FOLDER / "top_connectors.csv"
OUT_SUMMARY = OUTPUT_FOLDER / "network_summary.txt"
OUT_HTML = OUTPUT_FOLDER / "person_network_interactive.html"
OUT_EXCEL = OUTPUT_FOLDER / "sna_results.xlsx"

CORE_INSTITUTIONS = {
    "Erasmus MC",
    "TU Delft",
    "Erasmus University Rotterdam",
}

INSTITUTION_COLORS = {
    "Erasmus MC": "#2563eb",
    "TU Delft": "#f97316",
    "Erasmus University Rotterdam": "#16a34a",
    "Externe/overige partners": "#64748b",
    "Unknown": "#8a8f98",
    "Multiple core institutions": "#7c3aed",
}

SELECTED_FLAGSHIP_GROUPS = [
    {
        "id": "selected:healthy-joints",
        "title": "Healthy Joints",
        "member_ids": ["2022020"],
    },
    {
        "id": "selected:organ-transplantation",
        "title": "Organ Transplantation",
        "member_ids": ["2022025"],
    },
    {
        "id": "selected:alive",
        "title": "ALIVE",
        "member_ids": ["2022014", "2022030"],
    },
    {
        "id": "selected:consultation-room-2030",
        "title": "Flagship Consultation room 2030",
        "member_ids": ["2022026"],
    },
    {
        "id": "selected:icell",
        "title": "iCELL",
        "member_ids": ["2022035"],
    },
    {
        "id": "selected:personalized-real-time-health-impact",
        "title": "Personalized, Real-Time Health Impact",
        "member_ids": ["2022031"],
    },
    {
        "id": "selected:integrative-neuromedicine",
        "title": "IN - Integrative Neuromedicine",
        "member_ids": ["2022001"],
    },
    {
        "id": "selected:smart-or2030",
        "title": "SMART OR2030",
        "member_ids": ["2022019"],
    },
    {
        "id": "selected:cific",
        "title": "CIFIC",
        "member_ids": ["2022017"],
    },
    {
        "id": "selected:human-mobility-chmc",
        "title": "Human Mobility Lab / CHMC",
        "member_ids": ["2022036"],
    },
]
