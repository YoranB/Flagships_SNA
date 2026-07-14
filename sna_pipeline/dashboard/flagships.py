from itertools import combinations

import pandas as pd

from ..config import SELECTED_FLAGSHIP_GROUPS
from ..text_utils import clean_text, safe_float, split_semicolon_values


def membership_mask(applicants, member_ids):
    members = set(member_ids)
    mask = applicants["flagship_id"].isin(members)
    if "proposal_id" in applicants:
        mask = mask | applicants["proposal_id"].isin(members)
    if "proposal_key" in applicants:
        mask = mask | applicants["proposal_key"].isin(members)
    return mask


def make_flagship_record(group_id, title, member_ids, applicants, person_metrics):
    group = applicants[membership_mask(applicants, member_ids)]
    people = set(group["person_id"])
    institutions = sorted(set(group["institution_simplified"].dropna().map(clean_text)) - {""})
    proposal_keys = sorted(set(group["proposal_key"].dropna().map(clean_text)) - {""}) if "proposal_key" in group else []
    proposal_ids = sorted(set(group["proposal_id"].dropna().map(clean_text)) - {""}) if "proposal_id" in group else []
    call_ids = sorted(set(group["call_id"].dropna().map(clean_text)) - {""})
    call_names = sorted(set(group["call_name"].dropna().map(clean_text)) - {""})
    dashboard_member_ids = sorted(set(proposal_keys) | set(member_ids))
    top = (
        person_metrics[person_metrics["person_id"].isin(people)]
        .sort_values(["betweenness_centrality", "weighted_degree", "degree"], ascending=False)
        .head(5)
    )

    return {
        "id": group_id,
        "title": title,
        "member_ids": dashboard_member_ids,
        "legacy_member_ids": list(member_ids),
        "proposal_key": "; ".join(proposal_keys),
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
    visible_metrics = flagship_metrics[
        flagship_metrics.get("dashboard_project_node", True).astype(bool)
        if "dashboard_project_node" in flagship_metrics
        else pd.Series(True, index=flagship_metrics.index)
    ]
    visible_proposal_keys = set(visible_metrics["proposal_key"])
    top_by_proposal = {}
    for proposal_key, group in applicants[applicants["proposal_key"].isin(visible_proposal_keys)].groupby("proposal_key"):
        people = set(group["person_id"])
        top = (
            person_metrics[person_metrics["person_id"].isin(people)]
            .sort_values(["betweenness_centrality", "weighted_degree", "degree"], ascending=False)
            .head(5)
        )
        top_by_proposal[proposal_key] = [
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
    for _, row in visible_metrics.sort_values("proposal_key").iterrows():
        proposal_key = row["proposal_key"]
        legacy_id = row["flagship_id"]
        member_ids = sorted(set([proposal_key, legacy_id]))
        flagships.append({
            "id": proposal_key,
            "title": row["flagship_title"],
            "member_ids": member_ids,
            "legacy_member_ids": [legacy_id],
            "proposal_key": proposal_key,
            "proposal_id": row.get("proposal_id", legacy_id),
            "flagship_id": legacy_id,
            "call_id": row.get("call_id", ""),
            "call_name": row.get("call_name", ""),
            "n_applicants": int(row["n_applicants"]),
            "n_institutions": int(row["n_institutions"]),
            "institutions": split_semicolon_values(row["institutions"]),
            "top_connectors": top_by_proposal.get(proposal_key, []),
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
        proposal_key: set(group["person_id"])
        for proposal_key, group in applicants[applicants["proposal_key"].isin(visible_proposal_keys)].groupby("proposal_key")
    }
    selected_flagship_people = {
        selected["id"]: set(
            applicants[applicants["proposal_key"].isin(selected["member_ids"])]
            ["person_id"]
        )
        for selected in selected_flagship_groups
    }

    return {
        "flagships": flagships,
        "flagship_links": build_flagship_links(flagship_people),
        "selected_flagship_groups": selected_flagship_groups,
        "selected_flagship_links": build_flagship_links(selected_flagship_people),
    }
