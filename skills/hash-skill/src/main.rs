use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, Read};

use blake3;
use hex;
use md5::{Digest as Md5Digest, Md5};
use sha2::{Digest, Sha256, Sha512};

#[derive(Deserialize)]
struct Input {
    text: Option<String>,
    file_path: Option<String>,
    #[serde(default = "default_algorithm")]
    algorithm: String,
}

fn default_algorithm() -> String {
    "all".to_string()
}

#[derive(Serialize)]
struct Output {
    hashes: HashMap<String, String>,
    algorithm: String,
    input_size: usize,
}

fn hash_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn hash_sha512(data: &[u8]) -> String {
    let mut hasher = Sha512::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn hash_blake3(data: &[u8]) -> String {
    let hash = blake3::hash(data);
    hash.to_hex().to_string()
}

fn hash_md5(data: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
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

    // Determine the data to hash
    let data: Vec<u8> = if let Some(ref fp) = input.file_path {
        match std::fs::read(fp) {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("Error reading file '{}': {}", fp, e);
                let err = serde_json::json!({"error": format!("Failed to read file '{}': {}", fp, e)});
                println!("{}", err);
                return;
            }
        }
    } else if let Some(ref text) = input.text {
        text.as_bytes().to_vec()
    } else {
        let err = serde_json::json!({"error": "Either 'text' or 'file_path' must be provided"});
        println!("{}", err);
        return;
    };

    let input_size = data.len();
    let algorithm = input.algorithm.to_lowercase();

    let valid_algorithms = ["sha256", "sha512", "blake3", "md5", "all"];
    if !valid_algorithms.contains(&algorithm.as_str()) {
        let err = serde_json::json!({
            "error": format!("Invalid algorithm '{}'. Must be one of: sha256, sha512, blake3, md5, all", algorithm)
        });
        println!("{}", err);
        return;
    }

    let mut hashes = HashMap::new();

    if algorithm == "all" || algorithm == "sha256" {
        hashes.insert("sha256".to_string(), hash_sha256(&data));
    }
    if algorithm == "all" || algorithm == "sha512" {
        hashes.insert("sha512".to_string(), hash_sha512(&data));
    }
    if algorithm == "all" || algorithm == "blake3" {
        hashes.insert("blake3".to_string(), hash_blake3(&data));
    }
    if algorithm == "all" || algorithm == "md5" {
        hashes.insert("md5".to_string(), hash_md5(&data));
    }

    let output = Output {
        hashes,
        algorithm,
        input_size,
    };

    println!("{}", serde_json::to_string(&output).unwrap());
}
