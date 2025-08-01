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
import paypal from "@paypal/checkout-server-sdk";
import dotenv from "dotenv";

// === Настройка окружения ===
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dark_secret";

// === Middlewares ===
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || "*",
  credentials: true,
}));
app.use(bodyParser.json({ limit: "50mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// === Database ===
let db;
(async () => {
  db = await open({
    filename: "./database.sqlite",
    driver: sqlite3.Database,
  });

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

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      category TEXT,
      path TEXT,
      uploadedBy INTEGER,
      price REAL DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(uploadedBy) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS vip (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      active INTEGER DEFAULT 1,
      expiresAt TEXT,
      amount REAL DEFAULT 0,
      FOREIGN KEY(userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      content TEXT
    );

    CREATE TABLE IF NOT EXISTS chat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatType TEXT,
      senderId INTEGER,
      receiverId INTEGER,
      content TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(senderId) REFERENCES users(id),
      FOREIGN KEY(receiverId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS file_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fileId INTEGER,
      userId INTEGER,
      content TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(fileId) REFERENCES files(id),
      FOREIGN KEY(userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS file_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fileId INTEGER,
      userId INTEGER,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(fileId, userId),
      FOREIGN KEY(fileId) REFERENCES files(id),
      FOREIGN KEY(userId) REFERENCES users(id)
    );
  `);

  // Создаём админа, если его нет
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass = process.env.ADMIN_PASS;
  if (adminEmail && adminPass) {
    const existingAdmin = await db.get("SELECT * FROM users WHERE email = ?", [adminEmail]);
    if (!existingAdmin) {
      const hashed = await bcrypt.hash(adminPass, 10);
      await db.run(
        "INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
        ["Admin", adminEmail, hashed, "admin"]
      );
      console.log("👑 Админ создан");
    }
  }

  // Добавляем дефолтные сообщения
  const defaultCat = await db.get("SELECT * FROM messages WHERE type = 'cat'");
  if (!defaultCat) {
    await db.run("INSERT INTO messages (type, content) VALUES (?, ?)", [
      "cat",
      "Мяу! Я твоя тёмная помощница 🐾",
    ]);
  }
  const defaultBat = await db.get("SELECT * FROM messages WHERE type = 'bat'");
  if (!defaultBat) {
    await db.run("INSERT INTO messages (type, content) VALUES (?, ?)", [
      "bat",
      "Шшш... Новости из теней 🦇",
    ]);
  }
})();

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

// === Multer для аватаров ===
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "uploads", "avatars");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const uploadAvatar = multer({ storage: avatarStorage });

// === Загрузка файлов ===
const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.query.type || "files";
    const dir = path.join(__dirname, "uploads", type);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const uploadFile = multer({ storage: fileStorage, limits: { fileSize: 5 * 1024 * 1024 * 1024 } }); // 5GB

app.post("/upload-file", authMiddleware, uploadFile.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });

    const { originalname, filename } = req.file;
    const { category, price } = req.body;
    const filePath = path.join("uploads", req.query.type || "files", filename);

    await db.run(
      "INSERT INTO files (name, category, path, uploadedBy, price) VALUES (?, ?, ?, ?, ?)",
      [originalname, category || "general", filePath, req.user.id, price || 0]
    );

    res.json({ success: true, file: { name: originalname, path: `/${filePath}` } });
  } catch (err) {
    console.error("Ошибка загрузки файла:", err);
    res.status(500).json({ error: "Не удалось загрузить файл" });
  }
});

// === PayPal Integration ===
const Environment = paypal.core.SandboxEnvironment;
const paypalClient = new paypal.core.PayPalHttpClient(
  new Environment(
    process.env.PAYPAL_CLIENT_ID,
    process.env.PAYPAL_CLIENT_SECRET
  )
);

// === VIP проверка ===
app.get("/check-vip", authMiddleware, async (req, res) => {
  const vip = await db.get("SELECT * FROM vip WHERE userId = ? AND active = 1", [req.user.id]);
  if (!vip) return res.json({ vip: false });

  const now = new Date();
  if (new Date(vip.expiresAt) < now) {
    await db.run("UPDATE vip SET active = 0 WHERE id = ?", [vip.id]);
    return res.json({ vip: false });
  }
  res.json({ vip: true, expiresAt: vip.expiresAt, amount: vip.amount });
});

// === Запуск сервера ===
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
