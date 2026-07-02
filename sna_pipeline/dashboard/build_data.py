from ..config import INSTITUTION_COLORS
from .convergence import build_convergence_overview
from .flagships import build_flagship_records
from .partners import build_partner_dashboard_data
from .persons import build_person_records_and_edges
from .quality import build_quality_summary


def build_dashboard_data(G, applicants, person_metrics, flagship_metrics, partners=None):
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

    return {
        "persons": persons,
        "edges": edges,
        "flagships": flagship_data["flagships"],
        "flagship_links": flagship_data["flagship_links"],
        "selected_flagship_groups": flagship_data["selected_flagship_groups"],
        "selected_flagship_links": flagship_data["selected_flagship_links"],
        "convergence_overview": convergence_overview,
        "quality": quality,
        "institution_colors": INSTITUTION_COLORS,
        "department_groups": department_groups,
        **partner_data,
    }
