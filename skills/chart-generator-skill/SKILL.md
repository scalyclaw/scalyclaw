---
name: Chart Generator
description: Generate charts as PNG from data
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---

# Chart Generator Skill

Generate various chart types as PNG images from structured data using matplotlib.

## Input
- `chart_type` (string, required): One of "bar", "line", "pie", "scatter", "histogram"
- `data` (object, required): Data object with labels/values (for bar/pie) or x/y (for line/scatter/histogram)
- `title` (string, required): Chart title
- `x_label` (string, optional): X-axis label
- `y_label` (string, optional): Y-axis label
- `output_filename` (string, optional): Output filename (default: chart.png)

## Output
- `file_path` (string): Path to the generated PNG file
