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
import dotenv from "dotenv";
dotenv.config();
import paypal from "@paypal/checkout-server-sdk";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dark_secret";

// === Middlewares ===
app.use(bodyParser.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// Защита заголовков
app.use(helmet());

// Ограничение количества запросов
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // макс. 100 запросов с одного IP
});
app.use(limiter);

// Жёсткий CORS (разрешаем только свой фронтенд)
import cors from "cors";

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

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

// === Multer для загрузки аватаров ===
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "uploads", "avatars");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const uploadAvatar = multer({ 
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB лимит
});

// === Multer для загрузки файлов ===
const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.query.type || "files";
    const dir = path.join(__dirname, "uploads", type);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
import busboy from "busboy"; // добавь импорт наверху

// === Загрузка больших файлов (стриминг) ===
app.post("/upload-file", authMiddleware, (req, res) => {
  const bb = busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024 * 1024 } }); // до 10 GB

  let saveTo;
  let originalName = "";
  let filePath = "";
  let category = "general";
  let price = 0;

  bb.on("file", (name, file, info) => {
    originalName = info.filename;
    const type = req.query.type || "files";
    const uploadDir = path.join(__dirname, "uploads", type);

    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const filename = Date.now() + "-" + originalName;
    filePath = path.join("uploads", type, filename);
    saveTo = path.join(uploadDir, filename);

    file.pipe(fs.createWriteStream(saveTo));
  });

  bb.on("field", (name, val) => {
    if (name === "category") category = val;
    if (name === "price") price = parseFloat(val) || 0;
  });

  bb.on("close", async () => {
    try {
      await db.run(
        "INSERT INTO files (name, category, path, uploadedBy, price) VALUES (?, ?, ?, ?, ?)",
        [originalName, category, filePath, req.user.id, price]
      );
      res.json({ success: true, file: { name: originalName, path: "/" + filePath } });
    } catch (err) {
      console.error("Ошибка записи в базу:", err);
      res.status(500).json({ error: "Не удалось сохранить файл в базу" });
    }
  });

  req.pipe(bb);
});

// === Загрузка аватара ===
app.post("/upload-avatar", authMiddleware, uploadAvatar.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Аватар не загружен" });

    const filePath = path.join("uploads", "avatars", req.file.filename);

    // Сохраняем новый путь в профиле
    await db.run("UPDATE users SET avatar = ? WHERE id = ?", [filePath, req.user.id]);

    res.json({ success: true, avatar: `/${filePath}` });
  } catch (err) {
    console.error("Ошибка загрузки аватара:", err);
    res.status(500).json({ error: "Не удалось загрузить аватар" });
  }
});

// === Обновление профиля ===
app.put("/profile", authMiddleware, async (req, res) => {
  const { username, about } = req.body;
  try {
    if (!username) return res.status(400).json({ error: "Имя не может быть пустым" });

    await db.run("UPDATE users SET username = ?, about = ? WHERE id = ?", [
      username,
      about || "",
      req.user.id,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка обновления профиля:", err);
    res.status(500).json({ error: "Не удалось обновить профиль" });
  }
});

// === Удаление файлов (только автор или админ) ===
app.delete("/files/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const file = await db.get("SELECT * FROM files WHERE id = ?", [id]);
    if (!file) return res.status(404).json({ error: "Файл не найден" });

    if (file.uploadedBy !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: "Нет прав на удаление файла" });
    }

    // Удаляем физический файл
    const filePath = path.join(__dirname, file.path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Удаляем запись из БД
    await db.run("DELETE FROM files WHERE id = ?", [id]);

    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка удаления файла:", err);
    res.status(500).json({ error: "Не удалось удалить файл" });
  }
});

// === Фильтр типов файлов ===
const safeExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".txt", ".zip"];
const uploadSafeFile = multer({
  storage: fileStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!safeExtensions.includes(ext)) {
      return cb(new Error("Недопустимый тип файла"));
    }
    cb(null, true);
  },
});

// Используй uploadSafeFile вместо uploadFile, если хочешь ограничение
app.post("/safe-upload", authMiddleware, uploadSafeFile.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });

    const { originalname, filename } = req.file;
    const { category, price } = req.body;

    // Проверяем категорию
    const allowedCategories = ["general", "docs", "images", "music"];
    const cat = allowedCategories.includes(category) ? category : "general";

    const filePath = path.join("uploads", req.query.type || "files", filename);

    await db.run(
      "INSERT INTO files (name, category, path, uploadedBy, price) VALUES (?, ?, ?, ?, ?)",
      [originalname, cat, filePath, req.user.id, price || 0]
    );

    res.json({ success: true, file: { name: originalname, path: `/${filePath}` } });
  } catch (err) {
    console.error("Ошибка безопасной загрузки:", err);
    res.status(500).json({ error: "Не удалось загрузить файл" });
  }
});

// === Регистрация ===
app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  try {
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Заполните все поля" });
    }
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

  const vip = await db.get("SELECT * FROM vip WHERE userId = ? AND active = 1", [user.id]);
  let role = user.role;
  if (user.email === "juliaangelss26@gmail.com") {
    role = "admin";
  } else if (vip && vip.amount >= 10) {
    role = "developer";
    await db.run("UPDATE users SET role = 'developer' WHERE id = ?", [user.id]);
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
  res.json({ token, role });
});

// === Профиль ===
app.get("/profile", authMiddleware, async (req, res) => {
  let user = await db.get(
    "SELECT id, username, role, about, avatar, email FROM users WHERE id = ?",
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });

  if (!fs.existsSync(path.join(__dirname, user.avatar))) {
    user.avatar = "uploads/avatars/default.png";
  }

  user.avatar = `/${user.avatar}`;
  res.json(user);
});

// === Чат ===
app.get("/chat/:type", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const chatType = req.params.type;

    if (!["global", "private"].includes(chatType)) {
      return res.status(400).json({ error: "Неверный тип чата" });
    }

    let query = `
      SELECT chat.id, chat.content, chat.createdAt, 
             u.username, u.role
      FROM chat
      JOIN users u ON u.id = chat.senderId
    `;

    if (chatType === "private") {
      query += ` WHERE chat.receiverId = ? OR chat.senderId = ? ORDER BY chat.createdAt DESC LIMIT 50`;
      const messages = await db.all(query, [userId, userId]);
      return res.json(messages.reverse());
    } else {
      query += ` WHERE chat.chatType = 'global' ORDER BY chat.createdAt DESC LIMIT 50`;
      const messages = await db.all(query);
      return res.json(messages.reverse());
    }
  } catch (e) {
    console.error("Ошибка загрузки чата:", e);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/chat/:type", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { content, receiverId } = req.body;
    const chatType = req.params.type;

    if (!content || content.length > 500) {
      return res.status(400).json({ error: "Сообщение пустое или слишком длинное" });
    }

    if (chatType === "private" && !receiverId) {
      return res.status(400).json({ error: "Укажите получателя" });
    }

    await db.run(
      `INSERT INTO chat (chatType, senderId, receiverId, content) VALUES (?, ?, ?, ?)`,
      [chatType, userId, chatType === "private" ? receiverId : null, content]
    );

    res.json({ success: true });
  } catch (e) {
    console.error("Ошибка отправки сообщения:", e);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// === Комментарии к файлам ===
app.get("/files/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    const comments = await db.all(
      `SELECT fc.id, fc.content, fc.createdAt, u.username 
       FROM file_comments fc
       JOIN users u ON u.id = fc.userId
       WHERE fc.fileId = ?
       ORDER BY fc.createdAt DESC`,
      [id]
    );
    res.json(comments);
  } catch {
    res.status(500).json({ error: "Ошибка загрузки комментариев" });
  }
});

app.post("/files/:id/comments", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "Комментарий пустой" });

    await db.run(
      "INSERT INTO file_comments (fileId, userId, content) VALUES (?, ?, ?)",
      [id, req.user.id, content]
    );
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Ошибка добавления комментария" });
  }
});

// === Лайки ("мяук") ===
app.post("/files/:id/like", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.get(
      "SELECT * FROM file_likes WHERE fileId = ? AND userId = ?",
      [id, req.user.id]
    );

    if (existing) {
      await db.run("DELETE FROM file_likes WHERE id = ?", [existing.id]);
      return res.json({ success: true, liked: false });
    } else {
      await db.run("INSERT INTO file_likes (fileId, userId) VALUES (?, ?)", [
        id,
        req.user.id,
      ]);
      return res.json({ success: true, liked: true });
    }
  } catch {
    res.status(500).json({ error: "Ошибка лайка" });
  }
});

app.get("/files/:id/likes", async (req, res) => {
  try {
    const { id } = req.params;
    const count = await db.get(
      "SELECT COUNT(*) as total FROM file_likes WHERE fileId = ?",
      [id]
    );
    res.json({ total: count.total });
  } catch {
    res.status(500).json({ error: "Ошибка подсчёта лайков" });
  }
});

// === Админка: список файлов ===
app.get("/admin/files", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Доступ запрещен" });
  const files = await db.all("SELECT * FROM files ORDER BY createdAt DESC");
  res.json(files);
});

// === Админка: управление сообщениями ===
app.get("/admin/messages", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Доступ запрещен" });
  const msgs = await db.all("SELECT * FROM messages");
  res.json(msgs);
});

app.post("/admin/messages", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Доступ запрещен" });
  const { type, content } = req.body;
  await db.run("INSERT INTO messages (type, content) VALUES (?, ?)", [type, content]);
  res.json({ success: true });
});

app.put("/admin/messages/:id", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Доступ запрещен" });
  const { id } = req.params;
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: "Текст не может быть пустым" });

  await db.run("UPDATE messages SET content = ? WHERE id = ?", [content, id]);
  res.json({ success: true });
});

app.delete("/admin/messages/:id", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Доступ запрещен" });
  const { id } = req.params;
  await db.run("DELETE FROM messages WHERE id = ?", [id]);
  res.json({ success: true });
});

// === Сообщения (кошка и летучая мышь) ===
app.get("/messages/:type", async (req, res) => {
  const { type } = req.params;
  const msg = await db.get("SELECT content FROM messages WHERE type = ? ORDER BY RANDOM() LIMIT 1", [type]);
  if (!msg) return res.json({ message: "Сообщений пока нет." });
  res.json({ message: msg.content });
});

// === Стикеры ===
app.get("/stickers", async (req, res) => {
  try {
    const stickersDir = path.join(__dirname, "uploads", "stickers");

    if (!fs.existsSync(stickersDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(stickersDir)
      .filter(file => /\.(png|jpg|jpeg|gif|webp)$/i.test(file));

    res.json(files.map(file => ({
      name: file,
      url: `/uploads/stickers/${file}`
    })));
  } catch (err) {
    console.error("Ошибка при загрузке стикеров:", err);
    res.status(500).json({ error: "Не удалось загрузить стикеры" });
  }
});

// === Список пользователей ===
app.get("/users", async (req, res) => {
  try {
    const users = await db.all("SELECT id, username FROM users WHERE banned = 0");
    res.json(users);
  } catch (err) {
    console.error("Ошибка получения списка пользователей:", err);
    res.status(500).json({ error: "Не удалось загрузить пользователей" });
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

app.post("/create-order", authMiddleware, async (req, res) => {
  const { amount } = req.body;
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "EUR", value: amount } }],
  });

  try {
    const order = await paypalClient.execute(request);
    res.json(order.result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при создании заказа" });
  }
});

app.post("/capture-order", authMiddleware, async (req, res) => {
  const { orderID, days, amount } = req.body;
  const request = new paypal.orders.OrdersCaptureRequest(orderID);
  request.requestBody({});
  try {
    const capture = await paypalClient.execute(request);

    if (capture.result.status === "COMPLETED") {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (days || 30));

      await db.run(
        "INSERT INTO vip (userId, expiresAt, amount) VALUES (?, ?, ?)",
        [req.user.id, expiresAt.toISOString(), amount]
      );

      if (amount >= 10) {
        await db.run("UPDATE users SET role = 'developer' WHERE id = ?", [req.user.id]);
      }

      res.json(capture.result);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при подтверждении платежа" });
  }
});
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
// Обработчик ошибок
app.use((err, req, res, next) => {
  console.error("Ошибка сервера:", err.stack);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});
// === Запуск сервера ===
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
