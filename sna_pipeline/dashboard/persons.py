from collections import defaultdict

from ..enrichment.expertise import empty_expertise, load_expertise_map
from ..text_utils import clean_text, safe_float, split_semicolon_values


def expertise_for_person(person_id, expertise_map):
    candidates = [person_id]
    if "|flagship::" in person_id:
        candidates.append(person_id.replace("|flagship::", "|", 1))
    for candidate in candidates:
        if candidate in expertise_map:
            return expertise_map[candidate], candidate
    return empty_expertise(), ""


def build_person_records_and_edges(G, applicants, person_metrics, include_expertise_quality=False):
    metric_map = person_metrics.set_index("person_id").to_dict("index")
    expertise_map = load_expertise_map()

    person_flagships = defaultdict(list)
    person_project_contexts = defaultdict(dict)
    person_calls = defaultdict(dict)
    for _, row in applicants.iterrows():
        proposal_key = row.get("proposal_key", row.get("flagship_id", ""))
        is_dashboard_project = clean_text(row.get("dashboard_project_node", "")).lower() != "false"
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
        if is_dashboard_project:
            person_flagships[row["person_id"]].append(item)
        else:
            summary = clean_text(row.get("project_summary", row.get("program_description", "")))
            person_project_contexts[row["person_id"]][proposal_key] = {
                "id": proposal_key,
                "project_id": row.get("proposal_id", row.get("flagship_id", "")),
                "title": row.get("proposal_title", row.get("flagship_title", "")),
                "call_id": row.get("call_id", ""),
                "call_name": row.get("call_name", ""),
                "theme": row.get("project_theme", ""),
                "project_type": row.get("project_type", ""),
                "role": row.get("role", ""),
                "summary": summary[:500],
            }
        call_id = row.get("call_id", "")
        if call_id:
            person_calls[row["person_id"]][call_id] = {
                "id": call_id,
                "name": row.get("call_name", ""),
            }

    persons = []
    matched_expertise_ids = set()
    for node, attrs in G.nodes(data=True):
        metrics = metric_map.get(node, {})
        institution = attrs.get("institution") or "Unknown"
        institution_clean = attrs.get("institution_clean") or institution
        department = attrs.get("department") or ""
        department_clean = attrs.get("department_clean") or department
        department_group = attrs.get("department_group") or "Unknown"
        expertise, matched_expertise_id = expertise_for_person(node, expertise_map)
        if matched_expertise_id:
            matched_expertise_ids.add(matched_expertise_id)
        institution_units = split_semicolon_values(attrs.get("institution_units", "")) or [institution_clean or "Unknown"]
        department_units = split_semicolon_values(attrs.get("department_units", "")) or [department_group]
        has_expertise = bool(clean_text(expertise.get("expertise_keywords", "")) or clean_text(expertise.get("expertise_summary", "")))
        flagships = sorted(person_flagships.get(node, []), key=lambda x: x["id"])
        project_contexts = sorted(person_project_contexts.get(node, {}).values(), key=lambda x: (x["call_name"], x["title"]))
        derived_topics = sorted({item["theme"] for item in project_contexts if clean_text(item["theme"])})
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
            " ".join(item["title"] for item in project_contexts),
            " ".join(item["theme"] for item in project_contexts),
            " ".join(item["role"] for item in project_contexts),
            " ".join(item["summary"] for item in project_contexts),
        ]
        persons.append({
            "id": node,
            "name": attrs.get("name", node),
            "email": attrs.get("email", ""),
            "institution": institution,
            "institution_raw": attrs.get("institution_raw", ""),
            "institution_clean": institution_clean,
            "institution_units": institution_units,
            "department": department,
            "department_raw": attrs.get("department_raw", ""),
            "department_clean": department_clean,
            "department_group": department_group,
            "department_units": department_units,
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
            "project_contexts": project_contexts,
            "derived_topics": derived_topics,
            "expertise_keywords": expertise.get("expertise_keywords", ""),
            "expertise_summary": expertise.get("expertise_summary", ""),
            "expertise_source_url": expertise.get("expertise_source_url", ""),
            "expertise_source_type": expertise.get("expertise_source_type", ""),
            "expertise_confidence": expertise.get("expertise_confidence", ""),
            "expertise_last_checked": expertise.get("expertise_last_checked", ""),
            "expertise_manual_note": expertise.get("expertise_manual_note", ""),
            "expertise_origin": expertise.get("expertise_origin", ""),
            "has_expertise": has_expertise,
            "expertise_availability": "available" if has_expertise else "not_available",
            "base_search_text": " ".join(clean_text(part).lower() for part in search_parts[:-4] if clean_text(part)),
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
            "call_weights": attrs.get("call_weights", {}),
            "project_weights": attrs.get("project_weights", {}),
            "project_ids": sorted(attrs.get("project_weights", {})),
            "project_titles": attrs.get("flagship_titles", []),
        })

    expertise_quality = {
        "records": len(expertise_map),
        "matched_records": len(matched_expertise_ids),
        "unmatched_records": len(set(expertise_map) - matched_expertise_ids),
        "unmatched_person_ids": sorted(set(expertise_map) - matched_expertise_ids),
        "people_with_expertise": sum(person["has_expertise"] for person in persons),
    }
    if include_expertise_quality:
        return persons, edges, expertise_quality
    return persons, edges
