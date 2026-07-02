from collections import defaultdict

import pandas as pd

from ..config import CAMPUS_CLUSTER_MAPPING, CAMPUS_PARTNER_MAPPING, SELECTED_FLAGSHIP_GROUPS
from ..text_utils import clean_text, normalize_for_id


CAMPUS_CLUSTERS = [
    "Workforce & system transformation",
    "AI-driven early detection, smart diagnostics & decision support",
    "Care anywhere / hybrid care",
    "Precision medicine at scale & advanced therapies",
    "Prevention & positive health",
]

ALLOWED_SOURCE_TYPES = {"Flagship", "Sustainable Health"}
ALLOWED_PARTNER_TYPES = {
    "company",
    "hospital/healthcare organisation",
    "university/knowledge institute",
    "government/public organisation",
    "investor/funder",
    "other/unknown",
}

CLUSTER_MAPPING_COLUMNS = [
    "project_id",
    "project_name",
    "source_type",
    "primary_cluster",
    "evidence_text",
    "notes",
]

PARTNER_MAPPING_COLUMNS = [
    "project_id",
    "project_name",
    "source_type",
    "partner_name",
    "partner_type",
    "evidence_text",
    "notes",
]

FLAGSHIP_PROJECT_TO_SELECTED_ID = {
    "flagship_alive": "selected:alive",
    "flagship_chmc": "selected:human-mobility-chmc",
    "flagship_healthy_joints": "selected:healthy-joints",
    "flagship_organ_transplantation": "selected:organ-transplantation",
    "flagship_personalized_real_time_health": "selected:personalized-real-time-health-impact",
    "flagship_icell": "selected:icell",
    "flagship_cific": "selected:cific",
    "flagship_smart_or_2030": "selected:smart-or2030",
    "flagship_consultation_room_2030": "selected:consultation-room-2030",
    "flagship_integrative_neuromedicine": "selected:integrative-neuromedicine",
}

SUSTAINABLE_PROJECT_TO_PROPOSAL_KEY = {
    "sh_smart_or_2030": "sustainable-health-programs::shp-smart-or2030",
    "sh_zero_emission_endoscopy": "sustainable-health-programs::shp-zero-emission-endoscopy",
    "sh_technological_innovations_for_nurses": "sustainable-health-programs::shp-technological-innovations-for-nurses",
}


def cluster_id(value):
    return f"campus-cluster:{normalize_for_id(value)}"


def project_node_id(project_id):
    return f"campus-project:{project_id}"


def partner_node_id(project_id, partner_name):
    return f"campus-partner:{project_id}:{normalize_for_id(partner_name)}"


def read_csv_mapping(path, columns):
    if not path.exists():
        return pd.DataFrame(columns=columns)
    data = pd.read_csv(path, dtype=str).fillna("")
    missing = [column for column in columns if column not in data.columns]
    if missing:
        raise ValueError(f"Missing columns in {path}: {', '.join(missing)}")
    data = data[columns].copy()
    for column in data.columns:
        data[column] = data[column].apply(clean_text)
    return data


def selected_group_lookup():
    return {group["id"]: group for group in SELECTED_FLAGSHIP_GROUPS}


def dashboard_lookup(flagship_data):
    records = {}
    for item in flagship_data.get("flagships", []) + flagship_data.get("selected_flagship_groups", []):
        records[item["id"]] = item
    return records


def project_dashboard_id(project_id, source_type):
    if source_type == "Flagship":
        return FLAGSHIP_PROJECT_TO_SELECTED_ID.get(project_id, "")
    return SUSTAINABLE_PROJECT_TO_PROPOSAL_KEY.get(project_id, "")


def project_member_ids(project_id, source_type, dashboard_items):
    dashboard_id = project_dashboard_id(project_id, source_type)
    item = dashboard_items.get(dashboard_id, {})
    if item.get("member_ids"):
        return item["member_ids"]
    if dashboard_id:
        return [dashboard_id]
    return []


def project_people_count(applicants, member_ids):
    if not member_ids:
        return 0
    members = set(member_ids)
    mask = applicants["flagship_id"].isin(members)
    if "proposal_id" in applicants:
        mask = mask | applicants["proposal_id"].isin(members)
    if "proposal_key" in applicants:
        mask = mask | applicants["proposal_key"].isin(members)
    return int(applicants[mask]["person_id"].nunique()) if "person_id" in applicants else int(mask.sum())


def existing_partner_links_for_project(project, partner_data):
    member_ids = set(project.get("member_ids", []))
    if not member_ids:
        return []
    links = []
    for link in partner_data.get("partner_flagship_links", []):
        if clean_text(link.get("flagship_id", "")) in member_ids:
            links.append({
                "id": f"campus-existing-partner:{project['project_id']}:{link['id']}",
                "project_id": project["project_id"],
                "project_name": project["project_name"],
                "source_type": project["source_type"],
                "partner_name": link.get("partner_name", ""),
                "partner_type": link.get("partner_category", "other/unknown"),
                "evidence_text": link.get("role_relevance", ""),
                "notes": "Imported from existing flagship partner data",
                "source": "existing_flagship_partner_data",
                "source_link_id": link.get("id", ""),
            })
    return links


def manual_partner_links(projects_by_id):
    data = read_csv_mapping(CAMPUS_PARTNER_MAPPING, PARTNER_MAPPING_COLUMNS)
    links = []
    for idx, row in data.iterrows():
        project = projects_by_id.get(row["project_id"])
        partner_type = row["partner_type"] if row["partner_type"] in ALLOWED_PARTNER_TYPES else "other/unknown"
        links.append({
            "id": f"campus-manual-partner:{row['project_id']}:{idx}",
            "project_id": row["project_id"],
            "project_name": row["project_name"] or (project or {}).get("project_name", ""),
            "source_type": row["source_type"] or (project or {}).get("source_type", ""),
            "partner_name": row["partner_name"],
            "partner_type": partner_type,
            "evidence_text": row["evidence_text"],
            "notes": row["notes"],
            "source": "campus_project_partner_mapping",
            "source_link_id": "",
        })
    return links


def build_campus_dashboard_data(applicants, flagship_data, partner_data):
    mapping = read_csv_mapping(CAMPUS_CLUSTER_MAPPING, CLUSTER_MAPPING_COLUMNS)
    dashboard_items = dashboard_lookup(flagship_data)

    projects = []
    for _, row in mapping.iterrows():
        source_type = row["source_type"]
        primary_cluster = row["primary_cluster"]
        if source_type not in ALLOWED_SOURCE_TYPES:
            continue
        if primary_cluster not in CAMPUS_CLUSTERS:
            continue

        dashboard_id = project_dashboard_id(row["project_id"], source_type)
        member_ids = project_member_ids(row["project_id"], source_type, dashboard_items)
        dashboard_item = dashboard_items.get(dashboard_id, {})
        projects.append({
            "id": project_node_id(row["project_id"]),
            "project_id": row["project_id"],
            "project_name": row["project_name"],
            "source_type": source_type,
            "primary_cluster": primary_cluster,
            "cluster_id": cluster_id(primary_cluster),
            "evidence_text": row["evidence_text"],
            "notes": row["notes"],
            "dashboard_id": dashboard_id,
            "member_ids": member_ids,
            "n_people": project_people_count(applicants, member_ids),
            "n_institutions": int(dashboard_item.get("n_institutions", 0) or 0),
            "institutions": dashboard_item.get("institutions", []),
        })

    projects_by_id = {project["project_id"]: project for project in projects}
    partner_links = manual_partner_links(projects_by_id)
    for project in projects:
        partner_links.extend(existing_partner_links_for_project(project, partner_data))

    partner_links_by_project = defaultdict(list)
    for link in partner_links:
        if clean_text(link.get("partner_name", "")):
            partner_links_by_project[link["project_id"]].append(link)

    for project in projects:
        unique_partners = sorted({link["partner_name"] for link in partner_links_by_project[project["project_id"]] if link["partner_name"]})
        project["n_partners"] = len(unique_partners)
        project["partner_names"] = unique_partners

    clusters = []
    for name in CAMPUS_CLUSTERS:
        cluster_projects = [project for project in projects if project["primary_cluster"] == name]
        clusters.append({
            "id": cluster_id(name),
            "name": name,
            "n_projects": len(cluster_projects),
            "n_flagships": sum(1 for project in cluster_projects if project["source_type"] == "Flagship"),
            "n_sustainable_health": sum(1 for project in cluster_projects if project["source_type"] == "Sustainable Health"),
        })

    project_cluster_edges = [
        {
            "id": f"campus-project-cluster:{project['project_id']}:{project['cluster_id']}",
            "source": project["id"],
            "target": project["cluster_id"],
            "edge_type": "project_to_cluster",
            "source_type": project["source_type"],
            "evidence_text": project["evidence_text"],
        }
        for project in projects
    ]

    cluster_overview = []
    for cluster in clusters:
        cluster_projects = [project for project in projects if project["cluster_id"] == cluster["id"]]
        cluster_overview.append({
            "cluster": cluster["name"],
            "cluster_id": cluster["id"],
            "flagships": [project["project_name"] for project in cluster_projects if project["source_type"] == "Flagship"],
            "sustainable_health_programmes": [
                project["project_name"]
                for project in cluster_projects
                if project["source_type"] == "Sustainable Health"
            ],
            "n_items": len(cluster_projects),
        })

    return {
        "clusters": clusters,
        "projects": projects,
        "project_cluster_edges": project_cluster_edges,
        "cluster_overview": cluster_overview,
        "project_partner_links": partner_links,
        "partners_by_project": {
            project_id: {
                "project_id": project_id,
                "n_partners": len({link["partner_name"] for link in links if link["partner_name"]}),
                "links": links,
            }
            for project_id, links in partner_links_by_project.items()
        },
        "filters": {
            "source_types": sorted(ALLOWED_SOURCE_TYPES),
            "clusters": CAMPUS_CLUSTERS,
        },
        "quality": {
            "mapping_rows": int(len(mapping)),
            "valid_projects": int(len(projects)),
            "partner_links": int(len(partner_links)),
            "manual_partner_links": int(sum(1 for link in partner_links if link["source"] == "campus_project_partner_mapping")),
            "existing_partner_links": int(sum(1 for link in partner_links if link["source"] == "existing_flagship_partner_data")),
        },
    }
