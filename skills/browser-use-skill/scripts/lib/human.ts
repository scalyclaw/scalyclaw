import type { Page } from "playwright";
import { gaussianRandom, clamp, sleep, randInt, smoothstep } from "./utils.js";

interface Point {
  x: number;
  y: number;
}

// Current mouse position tracker
let mousePos: Point = { x: 0, y: 0 };

function bezierPoint(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function generateControlPoints(start: Point, end: Point): [Point, Point] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Perpendicular direction
  const nx = -dy / (dist || 1);
  const ny = dx / (dist || 1);

  const spread = clamp(dist * 0.3, 20, 200);

  const cp1: Point = {
    x: start.x + dx * 0.25 + nx * gaussianRandom(0, spread),
    y: start.y + dy * 0.25 + ny * gaussianRandom(0, spread),
  };
  const cp2: Point = {
    x: start.x + dx * 0.75 + nx * gaussianRandom(0, spread),
    y: start.y + dy * 0.75 + ny * gaussianRandom(0, spread),
  };

  return [cp1, cp2];
}

export async function humanMouseMove(page: Page, targetX: number, targetY: number): Promise<void> {
  const start = { ...mousePos };
  const end = { x: targetX, y: targetY };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 2) {
    mousePos = end;
    return;
  }

  // Fitts's law duration: a + b * log2(D/W + 1)
  const duration = clamp(80 + 120 * Math.log2(dist / 10 + 1), 100, 1500);
  const steps = Math.max(Math.floor(duration / 10), 5);
  const [cp1, cp2] = generateControlPoints(start, end);

  for (let i = 1; i <= steps; i++) {
    const rawT = i / steps;
    const t = smoothstep(rawT);
    const p = bezierPoint(t, start, cp1, cp2, end);

    // Add micro-jitter (decreasing near target)
    const jitterScale = 1 - rawT;
    p.x += gaussianRandom(0, 1.5 * jitterScale);
    p.y += gaussianRandom(0, 1.5 * jitterScale);

    await page.mouse.move(p.x, p.y);
    await sleep(clamp(gaussianRandom(8, 3), 3, 20));
  }

  // Ensure exact landing
  await page.mouse.move(end.x, end.y);
  mousePos = end;
}

export async function humanClick(
  page: Page,
  selector: string,
  button: "left" | "right" | "middle" = "left",
  clickCount: number = 1,
): Promise<void> {
  const el = page.locator(selector).first();
  const box = await el.boundingBox();
  if (!box) throw new Error(`Element not visible: ${selector}`);

  // Random point within the element (gaussian around center)
  const targetX = clamp(
    box.x + box.width / 2 + gaussianRandom(0, box.width * 0.15),
    box.x + 2,
    box.x + box.width - 2,
  );
  const targetY = clamp(
    box.y + box.height / 2 + gaussianRandom(0, box.height * 0.15),
    box.y + 2,
    box.y + box.height - 2,
  );

  await humanMouseMove(page, targetX, targetY);
  await sleep(clamp(gaussianRandom(50, 20), 20, 150));
  await page.mouse.click(targetX, targetY, { button, clickCount });
}

export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  const el = page.locator(selector).first();
  await el.focus();
  await sleep(clamp(gaussianRandom(100, 30), 40, 200));

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    await page.keyboard.type(char, { delay: 0 });

    // Base typing delay
    let delay = gaussianRandom(80, 25);

    // Extra pause after space or punctuation
    if (" .,;:!?".includes(char)) {
      delay += gaussianRandom(40, 15);
    }

    // Occasional "thinking" pause (2% chance)
    if (Math.random() < 0.02) {
      delay += gaussianRandom(400, 100);
    }

    await sleep(clamp(delay, 30, 800));
  }
}

export async function humanScroll(
  page: Page,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const totalX = deltaX;
  const totalY = deltaY;
  const chunks = randInt(3, 8);

  let scrolledX = 0;
  let scrolledY = 0;

  for (let i = 0; i < chunks; i++) {
    // Ease in-out: more at middle, less at edges
    const t = (i + 0.5) / chunks;
    const weight = 4 * t * (1 - t); // Parabolic
    const normalizedWeight = weight / (chunks * 0.667); // Normalize roughly

    let chunkX = totalX * normalizedWeight;
    let chunkY = totalY * normalizedWeight;

    // Last chunk: ensure we hit exact total
    if (i === chunks - 1) {
      chunkX = totalX - scrolledX;
      chunkY = totalY - scrolledY;
    }

    await page.mouse.wheel(chunkX, chunkY);
    scrolledX += chunkX;
    scrolledY += chunkY;

    await sleep(clamp(gaussianRandom(40, 15), 15, 100));
  }

  // Small overshoot + correction (inertia damping)
  if (Math.abs(totalY) > 100) {
    const overshoot = gaussianRandom(totalY * 0.05, Math.abs(totalY) * 0.02);
    await page.mouse.wheel(0, overshoot);
    await sleep(clamp(gaussianRandom(60, 20), 30, 120));
    await page.mouse.wheel(0, -overshoot);
  }
}
