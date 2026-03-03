use serde::Deserialize;
use serde_json;
use std::io::{self, Read};

#[derive(Deserialize)]
struct Input {
    content: String,
    from_format: String,
    to_format: String,
    pretty: Option<bool>,
}

fn main() {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .expect("Failed to read stdin");

    let data: Input = match serde_json::from_str(&input) {
        Ok(v) => v,
        Err(e) => {
            println!(
                "{}",
                serde_json::json!({"error": format!("Invalid input: {}", e)})
            );
            return;
        }
    };

    let pretty = data.pretty.unwrap_or(true);
    let from = data.from_format.to_lowercase();
    let to = data.to_format.to_lowercase();

    // Validate formats
    let valid_formats = ["yaml", "json", "toml"];
    if !valid_formats.contains(&from.as_str()) {
        println!(
            "{}",
            serde_json::json!({"error": format!("Invalid from_format '{}'. Must be one of: yaml, json, toml", from)})
        );
        return;
    }
    if !valid_formats.contains(&to.as_str()) {
        println!(
            "{}",
            serde_json::json!({"error": format!("Invalid to_format '{}'. Must be one of: yaml, json, toml", to)})
        );
        return;
    }

    // Parse input into serde_json::Value
    let value: serde_json::Value = match from.as_str() {
        "json" => match serde_json::from_str(&data.content) {
            Ok(v) => v,
            Err(e) => {
                println!(
                    "{}",
                    serde_json::json!({"error": format!("Failed to parse JSON: {}", e)})
                );
                return;
            }
        },
        "yaml" => match serde_yaml::from_str(&data.content) {
            Ok(v) => v,
            Err(e) => {
                println!(
                    "{}",
                    serde_json::json!({"error": format!("Failed to parse YAML: {}", e)})
                );
                return;
            }
        },
        "toml" => match toml::from_str::<toml::Value>(&data.content) {
            Ok(v) => {
                // Convert toml::Value to serde_json::Value via serialization
                let json_str = match serde_json::to_string(&v) {
                    Ok(s) => s,
                    Err(e) => {
                        println!(
                            "{}",
                            serde_json::json!({"error": format!("Failed to convert TOML to intermediate: {}", e)})
                        );
                        return;
                    }
                };
                match serde_json::from_str(&json_str) {
                    Ok(v) => v,
                    Err(e) => {
                        println!(
                            "{}",
                            serde_json::json!({"error": format!("Failed to convert TOML intermediate: {}", e)})
                        );
                        return;
                    }
                }
            }
            Err(e) => {
                println!(
                    "{}",
                    serde_json::json!({"error": format!("Failed to parse TOML: {}", e)})
                );
                return;
            }
        },
        _ => unreachable!(),
    };

    // Serialize to target format
    let result = match to.as_str() {
        "json" => {
            if pretty {
                serde_json::to_string_pretty(&value)
            } else {
                serde_json::to_string(&value)
            }
            .map_err(|e| format!("Failed to serialize to JSON: {}", e))
        }
        "yaml" => serde_yaml::to_string(&value)
            .map_err(|e| format!("Failed to serialize to YAML: {}", e)),
        "toml" => {
            // TOML requires root to be a table/object
            if !value.is_object() {
                Err("TOML requires a table/object at the root level. The input data is not a table/object.".to_string())
            } else {
                // Convert serde_json::Value to toml::Value
                let toml_str = serde_json::to_string(&value).unwrap();
                let toml_value: toml::Value = match serde_json::from_str::<serde_json::Value>(&toml_str) {
                    Ok(jv) => json_to_toml(&jv),
                    Err(e) => {
                        println!(
                            "{}",
                            serde_json::json!({"error": format!("Failed to convert to TOML value: {}", e)})
                        );
                        return;
                    }
                };
                if pretty {
                    toml::to_string_pretty(&toml_value)
                } else {
                    toml::to_string(&toml_value)
                }
                .map_err(|e| format!("Failed to serialize to TOML: {}", e))
            }
        }
        _ => unreachable!(),
    };

    match result {
        Ok(result_str) => {
            let output = serde_json::json!({
                "result": result_str,
                "from_format": from,
                "to_format": to,
            });
            println!("{}", serde_json::to_string(&output).unwrap());
        }
        Err(e) => {
            println!("{}", serde_json::json!({"error": e}));
        }
    }
}

/// Convert a serde_json::Value to a toml::Value
fn json_to_toml(json: &serde_json::Value) -> toml::Value {
    match json {
        serde_json::Value::Null => toml::Value::String("null".to_string()),
        serde_json::Value::Bool(b) => toml::Value::Boolean(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                toml::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                toml::Value::Float(f)
            } else {
                toml::Value::String(n.to_string())
            }
        }
        serde_json::Value::String(s) => toml::Value::String(s.clone()),
        serde_json::Value::Array(arr) => {
            let items: Vec<toml::Value> = arr.iter().map(|v| json_to_toml(v)).collect();
            toml::Value::Array(items)
        }
        serde_json::Value::Object(obj) => {
            let mut table = toml::map::Map::new();
            for (k, v) in obj {
                table.insert(k.clone(), json_to_toml(v));
            }
            toml::Value::Table(table)
        }
    }
}
