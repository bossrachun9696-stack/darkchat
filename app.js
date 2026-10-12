// ==================== ตั้งค่า Supabase ====================
const SUPABASE_URL = 'https://ealxfgjuiwoewwxxyppu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_E3FljLn7ipcoNzfXds3T9A_o4pj4d7z';

let sb = null;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.error('สร้าง Supabase client ไม่สำเร็จ:', err);
}

// ==================== State ====================
let currentUser = null;
let activeChat = null;
let state = { contacts: {}, messages: {} };
let onlineIds = new Set();
let msgChannel = null;
let presenceChannel = null;
let typingHideTimer = null;
let lastTypingSent = 0;
let searchTimer = null;
let searchToken = 0;
let entering = false;
let lastRead = {}; // เวลาข้อความล่าสุดที่อ่านแล้ว แยกตามแชท

// ==================== Helpers ====================
function $(id) { return document.getElementById(id); }

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('toast-stack').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.textContent = label || 'กำลังดำเนินการ...'; }
  else if (btn.dataset.label) { btn.textContent = btn.dataset.label; }
  btn.disabled = busy;
}

function thaiError(error) {
  const msg = (error && error.message) || '';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'เชื่อมต่อ Supabase ไม่ได้ ตรวจสอบอินเทอร์เน็ตและ SUPABASE_URL ใน app.js';
  if (/Invalid login credentials/i.test(msg)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (/Email not confirmed/i.test(msg)) return 'ยังไม่ได้ยืนยันอีเมล กรุณาตรวจสอบกล่องจดหมาย';
  if (/already registered|already been registered/i.test(msg)) return 'อีเมลนี้ถูกใช้สมัครแล้ว';
  if (/at least 6/i.test(msg)) return 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร';
  if (/rate limit/i.test(msg)) return 'ทำรายการบ่อยเกินไป กรุณารอสักครู่';
  return msg || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
}

// ถ้ายังไม่ได้รัน supabase.sql จะแจ้งให้ทราบ
function handleDbError(error) {
  const msg = (error && error.message) || '';
  if ((error && error.code === '42P01') || /does not exist|schema cache|Could not find the table/i.test(msg)) {
    toast('ยังไม่ได้สร้างตารางในฐานข้อมูล กรุณารันไฟล์ supabase.sql ใน SQL Editor ของ Supabase ก่อน', 'error');
  } else {
    toast(thaiError(error), 'error');
  }
}

function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function fmtListTime(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtClock(ts);
  if (d.toDateString() === new Date(now - 86400000).toDateString()) return 'เมื่อวาน';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

// ==================== เสียง ====================
let audioCtx = null;
function playSound(type) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const tones = { send: [440, 880], delete: [300, 150], receive: [880, 660] };
    const [from, to] = tones[type] || tones.send;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + 0.12);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    osc.start(t);
    osc.stop(t + 0.16);
  } catch (e) { /* ไม่มีเสียงก็ไม่เป็นไร */ }
}

// ==================== Auth ====================
async function enterApp(user) {
  if (entering) return;
  entering = true;
  try {
    currentUser = {
      id: user.id,
      email: user.email,
      username: user.user_metadata?.username || (user.email || 'user').split('@')[0],
      avatar: user.user_metadata?.avatar || ''
    };
    state = { contacts: {}, messages: {} };
    onlineIds = new Set();
    lastRead = {};

    $('auth-section').classList.add('hidden-element');
    $('main-section').classList.remove('hidden-element');
    $('main-section').classList.remove('chat-open');
    updateUserProfileUI();
    resetChatView();
    $('chat-list').innerHTML = '<div class="chat-empty">กำลังโหลดแชท...</div>';

    await loadMyProfile();
    updateUserProfileUI();
    await loadInitialData();
    subscribeRealtime();
    loadChatList();
  } catch (err) {
    handleDbError(err);
  } finally {
    entering = false;
  }
}

function leaveApp() {
  unsubscribeRealtime();
  currentUser = null;
  activeChat = null;
  state = { contacts: {}, messages: {} };
  lastRead = {};
  updateBadges();
  $('main-section').classList.add('hidden-element');
  $('main-section').classList.remove('chat-open');
  $('auth-section').classList.remove('hidden-element');
}

window.addEventListener('DOMContentLoaded', async () => {
  changeTheme(localStorage.getItem('darkchat_theme') || 'purple');

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { toggleSearchModal(false); toggleSettingsModal(false); }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeChat) markRead(activeChat.id);
  });

  if (!sb) { toast('โหลด Supabase SDK ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรช', 'error'); return; }

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) enterApp(session.user);
  } catch (err) {
    toast(thaiError(err), 'error');
  }

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && currentUser) leaveApp();
  });
});

function switchAuthTab(tab) {
  $('login-form').classList.toggle('hidden-element', tab !== 'login');
  $('register-form').classList.toggle('hidden-element', tab !== 'register');
  $('tab-login-btn').classList.toggle('active-tab', tab === 'login');
  $('tab-register-btn').classList.toggle('active-tab', tab !== 'login');
}

async function handleRegister(e) {
  e.preventDefault();
  if (!sb) return toast('ยังไม่ได้เชื่อมต่อ Supabase', 'error');

  const username = $('reg-username').value.trim();
  const email = $('reg-email').value.trim();
  const password = $('reg-password').value;
  if (!username || !email || !password) return toast('กรุณากรอกข้อมูลให้ครบ', 'error');

  const btn = $('register-btn');
  setBusy(btn, true, 'กำลังสมัคร...');
  try {
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { username, avatar: '' } }
    });
    if (error) throw error;

    if (data.session) {
      toast('สมัครสมาชิกสำเร็จ ยินดีต้อนรับ!', 'success');
      enterApp(data.session.user);
    } else {
      toast('สมัครสำเร็จ! กรุณากดลิงก์ยืนยันในอีเมลก่อนเข้าสู่ระบบ', 'success');
      $('login-email').value = email;
      switchAuthTab('login');
    }
  } catch (err) {
    toast('สมัครสมาชิกไม่สำเร็จ: ' + thaiError(err), 'error');
  } finally {
    setBusy(btn, false);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  if (!sb) return toast('ยังไม่ได้เชื่อมต่อ Supabase', 'error');

  const email = $('login-email').value.trim();
  const password = $('login-password').value;

  const btn = $('login-btn');
  setBusy(btn, true, 'กำลังเข้าสู่ระบบ...');
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    $('login-password').value = '';
    enterApp(data.user);
  } catch (err) {
    toast('เข้าสู่ระบบไม่สำเร็จ: ' + thaiError(err), 'error');
  } finally {
    setBusy(btn, false);
  }
}

async function logout() {
  unsubscribeRealtime();
  try { await sb.auth.signOut(); } catch (err) { console.warn(err); }
  if (currentUser) leaveApp();
}

// ==================== โปรไฟล์ ====================
async function loadMyProfile() {
  const { data, error } = await sb.from('profiles')
    .select('username, avatar').eq('id', currentUser.id).maybeSingle();
  if (error) throw error;

  if (data) {
    currentUser.username = data.username;
    currentUser.avatar = data.avatar || '';
  } else {
    // ยังไม่มีแถวโปรไฟล์ (เช่น สมัครก่อนรัน SQL) ให้สร้างเอง
    await sb.from('profiles').insert({
      id: currentUser.id,
      username: currentUser.username.slice(0, 24),
      avatar: currentUser.avatar && currentUser.avatar.length < 200000 ? currentUser.avatar : ''
    });
  }
}

function renderAvatar(el, avatarUrl, fallbackName) {
  if (!el) return;
  if (avatarUrl && (avatarUrl.startsWith('http') || avatarUrl.startsWith('data:'))) {
    el.style.backgroundImage = `url("${avatarUrl.replace(/"/g, '%22')}")`;
    el.textContent = '';
  } else if (avatarUrl && [...avatarUrl].length <= 4) {
    el.style.backgroundImage = 'none';
    el.textContent = avatarUrl;
  } else {
    el.style.backgroundImage = 'none';
    el.textContent = (fallbackName || 'D').charAt(0).toUpperCase();
  }
}

function updateUserProfileUI() {
  if (!currentUser) return;
  $('my-username').textContent = currentUser.username;
  renderAvatar($('my-avatar'), currentUser.avatar, currentUser.username);
  $('edit-username').value = currentUser.username;
  $('edit-avatar-url').value = currentUser.avatar && !currentUser.avatar.startsWith('data:') ? currentUser.avatar : '';
  $('edit-avatar-file').value = '';
}

function resizeImage(file, size = 160) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ไฟล์นี้ไม่ใช่รูปภาพ'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function saveProfile() {
  const newUsername = $('edit-username').value.trim();
  const file = $('edit-avatar-file').files[0];
  const textAvatar = $('edit-avatar-url').value.trim();
  if (!newUsername) return toast('กรุณากรอกชื่อผู้ใช้', 'error');

  const btn = $('save-profile-btn');
  setBusy(btn, true, 'กำลังบันทึก...');
  try {
    let avatar = currentUser.avatar;
    if (file) avatar = await resizeImage(file);
    else if (textAvatar) avatar = textAvatar;

    const { error } = await sb.from('profiles')
      .update({ username: newUsername, avatar }).eq('id', currentUser.id);
    if (error) throw error;

    // เก็บสำเนาไว้ใน metadata ของบัญชีด้วย (เฉพาะรูปที่ไม่ใหญ่เกินไป)
    await sb.auth.updateUser({
      data: { username: newUsername, avatar: avatar.length < 2000 ? avatar : '' }
    });

    currentUser.username = newUsername;
    currentUser.avatar = avatar;
    updateUserProfileUI();
    toggleSettingsModal(false);
    toast('บันทึกโปรไฟล์เรียบร้อย', 'success');
  } catch (err) {
    handleDbError(err);
  } finally {
    setBusy(btn, false);
  }
}

// ==================== โหลดข้อมูลแชท ====================
function contactsKey() { return 'darkchat_contacts_' + currentUser.id; }

function saveContacts() {
  try { localStorage.setItem(contactsKey(), JSON.stringify(Object.keys(state.contacts))); } catch (e) { /* ignore */ }
}

function toLocal(row) {
  const ts = new Date(row.created_at).getTime();
  const exp = row.expires_at ? new Date(row.expires_at).getTime() : null;
  return {
    id: row.id,
    text: row.text,
    ts,
    isMe: row.sender_id === currentUser.id,
    expiresAt: exp,
    timer: exp ? Math.round((exp - ts) / 1000) : null
  };
}

// คืนค่า true ถ้าเพิ่มสำเร็จ, false ถ้ามีข้อความนี้อยู่แล้ว
function addLocal(partnerId, msg) {
  const list = state.messages[partnerId] || (state.messages[partnerId] = []);
  if (list.some(m => m.id === msg.id)) return false;
  list.push(msg);
  list.sort((a, b) => a.ts - b.ts);
  return true;
}

async function fetchContact(id) {
  const { data } = await sb.from('profiles').select('id, username, avatar').eq('id', id).maybeSingle();
  if (data) { state.contacts[id] = data; saveContacts(); }
  return data;
}

async function loadInitialData() {
  const me = currentUser.id;

  // ลบข้อความของเราที่หมดเวลาแล้ว
  await sb.from('messages').delete().eq('sender_id', me).lte('expires_at', new Date().toISOString());

  const { data: rows, error } = await sb.from('messages')
    .select('*')
    .or(`sender_id.eq.${me},receiver_id.eq.${me}`)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) { handleDbError(error); return; }

  const now = Date.now();
  const ids = new Set();
  try { JSON.parse(localStorage.getItem(contactsKey()) || '[]').forEach(id => ids.add(id)); } catch (e) { /* ignore */ }

  rows.forEach(row => {
    const partner = row.sender_id === me ? row.receiver_id : row.sender_id;
    const msg = toLocal(row);
    if (msg.expiresAt && msg.expiresAt <= now) return;
    ids.add(partner);
    addLocal(partner, msg);
  });

  if (ids.size) {
    const { data: profiles, error: pErr } = await sb.from('profiles')
      .select('id, username, avatar').in('id', [...ids]);
    if (pErr) { handleDbError(pErr); return; }
    profiles.forEach(p => { state.contacts[p.id] = p; });
  }
  saveContacts();
  initLastRead();
}

// ==================== Realtime ====================
function subscribeRealtime() {
  unsubscribeRealtime();
  const me = currentUser.id;

  msgChannel = sb.channel('darkchat-messages-' + me)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
      payload => onIncoming(payload.new))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' },
      payload => onRemoteDelete(payload.old && payload.old.id))
    .subscribe();

  presenceChannel = sb.channel('darkchat-online', {
    config: { presence: { key: me }, broadcast: { self: false } }
  });
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      onlineIds = new Set(Object.keys(presenceChannel.presenceState()));
      onlineIds.delete(me);
      updateHeaderStatus();
      loadChatList();
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload && payload.to === me && activeChat && activeChat.id === payload.from) {
        showTyping(activeChat.username);
        clearTimeout(typingHideTimer);
        typingHideTimer = setTimeout(hideTyping, 2500);
      }
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') await presenceChannel.track({ at: new Date().toISOString() });
    });
}

function unsubscribeRealtime() {
  if (msgChannel) { sb.removeChannel(msgChannel); msgChannel = null; }
  if (presenceChannel) { sb.removeChannel(presenceChannel); presenceChannel = null; }
}

async function onIncoming(row) {
  if (!currentUser || !row) return;
  const me = currentUser.id;
  const partner = row.sender_id === me ? row.receiver_id : row.sender_id;

  if (!state.contacts[partner]) {
    await fetchContact(partner);
    if (!state.contacts[partner]) return;
  }

  const msg = toLocal(row);
  if (!addLocal(partner, msg)) return; // ซ้ำกับที่เพิ่มตอนส่งเอง

  if (!msg.isMe) {
    playSound('receive');
    const viewing = activeChat && activeChat.id === partner && !document.hidden;
    if (activeChat && activeChat.id === partner) hideTyping();
    if (!viewing) {
      const who = state.contacts[partner].username;
      toast(`ข้อความใหม่จาก ${who}: ${msg.text.slice(0, 40)}`, 'alert');
    }
  }
  if (activeChat && activeChat.id === partner) {
    loadMessages();
    if (!msg.isMe && !document.hidden) markRead(partner);
  }
  loadChatList();
}

function onRemoteDelete(id) {
  if (!id) return;
  for (const chatId in state.messages) {
    const before = state.messages[chatId].length;
    state.messages[chatId] = state.messages[chatId].filter(m => m.id !== id);
    if (state.messages[chatId].length !== before) {
      if (activeChat && activeChat.id === chatId) loadMessages();
      loadChatList();
      return;
    }
  }
}

// ลบข้อความที่หมดเวลา (ข้อความของเราจะลบจากฐานข้อมูลด้วย)
setInterval(() => {
  if (!currentUser) return;
  const now = Date.now();
  let activeChanged = false, changed = false;
  const ownIds = [];
  for (const chatId in state.messages) {
    const keep = [];
    state.messages[chatId].forEach(m => {
      if (m.expiresAt && m.expiresAt <= now) {
        changed = true;
        if (m.isMe) ownIds.push(m.id);
        if (activeChat && activeChat.id === chatId) activeChanged = true;
      } else keep.push(m);
    });
    state.messages[chatId] = keep;
  }
  if (ownIds.length) sb.from('messages').delete().in('id', ownIds).then(() => {});
  if (changed) { if (activeChanged) loadMessages(); loadChatList(); }
}, 1000);

// ==================== ข้อความที่ยังไม่ได้อ่าน (ป้ายสีแดง) ====================
function lastReadKey() { return 'darkchat_lastread_' + currentUser.id; }

function saveLastRead() {
  try { localStorage.setItem(lastReadKey(), JSON.stringify(lastRead)); } catch (e) { /* ignore */ }
}

function initLastRead() {
  let raw = null;
  try { raw = localStorage.getItem(lastReadKey()); } catch (e) { /* ignore */ }
  if (raw === null) {
    // ครั้งแรก: ถือว่าข้อความที่มีอยู่แล้วอ่านแล้ว จะได้ไม่ขึ้นเตือนทีเดียวเป็นร้อย
    lastRead = {};
    Object.keys(state.messages).forEach(id => {
      const last = lastMessageOf(id);
      if (last) lastRead[id] = last.ts;
    });
    saveLastRead();
  } else {
    try { lastRead = JSON.parse(raw) || {}; } catch (e) { lastRead = {}; }
  }
}

function unreadOf(chatId) {
  const since = lastRead[chatId] || 0;
  return (state.messages[chatId] || []).filter(m => !m.isMe && m.ts > since).length;
}

function markRead(chatId) {
  const last = lastMessageOf(chatId);
  if (!last || (lastRead[chatId] || 0) >= last.ts) return;
  lastRead[chatId] = last.ts;
  saveLastRead();
  loadChatList();
}

// อัปเดตเลขที่แท็บเบราว์เซอร์, ป้ายบนไอคอนแอป (ถ้าอุปกรณ์รองรับ) และป้ายบนปุ่มย้อนกลับ
function updateBadges() {
  let total = 0, others = 0;
  if (currentUser) {
    Object.keys(state.contacts).forEach(id => {
      const n = unreadOf(id);
      total += n;
      if (!activeChat || activeChat.id !== id) others += n;
    });
  }
  document.title = total > 0 ? `(${total > 99 ? '99+' : total}) DarkChat` : 'DarkChat';

  try {
    if (total > 0 && navigator.setAppBadge) navigator.setAppBadge(total).catch(() => {});
    else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch (e) { /* อุปกรณ์ไม่รองรับ */ }

  const back = $('back-badge');
  if (back) {
    back.textContent = others > 99 ? '99+' : others;
    back.classList.toggle('hidden-element', others === 0);
  }
}

async function enableNotifications() {
  if (!('Notification' in window)) {
    return toast('อุปกรณ์นี้ยังไม่รองรับการแจ้งเตือน (บน iPhone ต้องเพิ่มแอปไว้ที่หน้าจอหลักก่อน)', 'error');
  }
  const result = await Notification.requestPermission();
  toast(result === 'granted' ? 'เปิดการแจ้งเตือนแล้ว' : 'ยังไม่ได้อนุญาตการแจ้งเตือน',
        result === 'granted' ? 'success' : 'error');
  updateBadges();
}

// ==================== รายการแชท ====================
function lastMessageOf(chatId) {
  const list = state.messages[chatId] || [];
  return list[list.length - 1] || null;
}

function loadChatList(filtered = null) {
  const listEl = $('chat-list');
  listEl.innerHTML = '';
  updateBadges();

  const chats = (filtered || Object.values(state.contacts)).slice().sort((a, b) => {
    const ta = lastMessageOf(a.id)?.ts || 0, tb = lastMessageOf(b.id)?.ts || 0;
    return (tb - ta) || a.username.localeCompare(b.username);
  });

  if (chats.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = filtered ? 'ไม่พบห้องแชท' : 'ยังไม่มีแชท กด "ค้นหาเพื่อน" เพื่อเริ่มคุยกับคนอื่น';
    listEl.appendChild(empty);
    return;
  }

  chats.forEach(chat => {
    const last = lastMessageOf(chat.id);
    const unread = unreadOf(chat.id);

    const item = document.createElement('div');
    item.className = 'chat-item' + (activeChat?.id === chat.id ? ' active' : '');
    item.onclick = () => selectChat(chat);

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    renderAvatar(avatar, chat.avatar, chat.username);

    const info = document.createElement('div');
    info.className = 'chat-item-info';

    const top = document.createElement('div');
    top.className = 'chat-item-top';
    const name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = chat.username;
    if (onlineIds.has(chat.id)) {
      const dot = document.createElement('span');
      dot.className = 'status-dot online';
      name.appendChild(dot);
    }
    const time = document.createElement('span');
    time.className = 'chat-time';
    time.textContent = last ? fmtListTime(last.ts) : '';
    top.append(name, time);

    const bottom = document.createElement('div');
    bottom.className = 'chat-bottom';
    const preview = document.createElement('div');
    preview.className = 'chat-preview';
    preview.textContent = last ? (last.isMe ? 'คุณ: ' : '') + last.text : 'เริ่มต้นการสนทนา';
    bottom.appendChild(preview);
    if (unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'unread-badge';
      badge.textContent = unread > 99 ? '99+' : unread;
      bottom.appendChild(badge);
    }

    info.append(top, bottom);
    item.append(avatar, info);
    listEl.appendChild(item);
  });
}

function filterChats() {
  const q = $('search-input').value.toLowerCase().trim();
  if (!q) return loadChatList();
  loadChatList(Object.values(state.contacts).filter(chat =>
    chat.username.toLowerCase().includes(q) ||
    (lastMessageOf(chat.id)?.text || '').toLowerCase().includes(q)
  ));
}

// ==================== ค้นหาเพื่อน ====================
function toggleSearchModal(show) {
  $('search-modal').classList.toggle('hidden-element', !show);
  if (show) {
    $('user-search-input').value = '';
    setUserHint('พิมพ์ชื่อผู้ใช้ของเพื่อนเพื่อค้นหา');
    setTimeout(() => $('user-search-input').focus(), 50);
  }
}

function setUserHint(text) {
  const box = $('user-search-results');
  box.innerHTML = '';
  const hint = document.createElement('div');
  hint.className = 'user-hint';
  hint.textContent = text;
  box.appendChild(hint);
}

function searchUsers() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runUserSearch, 300);
}

async function runUserSearch() {
  if (!currentUser) return;
  const q = $('user-search-input').value.trim().replace(/[%_\\,()]/g, '');
  if (q.length < 2) return setUserHint('พิมพ์อย่างน้อย 2 ตัวอักษร');

  const token = ++searchToken;
  setUserHint('กำลังค้นหา...');
  const { data, error } = await sb.from('profiles')
    .select('id, username, avatar')
    .ilike('username', `%${q}%`)
    .neq('id', currentUser.id)
    .limit(20);
  if (token !== searchToken) return; // มีการพิมพ์ใหม่แล้ว
  if (error) { setUserHint('ค้นหาไม่สำเร็จ'); return handleDbError(error); }
  if (!data.length) return setUserHint('ไม่พบผู้ใช้ชื่อนี้');

  const box = $('user-search-results');
  box.innerHTML = '';
  data.forEach(p => {
    const row = document.createElement('div');
    row.className = 'user-row';
    const av = document.createElement('div');
    av.className = 'avatar';
    renderAvatar(av, p.avatar, p.username);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.username;
    const btn = document.createElement('button');
    btn.className = 'mini-btn';
    btn.textContent = state.contacts[p.id] ? 'เปิดแชท' : 'เริ่มแชท';
    btn.onclick = () => startChatWith(p);
    row.append(av, name, btn);
    box.appendChild(row);
  });
}

function startChatWith(profile) {
  state.contacts[profile.id] = profile;
  saveContacts();
  toggleSearchModal(false);
  $('search-input').value = '';
  loadChatList();
  selectChat(profile);
}

// ==================== หน้าแชท ====================
function resetChatView() {
  $('active-chat-title').textContent = 'ยินดีต้อนรับสู่ DarkChat';
  $('active-chat-subtitle').textContent = 'เลือกแชทเพื่อเริ่มสนทนา';
  renderAvatar($('active-chat-avatar'), '💬', 'D');
  $('message-input').disabled = true;
  $('send-btn').disabled = true;
  $('message-input').placeholder = 'เลือกแชทเพื่อพิมพ์ข้อความ';
  hideTyping();
  $('messages-container').innerHTML =
    '<div class="empty-state"><div class="empty-icon">💬</div><p>เลือกแชทจากรายการ<br>หรือกด "ค้นหาเพื่อน" เพื่อเริ่มคุย</p></div>';
}

function updateHeaderStatus() {
  if (!activeChat) return;
  $('active-chat-subtitle').textContent = onlineIds.has(activeChat.id) ? 'ออนไลน์อยู่' : 'ออฟไลน์';
}

function selectChat(chat) {
  activeChat = state.contacts[chat.id] || chat;
  markRead(activeChat.id);
  hideTyping();

  $('active-chat-title').textContent = activeChat.username;
  updateHeaderStatus();
  renderAvatar($('active-chat-avatar'), activeChat.avatar, activeChat.username);

  $('message-input').disabled = false;
  $('send-btn').disabled = false;
  $('message-input').placeholder = `พิมพ์ข้อความถึง ${activeChat.username}`;

  $('main-section').classList.add('chat-open');
  loadMessages();
  loadChatList();
  if (window.matchMedia('(min-width: 761px)').matches) $('message-input').focus();
}

function backToList() {
  $('main-section').classList.remove('chat-open');
}

function loadMessages() {
  const container = $('messages-container');
  container.innerHTML = '';
  if (!activeChat) return;

  const list = state.messages[activeChat.id] || [];
  if (list.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-icon">✨</div><p>ยังไม่มีข้อความ<br>ทักทายเป็นคนแรกได้เลย</p></div>';
    return;
  }

  list.forEach(msg => {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble ' + (msg.isMe ? 'sent' : 'received');

    if (msg.isMe) {
      const del = document.createElement('button');
      del.className = 'delete-msg-btn';
      del.title = 'ลบข้อความ';
      del.setAttribute('aria-label', 'ลบข้อความ');
      del.textContent = '🗑️';
      del.onclick = () => deleteMessage(msg.id);
      bubble.appendChild(del);
    }

    const text = document.createElement('span');
    text.textContent = msg.text;
    bubble.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    if (msg.timer) {
      const badge = document.createElement('span');
      badge.className = 'timer-badge';
      badge.textContent = `⏱ ${msg.timer} วิ`;
      meta.appendChild(badge);
    }
    const time = document.createElement('span');
    time.textContent = fmtClock(msg.ts);
    meta.appendChild(time);
    bubble.appendChild(meta);

    container.appendChild(bubble);
  });

  container.scrollTop = container.scrollHeight;
}

async function sendMessage(e) {
  e.preventDefault();
  const input = $('message-input');
  const text = input.value.trim();
  if (!text || !activeChat) return;

  const chat = activeChat;
  const seconds = parseInt($('auto-delete-timer').value, 10) || 0;
  input.value = '';

  const { data, error } = await sb.from('messages').insert({
    sender_id: currentUser.id,
    receiver_id: chat.id,
    text,
    expires_at: seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null
  }).select().single();

  if (error) {
    input.value = text; // ส่งไม่สำเร็จ คืนข้อความให้
    return handleDbError(error);
  }

  addLocal(chat.id, toLocal(data));
  playSound('send');
  if (activeChat && activeChat.id === chat.id) loadMessages();
  loadChatList();
}

async function deleteMessage(msgId) {
  if (!activeChat) return;
  const { error } = await sb.from('messages').delete().eq('id', msgId);
  if (error) return handleDbError(error);
  state.messages[activeChat.id] = (state.messages[activeChat.id] || []).filter(m => m.id !== msgId);
  playSound('delete');
  loadMessages();
  loadChatList();
}

// ==================== กำลังพิมพ์ ====================
function handleTyping() {
  if (!activeChat || !presenceChannel || !currentUser) return;
  const now = Date.now();
  if (now - lastTypingSent < 1500) return;
  lastTypingSent = now;
  presenceChannel.send({
    type: 'broadcast', event: 'typing',
    payload: { from: currentUser.id, to: activeChat.id }
  });
}

function showTyping(name) {
  const el = $('typing-status');
  el.innerHTML = '';
  const dots = document.createElement('span');
  dots.className = 'typing-dots';
  dots.innerHTML = '<i></i><i></i><i></i>';
  const label = document.createElement('span');
  label.textContent = `${name} กำลังพิมพ์`;
  el.append(dots, label);
  el.classList.remove('hidden-element');
}

function hideTyping() {
  clearTimeout(typingHideTimer);
  $('typing-status').classList.add('hidden-element');
}

// ==================== ตั้งค่า / ธีม ====================
function toggleSettingsModal(show) {
  $('settings-modal').classList.toggle('hidden-element', !show);
  if (show) updateUserProfileUI();
}

function changeTheme(name) {
  document.body.setAttribute('data-theme', name);
  localStorage.setItem('darkchat_theme', name);
  const selector = $('theme-selector');
  if (selector) selector.value = name;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.body).getPropertyValue('--accent-color').trim() || '#8b5cf6';
}

// ==================== Service Worker ====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW:', err));
  });
}
