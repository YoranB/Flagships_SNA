from collections import defaultdict
from itertools import combinations

from .config import INSTITUTION_COLORS, SELECTED_FLAGSHIP_GROUPS
from .text_utils import clean_text, safe_float, split_semicolon_values


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
            "institution_raw": attrs.get("institution_raw", ""),
            "institution_clean": institution_clean,
            "department": department,
            "department_raw": attrs.get("department_raw", ""),
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
        "quality": quality,
        "institution_colors": INSTITUTION_COLORS,
        "department_groups": department_groups,
    }
