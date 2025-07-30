import sqlite3 from "sqlite3";

const db = new sqlite3.Database("./database.sqlite");

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

    console.log("✅ Таблицы проверены/созданы");
});

db.close();
