import { chromium } from "playwright";
import { join } from "path";

try {
  const input = await Bun.stdin.json();
  const html: string | undefined = input.html;
  const outputFilename: string = input.output_filename || "output.pdf";
  const workspaceDir = process.env.WORKSPACE_DIR || "/tmp";

  if (!html) {
    console.log(JSON.stringify({ error: "Missing required field: html" }));
    process.exit(0);
  }

  const outputPath = join(
    workspaceDir,
    outputFilename.endsWith(".pdf") ? outputFilename : `${outputFilename}.pdf`
  );

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });

  await page.pdf({
    path: outputPath,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });

  await browser.close();

  console.error(`PDF written to: ${outputPath}`);
  console.log(JSON.stringify({ file_path: outputPath }));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
