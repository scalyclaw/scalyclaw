import { BrowserManager } from "./lib/browser-manager.js";
import { executeAction } from "./lib/actions.js";
import type { BrowserInput, ActionResult, BrowserOutput } from "./lib/types.js";

const totalStart = Date.now();

try {
  const input: BrowserInput = await Bun.stdin.json();

  if (!input.actions || !Array.isArray(input.actions) || input.actions.length === 0) {
    console.log(JSON.stringify({ error: "Missing or empty 'actions' array" }));
    process.exit(0);
  }

  const onError = input.on_error || "abort";
  const humanLike = input.human_like !== false;
  const manager = new BrowserManager(input);

  let results: ActionResult[] = [];

  try {
    await manager.launch();
    const page = manager.getPage();
    const context = manager.getContext();

    for (const action of input.actions) {
      console.error(`Action: ${action.action}`);
      const result = await executeAction(page, context, action, humanLike);
      results.push(result);

      if (!result.success && onError === "abort") {
        console.error(`Aborting: ${result.error}`);
        break;
      }
    }
  } finally {
    await manager.close();
  }

  const output: BrowserOutput = {
    results,
    elapsed_ms: Date.now() - totalStart,
  };

  console.log(JSON.stringify(output));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message, elapsed_ms: Date.now() - totalStart }));
}
