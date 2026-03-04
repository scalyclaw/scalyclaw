---
name: Resume Parser
description: Parse PDF/text resumes into structured JSON
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---

# Resume Parser Skill

Parse resumes from PDF files or raw text into structured JSON with contact info, experience, education, skills, and more.

## Input
- `file_path` (string, optional): Path to a PDF resume file
- `text` (string, optional): Raw resume text (one of file_path or text is required)

## Output
- `contact` (object): name, email, phone, linkedin, location
- `summary` (string): Professional summary or objective
- `skills` (array): List of skills
- `experience` (array): Work experience entries with title, company, dates, description
- `education` (array): Education entries with degree, institution, dates
- `certifications` (array): List of certifications
- `raw_text` (string): Full extracted text
