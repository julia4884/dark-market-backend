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

// Для __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Раздаём папки
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/devfiles", express.static(path.join(__dirname, "devfiles")));
app.use("/images", express.static(path.join(__dirname, "images")));
app.use("/books", express.static(path.join(__dirname, "books")));

const db = new sqlite3.Database("./users.db");
const SECRET_KEY = "dark_secret_key"; // ⚠️ Лучше вынести в .env

// =================== Таблицы ===================
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

db.run(`CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    price REAL DEFAULT 0
)`);

db.run(`CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    cover TEXT,
    price REAL DEFAULT 0
)`);

// =================== Создание администратора ===================
db.get("SELECT * FROM users WHERE role = 'admin'", (err, row) => {
    if (!row) {
        const hash = bcrypt.hashSync("dark4884", 10);
        db.run("INSERT INTO users (email, password, username, role, subscription) VALUES (?, ?, ?, ?, ?)", 
            ["juliaangelss26@gmail.com", hash, "administrator", "admin", "Разработчик"]);
        console.log("✅ Админ создан: juliaangelss26@gmail.com / dark4884");
    }
});

// =================== Middleware ===================
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

// =================== Регистрация / Логин ===================
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

app.post("/login", (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err || !user) return res.status(404).json({ success: false, error: "Пользователь не найден" });
        if (user.banned) return res.status(403).json({ success: false, error: "Аккаунт заблокирован" });
        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(403).json({ success: false, error: "Неверный пароль" });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username, role: user.role, subscription: user.subscription },
            SECRET_KEY,
            { expiresIn: "2h" }
        );

        res.json({ success: true, token });
    });
});

// =================== Профиль ===================
app.get("/profile", authenticateToken, (req, res) => {
    db.get("SELECT id, email, username, role, subscription, about, photo, banned FROM users WHERE id = ?", 
    [req.user.id], 
    (err, user) => {
        if (err || !user) return res.status(404).json({ success: false, error: "Пользователь не найден" });
        res.json({ success: true, ...user });
    });
});

app.post("/profile/update", authenticateToken, (req, res) => {
    const { about } = req.body;
    db.run("UPDATE users SET about = ? WHERE id = ?", [about, req.user.id], (err) => {
        if (err) return res.status(500).json({ success: false, error: "Ошибка обновления" });
        res.json({ success: true, about });
    });
});

// =================== Фото профиля ===================
const upload = multer({ storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
})});

app.post("/upload-photo", authenticateToken, upload.single("photo"), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "Файл не получен" });

    const photoPath = `/uploads/${req.file.filename}`;
    db.run("UPDATE users SET photo = ? WHERE id = ?", [photoPath, req.user.id], (err) => {
        if (err) return res.status(500).json({ success: false, error: "Ошибка сохранения фото" });
        res.json({ success: true, url: photoPath });
    });
});

// =================== Книги ===================
const bookStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "books/"),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const uploadBook = multer({ storage: bookStorage });

app.post("/upload-book", authenticateToken, uploadBook.fields([{ name: "book" }, { name: "cover" }]), (req, res) => {
    if (req.user.role !== "admin" && req.user.subscription !== "Разработчик") {
        return res.status(403).json({ success: false, error: "Нет прав" });
    }

    const bookFile = req.files["book"]?.[0];
    const coverFile = req.files["cover"]?.[0];
    const { title, price } = req.body;

    if (!bookFile || !coverFile) {
        return res.status(400).json({ success: false, error: "Файл книги и обложка обязательны" });
    }

    db.run("INSERT INTO books (title, filename, cover, price) VALUES (?, ?, ?, ?)", 
        [title, bookFile.filename, coverFile.filename, price || 0], 
        function(err) {
            if (err) return res.status(500).json({ success: false, error: "Ошибка сохранения книги" });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.get("/list-books", (req, res) => {
    db.all("SELECT * FROM books", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: "Ошибка получения книг" });
        res.json(rows);
    });
});

app.post("/buy-book", authenticateToken, (req, res) => {
    const { bookName } = req.body;
    db.get("SELECT * FROM books WHERE title = ?", [bookName], (err, book) => {
        if (err || !book) return res.status(404).json({ success: false, error: "Книга не найдена" });
        res.json({ success: true, message: `Оплата книги '${book.title}' (${book.price}€) проведена (тест).` });
    });
});

// =================== Админ ===================
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

// =================== Запуск ===================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡ Backend работает на порту ${PORT}`));
