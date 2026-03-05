---
name: Browser Use
description: Advanced browser automation with stealth, human-like behavior, profiles, and comprehensive actions
script: scripts/main.ts
language: javascript
install: bun install && bunx playwright install chromium
timeout: 300
---

# Browser Use Skill

Full browser automation: navigate, click, type, scroll, drag-drop, hover, screenshot, extract content, and more. Supports anti-bot stealth measures, human-like behavior simulation, and persistent browser profiles.

## Input

- `actions` (array, required): Array of action objects to execute sequentially. Each action has an `action` field plus action-specific parameters.
- `stealth` (boolean, optional): Enable anti-detection patches (default: true)
- `human_like` (boolean, optional): Enable human-like mouse/typing/scroll behavior (default: true)
- `profile` (string, optional): Named browser profile for persistent sessions (cookies, storage)
- `viewport` (object, optional): `{ width, height }` (default: 1920x1080)
- `user_agent` (string, optional): Override user agent
- `proxy` (object, optional): `{ server, username?, password? }`
- `locale` (string, optional): Browser locale (default: "en-US")
- `timezone` (string, optional): Timezone ID (default: "America/New_York")
- `extra_headers` (object, optional): Additional HTTP headers
- `on_error` (string, optional): `"abort"` (default) or `"continue"` on action failure

### Action Types

| Action | Parameters | Description |
|--------|-----------|-------------|
| `navigate` | `url`, `wait_until?` | Navigate to URL |
| `click` | `selector`, `button?`, `click_count?` | Click element |
| `type` | `selector`, `text`, `delay?` | Type text into element |
| `clear_and_type` | `selector`, `text` | Clear field then type |
| `fill` | `selector`, `value` | Fast fill (no simulation) |
| `select` | `selector`, `values` | Select dropdown option(s) |
| `press_key` | `key`, `modifiers?` | Press keyboard key |
| `hover` | `selector` | Hover over element |
| `scroll` | `direction?`, `amount?`, `selector?` | Scroll page or element |
| `drag_drop` | `source`, `target` | Drag from source to target |
| `screenshot` | `full_page?`, `selector?`, `clip?`, `output_filename?` | Capture screenshot |
| `extract` | `selector`, `attribute?`, `multiple?`, `format?` | Extract content from page |
| `evaluate` | `script` | Run JavaScript in page |
| `wait` | `selector?`, `navigation?`, `state?`, `timeout?`, `load_state?` | Wait for condition |
| `upload` | `selector`, `file_path` | Upload file |
| `go_back` | | Navigate back |
| `go_forward` | | Navigate forward |
| `get_cookies` | `urls?` | Get cookies |
| `set_cookies` | `cookies` | Set cookies |
| `pdf` | `output_filename?`, `format?`, `print_background?` | Save page as PDF |

## Output

- `results` (array): Array of per-action results with `action`, `success`, `data`, `error`, `elapsed_ms`
- `elapsed_ms` (number): Total execution time
