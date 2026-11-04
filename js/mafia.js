// ============================================================================
// MILONOV MAFIA ENGINE — FIREBASE REALTIME FIRESTORE INTEGRATION
// Strict Engineering UI · Zero Emojis · Role Distribution · Phase Machine
// ============================================================================

let currentMafiaRoomId = null;
let mafiaRoomUnsubscribe = null;
let currentMafiaRoomData = null;
let currentRoleCardRevealed = true;
let audioContext = null;

// Инициализация звуковых уведомлений (Web Audio API без внешних файлов)
function playTone(freq, type, duration) {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq || 440, audioContext.currentTime);
        gain.gain.setValueAtTime(0.08, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.start();
        osc.stop(audioContext.currentTime + duration);
    } catch (e) {
        // Audio policy ignore
    }
}

function playPhaseChangeSound(phase) {
    if (phase === 'night') {
        playTone(260, 'sine', 0.6);
        setTimeout(() => playTone(195, 'sine', 0.8), 200);
    } else if (phase === 'day') {
        playTone(440, 'triangle', 0.3);
        setTimeout(() => playTone(660, 'triangle', 0.4), 150);
    } else if (phase === 'voting') {
        playTone(520, 'square', 0.2);
        setTimeout(() => playTone(520, 'square', 0.2), 250);
    }
}

// ─── Ожидание инициализации Firebase ────────────────────────────────────────

async function waitForFirebase(timeoutMs = 3000) {
    if (typeof fbAvailable !== 'undefined' && fbAvailable && typeof db !== 'undefined' && db) {
        return true;
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (typeof fbAvailable !== 'undefined' && fbAvailable && typeof db !== 'undefined' && db) {
            return true;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    return !!(typeof fbAvailable !== 'undefined' && fbAvailable && typeof db !== 'undefined' && db);
}

// ─── Хранение и идентификация текущего игрока ──────────────────────────────

function getCurrentPlayerInfo() {
    let uid = localStorage.getItem('userId');
    let username = localStorage.getItem('username');
    if (!username) {
        let fn = localStorage.getItem('firstName') || 'Гость';
        let ln = localStorage.getItem('lastName') || '';
        username = `${fn} ${ln}`.trim();
    }
    if (!uid) {
        uid = 'USR-' + Math.floor(1000 + Math.random() * 9000);
        localStorage.setItem('userId', uid);
    }
    const avatar = localStorage.getItem('userAvatar') || '';
    return {
        id: uid,
        name: username || 'Участник ' + uid,
        avatar: avatar
    };
}

// ─── Создание комнаты ───────────────────────────────────────────────────────

async function createMafiaRoom() {
    const btn = document.getElementById('createMafiaRoomBtn');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Создание комнаты...';
    }

    try {
        const isReady = await waitForFirebase(3500);
        if (!isReady || !db) {
            alert('Ошибка: облачная база Firestore недоступна. Пожалуйста, обновите страницу.');
            return;
        }

        const player = getCurrentPlayerInfo();
        const code = 'MAF-' + Math.floor(100 + Math.random() * 900);
        const roomRef = db.collection('mafia_rooms').doc(code);

        const discussionTime = parseInt(document.getElementById('settingDiscussionTime')?.value || 90, 10);
        const votingTime = parseInt(document.getElementById('settingVotingTime')?.value || 45, 10);
        const nightTime = parseInt(document.getElementById('settingNightTime')?.value || 45, 10);

        const roleManiac = !!document.getElementById('roleManiacCheckbox')?.checked;
        const roleCourtesan = !!document.getElementById('roleCourtesanCheckbox')?.checked;
        const roleJournalist = !!document.getElementById('roleJournalistCheckbox')?.checked;

        const initialData = {
            roomId: code,
            createdAt: Date.now(),
            hostId: player.id,
            hostName: player.name,
            status: 'lobby', // lobby | role_reveal | night | day | voting | finished
            round: 1,
            timerSeconds: 0,
            timerEndsAt: null,
            settings: {
                discussionTime,
                votingTime,
                nightTime,
                customRoles: {
                    maniac: roleManiac,
                    courtesan: roleCourtesan,
                    journalist: roleJournalist
                }
            },
            players: {
                [player.id]: {
                    id: player.id,
                    name: player.name,
                    avatar: player.avatar,
                    isHost: true,
                    isAlive: true,
                    role: null,
                    voteTarget: null,
                    nightTarget: null,
                    checkedBySheriff: false,
                    healedByDoctor: false,
                    blockedByCourtesan: false,
                    joinedAt: Date.now(),
                    seatNumber: 1
                }
            },
            nightActions: {
                mafiaTarget: null,
                doctorTarget: null,
                sheriffTarget: null,
                maniacTarget: null,
                courtesanTarget: null
            },
            nightResults: {
                summaryText: 'Партия еще не началась.'
            },
            voting: {
                votes: {},
                eliminated: null
            },
            winner: null,
            logs: [
                {
                    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                    text: `Комната ${code} сформирована. Ведущий: ${player.name}.`,
                    isPrivate: false
                }
            ],
            chat: [
                {
                    id: 'sys_' + Date.now(),
                    senderName: 'СИСТЕМА',
                    text: 'Добро пожаловать в комнату игры Мафия. Ожидание подключения участников.',
                    channel: 'general',
                    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                }
            ]
        };

        await roomRef.set(initialData);
        enterMafiaRoom(code);
    } catch (err) {
        console.error('Ошибка создания комнаты:', err);
        alert('Не удалось создать комнату: ' + (err.message || err));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// ─── Подключение к комнате (Открытый вход) ──────────────────────────────────

async function joinMafiaRoom(roomCode) {
    if (!roomCode) {
        alert('Выберите комнату из списка открытых лобби.');
        return;
    }

    try {
        const isReady = await waitForFirebase(3500);
        if (!isReady || !db) {
            alert('Ошибка: облачная база Firestore недоступна.');
            return;
        }

        const roomRef = db.collection('mafia_rooms').doc(roomCode);
        const snap = await roomRef.get();
        if (!snap.exists) {
            alert(`Комната ${roomCode} не найдена или уже удалена.`);
            return;
        }

        const data = snap.data();
        const player = getCurrentPlayerInfo();
        const updatePath = `players.${player.id}`;

        let playerData = data.players && data.players[player.id] ? data.players[player.id] : null;

        if (!playerData) {
            const isMidGame = (data.status !== 'lobby');
            const existingSeats = Object.values(data.players || {}).map(p => Number(p.seatNumber) || 0);
            const nextSeat = existingSeats.length > 0 ? Math.max(...existingSeats, 0) + 1 : 1;
            playerData = {
                id: player.id,
                name: player.name,
                avatar: player.avatar,
                isHost: (data.hostId === player.id),
                isAlive: !isMidGame,
                isObserver: isMidGame,
                role: isMidGame ? 'civilian' : null,
                voteTarget: null,
                nightTarget: null,
                checkedBySheriff: false,
                healedByDoctor: false,
                blockedByCourtesan: false,
                joinedAt: Date.now(),
                seatNumber: nextSeat
            };
        }

        const newLogs = [...(data.logs || [])];
        if (!data.players || !data.players[player.id]) {
            newLogs.push({
                time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                text: `Игрок ${player.name} подключился к комнате.`,
                isPrivate: false
            });
        }

        await roomRef.update({
            [updatePath]: playerData,
            logs: newLogs
        });

        enterMafiaRoom(roomCode);
    } catch (err) {
        console.error('Ошибка подключения к комнате:', err);
        alert('Ошибка подключения: ' + (err.message || err));
    }
}

// ─── Вход в комнату и подписка на изменения ─────────────────────────────────

function enterMafiaRoom(roomId) {
    if (activeRoomsUnsubscribe) {
        activeRoomsUnsubscribe();
        activeRoomsUnsubscribe = null;
    }

    currentMafiaRoomId = roomId;
    localStorage.setItem('lastMafiaRoomId', roomId);

    document.getElementById('screenBrowser')?.classList.add('d-none');
    document.getElementById('screenRoom')?.classList.remove('d-none');
    document.getElementById('currentRoomCodeDisplay').textContent = roomId;

    if (mafiaRoomUnsubscribe) {
        mafiaRoomUnsubscribe();
    }

    mafiaRoomUnsubscribe = db.collection('mafia_rooms').doc(roomId).onSnapshot((doc) => {
        if (!doc.exists) {
            alert('Комната была удалена.');
            leaveMafiaRoom();
            return;
        }
        const data = doc.data();
        currentMafiaRoomData = data;
        renderMafiaRoomState(data);
    }, (err) => {
        console.error('Ошибка подписки на комнату:', err);
    });
}

function leaveMafiaRoom() {
    if (mafiaRoomUnsubscribe) {
        mafiaRoomUnsubscribe();
        mafiaRoomUnsubscribe = null;
    }
    currentMafiaRoomId = null;
    currentMafiaRoomData = null;
    localStorage.removeItem('lastMafiaRoomId');

    document.getElementById('screenRoom')?.classList.add('d-none');
    document.getElementById('screenBrowser')?.classList.remove('d-none');
    startActiveRoomsRealtimeSync();
}

// ─── Рендеринг состояния игры ───────────────────────────────────────────────

let lastPhase = null;

function renderMafiaRoomState(room) {
    const player = getCurrentPlayerInfo();
    const isHost = (room.hostId === player.id);
    let self = room.players ? room.players[player.id] : null;
    if (!self && room.players) {
        self = Object.values(room.players).find(p => p.name === player.name) || null;
    }

    // Звук смены фазы
    if (room.status !== lastPhase) {
        playPhaseChangeSound(room.status);
        lastPhase = room.status;
    }

    // Блоки ведущего
    const hostControls = document.querySelectorAll('.host-only-control');
    hostControls.forEach(el => {
        el.style.display = isHost ? 'block' : 'none';
    });

    // Фаза: Лобби (Ожидание старта)
    if (room.status === 'lobby') {
        document.getElementById('viewLobbySection').classList.remove('d-none');
        document.getElementById('viewGameSection').classList.add('d-none');
        document.getElementById('viewGameOverSection').classList.add('d-none');
        renderLobbyPlayers(room, isHost);
        return;
    }

    // Фаза: Игра завершена
    if (room.status === 'finished') {
        document.getElementById('viewLobbySection').classList.add('d-none');
        document.getElementById('viewGameSection').classList.add('d-none');
        document.getElementById('viewGameOverSection').classList.remove('d-none');
        renderGameOverState(room, isHost);
        return;
    }

    // Активная игра (role_reveal, night, day, voting)
    document.getElementById('viewLobbySection').classList.add('d-none');
    document.getElementById('viewGameSection').classList.remove('d-none');
    document.getElementById('viewGameOverSection').classList.add('d-none');

    renderPhaseHeader(room, self);
    renderRoleCard(self);
    renderPlayerGrid(room, self);
    renderActionPanels(room, self, isHost);
    renderChatMessages(room, self);
    renderHostLog(room, isHost);
}

// ─── Статичная фиксация позиций игроков (чтобы не скакали) ─────────────────

function getStaticSortedPlayers(playersMap, hostId) {
    if (!playersMap || typeof playersMap !== 'object') return [];
    const list = Object.values(playersMap);

    return list.sort((a, b) => {
        // 1. По постоянному номеру места (seatNumber), если задан
        const seatA = Number(a.seatNumber) || 0;
        const seatB = Number(b.seatNumber) || 0;
        if (seatA > 0 && seatB > 0 && seatA !== seatB) {
            return seatA - seatB;
        }
        if (seatA > 0 && seatB <= 0) return -1;
        if (seatA <= 0 && seatB > 0) return 1;

        // 2. Ведущий всегда на месте №1 (стол ведущего)
        const aIsHost = !!(a.isHost || (hostId && a.id === hostId));
        const bIsHost = !!(b.isHost || (hostId && b.id === hostId));
        if (aIsHost && !bIsHost) return -1;
        if (!aIsHost && bIsHost) return 1;

        // 3. По времени присоединения (joinedAt)
        const timeA = Number(a.joinedAt) || 0;
        const timeB = Number(b.joinedAt) || 0;
        if (timeA > 0 && timeB > 0 && timeA !== timeB) {
            return timeA - timeB;
        }

        // 4. Гарантированно детерминированный порядок по ID
        return String(a.id || '').localeCompare(String(b.id || ''));
    });
}

// ─── Отрисовка списка игроков в лобби ────────────────────────────────────────

function renderLobbyPlayers(room, isHost) {
    const list = document.getElementById('lobbyPlayersList');
    if (!list) return;

    const sortedPlayers = getStaticSortedPlayers(room.players || {}, room.hostId);
    const countEl = document.getElementById('lobbyPlayersCount');
    if (countEl) {
        countEl.textContent = `${sortedPlayers.length} участников`;
    }

    const existingCards = Array.from(list.querySelectorAll('[data-lobby-player-id]'));
    const existingIds = existingCards.map(c => c.getAttribute('data-lobby-player-id'));
    const newIds = sortedPlayers.map(p => p.id);

    const sameOrder = existingIds.length === newIds.length && existingIds.every((id, idx) => id === newIds[idx]);

    if (!sameOrder) {
        list.innerHTML = '';
        sortedPlayers.forEach(p => {
            const item = document.createElement('div');
            item.className = 'col-md-4 col-sm-6';
            item.setAttribute('data-lobby-player-id', p.id);
            list.appendChild(item);
        });
    }

    sortedPlayers.forEach((p, idx) => {
        const item = list.querySelector(`[data-lobby-player-id="${p.id}"]`);
        if (!item) return;

        const seatIdx = p.seatNumber || (idx + 1);
        const itemHtml = `
            <div class="p-3 rounded bg-body-tertiary border border-secondary-subtle d-flex align-items-center justify-content-between" style="min-height: 62px;">
                <div class="d-flex align-items-center gap-2 overflow-hidden">
                    <span class="font-mono text-secondary small flex-shrink-0">#${seatIdx}</span>
                    <span class="fw-semibold text-truncate" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
                </div>
                <div class="flex-shrink-0 ms-2">
                    ${p.isHost ? '<span class="badge bg-secondary font-mono">ВЕДУЩИЙ</span>' : '<span class="badge bg-success-subtle text-success-emphasis font-mono">ГОТОВ</span>'}
                    ${isHost && !p.isHost ? `<button class="btn btn-sm btn-outline-danger ms-2 py-0 px-1" onclick="kickPlayer('${p.id}')" title="Исключить">×</button>` : ''}
                </div>
            </div>
        `;

        if (item.innerHTML !== itemHtml) {
            item.innerHTML = itemHtml;
        }
    });

    const startBtn = document.getElementById('startGameBtn');
    if (startBtn) {
        startBtn.disabled = sortedPlayers.length < 2;
        startBtn.textContent = sortedPlayers.length < 2 
            ? `Ожидание игроков (минимум 2, сейчас ${sortedPlayers.length})` 
            : `Раздать роли и начать партию (${sortedPlayers.length} игроков)`;
    }
}

// ─── Распределение ролей и старт игры ───────────────────────────────────────

async function startMafiaGame() {
    if (!currentMafiaRoomData || !currentMafiaRoomId) return;

    const playersArr = Object.values(currentMafiaRoomData.players || {});
    if (playersArr.length < 2) {
        alert('Для запуска игры требуется минимум 2 участника.');
        return;
    }

    const n = playersArr.length;
    const settings = currentMafiaRoomData.settings || {};
    const custom = settings.customRoles || {};

    // Пул ролей
    let roles = [];

    if (n === 2) {
        // Партия на двоих (дуэль): 1 Мафия, 1 Шериф
        roles = ['mafia', 'sheriff'];
    } else if (n === 3) {
        // Партия на троих: 1 Мафия, 1 Шериф, 1 Мирный житель
        roles = ['mafia', 'sheriff', 'civilian'];
    } else {
        // Партия на 4+ игроков
        let mafiaCount = n >= 10 ? 3 : (n >= 7 ? 2 : 1);
        for (let i = 0; i < mafiaCount; i++) roles.push('mafia');

        // Обязательные активные роли
        roles.push('doctor');
        roles.push('sheriff');

        // Опциональные кастомные роли
        if (custom.maniac && roles.length < n) roles.push('maniac');
        if (custom.courtesan && roles.length < n) roles.push('courtesan');
        if (custom.journalist && roles.length < n) roles.push('journalist');

        // Остальные места — мирные жители
        while (roles.length < n) {
            roles.push('civilian');
        }
    }

    // Случайное перемешивание (Fisher-Yates)
    for (let i = roles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    const updatedPlayers = {};
    playersArr.forEach((p, idx) => {
        updatedPlayers[p.id] = {
            ...p,
            isAlive: true,
            role: roles[idx],
            voteTarget: null,
            nightTarget: null,
            checkedBySheriff: false,
            healedByDoctor: false,
            blockedByCourtesan: false
        };
    });

    const roomRef = db.collection('mafia_rooms').doc(currentMafiaRoomId);
    await roomRef.update({
        status: 'night',
        round: 1,
        players: updatedPlayers,
        nightActions: {
            mafiaTarget: null,
            doctorTarget: null,
            sheriffTarget: null,
            maniacTarget: null,
            courtesanTarget: null
        },
        logs: [
            ...currentMafiaRoomData.logs,
            {
                time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                text: `Партия запущена. Участников: ${n}. Наступила первая ночь.`,
                isPrivate: false
            }
        ]
    });
}

// ─── Отрисовка шапки фазы и таймера ─────────────────────────────────────────

function renderPhaseHeader(room, self) {
    const badge = document.getElementById('gamePhaseBadge');
    const desc = document.getElementById('gamePhaseDesc');
    const roundDisp = document.getElementById('gameRoundDisplay');
    const nextBtn = document.getElementById('hostNextPhaseBtn');

    if (roundDisp) roundDisp.textContent = `РАУНД ${room.round}`;

    if (room.status === 'night') {
        if (badge) {
            badge.className = 'badge bg-dark border border-secondary text-white font-mono px-3 py-2';
            badge.innerHTML = '<i class="bi bi-moon-stars me-1"></i> НОЧЬ';
        }
        if (desc) desc.textContent = 'Город засыпает. Мафия и активные роли делают свой выбор.';
        if (nextBtn) {
            nextBtn.className = 'btn-shiny btn-shiny-primary btn-sm font-mono';
            nextBtn.innerHTML = '<i class="bi bi-sun me-1"></i> Завершить ночь → Начать день';
        }
    } else if (room.status === 'day') {
        if (badge) {
            badge.className = 'badge bg-warning-subtle text-warning font-mono px-3 py-2';
            badge.innerHTML = '<i class="bi bi-sun me-1"></i> ДЕНЬ: ОБСУЖДЕНИЕ';
        }
        if (desc) desc.textContent = room.nightResults?.summaryText || 'Город проснулся. Идет открытое обсуждение подозреваемых.';
        if (nextBtn) {
            nextBtn.className = 'btn-shiny btn-shiny-warning btn-sm font-mono text-dark';
            nextBtn.innerHTML = '<i class="bi bi-fingerprint me-1"></i> Завершить день → Начать голосование';
        }
    } else if (room.status === 'voting') {
        if (badge) {
            badge.className = 'badge bg-danger-subtle text-danger font-mono px-3 py-2';
            badge.innerHTML = '<i class="bi bi-fingerprint me-1"></i> ГОЛОСОВАНИЕ';
        }
        if (desc) desc.textContent = 'Отдайте голос против подозреваемого за столом либо воздержитесь.';
        if (nextBtn) {
            nextBtn.className = 'btn-shiny btn-shiny-danger btn-sm font-mono';
            nextBtn.innerHTML = '<i class="bi bi-moon-stars me-1"></i> Подвести итоги голосования → Начать ночь';
        }
    }
}

// ─── Карточка роли игрока ───────────────────────────────────────────────────

const ROLE_INFO = {
    civilian: {
        title: 'Мирные жители',
        team: 'Город',
        desc: 'Ваша цель — вычислить мафию и остаться в живых.',
        instruction: 'Ночью отдыхайте. Днем участвуйте в дискуссии и голосуйте против мафии.',
        img: '../images/mafia/civilian.jpg'
    },
    mafia: {
        title: 'Мафия',
        team: 'Мафия',
        desc: 'Ваша цель — убить всех мирных жителей.',
        instruction: 'Каждую ночь выбирайте цель для ликвидации в приватном канале. Днем притворяйтесь мирным гражданином.',
        img: '../images/mafia/mafia.jpg'
    },
    doctor: {
        title: 'Доктор',
        team: 'Город',
        desc: 'Ночью вы можете вылечить игрока.',
        instruction: 'Каждую ночь выбирайте одного участника для защиты от нападения.',
        img: '../images/mafia/doctor.jpg'
    },
    sheriff: {
        title: 'Шериф',
        team: 'Город',
        desc: 'Ночью вы можете проверить, кто есть кто.',
        instruction: 'Каждую ночь выбирайте подозреваемого для секретной проверки на принадлежность к мафии.',
        img: '../images/mafia/sheriff.jpg'
    },
    maniac: {
        title: 'Маньяк',
        team: 'Одиночка',
        desc: 'Вы — одиночный стрелок. Ночью можете убить любого игрока.',
        instruction: 'Ночью устраняйте любого игрока. Побеждаете, если остаетесь последним выжившим.',
        img: '../images/mafia/maniac.jpg'
    },
    courtesan: {
        title: 'Любовница',
        team: 'Город',
        desc: 'Ночью вы можете заблокировать любое ночное действие.',
        instruction: 'Блокируйте способность выбранного игрока на текущую ночь.',
        img: '../images/mafia/courtesan.jpg'
    },
    journalist: {
        title: 'Журналист',
        team: 'Город',
        desc: 'Вы можете сравнить команды двух игроков (мирный или мафия).',
        instruction: 'Сравнивайте команды двух игроков, чтобы узнать, на одной ли они стороне.',
        img: '../images/mafia/journalist.jpg'
    }
};

function renderRoleCard(self) {
    const roleCard = document.getElementById('roleCardBody');
    const headerBadge = document.getElementById('myRoleBadgeHeader');
    const roleCardImg = document.getElementById('myRoleCardImg');
    const roleTitle = document.getElementById('myRoleTitle');
    const roleTeam = document.getElementById('myRoleTeam');
    const roleDesc = document.getElementById('myRoleDesc');
    const roleInstruction = document.getElementById('myRoleInstruction');
    const aliveBadge = document.getElementById('myAliveBadge');

    if (!self || !self.role) {
        if (headerBadge) {
            headerBadge.className = 'badge bg-secondary font-mono';
            headerBadge.textContent = 'ОЖИДАНИЕ...';
        }
        if (roleCardImg) {
            roleCardImg.src = '../images/mafia/civilian.jpg';
            roleCardImg.alt = 'Ожидание раздачи...';
        }
        if (roleTitle) roleTitle.textContent = 'Ожидание раздачи...';
        if (roleTeam) roleTeam.textContent = 'КОМАНДА: —';
        if (roleDesc) roleDesc.textContent = 'Роли будут распределены ведущим после запуска партии.';
        if (roleInstruction) roleInstruction.textContent = 'Ожидайте раздачи ролей ведущим.';
        return;
    }

    const info = ROLE_INFO[self.role] || ROLE_INFO.civilian;
    const roleColorMap = {
        mafia: { badge: 'bg-danger text-white', team: 'text-danger fw-bold' },
        sheriff: { badge: 'bg-info text-dark', team: 'text-info fw-bold' },
        doctor: { badge: 'bg-success text-white', team: 'text-success fw-bold' },
        maniac: { badge: 'bg-warning text-dark', team: 'text-warning fw-bold' },
        courtesan: { badge: 'bg-secondary text-white', team: 'text-white fw-bold' },
        journalist: { badge: 'bg-primary text-white', team: 'text-primary fw-bold' },
        civilian: { badge: 'bg-secondary-subtle text-white', team: 'text-secondary fw-bold' }
    };
    const colors = roleColorMap[self.role] || roleColorMap.civilian;

    if (headerBadge) {
        headerBadge.className = `badge font-mono ${colors.badge}`;
        headerBadge.textContent = info.title.toUpperCase();
    }
    if (roleCardImg) {
        roleCardImg.src = info.img || '../images/mafia/civilian.jpg';
        roleCardImg.alt = info.title;
    }
    if (roleTitle) {
        roleTitle.textContent = info.title;
        roleTitle.className = `h4 fw-bold mb-0 ${self.role === 'mafia' ? 'text-danger' : (self.role === 'sheriff' ? 'text-info' : 'text-white')}`;
    }
    if (roleTeam) {
        roleTeam.innerHTML = `КОМАНДА: <span class="${colors.team}">${info.team.toUpperCase()}</span>`;
    }
    if (roleDesc) {
        roleDesc.textContent = info.desc;
    }
    if (roleInstruction) {
        roleInstruction.textContent = info.instruction || '';
    }

    if (aliveBadge) {
        aliveBadge.className = self.isAlive 
            ? 'badge bg-success-subtle text-success-emphasis font-mono' 
            : 'badge bg-danger-subtle text-danger-emphasis font-mono';
        aliveBadge.textContent = self.isAlive ? 'ЖИВ' : 'УСТРАНЕН';
    }

    if (roleCard && currentRoleCardRevealed) {
        roleCard.style.display = 'block';
    }
}

function toggleRoleCardVisibility() {
    currentRoleCardRevealed = !currentRoleCardRevealed;
    const body = document.getElementById('roleCardBody');
    const eye = document.getElementById('roleCardEyeIcon');
    if (body) {
        body.style.display = currentRoleCardRevealed ? 'block' : 'none';
    }
    if (eye) {
        eye.className = currentRoleCardRevealed ? 'bi bi-eye' : 'bi bi-eye-slash';
    }
}

// ─── Сетка игроков и выбор целей ────────────────────────────────────────────

function renderPlayerGrid(room, self) {
    const grid = document.getElementById('gamePlayersGrid');
    if (!grid) return;

    const sortedPlayers = getStaticSortedPlayers(room.players || {}, room.hostId);
    const isAlive = self && self.isAlive;
    const phase = room.status;

    // Сверяем существующие карточки по data-player-id
    const existingCards = Array.from(grid.querySelectorAll('[data-player-id]'));
    const existingIds = existingCards.map(c => c.getAttribute('data-player-id'));
    const newIds = sortedPlayers.map(p => p.id);

    const sameOrder = existingIds.length === newIds.length && existingIds.every((id, idx) => id === newIds[idx]);

    // Если состав участников изменился, создаем стабильные контейнеры
    if (!sameOrder) {
        grid.innerHTML = '';
        sortedPlayers.forEach(p => {
            const col = document.createElement('div');
            col.className = 'col-lg-3 col-md-4 col-sm-6';
            col.setAttribute('data-player-id', p.id);
            grid.appendChild(col);
        });
    }

    sortedPlayers.forEach((p, idx) => {
        const col = grid.querySelector(`[data-player-id="${p.id}"]`);
        if (!col) return;

        const isSelf = (p.id === self?.id);
        const seatIdx = p.seatNumber || (idx + 1);

        let actionButtonHtml = '';

        if (isAlive && p.isAlive && !isSelf) {
            if (phase === 'night') {
                if (self.role === 'mafia') {
                    const isTarget = (self.nightTarget === p.id);
                    actionButtonHtml = `<button class="btn btn-sm ${isTarget ? 'btn-danger' : 'btn-outline-danger'} w-100 font-mono py-1" onclick="selectNightTarget('${p.id}')">${isTarget ? 'Цель выбрана' : 'Ликвидировать'}</button>`;
                } else if (self.role === 'doctor') {
                    const isTarget = (self.nightTarget === p.id);
                    actionButtonHtml = `<button class="btn btn-sm ${isTarget ? 'btn-success' : 'btn-outline-success'} w-100 font-mono py-1" onclick="selectNightTarget('${p.id}')">${isTarget ? 'Защищается' : 'Лечить'}</button>`;
                } else if (self.role === 'sheriff') {
                    const isTarget = (self.nightTarget === p.id);
                    actionButtonHtml = `<button class="btn btn-sm ${isTarget ? 'btn-info' : 'btn-outline-info'} w-100 font-mono py-1" onclick="selectNightTarget('${p.id}')">${isTarget ? 'Проверяется' : 'Проверить'}</button>`;
                } else if (self.role === 'maniac') {
                    const isTarget = (self.nightTarget === p.id);
                    actionButtonHtml = `<button class="btn btn-sm ${isTarget ? 'btn-danger' : 'btn-outline-danger'} w-100 font-mono py-1" onclick="selectNightTarget('${p.id}')">${isTarget ? 'Цель захвачена' : 'Уничтожить'}</button>`;
                }
            } else if (phase === 'voting') {
                const hasVoted = (self.voteTarget === p.id);
                actionButtonHtml = `<button class="btn btn-sm ${hasVoted ? 'btn-danger' : 'btn-outline-danger'} w-100 font-mono py-1" onclick="castVote('${p.id}')">${hasVoted ? 'Ваш голос учтен' : 'Голосовать против'}</button>`;
            }
        }

        // Подсчет голосов днем
        let voteCount = 0;
        if (phase === 'voting' && room.voting && room.voting.votes) {
            voteCount = Object.values(room.voting.votes).filter(t => t === p.id).length;
        }

        const cardHtml = `
            <div class="spotlight-card h-100 p-3 d-flex flex-column justify-content-between ${!p.isAlive ? 'opacity-50' : ''}" style="min-height: 200px;">
                <div>
                    <div class="d-flex align-items-center justify-content-between mb-2" style="min-height: 24px;">
                        <div class="d-flex align-items-center gap-1">
                            <span class="badge ${p.isAlive ? 'bg-success-subtle text-success-emphasis' : 'bg-danger-subtle text-danger-emphasis'} font-mono small">
                                ${p.isAlive ? 'ЖИВ' : 'МЕРТВ'}
                            </span>
                            <span class="badge bg-body-tertiary border border-secondary-subtle text-secondary font-mono small">
                                СТОЛ #${seatIdx}
                            </span>
                        </div>
                        <div>
                            ${voteCount > 0 ? `<span class="badge bg-danger font-mono">${voteCount} голос(ов)</span>` : ''}
                        </div>
                    </div>

                    <div class="fw-semibold mb-1 text-truncate" title="${escapeHtml(p.name)}">
                        ${escapeHtml(p.name)} 
                        ${isSelf ? '<span class="badge bg-secondary font-mono small ms-1">(Вы)</span>' : ''}
                    </div>

                    <div class="font-mono text-secondary small mb-2" style="min-height: 20px;">
                        ID: ${escapeHtml(p.id)}
                        ${isSelf && self?.role ? ` · <span class="text-white fw-bold">${ROLE_INFO[self.role]?.title || self.role}</span>` : ''}
                        ${!isSelf && p.role === 'mafia' && self?.role === 'mafia' ? ' · <span class="text-danger fw-bold">Мафия-союзник</span>' : ''}
                    </div>

                    <div style="min-height: 24px;" class="mb-2">
                        ${p.isHost ? '<span class="badge bg-secondary-subtle text-secondary-emphasis font-mono small">ВЕДУЩИЙ</span>' : ''}
                    </div>
                </div>

                <div class="mt-2 pt-2 border-top border-secondary-subtle" style="min-height: 40px; display: flex; align-items: center;">
                    ${actionButtonHtml ? actionButtonHtml : '<div class="w-100 text-secondary small font-mono text-center opacity-50">—</div>'}
                </div>
            </div>
        `;

        if (col.innerHTML !== cardHtml) {
            col.innerHTML = cardHtml;
        }
    });

    // Кнопка пропуска при голосовании
    const skipVoteContainer = document.getElementById('skipVoteContainer');
    if (skipVoteContainer) {
        if (phase === 'voting' && isAlive) {
            skipVoteContainer.style.display = 'block';
            const hasSkipped = self?.voteTarget === 'skip';
            skipVoteContainer.innerHTML = `
                <button class="btn btn-sm ${hasSkipped ? 'btn-secondary' : 'btn-outline-secondary'} font-mono" onclick="castVote('skip')">
                    ${hasSkipped ? 'Вы воздержались' : 'Пропустить голосование (Воздержаться)'}
                </button>
            `;
        } else {
            skipVoteContainer.style.display = 'none';
        }
    }
}

// ─── Действия игроков ───────────────────────────────────────────────────────

async function selectNightTarget(targetId) {
    if (!currentMafiaRoomId || !currentMafiaRoomData) return;
    const player = getCurrentPlayerInfo();
    let self = currentMafiaRoomData.players[player.id];
    if (!self) {
        self = Object.values(currentMafiaRoomData.players || {}).find(p => p.name === player.name);
    }
    if (!self || !self.isAlive) return;

    const targetPlayer = currentMafiaRoomData.players[targetId];
    const targetName = targetPlayer?.name || targetId;

    const roomRef = db.collection('mafia_rooms').doc(currentMafiaRoomId);
    const updates = {};
    updates[`players.${self.id}.nightTarget`] = targetId;

    if (self.role === 'mafia') {
        updates['nightActions.mafiaTarget'] = targetId;
        alert(`Цель мафии выбрана: «${targetName}».`);
    } else if (self.role === 'doctor') {
        updates['nightActions.doctorTarget'] = targetId;
        alert(`Вы защитили игрока «${targetName}» от гибели на эту ночь.`);
    } else if (self.role === 'sheriff') {
        updates['nightActions.sheriffTarget'] = targetId;
        const isTargetMafia = (targetPlayer?.role === 'mafia');
        alert(`Шерифская проверка игрока «${targetName}»:\n${isTargetMafia ? 'ВНИМАНИЕ! Этот игрок — ЧЛЕН МАФИИ!' : 'Этот игрок чист (НЕ МАФИЯ).'}`);
    } else if (self.role === 'maniac') {
        updates['nightActions.maniacTarget'] = targetId;
        alert(`Жертва маньяка выбрана: «${targetName}».`);
    }

    await roomRef.update(updates);
}

async function castVote(targetId) {
    if (!currentMafiaRoomId || !currentMafiaRoomData) return;
    const player = getCurrentPlayerInfo();
    let self = currentMafiaRoomData.players[player.id];
    if (!self) {
        self = Object.values(currentMafiaRoomData.players || {}).find(p => p.name === player.name);
    }
    if (!self || !self.isAlive) return;

    const targetPlayer = targetId === 'skip' ? { name: 'Воздержаться' } : currentMafiaRoomData.players[targetId];
    const targetName = targetPlayer?.name || targetId;

    const roomRef = db.collection('mafia_rooms').doc(currentMafiaRoomId);
    await roomRef.update({
        [`players.${self.id}.voteTarget`]: targetId,
        [`voting.votes.${self.id}`]: targetId
    });
    alert(`Ваш голос учтен: «${targetName}».`);
}

// ─── Управление ведущего: Смена фаз ─────────────────────────────────────────

function renderActionPanels(room, self, isHost) {
    const nextBtn = document.getElementById('hostNextPhaseBtn');
    if (!nextBtn) return;

    if (room.status === 'night') {
        nextBtn.className = 'btn-shiny btn-shiny-primary btn-sm font-mono';
        nextBtn.innerHTML = '<i class="bi bi-sun me-1"></i> Завершить ночь → Начать день';
    } else if (room.status === 'day') {
        nextBtn.className = 'btn-shiny btn-shiny-warning btn-sm font-mono text-dark';
        nextBtn.innerHTML = '<i class="bi bi-fingerprint me-1"></i> Завершить день → Начать голосование';
    } else if (room.status === 'voting') {
        nextBtn.className = 'btn-shiny btn-shiny-danger btn-sm font-mono';
        nextBtn.innerHTML = '<i class="bi bi-moon-stars me-1"></i> Завершить голосование → Начать ночь';
    }
}

async function hostAdvancePhase() {
    if (!currentMafiaRoomData || !currentMafiaRoomId) return;
    const room = currentMafiaRoomData;
    const roomRef = db.collection('mafia_rooms').doc(currentMafiaRoomId);
    const players = { ...room.players };

    if (room.status === 'night') {
        // Подведение итогов ночи
        const mafiaTarget = room.nightActions?.mafiaTarget;
        const maniacTarget = room.nightActions?.maniacTarget;
        const doctorTarget = room.nightActions?.doctorTarget;
        const sheriffTarget = room.nightActions?.sheriffTarget;

        let killed = [];
        let saved = [];

        // Проверка цели мафии
        if (mafiaTarget) {
            if (mafiaTarget === doctorTarget) {
                saved.push(mafiaTarget);
            } else {
                killed.push(mafiaTarget);
            }
        }

        // Проверка цели маньяка
        if (maniacTarget) {
            if (maniacTarget === doctorTarget) {
                saved.push(maniacTarget);
            } else if (!killed.includes(maniacTarget)) {
                killed.push(maniacTarget);
            }
        }

        // Применяем гибель
        killed.forEach(kId => {
            if (players[kId]) {
                players[kId].isAlive = false;
            }
        });

        // Формируем сводку
        let summaryText = '';
        if (killed.length > 0) {
            const names = killed.map(kId => players[kId]?.name || kId).join(', ');
            summaryText = `В эту ночь город понес потери. Убиты: ${names}.`;
        } else {
            summaryText = 'Утро наступило спокойно: никто не погиб этой ночью благодаря действиям доктора.';
        }

        // Сброс ночных действий
        Object.keys(players).forEach(id => {
            players[id].nightTarget = null;
        });

        // Проверка победы
        const win = checkWinCondition(players);

        await roomRef.update({
            status: win ? 'finished' : 'day',
            winner: win,
            players: players,
            nightResults: {
                killed: killed,
                saved: saved,
                summaryText: summaryText
            },
            logs: [
                ...room.logs,
                {
                    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                    text: `Итоги раунда ${room.round} (ночь): ${summaryText}`,
                    isPrivate: false
                }
            ]
        });

    } else if (room.status === 'day') {
        // Переход к голосованию (очищаем старые голоса)
        Object.keys(players).forEach(id => {
            players[id].voteTarget = null;
        });

        await roomRef.update({
            status: 'voting',
            players: players,
            voting: {
                votes: {},
                eliminated: null
            },
            logs: [
                ...room.logs,
                {
                    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                    text: `День ${room.round} завершен. Началось голосование.`,
                    isPrivate: false
                }
            ]
        });

    } else if (room.status === 'voting') {
        // Подведение итогов голосования
        const votes = room.voting?.votes || {};
        const tally = {};

        Object.values(votes).forEach(target => {
            if (target && target !== 'skip') {
                tally[target] = (tally[target] || 0) + 1;
            }
        });

        let highestVotes = 0;
        let eliminatedId = null;
        let isTie = false;

        for (const [target, count] of Object.entries(tally)) {
            if (count > highestVotes) {
                highestVotes = count;
                eliminatedId = target;
                isTie = false;
            } else if (count === highestVotes) {
                isTie = true;
            }
        }

        let lynchText = '';
        if (eliminatedId && !isTie && highestVotes > 0) {
            if (players[eliminatedId]) {
                players[eliminatedId].isAlive = false;
                lynchText = `Решением большинства устранен участник ${players[eliminatedId].name} (${ROLE_INFO[players[eliminatedId].role]?.title || 'Роль неизвестна'}).`;
            }
        } else {
            lynchText = 'Голосование завершилось без исключения: голоса разделились либо большинство воздержалось.';
        }

        // Сброс дневных выборов и ночных целей
        Object.keys(players).forEach(id => {
            players[id].voteTarget = null;
            players[id].nightTarget = null;
        });

        const win = checkWinCondition(players);

        await roomRef.update({
            status: win ? 'finished' : 'night',
            winner: win,
            round: room.round + 1,
            players: players,
            nightActions: {
                mafiaTarget: null,
                doctorTarget: null,
                sheriffTarget: null,
                maniacTarget: null,
                courtesanTarget: null
            },
            voting: {
                votes: {},
                eliminated: eliminatedId
            },
            logs: [
                ...room.logs,
                {
                    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                    text: `Итоги голосования: ${lynchText}`,
                    isPrivate: false
                }
            ]
        });
    }
}

// ─── Проверка победы ────────────────────────────────────────────────────────

function checkWinCondition(players) {
    const alive = Object.values(players).filter(p => p.isAlive);
    const mafiaAlive = alive.filter(p => p.role === 'mafia');
    const townAlive = alive.filter(p => p.role !== 'mafia' && p.role !== 'maniac');
    const maniacAlive = alive.filter(p => p.role === 'maniac');

    // Если все мафиози и маньяк мертвы — победа города
    if (mafiaAlive.length === 0 && maniacAlive.length === 0) {
        return 'civilians';
    }

    // Если все мирные мертвы — победа мафии
    if (townAlive.length === 0 && maniacAlive.length === 0) {
        return 'mafia';
    }

    // Для классических партий (3+ живых участников): если мафия равна или превышает число остальных
    if (alive.length >= 3 && mafiaAlive.length >= (alive.length - mafiaAlive.length)) {
        return 'mafia';
    }

    // Если маньяк остался один на один с любым игроком (или последний)
    if (maniacAlive.length > 0 && alive.length <= 2 && mafiaAlive.length === 0) {
        return 'maniac';
    }

    return null;
}

// ─── Отрисовка финала игры ──────────────────────────────────────────────────

function renderGameOverState(room, isHost) {
    const title = document.getElementById('gameOverTitle');
    const desc = document.getElementById('gameOverDesc');
    const rolesList = document.getElementById('gameOverRolesList');

    if (room.winner === 'civilians') {
        title.textContent = 'Победа Мирных жителей (Города)';
        desc.textContent = 'Все члены преступной группировки были успешно ликвидированы.';
    } else if (room.winner === 'mafia') {
        title.textContent = 'Победа Мафии';
        desc.textContent = 'Мафия установила полный контроль над городом.';
    } else if (room.winner === 'maniac') {
        title.textContent = 'Победа Маньяка';
        desc.textContent = 'Маньяк устранил всех соперников и остался последним выжившим.';
    }

    if (rolesList) {
        rolesList.innerHTML = '';
        const sortedPlayers = getStaticSortedPlayers(room.players || {}, room.hostId);
        sortedPlayers.forEach((p, idx) => {
            const roleData = ROLE_INFO[p.role] || ROLE_INFO.civilian;
            const seatIdx = p.seatNumber || (idx + 1);
            const item = document.createElement('div');
            item.className = 'col-md-4 col-sm-6';
            item.innerHTML = `
                <div class="p-2 rounded bg-body-tertiary border border-secondary-subtle font-mono small d-flex align-items-center justify-content-between gap-2">
                    <div class="d-flex align-items-center gap-2 overflow-hidden">
                        <span class="text-secondary small">#${seatIdx}</span>
                        <img src="${roleData.img || '../images/mafia/civilian.jpg'}" alt="${roleData.title}" style="width: 28px; height: 36px; object-fit: cover; border-radius: 4px;" class="border border-secondary flex-shrink-0">
                        <span class="text-truncate">${escapeHtml(p.name)}</span>
                    </div>
                    <span class="text-white fw-bold flex-shrink-0">${roleData.title}</span>
                </div>
            `;
            rolesList.appendChild(item);
        });
    }

    const restartBtn = document.getElementById('hostRestartGameBtn');
    if (restartBtn) {
        restartBtn.style.display = isHost ? 'inline-block' : 'none';
    }
}

async function hostRestartGame() {
    if (!currentMafiaRoomId) return;
    const roomRef = db.collection('mafia_rooms').doc(currentMafiaRoomId);
    const snap = await roomRef.get();
    if (!snap.exists) return;

    const data = snap.data();
    const resetPlayers = {};
    Object.values(data.players || {}).forEach(p => {
        resetPlayers[p.id] = {
            ...p,
            isAlive: true,
            role: null,
            voteTarget: null,
            nightTarget: null
        };
    });

    await roomRef.update({
        status: 'lobby',
        round: 1,
        players: resetPlayers,
        winner: null,
        nightResults: { summaryText: 'Лобби перезапущено.' },
        voting: { votes: {} }
    });
}

// ─── Чат (Общий эфир + Приватный канал мафии) ───────────────────────────────

let currentChatChannel = 'general';

function setChatChannel(channel) {
    currentChatChannel = channel;
    document.getElementById('chatTabGeneral')?.classList.toggle('active', channel === 'general');
    document.getElementById('chatTabMafia')?.classList.toggle('active', channel === 'mafia');
    if (currentMafiaRoomData) {
        const player = getCurrentPlayerInfo();
        renderChatMessages(currentMafiaRoomData, currentMafiaRoomData.players[player.id]);
    }
}

function renderChatMessages(room, self) {
    const container = document.getElementById('chatMessagesBox');
    if (!container) return;
    container.innerHTML = '';

    const mafiaTab = document.getElementById('chatTabMafia');
    if (mafiaTab) {
        mafiaTab.style.display = (self && self.role === 'mafia') ? 'inline-block' : 'none';
    }

    const messages = (room.chat || []).filter(m => m.channel === currentChatChannel);
    messages.forEach(m => {
        const div = document.createElement('div');
        div.className = 'mb-2 font-mono small';
        div.innerHTML = `
            <span class="text-secondary">[${m.time || ''}]</span>
            <span class="fw-semibold text-white">${escapeHtml(m.senderName)}:</span>
            <span class="text-secondary-emphasis">${escapeHtml(m.text)}</span>
        `;
        container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    if (!input || !input.value.trim() || !currentMafiaRoomId || !currentMafiaRoomData) return;

    const player = getCurrentPlayerInfo();
    const self = currentMafiaRoomData.players[player.id];

    // Мертвые не пишут в общий чат
    if (self && !self.isAlive && currentChatChannel === 'general') {
        alert('Устраненные участники не могут отправлять сообщения в общий эфир.');
        return;
    }

    // Ночью общий чат блокируется
    if (currentMafiaRoomData.status === 'night' && currentChatChannel === 'general' && !self.isHost) {
        alert('Ночью в общем эфире действует режим радиомолчания.');
        return;
    }

    const msg = {
        id: 'msg_' + Date.now(),
        senderId: player.id,
        senderName: player.name,
        text: input.value.trim(),
        channel: currentChatChannel,
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    };

    const roomRef = db.collection('mafia_rooms').doc(currentMafiaRoomId);
    await roomRef.update({
        chat: [...(currentMafiaRoomData.chat || []), msg]
    });
    input.value = '';
}

// ─── Лог действий для ведущего ──────────────────────────────────────────────

function renderHostLog(room, isHost) {
    const logBox = document.getElementById('hostEventLogBox');
    if (!logBox) return;
    logBox.innerHTML = '';

    (room.logs || []).forEach(l => {
        const row = document.createElement('div');
        row.className = 'mb-1 font-mono small text-secondary';
        row.innerHTML = `<span class="text-secondary">[${l.time}]</span> ${escapeHtml(l.text)}`;
        logBox.appendChild(row);
    });
    logBox.scrollTop = logBox.scrollHeight;
}

// ─── Список открытых комнат (Браузер) ───────────────────────────────────────

// ─── Проверка прав Администратора ──────────────────────────────────────────

function checkIsUserAdmin() {
    if (typeof isCurrentAdmin === 'function' && isCurrentAdmin()) return true;
    const uid = localStorage.getItem('userId');
    if (uid === '264-013' || uid === '859-200') return true;
    if (localStorage.getItem('isAdmin') === 'true') return true;
    try {
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const u = users.find(x => x.userId === uid);
        if (u && (u.isAdmin === true || u.role === 'admin' || u.role === 'Админ')) return true;
    } catch (e) {}
    return false;
}

// ─── Список открытых комнат (Автоматическая Realtime синхронизация) ──────────

let activeRoomsUnsubscribe = null;

async function startActiveRoomsRealtimeSync() {
    const container = document.getElementById('activeRoomsList');
    if (!container) return;

    container.innerHTML = '<div class="col-12 text-secondary font-mono small p-2"><span class="spinner-border spinner-border-sm me-2"></span>Автоматическая синхронизация лобби...</div>';

    const isReady = await waitForFirebase(5000);
    if (!isReady || !db) {
        container.innerHTML = '<div class="col-12 text-secondary font-mono small p-2">Подключение к базе данных... <button class="btn btn-sm btn-link p-0 text-white" onclick="startActiveRoomsRealtimeSync()">Повторить</button></div>';
        return;
    }

    if (activeRoomsUnsubscribe) {
        activeRoomsUnsubscribe();
        activeRoomsUnsubscribe = null;
    }

    try {
        // Подписка в реальном времени: новые, обновленные и удаленные комнаты появляются автоматически
        activeRoomsUnsubscribe = db.collection('mafia_rooms').onSnapshot((snap) => {
            renderActiveRoomsSnapshot(snap);
        }, (err) => {
            console.warn('Realtime sync fallback:', err);
            db.collection('mafia_rooms').limit(30).get().then(renderActiveRoomsSnapshot).catch(() => {
                container.innerHTML = '<div class="col-12 text-danger font-mono small p-2">Ошибка загрузки комнат.</div>';
            });
        });
    } catch (err) {
        console.error('Ошибка инициализации слушателя комнат:', err);
    }
}

function renderActiveRoomsSnapshot(snap) {
    const container = document.getElementById('activeRoomsList');
    if (!container) return;

    if (!snap || snap.empty) {
        container.innerHTML = '<div class="col-12 text-secondary font-mono small p-3 rounded bg-body-tertiary border border-secondary-subtle">Нет активных комнат. Сформируйте первую комнату выше!</div>';
        return;
    }

    container.innerHTML = '';
    const player = getCurrentPlayerInfo();
    const isAdmin = checkIsUserAdmin();

    const statusMap = {
        lobby: '<span class="badge bg-secondary font-mono small">ОЖИДАНИЕ</span>',
        role_reveal: '<span class="badge bg-info-subtle text-info font-mono small">СТАРТ</span>',
        night: '<span class="badge bg-dark border border-secondary font-mono small">НОЧЬ</span>',
        day: '<span class="badge bg-warning-subtle text-warning font-mono small">ДЕНЬ</span>',
        voting: '<span class="badge bg-danger-subtle text-danger font-mono small">ГОЛОСОВАНИЕ</span>',
        finished: '<span class="badge bg-secondary font-mono small">ФИНАЛ</span>'
    };

    snap.forEach(doc => {
        const data = doc.data();
        const roomId = data.roomId || doc.id;
        const count = Object.keys(data.players || {}).length;
        const isHost = (data.hostId === player.id);
        const canDelete = isHost || isAdmin;
        const statusBadge = statusMap[data.status] || '<span class="badge bg-secondary font-mono small">ИГРА</span>';

        const item = document.createElement('div');
        item.className = 'col-12 mb-2';
        item.innerHTML = `
            <div class="spotlight-card p-3 d-flex align-items-center justify-content-between flex-wrap gap-2">
                <div>
                    <div class="d-flex align-items-center gap-2 mb-1">
                        <span class="font-mono fw-bold">${escapeHtml(roomId)}</span>
                        ${statusBadge}
                        ${isHost ? '<span class="badge bg-info-subtle text-info font-mono small">Создатель</span>' : ''}
                        ${isAdmin && !isHost ? '<span class="badge bg-warning-subtle text-warning font-mono small">Админ</span>' : ''}
                    </div>
                    <div class="small text-secondary">
                        Ведущий: <span class="text-white">${escapeHtml(data.hostName || '—')}</span> · 
                        Участников: <span class="font-mono text-white">${count}</span> (мин. 2)
                    </div>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <button type="button" class="btn-shiny btn-sm" onclick="joinMafiaRoom('${escapeHtml(roomId)}')">
                        ${data.status === 'lobby' ? 'Подключиться' : 'Войти'}
                    </button>
                    ${canDelete ? `
                        <button type="button" class="btn btn-sm btn-outline-danger font-mono" onclick="deleteRoomFromList('${escapeHtml(roomId)}')" title="Удалить комнату (${isAdmin ? 'Администратор' : 'Создатель'})">
                            <i class="bi bi-trash3"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
        container.appendChild(item);
    });
}

async function refreshRoomsList() {
    await startActiveRoomsRealtimeSync();
}

// ─── Удаление комнат (только в лобби игр для админа и создателя) ────────────

async function deleteRoomFromList(roomId) {
    if (!roomId) return;
    const isAdmin = checkIsUserAdmin();
    const promptText = isAdmin 
        ? `[Права Администратора]\nВы действительно хотите безвозвратно удалить комнату ${roomId}?` 
        : `Вы уверены, что хотите удалить комнату ${roomId}?`;

    if (!confirm(promptText)) {
        return;
    }

    const isReady = await waitForFirebase(3000);
    if (!isReady || !db) {
        alert('Ошибка: облачная база Firestore недоступна.');
        return;
    }

    try {
        await db.collection('mafia_rooms').doc(roomId).delete();
        if (localStorage.getItem('lastMafiaRoomId') === roomId) {
            localStorage.removeItem('lastMafiaRoomId');
        }
        // Realtime listener автоматически перерисует список
    } catch (err) {
        console.error('Ошибка удаления комнаты:', err);
        alert('Не удалось удалить комнату: ' + (err.message || err));
    }
}

// ─── Вспомогательные функции ────────────────────────────────────────────────

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function copyMafiaRoomCode() {
    if (!currentMafiaRoomId) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(currentMafiaRoomId).then(() => {
            alert('Код комнаты скопирован: ' + currentMafiaRoomId);
        }).catch(() => {
            prompt('Скопируйте код комнаты вручную:', currentMafiaRoomId);
        });
    } else {
        prompt('Скопируйте код комнаты вручную:', currentMafiaRoomId);
    }
}

async function kickPlayer(uid) {
    if (!currentMafiaRoomId || !currentMafiaRoomData) return;
    if (!confirm('Исключить этого участника из комнаты?')) return;

    const roomRef = db.collection('mafia_rooms').doc(currentMafiaRoomId);
    const players = { ...currentMafiaRoomData.players };
    delete players[uid];

    await roomRef.update({
        players: players,
        logs: [
            ...currentMafiaRoomData.logs,
            {
                time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                text: `Ведущий исключил игрока с ID ${uid}.`,
                isPrivate: false
            }
        ]
    });
}

// ─── Привязка функций к глобальной области видимости window ────────────────

window.createMafiaRoom = createMafiaRoom;
window.joinMafiaRoom = joinMafiaRoom;
window.leaveMafiaRoom = leaveMafiaRoom;
window.deleteRoomFromList = deleteRoomFromList;
window.copyMafiaRoomCode = copyMafiaRoomCode;
window.startMafiaGame = startMafiaGame;
window.hostAdvancePhase = hostAdvancePhase;
window.toggleRoleCardVisibility = toggleRoleCardVisibility;
window.setChatChannel = setChatChannel;
window.sendChatMessage = sendChatMessage;
window.hostRestartGame = hostRestartGame;
window.refreshRoomsList = refreshRoomsList;
window.startActiveRoomsRealtimeSync = startActiveRoomsRealtimeSync;
window.kickPlayer = kickPlayer;
window.submitNightAction = submitNightAction;
window.submitVote = submitVote;

// ─── Инициализация страницы Мафии ───────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    // Прямая привязка обработчиков клика к кнопкам через addEventListener
    document.getElementById('createMafiaRoomBtn')?.addEventListener('click', createMafiaRoom);
    document.getElementById('refreshRoomsBtn')?.addEventListener('click', refreshRoomsList);
    document.getElementById('leaveMafiaRoomBtn')?.addEventListener('click', leaveMafiaRoom);
    document.getElementById('leaveMafiaRoomBtn2')?.addEventListener('click', leaveMafiaRoom);
    document.getElementById('startGameBtn')?.addEventListener('click', startMafiaGame);
    document.getElementById('hostNextPhaseBtn')?.addEventListener('click', hostAdvancePhase);
    document.getElementById('toggleRoleBtn')?.addEventListener('click', toggleRoleCardVisibility);
    document.getElementById('chatTabGeneral')?.addEventListener('click', () => setChatChannel('general'));
    document.getElementById('chatTabMafia')?.addEventListener('click', () => setChatChannel('mafia'));
    document.getElementById('sendChatBtn')?.addEventListener('click', sendChatMessage);
    document.getElementById('hostRestartGameBtn')?.addEventListener('click', hostRestartGame);

    // Слушатель Enter для инпута чата
    document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendChatMessage();
        }
    });

    // Автоматическая загрузка списка лобби в реальном времени при входе
    startActiveRoomsRealtimeSync();

    // Восстановление последней активной комнаты, если игрок не выходил из нее
    const lastRoom = localStorage.getItem('lastMafiaRoomId');
    if (lastRoom && document.getElementById('screenRoom')) {
        const isReady = await waitForFirebase(2500);
        if (isReady && db) {
            try {
                const snap = await db.collection('mafia_rooms').doc(lastRoom).get();
                if (snap.exists) {
                    enterMafiaRoom(lastRoom);
                } else {
                    localStorage.removeItem('lastMafiaRoomId');
                }
            } catch (e) {
                localStorage.removeItem('lastMafiaRoomId');
            }
        }
    }
});
