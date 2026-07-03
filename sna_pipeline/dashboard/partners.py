from collections import Counter, defaultdict

from ..text_utils import clean_text, split_semicolon_values


def sorted_counts(values):
    counts = Counter(value for value in values if clean_text(value))
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0].lower())))


def build_partner_dashboard_data(partners, applicants, flagship_metrics):
    if partners is None or partners.empty:
        return {
            "partners": [],
            "partner_flagship_links": [],
            "partners_by_flagship": {},
            "partner_filters": {"categories": [], "collaboration_types": []},
            "partner_quality": {
                "source_rows": 0,
                "unique_partners": 0,
                "matched_flagship_ids": [],
                "unmatched_flagship_ids": [],
                "missing_start_year": 0,
                "missing_end_year": 0,
                "category_normalizations": 0,
                "multi_type_collaborations": 0,
            },
        }

    partners = partners.fillna("").copy()
    for column in partners.columns:
        partners[column] = partners[column].apply(clean_text)

    applicant_flagship_ids = set(applicants["flagship_id"].dropna().map(clean_text))
    if "proposal_id" in applicants:
        applicant_flagship_ids.update(applicants["proposal_id"].dropna().map(clean_text))
    if "proposal_key" in applicants:
        applicant_flagship_ids.update(applicants["proposal_key"].dropna().map(clean_text))

    flagship_title_map = flagship_metrics.set_index("flagship_id")["flagship_title"].to_dict()
    if "proposal_key" in flagship_metrics:
        flagship_title_map.update(flagship_metrics.set_index("proposal_key")["flagship_title"].to_dict())

    links = []
    categories = set()
    collaboration_filter_values = set()
    by_flagship_records = defaultdict(list)

    for idx, row in partners.iterrows():
        link_id = f"partner-link:{row['flagship_id']}:{row['partner_id']}:{idx}"
        collaboration_types = split_semicolon_values(row.get("collaboration_types", ""))
        categories.add(row["partner_category"])
        collaboration_filter_values.update(collaboration_types)
        link = {
            "id": link_id,
            "partner_id": row["partner_id"],
            "partner_name": row["partner_name"],
            "flagship_id": row["flagship_id"],
            "flagship_title": flagship_title_map.get(row["flagship_id"], row.get("flagship_title_raw", "")),
            "flagship_title_raw": row.get("flagship_title_raw", ""),
            "partner_category": row["partner_category"],
            "partner_category_raw": row.get("partner_category_raw", ""),
            "collaboration_types": collaboration_types,
            "collaboration_type_raw": row.get("collaboration_type_raw", ""),
            "start_year": row.get("start_year", ""),
            "end_year": row.get("end_year", ""),
            "reporting_period": row.get("reporting_period", ""),
            "role_relevance": row.get("role_relevance", ""),
        }
        links.append(link)
        by_flagship_records[row["flagship_id"]].append(link)

    partner_nodes = []
    for partner_id, group in partners.groupby("partner_id"):
        group_links = [link for link in links if link["partner_id"] == partner_id]
        type_values = sorted({
            collaboration_type
            for link in group_links
            for collaboration_type in link["collaboration_types"]
        })
        partner_nodes.append({
            "id": partner_id,
            "name": group["partner_name"].iloc[0],
            "categories": sorted(set(group["partner_category"])),
            "collaboration_types": type_values,
            "flagship_ids": sorted(set(group["flagship_id"])),
            "n_flagships": int(group["flagship_id"].nunique()),
            "n_links": int(len(group)),
            "link_ids": [link["id"] for link in group_links],
            "search_text": " ".join(
                clean_text(part).lower()
                for part in [
                    group["partner_name"].iloc[0],
                    " ".join(sorted(set(group["partner_category"]))),
                    " ".join(type_values),
                    " ".join(sorted(set(group.get("role_relevance", [])))),
                ]
                if clean_text(part)
            ),
        })

    partners_by_flagship = {}
    for flagship_id, records in by_flagship_records.items():
        partners_by_flagship[flagship_id] = {
            "flagship_id": flagship_id,
            "n_partners": int(len(set(record["partner_id"] for record in records))),
            "n_links": int(len(records)),
            "category_counts": sorted_counts(record["partner_category"] for record in records),
            "collaboration_type_counts": sorted_counts(
                collaboration_type
                for record in records
                for collaboration_type in record["collaboration_types"]
            ),
            "link_ids": [record["id"] for record in records],
        }

    partner_flagship_ids = set(partners["flagship_id"].dropna().map(clean_text))
    matched_flagship_ids = sorted(partner_flagship_ids & applicant_flagship_ids)
    unmatched_flagship_ids = sorted(partner_flagship_ids - applicant_flagship_ids)

    return {
        "partners": sorted(partner_nodes, key=lambda item: item["name"].lower()),
        "partner_flagship_links": links,
        "partners_by_flagship": partners_by_flagship,
        "partner_filters": {
            "categories": sorted(category for category in categories if category),
            "collaboration_types": sorted(collaboration_filter_values),
        },
        "partner_quality": {
            "source_rows": int(len(partners)),
            "unique_partners": int(partners["partner_id"].nunique()),
            "matched_flagship_ids": matched_flagship_ids,
            "unmatched_flagship_ids": unmatched_flagship_ids,
            "missing_start_year": int((partners["start_year"] == "").sum()) if "start_year" in partners else 0,
            "missing_end_year": int((partners["end_year"] == "").sum()) if "end_year" in partners else 0,
            "category_normalizations": int((partners["partner_category"] != partners["partner_category_raw"]).sum()) if "partner_category_raw" in partners else 0,
            "multi_type_collaborations": int(partners["collaboration_types"].apply(lambda value: len(split_semicolon_values(value)) > 1).sum()) if "collaboration_types" in partners else 0,
        },
    }
