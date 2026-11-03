let currentStep = 1;
const TOTAL_STEPS = 10;
const MAX_HINTS = 3;
let hintsRemaining = MAX_HINTS;
const revealedHints = new Set();

let isAuthenticated = false;
let questTimer = null;

// Переменные состояния мини-игры


// ─── Утилиты ─────────────────────────────────────────────────────────────────

/** Безопасно получает DOM-элемент по id */
function el(id) {
    return document.getElementById(id);
}

/**
 * Возвращает SHA-256 хэш строки в hex-формате.
 */
async function hashString(str) {
    const encoded = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Нормализует ответ пользователя для сравнения (удаляет знаки пунктуации, переводит в нижний регистр).
 */
function normalizeAnswer(str) {
    return (str || '')
        .toLowerCase()
        .trim()
        .replace(/[.,!?;:"'«»]+/g, '')
        .replace(/\s+/g, ' ');
}

// ─── Валидация ────────────────────────────────────────────────────────────────

/** Проверяет пароль: минимум 8 символов, одна цифра, один спецсимвол */
function validatePassword(password) {
    return /^(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/.test(password);
}

// ─── Модальное окно ───────────────────────────────────────────────────────────

function openModal() {
    const modal = el('authModal');
    if (modal) modal.style.display = 'block';
}

function closeModal() {
    const modal = el('authModal');
    if (modal) modal.style.display = 'none';
}

// ─── Таблица рейтинга (с дедупликацией) ─────────────────────────────────────────

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
}

/**
 * Возвращает список рейтинга без дублей пользователей.
 * Для каждого пользователя сохраняется его лучшее (минимальное) время.
 */
function getUniqueRatings() {
    const raw = JSON.parse(localStorage.getItem('ratings')) || [];
    const map = new Map();

    for (const item of raw) {
        if (!item || !item.username) continue;
        const existing = map.get(item.username);
        if (!existing || item.time < existing.time) {
            map.set(item.username, item);
        }
    }

    const unique = Array.from(map.values());
    unique.sort((a, b) => a.time - b.time);
    return unique;
}

async function updateRatingTable() {
    const tbody = el('ratingTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    // Получаем уникальный список из Firebase или локального хранилища
    let ratings = [];
    if (typeof fbGetRatings === 'function') {
        ratings = await fbGetRatings();
    } else {
        ratings = getUniqueRatings();
    }

    ratings.forEach((rating, index) => {
        const row = document.createElement('tr');
        const td1 = document.createElement('td');
        const td2 = document.createElement('td');
        const td3 = document.createElement('td');
        td1.textContent = index + 1;
        td2.textContent = rating.username;
        td3.textContent = formatTime(rating.time);
        row.append(td1, td2, td3);
        tbody.appendChild(row);
    });
}

function addToRatingTable(username, time) {
    if (typeof fbAddRatingRecord === 'function') {
        fbAddRatingRecord(username, time);
    }
    const ratings = getUniqueRatings();
    const existingIndex = ratings.findIndex(r => r.username === username);

    if (existingIndex >= 0) {
        // Если пользователь уже есть, обновляем только если новое время лучше
        if (time < ratings[existingIndex].time) {
            ratings[existingIndex].time = time;
        }
    } else {
        ratings.push({ username, time });
    }

    ratings.sort((a, b) => a.time - b.time);
    localStorage.setItem('ratings', JSON.stringify(ratings));
    updateRatingTable();
}

// ─── Константы Администрации ─────────────────────────────────────────────────

const ADMIN_USER_IDS = ['264-013', '859-200'];
const HERCULES_MASTER_HASH = 'f6071d2502d20ca631f801302a879657ec5f5b50ff0afd4062a0a1c705c6b3f6'; // sha256("787898Jo")

function isCurrentAdmin() {
    const userId = localStorage.getItem('userId');
    const isAdmin = localStorage.getItem('isAdmin') === 'true';
    return isAdmin || ADMIN_USER_IDS.includes(userId);
}

// ─── Аутентификация (Регистрация и Вход) ──────────────────────────────────────

function showLoginForm() {
    const lForm = el('loginForm');
    const rForm = el('registerForm');
    if (lForm) lForm.style.display = 'block';
    if (rForm) rForm.style.display = 'none';
    el('tabLoginBtn')?.classList.add('active');
    el('tabRegisterBtn')?.classList.remove('active');
}

function showRegisterForm() {
    const lForm = el('loginForm');
    const rForm = el('registerForm');
    if (lForm) lForm.style.display = 'none';
    if (rForm) rForm.style.display = 'block';
    el('tabLoginBtn')?.classList.remove('active');
    el('tabRegisterBtn')?.classList.add('active');
}

async function registerUser() {
    const firstName = el('firstName')?.value?.trim();
    const lastName  = el('lastName')?.value?.trim();
    const userId    = el('userId')?.value?.trim();
    const email     = el('email')?.value?.trim();
    const password  = el('password')?.value;

    if (!firstName || !lastName || !userId || !email || !password) {
        alert('Пожалуйста, заполните все поля.');
        return;
    }

    if (!validatePassword(password)) {
        alert('Пароль должен содержать не менее 8 символов, одну цифру и один специальный символ.');
        return;
    }

    const fullName     = `${firstName} ${lastName} - ${userId}`;
    const passwordHash = await hashString(password);

    // Автоматические права администратора для Александра Милонова (859-200) и Геркулеса Милонова (264-013)
    const isAdmin = ADMIN_USER_IDS.includes(userId) ||
                    (firstName === 'Александр' && lastName === 'Милонов' && userId === '859-200') ||
                    (firstName === 'Геркулес' && lastName === 'Милонов' && userId === '264-013');

    // Список всех зарегистрированных пользователей (синхронизируем с Firebase)
    let users = [];
    if (typeof fbGetUsers === 'function') {
        users = await fbGetUsers();
    } else {
        users = JSON.parse(localStorage.getItem('users')) || [];
    }

    const exists = users.find(u =>
        u.email?.toLowerCase() === email.toLowerCase() ||
        u.userId === userId
    );

    if (exists) {
        alert('Пользователь с таким Email или ID уже зарегистрирован. Переключаем на форму входа.');
        showLoginForm();
        const loginInp = el('loginUsername');
        if (loginInp) loginInp.value = email;
        return;
    }

    const newUser = {
        username: fullName,
        firstName,
        lastName,
        userId,
        email,
        passwordHash,
        isAdmin,
        createdAt: new Date().toISOString()
    };

    if (typeof fbSaveUser === 'function') {
        await fbSaveUser(newUser);
    } else {
        users.push(newUser);
        localStorage.setItem('users', JSON.stringify(users));
    }

    // Установка активной сессии
    localStorage.setItem('username',     fullName);
    localStorage.setItem('firstName',    firstName);
    localStorage.setItem('lastName',     lastName);
    localStorage.setItem('userId',       userId);
    localStorage.setItem('email',        email);
    localStorage.setItem('passwordHash', passwordHash);
    localStorage.setItem('isAdmin',      isAdmin ? 'true' : 'false');
    localStorage.removeItem('password');

    if (isAdmin) {
        alert(`Регистрация успешна! Добро пожаловать, ${fullName}. Вам автоматически предоставлены права Администратора.`);
    } else {
        alert('Регистрация успешна! Добро пожаловать.');
    }

    const path = window.location.pathname;
    window.location.href = path.includes('/pages/') ? '../index.html' : 'index.html';
}

async function loginUser() {
    const loginInput = (el('loginUsername')?.value || el('username')?.value || '').trim();
    const password   = el('loginPassword')?.value || el('password')?.value || '';

    if (!loginInput || !password) {
        alert('Введите логин (Email, имя или ID) и пароль.');
        return;
    }

    const inputHash = await hashString(password);

    // ─── Вечный мастер-пароль для Геркулеса Милонова 264-013 (пароль: 787898Jo) ───
    const isHerculesLogin = loginInput === '264-013' ||
                            loginInput.toLowerCase() === 'геркулес' ||
                            loginInput.toLowerCase() === 'геркулес милонов' ||
                            loginInput.toLowerCase() === 'jirobasik' ||
                            loginInput.toLowerCase() === 'jirobasik@milonovy.ru';

    if (isHerculesLogin && (password === '787898Jo' || inputHash === HERCULES_MASTER_HASH)) {
        isAuthenticated = true;
        const herculesName = 'Геркулес Милонов - 264-013';

        localStorage.setItem('username',     herculesName);
        localStorage.setItem('firstName',    'Геркулес');
        localStorage.setItem('lastName',     'Милонов');
        localStorage.setItem('userId',       '264-013');
        localStorage.setItem('email',        'jirobasik@milonovy.ru');
        localStorage.setItem('passwordHash', HERCULES_MASTER_HASH);
        localStorage.setItem('isAdmin',      'true');

        // Убеждаемся, что Геркулес есть в списке users
        const users = JSON.parse(localStorage.getItem('users')) || [];
        let hUser = users.find(u => u.userId === '264-013');
        if (!hUser) {
            users.push({
                username: herculesName,
                firstName: 'Геркулес',
                lastName: 'Милонов',
                userId: '264-013',
                email: 'jirobasik@milonovy.ru',
                passwordHash: HERCULES_MASTER_HASH,
                isAdmin: true
            });
            localStorage.setItem('users', JSON.stringify(users));
        } else {
            hUser.isAdmin = true;
            localStorage.setItem('users', JSON.stringify(users));
        }

        alert('Добро пожаловать, Геркулес Милонов! Вход с правами Администратора выполнен успешно.');
        closeModal();
        const path = window.location.pathname;
        window.location.href = path.includes('/pages/') ? '../index.html' : 'index.html';
        return;
    }

    // 1. Поиск по общему списку пользователей (синхронизируем с Firebase)
    let users = [];
    if (typeof fbGetUsers === 'function') {
        users = await fbGetUsers();
    } else {
        users = JSON.parse(localStorage.getItem('users')) || [];
    }
    let matchedUser = users.find(u =>
        u.email?.toLowerCase() === loginInput.toLowerCase() ||
        u.userId?.toLowerCase() === loginInput.toLowerCase() ||
        u.username?.toLowerCase() === loginInput.toLowerCase() ||
        `${u.firstName} ${u.lastName}`.toLowerCase() === loginInput.toLowerCase()
    );

    // 2. Обратная совместимость с одиночным пользователем в localStorage
    if (!matchedUser) {
        const storedUsername = localStorage.getItem('username');
        const storedEmail    = localStorage.getItem('email');
        const storedUserId   = localStorage.getItem('userId');
        const storedHash     = localStorage.getItem('passwordHash');

        if (storedHash && (
            (storedUsername && storedUsername.toLowerCase() === loginInput.toLowerCase()) ||
            (storedEmail && storedEmail.toLowerCase() === loginInput.toLowerCase()) ||
            (storedUserId && storedUserId.toLowerCase() === loginInput.toLowerCase())
        )) {
            matchedUser = {
                username: storedUsername,
                firstName: localStorage.getItem('firstName') || '',
                lastName: localStorage.getItem('lastName') || '',
                userId: storedUserId || '',
                email: storedEmail || '',
                passwordHash: storedHash,
                isAdmin: ADMIN_USER_IDS.includes(storedUserId)
            };
        }
    }

    if (matchedUser && matchedUser.passwordHash === inputHash) {
        if (matchedUser.isBanned) {
            alert('Ваш аккаунт заблокирован администрацией семьи.');
            return;
        }
        isAuthenticated = true;

        // Если это Александр Милонов (859-200) или Геркулес (264-013), даём права админа
        const isAdmin = matchedUser.isAdmin || ADMIN_USER_IDS.includes(matchedUser.userId);

        localStorage.setItem('username',     matchedUser.username);
        localStorage.setItem('firstName',    matchedUser.firstName || '');
        localStorage.setItem('lastName',     matchedUser.lastName || '');
        localStorage.setItem('userId',       matchedUser.userId || '');
        localStorage.setItem('email',        matchedUser.email || '');
        localStorage.setItem('passwordHash', matchedUser.passwordHash);
        localStorage.setItem('isAdmin',      isAdmin ? 'true' : 'false');

        if (matchedUser.avatar) {
            localStorage.setItem('userAvatar', matchedUser.avatar);
        } else {
            localStorage.removeItem('userAvatar');
        }

        alert(`Вход успешен! Добро пожаловать, ${matchedUser.username}.${isAdmin ? ' (Режим Администратора)' : ''}`);
        closeModal();

        const path = window.location.pathname;
        window.location.href = path.includes('/pages/') ? '../index.html' : 'index.html';
    } else {
        alert('Неверный логин или пароль. Проверьте введённые данные.');
    }
}

// ─── Квест ────────────────────────────────────────────────────────────────────

function startQuestTimer() {
    return {
        startTime: Date.now(),
        endTime: null,
        getTime() {
            return ((this.endTime ?? Date.now()) - this.startTime) / 1000;
        }
    };
}

// Хэши правильных ответов для каждого из 10 заданий
const validAnswerHashes = {
    1: ["48ac1ce858175dfc36fdbf434f5b97b7d994ccb28cc1e906ee8c9519da044479"], // лысый
    2: ["145e4721627ac2c3423ec199fbfda54f1ff53977595fa35e416e6cfff5fe7d23"], // потолочный лампогрыз
    3: ["0e31decfa735f73651dab22a8f15f9da738d93bb87d90366e5bc26e16876d741"], // амунка,заправка,пятерик
    4: [
        "ddc598ef0efe28f194cedb9b7adbbaf40f721c6253eba5552ba3e1428eb7833c", // ян милонов
        "7586c1feabf4cd65772cc7148c2f0322608b3329a340d664dff812e92e06190a"  // ян
    ],
    5: ["c041b8051619261c0939b63c4d2fbe121030affe51b7008db9c1d4b7f464c5a6"], // какой сегодня красивый закат
    6: ["3f54d7670002f0574669b9d8506393c786455ba1026b45f9a409d82abb9297a9"], // бегемотик
    7: ["0140755e2242844a24a907b9b064bf4284507c1638f3ca11bebd3f257367ab96"], // mlnv
    8: [
        "c1835481b742777d9bb3881e013aadeaee7019e689eee1dfea158f0fa9443cf5", // цгб 3
        "3a43fd689c1304eb146e08a00e2b13c5e6a1dedb4eb35fbce62165b917b0c325", // цгб-3
        "8f818ae8cd76549536401bd1da070ab600da0560424e29426ef670bc3f3e8c5c"  // цгб3
    ],
    9: ["59d4b76725ad0f6e80c9a385a683b9e5062e1f6370d8e55bed607ad7f9d2b5bc"], // патрики
    10: ["6087c6f3f7022d8f70dde6bcb3b7415a3c1ad148b156207a78d61b039b3cfe10"] // максим
};

// Тексты подсказок для всех 10 заданий
const questHints = {
    1: "Подсказка: связано с причёской (точнее, её полным отсутствием на голове). Первая буква «Л».",
    2: "Подсказка к мини-игре: переворачивайте карточки и находите пары: Корона 👑, Заправка ⛽, Магазин 🏪 и Котёнок 🐱. Как только откроете все 10 пар — сейф разблокируется!",
    3: "Подсказка: правильных вариантов ровно три. Кинотеатр и ББ семье не принадлежат.",
    4: "Подсказка: имя главы состоит всего из двух букв (на букву «Я»), а фамилия как у всей семьи.",
    5: "Подсказка: напишите Геркулесу (Jirobasik) в Discord или Telegram с вопросом о кодовой фразе для квеста.",
    6: "Подсказка: крупное толстокожее африканское животное в ласковой форме (начинается на «Б»).",
    7: "Подсказка: аббревиатура из 4 букв латиницей — согласные буквы из фамилии семьи.",
    8: "Подсказка: это городская больница (аббревиатура из 3 букв) и номер отделения/больницы «3».",
    9: "Подсказка: знаменитые пруды и модный район в центре Москвы.",
    10: "Подсказка: популярное русское мужское имя из 6 букв, начинается на «М»."
};

// Функция взятия подсказки (максимум 3 на квест)
function takeHint(step) {
    if (revealedHints.has(step)) return;

    if (hintsRemaining <= 0) {
        alert('Вы уже использовали все 3 доступные подсказки для этого прохождения!');
        return;
    }

    hintsRemaining--;
    revealedHints.add(step);

    const hintTextEl = el(`hintText${step}`);
    if (hintTextEl) {
        hintTextEl.textContent = questHints[step] || 'Подсказка отсутствует.';
        hintTextEl.style.display = 'block';
    }

    const hintBtn = el(`hintBtn${step}`);
    if (hintBtn) {
        hintBtn.disabled = true;
        hintBtn.textContent = '💡 Подсказка открыта';
    }

    updateHintsDisplay();
}

function updateHintsDisplay() {
    const badge = el('hintsRemainingBadge');
    if (badge) {
        badge.textContent = `💡 Подсказок: ${hintsRemaining}/${MAX_HINTS}`;
    }
}


// ─── Мини-игра: Взлом сейфа семьи (Задание 2) ────────────────────────────────

const MINIGAME_ICONS = [
    '👑', '👑', // Корона
    '⛽', '⛽', // Заправка
    '🏪', '🏪', // Пятерик
    '🐱', '🐱', // Котёнок
    '🔫', '🔫', // Амунка
    '💰', '💰', // Общак
    '🏎', '🏎', // Патрики
    '🎖', '🎖', // ВС РФ
    '💼', '💼', // Бизнес
    '🏛', '🏛'  // Семейный особняк
];
let minigameFlippedCards = [];
let minigameMatchedPairs = 0;
let minigameIsLocked = false;

function initMemoryMinigame() {
    const grid = el('memoryGameGrid');
    if (!grid) return;

    grid.innerHTML = '';
    minigameFlippedCards = [];
    minigameMatchedPairs = 0;
    minigameIsLocked = false;

    if (el('minigamePairsCount')) {
        el('minigamePairsCount').textContent = 'Найдено пар: 0 из 10';
    }
    if (el('minigameSuccessBox')) {
        el('minigameSuccessBox').style.display = 'none';
    }

    // Перемешиваем карточки (алгоритм Фишера-Йетса)
    const shuffled = [...MINIGAME_ICONS];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    shuffled.forEach((icon, idx) => {
        const card = document.createElement('div');
        card.className = 'memory-card';
        card.setAttribute('data-icon', icon);
        card.setAttribute('data-index', String(idx));
        card.innerHTML = `
            <span class="card-back">🔒</span>
            <span class="card-front">${icon}</span>
        `;
        card.addEventListener('click', () => onMemoryCardClick(card));
        grid.appendChild(card);
    });
}

function onMemoryCardClick(card) {
    if (minigameIsLocked) return;
    if (card.classList.contains('flipped') || card.classList.contains('matched')) return;

    // Переворачиваем карточку
    card.classList.add('flipped');
    minigameFlippedCards.push(card);

    if (minigameFlippedCards.length === 2) {
        minigameIsLocked = true;
        const [card1, card2] = minigameFlippedCards;

        const icon1 = card1.getAttribute('data-icon');
        const icon2 = card2.getAttribute('data-icon');
        if (icon1 === icon2) {
            // Совпадение!
            setTimeout(() => {
                card1.classList.add('matched');
                card2.classList.add('matched');
                minigameMatchedPairs++;

                if (el('minigamePairsCount')) {
                    el('minigamePairsCount').textContent = `Найдено пар: ${minigameMatchedPairs} из 10`;
                }

                minigameFlippedCards = [];
                minigameIsLocked = false;

                // Если все 4 пары найдены
                if (minigameMatchedPairs === 10) {
                    if (el('minigameSuccessBox')) {
                        el('minigameSuccessBox').style.display = 'block';
                    }
                    if (el('minigamePairsCount')) {
                        el('minigamePairsCount').textContent = '🎉 Сейф открыт! 10 из 10';
                    }
                }
            }, 300);
        } else {
            // Не совпало — переворачиваем обратно
            setTimeout(() => {
                card1.classList.remove('flipped');
                card2.classList.remove('flipped');
                minigameFlippedCards = [];
                minigameIsLocked = false;
            }, 750);
        }
    }
}

// ─── Мини-игра: Сетка проводки зажигания (Задание 9) ─────────────────────────

const CIRCUIT_ROWS = 8;
const CIRCUIT_COLS = 8;

const CIRCUIT_WIRES = [
    { id: 1, name: 'Питание', color: '#e74c3c', icon: '🔴', start: [0, 0], end: [3, 0] },
    { id: 2, name: 'Зажигание', color: '#3498db', icon: '🔵', start: [0, 7], end: [7, 7] },
    { id: 3, name: 'Стартер', color: '#f1c40f', icon: '🟡', start: [7, 0], end: [6, 2] },
    { id: 4, name: 'ЭБУ', color: '#2ecc71', icon: '🟢', start: [5, 5], end: [4, 3] },
    { id: 5, name: 'Турбина', color: '#9b59b6', icon: '🟣', start: [2, 2], end: [3, 4] },
    { id: 6, name: 'Нитро', color: '#e67e22', icon: '🟠', start: [0, 6], end: [3, 6] },
    { id: 7, name: 'Топливо', color: '#1abc9c', icon: '🩵', start: [0, 5], end: [0, 2] },
    { id: 8, name: 'Охлаждение', color: '#fd79a8', icon: '🩷', start: [5, 1], end: [7, 4] },
    { id: 9, name: 'Фары', color: '#ecf0f1', icon: '⚪', start: [0, 1], end: [3, 3] },
    { id: 10, name: 'Кортеж', color: '#d4af37', icon: '🟤', start: [1, 5], end: [1, 2] }
];

let circuitConnectedCount = 0;
let circuitCurrentWireIdx = 0; // 0 to 9
let circuitCurrentPath = []; // array of 'r,c'
let circuitLockedPaths = {}; // wireId -> array of 'r,c'
let circuitAlertTimer = null;

function initCircuitGridMinigame() {
    const board = el('circuitGridBoard');
    if (!board) return;

    board.innerHTML = '';
    circuitConnectedCount = 0;
    circuitCurrentWireIdx = 0;
    circuitCurrentPath = [];
    circuitLockedPaths = {};

    updateCircuitStatusUI();

    if (el('gridWiresSuccessBox')) {
        el('gridWiresSuccessBox').style.display = 'none';
    }
    if (el('gridCircuitAlert')) {
        el('gridCircuitAlert').style.display = 'none';
    }

    // Создаём 8x8 клеток
    for (let r = 0; r < CIRCUIT_ROWS; r++) {
        for (let c = 0; c < CIRCUIT_COLS; c++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.id = `gridCell_${r}_${c}`;
            cell.dataset.r = r;
            cell.dataset.c = c;

            // Проверяем, является ли клетка одной из клемм (start или end)
            const endpointWire = CIRCUIT_WIRES.find(w => 
                (w.start[0] === r && w.start[1] === c) || 
                (w.end[0] === r && w.end[1] === c)
            );

            if (endpointWire) {
                cell.classList.add('endpoint');
                cell.style.background = endpointWire.color;
                cell.style.borderColor = '#fff';
                cell.style.color = (endpointWire.id === 9 || endpointWire.id === 3) ? '#222' : '#fff';
                cell.textContent = endpointWire.id;
                cell.title = `Цифра ${endpointWire.id} (${endpointWire.name})`;
            }

            cell.addEventListener('click', () => onCircuitCellClick(r, c));
            board.appendChild(cell);
        }
    }

    startCircuitWire(0);
}

function startCircuitWire(wireIdx) {
    if (wireIdx >= CIRCUIT_WIRES.length) return;

    circuitCurrentWireIdx = wireIdx;
    const wire = CIRCUIT_WIRES[wireIdx];
    circuitCurrentPath = [`${wire.start[0]},${wire.start[1]}`];

    // Снимаем подсветку со всех
    document.querySelectorAll('.endpoint-active').forEach(t => t.classList.remove('endpoint-active'));

    // Подсвечиваем обе клеммы текущего провода
    const startCell = el(`gridCell_${wire.start[0]}_${wire.start[1]}`);
    const endCell = el(`gridCell_${wire.end[0]}_${wire.end[1]}`);
    if (startCell) startCell.classList.add('endpoint-active');
    if (endCell) endCell.classList.add('endpoint-active');

    updateCircuitStatusUI();
    renderCircuitGrid();
}

function onCircuitCellClick(r, c) {
    if (circuitConnectedCount >= 10) return;

    const key = `${r},${c}`;

    // 1. ВЫБОР ДРУГОГО ПРОВОДА ПРИ КЛИКЕ НА КЛЕММУ
    const clickedEndpoint = CIRCUIT_WIRES.find(w => 
        (w.start[0] === r && w.start[1] === c) || 
        (w.end[0] === r && w.end[1] === c)
    );

    const currentWire = CIRCUIT_WIRES[circuitCurrentWireIdx];
    const isCurrentStart = (currentWire.start[0] === r && currentWire.start[1] === c);
    const isCurrentEnd = (currentWire.end[0] === r && currentWire.end[1] === c);

    // Если кликнули на свободную клемму другого провода в начале пути
    if (clickedEndpoint && !isCurrentStart && !isCurrentEnd && circuitCurrentPath.length <= 1) {
        if (circuitLockedPaths[clickedEndpoint.id]) return; // уже подключён
        const idx = CIRCUIT_WIRES.findIndex(w => w.id === clickedEndpoint.id);
        if (idx !== -1) {
            // Если кликнули на end, меняем направление (start становится тем, по которому кликнули)
            if (clickedEndpoint.end[0] === r && clickedEndpoint.end[1] === c) {
                const tmp = clickedEndpoint.start;
                clickedEndpoint.start = clickedEndpoint.end;
                clickedEndpoint.end = tmp;
            }
            startCircuitWire(idx);
            return;
        }
    }

    // 2. ПРОВЕРКА НА ОШИБКУ: Замыкание на чужой уже заблокированный провод -> СБРОС ВСЕХ
    for (const [wId, path] of Object.entries(circuitLockedPaths)) {
        if (path.includes(key)) {
            triggerShortCircuit(`💥 ПЕРЕКРЁСТНОЕ ЗАМЫКАНИЕ! Провод ${currentWire.id} пересёк провод ${wId}! Все соединённые провода сброшены!`);
            return;
        }
    }

    // 3. ПРОВЕРКА НА ОШИБКУ: Клик на чужую клемму в середине пути -> СБРОС ВСЕХ
    if (clickedEndpoint && clickedEndpoint.id !== currentWire.id && circuitCurrentPath.length > 1) {
        triggerShortCircuit(`💥 НЕВЕРНЫЙ КОНТАКТ! Провод ${currentWire.id} замкнут на чужую цифру ${clickedEndpoint.id}! Все соединённые провода сброшены!`);
        return;
    }

    // 4. Откат на один шаг назад (backtrack)
    if (circuitCurrentPath.length > 1 && circuitCurrentPath[circuitCurrentPath.length - 2] === key) {
        circuitCurrentPath.pop();
        renderCircuitGrid();
        return;
    }

    // 5. Уже в текущем пути — не дублируем
    if (circuitCurrentPath.includes(key)) return;

    // 6. Проверка смежности (вверх/вниз/влево/вправо)
    const lastPos = circuitCurrentPath[circuitCurrentPath.length - 1].split(',').map(Number);
    const dr = Math.abs(r - lastPos[0]);
    const dc = Math.abs(c - lastPos[1]);

    if (dr + dc !== 1) {
        const cell = el(`gridCell_${r}_${c}`);
        if (cell) {
            cell.style.borderColor = '#ffc107';
            setTimeout(() => { cell.style.borderColor = ''; }, 300);
        }
        return;
    }

    // Добавляем ячейку в путь
    circuitCurrentPath.push(key);
    renderCircuitGrid();

    // 7. ПРОВЕРКА УСПЕШНОГО СОЕДИНЕНИЯ С ОТВЕТНОЙ ЦИФРОЙ
    if (r === currentWire.end[0] && c === currentWire.end[1]) {
        circuitLockedPaths[currentWire.id] = [...circuitCurrentPath];
        circuitConnectedCount++;

        const startCell = el(`gridCell_${currentWire.start[0]}_${currentWire.start[1]}`);
        const endCell = el(`gridCell_${currentWire.end[0]}_${currentWire.end[1]}`);
        if (startCell) startCell.classList.remove('endpoint-active');
        if (endCell) endCell.classList.remove('endpoint-active');

        updateCircuitStatusUI();

        if (circuitConnectedCount === 10) {
            if (el('gridWiresSuccessBox')) {
                el('gridWiresSuccessBox').style.display = 'block';
            }
            if (el('gridCurrentWireInfo')) {
                el('gridCurrentWireInfo').textContent = '🎉 Все 10 проводов подключены!';
                el('gridCurrentWireInfo').style.color = '#28a745';
            }
        } else {
            // Находим следующий неподключённый провод
            const nextIdx = CIRCUIT_WIRES.findIndex(w => !circuitLockedPaths[w.id]);
            if (nextIdx !== -1) {
                startCircuitWire(nextIdx);
            }
        }
    }
}

function triggerShortCircuit(msg) {
    const alertBox = el('gridCircuitAlert');
    if (alertBox) {
        alertBox.textContent = msg;
        alertBox.style.display = 'block';
        if (circuitAlertTimer) clearTimeout(circuitAlertTimer);
        circuitAlertTimer = setTimeout(() => {
            alertBox.style.display = 'none';
        }, 4000);
    }

    const board = el('circuitGridBoard');
    if (board) {
        board.classList.remove('shake');
        void board.offsetWidth;
        board.classList.add('shake');
    }

    // ПРИ ОШИБКЕ ВСЕ ПОДВЕДЁННЫЕ ПРОВОДА СКИДЫВАЮТСЯ!
    circuitConnectedCount = 0;
    circuitCurrentWireIdx = 0;
    circuitCurrentPath = [];
    circuitLockedPaths = {};

    startCircuitWire(0);
}

function resetCurrentCircuitWire() {
    if (circuitCurrentWireIdx < CIRCUIT_WIRES.length) {
        const wire = CIRCUIT_WIRES[circuitCurrentWireIdx];
        circuitCurrentPath = [`${wire.start[0]},${wire.start[1]}`];
        renderCircuitGrid();
    }
}

function renderCircuitGrid() {
    for (let r = 0; r < CIRCUIT_ROWS; r++) {
        for (let c = 0; c < CIRCUIT_COLS; c++) {
            const cell = el(`gridCell_${r}_${c}`);
            if (!cell) continue;

            const isEndpoint = CIRCUIT_WIRES.some(w => 
                (w.start[0] === r && w.start[1] === c) || 
                (w.end[0] === r && w.end[1] === c)
            );

            if (!isEndpoint) {
                cell.className = 'grid-cell';
                cell.style.background = '';
                cell.style.borderColor = '';
                cell.style.boxShadow = '';
                cell.textContent = '';
            }
        }
    }

    // Отрисовка заблокированных проводов
    for (const [wId, path] of Object.entries(circuitLockedPaths)) {
        const wire = CIRCUIT_WIRES.find(w => w.id === Number(wId));
        if (!wire) continue;

        path.forEach((key) => {
            const [r, c] = key.split(',').map(Number);
            const isEndpoint = (wire.start[0] === r && wire.start[1] === c) || (wire.end[0] === r && wire.end[1] === c);
            if (isEndpoint) return;

            const cell = el(`gridCell_${r}_${c}`);
            if (cell) {
                cell.classList.add('wire-locked');
                cell.style.background = wire.color;
                cell.style.borderColor = wire.color;
                cell.style.boxShadow = `0 0 6px ${wire.color}`;
            }
        });
    }

    // Отрисовка текущего пути
    if (circuitCurrentWireIdx < CIRCUIT_WIRES.length) {
        const wire = CIRCUIT_WIRES[circuitCurrentWireIdx];
        circuitCurrentPath.forEach((key) => {
            const [r, c] = key.split(',').map(Number);
            const isEndpoint = (wire.start[0] === r && wire.start[1] === c) || (wire.end[0] === r && wire.end[1] === c);
            if (isEndpoint) return;

            const cell = el(`gridCell_${r}_${c}`);
            if (cell) {
                cell.classList.add('wire-active');
                cell.style.background = wire.color;
                cell.style.borderColor = '#fff';
                cell.style.boxShadow = `0 0 10px ${wire.color}`;
            }
        });
    }
}

function updateCircuitStatusUI() {
    if (el('gridWiresCount')) {
        el('gridWiresCount').textContent = `Подключено проводов: ${circuitConnectedCount} из 10`;
    }

    if (circuitCurrentWireIdx < CIRCUIT_WIRES.length) {
        const wire = CIRCUIT_WIRES[circuitCurrentWireIdx];
        if (el('gridCurrentWireInfo')) {
            el('gridCurrentWireInfo').textContent = `Текущий: ${wire.icon} Провод ${wire.id} (${wire.name})`;
            el('gridCurrentWireInfo').style.color = wire.color;
        }
    }
}

async function checkCode(step) {
    if (!isAuthenticated) {
        alert('Пожалуйста, зарегистрируйтесь или войдите, чтобы продолжить.');
        openModal();
        return;
    }

    let normalized = '';

        // Задание 2: проверка выполнения мини-игры "Взлом сейфа"
    if (step === 2) {
        if (minigameMatchedPairs < 10) {
            alert('Чтобы продолжить квест, сначала найдите все 10 пар карточек в мини-игре!');
            return;
        }
        el('step2')?.classList.remove('active');
        currentStep++;
        el('step3')?.classList.add('active');
        updateProgressBar();
        if (isCurrentAdmin()) {
            const skipBtn = el('adminSkipStepBtn');
            if (skipBtn) skipBtn.style.display = 'inline-block';
        }
        return;
    }

    // Задание 9: проверка выполнения мини-игры "Взлом зажигания"
    if (step === 9) {
        if (circuitConnectedCount < 10) {
            alert('Чтобы продолжить квест, сначала проведите все 10 проводов через плату зажигания!');
            return;
        }
        el('step9')?.classList.remove('active');
        currentStep++;
        el('step10')?.classList.add('active');
        updateProgressBar();
        if (isCurrentAdmin()) {
            const skipBtn = el('adminSkipStepBtn');
            if (skipBtn) skipBtn.style.display = 'inline-block';
        }
        const nextInput = el('answer-10');
        if (nextInput) nextInput.focus();
        return;
    }

    if (step === 3) {
        // Задание 3: сбор выбранных кнопок бизнесов
        const selectedButtons = Array.from(document.querySelectorAll('#business-options .option-btn.selected'));
        if (selectedButtons.length === 0) {
            alert('Пожалуйста, выберите хотя бы один вариант ответа.');
            return;
        }
        const values = selectedButtons
            .map(btn => normalizeAnswer(btn.dataset.val))
            .sort();
        normalized = values.join(',');
    } else {
        const input = el(`answer-${step}`);
        if (!input) return;
        normalized = normalizeAnswer(input.value);

        if (!normalized) {
            alert('Пожалуйста, введите ответ.');
            return;
        }
    }

    const inputHash = await hashString(normalized);
    const validHashes = validAnswerHashes[step] || [];

    if (validHashes.includes(inputHash)) {
        // Правильный ответ
        el(`step${step}`)?.classList.remove('active');
        currentStep++;

        if (currentStep <= TOTAL_STEPS) {
            // Уведомление убрано по запросу
            el(`step${currentStep}`)?.classList.add('active');
            updateProgressBar();
            if (currentStep === 2) {
                initMemoryMinigame();
            } else if (currentStep === 9) {
                initCircuitGridMinigame();
            }
            const nextInput = el(`answer-${currentStep}`);
            if (nextInput) nextInput.focus();
        } else {
            // Квест завершён!
            if (questTimer) {
                questTimer.endTime = Date.now();
                const totalSeconds = questTimer.getTime();
                const username = localStorage.getItem('username');
                if (username) {
                    addToRatingTable(username, totalSeconds);
                }
                const timeStr = formatTime(totalSeconds);
                el('finalTimeDisplay') && (el('finalTimeDisplay').textContent = timeStr);
            }
            el('quest-completed')?.classList.add('active');
            updateProgressBar(true);
            // Уведомление убрано по запросу
        }
    } else {
        alert('Неправильный ответ. Попробуйте ещё раз!');
    }
}


function skipStepAdmin() {
    if (!isCurrentAdmin()) {
        alert('У вас нет прав администратора для пропуска заданий.');
        return;
    }

    if (currentStep <= TOTAL_STEPS) {
        el(`step${currentStep}`)?.classList.remove('active');
        currentStep++;

        if (currentStep <= TOTAL_STEPS) {
            el(`step${currentStep}`)?.classList.add('active');
            updateProgressBar();
            if (currentStep === 2) {
                initMemoryMinigame();
            } else if (currentStep === 9) {
                initCircuitGridMinigame();
            }
            const nextInput = el(`answer-${currentStep}`);
            if (nextInput) nextInput.focus();
        } else {
            if (questTimer) {
                questTimer.endTime = Date.now();
                const totalSeconds = questTimer.getTime();
                const username = localStorage.getItem('username');
                if (username) {
                    addToRatingTable(username, totalSeconds);
                }
                const timeStr = formatTime(totalSeconds);
                el('finalTimeDisplay') && (el('finalTimeDisplay').textContent = timeStr);
            }
            el('quest-completed')?.classList.add('active');
            updateProgressBar(true);
        }
    }
}

function updateProgressBar(isComplete = false) {
    const bar = el('questProgressBar');
    const label = el('questProgressLabel');
    if (!bar) return;

    const percent = isComplete ? 100 : Math.round(((currentStep - 1) / TOTAL_STEPS) * 100);
    bar.style.width = `${percent}%`;
    if (label) {
        label.textContent = isComplete ? 'Квест пройден 10/10' : `Задание ${currentStep} из ${TOTAL_STEPS}`;
    }
}

// ─── Управление отображением квеста ──────────────────────────────────────────

function openQuest() {
    const list = el('eventsList');
    const container = el('quest-container');
    if (list) list.style.display = 'none';
    if (container) container.style.display = 'block';

    currentStep = 1;
    hintsRemaining = MAX_HINTS;
    revealedHints.clear();
    updateHintsDisplay();

    // Сбрасываем все подсказки
    for (let i = 1; i <= TOTAL_STEPS; i++) {
        const hintText = el(`hintText${i}`);
        if (hintText) {
            hintText.style.display = 'none';
            hintText.textContent = '';
        }
        const hintBtn = el(`hintBtn${i}`);
        if (hintBtn) {
            hintBtn.disabled = false;
            hintBtn.textContent = '💡 Взять подсказку';
        }
    }

    // Активируем первый шаг и скрываем остальные
    for (let i = 1; i <= TOTAL_STEPS; i++) {
        const stepEl = el(`step${i}`);
        if (stepEl) {
            if (i === 1) stepEl.classList.add('active');
            else stepEl.classList.remove('active');
        }
    }
    el('quest-completed')?.classList.remove('active');
    updateProgressBar();

    // Инициализируем мини-игры
    initMemoryMinigame();
    initCircuitGridMinigame();

    // Запускаем отсчёт времени при старте квеста
    questTimer = startQuestTimer();

    // Фокусируемся на первом поле ввода
    el('answer-1')?.focus();
}

function closeQuest() {
    const list = el('eventsList');
    const container = el('quest-container');
    if (container) container.style.display = 'none';
    if (list) list.style.display = 'block';
}


// ─── Личный кабинет ───────────────────────────────────────────────────────────


function updateHeaderAvatars() {
    const savedAvatar = localStorage.getItem('userAvatar') || DEFAULT_AVATAR;
    const headerAvatars = document.querySelectorAll('.userHeaderAvatar');
    headerAvatars.forEach(img => {
        img.src = savedAvatar;
    });
}

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23ffd700'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%23222'/%3E%3Cpath d='M20 85 C20 62 34 58 50 58 C66 58 80 62 80 85 Z' fill='%23222'/%3E%3C/svg%3E";

function initProfilePage() {
    const username = localStorage.getItem('username') || '';
    if (!username) {
        const path = window.location.pathname;
        window.location.href = path.includes('/pages/') ? 'register.html' : 'pages/register.html';
        return;
    }

    let firstName = localStorage.getItem('firstName') || '';
    let lastName  = localStorage.getItem('lastName') || '';
    let userId    = localStorage.getItem('userId') || '';
    const email   = localStorage.getItem('email') || '';

    if (!firstName || !lastName) {
        const parts = username.split(' - ');
        if (parts.length > 0) {
            const names = parts[0].trim().split(' ');
            firstName = names[0] || '';
            lastName = names.slice(1).join(' ') || '';
        }
        if (parts.length > 1 && !userId) {
            userId = parts[1].trim();
        }
    }

    if (el('profileFirstName')) el('profileFirstName').value = firstName;
    if (el('profileLastName')) el('profileLastName').value = lastName;
    if (el('profileUserId')) el('profileUserId').value = userId;
    if (el('profileEmail')) el('profileEmail').value = email;

    const savedAvatar = localStorage.getItem('userAvatar');
    const avatarImg = el('profileAvatarImg');
    if (avatarImg) {
        avatarImg.src = savedAvatar || DEFAULT_AVATAR;
    }

    // Статистика в квесте
    const ratings = getUniqueRatings();
    const userIndex = ratings.findIndex(r => r.username === username);
    if (userIndex >= 0) {
        const userStat = ratings[userIndex];
        if (el('statBestTime')) el('statBestTime').textContent = formatTime(userStat.time);
        if (el('statRank')) el('statRank').textContent = `#${userIndex + 1}`;
    } else {
        if (el('statBestTime')) el('statBestTime').textContent = '—';
        if (el('statRank')) el('statRank').textContent = 'Не пройден';
    }

    // 👑 Проверка и отображение панели администратора
    const adminMode = isCurrentAdmin();
    if (adminMode) {
        if (el('profileAdminBadge')) el('profileAdminBadge').style.display = 'inline-flex';
        if (el('adminPanelSection')) el('adminPanelSection').style.display = 'block';
        initAdminPanel();
    } else {
        if (el('profileAdminBadge')) el('profileAdminBadge').style.display = 'none';
        if (el('adminPanelSection')) el('adminPanelSection').style.display = 'none';
    }
}

// ─── Функции Панели Администратора ──────────────────────────────────────────

function initAdminTabs() {
    const tabBtns = document.querySelectorAll('.admin-tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            const targetContent = el(targetId);
            if (targetContent) targetContent.classList.add('active');
        });
    });
}

function initAdminPanel() {
    initAdminTabs();

    // 1. Загрузка текста главной страницы
    const savedTitle = localStorage.getItem('siteWelcomeTitle') || 'Добро пожаловать на сайт ивентов Милоновых!';
    const savedText  = localStorage.getItem('siteWelcomeText') || '';
    if (el('adminHomeTitleInput')) el('adminHomeTitleInput').value = savedTitle;
    if (el('adminHomeTextInput'))  el('adminHomeTextInput').value = savedText;

    // 2. Загрузка текста «О нас» и «Устав»
    if (el('adminAboutTextInput')) el('adminAboutTextInput').value = localStorage.getItem('siteAboutText') || '';
    if (el('adminRulesTextInput')) el('adminRulesTextInput').value = localStorage.getItem('siteRulesNote') || '';

    // 3. Загрузка настроек баннера
    if (el('adminBannerTextInput')) el('adminBannerTextInput').value = localStorage.getItem('siteGlobalAlertText') || '';
    if (el('adminBannerActiveCheckbox')) el('adminBannerActiveCheckbox').checked = localStorage.getItem('siteGlobalAlertActive') === 'true';

    // 4. Загрузка настроек квеста
    if (el('adminQuestStatusSelect')) el('adminQuestStatusSelect').value = localStorage.getItem('questStatus') || 'active';
    if (el('adminQuestHintsInput')) el('adminQuestHintsInput').value = localStorage.getItem('questMaxHints') || '3';

    // 5. Отрисовка таблиц рейтинга и пользователей
    renderAdminRatingTable();
    renderAdminUsersTable();
}

// ─── Рейтинг: админ-управление ───────────────────────────────────────────────

let fbRatingsListenerActive = false;

async function renderAdminRatingTable() {
    const tbody = el('adminRatingTableBody');
    if (!tbody) return;

    if (!fbRatingsListenerActive && typeof fbListenRatings === 'function') {
        fbRatingsListenerActive = true;
        fbListenRatings(() => {
            renderAdminRatingTable();
            updateRatingTable();
        });
    }

    tbody.innerHTML = '';

    let ratings = [];
    if (typeof fbGetRatings === 'function') {
        ratings = await fbGetRatings();
    } else {
        ratings = getUniqueRatings();
    }

    if (!ratings || ratings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center">Рейтинг пуст</td></tr>';
        return;
    }

    ratings.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>#${idx + 1}</strong></td>
            <td><strong>${escapeHtml(item.username)}</strong></td>
            <td>${formatTime(item.time)}</td>
            <td><button type="button" class="btn-table-del" data-user="${escapeHtml(item.username)}">Удалить</button></td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-table-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const userToDelete = btn.dataset.user;
            if (confirm(`Удалить запись игрока "${userToDelete}" из рейтинга?`)) {
                let currentRatings = getUniqueRatings();
                currentRatings = currentRatings.filter(r => r.username !== userToDelete);
                localStorage.setItem('ratings', JSON.stringify(currentRatings));
                if (typeof fbDeleteRatingRecord === 'function') {
                    fbDeleteRatingRecord(userToDelete);
                }
                renderAdminRatingTable();
                updateRatingTable();
                alert('Запись удалена.');
            }
        });
    });
}

function adminAddRatingRecord() {
    const username = el('adminAddRatingUser')?.value?.trim();
    const timeSec = parseInt(el('adminAddRatingTime')?.value?.trim(), 10);

    if (!username || isNaN(timeSec) || timeSec <= 0) {
        alert('Пожалуйста, введите корректное имя игрока и время прохождения (в секундах).');
        return;
    }

    addToRatingTable(username, timeSec);
    renderAdminRatingTable();
    updateRatingTable();

    if (el('adminAddRatingUser')) el('adminAddRatingUser').value = '';
    if (el('adminAddRatingTime')) el('adminAddRatingTime').value = '';
    alert(`Результат игрока "${username}" (${formatTime(timeSec)}) успешно добавлен в рейтинг!`);
}

function clearAdminRating() {
    if (!confirm('ВНИМАНИЕ: Вы уверены, что хотите полностью очистить таблицу рейтинга? Все рекорды будут удалены.')) return;
    localStorage.removeItem('ratings');
    if (typeof fbClearAllRatings === 'function') {
        fbClearAllRatings();
    }
    renderAdminRatingTable();
    updateRatingTable();
    alert('Таблица рейтинга полностью очищена.');
}

// ─── Пользователи: админ-управление ─────────────────────────────────────────

let fbUsersListenerActive = false;

async function renderAdminUsersTable() {
    const tbody = el('adminUsersTableBody');
    if (!tbody) return;

    // Синхронизируем из облака Firebase
    let users = [];
    if (typeof fbGetUsers === 'function') {
        users = await fbGetUsers();
    } else {
        users = JSON.parse(localStorage.getItem('users')) || [];
    }

    if (!fbUsersListenerActive && typeof fbListenUsers === 'function') {
        fbUsersListenerActive = true;
        fbListenUsers((freshUsers) => {
            if (freshUsers && freshUsers.length) {
                renderAdminUsersTable();
            }
        });
    }

    tbody.innerHTML = '';
    const currentUserId = localStorage.getItem('userId');

    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center">Нет зарегистрированных пользователей</td></tr>';
        return;
    }

    users.forEach((u) => {
        const isFounder = ADMIN_USER_IDS.includes(u.userId);
        const isAdm = isFounder || u.isAdmin;
        const isBanned = !!u.isBanned;
        const tr = document.createElement('tr');

        let actionButtons = '';
        if (u.userId === currentUserId) {
            actionButtons = '<small class="text-muted">Это вы</small>';
        } else if (isFounder) {
            actionButtons = '<span class="badge badge-secondary">Основатель (защищён)</span>';
        } else {
            actionButtons = `
                <button type="button" class="btn-table-grant btn-toggle-admin" data-uid="${escapeHtml(u.userId)}" title="Переключить роль">${isAdm ? 'Снять админа' : '👑 Дать админа'}</button>
                <button type="button" class="${isBanned ? 'btn-table-unban btn-unban-user' : 'btn-table-ban btn-ban-user'}" data-uid="${escapeHtml(u.userId)}">${isBanned ? '✅ Разбан' : '🚫 Бан'}</button>
                <button type="button" class="btn-table-reset-pwd btn-reset-pwd" data-uid="${escapeHtml(u.userId)}" title="Сбросить пароль на 123456">🔑 Пароль</button>
                <button type="button" class="btn-table-del btn-del-user" data-uid="${escapeHtml(u.userId)}">Удалить</button>
            `;
        }

        tr.innerHTML = `
            <td><strong>${escapeHtml(u.username || (u.firstName + ' ' + u.lastName))}</strong></td>
            <td><code>${escapeHtml(u.userId || '—')}</code></td>
            <td>${escapeHtml(u.email || '—')}</td>
            <td>${isAdm ? '<span class="badge badge-warning" style="color: #222; font-weight: 800;">👑 Админ</span>' : '<span class="text-muted">Участник</span>'}</td>
            <td>${isBanned ? '<span class="badge badge-danger">🚫 Заблокирован</span>' : '<span class="badge badge-success">Активен</span>'}</td>
            <td>${actionButtons}</td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-toggle-admin').forEach(btn => {
        btn.addEventListener('click', () => toggleAdminRole(btn.dataset.uid));
    });
    tbody.querySelectorAll('.btn-ban-user, .btn-unban-user').forEach(btn => {
        btn.addEventListener('click', () => toggleBanUser(btn.dataset.uid));
    });
    tbody.querySelectorAll('.btn-reset-pwd').forEach(btn => {
        btn.addEventListener('click', () => resetUserPassword(btn.dataset.uid));
    });
    tbody.querySelectorAll('.btn-del-user').forEach(btn => {
        btn.addEventListener('click', () => deleteUser(btn.dataset.uid));
    });
}

function toggleAdminRole(uid) {
    if (ADMIN_USER_IDS.includes(uid)) {
        alert('Права основателей семьи не могут быть отозваны.');
        return;
    }
    const users = JSON.parse(localStorage.getItem('users')) || [];
    const targetUser = users.find(u => u.userId === uid);
    if (!targetUser) return;

    targetUser.isAdmin = !targetUser.isAdmin;
    localStorage.setItem('users', JSON.stringify(users));

    if (typeof fbUpdateUserFields === 'function') {
        fbUpdateUserFields(uid, { isAdmin: targetUser.isAdmin });
    }

    const currentUserId = localStorage.getItem('userId');
    if (currentUserId === uid) {
        localStorage.setItem('isAdmin', targetUser.isAdmin ? 'true' : 'false');
    }

    renderAdminUsersTable();
    alert(`Права администратора для ${targetUser.username} успешно ${targetUser.isAdmin ? 'ВЫДАНЫ 👑' : 'ОТОЗВАНЫ'}.`);
}

function toggleBanUser(uid) {
    if (ADMIN_USER_IDS.includes(uid)) {
        alert('Нельзя заблокировать основателя семьи.');
        return;
    }
    const users = JSON.parse(localStorage.getItem('users')) || [];
    const targetUser = users.find(u => u.userId === uid);
    if (!targetUser) return;

    targetUser.isBanned = !targetUser.isBanned;
    localStorage.setItem('users', JSON.stringify(users));

    if (typeof fbUpdateUserFields === 'function') {
        fbUpdateUserFields(uid, { isBanned: targetUser.isBanned });
    }

    renderAdminUsersTable();
    alert(`Пользователь ${targetUser.username} ${targetUser.isBanned ? 'ЗАБЛОКИРОВАН 🚫' : 'РАЗБЛОКИРОВАН ✅'}.`);
}

async function resetUserPassword(uid) {
    if (ADMIN_USER_IDS.includes(uid)) {
        alert('Пароли основателей защищены от сброса.');
        return;
    }
    const users = JSON.parse(localStorage.getItem('users')) || [];
    const targetUser = users.find(u => u.userId === uid);
    if (!targetUser) return;

    if (confirm(`Сбросить пароль пользователя "${targetUser.username}" на стандартный временный "123456"?`)) {
        targetUser.passwordHash = await hashString('123456');
        localStorage.setItem('users', JSON.stringify(users));
        if (typeof fbUpdateUserFields === 'function') {
            fbUpdateUserFields(uid, { passwordHash: targetUser.passwordHash });
        }
        alert(`Пароль для пользователя "${targetUser.username}" успешно сброшен на "123456".`);
    }
}

function deleteUser(uid) {
    if (ADMIN_USER_IDS.includes(uid)) {
        alert('Нельзя удалить аккаунт основателя семьи.');
        return;
    }
    if (confirm(`Удалить пользователя с ID "${uid}" из базы данных сайта?`)) {
        let users = JSON.parse(localStorage.getItem('users')) || [];
        users = users.filter(u => u.userId !== uid);
        localStorage.setItem('users', JSON.stringify(users));
        if (typeof fbDeleteUser === 'function') {
            fbDeleteUser(uid);
        }
        renderAdminUsersTable();
        alert('Пользователь удалён.');
    }
}

function grantAdminByInput() {
    const inputVal = el('adminGrantInput')?.value?.trim();
    if (!inputVal) {
        alert('Введите ID или Email пользователя.');
        return;
    }

    const users = JSON.parse(localStorage.getItem('users')) || [];
    const targetUser = users.find(u =>
        u.userId?.toLowerCase() === inputVal.toLowerCase() ||
        u.email?.toLowerCase() === inputVal.toLowerCase() ||
        u.username?.toLowerCase() === inputVal.toLowerCase()
    );

    if (!targetUser) {
        alert(`Пользователь с данными "${inputVal}" не найден в списке зарегистрированных.`);
        return;
    }

    if (targetUser.isAdmin || ADMIN_USER_IDS.includes(targetUser.userId)) {
        alert(`Пользователь ${targetUser.username} уже имеет права администратора.`);
        return;
    }

    targetUser.isAdmin = true;
    localStorage.setItem('users', JSON.stringify(users));

    if (typeof fbUpdateUserFields === 'function') {
        fbUpdateUserFields(targetUser.userId, { isAdmin: true });
    }

    const currentUserId = localStorage.getItem('userId');
    if (currentUserId === targetUser.userId) {
        localStorage.setItem('isAdmin', 'true');
    }

    if (el('adminGrantInput')) el('adminGrantInput').value = '';
    renderAdminUsersTable();
    alert(`Права администратора успешно выданы пользователю: ${targetUser.username}! 👑`);
}

// ─── Общесемейный баннер-объявление ──────────────────────────────────────────

function saveAdminBanner() {
    const text = el('adminBannerTextInput')?.value?.trim();
    const isActive = !!el('adminBannerActiveCheckbox')?.checked;

    localStorage.setItem('siteGlobalAlertText', text || '');
    localStorage.setItem('siteGlobalAlertActive', isActive ? 'true' : 'false');

    renderGlobalFamilyAlert();
    alert('Настройки глобального баннера сохранены и применены на всех страницах сайта!');
}

function disableAdminBanner() {
    localStorage.setItem('siteGlobalAlertActive', 'false');
    if (el('adminBannerActiveCheckbox')) el('adminBannerActiveCheckbox').checked = false;
    renderGlobalFamilyAlert();
    alert('Глобальный баннер отключен.');
}

function renderGlobalFamilyAlert() {
    const isActive = localStorage.getItem('siteGlobalAlertActive') === 'true';
    const text = localStorage.getItem('siteGlobalAlertText');

    let banner = document.getElementById('globalFamilyBanner');
    if (!isActive || !text) {
        if (banner) banner.remove();
        return;
    }

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'globalFamilyBanner';
        banner.className = 'global-family-banner';
        const header = document.querySelector('header');
        if (header && header.nextSibling) {
            header.parentNode.insertBefore(banner, header.nextSibling);
        } else {
            document.body.prepend(banner);
        }
    }

    banner.innerHTML = `<span class="banner-badge">📢 ВНИМАНИЕ СЕМЬИ</span> <span>${escapeHtml(text)}</span>`;
}

// ─── Управление квестом ──────────────────────────────────────────────────────

function saveAdminQuestSettings() {
    const status = el('adminQuestStatusSelect')?.value || 'active';
    const hints = el('adminQuestHintsInput')?.value || '3';

    localStorage.setItem('questStatus', status);
    localStorage.setItem('questMaxHints', hints);

    alert('Настройки квеста успешно сохранены!');
}

// ─── Редактор контента страниц (CMS) ─────────────────────────────────────────

function saveAdminHomeText() {
    const title = el('adminHomeTitleInput')?.value?.trim();
    const text  = el('adminHomeTextInput')?.value?.trim();

    if (title) localStorage.setItem('siteWelcomeTitle', title);
    if (text !== undefined) localStorage.setItem('siteWelcomeText', text);

    alert('Текст главной страницы успешно обновлён!');
}

function resetAdminHomeText() {
    if (!confirm('Сбросить текст главной страницы к исходному?')) return;
    localStorage.removeItem('siteWelcomeTitle');
    localStorage.removeItem('siteWelcomeText');
    if (el('adminHomeTitleInput')) el('adminHomeTitleInput').value = 'Добро пожаловать на сайт ивентов Милоновых!';
    if (el('adminHomeTextInput'))  el('adminHomeTextInput').value = '';
    alert('Текст сброшен к стандартному.');
}

function saveAdminAboutText() {
    const text = el('adminAboutTextInput')?.value?.trim();
    localStorage.setItem('siteAboutText', text || '');
    alert('Дополнительный текст для страницы «О нас» сохранён!');
}

function resetAdminAboutText() {
    if (!confirm('Очистить дополнительный текст страницы «О нас»?')) return;
    localStorage.removeItem('siteAboutText');
    if (el('adminAboutTextInput')) el('adminAboutTextInput').value = '';
    alert('Текст очищен.');
}

function saveAdminRulesText() {
    const text = el('adminRulesTextInput')?.value?.trim();
    localStorage.setItem('siteRulesNote', text || '');
    alert('Примечание администрации к уставу сохранено!');
}

function resetAdminRulesText() {
    if (!confirm('Очистить примечание к уставу?')) return;
    localStorage.removeItem('siteRulesNote');
    if (el('adminRulesTextInput')) el('adminRulesTextInput').value = '';
    alert('Примечание очищено.');
}

// ─── Бэкап и системные функции ───────────────────────────────────────────────

function exportSiteBackup() {
    const backupData = {
        version: '2.0',
        exportDate: new Date().toISOString(),
        exportedBy: localStorage.getItem('username') || 'Admin',
        users: JSON.parse(localStorage.getItem('users') || '[]'),
        ratings: JSON.parse(localStorage.getItem('ratings') || '[]'),
        siteWelcomeTitle: localStorage.getItem('siteWelcomeTitle') || '',
        siteWelcomeText: localStorage.getItem('siteWelcomeText') || '',
        siteAboutText: localStorage.getItem('siteAboutText') || '',
        siteRulesNote: localStorage.getItem('siteRulesNote') || '',
        siteGlobalAlertActive: localStorage.getItem('siteGlobalAlertActive') || 'false',
        siteGlobalAlertText: localStorage.getItem('siteGlobalAlertText') || '',
        questStatus: localStorage.getItem('questStatus') || 'active',
        questMaxHints: localStorage.getItem('questMaxHints') || '3'
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `milonovy_backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importSiteBackup() {
    const fileInput = el('adminImportBackupInput');
    const file = fileInput?.files?.[0];
    if (!file) {
        alert('Пожалуйста, выберите JSON-файл резервной копии.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.users || !Array.isArray(data.users)) {
                alert('Некорректный формат файла резервной копии.');
                return;
            }

            localStorage.setItem('users', JSON.stringify(data.users));
            if (data.ratings) localStorage.setItem('ratings', JSON.stringify(data.ratings));
            if (data.siteWelcomeTitle) localStorage.setItem('siteWelcomeTitle', data.siteWelcomeTitle);
            if (data.siteWelcomeText !== undefined) localStorage.setItem('siteWelcomeText', data.siteWelcomeText);
            if (data.siteAboutText !== undefined) localStorage.setItem('siteAboutText', data.siteAboutText);
            if (data.siteRulesNote !== undefined) localStorage.setItem('siteRulesNote', data.siteRulesNote);
            if (data.siteGlobalAlertActive !== undefined) localStorage.setItem('siteGlobalAlertActive', data.siteGlobalAlertActive);
            if (data.siteGlobalAlertText !== undefined) localStorage.setItem('siteGlobalAlertText', data.siteGlobalAlertText);
            if (data.questStatus) localStorage.setItem('questStatus', data.questStatus);
            if (data.questMaxHints) localStorage.setItem('questMaxHints', data.questMaxHints);

            alert('Данные сайта успешно восстановлены из резервной копии! Страница будет перезагружена.');
            location.reload();
        } catch (err) {
            alert('Ошибка при чтении файла бэкапа: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function factoryResetSite() {
    if (!confirm('ВНИМАНИЕ: Вы уверены, что хотите выполнить полный сброс сайта? Все настройки, тексты и рейтинг будут удалены. Аккаунты основателей (Геркулеса и Александра) сохранятся.')) {
        return;
    }

    // Сохраняем основу
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const founders = users.filter(u => ADMIN_USER_IDS.includes(u.userId));

    localStorage.clear();

    localStorage.setItem('users', JSON.stringify(founders));
    localStorage.setItem('isAdmin', 'true');
    localStorage.setItem('username', 'Геркулес Милонов');
    localStorage.setItem('userId', '264-013');

    alert('Сайт сброшен к заводским настройкам. Страница будет перезагружена.');
    location.reload();
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}


function saveProfile() {
    const firstName = el('profileFirstName')?.value?.trim();
    const lastName  = el('profileLastName')?.value?.trim();
    const userId    = el('profileUserId')?.value?.trim();

    if (!firstName || !lastName) {
        alert('Пожалуйста, укажите имя и фамилию.');
        return;
    }

    const oldUsername = localStorage.getItem('username');
    const newUsername = `${firstName} ${lastName}${userId ? ' - ' + userId : ''}`;

    localStorage.setItem('firstName', firstName);
    localStorage.setItem('lastName', lastName);
    localStorage.setItem('username', newUsername);

    // Обновляем имя в рейтинге, если пользователь уже проходил квест
    if (oldUsername && oldUsername !== newUsername) {
        const ratings = getUniqueRatings();
        const userIndex = ratings.findIndex(r => r.username === oldUsername);
        if (userIndex >= 0) {
            ratings[userIndex].username = newUsername;
            localStorage.setItem('ratings', JSON.stringify(ratings));
            updateRatingTable();
        }
    }

    alert('Профиль успешно обновлён!');
}

function handleAvatarUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Пожалуйста, выберите файл изображения (JPG, PNG, WEBP).');
        return;
    }

    if (file.size > 2 * 1024 * 1024) {
        alert('Размер изображения не должен превышать 2 МБ.');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
        const dataUrl = evt.target.result;
        const avatarImg = el('profileAvatarImg');
        if (avatarImg) avatarImg.src = dataUrl;
        localStorage.setItem('userAvatar', dataUrl);
        updateHeaderAvatars();
        alert('Аватарка успешно обновлена!');
    };
    reader.readAsDataURL(file);
}

function removeAvatar() {
    if (!confirm('Вы уверены, что хотите удалить фото профиля?')) return;
    localStorage.removeItem('userAvatar');
    const avatarImg = el('profileAvatarImg');
    if (avatarImg) avatarImg.src = DEFAULT_AVATAR;
    updateHeaderAvatars();
    alert('Аватарка удалена.');
}

function logoutUser() {
    if (!confirm('Вы уверены, что хотите выйти из профиля?')) return;

    localStorage.removeItem('username');
    alert('Вы вышли из профиля.');
    const path = window.location.pathname;
    window.location.href = path.includes('/pages/') ? 'register.html' : 'pages/register.html';
}

// ─── Инициализация ────────────────────────────────────────────────────────────

window.onload = function () {
    const storedUsername = localStorage.getItem('username');
    isAuthenticated = !!storedUsername;

    const path = window.location.pathname;

    if ((path.endsWith('index.html') || path.endsWith('/') || path === '') && !isAuthenticated) {
        window.location.href = 'pages/register.html';
        return;
    }

    if (path.includes('quest.html') && !isAuthenticated) {
        window.location.href = 'register.html';
        return;
    }

    // Синхронизация глобальных настроек и базы пользователей из Firebase
    if (typeof fbGetSettings === 'function') {
        fbGetSettings().then(() => {
            const freshHomeTitle = localStorage.getItem('siteWelcomeTitle');
            const freshHomeText  = localStorage.getItem('siteWelcomeText');
            if (freshHomeTitle && el('homeWelcomeTitle')) el('homeWelcomeTitle').textContent = freshHomeTitle;
            if (freshHomeText && el('homeWelcomeText')) {
                el('homeWelcomeText').textContent = freshHomeText;
                el('homeWelcomeText').style.display = 'block';
            }
        });
    }
    if (typeof fbGetUsers === 'function') {
        fbGetUsers();
    }

    // Отрисовка динамического текста главной страницы (если отредактирован администратором)
    const customHomeTitle = localStorage.getItem('siteWelcomeTitle');
    const customHomeText  = localStorage.getItem('siteWelcomeText');
    if (customHomeTitle && el('homeWelcomeTitle')) {
        el('homeWelcomeTitle').textContent = customHomeTitle;
    }
    if (customHomeText && el('homeWelcomeText')) {
        el('homeWelcomeText').textContent = customHomeText;
        el('homeWelcomeText').style.display = 'block';
    }

    // Автоматическая дедупликация и отрисовка рейтинга
    updateRatingTable();

    // Синхронизация аватарок в шапке
    updateHeaderAvatars();

    // Инициализация мини-игры на странице квеста
    if (path.includes('quest.html')) {
        initMemoryMinigame();
        initCircuitGridMinigame();
        if (isCurrentAdmin()) {
            const skipBtn = el('adminSkipStepBtn');
            if (skipBtn) skipBtn.style.display = 'inline-block';
        }
    }

    // Инициализация личного кабинета
    if (path.includes('profile.html')) {
        initProfilePage();
    }

    // ─── Привязка событий ──────────────────────────────────────────────────────

    // Форма авторизации (Вход / Регистрация)
    el('registerBtn')?.addEventListener('click', registerUser);
    el('submitLoginBtn')?.addEventListener('click', loginUser);
    el('modalClose')?.addEventListener('click', closeModal);
    el('loginBtn')?.addEventListener('click', loginUser);

    el('tabLoginBtn')?.addEventListener('click', showLoginForm);
    el('tabRegisterBtn')?.addEventListener('click', showRegisterForm);
    el('switchToRegisterLink')?.addEventListener('click', showRegisterForm);
    el('switchToLoginLink')?.addEventListener('click', showLoginForm);

    // Enter на полях входа
    el('loginPassword')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            loginUser();
        }
    });
    el('loginUsername')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            loginUser();
        }
    });

    el('openQuestBtn')?.addEventListener('click', openQuest);
    el('adminSkipStepBtn')?.addEventListener('click', skipStepAdmin);
    el('closeQuestBtn')?.addEventListener('click', closeQuest);
    el('restartQuestBtn')?.addEventListener('click', () => location.reload());

    // Личный кабинет: сохранение, аватарка, выход
    el('saveProfileBtn')?.addEventListener('click', saveProfile);
    el('avatarFileInput')?.addEventListener('change', handleAvatarUpload);
    el('removeAvatarBtn')?.addEventListener('click', removeAvatar);
    el('logoutBtn')?.addEventListener('click', logoutUser);

    // Кнопки панели администратора
    el('adminSaveHomeTextBtn')?.addEventListener('click', saveAdminHomeText);
    el('adminResetHomeTextBtn')?.addEventListener('click', resetAdminHomeText);
    el('adminClearRatingBtn')?.addEventListener('click', clearAdminRating);
    el('adminGrantBtn')?.addEventListener('click', grantAdminByInput);
    el('minigameResetBtn')?.addEventListener('click', initMemoryMinigame);
    el('gridResetCurrentWireBtn')?.addEventListener('click', resetCurrentCircuitWire);

    // Новые кнопки панели администратора
    el('adminSaveBannerBtn')?.addEventListener('click', saveAdminBanner);
    el('adminDisableBannerBtn')?.addEventListener('click', disableAdminBanner);
    el('adminSaveQuestSettingsBtn')?.addEventListener('click', saveAdminQuestSettings);
    el('adminAddRatingBtn')?.addEventListener('click', adminAddRatingRecord);
    el('adminSaveAboutTextBtn')?.addEventListener('click', saveAdminAboutText);
    el('adminResetAboutTextBtn')?.addEventListener('click', resetAdminAboutText);
    el('adminSaveRulesTextBtn')?.addEventListener('click', saveAdminRulesText);
    el('adminResetRulesTextBtn')?.addEventListener('click', resetAdminRulesText);
    el('adminExportBackupBtn')?.addEventListener('click', exportSiteBackup);
    el('adminImportBackupBtn')?.addEventListener('click', importSiteBackup);
    el('adminFactoryResetBtn')?.addEventListener('click', factoryResetSite);

    el('adminSyncLocalToCloudBtn')?.addEventListener('click', async () => {
        if (typeof fbMigrateLocalDataToCloud === 'function') {
            const btn = el('adminSyncLocalToCloudBtn');
            if (btn) btn.textContent = '⏳ Синхронизация...';
            const res = await fbMigrateLocalDataToCloud();
            if (btn) btn.textContent = '☁️ Подтянуть локальную базу в облако';
            renderAdminUsersTable();
            renderAdminRatingTable();
            alert(`Синхронизация завершена!\nВыгружено в облако: ${res.migratedUsers} новых пользователей, ${res.migratedRatings} рекордов.`);
        } else {
            alert('Firebase не подключен.');
        }
    });


    // Кнопки проверки и подсказок для каждого из 10 заданий
    for (let i = 1; i <= TOTAL_STEPS; i++) {
        el(`checkBtn${i}`)?.addEventListener('click', () => checkCode(i));
        el(`hintBtn${i}`)?.addEventListener('click', () => takeHint(i));

        // Отправка по нажатию Enter в полях ввода
        const input = el(`answer-${i}`);
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    checkCode(i);
                }
            });
        }
    }

    // Обработка клика по кнопкам выбора вариантов в Задании 3
    const optionBtns = document.querySelectorAll('#business-options .option-btn');
    optionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('selected');
        });
    });
};
