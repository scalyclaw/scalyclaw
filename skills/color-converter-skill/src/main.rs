use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{self, Read};

// ─── Input types ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct Input {
    #[serde(default = "default_action")]
    action: String,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    to: Option<ToFormat>,
    #[serde(default = "default_palette_type")]
    r#type: String,
    #[serde(default = "default_count")]
    count: usize,
}

fn default_action() -> String {
    "convert".to_string()
}

fn default_palette_type() -> String {
    "complementary".to_string()
}

fn default_count() -> usize {
    5
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ToFormat {
    Single(String),
    Multiple(Vec<String>),
}

// ─── Output types ─────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct ColorFormats {
    hex: String,
    rgb: RgbOut,
    hsl: HslOut,
    hsv: HsvOut,
    cmyk: CmykOut,
}

#[derive(Serialize, Clone)]
struct RgbOut {
    r: u8,
    g: u8,
    b: u8,
}

#[derive(Serialize, Clone)]
struct HslOut {
    h: f64,
    s: f64,
    l: f64,
}

#[derive(Serialize, Clone)]
struct HsvOut {
    h: f64,
    s: f64,
    v: f64,
}

#[derive(Serialize, Clone)]
struct CmykOut {
    c: f64,
    m: f64,
    y: f64,
    k: f64,
}

#[derive(Serialize)]
struct PaletteOutput {
    base: ColorFormats,
    palette: Vec<ColorFormats>,
    r#type: String,
}

// ─── Color math ───────────────────────────────────────────────────────────────

fn rgb_to_hex(r: u8, g: u8, b: u8) -> String {
    format!("#{:02X}{:02X}{:02X}", r, g, b)
}

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let rf = r as f64 / 255.0;
    let gf = g as f64 / 255.0;
    let bf = b as f64 / 255.0;

    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let delta = max - min;

    let l = (max + min) / 2.0;

    if delta == 0.0 {
        return (0.0, 0.0, round2(l * 100.0));
    }

    let s = if l < 0.5 {
        delta / (max + min)
    } else {
        delta / (2.0 - max - min)
    };

    let mut h = if (max - rf).abs() < f64::EPSILON {
        ((gf - bf) / delta) % 6.0
    } else if (max - gf).abs() < f64::EPSILON {
        (bf - rf) / delta + 2.0
    } else {
        (rf - gf) / delta + 4.0
    };

    h *= 60.0;
    if h < 0.0 {
        h += 360.0;
    }

    (round2(h), round2(s * 100.0), round2(l * 100.0))
}

fn rgb_to_hsv(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let rf = r as f64 / 255.0;
    let gf = g as f64 / 255.0;
    let bf = b as f64 / 255.0;

    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let delta = max - min;

    let v = max;

    if delta == 0.0 {
        return (0.0, 0.0, round2(v * 100.0));
    }

    let s = delta / max;

    let mut h = if (max - rf).abs() < f64::EPSILON {
        ((gf - bf) / delta) % 6.0
    } else if (max - gf).abs() < f64::EPSILON {
        (bf - rf) / delta + 2.0
    } else {
        (rf - gf) / delta + 4.0
    };

    h *= 60.0;
    if h < 0.0 {
        h += 360.0;
    }

    (round2(h), round2(s * 100.0), round2(v * 100.0))
}

fn rgb_to_cmyk(r: u8, g: u8, b: u8) -> (f64, f64, f64, f64) {
    if r == 0 && g == 0 && b == 0 {
        return (0.0, 0.0, 0.0, 100.0);
    }

    let rf = r as f64 / 255.0;
    let gf = g as f64 / 255.0;
    let bf = b as f64 / 255.0;

    let k = 1.0 - rf.max(gf).max(bf);
    let c = (1.0 - rf - k) / (1.0 - k);
    let m = (1.0 - gf - k) / (1.0 - k);
    let y = (1.0 - bf - k) / (1.0 - k);

    (
        round2(c * 100.0),
        round2(m * 100.0),
        round2(y * 100.0),
        round2(k * 100.0),
    )
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    // h in [0,360), s in [0,100], l in [0,100]
    let s = s / 100.0;
    let l = l / 100.0;

    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let h2 = h / 60.0;
    let x = c * (1.0 - (h2 % 2.0 - 1.0).abs());
    let m = l - c / 2.0;

    let (r1, g1, b1) = if h2 < 1.0 {
        (c, x, 0.0)
    } else if h2 < 2.0 {
        (x, c, 0.0)
    } else if h2 < 3.0 {
        (0.0, c, x)
    } else if h2 < 4.0 {
        (0.0, x, c)
    } else if h2 < 5.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };

    let r = ((r1 + m) * 255.0).round() as u8;
    let g = ((g1 + m) * 255.0).round() as u8;
    let b = ((b1 + m) * 255.0).round() as u8;
    (r, g, b)
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

// ─── Color parsing ────────────────────────────────────────────────────────────

fn named_colors() -> HashMap<String, (u8, u8, u8)> {
    let mut m = HashMap::new();
    m.insert("red".into(), (255, 0, 0));
    m.insert("blue".into(), (0, 0, 255));
    m.insert("green".into(), (0, 128, 0));
    m.insert("yellow".into(), (255, 255, 0));
    m.insert("cyan".into(), (0, 255, 255));
    m.insert("magenta".into(), (255, 0, 255));
    m.insert("white".into(), (255, 255, 255));
    m.insert("black".into(), (0, 0, 0));
    m.insert("orange".into(), (255, 165, 0));
    m.insert("purple".into(), (128, 0, 128));
    m.insert("pink".into(), (255, 192, 203));
    m.insert("brown".into(), (165, 42, 42));
    m.insert("gray".into(), (128, 128, 128));
    m.insert("grey".into(), (128, 128, 128));
    m.insert("navy".into(), (0, 0, 128));
    m.insert("teal".into(), (0, 128, 128));
    m.insert("lime".into(), (0, 255, 0));
    m.insert("olive".into(), (128, 128, 0));
    m.insert("maroon".into(), (128, 0, 0));
    m.insert("aqua".into(), (0, 255, 255));
    m.insert("silver".into(), (192, 192, 192));
    m
}

fn parse_color(input: &str) -> Result<(u8, u8, u8), String> {
    let trimmed = input.trim();

    // Try named color first
    let lower = trimmed.to_lowercase();
    let names = named_colors();
    if let Some(&(r, g, b)) = names.get(&lower) {
        return Ok((r, g, b));
    }

    // Try hex: "#FF5733" or "FF5733"
    let hex_str = trimmed.strip_prefix('#').unwrap_or(trimmed);
    if hex_str.len() == 6 && hex_str.chars().all(|c| c.is_ascii_hexdigit()) {
        let r = u8::from_str_radix(&hex_str[0..2], 16).map_err(|e| e.to_string())?;
        let g = u8::from_str_radix(&hex_str[2..4], 16).map_err(|e| e.to_string())?;
        let b = u8::from_str_radix(&hex_str[4..6], 16).map_err(|e| e.to_string())?;
        return Ok((r, g, b));
    }
    // 3-char hex shorthand: "#F53" -> "#FF5533"
    if hex_str.len() == 3 && hex_str.chars().all(|c| c.is_ascii_hexdigit()) {
        let chars: Vec<char> = hex_str.chars().collect();
        let expanded = format!(
            "{0}{0}{1}{1}{2}{2}",
            chars[0], chars[1], chars[2]
        );
        let r = u8::from_str_radix(&expanded[0..2], 16).map_err(|e| e.to_string())?;
        let g = u8::from_str_radix(&expanded[2..4], 16).map_err(|e| e.to_string())?;
        let b = u8::from_str_radix(&expanded[4..6], 16).map_err(|e| e.to_string())?;
        return Ok((r, g, b));
    }

    // Try "rgb(r, g, b)" or "r,g,b"
    if let Some(rgb_result) = try_parse_rgb(trimmed) {
        return rgb_result;
    }

    // Try "hsl(h, s%, l%)"
    if let Some(hsl_result) = try_parse_hsl(trimmed) {
        return hsl_result;
    }

    Err(format!("Unable to parse color: '{}'", input))
}

fn try_parse_rgb(s: &str) -> Option<Result<(u8, u8, u8), String>> {
    // "rgb(255, 87, 51)" or "255,87,51"
    let inner = if s.to_lowercase().starts_with("rgb(") && s.ends_with(')') {
        &s[4..s.len() - 1]
    } else if s.contains(',') && !s.to_lowercase().starts_with("hsl(") {
        s
    } else {
        return None;
    };

    let parts: Vec<&str> = inner.split(',').map(|p| p.trim()).collect();
    if parts.len() != 3 {
        return Some(Err(format!("RGB expects 3 values, got {}", parts.len())));
    }

    let nums: Result<Vec<u8>, _> = parts
        .iter()
        .map(|p| {
            p.parse::<u8>()
                .map_err(|_| format!("Invalid RGB value: '{}'", p))
        })
        .collect();

    match nums {
        Ok(v) => Some(Ok((v[0], v[1], v[2]))),
        Err(e) => Some(Err(e)),
    }
}

fn try_parse_hsl(s: &str) -> Option<Result<(u8, u8, u8), String>> {
    // "hsl(14, 100%, 60%)"
    let lower = s.to_lowercase();
    if !lower.starts_with("hsl(") || !lower.ends_with(')') {
        return None;
    }

    let inner = &s[4..s.len() - 1];
    let parts: Vec<&str> = inner.split(',').map(|p| p.trim()).collect();
    if parts.len() != 3 {
        return Some(Err(format!("HSL expects 3 values, got {}", parts.len())));
    }

    let h: f64 = match parts[0].parse() {
        Ok(v) => v,
        Err(_) => return Some(Err(format!("Invalid hue: '{}'", parts[0]))),
    };
    let s_str = parts[1].trim_end_matches('%');
    let l_str = parts[2].trim_end_matches('%');

    let s_val: f64 = match s_str.parse() {
        Ok(v) => v,
        Err(_) => return Some(Err(format!("Invalid saturation: '{}'", parts[1]))),
    };
    let l_val: f64 = match l_str.parse() {
        Ok(v) => v,
        Err(_) => return Some(Err(format!("Invalid lightness: '{}'", parts[2]))),
    };

    let (r, g, b) = hsl_to_rgb(h, s_val, l_val);
    Some(Ok((r, g, b)))
}

// ─── Format building ──────────────────────────────────────────────────────────

fn build_all_formats(r: u8, g: u8, b: u8) -> ColorFormats {
    let hex = rgb_to_hex(r, g, b);
    let (hh, hs, hl) = rgb_to_hsl(r, g, b);
    let (vh, vs, vv) = rgb_to_hsv(r, g, b);
    let (cc, cm, cy, ck) = rgb_to_cmyk(r, g, b);

    ColorFormats {
        hex,
        rgb: RgbOut { r, g, b },
        hsl: HslOut {
            h: hh,
            s: hs,
            l: hl,
        },
        hsv: HsvOut {
            h: vh,
            s: vs,
            v: vv,
        },
        cmyk: CmykOut {
            c: cc,
            m: cm,
            y: cy,
            k: ck,
        },
    }
}

fn filter_formats(full: &ColorFormats, targets: &[String]) -> Value {
    let mut map = serde_json::Map::new();
    for t in targets {
        match t.to_lowercase().as_str() {
            "hex" => {
                map.insert("hex".into(), serde_json::to_value(&full.hex).unwrap());
            }
            "rgb" => {
                map.insert("rgb".into(), serde_json::to_value(&full.rgb).unwrap());
            }
            "hsl" => {
                map.insert("hsl".into(), serde_json::to_value(&full.hsl).unwrap());
            }
            "hsv" => {
                map.insert("hsv".into(), serde_json::to_value(&full.hsv).unwrap());
            }
            "cmyk" => {
                map.insert("cmyk".into(), serde_json::to_value(&full.cmyk).unwrap());
            }
            other => {
                eprintln!("Unknown target format '{}', skipping", other);
            }
        }
    }
    Value::Object(map)
}

// ─── Palette generation ───────────────────────────────────────────────────────

fn hue_shift(h: f64, degrees: f64) -> f64 {
    ((h + degrees) % 360.0 + 360.0) % 360.0
}

fn generate_palette(
    r: u8,
    g: u8,
    b: u8,
    palette_type: &str,
    count: usize,
) -> Result<(Vec<ColorFormats>, String), String> {
    let (h, s, l) = rgb_to_hsl(r, g, b);

    let used_type = palette_type.to_lowercase();
    let hsl_colors: Vec<(f64, f64, f64)> = match used_type.as_str() {
        "complementary" => {
            vec![(hue_shift(h, 180.0), s, l)]
        }
        "analogous" => {
            vec![
                (hue_shift(h, -30.0), s, l),
                (h, s, l),
                (hue_shift(h, 30.0), s, l),
            ]
        }
        "triadic" => {
            vec![
                (h, s, l),
                (hue_shift(h, 120.0), s, l),
                (hue_shift(h, 240.0), s, l),
            ]
        }
        "tetradic" => {
            vec![
                (h, s, l),
                (hue_shift(h, 90.0), s, l),
                (hue_shift(h, 180.0), s, l),
                (hue_shift(h, 270.0), s, l),
            ]
        }
        "monochromatic" => {
            let actual_count = if count < 2 { 5 } else { count };
            let step = 60.0 / (actual_count as f64 - 1.0);
            (0..actual_count)
                .map(|i| {
                    let lightness = 20.0 + step * i as f64;
                    (h, s, lightness)
                })
                .collect()
        }
        _ => {
            return Err(format!(
                "Unknown palette type: '{}'. Supported: complementary, analogous, triadic, tetradic, monochromatic",
                palette_type
            ));
        }
    };

    let palette: Vec<ColorFormats> = hsl_colors
        .iter()
        .map(|&(ph, ps, pl)| {
            let (pr, pg, pb) = hsl_to_rgb(ph, ps, pl);
            build_all_formats(pr, pg, pb)
        })
        .collect();

    Ok((palette, used_type))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    let mut input_str = String::new();
    io::stdin()
        .read_to_string(&mut input_str)
        .expect("Failed to read stdin");

    let input: Input = match serde_json::from_str(&input_str) {
        Ok(v) => v,
        Err(e) => {
            let err = serde_json::json!({"error": format!("Invalid input: {}", e)});
            println!("{}", err);
            return;
        }
    };

    let color_str = match &input.color {
        Some(c) => c.clone(),
        None => {
            let err = serde_json::json!({"error": "Missing required field: 'color'"});
            println!("{}", err);
            return;
        }
    };

    let (r, g, b) = match parse_color(&color_str) {
        Ok(rgb) => rgb,
        Err(e) => {
            let err = serde_json::json!({"error": e});
            println!("{}", err);
            return;
        }
    };

    eprintln!("Parsed color '{}' -> RGB({}, {}, {})", color_str, r, g, b);

    match input.action.to_lowercase().as_str() {
        "convert" => {
            let all = build_all_formats(r, g, b);

            // Determine which formats to return
            let output = match &input.to {
                Some(ToFormat::Single(s)) => {
                    filter_formats(&all, &[s.clone()])
                }
                Some(ToFormat::Multiple(v)) => {
                    filter_formats(&all, v)
                }
                None => {
                    // Return all formats
                    serde_json::to_value(&all).unwrap()
                }
            };

            println!("{}", serde_json::to_string(&output).unwrap());
        }
        "palette" => {
            let base = build_all_formats(r, g, b);

            match generate_palette(r, g, b, &input.r#type, input.count) {
                Ok((palette, used_type)) => {
                    let output = PaletteOutput {
                        base,
                        palette,
                        r#type: used_type,
                    };
                    println!("{}", serde_json::to_string(&output).unwrap());
                }
                Err(e) => {
                    let err = serde_json::json!({"error": e});
                    println!("{}", err);
                }
            }
        }
        other => {
            let err = serde_json::json!({
                "error": format!("Unknown action: '{}'. Supported: 'convert', 'palette'", other)
            });
            println!("{}", err);
        }
    }
}
