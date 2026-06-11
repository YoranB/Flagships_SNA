import pandas as pd
import networkx as nx

from .config import OUT_EXCEL, OUT_SUMMARY


def write_summary(G, person_metrics, flagship_metrics, institution_matrix):
    n_nodes = G.number_of_nodes()
    n_edges = G.number_of_edges()
    density = nx.density(G)

    components = list(nx.connected_components(G))
    largest_component = max(components, key=len) if components else []
    n_components = len(components)

    top_degree = person_metrics.sort_values("degree", ascending=False).head(10)
    top_betweenness = person_metrics.sort_values("betweenness_centrality", ascending=False).head(10)
    top_cross_flagship = person_metrics.sort_values("n_flagships", ascending=False).head(10)

    lines = []
    lines.append("SOCIAL NETWORK ANALYSIS SUMMARY")
    lines.append("=" * 50)
    lines.append("")
    lines.append(f"Nodes, people: {n_nodes}")
    lines.append(f"Edges, co-applicant relations: {n_edges}")
    lines.append(f"Network density: {density:.4f}")
    lines.append(f"Connected components: {n_components}")
    lines.append(f"Largest component size: {len(largest_component)}")
    lines.append(f"Flagships: {len(flagship_metrics)}")
    lines.append("")
    lines.append("Top 10 by degree")
    lines.append("-" * 50)
    for _, row in top_degree.iterrows():
        lines.append(f"{row['person_name']} | {row['institution']} | degree={row['degree']} | flagships={row['n_flagships']}")

    lines.append("")
    lines.append("Top 10 by betweenness centrality")
    lines.append("-" * 50)
    for _, row in top_betweenness.iterrows():
        lines.append(f"{row['person_name']} | {row['institution']} | betweenness={row['betweenness_centrality']:.4f} | flagships={row['n_flagships']}")

    lines.append("")
    lines.append("Top 10 cross-flagship people")
    lines.append("-" * 50)
    for _, row in top_cross_flagship.iterrows():
        lines.append(f"{row['person_name']} | {row['institution']} | flagships={row['n_flagships']} | degree={row['degree']}")

    lines.append("")
    lines.append("Top institution collaborations")
    lines.append("-" * 50)
    if not institution_matrix.empty:
        for _, row in institution_matrix.head(10).iterrows():
            lines.append(f"{row['institution_a']} <-> {row['institution_b']} | weight={row['weight']} | flagships={row['n_flagships']}")

    OUT_SUMMARY.write_text("\n".join(lines), encoding="utf-8")

def save_excel_outputs(person_metrics, flagship_metrics, institution_matrix, top_connectors):
    with pd.ExcelWriter(OUT_EXCEL, engine="openpyxl") as writer:
        person_metrics.to_excel(writer, sheet_name="Person metrics", index=False)
        flagship_metrics.to_excel(writer, sheet_name="Flagship metrics", index=False)
        institution_matrix.to_excel(writer, sheet_name="Institution matrix", index=False)
        top_connectors.to_excel(writer, sheet_name="Top connectors", index=False)
