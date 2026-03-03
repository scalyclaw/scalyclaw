import TurndownService from "turndown";
import { JSDOM } from "jsdom";

try {
  const data = await Bun.stdin.json();
  const html: string | undefined = data.html;
  const url: string | undefined = data.url;

  if (!html && !url) {
    throw new Error("Either 'html' or 'url' must be provided");
  }

  let htmlContent: string;

  if (url) {
    console.error(`Fetching HTML from: ${url}`);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "ScalyClaw-HTML-To-Markdown/1.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);
    }
    htmlContent = await res.text();
    console.error(`Fetched ${htmlContent.length} chars of HTML`);
  } else {
    htmlContent = html!;
    console.error(`Converting HTML content (${htmlContent.length} chars)`);
  }

  const dom = new JSDOM(htmlContent);
  const document = dom.window.document;

  const selectorsToRemove = ["script", "style", "nav", "footer", "header", "aside", "noscript", "iframe"];
  for (const selector of selectorsToRemove) {
    const elements = document.querySelectorAll(selector);
    elements.forEach((el: Element) => el.remove());
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });

  turndown.addRule("removeEmpty", {
    filter: (node: any) => {
      return (
        node.nodeName !== "IMG" &&
        node.nodeName !== "BR" &&
        node.nodeName !== "HR" &&
        node.textContent?.trim() === "" &&
        !node.querySelector("img")
      );
    },
    replacement: () => "",
  });

  const body = document.body;
  const mainContent = document.querySelector("main, article, [role=main], .content, #content") || body;

  const markdown = turndown.turndown(mainContent.innerHTML);

  const cleaned = markdown
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  console.log(JSON.stringify({ markdown: cleaned }));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
