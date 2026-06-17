// db.js - طبقة التخزين المحلية SQLite (SQL.js + OPFS)
import initSqlJs from 'https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/sql-wasm.mjs';

let SQL = null;
let db = null;

// اسم ملف قاعدة البيانات في OPFS
const DB_FILENAME = 'ramzapp.db';

// تهيئة SQL.js وتحميل/إنشاء قاعدة البيانات
async function initDatabase() {
    if (db) return db;

    // تحميل SQL.js
    SQL = await initSqlJs({
        locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/${file}`
    });

    // محاولة فتح قاعدة بيانات موجودة من OPFS
    let fileHandle = null;
    try {
        const root = await navigator.storage.getDirectory();
        fileHandle = await root.getFileHandle(DB_FILENAME);
        const file = await fileHandle.getFile();
        const buffer = await file.arrayBuffer();
        db = new SQL.Database(new Uint8Array(buffer));
    } catch (e) {
        // الملف غير موجود، أنشئ قاعدة بيانات جديدة
        db = new SQL.Database();
    }

    // إنشاء الجداول إذا لم تكن موجودة
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            sender_id TEXT NOT NULL,
            receiver_id TEXT NOT NULL,
            content TEXT DEFAULT '',
            type TEXT DEFAULT 'text',
            media_url TEXT DEFAULT '',
            reply_to TEXT,
            created_at TEXT NOT NULL,
            status TEXT DEFAULT 'sent',
            is_read INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_msgs_sender ON messages(sender_id);
        CREATE INDEX IF NOT EXISTS idx_msgs_receiver ON messages(receiver_id);
        CREATE INDEX IF NOT EXISTS idx_msgs_created ON messages(created_at);
    `);

    // إنشاء جدول لجهات الاتصال المحلية والكتالوج
    db.run(`
        CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY,
            name TEXT,
            avatar TEXT,
            phone TEXT,
            registered INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS catalog (
            id TEXT PRIMARY KEY,
            name TEXT,
            price TEXT,
            icon TEXT
        );
    `);

    await saveDatabase();
    return db;
}

// حفظ قاعدة البيانات إلى OPFS
async function saveDatabase() {
    if (!db) return;
    const data = db.export();
    const buffer = new Uint8Array(data);
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(DB_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
}

// ====== دوال الرسائل ======

// إدراج رسالة قادمة من Supabase إلى التخزين المحلي
function insertMessage(msg) {
    if (!db) throw new Error('Database not initialized');
    db.run(
        `INSERT OR REPLACE INTO messages (id, sender_id, receiver_id, content, type, media_url, reply_to, created_at, status, is_read)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            msg.id,
            msg.sender_id,
            msg.receiver_id,
            msg.content || '',
            msg.type || 'text',
            msg.media_url || '',
            msg.reply_to || null,
            msg.created_at,
            msg.status || 'sent',
            msg.status === 'read' ? 1 : 0
        ]
    );
    saveDatabase(); // حفظ فوري (يمكن تحسينه لاحقاً)
}

// جلب جميع الرسائل بين مستخدمين
function getMessages(userId, contactId) {
    if (!db) return [];
    const stmt = db.prepare(`
        SELECT * FROM messages
        WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
        ORDER BY created_at ASC
    `);
    const rows = [];
    stmt.bind([userId, contactId, contactId, userId]);
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows.map(r => ({
        id: r.id,
        sid: r.sender_id === userId ? 'me' : contactId,
        text: r.content,
        time: r.created_at,
        img: r.type === 'image' ? r.media_url : null,
        voice: r.type === 'voice' ? { blob: r.media_url, duration: '0:00' } : null,
        status: r.status,
        replyTo: r.reply_to
    }));
}

// جلب آخر رسالة بين كل جهة اتصال والمستخدم الحالي
function getLastMessageForContacts(userId, contactIds) {
    if (!db) return {};
    const result = {};
    for (const cid of contactIds) {
        const stmt = db.prepare(`
            SELECT * FROM messages
            WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
            ORDER BY created_at DESC LIMIT 1
        `);
        stmt.bind([userId, cid, cid, userId]);
        if (stmt.step()) {
            result[cid] = stmt.getAsObject();
        }
        stmt.free();
    }
    return result;
}

// عدد الرسائل غير المقروءة من جهة اتصال معينة
function getUnreadCount(userId, contactId) {
    if (!db) return 0;
    const stmt = db.prepare(`
        SELECT COUNT(*) as cnt FROM messages
        WHERE sender_id = ? AND receiver_id = ? AND is_read = 0
    `);
    stmt.bind([contactId, userId]);
    let count = 0;
    if (stmt.step()) {
        count = stmt.getAsObject().cnt;
    }
    stmt.free();
    return count;
}

// تحديث حالة رسالة (مثلاً من delivered إلى read)
function updateMessageLocalStatus(msgId, status) {
    if (!db) return;
    const isRead = status === 'read' ? 1 : 0;
    db.run('UPDATE messages SET status = ?, is_read = ? WHERE id = ?', [status, isRead, msgId]);
    saveDatabase();
}

// حذف رسالة محلياً
function deleteMessageLocal(msgId) {
    if (!db) return;
    db.run('DELETE FROM messages WHERE id = ?', [msgId]);
    saveDatabase();
}

// بحث في الرسائل (لكامل محادثات المستخدم)
function searchMessages(userId, query) {
    if (!db) return [];
    const stmt = db.prepare(`
        SELECT * FROM messages
        WHERE (sender_id = ? OR receiver_id = ?) AND content LIKE ?
        ORDER BY created_at DESC
    `);
    stmt.bind([userId, userId, `%${query}%`]);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

// ====== دوال جهات الاتصال المحلية ======
function saveContactsLocal(contacts) {
    if (!db) return;
    db.run('DELETE FROM contacts');
    const insert = db.prepare('INSERT OR REPLACE INTO contacts (id, name, avatar, phone, registered) VALUES (?, ?, ?, ?, ?)');
    for (const c of contacts) {
        insert.bind([c.id, c.name, c.avatar, c.phone || '', c.registered ? 1 : 0]);
        insert.step();
        insert.reset();
    }
    insert.free();
    saveDatabase();
}

function getContactsLocal() {
    if (!db) return [];
    const stmt = db.prepare('SELECT * FROM contacts');
    const rows = [];
    while (stmt.step()) {
        const r = stmt.getAsObject();
        rows.push({ ...r, registered: r.registered === 1 });
    }
    stmt.free();
    return rows;
}

// ====== تصدير قاعدة البيانات كاملة (للنسخ الاحتياطي) ======
async function exportDatabase() {
    if (!db) return null;
    const data = db.export();
    return new Blob([data], { type: 'application/x-sqlite3' });
}

// استيراد قاعدة بيانات من ملف (استبدال كامل)
async function importDatabase(file) {
    const buffer = await file.arrayBuffer();
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(DB_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
    // إعادة فتح
    db = new SQL.Database(new Uint8Array(buffer));
    await saveDatabase();
    return db;
}

// تصدير الدوال
export {
    initDatabase,
    saveDatabase,
    insertMessage,
    getMessages,
    getLastMessageForContacts,
    getUnreadCount,
    updateMessageLocalStatus,
    deleteMessageLocal,
    searchMessages,
    saveContactsLocal,
    getContactsLocal,
    exportDatabase,
    importDatabase
};
