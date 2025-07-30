import express from "express";
import sqlite3 from "sqlite3";
import bcrypt from "bcrypt";
import bodyParser from "body-parser";
import cors from "cors";
import multer from "multer";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const db = new sqlite3.Database("./users.db");

// Таблица пользователей
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT DEFAULT 'user'
)`);

// Автосоздание админа
db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
  if (row.count === 0) {
    const email = "juliaangelss26@gmail.com";
    const password = bcrypt.hashSync("dark4884", 10);
    db.run(
      "INSERT INTO users (email, password, username, role) VALUES (?, ?, ?, 'admin')",
      [email, password, "administrator"]
    );
    console.log("✨ Админ создан автоматически");
  }
});

// Регистрация
app.post("/register", (req, res) => {
  const { email, password, username } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  db.run(
    "INSERT INTO users (email, password, username) VALUES (?, ?, ?)",
    [email, hash, username],
    (err) => {
      if (err) return res.status(400).json({ error: "Email уже используется" });
      res.json({ success: true });
    }
  );
});

// Логин
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(403).json({ error: "Неверный пароль" });
    }
    res.json({ success: true, role: user.role, username: user.username });
  });
});

// Загрузка файлов (для админа)
const upload = multer({ dest: "uploads/" });
app.post("/upload", upload.single("file"), (req, res) => {
  res.json({ success: true, filename: req.file.originalname });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend работает на порту ${PORT}`));
