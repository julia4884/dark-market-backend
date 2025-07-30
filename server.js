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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === Разделы ===
const sections = ["images", "books", "games", "movies", "music", "apps", "tools"];
sections.forEach(section => {
    const dir = path.join(__dirname, "uploads", section);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    app.use(`/${section}`, express.static(dir));
});
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const db = new sqlite3.Database("./users.db");
const SECRET_KEY = "dark_secret_key";

// === Таблица пользователей ===
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

// === Таблицы для разделов ===
sections.forEach(section => {
    db.run(`CREATE TABLE IF NOT EXISTS ${section} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        filename TEXT NOT NULL,
        price REAL DEFAULT 0,
        cover TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS purchases_${section} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        itemId INTEGER NOT NULL
    )`);
});

// === Создание админа ===
db.get("SELECT * FROM users WHERE role = 'admin'", (err, row) => {
    if (!row) {
        const hash = bcrypt.hashSync("dark4884", 10);
        db.run("INSERT INTO users (email, password, username, role, subscription) VALUES (?, ?, ?, ?, ?)",
            ["juliaangelss26@gmail.com", hash, "administrator", "admin", "Разработчик"]);
        console.log("✅ Админ создан");
    }
});

// === JWT Middleware ===
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

// === Регистрация ===
app.post("/register", (req, res) => {
    const { email, password, username } = req.body;
    if (!email || !password || !username) return res.status(400).json({ success: false, error: "Все поля обязательны" });

    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (email, password, username) VALUES (?, ?, ?)",
        [email, hash, username], err => {
            if (err) return res.status(400).json({ success: false, error: "Email уже используется" });
            res.json({ success: true });
        });
});

// === Вход ===
app.post("/login", (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err || !user) return res.status(404).json({ success: false, error: "Пользователь не найден" });
        if (user.banned) return res.status(403).json({ success: false, error: "Аккаунт заблокирован" });
        if (!bcrypt.compareSync(password, user.password)) return res.status(403).json({ success: false, error: "Неверный пароль" });

        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username, role: user.role, subscription: user.subscription },
            SECRET_KEY, { expiresIn: "2h" });

        res.json({ success: true, token });
    });
});

// === Профиль ===
app.get("/profile", authenticateToken, (req, res) => {
    db.get("SELECT id, email, username, role, subscription, about, photo, banned FROM users WHERE id = ?",
        [req.user.id], (err, user) => {
            if (err || !user) return res.status(404).json({ success: false, error: "Пользователь не найден" });
            res.json({ success: true, ...user });
        });
});

// === Фото профиля ===
const photoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, "uploads", "photos");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const uploadPhoto = multer({ storage: photoStorage });

app.post("/upload-photo", authenticateToken, uploadPhoto.single("photo"), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "Файл не получен" });

    const photoPath = `/uploads/photos/${req.file.filename}`;
    db.run("UPDATE users SET photo = ? WHERE id = ?", [photoPath, req.user.id], err => {
        if (err) return res.status(500).json({ success: false, error: "Ошибка базы" });
        res.json({ success: true, photo: photoPath });
    });
});

// === Универсальные маршруты для всех разделов ===
function createUploadRoutes(section) {
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads", section)),
        filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
    });
    const upload = multer({ storage });

    // Загрузка
    app.post(`/upload-${section}`, authenticateToken, upload.single("file"), (req, res) => {
        if (!req.file) return res.status(400).json({ success: false, error: "Файл не получен" });
        const { title, price } = req.body;
        db.run(`INSERT INTO ${section} (title, filename, price) VALUES (?, ?, ?)`,
            [title, req.file.filename, price],
            function (err) {
                if (err) return res.status(500).json({ success: false, error: "Ошибка базы" });
                res.json({ success: true, id: this.lastID });
            });
    });

    // Список
    app.get(`/${section}/list`, (req, res) => {
        db.all(`SELECT * FROM ${section}`, [], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: "Ошибка базы" });
            res.json({
                success: true,
                items: rows.map(r => ({
                    id: r.id,
                    title: r.title,
                    price: r.price,
                    filename: r.filename,
                    free: r.price === 0
                }))
            });
        });
    });

    // Покупка
    app.post(`/buy-${section}`, authenticateToken, (req, res) => {
        const { itemId } = req.body;
        db.get(`SELECT price FROM ${section} WHERE id = ?`, [itemId], (err, item) => {
            if (!item) return res.status(404).json({ success: false, error: "Файл не найден" });

            if (item.price === 0) {
                return res.json({ success: true, message: "Файл бесплатный, скачивайте без покупки!" });
            }

            db.run(`INSERT INTO purchases_${section} (userId, itemId) VALUES (?, ?)`,
                [req.user.id, itemId], err => {
                    if (err) return res.status(500).json({ success: false, error: "Ошибка покупки" });
                    res.json({ success: true, message: "Покупка успешно совершена!" });
                });
        });
    });

    // Проверка покупки
    app.post(`/check-purchase-${section}`, authenticateToken, (req, res) => {
        const { itemId } = req.body;
        db.get(`SELECT * FROM ${section} WHERE id = ?`, [itemId], (err, item) => {
            if (!item) return res.json({ success: false, purchased: false });

            if (item.price === 0) {
                return res.json({ success: true, purchased: true, file: item.filename });
            }

            db.get(`SELECT * FROM purchases_${section} WHERE userId = ? AND itemId = ?`,
                [req.user.id, itemId], (err, row) => {
                    if (row) res.json({ success: true, purchased: true, file: item.filename });
                    else res.json({ success: true, purchased: false });
                });
        });
    });
}

sections.forEach(createUploadRoutes);

// === Запуск ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡ Dark Market Ultra запущен на порту ${PORT}`));
