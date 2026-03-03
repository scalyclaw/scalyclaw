---
name: Text Statistics
description: Analyze text for word count, character count, reading time, readability scores, and word frequency
script: target/release/text-stats-skill
language: rust
install: cargo build --release
timeout: 10
---
# Text Statistics

Analyze text to produce comprehensive statistics including counts, reading/speaking time estimates, readability scores, and word frequency analysis.

## Input

- `text` (string, required): The text to analyze
- `top_words` (int, optional, default 10): Number of top frequent words to return

## Output

- `characters` (int): Total character count
- `characters_no_spaces` (int): Characters excluding whitespace
- `words` (int): Word count
- `sentences` (int): Sentence count
- `paragraphs` (int): Paragraph count
- `lines` (int): Line count
- `avg_word_length` (float): Average word length in characters
- `avg_sentence_length` (float): Average number of words per sentence
- `reading_time_minutes` (float): Estimated reading time at 238 WPM
- `speaking_time_minutes` (float): Estimated speaking time at 150 WPM
- `flesch_reading_ease` (float): Flesch reading ease score
- `top_words` (array): Most frequent words as `{ word, count }`, excluding common stop words

## Examples

```json
{ "text": "The quick brown fox jumps over the lazy dog. The dog barked loudly." }
```

With custom top words count:
```json
{ "text": "Long text here...", "top_words": 20 }
```

## Notes

- Flesch reading ease formula: 206.835 - 1.015 * (words/sentences) - 84.6 * (syllables/words)
- Syllable counting uses a simple heuristic based on vowel groups
- Common stop words (the, a, an, is, etc.) are excluded from the top words list
