---
name: Data Analyzer
description: Analyze CSV/JSON/Excel data
script: scripts/main.py
language: python
install: uv sync
timeout: 60
---

# Data Analyzer Skill

Analyze CSV, JSON, and Excel data files using pandas.

## Input
- `file_path` (string, required): Path to the data file (CSV, JSON, or Excel)
- `operation` (string, required): One of "describe", "correlations", "filter", "value_counts", "head", "info"
- `column` (string, optional): Column name for value_counts or filter operations
- `filter_expr` (string, optional): Pandas query expression for filter operation

## Output
Depends on the operation:
- `describe`: Statistical summary of all numeric columns
- `correlations`: Correlation matrix
- `filter`: Filtered rows matching the expression
- `value_counts`: Value counts for the specified column
- `head`: First rows of the dataset
- `info`: Column names, dtypes, row count, memory usage
