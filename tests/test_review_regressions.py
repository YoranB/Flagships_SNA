import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import networkx as nx
import pandas as pd

from sna_pipeline import expertise_enrichment
from sna_pipeline.expertise_enrichment import evidence_for_candidate
from sna_pipeline.network.metrics import calculate_person_metrics
from sna_pipeline.text_utils import simplify_institution


class ReviewRegressionTest(unittest.TestCase):
    def test_betweenness_treats_collaboration_weight_as_strength(self):
        graph = nx.Graph()
        graph.add_edge("a", "b", weight=1)
        graph.add_edge("b", "c", weight=1)
        graph.add_edge("a", "c", weight=10)
        for node in graph:
            graph.nodes[node].update(name=node, email=f"{node}@example.org")

        applicants = pd.DataFrame({
            "person_id": ["a", "b", "c"],
            "proposal_key": ["call::p1", "call::p1", "call::p1"],
            "call_id": ["call", "call", "call"],
            "role": ["Applicant", "Applicant", "Applicant"],
            "flagship_title": ["Proposal", "Proposal", "Proposal"],
            "call_name": ["Call", "Call", "Call"],
        })

        metrics = calculate_person_metrics(graph, applicants).set_index("person_id")

        self.assertEqual(metrics.loc["b", "betweenness_centrality"], 0)

    def test_institution_aliases_do_not_match_inside_unrelated_words(self):
        self.assertEqual(simplify_institution("European Medicines Agency"), "European Medicines Agency")
        self.assertEqual(
            simplify_institution("Neuroscience Department, University of Oxford"),
            "Neuroscience Department, University of Oxford",
        )
        self.assertEqual(simplify_institution("Tudor Research Centre"), "Tudor Research Centre")

    def test_candidate_evidence_requires_matching_affiliation(self):
        person = {
            "institution": "Erasmus University Rotterdam",
            "department": "Economics",
            "email": "person@example.org",
        }

        wrong = evidence_for_candidate(
            person,
            "Same Initial Same Surname, TU Delft, Artificial Intelligence",
            ["TU Delft"],
        )
        right = evidence_for_candidate(
            person,
            "Same Initial Same Surname, Erasmus University Rotterdam, Economics",
            ["Erasmus University Rotterdam"],
        )

        self.assertNotIn("institution", wrong)
        self.assertNotIn("profile_page_organisation", wrong)
        self.assertIn("institution", right)

    def test_limited_enrichment_preserves_unprocessed_existing_rows(self):
        with TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "person_expertise.csv"
            existing = pd.DataFrame([
                {"person_id": "a", "person_name": "Ada", "confidence": "low"},
                {"person_id": "b", "person_name": "Ben", "confidence": "high"},
            ]).reindex(columns=expertise_enrichment.ONLINE_COLUMNS, fill_value="")
            existing.to_csv(output_path, index=False)

            applicants = pd.DataFrame({
                "person_id": ["a", "b"],
                "person_name_clean": ["Ada", "Ben"],
                "institution_simplified": ["Erasmus MC", "TU Delft"],
                "department_group": ["Surgery", "Engineering"],
                "email": ["a@example.org", "b@example.org"],
            })
            enriched = {
                "profile_url": "https://example.org/ada",
                "expertise_keywords": "Surgery",
                "expertise_summary": "Updated",
                "source_type": "test",
                "confidence": "high",
                "match_notes": "test match",
            }

            with (
                patch.object(expertise_enrichment, "OUT_PERSON_EXPERTISE", output_path),
                patch.object(expertise_enrichment, "ENRICHED_FOLDER", Path(tmpdir)),
                patch.object(expertise_enrichment, "load_data", return_value=(applicants, None, None)),
                patch.object(expertise_enrichment, "enrich_person", return_value=(enriched, "")),
            ):
                expertise_enrichment.run(limit=1, sleep_seconds=0)

            result = pd.read_csv(output_path, dtype=str).fillna("").set_index("person_id")
            self.assertEqual(set(result.index), {"a", "b"})
            self.assertEqual(result.loc["a", "expertise_summary"], "Updated")
            self.assertEqual(result.loc["b", "confidence"], "high")


if __name__ == "__main__":
    unittest.main()
