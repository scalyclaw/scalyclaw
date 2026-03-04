import sys
import json
import re


def extract_text_from_pdf(file_path):
    """Extract text from a PDF file using PyMuPDF."""
    import fitz

    sys.stderr.write(f"Opening PDF: {file_path}\n")
    doc = fitz.open(file_path)
    pages = []
    for page in doc:
        pages.append(page.get_text())
    doc.close()
    return "\n".join(pages)


def extract_contact(text):
    """Extract contact information from resume text."""
    contact = {
        "name": None,
        "email": None,
        "phone": None,
        "linkedin": None,
        "location": None,
    }

    # Email
    email_match = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
    if email_match:
        contact["email"] = email_match.group(0)

    # Phone
    phone_match = re.search(
        r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}", text
    )
    if phone_match:
        contact["phone"] = phone_match.group(0).strip()

    # LinkedIn
    linkedin_match = re.search(
        r"(?:https?://)?(?:www\.)?linkedin\.com/in/[\w-]+/?", text, re.IGNORECASE
    )
    if linkedin_match:
        contact["linkedin"] = linkedin_match.group(0)

    # Name — typically the first non-empty line
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if lines:
        first_line = lines[0]
        # Heuristic: name is short, no special chars like @ or http
        if len(first_line) < 60 and "@" not in first_line and "http" not in first_line.lower():
            contact["name"] = first_line

    return contact


SECTION_PATTERNS = {
    "summary": r"(?:summary|objective|profile|about\s*me)",
    "experience": r"(?:experience|work\s*history|employment|professional\s*experience)",
    "education": r"(?:education|academic|qualifications)",
    "skills": r"(?:skills|technical\s*skills|core\s*competencies|technologies)",
    "certifications": r"(?:certifications?|licenses?|credentials?)",
    "projects": r"(?:projects|personal\s*projects|portfolio)",
}


def split_sections(text):
    """Split resume text into sections based on common headings."""
    sections = {}
    lines = text.split("\n")
    current_section = None
    current_lines = []

    for line in lines:
        stripped = line.strip()
        matched = False
        for section_name, pattern in SECTION_PATTERNS.items():
            if re.match(rf"^{pattern}\s*:?\s*$", stripped, re.IGNORECASE):
                # Save previous section
                if current_section:
                    sections[current_section] = "\n".join(current_lines).strip()
                current_section = section_name
                current_lines = []
                matched = True
                break
        if not matched:
            current_lines.append(line)

    # Save last section
    if current_section:
        sections[current_section] = "\n".join(current_lines).strip()

    return sections


def parse_experience(text):
    """Parse experience section into structured entries."""
    entries = []
    # Split on date-like patterns that typically start experience blocks
    blocks = re.split(r"\n(?=\S.*(?:\d{4}|present|current))", text, flags=re.IGNORECASE)

    for block in blocks:
        block = block.strip()
        if not block:
            continue

        entry = {"title": None, "company": None, "dates": None, "description": ""}
        lines = block.split("\n")

        if lines:
            # First line often contains title and/or company
            first = lines[0].strip()
            # Look for date range
            date_match = re.search(
                r"(\w+\.?\s*\d{4}\s*[-–]\s*(?:\w+\.?\s*\d{4}|present|current))",
                first,
                re.IGNORECASE,
            )
            if date_match:
                entry["dates"] = date_match.group(1).strip()
                first = first[: date_match.start()].strip().rstrip("|-–,")

            # Try to split title and company
            for sep in [" at ", " - ", " | ", ", "]:
                if sep in first:
                    parts = first.split(sep, 1)
                    entry["title"] = parts[0].strip()
                    entry["company"] = parts[1].strip()
                    break
            else:
                entry["title"] = first

            entry["description"] = "\n".join(lines[1:]).strip()

        if entry["title"]:
            entries.append(entry)

    return entries


def parse_education(text):
    """Parse education section into structured entries."""
    entries = []
    blocks = re.split(r"\n(?=\S)", text)

    for block in blocks:
        block = block.strip()
        if not block:
            continue

        entry = {"degree": None, "institution": None, "dates": None}
        lines = block.split("\n")

        if lines:
            first = lines[0].strip()
            date_match = re.search(
                r"(\d{4}\s*[-–]\s*(?:\d{4}|present|current)|\d{4})",
                first,
                re.IGNORECASE,
            )
            if date_match:
                entry["dates"] = date_match.group(1).strip()
                first = first[: date_match.start()].strip().rstrip("|-–,")

            for sep in [" at ", " - ", " | ", ", "]:
                if sep in first:
                    parts = first.split(sep, 1)
                    entry["degree"] = parts[0].strip()
                    entry["institution"] = parts[1].strip()
                    break
            else:
                entry["degree"] = first

        if entry["degree"]:
            entries.append(entry)

    return entries


def parse_skills(text):
    """Parse skills section into a list."""
    skills = []
    for line in text.split("\n"):
        line = line.strip().lstrip("•·-*► ")
        if not line:
            continue
        # Skills might be comma or pipe separated
        for sep in [",", "|", ";"]:
            if sep in line:
                skills.extend(s.strip() for s in line.split(sep) if s.strip())
                break
        else:
            skills.append(line)
    return skills


def main():
    try:
        data = json.loads(sys.stdin.read())
        file_path = data.get("file_path")
        text = data.get("text")

        if not file_path and not text:
            print(json.dumps({"error": "Either file_path or text is required"}))
            return

        if file_path:
            raw_text = extract_text_from_pdf(file_path)
        else:
            raw_text = text

        contact = extract_contact(raw_text)
        sections = split_sections(raw_text)

        result = {
            "contact": contact,
            "summary": sections.get("summary", ""),
            "skills": parse_skills(sections["skills"]) if "skills" in sections else [],
            "experience": parse_experience(sections["experience"]) if "experience" in sections else [],
            "education": parse_education(sections["education"]) if "education" in sections else [],
            "certifications": parse_skills(sections["certifications"]) if "certifications" in sections else [],
            "raw_text": raw_text,
        }

        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
