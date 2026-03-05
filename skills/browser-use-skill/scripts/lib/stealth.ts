const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
];

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function getStealthLaunchArgs(): string[] {
  return [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-infobars",
    "--no-sandbox",
    "--no-first-run",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-translate",
    "--metrics-recording-only",
    "--no-default-browser-check",
  ];
}

export function getStealthScript(languages: string[] = ["en-US", "en"]): string {
  return `
    // Remove webdriver flag
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // Fake plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        const arr = Object.create(PluginArray.prototype);
        plugins.forEach((p, i) => {
          const plugin = Object.create(Plugin.prototype);
          Object.defineProperties(plugin, {
            name: { value: p.name },
            filename: { value: p.filename },
            description: { value: p.description },
            length: { value: 0 },
          });
          arr[i] = plugin;
        });
        Object.defineProperty(arr, 'length', { value: plugins.length });
        return arr;
      },
    });

    // Languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ${JSON.stringify(languages)},
    });

    // Chrome runtime
    if (!window.chrome) window.chrome = {};
    window.chrome.runtime = {
      connect: () => {},
      sendMessage: () => {},
      onMessage: { addListener: () => {}, removeListener: () => {} },
    };

    // Permissions
    const originalQuery = window.Permissions?.prototype?.query;
    if (originalQuery) {
      window.Permissions.prototype.query = function(parameters) {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return originalQuery.call(this, parameters);
      };
    }

    // Hardware concurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => ${4 + Math.floor(Math.random() * 5)},
    });

    // Device memory
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    });

    // Connection
    if (navigator.connection) {
      Object.defineProperty(navigator.connection, 'effectiveType', {
        get: () => '4g',
      });
    }

    // WebGL vendor/renderer
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };
    const getParameter2 = WebGL2RenderingContext?.prototype?.getParameter;
    if (getParameter2) {
      WebGL2RenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter2.call(this, parameter);
      };
    }
  `;
}
