from collections import defaultdict
from itertools import combinations

from ..config import CORE_INSTITUTIONS, SELECTED_FLAGSHIP_GROUPS
from ..text_utils import clean_text, safe_float


EXTERNAL_INSTITUTION_GROUP = "Externe/overige partners"
CONVERGENCE_INSTITUTION_GROUPS = [
    "Erasmus MC",
    "TU Delft",
    "Erasmus University Rotterdam",
    EXTERNAL_INSTITUTION_GROUP,
]


def convergence_institution_group(institution):
    value = clean_text(institution)
    return value if value in CORE_INSTITUTIONS else EXTERNAL_INSTITUTION_GROUP


def build_top_bridge_people(group, member_ids, person_metrics):
    metric_map = person_metrics.set_index("person_id").to_dict("index")
    name_column = "person_name_clean" if "person_name_clean" in group.columns else "person_id"
    people_names = (
        group.drop_duplicates("person_id")
        .set_index("person_id")[name_column]
        .to_dict()
    )
    people_institutions = (
        group.drop_duplicates("person_id")
        .set_index("person_id")["institution_simplified"]
        .to_dict()
    )
    cross_counts = defaultdict(int)

    for member_id in member_ids:
        member_people = (
            group[group["flagship_id"] == member_id]
            [["person_id", "institution_simplified"]]
            .drop_duplicates("person_id")
            .copy()
        )
        member_people["institution_group"] = member_people["institution_simplified"].map(convergence_institution_group)
        records = member_people.to_dict("records")
        for left, right in combinations(records, 2):
            if left["institution_group"] == right["institution_group"]:
                continue
            cross_counts[left["person_id"]] += 1
            cross_counts[right["person_id"]] += 1

    ranked = sorted(
        cross_counts.items(),
        key=lambda item: (
            -item[1],
            -safe_float(metric_map.get(item[0], {}).get("betweenness_centrality", 0)),
            clean_text(people_names.get(item[0], item[0])).lower(),
        ),
    )

    return [
        {
            "id": person_id,
            "name": people_names.get(person_id) or metric_map.get(person_id, {}).get("person_name") or person_id,
            "institution": convergence_institution_group(people_institutions.get(person_id, "")),
            "cross_institution_edges": int(count),
            "betweenness": safe_float(metric_map.get(person_id, {}).get("betweenness_centrality", 0)),
        }
        for person_id, count in ranked[:8]
    ]


def build_convergence_overview(applicants, person_metrics, selected_flagship_groups, selected_flagship_links):
    profiles = []
    for selected in SELECTED_FLAGSHIP_GROUPS:
        group = applicants[applicants["flagship_id"].isin(selected["member_ids"])].copy()
        people = (
            group[["person_id", "institution_simplified"]]
            .drop_duplicates("person_id")
            .copy()
        )
        people["institution_group"] = people["institution_simplified"].map(convergence_institution_group)
        counts = {institution: 0 for institution in CONVERGENCE_INSTITUTION_GROUPS}
        for institution, count in people["institution_group"].value_counts().to_dict().items():
            counts[institution] = int(count)

        total = int(people["person_id"].nunique())
        diversity = 0.0
        if total:
            diversity = 1 - sum((count / total) ** 2 for count in counts.values())
        present = [institution for institution, count in counts.items() if count > 0]
        largest_group = max(
            CONVERGENCE_INSTITUTION_GROUPS,
            key=lambda institution: (counts[institution], -CONVERGENCE_INSTITUTION_GROUPS.index(institution)),
        )

        profiles.append({
            "id": selected["id"],
            "title": selected["title"],
            "member_ids": selected["member_ids"],
            "counts": counts,
            "total_applicants": total,
            "diversity_score": round(safe_float(diversity), 4),
            "n_institution_groups": int(len(present)),
            "largest_group": largest_group if total else "Unknown",
            "top_bridge_people": build_top_bridge_people(group, selected["member_ids"], person_metrics),
        })

    ranking = sorted(
        profiles,
        key=lambda item: (
            -item["diversity_score"],
            -item["n_institution_groups"],
            -item["total_applicants"],
            item["title"].lower(),
        ),
    )

    return {
        "institution_groups": CONVERGENCE_INSTITUTION_GROUPS,
        "flagships": profiles,
        "ranking": ranking,
        "network_nodes": selected_flagship_groups,
        "network_edges": selected_flagship_links,
    }
