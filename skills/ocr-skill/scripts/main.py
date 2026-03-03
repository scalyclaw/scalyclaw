import sys
import json
import os


def main():
    try:
        data = json.loads(sys.stdin.read())
        file_path = data.get("file_path")
        language = data.get("language", "eng")
        psm = data.get("psm", 3)

        if not file_path:
            print(json.dumps({"error": "Missing required field: file_path"}))
            return

        if not os.path.isfile(file_path):
            print(json.dumps({"error": f"File not found: {file_path}"}))
            return

        from PIL import Image, ImageOps
        import pytesseract
        from pytesseract import Output

        sys.stderr.write(f"Opening image: {file_path}\n")

        img = Image.open(file_path)

        # Auto-rotate based on EXIF orientation
        img = ImageOps.exif_transpose(img)

        # Convert to RGB if needed (e.g. RGBA, P, L modes)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        # Build tesseract config
        custom_config = f"--psm {psm}"

        sys.stderr.write(f"Running OCR with language={language}, psm={psm}\n")

        # Extract text
        text = pytesseract.image_to_string(img, lang=language, config=custom_config)

        # Extract detailed data for confidence scoring
        ocr_data = pytesseract.image_to_data(
            img, lang=language, config=custom_config, output_type=Output.DICT
        )

        # Calculate average confidence from valid entries only
        # Filter: non-negative confidence and non-empty text
        valid_confidences = []
        for i, conf in enumerate(ocr_data["conf"]):
            conf_val = int(conf)
            word = ocr_data["text"][i].strip()
            if conf_val >= 0 and word:
                valid_confidences.append(conf_val)

        avg_confidence = (
            sum(valid_confidences) / len(valid_confidences)
            if valid_confidences
            else 0.0
        )

        # Count lines and words from the extracted text
        lines = [line for line in text.strip().split("\n") if line.strip()]
        line_count = len(lines)
        word_count = len(text.split()) if text.strip() else 0

        sys.stderr.write(
            f"OCR complete: {word_count} words, {line_count} lines, "
            f"confidence={avg_confidence:.1f}\n"
        )

        result = {
            "text": text.strip(),
            "confidence": round(avg_confidence, 2),
            "line_count": line_count,
            "word_count": word_count,
        }

        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
