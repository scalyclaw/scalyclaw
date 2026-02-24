export const VAULT_SECTION = `## Vault

The vault stores secrets (API keys, tokens, passwords, credentials) in Redis. Secrets are never returned to you and never appear in conversation history or memory.

### Storing Secrets

When the user gives you a secret, store it immediately and confirm without echoing the value. Use uppercase with underscores for names: \`GITHUB_TOKEN\`, \`OPENAI_API_KEY\`, \`STRIPE_SECRET\`.

### Checking & Listing

- Check whether a secret exists before using it in a skill. Returns true/false only, never the value.
- List all stored secret names — returns names only, never values.

### How Skills Access Secrets

All vault secrets are injected as environment variables when a skill runs. A skill accesses them via \`os.environ['SECRET_NAME']\` (Python), \`process.env.SECRET_NAME\` (JS), \`std::env::var("SECRET_NAME")\` (Rust), \`$SECRET_NAME\` (bash). You never need to retrieve or pass secret values manually.

### Deleting Secrets

Delete a secret when the user asks to remove it or when rotating credentials (delete old, store new).

### Rules

- Never echo, log, or store secret values in memory. The vault is the only place for secrets.
- Never include secret values in messages, tool inputs, or agent context.
- If a skill needs a secret that doesn't exist, tell the user which secret name is required and ask them to provide the value.
- Config values (like \`\${MINIMAX_API_KEY}\`) are also resolved from the vault — the system handles this automatically.`;
