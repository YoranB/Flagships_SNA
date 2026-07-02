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
from sna_pipeline.data.load import (
    DEFAULT_CALL_ID,
    DEFAULT_CALL_NAME,
    add_person_ids,
    ensure_call_columns,
    ensure_person_edge_call_columns,
    ensure_proposal_columns,
)
from sna_pipeline.data.manual_programs import (
    MANUAL_PROGRAM_COLUMNS,
    SUSTAINABLE_HEALTH_CALL_ID,
    append_manual_applicants,
    build_manual_org_edges,
    build_manual_person_edges,
    load_manual_applicants,
)
from sna_pipeline.network.graph_builder import build_person_graph
from sna_pipeline.network.metrics import calculate_person_metrics


class MultiCallFoundationTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
