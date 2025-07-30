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

// Раздаём папки
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/images", express.static(path.join(__dirname, "images")));
app.use("/books", express.static(path.join(__dirname, "books")));

const db = new sqlite3.Database("./users.db");
const SECRET_KEY = "dark_secret_key";

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

// Таблицы покупок
db.run(`CREATE TABLE IF NOT EXISTS purchases_books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    bookId INTEGER NOT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS purchases_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    imageId INTEGER NOT NULL
)`);

// =================== Создание администратора ===================
db.get("SELECT * FROM users WHERE role = 'admin'", (err, row) => {
    if (!row) {
        const hash = bcrypt.hashSync("dark4884", 10);
        db.run("INSERT INTO users (email, password, username, role, subscription) VALUES (?, ?, ?, ?, ?)", 
            ["juliaangelss26@gmail.com", hash, "administrator", "admin", "Разработчик"]);
        console.log("✅ Админ создан");
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
        res.json({ success: true, books: rows });
    });
});

app.post("/buy-book", authenticateToken, (req, res) => {
    const { bookId } = req.body;
    db.get("SELECT * FROM books WHERE id = ?", [bookId], (err, book) => {
        if (err || !book) return res.status(404).json({ success: false, error: "Книга не найдена" });
        db.run("INSERT INTO purchases_books (userId, bookId) VALUES (?, ?)", [req.user.id, bookId], (err) => {
            if (err) return res.status(500).json({ success: false, error: "Ошибка покупки" });
            res.json({ success: true, message: "Книга куплена" });
        });
    });
});

app.post("/check-purchase", authenticateToken, (req, res) => {
    const { bookId } = req.body;
    db.get("SELECT * FROM purchases_books WHERE userId = ? AND bookId = ?", [req.user.id, bookId], (err, row) => {
        if (row) {
            db.get("SELECT filename FROM books WHERE id = ?", [bookId], (err, book) => {
                res.json({ success: true, purchased: true, file: book.filename });
            });
        } else {
            res.json({ success: true, purchased: false });
        }
    });
});

// =================== Картинки ===================
const imageStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "images/"),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const uploadImage = multer({ storage: imageStorage });

app.post("/upload-image", authenticateToken, uploadImage.single("image"), (req, res) => {
    if (req.user.role !== "admin" && req.user.subscription !== "Разработчик") {
        return res.status(403).json({ success: false, error: "Нет прав" });
    }

    const { title, price } = req.body;
    db.run("INSERT INTO images (title, filename, price) VALUES (?, ?, ?)", 
        [title, req.file.filename, price || 0], 
        function(err) {
            if (err) return res.status(500).json({ success: false, error: "Ошибка сохранения картинки" });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.get("/images/list", (req, res) => {
    db.all("SELECT * FROM images", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: "Ошибка получения картинок" });
        res.json({ success: true, images: rows });
    });
});

app.post("/buy-image", authenticateToken, (req, res) => {
    const { imageId } = req.body;
    db.get("SELECT * FROM images WHERE id = ?", [imageId], (err, image) => {
        if (err || !image) return res.status(404).json({ success: false, error: "Картинка не найдена" });
        db.run("INSERT INTO purchases_images (userId, imageId) VALUES (?, ?)", [req.user.id, imageId], (err) => {
            if (err) return res.status(500).json({ success: false, error: "Ошибка покупки" });
            res.json({ success: true, message: "Картинка куплена" });
        });
    });
});

app.post("/check-purchase-image", authenticateToken, (req, res) => {
    const { imageId } = req.body;
    db.get("SELECT * FROM purchases_images WHERE userId = ? AND imageId = ?", [req.user.id, imageId], (err, row) => {
        if (row) {
            db.get("SELECT filename FROM images WHERE id = ?", [imageId], (err, image) => {
                res.json({ success: true, purchased: true, file: image.filename });
            });
        } else {
            res.json({ success: true, purchased: false });
        }
    });
});

// =================== Запуск ===================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡ Backend работает на порту ${PORT}`));
