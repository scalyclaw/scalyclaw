use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, Read};

#[derive(Deserialize)]
struct Input {
    csv_data: Option<String>,
    file_path: Option<String>,
    #[serde(default = "default_true")]
    headers: bool,
    #[serde(default = "default_delimiter")]
    delimiter: String,
}

fn default_true() -> bool {
    true
}

fn default_delimiter() -> String {
    ",".to_string()
}

#[derive(Serialize)]
struct Output {
    data: Value,
    row_count: usize,
    column_count: usize,
}

fn process_csv(csv_text: &str, has_headers: bool, delimiter: u8) -> Result<Output, String> {
    let mut reader_builder = csv::ReaderBuilder::new();
    reader_builder
        .delimiter(delimiter)
        .has_headers(has_headers)
        .flexible(true);

    let mut reader = reader_builder.from_reader(csv_text.as_bytes());

    let mut column_count: usize = 0;

    if has_headers {
        // Parse with headers: produce array of objects
        let headers: Vec<String> = match reader.headers() {
            Ok(h) => {
                let hdrs: Vec<String> = h.iter().map(|s| s.to_string()).collect();
                column_count = hdrs.len();
                hdrs
            }
            Err(e) => return Err(format!("Failed to read CSV headers: {}", e)),
        };

        let mut rows: Vec<Value> = Vec::new();

        for result in reader.records() {
            match result {
                Ok(record) => {
                    let mut obj = serde_json::Map::new();
                    for (i, field) in record.iter().enumerate() {
                        let key = if i < headers.len() {
                            headers[i].clone()
                        } else {
                            format!("column_{}", i)
                        };
                        // Try to parse as number or boolean, fall back to string
                        let value = parse_value(field);
                        obj.insert(key, value);
                    }
                    rows.push(Value::Object(obj));
                }
                Err(e) => {
                    eprintln!("Warning: skipping malformed row: {}", e);
                    continue;
                }
            }
        }

        let row_count = rows.len();

        Ok(Output {
            data: Value::Array(rows),
            row_count,
            column_count,
        })
    } else {
        // Parse without headers: produce array of arrays
        let mut rows: Vec<Value> = Vec::new();

        for result in reader.records() {
            match result {
                Ok(record) => {
                    let row: Vec<Value> = record.iter().map(|field| parse_value(field)).collect();
                    if row.len() > column_count {
                        column_count = row.len();
                    }
                    rows.push(Value::Array(row));
                }
                Err(e) => {
                    eprintln!("Warning: skipping malformed row: {}", e);
                    continue;
                }
            }
        }

        let row_count = rows.len();

        Ok(Output {
            data: Value::Array(rows),
            row_count,
            column_count,
        })
    }
}

/// Try to parse a field value as a number or boolean, falling back to string
fn parse_value(field: &str) -> Value {
    let trimmed = field.trim();

    if trimmed.is_empty() {
        return Value::Null;
    }

    // Try boolean
    if trimmed.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if trimmed.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }

    // Try integer
    if let Ok(n) = trimmed.parse::<i64>() {
        return Value::Number(serde_json::Number::from(n));
    }

    // Try float
    if let Ok(f) = trimmed.parse::<f64>() {
        if let Some(n) = serde_json::Number::from_f64(f) {
            return Value::Number(n);
        }
    }

    // Fall back to string
    Value::String(field.to_string())
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

    // Get the delimiter byte
    let delimiter = if input.delimiter.len() == 1 {
        input.delimiter.as_bytes()[0]
    } else if input.delimiter.is_empty() {
        b','
    } else {
        eprintln!(
            "Warning: delimiter '{}' is more than one character, using first character",
            input.delimiter
        );
        input.delimiter.as_bytes()[0]
    };

    // Get the CSV data
    let csv_text = if let Some(ref fp) = input.file_path {
        match std::fs::read_to_string(fp) {
            Ok(contents) => contents,
            Err(e) => {
                eprintln!("Error reading file '{}': {}", fp, e);
                let err =
                    serde_json::json!({"error": format!("Failed to read file '{}': {}", fp, e)});
                println!("{}", err);
                return;
            }
        }
    } else if let Some(ref data) = input.csv_data {
        data.clone()
    } else {
        let err =
            serde_json::json!({"error": "Either 'csv_data' or 'file_path' must be provided"});
        println!("{}", err);
        return;
    };

    match process_csv(&csv_text, input.headers, delimiter) {
        Ok(output) => {
            println!("{}", serde_json::to_string(&output).unwrap());
        }
        Err(e) => {
            eprintln!("CSV processing error: {}", e);
            let err = serde_json::json!({"error": e});
            println!("{}", err);
        }
    }
}
