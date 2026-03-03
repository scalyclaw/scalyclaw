import sys
import json
import os


def main():
    try:
        data = json.loads(sys.stdin.read())
        chart_type = data.get("chart_type")
        chart_data = data.get("data")
        title = data.get("title")

        if not chart_type:
            print(json.dumps({"error": "Missing required field: chart_type"}))
            return
        if not chart_data:
            print(json.dumps({"error": "Missing required field: data"}))
            return
        if not title:
            print(json.dumps({"error": "Missing required field: title"}))
            return

        valid_types = ("bar", "line", "pie", "scatter", "histogram")
        if chart_type not in valid_types:
            print(json.dumps({"error": f"Invalid chart_type: {chart_type}. Must be one of: {', '.join(valid_types)}"}))
            return

        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        x_label = data.get("x_label", "")
        y_label = data.get("y_label", "")
        output_filename = data.get("output_filename", "chart.png")

        workspace = os.environ.get("WORKSPACE_DIR", ".")
        output_path = os.path.join(workspace, output_filename)

        fig, ax = plt.subplots(figsize=(10, 6))

        if chart_type == "bar":
            labels = chart_data.get("labels", [])
            values = chart_data.get("values", [])
            ax.bar(labels, values)

        elif chart_type == "line":
            x = chart_data.get("x", chart_data.get("labels", []))
            y = chart_data.get("y", chart_data.get("values", []))
            ax.plot(x, y, marker="o")

        elif chart_type == "pie":
            labels = chart_data.get("labels", [])
            values = chart_data.get("values", [])
            ax.pie(values, labels=labels, autopct="%1.1f%%", startangle=90)
            ax.axis("equal")

        elif chart_type == "scatter":
            x = chart_data.get("x", [])
            y = chart_data.get("y", [])
            ax.scatter(x, y)

        elif chart_type == "histogram":
            values = chart_data.get("values", chart_data.get("x", []))
            bins = chart_data.get("bins", 10)
            ax.hist(values, bins=bins, edgecolor="black")

        ax.set_title(title)
        if x_label:
            ax.set_xlabel(x_label)
        if y_label:
            ax.set_ylabel(y_label)

        plt.tight_layout()
        plt.savefig(output_path, dpi=150, bbox_inches="tight")
        plt.close(fig)

        sys.stderr.write(f"Chart saved to: {output_path}\n")
        print(json.dumps({"file_path": output_path}))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
