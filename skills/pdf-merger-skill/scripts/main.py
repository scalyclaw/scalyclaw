import sys
import json
import os


def get_workspace_dir():
    workspace = os.environ.get("WORKSPACE_DIR", os.getcwd())
    os.makedirs(workspace, exist_ok=True)
    return workspace


def merge_pdfs(data):
    import fitz

    file_paths = data.get("file_paths")
    if not file_paths or not isinstance(file_paths, list) or len(file_paths) == 0:
        raise ValueError("'file_paths' must be a non-empty array of PDF file paths")

    output_filename = data.get("output_filename", "merged.pdf")
    workspace = get_workspace_dir()
    output_path = os.path.join(workspace, output_filename)

    merged = fitz.open()

    for path in file_paths:
        if not os.path.isfile(path):
            raise FileNotFoundError(f"PDF not found: {path}")
        print(f"[merge] adding: {path}", file=sys.stderr)
        src = fitz.open(path)
        merged.insert_pdf(src)
        src.close()

    merged.save(output_path)
    page_count = len(merged)
    merged.close()

    print(f"[merge] saved {page_count} pages to {output_path}", file=sys.stderr)
    return {"file_path": output_path, "page_count": page_count}


def split_pdf(data):
    import fitz

    file_path = data.get("file_path")
    if not file_path:
        raise ValueError("'file_path' is required for split action")
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"PDF not found: {file_path}")

    workspace = get_workspace_dir()
    src = fitz.open(file_path)
    page_count = len(src)
    files = []

    for i in range(page_count):
        page_doc = fitz.open()
        page_doc.insert_pdf(src, from_page=i, to_page=i)
        page_filename = f"page_{i + 1:03d}.pdf"
        page_path = os.path.join(workspace, page_filename)
        page_doc.save(page_path)
        page_doc.close()
        files.append({"file_path": page_path, "page_number": i + 1})
        print(f"[split] page {i + 1} -> {page_path}", file=sys.stderr)

    src.close()

    print(f"[split] split {page_count} pages", file=sys.stderr)
    return {"files": files, "page_count": page_count}


def extract_pages(data):
    import fitz

    file_path = data.get("file_path")
    if not file_path:
        raise ValueError("'file_path' is required for extract action")
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"PDF not found: {file_path}")

    pages = data.get("pages")
    if not pages or not isinstance(pages, list) or len(pages) == 0:
        raise ValueError("'pages' must be a non-empty array of page numbers (1-indexed)")

    output_filename = data.get("output_filename", "extracted.pdf")
    workspace = get_workspace_dir()
    output_path = os.path.join(workspace, output_filename)

    src = fitz.open(file_path)
    total_pages = len(src)

    for p in pages:
        if not isinstance(p, int) or p < 1 or p > total_pages:
            src.close()
            raise ValueError(
                f"Invalid page number {p}: must be between 1 and {total_pages}"
            )

    extracted = fitz.open()
    for p in pages:
        extracted.insert_pdf(src, from_page=p - 1, to_page=p - 1)
        print(f"[extract] extracting page {p}", file=sys.stderr)

    extracted.save(output_path)
    page_count = len(extracted)
    extracted.close()
    src.close()

    print(f"[extract] saved {page_count} pages to {output_path}", file=sys.stderr)
    return {"file_path": output_path, "page_count": page_count}


def main():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(1)

    action = data.get("action")
    if not action:
        print(json.dumps({"error": "'action' is required: merge, split, or extract"}))
        sys.exit(1)

    try:
        if action == "merge":
            result = merge_pdfs(data)
        elif action == "split":
            result = split_pdf(data)
        elif action == "extract":
            result = extract_pages(data)
        else:
            print(
                json.dumps(
                    {"error": f"Unknown action '{action}'. Use: merge, split, extract"}
                )
            )
            sys.exit(1)

        print(json.dumps(result))
    except FileNotFoundError as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Unexpected error: {e}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
