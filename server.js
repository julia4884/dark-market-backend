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
import nodemailer from "nodemailer";
import paypal from "@paypal/checkout-server-sdk";

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

    CREATE TABLE IF NOT EXISTS vip (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      active INTEGER DEFAULT 1,
      expiresAt TEXT,
      FOREIGN KEY(userId) REFERENCES users(id)
    );
  `);

  // Создаём админа, если его нет
  const adminEmail = "juliaangelss26@gmail.com";
  const existingAdmin = await db.get("SELECT * FROM users WHERE email = ?", [adminEmail]);
  if (!existingAdmin) {
    const hashed = await bcrypt.hash("dark4884", 10);
    await db.run(
      "INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
      ["Admin", adminEmail, hashed, "admin"]
    );
    console.log("👑 Админ создан");
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

// === Multer для загрузки аватаров ===
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "uploads", "avatars");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const uploadAvatar = multer({ storage: avatarStorage });

// === Multer для загрузки файлов ===
const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.query.type || "files"; // apps, books, movies, music, etc.
    const dir = path.join(__dirname, "uploads", type);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const uploadFile = multer({ storage: fileStorage });

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
  if (user.banned) return res.status(403).json({ error: "Пользователь заблокирован" });

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
  const user = await db.get(
    "SELECT id, username, role, about, avatar FROM users WHERE id = ?",
    [req.user.id]
  );
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

// === Загрузка файлов ===
app.post("/upload-file", authMiddleware, uploadFile.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не получен" });

  const type = req.query.type || "files";
  const filePath = `uploads/${type}/${req.file.filename}`;

  await db.run(
    "INSERT INTO apps (name, description, price) VALUES (?, ?, ?)",
    [req.file.originalname, `${type} upload`, 0]
  );

  res.json({ success: true, path: filePath });
});

// === Скачивание файлов ===
app.get("/download/:folder/:filename", authMiddleware, (req, res) => {
  const { folder, filename } = req.params;
  const filePath = path.join(__dirname, "uploads", folder, filename);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Файл не найден" });

  res.download(filePath);
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

// === Админка: список юзеров ===
app.get("/admin/users", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Доступ запрещен" });
  const users = await db.all("SELECT id, username, email, role, banned FROM users");
  res.json(users);
});

// === Админка: список файлов ===
app.get("/admin/files", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Доступ запрещен" });

  const files = [];
  const folders = ["apps", "books", "movies", "music", "photos", "tools", "games", "files"];
  for (let folder of folders) {
    const dir = path.join(__dirname, "uploads", folder);
    if (fs.existsSync(dir)) {
      const folderFiles = fs.readdirSync(dir).map((f) => ({
        folder,
        filename: f,
      }));
      files.push(...folderFiles);
    }
  }
  res.json(files);
});

// === Отправка сообщений администратору ===
app.post("/contact", async (req, res) => {
  const { email, message } = req.body;
  if (!email || !message) {
    return res.status(400).json({ error: "Укажите email и сообщение" });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "juliaangelss26@gmail.com",
        pass: process.env.GMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: email,
      to: "juliaangelss26@gmail.com",
      subject: "Сообщение с сайта Dark Market Ultra",
      text: message,
    });

    res.json({ success: true, message: "Сообщение отправлено!" });
  } catch (error) {
    console.error("Ошибка при отправке:", error);
    res.status(500).json({ error: "Не удалось отправить сообщение" });
  }
});

// === PayPal Integration ===
const Environment = paypal.core.SandboxEnvironment;
const paypalClient = new paypal.core.PayPalHttpClient(
  new Environment(
    process.env.PAYPAL_CLIENT_ID || "AU9A6gbVWpQ5gu6oWT8alj1wMqgTUDqDM5bidlDBYujcispGUtVZkqFKGZ7rEpuT0FcGbMM8To7Kiv-6",
    process.env.PAYPAL_CLIENT_SECRET || "EFot3o0eLa_AtP69rmS_7InXZcm4dppF-cRjJFh10uXs51Tu58jVclVShzc50dXh9-mKmlCYQB7r-bM9"
  )
);

app.post("/create-order", async (req, res) => {
  const { amount } = req.body;
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "USD", value: amount } }],
  });

  try {
    const order = await paypalClient.execute(request);
    res.json(order.result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при создании заказа" });
  }
});

app.post("/capture-order", async (req, res) => {
  const { orderID } = req.body;
  const request = new paypal.orders.OrdersCaptureRequest(orderID);
  request.requestBody({});
  try {
    const capture = await paypalClient.execute(request);
    res.json(capture.result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при подтверждении платежа" });
  }
});

// === VIP активация ===
app.post("/activate-vip", authMiddleware, async (req, res) => {
  const { days } = req.body;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);

  await db.run(
    "INSERT INTO vip (userId, expiresAt) VALUES (?, ?)",
    [req.user.id, expiresAt.toISOString()]
  );
  res.json({ success: true, vip: true, expiresAt });
});

// === Проверка VIP ===
app.get("/check-vip", authMiddleware, async (req, res) => {
  const vip = await db.get("SELECT * FROM vip WHERE userId = ? AND active = 1", [req.user.id]);
  if (!vip) return res.json({ vip: false });

  const now = new Date();
  if (new Date(vip.expiresAt) < now) {
    await db.run("UPDATE vip SET active = 0 WHERE id = ?", [vip.id]);
    return res.json({ vip: false });
  }
  res.json({ vip: true, expiresAt: vip.expiresAt });
});

// === Сообщения от кошки и мыши ===
app.get("/messages/cat", (req, res) => {
  res.json({ message: "Мяу! Я твоя тёмная помощница 🐾" });
});
app.get("/messages/bat", (req, res) => {
  res.json({ message: "Шшш... Новости из теней 🦇" });
});

// === Запуск сервера ===
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
