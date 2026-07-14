from collections import Counter
from itertools import combinations

from ..config import INSTITUTION_COLORS
from .campus import build_campus_dashboard_data
from .convergence import build_convergence_overview
from .flagships import build_flagship_records
from .partners import build_partner_dashboard_data
from .persons import build_person_records_and_edges
from .quality import build_quality_summary


def _count_dict(values):
    return dict(sorted(Counter(value for value in values if value).items(), key=lambda item: (-item[1], item[0].lower())))


def build_call_records(applicants, edges, project_catalog=None):
    project_catalog = project_catalog or []
    catalog_by_call = {}
    for project in project_catalog:
        catalog_by_call.setdefault(project["call_id"], []).append(project)
    calls = []
    for call_id, group in applicants.groupby("call_id"):
        catalog = catalog_by_call.get(call_id, [])
        call_edges = [edge for edge in edges if call_id in edge.get("call_weights", {})]
        calls.append({
            "id": call_id,
            "name": group["call_name"].iloc[0],
            "n_people": int(group["person_id"].nunique()),
            "n_projects": int(len(catalog) or group["proposal_key"].nunique()),
            "n_network_projects": int(sum(bool(item.get("network_ready")) for item in catalog) or group["proposal_key"].nunique()),
            "n_relationships": int(len(call_edges)),
            "n_institutions": int(group["institution_simplified"].nunique()),
            "themes": _count_dict(item.get("theme", "") for item in catalog),
            "project_types": _count_dict(item.get("project_type", "") for item in catalog),
        })
    return sorted(calls, key=lambda item: item["name"].lower())


def build_call_overlaps(applicants):
    people_by_call = {
        call_id: set(group["person_id"])
        for call_id, group in applicants.groupby("call_id")
    }
    overlaps = []
    for source, target in combinations(sorted(people_by_call), 2):
        shared = sorted(people_by_call[source] & people_by_call[target])
        if shared:
            overlaps.append({
                "source": source,
                "target": target,
                "weight": len(shared),
                "shared_people": shared,
            })
    return overlaps


def build_dashboard_data(
    G,
    applicants,
    person_metrics,
    flagship_metrics,
    partners=None,
    project_catalog=None,
    import_quality=None,
):
    persons, edges = build_person_records_and_edges(G, applicants, person_metrics)
    flagship_data = build_flagship_records(applicants, person_metrics, flagship_metrics)
    quality, department_groups = build_quality_summary(
        applicants,
        persons,
        edges,
        flagship_data["flagships"],
    )
    convergence_overview = build_convergence_overview(
        applicants,
        person_metrics,
        flagship_data["selected_flagship_groups"],
        flagship_data["selected_flagship_links"],
    )
    partner_data = build_partner_dashboard_data(partners, applicants, flagship_metrics)
    campus_data = build_campus_dashboard_data(applicants, flagship_data, partner_data)

    return {
        "persons": persons,
        "edges": edges,
        "calls": build_call_records(applicants, edges, project_catalog),
        "call_overlaps": build_call_overlaps(applicants),
        "project_catalog": project_catalog or [],
        "import_quality": import_quality or {"totals": {}, "by_call": {}, "unresolved_projects": []},
        "flagships": flagship_data["flagships"],
        "flagship_links": flagship_data["flagship_links"],
        "selected_flagship_groups": flagship_data["selected_flagship_groups"],
        "selected_flagship_links": flagship_data["selected_flagship_links"],
        "convergence_overview": convergence_overview,
        "quality": quality,
        "institution_colors": INSTITUTION_COLORS,
        "department_groups": department_groups,
        "campus": campus_data,
        **partner_data,
    }
