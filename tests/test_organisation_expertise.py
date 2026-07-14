import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import pandas as pd

from sna_pipeline.dashboard.organisation import (
    aggregate_participation,
    build_organisation_participation,
    build_proposal_records,
)
from sna_pipeline.dashboard.persons import expertise_for_person
from sna_pipeline.data.field_cleaning import clean_department, department_group
from sna_pipeline.enrichment import expertise as expertise_module
from sna_pipeline.text_utils import institution_units, simplify_institution


class OrganisationExpertiseTest(unittest.TestCase):
    def applicant_rows(self):
        return pd.DataFrame([
            {
                "person_id": "ada@example.org",
                "person_name_clean": "Ada",
                "institution_clean": "Multiple core institutions",
                "institution_units": "Erasmus MC; TU Delft",
                "department_group": "Epidemiology",
                "department_units": "Epidemiology",
                "proposal_key": "flagship::p1",
                "proposal_id": "p1",
                "proposal_title": "Prevention with AI",
                "flagship_id": "p1",
                "flagship_title": "Prevention with AI",
                "call_id": "flagship",
                "call_name": "Flagship Call",
                "project_theme": "Prevention",
                "project_summary": "AI for prevention",
                "dashboard_project_node": "true",
            },
            {
                "person_id": "ada@example.org",
                "person_name_clean": "Ada",
                "institution_clean": "Multiple core institutions",
                "institution_units": "Erasmus MC; TU Delft",
                "department_group": "Epidemiology",
                "department_units": "Epidemiology",
                "proposal_key": "flagship::p1",
                "proposal_id": "p1",
                "proposal_title": "Prevention with AI",
                "flagship_id": "p1",
                "flagship_title": "Prevention with AI",
                "call_id": "flagship",
                "call_name": "Flagship Call",
                "project_theme": "Prevention",
                "project_summary": "AI for prevention",
                "dashboard_project_node": "true",
            },
            {
                "person_id": "ben@example.org",
                "person_name_clean": "Ben",
                "institution_clean": "Unknown",
                "institution_units": "Unknown",
                "department_group": "Unknown",
                "department_units": "Unknown",
                "proposal_key": "open-mind::p2",
                "proposal_id": "p2",
                "proposal_title": "Biostatistics",
                "flagship_id": "p2",
                "flagship_title": "Biostatistics",
                "call_id": "open-mind",
                "call_name": "Open Mind Call",
                "project_theme": "Data science",
                "project_summary": "Biostatistical methods",
                "dashboard_project_node": "false",
            },
        ])

    def test_unknown_sentinels_and_multi_institution_values_are_canonical(self):
        self.assertEqual(simplify_institution("Not available"), "Unknown")
        self.assertEqual(clean_department("N/A"), "Unknown")
        self.assertEqual(department_group("-"), "Unknown")
        self.assertEqual(institution_units("Erasmus MC / TU Delft"), ["Erasmus MC", "TU Delft"])

    def test_participation_expands_units_and_deduplicates_people(self):
        participation = build_organisation_participation(self.applicant_rows())

        self.assertEqual(len(participation["records"]), 3)
        self.assertEqual(participation["summary"]["n_people"], 2)
        self.assertEqual(participation["summary"]["n_institutions"], 3)
        erasmus = next(row for row in participation["institutions"] if row["institution"] == "Erasmus MC")
        self.assertEqual(erasmus["n_people"], 1)
        self.assertEqual(erasmus["n_proposals"], 1)

        flagship = [record for record in participation["records"] if record["call_id"] == "flagship"]
        scoped = aggregate_participation(flagship)
        self.assertEqual(scoped["summary"]["n_calls"], 1)
        self.assertEqual(scoped["summary"]["n_institutions"], 2)

    def test_unified_proposals_include_dashboard_and_context_projects(self):
        proposals = build_proposal_records(self.applicant_rows())
        self.assertEqual({item["id"] for item in proposals}, {"flagship::p1", "open-mind::p2"})
        self.assertTrue(next(item for item in proposals if item["id"] == "flagship::p1")["dashboard_project_node"])
        self.assertFalse(next(item for item in proposals if item["id"] == "open-mind::p2")["dashboard_project_node"])

    def test_legacy_placeholder_expertise_id_resolves(self):
        current = "-1@tudelft.nl|flagship::2022017|ali-mohammadi-gheidari"
        legacy = "-1@tudelft.nl|2022017|ali-mohammadi-gheidari"
        item = {"expertise_keywords": "Imaging"}
        resolved, matched_id = expertise_for_person(current, {legacy: item})
        self.assertEqual(resolved, item)
        self.assertEqual(matched_id, legacy)

    def test_manual_only_and_online_plus_manual_expertise(self):
        with TemporaryDirectory() as tmpdir:
            online_path = Path(tmpdir) / "online.csv"
            manual_path = Path(tmpdir) / "manual.csv"
            pd.DataFrame([
                {"person_id": "online", "expertise_keywords": "AI", "expertise_summary": "Online summary"},
            ]).reindex(columns=expertise_module.ONLINE_COLUMNS, fill_value="").to_csv(online_path, index=False)
            pd.DataFrame([
                {"person_id": "online", "expertise_keywords": "Epidemiology", "expertise_summary": "Manual summary"},
                {"person_id": "manual", "expertise_keywords": "Biostatistics", "expertise_summary": "Manual only"},
            ]).reindex(columns=expertise_module.MANUAL_COLUMNS, fill_value="").to_csv(manual_path, index=False)

            with (
                patch.object(expertise_module, "OUT_PERSON_EXPERTISE", online_path),
                patch.object(expertise_module, "INPUT_MANUAL_EXPERTISE", manual_path),
            ):
                expertise = expertise_module.load_expertise_map()

        self.assertEqual(expertise["online"]["expertise_keywords"], "AI; Epidemiology")
        self.assertEqual(expertise["online"]["expertise_summary"], "Manual summary")
        self.assertEqual(expertise["online"]["expertise_origin"], "online_plus_manual")
        self.assertEqual(expertise["manual"]["expertise_origin"], "manual")


if __name__ == "__main__":
    unittest.main()
