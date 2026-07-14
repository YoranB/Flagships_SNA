from pathlib import Path


READY_APPLICANTS = Path("output_ready/flagship_applicants_sna_ready.csv")
CLEANED_FOLDER = Path("output_cleaned")
CLEANED_APPLICANTS = CLEANED_FOLDER / "flagship_applicants_sna_cleaned.csv"
OUT_DEPARTMENT_CLEANING_REPORT = CLEANED_FOLDER / "department_cleaning_report.csv"
OUT_INSTITUTION_CLEANING_REPORT = CLEANED_FOLDER / "institution_cleaning_report.csv"
OUT_UNMAPPED_DEPARTMENTS = CLEANED_FOLDER / "unmapped_departments.csv"
ENRICHED_FOLDER = Path("output_enriched")
OUT_PERSON_EXPERTISE = ENRICHED_FOLDER / "person_expertise.csv"
MANUAL_FOLDER = Path("input_manual")
INPUT_MANUAL_EXPERTISE = MANUAL_FOLDER / "person_expertise_manual.csv"
INPUT_MANUAL_SUSTAINABLE_HEALTH_PROGRAMS = MANUAL_FOLDER / "sustainable_health_programs.csv"
CAMPUS_CLUSTER_MAPPING = Path("Data/campus_project_cluster_mapping.csv")
CAMPUS_PARTNER_MAPPING = Path("Data/campus_project_partner_mapping.csv")
INPUT_CONVERGENCE_CALLS_XLSX = Path("Data/convergence_openmind_impuls_cleaned_v1.xlsx")

INPUT_APPLICANTS = CLEANED_APPLICANTS if CLEANED_APPLICANTS.exists() else READY_APPLICANTS
INPUT_PERSON_EDGES = Path("output_ready/person_person_edges_sna_ready.csv")
INPUT_ORG_EDGES = Path("output_ready/person_organisation_edges_sna_ready.csv")
INPUT_PARTNERS_XLSX = Path("Data/Partners.xlsx")
INPUT_PARTNERS_SHP_XLSX = Path("Data/Partners_shp.xlsx")
INPUT_PARTNER_XLSX_FILES = [INPUT_PARTNERS_XLSX, INPUT_PARTNERS_SHP_XLSX]
OUT_PARTNERS_CLEANED = CLEANED_FOLDER / "partners_cleaned.csv"

OUTPUT_FOLDER = Path("output_sna")
OUTPUT_FOLDER.mkdir(exist_ok=True)

OUT_PERSON_METRICS = OUTPUT_FOLDER / "person_metrics.csv"
OUT_FLAGSHIP_METRICS = OUTPUT_FOLDER / "flagship_metrics.csv"
OUT_INSTITUTION_MATRIX = OUTPUT_FOLDER / "institution_collaboration_matrix.csv"
OUT_TOP_CONNECTORS = OUTPUT_FOLDER / "top_connectors.csv"
OUT_SUMMARY = OUTPUT_FOLDER / "network_summary.txt"
OUT_HTML = OUTPUT_FOLDER / "person_network_interactive.html"
OUT_EXCEL = OUTPUT_FOLDER / "sna_results.xlsx"
