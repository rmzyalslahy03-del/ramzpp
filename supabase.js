const SUPABASE_URL = 'https://serlegwdzjulfcxabxzv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4_c97KxnG_7HTvfv-pKeNQ_FTlnK6Yx';

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const Supa = {
    createChatChannel(userId1, userId2) {
        const ids = [userId1, userId2].sort();
        const channelName = `chat-${ids[0]}-${ids[1]}`;
        return _supabase.channel(channelName, {
            config: { broadcast: { self: true } }
        });
    },

    async sendBroadcast(channel, payload) {
        await channel.send({
            type: 'broadcast',
            event: 'message',
            payload: payload
        });
    },

    subscribeToChannel(channel, onMessage) {
        channel.on('broadcast', { event: 'message' }, (event) => {
            onMessage(event.payload);
        }).subscribe((status) => {
            if (status === 'SUBSCRIBED') console.log('✅ متصل بالقناة:', channel.topic);
            else if (status === 'CLOSED') console.log('🔌 انقطع الاتصال');
        });
    },

    async removeChannel(channel) {
        if (channel) {
            await _supabase.removeChannel(channel);
        }
    },

    async uploadTemporaryFile(file) {
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
        const { error } = await _supabase.storage
            .from('ramz-images')
            .remove([fileName]);
        if (error) console.error('فشل حذف الملف:', error);
    }
};
