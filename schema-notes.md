# Data model notes
The SQLite schema is initialized by `server.ts` on first start.
Core tables: users, languages, levels, topics, questions, test_cases, content_progress,
question_progress, submissions, belts, belt_achievements, activity_logs.

The app deliberately uses SQLite for localhost so no hosted database/API key is required.
For production, migrate the same relationships to PostgreSQL and move code execution to
a hardened isolated worker/container.
