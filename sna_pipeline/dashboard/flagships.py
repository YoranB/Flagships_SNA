from itertools import combinations

from ..config import SELECTED_FLAGSHIP_GROUPS
from ..text_utils import clean_text, safe_float, split_semicolon_values


def make_flagship_record(group_id, title, member_ids, applicants, person_metrics):
    group = applicants[applicants["flagship_id"].isin(member_ids)]
    people = set(group["person_id"])
    institutions = sorted(set(group["institution_simplified"].dropna().map(clean_text)) - {""})
    proposal_ids = sorted(set(group["proposal_id"].dropna().map(clean_text)) - {""})
    call_ids = sorted(set(group["call_id"].dropna().map(clean_text)) - {""})
    call_names = sorted(set(group["call_name"].dropna().map(clean_text)) - {""})
    top = (
        person_metrics[person_metrics["person_id"].isin(people)]
        .sort_values(["betweenness_centrality", "weighted_degree", "degree"], ascending=False)
        .head(5)
    )

    return {
        "id": group_id,
        "title": title,
        "member_ids": member_ids,
        "proposal_id": "; ".join(proposal_ids),
        "call_id": "; ".join(call_ids),
        "call_name": "; ".join(call_names),
        "n_applicants": int(len(people)),
        "n_institutions": int(len(institutions)),
        "institutions": institutions,
        "top_connectors": [
            {
                "id": row["person_id"],
                "name": row["person_name"],
                "institution": row["institution"],
                "degree": int(row["degree"]),
                "betweenness": safe_float(row["betweenness_centrality"]),
            }
            for _, row in top.iterrows()
        ],
    }


def build_flagship_links(flagship_people):
    links = []
    for source_id, target_id in combinations(sorted(flagship_people), 2):
        shared = sorted(flagship_people[source_id] & flagship_people[target_id])
        if not shared:
            continue
        links.append({
            "source": source_id,
            "target": target_id,
            "weight": len(shared),
            "shared_people": shared,
        })
    return links


def build_flagship_records(applicants, person_metrics, flagship_metrics):
    top_by_flagship = {}
    for flagship_id, group in applicants.groupby("flagship_id"):
        people = set(group["person_id"])
        top = (
            person_metrics[person_metrics["person_id"].isin(people)]
            .sort_values(["betweenness_centrality", "weighted_degree", "degree"], ascending=False)
            .head(5)
        )
        top_by_flagship[flagship_id] = [
            {
                "id": row["person_id"],
                "name": row["person_name"],
                "institution": row["institution"],
                "degree": int(row["degree"]),
                "betweenness": safe_float(row["betweenness_centrality"]),
            }
            for _, row in top.iterrows()
        ]

    flagships = []
    for _, row in flagship_metrics.sort_values("flagship_id").iterrows():
        flagships.append({
            "id": row["flagship_id"],
            "title": row["flagship_title"],
            "member_ids": [row["flagship_id"]],
            "proposal_id": row.get("proposal_id", row["flagship_id"]),
            "call_id": row.get("call_id", ""),
            "call_name": row.get("call_name", ""),
            "n_applicants": int(row["n_applicants"]),
            "n_institutions": int(row["n_institutions"]),
            "institutions": split_semicolon_values(row["institutions"]),
            "top_connectors": top_by_flagship.get(row["flagship_id"], []),
        })

    selected_flagship_groups = [
        make_flagship_record(
            selected["id"],
            selected["title"],
            selected["member_ids"],
            applicants,
            person_metrics,
        )
        for selected in SELECTED_FLAGSHIP_GROUPS
    ]

    flagship_people = {
        flagship_id: set(group["person_id"])
        for flagship_id, group in applicants.groupby("flagship_id")
    }
    selected_flagship_people = {
        selected["id"]: set(
            applicants[applicants["flagship_id"].isin(selected["member_ids"])]["person_id"]
        )
        for selected in SELECTED_FLAGSHIP_GROUPS
    }

    return {
        "flagships": flagships,
        "flagship_links": build_flagship_links(flagship_people),
        "selected_flagship_groups": selected_flagship_groups,
        "selected_flagship_links": build_flagship_links(selected_flagship_people),
    }
