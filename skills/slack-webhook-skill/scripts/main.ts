try {
  const input = await Bun.stdin.json();

  const webhookUrl: string = input.webhook_url || process.env.SLACK_WEBHOOK_URL || "";
  const text: string = input.text || "";
  const channel: string | undefined = input.channel;
  const username: string | undefined = input.username;
  const iconEmoji: string | undefined = input.icon_emoji;
  const blocks: any[] | undefined = input.blocks;

  if (!webhookUrl) {
    throw new Error(
      "Missing webhook URL. Provide 'webhook_url' in input or set SLACK_WEBHOOK_URL environment variable."
    );
  }

  if (!text && !blocks) {
    throw new Error("Missing required parameter: text (or blocks)");
  }

  // Build the Slack payload
  const payload: Record<string, any> = { text };

  if (channel) payload.channel = channel;
  if (username) payload.username = username;
  if (iconEmoji) payload.icon_emoji = iconEmoji;
  if (blocks && Array.isArray(blocks) && blocks.length > 0) {
    payload.blocks = blocks;
  }

  console.error(`Sending Slack message to webhook${channel ? ` (channel: ${channel})` : ""}`);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const success = response.status === 200;

  if (!success) {
    const body = await response.text();
    console.error(`Slack API responded with status ${response.status}: ${body}`);
  } else {
    console.error("Message sent successfully");
  }

  console.log(JSON.stringify({ success, status: response.status }));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
