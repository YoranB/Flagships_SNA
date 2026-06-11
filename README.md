# Flagships SNA

This repository builds a social network analysis (SNA) dashboard from the cleaned Flagships applicant data.

## Project Flow

1. `output_ready/` contains the SNA-ready CSV inputs.
2. `python3 -m sna_pipeline.clean_fields` optionally creates audited institution and department fields in `output_cleaned/`.
3. `sna_pipeline/` builds the person graph, calculates metrics, and renders the standalone dashboard.
4. `output_sna/` contains the generated CSV, Excel, text summary, and HTML dashboard outputs.

The extraction and cleaning scripts are kept as separate legacy pipeline steps and are not required to run the dashboard from the existing `output_ready/` files.

## Install

```bash
python3 -m pip install -r requirements.txt
```

## Run

Preferred entrypoint:

```bash
python3 -m sna_pipeline.clean_fields
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

## Dashboard

Open `output_sna/person_network_interactive.html` in a browser after running the pipeline. The dashboard is standalone: required local JavaScript and CSS libraries are embedded into the generated HTML.

Useful controls:

- `Alleen gekozen flagships`: limits the overview to the 10 selected flagship groups.
- `Flagship edges`: switches between `Backbone`, `Selectie`, and `Alles`.
- `Persoon zoeken`: shows an ego network around a selected person.
- `Instelling` and `Afdeling`: filter person views and flagship drilldowns on cleaned institution and department groups.
- `Trefwoord`: searches across person name, email, institution, department, role, and flagship title.
- `Groepering`: colors person nodes by institution or department.

The selected flagship groups are configured in `sna_pipeline/config.py`. ALIVE combines source flagships `2022014` and `2022030`.

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
