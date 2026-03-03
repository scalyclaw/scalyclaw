import sys
import json
import os


def main():
    try:
        data = json.loads(sys.stdin.read())
        file_path = data.get("file_path")
        operation = data.get("operation")
        params = data.get("params", {})

        if not file_path:
            print(json.dumps({"error": "Missing required field: file_path"}))
            return
        if not operation:
            print(json.dumps({"error": "Missing required field: operation"}))
            return

        valid_ops = ("resize", "crop", "rotate", "convert", "watermark")
        if operation not in valid_ops:
            print(json.dumps({"error": f"Invalid operation: {operation}. Must be one of: {', '.join(valid_ops)}"}))
            return

        from PIL import Image, ImageDraw, ImageFont

        workspace = os.environ.get("WORKSPACE_DIR", ".")
        img = Image.open(file_path)
        original_format = img.format or os.path.splitext(file_path)[1].lstrip(".").upper()
        output_format = original_format

        sys.stderr.write(f"Processing image: {file_path} (operation: {operation})\n")

        if operation == "resize":
            width = params.get("width")
            height = params.get("height")
            if not width or not height:
                print(json.dumps({"error": "resize requires params.width and params.height"}))
                return
            img = img.resize((width, height), Image.LANCZOS)

        elif operation == "crop":
            box = params.get("box")
            if not box or len(box) != 4:
                print(json.dumps({"error": "crop requires params.box as [left, top, right, bottom]"}))
                return
            img = img.crop(tuple(box))

        elif operation == "rotate":
            angle = params.get("angle")
            if angle is None:
                print(json.dumps({"error": "rotate requires params.angle"}))
                return
            img = img.rotate(angle, expand=True)

        elif operation == "convert":
            target_format = params.get("format", "").upper()
            valid_formats = ("PNG", "JPEG", "WEBP", "BMP", "GIF")
            if target_format not in valid_formats:
                print(json.dumps({"error": f"Invalid format: {target_format}. Must be one of: {', '.join(valid_formats)}"}))
                return
            output_format = target_format
            if target_format == "JPEG" and img.mode in ("RGBA", "P"):
                img = img.convert("RGB")

        elif operation == "watermark":
            text = params.get("text")
            if not text:
                print(json.dumps({"error": "watermark requires params.text"}))
                return
            draw = ImageDraw.Draw(img)
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
            except (IOError, OSError):
                try:
                    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 24)
                except (IOError, OSError):
                    font = ImageFont.load_default()

            bbox = draw.textbbox((0, 0), text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
            x = img.width - text_width - 10
            y = img.height - text_height - 10
            draw.text((x + 1, y + 1), text, fill=(0, 0, 0, 128), font=font)
            draw.text((x, y), text, fill=(255, 255, 255, 200), font=font)

        # Determine output path
        format_to_ext = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp", "BMP": "bmp", "GIF": "gif"}
        ext = format_to_ext.get(output_format, output_format.lower())
        default_filename = f"processed.{ext}"
        output_filename = data.get("output_filename", default_filename)
        output_path = os.path.join(workspace, output_filename)

        save_format = output_format if output_format != "JPG" else "JPEG"
        img.save(output_path, format=save_format)

        sys.stderr.write(f"Image saved to: {output_path}\n")
        result = {
            "file_path": output_path,
            "width": img.width,
            "height": img.height,
            "format": output_format,
        }

        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
