import sqlite3 from "sqlite3";
import { open } from "sqlite";

const migrate = async () => {
  const db = await open({
    filename: "./database.sqlite",
    driver: sqlite3.Database,
  });

  // таблица пользователей
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user', -- роли: user / developer / admin
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // таблица файлов
  await db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      section TEXT NOT NULL,
      price REAL DEFAULT 0,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  console.log("Migration completed successfully ✅");
  await db.close();
};

migrate().catch((err) => {
  console.error("Migration failed ❌", err);
  process.exit(1);
});
