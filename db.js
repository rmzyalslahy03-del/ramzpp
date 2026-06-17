// db.js - LocalStorage Database Layer (بديل SQLite)

const DB = {
    _ready: true, // جاهز فورًا

    // لا يحتاج إلى init() غير متزامنة
    async init() {
        // دالة وهمية للتوافق مع common.js (لا تفعل شيئًا)
        return Promise.resolve();
    },

    // ========= المستخدم =========
    saveUser(user) {
        localStorage.setItem('ramz_currentUser', JSON.stringify(user));
    },
    getUser() {
        const data = localStorage.getItem('ramz_currentUser');
        return data ? JSON.parse(data) : null;
    },
    logoutUser() {
        localStorage.removeItem('ramz_currentUser');
    },

    // ========= جهات الاتصال =========
    saveContacts(contacts) {
        localStorage.setItem('ramz_contacts', JSON.stringify(contacts));
    },
    getContacts() {
        const data = localStorage.getItem('ramz_contacts');
        return data ? JSON.parse(data) : [];
    },

    // ========= الرسائل =========
    getChatKey(chatId) { return 'ramz_chat_' + chatId; },

    saveMessages(chatId, messages) {
        const key = this.getChatKey(chatId);
        const existing = this.getMessages(chatId);
        // نضيف الرسائل الجديدة فقط (نتجنب التكرار)
        const merged = [...existing];
        messages.forEach(msg => {
            if (!merged.some(m => m.sender === msg.sender && m.timestamp === msg.timestamp)) {
                merged.push(msg);
            }
        });
        localStorage.setItem(key, JSON.stringify(merged));
    },
    getMessages(chatId) {
        const key = this.getChatKey(chatId);
        const data = localStorage.getItem(key);
        const msgs = data ? JSON.parse(data) : [];
        // ترتيب تصاعدي حسب الطابع الزمني
        return msgs.sort((a, b) => a.timestamp - b.timestamp);
    },

    // ========= الإعدادات =========
    saveSetting(key, value) {
        localStorage.setItem('ramz_setting_' + key, JSON.stringify(value));
    },
    getSetting(key, defaultValue) {
        const data = localStorage.getItem('ramz_setting_' + key);
        return data !== null ? JSON.parse(data) : defaultValue;
    },

    // ========= تصدير/استيراد =========
    exportAll() {
        const exportObj = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('ramz_')) {
                exportObj[key] = localStorage.getItem(key);
            }
        }
        return JSON.stringify(exportObj, null, 2);
    },
    importAll(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            for (const key in data) {
                if (key.startsWith('ramz_')) {
                    localStorage.setItem(key, data[key]);
                }
            }
            return true;
        } catch (e) {
            console.error('استيراد فاشل', e);
            return false;
        }
    },
    clearAll() {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('ramz_')) keysToRemove.push(key);
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
    },

    // دوال إضافية للتوافق مع الكود القديم (إن وُجدت)
    _getAllMessages() {
        const all = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('ramz_chat_')) {
                const msgs = JSON.parse(localStorage.getItem(key));
                all.push(...msgs);
            }
        }
        return all;
    }
};

window.DB = DB;
