import sys
import json
import re


def extract_keywords(tfidf, feature_names, doc_index, top_n=30):
    """Extract top keywords from a TF-IDF vector."""
    row = tfidf[doc_index].toarray().flatten()
    top_indices = row.argsort()[-top_n:][::-1]
    return [feature_names[i] for i in top_indices if row[i] > 0]


def normalize_skill(skill):
    """Normalize a skill string for comparison."""
    return re.sub(r"[^a-z0-9+#.]", "", skill.lower())


def main():
    try:
        data = json.loads(sys.stdin.read())
        resume_text = data.get("resume_text")
        job_description = data.get("job_description")

        if not resume_text or not job_description:
            print(json.dumps({"error": "Both resume_text and job_description are required"}))
            return

        resume_skills = data.get("resume_skills", [])

        sys.stderr.write("Computing TF-IDF similarity...\n")

        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity

        # TF-IDF vectorization
        vectorizer = TfidfVectorizer(
            stop_words="english",
            max_features=5000,
            ngram_range=(1, 2),
        )
        tfidf_matrix = vectorizer.fit_transform([resume_text, job_description])
        feature_names = vectorizer.get_feature_names_out()

        # Cosine similarity
        similarity = cosine_similarity(tfidf_matrix[0:1], tfidf_matrix[1:2])[0][0]

        # Extract top keywords from each document
        resume_keywords = set(extract_keywords(tfidf_matrix, feature_names, 0))
        job_keywords = set(extract_keywords(tfidf_matrix, feature_names, 1))

        shared_keywords = resume_keywords & job_keywords
        resume_only = resume_keywords - job_keywords
        job_only = job_keywords - resume_keywords

        # Skill matching
        if resume_skills:
            normalized_resume_skills = {normalize_skill(s): s for s in resume_skills}
            job_text_lower = job_description.lower()

            matching_skills = []
            for norm, original in normalized_resume_skills.items():
                if norm and norm in job_text_lower:
                    matching_skills.append(original)

            # Extract potential skill terms from job description that aren't in resume
            missing_skills = [kw for kw in sorted(job_only) if len(kw) > 2][:15]
        else:
            matching_skills = list(shared_keywords)[:20]
            missing_skills = list(job_only)[:15]

        # Weighted overall score
        keyword_overlap_ratio = len(shared_keywords) / max(len(job_keywords), 1)
        overall_score = round((similarity * 0.6 + keyword_overlap_ratio * 0.4) * 100)
        overall_score = max(0, min(100, overall_score))

        # Generate recommendations
        recommendations = []
        if overall_score < 50:
            recommendations.append("Consider tailoring your resume more closely to this job description.")
        if missing_skills:
            top_missing = missing_skills[:5]
            recommendations.append(f"Add these missing keywords if applicable: {', '.join(top_missing)}")
        if similarity < 0.3:
            recommendations.append("Your resume language differs significantly from the job posting. Mirror key phrases from the description.")
        if not resume_skills:
            recommendations.append("Include a dedicated skills section in your resume for better keyword matching.")
        if overall_score >= 70:
            recommendations.append("Strong match — focus on quantifying your achievements to stand out.")

        result = {
            "overall_score": overall_score,
            "similarity_score": round(float(similarity), 4),
            "matching_skills": matching_skills,
            "missing_skills": missing_skills,
            "keyword_overlap": {
                "shared": sorted(shared_keywords),
                "resume_only": sorted(resume_only),
                "job_only": sorted(job_only),
            },
            "recommendations": recommendations,
        }

        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
