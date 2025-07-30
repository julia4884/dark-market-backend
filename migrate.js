import sqlite3 from "sqlite3";

const db = new sqlite3.Database("./database.sqlite");

db.serialize(() => {
    // Таблица пользователей
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        username TEXT,
        role TEXT DEFAULT 'user', -- user/admin
        subscription TEXT DEFAULT 'none', -- none/premium/dev
        about TEXT,
        photo TEXT,
        blocked INTEGER DEFAULT 0,
        token TEXT
    )`);

    // Таблица файлов
    db.run(`CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section TEXT, -- games, movies, music, images, books, apps, tools
        filename TEXT,
        originalname TEXT,
        price REAL DEFAULT 0,
        ownerId INTEGER,
        blocked INTEGER DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(ownerId) REFERENCES users(id)
    )`);

    // Таблица покупок
    db.run(`CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER,
        fileId INTEGER,
        purchasedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(id),
        FOREIGN KEY(fileId) REFERENCES files(id)
    )`);

    // Создание админского аккаунта, если его нет
    db.get(`SELECT * FROM users WHERE email = ?`, ["juliaangelss26@gmail.com"], (err, row) => {
        if (!row) {
            db.run(
                `INSERT INTO users (email, password, username, role, subscription) 
                 VALUES (?, ?, ?, ?, ?)`,
                ["juliaangelss26@gmail.com", "dark4884", "administrator", "admin", "dev"],
                function (err) {
                    if (err) {
                        console.error("❌ Ошибка при создании админа:", err.message);
                    } else {
                        console.log("✅ Админский аккаунт успешно создан");
                    }
                }
            );
        } else {
            console.log("ℹ️ Админский аккаунт уже существует");
        }
    });

    console.log("✅ Все таблицы проверены/созданы");
});

db.close();
