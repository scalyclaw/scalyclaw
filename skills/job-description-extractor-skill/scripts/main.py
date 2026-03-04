import sys
import json
import re


def empty_result(url=None):
    return {
        "title": None,
        "company": None,
        "location": None,
        "salary": None,
        "employment_type": None,
        "description": None,
        "requirements": [],
        "qualifications": [],
        "benefits": [],
        "posted_date": None,
        "url": url,
    }


def extract_from_jsonld(html, url):
    """Extract job posting data from JSON-LD structured data."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    scripts = soup.find_all("script", {"type": "application/ld+json"})

    for script in scripts:
        try:
            data = json.loads(script.string)
            # Handle both single objects and arrays
            items = data if isinstance(data, list) else [data]
            # Also check @graph
            for item in items:
                if isinstance(item, dict) and item.get("@graph"):
                    items.extend(item["@graph"])

            for item in items:
                if not isinstance(item, dict):
                    continue
                if item.get("@type") != "JobPosting":
                    continue

                result = empty_result(url)
                result["title"] = item.get("title")
                result["description"] = item.get("description", "")
                result["posted_date"] = item.get("datePosted")

                # Company
                org = item.get("hiringOrganization")
                if isinstance(org, dict):
                    result["company"] = org.get("name")
                elif isinstance(org, str):
                    result["company"] = org

                # Location
                loc = item.get("jobLocation")
                if isinstance(loc, dict):
                    addr = loc.get("address")
                    if isinstance(addr, dict):
                        parts = [
                            addr.get("addressLocality", ""),
                            addr.get("addressRegion", ""),
                            addr.get("addressCountry", ""),
                        ]
                        result["location"] = ", ".join(p for p in parts if p)
                elif isinstance(loc, list) and loc:
                    first = loc[0]
                    if isinstance(first, dict):
                        addr = first.get("address", {})
                        if isinstance(addr, dict):
                            parts = [
                                addr.get("addressLocality", ""),
                                addr.get("addressRegion", ""),
                            ]
                            result["location"] = ", ".join(p for p in parts if p)

                # Salary
                salary = item.get("baseSalary")
                if isinstance(salary, dict):
                    value = salary.get("value")
                    currency = salary.get("currency", "")
                    if isinstance(value, dict):
                        min_val = value.get("minValue", "")
                        max_val = value.get("maxValue", "")
                        if min_val and max_val:
                            result["salary"] = f"{currency} {min_val} - {max_val}"
                        elif min_val:
                            result["salary"] = f"{currency} {min_val}+"
                    elif value:
                        result["salary"] = f"{currency} {value}"

                # Employment type
                emp_type = item.get("employmentType")
                if isinstance(emp_type, list):
                    result["employment_type"] = ", ".join(emp_type)
                elif emp_type:
                    result["employment_type"] = emp_type

                return result
        except (json.JSONDecodeError, TypeError):
            continue

    return None


def extract_from_html(html, url):
    """Extract job posting data from HTML using common selectors."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    result = empty_result(url)

    # Title
    for selector in [
        "h1.job-title",
        "h1.jobTitle",
        '[data-testid="job-title"]',
        "h1.top-card-layout__title",
        "h1",
    ]:
        el = soup.select_one(selector)
        if el and el.get_text(strip=True):
            result["title"] = el.get_text(strip=True)
            break

    # Company
    for selector in [
        ".company-name",
        ".companyName",
        '[data-testid="company-name"]',
        ".top-card-layout__company-name",
        ".employer-name",
    ]:
        el = soup.select_one(selector)
        if el and el.get_text(strip=True):
            result["company"] = el.get_text(strip=True)
            break

    # Location
    for selector in [
        ".job-location",
        ".jobLocation",
        '[data-testid="job-location"]',
        ".top-card-layout__bullet",
        ".location",
    ]:
        el = soup.select_one(selector)
        if el and el.get_text(strip=True):
            result["location"] = el.get_text(strip=True)
            break

    # Description
    for selector in [
        ".job-description",
        ".jobDescription",
        "#job-description",
        '[data-testid="job-description"]',
        ".description__text",
    ]:
        el = soup.select_one(selector)
        if el:
            result["description"] = el.get_text(separator="\n", strip=True)
            break

    return result if result["title"] else None


def extract_from_text(text, url=None):
    """Extract job posting data from plain text using regex patterns."""
    result = empty_result(url)

    lines = text.split("\n")

    # Title — first substantial line
    for line in lines:
        line = line.strip()
        if len(line) > 5 and len(line) < 120:
            result["title"] = line
            break

    # Extract sections
    section_map = {
        "requirements": r"(?:requirements?|what\s+(?:you|we)\s+(?:need|require|look\s+for))",
        "qualifications": r"(?:qualifications?|who\s+you\s+are|ideal\s+candidate)",
        "benefits": r"(?:benefits?|perks|what\s+we\s+offer|compensation)",
    }

    for section_name, pattern in section_map.items():
        match = re.search(
            rf"^.*{pattern}.*$\n((?:.*\n)*?)(?=^\s*$|\Z)",
            text,
            re.MULTILINE | re.IGNORECASE,
        )
        if match:
            block = match.group(1)
            items = []
            for line in block.split("\n"):
                line = line.strip().lstrip("•·-*► ")
                if line and len(line) > 3:
                    items.append(line)
            result[section_name] = items

    # Salary
    salary_match = re.search(
        r"\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?(?:\s*/\s*(?:year|yr|hour|hr))?",
        text,
        re.IGNORECASE,
    )
    if salary_match:
        result["salary"] = salary_match.group(0)

    # Employment type
    emp_match = re.search(
        r"\b(full[- ]time|part[- ]time|contract|freelance|internship|temporary|remote)\b",
        text,
        re.IGNORECASE,
    )
    if emp_match:
        result["employment_type"] = emp_match.group(1)

    # Use full text as description
    result["description"] = text[:5000]

    return result


def main():
    try:
        data = json.loads(sys.stdin.read())
        url = data.get("url")
        text = data.get("text")

        if not url and not text:
            print(json.dumps({"error": "Either url or text is required"}))
            return

        if url:
            import httpx
            import trafilatura

            sys.stderr.write(f"Fetching URL: {url}\n")
            response = httpx.get(url, follow_redirects=True, timeout=20)
            response.raise_for_status()
            html = response.text

            # Strategy 1: JSON-LD
            result = extract_from_jsonld(html, url)
            if result and result.get("title"):
                sys.stderr.write("Extracted via JSON-LD\n")
                print(json.dumps(result))
                return

            # Strategy 2: HTML selectors
            result = extract_from_html(html, url)
            if result and result.get("title"):
                sys.stderr.write("Extracted via HTML selectors\n")
                print(json.dumps(result))
                return

            # Strategy 3: Trafilatura plain text + regex
            sys.stderr.write("Falling back to text extraction\n")
            extracted = trafilatura.extract(html, include_comments=False, include_tables=True)
            plain_text = extracted if extracted else ""
            result = extract_from_text(plain_text, url)
            print(json.dumps(result))

        else:
            result = extract_from_text(text)
            print(json.dumps(result))

    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
