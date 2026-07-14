from itertools import combinations

import networkx as nx
import pandas as pd

from ..config import CORE_INSTITUTIONS


def calculate_person_metrics(G, applicants):
    degree = dict(G.degree())
    weighted_degree = dict(G.degree(weight="weight"))

    degree_centrality = nx.degree_centrality(G)
    distance_graph = G.copy()
    for _, _, attrs in distance_graph.edges(data=True):
        strength = float(attrs.get("weight", 1) or 1)
        attrs["distance"] = 1.0 / strength if strength > 0 else 1.0
    betweenness = nx.betweenness_centrality(distance_graph, weight="distance", normalized=True)
    closeness = nx.closeness_centrality(G)

    try:
        eigenvector = nx.eigenvector_centrality(G, weight="weight", max_iter=1000)
    except nx.PowerIterationFailedConvergence:
        eigenvector = {node: None for node in G.nodes}

    communities = list(nx.community.greedy_modularity_communities(G, weight="weight"))
    community_map = {}
    for idx, community in enumerate(communities, start=1):
        for node in community:
            community_map[node] = idx

    flagship_counts = (
        applicants.groupby("person_id")["proposal_key"]
        .nunique()
        .rename("n_flagships")
        .reset_index()
    )

    call_counts = (
        applicants.groupby("person_id")["call_id"]
        .nunique()
        .rename("n_calls")
        .reset_index()
    )

    role_summary = (
        applicants.groupby("person_id")["role"]
        .apply(lambda x: "; ".join(sorted(set(v for v in x if v))))
        .rename("roles_all")
        .reset_index()
    )

    flagship_summary = (
        applicants.groupby("person_id")["flagship_title"]
        .apply(lambda x: "; ".join(sorted(set(v for v in x if v))))
        .rename("flagship_titles_all")
        .reset_index()
    )

    call_summary = (
        applicants.groupby("person_id")["call_name"]
        .apply(lambda x: "; ".join(sorted(set(v for v in x if v))))
        .rename("call_names_all")
        .reset_index()
    )

    proposal_key_summary = (
        applicants.groupby("person_id")["proposal_key"]
        .apply(lambda x: "; ".join(sorted(set(v for v in x if v))))
        .rename("proposal_keys_all")
        .reset_index()
    )

    rows = []

    for node, attrs in G.nodes(data=True):
        rows.append({
            "person_id": node,
            "email": attrs.get("email", ""),
            "person_name": attrs.get("name", ""),
            "institution": attrs.get("institution", ""),
            "institution_raw": attrs.get("institution_raw", ""),
            "institution_clean": attrs.get("institution_clean", attrs.get("institution", "")),
            "department": attrs.get("department", ""),
            "department_raw": attrs.get("department_raw", ""),
            "department_clean": attrs.get("department_clean", attrs.get("department", "")),
            "department_group": attrs.get("department_group", "Unknown"),
            "call_ids": attrs.get("call_ids", ""),
            "call_names": attrs.get("call_names", ""),
            "proposal_keys": attrs.get("proposal_keys", ""),
            "is_placeholder_id": attrs.get("is_placeholder_id", False),
            "degree": degree.get(node, 0),
            "weighted_degree": weighted_degree.get(node, 0),
            "degree_centrality": degree_centrality.get(node, 0),
            "betweenness_centrality": betweenness.get(node, 0),
            "closeness_centrality": closeness.get(node, 0),
            "eigenvector_centrality": eigenvector.get(node, None),
            "community": community_map.get(node, None),
        })

    metrics = pd.DataFrame(rows)

    metrics = metrics.merge(flagship_counts, on="person_id", how="left")
    metrics = metrics.merge(call_counts, on="person_id", how="left")
    metrics = metrics.merge(role_summary, on="person_id", how="left")
    metrics = metrics.merge(flagship_summary, on="person_id", how="left")
    metrics = metrics.merge(call_summary, on="person_id", how="left")
    metrics = metrics.merge(proposal_key_summary, on="person_id", how="left")

    metrics["n_flagships"] = metrics["n_flagships"].fillna(0).astype(int)
    metrics["n_calls"] = metrics["n_calls"].fillna(0).astype(int)

    metrics = metrics.sort_values(
        by=["betweenness_centrality", "weighted_degree", "degree"],
        ascending=False,
    )

    return metrics


def calculate_flagship_metrics(applicants):
    rows = []

    for proposal_key, group in applicants.groupby("proposal_key"):
        institutions = group["institution_simplified"].dropna().unique()
        people = group["person_id"].nunique()

        institution_counts = (
            group["institution_simplified"]
            .value_counts()
            .to_dict()
        )

        rows.append({
            "proposal_key": proposal_key,
            "flagship_id": group["flagship_id"].iloc[0],
            "proposal_id": group["proposal_id"].iloc[0],
            "call_id": group["call_id"].iloc[0],
            "call_name": group["call_name"].iloc[0],
            "flagship_title": group["flagship_title"].iloc[0],
            "proposal_title": group["proposal_title"].iloc[0] if "proposal_title" in group else group["flagship_title"].iloc[0],
            "source_file": group["source_file"].iloc[0] if "source_file" in group else "",
            "n_applicants": people,
            "n_institutions": len(institutions),
            "institutions": "; ".join(sorted(institutions)),
            "erasmus_mc_count": institution_counts.get("Erasmus MC", 0),
            "tu_delft_count": institution_counts.get("TU Delft", 0),
            "eur_count": institution_counts.get("Erasmus University Rotterdam", 0),
            "external_or_other_count": sum(
                count for inst, count in institution_counts.items()
                if inst not in CORE_INSTITUTIONS
            ),
        })

    return pd.DataFrame(rows).sort_values("n_applicants", ascending=False)


def calculate_institution_collaboration(applicants):
    rows = []

    for proposal_key, group in applicants.groupby("proposal_key"):
        people = group[["person_id", "institution_simplified"]].drop_duplicates()

        for (_, row_a), (_, row_b) in combinations(people.iterrows(), 2):
            inst_a = row_a["institution_simplified"]
            inst_b = row_b["institution_simplified"]

            if inst_a == inst_b:
                continue

            pair = sorted([inst_a, inst_b])

            rows.append({
                "institution_a": pair[0],
                "institution_b": pair[1],
                "proposal_key": proposal_key,
                "flagship_id": group["flagship_id"].iloc[0],
                "call_id": group["call_id"].iloc[0],
                "weight": 1,
            })

    df = pd.DataFrame(rows)

    if df.empty:
        return df

    return (
        df.groupby(["institution_a", "institution_b"], as_index=False)
        .agg(
            weight=("weight", "sum"),
            n_flagships=("proposal_key", lambda x: len(set(x))),
            flagships=("proposal_key", lambda x: "; ".join(sorted(set(map(str, x))))),
        )
        .sort_values("weight", ascending=False)
    )
