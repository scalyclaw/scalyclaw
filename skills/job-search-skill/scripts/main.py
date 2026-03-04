import sys
import json
import re


def build_query(query, location=None, job_type=None):
    """Build an optimized job search query."""
    parts = [query]

    # Add job-related keywords if not already present
    job_keywords = ["job", "jobs", "hiring", "career", "position", "opening"]
    if not any(kw in query.lower() for kw in job_keywords):
        parts.append("jobs")

    if location:
        parts.append(location)

    if job_type:
        parts.append(job_type)

    return " ".join(parts)


def extract_company(title):
    """Try to extract company name from common title patterns."""
    # Patterns like "Software Engineer at Google" or "Software Engineer - Google"
    for pattern in [
        r"(?:at|@)\s+(.+?)(?:\s*[-–|]|$)",
        r"[-–|]\s*(.+?)(?:\s*[-–|]|$)",
    ]:
        match = re.search(pattern, title, re.IGNORECASE)
        if match:
            company = match.group(1).strip()
            # Filter out common non-company suffixes
            for suffix in ["Indeed", "LinkedIn", "Glassdoor", "ZipRecruiter"]:
                if company.lower() == suffix.lower():
                    return None
            return company
    return None


def main():
    try:
        data = json.loads(sys.stdin.read())
        query = data.get("query")
        if not query:
            print(json.dumps({"error": "Missing required field: query"}))
            return

        location = data.get("location")
        job_type = data.get("job_type")
        max_results = data.get("max_results", 10)

        search_query = build_query(query, location, job_type)
        sys.stderr.write(f"Searching jobs: {search_query}\n")

        from duckduckgo_search import DDGS

        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(search_query, max_results=max_results):
                title = r.get("title", "")
                url = r.get("href", "")
                snippet = r.get("body", "")

                company = extract_company(title)

                # Try to determine source from URL
                source = None
                domain = url.split("/")[2] if len(url.split("/")) > 2 else ""
                for site in ["indeed", "linkedin", "glassdoor", "ziprecruiter", "monster", "dice"]:
                    if site in domain.lower():
                        source = site.capitalize()
                        break

                results.append({
                    "title": title,
                    "company": company,
                    "location": location or None,
                    "url": url,
                    "snippet": snippet,
                    "source": source,
                })

        print(json.dumps({"results": results}))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
