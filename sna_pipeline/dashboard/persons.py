from collections import defaultdict

from ..enrichment.expertise import empty_expertise, load_expertise_map
from ..text_utils import clean_text, safe_float


def build_person_records_and_edges(G, applicants, person_metrics):
    metric_map = person_metrics.set_index("person_id").to_dict("index")
    expertise_map = load_expertise_map()

    person_flagships = defaultdict(list)
    person_calls = defaultdict(dict)
    for _, row in applicants.iterrows():
        proposal_key = row.get("proposal_key", row.get("flagship_id", ""))
        item = {
            "id": proposal_key,
            "title": row["flagship_title"],
            "role": row["role"],
            "proposal_key": proposal_key,
            "proposal_id": row.get("proposal_id", row["flagship_id"]),
            "flagship_id": row["flagship_id"],
            "call_id": row.get("call_id", ""),
            "call_name": row.get("call_name", ""),
        }
        person_flagships[row["person_id"]].append(item)
        call_id = row.get("call_id", "")
        if call_id:
            person_calls[row["person_id"]][call_id] = {
                "id": call_id,
                "name": row.get("call_name", ""),
            }

    persons = []
    for node, attrs in G.nodes(data=True):
        metrics = metric_map.get(node, {})
        institution = attrs.get("institution") or "Unknown"
        institution_clean = attrs.get("institution_clean") or institution
        department = attrs.get("department") or ""
        department_clean = attrs.get("department_clean") or department
        department_group = attrs.get("department_group") or "Unknown"
        expertise = expertise_map.get(node, empty_expertise())
        flagships = sorted(person_flagships.get(node, []), key=lambda x: x["id"])
        calls = sorted(person_calls.get(node, {}).values(), key=lambda x: x["id"])
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
            expertise.get("expertise_keywords", ""),
            expertise.get("expertise_summary", ""),
            " ".join(item["title"] for item in flagships),
            " ".join(item["role"] for item in flagships),
            " ".join(item["name"] for item in calls),
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
            "n_calls": int(metrics.get("n_calls", len(calls)) or 0),
            "calls": calls,
            "proposal_keys": attrs.get("proposal_keys", ""),
            "flagships": flagships,
            "expertise_keywords": expertise.get("expertise_keywords", ""),
            "expertise_summary": expertise.get("expertise_summary", ""),
            "expertise_source_url": expertise.get("expertise_source_url", ""),
            "expertise_source_type": expertise.get("expertise_source_type", ""),
            "expertise_confidence": expertise.get("expertise_confidence", ""),
            "expertise_last_checked": expertise.get("expertise_last_checked", ""),
            "expertise_manual_note": expertise.get("expertise_manual_note", ""),
            "expertise_origin": expertise.get("expertise_origin", ""),
            "search_text": " ".join(clean_text(part).lower() for part in search_parts if clean_text(part)),
            "is_placeholder": bool(attrs.get("is_placeholder_id", False)),
        })

    edges = []
    for source, target, attrs in G.edges(data=True):
        proposal_keys = attrs.get("proposal_keys", [])
        edges.append({
            "source": source,
            "target": target,
            "weight": safe_float(attrs.get("weight", 1), 1),
            "proposal_keys": proposal_keys,
            "flagships": attrs.get("flagships", proposal_keys),
            "legacy_flagship_ids": attrs.get("legacy_flagship_ids", []),
            "flagship_titles": attrs.get("flagship_titles", []),
            "call_ids": attrs.get("call_ids", []),
            "call_names": attrs.get("call_names", []),
        })

    return persons, edges
