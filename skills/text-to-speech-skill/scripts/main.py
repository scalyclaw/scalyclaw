import sys
import json
import os
import asyncio


async def generate_speech(text: str, voice: str, output_path: str):
    import edge_tts

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)


def main():
    try:
        data = json.loads(sys.stdin.read())
        text = data.get("text")
        if not text:
            print(json.dumps({"error": "Missing required field: text"}))
            return

        voice = data.get("voice", "en-US-AriaNeural")
        output_filename = data.get("output_filename", "output.mp3")

        workspace = os.environ.get("WORKSPACE_DIR", ".")
        output_path = os.path.join(workspace, output_filename)

        sys.stderr.write(f"Generating speech with voice: {voice}\n")
        asyncio.run(generate_speech(text, voice, output_path))

        sys.stderr.write(f"Audio saved to: {output_path}\n")
        print(json.dumps({"file_path": output_path}))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
