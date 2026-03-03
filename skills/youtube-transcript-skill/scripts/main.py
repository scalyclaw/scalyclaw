import sys
import json
import re


def extract_video_id(url_or_id: str) -> str:
    """Extract YouTube video ID from a URL or return as-is if already an ID."""
    if len(url_or_id) == 11 and re.match(r"^[a-zA-Z0-9_-]+$", url_or_id):
        return url_or_id

    patterns = [
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/v/)([a-zA-Z0-9_-]{11})",
        r"^([a-zA-Z0-9_-]{11})$",
    ]
    for pattern in patterns:
        match = re.search(pattern, url_or_id)
        if match:
            return match.group(1)

    return url_or_id


def main():
    try:
        data = json.loads(sys.stdin.read())
        video_id = data.get("video_id") or data.get("url")
        if not video_id:
            print(json.dumps({"error": "Missing required field: video_id or url"}))
            return

        language = data.get("language", "en")
        video_id = extract_video_id(video_id)

        sys.stderr.write(f"Fetching transcript for video: {video_id}\n")

        from youtube_transcript_api import YouTubeTranscriptApi

        ytt_api = YouTubeTranscriptApi()
        transcript_data = ytt_api.fetch(video_id, languages=[language])

        transcript = []
        text_parts = []
        for entry in transcript_data:
            segment = {
                "text": entry.text,
                "start": entry.start,
                "duration": entry.duration,
            }
            transcript.append(segment)
            text_parts.append(entry.text)

        result = {
            "transcript": transcript,
            "full_text": " ".join(text_parts),
        }

        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
