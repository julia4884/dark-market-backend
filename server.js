import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import path from "path";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use("/uploads", express.static("uploads"));

let db;

// подключение БД
(async () => {
  db = await open({
    filename: "./database.sqlite",
    driver: sqlite3.Database,
  });
})();

// Multer для загрузок
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// Middleware для проверки токена
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Нет токена" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Неверный токен" });
    req.user = user;
    next();
  });
}

// Middleware только для разработчиков и админов
function developerMiddleware(req, res, next) {
  if (req.user.role !== "developer" && req.user.role !== "admin") {
    return res.status(403).json({ error: "Доступно только разработчикам" });
  }
  next();
}

// регистрация
app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);

  try {
    await db.run(
      "INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'user')",
      [username, email, hashed]
    );
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Email уже используется" });
  }
});

// вход
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user) return res.status(400).json({ error: "Пользователь не найден" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: "Неверный пароль" });

  const token = jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "2h" }
  );
  res.json({ token, role: user.role, username: user.username });
});

// загрузка файла (только dev и admin)
app.post("/upload-file", authMiddleware, developerMiddleware, upload.single("file"), async (req, res) => {
  const { section, price = 0 } = req.body;
  try {
    const result = await db.run(
      "INSERT INTO files (user_id, filename, section, price) VALUES (?, ?, ?, ?)",
      [req.user.id, req.file.filename, section, price]
    );
    res.json({ success: true, fileId: result.lastID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при загрузке" });
  }
});

// просмотр файлов
app.get("/files/:section", async (req, res) => {
  const files = await db.all("SELECT * FROM files WHERE section = ?", [req.params.section]);
  res.json(files);
});

// запуск сервера
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
