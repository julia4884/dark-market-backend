// server.js
import express from "express";
import multer from "multer";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "dark_secret";

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

// DB
const dbPromise = open({
  filename: "./database.sqlite",
  driver: sqlite3.Database
});

// init tables
(async () => {
  const db = await dbPromise;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'user'
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      url TEXT,
      owner_id INTEGER,
      category TEXT,
      FOREIGN KEY(owner_id) REFERENCES users(id)
    );
  `);

  // Создаём твой админский аккаунт, если его нет
  const adminEmail = "juliaangelss26@gmail.com";
  const adminPassword = "dark4884";
  const existingAdmin = await db.get("SELECT * FROM users WHERE email = ?", [adminEmail]);
  if (!existingAdmin) {
    const hashed = await bcrypt.hash(adminPassword, 10);
    await db.run(
      "INSERT INTO users (email, password, role) VALUES (?, ?, ?)",
      [adminEmail, hashed, "developer"]
    );
    console.log("✅ Админ создан");
  }
})();

// Multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// JWT middleware
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "Нет токена" });
  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: "Неверный токен" });
  }
};

// Регистрация
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Заполните все поля" });
  const db = await dbPromise;
  const hashed = await bcrypt.hash(password, 10);
  try {
    await db.run("INSERT INTO users (email, password) VALUES (?, ?)", [email, hashed]);
    res.json({ message: "Регистрация успешна" });
  } catch {
    res.status(400).json({ error: "Такой email уже есть" });
  }
});

// Логин
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const db = await dbPromise;
  const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user) return res.status(400).json({ error: "Неверный email или пароль" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: "Неверный email или пароль" });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "1d" });
  res.json({ token });
});

// Проверка профиля
app.get("/me", authMiddleware, async (req, res) => {
  const db = await dbPromise;
  const user = await db.get("SELECT id, email, role FROM users WHERE id = ?", [req.user.id]);
  res.json(user);
});

// Загрузка файлов
app.post("/upload-file", authMiddleware, upload.single("file"), async (req, res) => {
  const db = await dbPromise;
  const fileUrl = `/uploads/${req.file.filename}`;
  await db.run("INSERT INTO files (filename, url, owner_id, category) VALUES (?, ?, ?, ?)",
    [req.file.originalname, fileUrl, req.user.id, req.body.category || "general"]
  );
  res.json({ message: "Файл загружен", url: fileUrl });
});

// Список файлов
app.get("/files", async (req, res) => {
  const db = await dbPromise;
  const files = await db.all("SELECT * FROM files");
  res.json(files);
});

// Блокировка пользователя (только админ)
app.post("/block-user", authMiddleware, async (req, res) => {
  if (req.user.role !== "developer") return res.status(403).json({ error: "Нет доступа" });
  const { email } = req.body;
  const db = await dbPromise;
  await db.run("DELETE FROM users WHERE email = ?", [email]);
  res.json({ message: `Пользователь ${email} заблокирован` });
});

// Блокировка файла (только админ)
app.post("/block-file", authMiddleware, async (req, res) => {
  if (req.user.role !== "developer") return res.status(403).json({ error: "Нет доступа" });
  const { fileId } = req.body;
  const db = await dbPromise;
  await db.run("DELETE FROM files WHERE id = ?", [fileId]);
  res.json({ message: `Файл #${fileId} удалён` });
});

// Запуск
app.listen(PORT, () => console.log(`🔥 Сервер запущен на порту ${PORT}`));
