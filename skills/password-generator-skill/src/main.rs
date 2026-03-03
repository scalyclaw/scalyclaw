use rand::Rng;
use serde::{Deserialize, Serialize};
use std::io::{self, Read};

#[derive(Deserialize)]
struct Input {
    #[serde(default = "default_length")]
    length: usize,
    #[serde(default = "default_count")]
    count: usize,
    #[serde(default = "default_true")]
    uppercase: bool,
    #[serde(default = "default_true")]
    lowercase: bool,
    #[serde(default = "default_true")]
    digits: bool,
    #[serde(default = "default_true")]
    symbols: bool,
    exclude_chars: Option<String>,
    custom_symbols: Option<String>,
}

fn default_length() -> usize {
    16
}

fn default_count() -> usize {
    1
}

fn default_true() -> bool {
    true
}

const DEFAULT_SYMBOLS: &str = "!@#$%^&*()-_=+[]{}|;:',.<>?/`~";

#[derive(Serialize)]
struct Output {
    passwords: Vec<String>,
    length: usize,
    charset_size: usize,
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

    if input.length == 0 {
        let err = serde_json::json!({"error": "Password length must be greater than 0"});
        println!("{}", err);
        return;
    }

    if input.count == 0 {
        let err = serde_json::json!({"error": "Password count must be greater than 0"});
        println!("{}", err);
        return;
    }

    // Build the character set
    let mut charset: Vec<char> = Vec::new();

    if input.uppercase {
        charset.extend('A'..='Z');
    }
    if input.lowercase {
        charset.extend('a'..='z');
    }
    if input.digits {
        charset.extend('0'..='9');
    }
    if input.symbols {
        let symbols = if let Some(ref custom) = input.custom_symbols {
            custom.as_str()
        } else {
            DEFAULT_SYMBOLS
        };
        charset.extend(symbols.chars());
    }

    // Remove excluded characters
    if let Some(ref exclude) = input.exclude_chars {
        let exclude_set: std::collections::HashSet<char> = exclude.chars().collect();
        charset.retain(|c| !exclude_set.contains(c));
    }

    // Deduplicate the charset while preserving order
    let mut seen = std::collections::HashSet::new();
    charset.retain(|c| seen.insert(*c));

    if charset.is_empty() {
        let err = serde_json::json!({
            "error": "No characters available in charset. Enable at least one character category or reduce exclusions."
        });
        println!("{}", err);
        return;
    }

    let charset_size = charset.len();

    eprintln!(
        "Generating {} password(s) of length {} from charset of {} characters",
        input.count, input.length, charset_size
    );

    let mut rng = rand::thread_rng();
    let mut passwords: Vec<String> = Vec::with_capacity(input.count);

    for _ in 0..input.count {
        let password: String = (0..input.length)
            .map(|_| {
                let idx = rng.gen_range(0..charset_size);
                charset[idx]
            })
            .collect();
        passwords.push(password);
    }

    let output = Output {
        passwords,
        length: input.length,
        charset_size,
    };

    println!("{}", serde_json::to_string(&output).unwrap());
}
