import QRCode from "qrcode";
import { Jimp } from "jimp";
import jsQR from "jsqr";
import { join } from "path";

try {
  const data = await Bun.stdin.json();
  const action: string = data.action;

  if (!action || !["generate", "decode"].includes(action)) {
    throw new Error("Parameter 'action' must be 'generate' or 'decode'");
  }

  const workspaceDir = process.env.WORKSPACE_DIR || "/tmp";

  if (action === "generate") {
    const text: string = data.text;
    if (!text) throw new Error("Missing required parameter: text (for generate action)");

    const outputFilename = data.output_filename || "qrcode.png";
    const outputPath = join(workspaceDir, outputFilename.endsWith(".png") ? outputFilename : `${outputFilename}.png`);

    console.error(`Generating QR code for text (${text.length} chars)`);

    await QRCode.toFile(outputPath, text, {
      type: "png",
      width: 400,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });

    console.error(`QR code saved to: ${outputPath}`);
    console.log(JSON.stringify({ file_path: outputPath }));
  } else {
    const filePath: string = data.file_path;
    if (!filePath) throw new Error("Missing required parameter: file_path (for decode action)");

    console.error(`Decoding QR code from: ${filePath}`);

    const image = await Jimp.read(filePath);
    const width = image.width;
    const height = image.height;
    const bitmap = image.bitmap;

    const imageData = new Uint8ClampedArray(bitmap.data);
    const code = jsQR(imageData, width, height);

    if (!code) {
      throw new Error("No QR code found in the image");
    }

    console.error(`Decoded QR code: ${code.data.substring(0, 50)}...`);
    console.log(JSON.stringify({ text: code.data }));
  }
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
