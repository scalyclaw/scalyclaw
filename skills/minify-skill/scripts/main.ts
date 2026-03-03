import { minify as terserMinify } from "terser";
import prettier from "prettier";
import CleanCSS from "clean-css";
import { minify as htmlMinify } from "html-minifier-terser";

async function minifyJS(code: string): Promise<string> {
  const result = await terserMinify(code, {
    compress: true,
    mangle: true,
    output: { comments: false },
  });
  if (!result.code) throw new Error("Terser returned empty result");
  return result.code;
}

async function beautifyJS(code: string): Promise<string> {
  return prettier.format(code, {
    parser: "babel",
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    trailingComma: "all",
    printWidth: 80,
  });
}

function minifyCSS(code: string): string {
  const output = new CleanCSS({
    level: 2,
    returnPromise: false,
  }).minify(code);
  if (output.errors && output.errors.length > 0) {
    throw new Error(`CSS minification errors: ${output.errors.join(", ")}`);
  }
  return output.styles;
}

async function beautifyCSS(code: string): Promise<string> {
  return prettier.format(code, {
    parser: "css",
    tabWidth: 2,
    printWidth: 80,
  });
}

async function minifyHTML(code: string): Promise<string> {
  return htmlMinify(code, {
    collapseWhitespace: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeEmptyAttributes: true,
    minifyCSS: true,
    minifyJS: true,
    collapseBooleanAttributes: true,
  });
}

async function beautifyHTML(code: string): Promise<string> {
  return prettier.format(code, {
    parser: "html",
    tabWidth: 2,
    printWidth: 80,
  });
}

function minifyJSON(code: string): string {
  const parsed = JSON.parse(code);
  return JSON.stringify(parsed);
}

function beautifyJSON(code: string): string {
  const parsed = JSON.parse(code);
  return JSON.stringify(parsed, null, 2);
}

try {
  const data = await Bun.stdin.json();
  const code: string = data.code;
  const language: string = (data.language || "").toLowerCase();
  const action: string = (data.action || "").toLowerCase();

  if (!code) throw new Error("Missing required parameter: code");
  if (!language) throw new Error("Missing required parameter: language");
  if (!action) throw new Error("Missing required parameter: action");

  const validLanguages = ["js", "css", "html", "json"];
  if (!validLanguages.includes(language)) {
    throw new Error(`Invalid language: ${language}. Must be one of: ${validLanguages.join(", ")}`);
  }

  const validActions = ["minify", "beautify"];
  if (!validActions.includes(action)) {
    throw new Error(`Invalid action: ${action}. Must be 'minify' or 'beautify'`);
  }

  console.error(`${action === "minify" ? "Minifying" : "Beautifying"} ${language.toUpperCase()} (${code.length} chars)`);

  let resultCode: string;

  if (action === "minify") {
    switch (language) {
      case "js":
        resultCode = await minifyJS(code);
        break;
      case "css":
        resultCode = minifyCSS(code);
        break;
      case "html":
        resultCode = await minifyHTML(code);
        break;
      case "json":
        resultCode = minifyJSON(code);
        break;
      default:
        throw new Error(`Unsupported language: ${language}`);
    }
  } else {
    switch (language) {
      case "js":
        resultCode = await beautifyJS(code);
        break;
      case "css":
        resultCode = await beautifyCSS(code);
        break;
      case "html":
        resultCode = await beautifyHTML(code);
        break;
      case "json":
        resultCode = beautifyJSON(code);
        break;
      default:
        throw new Error(`Unsupported language: ${language}`);
    }
  }

  const originalSize = new TextEncoder().encode(code).length;
  const resultSize = new TextEncoder().encode(resultCode).length;
  const savingsPercent = originalSize > 0 ? Math.round(((originalSize - resultSize) / originalSize) * 10000) / 100 : 0;

  console.error(`Result: ${originalSize} -> ${resultSize} bytes (${savingsPercent}% ${action === "minify" ? "savings" : "change"})`);

  console.log(
    JSON.stringify({
      result: resultCode,
      original_size: originalSize,
      result_size: resultSize,
      savings_percent: savingsPercent,
    })
  );
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
