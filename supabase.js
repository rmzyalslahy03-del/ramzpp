// supabase.js - وسيط Supabase (اختياري)

const SUPABASE_URL = 'https://serlegwdzjulfcxabxzv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4_c97KxnG_7HTvfv-pKeNQ_FTlnK6Yx';

let _supabase = null;
if (typeof window.supabase !== 'undefined') {
    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const Supa = {
    createChatChannel(userId1, userId2) {
        if (!_supabase) return null;
        const ids = [userId1, userId2].sort();
        const channelName = `chat-${ids[0]}-${ids[1]}`;
        return _supabase.channel(channelName, {
            config: { broadcast: { self: true } }
        });
    },

    async sendBroadcast(channel, payload) {
        if (!channel) return;
        await channel.send({
            type: 'broadcast',
            event: 'message',
            payload: payload
        });
    },

    subscribeToChannel(channel, onMessage) {
        if (!channel) return;
        channel.on('broadcast', { event: 'message' }, (event) => {
            onMessage(event.payload);
        }).subscribe((status) => {
            if (status === 'SUBSCRIBED') console.log('✅ متصل بالقناة:', channel.topic);
            else if (status === 'CLOSED') console.log('🔌 انقطع الاتصال');
        });
    },

    async removeChannel(channel) {
        if (channel && _supabase) {
            await _supabase.removeChannel(channel);
        }
    },

    async uploadTemporaryFile(file) {
        if (!_supabase) throw new Error('Supabase غير متاح');
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;

        const { data: uploadData, error: uploadError } = await _supabase.storage
            .from('ramz-images')
            .upload(fileName, file, { cacheControl: '300', upsert: false });
        if (uploadError) throw uploadError;

        const { data: signedData, error: signedError } = await _supabase.storage
            .from('ramz-images')
            .createSignedUrl(fileName, 300);
        if (signedError) throw signedError;

        return {
            fileName: fileName,
            signedUrl: signedData.signedUrl
        };
    },

    async deleteFile(fileName) {
        if (!_supabase) return;
        const { error } = await _supabase.storage
            .from('ramz-images')
            .remove([fileName]);
        if (error) console.error('فشل حذف الملف:', error);
    }
};
