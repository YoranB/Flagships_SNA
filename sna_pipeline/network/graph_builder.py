import networkx as nx

from ..text_utils import choose_display_name, choose_institution, split_semicolon_values


def join_unique(values):
    return "; ".join(sorted(set(v for v in values if v)))


def merge_unique(left, right):
    return sorted(set((left or []) + (right or [])))


def contribution_weights(values, weight):
    keys = sorted(set(values or []))
    if not keys:
        return {}
    contribution = float(weight) / len(keys)
    return {key: contribution for key in keys}


def merge_weight_maps(left, right):
    merged = dict(left or {})
    for key, value in (right or {}).items():
        merged[key] = merged.get(key, 0) + float(value)
    return merged


def choose_group(values):
    cleaned = [v for v in values if v]
    if not cleaned:
        return "Unknown"
    counts = {}
    for value in cleaned:
        counts[value] = counts.get(value, 0) + 1
    return sorted(counts, key=lambda item: (-counts[item], item))[0]


def add_placeholder_node(G, node_id, row, side):
    G.add_node(
        node_id,
        name=row.get(f"{side}_name", node_id),
        institution="Unknown",
        institution_raw="",
        institution_clean="Unknown",
        department="",
        department_raw="",
        department_clean="",
        department_group="Unknown",
        department_tokens="",
        role="",
        email=row.get(side, ""),
        call_ids="",
        call_names="",
        proposal_keys="",
    )


def build_person_graph(applicants, person_edges):
    G = nx.Graph()

    person_summary = (
        applicants.groupby("person_id")
        .agg(
            name=("person_name_clean", choose_display_name),
            institution=("institution_simplified", choose_institution),
            institution_raw=("institution_raw", join_unique),
            institution_clean=("institution_clean", choose_institution),
            department=("department_clean", join_unique),
            department_raw=("department_raw", join_unique),
            department_clean=("department_clean", join_unique),
            department_group=("department_group", choose_group),
            department_tokens=("department_tokens", join_unique),
            role=("role", join_unique),
            email=("email", join_unique),
            call_ids=("call_id", join_unique),
            call_names=("call_name", join_unique),
            proposal_keys=("proposal_key", join_unique),
            is_placeholder_id=("is_placeholder_id", "max"),
        )
        .reset_index()
    )

    for _, row in person_summary.iterrows():
        G.add_node(
            row["person_id"],
            name=row["name"],
            institution=row["institution"] or "Unknown",
            institution_raw=row["institution_raw"],
            institution_clean=row["institution_clean"] or row["institution"] or "Unknown",
            department=row["department"],
            department_raw=row["department_raw"],
            department_clean=row["department_clean"],
            department_group=row["department_group"] or "Unknown",
            department_tokens=row["department_tokens"],
            role=row["role"],
            email=row["email"],
            call_ids=row["call_ids"],
            call_names=row["call_names"],
            proposal_keys=row["proposal_keys"],
            is_placeholder_id=bool(row["is_placeholder_id"]),
        )

    for _, row in person_edges.iterrows():
        source = row["source_id"]
        target = row["target_id"]

        if not source or not target or source == target:
            continue

        if source not in G:
            add_placeholder_node(G, source, row, "source")
        if target not in G:
            add_placeholder_node(G, target, row, "target")

        weight = float(row["weight"])
        proposal_keys = split_semicolon_values(row.get("proposal_keys", ""))
        legacy_flagship_ids = split_semicolon_values(row.get("flagships", ""))
        flagship_titles = split_semicolon_values(row.get("flagship_titles", ""))
        call_ids = split_semicolon_values(row.get("call_ids", ""))
        call_names = split_semicolon_values(row.get("call_names", ""))
        display_flagships = proposal_keys or legacy_flagship_ids
        call_weights = contribution_weights(call_ids, weight)
        project_weights = contribution_weights(proposal_keys or legacy_flagship_ids, weight)

        if G.has_edge(source, target):
            edge = G[source][target]
            edge["weight"] += weight
            edge["proposal_keys"] = merge_unique(edge.get("proposal_keys", []), proposal_keys)
            edge["flagships"] = merge_unique(edge.get("flagships", []), display_flagships)
            edge["legacy_flagship_ids"] = merge_unique(edge.get("legacy_flagship_ids", []), legacy_flagship_ids)
            edge["flagship_titles"] = merge_unique(edge.get("flagship_titles", []), flagship_titles)
            edge["call_ids"] = merge_unique(edge.get("call_ids", []), call_ids)
            edge["call_names"] = merge_unique(edge.get("call_names", []), call_names)
            edge["call_weights"] = merge_weight_maps(edge.get("call_weights", {}), call_weights)
            edge["project_weights"] = merge_weight_maps(edge.get("project_weights", {}), project_weights)
        else:
            G.add_edge(
                source,
                target,
                weight=weight,
                proposal_keys=proposal_keys,
                flagships=display_flagships,
                legacy_flagship_ids=legacy_flagship_ids,
                flagship_titles=flagship_titles,
                call_ids=call_ids,
                call_names=call_names,
                call_weights=call_weights,
                project_weights=project_weights,
                relation_type=row.get("relation_type", "co_applicant"),
            )

    return G
