import sys
import json


def main():
    try:
        data = json.loads(sys.stdin.read())
        file_path = data.get("file_path")
        if not file_path:
            print(json.dumps({"error": "Missing required field: file_path"}))
            return

        page_filter = data.get("pages")

        import fitz  # pymupdf

        sys.stderr.write(f"Opening PDF: {file_path}\n")
        doc = fitz.open(file_path)

        metadata = {
            "author": doc.metadata.get("author", ""),
            "title": doc.metadata.get("title", ""),
            "subject": doc.metadata.get("subject", ""),
            "creator": doc.metadata.get("creator", ""),
            "producer": doc.metadata.get("producer", ""),
            "creation_date": doc.metadata.get("creationDate", ""),
            "modification_date": doc.metadata.get("modDate", ""),
        }

        pages = []
        all_text_parts = []

        for page_num in range(doc.page_count):
            if page_filter is not None and page_num not in page_filter:
                continue
            page = doc.load_page(page_num)
            text = page.get_text()
            pages.append({"page": page_num, "text": text})
            all_text_parts.append(text)

        doc.close()

        result = {
            "text": "\n".join(all_text_parts),
            "page_count": doc.page_count,
            "metadata": metadata,
            "pages": pages,
        }

        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
