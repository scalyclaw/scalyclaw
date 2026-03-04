---
name: Job Match
description: Score resume-to-job fit with gap analysis
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---

# Job Match Skill

Score how well a resume matches a job description using TF-IDF cosine similarity and keyword analysis.

## Input
- `resume_text` (string, required): Full resume text
- `job_description` (string, required): Full job description text
- `resume_skills` (array, optional): Pre-extracted list of resume skills for more accurate matching

## Output
- `overall_score` (number): 0-100 overall match score
- `similarity_score` (number): 0-1 cosine similarity between resume and job description
- `matching_skills` (array): Skills found in both resume and job description
- `missing_skills` (array): Skills in the job description but not in the resume
- `keyword_overlap` (object): shared, resume_only, job_only keyword arrays
- `recommendations` (array): Actionable suggestions to improve the match
