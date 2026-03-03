import nodemailer from "nodemailer";

try {
  const data = await Bun.stdin.json();

  const to = data.to;
  const subject: string = data.subject;
  const body: string = data.body;
  const html: string | undefined = data.html;
  const from: string | undefined = data.from;
  const attachments: Array<{ filename: string; path: string }> | undefined = data.attachments;

  if (!to) throw new Error("Missing required parameter: to");
  if (!subject) throw new Error("Missing required parameter: subject");
  if (!body) throw new Error("Missing required parameter: body");

  const smtpHost = data.smtp_host || process.env.SMTP_HOST;
  const smtpPort = data.smtp_port || parseInt(process.env.SMTP_PORT || "587", 10);
  const smtpUser = data.smtp_user || process.env.SMTP_USER;
  const smtpPass = data.smtp_pass || process.env.SMTP_PASS;

  if (!smtpHost) throw new Error("SMTP host not provided (smtp_host param or SMTP_HOST env var)");
  if (!smtpUser) throw new Error("SMTP user not provided (smtp_user param or SMTP_USER env var)");
  if (!smtpPass) throw new Error("SMTP password not provided (smtp_pass param or SMTP_PASS env var)");

  console.error(`Connecting to SMTP server: ${smtpHost}:${smtpPort}`);

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    connectionTimeout: 10000,
    socketTimeout: 10000,
  });

  const recipients = Array.isArray(to) ? to.join(", ") : to;
  const senderAddress = from || smtpUser;

  const mailOptions: any = {
    from: senderAddress,
    to: recipients,
    subject,
    text: body,
  };

  if (html) {
    mailOptions.html = html;
  }

  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments.map((att) => ({
      filename: att.filename,
      path: att.path,
    }));
  }

  console.error(`Sending email to: ${recipients}`);
  const info = await transporter.sendMail(mailOptions);

  console.error(`Email sent: ${info.messageId}`);
  console.log(
    JSON.stringify({
      success: true,
      messageId: info.messageId,
    })
  );
} catch (err: any) {
  console.error(err.message);
  console.log(
    JSON.stringify({
      success: false,
      error: err.message,
    })
  );
}
