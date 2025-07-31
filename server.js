import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import multer from "multer";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dark_secret";

// === Middlewares ===
app.use(cors());
app.use(bodyParser.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// === Database ===
let db;
(async () => {
  db = await open({
    filename: "./database.sqlite",
    driver: sqlite3.Database,
  });

  // Создаём таблицы, если их нет
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'user',
      about TEXT,
      banned INTEGER DEFAULT 0,
      avatar TEXT DEFAULT 'uploads/avatars/default.png'
    );

    CREATE TABLE IF NOT EXISTS apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      description TEXT,
      price REAL DEFAULT 0,
      banned INTEGER DEFAULT 0
    );
  `);
})();

// === Multer для загрузки аватаров ===
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "uploads", "avatars");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const uploadAvatar = multer({ storage: avatarStorage });

// === Middleware для проверки токена ===
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "Нет токена" });

  const token = authHeader.split(" ")[1];
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Неверный токен" });
    req.user = user;
    next();
  });
}

// === Регистрация ===
app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    await db.run(
      "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
      [username, email, hashed]
    );
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Пользователь уже существует" });
  }
});

// === Логин ===
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);

  if (!user) return res.status(400).json({ error: "Неверная почта или пароль" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Неверная почта или пароль" });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
  res.json({ token, role: user.role });
});

// === Профиль ===
app.get("/profile", authMiddleware, async (req, res) => {
  const user = await db.get("SELECT id, username, role, about, avatar FROM users WHERE id = ?", [
    req.user.id,
  ]);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  res.json(user);
});

// === Обновление "О себе" ===
app.post("/update-about", authMiddleware, async (req, res) => {
  const { about } = req.body;
  await db.run("UPDATE users SET about = ? WHERE id = ?", [about, req.user.id]);
  res.json({ success: true, about });
});

// === Загрузка аватара ===
app.post("/upload-avatar", authMiddleware, uploadAvatar.single("avatar"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не получен" });

  const filePath = `uploads/avatars/${req.file.filename}`;
  await db.run("UPDATE users SET avatar = ? WHERE id = ?", [filePath, req.user.id]);

  res.json({ success: true, avatar: filePath });
});

// === Получение аватара ===
app.get("/user-avatar/:id", async (req, res) => {
  const user = await db.get("SELECT avatar FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).send("Нет аватара");
  res.sendFile(path.join(__dirname, user.avatar));
});

// === Блокировка пользователя (только админ) ===
app.post("/ban-user", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Доступ запрещен" });

  const { username } = req.body;
  const user = await db.get("SELECT * FROM users WHERE username = ?", [username]);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });

  await db.run("UPDATE users SET banned = 1 WHERE username = ?", [username]);
  res.json({ success: true });
});

// === Блокировка приложения (только админ) ===
app.post("/ban-app", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Доступ запрещен" });

  const { appId } = req.body;
  const appData = await db.get("SELECT * FROM apps WHERE id = ?", [appId]);
  if (!appData) return res.status(404).json({ error: "Приложение не найдено" });

  await db.run("UPDATE apps SET banned = 1 WHERE id = ?", [appId]);
  res.json({ success: true });
});

// === Запуск сервера ===
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
