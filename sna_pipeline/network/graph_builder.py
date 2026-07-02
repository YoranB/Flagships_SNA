import networkx as nx

from ..text_utils import choose_display_name, choose_institution, split_semicolon_values


def join_unique(values):
    return "; ".join(sorted(set(v for v in values if v)))


def choose_group(values):
    cleaned = [v for v in values if v]
    if not cleaned:
        return "Unknown"
    counts = {}
    for value in cleaned:
        counts[value] = counts.get(value, 0) + 1
    return sorted(counts, key=lambda item: (-counts[item], item))[0]


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
            is_placeholder_id=bool(row["is_placeholder_id"]),
        )

    for _, row in person_edges.iterrows():
        source = row["source_id"]
        target = row["target_id"]

        if not source or not target or source == target:
            continue

        if source not in G:
            G.add_node(source, name=row.get("source_name", source), institution="Unknown", institution_raw="", institution_clean="Unknown", department="", department_raw="", department_clean="", department_group="Unknown", department_tokens="", role="", email=row.get("source", ""), call_ids="", call_names="")
        if target not in G:
            G.add_node(target, name=row.get("target_name", target), institution="Unknown", institution_raw="", institution_clean="Unknown", department="", department_raw="", department_clean="", department_group="Unknown", department_tokens="", role="", email=row.get("target", ""), call_ids="", call_names="")

        weight = float(row["weight"])
        flagships = split_semicolon_values(row.get("flagships", ""))
        flagship_titles = split_semicolon_values(row.get("flagship_titles", ""))
        call_ids = split_semicolon_values(row.get("call_ids", ""))
        call_names = split_semicolon_values(row.get("call_names", ""))

        if G.has_edge(source, target):
            G[source][target]["weight"] += weight
            G[source][target]["flagships"] = sorted(set(G[source][target]["flagships"] + flagships))
            G[source][target]["flagship_titles"] = sorted(set(G[source][target]["flagship_titles"] + flagship_titles))
            G[source][target]["call_ids"] = sorted(set(G[source][target]["call_ids"] + call_ids))
            G[source][target]["call_names"] = sorted(set(G[source][target]["call_names"] + call_names))
        else:
            G.add_edge(
                source,
                target,
                weight=weight,
                flagships=flagships,
                flagship_titles=flagship_titles,
                call_ids=call_ids,
                call_names=call_names,
                relation_type=row.get("relation_type", "co_applicant"),
            )

    return G
