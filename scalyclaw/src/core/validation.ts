const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MAX_ID_LENGTH = 128;

/**
 * Validate an ID (agent, skill, MCP server, secret name).
 * Must be 1-128 chars, start with alphanumeric, contain only alphanumeric, dots, hyphens, underscores.
 */
export function validateId(id: string): boolean {
  return id.length >= 1 && id.length <= MAX_ID_LENGTH && ID_PATTERN.test(id);
}
