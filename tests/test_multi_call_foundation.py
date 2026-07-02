import unittest

import pandas as pd

from sna_pipeline.dashboard.persons import build_person_records_and_edges
from sna_pipeline.data.load import (
    DEFAULT_CALL_ID,
    DEFAULT_CALL_NAME,
    add_person_ids,
    ensure_call_columns,
    ensure_person_edge_call_columns,
    ensure_proposal_columns,
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
        self.assertIn("flagship|P1|unknown", applicants.loc[2, "person_id"])
        self.assertIn("open-mind|P1|unknown", applicants.loc[3, "person_id"])

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


if __name__ == "__main__":
    unittest.main()
