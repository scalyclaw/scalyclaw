---
name: Color Converter
description: Convert between color formats (hex, RGB, HSL, HSV, CMYK) and generate color palettes
script: target/release/color-converter-skill
language: rust
install: cargo build --release
timeout: 5
---

# Color Converter

Convert between color formats (hex, RGB, HSL, HSV, CMYK) and generate color palettes (complementary, analogous, triadic, tetradic, monochromatic).

## Input
- `action` (string, optional, default "convert"): "convert" or "palette"

### For "convert"
- `color` (string, required): Color in any format (hex, rgb, hsl, or named color)
- `to` (string or array, optional): Target format(s) — "hex", "rgb", "hsl", "hsv", "cmyk". Defaults to all.

### For "palette"
- `color` (string, required): Base color in any format
- `type` (string, optional, default "complementary"): "complementary", "analogous", "triadic", "tetradic", "monochromatic"
- `count` (int, optional, default 5): Number of colors for monochromatic

## Output (convert)
- `hex` (string), `rgb` (object: r,g,b), `hsl` (object: h,s,l), `hsv` (object: h,s,v), `cmyk` (object: c,m,y,k)

## Output (palette)
- `base` (object with all formats)
- `palette` (array of objects, each with all formats)
- `type` (string): Palette type used
