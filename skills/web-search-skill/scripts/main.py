import sys
import json


def main():
    try:
        data = json.loads(sys.stdin.read())
        query = data.get("query")
        if not query:
            print(json.dumps({"error": "Missing required field: query"}))
            return

        max_results = data.get("max_results", 10)

        from duckduckgo_search import DDGS

        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", ""),
                })

        print(json.dumps({"results": results}))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
