import sys
import json


def main():
    try:
        data = json.loads(sys.stdin.read())
        query = data.get("query")
        if not query:
            print(json.dumps({"error": "Missing required field: query"}))
            return

        language = data.get("language", "en")
        summary_only = data.get("summary_only", True)

        import wikipediaapi

        wiki = wikipediaapi.Wikipedia(
            user_agent="ScalyClaw/0.1.0 (skill; python)",
            language=language,
        )

        sys.stderr.write(f"Searching Wikipedia for: {query}\n")
        page = wiki.page(query)

        if not page.exists():
            # Try searching for the page
            sys.stderr.write(f"Page not found directly, trying search...\n")
            # wikipediaapi doesn't have search, so try common title formats
            # Try title case
            page = wiki.page(query.title())
            if not page.exists():
                # Try with first letter capitalized
                page = wiki.page(query.capitalize())
                if not page.exists():
                    print(json.dumps({
                        "error": f"No Wikipedia article found for: {query}",
                        "suggestion": "Try a more specific or exact article title",
                    }))
                    return

        categories = [cat.replace("Category:", "") for cat in page.categories.keys()]

        result = {
            "title": page.title,
            "summary": page.summary,
            "url": page.fullurl,
            "categories": categories[:20],  # Limit to 20 categories
        }

        if not summary_only:
            result["text"] = page.text

        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
