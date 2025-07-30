import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

const db = new sqlite3.Database("./database.sqlite");

// JWT секрет
const SECRET_KEY = "your_secret_key";

// === Создание таблиц ===
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        username TEXT,
        role TEXT DEFAULT 'user',
        subscription TEXT DEFAULT 'none',
        about TEXT,
        photo TEXT,
        blocked INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section TEXT,
        filename TEXT,
        originalname TEXT,
        price REAL DEFAULT 0,
        ownerId INTEGER,
        blocked INTEGER DEFAULT 0,
        FOREIGN KEY(ownerId) REFERENCES users(id)
    )`);

    // Создаём админа, если его нет
    db.get("SELECT * FROM users WHERE email = ?", ["juliaangelss26@gmail.com"], (err, row) => {
        if (!row) {
            bcrypt.hash("dark4884", 10, (err, hash) => {
                db.run("INSERT INTO users (email, password, username, role, subscription) VALUES (?, ?, ?, 'admin', 'Разработчик')",
                    ["juliaangelss26@gmail.com", hash, "administrator"]);
            });
        }
    });
});

// === Middleware для проверки токена ===
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

// === Multer настройка для загрузки ===
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const section = req.body.section || "misc";
        const dir = `uploads/${section}`;
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// === Регистрация ===
app.post("/register", (req, res) => {
    const { email, password, username } = req.body;
    bcrypt.hash(password, 10, (err, hash) => {
        db.run("INSERT INTO users (email, password, username) VALUES (?, ?, ?)", 
        [email, hash, username], function (err) {
            if (err) return res.json({ success: false, error: "Email уже используется" });
            res.json({ success: true });
        });
    });
});

// === Логин ===
app.post("/login", (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (!user || user.blocked) return res.json({ success: false, error: "Пользователь не найден или заблокирован" });
        bcrypt.compare(password, user.password, (err, result) => {
            if (!result) return res.json({ success: false, error: "Неверный пароль" });
            const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: "2h" });
            res.json({ success: true, token });
        });
    });
});

// === Профиль ===
app.get("/profile", authenticateToken, (req, res) => {
    db.get("SELECT username, role, subscription, about, photo FROM users WHERE id = ?", [req.user.id], (err, user) => {
        if (!user) return res.json({ success: false, error: "Пользователь не найден" });
        res.json({ success: true, ...user });
    });
});

app.post("/profile/update", authenticateToken, (req, res) => {
    const { about } = req.body;
    db.run("UPDATE users SET about = ? WHERE id = ?", [about, req.user.id], (err) => {
        if (err) return res.json({ success: false, error: "Ошибка обновления" });
        res.json({ success: true });
    });
});

app.post("/profile/photo", authenticateToken, upload.single("photo"), (req, res) => {
    const photoPath = `/${req.file.path}`;
    db.run("UPDATE users SET photo = ? WHERE id = ?", [photoPath, req.user.id], (err) => {
        if (err) return res.json({ success: false, error: "Ошибка сохранения фото" });
        res.json({ success: true, photo: photoPath });
    });
});

// === Загрузка файлов ===
app.post("/upload", authenticateToken, upload.single("file"), (req, res) => {
    const { section, price } = req.body;
    db.run("INSERT INTO files (section, filename, originalname, price, ownerId) VALUES (?, ?, ?, ?, ?)",
        [section, req.file.filename, req.file.originalname, price || 0, req.user.id],
        function (err) {
            if (err) return res.json({ success: false, error: "Ошибка загрузки" });
            res.json({ success: true });
        });
});

// === Получение файлов раздела ===
app.get("/files/:section", (req, res) => {
    db.all("SELECT * FROM files WHERE section = ? AND blocked = 0", [req.params.section], (err, rows) => {
        res.json({ success: true, files: rows });
    });
});

// === Админ: блокировка пользователя ===
app.post("/admin/block-user/:id", authenticateToken, (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ success: false, error: "Нет доступа" });
    db.run("UPDATE users SET blocked = 1 WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.json({ success: false, error: "Ошибка блокировки" });
        res.json({ success: true, message: "Пользователь заблокирован" });
    });
});

// === Админ: блокировка файла ===
app.post("/admin/block-file/:id", authenticateToken, (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ success: false, error: "Нет доступа" });
    db.run("UPDATE files SET blocked = 1 WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.json({ success: false, error: "Ошибка блокировки файла" });
        res.json({ success: true, message: "Файл заблокирован" });
    });
});

// === Запуск сервера ===
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
