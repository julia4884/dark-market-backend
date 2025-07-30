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

    // Создание администратора при первом запуске
    db.get("SELECT * FROM users WHERE email = ?", ["juliaangelss26@gmail.com"], (err, row) => {
        if (!row) {
            bcrypt.hash("dark4884", 10, (err, hash) => {
                db.run(
                    "INSERT INTO users (email, password, username, role, subscription) VALUES (?, ?, ?, 'admin', 'Разработчик')",
                    ["juliaangelss26@gmail.com", hash, "administrator"]
                );
            });
        }
    });
});

// === Middleware для токена ===
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

// === Настройка multer ===
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const section = req.body.section || "misc";
        const dir = `uploads/${section}`;
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
