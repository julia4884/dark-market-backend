alert("✅ Скрипт обновлён и загружен!");
document.addEventListener("DOMContentLoaded", () => {
  // === Авторизация ===
  const loginBtn = document.getElementById("login-btn");
  const registerBtn = document.getElementById("register-btn");
  const logoutBtn = document.getElementById("logout-btn");

  // Поддержка новых id без ломки старых
  function getById(...ids) {
    for (let id of ids) {
      const el = document.getElementById(id);
      if (el) return el;
    }
    return null;
  }

  // Привязка к полям ввода
  const chatInput   = getById("chat-input-main", "chat-input");
  const chatSendBtn = getById("chat-send-main", "chat-send");
  const stickerPanel = getById("sticker-panel-main", "sticker-panel");
  const stickerPanelOwl = getById("sticker-panel-owl", "sticker-panel");
  const stickerToggle = getById("sticker-toggle");

  console.log("✅ Проверка элементов:");
  console.log("chatInput:", chatInput);
  console.log("chatSendBtn:", chatSendBtn);
  console.log("stickerPanel:", stickerPanel);
  console.log("stickerToggle:", stickerToggle);

  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }

  updateUI();
});

// === Глобальные переменные ===
let token = localStorage.getItem("token");
let role = localStorage.getItem("role");

// === Обновление интерфейса ===
async function updateUI() {
  const authSection = document.getElementById("auth-section");
  const logoutSection = document.getElementById("logout-section");

  if (token) {
    if (authSection) authSection.style.display = "none";
    if (logoutSection) logoutSection.style.display = "block";

    try {
      const res = await fetch("/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!data || data.error) {
        logout();
        return;
      }

      role = data.role;
      localStorage.setItem("role", role);

      const profileInfo = document.getElementById("profile-info");
      if (profileInfo) {
        let badge = "";
        if (role === "admin") badge = "👑";
        else if (role === "developer") badge = "💎";

        profileInfo.innerHTML = `
          <div>
            <img src="${data.avatar}" alt="avatar" class="avatar">
            <p><strong>${data.username}</strong> ${badge}</p>
            <p>${data.about || "Нет описания"}</p>
            ${
              role === "admin"
                ? '<a href="admin.html" class="admin-btn">Перейти в админку</a>'
                : role === "developer"
                ? '<a href="developer.html" class="admin-btn">Перейти в кабинет разработчика 💎</a>'
                : '<a href="cabinet.html" class="user-btn">Перейти в личный кабинет</a>'
            }
          </div>
        `;
      }
    } catch {
      logout();
    }
  } else {
    if (authSection) authSection.style.display = "block";
    if (logoutSection) logoutSection.style.display = "none";
  }
}

// === Выход ===
function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  localStorage.removeItem("email");
  token = null;
  role = null;
  const authSection = document.getElementById("auth-section");
  const logoutSection = document.getElementById("logout-section");
  if (authSection) authSection.style.display = "block";
  if (logoutSection) logoutSection.style.display = "none";
}

// === Вход ===
document.getElementById("login-btn")?.addEventListener("click", (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value.trim();
  if (!email || !password) return alert("Заполните все поля!");

  fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
    .then((res) => res.json())
    .then(async (data) => {
      if (data.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("role", data.role);
        localStorage.setItem("email", email);
        token = data.token;
        role = data.role;

        await updateUI();

        if (role === "admin") {
          alert("Добро пожаловать, Администратор 👑");
          window.location.href = "admin.html";
        } else if (role === "developer") {
          alert("Добро пожаловать, Разработчик 💎");
          window.location.href = "developer.html";
        } else {
          alert("Вход выполнен успешно!");
          window.location.href = "cabinet.html";
        }
      } else {
        alert("Ошибка входа: " + (data.error || "Попробуйте снова"));
      }
    })
    .catch(() => alert("Сервер недоступен"));
});

// === Регистрация ===
document.getElementById("register-btn")?.addEventListener("click", (e) => {
  e.preventDefault();
  const username = document.getElementById("register-username").value.trim();
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value.trim();
  if (!username || !email || !password) return alert("Заполните все поля!");

  fetch("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        alert("Регистрация успешна! Войдите.");
      } else {
        alert("Ошибка регистрации: " + (data.error || "Попробуйте снова"));
      }
    })
    .catch(() => alert("Сервер недоступен"));
});

// === Донат PayPal ===
async function handleDonation(orderID, amount = 10) {
  try {
    const res = await fetch("/capture-order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify({ orderID, days: 30, amount }),
    });
    const data = await res.json();

    if (data.status === "COMPLETED") {
      alert("Спасибо за поддержку!");
      await updateUI();
      if (role === "developer") {
        window.location.href = "developer.html";
      } else {
        window.location.reload();
      }
    } else {
      alert("Оплата не завершена.");
    }
  } catch {
    alert("Ошибка при подтверждении платежа");
  }
}

// === Летучая мышь 🦇 ===
const bat = document.getElementById("flying-bat");
const batMessage = document.getElementById("bat-message");

const batMessages = [
  "Добро пожаловать в тёмный мир!",
  "Я тут просто пролетаю 🦇",
  "Осторожно... я наблюдаю за тобой 👀",
  "Ты сегодня отлично выглядишь!",
  "Не забудь проверить новые разделы!",
  "Псс... там скидки в магазине!",
  "Если боишься — жми на кошку 🐈‍⬛",
];

function moveBatSmoothly() {
  if (!bat) return;
  const x = Math.random() * (window.innerWidth - 80);
  const y = Math.random() * (window.innerHeight - 80);
  bat.style.left = `${x}px`;
  bat.style.top = `${y}px`;

  let nextFlight = Math.random() < 0.3
    ? Math.random() * 5000 + 5000
    : Math.random() * 4000 + 2000;

  setTimeout(moveBatSmoothly, nextFlight);
}
setTimeout(moveBatSmoothly, 2000);

bat?.addEventListener("click", () => {
  if (!batMessage) return;
  const msg = batMessages[Math.floor(Math.random() * batMessages.length)];
  batMessage.textContent = msg;
  batMessage.style.left = bat.style.left;
  batMessage.style.top = `calc(${bat.style.top} - 40px)`;
  batMessage.style.display = "block";
  batMessage.style.opacity = 1;
  setTimeout(() => (batMessage.style.display = "none"), 2500);
});

// === Чат ===
const chatWindow = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatTabs = document.querySelectorAll(".chat-tab");
let currentChat = "global";

// Переключение вкладок
chatTabs.forEach((tab) =>
  tab.addEventListener("click", () => {
    chatTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentChat = tab.dataset.tab;
    loadChat();
  })
);

// Обновление чата
async function loadChat() {
  try {
    const res = await fetch(`/chat/${currentChat}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    const messages = await res.json();
    <span>
  ${
    msg.content.startsWith("sticker:")
      ? `<img src="stickers/${msg.content.replace('sticker:', '')}" alt="sticker" class="chat-sticker">`
      : msg.content
  }
</span>
            <button class="reply-btn" data-user="${msg.username}">Ответить</button>
            <button class="pm-btn" data-user="${msg.username}">Личка</button>
            <button class="report-btn" data-id="${msg.id}">Пожаловаться</button>
          </div>
        </div>
      `
      )
      .join("");
  } catch {
    chatWindow.innerHTML = "<p>Не удалось загрузить сообщения.</p>";
  }
}

// Отправка сообщений
chatForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
 const content = chatInput.value.trim();
if (!content) return; 
  if (!content) return;

  try {
    await fetch(`/chat/${currentChat}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify({ content }),
    });
    chatInput.value = "";
    loadChat();
  } catch {
    alert("Ошибка отправки сообщения");
  }
});

// Действия в чате
chatWindow.addEventListener("click", async (e) => {
  const target = e.target;

  // Ответить
  if (target.classList.contains("reply-btn")) {
    const username = target.dataset.user;
    chatInput.value = `@${username}, `;
    chatInput.focus();
  }

  // Личка
  if (target.classList.contains("pm-btn")) {
    const username = target.dataset.user;
    currentChat = "private";
    chatTabs.forEach((t) => t.classList.remove("active"));
    document.querySelector('[data-tab="private"]').classList.add("active");
    chatInput.placeholder = `Сообщение для ${username}...`;
    chatInput.dataset.receiver = username;
    loadChat();
  }

  // Пожаловаться
  if (target.classList.contains("report-btn")) {
    const msgId = target.dataset.id;
    try {
      await fetch(`/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ messageId: msgId }),
      });
      alert("Жалоба отправлена администратору.");
    } catch {
      alert("Ошибка отправки жалобы");
    }
  }
});

// Стикеры
async function loadStickers() {
  try {
    const res = await fetch("/stickers");
    const stickers = await res.json();
    const stickerPanel = document.getElementById("sticker-panel");
    stickerPanel.innerHTML = "";

    stickers.forEach((sticker) => {
      const img = document.createElement("img");
      img.src = sticker.url;
      img.alt = sticker.name;
      img.classList.add("sticker");
      stickerPanel.appendChild(img);

      img.addEventListener("click", async () => {
        const stickerTag = `[sticker:${sticker.url}]`;
        try {
          await fetch(`/chat/${currentChat}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({ content: stickerTag }),
          });
          loadChat();
        } catch {
          alert("Ошибка отправки стикера");
        }
      });
    });
  } catch (err) {
    console.error("Ошибка загрузки стикеров:", err);
  }
}
loadStickers();

// Автообновление чата
setInterval(loadChat, 5000);
loadChat();

// Блокировка чата для гостей
document.addEventListener("DOMContentLoaded", () => {
  if (!localStorage.getItem("token")) {
    chatInput.disabled = true;
    chatForm.querySelector("button[type=submit]").disabled = true;
    chatInput.placeholder = "Войдите, чтобы отправлять сообщения";
  }
});

// === Кошка 🐈‍⬛ ===
const catWidget = document.getElementById("cat-widget");
const contactFormContainer = document.getElementById("contact-form-container");
const contactForm = document.getElementById("contact-form");
const closeContact = document.getElementById("close-contact");

catWidget?.addEventListener("click", () => {
  if (!contactFormContainer) return;
  contactFormContainer.style.display =
    contactFormContainer.style.display === "block" ? "none" : "block";
});

closeContact?.addEventListener("click", () => {
  if (contactFormContainer) contactFormContainer.style.display = "none";
});

contactForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const email = document.getElementById("contact-email").value.trim();
  const message = document.getElementById("contact-message").value.trim();
  if (!email || !message) return alert("Заполните все поля!");

  fetch("/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, message }),
  })
    .then((res) => res.json())
    .then((data) => {
      alert(data.success ? "Сообщение отправлено!" : "Ошибка: " + data.error);
      if (data.success) contactFormContainer.style.display = "none";
    })
    .catch(() => alert("Сервер недоступен"));
});

// === Галерея картинок ===
const imagesGallery = [
  { src: "images/pic1.jpg", title: "Тёмный лес", desc: "Мистическая тьма и свет луны." },
  { src: "images/pic2.jpg", title: "Космос", desc: "Неоновая галактика 🌌" },
  { src: "images/pic3.jpg", title: "Ведьма", desc: "Силуэты магии в ночи." },
  { src: "images/pic4.jpg", title: "Замок", desc: "Древние руины на утёсе." }
];

// === Галерея картинок + Мяук ===
async function loadImagesGallery() {
  const container = document.getElementById("images-gallery");
  if (!container) return;

  container.innerHTML = imagesGallery.map(img => `
    <div class="card" data-id="${img.id || 1}">
      <img src="${img.src}" alt="${img.title}">
      <h3>${img.title}</h3>
      <p>${img.desc}</p>
      <button class="meow-btn">🐾 Мяук</button>
      <span class="like-count">0</span>
    </div>
  `).join("");

  // Подгружаем лайки и статус для каждой карточки
  for (const fileCard of container.querySelectorAll(".card")) {
    const fileId = fileCard.dataset.id;
    const likeCount = fileCard.querySelector(".like-count");
    const btn = fileCard.querySelector(".meow-btn");

    try {
      // Получаем количество лайков
      const res = await fetch(`/files/${fileId}/likes`);
      const data = await res.json();
      likeCount.textContent = data.total || 0;

      // Проверяем, лайкал ли уже пользователь
      const checkRes = await fetch(`/files/${fileId}/liked`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.liked) {
          btn.textContent = "👍🏻 Мяук";
        }
      }
    } catch {
      likeCount.textContent = "⚠";
    }

    // Обработчик кнопки
    btn.addEventListener("click", async () => {
      try {
        const res = await fetch(`/files/${fileId}/like`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        });
        const data = await res.json();

        if (data.success) {
          // Обновляем количество лайков
          const res2 = await fetch(`/files/${fileId}/likes`);
          const countData = await res2.json();
          likeCount.textContent = countData.total;

          // Меняем вид кнопки
          btn.textContent = data.liked ? "👍🏻 Мяук" : "🐾 Мяук";
        } else {
          alert("Ошибка: " + (data.error || "Не удалось поставить лайк"));
        }
      } catch {
        alert("Сервер недоступен");
      }
    });
  }
}

// === Запуск ===
document.addEventListener("DOMContentLoaded", () => {
  updateUI();
  loadImagesGallery();
});
// === Обновление статистики ===
async function updateStats() {
  try {
    const res = await fetch("/stats"); // сервер отдаёт JSON
    if (!res.ok) throw new Error("Ошибка запроса статистики");
    const data = await res.json();

    const visitEl = document.getElementById("visit-count");
    const uploadEl = document.getElementById("upload-count");

    if (visitEl) visitEl.textContent = data.visits ?? 0;
    if (uploadEl) uploadEl.textContent = data.uploads ?? 0;
  } catch (err) {
    console.error("Ошибка при обновлении статистики:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  updateStats();
  setInterval(updateStats, 60000); // обновляем каждую минуту
  // === Логика для кнопки-совушки и панели стикеров ===
const stickerToggle = document.getElementById('sticker-toggle');
const stickerPanel = document.getElementById('sticker-panel');
const chatOverlay = document.getElementById('chat-overlay');

if (stickerToggle && stickerPanel && chatOverlay) {
  stickerToggle.addEventListener('click', () => {
    stickerPanel.classList.toggle('active');
    chatOverlay.classList.toggle('active');
  });

  // Закрытие панели при клике по затемнению
  chatOverlay.addEventListener('click', () => {
    stickerPanel.classList.remove('active');
    chatOverlay.classList.remove('active');
  });
}
});
