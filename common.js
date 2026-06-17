// common.js - المنطق الكامل للتطبيق (متوافق مع db.js SQLite)

let currentUser = null;
let contacts = [];
let activeChatId = null;
let activeChannel = null;
let activeChatPartner = null;
let currentScreen = 'chats';

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }
}

function scrollToBottom() {
    const area = document.getElementById('messagesArea');
    if (area) area.scrollTop = area.scrollHeight;
}

document.addEventListener('DOMContentLoaded', async () => {
    await DB.init();
    console.log('✅ SQLite جاهزة');

    let user = DB.getUser();
    if (!user) {
        const localUser = localStorage.getItem('ramz_currentUser');
        if (localUser) {
            const parsed = JSON.parse(localUser);
            DB.saveUser(parsed);
            user = parsed;
        }
    }
    currentUser = user;
    if (!currentUser || !currentUser.id) {
        window.location.href = 'login.html';
        return;
    }

    contacts = DB.getContacts();
    if (contacts.length === 0) {
        contacts = [
            { id: 'user_demo1', name: 'أحمد', avatar: 'أ', status: 'متصل', bio: 'مرحباً' },
            { id: 'user_demo2', name: 'سارة', avatar: 'س', status: 'غير متصل', bio: 'مسافرة' },
            { id: 'user_demo3', name: 'خالد', avatar: 'خ', status: 'متصل', bio: 'متاح' }
        ];
        DB.saveContacts(contacts);
    }

    document.getElementById('appContainer').style.display = 'flex';
    setupNavigation();
    showScreen('chats');
    renderChatsList();
    renderContactsList();
    setupEventListeners();

    console.log('✅ التطبيق جاهز', { currentUser, contactsCount: contacts.length });
});

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => showScreen(btn.dataset.nav));
    });
    document.getElementById('backBtn')?.addEventListener('click', () => showScreen('chats'));
    document.getElementById('backFromContactsBtn')?.addEventListener('click', () => showScreen('chats'));
    document.getElementById('backFromProfileBtn')?.addEventListener('click', () => showScreen('chats'));
    document.getElementById('closeSettingsBtn')?.addEventListener('click', () => showScreen('chats'));
    document.getElementById('settingsBtn')?.addEventListener('click', () => showScreen('settings'));
    document.getElementById('contactsBtn')?.addEventListener('click', () => showScreen('contacts'));
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(screenId + 'Screen');
    if (screen) screen.classList.add('active');
    currentScreen = screenId;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.nav === screenId));
    const nav = document.getElementById('bottomNav');
    if (['chat', 'profile', 'settings'].includes(screenId)) {
        nav.style.display = 'none';
    } else {
        nav.style.display = 'flex';
    }
}

function renderChatsList() {
    const container = document.getElementById('chatsList');
    if (!container) return;
    container.innerHTML = '';
    contacts.forEach(contact => {
        const chatId = getChatId(contact);
        const messages = DB.getMessages(chatId);
        const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.innerHTML = `
            <div class="chat-avatar">${contact.avatar || '?'}
                ${contact.status === 'متصل' ? '<div class="online-dot"></div>' : ''}
            </div>
            <div class="chat-info">
                <div class="chat-name-row">
                    <span class="chat-name">${contact.name}</span>
                    <span class="chat-time">${lastMsg ? formatTime(lastMsg.timestamp) : ''}</span>
                </div>
                <div class="chat-preview">
                    <span class="last-msg">${lastMsg ? (lastMsg.type === 'text' ? lastMsg.text : '📎 وسائط') : 'ابدأ المحادثة'}</span>
                </div>
            </div>
        `;
        div.addEventListener('click', () => openChat(contact));
        container.appendChild(div);
    });
}

function getChatId(contact) {
    const ids = [currentUser.id, contact.id].sort();
    return ids[0] + '_' + ids[1];
}

async function openChat(contact) {
    activeChatPartner = contact;
    activeChatId = getChatId(contact);
    document.getElementById('chatNameDisp').textContent = contact.name;
    document.getElementById('chatStatusDisp').textContent = contact.status || 'غير متصل';
    const statusEl = document.getElementById('chatStatusDisp');
    statusEl.className = 'chat-header-status ' + (contact.status === 'متصل' ? 'online' : '');
    document.getElementById('chatAvatar').textContent = contact.avatar || '?';

    const localMessages = DB.getMessages(activeChatId);
    renderMessages(localMessages);
    showScreen('chat');

    if (typeof Supa !== 'undefined') {
        if (activeChannel) {
            await Supa.removeChannel(activeChannel);
        }
        activeChannel = Supa.createChatChannel(currentUser.id, contact.id);
        Supa.subscribeToChannel(activeChannel, handleIncomingMessage);
    }
}

function handleIncomingMessage(payload) {
    if (!payload || !payload.sender || payload.sender !== activeChatPartner.id) return;
    const messages = DB.getMessages(activeChatId);
    const exists = messages.some(m => m.sender === payload.sender && m.timestamp === payload.timestamp);
    if (!exists) {
        messages.push(payload);
        DB.saveMessages(activeChatId, [payload]);
        addMessageToUI(payload);
    }
}

function renderMessages(messages) {
    const area = document.getElementById('messagesArea');
    if (!area) return;
    area.innerHTML = '';
    messages.forEach(msg => addMessageToUI(msg));
    scrollToBottom();
}

function addMessageToUI(msg) {
    const area = document.getElementById('messagesArea');
    if (!area) return;
    const isOwn = msg.sender === currentUser.id;
    const row = document.createElement('div');
    row.className = 'msg-row ' + (isOwn ? 'own' : 'other');
    let content = '';
    if (msg.type === 'file' || (msg.text && msg.text.startsWith('📎'))) {
        const url = msg.text.replace('📎 ', '');
        content = `<a href="${url}" target="_blank">📎 ملف مرفق</a>`;
    } else {
        content = escapeHtml(msg.text || '');
    }
    row.innerHTML = `
        <div class="msg-bubble">
            ${content}
            <div class="msg-time-row"><span>${formatTime(msg.timestamp)}</span></div>
        </div>
    `;
    area.appendChild(row);
    scrollToBottom();
}

async function sendMessage(text, type = 'text') {
    if (!text.trim()) return;
    const msg = {
        sender: currentUser.id,
        text: text,
        timestamp: Date.now(),
        type: type
    };

    const messages = DB.getMessages(activeChatId);
    messages.push(msg);
    DB.saveMessages(activeChatId, [msg]);
    addMessageToUI(msg);

    if (activeChannel && typeof Supa !== 'undefined') {
        try {
            await Supa.sendBroadcast(activeChannel, msg);
        } catch (e) {
            console.warn('⚠️ فشل إرسال الرسالة عبر Supabase:', e);
        }
    }
}

async function sendMedia(file) {
    if (!file) return;
    if (typeof Supa === 'undefined') {
        showToast('❌ خاصية الرفع غير متاحة بدون Supabase');
        return;
    }
    try {
        showToast('⏳ جاري رفع الملف...');
        const { signedUrl, fileName } = await Supa.uploadTemporaryFile(file);
        await sendMessage('📎 ' + signedUrl, 'file');
        showToast('✅ تم الإرسال');
        setTimeout(() => Supa.deleteFile(fileName), 10 * 60 * 1000);
    } catch (error) {
        console.error('فشل الرفع:', error);
        showToast('❌ فشل رفع الملف');
    }
}

function renderContactsList() {
    const container = document.getElementById('contactsList');
    if (!container) return;
    container.innerHTML = '';
    contacts.forEach(contact => {
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.innerHTML = `
            <div class="chat-avatar">${contact.avatar || '?'}</div>
            <div class="chat-info">
                <span class="chat-name">${contact.name}</span>
                <span class="item-sub">${contact.status || ''}</span>
            </div>
        `;
        div.addEventListener('click', () => openChat(contact));
        container.appendChild(div);
    });
}

function setupEventListeners() {
    const input = document.getElementById('msgInput');
    const sendBtn = document.getElementById('sendMsgBtn');
    const attachBtn = document.getElementById('attachBtn');
    const fileInput = document.getElementById('hiddenFileInput');

    input?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            sendMessage(input.value.trim());
            input.value = '';
            input.focus();
        }
    });

    sendBtn?.addEventListener('click', () => {
        if (input.value.trim()) {
            sendMessage(input.value.trim());
            input.value = '';
            input.focus();
        }
    });

    attachBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) sendMedia(file);
        fileInput.value = '';
    });
}

window.exportData = function() {
    const json = DB.exportAll();
    const blob = new Blob([json], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ramz-backup.json';
    a.click();
    showToast('تم تصدير البيانات');
};

window.importData = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            const success = DB.importAll(event.target.result);
            if (success) {
                showToast('تم الاستيراد، سيتم إعادة التحميل');
                setTimeout(() => window.location.reload(), 1000);
            } else {
                showToast('ملف غير صالح');
            }
        };
        reader.readAsText(file);
    };
    input.click();
};

window.clearAllData = function() {
    if (confirm('هل أنت متأكد من حذف جميع البيانات؟')) {
        DB.clearAll();
        window.location.href = 'login.html';
    }
};

window.logout = function() {
    DB.logoutUser();
    window.location.href = 'login.html';
};
