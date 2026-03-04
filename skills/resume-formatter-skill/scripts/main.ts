interface ResumeData {
  name?: string;
  contact?: {
    email?: string;
    phone?: string;
    linkedin?: string;
    location?: string;
  };
  summary?: string;
  skills?: string[];
  experience?: {
    title?: string;
    company?: string;
    dates?: string;
    description?: string;
  }[];
  education?: {
    degree?: string;
    institution?: string;
    dates?: string;
  }[];
  certifications?: string[];
}

function formatModern(r: ResumeData): string {
  const lines: string[] = [];

  if (r.name) lines.push(`# ${r.name}`, "");

  const contactParts: string[] = [];
  if (r.contact?.email) contactParts.push(r.contact.email);
  if (r.contact?.phone) contactParts.push(r.contact.phone);
  if (r.contact?.location) contactParts.push(r.contact.location);
  if (r.contact?.linkedin) contactParts.push(`[LinkedIn](${r.contact.linkedin})`);
  if (contactParts.length) lines.push(contactParts.join(" · "), "");

  if (r.summary) lines.push("## Summary", "", r.summary, "");

  if (r.skills?.length) {
    lines.push("## Skills", "");
    lines.push(r.skills.map((s) => `\`${s}\``).join(" · "), "");
  }

  if (r.experience?.length) {
    lines.push("## Experience", "");
    for (const exp of r.experience) {
      const header = [exp.title, exp.company].filter(Boolean).join(" — ");
      lines.push(`### ${header}`);
      if (exp.dates) lines.push(`*${exp.dates}*`);
      lines.push("");
      if (exp.description) lines.push(exp.description, "");
    }
  }

  if (r.education?.length) {
    lines.push("## Education", "");
    for (const edu of r.education) {
      const header = [edu.degree, edu.institution].filter(Boolean).join(" — ");
      lines.push(`### ${header}`);
      if (edu.dates) lines.push(`*${edu.dates}*`);
      lines.push("");
    }
  }

  if (r.certifications?.length) {
    lines.push("## Certifications", "");
    for (const cert of r.certifications) {
      lines.push(`- ${cert}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatClassic(r: ResumeData): string {
  const lines: string[] = [];

  if (r.name) lines.push(`# ${r.name}`, "");

  if (r.contact) {
    const parts: string[] = [];
    if (r.contact.email) parts.push(`Email: ${r.contact.email}`);
    if (r.contact.phone) parts.push(`Phone: ${r.contact.phone}`);
    if (r.contact.location) parts.push(`Location: ${r.contact.location}`);
    if (r.contact.linkedin) parts.push(`LinkedIn: ${r.contact.linkedin}`);
    lines.push(parts.join("  \n"), "");
  }

  lines.push("---", "");

  if (r.summary) lines.push("## Professional Summary", "", r.summary, "");

  if (r.experience?.length) {
    lines.push("## Professional Experience", "");
    for (const exp of r.experience) {
      if (exp.title) lines.push(`**${exp.title}**`);
      const meta = [exp.company, exp.dates].filter(Boolean).join(" | ");
      if (meta) lines.push(meta);
      lines.push("");
      if (exp.description) lines.push(exp.description, "");
    }
  }

  if (r.education?.length) {
    lines.push("## Education", "");
    for (const edu of r.education) {
      if (edu.degree) lines.push(`**${edu.degree}**`);
      const meta = [edu.institution, edu.dates].filter(Boolean).join(" | ");
      if (meta) lines.push(meta);
      lines.push("");
    }
  }

  if (r.skills?.length) {
    lines.push("## Technical Skills", "");
    lines.push(r.skills.join(", "), "");
  }

  if (r.certifications?.length) {
    lines.push("## Certifications", "");
    for (const cert of r.certifications) {
      lines.push(`- ${cert}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatMinimal(r: ResumeData): string {
  const lines: string[] = [];

  if (r.name) lines.push(`**${r.name}**`, "");

  const contactParts: string[] = [];
  if (r.contact?.email) contactParts.push(r.contact.email);
  if (r.contact?.phone) contactParts.push(r.contact.phone);
  if (r.contact?.location) contactParts.push(r.contact.location);
  if (contactParts.length) lines.push(contactParts.join(" | "), "");

  if (r.summary) lines.push(r.summary, "");

  if (r.skills?.length) lines.push(`**Skills:** ${r.skills.join(", ")}`, "");

  if (r.experience?.length) {
    lines.push("**Experience**", "");
    for (const exp of r.experience) {
      const header = [exp.title, exp.company, exp.dates].filter(Boolean).join(" — ");
      lines.push(header);
      if (exp.description) lines.push(exp.description);
      lines.push("");
    }
  }

  if (r.education?.length) {
    lines.push("**Education**", "");
    for (const edu of r.education) {
      lines.push([edu.degree, edu.institution, edu.dates].filter(Boolean).join(" — "));
    }
    lines.push("");
  }

  if (r.certifications?.length) {
    lines.push("**Certifications:** " + r.certifications.join(", "), "");
  }

  return lines.join("\n");
}

try {
  const input = await Bun.stdin.json();
  const resume: ResumeData = input.resume;

  if (!resume) {
    console.log(JSON.stringify({ error: "Missing required field: resume" }));
    process.exit(0);
  }

  const template: string = input.template || "modern";
  const outputFilename: string | undefined = input.output_filename;

  let markdown: string;
  switch (template) {
    case "classic":
      markdown = formatClassic(resume);
      break;
    case "minimal":
      markdown = formatMinimal(resume);
      break;
    default:
      markdown = formatModern(resume);
      break;
  }

  const result: { markdown: string; file_path?: string } = { markdown };

  if (outputFilename) {
    await Bun.write(outputFilename, markdown);
    result.file_path = outputFilename;
    console.error(`Written to ${outputFilename}`);
  }

  console.log(JSON.stringify(result));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
