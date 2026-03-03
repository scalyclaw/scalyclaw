import sys
import json
import re


SUPPORTED_LANGUAGES = {"en", "es", "fr", "de", "pt"}


def find_word_positions(text, target_word):
    """Find all character offsets of a word in text (case-insensitive whole-word match)."""
    positions = []
    pattern = re.compile(r"\b" + re.escape(target_word) + r"\b", re.IGNORECASE)
    for match in pattern.finditer(text):
        positions.append(match.start())
    return positions


def match_case(original, replacement):
    """Preserve the case pattern of the original word in the replacement."""
    if not replacement:
        return replacement

    if original.isupper():
        return replacement.upper()
    if original.islower():
        return replacement.lower()
    if original and original[0].isupper() and original[1:].islower():
        return replacement[0].upper() + replacement[1:].lower() if len(replacement) > 1 else replacement.upper()

    return replacement


def check_spelling(text, language, auto_correct):
    from spellchecker import SpellChecker

    spell = SpellChecker(language=language)

    words = re.findall(r"\b[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]+\b", text)
    word_count = len(words)

    unique_words = set(words)
    unknown = spell.unknown(unique_words)

    misspelled_entries = []
    seen_words = set()

    for word in words:
        word_lower = word.lower()
        if word_lower in seen_words:
            continue
        if word_lower in unknown or word in unknown:
            seen_words.add(word_lower)
            candidates = spell.candidates(word_lower)
            suggestions = sorted(candidates) if candidates else []
            positions = find_word_positions(text, word)

            for pos in positions:
                misspelled_entries.append({
                    "word": word,
                    "suggestions": suggestions[:10],
                    "position": pos,
                })

    misspelled_entries.sort(key=lambda e: e["position"])

    result = {
        "misspelled": misspelled_entries,
        "misspelled_count": len(misspelled_entries),
        "word_count": word_count,
    }

    if auto_correct:
        corrected = text
        offset = 0

        for entry in misspelled_entries:
            original_word = entry["word"]
            correction = spell.correction(original_word.lower())
            if correction and correction != original_word.lower():
                case_matched = match_case(original_word, correction)
                pos = entry["position"] + offset
                end = pos + len(original_word)

                if corrected[pos:end].lower() == original_word.lower():
                    corrected = corrected[:pos] + case_matched + corrected[end:]
                    offset += len(case_matched) - len(original_word)

        result["corrected_text"] = corrected

    return result


def main():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(1)

    text = data.get("text")
    if not text or not isinstance(text, str):
        print(json.dumps({"error": "'text' is required and must be a string"}))
        sys.exit(1)

    language = data.get("language", "en")
    if language not in SUPPORTED_LANGUAGES:
        print(json.dumps({
            "error": f"Unsupported language '{language}'. Supported: {', '.join(sorted(SUPPORTED_LANGUAGES))}"
        }))
        sys.exit(1)

    auto_correct = bool(data.get("auto_correct", False))

    try:
        result = check_spelling(text, language, auto_correct)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": f"Spell check failed: {e}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
