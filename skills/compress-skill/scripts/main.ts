import * as tar from "tar";
import { statSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, basename, resolve, relative } from "node:path";

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();

function collectFiles(basePath: string): string[] {
  const files: string[] = [];
  const stat = statSync(basePath);

  if (stat.isFile()) {
    files.push(basePath);
  } else if (stat.isDirectory()) {
    const entries = readdirSync(basePath, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const parentPath = entry.parentPath || (entry as any).path || basePath;
        files.push(join(parentPath, entry.name));
      }
    }
  }

  return files;
}

async function compressZip(filePaths: string[], outputFilename?: string): Promise<any> {
  const outputName = outputFilename || "archive.zip";
  const outputPath = join(WORKSPACE_DIR, outputName);

  // Resolve all file paths relative to WORKSPACE_DIR
  const resolvedPaths = filePaths.map((p) =>
    p.startsWith("/") ? p : join(WORKSPACE_DIR, p)
  );

  // Validate all paths exist
  for (const p of resolvedPaths) {
    if (!existsSync(p)) {
      throw new Error(`File or directory not found: ${p}`);
    }
  }

  // Compute relative paths for zip
  const relativePaths = resolvedPaths.map((p) => relative(WORKSPACE_DIR, p));

  const proc = Bun.spawn(["zip", "-r", outputPath, ...relativePaths], {
    cwd: WORKSPACE_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`zip command failed (exit ${exitCode}): ${stderr}`);
  }

  // Count files and get size
  let fileCount = 0;
  for (const p of resolvedPaths) {
    const collected = collectFiles(p);
    fileCount += collected.length;
  }

  const archiveStat = statSync(outputPath);

  return {
    file_path: outputPath,
    file_count: fileCount,
    total_size: archiveStat.size,
  };
}

async function compressTarGz(filePaths: string[], outputFilename?: string): Promise<any> {
  const outputName = outputFilename || "archive.tar.gz";
  const outputPath = join(WORKSPACE_DIR, outputName);

  // Resolve all file paths relative to WORKSPACE_DIR
  const resolvedPaths = filePaths.map((p) =>
    p.startsWith("/") ? p : join(WORKSPACE_DIR, p)
  );

  // Validate all paths exist
  for (const p of resolvedPaths) {
    if (!existsSync(p)) {
      throw new Error(`File or directory not found: ${p}`);
    }
  }

  // Compute relative paths for tar
  const relativePaths = resolvedPaths.map((p) => relative(WORKSPACE_DIR, p));

  await tar.create(
    {
      gzip: true,
      file: outputPath,
      cwd: WORKSPACE_DIR,
    },
    relativePaths
  );

  // Count files and get size
  let fileCount = 0;
  for (const p of resolvedPaths) {
    const collected = collectFiles(p);
    fileCount += collected.length;
  }

  const archiveStat = statSync(outputPath);

  return {
    file_path: outputPath,
    file_count: fileCount,
    total_size: archiveStat.size,
  };
}

async function extractZip(filePath: string, outputDir: string): Promise<any> {
  const resolvedPath = filePath.startsWith("/") ? filePath : join(WORKSPACE_DIR, filePath);
  const resolvedOutput = outputDir.startsWith("/") ? outputDir : join(WORKSPACE_DIR, outputDir);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Archive not found: ${resolvedPath}`);
  }

  if (!existsSync(resolvedOutput)) {
    mkdirSync(resolvedOutput, { recursive: true });
  }

  const proc = Bun.spawn(["unzip", "-o", resolvedPath, "-d", resolvedOutput], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`unzip command failed (exit ${exitCode}): ${stderr}`);
  }

  // List extracted files
  const files: string[] = [];
  const entries = readdirSync(resolvedOutput, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const parentPath = entry.parentPath || (entry as any).path || resolvedOutput;
      files.push(relative(resolvedOutput, join(parentPath, entry.name)));
    }
  }

  return {
    output_dir: resolvedOutput,
    files,
    file_count: files.length,
  };
}

async function extractTarGz(filePath: string, outputDir: string): Promise<any> {
  const resolvedPath = filePath.startsWith("/") ? filePath : join(WORKSPACE_DIR, filePath);
  const resolvedOutput = outputDir.startsWith("/") ? outputDir : join(WORKSPACE_DIR, outputDir);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Archive not found: ${resolvedPath}`);
  }

  if (!existsSync(resolvedOutput)) {
    mkdirSync(resolvedOutput, { recursive: true });
  }

  await tar.extract({
    file: resolvedPath,
    cwd: resolvedOutput,
  });

  // List extracted files
  const files: string[] = [];
  const entries = readdirSync(resolvedOutput, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const parentPath = entry.parentPath || (entry as any).path || resolvedOutput;
      files.push(relative(resolvedOutput, join(parentPath, entry.name)));
    }
  }

  return {
    output_dir: resolvedOutput,
    files,
    file_count: files.length,
  };
}

function detectFormat(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  if (lower.endsWith(".zip")) return "zip";
  return "zip"; // default
}

try {
  const input = await Bun.stdin.json();
  const action: string = input.action;

  if (!action) {
    throw new Error('Missing required parameter: action ("compress" or "extract")');
  }

  let result: any;

  switch (action) {
    case "compress": {
      const filePaths: string[] = input.file_paths;
      const format: string = input.format || "zip";
      const outputFilename: string | undefined = input.output_filename;

      if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
        throw new Error("Missing required parameter: file_paths (array of file/directory paths)");
      }

      console.error(`Compressing ${filePaths.length} path(s) as ${format}`);

      if (format === "tar.gz" || format === "tgz") {
        result = await compressTarGz(filePaths, outputFilename);
      } else if (format === "zip") {
        result = await compressZip(filePaths, outputFilename);
      } else {
        throw new Error(`Unsupported format: ${format}. Use "zip" or "tar.gz".`);
      }
      break;
    }
    case "extract": {
      const filePath: string = input.file_path;
      const outputDir: string = input.output_dir || WORKSPACE_DIR;

      if (!filePath) {
        throw new Error("Missing required parameter: file_path");
      }

      const format = detectFormat(filePath);
      console.error(`Extracting ${format} archive: ${filePath}`);

      if (format === "tar.gz") {
        result = await extractTarGz(filePath, outputDir);
      } else {
        result = await extractZip(filePath, outputDir);
      }
      break;
    }
    default:
      throw new Error(`Unknown action: ${action}. Use "compress" or "extract".`);
  }

  console.log(JSON.stringify(result));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
