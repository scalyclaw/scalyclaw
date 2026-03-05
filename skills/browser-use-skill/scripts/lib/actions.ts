import type { Page, BrowserContext } from "playwright";
import { join } from "path";
import type { Action, ActionResult } from "./types.js";
import { humanClick, humanType, humanMouseMove, humanScroll } from "./human.js";

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/tmp";

export async function executeAction(
  page: Page,
  context: BrowserContext,
  action: Action,
  humanLike: boolean,
): Promise<ActionResult> {
  const start = Date.now();
  try {
    const data = await dispatch(page, context, action, humanLike);
    return { action: action.action, success: true, data, elapsed_ms: Date.now() - start };
  } catch (err: any) {
    return { action: action.action, success: false, error: err.message, elapsed_ms: Date.now() - start };
  }
}

async function dispatch(
  page: Page,
  context: BrowserContext,
  action: Action,
  humanLike: boolean,
): Promise<any> {
  switch (action.action) {
    case "navigate":
      return handleNavigate(page, action);
    case "click":
      return handleClick(page, action, humanLike);
    case "type":
      return handleType(page, action, humanLike);
    case "clear_and_type":
      return handleClearAndType(page, action, humanLike);
    case "fill":
      return handleFill(page, action);
    case "select":
      return handleSelect(page, action);
    case "press_key":
      return handlePressKey(page, action);
    case "hover":
      return handleHover(page, action, humanLike);
    case "scroll":
      return handleScroll(page, action, humanLike);
    case "drag_drop":
      return handleDragDrop(page, action, humanLike);
    case "screenshot":
      return handleScreenshot(page, action);
    case "extract":
      return handleExtract(page, action);
    case "evaluate":
      return handleEvaluate(page, action);
    case "wait":
      return handleWait(page, action);
    case "upload":
      return handleUpload(page, action);
    case "go_back":
      await page.goBack();
      return { url: page.url() };
    case "go_forward":
      await page.goForward();
      return { url: page.url() };
    case "get_cookies":
      return handleGetCookies(context, action);
    case "set_cookies":
      return handleSetCookies(context, action);
    case "pdf":
      return handlePdf(page, action);
    default:
      throw new Error(`Unknown action: ${(action as any).action}`);
  }
}

// ── Navigate ───────────────────────────────────────────────────────

async function handleNavigate(page: Page, action: Extract<Action, { action: "navigate" }>) {
  const response = await page.goto(action.url, {
    waitUntil: action.wait_until || "domcontentloaded",
    timeout: 30000,
  });
  return {
    url: page.url(),
    title: await page.title(),
    status: response?.status(),
  };
}

// ── Click ──────────────────────────────────────────────────────────

async function handleClick(page: Page, action: Extract<Action, { action: "click" }>, humanLike: boolean) {
  if (humanLike) {
    await humanClick(page, action.selector, action.button, action.click_count);
  } else {
    await page.click(action.selector, {
      button: action.button,
      clickCount: action.click_count,
    });
  }
  return { clicked: action.selector };
}

// ── Type ───────────────────────────────────────────────────────────

async function handleType(page: Page, action: Extract<Action, { action: "type" }>, humanLike: boolean) {
  if (humanLike) {
    await humanType(page, action.selector, action.text);
  } else {
    await page.locator(action.selector).first().type(action.text, {
      delay: action.delay ?? 0,
    });
  }
  return { typed: action.text.length + " chars" };
}

// ── Clear and Type ─────────────────────────────────────────────────

async function handleClearAndType(page: Page, action: Extract<Action, { action: "clear_and_type" }>, humanLike: boolean) {
  const el = page.locator(action.selector).first();
  // Triple-click to select all, then delete
  await el.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  if (humanLike) {
    await humanType(page, action.selector, action.text);
  } else {
    await el.type(action.text);
  }
  return { typed: action.text.length + " chars" };
}

// ── Fill ───────────────────────────────────────────────────────────

async function handleFill(page: Page, action: Extract<Action, { action: "fill" }>) {
  await page.locator(action.selector).first().fill(action.value);
  return { filled: action.selector };
}

// ── Select ─────────────────────────────────────────────────────────

async function handleSelect(page: Page, action: Extract<Action, { action: "select" }>) {
  const values = Array.isArray(action.values) ? action.values : [action.values];
  const selected = await page.locator(action.selector).first().selectOption(values);
  return { selected };
}

// ── Press Key ──────────────────────────────────────────────────────

async function handlePressKey(page: Page, action: Extract<Action, { action: "press_key" }>) {
  let key = action.key;
  if (action.modifiers?.length) {
    key = action.modifiers.join("+") + "+" + key;
  }
  await page.keyboard.press(key);
  return { pressed: key };
}

// ── Hover ──────────────────────────────────────────────────────────

async function handleHover(page: Page, action: Extract<Action, { action: "hover" }>, humanLike: boolean) {
  if (humanLike) {
    const el = page.locator(action.selector).first();
    const box = await el.boundingBox();
    if (!box) throw new Error(`Element not visible: ${action.selector}`);
    await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await page.hover(action.selector);
  }
  return { hovered: action.selector };
}

// ── Scroll ─────────────────────────────────────────────────────────

async function handleScroll(page: Page, action: Extract<Action, { action: "scroll" }>, humanLike: boolean) {
  const amount = action.amount || 500;
  let deltaX = 0;
  let deltaY = 0;

  switch (action.direction || "down") {
    case "down": deltaY = amount; break;
    case "up": deltaY = -amount; break;
    case "right": deltaX = amount; break;
    case "left": deltaX = -amount; break;
  }

  if (action.selector) {
    await page.locator(action.selector).first().evaluate(
      (el, { dx, dy }) => el.scrollBy(dx, dy),
      { dx: deltaX, dy: deltaY },
    );
  } else if (humanLike) {
    await humanScroll(page, deltaX, deltaY);
  } else {
    await page.mouse.wheel(deltaX, deltaY);
  }

  return { scrolled: { deltaX, deltaY } };
}

// ── Drag & Drop ────────────────────────────────────────────────────

async function handleDragDrop(page: Page, action: Extract<Action, { action: "drag_drop" }>, humanLike: boolean) {
  const sourceEl = page.locator(action.source).first();
  const targetEl = page.locator(action.target).first();
  const sourceBox = await sourceEl.boundingBox();
  const targetBox = await targetEl.boundingBox();

  if (!sourceBox || !targetBox) throw new Error("Source or target not visible");

  const sx = sourceBox.x + sourceBox.width / 2;
  const sy = sourceBox.y + sourceBox.height / 2;
  const tx = targetBox.x + targetBox.width / 2;
  const ty = targetBox.y + targetBox.height / 2;

  if (humanLike) {
    await humanMouseMove(page, sx, sy);
    await page.mouse.down();
    await humanMouseMove(page, tx, ty);
    await page.mouse.up();
  } else {
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(tx, ty, { steps: 10 });
    await page.mouse.up();
  }

  return { dragged: action.source, dropped: action.target };
}

// ── Screenshot ─────────────────────────────────────────────────────

async function handleScreenshot(page: Page, action: Extract<Action, { action: "screenshot" }>) {
  const filename = action.output_filename || "screenshot.png";
  const outputPath = join(WORKSPACE_DIR, filename.endsWith(".png") ? filename : `${filename}.png`);

  const opts: any = { path: outputPath, type: "png" };

  if (action.selector) {
    await page.locator(action.selector).first().screenshot(opts);
  } else {
    if (action.full_page) opts.fullPage = true;
    if (action.clip) opts.clip = action.clip;
    await page.screenshot(opts);
  }

  return { file_path: outputPath };
}

// ── Extract ────────────────────────────────────────────────────────

async function handleExtract(page: Page, action: Extract<Action, { action: "extract" }>) {
  const locator = page.locator(action.selector);

  if (action.multiple) {
    const elements = await locator.all();
    const results: string[] = [];
    for (const el of elements) {
      if (action.attribute) {
        results.push((await el.getAttribute(action.attribute)) || "");
      } else if (action.format === "html") {
        results.push(await el.innerHTML());
      } else {
        results.push((await el.textContent()) || "");
      }
    }
    return { values: results, count: results.length };
  }

  const el = locator.first();
  let value: string;
  if (action.attribute) {
    value = (await el.getAttribute(action.attribute)) || "";
  } else if (action.format === "html") {
    value = await el.innerHTML();
  } else {
    value = (await el.textContent()) || "";
  }
  return { value };
}

// ── Evaluate ───────────────────────────────────────────────────────

async function handleEvaluate(page: Page, action: Extract<Action, { action: "evaluate" }>) {
  const result = await page.evaluate(action.script);
  return { result };
}

// ── Wait ───────────────────────────────────────────────────────────

async function handleWait(page: Page, action: Extract<Action, { action: "wait" }>) {
  const timeout = action.timeout || 30000;

  if (action.selector) {
    await page.waitForSelector(action.selector, {
      state: action.state || "visible",
      timeout,
    });
    return { waited_for: action.selector };
  }

  if (action.navigation) {
    await page.waitForNavigation({ timeout });
    return { waited_for: "navigation", url: page.url() };
  }

  if (action.load_state) {
    await page.waitForLoadState(action.load_state, { timeout });
    return { waited_for: action.load_state };
  }

  // Fallback: wait for timeout ms
  await page.waitForTimeout(timeout);
  return { waited_for: `${timeout}ms` };
}

// ── Upload ─────────────────────────────────────────────────────────

async function handleUpload(page: Page, action: Extract<Action, { action: "upload" }>) {
  await page.locator(action.selector).first().setInputFiles(action.file_path);
  return { uploaded: action.file_path };
}

// ── Cookies ────────────────────────────────────────────────────────

async function handleGetCookies(context: BrowserContext, action: Extract<Action, { action: "get_cookies" }>) {
  const cookies = await context.cookies(action.urls);
  return { cookies, count: cookies.length };
}

async function handleSetCookies(context: BrowserContext, action: Extract<Action, { action: "set_cookies" }>) {
  await context.addCookies(action.cookies);
  return { set: action.cookies.length };
}

// ── PDF ────────────────────────────────────────────────────────────

async function handlePdf(page: Page, action: Extract<Action, { action: "pdf" }>) {
  const filename = action.output_filename || "page.pdf";
  const outputPath = join(WORKSPACE_DIR, filename.endsWith(".pdf") ? filename : `${filename}.pdf`);

  await page.pdf({
    path: outputPath,
    format: action.format || "A4",
    printBackground: action.print_background !== false,
  });

  return { file_path: outputPath };
}
