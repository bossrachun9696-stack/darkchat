// ==================== ตั้งค่า Supabase ====================
const SUPABASE_URL = 'https://ealxfgjuiwoewwxxyppu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_E3FljLn7ipcoNzfXds3T9A_o4pj4d7z';

// กุญแจสาธารณะของ Web Push (VAPID Public Key) ใส่ในหน้าเว็บได้ ไม่เป็นความลับ
const VAPID_PUBLIC_KEY = 'BER6LQz_eP4lom4aKw1ibGZosJGSxBqjIwKEt3E9AeTfP1ptzKXiyGh7kWw__ebwkN7ar34LbYT6dnEpdpIrmIg';

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
let pendingChatId = new URLSearchParams(location.search).get('chat'); // เปิดจากการแจ้งเตือน
let lastBadgeTotal = -1;

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
  if (/should be different|same as the old/i.test(msg)) return 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม';
  if (/too_many_new_chats/i.test(msg)) return 'เริ่มแชทกับคนใหม่ได้ไม่เกิน 20 คนต่อวัน';
  if (/too_many_requests/i.test(msg)) return 'ส่งคำขอเป็นเพื่อนได้ไม่เกิน 20 ครั้งต่อวัน';
  if (/row-level security/i.test(msg)) return 'ทำรายการไม่ได้ (ถ้ากำลังส่งข้อความ ผู้ใช้นี้อาจบล็อกคุณ)';
  return msg || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
}

// ถ้ายังไม่ได้รัน supabase.sql จะแจ้งให้ทราบ
function handleDbError(error) {
  const msg = (error && error.message) || '';
  if ((error && (error.code === '42P01' || error.code === '42703')) || /does not exist|schema cache|Could not find the (table|function)/i.test(msg)) {
    toast('ฐานข้อมูลยังตั้งค่าไม่ครบ กรุณารันไฟล์ supabase.sql, supabase-push.sql, supabase-phase-a.sql และ supabase-phase-b.sql ใน SQL Editor ของ Supabase', 'error');
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
      nickname: '',
      avatar: user.user_metadata?.avatar || '',
      searchId: null,
      showName: true, showAvatar: true, showEmail: false, showId: true, showOnline: true
    };
    state = { contacts: {}, messages: {} };
    social = emptySocial();
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
    await loadSocial();
    await loadInitialData();
    subscribeRealtime();
    loadChatList();
    renderSocialUI();

    // ผูกอุปกรณ์นี้กับบัญชีที่เพิ่งล็อกอิน เพื่อให้ได้รับ Push (ถ้าเคยอนุญาตไว้)
    if (pushSupported() && Notification.permission === 'granted') {
      savePushSubscription(false).catch(() => {});
    }

    // เปิดจากการกดการแจ้งเตือน -> ไปที่แชทนั้นเลย
    if (pendingChatId) {
      const id = pendingChatId;
      pendingChatId = null;
      history.replaceState(null, '', location.pathname);
      openChatById(id);
    }
  } catch (err) {
    handleDbError(err);
  } finally {
    entering = false;
  }
}

function leaveApp() {
  unsubscribeRealtime();
  hidePin();
  toggleGearMenu(false);
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden-element'));
  currentUser = null;
  activeChat = null;
  state = { contacts: {}, messages: {} };
  social = emptySocial();
  lastRead = {};
  updateBadges();
  $('main-section').classList.add('hidden-element');
  $('main-section').classList.remove('chat-open');
  $('auth-section').classList.remove('hidden-element');
}

window.addEventListener('DOMContentLoaded', async () => {
  changeTheme(localStorage.getItem('darkchat_theme') || 'purple');
  changeMode(localStorage.getItem('darkchat_mode') || 'dark');
  setupPasswordToggles();
  setupGlobalListeners();

  if (!sb) { toast('โหลด Supabase SDK ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรช', 'error'); return; }

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) startSession(session.user, false);
  } catch (err) {
    toast(thaiError(err), 'error');
  }

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && currentUser) leaveApp();
  });
});

// เริ่มใช้งานหลังยืนยันตัวตน: ยังไม่มี PIN -> ตั้ง PIN, มี PIN และเปิดแอปใหม่ -> ใส่ PIN
function startSession(user, fresh) {
  if (!hasPin(user.id)) showPin('create', user, () => enterApp(user));
  else if (fresh) enterApp(user); // เพิ่งใส่รหัสผ่านมาเอง ไม่ต้องใส่ PIN ซ้ำ
  else showPin('unlock', user, () => enterApp(user));
}

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
      startSession(data.session.user, true);
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
    startSession(data.user, true);
  } catch (err) {
    toast('เข้าสู่ระบบไม่สำเร็จ: ' + thaiError(err), 'error');
  } finally {
    setBusy(btn, false);
  }
}

async function confirmLogout() {
  toggleGearMenu(false);
  const ok = await confirmDialog(
    'ออกจากระบบ',
    'ต้องการออกจากระบบใช่หรือไม่?\nครั้งหน้าต้องเข้าสู่ระบบด้วยรหัสผ่านและตั้ง PIN ใหม่',
    'ออกจากระบบ', true
  );
  if (ok) await logoutNow();
}

async function logoutNow(userId) {
  const uid = userId || (currentUser && currentUser.id);
  if (uid) localStorage.removeItem(pinKey(uid));
  unsubscribeRealtime();
  // เลิกผูกอุปกรณ์นี้กับบัญชีเดิม จะได้ไม่ได้รับแจ้งเตือนของคนที่ออกจากระบบแล้ว
  try {
    if (pushSupported() && Notification.permission === 'granted') {
      const sub = await getPushSubscription();
      if (sub) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    }
  } catch (e) { /* ไม่เป็นไร */ }
  try { await sb.auth.signOut(); } catch (err) { console.warn(err); }
  if (currentUser) leaveApp();
}

// ==================== โปรไฟล์ ====================
const PRIVACY = {
  show_name: 'showName', show_avatar: 'showAvatar', show_email: 'showEmail',
  show_id: 'showId', show_online: 'showOnline'
};

// ชื่อที่แสดงของคนอื่น: ถ้าเขาปิดชื่อผู้ใช้ จะใช้ชื่อเล่นแทน
function nameOf(p) { return (p && (p.username || p.nickname)) || 'ผู้ใช้'; }

function applyMyProfile(d) {
  currentUser.username = d.username;
  currentUser.nickname = d.nickname || d.username;
  currentUser.avatar = d.avatar || '';
  currentUser.searchId = d.search_id || null;
  currentUser.showName = d.show_name !== false;
  currentUser.showAvatar = d.show_avatar !== false;
  currentUser.showEmail = d.show_email === true;
  currentUser.showId = d.show_id !== false;
  currentUser.showOnline = d.show_online !== false;
}

async function loadMyProfile() {
  const { data, error } = await sb.from('profiles')
    .select('username, nickname, avatar, search_id, show_name, show_avatar, show_email, show_id, show_online')
    .eq('id', currentUser.id).maybeSingle();
  if (error) throw error;

  if (data) {
    applyMyProfile(data);
  } else {
    // ยังไม่มีแถวโปรไฟล์ (เช่น สมัครก่อนรัน SQL) ให้สร้างเอง
    const name = currentUser.username.slice(0, 24);
    await sb.from('profiles').insert({ id: currentUser.id, username: name, nickname: name });
    currentUser.nickname = name;
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
  renderAvatar($('pf-avatar'), currentUser.avatar, currentUser.username);
  $('pf-username').value = currentUser.username;
  $('pf-nickname').value = currentUser.nickname || '';
  $('pf-email').textContent = currentUser.email || '';
  $('pf-show-name').checked = currentUser.showName;
  $('pf-show-email').checked = currentUser.showEmail;
  $('pf-show-id').checked = currentUser.showId;
  $('pf-show-avatar').checked = currentUser.showAvatar;
  $('pf-show-online').checked = currentUser.showOnline;
  $('st-show-online').checked = currentUser.showOnline;
  $('my-status-dot').classList.toggle('online', currentUser.showOnline);
  $('my-status-text').textContent = currentUser.showOnline ? 'ออนไลน์' : 'ซ่อนสถานะ';

  const hasId = !!currentUser.searchId;
  $('pf-id-view').textContent = hasId ? '@' + currentUser.searchId : '';
  $('pf-id-view').classList.toggle('hidden-element', !hasId);
  $('pf-id-create').classList.toggle('hidden-element', hasId);
  $('pf-id-switch').classList.toggle('hidden-element', !hasId);
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

async function saveProfileNames() {
  const username = $('pf-username').value.trim();
  const nickname = $('pf-nickname').value.trim();
  if (!username || !nickname) return toast('กรุณากรอกชื่อผู้ใช้และชื่อเล่น', 'error');

  const btn = $('save-names-btn');
  setBusy(btn, true, 'กำลังบันทึก...');
  try {
    const { error } = await sb.from('profiles').update({ username, nickname }).eq('id', currentUser.id);
    if (error) throw error;
    currentUser.username = username;
    currentUser.nickname = nickname;
    updateUserProfileUI();
    toast('บันทึกชื่อเรียบร้อย', 'success');
  } catch (err) {
    handleDbError(err);
  } finally {
    setBusy(btn, false);
  }
}

async function updatePrivacy(column, value) {
  const { error } = await sb.from('profiles').update({ [column]: value }).eq('id', currentUser.id);
  if (error) { updateUserProfileUI(); return handleDbError(error); } // คืนสวิตช์กลับค่าเดิม
  currentUser[PRIVACY[column]] = value;
  if (column === 'show_online') { applyOnlineVisibility(); updateHeaderStatus(); loadChatList(); }
  updateUserProfileUI();
}

// เปิด/ปิดการแสดงสถานะออนไลน์ให้เพื่อน
function applyOnlineVisibility() {
  if (!presenceChannel || !currentUser) return;
  if (currentUser.showOnline) presenceChannel.track({ at: new Date().toISOString() });
  else presenceChannel.untrack();
}

async function createSearchId() {
  const id = $('pf-new-id').value.trim().toLowerCase();
  if (!/^[a-z0-9_.]{4,20}$/.test(id)) {
    return toast('ID ใช้ได้เฉพาะ a-z ตัวเลข _ . ยาว 4-20 ตัวอักษร', 'error');
  }
  const ok = await confirmDialog(
    'สร้าง ID ค้นหา',
    `ID ของคุณจะเป็น @${id}\nสร้างได้ครั้งเดียว และเปลี่ยนภายหลังไม่ได้\nยืนยันหรือไม่?`,
    'ยืนยันสร้าง'
  );
  if (!ok) return;

  const { error } = await sb.from('profiles').update({ search_id: id }).eq('id', currentUser.id);
  if (error) {
    if (error.code === '23505') return toast('ID นี้มีผู้ใช้แล้ว ลองตั้งชื่ออื่น', 'error');
    if (/search_id_locked/.test(error.message)) return toast('คุณสร้าง ID ไปแล้ว เปลี่ยนไม่ได้', 'error');
    if (/invalid_search_id/.test(error.message)) return toast('รูปแบบ ID ไม่ถูกต้อง', 'error');
    return handleDbError(error);
  }
  currentUser.searchId = id;
  $('pf-new-id').value = '';
  updateUserProfileUI();
  toast('สร้าง ID เรียบร้อย', 'success');
}

// ----- รูปโปรไฟล์: แตะเพื่อเลือก "ดูรูป" หรือ "เปลี่ยนรูป" -----
function openAvatarSheet() { openModal('avatar-sheet'); }

function viewAvatar() {
  closeModal('avatar-sheet');
  const a = currentUser.avatar;
  if (a && (a.startsWith('http') || a.startsWith('data:'))) {
    $('viewer-img').src = a;
    openModal('image-viewer');
  } else {
    toast('ยังไม่มีรูปโปรไฟล์ กด "เปลี่ยนรูป" เพื่อเพิ่มรูป', 'info');
  }
}

function pickAvatar() {
  closeModal('avatar-sheet');
  $('avatar-file').click();
}

async function changeAvatar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const avatar = await resizeImage(file);
    const { error } = await sb.from('profiles').update({ avatar }).eq('id', currentUser.id);
    if (error) throw error;
    currentUser.avatar = avatar;
    updateUserProfileUI();
    toast('เปลี่ยนรูปโปรไฟล์เรียบร้อย', 'success');
  } catch (err) {
    handleDbError(err);
  } finally {
    input.value = '';
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
  const { data } = await sb.from('public_profiles').select('id, nickname, username, avatar, email, search_id').eq('id', id).maybeSingle();
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
    if (social.cleared[partner] && msg.ts <= social.cleared[partner]) return;
    ids.add(partner);
    addLocal(partner, msg);
  });

  if (ids.size) {
    const { data: profiles, error: pErr } = await sb.from('public_profiles')
      .select('id, nickname, username, avatar, email, search_id').in('id', [...ids]);
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, onFriendshipChange)
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
        showTyping(nameOf(activeChat));
        clearTimeout(typingHideTimer);
        typingHideTimer = setTimeout(hideTyping, 2500);
      }
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED' && currentUser && currentUser.showOnline) await presenceChannel.track({ at: new Date().toISOString() });
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
    if (!social.muted.has(partner)) playSound('receive');
    const viewing = activeChat && activeChat.id === partner && !document.hidden;
    if (activeChat && activeChat.id === partner) hideTyping();
    if (!viewing && !social.muted.has(partner)) {
      const who = nameOf(state.contacts[partner]);
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

  if (total !== lastBadgeTotal) {
    lastBadgeTotal = total;
    try {
      if (total > 0 && navigator.setAppBadge) navigator.setAppBadge(total).catch(() => {});
      else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    } catch (e) { /* อุปกรณ์ไม่รองรับ */ }
    // ให้ Service Worker รู้เลขจริง เพื่อบวกต่อเมื่อมี Push เข้ามาตอนปิดแอป
    try { caches.open('darkchat-meta').then(c => c.put('badge', new Response(String(total)))); } catch (e) { /* ignore */ }
  }

  const back = $('back-badge');
  if (back) {
    back.textContent = others > 99 ? '99+' : others;
    back.classList.toggle('hidden-element', others === 0);
  }
}

// ==================== Web Push (แจ้งเตือนตอนปิดแอป) ====================
function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function swReady() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Service Worker ยังไม่พร้อม ลองรีเฟรชหน้าเว็บ')), 6000))
  ]);
}

async function getPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await swReady();
  return reg.pushManager.getSubscription();
}

// บันทึกอุปกรณ์นี้ลงฐานข้อมูล (ให้เซิร์ฟเวอร์รู้ว่าต้องส่ง Push ไปที่ไหน)
async function savePushSubscription(createIfMissing) {
  const reg = await swReady();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    if (!createIfMissing) return;
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }
  const json = sub.toJSON();
  const { error } = await sb.rpc('register_push', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth
  });
  if (error) throw error;
}

async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('ยังไม่ได้อนุญาตการแจ้งเตือน ไปเปิดสิทธิ์ในการตั้งค่าของเบราว์เซอร์หรือ iPhone แล้วลองใหม่');
  }
  await savePushSubscription(true);
  toast('เปิดการแจ้งเตือนแล้ว จะได้รับข้อความแม้ปิดแอป', 'success');
}

async function disablePush() {
  const sub = await getPushSubscription();
  if (sub) {
    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
  toast('ปิดการแจ้งเตือนแล้ว', 'success');
}

async function refreshNotifyButton() {
  const sw = $('notify-switch');
  if (!sw) return;
  let on = false;
  try {
    on = pushSupported() && Notification.permission === 'granted' && !!(await getPushSubscription());
  } catch (e) { /* ไม่เป็นไร */ }
  sw.checked = on;
}

async function toggleNotifications(want) {
  if (!pushSupported()) {
    refreshNotifyButton();
    return toast('อุปกรณ์นี้ยังไม่รองรับ Push บน iPhone ต้องใช้ iOS 16.4 ขึ้นไป และเพิ่มแอปไว้ที่หน้าจอหลักก่อน (Safari > ปุ่มแชร์ > เพิ่มไปยังหน้าจอโฮม) แล้วเปิดแอปจากไอคอนนั้น', 'error');
  }
  const sw = $('notify-switch');
  sw.disabled = true;
  try {
    if (want) await enablePush();
    else await disablePush();
  } catch (err) {
    handleDbError(err);
  } finally {
    sw.disabled = false;
    refreshNotifyButton();
  }
}

async function openChatById(id) {
  if (!id || !currentUser) return;
  if (!state.contacts[id]) await fetchContact(id);
  if (state.contacts[id]) selectChat(state.contacts[id]);
}

// ==================== รายการแชท ====================
function lastMessageOf(chatId) {
  const list = state.messages[chatId] || [];
  return list[list.length - 1] || null;
}

function loadChatList(filtered = null) {
  const listEl = $('chat-list');
  listEl.innerHTML = '';
  openSwipe = null;
  updateBadges();

  const chats = (filtered || Object.values(state.contacts)).slice().sort((a, b) => {
    const ta = lastMessageOf(a.id)?.ts || 0, tb = lastMessageOf(b.id)?.ts || 0;
    return (tb - ta) || nameOf(a).localeCompare(nameOf(b));
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

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    renderAvatar(avatar, chat.avatar, nameOf(chat));

    const info = document.createElement('div');
    info.className = 'chat-item-info';

    const top = document.createElement('div');
    top.className = 'chat-item-top';
    const name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = nameOf(chat);
    if (isOnline(chat.id)) {
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

    const wrap = document.createElement('div');
    wrap.className = 'chat-item-wrap';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'swipe-del';
    del.textContent = 'ลบ';
    wrap.append(del, item);
    attachSwipe(item, del, () => selectChat(chat), () => clearChat(chat.id));
    listEl.appendChild(wrap);
  });
}

function filterChats() {
  const q = $('search-input').value.toLowerCase().trim();
  if (!q) return loadChatList();
  loadChatList(Object.values(state.contacts).filter(chat =>
    nameOf(chat).toLowerCase().includes(q) ||
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
  const { data, error } = await sb.rpc('search_profiles', { q });
  if (token !== searchToken) return; // มีการพิมพ์ใหม่แล้ว
  if (error) { setUserHint('ค้นหาไม่สำเร็จ'); return handleDbError(error); }
  if (!data || !data.length) return setUserHint('ไม่พบผู้ใช้ที่ตรงกับคำค้นหา');

  const box = $('user-search-results');
  box.innerHTML = '';
  data.forEach(p => {
    const row = document.createElement('div');
    row.className = 'user-row';

    const av = document.createElement('div');
    av.className = 'avatar';
    renderAvatar(av, p.avatar, nameOf(p));

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = nameOf(p);
    if (p.search_id) {
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = '@' + p.search_id;
      name.appendChild(sub);
    }

    const btn = document.createElement('button');
    btn.className = 'mini-btn';
    btn.textContent = state.contacts[p.id] ? 'เปิดแชท' : 'เริ่มแชท';
    btn.onclick = () => startChatWith(p);
    row.append(av, name, friendChipFor(p.id), btn);
    box.appendChild(row);
  });
}

function startChatWith(profile) {
  ['friends-modal', 'requests-modal', 'user-modal', 'person-sheet', 'blocked-modal'].forEach(closeModal);
  state.contacts[profile.id] = profile;
  saveContacts();
  toggleSearchModal(false);
  $('search-input').value = '';
  loadChatList();
  selectChat(profile);
}

// ==================== หน้าแชท ====================
function resetChatView() {
  $('friend-banner').classList.add('hidden-element');
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

// ถ้าเราปิดสถานะออนไลน์ของตัวเอง เราก็จะไม่เห็นสถานะออนไลน์ของคนอื่นด้วย
function isOnline(id) {
  return !!(currentUser && currentUser.showOnline && onlineIds.has(id));
}

function updateHeaderStatus() {
  if (!activeChat) return;
  if (!currentUser || !currentUser.showOnline) {
    $('active-chat-subtitle').textContent = '';
    return;
  }
  $('active-chat-subtitle').textContent = isOnline(activeChat.id) ? 'ออนไลน์อยู่' : 'ออฟไลน์';
}

function selectChat(chat) {
  activeChat = state.contacts[chat.id] || chat;
  markRead(activeChat.id);
  hideTyping();

  $('active-chat-title').textContent = nameOf(activeChat);
  updateHeaderStatus();
  renderAvatar($('active-chat-avatar'), activeChat.avatar, nameOf(activeChat));

  $('message-input').disabled = false;
  $('send-btn').disabled = false;
  $('message-input').placeholder = `พิมพ์ข้อความถึง ${nameOf(activeChat)}`;

  $('main-section').classList.add('chat-open');
  loadMessages();
  loadChatList();
  updateFriendBanner();
  updateComposerState();
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
  if (social.blocked.has(activeChat.id)) return toast('คุณบล็อกผู้ใช้นี้ไว้ ปลดบล็อกก่อนจึงจะส่งข้อความได้', 'error');

  const chat = activeChat;
  const seconds = parseInt($('auto-delete-timer').value, 10) || 0;
  input.value = '';
  input.focus(); // ให้คีย์บอร์ดบนมือถือยังเปิดอยู่ พิมพ์ต่อได้ทันที

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

// ==================== หน้าต่างและเมนู ====================
function openModal(id) { $(id).classList.remove('hidden-element'); }
function closeModal(id) { $(id).classList.add('hidden-element'); }

function toggleGearMenu(force) {
  const menu = $('gear-menu');
  if (!menu) return;
  const show = force !== undefined ? force : menu.classList.contains('hidden-element');
  menu.classList.toggle('hidden-element', !show);
}

function openProfile() {
  toggleGearMenu(false);
  updateUserProfileUI();
  openModal('profile-modal');
}

function openSettings() {
  toggleGearMenu(false);
  updateUserProfileUI();
  refreshNotifyButton();
  openModal('settings-modal');
}

// ----- กล่องยืนยัน -----
let confirmResolve = null;

function confirmDialog(title, message, okLabel = 'ยืนยัน', danger = false) {
  return new Promise(resolve => {
    if (confirmResolve) confirmResolve(false);
    confirmResolve = resolve;
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    const ok = $('confirm-ok');
    ok.textContent = okLabel;
    ok.classList.toggle('danger-btn', danger);
    openModal('confirm-modal');
  });
}

function answerConfirm(value) {
  closeModal('confirm-modal');
  if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(value); }
}

// ----- เปลี่ยนรหัสผ่าน (ต้องใส่รหัสเดิม + ยืนยันทุกครั้ง) -----
function openPasswordModal() {
  closeModal('settings-modal');
  ['pw-current', 'pw-new', 'pw-confirm'].forEach(id => { $(id).value = ''; });
  openModal('pw-modal');
  setTimeout(() => $('pw-current').focus(), 50);
}

async function submitPasswordChange() {
  const current = $('pw-current').value;
  const next = $('pw-new').value;
  const again = $('pw-confirm').value;

  if (!current || !next || !again) return toast('กรุณากรอกให้ครบทุกช่อง', 'error');
  if (next.length < 6) return toast('รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร', 'error');
  if (next !== again) return toast('รหัสผ่านใหม่และช่องยืนยันไม่ตรงกัน', 'error');
  if (next === current) return toast('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม', 'error');

  const ok = await confirmDialog('เปลี่ยนรหัสผ่าน', 'ยืนยันการเปลี่ยนรหัสผ่านใช่หรือไม่?', 'ยืนยัน');
  if (!ok) return;

  const btn = $('pw-submit-btn');
  setBusy(btn, true, 'กำลังเปลี่ยน...');
  try {
    // ตรวจรหัสผ่านเดิมก่อน
    const { error: authErr } = await sb.auth.signInWithPassword({ email: currentUser.email, password: current });
    if (authErr) return toast('รหัสผ่านเดิมไม่ถูกต้อง', 'error');

    const { error } = await sb.auth.updateUser({ password: next });
    if (error) throw error;

    closeModal('pw-modal');
    toast('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว', 'success');
  } catch (err) {
    toast('เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + thaiError(err), 'error');
  } finally {
    setBusy(btn, false);
  }
}

// ==================== ธีม ====================
function changeTheme(name) {
  document.body.setAttribute('data-theme', name);
  localStorage.setItem('darkchat_theme', name);
  const selector = $('theme-selector');
  if (selector) selector.value = name;
}

function changeMode(mode) {
  document.body.setAttribute('data-mode', mode);
  localStorage.setItem('darkchat_mode', mode);
  document.querySelectorAll('.mode-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.body).getPropertyValue('--bg-main').trim() || '#08080d';
}

// ==================== ปุ่มตาในช่องรหัสผ่าน ====================
const EYE_SVG =
  '<svg class="eye" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
  '<svg class="eye-off" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

function setupPasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.innerHTML = EYE_SVG;
    btn.onclick = () => {
      const input = $(btn.dataset.for);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('on', show);
      btn.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
    };
  });
}

// ==================== PIN 6 หลัก ====================
const PIN_LOCK_AFTER_MS = 30000; // ซ่อนแอปเกิน 30 วินาที ต้องใส่ PIN ใหม่
const PIN_MAX_TRIES = 5;
let pin = { mode: null, buffer: '', first: '', user: null, onDone: null, onCancel: null, tries: 0 };
let hiddenAt = 0;

function pinKey(id) { return 'darkchat_pin_' + id; }
function hasPin(id) { return !!localStorage.getItem(pinKey(id)); }
function bytesToB64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function b64ToBytes(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }
function pinIsOpen() { return !$('pin-screen').classList.contains('hidden-element'); }

// เก็บแบบเข้ารหัสแฮช (PBKDF2) ไม่เก็บ PIN จริง
async function hashPin(code, saltB64) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations: 150000, hash: 'SHA-256' }, key, 256);
  return bytesToB64(new Uint8Array(bits));
}

async function savePin(id, code) {
  const salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPin(code, salt);
  localStorage.setItem(pinKey(id), JSON.stringify({ salt, hash }));
}

async function checkPin(id, code) {
  try {
    const saved = JSON.parse(localStorage.getItem(pinKey(id)));
    return !!saved && (await hashPin(code, saved.salt)) === saved.hash;
  } catch (e) { return false; }
}

function showPin(mode, user, onDone, onCancel = null) {
  pin = { mode, buffer: '', first: '', user, onDone, onCancel, tries: 0 };
  $('pin-error').textContent = '';
  renderPin();
  $('pin-screen').classList.remove('hidden-element');
}

function hidePin() { $('pin-screen').classList.add('hidden-element'); }

function renderPin() {
  const creating = pin.mode === 'create';
  $('pin-title').textContent = creating ? (pin.first ? 'ยืนยัน PIN อีกครั้ง' : 'ตั้ง PIN 6 หลัก') : 'ใส่ PIN เพื่อเข้าใช้งาน';
  $('pin-sub').textContent = creating
    ? (pin.first ? 'ใส่ PIN เดิมซ้ำเพื่อยืนยัน' : 'ใช้ปลดล็อกแอปทุกครั้งที่เปิดใช้งาน')
    : 'ยินดีต้อนรับกลับ';
  $('pin-dots').querySelectorAll('i').forEach((dot, i) => dot.classList.toggle('on', i < pin.buffer.length));

  const sec = $('pin-secondary');
  if (pin.onCancel) { sec.textContent = 'ยกเลิก'; sec.classList.remove('hidden-element'); }
  else if (!creating) { sec.textContent = 'ลืม PIN?'; sec.classList.remove('hidden-element'); }
  else sec.classList.add('hidden-element');
}

function pinPress(digit) {
  if (!pinIsOpen() || pin.buffer.length >= 6) return;
  $('pin-error').textContent = '';
  pin.buffer += digit;
  renderPin();
  if (pin.buffer.length === 6) setTimeout(pinSubmit, 120);
}

function pinDelete() {
  if (!pinIsOpen()) return;
  pin.buffer = pin.buffer.slice(0, -1);
  renderPin();
}

function pinError(message) {
  $('pin-error').textContent = message;
  const dots = $('pin-dots');
  dots.classList.remove('shake');
  void dots.offsetWidth;
  dots.classList.add('shake');
  renderPin();
}

async function pinSubmit() {
  const code = pin.buffer;
  pin.buffer = '';
  if (!(window.crypto && crypto.subtle)) {
    renderPin();
    return toast('เบราว์เซอร์นี้ใช้ PIN ไม่ได้ (ต้องเปิดผ่าน https)', 'error');
  }

  if (pin.mode === 'create') {
    if (!pin.first) { pin.first = code; renderPin(); return; }
    if (pin.first !== code) { pin.first = ''; return pinError('PIN ไม่ตรงกัน กรุณาตั้งใหม่'); }
    await savePin(pin.user.id, code);
    const done = pin.onDone;
    hidePin();
    toast('ตั้ง PIN เรียบร้อย', 'success');
    if (done) done();
    return;
  }

  // โหมดปลดล็อก
  if (await checkPin(pin.user.id, code)) {
    const done = pin.onDone;
    hidePin();
    if (done) done();
    return;
  }
  pin.tries++;
  if (pin.tries >= PIN_MAX_TRIES) {
    const uid = pin.user.id;
    hidePin();
    toast('ใส่ PIN ผิดเกินกำหนด กรุณาเข้าสู่ระบบใหม่ด้วยรหัสผ่าน', 'error');
    return logoutNow(uid);
  }
  pinError(`PIN ไม่ถูกต้อง (เหลือ ${PIN_MAX_TRIES - pin.tries} ครั้ง)`);
}

async function pinSecondary() {
  if (pin.onCancel) { const cancel = pin.onCancel; hidePin(); cancel(); return; }
  const ok = await confirmDialog(
    'ลืม PIN',
    'ต้องออกจากระบบ แล้วเข้าสู่ระบบด้วยรหัสผ่านใหม่เพื่อตั้ง PIN ใหม่\nต้องการดำเนินการต่อหรือไม่?',
    'ออกจากระบบ', true
  );
  if (!ok) return;
  const uid = pin.user.id;
  hidePin();
  await logoutNow(uid);
}

// เปลี่ยน PIN: ใส่ PIN เดิมก่อน แล้วตั้งอันใหม่
function startChangePin() {
  closeModal('settings-modal');
  if (!hasPin(currentUser.id)) return showPin('create', currentUser, () => {});
  const user = currentUser;
  const cancel = () => {};
  showPin('unlock', user, () => showPin('create', user, () => {}, cancel), cancel);
}

// ==================== ตัวดักฟังทั่วทั้งแอป ====================
function setupGlobalListeners() {
  document.addEventListener('keydown', e => {
    if (pinIsOpen()) {
      if (/^\d$/.test(e.key)) pinPress(e.key);
      else if (e.key === 'Backspace') pinDelete();
      return;
    }
    if (e.key === 'Escape') {
      if (!$('confirm-modal').classList.contains('hidden-element')) return answerConfirm(false);
      document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden-element'));
    }
  });

  // คลิกที่อื่น = ปิดเมนูฟันเฟือง
  document.addEventListener('click', e => {
    if (!e.target.closest('#gear-wrap')) toggleGearMenu(false);
  });

  // กลับมาเปิดแอปหลังซ่อนนานเกินกำหนด ต้องใส่ PIN อีกครั้ง
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (currentUser && hiddenAt && Date.now() - hiddenAt > PIN_LOCK_AFTER_MS &&
        hasPin(currentUser.id) && !pinIsOpen()) {
      showPin('unlock', currentUser, () => { if (activeChat) markRead(activeChat.id); });
    }
    hiddenAt = 0;
    if (activeChat && !pinIsOpen()) markRead(activeChat.id);
  });
}

// ==================== เพื่อน / บล็อก / รายงาน (เฟส B1) ====================
let social = emptySocial();
let reportTarget = null;
let openSwipe = null;
let friendsToken = 0;

function emptySocial() {
  return { friendships: [], blocked: new Set(), muted: new Set(), cleared: {}, profiles: {} };
}

const FRIEND_COLS = 'id, requester_id, addressee_id, status, created_at';
const PROFILE_COLS = 'id, nickname, username, avatar, email, search_id';

async function loadSocial() {
  const [fr, bl, mu, cl] = await Promise.all([
    sb.from('friendships').select(FRIEND_COLS),
    sb.from('blocks').select('blocked_id'),
    sb.from('chat_mutes').select('partner_id'),
    sb.from('chat_clears').select('partner_id, cleared_at')
  ]);
  const err = fr.error || bl.error || mu.error || cl.error;
  if (err) throw err;
  social.friendships = fr.data || [];
  social.blocked = new Set((bl.data || []).map(r => r.blocked_id));
  social.muted = new Set((mu.data || []).map(r => r.partner_id));
  social.cleared = {};
  (cl.data || []).forEach(r => { social.cleared[r.partner_id] = new Date(r.cleared_at).getTime(); });
}

async function refreshFriendships() {
  const { data, error } = await sb.from('friendships').select(FRIEND_COLS);
  if (error) return handleDbError(error);
  social.friendships = data || [];
}

// ---------- สถานะความเป็นเพื่อน ----------
function friendInfo(id) {
  const me = currentUser.id;
  const row = social.friendships.find(f =>
    (f.requester_id === me && f.addressee_id === id) || (f.requester_id === id && f.addressee_id === me));
  if (!row) return { state: 'none' };
  if (row.status === 'accepted') return { state: 'friends', row };
  if (row.requester_id === me) return { state: 'sent', row };   // ถูกปฏิเสธก็แสดงเป็น "รอตอบรับ" (ไม่แจ้งผู้ส่ง)
  if (row.status === 'pending') return { state: 'received', row };
  return { state: 'none', row };                                // เราเคยปฏิเสธเขาไปแล้ว
}

function friendIds() {
  const me = currentUser.id;
  return social.friendships.filter(f => f.status === 'accepted')
    .map(f => (f.requester_id === me ? f.addressee_id : f.requester_id));
}
function pendingIncoming() {
  return social.friendships.filter(f => f.addressee_id === currentUser.id && f.status === 'pending');
}
function pendingOutgoing() {
  return social.friendships.filter(f => f.requester_id === currentUser.id && f.status !== 'accepted');
}

function profileOf(id) { return state.contacts[id] || social.profiles[id] || null; }

async function ensureProfiles(ids) {
  const missing = ids.filter(id => !profileOf(id));
  if (missing.length) {
    const { data } = await sb.from('public_profiles').select(PROFILE_COLS).in('id', missing);
    (data || []).forEach(p => { social.profiles[p.id] = p; });
  }
  return ids.map(profileOf).filter(Boolean);
}

// ---------- การกระทำเกี่ยวกับเพื่อน ----------
async function afterSocialChange() {
  await refreshFriendships();
  renderSocialUI();
  if (!$('search-modal').classList.contains('hidden-element')) runUserSearch();
}

async function sendFriendRequest(id) {
  const { data, error } = await sb.rpc('send_friend_request', { p_to: id });
  if (error) return handleDbError(error);
  const texts = {
    sent: 'ส่งคำขอเป็นเพื่อนแล้ว', accepted: 'เป็นเพื่อนกันแล้ว',
    already_friends: 'เป็นเพื่อนกันอยู่แล้ว', pending: 'ส่งคำขอไปแล้ว รอการตอบรับอยู่'
  };
  toast(texts[data] || 'เรียบร้อย', data === 'accepted' ? 'success' : 'info');
  await afterSocialChange();
}

async function respondRequest(id, accept) {
  const { error } = await sb.rpc('respond_friend_request', { p_from: id, p_accept: accept });
  if (error) return handleDbError(error);
  toast(accept ? 'ยอมรับคำขอเป็นเพื่อนแล้ว' : 'ปฏิเสธคำขอแล้ว', accept ? 'success' : 'info');
  await afterSocialChange();
}

async function cancelRequest(id) {
  const { error } = await sb.rpc('cancel_friend_request', { p_to: id });
  if (error) return handleDbError(error);
  toast('ยกเลิกคำขอแล้ว', 'info');
  await afterSocialChange();
}

async function removeFriendConfirm(id) {
  const ok = await confirmDialog(
    'ลบเพื่อน',
    `ต้องการลบ ${nameOf(profileOf(id))} ออกจากรายชื่อเพื่อนใช่หรือไม่?\nข้อความในแชทยังอยู่เหมือนเดิม`,
    'ลบเพื่อน', true);
  if (!ok) return;
  const { error } = await sb.rpc('remove_friend', { p_friend: id });
  if (error) return handleDbError(error);
  toast('ลบเพื่อนแล้ว', 'info');
  await afterSocialChange();
}

async function toggleMute(id) {
  const muted = social.muted.has(id);
  const { error } = muted
    ? await sb.from('chat_mutes').delete().eq('partner_id', id)
    : await sb.from('chat_mutes').insert({ partner_id: id });
  if (error) return handleDbError(error);
  if (muted) social.muted.delete(id); else social.muted.add(id);
  toast(muted ? 'เปิดเสียงแจ้งเตือนแล้ว' : 'ปิดเสียงแจ้งเตือนของแชทนี้แล้ว', 'success');
  renderSocialUI();
}

async function toggleBlock(id) {
  if (social.blocked.has(id)) {
    const { error } = await sb.from('blocks').delete().eq('blocked_id', id);
    if (error) return handleDbError(error);
    social.blocked.delete(id);
    toast('ปลดบล็อกแล้ว', 'success');
  } else {
    const ok = await confirmDialog(
      'บล็อกผู้ใช้',
      `บล็อก ${nameOf(profileOf(id))} ใช่หรือไม่?\nเขาจะส่งข้อความหาคุณและค้นหาคุณไม่ได้\nปลดบล็อกได้ในการตั้งค่า`,
      'บล็อก', true);
    if (!ok) return;
    const { error } = await sb.from('blocks').insert({ blocked_id: id });
    if (error) return handleDbError(error);
    social.blocked.add(id);
    toast('บล็อกแล้ว', 'success');
  }
  updateComposerState();
  renderSocialUI();
}

// ถ้าเราบล็อกอีกฝั่งอยู่ จะพิมพ์ส่งข้อความไม่ได้
function updateComposerState() {
  if (!activeChat) return;
  const blocked = social.blocked.has(activeChat.id);
  $('message-input').disabled = blocked;
  $('send-btn').disabled = blocked;
  $('message-input').placeholder = blocked
    ? 'คุณบล็อกผู้ใช้นี้ไว้ ปลดบล็อกเพื่อส่งข้อความ'
    : `พิมพ์ข้อความถึง ${nameOf(activeChat)}`;
}

// ---------- รายงาน ----------
function openReport(id) {
  reportTarget = id;
  $('report-reason').selectedIndex = 0;
  $('report-details').value = '';
  openModal('report-modal');
}

async function submitReport() {
  if (!reportTarget) return;
  const btn = $('report-submit-btn');
  setBusy(btn, true, 'กำลังส่ง...');
  const { error } = await sb.from('reports').insert({
    reported_id: reportTarget,
    reason: $('report-reason').value,
    details: $('report-details').value.trim() || null
  });
  setBusy(btn, false);
  if (error) return handleDbError(error);
  closeModal('report-modal');
  toast('ส่งรายงานแล้ว ขอบคุณที่แจ้ง', 'success');
}

// ---------- ตัวช่วยสร้างปุ่ม/แถว ----------
function chip(label, onClick, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip ' + cls;
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function actionBtn(label, onClick, cls = 'secondary-btn') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function hintNode(text) {
  const d = document.createElement('div');
  d.className = 'user-hint';
  d.textContent = text;
  return d;
}

function personRow(p, sub) {
  const row = document.createElement('div');
  row.className = 'user-row';
  const av = document.createElement('div');
  av.className = 'avatar';
  renderAvatar(av, p.avatar, nameOf(p));
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = nameOf(p);
  if (sub) {
    const s = document.createElement('span');
    s.className = 'sub';
    s.textContent = sub;
    name.appendChild(s);
  }
  row.append(av, name);
  return row;
}

function friendChipFor(id) {
  const info = friendInfo(id);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mini-btn ghost';
  if (info.state === 'friends') { b.textContent = 'เพื่อนแล้ว'; b.disabled = true; }
  else if (info.state === 'sent') { b.textContent = 'รอตอบรับ'; b.disabled = true; }
  else if (info.state === 'received') { b.textContent = 'ยอมรับ'; b.onclick = () => respondRequest(id, true); }
  else { b.textContent = '+ เพื่อน'; b.onclick = () => sendFriendRequest(id); }
  return b;
}

// ---------- แถบด้านบนห้องแชท (เมื่อยังไม่ได้เป็นเพื่อน) ----------
function bannerKey() { return 'darkchat_banner_off_' + currentUser.id; }
function bannerDismissed(id) {
  try { return JSON.parse(localStorage.getItem(bannerKey()) || '[]').includes(id); } catch (e) { return false; }
}
function dismissBanner(id) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(bannerKey()) || '[]'); } catch (e) { /* ignore */ }
  if (!list.includes(id)) list.push(id);
  try { localStorage.setItem(bannerKey(), JSON.stringify(list)); } catch (e) { /* ignore */ }
  updateFriendBanner();
}

function updateFriendBanner() {
  const el = $('friend-banner');
  if (!el) return;
  if (!activeChat || !currentUser || bannerDismissed(activeChat.id)) { el.classList.add('hidden-element'); return; }
  const id = activeChat.id;
  const info = friendInfo(id);
  if (info.state === 'friends') { el.classList.add('hidden-element'); return; }

  const texts = {
    none: 'ยังไม่ได้เป็นเพื่อนกัน',
    sent: 'ส่งคำขอเป็นเพื่อนแล้ว รอการตอบรับ',
    received: `${nameOf(activeChat)} ส่งคำขอเป็นเพื่อนมาหาคุณ`
  };
  el.innerHTML = '';
  const text = document.createElement('div');
  text.className = 'fb-text';
  text.textContent = texts[info.state];
  el.appendChild(text);

  if (info.state === 'none') el.appendChild(chip('เพิ่มเป็นเพื่อน', () => sendFriendRequest(id), 'primary'));
  if (info.state === 'sent') el.appendChild(chip('ยกเลิกคำขอ', () => cancelRequest(id)));
  if (info.state === 'received') {
    el.appendChild(chip('ยอมรับ', () => respondRequest(id, true), 'primary'));
    el.appendChild(chip('ปฏิเสธ', () => respondRequest(id, false)));
  }
  el.appendChild(chip('ดูโปรไฟล์', () => openUserProfile(id)));
  el.appendChild(chip(social.muted.has(id) ? 'เปิดเสียง' : 'ปิดเสียง', () => toggleMute(id)));
  el.appendChild(chip(social.blocked.has(id) ? 'ปลดบล็อก' : 'บล็อก', () => toggleBlock(id), 'danger'));
  el.appendChild(chip('รายงาน', () => openReport(id), 'danger'));
  el.appendChild(chip('✕', () => dismissBanner(id), 'close'));
  el.classList.remove('hidden-element');
}

// ---------- ดูโปรไฟล์ผู้อื่น (เห็นเฉพาะที่เจ้าของเปิดไว้) ----------
async function openUserProfile(id) {
  const { data, error } = await sb.from('public_profiles').select(PROFILE_COLS).eq('id', id).maybeSingle();
  if (error || !data) return toast('ไม่พบข้อมูลผู้ใช้', 'error');
  social.profiles[id] = data;

  renderAvatar($('um-avatar'), data.avatar, nameOf(data));
  $('um-avatar').onclick = () => {
    if (data.avatar && (data.avatar.startsWith('http') || data.avatar.startsWith('data:'))) {
      $('viewer-img').src = data.avatar;
      openModal('image-viewer');
    }
  };
  $('um-name').textContent = nameOf(data);

  const rows = [
    ['ชื่อเล่น', data.nickname],
    ['ชื่อผู้ใช้', data.username],
    ['ID', data.search_id ? '@' + data.search_id : null],
    ['อีเมล', data.email]
  ];
  const box = $('um-rows');
  box.innerHTML = '';
  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'um-row';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    if (value) v.textContent = value; else { v.textContent = 'ผู้ใช้ปิดการแสดง'; v.className = 'off'; }
    row.append(l, v);
    box.appendChild(row);
  });

  const acts = $('um-actions');
  acts.innerHTML = '';
  acts.append(
    actionBtn('ส่งข้อความ', () => openChatWith(id), 'primary-btn'),
    actionBtn('เพิ่มเติม', () => openPersonSheet(id, 'profile')),
    actionBtn('ปิด', () => closeModal('user-modal'))
  );
  openModal('user-modal');
}

async function openChatWith(id) {
  const [p] = await ensureProfiles([id]);
  if (p) startChatWith(p);
}

// ---------- เมนูตัวเลือกของคนหนึ่งคน ----------
function openPersonSheet(id, context) {
  const info = friendInfo(id);
  const p = profileOf(id);
  $('person-title').textContent = nameOf(p);
  const box = $('person-actions');
  box.innerHTML = '';
  const add = (label, fn, cls) => box.appendChild(actionBtn(label, () => { closeModal('person-sheet'); fn(); }, cls || 'secondary-btn'));

  add('ส่งข้อความ', () => openChatWith(id), 'primary-btn');
  add('ดูโปรไฟล์', () => openUserProfile(id));
  if (info.state === 'none') add('เพิ่มเป็นเพื่อน', () => sendFriendRequest(id));
  if (info.state === 'sent') add('ยกเลิกคำขอเป็นเพื่อน', () => cancelRequest(id));
  if (info.state === 'received') {
    add('ยอมรับคำขอเป็นเพื่อน', () => respondRequest(id, true));
    add('ปฏิเสธคำขอ', () => respondRequest(id, false));
  }
  add(social.muted.has(id) ? 'เปิดเสียงแจ้งเตือน' : 'ปิดเสียงแจ้งเตือน', () => toggleMute(id));
  add(social.blocked.has(id) ? 'ปลดบล็อก' : 'บล็อก', () => toggleBlock(id), 'secondary-btn danger');
  add('รายงาน', () => openReport(id), 'secondary-btn danger');
  // ลบเพื่อนได้เฉพาะจากหน้า "เพื่อนทั้งหมด"
  if (info.state === 'friends' && context === 'friends') add('ลบเพื่อน', () => removeFriendConfirm(id), 'secondary-btn danger');
  box.appendChild(actionBtn('ปิด', () => closeModal('person-sheet')));
  openModal('person-sheet');
}

// ---------- หน้าต่าง: เพื่อนทั้งหมด / คำขอ / รายชื่อบล็อก ----------
function openFriendsModal() { openModal('friends-modal'); renderFriends(); }
function openRequestsModal() { openModal('requests-modal'); renderRequests(); }
function openBlockedModal() { closeModal('settings-modal'); openModal('blocked-modal'); renderBlocked(); }

async function renderFriends() {
  const token = ++friendsToken;
  const box = $('friends-list');
  const ids = friendIds();
  $('friends-count').textContent = ids.length ? `(${ids.length})` : '';
  if (!ids.length) { box.innerHTML = ''; box.appendChild(hintNode('ยังไม่มีเพื่อน กด "+ เพิ่มเพื่อน" เพื่อค้นหา')); return; }

  const profiles = (await ensureProfiles(ids)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  if (token !== friendsToken) return;
  box.innerHTML = '';
  profiles.forEach(p => {
    const row = personRow(p, isOnline(p.id) ? 'ออนไลน์อยู่' : (p.search_id ? '@' + p.search_id : ''));
    row.classList.add('tap');
    row.onclick = () => openChatWith(p.id);
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'mini-btn ghost';
    more.textContent = '⋯';
    more.setAttribute('aria-label', 'ตัวเลือก');
    more.onclick = e => { e.stopPropagation(); openPersonSheet(p.id, 'friends'); };
    row.appendChild(more);
    box.appendChild(row);
  });
}

async function renderRequests() {
  const box = $('requests-body');
  const incoming = pendingIncoming();
  const outgoing = pendingOutgoing();
  if (!incoming.length && !outgoing.length) { box.innerHTML = ''; box.appendChild(hintNode('ไม่มีคำขอเป็นเพื่อน')); return; }

  const profs = await ensureProfiles([...incoming.map(f => f.requester_id), ...outgoing.map(f => f.addressee_id)]);
  const byId = Object.fromEntries(profs.map(p => [p.id, p]));
  box.innerHTML = '';

  const title = text => { const t = document.createElement('div'); t.className = 'list-title'; t.textContent = text; box.appendChild(t); };

  if (incoming.length) {
    title(`คำขอที่ได้รับ (${incoming.length})`);
    incoming.forEach(f => {
      const id = f.requester_id;
      const card = document.createElement('div');
      card.className = 'req-card';
      card.appendChild(personRow(byId[id] || { id }, byId[id] && byId[id].search_id ? '@' + byId[id].search_id : ''));
      const acts = document.createElement('div');
      acts.className = 'req-actions';
      acts.append(
        chip('ยอมรับ', () => respondRequest(id, true), 'primary'),
        chip('ปฏิเสธ', () => respondRequest(id, false)),
        chip('ดูโปรไฟล์', () => openUserProfile(id)),
        chip('บล็อก', () => toggleBlock(id), 'danger'),
        chip('รายงาน', () => openReport(id), 'danger')
      );
      card.appendChild(acts);
      box.appendChild(card);
    });
  }

  if (outgoing.length) {
    title(`คำขอที่ส่งไป (${outgoing.length})`);
    outgoing.forEach(f => {
      const id = f.addressee_id;
      const row = personRow(byId[id] || { id }, 'รอการตอบรับ');
      row.appendChild(chip('ยกเลิกคำขอ', () => cancelRequest(id)));
      box.appendChild(row);
    });
  }
}

async function renderBlocked() {
  const box = $('blocked-list');
  const ids = [...social.blocked];
  if (!ids.length) { box.innerHTML = ''; box.appendChild(hintNode('ยังไม่มีรายชื่อที่ถูกบล็อก')); return; }
  const profs = await ensureProfiles(ids);
  box.innerHTML = '';
  profs.forEach(p => {
    const row = personRow(p, p.search_id ? '@' + p.search_id : '');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini-btn ghost';
    b.textContent = 'ปลดบล็อก';
    b.onclick = () => toggleBlock(p.id);
    row.appendChild(b);
    box.appendChild(row);
  });
}

function updateRequestBadge() {
  const b = $('req-badge');
  if (!b) return;
  const n = currentUser ? pendingIncoming().length : 0;
  b.textContent = n > 99 ? '99+' : n;
  b.classList.toggle('hidden-element', n === 0);
}

function renderSocialUI() {
  updateRequestBadge();
  updateFriendBanner();
  if (!$('friends-modal').classList.contains('hidden-element')) renderFriends();
  if (!$('requests-modal').classList.contains('hidden-element')) renderRequests();
  if (!$('blocked-modal').classList.contains('hidden-element')) renderBlocked();
}

// คำขอเป็นเพื่อนเปลี่ยนแปลงแบบเรียลไทม์
async function onFriendshipChange(payload) {
  if (!currentUser) return;
  await refreshFriendships();
  renderSocialUI();
  const row = payload.new;
  if (!row || !row.id) return;
  try {
    if (payload.eventType === 'INSERT' && row.addressee_id === currentUser.id && row.status === 'pending') {
      const [p] = await ensureProfiles([row.requester_id]);
      toast(`${nameOf(p)} ส่งคำขอเป็นเพื่อนถึงคุณ`, 'alert');
      playSound('receive');
    } else if (payload.eventType === 'UPDATE' && row.requester_id === currentUser.id && row.status === 'accepted') {
      const [p] = await ensureProfiles([row.addressee_id]);
      toast(`${nameOf(p)} ยอมรับคำขอเป็นเพื่อนแล้ว`, 'success');
    }
  } catch (e) { /* ไม่เป็นไร */ }
}

// ---------- ลบข้อความทั้งแชท (ฝั่งตัวเอง) ด้วยการปัดซ้าย ----------
async function clearChat(id) {
  const p = profileOf(id);
  const ok = await confirmDialog(
    'ลบข้อความทั้งหมด',
    `ลบข้อความทั้งหมดในแชทกับ ${nameOf(p)}?\nลบเฉพาะฝั่งคุณ เพื่อนยังเห็นข้อความเดิม\nและยังอยู่ในรายชื่อเพื่อนของคุณ`,
    'ลบข้อความ', true);
  if (!ok) return;

  const last = lastMessageOf(id);
  const ts = Math.max(Date.now(), last ? last.ts + 1 : 0);
  const { error } = await sb.from('chat_clears').upsert(
    { user_id: currentUser.id, partner_id: id, cleared_at: new Date(ts).toISOString() },
    { onConflict: 'user_id,partner_id' });
  if (error) return handleDbError(error);

  social.cleared[id] = ts;
  if (p) social.profiles[id] = p;
  state.messages[id] = [];
  delete state.contacts[id];
  saveContacts();
  delete lastRead[id];
  saveLastRead();
  if (activeChat && activeChat.id === id) { activeChat = null; resetChatView(); backToList(); }
  loadChatList();
  toast('ลบข้อความเรียบร้อย', 'success');
}

function closeSwipe() {
  if (openSwipe) { openSwipe.style.transform = ''; openSwipe.classList.remove('swiped'); openSwipe = null; }
}

// ปัดรายการแชทไปทางซ้ายเพื่อเผยปุ่ม "ลบ" (รองรับทั้งนิ้วและเมาส์)
function attachSwipe(item, delBtn, onTap, onDelete) {
  let startX = 0, startY = 0, dx = 0, dragging = false, moved = false;

  item.addEventListener('pointerdown', e => {
    if (e.button) return;
    startX = e.clientX; startY = e.clientY; dx = 0; dragging = true; moved = false;
    if (openSwipe && openSwipe !== item) closeSwipe();
  });
  item.addEventListener('pointermove', e => {
    if (!dragging) return;
    const x = e.clientX - startX, y = e.clientY - startY;
    if (!moved && Math.abs(x) > 8 && Math.abs(x) > Math.abs(y)) {
      moved = true;
      item.setPointerCapture(e.pointerId);
      item.style.transition = 'none';
    }
    if (moved) {
      const base = item === openSwipe ? -88 : 0;
      dx = Math.max(-110, Math.min(0, base + x));
      item.style.transform = `translateX(${dx}px)`;
    }
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    item.style.transition = '';
    if (!moved) return;
    if (dx < -44) { item.style.transform = 'translateX(-88px)'; item.classList.add('swiped'); openSwipe = item; }
    else { item.style.transform = ''; item.classList.remove('swiped'); if (openSwipe === item) openSwipe = null; }
  };
  item.addEventListener('pointerup', end);
  item.addEventListener('pointercancel', end);
  item.addEventListener('click', e => {
    if (moved) { moved = false; e.preventDefault(); return; }
    if (openSwipe === item) { closeSwipe(); return; }
    onTap();
  });
  delBtn.onclick = () => { closeSwipe(); onDelete(); };
}

// ==================== Service Worker ====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW:', err));
  });
  // Service Worker ส่งข้อความมาบอกให้เปิดแชท (เมื่อกดการแจ้งเตือนตอนแอปเปิดอยู่)
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'open-chat') openChatById(e.data.chatId);
  });
}
