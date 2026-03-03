use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::io::{self, Read};

#[derive(Deserialize)]
struct Input {
    pattern: String,
    text: String,
    flags: Option<String>,
    replace: Option<String>,
}

#[derive(Serialize)]
struct Output {
    is_match: bool,
    match_count: usize,
    matches: Vec<MatchResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    replaced: Option<String>,
}

#[derive(Serialize)]
struct MatchResult {
    text: String,
    start: usize,
    end: usize,
    groups: Vec<GroupResult>,
}

#[derive(Serialize)]
struct GroupResult {
    text: Option<String>,
    start: Option<usize>,
    end: Option<usize>,
    name: Option<String>,
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

    // Parse flags
    let flags = data.flags.as_deref().unwrap_or("");
    let case_insensitive = flags.contains('i');
    let multi_line = flags.contains('m');
    let dot_matches_new_line = flags.contains('s');

    // Build regex
    let regex = match RegexBuilder::new(&data.pattern)
        .case_insensitive(case_insensitive)
        .multi_line(multi_line)
        .dot_matches_new_line(dot_matches_new_line)
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            println!(
                "{}",
                serde_json::json!({"error": format!("Invalid regex pattern: {}", e)})
            );
            return;
        }
    };

    // Collect capture group names
    let group_names: Vec<Option<String>> = regex
        .capture_names()
        .map(|n| n.map(|s| s.to_string()))
        .collect();

    // Find all matches with capture groups
    let mut matches: Vec<MatchResult> = Vec::new();
    let mut match_count: usize = 0;
    const MAX_MATCHES: usize = 1000;

    for caps in regex.captures_iter(&data.text) {
        if match_count >= MAX_MATCHES {
            break;
        }
        match_count += 1;

        let full_match = caps.get(0).unwrap();
        let mut groups: Vec<GroupResult> = Vec::new();

        // Capture groups start at index 1
        for i in 1..caps.len() {
            let group = caps.get(i);
            let name = group_names.get(i).and_then(|n| n.clone());
            groups.push(GroupResult {
                text: group.map(|m| m.as_str().to_string()),
                start: group.map(|m| m.start()),
                end: group.map(|m| m.end()),
                name,
            });
        }

        matches.push(MatchResult {
            text: full_match.as_str().to_string(),
            start: full_match.start(),
            end: full_match.end(),
            groups,
        });
    }

    let is_match = !matches.is_empty();

    // Handle replacement if requested
    let replaced = data.replace.map(|replacement| {
        regex.replace_all(&data.text, replacement.as_str()).to_string()
    });

    let output = Output {
        is_match,
        match_count,
        matches,
        replaced,
    };

    println!("{}", serde_json::to_string(&output).unwrap());
}
