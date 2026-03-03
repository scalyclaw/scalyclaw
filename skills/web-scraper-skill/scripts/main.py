import sys
import json


def main():
    try:
        data = json.loads(sys.stdin.read())
        url = data.get("url")
        if not url:
            print(json.dumps({"error": "Missing required field: url"}))
            return

        import httpx
        import trafilatura

        sys.stderr.write(f"Fetching URL: {url}\n")
        response = httpx.get(url, follow_redirects=True, timeout=20)
        response.raise_for_status()
        html = response.text

        extracted = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            output_format="json",
            with_metadata=True,
            url=url,
        )

        if extracted:
            meta = json.loads(extracted)
            result = {
                "title": meta.get("title", ""),
                "text": meta.get("text", ""),
                "author": meta.get("author", ""),
                "date": meta.get("date", ""),
                "url": url,
            }
        else:
            result = {
                "title": "",
                "text": "",
                "author": "",
                "date": "",
                "url": url,
                "warning": "Could not extract article content from this URL",
            }

        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
