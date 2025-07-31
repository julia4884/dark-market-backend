import express from "express";
import bodyParser from "body-parser";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

app.use(bodyParser.json());
app.use(cors());
app.use("/uploads", express.static("uploads"));

// === SQLite подключение ===
let db;
(async () => {
  db = await open({
    filename: "./database.sqlite",
    driver: sqlite3.Database,
  });

  // создаем таблицы, если нет
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'user',
      avatar TEXT DEFAULT ''
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      filename TEXT,
      section TEXT,
      price REAL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users (id)
    );
  `);
})();

// === Middleware ===
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

function developerMiddleware(req, res, next) {
  if (req.user.role === "developer" || req.user.role === "admin") {
    return next();
  }
  return res.status(403).json({ error: "Доступ только для разработчиков" });
}

// === Настройка multer ===
const storageFiles = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const storageAvatars = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/avatars";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname),
});

const uploadFile = multer({ storage: storageFiles });
const uploadAvatar = multer({ storage: storageAvatars });

// === Регистрация ===
app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.run(
      "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
      [username, email, hashedPassword]
    );
    res.json({ success: true, message: "Регистрация успешна" });
  } catch (err) {
    res.status(400).json({ error: "Ошибка регистрации: " + err.message });
  }
});

// === Вход ===
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);

    if (!user) return res.status(400).json({ error: "Пользователь не найден" });
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: "Неверный пароль" });

    const token = jwt.sign(
      { id: user.id, role: user.role, username: user.username, avatar: user.avatar },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({ success: true, token, role: user.role, username: user.username, avatar: user.avatar });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// === Загрузка файла (только для разработчиков) ===
app.post("/upload-file", authMiddleware, developerMiddleware, uploadFile.single("file"), async (req, res) => {
  try {
    const { section, price } = req.body;
    await db.run(
      "INSERT INTO files (user_id, filename, section, price) VALUES (?, ?, ?, ?)",
      [req.user.id, req.file.filename, section, price || 0]
    );
    res.json({ success: true, message: "Файл загружен" });
  } catch (err) {
    res.status(500).json({ error: "Ошибка при загрузке файла: " + err.message });
  }
});

// === Загрузка аватара ===
app.post("/upload-avatar", authMiddleware, uploadAvatar.single("avatar"), async (req, res) => {
  try {
    const avatarPath = `/uploads/avatars/${req.file.filename}`;
    await db.run("UPDATE users SET avatar = ? WHERE id = ?", [avatarPath, req.user.id]);
    res.json({ success: true, avatar: avatarPath });
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки аватара: " + err.message });
  }
});

// === Получение аватара ===
app.get("/user-avatar/:id", async (req, res) => {
  try {
    const user = await db.get("SELECT avatar FROM users WHERE id = ?", [req.params.id]);
    if (!user || !user.avatar) {
      return res.json({ avatar: "/uploads/avatars/default.png" }); // дефолтный аватар
    }
    res.json({ avatar: user.avatar });
  } catch (err) {
    res.status(500).json({ error: "Ошибка получения аватара" });
  }
});

// === Список файлов по разделу ===
app.get("/files/:section", async (req, res) => {
  try {
    const files = await db.all("SELECT * FROM files WHERE section = ?", [req.params.section]);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: "Ошибка получения файлов" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});
