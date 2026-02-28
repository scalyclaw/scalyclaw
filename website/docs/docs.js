/* ─── ScalyClaw Docs — Shared JS ─────────────────────── */

/* ─── Sidebar Navigation Data ─────────────────────────── */
const NAV_SECTIONS = [
  {
    group: 'Getting Started',
    links: [
      { href: 'index.html', label: 'Introduction' },
      { href: 'getting-started.html', label: 'Prerequisites' },
      { href: 'getting-started.html#installation', label: 'Installation' },
      { href: 'getting-started.html#first-run', label: 'First Run' },
      { href: 'getting-started.html#project-structure', label: 'Project Structure' },
    ]
  },
  {
    group: 'Architecture',
    links: [
      { href: 'architecture.html', label: 'Overview' },
      { href: 'architecture.html#message-flow', label: 'Message Flow' },
      { href: 'architecture.html#configuration', label: 'Configuration' },
    ]
  },
  {
    group: 'The Mind',
    links: [
      { href: 'mind.html', label: 'Personality Files' },
      { href: 'mind.html#editing', label: 'Editing' },
    ]
  },
  {
    group: 'Channels',
    links: [
      { href: 'channels.html', label: 'Overview' },
      { href: 'channels.html#telegram', label: 'Telegram' },
      { href: 'channels.html#discord', label: 'Discord' },
      { href: 'channels.html#slack', label: 'Slack' },
      { href: 'channels.html#whatsapp', label: 'WhatsApp' },
      { href: 'channels.html#signal', label: 'Signal' },
      { href: 'channels.html#teams', label: 'Teams' },
      { href: 'channels.html#web', label: 'Web Gateway' },
    ]
  },
  {
    group: 'Models & Providers',
    links: [
      { href: 'models.html', label: 'Model Configuration' },
      { href: 'models.html#embedding', label: 'Embedding Models' },
      { href: 'models.html#budget', label: 'Budget Control' },
    ]
  },
  {
    group: 'Memory',
    links: [
      { href: 'memory.html', label: 'How Memory Works' },
      { href: 'memory.html#management', label: 'Memory Management' },
    ]
  },
  {
    group: 'Skills',
    links: [
      { href: 'skills.html', label: 'Skill Basics' },
      { href: 'skills.html#creating', label: 'Creating a Skill' },
      { href: 'skills.html#deployment', label: 'Deployment' },
      { href: 'skills.html#advanced', label: 'Advanced' },
    ]
  },
  {
    group: 'Agents',
    links: [
      { href: 'agents.html', label: 'Agent System' },
      { href: 'agents.html#creating', label: 'Creating Agents' },
      { href: 'agents.html#execution', label: 'Execution' },
    ]
  },
  {
    group: 'Tools',
    links: [
      { href: 'tools.html', label: 'Built-in Tools' },
      { href: 'tools.html#architecture', label: 'Tool Architecture' },
    ]
  },
  {
    group: 'Security',
    links: [
      { href: 'security.html', label: 'Overview' },
      { href: 'security.html#echo-guard', label: 'Echo Guard' },
      { href: 'security.html#content-guard', label: 'Content Guard' },
      { href: 'security.html#skill-agent-guard', label: 'Skill & Agent Guard' },
      { href: 'security.html#command-shield', label: 'Command Shield' },
      { href: 'security.html#vault', label: 'Vault' },
    ]
  },
  {
    group: 'MCP',
    links: [
      { href: 'mcp.html', label: 'Integration' },
      { href: 'mcp.html#connecting', label: 'Connecting Servers' },
    ]
  },
  {
    group: 'Workers',
    links: [
      { href: 'workers.html', label: 'Overview' },
      { href: 'workers.html#deploying', label: 'Deploying' },
      { href: 'workers.html#monitoring', label: 'Monitoring' },
    ]
  },
  {
    group: 'Scheduler',
    links: [
      { href: 'scheduler.html', label: 'Reminders & Tasks' },
    ]
  },
  {
    group: 'Engagement',
    links: [
      { href: 'engagement.html', label: 'Proactive System' },
    ]
  },
  {
    group: 'Dashboard',
    links: [
      { href: 'dashboard.html', label: 'Overview' },
      { href: 'dashboard.html#pages', label: 'Pages' },
    ]
  },
  {
    group: 'CLI Reference',
    links: [
      { href: 'cli.html', label: 'Commands' },
    ]
  },
  {
    group: 'Use Cases',
    links: [
      { href: 'use-cases.html', label: 'Personal Assistant' },
      { href: 'use-cases.html#developer', label: 'Developer Companion' },
      { href: 'use-cases.html#team', label: 'Team Bot' },
      { href: 'use-cases.html#home', label: 'Home Automation' },
    ]
  },
  {
    group: 'Troubleshooting',
    links: [
      { href: 'troubleshooting.html', label: 'Common Issues' },
      { href: 'troubleshooting.html#faq', label: 'FAQ' },
    ]
  },
];

/* ─── Search Index (page → snippets) ──────────────────── */
const SEARCH_INDEX = [
  { page: 'index.html', title: 'Introduction', text: 'ScalyClaw personal AI assistant one mind every channel infinite memory self-hosted extensible open-source' },
  { page: 'getting-started.html', title: 'Prerequisites', text: 'Bun runtime Redis server OS support macOS Linux Windows WSL' },
  { page: 'getting-started.html#installation', title: 'Installation', text: 'clone install build setup git repository bun install shared packages' },
  { page: 'getting-started.html#first-run', title: 'First Run', text: 'setup wizard start node worker dashboard first message configure' },
  { page: 'getting-started.html#project-structure', title: 'Project Structure', text: 'directory layout scalyclaw worker dashboard shared mind skills agents' },
  { page: 'architecture.html', title: 'Architecture Overview', text: 'node worker dashboard Redis BullMQ queues system architecture components' },
  { page: 'architecture.html#message-flow', title: 'Message Flow', text: 'channel guards orchestrator LLM tools response pipeline processing' },
  { page: 'architecture.html#configuration', title: 'Configuration', text: 'Redis stored hot-reload pub/sub config settings runtime' },
  { page: 'mind.html', title: 'Personality Files', text: 'IDENTITY.md SOUL.md USER.md personality tone behavior mind system prompt' },
  { page: 'mind.html#editing', title: 'Editing the Mind', text: 'dashboard mind editor edit files personality soul identity user' },
  { page: 'channels.html', title: 'Channels Overview', text: 'seven channels one memory Telegram Discord Slack WhatsApp Signal Teams Web' },
  { page: 'channels.html#telegram', title: 'Telegram', text: 'Telegram bot BotFather token webhook polling setup' },
  { page: 'channels.html#discord', title: 'Discord', text: 'Discord bot application gateway intents token server' },
  { page: 'channels.html#slack', title: 'Slack', text: 'Slack app bolt socket mode OAuth workspace' },
  { page: 'channels.html#whatsapp', title: 'WhatsApp', text: 'WhatsApp Business API Cloud Meta webhook' },
  { page: 'channels.html#signal', title: 'Signal', text: 'Signal signald linked device REST API' },
  { page: 'channels.html#teams', title: 'Teams', text: 'Microsoft Teams Bot Framework Azure' },
  { page: 'channels.html#web', title: 'Web Gateway', text: 'Web Gateway HTTP REST API WebSocket custom integration' },
  { page: 'models.html', title: 'Model Configuration', text: 'LLM providers models OpenAI Anthropic Claude GPT fallback chain priority weight' },
  { page: 'models.html#embedding', title: 'Embedding Models', text: 'embedding vector search memory openai text-embedding' },
  { page: 'models.html#budget', title: 'Budget Control', text: 'budget limits cost tracking hard soft mode alerts spending daily' },
  { page: 'memory.html', title: 'How Memory Works', text: 'auto extraction hybrid vector FTS5 sqlite types confidence semantic search' },
  { page: 'memory.html#management', title: 'Memory Management', text: 'dashboard search manual store delete browse memory entries' },
  { page: 'skills.html', title: 'Skill Basics', text: 'skills SKILL.md format JavaScript Python Rust Bash code execution' },
  { page: 'skills.html#creating', title: 'Creating a Skill', text: 'create skill step-by-step example parameters handler manifest' },
  { page: 'skills.html#deployment', title: 'Skill Deployment', text: 'hot-reload zip upload auto-dependency install deploy' },
  { page: 'skills.html#advanced', title: 'Advanced Skills', text: 'parameters long-running self-created skills streaming output' },
  { page: 'agents.html', title: 'Agent System', text: 'autonomous sub-agents delegation complex tasks orchestration' },
  { page: 'agents.html#creating', title: 'Creating Agents', text: 'create agent dashboard properties permissions model prompt' },
  { page: 'agents.html#execution', title: 'Agent Execution', text: 'delegation flow BullMQ agents queue tool routing' },
  { page: 'tools.html', title: 'Built-in Tools', text: 'execute_code execute_skill delegate_agent memory_store memory_search schedule_reminder execute_command' },
  { page: 'tools.html#architecture', title: 'Tool Architecture', text: 'TOOL_QUEUE routing local queue execution tool-impl processing' },
  { page: 'security.html', title: 'Security Overview', text: 'defense-in-depth fail-closed security guards layers protection' },
  { page: 'security.html#echo-guard', title: 'Echo Guard', text: 'echo guard semantic similarity check threshold injection detection' },
  { page: 'security.html#content-guard', title: 'Content Guard', text: 'content guard prompt injection social engineering jailbreak detection' },
  { page: 'security.html#skill-agent-guard', title: 'Skill & Agent Guard', text: 'skill agent guard code validation permission auditing sandbox' },
  { page: 'security.html#command-shield', title: 'Command Shield', text: 'command shield deterministic pattern matching denied blocked shell commands no LLM' },
  { page: 'security.html#vault', title: 'Vault', text: 'vault secrets Redis env var injection API keys credentials never exposed' },
  { page: 'mcp.html', title: 'MCP Integration', text: 'Model Context Protocol servers tools stdio HTTP SSE transport' },
  { page: 'mcp.html#connecting', title: 'Connecting MCP Servers', text: 'dashboard setup bulk import troubleshooting MCP connect' },
  { page: 'workers.html', title: 'Workers Overview', text: 'stateless execution Redis-only workers BullMQ processing' },
  { page: 'workers.html#deploying', title: 'Deploying Workers', text: 'same-machine remote Docker containers deploy workers scaling' },
  { page: 'workers.html#monitoring', title: 'Monitoring Workers', text: 'dashboard health queues concurrency uptime monitoring' },
  { page: 'scheduler.html', title: 'Reminders & Tasks', text: 'scheduler one-shot recurring cron patterns timezone reminders tasks' },
  { page: 'engagement.html', title: 'Proactive System', text: 'proactive engagement triggers quiet hours cooldown idle threshold reach out' },
  { page: 'dashboard.html', title: 'Dashboard Overview', text: 'dashboard 16-page SPA React real-time WebSocket admin interface' },
  { page: 'dashboard.html#pages', title: 'Dashboard Pages', text: 'overview mind usage channels models agents skills memory vault MCP scheduler' },
  { page: 'cli.html', title: 'CLI Commands', text: 'CLI commands scalyclaw node worker dashboard start stop setup' },
  { page: 'use-cases.html', title: 'Personal Assistant', text: 'personal assistant daily companion Telegram Discord use case' },
  { page: 'use-cases.html#developer', title: 'Developer Companion', text: 'developer code execution research agent MCP filesystem use case' },
  { page: 'use-cases.html#team', title: 'Team Bot', text: 'team bot Slack Teams standup reminders knowledge base use case' },
  { page: 'use-cases.html#home', title: 'Home Automation', text: 'home automation MCP IoT scheduled routines smart home use case' },
  { page: 'troubleshooting.html', title: 'Common Issues', text: 'troubleshooting Redis channels workers errors connection problems' },
  { page: 'troubleshooting.html#faq', title: 'FAQ', text: 'FAQ local LLMs storage backup scaling frequently asked questions' },
];

/* ─── SVG Icons ───────────────────────────────────────── */
const ICONS = {
  logo: `<img src="../assets/logo.svg" alt="ScalyClaw" style="width:28px;height:28px" />`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  github: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>`,
  hamburger: `<span></span><span></span><span></span>`,
};

/* ─── Inject Header ───────────────────────────────────── */
function injectHeader() {
  const header = document.createElement('header');
  header.className = 'docs-header';
  header.innerHTML = `
    <div class="docs-header-inner">
      <div class="docs-header-left">
        <div class="docs-hamburger" id="hamburger">${ICONS.hamburger}</div>
        <a href="../index.html" class="docs-logo">
          ${ICONS.logo}
          ScalyClaw
        </a>
        <span class="docs-logo-sep"></span>
        <span class="docs-logo-label">Docs</span>
      </div>
      <div class="docs-search" id="searchBox">
        <span class="docs-search-icon">${ICONS.search}</span>
        <input type="text" class="docs-search-input" id="searchInput" placeholder="Search docs..." autocomplete="off" />
        <span class="docs-search-kbd" id="searchKbd">&numsp;/&numsp;</span>
        <div class="docs-search-results" id="searchResults"></div>
      </div>
      <div class="docs-header-links">
        <a href="../index.html" class="docs-header-link">${ICONS.home} Home</a>
        <a href="https://github.com/scalyclaw/scalyclaw" target="_blank" class="docs-header-link">${ICONS.github} GitHub</a>
      </div>
    </div>
  `;
  document.body.prepend(header);
}

/* ─── Inject Sidebar ──────────────────────────────────── */
function injectSidebar() {
  const layout = document.querySelector('.docs-layout');
  if (!layout) return;

  const sidebar = document.createElement('aside');
  sidebar.className = 'docs-sidebar';
  sidebar.id = 'sidebar';

  const backdrop = document.createElement('div');
  backdrop.className = 'docs-sidebar-backdrop';
  backdrop.id = 'sidebarBackdrop';

  const currentPage = location.pathname.split('/').pop() || 'index.html';

  let html = '';
  for (const section of NAV_SECTIONS) {
    html += `<div class="docs-sidebar-group">`;
    html += `<div class="docs-sidebar-heading">${section.group}<span class="docs-sidebar-chevron">${ICONS.chevron}</span></div>`;
    html += `<ul class="docs-sidebar-links">`;
    for (const link of section.links) {
      const linkPage = link.href.split('#')[0] || 'index.html';
      const isPageActive = linkPage === currentPage;
      const fullHref = link.href;
      const cls = isPageActive ? ' page-active' : '';
      html += `<li><a href="${fullHref}" class="docs-sidebar-link${cls}" data-page="${linkPage}">${link.label}</a></li>`;
    }
    html += `</ul></div>`;
  }

  sidebar.innerHTML = html;
  layout.prepend(backdrop, sidebar);
}

/* ─── Scroll Spy ──────────────────────────────────────── */
function initScrollSpy() {
  const sections = document.querySelectorAll('.docs-content h2[id], .docs-content h3[id]');
  if (!sections.length) return;

  const links = document.querySelectorAll('.docs-sidebar-link');
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  let ticking = false;

  function update() {
    const scrollY = window.scrollY + 100;
    let activeId = '';
    sections.forEach(s => {
      if (s.offsetTop <= scrollY) activeId = s.id;
    });

    links.forEach(link => {
      link.classList.remove('active');
      const href = link.getAttribute('href');
      const [page, hash] = href.split('#');
      const linkPage = page || currentPage;
      if (linkPage === currentPage) {
        if (activeId && hash === activeId) {
          link.classList.add('active');
        } else if (!activeId && !hash) {
          link.classList.add('active');
        }
      }
    });
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  });
  update();
}

/* ─── Collapsible Sidebar Groups ──────────────────────── */
function initSidebarCollapse() {
  document.querySelectorAll('.docs-sidebar-heading').forEach(heading => {
    heading.addEventListener('click', () => {
      heading.parentElement.classList.toggle('collapsed');
    });
  });
}

/* ─── Mobile Sidebar ──────────────────────────────────── */
function initMobileSidebar() {
  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!hamburger || !sidebar) return;

  function toggle() {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('open');
  }
  function close() {
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
  }

  hamburger.addEventListener('click', toggle);
  backdrop.addEventListener('click', close);

  // Close on link click (mobile)
  sidebar.querySelectorAll('.docs-sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 900) close();
    });
  });
}

/* ─── Copy to Clipboard ───────────────────────────────── */
function initCopyButtons() {
  document.querySelectorAll('.code-block-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const pre = btn.closest('.code-block').querySelector('pre');
      if (!pre) return;
      const text = pre.textContent;
      navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = ICONS.check;
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = ICONS.copy;
          btn.classList.remove('copied');
        }, 2000);
      });
    });

    // Set initial icon
    btn.innerHTML = ICONS.copy;
  });
}

/* ─── Smooth Scroll for Same-page Anchors ─────────────── */
function initSmoothScroll() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href').slice(1);
    const target = document.getElementById(id);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.pushState(null, '', '#' + id);
    }
  });
}

/* ─── Client-side Search ──────────────────────────────── */
function initSearch() {
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  const kbd = document.getElementById('searchKbd');
  if (!input || !results) return;

  function doSearch(query) {
    if (query.length < 2) {
      results.classList.remove('open');
      return;
    }
    const q = query.toLowerCase();
    const matches = SEARCH_INDEX.filter(item =>
      item.title.toLowerCase().includes(q) || item.text.toLowerCase().includes(q)
    ).slice(0, 8);

    if (!matches.length) {
      results.innerHTML = `<div class="docs-search-empty">No results for "${query}"</div>`;
      results.classList.add('open');
      return;
    }

    results.innerHTML = matches.map(item => {
      const idx = item.text.toLowerCase().indexOf(q);
      let snippet = '';
      if (idx >= 0) {
        const start = Math.max(0, idx - 30);
        const end = Math.min(item.text.length, idx + q.length + 40);
        snippet = (start > 0 ? '...' : '') +
          item.text.slice(start, idx) +
          `<mark>${item.text.slice(idx, idx + q.length)}</mark>` +
          item.text.slice(idx + q.length, end) +
          (end < item.text.length ? '...' : '');
      }
      return `<a href="${item.page}" class="docs-search-result">
        <div class="docs-search-result-title">${item.title}</div>
        ${snippet ? `<div class="docs-search-result-snippet">${snippet}</div>` : ''}
      </a>`;
    }).join('');
    results.classList.add('open');
  }

  input.addEventListener('input', () => doSearch(input.value.trim()));
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) doSearch(input.value.trim()); });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#searchBox')) results.classList.remove('open');
  });

  // Keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      input.focus();
    }
    if (e.key === 'Escape') {
      results.classList.remove('open');
      input.blur();
    }
  });
}

/* ─── Init All ────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  injectHeader();
  injectSidebar();
  initSidebarCollapse();
  initMobileSidebar();
  initScrollSpy();
  initCopyButtons();
  initSmoothScroll();
  initSearch();
});
