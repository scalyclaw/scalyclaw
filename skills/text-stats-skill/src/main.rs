use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, Read};

#[derive(Deserialize)]
struct Input {
    text: String,
    top_words: Option<usize>,
}

#[derive(Serialize)]
struct Output {
    characters: usize,
    characters_no_spaces: usize,
    words: usize,
    sentences: usize,
    paragraphs: usize,
    lines: usize,
    avg_word_length: f64,
    avg_sentence_length: f64,
    reading_time_minutes: f64,
    speaking_time_minutes: f64,
    flesch_reading_ease: f64,
    top_words: Vec<WordFreq>,
}

#[derive(Serialize)]
struct WordFreq {
    word: String,
    count: usize,
}

const STOP_WORDS: &[&str] = &[
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
    "from", "is", "was", "are", "were", "be", "been", "being", "have", "has", "had", "do",
    "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall", "it",
    "its", "this", "that", "these", "those", "i", "you", "he", "she", "we", "they", "me", "him",
    "her", "us", "them", "my", "your", "his", "our", "their", "not", "no", "so", "if", "as",
];

fn count_syllables(word: &str) -> usize {
    let word = word.to_lowercase();
    if word.is_empty() {
        return 1;
    }

    let vowels = ['a', 'e', 'i', 'o', 'u', 'y'];
    let chars: Vec<char> = word.chars().collect();
    let mut syllable_count: usize = 0;
    let mut prev_is_vowel = false;

    for &ch in &chars {
        let is_vowel = vowels.contains(&ch);
        if is_vowel && !prev_is_vowel {
            syllable_count += 1;
        }
        prev_is_vowel = is_vowel;
    }

    // If word ends with 'e', subtract 1 (silent e) unless word ends with 'le' after a consonant
    if chars.len() >= 2 && chars[chars.len() - 1] == 'e' {
        if chars.len() >= 3 && chars[chars.len() - 2] == 'l' {
            // Ends with "le" — check if character before 'l' is a consonant
            let before_l = chars[chars.len() - 3];
            if vowels.contains(&before_l) {
                // Vowel before 'le', subtract for silent e
                if syllable_count > 1 {
                    syllable_count -= 1;
                }
            }
            // Consonant before 'le' — don't subtract (the 'le' is its own syllable)
        } else {
            // Ends with 'e' but not 'le' — subtract for silent e
            if syllable_count > 1 {
                syllable_count -= 1;
            }
        }
    }

    if syllable_count == 0 {
        syllable_count = 1;
    }

    syllable_count
}

fn extract_words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| !w.is_empty() && w.chars().any(|c| c.is_alphabetic()))
        .map(|w| w.to_string())
        .collect()
}

fn count_sentences(text: &str) -> usize {
    let mut count = 0;
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        if chars[i] == '.' || chars[i] == '!' || chars[i] == '?' {
            count += 1;
            // Skip consecutive sentence-ending punctuation (e.g., "..." or "?!")
            while i < chars.len()
                && (chars[i] == '.' || chars[i] == '!' || chars[i] == '?')
            {
                i += 1;
            }
        } else {
            i += 1;
        }
    }

    // If there's text but no sentence-ending punctuation, count as 1
    if count == 0 && !text.trim().is_empty() {
        count = 1;
    }

    count
}

fn count_paragraphs(text: &str) -> usize {
    if text.trim().is_empty() {
        return 0;
    }

    text.split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .count()
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

    let text = &data.text;
    let top_n = data.top_words.unwrap_or(10);

    // Basic counts
    let characters = text.chars().count();
    let characters_no_spaces = text.chars().filter(|c| !c.is_whitespace()).count();
    let lines = if text.is_empty() {
        0
    } else {
        text.lines().count()
    };
    let sentences = count_sentences(text);
    let paragraphs = count_paragraphs(text);

    // Word analysis
    let words = extract_words(text);
    let word_count = words.len();

    let avg_word_length = if word_count > 0 {
        let total_len: usize = words.iter().map(|w| w.len()).sum();
        total_len as f64 / word_count as f64
    } else {
        0.0
    };

    let avg_sentence_length = if sentences > 0 {
        word_count as f64 / sentences as f64
    } else {
        0.0
    };

    // Reading and speaking time
    let reading_time_minutes = if word_count > 0 {
        word_count as f64 / 238.0
    } else {
        0.0
    };

    let speaking_time_minutes = if word_count > 0 {
        word_count as f64 / 150.0
    } else {
        0.0
    };

    // Syllable count for Flesch score
    let total_syllables: usize = words.iter().map(|w| count_syllables(w)).sum();

    let flesch_reading_ease = if word_count > 0 && sentences > 0 {
        206.835
            - 1.015 * (word_count as f64 / sentences as f64)
            - 84.6 * (total_syllables as f64 / word_count as f64)
    } else {
        0.0
    };

    // Word frequency (excluding stop words)
    let mut freq: HashMap<String, usize> = HashMap::new();
    for word in &words {
        let lower = word.to_lowercase();
        if !STOP_WORDS.contains(&lower.as_str()) && lower.len() > 1 {
            *freq.entry(lower).or_insert(0) += 1;
        }
    }

    let mut freq_vec: Vec<(String, usize)> = freq.into_iter().collect();
    freq_vec.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    freq_vec.truncate(top_n);

    let top_words: Vec<WordFreq> = freq_vec
        .into_iter()
        .map(|(word, count)| WordFreq { word, count })
        .collect();

    // Round floats to 2 decimal places
    let round2 = |v: f64| (v * 100.0).round() / 100.0;

    let output = Output {
        characters,
        characters_no_spaces,
        words: word_count,
        sentences,
        paragraphs,
        lines,
        avg_word_length: round2(avg_word_length),
        avg_sentence_length: round2(avg_sentence_length),
        reading_time_minutes: round2(reading_time_minutes),
        speaking_time_minutes: round2(speaking_time_minutes),
        flesch_reading_ease: round2(flesch_reading_ease),
        top_words,
    };

    println!("{}", serde_json::to_string(&output).unwrap());
}
