# Coding Dojo Platform

A localhost-friendly Coding Dojo MVP with Student, Staff and Admin roles.

## Stack
- Node.js + Express + TypeScript
- SQLite (`better-sqlite3`) for zero-configuration local development
- Vanilla HTML/CSS/JS frontend served by Express
- Sandboxed local execution using child processes with timeout and output limits
- No online API keys required

## Run
1. Install Node.js 20+.
2. Extract the project.
3. Run `npm install`.
4. Copy `.env.example` to `.env` (optional; defaults work locally).
5. Run `npm run dev`.
6. Open `http://localhost:3000`.

## Demo accounts
- Student: `student@gmail.com` / `student123`
- Staff: `staff@gmail.com` / `staff123`
- Admin: `admin@gmail.com` / `admin123`

## Local runtimes
The runner detects installed commands:
- Python: `python` / `python3`
- C++: `g++`
- Java: `javac` / `java`
- JavaScript: Node.js

If a runtime is missing, the UI reports it instead of pretending execution succeeded.

## Important
This is designed for local demonstration/development. The code runner applies process/time/output limits but is not a replacement for a hardened production sandbox. For production, put execution in isolated containers/VMs with a dedicated unprivileged worker.
