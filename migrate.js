import sqlite3 from "sqlite3";
import { open } from "sqlite";
import fs from "fs";
import path from "path";

(async () => {
  // Создаём или подключаем базу
  const db = await open({
    filename: "./database.sqlite",
    driver: sqlite3.Database
  });

  console.log("🚀 База подключена.");

  // Создаём таблицу пользователей
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      username TEXT,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Создаём таблицу файлов
  await db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      filename TEXT,
      filepath TEXT,
      uploader_id INTEGER,
      section TEXT,
      price REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploader_id) REFERENCES users(id)
    )
  `);

  // Создаём таблицу покупок
  await db.exec(`
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      file_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (file_id) REFERENCES files(id)
    )
  `);

  console.log("📦 Таблицы готовы.");

  // Создание папок для загрузок
  const uploadDirs = [
    "uploads/images",
    "uploads/books",
    "uploads/games",
    "uploads/music",
    "uploads/movies",
    "uploads/apps",
    "uploads/tools"
  ];

  uploadDirs.forEach(dir => {
    const fullPath = path.resolve(dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`📁 Папка создана: ${dir}`);
    }
  });

  // Создание аккаунта администратора, если его нет
  const adminEmail = "juliaangelss26@gmail.com";
  const adminPassword = "dark4884"; // 💀 пароль из твоего запроса
  const adminUsername = "administrator";

  const existingAdmin = await db.get("SELECT * FROM users WHERE email = ?", [adminEmail]);

  if (!existingAdmin) {
    await db.run(
      "INSERT INTO users (email, password, username, role) VALUES (?, ?, ?, ?)",
      [adminEmail, adminPassword, adminUsername, "admin"]
    );
    console.log("👑 Администратор создан!");
  } else {
    console.log("👑 Администратор уже существует.");
  }

  console.log("✅ Миграция завершена.");
})();
