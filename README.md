# Flagships SNA

This repository builds a social network analysis (SNA) dashboard from the cleaned Flagships applicant data.

## Project Flow

1. `output_ready/` contains the SNA-ready CSV inputs.
2. `python3 -m sna_pipeline.clean_fields` optionally creates audited institution and department fields in `output_cleaned/`.
3. `python3 enrich_expertise.py` optionally enriches people with public expertise metadata in `output_enriched/`.
4. `sna_pipeline/` builds the person graph, calculates metrics, merges optional expertise data, and renders the standalone dashboard.
5. `output_sna/` contains the generated CSV, Excel, text summary, and HTML dashboard outputs.

The extraction and cleaning scripts are kept as separate legacy pipeline steps and are not required to run the dashboard from the existing `output_ready/` files.

## Install

```bash
python3 -m pip install -r requirements.txt
```

## Run

Preferred entrypoint:

```bash
python3 -m sna_pipeline.clean_fields
python3 enrich_expertise.py
python3 -m sna_pipeline
```

Compatibility wrapper:

```bash
python3 run_sna_analysis.py
```

Both commands regenerate:

- `output_sna/person_metrics.csv`
- `output_sna/flagship_metrics.csv`
- `output_sna/institution_collaboration_matrix.csv`
- `output_sna/top_connectors.csv`
- `output_sna/sna_results.xlsx`
- `output_sna/network_summary.txt`
- `output_sna/person_network_interactive.html`

The SNA command uses `output_cleaned/flagship_applicants_sna_cleaned.csv` when it exists. If it does not exist, it falls back to `output_ready/flagship_applicants_sna_ready.csv`.

The cleaning command writes:

- `output_cleaned/flagship_applicants_sna_cleaned.csv`
- `output_cleaned/department_cleaning_report.csv`
- `output_cleaned/institution_cleaning_report.csv`
- `output_cleaned/unmapped_departments.csv`

The expertise enrichment command writes:

- `output_enriched/person_expertise.csv`

## Dashboard

Open `output_sna/person_network_interactive.html` in a browser after running the pipeline. The dashboard is standalone: required local JavaScript and CSS libraries are embedded into the generated HTML.

Useful controls:

- `Alleen gekozen flagships`: limits the overview to the 10 selected flagship groups.
- `Zoeken`: searches people by name, email, institution, department, role, flagship title, and expertise text.
- `Instelling` and `Afdeling`: filter person views and flagship drilldowns on cleaned institution and department groups.
- `Expertise` and `Confidence`: filter people with/without expertise and by confidence level.
- `Export manual expertise edits`: downloads local browser edits as `manual_expertise_edits.csv`.

The selected flagship groups are configured in `sna_pipeline/config.py`. ALIVE combines source flagships `2022014` and `2022030`.

## Expertise Enrichment

The expertise layer is optional. If no expertise files exist, the dashboard still builds and shows expertise as `Not available`.

Run no-key online enrichment:

```bash
python3 enrich_expertise.py
```

For a small smoke test:

```bash
python3 enrich_expertise.py --limit 5
```

The enrichment script uses public no-key sources where available, including OpenAlex, ORCID, Semantic Scholar, and institutional/research profile metadata when discoverable from those sources. It does not use LinkedIn and does not run inside the dashboard. Matches are conservative: name similarity alone is not enough; the script also checks institution, email domain, department, organisation, or publication affiliation signals.

Confidence levels:

- `high`: strong match evidence plus usable expertise keywords or topics.
- `medium`: one clear institution/affiliation signal plus usable expertise data.
- `low`: weak but plausible extra evidence.
- `needs_review`: no reliable match or a result that should be manually checked.

Manual expertise can be added in two ways:

1. In the dashboard, select a person and click `Add/edit expertise`. Edits are stored in browser `localStorage` and immediately affect search/filtering in that browser.
2. Click `Export manual expertise edits` to download `manual_expertise_edits.csv`, then place or merge it as `input_manual/person_expertise_manual.csv`.

Manual data is merged into the dashboard by running:

```bash
python3 -m sna_pipeline
```

Manual expertise wins over online enrichment for summary, confidence, and notes. Keywords are merged and deduplicated so online discovery terms are not lost.

## Code Layout

- `config.py`: paths, colors, selected flagship groups.
- `field_cleaning.py`: deterministic institution and department cleaning plus audit reports.
- `clean_fields.py`: cleaning entrypoint for `python3 -m sna_pipeline.clean_fields`.
- `data_loading.py`: CSV loading and person id resolution.
- `graph_builder.py`: NetworkX person graph construction.
- `metrics.py`: person, flagship, and institution metrics.
- `dashboard_data.py`: compact JSON data for the HTML dashboard.
- `html_renderer.py`: standalone dashboard rendering.
- `outputs.py`: CSV, Excel, and text summary writing.
- `main.py`: pipeline orchestration.
