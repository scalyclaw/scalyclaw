import sys
import json


def main():
    try:
        data = json.loads(sys.stdin.read())
        text = data.get("text")
        target = data.get("target")

        if not text:
            print(json.dumps({"error": "Missing required field: text"}))
            return
        if not target:
            print(json.dumps({"error": "Missing required field: target"}))
            return

        source = data.get("source", "auto")

        from deep_translator import GoogleTranslator

        sys.stderr.write(f"Translating from '{source}' to '{target}'\n")
        translator = GoogleTranslator(source=source, target=target)
        translated = translator.translate(text)

        result = {
            "translated_text": translated,
            "source_language": source,
            "target_language": target,
        }

        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
