// ==================== ตั้งค่า Supabase ====================
// คัดลอกค่าจาก Supabase Dashboard > Project Settings > API
// (Project URL ต้องมีรูปแบบ https://<project-ref>.supabase.co)
const SUPABASE_URL = 'https://ealxfgjuiwoewwxxyppu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_E3FljLn7ipcoNzfXds3T9A_o4pj4d7z';

// หมายเหตุ: ไม่ตั้งชื่อตัวแปรว่า "supabase" เพราะชนกับ window.supabase ของ SDK
let sb = null;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.error('สร้าง Supabase client ไม่สำเร็จ:', err);
}

// ==================== State ====================
let currentUser = null;
let activeChat = null;
let state = { chats: [], messages: {} };
let botTypingTimeout = null;

const BOT_REPLIES = [
  'ได้เลยครับ 👍',
  'น่าสนใจมากเลย เล่าต่อได้ไหม',
  'เข้าใจแล้วครับ',
  'ขอคิดดูก่อนนะ 🤔',
  'ฮ่าๆ จริงด้วย',
  'โอเค ตามนั้นเลย!',
  'เดี๋ยวทักกลับนะครับ'
];

// ==================== Helpers ====================
function $(id) { return document.getElementById(id); }

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('toast-stack').appendChild(el);
  setTimeout(() => el.remove(), 4000);
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

    const [from, to] = type === 'delete' ? [300, 150] : [440, 880];
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + 0.12);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    osc.start(t);
    osc.stop(t + 0.16);
  } catch (e) { /* ไม่มีเสียงก็ไม่เป็นไร */ }
}

// ==================== เก็บข้อมูลแชทไว้ในเครื่อง (แยกตามผู้ใช้) ====================
function storageKey() { return 'darkchat_data_' + currentUser.id; }

function seedState() {
  const now = Date.now();
  return {
    chats: [
      { id: 'user2', username: 'DarkMaster', avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=DarkMaster', online: true, bot: true },
      { id: 'user3', username: 'CyberPunk', avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=CyberPunk', online: false, bot: true }
    ],
    messages: {
      user2: [{ id: 'm1', sender: 'DarkMaster', text: 'ยินดีต้อนรับสู่ DarkChat ครับ!', ts: now - 3 * 3600000, isMe: false }],
      user3: [{ id: 'm2', sender: 'CyberPunk', text: 'พรุ่งนี้ว่างไหมครับ', ts: now - 26 * 3600000, isMe: false }]
    }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) { state = JSON.parse(raw); return; }
  } catch (e) { console.warn('อ่านข้อมูลแชทไม่ได้ ใช้ค่าเริ่มต้นแทน', e); }
  state = seedState();
  saveState();
}

function saveState() {
  try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch (e) { console.warn(e); }
}

// ลบข้อความที่หมดเวลาแล้ว (ทำงานทุกวินาที และตอนเปิดแอป)
function pruneExpired() {
  const now = Date.now();
  let changed = false, activeChanged = false;
  for (const chatId in state.messages) {
    const before = state.messages[chatId].length;
    state.messages[chatId] = state.messages[chatId].filter(m => !m.expiresAt || m.expiresAt > now);
    if (state.messages[chatId].length !== before) {
      changed = true;
      if (activeChat && activeChat.id === chatId) activeChanged = true;
    }
  }
  if (changed) {
    saveState();
    if (activeChanged) loadMessages();
    loadChatList();
  }
}
setInterval(() => { if (currentUser) pruneExpired(); }, 1000);

// ==================== Auth ====================
function enterApp(user) {
  currentUser = {
    id: user.id,
    email: user.email,
    username: user.user_metadata?.username || (user.email || 'user').split('@')[0],
    avatar: user.user_metadata?.avatar || ''
  };
  loadState();
  pruneExpired();
  updateUserProfileUI();
  $('auth-section').classList.add('hidden-element');
  $('main-section').classList.remove('hidden-element');
  loadChatList();
  resetChatView();
}

function leaveApp() {
  currentUser = null;
  activeChat = null;
  $('main-section').classList.add('hidden-element');
  $('main-section').classList.remove('chat-open');
  $('auth-section').classList.remove('hidden-element');
}

window.addEventListener('DOMContentLoaded', async () => {
  changeTheme(localStorage.getItem('darkchat_theme') || 'purple');

  // ปิด modal ด้วยปุ่ม Esc
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { toggleGroupModal(false); toggleSettingsModal(false); }
  });
  $('new-group-name').addEventListener('keydown', e => { if (e.key === 'Enter') createNewGroup(); });

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
      // โปรเจกต์เปิดให้ยืนยันอีเมลก่อนเข้าสู่ระบบ
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
  try { await sb.auth.signOut(); } catch (err) { console.warn(err); }
  if (currentUser) leaveApp();
}

// ==================== Avatar / โปรไฟล์ ====================
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

// ย่อรูปก่อนบันทึก เพื่อไม่ให้ข้อมูลโปรไฟล์ใหญ่เกินไป
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

    const { error } = await sb.auth.updateUser({ data: { username: newUsername, avatar } });
    if (error) throw error;

    currentUser.username = newUsername;
    currentUser.avatar = avatar;
    updateUserProfileUI();
    toggleSettingsModal(false);
    toast('บันทึกโปรไฟล์เรียบร้อย', 'success');
  } catch (err) {
    toast('บันทึกไม่สำเร็จ: ' + thaiError(err), 'error');
  } finally {
    setBusy(btn, false);
  }
}

// ==================== รายการแชท ====================
function lastMessageOf(chatId) {
  const list = state.messages[chatId] || [];
  return list[list.length - 1] || null;
}

function loadChatList(filtered = null) {
  const listEl = $('chat-list');
  listEl.innerHTML = '';

  const chats = (filtered || state.chats).slice().sort((a, b) => {
    const ta = lastMessageOf(a.id)?.ts || 0, tb = lastMessageOf(b.id)?.ts || 0;
    return tb - ta;
  });

  if (chats.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = 'ไม่พบห้องแชท';
    listEl.appendChild(empty);
    return;
  }

  chats.forEach(chat => {
    const last = lastMessageOf(chat.id);

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
    if (chat.online) {
      const dot = document.createElement('span');
      dot.className = 'status-dot online';
      name.appendChild(dot);
    }

    const time = document.createElement('span');
    time.className = 'chat-time';
    time.textContent = last ? fmtListTime(last.ts) : '';

    const preview = document.createElement('div');
    preview.className = 'chat-preview';
    preview.textContent = last ? last.text : 'ยังไม่มีข้อความ';

    top.append(name, time);
    info.append(top, preview);
    item.append(avatar, info);
    listEl.appendChild(item);
  });
}

function filterChats() {
  const q = $('search-input').value.toLowerCase().trim();
  if (!q) return loadChatList();
  loadChatList(state.chats.filter(chat =>
    chat.username.toLowerCase().includes(q) ||
    (lastMessageOf(chat.id)?.text || '').toLowerCase().includes(q)
  ));
}

// ==================== หน้าแชท ====================
function resetChatView() {
  $('active-chat-title').textContent = 'ยินดีต้อนรับสู่ DarkChat';
  $('active-chat-subtitle').textContent = 'เลือกแชทเพื่อเริ่มสนทนา';
  renderAvatar($('active-chat-avatar'), '💬', 'D');
  $('message-input').disabled = true;
  $('send-btn').disabled = true;
  $('message-input').placeholder = 'เลือกแชทเพื่อพิมพ์ข้อความ';
  $('typing-status').classList.add('hidden-element');
  renderEmptyState('💬', 'เลือกแชทจากรายการด้านซ้าย<br>หรือสร้างกลุ่มใหม่เพื่อเริ่มคุยได้เลย');
}

function renderEmptyState(icon, html) {
  const c = $('messages-container');
  c.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${html}</p></div>`;
}

function selectChat(chat) {
  activeChat = chat;
  clearTimeout(botTypingTimeout);
  $('typing-status').classList.add('hidden-element');

  $('active-chat-title').textContent = chat.username;
  $('active-chat-subtitle').textContent = chat.group ? 'แชทกลุ่ม' : (chat.online ? 'ออนไลน์อยู่' : 'ออฟไลน์');
  renderAvatar($('active-chat-avatar'), chat.avatar, chat.username);

  $('message-input').disabled = false;
  $('send-btn').disabled = false;
  $('message-input').placeholder = `พิมพ์ข้อความถึง ${chat.username}`;

  $('main-section').classList.add('chat-open'); // มือถือ: สลับไปหน้าแชท
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
    renderEmptyState('✨', 'ยังไม่มีข้อความ<br>ทักทายเป็นคนแรกได้เลย');
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
    } else if (activeChat.group) {
      const who = document.createElement('span');
      who.className = 'msg-sender';
      who.textContent = msg.sender;
      bubble.appendChild(who);
    }

    const text = document.createElement('span');
    text.textContent = msg.text; // textContent ป้องกัน XSS
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

function addMessage(chatId, msg) {
  if (!state.messages[chatId]) state.messages[chatId] = [];
  state.messages[chatId].push(msg);
  saveState();
}

function sendMessage(e) {
  e.preventDefault();
  const input = $('message-input');
  const text = input.value.trim();
  if (!text || !activeChat) return;

  const seconds = parseInt($('auto-delete-timer').value, 10) || 0;
  const chat = activeChat;
  const now = Date.now();

  addMessage(chat.id, {
    id: 'msg_' + now + '_' + Math.random().toString(36).slice(2, 6),
    sender: currentUser.username,
    text,
    ts: now,
    isMe: true,
    timer: seconds || null,
    expiresAt: seconds ? now + seconds * 1000 : null
  });

  input.value = '';
  playSound('send');
  loadMessages();
  loadChatList();

  if (chat.bot) scheduleBotReply(chat);
}

function scheduleBotReply(chat) {
  clearTimeout(botTypingTimeout);
  botTypingTimeout = setTimeout(() => {
    if (activeChat?.id === chat.id) showTyping(chat.username);
    botTypingTimeout = setTimeout(() => {
      addMessage(chat.id, {
        id: 'bot_' + Date.now(),
        sender: chat.username,
        text: BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)],
        ts: Date.now(),
        isMe: false
      });
      $('typing-status').classList.add('hidden-element');
      if (activeChat?.id === chat.id) loadMessages();
      loadChatList();
    }, 1200 + Math.random() * 800);
  }, 400);
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

function deleteMessage(msgId) {
  if (!activeChat || !state.messages[activeChat.id]) return;
  state.messages[activeChat.id] = state.messages[activeChat.id].filter(m => m.id !== msgId);
  saveState();
  playSound('delete');
  loadMessages();
  loadChatList();
}

// ==================== กลุ่ม ====================
function toggleGroupModal(show) {
  $('group-modal').classList.toggle('hidden-element', !show);
  if (show) { $('new-group-name').value = ''; setTimeout(() => $('new-group-name').focus(), 50); }
}

function createNewGroup() {
  const groupName = $('new-group-name').value.trim();
  if (!groupName) return toast('กรุณากรอกชื่อกลุ่ม', 'error');

  const id = 'group_' + Date.now();
  const chat = { id, username: groupName, avatar: '👥', online: false, group: true };
  state.chats.unshift(chat);
  state.messages[id] = [{
    id: 'm0_' + id, sender: 'ระบบ',
    text: `สร้างกลุ่ม "${groupName}" เรียบร้อยแล้ว`,
    ts: Date.now(), isMe: false
  }];
  saveState();

  toggleGroupModal(false);
  selectChat(chat);
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
