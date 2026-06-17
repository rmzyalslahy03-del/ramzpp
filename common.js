// common.js – الطبقة المشتركة بين Supabase والتخزين المحلي وكل الميزات

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {
    initDatabase,
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
} from './db.js';

// ========== تكوين Supabase ==========
const SUPABASE_URL = 'https://serlegwdzjulfcxabxzv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4_c97KxnG_7HTvfv-pKeNQ_FTlnK6Yx';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ========== الإعدادات المحلية ==========
let localSettings = {
    theme: 'dark',
    notifications: true
};

function loadSettings() {
    const raw = localStorage.getItem('ramzapp_settings');
    if (raw) localSettings = { ...localSettings, ...JSON.parse(raw) };
    applyTheme();
}

function saveSettings() {
    localStorage.setItem('ramzapp_settings', JSON.stringify(localSettings));
}

function applyTheme() {
    document.body.classList.toggle('light-theme', localSettings.theme === 'light');
}

// ========== دوال الوقت والنص ==========
function timeAgo(d) {
    const df = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (df < 60) return 'الآن';
    if (df < 3600) return Math.floor(df / 60) + ' د';
    if (df < 86400) return Math.floor(df / 3600) + ' س';
    return Math.floor(df / 86400) + ' يوم';
}

function fmtTime(d) { return new Date(d).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }); }
function fmtDate(d) { return new Date(d).toLocaleDateString('ar-SA', { weekday: 'long', month: 'long', day: 'numeric' }); }
function esc(s) { return s ? s.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]) : ''; }
function genId() { return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6); }

function toast(msg, duration = 2000) {
    const existing = document.querySelector('.global-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'global-toast';
    el.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px20px;border-radius:25px;font-size:13px;z-index:9999;opacity:0;transition:opacity0.3s;font-family:'Cairo'`;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.style.opacity = '1');
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, duration);
}

// ========== دوال المستخدم ==========
async function getCurrentUser() {
    const raw = localStorage.getItem('ramzapp_user');
    return raw ? JSON.parse(raw) : null;
}

async function setOnlineStatus(status) {
    const user = await getCurrentUser();
    if (!user) return;
    await supabase.from('users').update({ is_online: status, last_seen: new Date().toISOString() }).eq('id', user.id);
}

// تسجيل الدخول بالبريد
async function signInWithEmail(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const user = data.user;
    const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();
    const userData = {
        id: user.id, email: user.email,
        name: profile?.name || 'مستخدم', avatar: profile?.avatar || '👤',
        phone: profile?.phone || ''
    };
    localStorage.setItem('ramzapp_user', JSON.stringify(userData));
    await setOnlineStatus(true);
    return userData;
}

// تسجيل ضيف
async function signInGuest() {
    const guestEmail = `guest_${Date.now()}@ramzapp.local`;
    const guestPassword = 'Guest@' + Date.now();
    const { data, error } = await supabase.auth.signUp({ email: guestEmail, password: guestPassword });
    if (error) throw error;
    const user = data.user;
    if (user) {
        await supabase.from('users').insert({ id: user.id, name: 'زائر', avatar: '👤', is_online: true });
        const userData = { id: user.id, email: user.email, name: 'زائر', avatar: '👤', phone: '' };
        localStorage.setItem('ramzapp_user', JSON.stringify(userData));
        return userData;
    }
    throw new Error('فشل إنشاء الضيف');
}

// تسجيل الدخول / التسجيل برقم الهاتف
async function signInWithPhone(phone) {
    const cleaned = phone.replace(/[\s\-\(\)]/g, '');
    const { data: existingUsers } = await supabase.from('users').select('*').eq('phone', cleaned).limit(1);
    let user;
    let isNewUser = false;
    if (existingUsers && existingUsers.length > 0) {
        user = existingUsers[0];
    } else {
        const tempName = 'مستخدم_' + cleaned.slice(-4);
        const { data: newUser, error } = await supabase.from('users').insert({
            name: tempName, phone: cleaned, avatar: tempName.charAt(0)
        }).select().single();
        if (error) throw error;
        user = newUser;
        isNewUser = true;
    }
    const userData = {
        id: user.id, email: '', name: user.name, avatar: user.avatar, phone: user.phone || '', isGuest: false
    };
    localStorage.setItem('ramzapp_user', JSON.stringify(userData));
    await supabase.from('users').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', user.id);
    return { user: userData, isNewUser };
}

// ========== رفع الصور ==========
async function uploadImage(file) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    const fileName = `${user.id}/${Date.now()}-${file.name}`;
    const { data, error } = await supabase.storage.from('ramz-images').upload(fileName, file, {
        cacheControl: '3600', upsert: false
    });
    if (error) throw error;
    const { data: publicURL } = supabase.storage.from('ramz-images').getPublicUrl(fileName);
    return publicURL.publicUrl;
}

// ========== جلب المحادثات ==========
async function fetchChats() {
    const user = await getCurrentUser();
    if (!user) return [];
    const { data: allUsers } = await supabase.from('users').select('*').neq('id', user.id);
    if (!allUsers) return [];
    await initDatabase();
    const lastMsgs = getLastMessageForContacts(user.id, allUsers.map(u => u.id));
    return allUsers.map(u => {
        const lastMsg = lastMsgs[u.id];
        const unread = getUnreadCount(user.id, u.id);
        return {
            id: u.id, name: u.name, avatar: u.avatar,
            online: u.is_online, lastSeen: u.last_seen,
            lastMsg: lastMsg ? lastMsg.content : '',
            lastTime: lastMsg ? lastMsg.created_at : null,
            unread: unread || 0, pinned: false
        };
    }).sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned - a.pinned;
        return new Date(b.lastTime || 0) - new Date(a.lastTime || 0);
    });
}

// ========== جلب الرسائل من Supabase ==========
async function fetchMessages(contactId) {
    const user = await getCurrentUser();
    if (!user) return [];
    const { data } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${contactId}),and(sender_id.eq.${contactId},receiver_id.eq.${user.id})`)
        .order('created_at', { ascending: true });
    return (data || []).map(m => ({
        id: m.id, sid: m.sender_id === user.id ? 'me' : contactId,
        text: m.content, time: m.created_at,
        img: m.type === 'image' ? m.media_url : null,
        voice: m.type === 'voice' ? { blob: m.media_url, duration: m.voice_duration || '0:00' } : null,
        status: m.status, replyTo: m.reply_to
    }));
}

// ========== إرسال رسالة ==========
async function sendMessage(receiverId, message) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    const payload = {
        sender_id: user.id, receiver_id: receiverId,
        content: message.text || '', type: message.type || 'text',
        media_url: message.img || '', reply_to: message.replyTo || null,
        status: 'sent'
    };
    const { data, error } = await supabase.from('messages').insert(payload).select().single();
    if (error) throw error;
    return data;
}

async function updateMessageStatus(msgId, status) {
    await supabase.from('messages').update({ status }).eq('id', msgId);
    await updateMessageLocalStatus(msgId, status);
}

// ========== Realtime ==========
function subscribeToMessages(chatId, onNewMessage) {
    const userStr = localStorage.getItem('ramzapp_user');
    if (!userStr) return null;
    const userId = JSON.parse(userStr).id;
    return supabase
        .channel('messages-' + chatId)
        .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'messages',
            filter: `receiver_id=eq.${userId}`
        }, payload => {
            if (payload.new.sender_id === chatId) {
                onNewMessage(payload.new);
            }
        })
        .subscribe();
}

// ========== بث الكتابة ==========
function sendTypingEvent(receiverId, isTyping) {
    const userStr = localStorage.getItem('ramzapp_user');
    if (!userStr) return;
    const user = JSON.parse(userStr);
    supabase.channel('typing-' + receiverId).send({
        type: 'broadcast', event: 'typing',
        payload: { user_id: user.id, isTyping }
    });
}

function onTypingEvent(chatId, callback) {
    const channel = supabase.channel('typing-' + chatId);
    channel.on('broadcast', { event: 'typing' }, payload => {
        if (payload.user_id === chatId) {
            callback(payload.isTyping);
        }
    }).subscribe();
    return channel;
}

// ========== دوال التخزين المحلي ==========
async function fetchAndStoreMessages(contactId) {
    const user = await getCurrentUser();
    if (!user) return [];
    const msgs = await fetchMessages(contactId);
    await initDatabase();
    for (const m of msgs) {
        await insertMessage({
            id: m.id, sender_id: m.sid === 'me' ? user.id : contactId,
            receiver_id: m.sid === 'me' ? contactId : user.id,
            content: m.text || '', type: m.img ? 'image' : 'text',
            media_url: m.img || '', reply_to: m.replyTo || null,
            created_at: m.time, status: m.status || 'sent'
        });
    }
    return msgs;
}

async function getMessagesLocalFirst(contactId) {
    await initDatabase();
    const user = await getCurrentUser();
    if (!user) return [];
    let localMsgs = getMessages(user.id, contactId);
    if (localMsgs.length === 0) {
        localMsgs = await fetchAndStoreMessages(contactId);
    }
    return localMsgs;
}

async function onNewMessageRealtime(newMsg, currentUserId) {
    await initDatabase();
    await insertMessage({
        id: newMsg.id, sender_id: newMsg.sender_id, receiver_id: newMsg.receiver_id,
        content: newMsg.content || '', type: newMsg.type || 'text',
        media_url: newMsg.media_url || '', reply_to: newMsg.reply_to || null,
        created_at: newMsg.created_at, status: newMsg.status || 'sent'
    });
}

async function storeSentMessageLocally(msgData, receiverId) {
    const user = await getCurrentUser();
    await initDatabase();
    await insertMessage({
        id: msgData.id, sender_id: user.id, receiver_id: receiverId,
        content: msgData.content || '', type: msgData.type || 'text',
        media_url: msgData.media_url || '', reply_to: msgData.reply_to || null,
        created_at: msgData.created_at, status: 'sent'
    });
}

async function searchChatLocally(contactId, query) {
    const user = await getCurrentUser();
    if (!user) return [];
    return searchMessages(user.id, query);
}

// ========== دوال File System Access ==========
let mediaFolderHandle = null;

async function ensureMediaFolder() {
    if (localStorage.getItem('ramzapp_media_folder_granted') === 'true') {
        try {
            mediaFolderHandle = await window.showDirectoryPicker({
                id: 'ramzapp-media', mode: 'readwrite', startIn: 'documents'
            });
            return true;
        } catch (e) {
            localStorage.removeItem('ramzapp_media_folder_granted');
            mediaFolderHandle = null;
        }
    }
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'ramzapp-media-modal-overlay';
        overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;font-family:'Cairo'`;
        const card = document.createElement('div');
        card.style.cssText = `background:var(--surface,#1a1a1a);color:var(--text,#fff);border-radius:20px;padding:24px;width:340px;max-width:90%;box-shadow:0 20px 40px rgba(0,0,0,0.6);text-align:center`;
        card.innerHTML = `
            <div style="font-size:48px;margin-bottom:12px;">📂</div>
            <h3 style="margin-bottom:8px;">تحديد مجلد التخزين</h3>
            <p style="font-size:13px;color:var(--text3,#999);margin-bottom:16px;">
                سيُطلب منك اختيار مجلد لحفظ الوسائط والملفات.<br>
                <strong>نوصي بإنشاء مجلد باسم RamzApp Media.</strong>
            </p>
            <div style="display:flex;gap:10px;justify-content:center;">
                <button id="ramzapp-media-confirm" style="background:linear-gradient(135deg,#ff0050,#ff6b8a);border:none;color:#fff;padding:10px24px;border-radius:25px;font-weight:700;cursor:pointer;font-family:inherit;flex:1;">✅ موافق</button>
                <button id="ramzapp-media-skip" style="background:transparent;border:2px solid #ff0050;color:#ff0050;padding:10px24px;border-radius:25px;font-weight:700;cursor:pointer;font-family:inherit;flex:1;">⏭️ تخطي</button>
            </div>`;
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        document.getElementById('ramzapp-media-confirm').addEventListener('click', async () => {
            overlay.remove();
            try {
                mediaFolderHandle = await window.showDirectoryPicker({
                    id: 'ramzapp-media', mode: 'readwrite', startIn: 'documents'
                });
                localStorage.setItem('ramzapp_media_folder_granted', 'true');
                toast('✅ تم اختيار مجلد التخزين');
                resolve(true);
            } catch (err) {
                toast(err.name === 'AbortError' ? '⚠️ لم يتم اختيار مجلد' : '❌ حدث خطأ');
                resolve(false);
            }
        });
        document.getElementById('ramzapp-media-skip').addEventListener('click', () => {
            overlay.remove();
            toast('⏭️ تم تخطي اختيار المجلد');
            resolve(false);
        });
    });
}

async function saveMediaToLocalFolder(fileName, blobOrUrl) {
    if (!mediaFolderHandle) {
        if (localStorage.getItem('ramzapp_media_folder_granted') === 'true') await ensureMediaFolder();
        if (!mediaFolderHandle) { toast('⚠️ لم يتم تحديد مجلد التخزين'); return false; }
    }
    try {
        let blob;
        if (typeof blobOrUrl === 'string') {
            const response = await fetch(blobOrUrl);
            blob = await response.blob();
        } else {
            blob = blobOrUrl;
        }
        const newFileHandle = await mediaFolderHandle.getFileHandle(fileName, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
    } catch (err) {
        console.error('فشل حفظ الملف:', err);
        toast('❌ فشل حفظ الملف');
        return false;
    }
}

async function downloadAndSaveMedia(url, fileName) {
    if (await saveMediaToLocalFolder(fileName, url)) {
        toast('💾 تم الحفظ في مجلد RamzApp Media');
    }
}

async function autoSaveSentMedia(localFileName, blobOrUrl) {
    return await saveMediaToLocalFolder(localFileName, blobOrUrl);
}

async function autoSaveReceivedMedia(url, msgId) {
    const fileName = `received_${msgId}_${Date.now()}.jpg`;
    return await saveMediaToLocalFolder(fileName, url);
}

// ========== القصص ==========
async function uploadStory(file) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    const fileName = `stories/${user.id}/${Date.now()}-${file.name}`;
    const { data, error } = await supabase.storage.from('ramz-images').upload(fileName, file, {
        cacheControl: '3600', upsert: false
    });
    if (error) throw error;
    const { data: publicURL } = supabase.storage.from('ramz-images').getPublicUrl(fileName);
    const { data: story, error: insertError } = await supabase.from('stories').insert({
        user_id: user.id, media_url: publicURL.publicUrl,
        type: file.type.startsWith('video/') ? 'video' : 'image'
    }).select().single();
    if (insertError) throw insertError;
    return story;
}

async function fetchStories() {
    const user = await getCurrentUser();
    if (!user) return [];
    await supabase.from('stories').delete().lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    const { data, error } = await supabase.from('stories').select('*, users(id, name, avatar)').neq('user_id', user.id).order('created_at', { ascending: false });
    if (error) return [];
    const grouped = {};
    data.forEach(story => {
        if (!grouped[story.user_id]) grouped[story.user_id] = { userId: story.user_id, name: story.users.name, avatar: story.users.avatar, stories: [] };
        grouped[story.user_id].stories.push({ id: story.id, mediaUrl: story.media_url, type: story.type || 'image', createdAt: story.created_at });
    });
    const { data: myStories } = await supabase.from('stories').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    const result = Object.values(grouped);
    result.unshift({ userId: user.id, name: 'قصتي', avatar: user.avatar || '👤', stories: (myStories || []).map(s => ({ id: s.id, mediaUrl: s.media_url, type: s.type || 'image', createdAt: s.created_at })) });
    return result;
}

async function deleteStory(storyId) {
    const user = await getCurrentUser();
    if (!user) return;
    const { error } = await supabase.from('stories').delete().eq('id', storyId).eq('user_id', user.id);
    if (error) throw error;
}

// ========== نظام التعارف ==========
async function fetchRegisteredUsers() {
    const user = await getCurrentUser();
    if (!user) return [];
    const { data } = await supabase.from('users').select('*').neq('id', user.id).order('name');
    return (data || []).map(u => ({
        id: u.id, name: u.name, avatar: u.avatar, phone: u.phone || '',
        online: u.is_online, lastSeen: u.last_seen
    }));
}

async function searchUsers(query) {
    if (!query || query.length < 2) return [];
    const { data, error } = await supabase.from('users').select('*').or(`name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`).limit(20);
    if (error) return [];
    const currentUser = await getCurrentUser();
    return data.filter(u => u.id !== currentUser.id);
}

async function findUserByPhone(phone) {
    const cleaned = phone.replace(/[\s\-\(\)]/g, '');
    const variants = [cleaned];
    if (cleaned.startsWith('+')) variants.push(cleaned.substring(1));
    if (cleaned.startsWith('00')) variants.push('+' + cleaned.substring(2));
    const { data, error } = await supabase.from('users').select('*').in('phone', variants).limit(1);
    if (error || !data || data.length === 0) return null;
    const u = data[0];
    return { id: u.id, name: u.name, avatar: u.avatar, phone: u.phone, online: u.is_online, lastSeen: u.last_seen };
}

async function checkContactExists(contactId) {
    const user = await getCurrentUser();
    if (!user) return false;
    const { data } = await supabase.from('contacts').select('*').eq('user_id', user.id).eq('contact_id', contactId).maybeSingle();
    return !!data;
}

async function addContact(contactId) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    const { error } = await supabase.from('contacts').insert({ user_id: user.id, contact_id: contactId });
    if (error) throw error;
}

async function removeContact(contactId) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    const { error } = await supabase.from('contacts').delete().eq('user_id', user.id).eq('contact_id', contactId);
    if (error) throw error;
}

async function shareContact(contactName, contactPhone) {
    if (navigator.share) {
        try {
            await navigator.share({ title: contactName, text: `جهة اتصال: ${contactName}\nالهاتف: ${contactPhone}` });
            return true;
        } catch (err) { return false; }
    } else {
        try {
            await navigator.clipboard.writeText(`${contactName}\n${contactPhone}`);
            toast('📋 تم نسخ معلومات جهة الاتصال');
            return true;
        } catch (e) { toast('⚠️ تعذرت المشاركة'); return false; }
    }
}

async function sendFriendRequest(receiverId) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    const { data, error } = await supabase.from('friend_requests').insert({ sender_id: user.id, receiver_id: receiverId, status: 'pending' }).select().single();
    if (error) {
        if (error.code === '23505') throw new Error('طلب موجود مسبقاً');
        throw error;
    }
    return data;
}

async function acceptFriendRequest(requestId) {
    const { error } = await supabase.from('friend_requests').update({ status: 'accepted' }).eq('id', requestId);
    if (error) throw error;
}

async function rejectFriendRequest(requestId) {
    const { error } = await supabase.from('friend_requests').update({ status: 'rejected' }).eq('id', requestId);
    if (error) throw error;
}

async function getPendingReceivedRequests() {
    const user = await getCurrentUser();
    if (!user) return [];
    const { data, error } = await supabase.from('friend_requests').select('id, sender_id, created_at, users!friend_requests_sender_id_fkey(name, avatar)').eq('receiver_id', user.id).eq('status', 'pending').order('created_at', { ascending: false });
    if (error) return [];
    return data.map(r => ({ id: r.id, sender: r.users, created_at: r.created_at }));
}

async function getPendingSentRequests() {
    const user = await getCurrentUser();
    if (!user) return [];
    const { data, error } = await supabase.from('friend_requests').select('id, receiver_id, created_at, users!friend_requests_receiver_id_fkey(name, avatar)').eq('sender_id', user.id).eq('status', 'pending').order('created_at', { ascending: false });
    if (error) return [];
    return data.map(r => ({ id: r.id, receiver: r.users, created_at: r.created_at }));
}

// ========== دوال الروابط ==========
function generateChatLink(userId) {
    const baseUrl = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${baseUrl}redirect.html?id=${userId}`;
}

// ========== حذف الحساب ==========
async function deleteUserAccount() {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not logged in');
    const { error: dbError } = await supabase.from('users').delete().eq('id', user.id);
    if (dbError) throw dbError;
    await supabase.auth.signOut();
    localStorage.removeItem('ramzapp_user');
    localStorage.removeItem('ramzapp_settings');
    localStorage.removeItem('ramzapp_media_folder_granted');
    try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry('ramzapp.db');
    } catch (e) {}
    return true;
}

// ========== قائمة منبثقة ==========
function showPopupMenu(items, anchorElement) {
    const existing = document.querySelector('.ramzapp-popup-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'ramzapp-popup-menu';
    menu.style.cssText = `
        position: absolute; background: var(--surface); border-radius: 16px; min-width: 200px;
        box-shadow: var(--shadow); z-index: 5000; overflow: hidden; border: 1px solid var(--border);
        animation: slideIn 0.2s ease;
    `;
    menu.innerHTML = items.map(item => `
        <div class="popup-item${item.danger ? ' danger' : ''}" data-action="${item.label}">
            <i class="fas ${item.icon}"></i> <span>${item.label}</span>
        </div>
    `).join('');

    const anchorRect = anchorElement.getBoundingClientRect();
    menu.style.top = `${anchorRect.bottom + 4}px`;
    menu.style.left = `${anchorRect.left}px`;

    document.body.appendChild(menu);

    menu.querySelectorAll('.popup-item').forEach(el => {
        el.addEventListener('click', () => {
            const item = items.find(i => i.label === el.dataset.action);
            if (item?.action) item.action();
            menu.remove();
        });
    });

    const closeHandler = (e) => {
        if (!menu.contains(e.target) && e.target !== anchorElement) {
            menu.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

// ========== تصدير ==========
export {
    supabase,
    loadSettings, saveSettings, localSettings, applyTheme,
    timeAgo, fmtTime, fmtDate, esc, genId, toast,
    getCurrentUser, setOnlineStatus,
    signInWithEmail, signInGuest, signInWithPhone,
    uploadImage,
    fetchChats, fetchMessages, sendMessage, updateMessageStatus,
    subscribeToMessages, sendTypingEvent, onTypingEvent,
    initDatabase, fetchAndStoreMessages, getMessagesLocalFirst,
    onNewMessageRealtime, storeSentMessageLocally,
    searchChatLocally, deleteMessageLocal,
    ensureMediaFolder, saveMediaToLocalFolder, downloadAndSaveMedia,
    autoSaveSentMedia, autoSaveReceivedMedia,
    uploadStory, fetchStories, deleteStory,
    fetchRegisteredUsers, searchUsers, findUserByPhone,
    checkContactExists, addContact, removeContact, shareContact,
    sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
    getPendingReceivedRequests, getPendingSentRequests,
    generateChatLink,
    deleteUserAccount,
    showPopupMenu
};
