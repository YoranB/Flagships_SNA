import argparse
import json
import time
from datetime import date
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import pandas as pd

from .config import ENRICHED_FOLDER, OUT_PERSON_EXPERTISE
from .data.load import load_data
from .enrichment.expertise import ONLINE_COLUMNS, normalize_keywords
from .text_utils import clean_text, simplify_institution, split_semicolon_values


CONFIDENCE_ORDER = {"needs_review": 0, "low": 1, "medium": 2, "high": 3}


def normalize_name(value):
    return "".join(ch.lower() if ch.isalnum() or ch.isspace() else " " for ch in clean_text(value)).split()


def name_matches(person_name, candidate_name):
    person_tokens = normalize_name(person_name)
    candidate_tokens = normalize_name(candidate_name)
    if not person_tokens or not candidate_tokens:
        return False
    if person_tokens[-1] != candidate_tokens[-1]:
        return False
    person_first = person_tokens[0]
    candidate_first = candidate_tokens[0]
    return person_first == candidate_first or person_first[:1] == candidate_first[:1]


def keyword_tokens(value):
    return {token.lower() for token in normalize_name(value) if len(token) > 3}


def fetch_json(url, timeout):
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "Flagships-SNA-expertise-enrichment/1.0 (mailto:no-reply@example.org)",
        },
    )
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def evidence_for_candidate(person, candidate_text, candidate_affiliations=None):
    evidence = []
    text = clean_text(candidate_text).lower()
    institution = clean_text(person["institution"])
    department = clean_text(person["department"])
    email = clean_text(person["email"]).lower()
    affiliations = [clean_text(value) for value in (candidate_affiliations or []) if clean_text(value)]

    if institution and any(
        simplify_institution(affiliation) == simplify_institution(institution)
        for affiliation in affiliations
    ):
        evidence.append("institution")
    if email and "@" in email:
        domain = email.split("@", 1)[1]
        if domain and domain in text:
            evidence.append("email_domain")
    if department and keyword_tokens(department) & keyword_tokens(candidate_text):
        evidence.append("department")
    return sorted(set(evidence))


def confidence_from_evidence(evidence, has_keywords):
    if len(evidence) >= 2 and has_keywords:
        return "high"
    if len(evidence) >= 1 and has_keywords:
        return "medium"
    if len(evidence) >= 1:
        return "low"
    return "needs_review"


def result_score(result):
    return (
        CONFIDENCE_ORDER.get(result["confidence"], 0),
        len(split_semicolon_values(result["expertise_keywords"])),
        len(result["match_notes"]),
    )


def openalex_candidates(person, timeout):
    url = "https://api.openalex.org/authors?" + urlencode({"search": person["person_name"], "per-page": 5})
    data = fetch_json(url, timeout)
    results = []
    for item in data.get("results", []):
        candidate_name = clean_text(item.get("display_name", ""))
        if not name_matches(person["person_name"], candidate_name):
            continue

        institutions = []
        for key in ["last_known_institution", "last_known_institutions"]:
            value = item.get(key)
            if isinstance(value, dict):
                institutions.append(clean_text(value.get("display_name", "")))
            elif isinstance(value, list):
                institutions.extend(clean_text(inst.get("display_name", "")) for inst in value if isinstance(inst, dict))
        for affiliation in item.get("affiliations", []) or []:
            institutions.append(clean_text(affiliation.get("institution", {}).get("display_name", "")))

        keywords = []
        for concept in (item.get("topics") or item.get("x_concepts") or [])[:8]:
            if isinstance(concept, dict):
                keywords.append(clean_text(concept.get("display_name", "")))

        candidate_text = " ".join([candidate_name, *institutions, *keywords])
        evidence = evidence_for_candidate(person, candidate_text, institutions)
        confidence = confidence_from_evidence(evidence, bool(keywords))
        if confidence == "needs_review":
            continue

        works_count = item.get("works_count", 0)
        results.append({
            "profile_url": clean_text(item.get("id", "")),
            "expertise_keywords": normalize_keywords("; ".join(keywords)),
            "expertise_summary": f"OpenAlex author profile for {candidate_name}; {works_count} works. " + (f"Topics: {', '.join(keywords[:5])}." if keywords else ""),
            "source_type": "openalex",
            "confidence": confidence,
            "match_notes": "Matched by name plus " + ", ".join(evidence),
        })
    return results


def semantic_scholar_candidates(person, timeout):
    fields = "name,affiliations,paperCount,homepage,papers.title,papers.fieldsOfStudy"
    url = "https://api.semanticscholar.org/graph/v1/author/search?" + urlencode({
        "query": person["person_name"],
        "limit": 5,
        "fields": fields,
    })
    data = fetch_json(url, timeout)
    results = []
    for item in data.get("data", []):
        candidate_name = clean_text(item.get("name", ""))
        if not name_matches(person["person_name"], candidate_name):
            continue

        affiliations = [clean_text(value) for value in item.get("affiliations", []) or []]
        fields_of_study = []
        titles = []
        for paper in item.get("papers", []) or []:
            titles.append(clean_text(paper.get("title", "")))
            fields_of_study.extend(clean_text(value) for value in paper.get("fieldsOfStudy", []) or [])
        keywords = sorted(set(value for value in fields_of_study if value))[:8]
        candidate_text = " ".join([candidate_name, *affiliations, *titles, *keywords])
        evidence = evidence_for_candidate(person, candidate_text, affiliations)
        confidence = confidence_from_evidence(evidence, bool(keywords or titles))
        if confidence == "needs_review":
            continue

        summary_tail = f" Recent indexed work includes: {titles[0]}." if titles else ""
        results.append({
            "profile_url": clean_text(item.get("homepage", "")),
            "expertise_keywords": normalize_keywords("; ".join(keywords)),
            "expertise_summary": f"Semantic Scholar author profile for {candidate_name}; {item.get('paperCount', 0)} papers.{summary_tail}",
            "source_type": "semantic_scholar",
            "confidence": confidence,
            "match_notes": "Matched by name plus " + ", ".join(evidence),
        })
    return results


def orcid_candidates(person, timeout):
    query = f'"{person["person_name"]}"'
    url = "https://pub.orcid.org/v3.0/expanded-search/?" + urlencode({"q": query, "rows": 5})
    data = fetch_json(url, timeout)
    results = []
    for item in data.get("expanded-result", []) or []:
        given = clean_text(item.get("given-names", ""))
        family = clean_text(item.get("family-names", ""))
        candidate_name = clean_text(f"{given} {family}")
        if not name_matches(person["person_name"], candidate_name):
            continue

        affiliations = []
        for key in ["institution-name", "affiliation-org-name"]:
            value = item.get(key)
            if isinstance(value, list):
                affiliations.extend(clean_text(part) for part in value)
            else:
                affiliations.append(clean_text(value))
        keywords = []
        value = item.get("keywords")
        if isinstance(value, list):
            keywords.extend(clean_text(part) for part in value)
        elif value:
            keywords.extend(split_semicolon_values(value))

        candidate_text = " ".join([candidate_name, *affiliations, *keywords])
        evidence = evidence_for_candidate(person, candidate_text, affiliations)
        confidence = confidence_from_evidence(evidence, bool(keywords or affiliations))
        if confidence == "needs_review":
            continue
        orcid_id = clean_text(item.get("orcid-id", ""))
        results.append({
            "profile_url": f"https://orcid.org/{orcid_id}" if orcid_id else "",
            "expertise_keywords": normalize_keywords("; ".join(keywords)),
            "expertise_summary": f"ORCID profile for {candidate_name}." + (f" Affiliations: {', '.join(affiliations[:3])}." if affiliations else ""),
            "source_type": "orcid",
            "confidence": confidence,
            "match_notes": "Matched by name plus " + ", ".join(evidence),
        })
    return results


def empty_result(person, today, note):
    return {
        "person_id": person["person_id"],
        "person_name": person["person_name"],
        "institution": person["institution"],
        "department": person["department"],
        "profile_url": "",
        "expertise_keywords": "",
        "expertise_summary": "",
        "source_type": "",
        "confidence": "needs_review",
        "last_checked": today,
        "match_notes": note,
        "manual_override": "",
    }


def build_people(applicants):
    people = []
    grouped = applicants.groupby("person_id", dropna=False)
    for person_id, group in grouped:
        first = group.iloc[0]
        people.append({
            "person_id": person_id,
            "person_name": clean_text(first.get("person_name_clean", "")) or clean_text(first.get("person_name", "")) or person_id,
            "institution": clean_text(first.get("institution_simplified", "")) or clean_text(first.get("institution_clean", "")) or clean_text(first.get("institution", "")),
            "department": clean_text(first.get("department_group", "")) or clean_text(first.get("department_clean", "")) or clean_text(first.get("department", "")),
            "email": clean_text(first.get("email", "")),
        })
    return sorted(people, key=lambda item: item["person_name"].lower())


def load_manual_override_ids():
    if not OUT_PERSON_EXPERTISE.exists():
        return set()
    existing = pd.read_csv(OUT_PERSON_EXPERTISE, dtype=str).fillna("")
    if "manual_override" not in existing.columns:
        return set()
    mask = existing["manual_override"].str.lower().isin(["1", "true", "yes", "ja", "y"])
    return set(existing.loc[mask, "person_id"])


def enrich_person(person, timeout):
    candidates = []
    errors = []
    for provider in [openalex_candidates, semantic_scholar_candidates, orcid_candidates]:
        try:
            candidates.extend(provider(person, timeout))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            errors.append(f"{provider.__name__}: {exc.__class__.__name__}")
    if not candidates:
        note = "No reliable online match found"
        if errors:
            note += "; provider errors: " + "; ".join(errors[:3])
        return None, note
    return sorted(candidates, key=result_score, reverse=True)[0], ""


def run(limit=None, timeout=8, sleep_seconds=0.2):
    applicants, _, _ = load_data()
    people = build_people(applicants)
    limited_run = limit is not None
    if limited_run:
        people = people[:max(0, limit)]

    ENRICHED_FOLDER.mkdir(exist_ok=True)
    today = date.today().isoformat()
    existing = pd.DataFrame(columns=ONLINE_COLUMNS)
    if OUT_PERSON_EXPERTISE.exists():
        existing = pd.read_csv(OUT_PERSON_EXPERTISE, dtype=str).fillna("")
        existing = existing.reindex(columns=ONLINE_COLUMNS, fill_value="")
    manual_override_ids = load_manual_override_ids()
    preserved = {}
    if manual_override_ids:
        preserved = {
            row["person_id"]: row.to_dict()
            for _, row in existing.iterrows()
            if row.get("person_id", "") in manual_override_ids
        }

    rows = []
    for index, person in enumerate(people, start=1):
        if person["person_id"] in preserved:
            row = {column: clean_text(preserved[person["person_id"]].get(column, "")) for column in ONLINE_COLUMNS}
            rows.append(row)
            continue

        best, note = enrich_person(person, timeout)
        if best:
            rows.append({
                "person_id": person["person_id"],
                "person_name": person["person_name"],
                "institution": person["institution"],
                "department": person["department"],
                "profile_url": best["profile_url"],
                "expertise_keywords": best["expertise_keywords"],
                "expertise_summary": best["expertise_summary"],
                "source_type": best["source_type"],
                "confidence": best["confidence"],
                "last_checked": today,
                "match_notes": best["match_notes"],
                "manual_override": "",
            })
        else:
            rows.append(empty_result(person, today, note))

        if sleep_seconds and index < len(people):
            time.sleep(sleep_seconds)

    if limited_run and not existing.empty:
        processed_ids = {person["person_id"] for person in people}
        rows.extend(
            {column: clean_text(row.get(column, "")) for column in ONLINE_COLUMNS}
            for _, row in existing.iterrows()
            if clean_text(row.get("person_id", "")) not in processed_ids
        )

    output = pd.DataFrame(rows, columns=ONLINE_COLUMNS)
    output.to_csv(OUT_PERSON_EXPERTISE, index=False, encoding="utf-8-sig")
    return OUT_PERSON_EXPERTISE, len(output)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Enrich SNA persons with public no-key expertise metadata.")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N unique people.")
    parser.add_argument("--timeout", type=int, default=8, help="HTTP timeout per provider request in seconds.")
    parser.add_argument("--sleep", type=float, default=0.2, help="Pause between people to avoid hammering public APIs.")
    args = parser.parse_args(argv)
    path, count = run(limit=args.limit, timeout=args.timeout, sleep_seconds=args.sleep)
    print(f"Wrote {count} expertise rows to {path}")


if __name__ == "__main__":
    main()
