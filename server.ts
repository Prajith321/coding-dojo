import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "local-coding-dojo-secret-key-2026";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zpgwsqxaxvuxaaiecpja.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const dbPath = process.env.VERCEL
  ? path.join(os.tmpdir(), "dojo.sqlite")
  : path.join(process.cwd(), "dojo.sqlite");

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");

(db as any).transaction = function<T extends (...args: any[]) => any>(fn: T): T {
  return ((...args: any[]) => {
    db.exec("BEGIN");
    try {
      const res = fn(...args);
      db.exec("COMMIT");
      return res;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }) as T;
};

app.use(cors());
app.use(express.json({ limit: "512kb" }));
app.use(cookieParser());
app.use(express.static(path.join(process.cwd(), "public")));

// Initialize Schema
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  daily_goal_date TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS languages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  icon TEXT DEFAULT 'code',
  description TEXT DEFAULT '',
  difficulty TEXT DEFAULT 'Beginner',
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS belts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Seed Database
function seedDatabase() {
  const userCount = db.prepare("SELECT COUNT(*) c FROM users").get() as any;
  if (userCount.c === 0) {
    console.log("Seeding Coding Dojo Database...");
    
    const addUser = db.prepare("INSERT INTO users(name,email,password_hash,role,selected_language) VALUES(?,?,?,?,?)");
    const addProfile = db.prepare("INSERT INTO student_profiles(user_id,xp,streak_days,last_active_date,daily_goal_count,daily_goal_date) VALUES(?,?,?,?,?,?)");
    
    const today = new Date().toISOString().split('T')[0];
    
    const resStudent = addUser.run("Student Arun", "student@dojo.local", bcrypt.hashSync("student123", 10), "student", "Python");
    const sId = Number(resStudent.lastInsertRowid);
    addProfile.run(sId, 180, 6, today, 2, today);
    
    const resStaff = addUser.run("Staff Priya", "staff@dojo.local", bcrypt.hashSync("staff123", 10), "staff", "Python");
    const stId = Number(resStaff.lastInsertRowid);
    addProfile.run(stId, 0, 0, null, 0, null);

    const resAdmin = addUser.run("Admin Kumar", "admin@dojo.local", bcrypt.hashSync("admin123", 10), "admin", "Python");
    const aId = Number(resAdmin.lastInsertRowid);
    addProfile.run(aId, 0, 0, null, 0, null);

    // Seed Belts
    const insBelt = db.prepare("INSERT INTO belts(name,color_hex,sort_order,xp_required,required_questions,description) VALUES(?,?,?,?,?,?)");
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
    for (const b of beltList) insBelt.run(b[0], b[1], b[2], b[3], b[4], b[5]);

    // Seed Languages
    const insLang = db.prepare("INSERT INTO languages(name,icon,description,difficulty) VALUES(?,?,?,?)");
    insLang.run("Python", "snake", "Clean, highly readable code.", "Beginner");
    insLang.run("JavaScript", "code-js", "The language of the web.", "Beginner");
    insLang.run("C++", "cpu", "Fast, high-performance language.", "Intermediate");
    insLang.run("Java", "coffee", "Popular object-oriented enterprise language.", "Intermediate");

    const pyLang = (db.prepare("SELECT id FROM languages WHERE name='Python'").get() as any).id;
    const jsLang = (db.prepare("SELECT id FROM languages WHERE name='JavaScript'").get() as any).id;
    const cppLang = (db.prepare("SELECT id FROM languages WHERE name='C++'").get() as any).id;
    const javaLang = (db.prepare("SELECT id FROM languages WHERE name='Java'").get() as any).id;

    // Seed Student Language Belts
    const insLangBelt = db.prepare("INSERT INTO student_language_belts(user_id,language_id,current_belt_id) VALUES(?,?,?)");
    insLangBelt.run(sId, pyLang, 1);
    insLangBelt.run(sId, cppLang, 1);
    insLangBelt.run(sId, jsLang, 1);
    insLangBelt.run(sId, javaLang, 1);

    db.prepare("INSERT INTO belt_achievements(user_id,language_id,belt_id) VALUES(?,?,1)").run(sId, pyLang);

    // Seed Achievements
    const insAch = db.prepare("INSERT INTO achievements(code,title,description,icon,xp_bonus) VALUES(?,?,?,?,?)");
    insAch.run("FIRST_STEP", "First Question Solved", "Pass all test cases on your first challenge.", "trophy", 25);
    insAch.run("STREAK_7", "7 Day Streak", "Maintain a 7-day coding practice streak.", "fire", 50);
    insAch.run("YELLOW_BELT", "Yellow Belt Earned", "Promoted to Yellow Belt status in Coding Dojo.", "award", 100);

    db.prepare("INSERT INTO student_achievements(user_id,achievement_id) VALUES(?,?)").run(sId, 1);

    const insTopic = db.prepare("INSERT INTO topics(language_id,belt_id,name,description,content,line_explanation,common_mistakes,key_takeaways,estimated_minutes,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)");
    const insQ = db.prepare("INSERT INTO questions(topic_id,title,statement,input_desc,output_desc,constraints,example_input,example_output,explanation,starter_code_py,starter_code_js,starter_code_cpp,starter_code_java,difficulty,xp_value,required,is_belt_test,hint_1,hint_2) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const insTest = db.prepare("INSERT INTO test_cases(question_id,input,expected_output,visible) VALUES(?,?,?,?)");

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
      // BELT 1 (WHITE BELT): Variables & Input
      const t1 = Number(insTopic.run(l.id, 1, `[White Belt] ${l.name} Variables & Input`, `Learn variables and console input in ${l.name}.`, `# ${l.name} Variables & Input\n\nVariables store values in memory. Read input and print expected output.`, `1. Read input.\n2. Calculate.\n3. Output result.`, `• Type casting errors.`, `1. Variables store state.`, 10, 1).lastInsertRowid);
      const q1 = Number(insQ.run(t1, `Sum of Two Numbers (${l.name})`, "Read two integers A and B and print their sum.", "Two space-separated integers A and B.", "A + B.", "-1000 <= A, B <= 1000", "5 10", "15", "5 + 10 = 15", pyStarter, jsStarter, cppStarter, "", "Easy", 50, 1, 1, "Read A and B", "Print sum").lastInsertRowid);
      for (const [i,o,v] of [["5 10","15",1],["20 30","50",1],["100 250","350",1],["-5 8","3",0],["0 0","0",0],["7 -2","5",0],["500 500","1000",0],["-100 -200","-300",0]]) insTest.run(q1, i, o, v);

      const q2 = Number(insQ.run(t1, `Multiply Three Numbers (${l.name})`, "Read three integers A, B, and C and print their product.", "Three space-separated integers A, B, C.", "Product A * B * C.", "-100 <= A, B, C <= 100", "2 3 4", "24", "2 * 3 * 4 = 24", "", "", cppStarter, "", "Easy", 50, 1, 0, "Read 3 numbers", "Multiply").lastInsertRowid);
      for (const [i,o,v] of [["2 3 4","24",1],["5 0 10","0",1],["-2 4 5","-40",1],["1 1 1","1",0],["-3 -3 -3","-27",0],["10 20 30","6000",0],["7 8 2","112",0],["-5 2 -4","40",0]]) insTest.run(q2, i, o, v);

      const q3 = Number(insQ.run(t1, `Square of N (${l.name})`, "Read a single integer N and print N squared.", "Single integer N.", "N * N.", "-1000 <= N <= 1000", "7", "49", "7 squared is 49", "", "", cppStarter, "", "Easy", 50, 1, 0, "Read N", "Compute N * N").lastInsertRowid);
      for (const [i,o,v] of [["7","49",1],["0","0",1],["-5","25",1],["12","144",0],["100","10000",0],["-15","225",0],["1","1",0],["9","81",0]]) insTest.run(q3, i, o, v);

      // BELT 1 (WHITE BELT): Basic Expressions
      const t1b = Number(insTopic.run(l.id, 1, `[White Belt] ${l.name} Basic Expressions`, `Master math expressions in ${l.name}.`, `# ${l.name} Expressions\n\nEvaluate mathematical expressions with precedence.`, `1. Evaluate operators.\n2. Compute result.`, `• Division by zero.`, `1. Order of operations.`, 10, 2).lastInsertRowid);
      const q1b = Number(insQ.run(t1b, `Perimeter of Rectangle (${l.name})`, "Read length L and width W, print 2*(L+W).", "Two integers L and W.", "Perimeter integer.", "1 <= L, W <= 1000", "5 10", "30", "2*(5+10)=30", "", "", cppStarter, "", "Easy", 50, 1, 0, "2 * (L + W)", "Print result").lastInsertRowid);
      for (const [i,o,v] of [["5 10","30",1],["1 1","4",1],["10 20","60",1],["50 50","200",0],["100 200","600",0],["7 3","20",0],["12 8","40",0],["15 15","60",0]]) insTest.run(q1b, i, o, v);

      // BELT 1 (WHITE BELT): Formatting Output
      const t1c = Number(insTopic.run(l.id, 1, `[White Belt] ${l.name} Formatting Output`, `Format text and values cleanly in ${l.name}.`, `# ${l.name} Formatting\n\nFormat console output string layout.`, `1. Read name.\n2. Output welcome text.`, `• Extra spaces.`, `1. Match string format.`, 10, 3).lastInsertRowid);
      const q1c = Number(insQ.run(t1c, `Double Value (${l.name})`, "Read integer N and print N*2.", "Single integer N.", "N * 2.", "-1000 <= N <= 1000", "8", "16", "8 * 2 = 16", "", "", cppStarter, "", "Easy", 50, 1, 0, "N * 2", "Print double").lastInsertRowid);
      for (const [i,o,v] of [["8","16",1],["0","0",1],["-4","-8",1],["100","200",0],["50","100",0],["-15","-30",0],["7","14",0],["99","198",0]]) insTest.run(q1c, i, o, v);

      // BELT 2 (YELLOW BELT): Conditional Logic
      const t2 = Number(insTopic.run(l.id, 2, `[Yellow Belt] ${l.name} Conditional Logic`, `Master logic conditions in ${l.name}.`, `# ${l.name} Conditions\n\nBranch logic using if/else statements.`, `1. Evaluate expression.\n2. Branch code logic.`, `• Single = instead of ==.`, `1. If-else controls flow.`, 12, 4).lastInsertRowid);
      const q4 = Number(insQ.run(t2, `Even or Odd (${l.name})`, "Read integer N and print 'Even' if divisible by 2, else 'Odd'.", "Single integer N.", "'Even' or 'Odd'.", "-10000 <= N <= 10000", "4", "Even", "4 is divisible by 2", "", "", cppStarter, "", "Easy", 50, 1, 1, "Modulo % 2", "Print Even/Odd").lastInsertRowid);
      for (const [i,o,v] of [["4","Even",1],["7","Odd",1],["0","Even",1],["-3","Odd",0],["100","Even",0],["101","Odd",0],["-44","Even",0],["999","Odd",0]]) insTest.run(q4, i, o, v);

      const q5 = Number(insQ.run(t2, `Maximum of Two (${l.name})`, "Read two integers A and B and print the larger value.", "Two integers A and B.", "Larger integer.", "-1000 <= A, B <= 1000", "15 42", "42", "42 > 15", "", "", cppStarter, "", "Easy", 50, 1, 0, "Compare A, B", "Print larger").lastInsertRowid);
      for (const [i,o,v] of [["15 42","42",1],["100 20","100",1],["-5 -10","-5",1],["0 0","0",0],["7 7","7",0],["-20 50","50",0],["99 100","100",0],["-1 -2","-1",0]]) insTest.run(q5, i, o, v);

      // BELT 3 (ORANGE BELT): Loops & Iteration
      const t3 = Number(insTopic.run(l.id, 3, `[Orange Belt] ${l.name} Loops & Iteration`, `Repeat tasks with loops in ${l.name}.`, `# ${l.name} Loops\n\nLoops iterate over ranges automatically.`, `1. Counter setup.\n2. Exit check.`, `• Infinite loops.`, `1. For loops repeat iterations.`, 15, 5).lastInsertRowid);
      const q7 = Number(insQ.run(t3, `Print 1 to N (${l.name})`, "Read integer N and print numbers from 1 to N space-separated.", "Single positive integer N.", "1 to N space-separated.", "1 <= N <= 100", "5", "1 2 3 4 5", "Prints 1 2 3 4 5", "", "", cppStarter, "", "Easy", 50, 1, 1, "Loop 1 to N", "Space-separated").lastInsertRowid);
      for (const [i,o,v] of [["5","1 2 3 4 5",1],["1","1",1],["3","1 2 3",1],["6","1 2 3 4 5 6",0],["8","1 2 3 4 5 6 7 8",0],["10","1 2 3 4 5 6 7 8 9 10",0],["2","1 2",0],["4","1 2 3 4",0]]) insTest.run(q7, i, o, v);

      if (l.name === "Python") {
        db.prepare("INSERT INTO question_progress(user_id,question_id,solved,attempts,solved_at) VALUES(?,?,1,1,CURRENT_TIMESTAMP)").run(sId, q1);
        db.prepare("INSERT INTO question_progress(user_id,question_id,solved,attempts,solved_at) VALUES(?,?,1,1,CURRENT_TIMESTAMP)").run(sId, q1b);
        db.prepare("INSERT INTO question_progress(user_id,question_id,solved,attempts,solved_at) VALUES(?,?,1,1,CURRENT_TIMESTAMP)").run(sId, q1c);
        db.prepare("INSERT INTO content_progress(user_id,topic_id,completed_at) VALUES(?,?,CURRENT_TIMESTAMP)").run(sId, t1);
        db.prepare("INSERT INTO content_progress(user_id,topic_id,completed_at) VALUES(?,?,CURRENT_TIMESTAMP)").run(sId, t1b);
        db.prepare("INSERT INTO content_progress(user_id,topic_id,completed_at) VALUES(?,?,CURRENT_TIMESTAMP)").run(sId, t1c);
      }
    }

    db.prepare("INSERT INTO staff_notes(student_id,staff_id,note) VALUES(?,?,?)").run(sId, stId, "Student Arun completed 3 topics in Python and is ready for Yellow Belt Promotion Test.");
    console.log("Database seeded successfully!");
  }
}
seedDatabase();

type AuthReq = express.Request & { user?: any };

function authMiddleware(req: AuthReq, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.token;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
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

function logActivity(userId: number, action: string, meta: any = "") {
  try {
    db.prepare("INSERT INTO activity_logs(user_id,action,meta) VALUES(?,?,?)").run(userId, action, JSON.stringify(meta));
  } catch (err) {
    console.error("Activity log error:", err);
  }
}

function addStudentXP(userId: number, xpAmount: number) {
  const profile = db.prepare("SELECT * FROM student_profiles WHERE user_id=?").get(userId) as any;
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
  db.prepare("UPDATE student_profiles SET xp=?, streak_days=?, last_active_date=? WHERE user_id=?").run(newXP, newStreak, today, userId);
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

// ROBUST RUNNER FOR PYTHON, JS, C++, JAVA WITH FALLBACKS
async function runStudentCode(language: string, code: string, input: string, timeoutMs: number = 3000) {
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

// AUTH
app.post("/api/register", (req, res) => {
  const { name, email, password, language } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email, and password required" });

  const existing = db.prepare("SELECT id FROM users WHERE lower(email)=lower(?)").get(email);
  if (existing) return res.status(400).json({ error: "Email is already registered" });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare("INSERT INTO users(name,email,password_hash,role,selected_language) VALUES(?,?,?,'student',?)").run(name, email, hash, language || "Python");
  const userId = Number(result.lastInsertRowid);

  const today = new Date().toISOString().split('T')[0];
  db.prepare("INSERT INTO student_profiles(user_id,xp,streak_days,last_active_date) VALUES(?,0,1,?)").run(userId, today);
  
  const langs = db.prepare("SELECT id FROM languages").all() as any[];
  for (const l of langs) {
    db.prepare("INSERT INTO student_language_belts(user_id,language_id,current_belt_id) VALUES(?,?,1)").run(userId, l.id);
    db.prepare("INSERT INTO belt_achievements(user_id,language_id,belt_id) VALUES(?,?,1)").run(userId, l.id);
  }

  const token = jwt.sign({ id: userId, name, email, role: "student" }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, { httpOnly: true, sameSite: "lax" });

  logActivity(userId, "register");
  res.json({ user: { id: userId, name, email, role: "student", selected_language: language || "Python" } });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const u: any = db.prepare("SELECT * FROM users WHERE lower(email)=lower(?) AND active=1").get(email || "");
  if (!u || !bcrypt.compareSync(password || "", u.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = jwt.sign({ id: u.id, name: u.name, email: u.email, role: u.role }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, { httpOnly: true, sameSite: "lax" });

  logActivity(u.id, "login");
  res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role, selected_language: u.selected_language } });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

app.get("/api/me", authMiddleware, (req: AuthReq, res) => {
  const u: any = db.prepare("SELECT id, name, email, role, selected_language FROM users WHERE id=?").get(req.user.id);
  if (!u) return res.status(404).json({ error: "User not found" });

  const profile: any = db.prepare("SELECT * FROM student_profiles WHERE user_id=?").get(u.id) || { xp: 0, streak_days: 0 };
  res.json({ user: { ...u, profile } });
});

app.post("/api/onboarding", authMiddleware, (req: AuthReq, res) => {
  const { language } = req.body || {};
  if (language) {
    db.prepare("UPDATE users SET selected_language=? WHERE id=?").run(language, req.user.id);
  }
  res.json({ ok: true });
});

// CURRICULUM
app.get("/api/languages", (req, res) => {
  res.json(db.prepare("SELECT * FROM languages WHERE enabled=1 ORDER BY id").all());
});

app.get("/api/languages/:name/belt-details", authMiddleware, (req: AuthReq, res) => {
  const uid = req.user.id;
  const langName = String(req.params.name);

  const lang: any = db.prepare("SELECT id, name FROM languages WHERE name=?").get(langName);
  if (!lang) return res.status(404).json({ error: "Language not found" });

  const slb: any = db.prepare("SELECT current_belt_id FROM student_language_belts WHERE user_id=? AND language_id=?").get(uid, lang.id) || { current_belt_id: 1 };
  const currentBelt: any = db.prepare("SELECT * FROM belts WHERE id=?").get(slb.current_belt_id);
  const nextBelt: any = db.prepare("SELECT * FROM belts WHERE sort_order > ? ORDER BY sort_order ASC LIMIT 1").get(currentBelt ? currentBelt.sort_order : 1);

  const completedTopicsCount = (db.prepare(`
    SELECT COUNT(DISTINCT cp.topic_id) c FROM content_progress cp
    JOIN topics t ON t.id = cp.topic_id
    WHERE cp.user_id=? AND t.language_id=? AND cp.completed_at IS NOT NULL
  `).get(uid, lang.id) as any).c;

  const totalTopicsCount = (db.prepare("SELECT COUNT(*) c FROM topics WHERE language_id=? AND active=1").get(lang.id) as any).c;
  const pendingReq: any = db.prepare("SELECT * FROM belt_promotion_requests WHERE user_id=? AND language_id=? ORDER BY id DESC LIMIT 1").get(uid, lang.id);

  res.json({
    language: lang,
    currentBelt,
    nextBelt,
    completedTopicsCount,
    totalTopicsCount,
    canApplyPromotion: completedTopicsCount >= 3,
    promotionRequest: pendingReq
  });
});

app.get("/api/topics", authMiddleware, (req: AuthReq, res) => {
  const langName = String(req.query.language || req.user.selected_language || "Python");
  const topics = db.prepare(`
    SELECT t.*, b.name belt_name, b.color_hex belt_color, l.name language_name,
           CASE WHEN cp.completed_at IS NOT NULL THEN 1 ELSE 0 END completed,
           (SELECT COUNT(*) FROM questions q WHERE q.topic_id = t.id AND q.active=1) question_count
    FROM topics t
    JOIN languages l ON l.id = t.language_id
    JOIN belts b ON b.id = t.belt_id
    LEFT JOIN content_progress cp ON cp.topic_id = t.id AND cp.user_id = ?
    WHERE l.name = ? AND t.active = 1
    ORDER BY b.sort_order ASC, t.sort_order ASC
  `).all(req.user.id, langName);

  res.json(topics);
});

app.get("/api/topics/:id", authMiddleware, (req: AuthReq, res) => {
  const topic: any = db.prepare(`
    SELECT t.*, l.name language_name, b.name belt_name, b.color_hex belt_color
    FROM topics t
    JOIN languages l ON l.id = t.language_id
    JOIN belts b ON b.id = t.belt_id
    WHERE t.id = ?
  `).get(Number(req.params.id));

  if (!topic) return res.status(404).json({ error: "Topic not found" });

  db.prepare("INSERT OR IGNORE INTO content_progress(user_id,topic_id) VALUES(?,?)").run(req.user.id, topic.id);
  const questions = db.prepare(`
    SELECT q.id, q.title, q.difficulty, q.xp_value, q.required,
           COALESCE(qp.solved, 0) solved, COALESCE(qp.attempts, 0) attempts
    FROM questions q
    LEFT JOIN question_progress qp ON qp.question_id = q.id AND qp.user_id = ?
    WHERE q.topic_id = ? AND q.active = 1
    ORDER BY q.id ASC
  `).all(req.user.id, topic.id);

  res.json({ ...topic, questions });
});

app.post("/api/topics/:id/complete", authMiddleware, (req: AuthReq, res) => {
  db.prepare("UPDATE content_progress SET completed_at=CURRENT_TIMESTAMP WHERE user_id=? AND topic_id=?").run(req.user.id, Number(req.params.id));
  addStudentXP(req.user.id, 10);
  logActivity(req.user.id, "topic_completed", { topicId: req.params.id });
  res.json({ ok: true, xpEarned: 10 });
});

// BELT PROMOTION EXAM & TEST CASE EVALUATION
app.post("/api/belt-promotion/request", authMiddleware, (req: AuthReq, res) => {
  const { language } = req.body || {};
  const uid = req.user.id;

  const lang: any = db.prepare("SELECT id FROM languages WHERE name=?").get(language);
  if (!lang) return res.status(400).json({ error: "Invalid language" });

  const completedCount = (db.prepare(`
    SELECT COUNT(DISTINCT cp.topic_id) c FROM content_progress cp
    JOIN topics t ON t.id = cp.topic_id
    WHERE cp.user_id=? AND t.language_id=? AND cp.completed_at IS NOT NULL
  `).get(uid, lang.id) as any).c;

  if (completedCount < 3) {
    return res.status(400).json({ error: "Minimum 3 completed topics required to apply for Belt Promotion." });
  }

  const slb: any = db.prepare("SELECT current_belt_id FROM student_language_belts WHERE user_id=? AND language_id=?").get(uid, lang.id) || { current_belt_id: 1 };
  const nextBelt: any = db.prepare("SELECT id FROM belts WHERE sort_order > (SELECT sort_order FROM belts WHERE id=?) ORDER BY sort_order ASC LIMIT 1").get(slb.current_belt_id);

  if (!nextBelt) return res.status(400).json({ error: "You are already at Black Belt rank!" });

  db.prepare(`
    INSERT INTO belt_promotion_requests(user_id, language_id, current_belt_id, target_belt_id, status)
    VALUES(?, ?, ?, ?, 'pending')
  `).run(uid, lang.id, slb.current_belt_id, nextBelt.id);

  logActivity(uid, "promotion_requested", { language, targetBeltId: nextBelt.id });
  res.json({ ok: true, message: "Belt promotion request submitted to Sensei Staff for review!" });
});

app.get("/api/belt-test/exam", authMiddleware, (req: AuthReq, res) => {
  const uid = req.user.id;
  const langName = String(req.query.language || "Python");

  const lang: any = db.prepare("SELECT id, name FROM languages WHERE name=?").get(langName);
  if (!lang) return res.status(404).json({ error: "Language not found" });

  const bpr: any = db.prepare(`
    SELECT bpr.*, tb.name target_belt_name, tb.color_hex target_belt_color
    FROM belt_promotion_requests bpr
    JOIN belts tb ON tb.id = bpr.target_belt_id
    WHERE bpr.user_id=? AND bpr.language_id=? AND bpr.status='approved'
    ORDER BY bpr.id DESC LIMIT 1
  `).get(uid, lang.id);

  if (!bpr) return res.status(403).json({ error: "No approved belt promotion exam found." });

  let examQuestions = db.prepare(`
    SELECT q.id, q.title, q.statement, q.input_desc, q.output_desc, q.example_input, q.example_output, t.name topic_name
    FROM questions q
    JOIN topics t ON t.id = q.topic_id
    WHERE t.language_id=? AND q.is_belt_test=1 AND q.active=1
    LIMIT 3
  `).all(lang.id) as any[];

  if (examQuestions.length < 3) {
    const topics = db.prepare("SELECT id, name FROM topics WHERE language_id=? AND active=1 ORDER BY sort_order ASC LIMIT 3").all(lang.id) as any[];
    examQuestions = [];
    for (const t of topics) {
      const q: any = db.prepare("SELECT id, title, statement, input_desc, output_desc, example_input, example_output FROM questions WHERE topic_id=? AND active=1 LIMIT 1").get(t.id);
      if (q) {
        examQuestions.push({ ...q, topic_name: t.name });
      }
    }
  }

  const enrichedQuestions = examQuestions.map(q => {
    const visibleCases = db.prepare("SELECT id, input, expected_output FROM test_cases WHERE question_id=? AND visible=1").all(q.id);
    const hiddenCount = (db.prepare("SELECT COUNT(*) c FROM test_cases WHERE question_id=? AND visible=0").get(q.id) as any).c;
    return { ...q, visibleTestCases: visibleCases, hiddenTestCasesCount: hiddenCount };
  });

  res.json({ promotionRequest: bpr, language: lang, examQuestions: enrichedQuestions });
});

app.post("/api/belt-test/run-question", authMiddleware, async (req: AuthReq, res) => {
  const { questionId, code, language } = req.body || {};
  const qId = Number(questionId);

  const q: any = db.prepare("SELECT * FROM questions WHERE id=? AND active=1").get(qId);
  if (!q) return res.status(404).json({ error: "Question not found" });

  const allTestCases = db.prepare("SELECT * FROM test_cases WHERE question_id=? ORDER BY visible DESC, id ASC").all(qId) as any[];

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
});

app.post("/api/belt-test/submit", authMiddleware, async (req: AuthReq, res) => {
  const uid = req.user.id;
  const { language, answers } = req.body || {};

  const lang: any = db.prepare("SELECT id, name FROM languages WHERE name=?").get(language);
  if (!lang) return res.status(400).json({ error: "Invalid language" });

  const bpr: any = db.prepare("SELECT * FROM belt_promotion_requests WHERE user_id=? AND language_id=? AND status='approved' ORDER BY id DESC LIMIT 1").get(uid, lang.id);
  if (!bpr) return res.status(403).json({ error: "No active approved promotion exam." });

  let allQuestionsPassed = true;
  const results = [];

  for (const [qIdStr, codeStr] of Object.entries(answers || {})) {
    const qId = Number(qIdStr);
    const testCases = db.prepare("SELECT * FROM test_cases WHERE question_id=?").all(qId) as any[];
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
    db.prepare("UPDATE student_language_belts SET current_belt_id=? WHERE user_id=? AND language_id=?").run(bpr.target_belt_id, uid, lang.id);
    db.prepare("UPDATE belt_promotion_requests SET status='completed' WHERE id=?").run(bpr.id);
    db.prepare("INSERT INTO belt_achievements(user_id,language_id,belt_id) VALUES(?,?,?)").run(uid, lang.id, bpr.target_belt_id);
    
    addStudentXP(uid, 100);

    const newBelt: any = db.prepare("SELECT * FROM belts WHERE id=?").get(bpr.target_belt_id);
    db.prepare("INSERT INTO notifications(user_id,title,message,type) VALUES(?,?,?,?)").run(
      uid,
      `🥋 BELT PROMOTION ACHIEVED!`,
      `Congratulations! You passed all 3 exam questions and earned your ${newBelt.name} in ${lang.name}!`,
      "belt"
    );

    logActivity(uid, "belt_promoted", { language: lang.name, beltId: bpr.target_belt_id });
    return res.json({ success: true, message: `🎉 Promotion Achieved! You earned your ${newBelt.name} in ${lang.name}!`, belt: newBelt });
  } else {
    db.prepare("UPDATE belt_promotion_requests SET status='failed' WHERE id=?").run(bpr.id);
    return res.json({ success: false, message: "Promotion exam not passed. Make sure to pass all test cases for all 3 questions. You can re-apply later!" });
  }
});

// ADMIN FEATURES: CONTENT CREATOR & BELT TEST QUESTION MANAGER
app.post("/api/admin/topics", authMiddleware, requireRole("admin"), (req, res) => {
  const { language_name, belt_name, name, description, content } = req.body || {};
  if (!language_name || !name || !content) return res.status(400).json({ error: "Language, topic name, and content required" });

  const lang: any = db.prepare("SELECT id FROM languages WHERE name=?").get(language_name);
  if (!lang) return res.status(400).json({ error: "Invalid language" });

  const belt: any = db.prepare("SELECT id FROM belts WHERE name=?").get(belt_name || "White Belt");
  const beltId = belt ? belt.id : 1;

  const result = db.prepare(`
    INSERT INTO topics(language_id, belt_id, name, description, content, sort_order)
    VALUES(?, ?, ?, ?, ?, 99)
  `).run(lang.id, beltId, name, description || '', content);

  res.json({ ok: true, topicId: Number(result.lastInsertRowid), message: "Topic created successfully!" });
});

app.post("/api/admin/questions", authMiddleware, requireRole("admin"), (req, res) => {
  const { topic_id, title, statement, input_desc, output_desc, example_input, example_output, starter_code, is_belt_test, test_cases } = req.body || {};
  if (!topic_id || !title || !statement) return res.status(400).json({ error: "Topic ID, title, and statement required" });

  const result = db.prepare(`
    INSERT INTO questions(topic_id, title, statement, input_desc, output_desc, constraints, example_input, example_output, is_belt_test)
    VALUES(?, ?, ?, ?, ?, 'Standard Constraints', ?, ?, ?)
  `).run(topic_id, title, statement, input_desc || '', output_desc || '', example_input || '', example_output || '', is_belt_test ? 1 : 0);

  const qId = Number(result.lastInsertRowid);

  if (Array.isArray(test_cases)) {
    const insTest = db.prepare("INSERT INTO test_cases(question_id, input, expected_output, visible) VALUES(?,?,?,?)");
    for (const tc of test_cases) {
      if (tc.input !== undefined && tc.expected_output !== undefined) {
        insTest.run(qId, String(tc.input), String(tc.expected_output), tc.visible ? 1 : 0);
      }
    }
  }

  res.json({ ok: true, questionId: qId, message: "Question and test cases created!" });
});

app.get("/api/admin/belt-test-questions", authMiddleware, requireRole("admin"), (req, res) => {
  const questions = db.prepare(`
    SELECT q.*, t.name topic_name, l.name language_name, b.name belt_name
    FROM questions q
    JOIN topics t ON t.id = q.topic_id
    JOIN languages l ON l.id = t.language_id
    JOIN belts b ON b.id = t.belt_id
    WHERE q.is_belt_test = 1 OR q.active = 1
    ORDER BY l.id ASC, b.sort_order ASC, q.id DESC
  `).all();
  res.json(questions);
});

app.put("/api/admin/questions/:id", authMiddleware, requireRole("admin"), (req, res) => {
  const qId = Number(req.params.id);
  const { title, statement, is_belt_test } = req.body || {};

  db.prepare(`
    UPDATE questions SET title=?, statement=?, is_belt_test=? WHERE id=?
  `).run(title, statement, is_belt_test ? 1 : 0, qId);

  res.json({ ok: true, message: "Question updated successfully!" });
});

app.delete("/api/admin/questions/:id", authMiddleware, requireRole("admin"), (req, res) => {
  const qId = Number(req.params.id);
  db.prepare("DELETE FROM test_cases WHERE question_id=?").run(qId);
  db.prepare("DELETE FROM questions WHERE id=?").run(qId);
  res.json({ ok: true, message: "Question deleted successfully!" });
});

// STAFF PORTAL
app.get("/api/staff/promotions", authMiddleware, requireRole("staff", "admin"), (req, res) => {
  const requests = db.prepare(`
    SELECT bpr.*, u.name student_name, u.email student_email, l.name language_name,
           cb.name current_belt_name, tb.name target_belt_name
    FROM belt_promotion_requests bpr
    JOIN users u ON u.id = bpr.user_id
    JOIN languages l ON l.id = bpr.language_id
    JOIN belts cb ON cb.id = bpr.current_belt_id
    JOIN belts tb ON tb.id = bpr.target_belt_id
    WHERE bpr.status = 'pending'
    ORDER BY bpr.id DESC
  `).all();
  res.json(requests);
});

app.post("/api/staff/promotions/:id/review", authMiddleware, requireRole("staff", "admin"), (req: AuthReq, res) => {
  const reqId = Number(req.params.id);
  const { action } = req.body || {};

  const bpr: any = db.prepare("SELECT * FROM belt_promotion_requests WHERE id=?").get(reqId);
  if (!bpr) return res.status(404).json({ error: "Promotion request not found" });

  const status = action === 'approved' ? 'approved' : 'rejected';
  db.prepare("UPDATE belt_promotion_requests SET status=?, reviewed_at=CURRENT_TIMESTAMP, reviewed_by=? WHERE id=?").run(status, req.user.id, reqId);

  const lang: any = db.prepare("SELECT name FROM languages WHERE id=?").get(bpr.language_id);

  if (action === 'approved') {
    db.prepare("INSERT INTO notifications(user_id,title,message,type) VALUES(?,?,?,?)").run(
      bpr.user_id,
      "🥋 Promotion Approved!",
      `Sensei has approved your promotion test for ${lang?.name || 'Language'}! Open Belt Test page to complete 3 exam questions.`,
      "belt"
    );
  } else {
    db.prepare("INSERT INTO notifications(user_id,title,message,type) VALUES(?,?,?,?)").run(
      bpr.user_id,
      "⚠️ Promotion Request Rejected",
      `Sensei reviewed your promotion request for ${lang?.name || 'Language'}. Please practice topics further and feel free to re-apply anytime!`,
      "info"
    );
  }

  logActivity(req.user.id, "promotion_reviewed", { requestId: reqId, status });
  res.json({ ok: true });
});

// QUESTIONS & TESTS
app.get("/api/questions/:id", authMiddleware, (req: AuthReq, res) => {
  const q: any = db.prepare(`
    SELECT q.*, t.name topic_name, l.name language_name, b.name belt_name
    FROM questions q
    JOIN topics t ON t.id = q.topic_id
    JOIN languages l ON l.id = t.language_id
    JOIN belts b ON b.id = t.belt_id
    WHERE q.id = ? AND q.active = 1
  `).get(Number(req.params.id));

  if (!q) return res.status(404).json({ error: "Question not found" });

  const visibleCases = db.prepare("SELECT id, input, expected_output, timeout_ms FROM test_cases WHERE question_id=? AND visible=1 ORDER BY id ASC").all(q.id);
  const hiddenCount = (db.prepare("SELECT COUNT(*) c FROM test_cases WHERE question_id=? AND visible=0").get(q.id) as any).c;

  const progress: any = db.prepare("SELECT solved, attempts FROM question_progress WHERE user_id=? AND question_id=?").get(req.user.id, q.id) || { solved: 0, attempts: 0 };
  const isBookmarked = db.prepare("SELECT 1 FROM bookmarks WHERE user_id=? AND item_type='question' AND item_id=?").get(req.user.id, q.id) ? 1 : 0;

  res.json({
    ...q,
    visibleTestCases: visibleCases,
    hiddenTestCasesCount: hiddenCount,
    solved: progress.solved,
    attempts: progress.attempts,
    bookmarked: isBookmarked
  });
});

app.post("/api/questions/:id/run", authMiddleware, async (req: AuthReq, res) => {
  const { code, language } = req.body || {};
  const qId = Number(req.params.id);

  const q: any = db.prepare("SELECT * FROM questions WHERE id=? AND active=1").get(qId);
  if (!q) return res.status(404).json({ error: "Question not found" });

  const allTestCases = db.prepare("SELECT * FROM test_cases WHERE question_id=? ORDER BY visible DESC, id ASC").all(qId) as any[];

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

  db.prepare(`
    INSERT INTO question_progress(user_id, question_id, attempts) VALUES(?, ?, 1)
    ON CONFLICT(user_id, question_id) DO UPDATE SET attempts = attempts + 1
  `).run(req.user.id, qId);

  res.json({
    status: "completed",
    visibleTests: visibleResults,
    hiddenTests: {
      passed: hiddenPassedCount,
      total: hiddenTotalCount
    },
    canSubmit: allPassed
  });
});

app.post("/api/questions/:id/submit", authMiddleware, async (req: AuthReq, res) => {
  const { code, language } = req.body || {};
  const qId = Number(req.params.id);

  const q: any = db.prepare("SELECT * FROM questions WHERE id=? AND active=1").get(qId);
  if (!q) return res.status(404).json({ error: "Question not found" });

  const allTestCases = db.prepare("SELECT * FROM test_cases WHERE question_id=? ORDER BY id ASC").all(qId) as any[];

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

  db.prepare(`
    INSERT INTO submissions(user_id, question_id, language, code, passed, visible_passed, hidden_passed, total_tests)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, qId, language || "Python", code || "", isFullyPassed ? 1 : 0, visiblePassed, hiddenPassed, totalCases);

  if (!isFullyPassed) {
    return res.json({
      success: false,
      message: `Only ${totalPassed}/${totalCases} test cases passed. Edit code and try again!`,
      visiblePassed,
      hiddenPassed
    });
  }

  db.prepare(`
    INSERT INTO question_progress(user_id, question_id, solved, attempts, solved_at)
    VALUES(?, ?, 1, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, question_id) DO UPDATE SET solved = 1, solved_at = CURRENT_TIMESTAMP
  `).run(req.user.id, qId);

  const xpBonus = q.required ? 50 : 25;
  addStudentXP(req.user.id, xpBonus);
  logActivity(req.user.id, "question_solved", { questionId: qId, xp: xpBonus });

  res.json({
    success: true,
    xpEarned: xpBonus,
    message: "🎉 Question Verified! All required test cases passed."
  });
});

// PROGRESS & ANALYTICS
app.get("/api/progress", authMiddleware, (req: AuthReq, res) => {
  const uid = req.user.id;
  const profile: any = db.prepare("SELECT * FROM student_profiles WHERE user_id=?").get(uid) || { xp: 0, streak_days: 0 };
  
  const solvedCount = (db.prepare("SELECT COUNT(*) c FROM question_progress WHERE user_id=? AND solved=1").get(uid) as any).c;
  const attemptedCount = (db.prepare("SELECT COALESCE(SUM(attempts), 0) c FROM question_progress WHERE user_id=?").get(uid) as any).c;
  const completedLessons = (db.prepare("SELECT COUNT(*) c FROM content_progress WHERE user_id=? AND completed_at IS NOT NULL").get(uid) as any).c;
  const totalLessons = (db.prepare("SELECT COUNT(*) c FROM topics WHERE active=1").get() as any).c;

  const languages = db.prepare("SELECT * FROM languages WHERE enabled=1").all() as any[];
  const languageStats = languages.map(l => {
    const slb: any = db.prepare("SELECT current_belt_id FROM student_language_belts WHERE user_id=? AND language_id=?").get(uid, l.id) || { current_belt_id: 1 };
    const b: any = db.prepare("SELECT * FROM belts WHERE id=?").get(slb.current_belt_id);
    
    const completedTopics = (db.prepare(`
      SELECT COUNT(DISTINCT cp.topic_id) c FROM content_progress cp
      JOIN topics t ON t.id = cp.topic_id
      WHERE cp.user_id=? AND t.language_id=? AND cp.completed_at IS NOT NULL
    `).get(uid, l.id) as any).c;

    const totalTopics = (db.prepare("SELECT COUNT(*) c FROM topics WHERE language_id=? AND active=1").get(l.id) as any).c;
    const progressPercent = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;

    return {
      name: l.name,
      beltName: b?.name || 'White Belt',
      beltColor: b?.color_hex || '#E2E8F0',
      completedTopics,
      totalTopics,
      progressPercent
    };
  });

  const belts = db.prepare("SELECT * FROM belts ORDER BY sort_order ASC").all() as any[];
  const beltStats = belts.map(b => {
    const solvedInBelt = (db.prepare(`
      SELECT COUNT(DISTINCT qp.question_id) c
      FROM question_progress qp
      JOIN questions q ON q.id = qp.question_id
      JOIN topics t ON t.id = q.topic_id
      WHERE qp.user_id=? AND qp.solved=1 AND t.belt_id=?
    `).get(uid, b.id) as any).c;

    return {
      beltName: b.name,
      beltColor: b.color_hex,
      solvedCount: solvedInBelt
    };
  });

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
});

app.get("/api/activity", authMiddleware, (req: AuthReq, res) => {
  res.json(db.prepare("SELECT * FROM activity_logs WHERE user_id=? ORDER BY id DESC LIMIT 15").all(req.user.id));
});

app.get("/api/revisit", authMiddleware, (req: AuthReq, res) => {
  const uid = req.user.id;
  const completedLessons = db.prepare(`
    SELECT t.*, l.name language_name, cp.completed_at
    FROM content_progress cp
    JOIN topics t ON t.id = cp.topic_id
    JOIN languages l ON l.id = t.language_id
    WHERE cp.user_id = ? AND cp.completed_at IS NOT NULL
    ORDER BY cp.completed_at DESC
  `).all(uid);

  const weakTopics = db.prepare(`
    SELECT t.id topic_id, t.name topic_name, l.name language_name,
           COUNT(q.id) total_q,
           SUM(CASE WHEN qp.solved=1 THEN 1 ELSE 0 END) solved_q
    FROM topics t
    JOIN languages l ON l.id = t.language_id
    JOIN questions q ON q.topic_id = t.id
    LEFT JOIN question_progress qp ON qp.question_id = q.id AND qp.user_id = ?
    WHERE t.active = 1
    GROUP BY t.id
    HAVING total_q > 0 AND (solved_q * 1.0 / total_q) < 0.6
  `).all(uid);

  res.json({ completedLessons, weakTopics });
});

app.get("/api/bookmarks", authMiddleware, (req: AuthReq, res) => {
  res.json(db.prepare("SELECT * FROM bookmarks WHERE user_id=? ORDER BY created_at DESC").all(req.user.id));
});

app.post("/api/bookmarks/toggle", authMiddleware, (req: AuthReq, res) => {
  const { item_type, item_id } = req.body || {};
  const existing = db.prepare("SELECT 1 FROM bookmarks WHERE user_id=? AND item_type=? AND item_id=?").get(req.user.id, item_type, item_id);
  
  if (existing) {
    db.prepare("DELETE FROM bookmarks WHERE user_id=? AND item_type=? AND item_id=?").run(req.user.id, item_type, item_id);
    res.json({ bookmarked: false });
  } else {
    db.prepare("INSERT INTO bookmarks(user_id, item_type, item_id) VALUES(?, ?, ?)").run(req.user.id, item_type, item_id);
    res.json({ bookmarked: true });
  }
});

// STAFF PORTAL
app.get("/api/staff/dashboard", authMiddleware, requireRole("staff", "admin"), (req, res) => {
  const totalStudents = (db.prepare("SELECT COUNT(*) c FROM users WHERE role='student'").get() as any).c;
  const activeStudents = (db.prepare("SELECT COUNT(DISTINCT user_id) c FROM student_profiles WHERE last_active_date >= date('now', '-7 days')").get() as any).c;
  const needsAttention = (db.prepare("SELECT COUNT(*) c FROM student_profiles WHERE streak_days = 0 OR xp < 50").get() as any).c;

  res.json({ totalStudents, activeStudents, needsAttention });
});

app.get("/api/staff/students", authMiddleware, requireRole("staff", "admin"), (req, res) => {
  const students = db.prepare(`
    SELECT u.id, u.name, u.email, u.selected_language, u.created_at,
           p.xp, p.streak_days, p.last_active_date,
           (SELECT COUNT(*) FROM question_progress qp WHERE qp.user_id = u.id AND qp.solved = 1) solved_count
    FROM users u
    LEFT JOIN student_profiles p ON p.user_id = u.id
    WHERE u.role = 'student'
    ORDER BY u.id DESC
  `).all();
  res.json(students);
});

app.get("/api/staff/students/:id", authMiddleware, requireRole("staff", "admin"), (req, res) => {
  const sId = Number(req.params.id);
  const u: any = db.prepare("SELECT id, name, email, selected_language, created_at FROM users WHERE id=? AND role='student'").get(sId);
  if (!u) return res.status(404).json({ error: "Student not found" });

  const profile: any = db.prepare("SELECT * FROM student_profiles WHERE user_id=?").get(sId);
  
  const languages = db.prepare("SELECT * FROM languages WHERE enabled=1").all() as any[];
  const languageBelts = languages.map(l => {
    const slb: any = db.prepare("SELECT current_belt_id FROM student_language_belts WHERE user_id=? AND language_id=?").get(sId, l.id) || { current_belt_id: 1 };
    const b: any = db.prepare("SELECT * FROM belts WHERE id=?").get(slb.current_belt_id);
    return {
      language: l.name,
      beltName: b?.name || 'White Belt',
      beltColor: b?.color_hex || '#E2E8F0'
    };
  });

  const solvedCount = (db.prepare("SELECT COUNT(*) c FROM question_progress WHERE user_id=? AND solved=1").get(sId) as any).c;
  const totalQuestions = (db.prepare("SELECT COUNT(*) c FROM questions WHERE active=1").get() as any).c;
  const progressPercent = totalQuestions > 0 ? Math.round((solvedCount / totalQuestions) * 100) : 0;

  const completedTopics = db.prepare(`
    SELECT t.name topic_name, l.name language_name, cp.completed_at
    FROM content_progress cp
    JOIN topics t ON t.id = cp.topic_id
    JOIN languages l ON l.id = t.language_id
    WHERE cp.user_id=? AND cp.completed_at IS NOT NULL
  `).all(sId);

  const recentSubmissions = db.prepare(`
    SELECT s.*, q.title question_title
    FROM submissions s
    JOIN questions q ON q.id = s.question_id
    WHERE s.user_id=?
    ORDER BY s.id DESC LIMIT 10
  `).all(sId);

  const notes = db.prepare(`
    SELECT sn.*, u.name staff_name
    FROM staff_notes sn
    JOIN users u ON u.id = sn.staff_id
    WHERE sn.student_id=?
    ORDER BY sn.id DESC
  `).all(sId);

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
});

app.post("/api/staff/students/:id/notes", authMiddleware, requireRole("staff", "admin"), (req: AuthReq, res) => {
  const sId = Number(req.params.id);
  const { note } = req.body || {};
  if (!note) return res.status(400).json({ error: "Note text required" });

  db.prepare("INSERT INTO staff_notes(student_id, staff_id, note) VALUES(?, ?, ?)").run(sId, req.user.id, note);
  res.json({ ok: true });
});

app.get("/api/admin/dashboard", authMiddleware, requireRole("admin"), (req, res) => {
  const totalStudents = (db.prepare("SELECT COUNT(*) c FROM users WHERE role='student'").get() as any).c;
  const totalStaff = (db.prepare("SELECT COUNT(*) c FROM users WHERE role='staff'").get() as any).c;
  const totalLessons = (db.prepare("SELECT COUNT(*) c FROM topics").get() as any).c;
  const totalQuestions = (db.prepare("SELECT COUNT(*) c FROM questions").get() as any).c;
  const totalSubmissions = (db.prepare("SELECT COUNT(*) c FROM submissions").get() as any).c;

  res.json({ totalStudents, totalStaff, totalLessons, totalQuestions, totalSubmissions });
});

app.get("/api/admin/users", authMiddleware, requireRole("admin"), (req, res) => {
  res.json(db.prepare("SELECT id, name, email, role, active, created_at FROM users ORDER BY id DESC").all());
});

app.get("/api/admin/content", authMiddleware, requireRole("admin"), (req, res) => {
  const languages = db.prepare("SELECT * FROM languages").all();
  const belts = db.prepare("SELECT * FROM belts ORDER BY sort_order ASC").all();
  const topics = db.prepare("SELECT t.*, l.name language_name, b.name belt_name FROM topics t JOIN languages l ON l.id = t.language_id JOIN belts b ON b.id = t.belt_id ORDER BY t.id DESC").all();
  const questions = db.prepare("SELECT q.*, t.name topic_name, l.name language_name, b.name belt_name FROM questions q JOIN topics t ON t.id = q.topic_id JOIN languages l ON l.id = t.language_id JOIN belts b ON b.id = t.belt_id ORDER BY q.id DESC").all();
  res.json({ languages, belts, topics, questions });
});

app.get("/{*path}", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🥋 Coding Dojo Platform server listening at http://localhost:${PORT}`);
  });
}
