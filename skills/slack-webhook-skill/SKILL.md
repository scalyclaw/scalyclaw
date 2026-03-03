---
name: Slack Webhook
description: Send messages to Slack channels via incoming webhook URLs
script: scripts/main.ts
language: javascript
install: none
timeout: 10
---

# Slack Webhook

Send messages to Slack channels via incoming webhook URLs. Supports rich formatting with Block Kit blocks.

## Secrets
- `SLACK_WEBHOOK_URL`: Default Slack incoming webhook URL (auto-injected from vault)

## Input
- `webhook_url` (string, optional): Slack incoming webhook URL (falls back to $SLACK_WEBHOOK_URL env var)
- `text` (string, required): Message text (supports Slack mrkdwn formatting)
- `channel` (string, optional): Override channel (e.g. "#general")
- `username` (string, optional): Override bot display name
- `icon_emoji` (string, optional): Override bot icon (e.g. ":robot_face:")
- `blocks` (array, optional): Slack Block Kit blocks for rich formatting

## Output
- `success` (boolean): Whether the message was sent successfully
- `status` (number): HTTP response status code
