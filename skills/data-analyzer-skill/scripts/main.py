import sys
import json
import os


def load_dataframe(file_path: str):
    import pandas as pd

    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".csv":
        return pd.read_csv(file_path)
    elif ext == ".json":
        return pd.read_json(file_path)
    elif ext in (".xlsx", ".xls"):
        return pd.read_excel(file_path)
    else:
        raise ValueError(f"Unsupported file format: {ext}. Supported: .csv, .json, .xlsx, .xls")


def main():
    try:
        data = json.loads(sys.stdin.read())
        file_path = data.get("file_path")
        operation = data.get("operation")

        if not file_path:
            print(json.dumps({"error": "Missing required field: file_path"}))
            return
        if not operation:
            print(json.dumps({"error": "Missing required field: operation"}))
            return

        valid_ops = ("describe", "correlations", "filter", "value_counts", "head", "info")
        if operation not in valid_ops:
            print(json.dumps({"error": f"Invalid operation: {operation}. Must be one of: {', '.join(valid_ops)}"}))
            return

        import pandas as pd

        sys.stderr.write(f"Loading file: {file_path}\n")
        df = load_dataframe(file_path)

        column = data.get("column")
        filter_expr = data.get("filter_expr")

        if operation == "describe":
            desc = df.describe(include="all")
            result = {"operation": "describe", "data": json.loads(desc.to_json())}

        elif operation == "correlations":
            numeric_df = df.select_dtypes(include="number")
            if numeric_df.empty:
                print(json.dumps({"error": "No numeric columns found for correlation"}))
                return
            corr = numeric_df.corr()
            result = {"operation": "correlations", "data": json.loads(corr.to_json())}

        elif operation == "filter":
            if not filter_expr:
                print(json.dumps({"error": "Missing required field: filter_expr for filter operation"}))
                return
            filtered = df.query(filter_expr)
            result = {
                "operation": "filter",
                "filter_expr": filter_expr,
                "row_count": len(filtered),
                "data": json.loads(filtered.to_json(orient="records", date_format="iso")),
            }

        elif operation == "value_counts":
            if not column:
                print(json.dumps({"error": "Missing required field: column for value_counts operation"}))
                return
            if column not in df.columns:
                print(json.dumps({"error": f"Column '{column}' not found. Available: {list(df.columns)}"}))
                return
            vc = df[column].value_counts()
            result = {
                "operation": "value_counts",
                "column": column,
                "data": {str(k): int(v) for k, v in vc.items()},
            }

        elif operation == "head":
            n = data.get("n", 10)
            head = df.head(n)
            result = {
                "operation": "head",
                "row_count": len(head),
                "data": json.loads(head.to_json(orient="records", date_format="iso")),
            }

        elif operation == "info":
            info = {
                "operation": "info",
                "row_count": len(df),
                "column_count": len(df.columns),
                "columns": [
                    {
                        "name": col,
                        "dtype": str(df[col].dtype),
                        "non_null_count": int(df[col].notna().sum()),
                        "null_count": int(df[col].isna().sum()),
                    }
                    for col in df.columns
                ],
                "memory_usage_bytes": int(df.memory_usage(deep=True).sum()),
            }
            result = info

        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
