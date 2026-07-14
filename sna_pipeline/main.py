import networkx as nx

from .config import (
    OUT_EXCEL,
    OUT_FLAGSHIP_METRICS,
    OUT_HTML,
    OUT_INSTITUTION_MATRIX,
    OUT_PERSON_METRICS,
    OUT_SUMMARY,
    OUT_TOP_CONNECTORS,
)
from .dashboard.render import create_interactive_network
from .data.load import load_data
from .data.convergence_calls import load_convergence_dashboard_metadata
from .network.graph_builder import build_person_graph
from .network.metrics import calculate_flagship_metrics, calculate_institution_collaboration, calculate_person_metrics
from .partners import load_partners
from .reporting.outputs import save_excel_outputs, write_summary


def main():
    applicants, person_edges, org_edges = load_data()
    partners = load_partners()
    project_catalog, import_quality = load_convergence_dashboard_metadata()

    G = build_person_graph(applicants, person_edges)

    person_metrics = calculate_person_metrics(G, applicants)
    flagship_metrics = calculate_flagship_metrics(applicants)
    institution_matrix = calculate_institution_collaboration(applicants)

    top_connectors = person_metrics.sort_values(
        by=["betweenness_centrality", "n_flagships", "weighted_degree"],
        ascending=False,
    ).head(50)

    person_metrics.to_csv(OUT_PERSON_METRICS, index=False, encoding="utf-8-sig")
    flagship_metrics.to_csv(OUT_FLAGSHIP_METRICS, index=False, encoding="utf-8-sig")
    institution_matrix.to_csv(OUT_INSTITUTION_MATRIX, index=False, encoding="utf-8-sig")
    top_connectors.to_csv(OUT_TOP_CONNECTORS, index=False, encoding="utf-8-sig")

    save_excel_outputs(person_metrics, flagship_metrics, institution_matrix, top_connectors)

    create_interactive_network(
        G,
        applicants,
        person_metrics,
        flagship_metrics,
        partners,
        project_catalog,
        import_quality,
    )
    write_summary(G, person_metrics, flagship_metrics, institution_matrix)

    print("Done")
    print(f"People in network: {G.number_of_nodes()}")
    print(f"Co-applicant edges: {G.number_of_edges()}")
    print(f"Network density: {nx.density(G):.4f}")
    print(f"Connected components: {nx.number_connected_components(G)}")
    print()
    print(f"Person metrics: {OUT_PERSON_METRICS}")
    print(f"Flagship metrics: {OUT_FLAGSHIP_METRICS}")
    print(f"Institution collaboration matrix: {OUT_INSTITUTION_MATRIX}")
    print(f"Top connectors: {OUT_TOP_CONNECTORS}")
    print(f"Summary: {OUT_SUMMARY}")
    print(f"Excel output: {OUT_EXCEL}")
    print(f"Interactive network: {OUT_HTML}")
