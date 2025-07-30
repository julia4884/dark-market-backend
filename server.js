import express from "express";
import sqlite3 from "sqlite3";
import bcrypt from "bcrypt";
import bodyParser from "body-parser";
import cors from "cors";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Для работы с __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Раздаём папки
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/devfiles", express.static(path.join(__dirname, "devfiles")));
app.use("/images", express.static(path.join(__dirname, "images")));
app.use("/books", express.static(path.join(__dirname, "books")));

const db = new sqlite3.Database("./users.db");
const SECRET_KEY = "dark_secret_key"; // ⚠️ лучше вынести в .env

// Создаём таблицы
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    username TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    subscription TEXT DEFAULT 'Нет',
    photo TEXT,
    about TEXT,
    banned INTEGER DEFAULT 0
)`);

db.run(`CREATE TABLE IF NOT EXISTS blocked_apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appName TEXT UNIQUE NOT NULL
)`);

// Создаём администратора, если его нет
db.get("SELECT * FROM users WHERE role = 'admin'", (err, row) => {
    if (!row) {
        const hash = bcrypt.hashSync("dark4884", 10);
        db.run("INSERT INTO users (email, password, username, role, subscription) VALUES (?, ?, ?, ?, ?)", 
            ["juliaangelss26@gmail.com", hash, "administrator", "admin", "Разработчик"]);
        console.log("✅ Админ создан: juliaangelss26@gmail.com / dark4884");
    }
});

// Middleware проверки токена
function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ success: false, error: "Нет токена" });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ success: false, error: "Неверный токен" });
        req.user = user;
        next();
    });
}

// 📌 Регистрация
app.post("/register", (req, res) => {
    const { email, password, username } = req.body;
    if (!email || !password || !username) {
        return res.status(400).json({ success: false, error: "Все поля обязательны" });
    }
    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (email, password, username) VALUES (?, ?, ?)", 
        [email, hash, username], 
        (err) => {
            if (err) return res.status(400).json({ success: false, error: "Email уже используется" });
            res.json({ success: true });
        }
    );
});

// 📌 Логин
app.post("/login", (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err || !user) return res.status(404).json({ success: false, error: "Пользователь не найден" });
        if (user.banned) return res.status(403).json({ success: false, error: "Аккаунт заблокирован" });
        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(403).json({ success: false, error: "Неверный пароль" });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username, role: user.role },
            SECRET_KEY,
            { expiresIn: "2h" }
        );

        res.json({ success: true, token });
    });
});

// 📌 Профиль
app.get("/profile", authenticateToken, (req, res) => {
    db.get("SELECT id, email, username, role, subscription, about, photo, banned FROM users WHERE id = ?", 
    [req.user.id], 
    (err, user) => {
        if (err || !user) return res.status(404).json({ success: false, error: "Пользователь не найден" });
        res.json({ success: true, ...user });
    });
});

// 📌 Обновление "о себе"
app.post("/profile/update", authenticateToken, (req, res) => {
    const { about } = req.body;
    db.run("UPDATE users SET about = ? WHERE id = ?", [about, req.user.id], (err) => {
        if (err) return res.status(500).json({ success: false, error: "Ошибка обновления" });
        res.json({ success: true, about });
    });
});

// 📌 Загрузка фото
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + "-" + file.originalname);
    }
});
const upload = multer({ storage });

app.post("/upload-photo", authenticateToken, upload.single("photo"), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "Файл не получен" });

    const photoPath = `/uploads/${req.file.filename}`;
    db.run("UPDATE users SET photo = ? WHERE id = ?", [photoPath, req.user.id], (err) => {
        if (err) return res.status(500).json({ success: false, error: "Ошибка сохранения фото" });
        res.json({ success: true, url: photoPath });
    });
});

// 📌 Загрузка файлов разработчика
const devStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "devfiles/"),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + "-" + file.originalname);
    }
});
const uploadDev = multer({ storage: devStorage });

app.post("/upload-dev-files", authenticateToken, uploadDev.array("files"), (req, res) => {
    if (req.user.role !== "admin" && req.user.subscription !== "Разработчик") {
        return res.status(403).json({ success: false, error: "Нет прав" });
    }
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, error: "Файлы не получены" });
    }
    res.json({ success: true, files: req.files.map(f => `/devfiles/${f.filename}`) });
});

// 📌 Список картинок
app.get("/list-images", (req, res) => {
    fs.readdir(path.join(__dirname, "images"), (err, files) => {
        if (err) return res.status(500).json({ success: false, error: "Ошибка чтения папки" });
        res.json(files);
    });
});

// 📌 Список книг
app.get("/list-books", (req, res) => {
    fs.readdir(path.join(__dirname, "books"), (err, files) => {
        if (err) return res.status(500).json({ success: false, error: "Ошибка чтения папки" });
        res.json(files);
    });
});

// 📌 Блокировка пользователя
app.post("/admin/block-user", authenticateToken, (req, res) => {
    if (req.user.role !== "admin" || req.user.email !== "juliaangelss26@gmail.com") {
        return res.status(403).json({ success: false, error: "Нет прав администратора" });
    }
    const { email } = req.body;
    db.run("UPDATE users SET banned = 1 WHERE email = ?", [email], function(err) {
        if (err || this.changes === 0) return res.status(400).json({ success: false, error: "Пользователь не найден" });
        res.json({ success: true, message: "Пользователь заблокирован" });
    });
});

// 📌 Блокировка приложения
app.post("/admin/block-app", authenticateToken, (req, res) => {
    if (req.user.role !== "admin" || req.user.email !== "juliaangelss26@gmail.com") {
        return res.status(403).json({ success: false, error: "Нет прав администратора" });
    }
    const { appName } = req.body;
    db.run("INSERT OR IGNORE INTO blocked_apps (appName) VALUES (?)", [appName], (err) => {
        if (err) return res.status(500).json({ success: false, error: "Ошибка блокировки" });
        res.json({ success: true, message: "Приложение заблокировано" });
    });
});

// 🚀 Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡ Backend работает на порту ${PORT}`));
