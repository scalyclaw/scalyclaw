import sys
import json
import os


def main():
    try:
        data = json.loads(sys.stdin.read())
        file_path = data.get("file_path")
        model_size = data.get("model", "base")
        language = data.get("language")
        include_timestamps = data.get("timestamps", False)

        if not file_path:
            print(json.dumps({"error": "Missing required field: file_path"}))
            return

        if not os.path.isfile(file_path):
            print(json.dumps({"error": f"File not found: {file_path}"}))
            return

        valid_models = ("tiny", "base", "small", "medium", "large")
        if model_size not in valid_models:
            print(
                json.dumps(
                    {
                        "error": f"Invalid model: {model_size}. "
                        f"Must be one of: {', '.join(valid_models)}"
                    }
                )
            )
            return

        import whisper

        sys.stderr.write(f"Loading Whisper model: {model_size}\n")
        model = whisper.load_model(model_size)

        sys.stderr.write(f"Transcribing: {file_path}\n")

        # Build transcribe options
        transcribe_opts = {}
        if language:
            transcribe_opts["language"] = language

        result = model.transcribe(file_path, **transcribe_opts)

        text = result.get("text", "").strip()
        detected_language = result.get("language", "unknown")
        segments = result.get("segments", [])

        # Calculate duration from last segment end time
        duration = 0.0
        if segments:
            duration = segments[-1].get("end", 0.0)

        sys.stderr.write(
            f"Transcription complete: {len(text)} chars, "
            f"language={detected_language}, duration={duration:.1f}s\n"
        )

        output = {
            "text": text,
            "language": detected_language,
            "duration": round(duration, 2),
        }

        # Include segment timestamps if requested
        if include_timestamps:
            output["segments"] = [
                {
                    "start": round(seg.get("start", 0.0), 2),
                    "end": round(seg.get("end", 0.0), 2),
                    "text": seg.get("text", "").strip(),
                }
                for seg in segments
            ]

        print(json.dumps(output))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
