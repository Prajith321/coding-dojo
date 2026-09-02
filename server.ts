import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);

const JWT_SECRET = process.env.JWT_SECRET || (isProd ? "" : "local-coding-dojo-secret-key-2026");

// DATABASE ABSTRACTION: POSTGRESQL (PRODUCTION) VS SQLITE (LOCAL DEV)
const pgConnectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
const isPg = Boolean(pgConnectionString);

let pgPool: Pool | null = null;
let sqliteDb: any = null;

function getPgPool(): Pool {
  if (!pgPool) {
    if (!pgConnectionString) {
      throw new Error("DATABASE_URL environment variable is missing for PostgreSQL connection.");
    }
    pgPool = new Pool({
      connectionString: pgConnectionString,
      ssl: process.env.DISABLE_PG_SSL ? false : { rejectUnauthorized: false }
    });
  }
  return pgPool;
}

function getSqliteDb(): any {
  if (!sqliteDb) {
    try {
      // Dynamic lazy require to prevent module load crash on Node runtimes without node:sqlite
      const { DatabaseSync } = require("node:sqlite");
      const dbPath = process.env.VERCEL
        ? path.join(os.tmpdir(), "dojo.sqlite")
        : path.join(process.cwd(), "dojo.sqlite");
      sqliteDb = new DatabaseSync(dbPath);
      sqliteDb.exec("PRAGMA journal_mode = WAL;");
    } catch (err: any) {
      throw new Error(`SQLite unavailable: ${err.message}. Please configure DATABASE_URL environment variable for PostgreSQL.`);
    }
  }
  return sqliteDb;
}

function convertSql(sql: string): string {
  if (!isPg) return sql;
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
}

async function dbAll(sql: string, params: any[] = []): Promise<any[]> {
  await ensureDbInitialized();
  if (isPg) {
    const res = await getPgPool().query(convertSql(sql), params);
    return res.rows;
  } else {
    return getSqliteDb().prepare(sql).all(...params) as any[];
  }
}

async function dbGet(sql: string, params: any[] = []): Promise<any> {
  await ensureDbInitialized();
  if (isPg) {
    const res = await getPgPool().query(convertSql(sql), params);
    return res.rows[0];
  } else {
    return getSqliteDb().prepare(sql).get(...params);
  }
}

async function dbRun(sql: string, params: any[] = []): Promise<{ lastInsertRowid: number; changes: number }> {
  await ensureDbInitialized();
  if (isPg) {
    let querySql = convertSql(sql);
    if (querySql.trim().toUpperCase().startsWith("INSERT") && !querySql.toUpperCase().includes("RETURNING")) {
      querySql += " RETURNING id";
    }
    const res = await getPgPool().query(querySql, params);
    const id = res.rows[0]?.id ? Number(res.rows[0].id) : 0;
    return { lastInsertRowid: id, changes: res.rowCount || 0 };
  } else {
    const res = getSqliteDb().prepare(sql).run(...params);
    return { lastInsertRowid: Number(res.lastInsertRowid), changes: Number(res.changes) };
  }
}

async function dbExec(sql: string): Promise<void> {
  if (isPg) {
    await getPgPool().query(sql);
  } else {
    getSqliteDb().exec(sql);
  }
}

app.use(cors());
app.use(express.json({ limit: "512kb" }));
app.use(cookieParser());
app.use(express.static(path.join(process.cwd(), "public")));

// HEALTH CHECK ENDPOINTS (LIGHTWEIGHT & INDEPENDENT)
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    environment: process.env.NODE_ENV || (process.env.VERCEL ? "production" : "development")
  });
});

app.get("/api/health/db", async (req, res) => {
  try {
    const row = await dbGet("SELECT 1 as connected");
    res.json({
      ok: true,
      database: isPg ? "postgresql" : "sqlite",
      connected: Boolean(row && (row.connected === 1 || row.connected === "1" || row.connected === true))
    });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      database: isPg ? "postgresql" : "sqlite",
      connected: false,
      error: err.message || "Database health check failed"
    });
  }
});

// LAZY DATABASE INITIALIZATION
let dbInitPromise: Promise<void> | null = null;

function ensureDbInitialized(): Promise<void> {
  if (!dbInitPromise) {
    dbInitPromise = seedDatabase().catch((err) => {
      console.error("Database initialization / seed error:", err.message);
      dbInitPromise = null; // allow retry on subsequent requests
      throw err;
    });
  }
  return dbInitPromise;
}

// Initialize Database Schema
async function initSchema() {
  const pkType = isPg ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";

  await dbExec(`
CREATE TABLE IF NOT EXISTS users (
  id ${pkType},
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  active INTEGER NOT NULL DEFAULT 1,
  selected_language TEXT DEFAULT 'Python',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id INTEGER PRIMARY KEY,
  xp INTEGER NOT NULL DEFAULT 0,
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  daily_goal_count INTEGER NOT NULL DEFAULT 0,
  daily_goal_date TEXT
);

CREATE TABLE IF NOT EXISTS languages (
  id ${pkType},
  name TEXT UNIQUE NOT NULL,
  icon TEXT DEFAULT 'code',
  description TEXT DEFAULT '',
  difficulty TEXT DEFAULT 'Beginner',
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS belts (
  id ${pkType},
  name TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  xp_required INTEGER NOT NULL DEFAULT 0,
  required_questions INTEGER NOT NULL DEFAULT 3,
  description TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS student_language_belts (
  user_id INTEGER NOT NULL,
  language_id INTEGER NOT NULL,
  current_belt_id INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(user_id, language_id)
);

CREATE TABLE IF NOT EXISTS belt_promotion_requests (
  id ${pkType},
  user_id INTEGER NOT NULL,
  language_id INTEGER NOT NULL,
  current_belt_id INTEGER NOT NULL,
  target_belt_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by INTEGER
);

CREATE TABLE IF NOT EXISTS topics (
  id ${pkType},
  language_id INTEGER NOT NULL,
  belt_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  line_explanation TEXT DEFAULT '',
  common_mistakes TEXT DEFAULT '',
  key_takeaways TEXT DEFAULT '',
  estimated_minutes INTEGER NOT NULL DEFAULT 15,
  sort_order INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS questions (
  id ${pkType},
  topic_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  input_desc TEXT NOT NULL,
  output_desc TEXT NOT NULL,
  constraints TEXT NOT NULL,
  example_input TEXT NOT NULL,
  example_output TEXT NOT NULL,
  explanation TEXT DEFAULT '',
  starter_code_py TEXT DEFAULT '',
  starter_code_js TEXT DEFAULT '',
  starter_code_cpp TEXT DEFAULT '',
  starter_code_java TEXT DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT 'Easy',
  xp_value INTEGER NOT NULL DEFAULT 50,
  required INTEGER NOT NULL DEFAULT 1,
  is_belt_test INTEGER NOT NULL DEFAULT 0,
  hint_1 TEXT DEFAULT '',
  hint_2 TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS test_cases (
  id ${pkType},
  question_id INTEGER NOT NULL,
  input TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 0,
  timeout_ms INTEGER NOT NULL DEFAULT 3000
);

CREATE TABLE IF NOT EXISTS content_progress (
  user_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  PRIMARY KEY(user_id, topic_id)
);

CREATE TABLE IF NOT EXISTS question_progress (
  user_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  solved INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  solved_at TEXT,
  PRIMARY KEY(user_id, question_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id ${pkType},
  user_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  language TEXT NOT NULL,
  code TEXT NOT NULL,
  passed INTEGER NOT NULL,
  visible_passed INTEGER NOT NULL,
  hidden_passed INTEGER NOT NULL,
  total_tests INTEGER NOT NULL,
  error_message TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS belt_achievements (
  user_id INTEGER NOT NULL,
  language_id INTEGER NOT NULL,
  belt_id INTEGER NOT NULL,
  achieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, language_id, belt_id)
);

CREATE TABLE IF NOT EXISTS achievements (
  id ${pkType},
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  xp_bonus INTEGER NOT NULL DEFAULT 25
);

CREATE TABLE IF NOT EXISTS student_achievements (
  user_id INTEGER NOT NULL,
  achievement_id INTEGER NOT NULL,
  unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  user_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, item_type, item_id)
);

CREATE TABLE IF NOT EXISTS staff_notes (
  id ${pkType},
  student_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id ${pkType},
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id ${pkType},
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
}

async function seedDatabase() {
  await initSchema();
  const userCount = await dbGet("SELECT COUNT(*) c FROM users");
  if (Number(userCount?.c || 0) === 0) {
    console.log("Seeding Coding Dojo Database...");

    const today = new Date().toISOString().split('T')[0];

    const resStudent = await dbRun("INSERT INTO users(name,email,password_hash,role,selected_language) VALUES(?,?,?,?,?)", ["Student Arun", "student@dojo.local", bcrypt.hashSync("student123", 10), "student", "Python"]);
    const sId = resStudent.lastInsertRowid;
    await dbRun("INSERT INTO student_profiles(user_id,xp,streak_days,last_active_date,daily_goal_count,daily_goal_date) VALUES(?,?,?,?,?,?)", [sId, 180, 6, today, 2, today]);

    const resStaff = await dbRun("INSERT INTO users(name,email,password_hash,role,selected_language) VALUES(?,?,?,?,?)", ["Staff Priya", "staff@dojo.local", bcrypt.hashSync("staff123", 10), "staff", "Python"]);
    const stId = resStaff.lastInsertRowid;
    await dbRun("INSERT INTO student_profiles(user_id,xp,streak_days,last_active_date,daily_goal_count,daily_goal_date) VALUES(?,?,?,?,?,?)", [stId, 0, 0, null, 0, null]);

    const resAdmin = await dbRun("INSERT INTO users(name,email,password_hash,role,selected_language) VALUES(?,?,?,?,?)", ["Admin Kumar", "admin@dojo.local", bcrypt.hashSync("admin123", 10), "admin", "Python"]);
    const aId = resAdmin.lastInsertRowid;
    await dbRun("INSERT INTO student_profiles(user_id,xp,streak_days,last_active_date,daily_goal_count,daily_goal_date) VALUES(?,?,?,?,?,?)", [aId, 0, 0, null, 0, null]);

    const beltList = [
      ["White Belt", "#E2E8F0", 1, 0, 3, "Foundation of programming fundamentals, variables, and standard I/O."],
      ["Yellow Belt", "#F59E0B", 2, 200, 3, "Basic conditions, branching logic, and decision making."],
      ["Orange Belt", "#F97316", 3, 500, 3, "Iteration, while loops, and for loop mechanics."],
      ["Green Belt", "#10B981", 4, 900, 4, "Functions, parameters, and return values."],
      ["Blue Belt", "#3B82F6", 5, 1400, 4, "Arrays, lists, and basic algorithms."],
      ["Purple Belt", "#8B5CF6", 6, 2000, 5, "Strings, characters, and parsing techniques."],
      ["Brown Belt", "#78350F", 7, 2800, 5, "Nested loops, 2D matrices, and search algorithms."],
      ["Black Belt", "#0F172A", 8, 4000, 6, "Mastery of problem solving, data structures, and optimization."]
    ];
    for (const b of beltList) {
      await dbRun("INSERT INTO belts(name,color_hex,sort_order,xp_required,required_questions,description) VALUES(?,?,?,?,?,?)", b);
    }

    await dbRun("INSERT INTO languages(name,icon,description,difficulty) VALUES(?,?,?,?)", ["Python", "snake", "Clean, highly readable code.", "Beginner"]);
    await dbRun("INSERT INTO languages(name,icon,description,difficulty) VALUES(?,?,?,?)", ["JavaScript", "code-js", "The language of the web.", "Beginner"]);
    await dbRun("INSERT INTO languages(name,icon,description,difficulty) VALUES(?,?,?,?)", ["C++", "cpu", "Fast, high-performance language.", "Intermediate"]);
    await dbRun("INSERT INTO languages(name,icon,description,difficulty) VALUES(?,?,?,?)", ["Java", "coffee", "Popular object-oriented enterprise language.", "Intermediate"]);

    const pyLang = (await dbGet("SELECT id FROM languages WHERE name='Python'")).id;
    const jsLang = (await dbGet("SELECT id FROM languages WHERE name='JavaScript'")).id;
    const cppLang = (await dbGet("SELECT id FROM languages WHERE name='C++'")).id;
    const javaLang = (await dbGet("SELECT id FROM languages WHERE name='Java'")).id;

    await dbRun("INSERT INTO student_language_belts(user_id,language_id,current_belt_id) VALUES(?,?,1)", [sId, pyLang]);
    await dbRun("INSERT INTO student_language_belts(user_id,language_id,current_belt_id) VALUES(?,?,1)", [sId, cppLang]);
    await dbRun("INSERT INTO student_language_belts(user_id,language_id,current_belt_id) VALUES(?,?,1)", [sId, jsLang]);
    await dbRun("INSERT INTO student_language_belts(user_id,language_id,current_belt_id) VALUES(?,?,1)", [sId, javaLang]);

    await dbRun("INSERT INTO belt_achievements(user_id,language_id,belt_id) VALUES(?,?,1)", [sId, pyLang]);

    await dbRun("INSERT INTO achievements(code,title,description,icon,xp_bonus) VALUES(?,?,?,?,?)", ["FIRST_STEP", "First Question Solved", "Pass all test cases on your first challenge.", "trophy", 25]);
    await dbRun("INSERT INTO achievements(code,title,description,icon,xp_bonus) VALUES(?,?,?,?,?)", ["STREAK_7", "7 Day Streak", "Maintain a 7-day coding practice streak.", "fire", 50]);
    await dbRun("INSERT INTO achievements(code,title,description,icon,xp_bonus) VALUES(?,?,?,?,?)", ["YELLOW_BELT", "Yellow Belt Earned", "Promoted to Yellow Belt status in Coding Dojo.", "award", 100]);

    await dbRun("INSERT INTO student_achievements(user_id,achievement_id) VALUES(?,1)", [sId]);

    const pyStarter = `import sys
lines = sys.stdin.read().split()
if len(lines) >= 2:
    a = int(lines[0])
    b = int(lines[1])
    print(a + b)
`;

    const jsStarter = `const fs = require('fs');
const input = fs.readFileSync('/dev/stdin', 'utf-8').trim().split(/\\s+/);
if (input.length >= 2) {
    const a = parseInt(input[0], 10);
    const b = parseInt(input[1], 10);
    console.log(a + b);
}
`;

    const cppStarter = `#include <iostream>
using namespace std;
int main() {
    int a, b;
    if (cin >> a >> b) {
        cout << (a + b);
    }
    return 0;
}
`;

    const allLangs = [
      { id: pyLang, name: "Python" },
      { id: cppLang, name: "C++" },
      { id: jsLang, name: "JavaScript" },
      { id: javaLang, name: "Java" }
    ];

    for (const l of allLangs) {
      const t1Res = await dbRun("INSERT INTO topics(language_id,belt_id,name,description,content,line_explanation,common_mistakes,key_takeaways,estimated_minutes,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)", [l.id, 1, `[White Belt] ${l.name} Variables & Input`, `Learn variables and console input in ${l.name}.`, `# ${l.name} Variables & Input\n\nVariables store values in memory. Read input and print expected output.`, `1. Read input.\n2. Calculate.\n3. Output result.`, `• Type casting errors.`, `1. Variables store state.`, 10, 1]);
      const t1 = t1Res.lastInsertRowid;

      const q1Res = await dbRun("INSERT INTO questions(topic_id,title,statement,input_desc,output_desc,constraints,example_input,example_output,explanation,starter_code_py,starter_code_js,starter_code_cpp,starter_code_java,difficulty,xp_value,required,is_belt_test,hint_1,hint_2) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [t1, `Sum of Two Numbers (${l.name})`, "Read two integers A and B and print their sum.", "Two space-separated integers A and B.", "A + B.", "-1000 <= A, B <= 1000", "5 10", "15", "5 + 10 = 15", pyStarter, jsStarter, cppStarter, "", "Easy", 50, 1, 1, "Read A and B", "Print sum"]);
      const q1 = q1Res.lastInsertRowid;
      for (const [i,o,v] of [["5 10","15",1],["20 30","50",1],["100 250","350",1],["-5 8","3",0],["0 0","0",0],["7 -2","5",0],["500 500","1000",0],["-100 -200","-300",0]]) {
        await dbRun("INSERT INTO test_cases(question_id,input,expected_output,visible) VALUES(?,?,?,?)", [q1, i, o, v]);
      }

      const q2Res = await dbRun("INSERT INTO questions(topic_id,title,statement,input_desc,output_desc,constraints,example_input,example_output,explanation,starter_code_py,starter_code_js,starter_code_cpp,starter_code_java,difficulty,xp_value,required,is_belt_test,hint_1,hint_2) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [t1, `Multiply Three Numbers (${l.name})`, "Read three integers A, B, and C and print their product.", "Three space-separated integers A, B, C.", "Product A * B * C.", "-100 <= A, B, C <= 100", "2 3 4", "24", "2 * 3 * 4 = 24", "", "", cppStarter, "", "Easy", 50, 1, 0, "Read 3 numbers", "Multiply"]);
      const q2 = q2Res.lastInsertRowid;
      for (const [i,o,v] of [["2 3 4","24",1],["5 0 10","0",1],["-2 4 5","-40",1],["1 1 1","1",0],["-3 -3 -3","-27",0],["10 20 30","6000",0],["7 8 2","112",0],["-5 2 -4","40",0]]) {
        await dbRun("INSERT INTO test_cases(question_id,input,expected_output,visible) VALUES(?,?,?,?)", [q2, i, o, v]);
      }

      const q3Res = await dbRun("INSERT INTO questions(topic_id,title,statement,input_desc,output_desc,constraints,example_input,example_output,explanation,starter_code_py,starter_code_js,starter_code_cpp,starter_code_java,difficulty,xp_value,required,is_belt_test,hint_1,hint_2) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [t1, `Square of N (${l.name})`, "Read a single integer N and print N squared.", "Single integer N.", "N * N.", "-1000 <= N <= 1000", "7", "49", "7 squared is 49", "", "", cppStarter, "", "Easy", 50, 1, 0, "Read N", "Compute N * N"]);
      const q3 = q3Res.lastInsertRowid;
      for (const [i,o,v] of [["7","49",1],["0","0",1],["-5","25",1],["12","144",0],["100","10000",0],["-15","225",0],["1","1",0],["9","81",0]]) {
        await dbRun("INSERT INTO test_cases(question_id,input,expected_output,visible) VALUES(?,?,?,?)", [q3, i, o, v]);
      }

      const t1bRes = await dbRun("INSERT INTO topics(language_id,belt_id,name,description,content,line_explanation,common_mistakes,key_takeaways,estimated_minutes,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)", [l.id, 1, `[White Belt] ${l.name} Basic Expressions`, `Master math expressions in ${l.name}.`, `# ${l.name} Expressions\n\nEvaluate mathematical expressions with precedence.`, `1. Evaluate operators.\n2. Compute result.`, `• Division by zero.`, `1. Order of operations.`, 10, 2]);
      const t1b = t1bRes.lastInsertRowid;
      const q1bRes = await dbRun("INSERT INTO questions(topic_id,title,statement,input_desc,output_desc,constraints,example_input,example_output,explanation,starter_code_py,starter_code_js,starter_code_cpp,starter_code_java,difficulty,xp_value,required,is_belt_test,hint_1,hint_2) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [t1b, `Perimeter of Rectangle (${l.name})`, "Read length L and width W, print 2*(L+W).", "Two integers L and W.", "Perimeter integer.", "1 <= L, W <= 1000", "5 10", "30", "2*(5+10)=30", "", "", cppStarter, "", "Easy", 50, 1, 0, "2 * (L + W)", "Print result"]);
      const q1b = q1bRes.lastInsertRowid;
      for (const [i,o,v] of [["5 10","30",1],["1 1","4",1],["10 20","60",1],["50 50","200",0],["100 200","600",0],["7 3","20",0],["12 8","40",0],["15 15","60",0]]) {
        await dbRun("INSERT INTO test_cases(question_id,input,expected_output,visible) VALUES(?,?,?,?)", [q1b, i, o, v]);
      }

      const t1cRes = await dbRun("INSERT INTO topics(language_id,belt_id,name,description,content,line_explanation,common_mistakes,key_takeaways,estimated_minutes,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)", [l.id, 1, `[White Belt] ${l.name} Formatting Output`, `Format text and values cleanly in ${l.name}.`, `# ${l.name} Formatting\n\nFormat console output string layout.`, `1. Read name.\n2. Output welcome text.`, `• Extra spaces.`, `1. Match string format.`, 10, 3]);
      const t1c = t1cRes.lastInsertRowid;
      const q1cRes = await dbRun("INSERT INTO questions(topic_id,title,statement,input_desc,output_desc,constraints,example_input,example_output,explanation,starter_code_py,starter_code_js,starter_code_cpp,starter_code_java,difficulty,xp_value,required,is_belt_test,hint_1,hint_2) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [t1c, `Double Value (${l.name})`, "Read integer N and print N*2.", "Single integer N.", "N * 2.", "-1000 <= N <= 1000", "8", "16", "8 * 2 = 16", "", "", cppStarter, "", "Easy", 50, 1, 0, "N * 2", "Print double"]);
      const q1c = q1cRes.lastInsertRowid;
      for (const [i,o,v] of [["8","16",1],["0","0",1],["-4","-8",1],["100","200",0],["50","100",0],["-15","-30",0],["7","14",0],["99","198",0]]) {
        await dbRun("INSERT INTO test_cases(question_id,input,expected_output,visible) VALUES(?,?,?,?)", [q1c, i, o, v]);
      }

      const t2Res = await dbRun("INSERT INTO topics(language_id,belt_id,name,description,content,line_explanation,common_mistakes,key_takeaways,estimated_minutes,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)", [l.id, 2, `[Yellow Belt] ${l.name} Conditional Logic`, `Master logic conditions in ${l.name}.`, `# ${l.name} Conditions\n\nBranch logic using if/else statements.`, `1. Evaluate expression.\n2. Branch code logic.`, `• Single = instead of ==.`, `1. If-else controls flow.`, 12, 4]);
      const t2 = t2Res.lastInsertRowid;
      const q4Res = await dbRun("INSERT INTO questions(topic_id,title,statement,input_desc,output_desc,constraints,example_input,example_output,explanation,starter_code_py,starter_code_js,starter_code_cpp,starter_code_java,difficulty,xp_value,required,is_belt_test,hint_1,hint_2) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [t2, `Even or Odd (${l.name})`, "Read integer N and print 'Even' if divisible by 2, else 'Odd'.", "Single integer N.", "'Even' or 'Odd'.", "-10000 <= N <= 10000", "4", "Even", "4 is divisible by 2", "", "", cppStarter, "", "Easy", 50, 1, 1, "Modulo % 2", "Print Even/Odd"]);
      const q4 = q4Res.lastInsertRowid;
      for (const [i,o,v] of [["4","Even",1],["7","Odd",1],["0","Even",1],["-3","Odd",0],["100","Even",0],["101","Odd",0],["-44","Even",0],["999","Odd",0]]) {
        await dbRun("INSERT INTO test_cases(question_id,input,expected_output,visible) VALUES(?,?,?,?)", [q4, i, o, v]);
      }

      const t3Res = await dbRun("INSERT INTO topics(language_id,belt_id,name,description,content,line_explanation,common_mistakes,key_takeaways,estimated_minutes,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)", [l.id, 3, `[Orange Belt] ${l.name} Loops & Iteration`, `Repeat tasks with loops in ${l.name}.`, `# ${l.name} Loops\n\nLoops iterate over ranges automatically.`, `1. Counter setup.\n2. Exit check.`, `• Infinite loops.`, `1. For loops repeat iterations.`, 15, 5]);
      const t3 = t3Res.lastInsertRowid;
      const q7Res = await dbRun("INSERT INTO questions(topic_id,title,statement,input_desc,output_desc,constraints,example_input,example_output,explanation,starter_code_py,starter_code_js,starter_code_cpp,starter_code_java,difficulty,xp_value,required,is_belt_test,hint_1,hint_2) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [t3, `Print 1 to N (${l.name})`, "Read integer N and print numbers from 1 to N space-separated.", "Single positive integer N.", "1 to N space-separated.", "1 <= N <= 100", "5", "1 2 3 4 5", "Prints 1 2 3 4 5", "", "", cppStarter, "", "Easy", 50, 1, 1, "Loop 1 to N", "Space-separated"]);
      const q7 = q7Res.lastInsertRowid;
      for (const [i,o,v] of [["5","1 2 3 4 5",1],["1","1",1],["3","1 2 3",1],["6","1 2 3 4 5 6",0],["8","1 2 3 4 5 6 7 8",0],["10","1 2 3 4 5 6 7 8 9 10",0],["2","1 2",0],["4","1 2 3 4",0]]) {
        await dbRun("INSERT INTO test_cases(question_id,input,expected_output,visible) VALUES(?,?,?,?)", [q7, i, o, v]);
      }

      if (l.name === "Python") {
        await dbRun("INSERT INTO question_progress(user_id,question_id,solved,attempts,solved_at) VALUES(?,?,1,1,CURRENT_TIMESTAMP)", [sId, q1]);
        await dbRun("INSERT INTO question_progress(user_id,question_id,solved,attempts,solved_at) VALUES(?,?,1,1,CURRENT_TIMESTAMP)", [sId, q1b]);
        await dbRun("INSERT INTO question_progress(user_id,question_id,solved,attempts,solved_at) VALUES(?,?,1,1,CURRENT_TIMESTAMP)", [sId, q1c]);
        await dbRun("INSERT INTO content_progress(user_id,topic_id,completed_at) VALUES(?,? ,CURRENT_TIMESTAMP)", [sId, t1]);
        await dbRun("INSERT INTO content_progress(user_id,topic_id,completed_at) VALUES(?,? ,CURRENT_TIMESTAMP)", [sId, t1b]);
        await dbRun("INSERT INTO content_progress(user_id,topic_id,completed_at) VALUES(?,? ,CURRENT_TIMESTAMP)", [sId, t1c]);
      }
    }

    await dbRun("INSERT INTO staff_notes(student_id,staff_id,note) VALUES(?,?,?)", [sId, stId, "Student Arun completed 3 topics in Python and is ready for Yellow Belt Promotion Test."]);
    console.log("Database seeded successfully!");
  }
}

type AuthReq = express.Request & { user?: any };

function authMiddleware(req: AuthReq, res: express.Response, next: express.NextFunction) {
  if (isProd && !JWT_SECRET) {
    return res.status(500).json({ error: "Server configuration error: JWT_SECRET environment variable is not defined." });
  }

  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.token;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, JWT_SECRET || "local-coding-dojo-secret-key-2026");
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

function requireRole(...allowedRoles: string[]) {
  return (req: AuthReq, res: express.Response, next: express.NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied. Insufficient permissions." });
    }
    next();
  };
}

async function logActivity(userId: number, action: string, meta: any = "") {
  try {
    await dbRun("INSERT INTO activity_logs(user_id,action,meta) VALUES(?,?,?)", [userId, action, JSON.stringify(meta)]);
  } catch (err) {
    console.error("Activity log error:", err);
  }
}

async function addStudentXP(userId: number, xpAmount: number) {
  const profile: any = await dbGet("SELECT * FROM student_profiles WHERE user_id=?", [userId]);
  if (!profile) return;

  const today = new Date().toISOString().split('T')[0];
  let newStreak = profile.streak_days;

  if (profile.last_active_date) {
    const lastDate = new Date(profile.last_active_date);
    const currentDate = new Date(today);
    const diffDays = Math.floor((currentDate.getTime() - lastDate.getTime()) / (1000 * 3600 * 24));
    
    if (diffDays === 1) newStreak += 1;
    else if (diffDays > 1) newStreak = 1;
  } else {
    newStreak = 1;
  }

  const newXP = profile.xp + xpAmount;
  await dbRun("UPDATE student_profiles SET xp=?, streak_days=?, last_active_date=? WHERE user_id=?", [newXP, newStreak, today, userId]);
}

function normalizeOutput(str: string): string {
  return String(str || "").replace(/\r/g, "").trim().split(/\s+/).join(" ");
}

function execProcess(command: string, args: string[], input: string, timeoutMs: number = 3000): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const proc = spawn(command, args, { windowsHide: true });
    
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    if (input) {
      proc.stdin.write(input);
    }
    proc.stdin.end();

    proc.stdout?.on("data", (d) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code || 0, stdout, stderr, timedOut });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout: "", stderr: err.message, timedOut: false });
    });
  });
}

// LOCAL PROCESS RUNNER (DEVELOPMENT ONLY)
async function runLocalStudentCode(language: string, code: string, input: string, timeoutMs: number = 3000) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojo-run-"));
  let cmd = "", args: string[] = [], filePath = "";

  try {
    if (language === "Python") {
      filePath = path.join(tempDir, "solution.py");
      fs.writeFileSync(filePath, code || "");
      cmd = process.platform === "win32" ? "python" : "python3";
      args = [filePath];

      let res = await execProcess(cmd, args, input, timeoutMs);
      if (res.code !== 0 && process.platform === "win32") {
        res = await execProcess("py", args, input, timeoutMs);
      }
      const outText = res.stdout || res.stderr || (res.timedOut ? "Time Limit Exceeded" : "");
      return { passed: res.code === 0 && !res.timedOut, error: res.stderr, output: outText };
    } else if (language === "JavaScript") {
      filePath = path.join(tempDir, "solution.js");
      fs.writeFileSync(filePath, code || "");
      cmd = "node";
      args = [filePath];
      const res = await execProcess(cmd, args, input, timeoutMs);
      const outText = res.stdout || res.stderr || (res.timedOut ? "Time Limit Exceeded" : "");
      return { passed: res.code === 0 && !res.timedOut, error: res.stderr, output: outText };
    } else if (language === "C++") {
      filePath = path.join(tempDir, "solution.cpp");
      const exePath = path.join(tempDir, "solution" + (process.platform === "win32" ? ".exe" : ""));
      fs.writeFileSync(filePath, code || "");
      const compile = await execProcess("g++", [filePath, "-O2", "-std=c++17", "-o", exePath], "", 5000);
      if (compile.code !== 0) {
        return { passed: false, error: "Compilation error", output: compile.stderr || "g++ failed to compile code." };
      }
      cmd = exePath;
      args = [];
      const res = await execProcess(cmd, args, input, timeoutMs);
      const outText = res.stdout || res.stderr || (res.timedOut ? "Time Limit Exceeded" : "");
      return { passed: res.code === 0 && !res.timedOut, error: res.stderr, output: outText };
    } else if (language === "Java") {
      filePath = path.join(tempDir, "Main.java");
      fs.writeFileSync(filePath, code || "");
      const compile = await execProcess("javac", [filePath], "", 5000);
      if (compile.code !== 0) {
        return { passed: false, error: "Compilation error", output: compile.stderr || "javac failed to compile code." };
      }
      cmd = "java";
      args = ["-cp", tempDir, "Main"];
      const res = await execProcess(cmd, args, input, timeoutMs);
      const outText = res.stdout || res.stderr || (res.timedOut ? "Time Limit Exceeded" : "");
      return { passed: res.code === 0 && !res.timedOut, error: res.stderr, output: outText };
    } else {
      return { passed: false, error: "Unsupported language", output: "" };
    }
  } catch (err: any) {
    return { passed: false, error: "System Error", output: err.message };
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

// PRODUCTION CODE EXECUTION ENGINE: JUDGE0 CE SANDBOX API
async function runStudentCode(language: string, code: string, input: string, timeoutMs: number = 3000) {
  const judge0Url = process.env.JUDGE0_URL || process.env.EXECUTION_API_URL || process.env.JUDGE0_API_URL || "https://ce.judge0.com";
  const judge0Key = process.env.JUDGE0_API_KEY || process.env.EXECUTION_API_KEY || "";

  const langIdMap: Record<string, number> = {
    Python: 71,
    JavaScript: 63,
    "C++": 54,
    Java: 62
  };

  const langId = langIdMap[language] || 71;

  if (judge0Url) {
    try {
      const baseUrl = judge0Url.replace(/\/$/, "");
      const url = `${baseUrl}/submissions?wait=true&base64_encoded=false`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (judge0Key) {
        headers["X-RapidAPI-Key"] = judge0Key;
        headers["X-RapidAPI-Host"] = new URL(baseUrl).hostname;
        headers["X-Auth-Token"] = judge0Key;
      }

      const body = {
        source_code: code || "",
        language_id: langId,
        stdin: input || "",
        cpu_time_limit: Math.ceil(timeoutMs / 1000)
      };

      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (resp.ok) {
        const data = await resp.json();
        const stdout = data.stdout || "";
        const stderr = data.stderr || data.compile_output || "";
        const statusDescription = data.status?.description || "";
        const statusCode = data.status?.id;

        const isPassed = statusCode === 3; // 3 = Accepted
        let errorMessage = stderr;

        if (!isPassed && !errorMessage) {
          errorMessage = statusDescription || "Execution failed";
        }

        const outputText = stdout || stderr || statusDescription || "No output generated.";

        return {
          passed: isPassed,
          error: errorMessage,
          output: outputText
        };
      } else {
        const errText = await resp.text();
        console.error("Judge0 API HTTP error:", resp.status, errText);
      }
    } catch (err: any) {
      console.error("Judge0 API invocation error:", err.message);
    }
  }

  if (isProd) {
    return {
      passed: false,
      error: "Production execution error: Judge0 Sandbox Service is unconfigured or unreachable.",
      output: "Code execution sandbox unavailable in production environment."
    };
  }

  return runLocalStudentCode(language, code, input, timeoutMs);
}

// AUTH
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, language } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: "Name, email, and password required" });

    const existing = await dbGet("SELECT id FROM users WHERE lower(email)=lower(?)", [email]);
    if (existing) return res.status(400).json({ error: "Email is already registered" });

    const hash = bcrypt.hashSync(password, 10);
    const result = await dbRun("INSERT INTO users(name,email,password_hash,role,selected_language) VALUES(?,?,?,'student',?)", [name, email, hash, language || "Python"]);
    const userId = result.lastInsertRowid;

    const today = new Date().toISOString().split('T')[0];
    await dbRun("INSERT INTO student_profiles(user_id,xp,streak_days,last_active_date) VALUES(?,0,1,?)", [userId, today]);
    
    const langs = await dbAll("SELECT id FROM languages");
    for (const l of langs) {
      await dbRun("INSERT INTO student_language_belts(user_id,language_id,current_belt_id) VALUES(?,?,1)", [userId, l.id]);
      await dbRun("INSERT INTO belt_achievements(user_id,language_id,belt_id) VALUES(?,?,1)", [userId, l.id]);
    }

    const token = jwt.sign({ id: userId, name, email, role: "student" }, JWT_SECRET || "local-coding-dojo-secret-key-2026", { expiresIn: "7d" });
    res.cookie("token", token, { httpOnly: true, sameSite: "lax" });

    await logActivity(userId, "register");
    res.json({ user: { id: userId, name, email, role: "student", selected_language: language || "Python" } });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Registration failed" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const u: any = await dbGet("SELECT * FROM users WHERE lower(email)=lower(?) AND active=1", [email || ""]);
    if (!u || !bcrypt.compareSync(password || "", u.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign({ id: u.id, name: u.name, email: u.email, role: u.role }, JWT_SECRET || "local-coding-dojo-secret-key-2026", { expiresIn: "7d" });
    res.cookie("token", token, { httpOnly: true, sameSite: "lax" });

    await logActivity(u.id, "login");
    res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role, selected_language: u.selected_language } });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Login failed" });
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

app.get("/api/me", authMiddleware, async (req: AuthReq, res) => {
  try {
    const u: any = await dbGet("SELECT id, name, email, role, selected_language FROM users WHERE id=?", [req.user.id]);
    if (!u) return res.status(404).json({ error: "User not found" });

    const profile: any = (await dbGet("SELECT * FROM student_profiles WHERE user_id=?", [u.id])) || { xp: 0, streak_days: 0 };
    res.json({ user: { ...u, profile } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/onboarding", authMiddleware, async (req: AuthReq, res) => {
  try {
    const { language } = req.body || {};
    if (language) {
      await dbRun("UPDATE users SET selected_language=? WHERE id=?", [language, req.user.id]);
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// CURRICULUM
app.get("/api/languages", async (req, res) => {
  try {
    res.json(await dbAll("SELECT * FROM languages WHERE enabled=1 ORDER BY id"));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/languages/:name/belt-details", authMiddleware, async (req: AuthReq, res) => {
  try {
    const uid = req.user.id;
    const langName = String(req.params.name);

    const lang: any = await dbGet("SELECT id, name FROM languages WHERE name=?", [langName]);
    if (!lang) return res.status(404).json({ error: "Language not found" });

    const slb: any = (await dbGet("SELECT current_belt_id FROM student_language_belts WHERE user_id=? AND language_id=?", [uid, lang.id])) || { current_belt_id: 1 };
    const currentBelt: any = await dbGet("SELECT * FROM belts WHERE id=?", [slb.current_belt_id]);
    const nextBelt: any = await dbGet("SELECT * FROM belts WHERE sort_order > ? ORDER BY sort_order ASC LIMIT 1", [currentBelt ? currentBelt.sort_order : 1]);

    const completedTopicsCount = Number((await dbGet(`
      SELECT COUNT(DISTINCT cp.topic_id) c FROM content_progress cp
      JOIN topics t ON t.id = cp.topic_id
      WHERE cp.user_id=? AND t.language_id=? AND cp.completed_at IS NOT NULL
    `, [uid, lang.id]))?.c || 0);

    const totalTopicsCount = Number((await dbGet("SELECT COUNT(*) c FROM topics WHERE language_id=? AND active=1", [lang.id]))?.c || 0);
    const pendingReq: any = await dbGet("SELECT * FROM belt_promotion_requests WHERE user_id=? AND language_id=? ORDER BY id DESC LIMIT 1", [uid, lang.id]);

    res.json({
      language: lang,
      currentBelt,
      nextBelt,
      completedTopicsCount,
      totalTopicsCount,
      canApplyPromotion: completedTopicsCount >= 3,
      promotionRequest: pendingReq
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/topics", authMiddleware, async (req: AuthReq, res) => {
  try {
    const langName = String(req.query.language || req.user.selected_language || "Python");
    const topics = await dbAll(`
      SELECT t.*, b.name belt_name, b.color_hex belt_color, l.name language_name,
             CASE WHEN cp.completed_at IS NOT NULL THEN 1 ELSE 0 END completed,
             (SELECT COUNT(*) FROM questions q WHERE q.topic_id = t.id AND q.active=1) question_count
      FROM topics t
      JOIN languages l ON l.id = t.language_id
      JOIN belts b ON b.id = t.belt_id
      LEFT JOIN content_progress cp ON cp.topic_id = t.id AND cp.user_id = ?
      WHERE l.name = ? AND t.active = 1
      ORDER BY b.sort_order ASC, t.sort_order ASC
    `, [req.user.id, langName]);

    res.json(topics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/topics/:id", authMiddleware, async (req: AuthReq, res) => {
  try {
    const tId = Number(req.params.id);
    const topic: any = await dbGet(`
      SELECT t.*, l.name language_name, b.name belt_name, b.color_hex belt_color
      FROM topics t
      JOIN languages l ON l.id = t.language_id
      JOIN belts b ON b.id = t.belt_id
      WHERE t.id = ?
    `, [tId]);

    if (!topic) return res.status(404).json({ error: "Topic not found" });

    await dbRun("INSERT INTO content_progress(user_id,topic_id) VALUES(?,?) ON CONFLICT DO NOTHING", [req.user.id, topic.id]);
    const questions = await dbAll(`
      SELECT q.id, q.title, q.difficulty, q.xp_value, q.required,
             COALESCE(qp.solved, 0) solved, COALESCE(qp.attempts, 0) attempts
      FROM questions q
      LEFT JOIN question_progress qp ON qp.question_id = q.id AND qp.user_id = ?
      WHERE q.topic_id = ? AND q.active = 1
      ORDER BY q.id ASC
    `, [req.user.id, topic.id]);

    res.json({ ...topic, questions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/topics/:id/complete", authMiddleware, async (req: AuthReq, res) => {
  try {
    const tId = Number(req.params.id);
    await dbRun("UPDATE content_progress SET completed_at=CURRENT_TIMESTAMP WHERE user_id=? AND topic_id=?", [req.user.id, tId]);
    await addStudentXP(req.user.id, 10);
    await logActivity(req.user.id, "topic_completed", { topicId: tId });
    res.json({ ok: true, xpEarned: 10 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// BELT PROMOTION EXAM & TEST CASE EVALUATION
app.post("/api/belt-promotion/request", authMiddleware, async (req: AuthReq, res) => {
  try {
    const { language } = req.body || {};
    const uid = req.user.id;

    const lang: any = await dbGet("SELECT id FROM languages WHERE name=?", [language]);
    if (!lang) return res.status(400).json({ error: "Invalid language" });

    const completedCount = Number((await dbGet(`
      SELECT COUNT(DISTINCT cp.topic_id) c FROM content_progress cp
      JOIN topics t ON t.id = cp.topic_id
      WHERE cp.user_id=? AND t.language_id=? AND cp.completed_at IS NOT NULL
    `, [uid, lang.id]))?.c || 0);

    if (completedCount < 3) {
      return res.status(400).json({ error: "Minimum 3 completed topics required to apply for Belt Promotion." });
    }

    const slb: any = (await dbGet("SELECT current_belt_id FROM student_language_belts WHERE user_id=? AND language_id=?", [uid, lang.id])) || { current_belt_id: 1 };
    const nextBelt: any = await dbGet("SELECT id FROM belts WHERE sort_order > (SELECT sort_order FROM belts WHERE id=?) ORDER BY sort_order ASC LIMIT 1", [slb.current_belt_id]);

    if (!nextBelt) return res.status(400).json({ error: "You are already at Black Belt rank!" });

    await dbRun(`
      INSERT INTO belt_promotion_requests(user_id, language_id, current_belt_id, target_belt_id, status)
      VALUES(?, ?, ?, ?, 'pending')
    `, [uid, lang.id, slb.current_belt_id, nextBelt.id]);

    await logActivity(uid, "promotion_requested", { language, targetBeltId: nextBelt.id });
    res.json({ ok: true, message: "Belt promotion request submitted to Sensei Staff for review!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/belt-test/exam", authMiddleware, async (req: AuthReq, res) => {
  try {
    const uid = req.user.id;
    const langName = String(req.query.language || "Python");

    const lang: any = await dbGet("SELECT id, name FROM languages WHERE name=?", [langName]);
    if (!lang) return res.status(404).json({ error: "Language not found" });

    const bpr: any = await dbGet(`
      SELECT bpr.*, tb.name target_belt_name, tb.color_hex target_belt_color
      FROM belt_promotion_requests bpr
      JOIN belts tb ON tb.id = bpr.target_belt_id
      WHERE bpr.user_id=? AND bpr.language_id=? AND bpr.status='approved'
      ORDER BY bpr.id DESC LIMIT 1
    `, [uid, lang.id]);

    if (!bpr) return res.status(403).json({ error: "No approved belt promotion exam found." });

    let examQuestions = await dbAll(`
      SELECT q.id, q.title, q.statement, q.input_desc, q.output_desc, q.example_input, q.example_output, t.name topic_name
      FROM questions q
      JOIN topics t ON t.id = q.topic_id
      WHERE t.language_id=? AND q.is_belt_test=1 AND q.active=1
      LIMIT 3
    `, [lang.id]);

    if (examQuestions.length < 3) {
      const topics = await dbAll("SELECT id, name FROM topics WHERE language_id=? AND active=1 ORDER BY sort_order ASC LIMIT 3", [lang.id]);
      examQuestions = [];
      for (const t of topics) {
        const q: any = await dbGet("SELECT id, title, statement, input_desc, output_desc, example_input, example_output FROM questions WHERE topic_id=? AND active=1 LIMIT 1", [t.id]);
        if (q) {
          examQuestions.push({ ...q, topic_name: t.name });
        }
      }
    }

    const enrichedQuestions = [];
    for (const q of examQuestions) {
      const visibleCases = await dbAll("SELECT id, input, expected_output FROM test_cases WHERE question_id=? AND visible=1", [q.id]);
      const hiddenCount = Number((await dbGet("SELECT COUNT(*) c FROM test_cases WHERE question_id=? AND visible=0", [q.id]))?.c || 0);
      enrichedQuestions.push({ ...q, visibleTestCases: visibleCases, hiddenTestCasesCount: hiddenCount });
    }

    res.json({ promotionRequest: bpr, language: lang, examQuestions: enrichedQuestions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/belt-test/run-question", authMiddleware, async (req: AuthReq, res) => {
  try {
    const { questionId, code, language } = req.body || {};
    const qId = Number(questionId);

    const q: any = await dbGet("SELECT * FROM questions WHERE id=? AND active=1", [qId]);
    if (!q) return res.status(404).json({ error: "Question not found" });

    const allTestCases = await dbAll("SELECT * FROM test_cases WHERE question_id=? ORDER BY visible DESC, id ASC", [qId]);

    const visibleResults = [];
    let hiddenPassedCount = 0;
    let hiddenTotalCount = 0;
    let allPassed = true;

    for (const tc of allTestCases) {
      const exec = await runStudentCode(language || "Python", code || "", tc.input, tc.timeout_ms || 3000);
      const normalizedActual = normalizeOutput(exec.output);
      const normalizedExpected = normalizeOutput(tc.expected_output);
      const passed = exec.passed && normalizedActual === normalizedExpected;

      if (!passed) allPassed = false;

      if (tc.visible === 1) {
        visibleResults.push({
          testNumber: visibleResults.length + 1,
          input: tc.input,
          expectedOutput: tc.expected_output,
          actualOutput: exec.output,
          status: passed ? "passed" : exec.error || "failed"
        });
      } else {
        hiddenTotalCount++;
        if (passed) hiddenPassedCount++;
      }
    }

    res.json({
      visibleTests: visibleResults,
      hiddenTests: {
        passed: hiddenPassedCount,
        total: hiddenTotalCount
      },
      allPassed
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/belt-test/submit", authMiddleware, async (req: AuthReq, res) => {
  try {
    const uid = req.user.id;
    const { language, answers } = req.body || {};

    const lang: any = await dbGet("SELECT id, name FROM languages WHERE name=?", [language]);
    if (!lang) return res.status(400).json({ error: "Invalid language" });

    const bpr: any = await dbGet("SELECT * FROM belt_promotion_requests WHERE user_id=? AND language_id=? AND status='approved' ORDER BY id DESC LIMIT 1", [uid, lang.id]);
    if (!bpr) return res.status(403).json({ error: "No active approved promotion exam." });

    let allQuestionsPassed = true;
    const results = [];

    for (const [qIdStr, codeStr] of Object.entries(answers || {})) {
      const qId = Number(qIdStr);
      const testCases = await dbAll("SELECT * FROM test_cases WHERE question_id=?", [qId]);
      let qPassed = true;

      for (const tc of testCases) {
        const exec = await runStudentCode(lang.name, String(codeStr || ""), tc.input, tc.timeout_ms || 3000);
        if (!exec.passed || normalizeOutput(exec.output) !== normalizeOutput(tc.expected_output)) {
          qPassed = false;
          break;
        }
      }

      if (!qPassed) allQuestionsPassed = false;
      results.push({ questionId: qId, passed: qPassed });
    }

    if (allQuestionsPassed && results.length >= 3) {
      await dbRun("UPDATE student_language_belts SET current_belt_id=? WHERE user_id=? AND language_id=?", [bpr.target_belt_id, uid, lang.id]);
      await dbRun("UPDATE belt_promotion_requests SET status='completed' WHERE id=?", [bpr.id]);
      await dbRun("INSERT INTO belt_achievements(user_id,language_id,belt_id) VALUES(?,?,?) ON CONFLICT DO NOTHING", [uid, lang.id, bpr.target_belt_id]);
      
      await addStudentXP(uid, 100);

      const newBelt: any = await dbGet("SELECT * FROM belts WHERE id=?", [bpr.target_belt_id]);
      await dbRun("INSERT INTO notifications(user_id,title,message,type) VALUES(?,?,?,?)", [
        uid,
        `🥋 BELT PROMOTION ACHIEVED!`,
        `Congratulations! You passed all 3 exam questions and earned your ${newBelt.name} in ${lang.name}!`,
        "belt"
      ]);

      await logActivity(uid, "belt_promoted", { language: lang.name, beltId: bpr.target_belt_id });
      return res.json({ success: true, message: `🎉 Promotion Achieved! You earned your ${newBelt.name} in ${lang.name}!`, belt: newBelt });
    } else {
      await dbRun("UPDATE belt_promotion_requests SET status='failed' WHERE id=?", [bpr.id]);
      return res.json({ success: false, message: "Promotion exam not passed. Make sure to pass all test cases for all 3 questions. You can re-apply later!" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ADMIN FEATURES: CONTENT CREATOR & BELT TEST QUESTION MANAGER
app.post("/api/admin/topics", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const { language_name, belt_name, name, description, content } = req.body || {};
    if (!language_name || !name || !content) return res.status(400).json({ error: "Language, topic name, and content required" });

    const lang: any = await dbGet("SELECT id FROM languages WHERE name=?", [language_name]);
    if (!lang) return res.status(400).json({ error: "Invalid language" });

    const belt: any = await dbGet("SELECT id FROM belts WHERE name=?", [belt_name || "White Belt"]);
    const beltId = belt ? belt.id : 1;

    const result = await dbRun(`
      INSERT INTO topics(language_id, belt_id, name, description, content, sort_order)
      VALUES(?, ?, ?, ?, ?, 99)
    `, [lang.id, beltId, name, description || '', content]);

    res.json({ ok: true, topicId: result.lastInsertRowid, message: "Topic created successfully!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/questions", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const { topic_id, title, statement, input_desc, output_desc, example_input, example_output, starter_code, is_belt_test, test_cases } = req.body || {};
    if (!topic_id || !title || !statement) return res.status(400).json({ error: "Topic ID, title, and statement required" });

    const result = await dbRun(`
      INSERT INTO questions(topic_id, title, statement, input_desc, output_desc, constraints, example_input, example_output, is_belt_test)
      VALUES(?, ?, ?, ?, ?, 'Standard Constraints', ?, ?, ?)
    `, [topic_id, title, statement, input_desc || '', output_desc || '', example_input || '', example_output || '', is_belt_test ? 1 : 0]);

    const qId = result.lastInsertRowid;

    if (Array.isArray(test_cases)) {
      for (const tc of test_cases) {
        if (tc.input !== undefined && tc.expected_output !== undefined) {
          await dbRun("INSERT INTO test_cases(question_id, input, expected_output, visible) VALUES(?,?,?,?)", [qId, String(tc.input), String(tc.expected_output), tc.visible ? 1 : 0]);
        }
      }
    }

    res.json({ ok: true, questionId: qId, message: "Question and test cases created!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/belt-test-questions", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const questions = await dbAll(`
      SELECT q.*, t.name topic_name, l.name language_name, b.name belt_name
      FROM questions q
      JOIN topics t ON t.id = q.topic_id
      JOIN languages l ON l.id = t.language_id
      JOIN belts b ON b.id = t.belt_id
      WHERE q.is_belt_test = 1 OR q.active = 1
      ORDER BY l.id ASC, b.sort_order ASC, q.id DESC
    `);
    res.json(questions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/questions/:id", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const qId = Number(req.params.id);
    const { title, statement, is_belt_test } = req.body || {};

    await dbRun(`
      UPDATE questions SET title=?, statement=?, is_belt_test=? WHERE id=?
    `, [title, statement, is_belt_test ? 1 : 0, qId]);

    res.json({ ok: true, message: "Question updated successfully!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/questions/:id", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const qId = Number(req.params.id);
    await dbRun("DELETE FROM test_cases WHERE question_id=?", [qId]);
    await dbRun("DELETE FROM questions WHERE id=?", [qId]);
    res.json({ ok: true, message: "Question deleted successfully!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// STAFF PORTAL
app.get("/api/staff/promotions", authMiddleware, requireRole("staff", "admin"), async (req, res) => {
  try {
    const requests = await dbAll(`
      SELECT bpr.*, u.name student_name, u.email student_email, l.name language_name,
             cb.name current_belt_name, tb.name target_belt_name
      FROM belt_promotion_requests bpr
      JOIN users u ON u.id = bpr.user_id
      JOIN languages l ON l.id = bpr.language_id
      JOIN belts cb ON cb.id = bpr.current_belt_id
      JOIN belts tb ON tb.id = bpr.target_belt_id
      WHERE bpr.status = 'pending'
      ORDER BY bpr.id DESC
    `);
    res.json(requests);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/staff/promotions/:id/review", authMiddleware, requireRole("staff", "admin"), async (req: AuthReq, res) => {
  try {
    const reqId = Number(req.params.id);
    const { action } = req.body || {};

    const bpr: any = await dbGet("SELECT * FROM belt_promotion_requests WHERE id=?", [reqId]);
    if (!bpr) return res.status(404).json({ error: "Promotion request not found" });

    const status = action === 'approved' ? 'approved' : 'rejected';
    await dbRun("UPDATE belt_promotion_requests SET status=?, reviewed_at=CURRENT_TIMESTAMP, reviewed_by=? WHERE id=?", [status, req.user.id, reqId]);

    const lang: any = await dbGet("SELECT name FROM languages WHERE id=?", [bpr.language_id]);

    if (action === 'approved') {
      await dbRun("INSERT INTO notifications(user_id,title,message,type) VALUES(?,?,?,?)", [
        bpr.user_id,
        "🥋 Promotion Approved!",
        `Sensei has approved your promotion test for ${lang?.name || 'Language'}! Open Belt Test page to complete 3 exam questions.`,
        "belt"
      ]);
    } else {
      await dbRun("INSERT INTO notifications(user_id,title,message,type) VALUES(?,?,?,?)", [
        bpr.user_id,
        "⚠️ Promotion Request Rejected",
        `Sensei reviewed your promotion request for ${lang?.name || 'Language'}. Please practice topics further and feel free to re-apply anytime!`,
        "info"
      ]);
    }

    await logActivity(req.user.id, "promotion_reviewed", { requestId: reqId, status });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// QUESTIONS & TESTS
app.get("/api/questions/:id", authMiddleware, async (req: AuthReq, res) => {
  try {
    const qId = Number(req.params.id);
    const q: any = await dbGet(`
      SELECT q.*, t.name topic_name, l.name language_name, b.name belt_name
      FROM questions q
      JOIN topics t ON t.id = q.topic_id
      JOIN languages l ON l.id = t.language_id
      JOIN belts b ON b.id = t.belt_id
      WHERE q.id = ? AND q.active = 1
    `, [qId]);

    if (!q) return res.status(404).json({ error: "Question not found" });

    const visibleCases = await dbAll("SELECT id, input, expected_output, timeout_ms FROM test_cases WHERE question_id=? AND visible=1 ORDER BY id ASC", [q.id]);
    const hiddenCount = Number((await dbGet("SELECT COUNT(*) c FROM test_cases WHERE question_id=? AND visible=0", [q.id]))?.c || 0);

    const progress: any = (await dbGet("SELECT solved, attempts FROM question_progress WHERE user_id=? AND question_id=?", [req.user.id, q.id])) || { solved: 0, attempts: 0 };
    const isBookmarked = (await dbGet("SELECT 1 FROM bookmarks WHERE user_id=? AND item_type='question' AND item_id=?", [req.user.id, q.id])) ? 1 : 0;

    res.json({
      ...q,
      visibleTestCases: visibleCases,
      hiddenTestCasesCount: hiddenCount,
      solved: progress.solved,
      attempts: progress.attempts,
      bookmarked: isBookmarked
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/questions/:id/run", authMiddleware, async (req: AuthReq, res) => {
  try {
    const { code, language } = req.body || {};
    const qId = Number(req.params.id);

    const q: any = await dbGet("SELECT * FROM questions WHERE id=? AND active=1", [qId]);
    if (!q) return res.status(404).json({ error: "Question not found" });

    const allTestCases = await dbAll("SELECT * FROM test_cases WHERE question_id=? ORDER BY visible DESC, id ASC", [qId]);

    const visibleResults = [];
    let hiddenPassedCount = 0;
    let hiddenTotalCount = 0;
    let allPassed = true;

    for (const tc of allTestCases) {
      const exec = await runStudentCode(language || "Python", code || "", tc.input, tc.timeout_ms || 3000);
      const normalizedActual = normalizeOutput(exec.output);
      const normalizedExpected = normalizeOutput(tc.expected_output);
      const passed = exec.passed && normalizedActual === normalizedExpected;

      if (!passed) allPassed = false;

      if (tc.visible === 1) {
        visibleResults.push({
          testNumber: visibleResults.length + 1,
          input: tc.input,
          expectedOutput: tc.expected_output,
          actualOutput: exec.output,
          status: passed ? "passed" : exec.error || "failed"
        });
      } else {
        hiddenTotalCount++;
        if (passed) hiddenPassedCount++;
      }
    }

    if (isPg) {
      await dbRun("INSERT INTO question_progress(user_id, question_id, attempts) VALUES(?, ?, 1) ON CONFLICT(user_id, question_id) DO UPDATE SET attempts = question_progress.attempts + 1", [req.user.id, qId]);
    } else {
      await dbRun("INSERT INTO question_progress(user_id, question_id, attempts) VALUES(?, ?, 1) ON CONFLICT(user_id, question_id) DO UPDATE SET attempts = attempts + 1", [req.user.id, qId]);
    }

    res.json({
      status: "completed",
      visibleTests: visibleResults,
      hiddenTests: {
        passed: hiddenPassedCount,
        total: hiddenTotalCount
      },
      canSubmit: allPassed
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/questions/:id/submit", authMiddleware, async (req: AuthReq, res) => {
  try {
    const { code, language } = req.body || {};
    const qId = Number(req.params.id);

    const q: any = await dbGet("SELECT * FROM questions WHERE id=? AND active=1", [qId]);
    if (!q) return res.status(404).json({ error: "Question not found" });

    const allTestCases = await dbAll("SELECT * FROM test_cases WHERE question_id=? ORDER BY id ASC", [qId]);

    let visiblePassed = 0;
    let hiddenPassed = 0;
    let visibleTotal = 0;
    let hiddenTotal = 0;

    for (const tc of allTestCases) {
      const exec = await runStudentCode(language || "Python", code || "", tc.input, tc.timeout_ms || 3000);
      const passed = exec.passed && normalizeOutput(exec.output) === normalizeOutput(tc.expected_output);

      if (tc.visible === 1) {
        visibleTotal++;
        if (passed) visiblePassed++;
      } else {
        hiddenTotal++;
        if (passed) hiddenPassed++;
      }
    }

    const totalPassed = visiblePassed + hiddenPassed;
    const totalCases = visibleTotal + hiddenTotal;
    const isFullyPassed = totalPassed === totalCases && totalCases > 0;

    await dbRun(`
      INSERT INTO submissions(user_id, question_id, language, code, passed, visible_passed, hidden_passed, total_tests)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `, [req.user.id, qId, language || "Python", code || "", isFullyPassed ? 1 : 0, visiblePassed, hiddenPassed, totalCases]);

    if (!isFullyPassed) {
      return res.json({
        success: false,
        message: `Only ${totalPassed}/${totalCases} test cases passed. Edit code and try again!`,
        visiblePassed,
        hiddenPassed
      });
    }

    if (isPg) {
      await dbRun(`
        INSERT INTO question_progress(user_id, question_id, solved, attempts, solved_at)
        VALUES(?, ?, 1, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, question_id) DO UPDATE SET solved = 1, solved_at = CURRENT_TIMESTAMP
      `, [req.user.id, qId]);
    } else {
      await dbRun(`
        INSERT INTO question_progress(user_id, question_id, solved, attempts, solved_at)
        VALUES(?, ?, 1, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, question_id) DO UPDATE SET solved = 1, solved_at = CURRENT_TIMESTAMP
      `, [req.user.id, qId]);
    }

    const xpBonus = q.required ? 50 : 25;
    await addStudentXP(req.user.id, xpBonus);
    await logActivity(req.user.id, "question_solved", { questionId: qId, xp: xpBonus });

    res.json({
      success: true,
      xpEarned: xpBonus,
      message: "🎉 Question Verified! All required test cases passed."
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PROGRESS & ANALYTICS
app.get("/api/progress", authMiddleware, async (req: AuthReq, res) => {
  try {
    const uid = req.user.id;
    const profile: any = (await dbGet("SELECT * FROM student_profiles WHERE user_id=?", [uid])) || { xp: 0, streak_days: 0 };
    
    const solvedCount = Number((await dbGet("SELECT COUNT(*) c FROM question_progress WHERE user_id=? AND solved=1", [uid]))?.c || 0);
    const attemptedCount = Number((await dbGet("SELECT COALESCE(SUM(attempts), 0) c FROM question_progress WHERE user_id=?", [uid]))?.c || 0);
    const completedLessons = Number((await dbGet("SELECT COUNT(*) c FROM content_progress WHERE user_id=? AND completed_at IS NOT NULL", [uid]))?.c || 0);
    const totalLessons = Number((await dbGet("SELECT COUNT(*) c FROM topics WHERE active=1"))?.c || 0);

    const languages = await dbAll("SELECT * FROM languages WHERE enabled=1");
    const languageStats = [];

    for (const l of languages) {
      const slb: any = (await dbGet("SELECT current_belt_id FROM student_language_belts WHERE user_id=? AND language_id=?", [uid, l.id])) || { current_belt_id: 1 };
      const b: any = await dbGet("SELECT * FROM belts WHERE id=?", [slb.current_belt_id]);
      
      const completedTopics = Number((await dbGet(`
        SELECT COUNT(DISTINCT cp.topic_id) c FROM content_progress cp
        JOIN topics t ON t.id = cp.topic_id
        WHERE cp.user_id=? AND t.language_id=? AND cp.completed_at IS NOT NULL
      `, [uid, l.id]))?.c || 0);

      const totalTopics = Number((await dbGet("SELECT COUNT(*) c FROM topics WHERE language_id=? AND active=1", [l.id]))?.c || 0);
      const progressPercent = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;

      languageStats.push({
        name: l.name,
        beltName: b?.name || 'White Belt',
        beltColor: b?.color_hex || '#E2E8F0',
        completedTopics,
        totalTopics,
        progressPercent
      });
    }

    const belts = await dbAll("SELECT * FROM belts ORDER BY sort_order ASC");
    const beltStats = [];

    for (const b of belts) {
      const solvedInBelt = Number((await dbGet(`
        SELECT COUNT(DISTINCT qp.question_id) c
        FROM question_progress qp
        JOIN questions q ON q.id = qp.question_id
        JOIN topics t ON t.id = q.topic_id
        WHERE qp.user_id=? AND qp.solved=1 AND t.belt_id=?
      `, [uid, b.id]))?.c || 0);

      beltStats.push({
        beltName: b.name,
        beltColor: b.color_hex,
        solvedCount: solvedInBelt
      });
    }

    res.json({
      xp: profile.xp,
      streak: profile.streak_days,
      solvedQuestions: solvedCount,
      attemptedQuestions: attemptedCount,
      successRate: attemptedCount > 0 ? Math.round((solvedCount / attemptedCount) * 100) : 100,
      completedLessons,
      totalLessons,
      languageStats,
      beltStats
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/activity", authMiddleware, async (req: AuthReq, res) => {
  try {
    res.json(await dbAll("SELECT * FROM activity_logs WHERE user_id=? ORDER BY id DESC LIMIT 15", [req.user.id]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/revisit", authMiddleware, async (req: AuthReq, res) => {
  try {
    const uid = req.user.id;
    const completedLessons = await dbAll(`
      SELECT t.*, l.name language_name, cp.completed_at
      FROM content_progress cp
      JOIN topics t ON t.id = cp.topic_id
      JOIN languages l ON l.id = t.language_id
      WHERE cp.user_id = ? AND cp.completed_at IS NOT NULL
      ORDER BY cp.completed_at DESC
    `, [uid]);

    const weakTopics = await dbAll(`
      SELECT t.id topic_id, t.name topic_name, l.name language_name,
             COUNT(q.id) total_q,
             SUM(CASE WHEN qp.solved=1 THEN 1 ELSE 0 END) solved_q
      FROM topics t
      JOIN languages l ON l.id = t.language_id
      JOIN questions q ON q.topic_id = t.id
      LEFT JOIN question_progress qp ON qp.question_id = q.id AND qp.user_id = ?
      WHERE t.active = 1
      GROUP BY t.id, t.name, l.name
      HAVING COUNT(q.id) > 0 AND (SUM(CASE WHEN qp.solved=1 THEN 1 ELSE 0 END) * 1.0 / COUNT(q.id)) < 0.6
    `, [uid]);

    res.json({ completedLessons, weakTopics });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/bookmarks", authMiddleware, async (req: AuthReq, res) => {
  try {
    res.json(await dbAll("SELECT * FROM bookmarks WHERE user_id=? ORDER BY created_at DESC", [req.user.id]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/bookmarks/toggle", authMiddleware, async (req: AuthReq, res) => {
  try {
    const { item_type, item_id } = req.body || {};
    const existing = await dbGet("SELECT 1 FROM bookmarks WHERE user_id=? AND item_type=? AND item_id=?", [req.user.id, item_type, item_id]);
    
    if (existing) {
      await dbRun("DELETE FROM bookmarks WHERE user_id=? AND item_type=? AND item_id=?", [req.user.id, item_type, item_id]);
      res.json({ bookmarked: false });
    } else {
      await dbRun("INSERT INTO bookmarks(user_id, item_type, item_id) VALUES(?, ?, ?)", [req.user.id, item_type, item_id]);
      res.json({ bookmarked: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// STAFF PORTAL
app.get("/api/staff/dashboard", authMiddleware, requireRole("staff", "admin"), async (req, res) => {
  try {
    const totalStudents = Number((await dbGet("SELECT COUNT(*) c FROM users WHERE role='student'"))?.c || 0);
    const activeStudents = Number((await dbGet("SELECT COUNT(DISTINCT user_id) c FROM student_profiles WHERE last_active_date >= date('now', '-7 days')"))?.c || 0);
    const needsAttention = Number((await dbGet("SELECT COUNT(*) c FROM student_profiles WHERE streak_days = 0 OR xp < 50"))?.c || 0);

    res.json({ totalStudents, activeStudents, needsAttention });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/staff/students", authMiddleware, requireRole("staff", "admin"), async (req, res) => {
  try {
    const students = await dbAll(`
      SELECT u.id, u.name, u.email, u.selected_language, u.created_at,
             p.xp, p.streak_days, p.last_active_date,
             (SELECT COUNT(*) FROM question_progress qp WHERE qp.user_id = u.id AND qp.solved = 1) solved_count
      FROM users u
      LEFT JOIN student_profiles p ON p.user_id = u.id
      WHERE u.role = 'student'
      ORDER BY u.id DESC
    `);
    res.json(students);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/staff/students/:id", authMiddleware, requireRole("staff", "admin"), async (req, res) => {
  try {
    const sId = Number(req.params.id);
    const u: any = await dbGet("SELECT id, name, email, selected_language, created_at FROM users WHERE id=? AND role='student'", [sId]);
    if (!u) return res.status(404).json({ error: "Student not found" });

    const profile: any = await dbGet("SELECT * FROM student_profiles WHERE user_id=?", [sId]);
    
    const languages = await dbAll("SELECT * FROM languages WHERE enabled=1");
    const languageBelts = [];
    for (const l of languages) {
      const slb: any = (await dbGet("SELECT current_belt_id FROM student_language_belts WHERE user_id=? AND language_id=?", [sId, l.id])) || { current_belt_id: 1 };
      const b: any = await dbGet("SELECT * FROM belts WHERE id=?", [slb.current_belt_id]);
      languageBelts.push({
        language: l.name,
        beltName: b?.name || 'White Belt',
        beltColor: b?.color_hex || '#E2E8F0'
      });
    }

    const solvedCount = Number((await dbGet("SELECT COUNT(*) c FROM question_progress WHERE user_id=? AND solved=1", [sId]))?.c || 0);
    const totalQuestions = Number((await dbGet("SELECT COUNT(*) c FROM questions WHERE active=1"))?.c || 0);
    const progressPercent = totalQuestions > 0 ? Math.round((solvedCount / totalQuestions) * 100) : 0;

    const completedTopics = await dbAll(`
      SELECT t.name topic_name, l.name language_name, cp.completed_at
      FROM content_progress cp
      JOIN topics t ON t.id = cp.topic_id
      JOIN languages l ON l.id = t.language_id
      WHERE cp.user_id=? AND cp.completed_at IS NOT NULL
    `, [sId]);

    const recentSubmissions = await dbAll(`
      SELECT s.*, q.title question_title
      FROM submissions s
      JOIN questions q ON q.id = s.question_id
      WHERE s.user_id=?
      ORDER BY s.id DESC LIMIT 10
    `, [sId]);

    const notes = await dbAll(`
      SELECT sn.*, u.name staff_name
      FROM staff_notes sn
      JOIN users u ON u.id = sn.staff_id
      WHERE sn.student_id=?
      ORDER BY sn.id DESC
    `, [sId]);

    res.json({
      ...u,
      profile,
      languageBelts,
      solvedCount,
      progressPercent,
      completedTopics,
      recentSubmissions,
      notes
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/staff/students/:id/notes", authMiddleware, requireRole("staff", "admin"), async (req: AuthReq, res) => {
  try {
    const sId = Number(req.params.id);
    const { note } = req.body || {};
    if (!note) return res.status(400).json({ error: "Note text required" });

    await dbRun("INSERT INTO staff_notes(student_id, staff_id, note) VALUES(?, ?, ?)", [sId, req.user.id, note]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/dashboard", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const totalStudents = Number((await dbGet("SELECT COUNT(*) c FROM users WHERE role='student'"))?.c || 0);
    const totalStaff = Number((await dbGet("SELECT COUNT(*) c FROM users WHERE role='staff'"))?.c || 0);
    const totalLessons = Number((await dbGet("SELECT COUNT(*) c FROM topics"))?.c || 0);
    const totalQuestions = Number((await dbGet("SELECT COUNT(*) c FROM questions"))?.c || 0);
    const totalSubmissions = Number((await dbGet("SELECT COUNT(*) c FROM submissions"))?.c || 0);

    res.json({ totalStudents, totalStaff, totalLessons, totalQuestions, totalSubmissions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/users", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    res.json(await dbAll("SELECT id, name, email, role, active, created_at FROM users ORDER BY id DESC"));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/content", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const languages = await dbAll("SELECT * FROM languages");
    const belts = await dbAll("SELECT * FROM belts ORDER BY sort_order ASC");
    const topics = await dbAll("SELECT t.*, l.name language_name, b.name belt_name FROM topics t JOIN languages l ON l.id = t.language_id JOIN belts b ON b.id = t.belt_id ORDER BY t.id DESC");
    const questions = await dbAll("SELECT q.*, t.name topic_name, l.name language_name, b.name belt_name FROM questions q JOIN topics t ON t.id = q.topic_id JOIN languages l ON l.id = t.language_id JOIN belts b ON b.id = t.belt_id ORDER BY q.id DESC");
    res.json({ languages, belts, topics, questions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/{*path}", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🥋 Coding Dojo Platform server listening at http://localhost:${PORT}`);
  });
}
