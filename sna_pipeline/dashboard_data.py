from collections import defaultdict
from itertools import combinations

from .config import CORE_INSTITUTIONS, INSTITUTION_COLORS, SELECTED_FLAGSHIP_GROUPS
from .text_utils import clean_text, safe_float, split_semicolon_values


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


def make_flagship_record(group_id, title, member_ids, applicants, person_metrics):
    group = applicants[applicants["flagship_id"].isin(member_ids)]
    people = set(group["person_id"])
    institutions = sorted(set(group["institution_simplified"].dropna().map(clean_text)) - {""})
    top = (
        person_metrics[person_metrics["person_id"].isin(people)]
        .sort_values(["betweenness_centrality", "weighted_degree", "degree"], ascending=False)
        .head(5)
    )

    return {
        "id": group_id,
        "title": title,
        "member_ids": member_ids,
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

def build_dashboard_data(G, applicants, person_metrics, flagship_metrics):
    metric_map = person_metrics.set_index("person_id").to_dict("index")

    person_flagships = defaultdict(list)
    for _, row in applicants.iterrows():
        item = {
            "id": row["flagship_id"],
            "title": row["flagship_title"],
            "role": row["role"],
        }
        person_flagships[row["person_id"]].append(item)

    persons = []
    for node, attrs in G.nodes(data=True):
        metrics = metric_map.get(node, {})
        institution = attrs.get("institution") or "Unknown"
        institution_clean = attrs.get("institution_clean") or institution
        department = attrs.get("department") or ""
        department_clean = attrs.get("department_clean") or department
        department_group = attrs.get("department_group") or "Unknown"
        flagships = sorted(person_flagships.get(node, []), key=lambda x: x["id"])
        search_parts = [
            attrs.get("name", node),
            attrs.get("email", ""),
            institution,
            institution_clean,
            attrs.get("institution_raw", ""),
            department,
            department_clean,
            department_group,
            attrs.get("department_raw", ""),
            attrs.get("role", ""),
            " ".join(item["title"] for item in flagships),
            " ".join(item["role"] for item in flagships),
        ]
        persons.append({
            "id": node,
            "name": attrs.get("name", node),
            "email": attrs.get("email", ""),
            "institution": institution,
            "institution_clean": institution_clean,
            "department": department,
            "department_clean": department_clean,
            "department_group": department_group,
            "department_tokens": attrs.get("department_tokens", ""),
            "role": attrs.get("role", ""),
            "degree": int(metrics.get("degree", 0) or 0),
            "weighted_degree": safe_float(metrics.get("weighted_degree", 0)),
            "betweenness": safe_float(metrics.get("betweenness_centrality", 0)),
            "community": int(metrics.get("community", 0) or 0),
            "n_flagships": int(metrics.get("n_flagships", 0) or 0),
            "flagships": flagships,
            "search_text": " ".join(clean_text(part).lower() for part in search_parts if clean_text(part)),
            "is_placeholder": bool(attrs.get("is_placeholder_id", False)),
        })

    edges = []
    for source, target, attrs in G.edges(data=True):
        edges.append({
            "source": source,
            "target": target,
            "weight": safe_float(attrs.get("weight", 1), 1),
            "flagships": attrs.get("flagships", []),
            "flagship_titles": attrs.get("flagship_titles", []),
        })

    top_by_flagship = {}
    applicant_counts = applicants.groupby("flagship_id")["person_id"].nunique().to_dict()
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
            "n_applicants": int(row["n_applicants"]),
            "n_institutions": int(row["n_institutions"]),
            "institutions": split_semicolon_values(row["institutions"]),
            "top_connectors": top_by_flagship.get(row["flagship_id"], []),
        })

    flagship_people = {
        flagship_id: set(group["person_id"])
        for flagship_id, group in applicants.groupby("flagship_id")
    }

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

    selected_flagship_people = {
        selected["id"]: set(
            applicants[applicants["flagship_id"].isin(selected["member_ids"])]["person_id"]
        )
        for selected in SELECTED_FLAGSHIP_GROUPS
    }

    flagship_links = build_flagship_links(flagship_people)
    selected_flagship_links = build_flagship_links(selected_flagship_people)
    convergence_overview = build_convergence_overview(
        applicants,
        person_metrics,
        selected_flagship_groups,
        selected_flagship_links,
    )

    raw_institutions = sorted(set(applicants["institution"].dropna().map(clean_text)) - {""})
    simplified_institutions = sorted(set(applicants["institution_simplified"].dropna().map(clean_text)) - {""})
    raw_departments = sorted(set(applicants["department_raw"].dropna().map(clean_text)) - {""}) if "department_raw" in applicants else []
    department_groups = sorted(set(applicants["department_group"].dropna().map(clean_text)) - {""}) if "department_group" in applicants else []
    quality = {
        "people": len(persons),
        "edges": len(edges),
        "flagships": len(flagships),
        "placeholder_person_ids": int(sum(person["is_placeholder"] for person in persons)),
        "raw_institution_values": len(raw_institutions),
        "simplified_institution_values": len(simplified_institutions),
        "raw_department_values": len(raw_departments),
        "department_groups": len(department_groups),
        "raw_institution_examples": raw_institutions[:20],
    }

    return {
        "persons": persons,
        "edges": edges,
        "flagships": flagships,
        "flagship_links": flagship_links,
        "selected_flagship_groups": selected_flagship_groups,
        "selected_flagship_links": selected_flagship_links,
        "convergence_overview": convergence_overview,
        "quality": quality,
        "institution_colors": INSTITUTION_COLORS,
        "department_groups": department_groups,
    }
