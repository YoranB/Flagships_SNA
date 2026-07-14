import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import pandas as pd

from sna_pipeline.config import CAMPUS_CLUSTER_MAPPING, SELECTED_FLAGSHIP_GROUPS
from sna_pipeline.dashboard.campus import (
    CLUSTER_MAPPING_COLUMNS,
    build_campus_dashboard_data,
    read_csv_mapping,
)
from sna_pipeline.dashboard.persons import build_person_records_and_edges
from sna_pipeline.dashboard.flagships import build_flagship_records
from sna_pipeline.data.load import (
    DEFAULT_CALL_ID,
    DEFAULT_CALL_NAME,
    add_person_ids,
    build_edge_id_lookup,
    ensure_call_columns,
    ensure_person_edge_call_columns,
    ensure_proposal_columns,
    resolve_edge_person_id,
)
from sna_pipeline.data.convergence_calls import (
    build_convergence_applicants,
    build_convergence_person_edges,
    build_import_quality,
    build_project_catalog,
    read_convergence_workbook,
)
from sna_pipeline.data.field_cleaning import clean_department, department_group, department_tokens
from sna_pipeline.data.manual_programs import (
    MANUAL_PROGRAM_COLUMNS,
    SUSTAINABLE_HEALTH_CALL_ID,
    append_manual_applicants,
    build_manual_org_edges,
    build_manual_person_edges,
    load_manual_applicants,
)
from sna_pipeline.network.graph_builder import build_person_graph
from sna_pipeline.network.metrics import calculate_flagship_metrics, calculate_person_metrics
from sna_pipeline.partners import normalize_partner_flagship_id
from sna_pipeline.text_utils import simplify_institution


def prepare_convergence_applicants(applicants):
    applicants = ensure_call_columns(applicants)
    applicants = ensure_proposal_columns(applicants)
    applicants["institution_raw"] = applicants["institution"]
    applicants["institution_clean"] = applicants["institution_raw"].apply(simplify_institution)
    applicants["institution_simplified"] = applicants["institution_clean"]
    applicants["department_raw"] = applicants["department"]
    applicants["department_clean"] = applicants["department_raw"].apply(clean_department)
    applicants["department_group"] = applicants["department_raw"].apply(department_group)
    applicants["department_tokens"] = applicants["department_raw"].apply(department_tokens)
    return applicants


class MultiCallFoundationTest(unittest.TestCase):
    def test_convergence_workbook_rejects_missing_sheets_and_columns(self):
        with TemporaryDirectory() as tmpdir:
            missing_sheet_path = Path(tmpdir) / "missing-sheet.xlsx"
            with pd.ExcelWriter(missing_sheet_path) as writer:
                pd.DataFrame({"project_uid": ["p1"]}).to_excel(
                    writer, sheet_name="Projects_clean", index=False
                )
            with self.assertRaisesRegex(ValueError, "Missing sheets"):
                read_convergence_workbook(missing_sheet_path)

            missing_column_path = Path(tmpdir) / "missing-column.xlsx"
            project_columns = {
                "project_uid": ["p1"],
                "call_name": ["Open Mind"],
                "project_type": ["Research"],
                "title": ["Project One"],
                "theme": ["Health"],
                "network_ready": ["yes"],
                "source_files": ["source.xlsx"],
                "data_quality": [""],
            }
            people_columns = {
                "person_uid": ["person:1"],
                "full_name": ["Ada Example"],
                "email": ["ada@example.com"],
                "position": ["Researcher"],
                "institution": ["Erasmus MC"],
                "faculty_or_department": ["Surgery"],
                "source_files": ["source.xlsx"],
                "raw_notes": [""],
                "data_quality": [""],
            }
            membership_columns = {
                "edge_uid": ["edge:1"],
                "person_uid": ["person:1"],
                "project_uid": ["p1"],
                "roles": ["Applicant"],
                "source_files": ["source.xlsx"],
                "notes": [""],
            }
            with pd.ExcelWriter(missing_column_path) as writer:
                pd.DataFrame(project_columns).to_excel(writer, sheet_name="Projects_clean", index=False)
                pd.DataFrame(people_columns).to_excel(writer, sheet_name="People_clean", index=False)
                pd.DataFrame(membership_columns).to_excel(
                    writer, sheet_name="Person_Project_Edges", index=False
                )
            with self.assertRaisesRegex(ValueError, r"Projects_clean.*summary"):
                read_convergence_workbook(missing_column_path)

    def test_convergence_workbook_import_counts_and_quality(self):
        bundle = read_convergence_workbook()
        applicants = build_convergence_applicants(bundle)
        catalog = build_project_catalog(bundle)
        quality = build_import_quality(bundle)

        self.assertEqual(len(catalog), 142)
        self.assertEqual(sum(item["network_ready"] for item in catalog), 140)
        self.assertEqual(len(applicants), 589)
        self.assertEqual(applicants["source_person_uid"].nunique(), 500)
        self.assertEqual(quality["totals"]["source_people"], 501)
        self.assertEqual(quality["totals"]["unlinked_people"], 1)
        self.assertEqual(len(quality["unresolved_projects"]), 2)

    def test_convergence_missing_email_ids_are_stable_across_projects(self):
        applicants = build_convergence_applicants(read_convergence_workbook())
        applicants = ensure_call_columns(applicants)
        applicants = ensure_proposal_columns(applicants)
        applicants = add_person_ids(applicants)
        missing = applicants[applicants["email"] == ""]
        repeated = missing.groupby("source_person_uid").filter(lambda group: group["proposal_id"].nunique() > 1)

        self.assertFalse(repeated.empty)
        self.assertTrue((repeated.groupby("source_person_uid")["person_id"].nunique() == 1).all())
        self.assertTrue(repeated["person_id"].str.startswith("source-person::").all())

    def test_real_cross_call_people_keep_one_global_identity(self):
        applicants = prepare_convergence_applicants(
            build_convergence_applicants(read_convergence_workbook())
        )
        applicants = add_person_ids(applicants)
        cross_call = applicants.groupby("source_person_uid").filter(
            lambda group: group["call_id"].nunique() > 1
        )

        self.assertFalse(cross_call.empty)
        self.assertTrue((cross_call.groupby("source_person_uid")["person_id"].nunique() == 1).all())
        self.assertGreaterEqual(cross_call["source_person_uid"].nunique(), 1)

    def test_convergence_edges_keep_call_contribution_weights(self):
        applicants = build_convergence_applicants(read_convergence_workbook())
        applicants = prepare_convergence_applicants(applicants)
        person_edges = build_convergence_person_edges(applicants)
        applicants = add_person_ids(applicants)
        lookup = build_edge_id_lookup(applicants)
        person_edges["source_id"] = person_edges.apply(lambda row: resolve_edge_person_id(row, "source", lookup), axis=1)
        person_edges["target_id"] = person_edges.apply(lambda row: resolve_edge_person_id(row, "target", lookup), axis=1)
        graph = build_person_graph(applicants, person_edges)

        self.assertEqual(len(person_edges), 1216)
        self.assertTrue(all(set(attrs["call_weights"]).issubset({"open-mind", "impuls"}) for _, _, attrs in graph.edges(data=True)))
        self.assertTrue(all(sum(attrs["call_weights"].values()) == attrs["weight"] for _, _, attrs in graph.edges(data=True)))

    def test_convergence_projects_become_person_context_not_flagship_nodes(self):
        applicants = build_convergence_applicants(read_convergence_workbook())
        first_project = applicants["proposal_id"].iloc[0]
        applicants = applicants[applicants["proposal_id"] == first_project].copy()
        applicants = prepare_convergence_applicants(applicants)
        person_edges = build_convergence_person_edges(applicants)
        applicants = add_person_ids(applicants)
        lookup = build_edge_id_lookup(applicants)
        person_edges["source_id"] = person_edges.apply(lambda row: resolve_edge_person_id(row, "source", lookup), axis=1)
        person_edges["target_id"] = person_edges.apply(lambda row: resolve_edge_person_id(row, "target", lookup), axis=1)
        graph = build_person_graph(applicants, person_edges)
        person_metrics = calculate_person_metrics(graph, applicants)
        persons, _ = build_person_records_and_edges(graph, applicants, person_metrics)
        flagship_metrics = calculate_flagship_metrics(applicants)
        flagship_data = build_flagship_records(applicants, person_metrics, flagship_metrics)

        self.assertTrue(all(person["project_contexts"] for person in persons))
        self.assertTrue(all(not person["flagships"] for person in persons))
        self.assertEqual(flagship_data["flagships"], [])

    def test_legacy_rows_get_call_fallbacks_and_proposal_alias(self):
        applicants = pd.DataFrame({
            "flagship_id": ["2022001"],
            "flagship_title": ["Legacy Flagship"],
        })

        applicants = ensure_call_columns(applicants)
        applicants = ensure_proposal_columns(applicants)

        self.assertEqual(applicants.loc[0, "call_id"], DEFAULT_CALL_ID)
        self.assertEqual(applicants.loc[0, "call_name"], DEFAULT_CALL_NAME)
        self.assertEqual(applicants.loc[0, "proposal_id"], "2022001")

    def test_existing_call_columns_are_preserved_and_blanks_are_filled(self):
        applicants = pd.DataFrame({
            "call_id": ["open-mind", ""],
            "call_name": ["Open Mind Call", ""],
        })

        applicants = ensure_call_columns(applicants)

        self.assertEqual(applicants.loc[0, "call_id"], "open-mind")
        self.assertEqual(applicants.loc[0, "call_name"], "Open Mind Call")
        self.assertEqual(applicants.loc[1, "call_id"], DEFAULT_CALL_ID)
        self.assertEqual(applicants.loc[1, "call_name"], DEFAULT_CALL_NAME)

    def test_person_ids_support_multi_call_people_and_placeholder_uniqueness(self):
        applicants = pd.DataFrame({
            "email": ["same@example.com", "same@example.com", "", ""],
            "person_name_clean": ["Ada", "Ada", "Unknown", "Unknown"],
            "flagship_id": ["P1", "P2", "P1", "P1"],
            "proposal_id": ["P1", "P2", "P1", "P1"],
            "call_id": ["flagship", "open-mind", "flagship", "open-mind"],
        })

        applicants = add_person_ids(applicants)

        self.assertEqual(applicants.loc[0, "person_id"], "same@example.com")
        self.assertEqual(applicants.loc[1, "person_id"], "same@example.com")
        self.assertNotEqual(applicants.loc[2, "person_id"], applicants.loc[3, "person_id"])
        self.assertIn("flagship::P1|unknown", applicants.loc[2, "person_id"])
        self.assertIn("open-mind::P1|unknown", applicants.loc[3, "person_id"])

    def test_person_edges_get_legacy_call_lists(self):
        person_edges = pd.DataFrame({
            "flagships": ["P1; P2"],
        })

        person_edges = ensure_person_edge_call_columns(person_edges)

        self.assertEqual(person_edges.loc[0, "proposal_ids"], "P1; P2")
        self.assertEqual(person_edges.loc[0, "call_ids"], "flagship; flagship")
        self.assertEqual(person_edges.loc[0, "call_names"], "Flagship Call; Flagship Call")

    def test_dashboard_records_include_call_metadata(self):
        applicants = pd.DataFrame({
            "email": ["same@example.com", "other@example.com"],
            "person_name_clean": ["Ada Example", "Other Person"],
            "flagship_id": ["P1", "P1"],
            "proposal_id": ["P1", "P1"],
            "flagship_title": ["Proposal One", "Proposal One"],
            "call_id": ["open-mind", "open-mind"],
            "call_name": ["Open Mind Call", "Open Mind Call"],
            "institution_simplified": ["Erasmus MC", "TU Delft"],
            "institution_raw": ["Erasmus MC", "TU Delft"],
            "institution_clean": ["Erasmus MC", "TU Delft"],
            "department_clean": ["Dept A", "Dept B"],
            "department_raw": ["Dept A", "Dept B"],
            "department_group": ["Dept A", "Dept B"],
            "department_tokens": ["dept; a", "dept; b"],
            "role": ["Applicant", "Applicant"],
        })
        applicants = ensure_proposal_columns(applicants)
        applicants = add_person_ids(applicants)
        person_edges = pd.DataFrame({
            "source": ["same@example.com"],
            "target": ["other@example.com"],
            "source_name": ["Ada Example"],
            "target_name": ["Other Person"],
            "weight": [1],
            "flagships": ["P1"],
            "flagship_titles": ["Proposal One"],
            "proposal_ids": ["P1"],
            "call_ids": ["open-mind"],
            "call_names": ["Open Mind Call"],
            "relation_type": ["co_applicant"],
            "source_id": ["same@example.com"],
            "target_id": ["other@example.com"],
        })

        graph = build_person_graph(applicants, person_edges)
        person_metrics = calculate_person_metrics(graph, applicants)
        persons, edges = build_person_records_and_edges(graph, applicants, person_metrics)
        person = next(item for item in persons if item["id"] == "same@example.com")

        self.assertEqual(person["n_calls"], 1)
        self.assertEqual(person["calls"], [{"id": "open-mind", "name": "Open Mind Call"}])
        self.assertEqual(person["flagships"][0]["proposal_id"], "P1")
        self.assertEqual(person["flagships"][0]["call_id"], "open-mind")
        self.assertEqual(person["flagships"][0]["call_name"], "Open Mind Call")
        self.assertEqual(edges[0]["call_ids"], ["open-mind"])
        self.assertEqual(edges[0]["call_names"], ["Open Mind Call"])

    def test_missing_manual_program_csv_is_noop(self):
        with TemporaryDirectory() as tmpdir:
            missing_path = Path(tmpdir) / "missing.csv"
            manual = load_manual_applicants(missing_path)
            applicants = pd.DataFrame({"flagship_id": ["P1"]})

            combined = append_manual_applicants(applicants, manual)

            self.assertTrue(manual.empty)
            self.assertEqual(len(combined), 1)

    def test_manual_program_rows_get_defaults_and_edges(self):
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "manual.csv"
            rows = [
                {
                    "proposal_id": "p1",
                    "flagship_id": "p1",
                    "proposal_title": "Program One",
                    "flagship_title": "Program One",
                    "person_name_raw": "Ada Example",
                    "person_name_clean": "Ada Example",
                    "institution": "Erasmus MC",
                    "department": "Surgery",
                    "email": "ADA@example.com",
                },
                {
                    "proposal_id": "p1",
                    "flagship_id": "p1",
                    "proposal_title": "Program One",
                    "flagship_title": "Program One",
                    "person_name_raw": "Ben Example",
                    "person_name_clean": "Ben Example",
                    "institution": "TU Delft",
                    "department": "Applied Mathematics",
                    "email": "ben@example.com",
                },
                {
                    "proposal_id": "p2",
                    "flagship_id": "p2",
                    "proposal_title": "Program Two",
                    "flagship_title": "Program Two",
                    "person_name_raw": "Cam Example",
                    "person_name_clean": "Cam Example",
                    "institution": "Erasmus University Rotterdam",
                    "department": "ESHPM",
                    "email": "cam@example.com",
                },
            ]
            pd.DataFrame(rows).reindex(columns=MANUAL_PROGRAM_COLUMNS, fill_value="").to_csv(path, index=False)

            manual = load_manual_applicants(path)
            manual = ensure_call_columns(manual)
            manual = ensure_proposal_columns(manual)
            person_edges = build_manual_person_edges(manual)
            org_edges = build_manual_org_edges(manual)

            self.assertEqual(set(manual["role"]), {"Lead"})
            self.assertEqual(set(manual["call_id"]), {SUSTAINABLE_HEALTH_CALL_ID})
            self.assertEqual(manual.loc[0, "email"], "ada@example.com")
            self.assertEqual(len(person_edges), 1)
            self.assertEqual(len(org_edges), 3)
            self.assertEqual(person_edges.loc[0, "proposal_keys"], "sustainable-health-programs::p1")

    def test_sustainable_health_fixture_edges_and_person_id_deduplication(self):
        manual = load_manual_applicants()
        manual = ensure_call_columns(manual)
        manual = ensure_proposal_columns(manual)
        person_edges = build_manual_person_edges(manual)
        org_edges = build_manual_org_edges(manual)
        with_ids = add_person_ids(manual)

        self.assertEqual(len(manual), 22)
        self.assertEqual(len(person_edges), 71)
        self.assertEqual(len(org_edges), 22)
        self.assertEqual(set(manual["role"]), {"Lead", "Participant"})
        self.assertEqual(len(manual[manual["role"] == "Participant"]), 11)
        self.assertEqual(with_ids[with_ids["email"] == "b.cornelissen@erasmusmc.nl"]["person_id"].nunique(), 1)
        self.assertEqual(with_ids[with_ids["email"] == "belsteen@tudelft.nl"]["person_id"].iloc[0], "belsteen@tudelft.nl")
        tamara_id = with_ids[with_ids["person_name_clean"] == "Tamara Hoveling"]["person_id"].iloc[0]
        self.assertIn("missing-email|", tamara_id)
        self.assertIn("shp-zero-emission-endoscopy", tamara_id)

    def test_sustainable_health_selected_group_matches_proposal_keys(self):
        selected = next(
            group
            for group in SELECTED_FLAGSHIP_GROUPS
            if group["id"] == "selected:sustainable-health-programs"
        )

        self.assertEqual(
            selected["member_ids"],
            [
                "sustainable-health-programs::shp-smart-or2030",
                "sustainable-health-programs::shp-technological-innovations-for-nurses",
                "sustainable-health-programs::shp-zero-emission-endoscopy",
            ],
        )

    def test_sustainable_health_partner_ids_are_normalized(self):
        cases = [
            ("2023014", "", "sustainable-health-programs::shp-smart-or2030"),
            ("", "SMART OR2030", "sustainable-health-programs::shp-smart-or2030"),
            ("2023015", "", "sustainable-health-programs::shp-technological-innovations-for-nurses"),
            ("", "NURTURE", "sustainable-health-programs::shp-technological-innovations-for-nurses"),
            ("2023016", "", "sustainable-health-programs::shp-zero-emission-endoscopy"),
            ("", "ZEE", "sustainable-health-programs::shp-zero-emission-endoscopy"),
        ]

        for project_code, title, expected in cases:
            with self.subTest(project_code=project_code, title=title):
                self.assertEqual(normalize_partner_flagship_id(project_code, title), expected)

    def test_campus_cluster_mapping_has_unique_projects(self):
        mapping = read_csv_mapping(CAMPUS_CLUSTER_MAPPING, CLUSTER_MAPPING_COLUMNS)

        self.assertEqual(len(mapping), 13)
        self.assertEqual(mapping["project_id"].nunique(), 13)
        self.assertEqual(set(mapping["source_type"]), {"Flagship", "Sustainable Health"})
        self.assertIn("flagship_smart_or_2030", set(mapping["project_id"]))
        self.assertIn("sh_smart_or_2030", set(mapping["project_id"]))

    def test_campus_keeps_smart_or_flagship_and_sustainable_health_separate(self):
        applicants = pd.DataFrame({
            "person_id": ["flagship-person", "sustainable-person"],
            "flagship_id": ["2022019", "shp-smart-or2030"],
            "proposal_id": ["2022019", "shp-smart-or2030"],
            "proposal_key": ["flagship::2022019", "sustainable-health-programs::shp-smart-or2030"],
        })
        flagship_data = {
            "flagships": [
                {
                    "id": "sustainable-health-programs::shp-smart-or2030",
                    "member_ids": ["sustainable-health-programs::shp-smart-or2030", "shp-smart-or2030"],
                    "n_institutions": 1,
                    "institutions": ["Erasmus MC"],
                },
            ],
            "selected_flagship_groups": [
                {
                    "id": "selected:smart-or2030",
                    "member_ids": ["2022019", "flagship::2022019"],
                    "n_institutions": 1,
                    "institutions": ["Erasmus MC"],
                },
            ],
        }
        campus = build_campus_dashboard_data(
            applicants,
            flagship_data,
            {
                "partner_flagship_links": [],
            },
        )
        projects = {project["project_id"]: project for project in campus["projects"]}

        self.assertEqual(projects["flagship_smart_or_2030"]["source_type"], "Flagship")
        self.assertEqual(projects["sh_smart_or_2030"]["source_type"], "Sustainable Health")
        self.assertEqual(projects["flagship_smart_or_2030"]["n_people"], 1)
        self.assertEqual(projects["sh_smart_or_2030"]["n_people"], 1)
        self.assertEqual(len(campus["project_cluster_edges"]), 13)

    def test_campus_partner_rows_keep_collaboration_types(self):
        proposal_key = "sustainable-health-programs::shp-technological-innovations-for-nurses"
        applicants = pd.DataFrame({
            "person_id": ["sustainable-person"],
            "flagship_id": ["shp-technological-innovations-for-nurses"],
            "proposal_id": ["shp-technological-innovations-for-nurses"],
            "proposal_key": [proposal_key],
        })
        flagship_data = {
            "flagships": [
                {
                    "id": proposal_key,
                    "member_ids": [proposal_key, "shp-technological-innovations-for-nurses"],
                    "n_institutions": 1,
                    "institutions": ["Erasmus MC"],
                },
            ],
            "selected_flagship_groups": [],
        }
        campus = build_campus_dashboard_data(
            applicants,
            flagship_data,
            {
                "partner_flagship_links": [
                    {
                        "id": "partner-link:nurture:create4care",
                        "flagship_id": proposal_key,
                        "partner_name": "Create4Care",
                        "partner_category": "Publiek / Maatschappelijk",
                        "collaboration_types": ["Co-creatie", "Implementatie"],
                        "collaboration_type_raw": "Co-creatie; implementatie",
                        "role_relevance": "Innovatieplatform voor verpleegkundige zorgtechnologie.",
                    },
                ],
            },
        )

        rows = [
            row
            for row in campus["partner_cluster_view"]
            if row["project_id"] == "sh_technological_innovations_for_nurses"
        ]

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["partner_name"], "Create4Care")
        self.assertEqual(rows[0]["collaboration_types"], ["Co-creatie", "Implementatie"])
        self.assertEqual(
            campus["partners_by_project"]["sh_technological_innovations_for_nurses"]["links"][0]["collaboration_type_raw"],
            "Co-creatie; implementatie",
        )


if __name__ == "__main__":
    unittest.main()
