const express = require("express");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const SECRET_KEY = "super_secret_dark_key";
const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ================== DB INIT ==================
const db = new sqlite3.Database("./database.db", (err) => {
  if (err) console.error("DB error:", err.message);
  else console.log("Connected to SQLite");
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    username TEXT,
    role TEXT DEFAULT 'user',
    about TEXT DEFAULT '',
    avatar TEXT DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    filename TEXT,
    section TEXT,
    blocked INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS blocked_users (
    user_id INTEGER UNIQUE,
    reason TEXT
  )`);
});

// ================== HELPERS ==================
function generateToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: "7d" });
}

function authMiddleware(req, res, next) {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ error: "Нет токена" });

  jwt.verify(token.split(" ")[1], SECRET_KEY, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Неверный токен" });
    req.user = decoded;
    next();
  });
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Доступ запрещён" });
  next();
}

// ================== FILE UPLOAD ==================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// ================== AUTH ROUTES ==================
app.post("/register", async (req, res) => {
  const { email, password, username } = req.body;
  const hashed = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (email, password, username, role) VALUES (?, ?, ?, ?)`,
    [email, hashed, username, email === "juliaangelss26@gmail.com" ? "admin" : "user"],
    function (err) {
      if (err) return res.status(400).json({ error: "Пользователь уже существует" });
      res.json({ success: true, userId: this.lastID });
    }
  );
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(403).json({ error: "Неверный пароль" });

    const token = generateToken(user);
    res.json({ token, role: user.role, username: user.username });
  });
});

// ================== PROFILE ROUTES ==================
app.post("/upload-avatar", authMiddleware, upload.single("avatar"), (req, res) => {
  db.run(`UPDATE users SET avatar = ? WHERE id = ?`, [req.file.filename, req.user.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, filename: req.file.filename });
  });
});

app.post("/about-me", authMiddleware, (req, res) => {
  const { about } = req.body;
  db.run(`UPDATE users SET about = ? WHERE id = ?`, [about, req.user.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.get("/profile", authMiddleware, (req, res) => {
  db.get(`SELECT username, role, about, avatar FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(user);
  });
});

// ================== FILE ROUTES ==================
app.post("/upload-file", authMiddleware, upload.single("file"), (req, res) => {
  const { section } = req.body;
  db.run(
    `INSERT INTO files (user_id, filename, section) VALUES (?, ?, ?)`,
    [req.user.id, req.file.filename, section],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, fileId: this.lastID });
    }
  );
});

app.get("/my-files", authMiddleware, (req, res) => {
  db.all(`SELECT * FROM files WHERE user_id = ?`, [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ================== ADMIN ROUTES ==================
app.post("/block-user", authMiddleware, adminMiddleware, (req, res) => {
  const { userId, reason } = req.body;
  db.run(`INSERT OR REPLACE INTO blocked_users (user_id, reason) VALUES (?, ?)`, [userId, reason], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post("/block-app", authMiddleware, adminMiddleware, (req, res) => {
  const { fileId } = req.body;
  db.run(`UPDATE files SET blocked = 1 WHERE id = ?`, [fileId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ================== SERVER START ==================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
