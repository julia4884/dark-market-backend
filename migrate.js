import sqlite3 from "sqlite3";
import { open } from "sqlite";
import bcrypt from "bcrypt";

const migrate = async () => {
  const db = await open({
    filename: "./database.sqlite",
    driver: sqlite3.Database,
  });

  // Создание таблицы пользователей
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user', -- user / developer / admin
      avatar TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Создание таблицы файлов
  await db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      section TEXT NOT NULL,
      size REAL DEFAULT 0,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Проверяем, есть ли админ
  const adminEmail = "juliaangelss26@gmail.com";
  const adminPassword = "dark4884";
  const existingAdmin = await db.get("SELECT * FROM users WHERE email = ?", [adminEmail]);

  if (!existingAdmin) {
    const hashed = await bcrypt.hash(adminPassword, 10);
    await db.run(
      "INSERT INTO users (username, email, password, role, avatar) VALUES (?, ?, ?, ?, ?)",
      ["SuperAdmin", adminEmail, hashed, "admin", "uploads/avatars/default.png"]
    );
    console.log("✅ Админ создан: email = juliaangelss26@gmail.com, пароль = dark4884");
  } else {
    console.log("ℹ️ Админ уже существует, пропускаем создание.");
  }

  console.log("✅ Migration completed successfully");
  await db.close();
};

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
