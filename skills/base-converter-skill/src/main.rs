use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::io::{self, Read};

#[derive(Deserialize)]
struct Input {
    text: String,
    operation: String,
}

#[derive(Serialize)]
struct Output {
    result: String,
    operation: String,
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

    let valid_ops = [
        "base64_encode",
        "base64_decode",
        "hex_encode",
        "hex_decode",
        "url_encode",
        "url_decode",
    ];

    if !valid_ops.contains(&input.operation.as_str()) {
        let err = serde_json::json!({
            "error": format!(
                "Invalid operation '{}'. Must be one of: {}",
                input.operation,
                valid_ops.join(", ")
            )
        });
        println!("{}", err);
        return;
    }

    let result = match input.operation.as_str() {
        "base64_encode" => Ok(general_purpose::STANDARD.encode(input.text.as_bytes())),
        "base64_decode" => match general_purpose::STANDARD.decode(input.text.as_bytes()) {
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(s) => Ok(s),
                Err(e) => Err(format!("Decoded bytes are not valid UTF-8: {}", e)),
            },
            Err(e) => Err(format!("Base64 decode failed: {}", e)),
        },
        "hex_encode" => Ok(hex::encode(input.text.as_bytes())),
        "hex_decode" => match hex::decode(&input.text) {
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(s) => Ok(s),
                Err(e) => Err(format!("Decoded bytes are not valid UTF-8: {}", e)),
            },
            Err(e) => Err(format!("Hex decode failed: {}", e)),
        },
        "url_encode" => Ok(urlencoding::encode(&input.text).into_owned()),
        "url_decode" => match urlencoding::decode(&input.text) {
            Ok(s) => Ok(s.into_owned()),
            Err(e) => Err(format!("URL decode failed: {}", e)),
        },
        _ => Err(format!("Unknown operation: {}", input.operation)),
    };

    match result {
        Ok(result_str) => {
            let output = Output {
                result: result_str,
                operation: input.operation,
            };
            println!("{}", serde_json::to_string(&output).unwrap());
        }
        Err(e) => {
            eprintln!("Operation error: {}", e);
            let err = serde_json::json!({"error": e});
            println!("{}", err);
        }
    }
}
