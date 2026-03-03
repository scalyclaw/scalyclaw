import sys
import json
import os


def main():
    try:
        data = json.loads(sys.stdin.read())
        url = data.get("url")
        if not url:
            print(json.dumps({"error": "Missing required field: url"}))
            return

        full_page = data.get("full_page", False)
        width = data.get("width", 1280)
        height = data.get("height", 720)
        output_filename = data.get("output_filename", "screenshot.png")

        workspace = os.environ.get("WORKSPACE_DIR", ".")
        output_path = os.path.join(workspace, output_filename)

        from playwright.sync_api import sync_playwright

        sys.stderr.write(f"Capturing screenshot of: {url}\n")

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": width, "height": height},
                device_scale_factor=1,
            )
            page = context.new_page()

            page.goto(url, wait_until="networkidle", timeout=30000)

            page.screenshot(path=output_path, full_page=full_page)

            browser.close()

        sys.stderr.write(f"Screenshot saved to: {output_path}\n")
        print(json.dumps({"file_path": output_path}))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
