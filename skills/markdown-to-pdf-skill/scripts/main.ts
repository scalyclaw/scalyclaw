import { mdToPdf } from "md-to-pdf";
import { join } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";

try {
  const data = await Bun.stdin.json();
  const markdown: string | undefined = data.markdown;
  const filePath: string | undefined = data.file_path;
  const outputFilename: string = data.output_filename || "output.pdf";
  const workspaceDir = process.env.WORKSPACE_DIR || "/tmp";

  if (!markdown && !filePath) {
    throw new Error("Either 'markdown' or 'file_path' must be provided");
  }

  let mdContent: string;

  if (filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    mdContent = readFileSync(filePath, "utf-8");
    console.error(`Read markdown from file: ${filePath}`);
  } else {
    mdContent = markdown!;
    console.error(`Converting markdown content (${mdContent.length} chars)`);
  }

  const outputPath = join(workspaceDir, outputFilename.endsWith(".pdf") ? outputFilename : `${outputFilename}.pdf`);

  const pdf = await mdToPdf(
    { content: mdContent },
    {
      dest: outputPath,
      launch_options: {
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    }
  );

  if (pdf.content) {
    writeFileSync(outputPath, pdf.content);
  }

  console.error(`PDF written to: ${outputPath}`);
  console.log(JSON.stringify({ file_path: outputPath }));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
