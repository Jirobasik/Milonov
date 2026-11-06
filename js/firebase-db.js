// ============================================================================
// Firebase Firestore Database Integration — Ивенты Милоновых
// ============================================================================

const firebaseConfig = {
  apiKey: "AIzaSyBPT8zLPJSsMf7NjHDa_rRKmhM63phM4_Q",
  authDomain: "milonov-ivent.firebaseapp.com",
  projectId: "milonov-ivent",
  storageBucket: "milonov-ivent.firebasestorage.app",
  messagingSenderId: "735445365472",
  appId: "1:735445365472:web:568b009b7d938a793d5685",
  measurementId: "G-87BNP5528M"
};

let db = null;
let fbAvailable = false;

try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    fbAvailable = true;
    console.log('[Firebase] Firestore успешно подключен к проекту milonov-ivent.');
  } else {
    console.warn('[Firebase] SDK Firebase не загружен. Работаем через локальный кэш.');
  }
} catch (err) {
  console.error('[Firebase] Ошибка инициализации:', err);
}

// ─── Управление пользователями (Users) ───────────────────────────────────────

/**
 * Получить список всех пользователей из Firestore.
 * При успехе синхронизирует в localStorage('users').
 */
async function fbGetUsers() {
  if (!fbAvailable || !db) {
    return JSON.parse(localStorage.getItem('users') || '[]');
  }
  try {
    const snapshot = await db.collection('users').get();
    const users = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data && data.userId) {
        users.push(data);
      }
    });
    if (users.length > 0) {
      localStorage.setItem('users', JSON.stringify(users));
      return users;
    }
    // Если коллекция в Firestore пока пуста, пробуем взять локальные данные
    return JSON.parse(localStorage.getItem('users') || '[]');
  } catch (err) {
    console.warn('[Firebase] Не удалось прочитать users из Firestore:', err);
    return JSON.parse(localStorage.getItem('users') || '[]');
  }
}

/**
 * Сохранить нового пользователя или обновить существующего в Firestore
 */
async function fbSaveUser(user) {
  // Обновляем локальный кэш
  let users = JSON.parse(localStorage.getItem('users') || '[]');
  const idx = users.findIndex(u => u.userId === user.userId || (u.email && user.email && u.email.toLowerCase() === user.email.toLowerCase()));
  if (idx >= 0) {
    users[idx] = Object.assign({}, users[idx], user);
  } else {
    users.push(user);
  }
  localStorage.setItem('users', JSON.stringify(users));

  if (!fbAvailable || !db) return true;
  try {
    const docId = user.userId || (user.email ? user.email.replace(/[.@]/g, '_') : String(Date.now()));
    await db.collection('users').doc(docId).set(user, { merge: true });
    console.log('[Firebase] Пользователь сохранён в облачной базе:', user.userId);
    return true;
  } catch (err) {
    console.warn('[Firebase] Ошибка сохранения пользователя в Firestore:', err);
    return false;
  }
}

/**
 * Обновить конкретные поля пользователя (например, роль админа, бан, сброс пароля)
 */
async function fbUpdateUserFields(userId, updates) {
  let users = JSON.parse(localStorage.getItem('users') || '[]');
  const target = users.find(u => u.userId === userId);
  if (target) {
    Object.assign(target, updates);
    localStorage.setItem('users', JSON.stringify(users));
  }

  if (!fbAvailable || !db) return true;
  try {
    await db.collection('users').doc(userId).set(updates, { merge: true });
    console.log('[Firebase] Поля пользователя обновлены в Firestore:', userId, updates);
    return true;
  } catch (err) {
    console.warn('[Firebase] Ошибка обновления пользователя в Firestore:', err);
    return false;
  }
}

/**
 * Удалить пользователя из Firestore
 */
async function fbDeleteUser(userId) {
  let users = JSON.parse(localStorage.getItem('users') || '[]');
  users = users.filter(u => u.userId !== userId);
  localStorage.setItem('users', JSON.stringify(users));

  if (!fbAvailable || !db) return true;
  try {
    await db.collection('users').doc(userId).delete();
    console.log('[Firebase] Пользователь удалён из Firestore:', userId);
    return true;
  } catch (err) {
    console.warn('[Firebase] Ошибка удаления пользователя из Firestore:', err);
    return false;
  }
}

/**
 * Зафиксировать завершение квеста пользователем в облаке
 */
async function fbRecordQuestCompletion(userId, username, totalSeconds) {
  const updates = {
    questCompleted: true,
    questTime: totalSeconds,
    questCompletedAt: Date.now()
  };
  await fbUpdateUserFields(userId, updates);

  if (!fbAvailable || !db) return true;
  try {
    await db.collection('quest_completions').doc(userId).set({
      userId,
      username: username || '',
      questTime: totalSeconds,
      completedAt: Date.now(),
      completed: true
    }, { merge: true });
    console.log('[Firebase] Завершение квеста зафиксировано в облаке для:', userId);
    return true;
  } catch (err) {
    console.warn('[Firebase] Ошибка записи quest_completions:', err);
    return false;
  }
}

/**
 * Сбросить статус квеста пользователю (разрешить повторное прохождение)
 */
async function fbResetUserQuest(userId) {
  const updates = {
    questCompleted: false,
    questTime: null,
    questCompletedAt: null,
    questResetAt: Date.now()
  };
  await fbUpdateUserFields(userId, updates);

  if (!fbAvailable || !db) return true;
  try {
    await db.collection('quest_completions').doc(userId).delete().catch(() => {});
    console.log('[Firebase] Статус квеста сброшен в облаке для:', userId);
    return true;
  } catch (err) {
    console.warn('[Firebase] Ошибка сброса quest_completions:', err);
    return false;
  }
}

/**
 * Слушатель пользователей в реальном времени (для панели администратора)
 */
function fbListenUsers(callback) {
  if (!fbAvailable || !db) return null;
  try {
    return db.collection('users').onSnapshot((snapshot) => {
      const users = [];
      snapshot.forEach(doc => {
        const d = doc.data();
        if (d && d.userId) users.push(d);
      });
      if (users.length > 0) {
        localStorage.setItem('users', JSON.stringify(users));
      }
      if (typeof callback === 'function') {
        callback(users);
      }
    }, (err) => {
      console.warn('[Firebase] Ошибка слушателя пользователей:', err);
    });
  } catch (err) {
    console.warn('[Firebase] Не удалось подключить realtime-слушатель users:', err);
    return null;
  }
}

// ─── Управление рейтингом (Ratings) ──────────────────────────────────────────

/**
 * Получить список рекордов из Firestore, отсортированных по лучшему времени
 */
async function fbGetRatings() {
  if (!fbAvailable || !db) {
    return JSON.parse(localStorage.getItem('ratings') || '[]');
  }
  try {
    const snapshot = await db.collection('ratings').orderBy('time', 'asc').get();
    const ratings = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      if (d && d.username && typeof d.time === 'number') {
        ratings.push(d);
      }
    });
    if (ratings.length > 0) {
      localStorage.setItem('ratings', JSON.stringify(ratings));
      return ratings;
    }
    return JSON.parse(localStorage.getItem('ratings') || '[]');
  } catch (err) {
    console.warn('[Firebase] Не удалось прочитать ratings из Firestore:', err);
    return JSON.parse(localStorage.getItem('ratings') || '[]');
  }
}

/**
 * Добавить или улучшить результат игрока в Firestore
 */
async function fbAddRatingRecord(username, time) {
  let ratings = JSON.parse(localStorage.getItem('ratings') || '[]');
  const existing = ratings.find(r => r.username === username);
  if (existing) {
    if (time < existing.time) existing.time = time;
  } else {
    ratings.push({ username, time });
  }
  ratings.sort((a, b) => a.time - b.time);
  localStorage.setItem('ratings', JSON.stringify(ratings));

  if (!fbAvailable || !db) return true;
  try {
    const docId = username.replace(/[\/\s#?]+/g, '_').substring(0, 80);
    const docRef = db.collection('ratings').doc(docId);
    const snap = await docRef.get();
    if (snap.exists) {
      const cur = snap.data();
      if (time < (cur.time || Infinity)) {
        await docRef.set({ username, time, updatedAt: Date.now() }, { merge: true });
      }
    } else {
      await docRef.set({ username, time, createdAt: Date.now() });
    }
    console.log('[Firebase] Рекорд добавлен в облако:', username, time);
    return true;
  } catch (err) {
    console.warn('[Firebase] Ошибка добавления рекорда в Firestore:', err);
    return false;
  }
}

/**
 * Удалить конкретную запись из рейтинга в Firestore
 */
async function fbDeleteRatingRecord(username) {
  let ratings = JSON.parse(localStorage.getItem('ratings') || '[]');
  ratings = ratings.filter(r => r.username !== username);
  localStorage.setItem('ratings', JSON.stringify(ratings));

  if (!fbAvailable || !db) return true;
  try {
    const docId = username.replace(/[\/\s#?]+/g, '_').substring(0, 80);
    await db.collection('ratings').doc(docId).delete();
    console.log('[Firebase] Рекорд удалён из Firestore:', username);
    return true;
  } catch (err) {
    console.warn('[Firebase] Ошибка удаления рекорда в Firestore:', err);
    return false;
  }
}

/**
 * Полная очистка таблицы рейтинга в Firestore
 */
async function fbClearAllRatings() {
  localStorage.removeItem('ratings');
  if (!fbAvailable || !db) return true;
  try {
    const snap = await db.collection('ratings').get();
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log('[Firebase] Рейтинг полностью очищен в Firestore.');
    return true;
  } catch (err) {
    console.warn('[Firebase] Ошибка очистки рейтинга в Firestore:', err);
    return false;
  }
}

/**
 * Слушатель таблицы рейтинга в реальном времени
 */
function fbListenRatings(callback) {
  if (!fbAvailable || !db) return null;
  try {
    return db.collection('ratings').orderBy('time', 'asc').onSnapshot((snapshot) => {
      const ratings = [];
      snapshot.forEach(doc => {
        const d = doc.data();
        if (d && d.username && typeof d.time === 'number') {
          ratings.push(d);
        }
      });
      localStorage.setItem('ratings', JSON.stringify(ratings));
      if (typeof callback === 'function') {
        callback(ratings);
      }
    }, (err) => {
      console.warn('[Firebase] Ошибка слушателя рейтинга:', err);
    });
  } catch (err) {
    console.warn('[Firebase] Не удалось подключить realtime-слушатель ratings:', err);
    return null;
  }
}

// ─── Глобальные настройки сайта (Settings & Banners) ─────────────────────────

async function fbGetSettings() {
  if (!fbAvailable || !db) return null;
  try {
    const snap = await db.collection('settings').doc('global').get();
    if (snap.exists) {
      const data = snap.data();
      if (data.siteWelcomeTitle) localStorage.setItem('siteWelcomeTitle', data.siteWelcomeTitle);
      if (data.siteWelcomeText !== undefined) localStorage.setItem('siteWelcomeText', data.siteWelcomeText);
      if (data.siteAboutText !== undefined) localStorage.setItem('siteAboutText', data.siteAboutText);
      if (data.siteRulesNote !== undefined) localStorage.setItem('siteRulesNote', data.siteRulesNote);
      if (data.siteGlobalAlertActive !== undefined) localStorage.setItem('siteGlobalAlertActive', data.siteGlobalAlertActive);
      if (data.siteGlobalAlertText !== undefined) localStorage.setItem('siteGlobalAlertText', data.siteGlobalAlertText);
      if (data.questStatus) localStorage.setItem('questStatus', data.questStatus);
      if (data.questMaxHints) localStorage.setItem('questMaxHints', data.questMaxHints);
      return data;
    }
  } catch (err) {
    console.warn('[Firebase] Ошибка загрузки настроек сайта:', err);
  }
  return null;
}

async function fbSaveSettings(updates) {
  if (!fbAvailable || !db) return false;
  try {
    await db.collection('settings').doc('global').set(updates, { merge: true });
    console.log('[Firebase] Настройки сайта сохранены в Firestore.');
    return true;
  } catch (err) {
    console.warn('[Firebase] Ошибка сохранения настроек сайта:', err);
    return false;
  }
}

/**
 * Автоматически подтягивает и выгружает всю старую локальную базу (users и ratings)
 * из браузера (localStorage) в облако Firestore.
 */
async function fbMigrateLocalDataToCloud() {
  if (!fbAvailable || !db) return { migratedUsers: 0, migratedRatings: 0 };
  let migratedUsers = 0;
  let migratedRatings = 0;
  try {
    // 1. Локальные пользователи
    const localUsers = JSON.parse(localStorage.getItem('users') || '[]');
    if (Array.isArray(localUsers) && localUsers.length > 0) {
      for (const u of localUsers) {
        if (!u || !u.userId) continue;
        const docRef = db.collection('users').doc(u.userId);
        const snap = await docRef.get();
        if (!snap.exists) {
          await docRef.set(u, { merge: true });
          migratedUsers++;
        }
      }
    }

    // 2. Локальный рейтинг
    const localRatings = JSON.parse(localStorage.getItem('ratings') || '[]');
    if (Array.isArray(localRatings) && localRatings.length > 0) {
      for (const r of localRatings) {
        if (!r || !r.username) continue;
        const docId = r.username.replace(/[\/\s#?]+/g, '_').substring(0, 80);
        const docRef = db.collection('ratings').doc(docId);
        const snap = await docRef.get();
        if (!snap.exists) {
          await docRef.set(r, { merge: true });
          migratedRatings++;
        }
      }
    }

    // 3. Скачиваем объединённый актуальный список обратно в кэш
    await fbGetUsers();
    await fbGetRatings();
    await fbGetSettings();
    console.log(`[Firebase Migration] Миграция завершена. Новых пользователей в облаке: ${migratedUsers}, рекордов: ${migratedRatings}`);
  } catch (err) {
    console.warn('[Firebase Migration] Ошибка миграции:', err);
  }
  return { migratedUsers, migratedRatings };
}

// Запуск фоновой синхронизации локальной базы с облаком при загрузке скрипта
if (fbAvailable && db) {
  setTimeout(() => {
    fbMigrateLocalDataToCloud();
  }, 1000);
}
