import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// Настройки путей
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Настройка Multer (загрузка файлов)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = "uploads/files";
    if (file.fieldname === "avatar") folder = "uploads/avatars";
    cb(null, path.join(__dirname, folder));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// Подключение БД
let db;
(async () => {
  db = await open({
    filename: "database.db",
    driver: sqlite3.Database,
  });
  console.log("База данных подключена!");
})();

// Регистрация
app.post("/register", async (req, res) => {
  try {
    const { email, password, username } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const existingUser = await db.get("SELECT * FROM users WHERE email = ?", [email]);
    if (existingUser) {
      return res.status(400).json({ error: "Email уже зарегистрирован" });
    }

    await db.run(
      "INSERT INTO users (email, password, username, role) VALUES (?, ?, ?, ?)",
      [email, hashedPassword, username, "user"]
    );

    res.json({ success: true, message: "Регистрация успешна!" });
  } catch (err) {
    console.error("Ошибка регистрации:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Логин
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);

    if (!user) return res.status(400).json({ error: "Неверный email или пароль" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Неверный email или пароль" });

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "1h" });

    res.json({ success: true, token, role: user.role, username: user.username, id: user.id });
  } catch (err) {
    console.error("Ошибка входа:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Получение профиля
app.get("/profile", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return res.status(401).json({ error: "Нет токена" });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await db.get("SELECT id, email, username, role, avatar FROM users WHERE id = ?", [
      decoded.id,
    ]);

    res.json(user);
  } catch (err) {
    console.error("Ошибка профиля:", err);
    res.status(401).json({ error: "Неверный токен" });
  }
});

// Загрузка аватара
app.post("/upload-avatar", upload.single("avatar"), async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return res.status(401).json({ error: "Нет токена" });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const avatarPath = "uploads/avatars/" + req.file.filename;
    await db.run("UPDATE users SET avatar = ? WHERE id = ?", [avatarPath, decoded.id]);

    res.json({ success: true, avatar: avatarPath });
  } catch (err) {
    console.error("Ошибка загрузки аватара:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Получение аватара (с пустой заглушкой)
app.get("/user-avatar/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await db.get("SELECT avatar FROM users WHERE id = ?", [userId]);

    if (user && user.avatar) {
      const avatarPath = path.join(__dirname, user.avatar);
      if (fs.existsSync(avatarPath)) {
        return res.sendFile(avatarPath);
      }
    }

    // Отдаём прозрачный PNG-заглушку
    const blankImage = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEklEQVR42mP8/5+hHgAHggJ/lA5fXwAAAABJRU5ErkJggg==",
      "base64"
    );
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": blankImage.length,
    });
    return res.end(blankImage);
  } catch (err) {
    console.error("Ошибка при загрузке аватара:", err);
    res.status(500).json({ error: "Ошибка сервера при загрузке аватара" });
  }
});

// Загрузка файлов (только для разработчиков и админов)
app.post("/upload/:category", upload.single("file"), async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return res.status(401).json({ error: "Нет токена" });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.role !== "developer" && decoded.role !== "admin") {
      return res.status(403).json({ error: "Нет прав на загрузку" });
    }

    const filePath = `uploads/${req.params.category}/${req.file.filename}`;
    res.json({ success: true, path: filePath });
  } catch (err) {
    console.error("Ошибка загрузки файла:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Запуск сервера
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
