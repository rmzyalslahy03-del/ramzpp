// db.js - SQLite Database Layer (sql.js)

const DB = {
    _db: null,
    _ready: false,

    async init() {
        if (this._ready) return;

        if (typeof initSqlJs === 'undefined') {
            throw new Error('مكتبة sql.js لم تُحمّل. تأكد من اتصال الإنترنت أو استخدم Live Server.');
        }

        const SQL = await initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.9.0/${file}`
        });

        const savedData = await this._loadFromStorage();
        if (savedData) {
            this._db = new SQL.Database(new Uint8Array(savedData));
        } else {
            this._db = new SQL.Database();
            this._createTables();
        }

        this._ready = true;
        this._startAutoSave();
    },

    _createTables() {
        this._db.run(`
            CREATE TABLE IF NOT EXISTS contacts (
                id TEXT PRIMARY KEY,
                name TEXT,
                avatar TEXT,
                status TEXT,
                bio TEXT
            );
            CREATE TABLE IF NOT EXISTS messages (
                chat_id TEXT,
                sender TEXT,
                text TEXT,
                timestamp INTEGER,
                type TEXT DEFAULT 'text',
                UNIQUE(chat_id, sender, timestamp)
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS current_user (
                id TEXT PRIMARY KEY,
                name TEXT
            );
        `);
    },

    saveUser(user) {
        if (!this._ready) return;
        this._db.run(`DELETE FROM current_user`);
        this._db.run(`INSERT INTO current_user (id, name) VALUES (?, ?)`, [user.id, user.name]);
        this._saveToStorage();
    },

    getUser() {
        if (!this._ready) return null;
        const stmt = this._db.prepare(`SELECT * FROM current_user LIMIT 1`);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            return { id: row.id, name: row.name };
        }
        return null;
    },

    logoutUser() {
        if (!this._ready) return;
        this._db.run(`DELETE FROM current_user`);
        this._saveToStorage();
    },

    saveContacts(contacts) {
        if (!this._ready) return;
        this._db.run(`DELETE FROM contacts`);
        const stmt = this._db.prepare(`INSERT INTO contacts VALUES (?, ?, ?, ?, ?)`);
        contacts.forEach(c => {
            stmt.run([c.id, c.name, c.avatar || '', c.status || '', c.bio || '']);
        });
        stmt.free();
        this._saveToStorage();
    },

    getContacts() {
        if (!this._ready) return [];
        const stmt = this._db.prepare(`SELECT * FROM contacts`);
        const contacts = [];
        while (stmt.step()) {
            contacts.push(stmt.getAsObject());
        }
        stmt.free();
        return contacts;
    },

    getChatKey(chatId) { return chatId; },

    saveMessages(chatId, messages) {
        if (!this._ready) return;
        const stmt = this._db.prepare(`INSERT OR IGNORE INTO messages (chat_id, sender, text, timestamp, type) VALUES (?, ?, ?, ?, ?)`);
        messages.forEach(msg => {
            stmt.run([chatId, msg.sender, msg.text, msg.timestamp, msg.type || 'text']);
        });
        stmt.free();
        this._saveToStorage();
    },

    getMessages(chatId) {
        if (!this._ready) return [];
        const stmt = this._db.prepare(`SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC`, [chatId]);
        const msgs = [];
        while (stmt.step()) msgs.push(stmt.getAsObject());
        stmt.free();
        return msgs;
    },

    saveSetting(key, value) {
        if (!this._ready) return;
        const jsonValue = JSON.stringify(value);
        this._db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, jsonValue]);
        this._saveToStorage();
    },

    getSetting(key, defaultValue) {
        if (!this._ready) return defaultValue;
        const stmt = this._db.prepare(`SELECT value FROM settings WHERE key = ?`, [key]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            return JSON.parse(row.value);
        }
        stmt.free();
        return defaultValue;
    },

    exportAll() {
        if (!this._ready) return '{}';
        const data = {
            contacts: this.getContacts(),
            messages: this._getAllMessages(),
            settings: this._getAllSettings(),
            currentUser: this.getUser()
        };
        return JSON.stringify(data);
    },

    importAll(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            if (data.contacts) this.saveContacts(data.contacts);
            if (data.messages && data.messages.length) {
                const chatGroups = {};
                data.messages.forEach(msg => {
                    const cid = msg.chat_id;
                    if (!chatGroups[cid]) chatGroups[cid] = [];
                    chatGroups[cid].push(msg);
                });
                for (const cid in chatGroups) {
                    this.saveMessages(cid, chatGroups[cid]);
                }
            }
            if (data.settings) {
                const stmt = this._db.prepare(`INSERT OR REPLACE INTO settings VALUES (?, ?)`);
                for (const key in data.settings) stmt.run([key, JSON.stringify(data.settings[key])]);
                stmt.free();
            }
            if (data.currentUser) this.saveUser(data.currentUser);
            this._saveToStorage();
            return true;
        } catch (e) {
            console.error('استيراد فاشل:', e);
            return false;
        }
    },

    clearAll() {
        if (!this._ready) return;
        this._db.run(`DELETE FROM messages`);
        this._db.run(`DELETE FROM contacts`);
        this._db.run(`DELETE FROM settings`);
        this._db.run(`DELETE FROM current_user`);
        this._saveToStorage();
    },

    _getAllMessages() {
        const stmt = this._db.prepare(`SELECT * FROM messages`);
        const msgs = [];
        while (stmt.step()) msgs.push(stmt.getAsObject());
        stmt.free();
        return msgs;
    },

    _getAllSettings() {
        const stmt = this._db.prepare(`SELECT * FROM settings`);
        const settings = {};
        while (stmt.step()) {
            const row = stmt.getAsObject();
            settings[row.key] = JSON.parse(row.value);
        }
        stmt.free();
        return settings;
    },

    async _loadFromStorage() {
        return new Promise((resolve) => {
            const request = indexedDB.open('ramz-sqlite', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('database')) db.createObjectStore('database');
            };
            request.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction('database', 'readonly');
                const store = tx.objectStore('database');
                const getReq = store.get('dbdata');
                getReq.onsuccess = () => resolve(getReq.result);
                getReq.onerror = () => resolve(null);
            };
            request.onerror = () => resolve(null);
        });
    },

    _saveToStorage() {
        if (!this._ready) return;
        const data = this._db.export();
        const buffer = data.buffer;
        const request = indexedDB.open('ramz-sqlite', 1);
        request.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction('database', 'readwrite');
            const store = tx.objectStore('database');
            store.put(buffer, 'dbdata');
        };
    },

    _startAutoSave() {
        setInterval(() => this._saveToStorage(), 5000);
    }
};

window.DB = DB;
