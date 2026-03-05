import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { join } from "path";
import { getStealthScript, getStealthLaunchArgs, getRandomUserAgent } from "./stealth.js";
import type { BrowserInput } from "./types.js";

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private input: BrowserInput;

  constructor(input: BrowserInput) {
    this.input = input;
  }

  async launch(): Promise<void> {
    const stealth = this.input.stealth !== false;
    const viewport = this.input.viewport || { width: 1920, height: 1080 };
    const userAgent = this.input.user_agent || (stealth ? getRandomUserAgent() : undefined);
    const launchArgs = stealth ? getStealthLaunchArgs() : ["--no-sandbox"];

    const contextOptions: any = {
      viewport,
      userAgent,
      locale: this.input.locale || "en-US",
      timezoneId: this.input.timezone || "America/New_York",
      extraHTTPHeaders: this.input.extra_headers,
    };

    if (this.input.proxy) {
      contextOptions.proxy = this.input.proxy;
    }

    if (this.input.profile) {
      // Persistent context: cookies, localStorage, etc. survive across invocations
      const workspaceDir = process.env.WORKSPACE_DIR || "/tmp";
      const userDataDir = join(workspaceDir, ".browser-profiles", this.input.profile);
      this.context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        args: launchArgs,
        ...contextOptions,
      });
      this.page = this.context.pages()[0] || (await this.context.newPage());
    } else {
      // Ephemeral: fresh browser, no persistence
      this.browser = await chromium.launch({
        headless: true,
        args: launchArgs,
      });
      this.context = await this.browser.newContext(contextOptions);
      this.page = await this.context.newPage();
    }

    if (stealth) {
      const languages = this.input.locale ? [this.input.locale, this.input.locale.split("-")[0]] : undefined;
      await this.context.addInitScript(getStealthScript(languages));
    }
  }

  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched");
    return this.page;
  }

  getContext(): BrowserContext {
    if (!this.context) throw new Error("Browser not launched");
    return this.context;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    } else if (this.context) {
      await this.context.close();
    }
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
