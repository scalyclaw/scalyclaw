use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, Read};

#[derive(Deserialize)]
struct Input {
    value: f64,
    from: String,
    to: String,
    #[serde(default)]
    category: Option<String>,
}

#[derive(Serialize)]
struct Output {
    value: f64,
    result: f64,
    from: String,
    to: String,
    category: String,
    formula: String,
}

#[derive(Clone, Debug)]
struct UnitInfo {
    category: String,
    canonical: String,
    factor: f64,
}

fn build_unit_map() -> HashMap<String, UnitInfo> {
    let mut map: HashMap<String, UnitInfo> = HashMap::new();

    // Helper closure to insert a unit with multiple aliases
    let mut add = |category: &str, canonical: &str, factor: f64, aliases: &[&str]| {
        let info = UnitInfo {
            category: category.to_string(),
            canonical: canonical.to_string(),
            factor,
        };
        for alias in aliases {
            map.insert(alias.to_lowercase(), info.clone());
        }
    };

    // Length — base unit: meter
    add("length", "mm", 0.001, &["mm", "millimeter", "millimeters", "millimetre", "millimetres"]);
    add("length", "cm", 0.01, &["cm", "centimeter", "centimeters", "centimetre", "centimetres"]);
    add("length", "m", 1.0, &["m", "meter", "meters", "metre", "metres"]);
    add("length", "km", 1000.0, &["km", "kilometer", "kilometers", "kilometre", "kilometres"]);
    add("length", "inch", 0.0254, &["inch", "inches", "in"]);
    add("length", "foot", 0.3048, &["foot", "feet", "ft"]);
    add("length", "yard", 0.9144, &["yard", "yards", "yd"]);
    add("length", "mile", 1609.344, &["mile", "miles", "mi"]);
    add("length", "nautical_mile", 1852.0, &["nautical_mile", "nautical_miles", "nmi", "nm"]);

    // Weight/Mass — base unit: gram
    add("weight", "mg", 0.001, &["mg", "milligram", "milligrams"]);
    add("weight", "g", 1.0, &["g", "gram", "grams"]);
    add("weight", "kg", 1000.0, &["kg", "kilogram", "kilograms"]);
    add("weight", "tonne", 1_000_000.0, &["tonne", "tonnes", "metric_ton", "metric_tons", "t"]);
    add("weight", "oz", 28.349523125, &["oz", "ounce", "ounces"]);
    add("weight", "lb", 453.59237, &["lb", "lbs", "pound", "pounds"]);
    add("weight", "stone", 6350.29318, &["stone", "stones", "st"]);

    // Temperature — special handling, factor is unused but we register the units
    add("temperature", "celsius", 0.0, &["celsius", "c", "degc"]);
    add("temperature", "fahrenheit", 0.0, &["fahrenheit", "f", "degf"]);
    add("temperature", "kelvin", 0.0, &["kelvin", "k"]);

    // Volume — base unit: milliliter (ml)
    add("volume", "ml", 1.0, &["ml", "milliliter", "milliliters", "millilitre", "millilitres"]);
    add("volume", "l", 1000.0, &["l", "liter", "liters", "litre", "litres"]);
    add("volume", "gallon_us", 3785.41178, &["gallon_us", "gal_us", "gallon", "gallons", "gal"]);
    add("volume", "gallon_uk", 4546.09, &["gallon_uk", "gal_uk", "imperial_gallon"]);
    add("volume", "cup", 236.588, &["cup", "cups"]);
    add("volume", "tablespoon", 14.7868, &["tablespoon", "tablespoons", "tbsp"]);
    add("volume", "teaspoon", 4.92892, &["teaspoon", "teaspoons", "tsp"]);
    add("volume", "fl_oz", 29.5735, &["fl_oz", "fluid_ounce", "fluid_ounces", "floz"]);
    add("volume", "pint", 473.176, &["pint", "pints", "pt"]);

    // Area — base unit: square meter (m2)
    add("area", "mm2", 0.000001, &["mm2", "sq_mm", "square_mm"]);
    add("area", "cm2", 0.0001, &["cm2", "sq_cm", "square_cm"]);
    add("area", "m2", 1.0, &["m2", "sq_m", "square_m", "square_meter", "square_meters"]);
    add("area", "km2", 1_000_000.0, &["km2", "sq_km", "square_km"]);
    add("area", "hectare", 10_000.0, &["hectare", "hectares", "ha"]);
    add("area", "acre", 4046.8564224, &["acre", "acres"]);
    add("area", "sqft", 0.09290304, &["sqft", "sq_ft", "square_foot", "square_feet"]);
    add("area", "sqmi", 2_589_988.110336, &["sqmi", "sq_mi", "square_mile", "square_miles"]);

    // Speed — base unit: meters per second (m/s)
    add("speed", "m_s", 1.0, &["m_s", "m/s", "mps", "meters_per_second"]);
    add("speed", "km_h", 1.0 / 3.6, &["km_h", "km/h", "kph", "kilometers_per_hour", "kmh"]);
    add("speed", "mph", 0.44704, &["mph", "miles_per_hour"]);
    add("speed", "knot", 0.514444, &["knot", "knots", "kn", "kt"]);
    add("speed", "ft_s", 0.3048, &["ft_s", "ft/s", "fps", "feet_per_second"]);

    // Data — base unit: byte
    add("data", "bit", 0.125, &["bit", "bits"]);
    add("data", "byte", 1.0, &["byte", "bytes", "b"]);
    add("data", "kb", 1000.0, &["kb", "kilobyte", "kilobytes"]);
    add("data", "mb", 1_000_000.0, &["mb", "megabyte", "megabytes"]);
    add("data", "gb", 1_000_000_000.0, &["gb", "gigabyte", "gigabytes"]);
    add("data", "tb", 1_000_000_000_000.0, &["tb", "terabyte", "terabytes"]);
    add("data", "pb", 1_000_000_000_000_000.0, &["pb", "petabyte", "petabytes"]);
    add("data", "kib", 1024.0, &["kib", "kibibyte", "kibibytes"]);
    add("data", "mib", 1_048_576.0, &["mib", "mebibyte", "mebibytes"]);
    add("data", "gib", 1_073_741_824.0, &["gib", "gibibyte", "gibibytes"]);
    add("data", "tib", 1_099_511_627_776.0, &["tib", "tebibyte", "tebibytes"]);

    // Time — base unit: second
    add("time", "ms", 0.001, &["ms", "millisecond", "milliseconds"]);
    add("time", "second", 1.0, &["second", "seconds", "sec", "s"]);
    add("time", "minute", 60.0, &["minute", "minutes", "min"]);
    add("time", "hour", 3600.0, &["hour", "hours", "hr", "h"]);
    add("time", "day", 86400.0, &["day", "days", "d"]);
    add("time", "week", 604800.0, &["week", "weeks", "wk"]);
    add("time", "month", 2_629_746.0, &["month", "months", "mo"]); // average month (365.25/12 days)
    add("time", "year", 31_556_952.0, &["year", "years", "yr"]); // average year (365.25 days)

    map
}

fn convert_temperature(value: f64, from: &str, to: &str) -> Result<f64, String> {
    // Normalize to Celsius first
    let celsius = match from {
        "celsius" => value,
        "fahrenheit" => (value - 32.0) * 5.0 / 9.0,
        "kelvin" => value - 273.15,
        _ => return Err(format!("Unknown temperature unit: {}", from)),
    };

    // Convert from Celsius to target
    match to {
        "celsius" => Ok(celsius),
        "fahrenheit" => Ok(celsius * 9.0 / 5.0 + 32.0),
        "kelvin" => Ok(celsius + 273.15),
        _ => Err(format!("Unknown temperature unit: {}", to)),
    }
}

fn temperature_formula(from_canonical: &str, to_canonical: &str) -> String {
    match (from_canonical, to_canonical) {
        ("celsius", "fahrenheit") => "C * 9/5 + 32 = F".to_string(),
        ("fahrenheit", "celsius") => "(F - 32) * 5/9 = C".to_string(),
        ("celsius", "kelvin") => "C + 273.15 = K".to_string(),
        ("kelvin", "celsius") => "K - 273.15 = C".to_string(),
        ("fahrenheit", "kelvin") => "(F - 32) * 5/9 + 273.15 = K".to_string(),
        ("kelvin", "fahrenheit") => "(K - 273.15) * 9/5 + 32 = F".to_string(),
        _ => format!("{} -> {}", from_canonical, to_canonical),
    }
}

fn round6(v: f64) -> f64 {
    (v * 1_000_000.0).round() / 1_000_000.0
}

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

    let unit_map = build_unit_map();

    let from_key = input.from.to_lowercase();
    let to_key = input.to.to_lowercase();

    let from_info = match unit_map.get(&from_key) {
        Some(info) => info.clone(),
        None => {
            let err = serde_json::json!({
                "error": format!("Unknown source unit: '{}'. Supported units include: mm, cm, m, km, inch, foot, mile, mg, g, kg, lb, oz, celsius, fahrenheit, kelvin, ml, l, gallon_us, m2, km2, acre, m_s, km_h, mph, bit, byte, kb, mb, gb, tb, ms, second, minute, hour, day, week, month, year", input.from)
            });
            println!("{}", err);
            return;
        }
    };

    let to_info = match unit_map.get(&to_key) {
        Some(info) => info.clone(),
        None => {
            let err = serde_json::json!({
                "error": format!("Unknown target unit: '{}'. Supported units include: mm, cm, m, km, inch, foot, mile, mg, g, kg, lb, oz, celsius, fahrenheit, kelvin, ml, l, gallon_us, m2, km2, acre, m_s, km_h, mph, bit, byte, kb, mb, gb, tb, ms, second, minute, hour, day, week, month, year", input.to)
            });
            println!("{}", err);
            return;
        }
    };

    // Resolve category: if user provided a hint and both units exist in that category, use it.
    // Otherwise, check that from and to are in the same category.
    let from_cat = &from_info.category;
    let to_cat = &to_info.category;

    // If user provided a category hint, validate it
    if let Some(ref cat_hint) = input.category {
        let hint_lower = cat_hint.to_lowercase();
        if from_cat.to_lowercase() != hint_lower || to_cat.to_lowercase() != hint_lower {
            eprintln!(
                "Category hint '{}' ignored; using detected categories: from='{}', to='{}'",
                cat_hint, from_cat, to_cat
            );
        }
    }

    if from_cat != to_cat {
        let err = serde_json::json!({
            "error": format!(
                "Cannot convert between different categories: '{}' ({}) and '{}' ({})",
                input.from, from_cat, input.to, to_cat
            )
        });
        println!("{}", err);
        return;
    }

    let category = from_cat.clone();

    // Perform conversion
    let result = if category == "temperature" {
        match convert_temperature(input.value, &from_info.canonical, &to_info.canonical) {
            Ok(v) => v,
            Err(e) => {
                let err = serde_json::json!({"error": e});
                println!("{}", err);
                return;
            }
        }
    } else {
        // Standard multiplicative conversion: value * from_factor / to_factor
        input.value * from_info.factor / to_info.factor
    };

    let result = round6(result);

    // Build formula
    let formula = if category == "temperature" {
        temperature_formula(&from_info.canonical, &to_info.canonical)
    } else {
        let factor = round6(from_info.factor / to_info.factor);
        format!("1 {} = {} {}", from_info.canonical, factor, to_info.canonical)
    };

    let output = Output {
        value: input.value,
        result,
        from: from_info.canonical,
        to: to_info.canonical,
        category,
        formula,
    };

    eprintln!(
        "Converted {} {} -> {} {}",
        input.value, output.from, output.result, output.to
    );

    println!("{}", serde_json::to_string(&output).unwrap());
}
