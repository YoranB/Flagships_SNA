from pathlib import Path
import json

from ..config import OUT_HTML
from .build_data import build_dashboard_data


PACKAGE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PACKAGE_DIR.parent.parent
TEMPLATE_PATH = PACKAGE_DIR / "templates" / "dashboard.html"
DASHBOARD_CSS_PATH = PACKAGE_DIR / "static" / "dashboard.css"
DASHBOARD_JS_PATH = PACKAGE_DIR / "static" / "dashboard.js"
VIS_CSS_PATH = PROJECT_ROOT / "lib" / "vis-9.1.2" / "vis-network.css"
VIS_JS_PATH = PROJECT_ROOT / "lib" / "vis-9.1.2" / "vis-network.min.js"
TOM_SELECT_CSS_PATH = PROJECT_ROOT / "lib" / "tom-select" / "tom-select.css"
TOM_SELECT_JS_PATH = PROJECT_ROOT / "lib" / "tom-select" / "tom-select.complete.min.js"


def read_text(path):
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        raise ValueError(f"Required dashboard asset is empty: {path}")
    return text


def create_interactive_network(G, applicants, person_metrics, flagship_metrics, partners=None):
    data = build_dashboard_data(G, applicants, person_metrics, flagship_metrics, partners)
    data_json = json.dumps(data, ensure_ascii=False).replace("</", "<\/")

    html = read_text(TEMPLATE_PATH)
    html = (
        html
        .replace("__VIS_CSS__", read_text(VIS_CSS_PATH))
        .replace("__TOM_SELECT_CSS__", read_text(TOM_SELECT_CSS_PATH))
        .replace("__DASHBOARD_CSS__", read_text(DASHBOARD_CSS_PATH))
        .replace("__VIS_JS__", read_text(VIS_JS_PATH).replace("</script", "<\/script"))
        .replace("__TOM_SELECT_JS__", read_text(TOM_SELECT_JS_PATH).replace("</script", "<\/script"))
        .replace("__DASHBOARD_JS__", read_text(DASHBOARD_JS_PATH).replace("</script", "<\/script"))
        .replace("__SNA_DATA__", data_json)
    )

    OUT_HTML.write_text(html, encoding="utf-8")
