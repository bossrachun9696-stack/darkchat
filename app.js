// ==================== ตั้งค่า Supabase ====================
const SUPABASE_URL = 'https://ealxfgjuiwoewwxxyppu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_E3FljLn7ipcoNzfXds3T9A_o4pj4d7z';

// กุญแจสาธารณะของ Web Push (VAPID Public Key) ใส่ในหน้าเว็บได้ ไม่เป็นความลับ
const VAPID_PUBLIC_KEY = 'BER6LQz_eP4lom4aKw1ibGZosJGSxBqjIwKEt3E9AeTfP1ptzKXiyGh7kWw__ebwkN7ar34LbYT6dnEpdpIrmIg';

const RECOVERY_LINK = /type=recovery/.test(location.hash);

let sb = null;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.error('สร้าง Supabase client ไม่สำเร็จ:', err);
}

// ==================== State ====================
let currentUser = null;
let activeChat = null;
let state = { contacts: {}, messages: {}, groups: {} };
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
  if (/secret_no_key_partner/i.test(msg)) return 'เพื่อนยังไม่ได้เปิดแอปเวอร์ชันใหม่ จึงยังเปิดห้องลับไม่ได้ (ให้เพื่อนเปิดแอปเวอร์ชันล่าสุดก่อน)';
  if (/secret_no_key_me/i.test(msg)) return 'เครื่องนี้ยังไม่มีกุญแจเข้ารหัส ปิดแล้วเปิดแอปใหม่อีกครั้ง';
  if (/secret_required/i.test(msg)) return 'ห้องลับต้องส่งแบบเข้ารหัสเท่านั้น (ลองเปิดแอปใหม่)';
  if (/secret_no_edit/i.test(msg)) return 'แก้ไขข้อความในห้องลับไม่ได้';
  if (/secret_no_cards|secret_no_schedule/i.test(msg)) return 'ห้องลับยังใช้ฟีเจอร์นี้ไม่ได้ (โพลล์ นัดหมาย ตำแหน่ง ตั้งเวลาส่ง)';
  if (/call_full/i.test(msg)) return 'สายนี้เต็มแล้ว (สูงสุด 6 คน)';
  if (/call_ended/i.test(msg)) return 'สายนี้สิ้นสุดแล้ว';
  if (/invalid_live/i.test(msg)) return 'ระยะเวลาแชร์ตำแหน่งสดไม่ถูกต้อง';
  if (/too_many_live/i.test(msg)) return 'แชร์ตำแหน่งสดพร้อมกันได้ไม่เกิน 3 รายการ';
  if (/invalid_poll/i.test(msg)) return 'โพลล์ต้องมีคำถามและตัวเลือกอย่างน้อย 2 ข้อ';
  if (/invalid_event/i.test(msg)) return 'ข้อมูลนัดหมายไม่ถูกต้อง ตรวจสอบชื่อและวันเวลา';
  if (/invalid_location/i.test(msg)) return 'ตำแหน่งที่ตั้งไม่ถูกต้อง';
  if (/invalid_time/i.test(msg)) return 'เวลาที่ตั้งต้องเป็นอนาคต (อย่างน้อย 1 นาที)';
  if (/too_many_reminders/i.test(msg)) return 'ตั้งเตือนได้ไม่เกิน 50 รายการ';
  if (/too_many_scheduled/i.test(msg)) return 'ตั้งเวลาส่งข้อความได้ไม่เกิน 20 รายการ';
  if (/alias_taken/i.test(msg)) return 'ชื่อนี้มีคนใช้ในกลุ่มแล้ว ลองชื่ออื่น';
  if (/media_missing|invalid_media/i.test(msg)) return 'ไฟล์แนบไม่ถูกต้อง ลองส่งใหม่';
  if (/exceeded the maximum|too large|payload/i.test(msg)) return 'ไฟล์ใหญ่เกินกำหนด';
  if (/forbidden_mention_all/i.test(msg)) return 'แท็กทุกคนได้เฉพาะเจ้าของและผู้ดูแลกลุ่ม';
  if (/invalid_mention/i.test(msg)) return 'แท็กได้เฉพาะสมาชิกที่อยู่ในกลุ่ม';
  if (/too_many_mentions/i.test(msg)) return 'แท็กได้ไม่เกิน 20 คนต่อข้อความ';
  if (/cannot_edit/i.test(msg)) return 'แก้ไขไม่ได้แล้ว (แก้ไขได้ภายใน 15 นาทีหลังส่ง)';
  if (/too_many_pins/i.test(msg)) return 'ปักหมุดได้ไม่เกิน 5 ข้อความต่อห้อง';
  if (/cannot_pin_timed/i.test(msg)) return 'ปักหมุดข้อความที่ตั้งเวลาลบไม่ได้';
  if (/too_many_groups/i.test(msg)) return 'สร้างกลุ่มได้ไม่เกิน 10 กลุ่มต่อวัน';
  if (/not_found/i.test(msg)) return 'ไม่พบคำขอนี้ (อาจมีผู้ดูแลคนอื่นจัดการไปแล้ว)';
  if (/group_full/i.test(msg)) return 'กลุ่มนี้เต็มแล้ว';
  if (/not_public/i.test(msg)) return 'กลุ่มนี้ไม่ได้เปิดเป็นกลุ่มสาธารณะ';
  if (/too_many_requests/i.test(msg)) return 'ส่งคำขอเป็นเพื่อนได้ไม่เกิน 20 ครั้งต่อวัน';
  if (/row-level security/i.test(msg)) return 'ทำรายการไม่ได้ (ถ้ากำลังส่งข้อความ ผู้ใช้นี้อาจบล็อกคุณ)';
  return msg || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
}

// ถ้ายังไม่ได้รัน supabase.sql จะแจ้งให้ทราบ
function handleDbError(error) {
  const msg = (error && error.message) || '';
  if ((error && (error.code === '42P01' || error.code === '42703')) || /does not exist|schema cache|Could not find the (table|function)/i.test(msg)) {
    toast('ฐานข้อมูลยังตั้งค่าไม่ครบ กรุณารันไฟล์ supabase.sql, supabase-push.sql, supabase-phase-a.sql, supabase-phase-b.sql, supabase-phase-b2.sql, supabase-phase-b3.sql, supabase-phase-c.sql, supabase-phase-d1.sql, supabase-phase-d2.sql, supabase-phase-d3.sql, supabase-phase-e.sql และ supabase-phase-d4.sql ใน SQL Editor ของ Supabase', 'error');
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
      showName: true, showAvatar: true, showEmail: false, showId: true, showOnline: true,
      dnd: { enabled: false, start: 1320, end: 420 }, hidePush: false, tzOffset: 420
    };
    state = { contacts: {}, messages: {}, groups: {} };
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
    try { localStorage.setItem('darkchat_who_' + currentUser.id, JSON.stringify({ name: currentUser.username, avatar: currentUser.avatar || '' })); } catch (e) { /* ไม่เป็นไร */ }
    resumeLiveShares();
    hydrateRoomPrefs();
    registerThisDevice();
    e2eeInit();
    loadSecretRooms().then(() => loadChatList());
    checkRingingCalls();
    await loadSocial();
    await loadGroups();
    await loadInitialData();
    subscribeRealtime();
    loadChatList();
    renderSocialUI();
    touchLastSeen();
    clearInterval(seenTimer);
    seenTimer = setInterval(touchLastSeen, 120000);

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
  clearInterval(seenTimer);
  unsubscribeRealtime();
  hidePin();
  toggleGearMenu(false);
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden-element'));
  currentUser = null;
  activeChat = null;
  state = { contacts: {}, messages: {}, groups: {} };
  social = emptySocial();
  lastRead = {};
  updateBadges();
  $('main-section').classList.add('hidden-element');
  $('main-section').classList.remove('chat-open');
  $('auth-section').classList.remove('hidden-element');
}

window.addEventListener('DOMContentLoaded', async () => {
  changeTheme(localStorage.getItem('darkchat_theme') || 'purple');
  applyGlassColors();
  renderGlassPresets();
  changeMode(localStorage.getItem('darkchat_mode_v2') || 'glass');
  setupPasswordToggles();
  setupGlobalListeners();

  if (!sb) { toast('โหลด Supabase SDK ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรช', 'error'); return; }

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session && RECOVERY_LINK) openRecovery();
    else if (session) startSession(session.user, false);
  } catch (err) {
    toast(thaiError(err), 'error');
  }

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && currentUser) leaveApp();
    if (event === 'PASSWORD_RECOVERY') openRecovery();
  });
});

// เริ่มใช้งานหลังยืนยันตัวตน: ยังไม่มี PIN -> ตั้ง PIN, มี PIN และเปิดแอปใหม่ -> ใส่ PIN
function startSession(user, fresh) {
  if (!pinEnabled(user.id)) return enterApp(user); // ผู้ใช้ปิดการล็อกด้วย PIN
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
  if (CALL.session) { try { await endCall(); } catch (e) { /* ไม่เป็นไร */ } }
  const uid = userId || (currentUser && currentUser.id);
  if (uid) { localStorage.removeItem(pinKey(uid)); localStorage.removeItem('darkchat_draft_' + uid); }
  stopAllLiveLocal();
  unsubscribeRealtime();
  // เลิกผูกอุปกรณ์นี้กับบัญชีเดิม จะได้ไม่ได้รับแจ้งเตือนของคนที่ออกจากระบบแล้ว
  try {
    if (pushSupported() && Notification.permission === 'granted') {
      const sub = await getPushSubscription();
      if (sub) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    }
  } catch (e) { /* ไม่เป็นไร */ }
  try { await sb.from('devices').delete().eq('device_key', deviceKey()); } catch (e) { /* ไม่เป็นไร */ }
  try { await sb.auth.signOut({ scope: 'local' }); } catch (err) { console.warn(err); }
  if (currentUser) leaveApp();
}

// ==================== โปรไฟล์ ====================
const PRIVACY = {
  show_name: 'showName', show_avatar: 'showAvatar', show_email: 'showEmail',
  show_id: 'showId', show_online: 'showOnline'
};

// ชื่อที่แสดงของคนอื่น: ถ้าเขาปิดชื่อผู้ใช้ จะใช้ชื่อเล่นแทน
function nameOf(p) {
  if (p && p.isGroup) return p.name;
  return (p && (p.username || p.nickname)) || 'ผู้ใช้';
}

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
  currentUser.dnd = {
    enabled: d.dnd_enabled === true,
    start: d.dnd_start == null ? 1320 : d.dnd_start,
    end: d.dnd_end == null ? 420 : d.dnd_end
  };
  currentUser.hidePush = d.hide_push_content === true;
  currentUser.tzOffset = d.tz_offset == null ? 420 : d.tz_offset;
}

async function loadMyProfile() {
  const { data, error } = await sb.from('profiles')
    .select('username, nickname, avatar, search_id, show_name, show_avatar, show_email, show_id, show_online, dnd_enabled, dnd_start, dnd_end, tz_offset, hide_push_content')
    .eq('id', currentUser.id).maybeSingle();
  if (error) throw error;

  if (data) {
    applyMyProfile(data);
    migrateOwnAvatar();
    // เขตเวลาเปลี่ยน (เช่น เดินทาง) ให้ปรับเพื่อให้ห้ามรบกวนตรงเวลา
    const tz = -new Date().getTimezoneOffset();
    if (data.tz_offset !== tz) sb.from('profiles').update({ tz_offset: tz }).eq('id', currentUser.id).then(() => {}, () => {});
  } else {
    // ยังไม่มีแถวโปรไฟล์ (เช่น สมัครก่อนรัน SQL) ให้สร้างเอง
    const name = currentUser.username.slice(0, 24);
    await sb.from('profiles').insert({ id: currentUser.id, username: name, nickname: name });
    currentUser.nickname = name;
  }
}

function avatarColor(name) {
  let h = 0;
  for (const c of String(name || '?')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 62% 42%)`;
}

function renderAvatar(el, avatarUrl, fallbackName) {
  if (!el) return;
  if (avatarUrl && (avatarUrl.startsWith('http') || avatarUrl.startsWith('data:'))) {
    el.style.backgroundImage = `url("${avatarUrl.replace(/"/g, '%22')}")`;
    el.style.backgroundColor = '';
    el.textContent = '';
  } else if (avatarUrl && [...avatarUrl].length <= 4) {
    el.style.backgroundImage = 'none';
    el.style.backgroundColor = 'color-mix(in srgb, var(--accent-color) 22%, var(--bg-solid))';
    el.textContent = avatarUrl;
  } else {
    el.style.backgroundImage = 'none';
    el.style.backgroundColor = avatarColor(fallbackName);
    el.textContent = (fallbackName || 'D').charAt(0).toUpperCase();
  }
}

// สีของสมาชิกแต่ละคนในกลุ่ม: กระจายสีให้ต่างกันชัด (ตามลำดับสมาชิก) และปรับความสว่างตามธีม
function memberHue(chat, uid) {
  const ids = ((chat && chat.members) || []).map(m => m.user_id).sort();
  let i = ids.indexOf(uid);
  if (i < 0) { i = 0; for (const c of String(uid)) i += c.charCodeAt(0); }
  return Math.round((i * 137.508) % 360);
}
function memberColor(chat, uid) {
  const light = document.body.getAttribute('data-mode') === 'light';
  return light ? `hsl(${memberHue(chat, uid)} 75% 32%)` : `hsl(${memberHue(chat, uid)} 90% 74%)`;
}
function memberFill(chat, uid) { return `hsl(${memberHue(chat, uid)} 62% 40%)`; }

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
  $('st-pin-lock').checked = pinEnabled(currentUser.id);
  $('st-idle').value = String(idleSeconds());
  $('dnd-enabled').checked = currentUser.dnd.enabled;
  $('dnd-start').value = minutesToTime(currentUser.dnd.start);
  $('dnd-end').value = minutesToTime(currentUser.dnd.end);
  $('hide-push').checked = currentUser.hidePush;
  $('my-status-dot').classList.toggle('online', currentUser.showOnline);
  $('my-status-text').textContent = currentUser.showOnline ? 'ออนไลน์' : 'ซ่อนสถานะ';

  const hasId = !!currentUser.searchId;
  $('pf-id-view').textContent = hasId ? '@' + currentUser.searchId : '';
  $('pf-id-view').classList.toggle('hidden-element', !hasId);
  $('pf-id-copy').classList.toggle('hidden-element', !hasId);
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
    const old = currentUser.avatar;
    const avatar = await uploadAvatarImage(file, 256, 'p');
    const { error } = await sb.from('profiles').update({ avatar }).eq('id', currentUser.id);
    if (error) throw error;
    currentUser.avatar = avatar;
    updateUserProfileUI();
    removeOldAvatar(old);
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
    senderId: row.sender_id,
    kind: row.kind || 'text',
    readAt: row.read_at ? new Date(row.read_at).getTime() : null,
    status: 'sent',
    replyTo: row.reply_to || null,
    editedAt: row.edited_at ? new Date(row.edited_at).getTime() : null,
    pinnedAt: row.pinned_at ? new Date(row.pinned_at).getTime() : null,
    mentions: (row.meta && Array.isArray(row.meta.mentions)) ? row.meta.mentions : [],
    mentionAll: !!(row.meta && row.meta.all),
    expiresAt: exp,
    ttl: row.ttl_seconds || null,
    fwd: !!(row.meta && row.meta.fwd),
    media: row.media || null,
    batch: (row.meta && row.meta.batch) || null,
    rmeta: row.meta || null,
    sticker: (row.meta && row.meta.sticker) || null,
    enc: row.enc || null,
    encFrom: row.sender_id,
    encTo: row.receiver_id,
    batchN: (row.meta && row.meta.n) || null,
    timer: row.ttl_seconds || (exp ? Math.round((exp - ts) / 1000) : null)
  };
}

// คืนค่า true ถ้าเพิ่มสำเร็จ, false ถ้ามีข้อความนี้อยู่แล้ว
function addLocal(partnerId, msg) {
  const list = state.messages[partnerId] || (state.messages[partnerId] = []);
  if (list.some(m => m.id === msg.id)) return false;
  list.push(msg);
  list.sort((a, b) => a.ts - b.ts);
  if (msg.enc && !msg.dec) queueDecrypt(partnerId, msg);
  if (typeof watchChatUpdated === 'function') watchChatUpdated(partnerId, msg);
  return true;
}

async function fetchContact(id) {
  const { data } = await sb.from('public_profiles').select('id, nickname, username, avatar, email, search_id, last_seen_at').eq('id', id).maybeSingle();
  if (data) { state.contacts[id] = data; saveContacts(); }
  return data;
}

async function loadInitialData() {
  const me = currentUser.id;

  // ลบข้อความของเราที่หมดเวลาแล้ว
  await sb.from('messages').delete().eq('sender_id', me).lte('expires_at', new Date().toISOString());

  const { data: rows, error } = await sb.from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) { handleDbError(error); return; }
  state.historyAll = rows.length < 500; // ถ้าได้น้อยกว่า 500 แปลว่าโหลดประวัติครบแล้ว

  const now = Date.now();
  const ids = new Set();
  const senderIds = new Set();
  try { JSON.parse(localStorage.getItem(contactsKey()) || '[]').forEach(id => ids.add(id)); } catch (e) { /* ignore */ }

  rows.forEach(row => {
    const isGroupMsg = !!row.group_id;
    const partner = isGroupMsg ? row.group_id : (row.sender_id === me ? row.receiver_id : row.sender_id);
    const msg = toLocal(row);
    if (msg.expiresAt && msg.expiresAt <= now) return;
    if (social.cleared[partner] && msg.ts <= social.cleared[partner]) return;
    if (isGroupMsg) {
      if (!state.groups[partner]) return;
      if (row.sender_id !== me && !state.groups[partner].anonymous) senderIds.add(row.sender_id);
      addLocal(partner, msg);
      return;
    }
    ids.add(partner);
    addLocal(partner, msg);
  });

  if (ids.size) {
    const { data: profiles, error: pErr } = await sb.from('public_profiles')
      .select('id, nickname, username, avatar, email, search_id, last_seen_at').in('id', [...ids]);
    if (pErr) { handleDbError(pErr); return; }
    profiles.forEach(p => { state.contacts[p.id] = p; });
  }
  if (senderIds.size) await ensureProfiles([...senderIds]);
  ensureSavedChat();
  saveContacts();
  initLastRead();
}

// ==================== Realtime ====================
function subscribeRealtime() {
  unsubscribeRealtime();
  const me = currentUser.id;

  const gen = rtGen;
  // ช่องหลัก: ข้อความ เพื่อน กลุ่ม (ต้องไม่ถูกตารางเสริมที่ยังไม่ได้สร้างมาทำให้พัง)
  msgChannel = sb.channel('darkchat-messages-' + me + '-' + gen)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
      payload => onIncoming(payload.new))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' },
      payload => onRemoteDelete(payload.old && payload.old.id))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => onMessageUpdate(payload.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, onFriendshipChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, onGroupChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, onGroupChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_invites' }, onGroupInvite)
    .subscribe(status => onCoreStatus(status, gen));

  // ตารางเสริม: แยกคนละช่อง ถ้าตารางไหนยังไม่มี (ยังไม่ได้รัน SQL ของเฟสนั้น) ช่องนั้นจะถูกปิดไป ไม่กระทบข้อความ
  RT_EXTRAS.forEach(def => {
    const ch = sb.channel(`darkchat-x-${def.table}-${me}-${gen}`);
    def.events.forEach(([event, fn]) => ch.on('postgres_changes', { event, schema: 'public', table: def.table }, payload => fn(payload)));
    ch.subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { try { sb.removeChannel(ch); } catch (e) { /* ไม่เป็นไร */ } }
    });
    extraChannels.push(ch);
  });

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
      if (!payload || !activeChat) return;
      let who = null;
      if (payload.to === me && activeChat.id === payload.from) who = nameOf(activeChat);
      else if (state.groups[payload.to] && activeChat.id === payload.to && payload.from !== me && !social.blocked.has(payload.from)) {
        who = groupSenderName(state.groups[payload.to], payload.from);
      }
      if (who) {
        showTyping(who);
        clearTimeout(typingHideTimer);
        typingHideTimer = setTimeout(hideTyping, 2500);
      }
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED' && currentUser && currentUser.showOnline) await presenceChannel.track({ at: new Date().toISOString() });
    });
}

function unsubscribeRealtime() {
  rtGen++;                       // ทำให้ callback ของช่องเก่าไม่มีผลอีก
  clearTimeout(rtRetryTimer);
  if (msgChannel) { sb.removeChannel(msgChannel); msgChannel = null; }
  extraChannels.forEach(ch => { try { sb.removeChannel(ch); } catch (e) { /* ไม่เป็นไร */ } });
  extraChannels = [];
  if (presenceChannel) { sb.removeChannel(presenceChannel); presenceChannel = null; }
}

// ---------- ความเสถียรของ Realtime: ต่อใหม่เอง + ดึงข้อความที่ตกหล่นมาเติม ----------
let rtGen = 0;
let rtRetry = 0;
let rtRetryTimer = null;
let extraChannels = [];
let lastCatchUp = 0;
let catchingUp = false;

const RT_EXTRAS = [
  { table: 'group_aliases', events: [['*', p => onGroupChange(p)]] },
  { table: 'poll_votes', events: [['*', p => onCardChange(p)]] },
  { table: 'event_rsvps', events: [['*', p => onCardChange(p)]] },
  { table: 'live_locations', events: [['*', p => onLiveChange(p)]] },
  { table: 'devices', events: [['UPDATE', p => onDeviceChange(p)]] },
  { table: 'calls', events: [['*', p => onCallChange(p)]] },
  { table: 'call_streams', events: [['INSERT', p => onStreamChange(p)], ['DELETE', p => onStreamChange(p)]] },
  { table: 'message_reactions', events: [['*', p => onReactionChange(p)]] },
  { table: 'secret_rooms', events: [['*', p => onSecretChange(p)]] }
];

function onCoreStatus(status, gen) {
  if (gen !== rtGen || !currentUser) return;
  if (status === 'SUBSCRIBED') {
    rtRetry = 0;
    catchUp(true);               // ช่วงก่อนเชื่อมต่อติด อาจมีข้อความหลุดไป ดึงมาเติมทุกครั้งที่เชื่อมต่อใหม่
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    clearTimeout(rtRetryTimer);
    const wait = Math.min(30000, 2000 * Math.pow(2, rtRetry++));
    rtRetryTimer = setTimeout(() => { if (currentUser && gen === rtGen) subscribeRealtime(); }, wait);
  }
}

function latestMessageTs() {
  let t = 0;
  for (const k in state.messages) {
    for (const m of state.messages[k]) if (!String(m.id).startsWith('tmp_') && m.ts > t) t = m.ts;
  }
  return t;
}

// full = ดึง 150 ข้อความล่าสุดมาเทียบ (เติมที่ขาด อัปเดตที่แก้/อ่านแล้ว และลบที่หายไปจากเซิร์ฟเวอร์) / ไม่ full = ดึงเฉพาะที่ใหม่กว่าที่มีอยู่
async function catchUp(full) {
  if (!currentUser || catchingUp) return;
  catchingUp = true;
  lastCatchUp = Date.now();
  const me = currentUser.id;
  try {
    if (full) {
      const { data, error } = await sb.from('messages').select('*').order('created_at', { ascending: false }).limit(150);
      if (error || !data) return;
      const seen = new Set(data.map(r => r.id));
      for (const row of data.slice().reverse()) {
        const partner = row.group_id || (row.sender_id === me ? row.receiver_id : row.sender_id);
        const exists = (state.messages[partner] || []).some(m => m.id === row.id);
        if (exists) onMessageUpdate(row); else await onIncoming(row, true);
      }
      const oldest = data.length >= 150 ? new Date(data[data.length - 1].created_at).getTime() : 0;
      for (const chatId in state.messages) {
        state.messages[chatId]
          .filter(m => !String(m.id).startsWith('tmp_') && m.status === 'sent' && m.ts >= oldest && !seen.has(m.id))
          .forEach(m => onRemoteDelete(m.id));   // ถูกลบไปตอนที่เราไม่ได้เชื่อมต่อ
      }
    } else {
      const since = new Date(Math.max(0, latestMessageTs() - 3000)).toISOString();
      const { data, error } = await sb.from('messages').select('*').gt('created_at', since)
        .order('created_at', { ascending: true }).limit(100);
      if (error || !data) return;
      for (const row of data) await onIncoming(row, true);
    }
  } catch (e) { /* ลองใหม่รอบหน้า */ }
  finally { catchingUp = false; }
}

// ตาข่ายนิรภัย: ถ้าช่องเรียลไทม์ไม่พร้อม ตรวจข้อความใหม่ทุก 15 วินาที (ถ้าพร้อมแล้วตรวจแบบเบาๆ ทุก 2 นาที)
function startRealtimeWatchdog() {
  setInterval(() => {
    if (!currentUser || document.hidden) return;
    const joined = !!msgChannel && msgChannel.state === 'joined';
    if (!joined && Date.now() - lastCatchUp > 14000) catchUp(false);
    else if (joined && Date.now() - lastCatchUp > 120000) catchUp(false);
  }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && currentUser) catchUp(true); });
  window.addEventListener('online', () => { if (currentUser) { subscribeRealtime(); catchUp(true); } });
}

async function onIncoming(row, silent) {
  if (!currentUser || !row) return;
  const me = currentUser.id;
  const partner = row.group_id || (row.sender_id === me ? row.receiver_id : row.sender_id);

  if (row.group_id) {
    if (!state.groups[partner]) {
      try { await loadGroups(); } catch (e) { return; }
      if (!state.groups[partner]) return;
    }
    if (row.sender_id !== me && !state.groups[partner].anonymous) await ensureProfiles([row.sender_id]);
  } else if (!state.contacts[partner]) {
    await fetchContact(partner);
    if (!state.contacts[partner]) return;
  }

  const msg = toLocal(row);
  if (msg.expiresAt && msg.expiresAt <= Date.now()) return;                        // หมดเวลาแล้ว
  if (social.cleared[partner] && msg.ts <= social.cleared[partner]) return;        // แชทนี้ล้างไปแล้ว ไม่ดึงข้อความเก่ากลับมา
  if (!addLocal(partner, msg)) return; // ซ้ำกับที่เพิ่มตอนส่งเอง
  if (msg.kind === 'reminder') {
    if (!silent && !dndActive()) playSound('receive');
    if (!silent) toast(msg.text, 'alert');
    loadChatList();
    if (activeChat && activeChat.id === partner) loadMessages();
    return;
  }

  if (!msg.isMe && msg.kind !== 'system') {
    const mentioned = !!row.group_id && iAmMentioned(msg);
    const quiet = !!silent || dndActive() || (isMuted(partner) && !mentioned);
    if (!quiet) playSound('receive');
    const viewing = activeChat && activeChat.id === partner && !document.hidden;
    if (activeChat && activeChat.id === partner) hideTyping();
    if (!viewing && !quiet) {
      const chatName = nameOf(state.contacts[partner] || state.groups[partner]);
      const who = row.group_id ? `${chatName} (${groupSenderName(state.groups[partner], row.sender_id)})` : chatName;
      toast(mentioned ? `${who} แท็กคุณ: ${msg.text.slice(0, 40)}` : `ข้อความใหม่จาก ${who}: ${msg.text.slice(0, 40)}`, 'alert');
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
  const mediaGone = [];
  for (const chatId in state.messages) {
    const keep = [];
    state.messages[chatId].forEach(m => {
      if (m.expiresAt && m.expiresAt <= now) {
        changed = true;
        if (m.isMe && !String(m.id).startsWith('tmp_')) { ownIds.push(m.id); if (m.media) mediaGone.push(m.media); }
        if (activeChat && activeChat.id === chatId) activeChanged = true;
      } else keep.push(m);
    });
    state.messages[chatId] = keep;
  }
  if (ownIds.length) sb.from('messages').delete().in('id', ownIds).then(() => {});
  mediaGone.forEach(removeMediaFiles);
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
  return (state.messages[chatId] || []).filter(m => !m.isMe && m.kind !== 'system' && !social.blocked.has(m.senderId) && m.ts > since).length;
}

function markRead(chatId) {
  const last = lastMessageOf(chatId);
  if (!last || (lastRead[chatId] || 0) >= last.ts) return;
  lastRead[chatId] = last.ts;
  saveLastRead();
  if (state.groups[chatId]) sb.rpc('mark_group_read', { p_group: chatId }).then(() => {}, () => {});
  else if (chatId !== currentUser.id) sb.rpc('mark_read', { p_partner: chatId }).then(() => {}, () => {});
  loadChatList();
}

// อัปเดตเลขที่แท็บเบราว์เซอร์, ป้ายบนไอคอนแอป (ถ้าอุปกรณ์รองรับ) และป้ายบนปุ่มย้อนกลับ
function updateBadges() {
  let total = 0, others = 0;
  if (currentUser) {
    [...Object.keys(state.contacts), ...Object.keys(state.groups || {})].forEach(id => {
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
  if (state.groups[id]) { selectChat(state.groups[id]); return; }
  if (!state.contacts[id]) await fetchContact(id);
  if (state.contacts[id]) selectChat(state.contacts[id]);
}

// ==================== รายการแชท ====================
function lastMessageOf(chatId) {
  const list = state.messages[chatId] || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (!social.hidden.has(list[i].id)) return list[i];
  }
  return null;
}

function loadChatList(filtered = null) {
  const listEl = $('chat-list');
  listEl.innerHTML = '';
  openSwipe = null;
  updateBadges();

  const chats = (filtered || allChats()).slice().sort((a, b) => {
    const ta = lastMessageOf(a.id)?.ts || 0, tb = lastMessageOf(b.id)?.ts || 0;
    const pa = social.pinnedChats.has(a.id) ? 1 : 0, pb = social.pinnedChats.has(b.id) ? 1 : 0;
    return ((b.isSaved ? 1 : 0) - (a.isSaved ? 1 : 0)) || (pb - pa) || (tb - ta) || nameOf(a).localeCompare(nameOf(b));
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
    item.className = 'chat-item' + (chat.isGroup ? ' group' : '') + (activeChat?.id === chat.id ? ' active' : '');

    const avatar = document.createElement('div');
    avatar.className = 'avatar' + (chat.isGroup ? ' group-av' : '');
    renderAvatar(avatar, chat.avatar, nameOf(chat));

    const info = document.createElement('div');
    info.className = 'chat-item-info';

    const top = document.createElement('div');
    top.className = 'chat-item-top';
    const name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = nameOf(chat) + (social.pinnedChats.has(chat.id) ? ' 📌' : '') + (isSecret(chat.id) ? ' 🔒' : '');
    if (chat.isGroup) {
      const tag = document.createElement('span');
      tag.className = 'tag-group';
      tag.textContent = 'กลุ่ม';
      name.appendChild(tag);
      if (chat.anonymous) {
        const anon = document.createElement('span');
        anon.className = 'tag-group tag-anon';
        anon.textContent = 'ไม่แสดงตัวตน';
        name.appendChild(anon);
      }
    }
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
    const dr = (!activeChat || activeChat.id !== chat.id) ? draftOf(chat.id) : null;
    if (dr && !isRoomLocked(chat.id)) {
      const tag = document.createElement('span');
      tag.className = 'draft-tag';
      tag.textContent = 'ร่าง: ';
      preview.append(tag, document.createTextNode(dr.text.replace(/\s+/g, ' ').slice(0, 60)));
    } else {
      preview.textContent = previewText(chat, last);
    }
    bottom.appendChild(preview);
    if (chat.isGroup && mentionUnread(chat.id) > 0) {
      const at = document.createElement('span');
      at.className = 'mention-badge';
      at.textContent = '@';
      at.title = 'มีคนแท็กคุณ';
      bottom.appendChild(at);
    }
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
    const prof = document.createElement('button');
    prof.type = 'button';
    prof.className = 'swipe-prof';
    prof.textContent = chat.isGroup ? 'ข้อมูล' : 'โปรไฟล์';
    wrap.append(prof, del, item);
    attachSwipe(item, del, prof,
      () => selectChat(chat),
      () => clearChat(chat.id),
      () => (chat.isGroup ? openGroupInfo(chat.id) : openUserProfile(chat.id)),
      () => peekChat(chat));
    listEl.appendChild(wrap);
  });
}

function filterChats() {
  const q = $('search-input').value.toLowerCase().trim();
  if (!q) return loadChatList();
  loadChatList(allChats().filter(chat =>
    nameOf(chat).toLowerCase().includes(q) ||
    (lastMessageOf(chat.id)?.text || '').toLowerCase().includes(q)
  ));
}

// ==================== ค้นหาเพื่อน ====================
function toggleSearchModal(show) {
  $('search-modal').classList.toggle('hidden-element', !show);
  if (show) {
    $('user-search-input').value = '';
    setSearchTab('users');
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
  if (searchTab === 'groups') return runGroupSearch();
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
  ['friends-modal', 'requests-modal', 'user-modal', 'person-sheet', 'blocked-modal', 'ginfo-modal', 'group-modal'].forEach(closeModal);
  state.contacts[profile.id] = profile;
  saveContacts();
  toggleSearchModal(false);
  $('search-input').value = '';
  loadChatList();
  selectChat(profile);
}

// ==================== หน้าแชท ====================
function resetChatView() {
  updateCallBanner();
  applySecretUI(null);
  $('plus-btn').disabled = true;
  $('sticker-btn').disabled = true;
  closeStickerPanel();
  $('mic-btn').disabled = true;
  leaveSelectModeQuiet();
  closeAttachMenu();
  updateTtlChip();
  applyRoomStyle();
  $('friend-banner').classList.add('hidden-element');
  $('chat-area').classList.remove('group-mode');
  $('scroll-down-btn').classList.add('hidden-element');
  $('pin-bar').classList.add('hidden-element');
  clearComposerMode();
  clearTags();
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
  if (activeChat.isSaved) { $('active-chat-subtitle').textContent = 'โน้ตส่วนตัวของคุณ'; return; }
  if (activeChat.isGroup) {
    $('active-chat-subtitle').textContent = `สมาชิก ${activeChat.members.length} คน`;
    return;
  }
  if (!currentUser || !currentUser.showOnline) {
    $('active-chat-subtitle').textContent = '';
    return;
  }
  if (isOnline(activeChat.id)) $('active-chat-subtitle').textContent = 'ออนไลน์อยู่';
  else if (activeChat.last_seen_at) $('active-chat-subtitle').textContent = `ใช้งานเมื่อ ${agoText(activeChat.last_seen_at)}`;
  else $('active-chat-subtitle').textContent = 'ออฟไลน์';
}

function selectChat(chat) {
  const target = state.contacts[chat.id] || state.groups[chat.id] || chat;
  if (isRoomLocked(target.id) && !unlockedRooms.has(target.id)) return promptRoomUnlock(target);
  if (activeChat && activeChat.id !== target.id) unlockedRooms.delete(activeChat.id);
  saveDraftNow();
  activeChat = target;
  markRead(activeChat.id);
  hideTyping();

  $('active-chat-title').textContent = nameOf(activeChat);
  updateHeaderStatus();
  renderAvatar($('active-chat-avatar'), activeChat.avatar, nameOf(activeChat));
  $('chat-area').classList.toggle('group-mode', !!activeChat.isGroup);

  $('message-input').disabled = false;
  $('send-btn').disabled = false;
  $('message-input').placeholder = composerPlaceholder();

  $('main-section').classList.add('chat-open');
  loadMessages();
  loadChatList();
  updateFriendBanner();
  updateComposerState();
  clearComposerMode();
  clearTags();
  restoreDraft(activeChat);
  $('plus-btn').disabled = false;
  $('sticker-btn').disabled = false;
  closeStickerPanel();
  $('mic-btn').disabled = false;
  leaveSelectModeQuiet();
  closeAttachMenu();
  applyRoomStyle();
  loadTtlFor(activeChat.id);
  loadPins(activeChat);
  loadCards(activeChat);
  loadLive(activeChat);
  loadOpenCall(activeChat);
  applySecretUI(activeChat);
  loadReactions(activeChat);
  refreshLastSeen(activeChat);
  if (window.matchMedia('(min-width: 761px)').matches) $('message-input').focus();
}

function backToList() {
  if (activeChat) unlockedRooms.delete(activeChat.id);
  // กลับหน้ารายการแชท = ออกจากห้องนั้นจริงๆ (ไม่งั้นแอปคิดว่ายังเปิดห้องอยู่ แล้วนับข้อความใหม่เป็น "อ่านแล้ว")
  $('main-section').classList.remove('chat-open');
  saveDraftNow();
  activeChat = null;
  resetChatView();
  loadChatList();
}

// ==================== เฟส D1: หน้าตาแชท เมนูข้อความ ตอบกลับ แก้ไข ปักหมุด แอบดู ====================
const composer = { type: null, msg: null };   // type: 'reply' | 'edit' | null
let pinsToken = 0;
let seenTimer = null;

function snippetOf(m) {
  const t = (m && msgLabel(m)) || '';
  return t.length > 80 ? t.slice(0, 80) + '…' : t;
}

function senderLabel(chat, m) {
  if (m.isMe) return 'คุณ';
  return chat.isGroup ? groupSenderName(chat, m.senderId) : nameOf(chat);
}

// ป้ายเวลากลางจอ เช่น "08:43", "จันทร์ 08:43"
function dividerLabel(ts) {
  const d = new Date(ts), now = new Date();
  const hm = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return hm;
  if (d.toDateString() === new Date(now - 86400000).toDateString()) return 'เมื่อวาน ' + hm;
  if (now - d < 6 * 86400000) return d.toLocaleDateString('th-TH', { weekday: 'long' }) + ' ' + hm;
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + hm;
}

function agoText(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'เมื่อสักครู่';
  if (s < 3600) return `${Math.floor(s / 60)} นาที ที่แล้ว`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชม. ที่แล้ว`;
  return `${Math.floor(s / 86400)} วัน ที่แล้ว`;
}

function visibleMessages(chat) {
  return (state.messages[chat.id] || []).filter(m =>
    !social.hidden.has(m.id) && !(chat.isGroup && !m.isMe && social.blocked.has(m.senderId)));
}

// ---------- ข้อความที่ถูกตอบ (เก็บแค่รหัส ถ้าถูกลบจะขึ้นว่าถูกลบแล้ว) ----------
function findMessage(id) {
  for (const k in state.messages) {
    const m = state.messages[k].find(x => x.id === id);
    if (m) return m;
  }
  for (const k in (state.pins || {})) {
    const m = state.pins[k].find(x => x.id === id);
    if (m) return m;
  }
  return null;
}

function resolveRef(id) {
  const m = findMessage(id);
  if (m) return m;
  state.refs = state.refs || {};
  if (state.refs[id] === undefined) { state.refs[id] = 'loading'; fetchRef(id); }
  return state.refs[id]; // 'loading' | false (ถูกลบ) | ข้อความ
}

async function fetchRef(id) {
  const { data } = await sb.from('messages').select('*').eq('id', id).maybeSingle();
  state.refs[id] = data ? toLocal(data) : false;
  if (activeChat) loadMessages(true);
}

function buildReplyRef(msg) {
  const ref = document.createElement('div');
  ref.className = 'reply-ref';
  const r = resolveRef(msg.replyTo);
  const name = document.createElement('strong');
  const txt = document.createElement('span');
  if (r && r !== 'loading') {
    name.textContent = senderLabel(activeChat, r);
    txt.textContent = snippetOf(r);
    ref.onclick = e => { e.stopPropagation(); scrollToMessage(r.id); };
  } else {
    name.textContent = 'ข้อความเดิม';
    txt.textContent = r === 'loading' ? 'กำลังโหลด…' : 'ข้อความถูกลบแล้ว';
  }
  ref.append(name, txt);
  return ref;
}

function scrollToMessage(id) {
  const el = [...$('messages-container').children].find(c => c.dataset && c.dataset.id === id);
  if (!el) return toast('ข้อความนี้อยู่ไกลขึ้นไป เลื่อนขึ้นเพื่อโหลดข้อความเก่าก่อน', 'info');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// ---------- แสดงข้อความ (สไตล์แอปแชททั่วไป: รูปคู่สนทนา ป้ายเวลากลางจอ) ----------
function loadMessages(keepScroll) {
  const container = $('messages-container');
  const prevTop = container.scrollTop;
  container.innerHTML = '';
  if (!activeChat) return;
  updatePinBar();

  const list = groupAlbums(visibleMessages(activeChat));
  if (list.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-icon">✨</div><p>ยังไม่มีข้อความ<br>ทักทายเป็นคนแรกได้เลย</p></div>';
    return;
  }

  if (!isHistoryDone(activeChat.id)) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'load-older';
    more.textContent = 'โหลดข้อความเก่ากว่านี้';
    more.onclick = () => loadOlder(activeChat, true);
    container.appendChild(more);
  }

  const GAP = 30 * 60 * 1000;
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  let prev = null;
  const lastOwn = [...list].reverse().find(m => m.isMe && m.status === 'sent');
  const lastOwnId = lastOwn ? lastOwn.id : null;

  list.forEach((msg, i) => {
    if (!prev || msg.ts - prev.ts > GAP || !sameDay(msg.ts, prev.ts)) {
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      divider.textContent = dividerLabel(msg.ts);
      container.appendChild(divider);
    }
    prev = msg;

    if (msg.kind === 'call') {
      const cm = document.createElement('div');
      cm.className = 'call-msg';
      const ct = document.createElement('span');
      ct.textContent = msg.text;
      cm.appendChild(ct);
      const cmeta = msg.rmeta || {};
      const openCall = activeChat && CALL.open[activeChat.id];
      const live = !!openCall && openCall.id === cmeta.call;
      cm.appendChild(chip(live ? 'เข้าร่วม' : 'โทรอีกครั้ง',
        () => (live ? joinCall(cmeta.call, activeChat, cmeta.kind || 'audio') : startCall(cmeta.kind || 'audio')),
        live ? 'primary' : ''));
      container.appendChild(cm);
      return;
    }
    if (msg.kind === 'reminder') {
      const rm = document.createElement('div');
      rm.className = 'reminder-msg';
      rm.textContent = msg.text;
      rm.onclick = () => { const cid = msg.rmeta && msg.rmeta.chat; if (cid && cid !== (activeChat && activeChat.id)) openChatById(cid); };
      container.appendChild(rm);
      return;
    }
    if (msg.kind === 'system') {
      const sys = document.createElement('div');
      sys.className = 'system-msg';
      sys.textContent = msg.text;
      container.appendChild(sys);
      return;
    }

    const next = list[i + 1];
    const endOfRun = !next || next.kind === 'system' || next.isMe !== msg.isMe ||
      next.senderId !== msg.senderId || next.ts - msg.ts > GAP || !sameDay(msg.ts, next.ts);

    const row = document.createElement('div');
    row.className = 'msg-row ' + (msg.isMe ? 'sent' : 'received');
    row.dataset.id = msg.id;
    row.dataset.ids = msg.album ? msg.album.map(a => a.id).join(',') : msg.id;

    if (!msg.isMe) {
      const av = document.createElement('div');
      av.className = 'avatar msg-avatar' + (endOfRun ? '' : ' spacer');
      if (endOfRun) {
        if (activeChat.isGroup) {
          const p = activeChat.anonymous ? null : profileOf(msg.senderId);
          renderAvatar(av, p && p.avatar, groupSenderName(activeChat, msg.senderId));
          if (!(p && p.avatar)) av.style.backgroundColor = memberFill(activeChat, msg.senderId);
        } else {
          renderAvatar(av, activeChat.avatar, nameOf(activeChat));
        }
      }
      row.appendChild(av);
    }

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble ' + (msg.isMe ? 'sent' : 'received') + (msg.status === 'failed' ? ' failed' : '');

    if (!msg.isMe && activeChat.isGroup) {
      const who = document.createElement('span');
      who.className = 'msg-sender';
      who.textContent = groupSenderName(activeChat, msg.senderId);
      who.style.color = memberColor(activeChat, msg.senderId);
      bubble.appendChild(who);
    }

    if (msg.replyTo) bubble.appendChild(buildReplyRef(msg));

    if (activeChat.isGroup && (msg.mentionAll || (msg.mentions && msg.mentions.length))) {
      const line = document.createElement('div');
      line.className = 'mention-line';
      line.textContent = msg.mentionAll
        ? 'แท็ก @ทุกคน'
        : 'แท็ก ' + msg.mentions.map(id => '@' + (id === currentUser.id ? 'คุณ' : groupSenderName(activeChat, id))).join(' ');
      bubble.appendChild(line);
      if (iAmMentioned(msg)) bubble.classList.add('mention-me');
    }

    if (msg.fwd) {
      const fl = document.createElement('div');
      fl.className = 'fwd-line';
      fl.textContent = '↪ ส่งต่อ';
      bubble.appendChild(fl);
    }
    if (msg.media) bubble.appendChild(buildMediaEl(msg));
    if (msg.kind === 'card') bubble.appendChild(buildCardEl(msg));
    if (msg.sticker) bubble.appendChild(buildStickerEl(msg));
    if (msg.text && msg.kind !== 'card' && !msg.sticker) {
      const text = document.createElement('span');
      linkify(text, msg.text);
      bubble.appendChild(text);
    }

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    if (msg.pinnedAt) { const pin = document.createElement('span'); pin.textContent = '📌'; meta.appendChild(pin); }
    if (msg.timer) {
      const badge = document.createElement('span');
      badge.className = 'timer-badge';
      badge.textContent = (msg.ttl && !msg.expiresAt) ? `⏱ ลบ ${fmtDuration(msg.timer)} หลังอ่าน` : `⏱ ${fmtDuration(msg.timer)}`;
      meta.appendChild(badge);
    }
    if (msg.editedAt) { const ed = document.createElement('span'); ed.textContent = 'แก้ไขแล้ว'; meta.appendChild(ed); }
    const time = document.createElement('span');
    time.textContent = fmtClock(msg.ts);
    meta.appendChild(time);
    if (msg.isMe) {
      const st = document.createElement('span');
      st.className = 'msg-status ' + (msg.status || 'sent');
      if (msg.status === 'sending') st.textContent = 'กำลังส่ง…';
      else if (msg.status === 'failed') st.textContent = 'ส่งไม่สำเร็จ';
      else if (activeChat.isSaved) st.textContent = '✓';
      else if (activeChat.isGroup) {
        const n = (msg.id === lastOwnId) ? groupReaders(activeChat, msg).length : 0;
        st.textContent = n > 0 ? `✓ อ่านแล้ว ${n}` : '✓';
        if (n > 0) {
          st.classList.add('read');
          st.addEventListener('pointerdown', e => e.stopPropagation());
          st.onclick = e => { e.stopPropagation(); openReaders(msg); };
        }
      }
      else { st.textContent = msg.readAt ? '✓✓' : '✓'; if (msg.readAt) st.classList.add('read'); }
      meta.appendChild(st);
    }
    bubble.appendChild(meta);
    const rx = buildReactions(msg);
    if (rx) bubble.appendChild(rx);

    if (msg.status === 'failed') {
      const retry = document.createElement('div');
      retry.className = 'retry-row';
      retry.append(
        chip('ส่งใหม่', () => retryMsg(msg), 'primary'),
        chip('ลบ', () => (msg.album ? msg.album.forEach(a => deleteMessage(a.id)) : deleteMessage(msg.id)))
      );
      bubble.appendChild(retry);
    }

    row.appendChild(bubble);
    container.appendChild(row);
    if (!sel.on) attachMessageGestures(row, bubble, msg);
  });

  if (sel.on) decorateSelect(container);
  container.scrollTop = keepScroll ? prevTop : container.scrollHeight;
}

// กดค้างที่ข้อความ = เมนู, ปัดเข้าหาตรงกลาง = ตอบกลับ
function attachMessageGestures(row, bubble, msg) {
  const dir = msg.isMe ? -1 : 1;
  let sx = 0, sy = 0, dx = 0, timer = null, dragging = false, swiping = false, opened = false;

  bubble.addEventListener('pointerdown', e => {
    if (e.button) return;
    sx = e.clientX; sy = e.clientY; dx = 0; dragging = true; swiping = false; opened = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      opened = true; dragging = false;
      if (navigator.vibrate) navigator.vibrate(12);
      openMsgMenu(msg);
    }, 450);
  });
  bubble.addEventListener('pointermove', e => {
    if (!dragging) return;
    const x = e.clientX - sx, y = e.clientY - sy;
    if (!swiping && (Math.abs(x) > 8 || Math.abs(y) > 8)) {
      clearTimeout(timer);
      if (Math.abs(x) > Math.abs(y) && x * dir > 0) {
        swiping = true;
        bubble.setPointerCapture(e.pointerId);
        bubble.style.transition = 'none';
        row.classList.add('swiping');
      } else { dragging = false; return; }
    }
    if (swiping) {
      dx = Math.max(0, Math.min(80, x * dir));
      bubble.style.transform = `translateX(${dx * dir}px)`;
      row.classList.toggle('reply-ready', dx >= 56);
    }
  });
  const end = () => {
    clearTimeout(timer);
    if (swiping) {
      bubble.style.transition = '';
      bubble.style.transform = '';
      if (dx >= 56) { if (navigator.vibrate) navigator.vibrate(10); startReply(msg); }
      row.classList.remove('swiping', 'reply-ready');
    }
    dragging = false; swiping = false;
  };
  bubble.addEventListener('pointerup', end);
  bubble.addEventListener('pointercancel', end);
  bubble.addEventListener('contextmenu', e => { e.preventDefault(); clearTimeout(timer); if (!opened) openMsgMenu(msg); });
}

// ---------- เมนูกดค้างที่ข้อความ ----------
function msgCanUnsend(m) {
  if (!m.isMe || m.status !== 'sent' || (m.kind !== 'text' && m.kind !== 'card')) return false;
  if (activeChat.isGroup) return Date.now() - m.ts < 5 * 60 * 1000;
  return !m.readAt; // เพื่อนยังไม่ได้อ่าน
}
function msgCanEdit(m) {
  return m.isMe && m.status === 'sent' && m.kind === 'text' && !m.media && !m.sticker && Date.now() - m.ts < 15 * 60 * 1000;
}
function canPin(m) {
  if (!activeChat || m.kind !== 'text' || m.status !== 'sent' || m.ttl) return false;
  if (activeChat.isGroup) return activeChat.role === 'owner' || activeChat.role === 'admin';
  return true;
}

function openMsgMenu(msg) {
  if (!activeChat) return;
  if (msg.album) return openAlbumMenu(msg);
  $('msg-menu-preview').textContent = snippetOf(msg);
  const emojis = $('msg-menu-emoji');
  emojis.innerHTML = '';
  if (msg.status === 'sent') {
    REACTIONS.forEach(e => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emoji-btn' + (myReaction(msg.id) === e ? ' mine' : '');
      b.textContent = e;
      b.onclick = () => { closeModal('msg-menu'); reactTo(msg, e); };
      emojis.appendChild(b);
    });
  }
  emojis.classList.toggle('hidden-element', msg.status !== 'sent');

  const box = $('msg-menu-actions');
  box.innerHTML = '';
  const add = (label, fn, cls) => box.appendChild(actionBtn(label, () => { closeModal('msg-menu'); fn(); }, cls || 'secondary-btn'));

  if (msg.status === 'sent') add('ตอบกลับ', () => startReply(msg), 'primary-btn');
  if (msg.text && !msg.sticker) add('คัดลอก', () => copyText(msg.text));
  if (msg.media && !msg.media.expired && !msg.media.pending) {
    add(msg.media.type === 'file' ? 'ดาวน์โหลดไฟล์' : 'บันทึกลงเครื่อง', () => saveMedia(msg.media), 'primary-btn');
  }
  if (msg.status === 'sent' && msg.kind !== 'card' && !(msg.media && (msg.media.expired || msg.media.pending))) add('ส่งต่อ', () => openForward(msg));
  if (msg.status === 'sent') add('เตือนฉัน', () => openRemind(msg));
  if (msg.status === 'sent' && !activeChat.isSaved) add('บันทึกข้อความ', () => saveToNotes(msg));
  if (msgCanUnsend(msg)) add('ยกเลิกการส่ง', () => unsendMessage(msg), 'secondary-btn danger');
  if (msgCanEdit(msg)) add('แก้ไข', () => startEdit(msg));
  if (canPin(msg)) add(msg.pinnedAt ? 'เลิกปักหมุด' : 'ปักหมุด', () => togglePin(msg));
  add('ลบ', () => enterSelectMode([msg.id]), 'secondary-btn danger');
  // ห้องลับ: ไม่ให้ส่งต่อ/เตือน/บันทึกลงแชทตัวเอง/แก้ไข/ปักหมุด เพราะจะทำให้เนื้อหาขึ้นไปอยู่บนเซิร์ฟเวอร์แบบอ่านออก
  if (isSecret(activeChat.id)) [...box.children].forEach(b => { if (/^(แก้ไข|ส่งต่อ|ปักหมุด|เลิกปักหมุด|เตือนฉัน|บันทึกข้อความ)$/.test(b.textContent.trim())) b.remove(); });
  box.appendChild(actionBtn('ปิด', () => closeModal('msg-menu')));
  openModal('msg-menu');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) { /* ไม่เป็นไร */ }
    ta.remove();
  }
  toast('คัดลอกแล้ว', 'success');
}

function copyMyId() { if (currentUser && currentUser.searchId) copyText(currentUser.searchId); }

async function unsendMessage(m) {
  const ok = await confirmDialog('ยกเลิกการส่ง', 'ยกเลิกการส่งข้อความนี้?\nข้อความจะถูกลบออกจากแชทของทุกคน', 'ยกเลิกการส่ง', true);
  if (ok) deleteMessage(m.id);
}

// ลบเฉพาะฝั่งเรา (อีกฝั่งยังเห็น)
async function hideForMe(m) {
  if (String(m.id).startsWith('tmp_')) return deleteMessage(m.id);
  const ok = await confirmDialog('ลบข้อความ', 'ลบข้อความนี้ออกจากแชทของคุณ?\nอีกฝั่งยังเห็นข้อความนี้อยู่', 'ลบ', true);
  if (!ok) return;
  const { error } = await sb.from('hidden_messages').insert({ message_id: m.id });
  if (error) return handleDbError(error);
  social.hidden.add(m.id);
  loadMessages(true);
  loadChatList();
  toast('ลบข้อความแล้ว (เฉพาะฝั่งคุณ)', 'success');
}

// ---------- ตอบกลับ / แก้ไข (แถบเหนือช่องพิมพ์) ----------
function renderComposerBar() {
  const bar = $('composer-bar');
  if (!composer.type || !activeChat) { bar.classList.add('hidden-element'); return; }
  $('cb-title').textContent = composer.type === 'edit' ? 'แก้ไขข้อความ' : `ตอบกลับ ${senderLabel(activeChat, composer.msg)}`;
  $('cb-snippet').textContent = snippetOf(composer.msg);
  bar.classList.remove('hidden-element');
}

function clearComposerMode() {
  if (composer.type === 'edit') { $('message-input').value = ''; autoGrow(); }
  composer.type = null;
  composer.msg = null;
  renderComposerBar();
}

function startReply(m) {
  if (!activeChat || m.status !== 'sent' || $('message-input').disabled) return;
  if (composer.type === 'edit') { $('message-input').value = ''; autoGrow(); }
  composer.type = 'reply';
  composer.msg = m;
  renderComposerBar();
  $('message-input').focus();
}

function startEdit(m) {
  composer.type = 'edit';
  composer.msg = m;
  const input = $('message-input');
  input.value = m.text;
  autoGrow();
  renderComposerBar();
  input.focus();
}

async function submitEdit(text) {
  const m = composer.msg;
  const input = $('message-input');
  if (text === m.text) { clearComposerMode(); return; }
  const { error } = await sb.rpc('edit_message', { p_id: m.id, p_text: text });
  if (error) {
    input.value = text; autoGrow();
    return toast(/cannot_edit/.test(error.message) ? 'แก้ไขไม่ได้แล้ว (แก้ไขได้ภายใน 15 นาทีหลังส่ง)' : thaiError(error), 'error');
  }
  m.text = text;
  m.editedAt = Date.now();
  composer.type = null; composer.msg = null;
  renderComposerBar();
  loadMessages(true);
  loadChatList();
}

async function sendMessage(e) {
  e.preventDefault();
  const input = $('message-input');
  const text = input.value.trim();
  if (!text || !activeChat) return;
  if (!activeChat.isGroup && social.blocked.has(activeChat.id)) return toast('คุณบล็อกผู้ใช้นี้ไว้ ปลดบล็อกก่อนจึงจะส่งข้อความได้', 'error');
  input.focus(); // ให้คีย์บอร์ดบนมือถือยังเปิดอยู่ พิมพ์ต่อได้ทันที

  if (composer.type === 'edit') {
    input.value = ''; autoGrow();
    return submitEdit(text);
  }

  const chat = activeChat;
  const seconds = currentTtl();
  const replyTo = composer.type === 'reply' ? composer.msg.id : null;
  input.value = '';
  autoGrow();
  clearComposerMode();

  const now = Date.now();
  const msg = {
    id: 'tmp_' + now + '_' + Math.random().toString(36).slice(2, 7),
    text, ts: now, isMe: true, senderId: currentUser.id, kind: 'text',
    expiresAt: null,
    ttl: seconds || null,
    timer: seconds || null,
    status: 'sending', readAt: null, replyTo,
    mentions: chat.isGroup ? [...composerTags.ids] : [],
    mentionAll: chat.isGroup && composerTags.all
  };
  clearTags();
  addLocal(chat.id, msg);
  playSound('send');
  if (activeChat && activeChat.id === chat.id) loadMessages();
  loadChatList();
  await deliverMessage(chat, msg);
}

// ช่องพิมพ์หลายบรรทัด: ขยายตามข้อความ เห็นข้อความทั้งหมด
function autoGrow() {
  const t = $('message-input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 150) + 'px';
  syncSendMic();
}
function onComposerInput() { autoGrow(); handleTyping(); scheduleDraftSave(); }
function composerPlaceholder() {
  return isSecret(activeChat.id) && !activeChat.isGroup && !activeChat.isSaved
    ? `พิมพ์ข้อความลับถึง ${nameOf(activeChat)}` : `พิมพ์ข้อความถึง ${nameOf(activeChat)}`;
}

function comingSoon(name) { toast(`${name} จะเปิดให้ใช้ในเฟสถัดไป`, 'info'); }

// ---------- ปักหมุดข้อความ ----------
async function loadPins(chat) {
  if (isSecret(chat.id)) { state.pins = state.pins || {}; state.pins[chat.id] = []; if (activeChat && activeChat.id === chat.id) updatePinBar(); return; }
  const token = ++pinsToken;
  const me = currentUser.id;
  let q = sb.from('messages').select('*').not('pinned_at', 'is', null)
    .order('pinned_at', { ascending: false }).limit(5);
  q = chat.isGroup
    ? q.eq('group_id', chat.id)
    : q.or(`and(sender_id.eq.${me},receiver_id.eq.${chat.id}),and(sender_id.eq.${chat.id},receiver_id.eq.${me})`);
  const { data, error } = await q;
  if (error || token !== pinsToken) return;
  state.pins = state.pins || {};
  state.pins[chat.id] = (data || []).map(toLocal);
  if (activeChat && activeChat.id === chat.id) updatePinBar();
}

function updatePinBar() {
  const bar = $('pin-bar');
  const pins = activeChat ? ((state.pins && state.pins[activeChat.id]) || []) : [];
  if (!pins.length) { bar.classList.add('hidden-element'); return; }
  $('pin-bar-text').textContent = snippetOf(pins[0]);
  $('pin-bar-count').textContent = pins.length > 1 ? `(${pins.length})` : '';
  bar.classList.remove('hidden-element');
}

function openPins() {
  if (!activeChat) return;
  const pins = (state.pins && state.pins[activeChat.id]) || [];
  const box = $('pins-list');
  box.innerHTML = '';
  if (!pins.length) box.appendChild(hintNode('ยังไม่มีข้อความที่ปักหมุด'));
  pins.forEach(m => {
    const card = document.createElement('div');
    card.className = 'req-card';
    const head = document.createElement('div');
    head.className = 'hint';
    head.style.marginTop = '0';
    head.textContent = `${senderLabel(activeChat, m)} · ${dividerLabel(m.ts)}`;
    const text = document.createElement('div');
    text.className = 'pin-text';
    text.textContent = m.text;
    const acts = document.createElement('div');
    acts.className = 'req-actions';
    acts.appendChild(chip('ไปที่ข้อความ', () => { closeModal('pins-modal'); scrollToMessage(m.id); }, 'primary'));
    if (canPin(m)) acts.appendChild(chip('เลิกปักหมุด', () => togglePin(m)));
    card.append(head, text, acts);
    box.appendChild(card);
  });
  openModal('pins-modal');
}

async function togglePin(m) {
  const pin = !m.pinnedAt;
  if (pin && (m.expiresAt || m.ttl)) return toast('ปักหมุดข้อความที่ตั้งเวลาลบไม่ได้', 'error');
  const { error } = await sb.rpc('set_pin', { p_id: m.id, p_pin: pin });
  if (error) return handleDbError(error);
  toast(pin ? 'ปักหมุดข้อความแล้ว' : 'เลิกปักหมุดแล้ว', 'success');
  if (!$('pins-modal').classList.contains('hidden-element')) closeModal('pins-modal');
  // ตัวอัปเดตจริงมาจาก Realtime (onMessageUpdate) ถ้าไม่มา ให้โหลดใหม่
  setTimeout(() => { if (activeChat) loadPins(activeChat); }, 800);
}

// อัปเดตข้อความจากเซิร์ฟเวอร์: อ่านแล้ว / แก้ไข / ปักหมุด
function onMessageUpdate(row) {
  if (!currentUser || !row || !row.id) return;
  const me = currentUser.id;
  const chatKey = row.group_id || (row.sender_id === me ? row.receiver_id : row.sender_id);
  const m = (state.messages[chatKey] || []).find(x => x.id === row.id);
  if (m) {
    if (!m.enc) m.text = row.text;   // ข้อความเข้ารหัส: ห้ามเขียนทับด้วยข้อความแทนจากเซิร์ฟเวอร์
    m.readAt = row.read_at ? new Date(row.read_at).getTime() : null;
    m.editedAt = row.edited_at ? new Date(row.edited_at).getTime() : null;
    m.pinnedAt = row.pinned_at ? new Date(row.pinned_at).getTime() : null;
    m.expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
    m.media = row.media || null;
  }
  state.pins = state.pins || {};
  const pins = (state.pins[chatKey] || []).filter(p => p.id !== row.id);
  if (row.pinned_at) pins.push(toLocal(row));
  pins.sort((a, b) => b.pinnedAt - a.pinnedAt);
  state.pins[chatKey] = pins.slice(0, 5);
  if (activeChat && activeChat.id === chatKey) {
    updatePinBar();
    if (m) loadMessages(true);
  }
}

// ---------- แอบดูข้อความ (กดค้างที่แชทในหน้าหลัก 6 วินาที) ไม่ทำให้ขึ้นว่าอ่านแล้ว ----------
function peekChat(chat) {
  if (isRoomLocked(chat.id)) return;
  renderAvatar($('peek-avatar'), chat.avatar, nameOf(chat));
  $('peek-avatar').classList.toggle('group-av', !!chat.isGroup);
  $('peek-title').textContent = nameOf(chat);
  const body = $('peek-body');
  body.innerHTML = '';

  const list = (state.messages[chat.id] || []).filter(m =>
    !social.hidden.has(m.id) && !(chat.isGroup && !m.isMe && social.blocked.has(m.senderId)));
  if (!list.length) body.appendChild(hintNode('ยังไม่มีข้อความ'));

  let prev = null;
  list.forEach(m => {
    if (!prev || m.ts - prev.ts > 30 * 60 * 1000) {
      const d = document.createElement('div');
      d.className = 'date-divider';
      d.textContent = dividerLabel(m.ts);
      body.appendChild(d);
    }
    prev = m;
    if (m.kind === 'system') {
      const s = document.createElement('div');
      s.className = 'system-msg';
      s.textContent = m.text;
      body.appendChild(s);
      return;
    }
    const row = document.createElement('div');
    row.className = 'peek-msg' + (m.isMe ? ' me' : '');
    if (chat.isGroup && !m.isMe) {
      const who = document.createElement('span');
      who.className = 'msg-sender';
      who.textContent = groupSenderName(chat, m.senderId);
      who.style.color = memberColor(chat, m.senderId);
      row.appendChild(who);
    }
    const t = document.createElement('span');
    t.textContent = m.text;
    row.appendChild(t);
    body.appendChild(row);
  });
  openModal('peek-modal'); // ไม่เรียก markRead / mark_read
  body.scrollTop = body.scrollHeight;
}

// ---------- ใช้งานล่าสุด ----------
function touchLastSeen() {
  if (!currentUser || document.hidden || !sb) return;
  sb.rpc('touch_last_seen').then(() => {}, () => {});
}

async function refreshLastSeen(chat) {
  if (!chat || chat.isGroup || chat.isSaved) return;
  const { data } = await sb.from('public_profiles').select('id, last_seen_at').eq('id', chat.id).maybeSingle();
  if (data && state.contacts[chat.id]) {
    state.contacts[chat.id].last_seen_at = data.last_seen_at;
    if (activeChat && activeChat.id === chat.id) updateHeaderStatus();
  }
}

// ==================== เฟส D2: แท็ก รีแอกชัน อ่านแล้วในกลุ่ม ข้อความที่บันทึกไว้ ห้ามรบกวน ====================
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const composerTags = { ids: new Set(), all: false };

// ---------- รีแอกชัน ----------
function myReaction(mid) {
  const r = state.reactions && state.reactions[mid];
  return (r && currentUser && r[currentUser.id]) || '';
}

function setReactionLocal(mid, uid, emoji) {
  state.reactions = state.reactions || {};
  const r = state.reactions[mid] || (state.reactions[mid] = {});
  if (emoji) r[uid] = emoji; else delete r[uid];
}

async function loadReactions(chat) {
  const { data, error } = await sb.rpc('chat_reactions', { p_chat: chat.id, p_group: !!chat.isGroup });
  if (error) return; // ไม่แจ้ง error: ถ้ายังไม่ได้รัน SQL แค่ไม่มีรีแอกชัน
  (data || []).forEach(r => setReactionLocal(r.message_id, r.user_id, r.emoji));
  if (activeChat && activeChat.id === chat.id) loadMessages(true);
}

async function reactTo(msg, emoji) {
  if (String(msg.id).startsWith('tmp_')) return;
  const next = myReaction(msg.id) === emoji ? '' : emoji; // กดซ้ำ = ยกเลิก
  const { error } = await sb.rpc('react', { p_message: msg.id, p_emoji: next || null });
  if (error) return handleDbError(error);
  setReactionLocal(msg.id, currentUser.id, next);
  loadMessages(true);
}

function onReactionChange(payload) {
  const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
  if (!row || !row.message_id) return;
  setReactionLocal(row.message_id, row.user_id, payload.eventType === 'DELETE' ? '' : row.emoji);
  if (activeChat && (state.messages[activeChat.id] || []).some(m => m.id === row.message_id)) loadMessages(true);
}

function buildReactions(msg) {
  const r = state.reactions && state.reactions[msg.id];
  if (!r) return null;
  const counts = {};
  Object.values(r).forEach(e => { counts[e] = (counts[e] || 0) + 1; });
  const emojis = Object.keys(counts);
  if (!emojis.length) return null;

  const box = document.createElement('div');
  box.className = 'reactions';
  emojis.forEach(emoji => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'react-chip' + (myReaction(msg.id) === emoji ? ' mine' : '');
    b.textContent = counts[emoji] > 1 ? `${emoji} ${counts[emoji]}` : emoji;
    b.addEventListener('pointerdown', e => e.stopPropagation()); // ไม่ให้ไปเริ่มกดค้างที่ข้อความ
    b.onclick = e => { e.stopPropagation(); reactTo(msg, emoji); };
    box.appendChild(b);
  });
  return box;
}

// ---------- ใครอ่านแล้วในกลุ่ม ----------
function groupReaders(g, msg) {
  const me = currentUser.id;
  return g.members.filter(m => m.user_id !== me && m.readAt && m.readAt >= msg.ts);
}

function openReaders(msg) {
  if (!activeChat || !activeChat.isGroup) return;
  const readers = groupReaders(activeChat, msg);
  const box = $('readers-list');
  box.innerHTML = '';
  if (!readers.length) box.appendChild(hintNode('ยังไม่มีใครอ่าน'));
  readers.forEach(m => {
    const anon = activeChat.anonymous;
    const p = anon ? null : profileOf(m.user_id);
    box.appendChild(personRow({ id: m.user_id, nickname: groupSenderName(activeChat, m.user_id), avatar: p && p.avatar }, ''));
  });
  $('readers-count').textContent = readers.length ? `(${readers.length})` : '';
  openModal('readers-modal');
}

// ---------- แท็กเพื่อนในกลุ่ม ----------
function iAmMentioned(m) {
  return !!(m && (m.mentionAll || (m.mentions || []).includes(currentUser.id)));
}

function mentionUnread(chatId) {
  const since = lastRead[chatId] || 0;
  return (state.messages[chatId] || []).filter(m => !m.isMe && m.ts > since && iAmMentioned(m)).length;
}

function updateTagBar() {
  const isGroup = !!(activeChat && activeChat.isGroup);
  $('tag-btn').classList.toggle('hidden-element', !isGroup);
  const bar = $('tag-bar');
  if (!isGroup || (!composerTags.ids.size && !composerTags.all)) { bar.classList.add('hidden-element'); return; }
  $('tag-bar-text').textContent = composerTags.all
    ? 'แท็ก: @ทุกคน'
    : 'แท็ก: ' + [...composerTags.ids].map(id => '@' + groupSenderName(activeChat, id)).join(' ');
  bar.classList.remove('hidden-element');
}

function clearTags() {
  composerTags.ids = new Set();
  composerTags.all = false;
  updateTagBar();
}

async function openTagPicker() {
  if (!activeChat || !activeChat.isGroup) return;
  const g = activeChat;
  const me = currentUser.id;
  if (!g.anonymous) await ensureProfiles(g.members.map(m => m.user_id).filter(id => id !== me));

  const box = $('tag-list');
  box.innerHTML = '';

  const row = (p, checked, onChange) => {
    const r = personRow(p, '');
    r.classList.add('tap');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'pick';
    cb.checked = checked;
    const toggle = () => { cb.checked = !cb.checked; onChange(cb.checked); };
    cb.onclick = e => { e.stopPropagation(); onChange(cb.checked); };
    r.onclick = toggle;
    r.appendChild(cb);
    return r;
  };

  {
    box.appendChild(row({ id: 'all', nickname: 'ทุกคนในกลุ่ม (@ทุกคน)' }, composerTags.all, v => {
      composerTags.all = v;
      if (v) composerTags.ids = new Set();
      openTagPicker();
    }));
  }
  g.members.filter(m => m.user_id !== me).forEach(m => {
    const p = g.anonymous ? null : profileOf(m.user_id);
    box.appendChild(row(
      { id: m.user_id, nickname: groupSenderName(g, m.user_id), avatar: p && p.avatar },
      composerTags.all || composerTags.ids.has(m.user_id),
      v => {
        if (composerTags.all) { composerTags.all = false; }
        if (v) composerTags.ids.add(m.user_id); else composerTags.ids.delete(m.user_id);
        updateTagBar();
      }));
  });
  openModal('tag-modal');
}

function closeTagPicker() { closeModal('tag-modal'); updateTagBar(); $('message-input').focus(); }

// ---------- ข้อความที่บันทึกไว้ (แชทกับตัวเอง) ----------
function ensureSavedChat() {
  const me = currentUser.id;
  state.contacts[me] = {
    id: me, isSaved: true, avatar: '🔖',
    username: 'ข้อความที่บันทึกไว้', nickname: 'ข้อความที่บันทึกไว้'
  };
}

async function saveToNotes(msg) {
  const { error } = await sb.from('messages').insert({ sender_id: currentUser.id, receiver_id: currentUser.id, text: msg.text });
  if (error) return handleDbError(error);
  toast('บันทึกไว้ใน "ข้อความที่บันทึกไว้" แล้ว', 'success');
}

// ---------- ห้ามรบกวน / ซ่อนเนื้อหาแจ้งเตือน ----------
function minutesToTime(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
function timeToMinutes(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function dndActive() {
  if (!currentUser || !currentUser.dnd || !currentUser.dnd.enabled) return false;
  const d = new Date();
  const now = d.getHours() * 60 + d.getMinutes();
  const s = currentUser.dnd.start, e = currentUser.dnd.end;
  return s <= e ? (now >= s && now < e) : (now >= s || now < e);
}

async function saveNotifyPrefs() {
  const enabled = $('dnd-enabled').checked;
  const start = timeToMinutes($('dnd-start').value);
  const end = timeToMinutes($('dnd-end').value);
  const hide = $('hide-push').checked;
  const tz = -new Date().getTimezoneOffset();
  const { error } = await sb.from('profiles').update({
    dnd_enabled: enabled, dnd_start: start, dnd_end: end, hide_push_content: hide, tz_offset: tz
  }).eq('id', currentUser.id);
  if (error) { updateUserProfileUI(); return handleDbError(error); }
  currentUser.dnd = { enabled, start, end };
  currentUser.hidePush = hide;
  currentUser.tzOffset = tz;
}

// ==================== เฟส D3: ลิงก์ ส่งต่อ ตั้งเวลาลบ เมนูห้อง ค้นหา ธีมห้อง ปักหมุดแชท ====================

// ---------- ลิงก์ที่กดได้ ----------
const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

function linkify(el, text) {
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]}'"]+$/);
    if (trail) url = url.slice(0, -trail[0].length);
    if (!url) continue;
    el.appendChild(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement('a');
    a.className = 'msg-link';
    a.textContent = url;
    a.href = /^https?:/i.test(url) ? url : 'https://' + url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    el.appendChild(a);
    last = m.index + url.length;
  }
  el.appendChild(document.createTextNode(text.slice(last)));
}

// ---------- ตั้งเวลาลบข้อความ: ใส่ตัวเลข + เลือกหน่วย เริ่มนับหลังอ่าน ----------
function fmtDuration(sec) {
  if (sec % 86400 === 0) return `${sec / 86400} วัน`;
  if (sec % 3600 === 0) return `${sec / 3600} ชม.`;
  if (sec % 60 === 0) return `${sec / 60} นาที`;
  return `${sec} วินาที`;
}

function ttlKey() { return 'darkchat_ttl_' + currentUser.id; }
function getTtlMap() { try { return JSON.parse(localStorage.getItem(ttlKey()) || '{}'); } catch (e) { return {}; } }

// ---------- ส่งต่อข้อความ ----------
// ---------- เมนูห้องแชท (ปุ่ม ⋮ มุมขวาบน) ----------
function openRoomMenu() {
  const c = activeChat;
  if (!c) return;
  $('room-menu-title').textContent = nameOf(c);
  const box = $('room-menu-actions');
  box.innerHTML = '';
  const add = (label, fn, cls) => box.appendChild(actionBtn(label, () => { closeModal('room-menu'); fn(); }, cls || 'secondary-btn'));

  add('ค้นหาข้อความ', openMsgSearch, 'primary-btn');
  add(c.isGroup ? 'ข้อมูลกลุ่ม' : (c.isSaved ? 'โปรไฟล์ของฉัน' : 'ดูโปรไฟล์'), openChatInfo);
  if (!c.isSaved) {
    add(social.pinnedChats.has(c.id) ? 'เลิกปักหมุดแชทนี้' : 'ปักหมุดแชทนี้ไว้บนสุด', () => toggleChatPin(c.id));
    add(isMuted(c.id) ? 'เปิดเสียงแจ้งเตือนห้องนี้' : 'ปิดเสียงแจ้งเตือนห้องนี้', toggleRoomMute);
  }
  add('ตั้งเวลาลบข้อความ', openTtlModal);
  add('ธีมห้องและพื้นหลัง', openRoomStyle);
  add('ข้อความที่ปักหมุด', openPins);
  add('สื่อของห้อง (รูป ไฟล์ ลิงก์)', openRoomMedia);
  add('การเตือนและข้อความตั้งเวลาส่ง', openSchedList);
  if (isRoomLocked(c.id)) {
    add('เปลี่ยนรหัสล็อกห้อง', () => setRoomCode(c));
    add('ปิดรหัสล็อกห้อง', () => removeRoomCode(c), 'secondary-btn danger');
  } else {
    add('ตั้งรหัสล็อกห้องนี้', () => setRoomCode(c));
  }
  if (!c.isGroup && !c.isSaved) {
    if (isSecret(c.id)) {
      add('รหัสความปลอดภัย (ห้องลับ)', openSafety);
      add('ปิดห้องลับ', disableSecretRoom, 'secondary-btn danger');
    } else add('เปิดห้องลับ (เข้ารหัสปลายทาง)', enableSecretRoom);
  }
  // ห้องลับ: ฟีเจอร์ที่ต้องเก็บเนื้อหาไว้ที่เซิร์ฟเวอร์ใช้ไม่ได้
  if (isSecret(c.id)) [...box.children].forEach(b => { if (/ข้อความที่ปักหมุด|สื่อของห้อง|เตือนและข้อความตั้งเวลา/.test(b.textContent)) b.remove(); });
  box.appendChild(actionBtn('ปิด', () => closeModal('room-menu')));
  openModal('room-menu');
}

async function toggleRoomMute() {
  const c = activeChat;
  if (!c) return;
  if (!c.isGroup) return toggleMute(c.id);
  const { error } = await sb.rpc('set_group_muted', { p_group: c.id, p_muted: !c.muted });
  if (error) return handleDbError(error);
  try { await loadGroups(); } catch (e) { /* ไม่เป็นไร */ }
  toast(c.muted ? 'เปิดเสียงแจ้งเตือนกลุ่มแล้ว' : 'ปิดเสียงแจ้งเตือนกลุ่มแล้ว', 'success');
}

// ---------- ปักหมุดแชทไว้บนสุด ----------
async function toggleChatPin(id) {
  const has = social.pinnedChats.has(id);
  const { error } = has
    ? await sb.from('chat_pins').delete().eq('chat_id', id)
    : await sb.from('chat_pins').insert({ chat_id: id });
  if (error) return handleDbError(error);
  if (has) social.pinnedChats.delete(id); else social.pinnedChats.set(id, Date.now());
  loadChatList();
  toast(has ? 'เลิกปักหมุดแชทแล้ว' : 'ปักหมุดแชทแล้ว', 'success');
}

// ---------- ค้นหาข้อความในห้อง ----------
let smsgTimer = null;
let smsgToken = 0;

function openMsgSearch() {
  $('smsg-input').value = '';
  const box = $('smsg-list');
  box.innerHTML = '';
  box.appendChild(hintNode('พิมพ์คำที่ต้องการค้นหา (อย่างน้อย 2 ตัวอักษร)'));
  openModal('search-msg-modal');
  setTimeout(() => $('smsg-input').focus(), 60);
}

function msgSearchInput() {
  clearTimeout(smsgTimer);
  smsgTimer = setTimeout(runMsgSearch, 300);
}

async function runMsgSearch() {
  const chat = activeChat;
  if (!chat) return;
  const raw = $('smsg-input').value.trim();
  const q = raw.replace(/[%_\\,()]/g, '');
  const box = $('smsg-list');
  if (q.length < 2) { box.innerHTML = ''; box.appendChild(hintNode('พิมพ์อย่างน้อย 2 ตัวอักษร')); return; }
  if (!chat.isGroup && isSecret(chat.id)) return runSecretSearch(q);

  const token = ++smsgToken;
  const me = currentUser.id;
  let query = sb.from('messages').select('*').ilike('text', `%${q}%`).neq('kind', 'system')
    .order('created_at', { ascending: false }).limit(40);
  query = chat.isGroup
    ? query.eq('group_id', chat.id)
    : query.or(`and(sender_id.eq.${me},receiver_id.eq.${chat.id}),and(sender_id.eq.${chat.id},receiver_id.eq.${me})`);
  const { data, error } = await query;
  if (token !== smsgToken) return;
  if (error) return handleDbError(error);

  const now = Date.now();
  const rows = (data || []).map(toLocal).filter(m =>
    !social.hidden.has(m.id) &&
    !(social.cleared[chat.id] && m.ts <= social.cleared[chat.id]) &&
    !(m.expiresAt && m.expiresAt <= now) &&
    !(chat.isGroup && !m.isMe && social.blocked.has(m.senderId)));

  if (chat.isGroup && !chat.anonymous) {
    const senders = [...new Set(rows.map(m => m.senderId).filter(id => id !== me))];
    if (senders.length) await ensureProfiles(senders);
    if (token !== smsgToken) return;
  }

  box.innerHTML = '';
  if (!rows.length) { box.appendChild(hintNode('ไม่พบข้อความที่ตรงกับคำค้นหา')); return; }
  rows.forEach(m => {
    const card = document.createElement('div');
    card.className = 'req-card tap';
    const head = document.createElement('div');
    head.className = 'hint';
    head.style.marginTop = '0';
    head.textContent = `${senderLabel(chat, m)} · ${dividerLabel(m.ts)}`;
    const body = document.createElement('div');
    body.className = 'pin-text';
    const lower = m.text.toLowerCase();
    const at = lower.indexOf(q.toLowerCase());
    if (at < 0) body.textContent = snippetOf(m);
    else {
      const start = Math.max(0, at - 30);
      if (start > 0) body.appendChild(document.createTextNode('…'));
      body.appendChild(document.createTextNode(m.text.slice(start, at)));
      const mark = document.createElement('mark');
      mark.textContent = m.text.slice(at, at + q.length);
      body.appendChild(mark);
      body.appendChild(document.createTextNode(m.text.slice(at + q.length, at + q.length + 80)));
    }
    card.append(head, body);
    card.onclick = () => jumpToMessage(m);
    box.appendChild(card);
  });
}

// เลื่อนไปที่ข้อความ (โหลดข้อความเก่าเพิ่มจนเจอ)
async function jumpToMessage(m) {
  closeModal('search-msg-modal');
  const chat = activeChat;
  if (!chat) return;
  const rendered = () => [...$('messages-container').children].some(c => c.dataset && c.dataset.id === m.id);
  let guard = 0;
  if (!rendered()) toast('กำลังหาข้อความ…', 'info');
  while (!rendered() && !isHistoryDone(chat.id) && guard++ < 40) {
    const oldest = (state.messages[chat.id] || []).find(x => !String(x.id).startsWith('tmp_'));
    if (oldest && oldest.ts <= m.ts) break;
    await loadOlder(chat, false);
  }
  scrollToMessage(m.id);
}

// ---------- ธีมห้อง และพื้นหลังจากรูปที่เลือกเอง (เก็บในเครื่อง) ----------
const ROOM_THEMES = [
  { id: '', name: 'ปกติ', color: 'linear-gradient(135deg,#8b5cf6,#d946ef)' },
  { id: 'love', name: 'ความรัก', color: 'linear-gradient(135deg,#ec4899,#f43f5e)' },
  { id: 'happy', name: 'อารมณ์ดี', color: 'linear-gradient(135deg,#f59e0b,#f97316)' },
  { id: 'calm', name: 'สงบ', color: 'linear-gradient(135deg,#14b8a6,#3b82f6)' },
  { id: 'night', name: 'ราตรี', color: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }
];

function roomKey() { return 'darkchat_room_' + currentUser.id; }
function getRoomStyles() { try { return JSON.parse(localStorage.getItem(roomKey()) || '{}'); } catch (e) { return {}; } }
function saveRoomStyles(all) {
  try { localStorage.setItem(roomKey(), JSON.stringify(all)); return true; }
  catch (e) { toast('พื้นที่เก็บรูปพื้นหลังเต็ม ลองรูปอื่นหรือลบพื้นหลังของห้องอื่นก่อน', 'error'); return false; }
}

function applyRoomStyle() {
  const area = $('chat-area');
  const box = $('messages-container');
  const st = activeChat ? (getRoomStyles()[activeChat.id] || {}) : {};
  if (st.theme) area.setAttribute('data-room', st.theme); else area.removeAttribute('data-room');
  if (st.wp) {
    box.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.28), rgba(0,0,0,0.28)), url("${st.wp}")`;
    box.style.backgroundSize = 'cover';
    box.style.backgroundPosition = 'center';
  } else {
    box.style.backgroundImage = '';
    box.style.backgroundSize = '';
    box.style.backgroundPosition = '';
  }
}

function renderRoomThemes() {
  const cur = (activeChat && (getRoomStyles()[activeChat.id] || {}).theme) || '';
  const box = $('room-themes');
  box.innerHTML = '';
  ROOM_THEMES.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-chip' + (t.id === cur ? ' active' : '');
    const dot = document.createElement('span');
    dot.className = 'theme-dot';
    dot.style.background = t.color;
    b.append(dot, document.createTextNode(t.name));
    b.onclick = () => setRoomTheme(t.id);
    box.appendChild(b);
  });
}

function openRoomStyle() {
  if (!activeChat) return;
  renderRoomThemes();
  openModal('room-style-modal');
}

function setRoomStyleField(field, value) {
  const cid = activeChat.id;
  const all = getRoomStyles();
  const st = all[cid] || {};
  if (field === 'wp' && st.wpPath) { addPrefTrash(st.wpPath); delete st.wpPath; } // ไฟล์พื้นหลังเดิมบนเซิร์ฟเวอร์ ลบทิ้งทีหลัง
  if (value) st[field] = value; else delete st[field];
  if (Object.keys(st).length) all[cid] = st; else delete all[cid];
  if (!saveRoomStyles(all)) return false;
  applyRoomStyle();
  pushRoomPrefSoon(cid);
  return true;
}

function setRoomTheme(id) {
  if (setRoomStyleField('theme', id)) renderRoomThemes();
}

function resizeWallpaper(file, maxSide = 1080) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ไฟล์นี้ไม่ใช่รูปภาพ'));
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function pickRoomWallpaper(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const data = await resizeWallpaper(file);
    if (setRoomStyleField('wp', data)) toast('ตั้งพื้นหลังห้องแล้ว (เก็บในเครื่องนี้)', 'success');
  } catch (err) {
    toast(thaiError(err), 'error');
  }
  input.value = '';
}

function clearRoomWallpaper() {
  if (setRoomStyleField('wp', null)) toast('เอาพื้นหลังออกแล้ว', 'success');
}

// ==================== เฟส E: รูป วิดีโอ เสียง ไฟล์ + ตั้งเวลาลบ (หน้าต่างป๊อปอัป) ====================
const MEDIA_BUCKET = 'chat-media';
const MEDIA_LIMITS = { image: 15 * 1048576, video: 40 * 1048576, audio: 10 * 1048576, file: 20 * 1048576 };
const urlCache = {};

// ---------- ตัวช่วย ----------
function mediaKind(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('image/') && t !== 'image/svg+xml') return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  return 'file';
}

function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return Math.round(b / 1024) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function mediaLabel(media) {
  const map = { image: '📷 รูปภาพ', video: '🎬 วิดีโอ', audio: '🎤 คลิปเสียง' };
  return map[media.type] || ('📎 ' + (media.name || 'ไฟล์'));
}

function msgLabel(m) {
  if (m.sticker) return '🏷 สติ๊กเกอร์';
  if (m.album) return '▦ รูปภาพ ' + m.album.length + ' รายการ' + (m.text ? ' ' + m.text : '');
  if (m.media) return mediaLabel(m.media) + (m.text ? ' ' + m.text : '');
  return m.text;
}

// ---------- ปุ่ม + ข้างช่องพิมพ์ ----------
function toggleAttachMenu() {
  closeStickerPanel();
  const menu = $('attach-menu');
  const opening = menu.classList.contains('hidden-element');
  if (opening) {
    $('attach-saved').classList.toggle('hidden-element', !!(activeChat && activeChat.isSaved));
    $('chat-area').style.setProperty('--composer-h', document.querySelector('.chat-input-area').offsetHeight + 'px');
  }
  menu.classList.toggle('hidden-element', !opening);
  $('plus-btn').classList.toggle('open', opening);
}

function closeAttachMenu() {
  $('attach-menu').classList.add('hidden-element');
  $('plus-btn').classList.remove('open');
}

function attachPick(inputId) {
  closeAttachMenu();
  document.getElementById(inputId).click();
}

function openSavedChat() {
  closeAttachMenu();
  const me = currentUser.id;
  if (state.contacts[me]) selectChat(state.contacts[me]);
}

// ---------- ประมวลผลไฟล์ก่อนอัปโหลด ----------
function loadImageEl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปนี้ไม่ได้')); };
    img.src = url;
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), type, quality));
}

async function scaleImage(img, maxSide, quality) {
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return { blob: await canvasBlob(canvas, 'image/jpeg', quality), w, h };
}

// รูปตัวอย่างของวิดีโอ (จับภาพเฟรมแรก) ถ้าเบราว์เซอร์ทำไม่ได้จะส่งแบบไม่มีรูปตัวอย่าง
function videoPoster(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    let done = false;
    const finish = val => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(val); };
    v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.2, (v.duration || 1) / 2); } catch (e) { finish(null); } };
    v.onseeked = async () => {
      try {
        const k = Math.min(1, 320 / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.max(1, Math.round(v.videoWidth * k)), h = Math.max(1, Math.round(v.videoHeight * k));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        const blob = await canvasBlob(c, 'image/jpeg', 0.7);
        finish(blob ? { blob, w: v.videoWidth, h: v.videoHeight, dur: v.duration } : null);
      } catch (e) { finish(null); }
    };
    v.onerror = () => finish(null);
    setTimeout(() => finish(null), 7000);
    v.src = url;
  });
}

function extOf(file, fallback) {
  const n = ((file.name || '').split('.').pop() || '').toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(n) ? n : fallback;
}

function mediaPath(ext) {
  return `${currentUser.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

async function uploadObject(path, blob, contentType) {
  const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType, cacheControl: '3600', upsert: false });
  if (error) throw error;
}

function removeMediaFiles(media) {
  if (!media || !media.path) return;
  sb.storage.from(MEDIA_BUCKET).remove([media.path, media.thumb].filter(Boolean)).then(() => {}, () => {});
}

// ---------- ส่งไฟล์ ----------
async function sendMediaFile(file, extra = {}) {
  const chat = activeChat;
  if (!chat) return;
  if (!chat.isGroup && social.blocked.has(chat.id)) return toast('คุณบล็อกผู้ใช้นี้ไว้ ปลดบล็อกก่อนจึงจะส่งได้', 'error');

  const type = extra.type || mediaKind(file);
  if (file.size > MEDIA_LIMITS[type]) {
    return toast(`${file.name || 'ไฟล์'} ใหญ่เกินไป (สูงสุด ${fmtSize(MEDIA_LIMITS[type])})` +
      (type === 'video' ? ' ลองตัดคลิปให้สั้นลง หรือถ่ายใหม่โดยตั้งกล้อง iPhone เป็น 720p HD' : ''), 'error');
  }
  const names = { image: 'รูปภาพ.jpg', video: 'วิดีโอ.mp4', audio: 'เสียง.m4a', file: 'ไฟล์' };
  const now = Date.now();
  const ttl = currentTtl();
  const msg = {
    id: 'tmp_' + now + '_' + Math.random().toString(36).slice(2, 7),
    text: extra.caption || '', ts: now, isMe: true, senderId: currentUser.id, kind: 'text',
    batch: extra.batch || null, batchN: extra.batchN || null,
    expiresAt: null, ttl: ttl || null, timer: ttl || null,
    status: 'sending', readAt: null, replyTo: null,
    media: {
      type, name: file.name || names[type], size: file.size, mime: file.type || '', pending: true,
      local: type === 'image' ? URL.createObjectURL(file) : null
    },
    _file: file, _extra: extra
  };
  addLocal(chat.id, msg);
  playSound('send');
  if (activeChat && activeChat.id === chat.id) loadMessages();
  loadChatList();
  await deliverMedia(chat, msg);
}

async function deliverMedia(chat, msg) {
  if (msg.status !== 'sending') {
    msg.status = 'sending';
    if (activeChat && activeChat.id === chat.id) loadMessages(true);
  }
  const file = msg._file;
  const type = msg.media.type;
  const uploaded = [];
  try {
    let main = file, thumb = null, w = null, h = null, dur = msg._extra.dur || null;
    let mime = file.type || 'application/octet-stream';
    let ext = extOf(file, type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : type === 'audio' ? 'm4a' : 'bin');
    let name = msg.media.name;

    if (type === 'image') {
      const { img, url } = await loadImageEl(file);
      const t = await scaleImage(img, 320, 0.7);
      thumb = t.blob;
      if (mime === 'image/gif' && file.size <= 6 * 1048576) {
        w = img.naturalWidth; h = img.naturalHeight;   // GIF: เก็บต้นฉบับเพื่อให้ยังขยับได้
      } else {
        const m = await scaleImage(img, 1600, 0.8);    // ย่อรูปประหยัดพื้นที่
        main = m.blob; w = m.w; h = m.h; mime = 'image/jpeg'; ext = 'jpg';
        name = name.replace(/\.[^.]+$/, '') + '.jpg';
      }
      URL.revokeObjectURL(url);
    } else if (type === 'video') {
      const p = await videoPoster(file);
      if (p) { thumb = p.blob; w = p.w; h = p.h; dur = p.dur; }
    }

    const path = mediaPath(ext);
    await uploadObject(path, main, mime);
    uploaded.push(path);
    let thumbPath = null;
    if (thumb) {
      thumbPath = path.replace(/\.[a-z0-9]+$/, '') + '_t.jpg';
      await uploadObject(thumbPath, thumb, 'image/jpeg');
      uploaded.push(thumbPath);
    }

    const media = {
      type, path, thumb: thumbPath, thumb_size: thumb ? thumb.size : 0, name, size: main.size, mime,
      w, h, dur: dur ? Math.round(dur) : null
    };
    const { data, error } = await sb.from('messages').insert({
      sender_id: currentUser.id,
      ...(chat.isGroup ? { group_id: chat.id } : { receiver_id: chat.id }),
      text: msg.text || '',
      media,
      ...(msg.batch ? { meta: { batch: msg.batch, n: msg.batchN || 2 } } : {}),
      ...(msg.ttl ? { ttl_seconds: msg.ttl } : {})
    }).select().single();
    if (error) throw error;

    if (msg.media.local) URL.revokeObjectURL(msg.media.local);
    state.messages[chat.id] = (state.messages[chat.id] || []).filter(m => m.id !== msg.id);
    addLocal(chat.id, toLocal(data));
    // ตรวจพื้นที่: ถ้าใกล้เต็ม เซิร์ฟเวอร์จะลบไฟล์เก่าสุดให้เอง
    sb.functions.invoke('media-cleanup', { body: {} }).then(() => {}, () => {});
  } catch (err) {
    if (uploaded.length) sb.storage.from(MEDIA_BUCKET).remove(uploaded).then(() => {}, () => {});
    msg.status = 'failed';
    toast('ส่งไฟล์ไม่สำเร็จ: ' + thaiError(err), 'error');
  }
  if (activeChat && activeChat.id === chat.id) loadMessages(true);
  loadChatList();
}

// ---------- แสดงไฟล์ในแชท ----------
async function getMediaUrl(path, opts) {
  const key = path + (opts ? '|dl' : '');
  const c = urlCache[key];
  if (c && c.exp > Date.now()) return c.url;
  const { data, error } = await sb.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600, opts);
  if (error || !data) return null;
  urlCache[key] = { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 };
  return data.signedUrl;
}

function buildMediaEl(msg) {
  if (msg.album) return buildAlbumEl(msg);
  const m = msg.media;
  const wrap = document.createElement('div');
  wrap.className = 'media media-' + m.type;

  if (m.expired) {
    wrap.classList.add('media-expired');
    wrap.textContent = 'สื่อนี้ถูกลบอัตโนมัติเพื่อประหยัดพื้นที่เซิร์ฟเวอร์';
    return wrap;
  }

  if (m.type === 'image' || m.type === 'video') {
    const img = document.createElement('img');
    img.className = 'media-thumb';
    img.alt = '';
    img.loading = 'lazy';
    if (m.w && m.h) img.style.aspectRatio = `${m.w} / ${m.h}`;
    img.onerror = () => { img.removeAttribute('src'); wrap.classList.add('no-poster'); };
    if (m.local) img.src = m.local;
    else if (m.thumb) getMediaUrl(m.thumb).then(u => { if (u) img.src = u; });
    else if (m.type === 'image') getMediaUrl(m.path).then(u => { if (u) img.src = u; });
    else wrap.classList.add('no-poster');
    wrap.appendChild(img);
    if (m.pending) {
      const sp = document.createElement('span');
      sp.className = 'media-badge';
      sp.textContent = 'กำลังอัปโหลด…';
      wrap.appendChild(sp);
    } else if (m.type === 'video') {
      const play = document.createElement('span');
      play.className = 'media-play';
      play.textContent = '▶' + (m.dur ? ' ' + Math.floor(m.dur / 60) + ':' + String(m.dur % 60).padStart(2, '0') : '');
      wrap.appendChild(play);
    }
    wrap.onclick = e => { e.stopPropagation(); if (!m.pending) openGallery([m], 0); };
  } else if (m.type === 'audio') {
    const a = document.createElement('audio');
    a.controls = true;
    a.preload = 'none';
    a.className = 'media-audio-el';
    a.addEventListener('pointerdown', e => e.stopPropagation()); // เลื่อนแถบเสียงได้โดยไม่เปิดเมนูข้อความ
    if (!m.pending) getMediaUrl(m.path).then(u => { if (u) a.src = u; });
    wrap.appendChild(a);
  } else {
    const ico = document.createElement('span');
    ico.className = 'media-file-ico';
    ico.textContent = '📎';
    const info = document.createElement('div');
    info.className = 'media-file-info';
    const nm = document.createElement('strong');
    nm.textContent = m.name || 'ไฟล์';
    const sz = document.createElement('span');
    sz.textContent = m.pending ? 'กำลังอัปโหลด…' : fmtSize(m.size || 0) + ' · แตะเพื่อดาวน์โหลด';
    info.append(nm, sz);
    wrap.append(ico, info);
    wrap.onclick = e => { e.stopPropagation(); if (!m.pending) saveMedia(m); };
  }
  return wrap;
}

// บันทึกรูป/วิดีโอ/ไฟล์ลงเครื่อง (iPhone: เปิดแผ่นแชร์ เลือก "บันทึกรูปภาพ/วิดีโอ")
async function saveMedia(m) {
  toast('กำลังเตรียมไฟล์…', 'info');
  const url = await getMediaUrl(m.path);
  if (!url) return toast('ไม่พบไฟล์ (อาจถูกลบอัตโนมัติแล้ว)', 'error');
  try {
    const blob = await (await fetch(url)).blob();
    const name = m.name || ('darkchat-' + Date.now());
    const file = new File([blob], name, { type: m.mime || blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    toast('บันทึกไฟล์แล้ว', 'success');
  } catch (err) {
    if (err && err.name === 'AbortError') return; // ยกเลิกแผ่นแชร์
    window.open(url, '_blank');
  }
}

// ---------- ตัวช่วยบันทึกเสียง ----------
function pickAudioMime() {
  if (!window.MediaRecorder) return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'].find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function fmtClock2(sec) { return Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0'); }

// ---------- ตั้งเวลาลบข้อความอัตโนมัติ (ป๊อปอัปจากปุ่ม ⋮) ----------
function readTtlInputs() {
  const v = parseInt($('ttl-value').value, 10);
  if (!v || v < 1) return 0;
  return Math.min(v * parseInt($('ttl-unit').value, 10), 2592000); // สูงสุด 30 วัน
}

function currentTtl() { return activeChat ? (getTtlMap()[activeChat.id] || 0) : 0; }

function setTtlInputs(secs) {
  let unit = 1;
  [86400, 3600, 60, 1].some(u => { if (secs && secs % u === 0) { unit = u; return true; } return false; });
  $('ttl-unit').value = String(unit);
  $('ttl-value').value = secs ? String(secs / unit) : '';
}

function updateTtlChip() {
  const el = $('ttl-chip');
  const secs = currentTtl();
  if (!secs) { el.classList.add('hidden-element'); return; }
  el.textContent = `⏱ ลบหลังอ่าน ${fmtDuration(secs)}`;
  el.classList.remove('hidden-element');
}

function loadTtlFor() { updateTtlChip(); }

function openTtlModal() {
  if (!activeChat) return;
  setTtlInputs(currentTtl());
  const box = $('ttl-presets');
  box.innerHTML = '';
  [[10, '10 วินาที'], [60, '1 นาที'], [3600, '1 ชั่วโมง'], [86400, '1 วัน'], [604800, '7 วัน']].forEach(([s, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-chip';
    b.textContent = label;
    b.onclick = () => setTtlInputs(s);
    box.appendChild(b);
  });
  openModal('ttl-modal');
}

async function applyTtl(secs) {
  const c = activeChat;
  if (!c) return;
  const map = getTtlMap();
  if (secs) map[c.id] = secs; else delete map[c.id];
  try { localStorage.setItem(ttlKey(), JSON.stringify(map)); } catch (e) { /* ไม่เป็นไร */ }
  closeModal('ttl-modal');
  updateTtlChip();
  // ประกาศในแชทให้ทุกคนในห้องเห็น (ข้อความระบบ)
  const { error } = await sb.rpc('announce_ttl', { p_chat: c.id, p_group: !!c.isGroup, p_seconds: secs || 0 });
  if (error) return handleDbError(error);
  toast(secs ? `เริ่มลบข้อความอัตโนมัติ ${fmtDuration(secs)} หลังอ่าน` : 'ปิดการลบข้อความอัตโนมัติแล้ว', 'success');
}

function submitTtl() {
  const secs = readTtlInputs();
  if (!secs) return toast('ใส่ตัวเลขเวลาก่อน หรือกด "ปิดการลบ"', 'error');
  applyTtl(secs);
}

function turnOffTtl() { applyTtl(0); }

// ==================== เฟส E2: ส่งรูปเป็นชุด / ดูรูปปัดซ้ายขวา+ซูม / ลบหลายข้อความ / ไมค์กดค้าง ====================

function newBatchId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
}

// ---------- เลือกไฟล์ แล้วพิมพ์ข้อความก่อนส่ง ----------
const sp = { files: [], urls: [] };

function onMediaPicked(input) {
  const files = [...(input.files || [])].slice(0, 10);
  input.value = '';
  closeAttachMenu();
  if (!files.length || !activeChat) return;
  openSendPreview(files);
}

function openSendPreview(files) {
  sp.files = files;
  $('sp-caption').value = '';
  renderSendPreview();
  openModal('send-preview');
}

function revokeSendPreview() {
  sp.urls.forEach(u => URL.revokeObjectURL(u));
  sp.urls = [];
}

function renderSendPreview() {
  revokeSendPreview();
  const grid = $('sp-grid');
  grid.innerHTML = '';
  $('sp-title').textContent = `ส่ง ${sp.files.length} รายการ`;
  $('sp-send').textContent = `ส่ง (${sp.files.length})`;
  sp.files.forEach((f, i) => {
    const cell = document.createElement('div');
    cell.className = 'sp-cell';
    const kind = mediaKind(f);
    if (kind === 'image') {
      const url = URL.createObjectURL(f);
      sp.urls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      cell.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'sp-ph';
      ph.textContent = kind === 'video' ? '🎬' : kind === 'audio' ? '🎤' : '📎';
      const nm = document.createElement('span');
      nm.textContent = f.name || 'ไฟล์';
      cell.append(ph, nm);
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'sp-x';
    x.setAttribute('aria-label', 'เอาออก');
    x.textContent = '✕';
    x.onclick = () => { sp.files.splice(i, 1); if (!sp.files.length) closeSendPreview(); else renderSendPreview(); };
    cell.appendChild(x);
    grid.appendChild(cell);
  });
}

function closeSendPreview() {
  revokeSendPreview();
  sp.files = [];
  closeModal('send-preview');
}

async function confirmSendPreview() {
  const files = sp.files.slice();
  const caption = $('sp-caption').value.trim();
  if (!files.length || !activeChat) return;
  closeSendPreview();

  const visual = files.filter(f => ['image', 'video'].includes(mediaKind(f)));
  const rest = files.filter(f => !visual.includes(f));
  const batch = visual.length > 1 ? newBatchId() : null;   // หลายรูป = ส่งเป็นชุด
  const all = [...visual, ...rest];
  for (let i = 0; i < all.length; i++) {
    const f = all[i];
    await sendMediaFile(f, {
      caption: i === all.length - 1 ? caption : '',        // ข้อความไปอยู่ที่รายการสุดท้าย
      batch: visual.includes(f) ? batch : null,
      batchN: visual.length
    });
  }
}

// ---------- รูปเป็นชุด (กองรูปซ้อนกัน แตะเพื่อเปิดดูทั้งชุด) ----------
function groupAlbums(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.batch && m.media && (m.media.type === 'image' || m.media.type === 'video')) {
      const group = [m];
      while (i + 1 < list.length && list[i + 1].batch === m.batch && list[i + 1].senderId === m.senderId && list[i + 1].media) {
        group.push(list[i + 1]);
        i++;
      }
      if (group.length > 1) {
        const last = group[group.length - 1];
        const status = group.some(x => x.status === 'failed') ? 'failed' : group.some(x => x.status === 'sending') ? 'sending' : 'sent';
        out.push(Object.assign({}, last, { album: group, status, text: last.text || '' }));
        continue;
      }
    }
    out.push(m);
  }
  return out;
}

function albumThumb(m) {
  const img = document.createElement('img');
  img.className = 'album-img';
  img.alt = '';
  img.loading = 'lazy';
  img.onerror = () => img.removeAttribute('src');
  if (m.local) img.src = m.local;
  else if (m.thumb) getMediaUrl(m.thumb).then(u => { if (u) img.src = u; });
  else if (m.type === 'image') getMediaUrl(m.path).then(u => { if (u) img.src = u; });
  return img;
}

function buildAlbumEl(am) {
  const items = am.album;
  const wrap = document.createElement('div');
  wrap.className = 'media album';
  const nImg = items.filter(a => a.media.type === 'image').length;
  const head = document.createElement('div');
  head.className = 'album-head';
  head.textContent = '▦ ' + (nImg === items.length ? `รูปภาพ ${items.length} รูป` : `รูปภาพและวิดีโอ ${items.length} รายการ`);
  const stack = document.createElement('div');
  stack.className = 'album-stack';
  const tilts = [0, -4, 5];
  items.slice(0, 3).forEach((a, i) => {
    const card = document.createElement('div');
    card.className = 'album-card' + (a.media.type === 'video' ? ' is-video' : '');
    card.style.zIndex = String(10 - i);
    card.style.transform = `rotate(${tilts[i]}deg) translate(${i * 6}px, ${i * -4}px)`;
    card.appendChild(albumThumb(a.media));
    if (i === 0 && a.media.type === 'video') {
      const pl = document.createElement('span');
      pl.className = 'media-play';
      pl.textContent = '▶';
      card.appendChild(pl);
    }
    stack.appendChild(card);
  });
  if (items.some(a => a.media.pending)) {
    const b = document.createElement('span');
    b.className = 'media-badge';
    b.textContent = 'กำลังอัปโหลด…';
    stack.appendChild(b);
  }
  stack.onclick = e => {
    e.stopPropagation();
    const playable = items.map(a => a.media).filter(x => !x.expired && !x.pending);
    if (playable.length) openGallery(playable, 0);
  };
  wrap.append(head, stack);
  return wrap;
}

function retryMsg(msg) {
  const list = msg.album ? msg.album : [msg];
  list.filter(x => x.status === 'failed').forEach(x => (x.media ? deliverMedia(activeChat, x) : deliverMessage(activeChat, x)));
}

function fillReactRow(msg) {
  const emojis = $('msg-menu-emoji');
  emojis.innerHTML = '';
  if (msg.status === 'sent') {
    REACTIONS.forEach(e => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-btn' + (myReaction(msg.id) === e ? ' mine' : '');
      btn.textContent = e;
      btn.onclick = () => { closeModal('msg-menu'); reactTo(msg, e); };
      emojis.appendChild(btn);
    });
  }
  emojis.classList.toggle('hidden-element', msg.status !== 'sent');
}

function openAlbumMenu(am) {
  $('msg-menu-preview').textContent = msgLabel(am);
  fillReactRow(am);
  const box = $('msg-menu-actions');
  box.innerHTML = '';
  const add = (label, fn, cls) => box.appendChild(actionBtn(label, () => { closeModal('msg-menu'); fn(); }, cls || 'secondary-btn'));
  const items = am.album;
  const ids = items.map(a => a.id);
  const ready = items.every(a => a.status === 'sent' && !a.media.pending);

  if (am.status === 'sent') add('ตอบกลับ', () => startReply(am), 'primary-btn');
  if (ready) add('บันทึกทั้งหมดลงเครื่อง', () => saveMediaMany(items.map(a => a.media)));
  if (ready && items.every(a => !a.media.expired)) add('ส่งต่อทั้งชุด', () => openForward(am));
  const canUnsend = am.isMe && ready &&
    (activeChat.isGroup ? Date.now() - items[0].ts < 5 * 60 * 1000 : items.every(a => !a.readAt));
  if (canUnsend) add('ยกเลิกการส่งทั้งชุด', () => unsendAlbum(items), 'secondary-btn danger');
  add('ลบ', () => enterSelectMode(ids), 'secondary-btn danger');
  box.appendChild(actionBtn('ปิด', () => closeModal('msg-menu')));
  openModal('msg-menu');
}

async function unsendAlbum(items) {
  const ok = await confirmDialog('ยกเลิกการส่งทั้งชุด', `ยกเลิกการส่งรูป/วิดีโอ ${items.length} รายการนี้?\nจะถูกลบออกจากแชทของทุกคน`, 'ยกเลิกการส่ง', true);
  if (!ok) return;
  const ids = items.map(a => a.id);
  const { error } = await sb.from('messages').delete().in('id', ids);
  if (error) return handleDbError(error);
  items.forEach(a => removeMediaFiles(a.media));
  state.messages[activeChat.id] = (state.messages[activeChat.id] || []).filter(m => !ids.includes(m.id));
  playSound('delete');
  loadMessages(true);
  loadChatList();
}

async function saveMediaMany(medias) {
  toast('กำลังเตรียมไฟล์…', 'info');
  try {
    const files = [];
    for (const m of medias) {
      const url = await getMediaUrl(m.path);
      if (!url) continue;
      const blob = await (await fetch(url)).blob();
      files.push(new File([blob], m.name || ('darkchat-' + Date.now()), { type: m.mime || blob.type }));
    }
    if (!files.length) return toast('ไม่พบไฟล์ (อาจถูกลบอัตโนมัติแล้ว)', 'error');
    if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files }); return; }
    for (const f of files) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise(r => setTimeout(r, 300));
    }
    toast('บันทึกไฟล์แล้ว', 'success');
  } catch (err) {
    if (!(err && err.name === 'AbortError')) toast('บันทึกไม่สำเร็จ ลองบันทึกทีละรูป', 'error');
  }
}

// ---------- ดูรูป/วิดีโอเต็มจอ: ปัดซ้ายขวา, บีบนิ้วซูม, แตะสองครั้งซูม ----------
const gal = { items: [], idx: 0, scale: 1, tx: 0, ty: 0, ptrs: new Map(), startDist: 0, startScale: 1,
  startX: 0, startY: 0, baseTx: 0, baseTy: 0, drag: 0, dragging: false, moved: false, lastTap: 0, ready: false };

function curSlideImg() {
  const slide = $('mv-track').children[gal.idx];
  return slide ? slide.querySelector('.mv-img') : null;
}

function applyZoom() {
  const img = curSlideImg();
  if (img) img.style.transform = `translate(${gal.tx}px, ${gal.ty}px) scale(${gal.scale})`;
}

function resetZoom() {
  gal.scale = 1; gal.tx = 0; gal.ty = 0;
  [...$('mv-track').querySelectorAll('.mv-img')].forEach(i => { i.style.transform = ''; });
}

function clampPan() {
  const st = $('mv-stage');
  const mx = (gal.scale - 1) * st.clientWidth / 2;
  const my = (gal.scale - 1) * st.clientHeight / 2;
  gal.tx = Math.max(-mx, Math.min(mx, gal.tx));
  gal.ty = Math.max(-my, Math.min(my, gal.ty));
}

function loadSlide(i) {
  const slide = $('mv-track').children[i];
  const m = gal.items[i];
  if (!slide || !m || slide.dataset.loaded) return;
  slide.dataset.loaded = '1';
  getMediaUrl(m.path).then(u => {
    if (!u) { slide.textContent = 'ไม่พบไฟล์ (อาจถูกลบอัตโนมัติแล้ว)'; return; }
    slide.textContent = '';
    if (m.type === 'video') {
      const v = document.createElement('video');
      v.src = u; v.controls = true; v.playsInline = true; v.className = 'mv-video';
      if (m.thumb) getMediaUrl(m.thumb).then(p => { if (p) v.poster = p; });
      slide.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = u; img.alt = ''; img.className = 'mv-img'; img.draggable = false;
      slide.appendChild(img);
    }
  });
}

function updateGallery(animate = true) {
  const track = $('mv-track');
  track.style.transition = animate ? '' : 'none';
  track.style.transform = `translateX(${-gal.idx * 100}%)`;
  const m = gal.items[gal.idx];
  $('mv-name').textContent = m ? (m.name || '') : '';
  $('mv-count').textContent = gal.items.length > 1 ? `${gal.idx + 1} / ${gal.items.length}` : '';
  $('mv-goto').classList.toggle('hidden-element', !(m && m.mid));
  $('mv-prev').classList.toggle('hidden-element', gal.idx === 0);
  $('mv-next').classList.toggle('hidden-element', gal.idx >= gal.items.length - 1);
  [gal.idx - 1, gal.idx, gal.idx + 1].forEach(loadSlide);
  [...track.querySelectorAll('video')].forEach((v, k) => { if (v.closest('.mv-slide') !== track.children[gal.idx]) v.pause(); });
}

function openGallery(items, idx = 0) {
  gal.items = items; gal.idx = idx; gal.ptrs.clear();
  const track = $('mv-track');
  track.innerHTML = '';
  items.forEach(() => { const s = document.createElement('div'); s.className = 'mv-slide'; track.appendChild(s); });
  resetZoom();
  openModal('media-viewer');
  updateGallery(false);
  if (!gal.ready) {
    gal.ready = true;
    const st = $('mv-stage');
    st.addEventListener('pointerdown', galDown);
    st.addEventListener('pointermove', galMove);
    st.addEventListener('pointerup', galUp);
    st.addEventListener('pointercancel', galUp);
    st.addEventListener('wheel', e => {
      e.preventDefault();
      gal.scale = Math.max(1, Math.min(5, gal.scale - e.deltaY * 0.0025));
      if (gal.scale === 1) { gal.tx = 0; gal.ty = 0; }
      clampPan();
      applyZoom();
    }, { passive: false });
  }
}

function closeMediaViewer() {
  closeModal('media-viewer');
  $('mv-track').innerHTML = ''; // หยุดวิดีโอ
  gal.items = [];
  gal.ptrs.clear();
}

function galleryStep(d) {
  const n = Math.max(0, Math.min(gal.items.length - 1, gal.idx + d));
  if (n === gal.idx) return updateGallery();
  resetZoom();
  gal.idx = n;
  updateGallery();
}

function saveCurrentMedia() { const m = gal.items[gal.idx]; if (m) saveMedia(m); }

function galDist() {
  const [a, b] = [...gal.ptrs.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}

function galDown(e) {
  if (e.target.closest('video, .mv-nav')) return; // ให้ปุ่มควบคุมวิดีโอทำงานเอง
  gal.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  $('mv-stage').setPointerCapture(e.pointerId);
  if (gal.ptrs.size === 2) {
    gal.startDist = galDist(); gal.startScale = gal.scale; gal.dragging = false; gal.moved = true;
  } else {
    gal.startX = e.clientX; gal.startY = e.clientY; gal.baseTx = gal.tx; gal.baseTy = gal.ty;
    gal.drag = 0; gal.moved = false; gal.dragging = true;
    $('mv-track').style.transition = 'none';
  }
}

function galMove(e) {
  const p = gal.ptrs.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (gal.ptrs.size === 2) {
    gal.scale = Math.max(1, Math.min(5, gal.startScale * galDist() / gal.startDist));
    if (gal.scale === 1) { gal.tx = 0; gal.ty = 0; }
    clampPan();
    applyZoom();
    return;
  }
  if (!gal.dragging) return;
  const dx = e.clientX - gal.startX, dy = e.clientY - gal.startY;
  if (Math.abs(dx) > 6 || Math.abs(dy) > 6) gal.moved = true;
  if (gal.scale > 1.02) {
    gal.tx = gal.baseTx + dx; gal.ty = gal.baseTy + dy;
    clampPan();
    applyZoom();
  } else {
    gal.drag = dx;
    $('mv-track').style.transform = `translateX(calc(${-gal.idx * 100}% + ${dx}px))`;
  }
}

function galUp(e) {
  if (!gal.ptrs.delete(e.pointerId)) return;
  if (gal.ptrs.size === 1) { // เหลือนิ้วเดียวหลังบีบ: เริ่มลากต่อ
    const [p] = [...gal.ptrs.values()];
    gal.startX = p.x; gal.startY = p.y; gal.baseTx = gal.tx; gal.baseTy = gal.ty; gal.dragging = true;
    return;
  }
  if (gal.ptrs.size > 0) return;
  gal.dragging = false;
  $('mv-track').style.transition = '';
  if (gal.scale <= 1.02) {
    resetZoom();
    if (gal.moved && Math.abs(gal.drag) > 70) galleryStep(gal.drag < 0 ? 1 : -1);
    else updateGallery();
  }
  if (!gal.moved) { // แตะสองครั้ง = ซูมเข้า/ออก
    const now = Date.now();
    if (now - gal.lastTap < 300) {
      if (gal.scale > 1.02) resetZoom(); else { gal.scale = 2.5; gal.tx = 0; gal.ty = 0; applyZoom(); }
      gal.lastTap = 0;
    } else gal.lastTap = now;
  }
  gal.drag = 0;
}

// ---------- ลบหลายข้อความ (เลือกวงกลม แล้วกด "ลบ (n)") ----------
const sel = { on: false, ids: new Set() };

function enterSelectMode(ids) {
  sel.on = true;
  sel.ids = new Set(ids);
  $('chat-area').classList.add('select-mode');
  closeAttachMenu();
  updateSelCount();
  loadMessages(true);
}

function leaveSelectModeQuiet() {
  sel.on = false;
  sel.ids = new Set();
  $('chat-area').classList.remove('select-mode');
}

function exitSelectMode() {
  if (!sel.on) return;
  leaveSelectModeQuiet();
  loadMessages(true);
}

function updateSelCount() {
  const b = $('sel-delete');
  b.textContent = `ลบ (${sel.ids.size})`;
  b.disabled = sel.ids.size === 0;
}

function toggleSel(ids) {
  const all = ids.every(id => sel.ids.has(id));
  ids.forEach(id => { if (all) sel.ids.delete(id); else sel.ids.add(id); });
  updateSelCount();
  loadMessages(true);
}

function decorateSelect(container) {
  [...container.children].forEach(row => {
    if (!row.classList.contains('msg-row')) return;
    const ids = (row.dataset.ids || row.dataset.id || '').split(',').filter(Boolean);
    const c = document.createElement('div');
    c.className = 'sel-circle' + (ids.length && ids.every(id => sel.ids.has(id)) ? ' on' : '');
    row.insertBefore(c, row.firstChild);
    row.onclick = e => { e.preventDefault(); e.stopPropagation(); toggleSel(ids); };
  });
}

async function deleteSelected() {
  const ids = [...sel.ids];
  if (!ids.length) return;
  const ok = await confirmDialog('ลบข้อความ', `ลบ ${ids.length} ข้อความออกจากแชทของคุณ?\nอีกฝั่งยังเห็นข้อความเหล่านี้อยู่`, 'ลบ', true);
  if (!ok) return;
  const real = ids.filter(id => !String(id).startsWith('tmp_'));
  const tmp = ids.filter(id => String(id).startsWith('tmp_'));
  if (real.length) {
    const { error } = await sb.from('hidden_messages').insert(real.map(id => ({ message_id: id })));
    if (error) return handleDbError(error);
    real.forEach(id => social.hidden.add(id));
  }
  if (tmp.length && activeChat) state.messages[activeChat.id] = (state.messages[activeChat.id] || []).filter(m => !tmp.includes(m.id));
  leaveSelectModeQuiet();
  loadMessages(true);
  loadChatList();
  toast(`ลบ ${ids.length} ข้อความแล้ว (เฉพาะฝั่งคุณ)`, 'success');
}

// ---------- ไมโครโฟนในช่องพิมพ์: กดค้างเพื่ออัด ปล่อยนิ้วเพื่อส่งทันที ปัดซ้ายเพื่อยกเลิก ----------
// ---------- หน้าใส่ PIN: ออกจากระบบ ----------
async function pinLogout() {
  const ok = await confirmDialog('ออกจากระบบ', 'ต้องการออกจากระบบใช่หรือไม่?\nครั้งหน้าต้องเข้าสู่ระบบด้วยรหัสผ่านและตั้ง PIN ใหม่', 'ออกจากระบบ', true);
  if (!ok) return;
  const uid = pin.user.id;
  hidePin();
  await logoutNow(uid);
}

// ==================== เฟส D4: PIN เปิด/ปิด, รหัสล็อกห้อง, ไมค์กดค้าง (แก้บั๊ก), เตือนข้อความ, ตั้งเวลาส่ง, ชื่อสุ่มในกลุ่มไม่แสดงตัวตน ====================

// ---------- PIN: แสดงเจ้าของบัญชี + เปิด/ปิดการล็อก ----------
function pinWho(user) {
  try {
    const c = JSON.parse(localStorage.getItem('darkchat_who_' + user.id) || 'null');
    if (c && c.name) return c;
  } catch (e) { /* ไม่เป็นไร */ }
  const meta = user.user_metadata || {};
  return { name: meta.username || (user.email || 'ผู้ใช้').split('@')[0], avatar: meta.avatar || '' };
}

function pinEnabled(uid) { return !localStorage.getItem('darkchat_pinoff_' + uid); }

function togglePinLock(on) {
  const uid = currentUser.id;
  const flag = 'darkchat_pinoff_' + uid;
  const revert = () => { $('st-pin-lock').checked = pinEnabled(uid); };
  if (on) {
    localStorage.removeItem(flag);
    if (!hasPin(uid)) {
      return showPin('create', currentUser, () => toast('เปิดการล็อกด้วย PIN แล้ว', 'success'),
        () => { localStorage.setItem(flag, '1'); revert(); });
    }
    toast('เปิดการล็อกด้วย PIN แล้ว', 'success');
  } else {
    if (!hasPin(uid)) { localStorage.setItem(flag, '1'); return toast('ปิดการล็อกด้วย PIN แล้ว', 'success'); }
    // ต้องใส่ PIN เดิมก่อนจึงปิดได้
    showPin('unlock', currentUser, () => { localStorage.setItem(flag, '1'); revert(); toast('ปิดการล็อกด้วย PIN แล้ว', 'success'); }, revert);
  }
}

async function savePinKey(key, code) {
  const salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPin(code, salt);
  localStorage.setItem(key, JSON.stringify({ salt, hash }));
}

async function checkPinKey(key, code) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return !!saved && (await hashPin(code, saved.salt)) === saved.hash;
  } catch (e) { return false; }
}

// ---------- รหัสล็อกห้องแชท (ตั้งได้เป็นรายห้อง เก็บในเครื่องนี้) ----------
const unlockedRooms = new Set();

function roomLockKey(chatId) { return `darkchat_rl_${currentUser.id}_${chatId}`; }
function roomFailsKey(chatId) { return `darkchat_rlf_${currentUser.id}_${chatId}`; }
function isRoomLocked(chatId) { return !!(currentUser && localStorage.getItem(roomLockKey(chatId))); }

function roomPinOpts(chat) {
  return { kind: 'room', key: roomLockKey(chat.id), who: { name: nameOf(chat), avatar: chat.avatar }, chatId: chat.id };
}

function promptRoomUnlock(chat) {
  showPin('unlock', currentUser, () => {
    localStorage.removeItem(roomFailsKey(chat.id));
    unlockedRooms.add(chat.id);
    selectChat(chat);
  }, () => {}, roomPinOpts(chat));
}

// ใส่รหัสห้องผิด: นับจำนวนครั้ง (เก็บในเครื่อง รีเฟรชก็ไม่รีเซ็ต) ครบ 5 ครั้งจะล้างข้อความในห้องแล้วเปิดห้องเปล่าให้
async function roomCodeWrong() {
  const id = pin.chatId;
  const fails = (parseInt(localStorage.getItem(roomFailsKey(id)) || '0', 10) || 0) + 1;
  localStorage.setItem(roomFailsKey(id), String(fails));
  if (fails < 5) return pinError('รหัสไม่ถูกต้อง');
  const done = pin.onDone;
  hidePin();
  await wipeRoom(id);
  localStorage.removeItem(roomFailsKey(id));
  if (done) done();
}

async function wipeRoom(chatId) {
  try {
    if (state.groups[chatId]) await sb.rpc('clear_group_chat', { p_group: chatId });
    else {
      await sb.from('chat_clears').upsert(
        { user_id: currentUser.id, partner_id: chatId, cleared_at: new Date().toISOString() },
        { onConflict: 'user_id,partner_id' });
    }
  } catch (e) { /* ล้างฝั่งเครื่องต่อไป */ }
  const last = lastMessageOf(chatId);
  social.cleared[chatId] = Math.max(Date.now(), last ? last.ts + 1 : 0);
  state.messages[chatId] = [];
  if (state.pins) delete state.pins[chatId];
  delete lastRead[chatId];
  saveLastRead();
}

function setRoomCode(chat) {
  const opts = roomPinOpts(chat);
  const create = () => showPin('create', currentUser, () => {
    localStorage.removeItem(roomFailsKey(chat.id));
    unlockedRooms.add(chat.id);
    toast('ตั้งรหัสล็อกห้องแล้ว', 'success');
    loadChatList();
  }, () => {}, opts);
  if (isRoomLocked(chat.id)) showPin('unlock', currentUser, create, () => {}, opts);
  else create();
}

function removeRoomCode(chat) {
  showPin('unlock', currentUser, () => {
    localStorage.removeItem(roomLockKey(chat.id));
    localStorage.removeItem(roomFailsKey(chat.id));
    toast('ปิดรหัสล็อกห้องแล้ว', 'success');
    loadChatList();
  }, () => {}, roomPinOpts(chat));
}

// ---------- ไมโครโฟนในช่องพิมพ์: กดค้างเพื่ออัด ปล่อยนิ้วเพื่อส่ง (แก้บั๊กกดแล้วปล่อยเร็วแล้วค้าง) ----------
const hold = { down: false, cancel: false, startX: 0, mr: null, stream: null, chunks: [], t0: 0, timer: null, mime: '', token: 0, pressAt: 0, safety: null };

function syncSendMic() {
  const has = $('message-input').value.trim().length > 0;
  $('send-btn').classList.toggle('hidden-element', !has);
  $('mic-btn').classList.toggle('hidden-element', has);
}

function setRecUI(show) {
  $('rec-bar').classList.toggle('hidden-element', !show);
  if (show) {
    $('rec-bar').classList.remove('cancel');
    $('rec-hint').textContent = 'ปัดไปด้านซ้ายเพื่อยกเลิก หรือปล่อยนิ้วเพื่อส่ง';
    $('rec-clock').textContent = '0:00';
  }
}

function stopHoldStream() {
  if (hold.stream) hold.stream.getTracks().forEach(t => t.stop());
  hold.stream = null;
}

// ล้างสถานะการอัดทั้งหมด (ใช้ทุกครั้งที่สถานะผิดปกติ จะได้ไม่ค้าง)
function hardResetHold() {
  clearInterval(hold.timer);
  clearTimeout(hold.safety);
  if (hold.mr) {
    try { hold.mr.ondataavailable = null; hold.mr.onstop = null; if (hold.mr.state !== 'inactive') hold.mr.stop(); } catch (e) { /* ไม่เป็นไร */ }
  }
  hold.mr = null;
  stopHoldStream();
  hold.down = false;
  hold.cancel = false;
  hold.chunks = [];
  setRecUI(false);
}

function micDown(e) {
  if (!activeChat || e.button) return;
  e.preventDefault();
  if (hold.down || hold.mr || hold.stream) hardResetHold(); // เคลียร์สถานะที่ค้างจากครั้งก่อน
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast('เบราว์เซอร์นี้ยังบันทึกเสียงไม่ได้', 'error');
  hold.down = true;
  hold.cancel = false;
  hold.startX = e.clientX;
  hold.pressAt = Date.now();
  try { $('mic-btn').setPointerCapture(e.pointerId); } catch (_) { /* ไม่เป็นไร */ }
  startHoldRecording(++hold.token);
}

async function startHoldRecording(token) {
  setRecUI(true);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    if (token === hold.token) hardResetHold();
    return toast('เปิดไมโครโฟนไม่ได้ ถ้าเพิ่งขึ้นหน้าต่างขออนุญาต กดอนุญาตแล้วลองกดค้างใหม่', 'error');
  }
  const waited = Date.now() - hold.pressAt;
  // ปล่อยนิ้วไปแล้ว / กดใหม่ซ้อน / รอนานผิดปกติ (มีหน้าต่างขออนุญาตขึ้นมาคั่น) -> ไม่เริ่มอัด ไม่ค้าง
  if (token !== hold.token || !hold.down || waited > 1500) {
    stream.getTracks().forEach(t => t.stop());
    if (token === hold.token) {
      hardResetHold();
      toast(waited > 1500 ? 'อนุญาตไมโครโฟนแล้ว กดค้างที่ไมค์อีกครั้งเพื่ออัดเสียง'
                          : 'กดค้างที่ไมโครโฟนเพื่ออัดเสียง ปล่อยนิ้วเพื่อส่ง', 'info');
    }
    return;
  }
  hold.stream = stream;
  hold.chunks = [];
  hold.mime = pickAudioMime();
  try {
    hold.mr = new MediaRecorder(stream, hold.mime ? { mimeType: hold.mime } : undefined);
  } catch (e) {
    hardResetHold();
    return toast('เริ่มอัดเสียงไม่ได้ ลองใหม่อีกครั้ง', 'error');
  }
  hold.mr.ondataavailable = ev => { if (ev.data && ev.data.size) hold.chunks.push(ev.data); };
  hold.mr.onstop = onHoldStop;
  hold.t0 = Date.now();
  hold.mr.start();
  if (navigator.vibrate) navigator.vibrate(15);
  clearInterval(hold.timer);
  hold.timer = setInterval(() => {
    const s = (Date.now() - hold.t0) / 1000;
    $('rec-clock').textContent = fmtClock2(s);
    if (s >= 300 && hold.mr && hold.mr.state === 'recording') { hold.down = false; hold.mr.stop(); } // อัดได้สูงสุด 5 นาที
  }, 250);
  // ถ้าปล่อยนิ้วไปแล้วระหว่างที่กำลังเริ่ม ให้หยุดทันที
  if (!hold.down) micUp();
}

function micMove(e) {
  if (!hold.down) return;
  const cancel = e.clientX - hold.startX < -80;
  if (cancel !== hold.cancel) {
    hold.cancel = cancel;
    $('rec-bar').classList.toggle('cancel', cancel);
    $('rec-hint').textContent = cancel ? 'ปล่อยนิ้วเพื่อยกเลิกการอัดเสียง' : 'ปัดไปด้านซ้ายเพื่อยกเลิก หรือปล่อยนิ้วเพื่อส่ง';
  }
}

function micUp() {
  if (!hold.down && !hold.mr) return;
  hold.down = false;
  if (hold.mr && hold.mr.state === 'recording') {
    try { hold.mr.stop(); } catch (e) { hardResetHold(); return; }
    // กันกรณี onstop ไม่ถูกเรียก (เบราว์เซอร์บางตัว)
    clearTimeout(hold.safety);
    hold.safety = setTimeout(() => { if (hold.mr) hardResetHold(); }, 2500);
  } else if (!hold.mr) {
    // ยังรอไมค์/หน้าต่างขออนุญาตอยู่: ถ้านานเกินไปให้ล้างสถานะ
    clearTimeout(hold.safety);
    hold.safety = setTimeout(() => { if (!hold.down && !hold.mr) hardResetHold(); }, 4000);
  }
}

function onHoldStop() {
  clearInterval(hold.timer);
  clearTimeout(hold.safety);
  stopHoldStream();
  setRecUI(false);
  const dur = (Date.now() - hold.t0) / 1000;
  const cancelled = hold.cancel;
  const chunks = hold.chunks;
  const mime = hold.mime;
  hold.mr = null;
  hold.chunks = [];
  hold.cancel = false;
  if (!chunks.length || cancelled) return;
  if (dur < 0.7) return toast('กดค้างที่ไมโครโฟนเพื่ออัดเสียง ปล่อยนิ้วเพื่อส่ง', 'info');
  const type = mime || 'audio/mp4';
  const blob = new Blob(chunks, { type });
  const ext = /webm/.test(type) ? 'webm' : 'm4a';
  const file = new File([blob], `เสียง-${new Date().toLocaleTimeString('th-TH').replace(/:/g, '.')}.${ext}`, { type });
  sendMediaFile(file, { type: 'audio', dur });
}

// แตะแถบอัดเสียงตอนที่ค้าง (ไม่มีนิ้วกดอยู่) = ส่งที่อัดไว้ หรือล้างสถานะ
function recBarTap() {
  if (hold.mr && hold.mr.state === 'recording' && !hold.down) { try { hold.mr.stop(); } catch (e) { hardResetHold(); } }
  else if (!hold.down) hardResetHold();
}

// ---------- เตือนข้อความ / ตั้งเวลาส่ง ----------
let remindTarget = null;
let dueOk = null;

function pad2(n) { return String(n).padStart(2, '0'); }
function toLocalInput(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtWhen(iso) {
  return new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ตัวทำงานตามเวลาบนเซิร์ฟเวอร์ (pg_cron) เปิดอยู่ไหม ถ้าไม่เปิด การเตือนและการส่งตามเวลาจะไม่ทำงาน
async function checkDueActive() {
  if (dueOk === true) return true;
  const { data, error } = await sb.rpc('due_jobs_active');
  dueOk = !error && data === true;
  if (!dueOk) toast('ยังไม่ได้เปิดตัวทำงานตามเวลาบนเซิร์ฟเวอร์ (pg_cron) การเตือนและการส่งตามเวลาจะยังไม่ทำงาน ดูวิธีเปิดในคู่มือ', 'error');
  return dueOk;
}

function fillTimePresets(boxId, inputId) {
  const box = $(boxId);
  box.innerHTML = '';
  const tomorrow9 = new Date(); tomorrow9.setDate(tomorrow9.getDate() + 1); tomorrow9.setHours(9, 0, 0, 0);
  [['10 นาที', 10 * 60000], ['1 ชั่วโมง', 3600000], ['3 ชั่วโมง', 3 * 3600000], ['พรุ่งนี้ 09:00', tomorrow9.getTime() - Date.now()]].forEach(([label, ms]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-chip';
    b.textContent = label;
    b.onclick = () => { $(inputId).value = toLocalInput(new Date(Date.now() + ms)); };
    box.appendChild(b);
  });
  $(inputId).value = toLocalInput(new Date(Date.now() + 3600000));
}

function openRemind(msg) {
  remindTarget = msg;
  $('remind-preview').textContent = snippetOf(msg);
  fillTimePresets('remind-presets', 'remind-at');
  openModal('remind-modal');
}

async function submitRemind() {
  const at = new Date($('remind-at').value);
  if (!remindTarget || isNaN(at) || at.getTime() < Date.now() + 60000) return toast('เลือกเวลาในอนาคต (อย่างน้อย 1 นาที)', 'error');
  const c = activeChat;
  const { error } = await sb.rpc('create_reminder', {
    p_chat: c.id, p_group: !!c.isGroup, p_message: String(remindTarget.id).startsWith('tmp_') ? null : remindTarget.id,
    p_label: `${nameOf(c)}: ${snippetOf(remindTarget)}`, p_at: at.toISOString()
  });
  if (error) return handleDbError(error);
  closeModal('remind-modal');
  toast(`ตั้งเตือนไว้ ${fmtWhen(at)}`, 'success');
  checkDueActive();
}

function openSchedule() {
  closeAttachMenu();
  const text = $('message-input').value.trim();
  if (!text) return toast('พิมพ์ข้อความที่จะส่งก่อน แล้วกด + เลือก "ตั้งเวลาส่งข้อความ"', 'info');
  $('schedule-preview').textContent = text.length > 120 ? text.slice(0, 120) + '…' : text;
  fillTimePresets('schedule-presets', 'schedule-at');
  openModal('schedule-modal');
}

async function submitSchedule() {
  const text = $('message-input').value.trim();
  const at = new Date($('schedule-at').value);
  if (!text || !activeChat) return;
  if (isNaN(at) || at.getTime() < Date.now() + 60000) return toast('เลือกเวลาในอนาคต (อย่างน้อย 1 นาที)', 'error');
  const c = activeChat;
  const { error } = await sb.rpc('schedule_message', { p_chat: c.id, p_group: !!c.isGroup, p_text: text, p_at: at.toISOString() });
  if (error) return handleDbError(error);
  closeModal('schedule-modal');
  $('message-input').value = '';
  autoGrow();
  toast(`ตั้งเวลาส่งไว้ ${fmtWhen(at)}`, 'success');
  checkDueActive();
}

async function openSchedList() {
  const c = activeChat;
  if (!c) return;
  const box = $('sched-list');
  box.innerHTML = '';
  box.appendChild(hintNode('กำลังโหลด…'));
  openModal('sched-modal');

  const sm = sb.from('scheduled_messages').select('id, text, send_at').order('send_at');
  const [rem, sch] = await Promise.all([
    sb.from('reminders').select('id, label, remind_at').eq('chat_id', c.id).order('remind_at'),
    c.isGroup ? sm.eq('group_id', c.id) : sm.eq('receiver_id', c.id)
  ]);
  box.innerHTML = '';
  const title = t => { const d = document.createElement('div'); d.className = 'list-title'; d.textContent = t; box.appendChild(d); };
  const card = (head, body, onCancel) => {
    const el = document.createElement('div');
    el.className = 'req-card';
    const h = document.createElement('div'); h.className = 'hint'; h.style.marginTop = '0'; h.textContent = head;
    const t = document.createElement('div'); t.className = 'pin-text'; t.textContent = body;
    const acts = document.createElement('div'); acts.className = 'req-actions';
    acts.appendChild(chip('ยกเลิก', onCancel, 'danger'));
    el.append(h, t, acts);
    box.appendChild(el);
  };
  const rems = rem.data || [], schs = sch.data || [];
  if (!rems.length && !schs.length) { box.appendChild(hintNode('ยังไม่มีการเตือนหรือข้อความที่ตั้งเวลาส่งในห้องนี้')); return; }
  if (rems.length) {
    title('การเตือน');
    rems.forEach(r => card('⏰ ' + fmtWhen(r.remind_at), r.label, async () => { await sb.from('reminders').delete().eq('id', r.id); openSchedList(); }));
  }
  if (schs.length) {
    title('ข้อความที่ตั้งเวลาส่ง');
    schs.forEach(m => card('🕒 ส่ง ' + fmtWhen(m.send_at), m.text, async () => { await sb.from('scheduled_messages').delete().eq('id', m.id); openSchedList(); }));
  }
}

// ---------- ชื่อสุ่มเฉพาะกลุ่มในกลุ่มไม่แสดงตัวตน ----------
function renderAliasRow(g) {
  const row = $('gi-alias');
  if (!g.anonymous) { row.classList.add('hidden-element'); return; }
  $('gi-alias-name').textContent = g.aliases[currentUser.id] || currentUser.nickname || '';
  row.classList.remove('hidden-element');
}

function openAlias() {
  const g = state.groups[groupTargetId];
  if (!g) return;
  $('alias-input').value = g.aliases[currentUser.id] || '';
  openModal('alias-modal');
}

async function afterAliasChange() {
  try { await loadGroups(); } catch (e) { /* ไม่เป็นไร */ }
  renderGroupInfo();
  loadChatList();
  if (activeChat) loadMessages(true);
}

async function saveAlias() {
  const alias = $('alias-input').value.trim();
  if (!alias) return toast('กรุณาใส่ชื่อ', 'error');
  const { error } = await sb.rpc('set_group_alias', { p_group: groupTargetId, p_alias: alias });
  if (error) return handleDbError(error);
  closeModal('alias-modal');
  toast('เปลี่ยนชื่อในกลุ่มแล้ว', 'success');
  afterAliasChange();
}

async function randomAlias() {
  const { error } = await sb.rpc('randomize_group_alias', { p_group: groupTargetId });
  if (error) return handleDbError(error);
  await afterAliasChange();
  const g = state.groups[groupTargetId];
  if (g) $('alias-input').value = g.aliases[currentUser.id] || '';
}

// ==================== เฟส D5: ล็อกหน้าจออัตโนมัติ + ปุ่มประตู, การ์ดในแชท (โพลล์ นัดหมาย ตำแหน่ง) ====================

// ---------- ล็อกหน้าจอ: กดปุ่มรูปประตู หรือไม่ได้ใช้งานครบเวลา ----------
let lastActivity = Date.now();
let idleLoop = null;

function idleKey() { return 'darkchat_idle_' + currentUser.id; }

function idleSeconds() {
  const v = localStorage.getItem(idleKey());
  return v === null ? 30 : (parseInt(v, 10) || 0); // ค่าเริ่มต้น 30 วินาที
}

function setIdleLock(v) {
  const secs = parseInt(v, 10) || 0;
  localStorage.setItem(idleKey(), String(secs));
  lastActivity = Date.now();
  toast(secs ? `ล็อกอัตโนมัติเมื่อไม่ได้ใช้งาน ${fmtDuration(secs)}` : 'ปิดการล็อกอัตโนมัติเมื่อไม่ได้ใช้งานแล้ว', 'success');
}

function markActive() { lastActivity = Date.now(); }

function lockNow(auto) {
  if (!currentUser || pinIsOpen()) return;
  if (!pinEnabled(currentUser.id) || !hasPin(currentUser.id)) {
    if (!auto) toast('ยังไม่ได้เปิดการล็อกด้วย PIN เปิดได้ที่ตั้งค่า > ล็อกแอปด้วย PIN', 'info');
    return;
  }
  // ปิดทุกอย่างที่อาจค้างอยู่บนหน้าจอ (หน้าต่าง ตัวดูรูป วิดีโอ กล่องยืนยัน)
  try { closeMediaViewer(); } catch (e) { /* ไม่เป็นไร */ }
  if (confirmResolve) answerConfirm(false);
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden-element'));
  toggleGearMenu(false);
  closeAttachMenu();
  if (hold.down || hold.mr) hardResetHold();
  unlockedRooms.clear();
  if (activeChat && isRoomLocked(activeChat.id)) backToList();
  showPin('unlock', currentUser, () => { lastActivity = Date.now(); if (activeChat) markRead(activeChat.id); });
}

function startIdleWatcher() {
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(t =>
    document.addEventListener(t, markActive, { passive: true, capture: true }));
  clearInterval(idleLoop);
  idleLoop = setInterval(() => {
    if (!currentUser || pinIsOpen()) { lastActivity = Date.now(); return; }
    const secs = idleSeconds();
    if (!secs || !pinEnabled(currentUser.id) || !hasPin(currentUser.id)) return;
    if (Date.now() - lastActivity < secs * 1000) return;
    // ไม่ล็อกระหว่างอัดเสียง หรือกำลังเล่นวิดีโอ/เสียงอยู่
    if (hold.down || hold.mr) { lastActivity = Date.now(); return; }
    if ([...document.querySelectorAll('video, audio')].some(m => !m.paused && !m.ended)) { lastActivity = Date.now(); return; }
    lockNow(true);
  }, 2000);
}

// ---------- การ์ดในแชท: โพลล์ / นัดหมาย / ตำแหน่ง ----------
function cardMeta(msg) { return msg.rmeta || {}; }

async function showPostedCard(chat, id) {
  const { data } = await sb.from('messages').select('*').eq('id', id).maybeSingle();
  if (!data) return;
  addLocal(chat.id, toLocal(data));
  if (activeChat && activeChat.id === chat.id) loadMessages();
  loadChatList();
}

async function loadCards(chat) {
  const ids = (state.messages[chat.id] || [])
    .filter(m => m.kind === 'card' && !String(m.id).startsWith('tmp_')).map(m => m.id);
  if (!ids.length) return;
  state.polls = state.polls || {};
  state.rsvps = state.rsvps || {};
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    const [v, r] = await Promise.all([
      sb.from('poll_votes').select('message_id, user_id, option_idx').in('message_id', slice),
      sb.from('event_rsvps').select('message_id, user_id, status').in('message_id', slice)
    ]);
    if (v.error || r.error) return;
    slice.forEach(id => { delete state.polls[id]; delete state.rsvps[id]; });
    (v.data || []).forEach(x => {
      (state.polls[x.message_id] || (state.polls[x.message_id] = [])).push({ uid: x.user_id, idx: x.option_idx });
    });
    (r.data || []).forEach(x => {
      (state.rsvps[x.message_id] || (state.rsvps[x.message_id] = {}))[x.user_id] = x.status;
    });
  }
  if (activeChat && activeChat.id === chat.id) loadMessages(true);
}

function onCardChange(payload) {
  if (!currentUser) return;
  state.polls = state.polls || {};
  state.rsvps = state.rsvps || {};
  const t = payload.table;
  const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
  if (!row || !row.message_id) return;
  if (t === 'poll_votes') {
    const list = state.polls[row.message_id] || (state.polls[row.message_id] = []);
    const k = list.findIndex(v => v.uid === row.user_id && v.idx === row.option_idx);
    if (payload.eventType === 'DELETE') { if (k >= 0) list.splice(k, 1); }
    else if (k < 0) list.push({ uid: row.user_id, idx: row.option_idx });
  } else if (t === 'event_rsvps') {
    const m = state.rsvps[row.message_id] || (state.rsvps[row.message_id] = {});
    if (payload.eventType === 'DELETE') delete m[row.user_id]; else m[row.user_id] = row.status;
  }
  if (activeChat && (state.messages[activeChat.id] || []).some(x => x.id === row.message_id)) loadMessages(true);
}

function buildCardEl(msg) {
  const meta = cardMeta(msg);
  const wrap = document.createElement('div');
  wrap.className = 'card card-' + (meta.card || 'x');
  // กดปุ่มในการ์ดต้องไม่เปิดเมนูข้อความ
  wrap.addEventListener('pointerdown', e => { if (e.target.closest('button')) e.stopPropagation(); });

  const title = (t) => { const d = document.createElement('div'); d.className = 'card-title'; d.textContent = t; return d; };
  const sub = (t) => { const d = document.createElement('div'); d.className = 'card-sub'; d.textContent = t; return d; };

  if (meta.card === 'poll') {
    const votes = (state.polls && state.polls[msg.id]) || [];
    const total = new Set(votes.map(v => v.uid)).size;
    const mine = votes.filter(v => v.uid === currentUser.id).map(v => v.idx);
    wrap.append(title('📊 ' + (meta.q || 'โพลล์')),
      sub((meta.multi ? 'เลือกได้หลายข้อ' : 'เลือกได้ 1 ข้อ') + ` · ${total} คนโหวต`));
    (meta.options || []).forEach((label, i) => {
      const n = votes.filter(v => v.idx === i).length;
      const pct = total ? Math.round(n * 100 / total) : 0;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'poll-opt' + (mine.includes(i) ? ' mine' : '');
      const bar = document.createElement('span');
      bar.className = 'poll-bar';
      bar.style.width = pct + '%';
      const l = document.createElement('span');
      l.className = 'poll-label';
      l.textContent = (mine.includes(i) ? '✓ ' : '') + label;
      const c = document.createElement('span');
      c.className = 'poll-count';
      c.textContent = n;
      b.append(bar, l, c);
      b.onclick = () => votePoll(msg, i);
      wrap.appendChild(b);
    });
  } else if (meta.card === 'event') {
    const at = meta.at ? new Date(meta.at) : null;
    wrap.appendChild(title('📅 ' + (meta.title || 'นัดหมาย')));
    if (at) wrap.appendChild(sub(at.toLocaleString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })));
    if (meta.place) wrap.appendChild(sub('📍 ' + meta.place));
    const rs = (state.rsvps && state.rsvps[msg.id]) || {};
    const row = document.createElement('div');
    row.className = 'card-actions';
    [['going', 'ไป'], ['maybe', 'อาจจะ'], ['no', 'ไม่ไป']].forEach(([key, label]) => {
      const n = Object.values(rs).filter(x => x === key).length;
      row.appendChild(chip(`${label}${n ? ' ' + n : ''}`, () => rsvpEvent(msg, key), rs[currentUser.id] === key ? 'primary' : ''));
    });
    wrap.appendChild(row);
    if (at) {
      const cal = document.createElement('div');
      cal.className = 'card-actions';
      cal.appendChild(chip('เพิ่มลงปฏิทิน', () => downloadIcs(meta)));
      wrap.appendChild(cal);
    }
  } else if (meta.card === 'location') {
    wrap.appendChild(title('📍 ' + (meta.label || 'ตำแหน่งที่ตั้ง')));
    wrap.appendChild(sub(`${meta.lat}, ${meta.lng}`));
    const row = document.createElement('div');
    row.className = 'card-actions';
    row.appendChild(chip('ดูแผนที่', () => openMapView(meta.lat, meta.lng, meta.label), 'primary'));
    row.appendChild(chip('เปิดในแอปแผนที่', () => window.open(`https://maps.google.com/?q=${meta.lat},${meta.lng}`, '_blank', 'noopener')));
    wrap.appendChild(row);
  } else if (meta.card === 'live') {
    buildLiveCard(wrap, msg, title, sub);
  } else {
    wrap.appendChild(title(msg.text || 'การ์ด'));
  }
  return wrap;
}

async function votePoll(msg, idx) {
  const meta = cardMeta(msg);
  state.polls = state.polls || {};
  const prev = state.polls[msg.id] || [];
  const me = currentUser.id;
  const mine = prev.filter(v => v.uid === me).map(v => v.idx);
  let next;
  if (meta.multi) next = mine.includes(idx) ? mine.filter(i => i !== idx) : [...mine, idx];
  else next = mine.includes(idx) ? [] : [idx];
  state.polls[msg.id] = prev.filter(v => v.uid !== me).concat(next.map(i => ({ uid: me, idx: i })));
  loadMessages(true);
  const { error } = await sb.rpc('vote_poll', { p_message: msg.id, p_options: next });
  if (error) { state.polls[msg.id] = prev; loadMessages(true); handleDbError(error); }
}

async function rsvpEvent(msg, status) {
  state.rsvps = state.rsvps || {};
  const m = state.rsvps[msg.id] || (state.rsvps[msg.id] = {});
  const me = currentUser.id;
  const prev = m[me];
  const next = prev === status ? null : status;
  if (next) m[me] = next; else delete m[me];
  loadMessages(true);
  const { error } = await sb.rpc('rsvp_event', { p_message: msg.id, p_status: next });
  if (error) { if (prev) m[me] = prev; else delete m[me]; loadMessages(true); handleDbError(error); }
}

function downloadIcs(meta) {
  const d = new Date(meta.at);
  const fmt = x => x.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = t => String(t || '').replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DarkChat//TH', 'BEGIN:VEVENT',
    'UID:' + Date.now() + '@darkchat', 'DTSTAMP:' + fmt(new Date()),
    'DTSTART:' + fmt(d), 'DTEND:' + fmt(new Date(d.getTime() + 3600000)),
    'SUMMARY:' + esc(meta.title), meta.place ? 'LOCATION:' + esc(meta.place) : '',
    'END:VEVENT', 'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'นัดหมาย.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

// ----- สร้างโพลล์ -----
function addPollOption() {
  const box = $('poll-options');
  if (box.children.length >= 8) return toast('ใส่ได้สูงสุด 8 ตัวเลือก', 'info');
  const i = document.createElement('input');
  i.type = 'text';
  i.className = 'plain-input poll-opt-input';
  i.maxLength = 80;
  i.placeholder = `ตัวเลือก ${box.children.length + 1}`;
  box.appendChild(i);
}

function openPollModal() {
  closeAttachMenu();
  $('poll-q').value = '';
  $('poll-options').innerHTML = '';
  addPollOption();
  addPollOption();
  $('poll-multi').checked = false;
  openModal('poll-modal');
}

async function submitPoll() {
  const q = $('poll-q').value.trim();
  const opts = [...$('poll-options').children].map(i => i.value.trim()).filter(Boolean);
  if (!q || opts.length < 2) return toast('ใส่คำถามและตัวเลือกอย่างน้อย 2 ข้อ', 'error');
  const c = activeChat;
  const { data, error } = await sb.rpc('create_poll', { p_chat: c.id, p_group: !!c.isGroup, p_question: q, p_options: opts, p_multi: $('poll-multi').checked });
  if (error) return handleDbError(error);
  closeModal('poll-modal');
  showPostedCard(c, data);
}

// ----- สร้างนัดหมาย -----
function openEventModal() {
  closeAttachMenu();
  $('event-title').value = '';
  $('event-place').value = '';
  $('event-at').value = toLocalInput(new Date(Date.now() + 24 * 3600000));
  openModal('event-modal');
}

async function submitEvent() {
  const title = $('event-title').value.trim();
  const at = new Date($('event-at').value);
  if (!title || isNaN(at)) return toast('ใส่ชื่อนัดหมายและวันเวลา', 'error');
  const c = activeChat;
  const { data, error } = await sb.rpc('create_event', {
    p_chat: c.id, p_group: !!c.isGroup, p_title: title, p_at: at.toISOString(), p_place: $('event-place').value.trim()
  });
  if (error) return handleDbError(error);
  closeModal('event-modal');
  showPostedCard(c, data);
}

// ----- ส่งตำแหน่งที่ตั้ง -----
function shareLocation() {
  closeAttachMenu();
  if (!navigator.geolocation) return toast('อุปกรณ์นี้ไม่รองรับการแชร์ตำแหน่ง', 'error');
  const c = activeChat;
  toast('กำลังหาตำแหน่งของคุณ…', 'info');
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = Math.round(pos.coords.latitude * 1e4) / 1e4;
    const lng = Math.round(pos.coords.longitude * 1e4) / 1e4;
    const ok = await confirmDialog('ส่งตำแหน่งที่ตั้ง', `ส่งตำแหน่งปัจจุบันของคุณ (ประมาณ ${lat}, ${lng}) ให้ ${nameOf(c)} ใช่หรือไม่?`, 'ส่ง');
    if (!ok) return;
    const { data, error } = await sb.rpc('share_location', { p_chat: c.id, p_group: !!c.isGroup, p_lat: lat, p_lng: lng, p_label: 'ตำแหน่งปัจจุบันของฉัน' });
    if (error) return handleDbError(error);
    showPostedCard(c, data);
  }, () => toast('หาตำแหน่งไม่ได้ ตรวจสอบสิทธิ์ตำแหน่งของเบราว์เซอร์', 'error'),
  { enableHighAccuracy: true, timeout: 12000 });
}

// ==================== รอบ A+B: ร่างข้อความต่อห้อง, สื่อของห้อง, สติ๊กเกอร์ ====================

// ---------- ร่างข้อความที่พิมพ์ค้างไว้ (เก็บในเครื่อง แยกตามห้อง) ----------
let draftTimer = null;

function draftKey() { return 'darkchat_draft_' + currentUser.id; }
function getDrafts() { try { return JSON.parse(localStorage.getItem(draftKey()) || '{}'); } catch (e) { return {}; } }
function draftOf(chatId) {
  if (!currentUser) return null;
  const d = getDrafts()[chatId];
  return d && d.text && d.text.trim() ? d : null;
}

function saveDraftNow() {
  clearTimeout(draftTimer);
  if (!currentUser || !activeChat || composer.type === 'edit') return;
  const text = $('message-input').value;
  const all = getDrafts();
  if (text.trim()) all[activeChat.id] = { text: text.slice(0, 1000), ts: Date.now() };
  else delete all[activeChat.id];
  // เก็บไม่เกิน 200 ห้อง (ตัดอันเก่าสุดออก)
  const keys = Object.keys(all);
  if (keys.length > 200) keys.sort((a, b) => all[a].ts - all[b].ts).slice(0, keys.length - 200).forEach(k => delete all[k]);
  try { localStorage.setItem(draftKey(), JSON.stringify(all)); } catch (e) { /* ไม่เป็นไร */ }
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, 400);
}

function restoreDraft(chat) {
  const input = $('message-input');
  if (composer.type === 'edit') return;
  const d = draftOf(chat.id);
  input.value = d ? d.text : '';
  autoGrow();
}

// ---------- สื่อของห้อง (รูป วิดีโอ ไฟล์ เสียง ลิงก์) ----------
const rm = { chat: null, tab: 'visual', items: [], page: 0, done: false, loading: false, sel: false, picked: new Set(), token: 0 };
const RM_TABS = [['visual', 'รูปและวิดีโอ'], ['file', 'ไฟล์'], ['audio', 'เสียง'], ['links', 'ลิงก์']];

function renderRmTabs() {
  const box = $('rm-tabs');
  box.innerHTML = '';
  RM_TABS.forEach(([key, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-chip' + (rm.tab === key ? ' active' : '');
    b.textContent = label;
    b.onclick = () => setRmTab(key);
    box.appendChild(b);
  });
  $('rm-select-btn').classList.toggle('hidden-element', rm.tab === 'links');
  $('rm-select-btn').textContent = rm.sel ? 'เสร็จ' : 'เลือก';
}

async function openRoomMedia() {
  if (!activeChat) return;
  rm.chat = activeChat; rm.tab = 'visual'; rm.sel = false; rm.picked = new Set(); rm.loading = false;
  renderRmTabs();
  $('rm-stats').textContent = '';
  openModal('room-media-modal');
  loadRoomStats();
  await loadRoomMedia(true);
}

function closeRoomMedia() {
  closeModal('room-media-modal');
  rm.items = [];
  rm.chat = null;
  rm.token++;
  $('rm-body').innerHTML = '';
}

function setRmTab(t) {
  rm.tab = t; rm.sel = false; rm.picked = new Set();
  renderRmTabs();
  loadRoomMedia(true);
}

async function loadRoomStats() {
  const c = rm.chat;
  if (!c) return;
  const { data } = await sb.rpc('room_media_stats', { p_chat: c.id, p_group: !!c.isGroup });
  if (!data || rm.chat !== c) return;
  const by = {};
  data.forEach(r => { by[r.kind] = r; });
  const n = k => (by[k] ? Number(by[k].cnt) : 0);
  const bytes = data.reduce((a, r) => a + Number(r.bytes), 0);
  $('rm-stats').textContent = `รูป ${n('image')} · วิดีโอ ${n('video')} · ไฟล์ ${n('file')} · เสียง ${n('audio')} · พื้นที่รวม ${fmtSize(bytes)}`;
}

async function loadRoomMedia(reset) {
  const c = rm.chat;
  if (!c) return;
  if (reset) {
    rm.items = []; rm.page = 0; rm.done = false;
    $('rm-body').innerHTML = '';
    $('rm-body').appendChild(hintNode('กำลังโหลด…'));
    rm.loading = false;
  }
  if (rm.loading || rm.done) return;
  rm.loading = true;
  const token = ++rm.token;
  const me = currentUser.id;
  const PAGE = 60;
  let q = sb.from('messages').select('*').order('created_at', { ascending: false })
    .range(rm.page * PAGE, rm.page * PAGE + PAGE - 1);
  if (rm.tab === 'links') q = q.is('media', null).ilike('text', '%http%').neq('kind', 'system');
  else {
    q = q.not('media', 'is', null);
    q = rm.tab === 'visual' ? q.in('media->>type', ['image', 'video']) : q.eq('media->>type', rm.tab);
  }
  q = c.isGroup
    ? q.eq('group_id', c.id)
    : q.or(`and(sender_id.eq.${me},receiver_id.eq.${c.id}),and(sender_id.eq.${c.id},receiver_id.eq.${me})`);
  const { data, error } = await q;
  rm.loading = false;
  if (token !== rm.token || rm.chat !== c) return;
  if (error) { $('rm-body').innerHTML = ''; return handleDbError(error); }
  rm.page++;
  if ((data || []).length < PAGE) rm.done = true;
  const now = Date.now();
  const rows = (data || []).map(toLocal).filter(m =>
    !social.hidden.has(m.id) &&
    !(social.cleared[c.id] && m.ts <= social.cleared[c.id]) &&
    !(m.expiresAt && m.expiresAt <= now) &&
    !(m.media && m.media.expired) &&
    !(c.isGroup && !m.isMe && social.blocked.has(m.senderId)));
  rm.items.push(...rows);
  renderRoomMedia();
}

function renderRoomMedia() {
  const body = $('rm-body');
  const keep = body.scrollTop;
  body.innerHTML = '';
  $('rm-more').classList.toggle('hidden-element', rm.done || !rm.items.length);
  if (!rm.items.length) { body.appendChild(hintNode('ยังไม่มีรายการในหมวดนี้')); updateRmActions(); return; }

  if (rm.tab === 'visual') {
    const grid = document.createElement('div');
    grid.className = 'rm-grid';
    rm.items.forEach(m => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'rm-cell' + (rm.picked.has(m.id) ? ' picked' : '');
      cell.appendChild(albumThumb(m.media));
      if (m.media.type === 'video') {
        const pl = document.createElement('span');
        pl.className = 'rm-play';
        pl.textContent = '▶';
        cell.appendChild(pl);
      }
      if (rm.sel) {
        const ck = document.createElement('span');
        ck.className = 'rm-check';
        ck.textContent = rm.picked.has(m.id) ? '✓' : '';
        cell.appendChild(ck);
      }
      cell.onclick = () => (rm.sel ? togglePick(m.id) : openRoomGallery(m.id));
      grid.appendChild(cell);
    });
    body.appendChild(grid);
  } else {
    rm.items.forEach(m => {
      const row = document.createElement('div');
      row.className = 'rm-row' + (rm.picked.has(m.id) ? ' picked' : '');
      const info = document.createElement('div');
      info.className = 'rm-info';
      const head = document.createElement('strong');
      const sub = document.createElement('span');
      const who = m.isMe ? 'คุณ' : senderLabel(rm.chat, m);
      sub.textContent = `${who} · ${dividerLabel(m.ts)}`;
      if (rm.tab === 'links') {
        const urls = (m.text.match(/https?:\/\/[^\s<>"']+/gi) || []);
        head.textContent = urls[0] || m.text;
        row.onclick = () => { if (urls[0]) window.open(urls[0], '_blank', 'noopener'); };
        info.append(head, sub);
        row.appendChild(info);
      } else if (rm.tab === 'audio') {
        head.textContent = `🎤 ${m.media.dur ? fmtClock2(m.media.dur) : 'คลิปเสียง'}`;
        const a = document.createElement('audio');
        a.controls = true; a.preload = 'none'; a.className = 'media-audio-el';
        a.addEventListener('click', e => e.stopPropagation());
        getMediaUrl(m.media.path).then(u => { if (u) a.src = u; });
        info.append(head, sub, a);
        row.appendChild(info);
        if (rm.sel) row.onclick = () => togglePick(m.id);
      } else {
        const ico = document.createElement('span');
        ico.className = 'media-file-ico';
        ico.textContent = '📎';
        head.textContent = m.media.name || 'ไฟล์';
        sub.textContent = `${fmtSize(m.media.size || 0)} · ${who} · ${dividerLabel(m.ts)}`;
        info.append(head, sub);
        row.append(ico, info);
        row.onclick = () => (rm.sel ? togglePick(m.id) : saveMedia(m.media));
      }
      if (rm.sel && rm.tab !== 'links') {
        const ck = document.createElement('span');
        ck.className = 'rm-check inline';
        ck.textContent = rm.picked.has(m.id) ? '✓' : '';
        row.appendChild(ck);
      }
      body.appendChild(row);
    });
  }
  updateRmActions();
  body.scrollTop = keep;
}

function openRoomGallery(id) {
  const items = rm.items.map(x => Object.assign({}, x.media, { mid: x.id, mts: x.ts }));
  const idx = rm.items.findIndex(x => x.id === id);
  if (idx >= 0) openGallery(items, idx);
}

function gotoFromViewer() {
  const m = gal.items[gal.idx];
  if (!m || !m.mid) return;
  closeMediaViewer();
  closeRoomMedia();
  jumpToMessage({ id: m.mid, ts: m.mts });
}

function toggleRoomMediaSelect() {
  rm.sel = !rm.sel;
  rm.picked = new Set();
  $('rm-select-btn').textContent = rm.sel ? 'เสร็จ' : 'เลือก';
  renderRoomMedia();
}

function togglePick(id) {
  if (rm.picked.has(id)) rm.picked.delete(id); else rm.picked.add(id);
  renderRoomMedia();
}

function updateRmActions() {
  const on = rm.sel && rm.tab !== 'links';
  $('rm-actions').classList.toggle('hidden-element', !on);
  $('rm-save').textContent = `บันทึก (${rm.picked.size})`;
  $('rm-save').disabled = rm.picked.size === 0;
}

async function saveRoomMediaPicked() {
  const medias = rm.items.filter(x => rm.picked.has(x.id)).map(x => x.media);
  if (medias.length) await saveMediaMany(medias);
}

async function deleteRoomMediaPicked() {
  const ids = [...rm.picked];
  if (!ids.length) return;
  const ok = await confirmDialog('ลบรายการ', `ลบ ${ids.length} รายการออกจากแชทของคุณ?\nอีกฝั่งยังเห็นอยู่`, 'ลบ', true);
  if (!ok) return;
  const { error } = await sb.from('hidden_messages').insert(ids.map(id => ({ message_id: id })));
  if (error) return handleDbError(error);
  ids.forEach(id => social.hidden.add(id));
  rm.items = rm.items.filter(x => !rm.picked.has(x.id));
  rm.picked = new Set();
  renderRoomMedia();
  if (activeChat) loadMessages(true);
  toast(`ลบ ${ids.length} รายการแล้ว (เฉพาะฝั่งคุณ)`, 'success');
}

// ---------- สติ๊กเกอร์ (วาดเอง เป็นภาพเวกเตอร์ ไม่ใช้พื้นที่ Storage) ----------
const STK_FACES = [
  { id: 'ok', cap: 'โอเค', eyes: 'dot', mouth: 'smile', extra: 'spark' },
  { id: 'thx', cap: 'ขอบคุณ', eyes: 'happy', mouth: 'open', extra: 'heart' },
  { id: 'love', cap: 'รักนะ', eyes: 'heart', mouth: 'smile', extra: 'heart' },
  { id: 'lol', cap: '555', eyes: 'happy', mouth: 'laugh', extra: 'sweat' },
  { id: 'sleep', cap: 'ง่วง', eyes: 'closed', mouth: 'flat', extra: 'zzz' },
  { id: 'hungry', cap: 'หิว', eyes: 'dot', mouth: 'drool', extra: '' },
  { id: 'cry', cap: 'ฮือๆ', eyes: 'sad', mouth: 'wobble', extra: 'tear' },
  { id: 'angry', cap: 'โมโห', eyes: 'angry', mouth: 'frown', extra: 'anger' },
  { id: 'what', cap: 'งง', eyes: 'dot', mouth: 'o', extra: 'question' },
  { id: 'cheer', cap: 'สู้ๆ', eyes: 'star', mouth: 'smile', extra: 'star' },
  { id: 'night', cap: 'ราตรีสวัสดิ์', eyes: 'closed', mouth: 'smile', extra: 'zzz' },
  { id: 'hi', cap: 'สวัสดี', eyes: 'happy', mouth: 'open', extra: 'spark' }
];
const STK_PACKS = [
  { id: 'blob', name: 'ก้อนกลม', color: '#a78bfa', shade: '#7c3aed', shape: 'blob' },
  { id: 'cat', name: 'แมวส้ม', color: '#fdba74', shade: '#ea580c', shape: 'cat' },
  { id: 'bear', name: 'หมีน้อย', color: '#d6a77a', shade: '#92400e', shape: 'bear' }
];

function stkEyes(kind) {
  const ink = '#2d2a3a', y = 80;
  const dot = x => `<circle cx="${x}" cy="${y}" r="5.5" fill="${ink}"/><circle cx="${x + 1.8}" cy="${y - 2}" r="1.8" fill="#fff"/>`;
  const arc = x => `<path d="M${x - 7} ${y + 3} q7 -12 14 0" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`;
  const line = x => `<path d="M${x - 7} ${y} h14" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`;
  const heart = x => `<path d="M${x} ${y + 8} c-13 -9 -9 -19 0 -12 c9 -7 13 3 0 12z" fill="#ef4444"/>`;
  const star = x => `<path d="M${x} ${y - 9} l2.6 5.4 5.9 .8 -4.3 4.1 1 5.9 -5.2 -2.8 -5.2 2.8 1 -5.9 -4.3 -4.1 5.9 -.8z" fill="#facc15" stroke="#ca8a04" stroke-width="1"/>`;
  const brow = (x, kindB) => {
    const s = x < 80 ? 1 : -1;
    return kindB === 'sad'
      ? `<path d="M${x - 8 * s} ${y - 8} L${x + 6 * s} ${y - 15}" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`
      : `<path d="M${x - 8 * s} ${y - 15} L${x + 6 * s} ${y - 8}" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`;
  };
  const f = { dot, happy: arc, closed: line, heart, star,
    sad: x => dot(x) + brow(x, 'sad'), angry: x => dot(x) + brow(x, 'angry') }[kind] || dot;
  return f(62) + f(98);
}

function stkMouth(kind) {
  const ink = '#2d2a3a';
  const smile = `<path d="M68 98 q12 12 24 0" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`;
  return {
    smile,
    open: `<path d="M68 96 q12 20 24 0z" fill="#7f1d1d" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/><path d="M73 104 q7 6 14 0" fill="#f87171"/>`,
    laugh: `<path d="M62 94 q18 30 36 0z" fill="#7f1d1d" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/><path d="M70 106 q10 8 20 0" fill="#f87171"/>`,
    flat: `<path d="M72 102 h16" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`,
    drool: smile + `<path d="M88 104 q5 8 0 13 q-5 -5 0 -13z" fill="#7dd3fc"/>`,
    wobble: `<path d="M64 106 q4 -8 8 0 t8 0 t8 0 t8 0" fill="none" stroke="${ink}" stroke-width="3.2" stroke-linecap="round"/>`,
    frown: `<path d="M68 108 q12 -12 24 0" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`,
    o: `<ellipse cx="80" cy="103" rx="5" ry="6.5" fill="#7f1d1d" stroke="${ink}" stroke-width="3"/>`
  }[kind] || smile;
}

function stkExtra(kind) {
  return {
    heart: '<path d="M128 46 c-15 -11 -10 -24 0 -15 c10 -9 15 4 0 15z" fill="#ef4444"/><path d="M142 30 c-8 -6 -5 -13 0 -8 c5 -5 8 2 0 8z" fill="#fb7185"/>',
    spark: '<path d="M128 24 l3.2 9.5 9.5 3.2 -9.5 3.2 -3.2 9.5 -3.2 -9.5 -9.5 -3.2 9.5 -3.2z" fill="#facc15"/>',
    star: '<path d="M128 26 l4 8.4 9.2 1.3 -6.7 6.4 1.6 9.1 -8.1 -4.3 -8.1 4.3 1.6 -9.1 -6.7 -6.4 9.2 -1.3z" fill="#facc15" stroke="#ca8a04" stroke-width="1.5"/>',
    sweat: '<path d="M124 52 q9 13 0 19 q-9 -6 0 -19z" fill="#7dd3fc" stroke="#0ea5e9" stroke-width="1.5"/>',
    zzz: '<text x="114" y="46" font-size="22" font-weight="800" fill="#6366f1" font-family="system-ui,sans-serif">Z</text><text x="132" y="28" font-size="15" font-weight="800" fill="#818cf8" font-family="system-ui,sans-serif">z</text>',
    tear: '<path d="M55 92 q-6 13 0 15 q6 -2 0 -15z" fill="#7dd3fc"/><path d="M105 92 q-6 13 0 15 q6 -2 0 -15z" fill="#7dd3fc"/>',
    anger: '<path d="M118 28 l13 13 M131 28 l-13 13" stroke="#ef4444" stroke-width="5.5" stroke-linecap="round"/>',
    question: '<text x="116" y="48" font-size="36" font-weight="800" fill="#7c3aed" font-family="system-ui,sans-serif">?</text>'
  }[kind] || '';
}

function stickerSvg(packId, faceId) {
  const pack = STK_PACKS.find(p => p.id === packId);
  const face = STK_FACES.find(f => f.id === faceId);
  if (!pack || !face) return '';
  const { color, shade } = pack;
  let ears = '';
  if (pack.shape === 'cat') {
    ears = `<path d="M32 58 L38 16 L68 40z" fill="${color}" stroke="${shade}" stroke-width="3" stroke-linejoin="round"/><path d="M128 58 L122 16 L92 40z" fill="${color}" stroke="${shade}" stroke-width="3" stroke-linejoin="round"/><path d="M42 44 L44 28 L58 40z" fill="#fda4af"/><path d="M118 44 L116 28 L102 40z" fill="#fda4af"/>`;
  } else if (pack.shape === 'bear') {
    ears = `<circle cx="38" cy="42" r="17" fill="${color}" stroke="${shade}" stroke-width="3"/><circle cx="122" cy="42" r="17" fill="${color}" stroke="${shade}" stroke-width="3"/><circle cx="38" cy="42" r="8" fill="#fcd9b6"/><circle cx="122" cy="42" r="8" fill="#fcd9b6"/>`;
  }
  const whiskers = pack.shape === 'cat'
    ? `<path d="M34 96 l-16 -4 M34 104 l-16 4 M126 96 l16 -4 M126 104 l16 4" stroke="${shade}" stroke-width="2.5" stroke-linecap="round"/>` : '';
  const snout = pack.shape === 'bear' ? '<ellipse cx="80" cy="100" rx="17" ry="12" fill="#fcd9b6" opacity=".7"/>' : '';
  const cap = face.cap.length > 8 ? 16 : face.cap.length > 5 ? 19 : 23;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
${ears}<ellipse cx="80" cy="84" rx="54" ry="50" fill="${color}" stroke="${shade}" stroke-width="3.5"/>
<ellipse cx="62" cy="58" rx="16" ry="9" fill="#fff" opacity=".28"/>${snout}
<circle cx="46" cy="96" r="8" fill="#fb7185" opacity=".35"/><circle cx="114" cy="96" r="8" fill="#fb7185" opacity=".35"/>
${stkEyes(face.eyes)}${stkMouth(face.mouth)}${whiskers}${stkExtra(face.extra)}
<text x="80" y="153" text-anchor="middle" font-family="'Noto Sans Thai','Sarabun','Thonburi',system-ui,sans-serif" font-size="${cap}" font-weight="800" fill="#fff" stroke="#3b2f63" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${face.cap}</text>
</svg>`;
}

const stkCache = {};
function stickerUri(code) {
  code = String(code || '');
  if (STK_FILE_RE.test(code)) return 'stickers/' + code;   // ไฟล์ในโฟลเดอร์ stickers
  if (stkCache[code]) return stkCache[code];
  const [p, f] = String(code).split(':');
  const svg = stickerSvg(p, f);
  if (!svg) return '';
  stkCache[code] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return stkCache[code];
}

function stkRecentKey() { return 'darkchat_stk_recent_' + currentUser.id; }
function getStkRecent() { try { return JSON.parse(localStorage.getItem(stkRecentKey()) || '[]'); } catch (e) { return []; } }
function rememberSticker(code) {
  const list = [code, ...getStkRecent().filter(c => c !== code)].slice(0, 16);
  try { localStorage.setItem(stkRecentKey(), JSON.stringify(list)); } catch (e) { /* ไม่เป็นไร */ }
}

function closeStickerPanel() {
  $('sticker-panel').classList.add('hidden-element');
  $('sticker-btn').classList.remove('open');
}

function buildStickerEl(msg) {
  const fallback = () => { const t = document.createElement('span'); t.textContent = msg.text; return t; };
  const uri = stickerUri(msg.sticker);
  if (!uri) return fallback();
  const img = document.createElement('img');
  img.className = 'sticker-img';
  img.src = uri;
  img.alt = 'สติ๊กเกอร์';
  img.draggable = false;
  img.onerror = () => img.replaceWith(fallback());   // ไฟล์หายไปแล้ว: แสดงเป็นข้อความแทน
  return img;
}

async function sendSticker(code) {
  const chat = activeChat;
  if (!chat) return;
  if (!(STK_FILE_RE.test(code) || STK_LEGACY_RE.test(code))) return;
  if (!chat.isGroup && social.blocked.has(chat.id)) return toast('คุณบล็อกผู้ใช้นี้ไว้ ปลดบล็อกก่อนจึงจะส่งได้', 'error');
  closeStickerPanel();
  rememberSticker(code);
  const now = Date.now();
  const seconds = currentTtl();
  const replyTo = composer.type === 'reply' ? composer.msg.id : null;
  if (composer.type === 'reply') clearComposerMode();
  const msg = {
    id: 'tmp_' + now + '_' + Math.random().toString(36).slice(2, 7),
    text: '🏷 สติ๊กเกอร์', ts: now, isMe: true, senderId: currentUser.id, kind: 'text',
    expiresAt: null, ttl: seconds || null, timer: seconds || null,
    status: 'sending', readAt: null, replyTo, mentions: [], mentionAll: false, sticker: code
  };
  addLocal(chat.id, msg);
  playSound('send');
  if (activeChat && activeChat.id === chat.id) loadMessages();
  loadChatList();
  await deliverMessage(chat, msg);
}

// ==================== รอบนี้: สติ๊กเกอร์จากโฟลเดอร์ stickers + ตำแหน่ง (แผนที่ ปักหมุด ตำแหน่งสด) ====================

// ---------- สติ๊กเกอร์จากโฟลเดอร์ stickers/ (อ่านรายการจาก stickers/index.json) ----------
let stkTab = 'recent';
let stkIndex = null;     // null = ยังไม่โหลด, [] = ไม่มีไฟล์รายการ
let stkLoading = null;
const STK_FILE_RE = /^[A-Za-z0-9_-]{1,30}\/[A-Za-z0-9_-]{1,60}\.(png|webp|gif|jpe?g|svg)$/i;
const STK_LEGACY_RE = /^[a-z0-9]{1,12}:[a-z0-9_]{1,24}$/;

function loadStickerIndex() {
  if (stkIndex) return Promise.resolve(stkIndex);
  if (stkLoading) return stkLoading;
  stkLoading = fetch('stickers/index.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('no index'))))
    .then(j => (j.packs || [])
      .filter(p => p && /^[A-Za-z0-9_-]{1,30}$/.test(p.id) && Array.isArray(p.files))
      .map(p => ({ id: p.id, name: String(p.name || p.id), codes: p.files.map(f => `${p.id}/${f}`).filter(c => STK_FILE_RE.test(c)) }))
      .filter(p => p.codes.length))
    .catch(() => [])
    .then(list => { stkIndex = list; stkLoading = null; return list; });
  return stkLoading;
}

// ชุดที่แสดงในแผง: จากโฟลเดอร์ stickers (ถ้าไม่มีไฟล์รายการ จะใช้ชุดที่สร้างในโค้ดแทน)
function stickerPacks() {
  if (stkIndex && stkIndex.length) return stkIndex;
  return STK_PACKS.map(p => ({ id: p.id, name: p.name, codes: STK_FACES.map(f => `${p.id}:${f.id}`) }));
}

function renderStickerPanel() {
  const packs = stickerPacks();
  if (stkTab !== 'recent' && !packs.some(p => p.id === stkTab)) stkTab = 'recent';

  const tabs = $('sticker-tabs');
  tabs.innerHTML = '';
  const mk = (key, title, node) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stk-tab' + (stkTab === key ? ' active' : '');
    b.title = title;
    b.setAttribute('aria-label', title);
    b.appendChild(node);
    b.onclick = () => { stkTab = key; renderStickerPanel(); };
    tabs.appendChild(b);
  };
  const clock = document.createElement('span');
  clock.textContent = '🕘';
  mk('recent', 'ล่าสุด', clock);
  packs.forEach(p => {
    const img = document.createElement('img');
    img.src = stickerUri(p.codes[0]);
    img.alt = '';
    img.draggable = false;
    mk(p.id, p.name, img);
  });

  const grid = $('sticker-grid');
  grid.innerHTML = '';
  let codes;
  if (stkTab === 'recent') codes = getStkRecent();
  else {
    const pack = packs.find(p => p.id === stkTab);
    codes = pack ? pack.codes : [];
    if (pack) {
      const h = document.createElement('div');
      h.className = 'stk-name';
      h.textContent = pack.name;
      grid.appendChild(h);
    }
  }
  if (!codes.length) { grid.appendChild(hintNode('ยังไม่มีสติ๊กเกอร์ที่ใช้ล่าสุด เลือกชุดด้านบนได้เลย')); return; }
  codes.forEach(code => {
    const uri = stickerUri(code);
    if (!uri) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sticker-cell';
    const img = document.createElement('img');
    img.src = uri;
    img.alt = '';
    img.loading = 'lazy';
    img.draggable = false;
    img.onerror = () => b.remove();   // ไฟล์หาย/เสีย: ซ่อนช่องนั้น
    b.appendChild(img);
    b.onclick = () => sendSticker(code);
    grid.appendChild(b);
  });
}

async function toggleStickerPanel() {
  const panel = $('sticker-panel');
  const opening = panel.classList.contains('hidden-element');
  closeAttachMenu();
  if (opening) {
    await loadStickerIndex();
    const packs = stickerPacks();
    stkTab = getStkRecent().length ? 'recent' : (packs[0] ? packs[0].id : 'recent');
    $('chat-area').style.setProperty('--composer-h', document.querySelector('.chat-input-area').offsetHeight + 'px');
    renderStickerPanel();
  }
  panel.classList.toggle('hidden-element', !opening);
  $('sticker-btn').classList.toggle('open', opening);
}

// ---------- ตำแหน่ง: แผนที่ (Leaflet + OpenStreetMap) ----------
let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    js.onload = () => resolve();
    js.onerror = () => { leafletPromise = null; reject(new Error('โหลดแผนที่ไม่ได้')); };
    document.head.appendChild(js);
  });
  return leafletPromise;
}

const mapState = { map: null, marker: null, mode: null, liveId: null, pick: null, cur: null };

function getPosition(opts) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, opts || { enableHighAccuracy: true, timeout: 10000 });
  });
}

function setMapUI(mode, primary, secondary, status) {
  mapState.mode = mode;
  $('map-primary').textContent = primary;
  $('map-secondary').textContent = secondary || '';
  $('map-secondary').classList.toggle('hidden-element', !secondary);
  $('map-status').textContent = status || '';
}

async function openMapModal(title) {
  $('map-title').textContent = title;
  openModal('map-modal');
  try {
    await loadLeaflet();
  } catch (e) {
    closeMapModal();
    toast('โหลดแผนที่ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 'error');
    return false;
  }
  if (!mapState.map) {
    mapState.map = L.map('map-canvas').setView([13.7563, 100.5018], 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapState.map);
    mapState.map.on('click', e => { if (mapState.mode === 'pick') setMarker(e.latlng.lat, e.latlng.lng, true); });
  }
  setTimeout(() => mapState.map && mapState.map.invalidateSize(), 250);
  return true;
}

function setMarker(lat, lng, draggable) {
  if (mapState.marker) { mapState.map.removeLayer(mapState.marker); mapState.marker = null; }
  const icon = L.divIcon({ className: 'map-pin', html: '📍', iconSize: [32, 32], iconAnchor: [16, 30] });
  mapState.marker = L.marker([lat, lng], { icon, draggable: !!draggable }).addTo(mapState.map);
  if (draggable) {
    mapState.pick = { lat, lng };
    mapState.marker.on('dragend', () => { const p = mapState.marker.getLatLng(); mapState.pick = { lat: p.lat, lng: p.lng }; });
  }
}

function closeMapModal() {
  closeModal('map-modal');
  mapState.mode = null;
  mapState.liveId = null;
}

function openLocationSheet() {
  closeAttachMenu();
  openModal('loc-modal');
}

async function openMapPick() {
  closeModal('loc-modal');
  mapState.liveId = null;
  setMapUI('pick', 'ส่งตำแหน่งนี้', 'ไปที่ตำแหน่งของฉัน', 'แตะบนแผนที่หรือลากหมุดเพื่อเลือกตำแหน่ง');
  if (!(await openMapModal('เลือกตำแหน่งที่จะส่ง'))) return;
  setMarker(13.7563, 100.5018, true);
  centerOnMe(true);
}

async function centerOnMe(quiet) {
  try {
    const pos = await getPosition({ enableHighAccuracy: true, timeout: 8000 });
    if (mapState.mode !== 'pick') return;
    const { latitude: lat, longitude: lng } = pos.coords;
    mapState.map.setView([lat, lng], 16);
    setMarker(lat, lng, true);
  } catch (e) {
    if (!quiet) toast('หาตำแหน่งไม่ได้ ตรวจสอบสิทธิ์ตำแหน่งของเบราว์เซอร์', 'error');
  }
}

async function openMapView(lat, lng, label) {
  mapState.liveId = null;
  mapState.cur = { lat, lng };
  setMapUI('view', 'เปิดในแอปแผนที่', '', label || '');
  if (!(await openMapModal('ตำแหน่งที่ตั้ง'))) return;
  mapState.map.setView([lat, lng], 16);
  setMarker(lat, lng, false);
}

async function sendPickedLocation() {
  const p = mapState.pick;
  const c = activeChat;
  if (!p || !c) return;
  const { data, error } = await sb.rpc('share_location', {
    p_chat: c.id, p_group: !!c.isGroup,
    p_lat: Math.round(p.lat * 1e4) / 1e4, p_lng: Math.round(p.lng * 1e4) / 1e4, p_label: 'ตำแหน่งที่เลือก'
  });
  if (error) return handleDbError(error);
  closeMapModal();
  showPostedCard(c, data);
}

async function mapPrimary() {
  if (mapState.mode === 'pick') return sendPickedLocation();
  if (mapState.mode === 'live-mine') { const id = mapState.liveId; closeMapModal(); return stopLiveShare(id, true); }
  const p = mapState.cur;
  if (p) window.open(`https://maps.google.com/?q=${p.lat},${p.lng}`, '_blank', 'noopener');
}

function mapSecondary() {
  if (mapState.mode === 'pick') return centerOnMe(false);
  closeMapModal();
}

// ---------- ตำแหน่งสด ----------
const liveShares = {};   // รหัสข้อความ -> { watchId, timer, until, lastSent }

function liveKey() { return 'darkchat_live_' + currentUser.id; }

function liveStatus(row) {
  const ago = Math.max(0, Math.round((Date.now() - row.updated) / 1000));
  const left = Math.max(0, Math.round((row.expires - Date.now()) / 60000));
  return `อัปเดตล่าสุด ${ago < 60 ? ago + ' วินาที' : Math.round(ago / 60) + ' นาที'}ที่แล้ว · เหลือ ${left} นาที`;
}

function toLiveRow(r) {
  return { lat: r.lat, lng: r.lng, updated: new Date(r.updated_at).getTime(), expires: new Date(r.expires_at).getTime() };
}

async function loadLive(chat) {
  const ids = (state.messages[chat.id] || [])
    .filter(m => m.kind === 'card' && m.rmeta && m.rmeta.card === 'live' && !String(m.id).startsWith('tmp_'))
    .map(m => m.id).slice(-80);
  if (!ids.length) return;
  state.live = state.live || {};
  const { data, error } = await sb.from('live_locations').select('message_id, lat, lng, updated_at, expires_at').in('message_id', ids);
  if (error) return;
  ids.forEach(id => { delete state.live[id]; });
  (data || []).forEach(r => { state.live[r.message_id] = toLiveRow(r); });
  if (activeChat && activeChat.id === chat.id) loadMessages(true);
}

function onLiveChange(payload) {
  if (!currentUser) return;
  state.live = state.live || {};
  const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
  if (!row || !row.message_id) return;
  if (payload.eventType === 'DELETE') delete state.live[row.message_id];
  else state.live[row.message_id] = toLiveRow(row);

  if (mapState.liveId === row.message_id && !$('map-modal').classList.contains('hidden-element')) {
    const r = state.live[row.message_id];
    if (!r) { closeMapModal(); toast('สิ้นสุดการแชร์ตำแหน่งสดแล้ว', 'info'); }
    else {
      mapState.cur = { lat: r.lat, lng: r.lng };
      setMarker(r.lat, r.lng, false);
      mapState.map.panTo([r.lat, r.lng]);
      $('map-status').textContent = liveStatus(r);
    }
  }
  if (activeChat && (state.messages[activeChat.id] || []).some(x => x.id === row.message_id)) loadMessages(true);
}

function buildLiveCard(wrap, msg, title, sub) {
  const row = (state.live || {})[msg.id];
  const active = !!row && row.expires > Date.now();
  wrap.appendChild(title('📍 ตำแหน่งสด'));
  wrap.appendChild(sub(active ? liveStatus(row) : 'สิ้นสุดการแชร์ตำแหน่งสดแล้ว'));
  if (!active) return;
  const acts = document.createElement('div');
  acts.className = 'card-actions';
  acts.appendChild(chip('ดูแผนที่', () => openLiveMap(msg), 'primary'));
  if (msg.isMe) acts.appendChild(chip('หยุดแชร์', () => stopLiveShare(msg.id, true), 'danger'));
  wrap.appendChild(acts);
}

async function openLiveMap(msg) {
  const row = (state.live || {})[msg.id];
  if (!row || row.expires < Date.now()) return toast('สิ้นสุดการแชร์ตำแหน่งสดแล้ว', 'info');
  mapState.liveId = msg.id;
  mapState.cur = { lat: row.lat, lng: row.lng };
  setMapUI(msg.isMe ? 'live-mine' : 'live', msg.isMe ? 'หยุดแชร์ตำแหน่งสด' : 'เปิดในแอปแผนที่', '', liveStatus(row));
  if (!(await openMapModal(msg.isMe ? 'ตำแหน่งสดของฉัน' : 'ตำแหน่งสด'))) return;
  mapState.map.setView([row.lat, row.lng], 16);
  setMarker(row.lat, row.lng, false);
}

async function startLiveShare(minutes) {
  closeModal('loc-modal');
  const c = activeChat;
  if (!c) return;
  const ok = await confirmDialog('แชร์ตำแหน่งสด',
    `แชร์ตำแหน่งของคุณแบบสดให้ ${nameOf(c)} เป็นเวลา ${fmtDuration(minutes * 60)} ใช่หรือไม่?\nอัปเดตเฉพาะตอนเปิดแอปค้างไว้ และหยุดได้ทุกเมื่อ`, 'เริ่มแชร์');
  if (!ok) return;
  toast('กำลังหาตำแหน่งของคุณ…', 'info');
  let pos;
  try { pos = await getPosition({ enableHighAccuracy: true, timeout: 12000 }); }
  catch (e) { return toast('หาตำแหน่งไม่ได้ ตรวจสอบสิทธิ์ตำแหน่งของเบราว์เซอร์', 'error'); }
  const { data, error } = await sb.rpc('start_live_location', {
    p_chat: c.id, p_group: !!c.isGroup, p_minutes: minutes, p_lat: pos.coords.latitude, p_lng: pos.coords.longitude
  });
  if (error) return handleDbError(error);
  beginWatch(data, Date.now() + minutes * 60000);
  showPostedCard(c, data);
  setTimeout(() => { if (activeChat) loadLive(activeChat); }, 800);
}

function persistLive() {
  try { localStorage.setItem(liveKey(), JSON.stringify(Object.keys(liveShares).map(id => ({ id, until: liveShares[id].until })))); }
  catch (e) { /* ไม่เป็นไร */ }
}

function beginWatch(mid, untilMs) {
  if (liveShares[mid] || !navigator.geolocation) return;
  const rec = { until: untilMs, lastSent: Date.now(), watchId: null, timer: null };
  rec.watchId = navigator.geolocation.watchPosition(pos => {
    const now = Date.now();
    if (now >= rec.until) return stopLiveShare(mid, false);
    if (now - rec.lastSent < 20000) return;
    rec.lastSent = now;
    sb.rpc('update_live_location', { p_message: mid, p_lat: pos.coords.latitude, p_lng: pos.coords.longitude })
      .then(({ data }) => { if (data === false) stopLiveShare(mid, false); });
  }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
  rec.timer = setTimeout(() => stopLiveShare(mid, false), Math.max(0, untilMs - Date.now()));
  liveShares[mid] = rec;
  persistLive();
}

async function stopLiveShare(mid, announce) {
  const rec = liveShares[mid];
  if (rec) {
    navigator.geolocation.clearWatch(rec.watchId);
    clearTimeout(rec.timer);
    delete liveShares[mid];
    persistLive();
  }
  if (announce) {
    const { error } = await sb.rpc('stop_live_location', { p_message: mid });
    if (error) return handleDbError(error);
    toast('หยุดแชร์ตำแหน่งสดแล้ว', 'success');
  }
  if (state.live) delete state.live[mid];
  if (activeChat) loadMessages(true);
}

function stopAllLiveLocal() {
  Object.keys(liveShares).forEach(id => {
    const rec = liveShares[id];
    navigator.geolocation.clearWatch(rec.watchId);
    clearTimeout(rec.timer);
    delete liveShares[id];
  });
}

// เปิดแอปใหม่ระหว่างที่ยังแชร์ไม่หมดเวลา: เริ่มส่งตำแหน่งต่อ
function resumeLiveShares() {
  try {
    JSON.parse(localStorage.getItem(liveKey()) || '[]').forEach(r => { if (r.until > Date.now() + 30000) beginWatch(r.id, r.until); });
  } catch (e) { /* ไม่เป็นไร */ }
}

// ==================== รอบ D: รูปโปรไฟล์/รูปกลุ่มใน Storage, ธีม+พื้นหลังห้องซิงก์ข้ามเครื่อง, ส่งต่อรูปและไฟล์ ====================

// ---------- รูปโปรไฟล์/รูปกลุ่ม: เก็บใน Storage (บักเก็ต avatars) ----------
const AVATAR_BUCKET = 'avatars';

async function dataUrlToBlob(u) { return (await fetch(u)).blob(); }

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
    r.readAsDataURL(blob);
  });
}

function avatarFilePath(prefix) {
  return `${currentUser.id}/${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
}

// ย่อรูปแล้วอัปโหลด คืนลิงก์สาธารณะ (ถ้าอัปโหลดไม่ได้ เช่น ยังไม่ได้รัน SQL ใช้แบบฝังในฐานข้อมูลเหมือนเดิม จะได้ไม่พัง)
async function uploadAvatarImage(file, size, prefix) {
  const dataUrl = await resizeImage(file, size);
  try {
    const blob = await dataUrlToBlob(dataUrl);
    const path = avatarFilePath(prefix);
    const { error } = await sb.storage.from(AVATAR_BUCKET).upload(path, blob,
      { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    if (error) throw error;
    return sb.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (e) {
    return dataUrl;
  }
}

function avatarPathOf(url) {
  const m = String(url || '').match(/\/storage\/v1\/object\/public\/avatars\/(.+)$/);
  if (!m) return null;
  const p = decodeURIComponent(m[1]);
  return p.startsWith(currentUser.id + '/') ? p : null;   // ลบได้เฉพาะไฟล์ของตัวเอง
}

function removeOldAvatar(url) {
  const p = avatarPathOf(url);
  if (p) sb.storage.from(AVATAR_BUCKET).remove([p]).then(() => {}, () => {});
}

// รูปโปรไฟล์เดิมที่ฝังอยู่ในฐานข้อมูล: ย้ายไป Storage ให้เองเงียบๆ (ครั้งเดียว)
let avatarMigrated = false;
async function migrateOwnAvatar() {
  if (avatarMigrated || !currentUser || !String(currentUser.avatar || '').startsWith('data:image')) return;
  avatarMigrated = true;
  try {
    const blob = await dataUrlToBlob(currentUser.avatar);
    const path = avatarFilePath('p');
    const up = await sb.storage.from(AVATAR_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    if (up.error) throw up.error;
    const url = sb.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
    const { error } = await sb.from('profiles').update({ avatar: url }).eq('id', currentUser.id);
    if (error) throw error;
    currentUser.avatar = url;
    updateUserProfileUI();
  } catch (e) { /* ยังไม่ได้รัน SQL ของรอบนี้ ข้ามไปก่อน */ }
}

// ---------- ธีมห้อง + พื้นหลังห้อง: ซิงก์ข้ามเครื่อง ----------
const PREFS_BUCKET = 'prefs';
const prefTimers = {};

function trashKey() { return 'darkchat_prefs_trash_' + currentUser.id; }

function addPrefTrash(path) {
  try {
    const l = JSON.parse(localStorage.getItem(trashKey()) || '[]');
    l.push(path);
    localStorage.setItem(trashKey(), JSON.stringify(l.slice(-50)));
  } catch (e) { /* ไม่เป็นไร */ }
}

function flushPrefTrash() {
  try {
    const l = JSON.parse(localStorage.getItem(trashKey()) || '[]');
    if (!l.length) return;
    sb.storage.from(PREFS_BUCKET).remove(l).then(() => { localStorage.removeItem(trashKey()); }, () => {});
  } catch (e) { /* ไม่เป็นไร */ }
}

async function pushRoomPref(chatId) {
  const all = getRoomStyles();
  const st = all[chatId];
  try {
    if (!st || (!st.theme && !st.wp)) {
      await sb.from('room_prefs').delete().eq('chat_id', chatId);
      flushPrefTrash();
      return;
    }
    if (st.wp && !st.wpPath) {
      const blob = await dataUrlToBlob(st.wp);
      const path = `${currentUser.id}/wp_${chatId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const up = await sb.storage.from(PREFS_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw up.error;
      st.wpPath = path;
      saveRoomStyles(all);
    }
    const { error } = await sb.from('room_prefs').upsert(
      { user_id: currentUser.id, chat_id: chatId, theme: st.theme || null, wallpaper: st.wp ? st.wpPath : null },
      { onConflict: 'user_id,chat_id' });
    if (error) throw error;
    flushPrefTrash();
  } catch (e) { /* ลองใหม่ครั้งหน้า */ }
}

function pushRoomPrefSoon(chatId) {
  clearTimeout(prefTimers[chatId]);
  prefTimers[chatId] = setTimeout(() => pushRoomPref(chatId), 800);
}

// ดึงค่าจากเซิร์ฟเวอร์ (ค่าบนเซิร์ฟเวอร์เป็นหลัก) และอัปค่าที่มีเฉพาะในเครื่องนี้ขึ้นไป
async function hydrateRoomPrefs() {
  if (!currentUser) return;
  const { data, error } = await sb.from('room_prefs').select('chat_id, theme, wallpaper');
  if (error) return; // ยังไม่ได้รัน SQL ของรอบนี้
  const local = getRoomStyles();
  const remote = new Set();
  let changed = false;
  for (const r of data || []) {
    remote.add(r.chat_id);
    const st = local[r.chat_id] || {};
    if ((r.theme || '') !== (st.theme || '')) {
      if (r.theme) st.theme = r.theme; else delete st.theme;
      changed = true;
    }
    if (r.wallpaper && st.wpPath !== r.wallpaper) {
      const { data: blob } = await sb.storage.from(PREFS_BUCKET).download(r.wallpaper);
      if (blob) { st.wp = await blobToDataUrl(blob); st.wpPath = r.wallpaper; changed = true; }
    } else if (!r.wallpaper && st.wp && st.wpPath) {
      delete st.wp; delete st.wpPath; changed = true;
    }
    if (Object.keys(st).length) local[r.chat_id] = st; else delete local[r.chat_id];
  }
  if (changed) saveRoomStyles(local);
  for (const id of Object.keys(local)) if (!remote.has(id)) await pushRoomPref(id);
  if (activeChat) applyRoomStyle();
}

// ---------- ส่งต่อข้อความ รูป วิดีโอ ไฟล์ และสติ๊กเกอร์ ----------
const fwd = { msg: null, items: null, ids: new Set() };

async function openForward(msg) {
  fwd.msg = msg;
  fwd.items = msg.album ? msg.album : (msg.media ? [msg] : null);
  fwd.ids = new Set();
  $('fwd-search').value = '';
  $('fwd-count').textContent = '';
  $('fwd-preview').textContent = snippetOf(msg);
  openModal('fwd-modal');
  await renderForward();
}

async function renderForward() {
  const q = $('fwd-search').value.trim().toLowerCase();
  const friends = await ensureProfiles(friendIds().filter(id => !state.contacts[id]));
  const items = [...allChats(), ...friends]
    .filter(c => !(activeChat && c.id === activeChat.id) && !social.blocked.has(c.id))
    .filter(c => !q || nameOf(c).toLowerCase().includes(q))
    .sort((a, b) => (b.isSaved ? 1 : 0) - (a.isSaved ? 1 : 0) || nameOf(a).localeCompare(nameOf(b)));

  const box = $('fwd-list');
  box.innerHTML = '';
  if (!items.length) box.appendChild(hintNode('ไม่พบแชทหรือเพื่อน'));
  items.forEach(c => {
    const row = personRow(c, c.isGroup ? 'กลุ่ม' : '');
    row.querySelector('.avatar').classList.toggle('group-av', !!c.isGroup);
    row.classList.add('tap');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'pick';
    cb.checked = fwd.ids.has(c.id);
    const toggle = () => {
      if (fwd.ids.has(c.id)) fwd.ids.delete(c.id);
      else {
        if (fwd.ids.size >= 5) return toast('ส่งต่อได้ครั้งละไม่เกิน 5 แชท', 'error');
        fwd.ids.add(c.id);
      }
      cb.checked = fwd.ids.has(c.id);
      $('fwd-count').textContent = fwd.ids.size ? `(${fwd.ids.size})` : '';
    };
    cb.onclick = e => { e.stopPropagation(); toggle(); };
    row.onclick = toggle;
    row.appendChild(cb);
    box.appendChild(row);
  });
}

// คัดลอกไฟล์ในพื้นที่เก็บของเซิร์ฟเวอร์ไปเป็นของเรา แล้วสร้างข้อความ (ทำทีละไฟล์ ถ้าพังกลางทางจะถอนกลับให้)
async function forwardMediaTo(base, items) {
  const batch = items.length > 1 ? newBatchId() : null;
  const rows = [];
  const copied = [];
  try {
    for (let i = 0; i < items.length; i++) {
      const src = items[i];
      const m = src.media;
      if (!m || m.expired || m.pending) throw new Error('ไฟล์ยังไม่พร้อมส่งต่อ');
      const ext = ((m.path.split('.').pop() || 'bin').replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 8)) || 'bin';
      const newPath = mediaPath(ext);
      const cp = await sb.storage.from(MEDIA_BUCKET).copy(m.path, newPath);
      if (cp.error) throw cp.error;
      copied.push(newPath);
      let newThumb = null;
      if (m.thumb) {
        const tp = newPath.replace(/\.[a-z0-9]+$/, '') + '_t.jpg';
        const ct = await sb.storage.from(MEDIA_BUCKET).copy(m.thumb, tp);
        if (!ct.error) { newThumb = tp; copied.push(tp); }
      }
      const media = {
        type: m.type, path: newPath, thumb: newThumb, thumb_size: newThumb ? (m.thumb_size || 0) : 0,
        name: m.name, size: m.size, mime: m.mime, w: m.w, h: m.h, dur: m.dur
      };
      const meta = { fwd: true, ...(batch ? { batch, n: items.length } : {}) };
      const { data, error } = await sb.from('messages').insert({
        ...base, text: i === items.length - 1 ? (src.text || '') : '', media, meta
      }).select().single();
      if (error) throw error;
      rows.push(data);
    }
    return rows;
  } catch (err) {
    sb.storage.from(MEDIA_BUCKET).remove(copied).then(() => {}, () => {});
    if (rows.length) await sb.from('messages').delete().in('id', rows.map(r => r.id));
    throw err;
  }
}

async function forwardOne(id, isGroup) {
  const base = { sender_id: currentUser.id, ...(isGroup ? { group_id: id } : { receiver_id: id }) };
  if (fwd.items) return forwardMediaTo(base, fwd.items);
  const meta = { fwd: true };
  if (fwd.msg.sticker) meta.sticker = fwd.msg.sticker;
  const { data, error } = await sb.from('messages').insert({ ...base, text: fwd.msg.text, meta }).select().single();
  if (error) throw error;
  return [data];
}

async function submitForward() {
  const ids = [...fwd.ids];
  if (!ids.length) return toast('เลือกแชทที่จะส่งต่อก่อน', 'error');
  const btn = $('fwd-submit');
  setBusy(btn, true, fwd.items ? 'กำลังคัดลอกไฟล์...' : 'กำลังส่ง...');
  let ok = 0, fail = 0;
  for (const id of ids) {
    const isGroup = !!state.groups[id];
    const chat = state.groups[id] || state.contacts[id] || social.profiles[id];
    try {
      const rows = await forwardOne(id, isGroup);
      if (!isGroup && !state.contacts[id] && chat) { state.contacts[id] = chat; saveContacts(); }
      rows.forEach(r => addLocal(id, toLocal(r)));
      ok++;
    } catch (e) { fail++; }
  }
  setBusy(btn, false);
  closeModal('fwd-modal');
  loadChatList();
  if (activeChat) loadMessages(true);
  toast(ok ? `ส่งต่อไปยัง ${ok} แชทแล้ว` + (fail ? ` (ไม่สำเร็จ ${fail})` : '') : 'ส่งต่อไม่สำเร็จ',
        ok ? 'success' : 'error');
}

// ==================== อุปกรณ์ที่เข้าสู่ระบบ + สั่งออกจากระบบเครื่องอื่น ====================
let lastDeviceCheck = 0;

function deviceKey() {
  let k = localStorage.getItem('darkchat_device_key');
  if (!k) {
    k = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '')
      : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
    if (k.length < 16) k = k.padEnd(16, 'x');
    k = k.slice(0, 40);
    try { localStorage.setItem('darkchat_device_key', k); } catch (e) { /* ไม่เป็นไร */ }
  }
  return k;
}

function deviceName() {
  const ua = navigator.userAgent || '';
  const os = /iPhone/.test(ua) ? 'iPhone'
    : (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux' : 'อุปกรณ์';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : (/Chrome\//.test(ua) || /CriOS/.test(ua)) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'เบราว์เซอร์';
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  return standalone ? `แอปบนหน้าจอโฮม · ${os}` : `${br} · ${os}`;
}

// บันทึกอุปกรณ์นี้ (เรียกตอนเปิดแอปและเมื่อกลับมาเปิดหน้านี้) ถ้าถูกสั่งออกจากระบบแล้ว จะออกจากระบบทันที
async function registerThisDevice() {
  if (!currentUser) return;
  lastDeviceCheck = Date.now();
  const { data, error } = await sb.rpc('register_device', { p_key: deviceKey(), p_name: deviceName() });
  if (error) return; // ยังไม่ได้รัน SQL ของรอบนี้
  if (data === false) forceSignOut();
}

async function forceSignOut() {
  if (!currentUser) return;
  const uid = currentUser.id;
  const key = deviceKey();
  try { await sb.from('devices').delete().eq('device_key', key); } catch (e) { /* ไม่เป็นไร */ }
  try { await sb.from('e2ee_keys').update({ revoked_at: new Date().toISOString() }).eq('device_key', key); } catch (e) { /* ไม่เป็นไร */ }
  try { localStorage.removeItem('darkchat_device_key'); } catch (e) { /* ไม่เป็นไร */ }
  toast('บัญชีนี้ถูกสั่งออกจากระบบจากอีกเครื่อง', 'error');
  await logoutNow(uid);
}

function onDeviceChange(payload) {
  const row = payload.new;
  if (row && row.device_key === deviceKey() && row.revoked_at) return forceSignOut();
  if (!$('devices-modal').classList.contains('hidden-element')) renderDevices();
}

function devAgoText(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 180) return 'ตอนนี้';
  if (s < 3600) return `${Math.round(s / 60)} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.round(s / 3600)} ชั่วโมงที่แล้ว`;
  return `${Math.round(s / 86400)} วันที่แล้ว`;
}

async function openDevices() {
  openModal('devices-modal');
  await renderDevices();
}

async function renderDevices() {
  const box = $('devices-list');
  box.innerHTML = '';
  box.appendChild(hintNode('กำลังโหลด…'));
  const { data, error } = await sb.from('devices')
    .select('id, device_key, name, first_seen, last_seen, revoked_at').order('last_seen', { ascending: false });
  box.innerHTML = '';
  if (error) { box.appendChild(hintNode('โหลดรายการไม่ได้ (ยังไม่ได้รัน SQL ของรอบนี้หรือเปล่า)')); return; }
  const mine = deviceKey();
  const rows = (data || []).filter(d => !d.revoked_at);
  if (!rows.length) { box.appendChild(hintNode('ยังไม่มีข้อมูลอุปกรณ์')); return; }
  rows.forEach(d => {
    const card = document.createElement('div');
    card.className = 'req-card';
    const head = document.createElement('strong');
    head.textContent = d.name || 'อุปกรณ์ไม่ทราบชื่อ';
    if (d.device_key === mine) {
      const b = document.createElement('span');
      b.className = 'tag-group tag-public';
      b.style.marginLeft = '8px';
      b.textContent = 'เครื่องนี้';
      head.appendChild(b);
    }
    const sub = document.createElement('div');
    sub.className = 'hint';
    sub.style.marginTop = '2px';
    sub.textContent = `ใช้งานล่าสุด ${devAgoText(d.last_seen)} · เข้าครั้งแรก ${new Date(d.first_seen).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    card.append(head, sub);
    if (d.device_key !== mine) {
      const acts = document.createElement('div');
      acts.className = 'req-actions';
      acts.appendChild(chip('ออกจากระบบเครื่องนี้', () => revokeDevice(d), 'danger'));
      card.appendChild(acts);
    }
    box.appendChild(card);
  });
}

async function revokeDevice(d) {
  const ok = await confirmDialog('ออกจากระบบเครื่องนั้น',
    `สั่ง "${d.name}" ออกจากระบบ?\nเครื่องนั้นจะออกจากระบบทันทีถ้าเปิดแอปอยู่ หรือเมื่อเปิดแอปครั้งถัดไป`, 'ออกจากระบบ', true);
  if (!ok) return;
  const { error } = await sb.from('devices').update({ revoked_at: new Date().toISOString() }).eq('id', d.id);
  if (error) return handleDbError(error);
  await sb.from('e2ee_keys').update({ revoked_at: new Date().toISOString() }).eq('device_key', d.device_key);
  toast('สั่งออกจากระบบแล้ว', 'success');
  renderDevices();
}

async function signOutOthers() {
  const ok = await confirmDialog('ออกจากระบบทุกเครื่องอื่น',
    'ทุกเครื่องที่ล็อกอินบัญชีนี้ นอกจากเครื่องนี้ จะถูกออกจากระบบ และต้องเข้าสู่ระบบใหม่\nใช้เมื่อทำโทรศัพท์หาย หรือลืมออกจากระบบจากเครื่องที่ไม่ใช่ของตัวเอง', 'ออกจากระบบทุกเครื่องอื่น', true);
  if (!ok) return;
  // 1) ตั้งธงให้เครื่องอื่นออกจากระบบทันที  2) ยกเลิกสิทธิ์การเข้าถึงของเครื่องอื่นที่ฝั่งเซิร์ฟเวอร์
  await sb.from('devices').update({ revoked_at: new Date().toISOString() }).neq('device_key', deviceKey()).is('revoked_at', null);
  await sb.from('e2ee_keys').update({ revoked_at: new Date().toISOString() }).neq('device_key', deviceKey()).is('revoked_at', null);
  const { error } = await sb.auth.signOut({ scope: 'others' });
  if (error) return handleDbError(error);
  toast('ออกจากระบบทุกเครื่องอื่นแล้ว', 'success');
  renderDevices();
}

// ==================== เฟส G + G2: โทรเสียง/วิดีโอ (WebRTC) + Watch Party (แชร์หน้าจอ) ====================
// ระดับคุณภาพภาพสตรีมที่ผู้ชมเลือกได้ (ผู้ชมแต่ละคนมีการเชื่อมต่อของตัวเอง ผู้สตรีมจึงปรับให้ทีละคนได้)
const QOS = {
  auto:   { name: 'อัตโนมัติ', desc: 'ปรับตามจำนวนผู้ชมและความเร็วเน็ต (ค่าเริ่มต้น)' },
  low:    { name: 'ประหยัดข้อมูล', desc: '360p · 15 เฟรม · ราว 0.5 Mbps', h: 360, br: 450000, fps: 15 },
  medium: { name: 'มาตรฐาน', desc: '720p · 24 เฟรม · ราว 1.5 Mbps', h: 720, br: 1500000, fps: 24 },
  high:   { name: 'คมชัดสูง', desc: '1080p · 30 เฟรม · ราว 3.5 Mbps', h: 1080, br: 3500000, fps: 30 },
  text:   { name: 'เน้นตัวหนังสือชัด', desc: '1080p · 8 เฟรม · เหมาะกับสไลด์/โค้ด/เอกสาร', h: 1080, br: 2500000, fps: 8 }
};

const CALL = { session: null, incoming: null, open: {}, streams: {}, ringTimer: null, ringCtx: null, incomingTimer: null, wake: null, screenView: null, wUnread: 0 };
let iceCache = null;
const FALLBACK_ICE = [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['stun:stun.l.google.com:19302'] }];

// ไอคอนเส้น (24x24) สไตล์เรียบทันสมัย
const ICON = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micOff: '<path d="M3 3l18 18"/><path d="M9 9v2a3 3 0 0 0 5 2.2M15 8V6a3 3 0 0 0-5.7-1.3"/><path d="M5 11a7 7 0 0 0 11 5.7M19 11a7 7 0 0 1-.6 2.8M12 18v3"/>',
  video: '<rect x="3" y="6" width="12" height="12" rx="3"/><path d="M15 10.5l6-3.5v10l-6-3.5z"/>',
  videoOff: '<path d="M3 3l18 18"/><path d="M7 6h5a3 3 0 0 1 3 3v3M15 15v0a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9"/><path d="M15 10.5l6-3.5v10"/>',
  flip: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><path d="M9 13.2a3 3 0 0 1 5.2-1.2M15 14.8a3 3 0 0 1-5.2 1.2"/><path d="M14.3 10.6v1.6h-1.6M9.7 17.4v-1.6h1.6"/>',
  speaker: '<path d="M4 9.5v5h4l5 4v-13l-5 4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/>',
  speakerOff: '<path d="M4 9.5v5h4l5 4v-13l-5 4z"/><path d="M17 9.5l4 5M21 9.5l-4 5"/>',
  share: '<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8 20h8M12 16v4"/><path d="M12 13V8M9.5 10.3L12 8l2.5 2.3"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3.5 20l1.3-4.6A8.5 8.5 0 1 1 21 11.5z"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  hd: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><text x="12" y="15.2" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui,sans-serif">HD</text>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>'
};
const HANGUP = '<path fill="currentColor" stroke="none" d="M3.2 14.6c4.9-4.6 12.7-4.6 17.6 0 .5.5.6 1.3.1 1.9l-1.3 1.6a1.5 1.5 0 0 1-1.7.4l-2.6-1a1.5 1.5 0 0 1-.9-1.4v-1.4a11.5 11.5 0 0 0-5.4 0v1.4c0 .6-.4 1.2-.9 1.4l-2.6 1a1.5 1.5 0 0 1-1.7-.4L3.1 16.5c-.5-.6-.4-1.4.1-1.9z"/>';

function svgIcon(name, size = 24) {
  const body = name === 'hangup' ? HANGUP : ICON[name];
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function setIcon(el, name) {
  if (!el) return;
  const slot = el.querySelector('.ci') || el;
  slot.innerHTML = svgIcon(name, name === 'hangup' ? 30 : 24);
  el.dataset.i = name;
}

function canShareScreen() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

// รายชื่อเซิร์ฟเวอร์ STUN/TURN จากฟังก์ชัน turn-credentials (ถ้าไม่มี ใช้ STUN อย่างเดียว)
async function getIceServers() {
  if (iceCache && iceCache.exp > Date.now()) return iceCache.servers;
  let servers = FALLBACK_ICE;
  let relay = false;
  try {
    const { data, error } = await sb.functions.invoke('turn-credentials', { body: {} });
    if (!error && data && Array.isArray(data.iceServers) && data.iceServers.length) {
      servers = data.iceServers;
      relay = !!data.relay;
    }
  } catch (e) { /* ใช้ STUN อย่างเดียว */ }
  iceCache = { servers, relay, exp: Date.now() + 20 * 60 * 1000 };
  return servers;
}

async function setLocalDesc(pc) {
  try { await pc.setLocalDescription(); }
  catch (e) {
    const d = pc.signalingState === 'have-remote-offer' ? await pc.createAnswer() : await pc.createOffer();
    await pc.setLocalDescription(d);
  }
}

function callErrorText(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน/กล้อง ตรวจสอบสิทธิ์ในการตั้งค่าเบราว์เซอร์';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'ไม่พบไมโครโฟนหรือกล้องในอุปกรณ์นี้';
  if (n === 'NotReadableError') return 'ไมโครโฟน/กล้องถูกแอปอื่นใช้อยู่';
  return (e && e.message) || 'เริ่มสายไม่สำเร็จ';
}

function streamErrorText(e) {
  const msg = (e && e.message) || '';
  if (/stream_busy/i.test(msg)) return 'มีคนกำลังสตรีมอยู่ในห้องนี้แล้ว';
  if (/unsupported/i.test(msg)) return 'เบราว์เซอร์นี้แชร์หน้าจอไม่ได้ (ใช้ได้บนคอมพิวเตอร์)';
  if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return 'ยกเลิกการแชร์หน้าจอ';
  return thaiError(e);
}

// ---------- ตัวจัดการสาย (หลายคนต่อกันแบบ mesh: ทุกคนเชื่อมถึงกันโดยตรง) ----------
class CallSession {
  constructor(callId, chat, kind) {
    this.callId = callId;
    this.chat = chat;
    this.kind = kind;
    this.me = currentUser.id;
    this.nonce = Math.random().toString(36).slice(2, 10);
    this.peers = new Map();
    this.local = null;
    this.channel = null;
    this.closed = false;
    this.startedAt = null;
    this.timer = null;
    this.deaf = false;
    this.facing = 'user';
    this.screen = null;
    this.screenTracks = new Set();
    this.remoteScreens = new Map();
    this.beatTimer = null;
  }

  camConstraints() {
    return { facingMode: { ideal: this.facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } };
  }

  async start() {
    this.ice = await getIceServers();
    this.local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: this.kind === 'video' ? this.camConstraints() : false
    });
    this.updateLocalPreview();
    await sb.realtime.setAuth();
    this.channel = sb.channel('call:' + this.callId, { config: { private: true, broadcast: { self: false } } });
    this.channel.on('broadcast', { event: 'sig' }, ({ payload }) => this.onSignal(payload));
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('เชื่อมต่อช่องส่งสัญญาณไม่ทัน ลองใหม่อีกครั้ง')), 12000);
      this.channel.subscribe(status => {
        if (status === 'SUBSCRIBED') { clearTimeout(t); resolve(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(t); reject(new Error('เชื่อมต่อช่องส่งสัญญาณไม่ได้')); }
      });
    });
    this.send('*', 'hello', { nonce: this.nonce });
    renderCallStatus();
  }

  send(to, type, data) {
    if (!this.channel) return;
    this.channel.send({ type: 'broadcast', event: 'sig', payload: { to, from: this.me, type, data } });
  }

  onSignal(p) {
    if (this.closed || !p || p.from === this.me) return;
    if (p.to !== '*' && p.to !== this.me) return;
    if (p.type === 'bye') return this.dropPeer(p.from);
    if (p.type === 'q') {   // ผู้ชมขอเปลี่ยนคุณภาพภาพสตรีม
      const qp = this.peers.get(p.from);
      const lv = p.data && p.data.level;
      if (qp && QOS[lv]) { qp.q = lv; this.tune(); }
      return;
    }
    if (p.type === 'hello') {
      const old = this.peers.get(p.from);
      if (old && old.nonce === (p.data && p.data.nonce)) return;   // เจอคนเดิมที่เชื่อมอยู่แล้ว
      if (old) this.dropPeer(p.from);                               // เข้าร่วมใหม่ (เช่น รีเฟรชหน้า): เริ่มเชื่อมใหม่
      const peer = this.getPeer(p.from);
      peer.nonce = p.data && p.data.nonce;
      return;
    }
    if (p.type === 'share') {                                       // อีกฝั่งเริ่ม/หยุดสตรีมหน้าจอ
      const peer = this.getPeer(p.from);
      if (p.data && p.data.on) peer.shareId = p.data.id;
      else { peer.shareId = null; this.removeRemoteScreen(p.from); }
      return;
    }
    const peer = this.getPeer(p.from);
    peer.chain = peer.chain.then(() => this.handle(peer, p)).catch(e => console.warn(e));
  }

  async handle(peer, p) {
    const pc = peer.pc;
    if (p.type === 'desc') {
      const desc = p.data;
      const collision = desc.type === 'offer' && (peer.making || pc.signalingState !== 'stable');
      peer.ignore = !peer.polite && collision;
      if (peer.ignore) return;
      await pc.setRemoteDescription(desc);
      for (const c of peer.pending.splice(0)) { try { await pc.addIceCandidate(c); } catch (e) { /* ไม่เป็นไร */ } }
      if (desc.type === 'offer') {
        await setLocalDesc(pc);
        this.send(peer.uid, 'desc', pc.localDescription);
      }
    } else if (p.type === 'ice') {
      if (!pc.remoteDescription) { peer.pending.push(p.data); return; }
      try { await pc.addIceCandidate(p.data); } catch (e) { if (!peer.ignore) console.warn(e); }
    }
  }

  getPeer(uid) {
    let peer = this.peers.get(uid);
    if (peer) return peer;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    peer = { uid, pc, making: false, ignore: false, polite: this.me > uid, nonce: null, pending: [], chain: Promise.resolve(), stream: null, shareId: null, failTimer: null };
    this.peers.set(uid, peer);
    if (this.chat.isGroup && !this.chat.anonymous) ensureProfiles([uid]).then(() => updateCallTile(uid));
    callTile(uid);

    if (this.local) this.local.getTracks().forEach(t => pc.addTrack(t, this.local));
    if (this.screen) {                                              // เรากำลังสตรีมอยู่: ส่งหน้าจอให้คนที่เพิ่งเข้ามาด้วย
      this.send(uid, 'share', { on: true, id: this.screen.id });
      this.screen.getTracks().forEach(t => pc.addTrack(t, this.screen));
    }

    // ทำงานต่อคิวเดียวกับการรับสัญญาณ (peer.chain) เพื่อไม่ให้ชนกับการตอบรับข้อเสนอจากอีกฝั่ง
    pc.onnegotiationneeded = () => {
      peer.chain = peer.chain.then(async () => {
        try {
          if (this.closed || pc.signalingState === 'closed') return;
          peer.making = true;
          await setLocalDesc(pc);
          if (pc.localDescription && pc.localDescription.type === 'offer') this.send(uid, 'desc', pc.localDescription);
        } catch (e) { console.warn(e); }
        finally { peer.making = false; }
      });
    };
    pc.onicecandidate = e => { if (e.candidate) this.send(uid, 'ice', e.candidate); };
    pc.ontrack = e => {
      const st = e.streams[0] || null;
      if (st && peer.shareId && st.id === peer.shareId) { this.setRemoteScreen(uid, st); return; }
      if (st && peer.stream && st.id !== peer.stream.id) {          // สตรีมที่สองจากคนเดิม = หน้าจอที่แชร์
        peer.shareId = peer.shareId || st.id;
        this.setRemoteScreen(uid, st);
        return;
      }
      peer.stream = st || peer.stream || new MediaStream();
      if (!st) peer.stream.addTrack(e.track);
      attachCallStream(uid, peer.stream);
      e.track.onmute = () => updateCallTile(uid);
      e.track.onunmute = () => updateCallTile(uid);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      updateCallTile(uid);
      if (st === 'connected') {
        clearTimeout(peer.failTimer);
        if (!this.startedAt) { this.startedAt = Date.now(); this.timer = setInterval(renderCallStatus, 1000); }
        this.tune();
        renderCallStatus();
      } else if (st === 'disconnected' || st === 'failed') {
        try { pc.restartIce(); } catch (e) { /* ไม่เป็นไร */ }
        clearTimeout(peer.failTimer);
        peer.failTimer = setTimeout(() => {
          if (this.closed || pc.connectionState === 'connected') return;
          if (!this.chat.isGroup) { toast('สัญญาณหลุด สายสิ้นสุดแล้ว', 'error'); endCall(); }   // แชทส่วนตัว: อีกฝ่ายหายไป = จบสาย
          else this.dropPeer(uid);
        }, 20000);
      }
    };
    this.tune();
    return peer;
  }

  dropPeer(uid) {
    const peer = this.peers.get(uid);
    if (!peer) return;
    clearTimeout(peer.failTimer);
    try { peer.pc.close(); } catch (e) { /* ไม่เป็นไร */ }
    this.peers.delete(uid);
    removeCallTile(uid);
    this.removeRemoteScreen(uid);
    this.tune();
    renderCallStatus();
    updateCallLayout();
  }

  setRemoteScreen(uid, stream) {
    this.remoteScreens.set(uid, stream);
    if (!CALL.screenView || !this.remoteScreens.has(CALL.screenView)) CALL.screenView = uid;
    renderScreen();
  }

  removeRemoteScreen(uid) {
    if (!this.remoteScreens.delete(uid)) return;
    if (CALL.screenView === uid) CALL.screenView = this.remoteScreens.size ? [...this.remoteScreens.keys()][0] : null;
    renderScreen();
  }

  // ปรับคุณภาพตามจำนวนคนในสาย (คนยิ่งเยอะ ยิ่งลดบิตเรต เพราะต้องส่งภาพให้ทุกคนพร้อมกัน)
  tune() {
    const n = this.peers.size;
    const camBr = n <= 1 ? 800000 : n === 2 ? 400000 : 250000;
    const scrBr = n <= 2 ? 2500000 : n === 3 ? 1600000 : 1100000;
    const levelOf = peer => (peer.q && peer.q !== 'auto' && QOS[peer.q]) ? QOS[peer.q] : null;
    // รอบแรก: รวมบิตเรตภาพหน้าจอที่ต้องส่งให้ผู้ชมทุกคน แล้วจำกัดขาอัปโหลดรวมไม่ให้เกินประมาณ 8 Mbps
    let total = 0;
    this.peers.forEach(peer => { total += levelOf(peer) ? levelOf(peer).br : scrBr; });
    const clamp = this.screen && total > 8000000 ? 8000000 / total : 1;
    this.peers.forEach(peer => {
      const q = levelOf(peer);
      peer.pc.getSenders().forEach(s => {
        if (!s.track) return;
        try {
          const p = s.getParameters();
          if (!p.encodings || !p.encodings.length) p.encodings = [{}];
          const enc = p.encodings[0];
          const isScreen = this.screenTracks.has(s.track);
          if (s.track.kind === 'video') {
            if (isScreen) {
              const h = (s.track.getSettings && s.track.getSettings().height) || 1080;
              enc.maxBitrate = Math.round((q ? q.br : scrBr) * clamp);
              enc.scaleResolutionDownBy = q ? Math.max(1, h / q.h) : (n >= 4 ? 1.5 : 1);
              enc.maxFramerate = q ? q.fps : 30;
            } else enc.maxBitrate = camBr;
          } else enc.maxBitrate = isScreen ? 128000 : 32000;
          s.setParameters(p).catch(() => {});
        } catch (e) { /* ไม่เป็นไร */ }
      });
    });
  }

  setMuted(m) { this.local.getAudioTracks().forEach(t => { t.enabled = !m; }); }
  isMuted() { const t = this.local && this.local.getAudioTracks()[0]; return !!t && !t.enabled; }

  async toggleCamera() {
    const vt = this.local.getVideoTracks()[0];
    if (vt) { vt.enabled = !vt.enabled; this.updateLocalPreview(); return vt.enabled; }
    const cam = await navigator.mediaDevices.getUserMedia({ video: this.camConstraints() });
    const track = cam.getVideoTracks()[0];
    this.local.addTrack(track);
    this.peers.forEach(({ pc }) => pc.addTrack(track, this.local));   // เพิ่มภาพ: ระบบจะเจรจาใหม่ให้เอง
    this.updateLocalPreview();
    this.tune();
    return true;
  }

  // สลับกล้องหน้า/หลัง (เปลี่ยนภาพโดยไม่ต้องเจรจาใหม่)
  async flipCamera() {
    const prev = this.facing;
    this.facing = prev === 'user' ? 'environment' : 'user';
    const old = this.local.getVideoTracks()[0];
    if (!old) return this.facing;                                   // กล้องยังปิดอยู่: จำไว้ใช้ตอนเปิดกล้อง
    old.stop();
    let track;
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: this.camConstraints() });
      track = cam.getVideoTracks()[0];
    } catch (e) {
      this.facing = prev;                                           // สลับไม่ได้ (เช่น เครื่องมีกล้องตัวเดียว): กลับไปใช้ตัวเดิม
      const cam = await navigator.mediaDevices.getUserMedia({ video: this.camConstraints() });
      track = cam.getVideoTracks()[0];
      this.swapVideoTrack(old, track);
      throw e;
    }
    this.swapVideoTrack(old, track);
    return this.facing;
  }

  swapVideoTrack(old, track) {
    this.peers.forEach(({ pc }) => pc.getSenders().forEach(s => { if (s.track === old) s.replaceTrack(track).catch(() => {}); }));
    this.local.removeTrack(old);
    this.local.addTrack(track);
    this.updateLocalPreview();
    this.tune();
  }

  hasCamera() { const t = this.local && this.local.getVideoTracks()[0]; return !!t && t.enabled; }

  updateLocalPreview() {
    const v = $('call-local');
    const on = this.hasCamera();
    if (on) v.srcObject = this.local;
    v.classList.toggle('hidden-element', !on);
    v.classList.toggle('mirror', this.facing === 'user');
    updateCallLayout();
  }

  // ---- สตรีมหน้าจอ (Watch Party) ----
  async startScreenShare() {
    if (this.screen) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error('unsupported');
    const { error } = await sb.rpc('start_stream', { p_call: this.callId });
    if (error) throw error;                                         // เช่น stream_busy: มีคนสตรีมอยู่แล้ว
    let scr;
    try {
      scr = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 24, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
        audio: true
      });
    } catch (e) {
      await sb.rpc('stop_stream', { p_call: this.callId });
      throw e;
    }
    this.screen = scr;
    scr.getTracks().forEach(t => {
      this.screenTracks.add(t);
      if (t.kind === 'video') { try { t.contentHint = 'motion'; } catch (e) { /* ไม่เป็นไร */ } }
      t.onended = () => { if (this.screen === scr) this.stopScreenShare(); };   // กด "หยุดแชร์" ของเบราว์เซอร์
    });
    this.send('*', 'share', { on: true, id: scr.id });             // บอกก่อนส่งภาพ ผู้รับจะได้รู้ว่าสตรีมนี้คือหน้าจอ
    this.peers.forEach(({ pc }) => scr.getTracks().forEach(t => pc.addTrack(t, scr)));
    this.beatTimer = setInterval(() => { sb.rpc('beat_stream', { p_call: this.callId }); }, 25000);
    this.tune();
  }

  async stopScreenShare() {
    const scr = this.screen;
    if (!scr) return;
    this.screen = null;
    clearInterval(this.beatTimer);
    this.send('*', 'share', { on: false });
    this.peers.forEach(({ pc }) => pc.getSenders().forEach(s => {
      if (s.track && this.screenTracks.has(s.track)) { try { pc.removeTrack(s); } catch (e) { /* ไม่เป็นไร */ } }
    }));
    scr.getTracks().forEach(t => { t.onended = null; t.stop(); this.screenTracks.delete(t); });
    updateShareButton();
    renderCallStatus();
    if (!this.closed) await sb.rpc('stop_stream', { p_call: this.callId });
  }

  setDeaf(d) {
    this.deaf = d;
    document.querySelectorAll('#call-grid video').forEach(v => { v.muted = d; });
    const sv = $('call-screen-video');
    if (sv) sv.muted = d;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.send('*', 'bye', {}); } catch (e) { /* ไม่เป็นไร */ }
    clearInterval(this.timer);
    clearInterval(this.beatTimer);
    if (this.screen) { this.screen.getTracks().forEach(t => { t.onended = null; t.stop(); }); this.screen = null; }
    this.peers.forEach(p => { clearTimeout(p.failTimer); try { p.pc.close(); } catch (e) { /* ไม่เป็นไร */ } });
    this.peers.clear();
    this.remoteScreens.clear();
    if (this.local) this.local.getTracks().forEach(t => t.stop());
    const ch = this.channel;
    this.channel = null;
    if (ch) setTimeout(() => { try { sb.removeChannel(ch); } catch (e) { /* ไม่เป็นไร */ } }, 400);
  }
}

// ---------- หน้าจอสาย ----------
function callTile(uid) {
  let el = document.querySelector(`.call-tile[data-uid="${uid}"]`);
  if (el) return el;
  el = document.createElement('div');
  el.className = 'call-tile';
  el.dataset.uid = uid;
  const v = document.createElement('video');
  v.autoplay = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  if (CALL.session && CALL.session.deaf) v.muted = true;
  const av = document.createElement('div');
  av.className = 'avatar call-av';
  const nm = document.createElement('div');
  nm.className = 'call-name';
  const st = document.createElement('div');
  st.className = 'call-tile-status';
  el.append(v, av, nm, st);
  $('call-grid').appendChild(el);
  updateCallTile(uid);
  renderCallStatus();
  return el;
}

function updateCallTile(uid) {
  const s = CALL.session;
  const el = document.querySelector(`.call-tile[data-uid="${uid}"]`);
  if (!s || !el) return;
  const chat = s.chat;
  const label = chat.isGroup ? groupSenderName(chat, uid) : nameOf(chat);
  const prof = chat.isGroup ? (social.profiles[uid] || state.contacts[uid]) : chat;
  el.querySelector('.call-name').textContent = label;
  renderAvatar(el.querySelector('.call-av'), (!chat.anonymous && prof && prof.avatar) || '', label);
  const peer = s.peers.get(uid);
  const stream = peer && peer.stream;
  const vt = stream && stream.getVideoTracks().find(t => t.readyState === 'live' && !t.muted);
  el.classList.toggle('has-video', !!vt);
  const st = peer ? peer.pc.connectionState : 'new';
  el.querySelector('.call-tile-status').textContent =
    st === 'connected' ? '' : st === 'failed' ? 'เชื่อมต่อไม่ได้' : st === 'disconnected' ? 'สัญญาณหลุด…' : 'กำลังเชื่อมต่อ…';
  updateCallLayout();
}

function attachCallStream(uid, stream) {
  const el = callTile(uid);
  const v = el.querySelector('video');
  if (v.srcObject !== stream) v.srcObject = stream;
  v.play().catch(() => { /* บางเบราว์เซอร์ต้องแตะหน้าจอก่อน: ดู resumeCallPlayback */ });
  updateCallTile(uid);
}

function removeCallTile(uid) {
  const el = document.querySelector(`.call-tile[data-uid="${uid}"]`);
  if (el) el.remove();
}

function resumeCallPlayback() {
  document.querySelectorAll('#call-grid video').forEach(v => v.play().catch(() => {}));
  const sv = $('call-screen-video');
  if (sv && sv.srcObject) sv.play().catch(() => {});
}

// จัดรูปแบบหน้าจออัตโนมัติ: เสียงล้วน (รูป+ชื่อกลางจอ) / วิดีโอเต็มจอ / ดูสตรีมหน้าจอ
function updateCallLayout() {
  const s = CALL.session;
  if (!s) return;
  const ov = $('call-overlay');
  const watching = !!(CALL.screenView && s.remoteScreens.get(CALL.screenView));
  const anyVideo = !!document.querySelector('.call-tile.has-video');
  const layout = watching ? 'watch' : anyVideo ? 'video' : (s.chat.isGroup ? 'voice-group' : 'voice');
  ov.dataset.layout = layout;
  const tiles = $('call-grid').children.length;
  $('call-grid').classList.toggle('n1', tiles === 1);
  const showHero = layout === 'voice' || (layout === 'voice-group' && tiles === 0);
  $('call-hero').classList.toggle('hidden-element', !showHero);
  $('call-q').classList.toggle('hidden-element', layout !== 'watch');
  if (layout !== 'watch') $('q-menu').classList.add('hidden-element');
  if (layout === 'watch' && CALL.screenView) {
    const want = qualityPref();
    if (want !== 'auto' && CALL.qSent !== CALL.screenView + ':' + want) { s.send(CALL.screenView, 'q', { level: want }); CALL.qSent = CALL.screenView + ':' + want; }
  }
  const canFull = layout === 'watch' || layout === 'video';
  $('call-fs').classList.toggle('hidden-element', !canFull);
  if (CALL.immersive && !canFull) setImmersive(false);   // ไม่มีภาพให้ดูแล้ว (เช่น เพื่อนหยุดสตรีม): ออกจากโหมดเต็มจอ
  const myCam = s.hasCamera();
  $('call-local').classList.toggle('hidden-element', !myCam || layout === 'voice' || layout === 'voice-group');
  updateCallButtons();
}

function renderScreen() {
  const s = CALL.session;
  const box = $('call-screen');
  const v = $('call-screen-video');
  const chips = $('call-screen-chips');
  const st = s && CALL.screenView && s.remoteScreens.get(CALL.screenView);
  if (!st) {
    box.classList.add('hidden-element');
    v.srcObject = null;
    chips.innerHTML = '';
  } else {
    box.classList.remove('hidden-element');
    if (v.srcObject !== st) v.srcObject = st;
    v.muted = s.deaf;
    v.play().catch(() => {});
    chips.innerHTML = '';
    if (s.remoteScreens.size > 1) {
      s.remoteScreens.forEach((_, uid) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'screen-chip' + (uid === CALL.screenView ? ' active' : '');
        b.textContent = '🖥 ' + (s.chat.isGroup ? groupSenderName(s.chat, uid) : nameOf(s.chat));
        b.onclick = e => { e.stopPropagation(); CALL.screenView = uid; renderScreen(); };
        chips.appendChild(b);
      });
    }
  }
  updateCallLayout();
}

function callStatusText() {
  const s = CALL.session;
  if (!s) return '';
  let t;
  if (s.startedAt) {
    const sec = Math.floor((Date.now() - s.startedAt) / 1000);
    t = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  } else if (s.peers.size) t = 'กำลังเชื่อมต่อ…';
  else t = s.chat.isGroup ? 'รอเพื่อนเข้าร่วมสาย…' : 'กำลังโทร…';
  if (s.screen) t += ' · 🔴 คุณกำลังสตรีม';
  return t;
}

function renderCallStatus() {
  const s = CALL.session;
  if (!s) return;
  const t = callStatusText();
  $('call-status').textContent = t;
  $('call-hero-status').textContent = t;
  $('call-pill-text').textContent = `${nameOf(s.chat)} · ${t}`;
}

function updateCallButtons() {
  const s = CALL.session;
  if (!s) return;
  const muted = s.isMuted();
  setIcon($('call-mic'), muted ? 'micOff' : 'mic');
  $('call-mic').classList.toggle('off', muted);
  $('call-mic').querySelector('small').textContent = muted ? 'เปิดไมค์' : 'ปิดไมค์';
  const cam = s.hasCamera();
  setIcon($('call-cam'), cam ? 'video' : 'videoOff');
  $('call-cam').classList.toggle('off', !cam);
  $('call-cam').querySelector('small').textContent = cam ? 'ปิดกล้อง' : 'เปิดกล้อง';
  $('call-flip').classList.toggle('disabled', !cam);
  setIcon($('call-spk'), s.deaf ? 'speakerOff' : 'speaker');
  $('call-spk').classList.toggle('off', s.deaf);
  updateShareButton();
}

function updateShareButton() {
  const b = $('call-share');
  const s = CALL.session;
  if (!b) return;
  b.classList.toggle('hidden-element', !canShareScreen());
  b.classList.toggle('on', !!(s && s.screen));
  const sm = b.querySelector('small');
  if (sm) sm.textContent = s && s.screen ? 'หยุดสตรีม' : 'สตรีมจอ';
}

function openCallUI(s) {
  $('call-overlay').classList.remove('minimized');
  $('call-pill').classList.add('hidden-element');
  $('call-title').textContent = nameOf(s.chat);
  $('call-hero-name').textContent = nameOf(s.chat);
  renderAvatar($('call-hero-av'), s.chat.avatar, nameOf(s.chat));
  $('call-hero-av').classList.toggle('group-av', !!s.chat.isGroup);
  $('call-grid').innerHTML = '';
  $('watch-chat').classList.add('hidden-element');
  $('watch-float').innerHTML = '';
  CALL.wUnread = 0;
  updateWatchBadge();
  $('call-fs').classList.add('hidden-element');
  $('call-overlay').dataset.layout = s.chat.isGroup ? 'voice-group' : 'voice';
  $('call-overlay').classList.remove('hidden-element');
  initCallIcons();
  initPip();
  renderCallStatus();
  updateCallLayout();
  updateCallBanner();
}

function closeCallUI() {
  releaseWake();
  CALL.qSent = null;
  $('q-menu').classList.add('hidden-element');
  CALL.immersive = false;
  $('call-overlay').classList.remove('immersive');
  $('imm-exit').classList.add('hidden-element');
  $('call-overlay').classList.add('hidden-element');
  $('call-overlay').classList.remove('minimized');
  $('call-pill').classList.add('hidden-element');
  $('call-grid').innerHTML = '';
  $('watch-chat').classList.add('hidden-element');
  $('watch-float').innerHTML = '';
  CALL.screenView = null;
  CALL.wUnread = 0;
  const sv = $('call-screen-video');
  sv.srcObject = null;
  $('call-screen').classList.add('hidden-element');
  const v = $('call-local');
  v.srcObject = null;
  v.classList.add('hidden-element');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  updateCallBanner();
}

let callIconsReady = false;
function initCallIcons() {
  if (callIconsReady) return;
  callIconsReady = true;
  document.querySelectorAll('#call-overlay [data-i]').forEach(el => setIcon(el, el.dataset.i));
}

function toggleCallMic() {
  const s = CALL.session;
  if (!s) return;
  s.setMuted(!s.isMuted());
  updateCallButtons();
}

async function toggleCallCam() {
  const s = CALL.session;
  if (!s) return;
  try { await s.toggleCamera(); } catch (e) { toast(callErrorText(e), 'error'); }
  updateCallButtons();
  updateCallLayout();
}

async function flipCallCamera() {
  const s = CALL.session;
  if (!s) return;
  if (!s.hasCamera()) return toast('เปิดกล้องก่อน แล้วจึงสลับกล้องหน้า/หลังได้', 'info');
  try { await s.flipCamera(); } catch (e) { toast('สลับกล้องไม่ได้ (อุปกรณ์นี้อาจมีกล้องตัวเดียว)', 'error'); }
  updateCallButtons();
}

function toggleCallSpeaker() {
  const s = CALL.session;
  if (!s) return;
  s.setDeaf(!s.deaf);
  updateCallButtons();
}

async function toggleCallShare() {
  const s = CALL.session;
  if (!s) return;
  try {
    if (s.screen) await s.stopScreenShare();
    else {
      await s.startScreenShare();
      toast('เริ่มสตรีมหน้าจอแล้ว เพื่อนในห้องกดเข้าชมได้เลย', 'success');
    }
  } catch (e) { toast(streamErrorText(e), 'error'); }
  updateShareButton();
  renderCallStatus();
}

// โหมดดูเต็มจอ: ซ่อนทุกปุ่ม/ไอคอน เหลือแต่วิดีโอ  แตะ 1 ครั้ง = แสดงปุ่มออกชั่วคราว / แตะ 2 ครั้ง = ออก
let immTimer = null;
let immLastTap = 0;

function immFullRequested() { const o = $('call-overlay'); return !!(o.requestFullscreen || o.webkitRequestFullscreen); }

function qualityPref() { return localStorage.getItem('darkchat_qos') || 'auto'; }

function renderQualityMenu() {
  const box = $('q-menu');
  const cur = qualityPref();
  const v = $('call-screen-video');
  const got = v && v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : '-';
  box.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'q-title';
  t.textContent = `คุณภาพภาพสตรีม · ภาพที่ได้รับตอนนี้ ${got}`;
  box.appendChild(t);
  Object.keys(QOS).forEach(key => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'q-opt' + (key === cur ? ' active' : '');
    const dot = document.createElement('span');
    dot.className = 'q-dot';
    const txt = document.createElement('span');
    const nm = document.createElement('strong');
    nm.textContent = QOS[key].name;
    const ds = document.createElement('small');
    ds.textContent = QOS[key].desc;
    txt.append(nm, ds);
    b.append(dot, txt);
    b.onclick = () => setStreamQuality(key);
    box.appendChild(b);
  });
}

function toggleQualityMenu() {
  const box = $('q-menu');
  if (box.classList.contains('hidden-element')) { renderQualityMenu(); box.classList.remove('hidden-element'); }
  else box.classList.add('hidden-element');
}

function setStreamQuality(level) {
  try { localStorage.setItem('darkchat_qos', level); } catch (e) { /* ไม่เป็นไร */ }
  const s = CALL.session;
  if (s && CALL.screenView) { s.send(CALL.screenView, 'q', { level }); CALL.qSent = CALL.screenView + ':' + level; }
  renderQualityMenu();
  setTimeout(() => { if (!$('q-menu').classList.contains('hidden-element')) renderQualityMenu(); }, 2500);  // อัปเดตขนาดภาพที่ได้รับจริงหลังปรับ
}

function toggleCallFullscreen() { setImmersive(!CALL.immersive); }

function showImmExit(text, ms) {
  const b = $('imm-exit');
  b.textContent = text;
  b.classList.remove('hidden-element');
  clearTimeout(immTimer);
  immTimer = setTimeout(() => b.classList.add('hidden-element'), ms || 3000);
}

function setImmersive(on) {
  const o = $('call-overlay');
  const full = document.fullscreenElement || document.webkitFullscreenElement;
  CALL.immersive = !!on;
  o.classList.toggle('immersive', !!on);
  if (on) {
    // คอมพิวเตอร์/Android: ขอเต็มจอจริงของเบราว์เซอร์ด้วย (iPhone ไม่รองรับ ใช้โหมดซ่อนปุ่มอย่างเดียว)
    try {
      const f = o.requestFullscreen || o.webkitRequestFullscreen;
      if (f && !full) { const p = f.call(o); if (p && p.catch) p.catch(() => {}); }
    } catch (e) { /* ไม่เป็นไร */ }
    immLastTap = 0;
    showImmExit('แตะสองครั้งเพื่อออกจากเต็มจอ' + (window.innerHeight > window.innerWidth ? ' · หมุนจอเป็นแนวนอนจะเห็นภาพใหญ่ขึ้น' : ''), 3500);
  } else {
    clearTimeout(immTimer);
    $('imm-exit').classList.add('hidden-element');
    try {
      if (document.fullscreenElement && document.exitFullscreen) { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); }
      else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) { /* ไม่เป็นไร */ }
  }
}

function onImmersiveTap(e) {
  if (!CALL.immersive || (e.target.closest && e.target.closest('#imm-exit'))) return;
  const now = Date.now();
  if (now - immLastTap < 330) { immLastTap = 0; setImmersive(false); return; }
  immLastTap = now;
  showImmExit('ออกจากเต็มจอ', 3000);
}

function minimizeCall() {
  if (!CALL.session) return;
  $('call-overlay').classList.add('minimized');
  $('call-pill').classList.remove('hidden-element');
}

function restoreCall() {
  $('call-overlay').classList.remove('minimized');
  $('call-pill').classList.add('hidden-element');
  resumeCallPlayback();
}

// ---------- ช่องภาพของเรา: ลากย้ายไปที่ไหนของหน้าจอก็ได้ ----------
function clampPip() {
  const v = $('call-local');
  const w = v.offsetWidth || 104, h = v.offsetHeight || 140;
  const l = parseFloat(v.style.left), t = parseFloat(v.style.top);
  if (isNaN(l) || isNaN(t)) return;
  v.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, l)) + 'px';
  v.style.top = Math.max(6, Math.min(window.innerHeight - h - 6, t)) + 'px';
}

function restorePip() {
  const v = $('call-local');
  try {
    const p = JSON.parse(localStorage.getItem('darkchat_pip') || 'null');
    if (p && typeof p.x === 'number' && typeof p.y === 'number') {
      v.style.left = (p.x * window.innerWidth) + 'px';
      v.style.top = (p.y * window.innerHeight) + 'px';
      v.style.right = 'auto';
      v.style.bottom = 'auto';
      clampPip();
    }
  } catch (e) { /* ใช้ตำแหน่งเริ่มต้น */ }
}

function initPip() {
  const v = $('call-local');
  if (v.dataset.pip) { restorePip(); return; }
  v.dataset.pip = '1';
  let drag = false, pid = null, sx = 0, sy = 0, ox = 0, oy = 0;
  v.addEventListener('pointerdown', e => {
    drag = true; pid = e.pointerId;
    try { v.setPointerCapture(pid); } catch (_) { /* ไม่เป็นไร */ }
    const r = v.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    v.classList.add('dragging');
    e.preventDefault();
    e.stopPropagation();
  });
  v.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== pid) return;
    v.style.left = (ox + e.clientX - sx) + 'px';
    v.style.top = (oy + e.clientY - sy) + 'px';
    v.style.right = 'auto';
    v.style.bottom = 'auto';
    clampPip();
  });
  const end = () => {
    if (!drag) return;
    drag = false;
    v.classList.remove('dragging');
    try { v.releasePointerCapture(pid); } catch (_) { /* ไม่เป็นไร */ }
    const r = v.getBoundingClientRect();
    try { localStorage.setItem('darkchat_pip', JSON.stringify({ x: r.left / window.innerWidth, y: r.top / window.innerHeight })); } catch (e) { /* ไม่เป็นไร */ }
  };
  v.addEventListener('pointerup', end);
  v.addEventListener('pointercancel', end);
  window.addEventListener('resize', clampPip);
  restorePip();
}

// ---------- แชทซ้อนบนจอสาย / จอสตรีม ----------
function watchChatOpen() { return !$('watch-chat').classList.contains('hidden-element'); }

function updateWatchBadge() {
  const b = $('call-chat-badge');
  b.textContent = CALL.wUnread > 9 ? '9+' : String(CALL.wUnread);
  b.classList.toggle('hidden-element', CALL.wUnread === 0);
}

function toggleWatchChat() {
  const p = $('watch-chat');
  const show = p.classList.contains('hidden-element');
  p.classList.toggle('hidden-element', !show);
  if (show) {
    CALL.wUnread = 0;
    $('watch-float').innerHTML = '';
    renderWatchChat();
    setTimeout(() => $('watch-input').focus(), 80);
  }
  updateWatchBadge();
}

function renderWatchChat() {
  const s = CALL.session;
  if (!s) return;
  const chat = s.chat;
  const box = $('watch-msgs');
  box.innerHTML = '';
  visibleMessages(chat).filter(m => m.kind === 'text' || m.kind === 'card').slice(-40).forEach(m => {
    const row = document.createElement('div');
    row.className = 'wm' + (m.isMe ? ' me' : '');
    if (chat.isGroup && !m.isMe) {
      const who = document.createElement('div');
      who.className = 'wm-who';
      who.textContent = groupSenderName(chat, m.senderId);
      row.appendChild(who);
    }
    const body = document.createElement('div');
    body.className = 'wm-body';
    if (m.sticker) {
      const img = document.createElement('img');
      img.className = 'wm-sticker';
      img.src = stickerUri(m.sticker);
      img.alt = 'สติ๊กเกอร์';
      body.appendChild(img);
    } else if (m.media) body.textContent = msgLabel(m);
    else if (m.kind === 'card') body.textContent = m.text;
    else linkify(body, m.text);
    row.appendChild(body);
    box.appendChild(row);
  });
  box.scrollTop = box.scrollHeight;
}

// เรียกจาก addLocal ทุกครั้งที่มีข้อความเข้า/ออกของห้อง
function watchChatUpdated(chatId, msg) {
  const s = CALL.session;
  if (!s || s.chat.id !== chatId) return;
  if (watchChatOpen()) { renderWatchChat(); return; }
  if (!msg.isMe && msg.kind === 'text') {
    CALL.wUnread++;
    updateWatchBadge();
    flashWatchMsg(msg);
  }
}

// ข้อความลอยขึ้นบนจอ เมื่อปิดแถบแชทอยู่
function flashWatchMsg(msg) {
  const box = $('watch-float');
  const s = CALL.session;
  const el = document.createElement('div');
  el.className = 'wf';
  const who = s.chat.isGroup ? groupSenderName(s.chat, msg.senderId) : nameOf(s.chat);
  el.textContent = `${who}: ${msg.sticker ? '🏷 สติ๊กเกอร์' : msgLabel(msg)}`;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 6000);
}

async function sendWatchMessage(e) {
  e.preventDefault();
  const s = CALL.session;
  if (!s) return;
  const input = $('watch-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const chat = s.chat;
  const now = Date.now();
  const msg = {
    id: 'tmp_' + now + '_' + Math.random().toString(36).slice(2, 7),
    text, ts: now, isMe: true, senderId: currentUser.id, kind: 'text',
    expiresAt: null, ttl: null, timer: null, status: 'sending', readAt: null, replyTo: null, mentions: [], mentionAll: false
  };
  addLocal(chat.id, msg);
  playSound('send');
  if (activeChat && activeChat.id === chat.id) loadMessages();
  loadChatList();
  await deliverMessage(chat, msg);
  renderWatchChat();
}

// ---------- เริ่มสาย / เข้าร่วม / วางสาย ----------
async function startCall(kind) {
  const chat = activeChat;
  if (!chat) return;
  if (CALL.session) return toast('คุณอยู่ในสายอื่นอยู่', 'info');
  if (chat.isSaved) return toast('โทรหาตัวเองไม่ได้', 'info');
  if (!chat.isGroup && social.blocked.has(chat.id)) return toast('คุณบล็อกผู้ใช้นี้ไว้ ปลดบล็อกก่อนจึงจะโทรได้', 'error');
  const { data, error } = await sb.rpc('start_call', { p_chat: chat.id, p_group: !!chat.isGroup, p_kind: kind });
  if (error) return handleDbError(error);
  await joinCall(data, chat, kind);
}

// ปุ่มสตรีมที่หัวห้อง: เริ่ม Watch Party (เริ่มสายถ้ายังไม่มี แล้วเริ่มแชร์หน้าจอ)
async function startWatchParty() {
  const chat = activeChat;
  if (!chat) return;
  if (!canShareScreen()) return toast('การแชร์หน้าจอใช้ได้บนคอมพิวเตอร์เท่านั้น (มือถือเข้ามาดูและคุยด้วยไมค์ได้)', 'info');
  if (!CALL.session) await startCall('audio');
  if (CALL.session && CALL.session.chat.id === chat.id && !CALL.session.screen) toggleCallShare();
}

async function joinCall(callId, chat, kind) {
  if (CALL.session) return;
  if (!window.RTCPeerConnection || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return toast('เบราว์เซอร์นี้ยังโทรไม่ได้', 'error');
  }
  const { data, error } = await sb.rpc('join_call', { p_call: callId });
  if (error) return handleDbError(error);
  const s = new CallSession(callId, chat, (data && data.kind) || kind);
  CALL.session = s;
  openCallUI(s);
  const streaming = (CALL.streams[callId] || []).some(x => x.user_id !== currentUser.id);
  try {
    await s.start();
    acquireWake();
    if (streaming) { s.setMuted(true); updateCallButtons(); toast('เข้าชมสตรีมแล้ว ไมค์ปิดไว้ก่อนเพื่อกันเสียงสะท้อน กดปุ่มไมค์เมื่ออยากพูด', 'info'); }
  } catch (e) { toast(callErrorText(e), 'error'); await endCall(); }
}

async function endCall() {
  const s = CALL.session;
  if (!s) return;
  CALL.session = null;
  s.close();
  closeCallUI();
  await sb.rpc('leave_call', { p_call: s.callId });
}

function remoteEnded() {
  const s = CALL.session;
  if (!s) return;
  CALL.session = null;
  s.close();
  closeCallUI();
  toast('สายสิ้นสุดแล้ว', 'info');
}

// ---------- สายเข้า ----------
function startRingtone() {
  stopRingtone();
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    CALL.ringCtx = ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const beep = (t0, f) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.42);
    };
    const ring = () => {
      const t = ctx.currentTime;
      beep(t, 440);
      beep(t + 0.5, 480);
      if (navigator.vibrate) navigator.vibrate([300, 200, 300]);
    };
    ring();
    CALL.ringTimer = setInterval(ring, 2500);
  } catch (e) { /* เสียงเรียกเข้าเป็นแค่ส่วนเสริม */ }
}

function stopRingtone() {
  clearInterval(CALL.ringTimer);
  CALL.ringTimer = null;
  if (CALL.ringCtx) { CALL.ringCtx.close().catch(() => {}); CALL.ringCtx = null; }
  if (navigator.vibrate) navigator.vibrate(0);
}

async function showIncoming(row) {
  if (!currentUser || (CALL.incoming && CALL.incoming.id === row.id)) return;
  if (CALL.session) { if (!row.is_group) sb.rpc('decline_call', { p_call: row.id }); return; } // อยู่ในสายอื่น: ปฏิเสธอัตโนมัติ
  let chat;
  if (row.is_group) chat = state.groups[row.chat_id];
  else chat = state.contacts[row.started_by] || (await ensureProfiles([row.started_by]))[0];
  if (!chat) return;
  if (!row.is_group && social.blocked.has(row.started_by)) return;
  if (row.is_group && isMuted(chat.id)) return;   // กลุ่มที่ปิดเสียง: ไม่เด้งสายเข้า (ยังเห็นป้ายในห้อง)
  if (dndActive()) return;                         // ช่วงห้ามรบกวน
  CALL.incoming = { id: row.id, chat, kind: row.kind, isGroup: !!row.is_group };
  renderAvatar($('inc-avatar'), chat.avatar, nameOf(chat));
  $('inc-name').textContent = nameOf(chat);
  $('inc-text').textContent = (row.is_group ? 'สายกลุ่ม · ' : '') + (row.kind === 'video' ? 'วิดีโอคอล' : 'โทรเสียง');
  $('incoming-call').classList.remove('hidden-element');
  startRingtone();
  clearTimeout(CALL.incomingTimer);
  CALL.incomingTimer = setTimeout(dismissIncoming, 60000);
}

function dismissIncoming() {
  clearTimeout(CALL.incomingTimer);
  CALL.incoming = null;
  stopRingtone();
  $('incoming-call').classList.add('hidden-element');
}

async function acceptIncoming() {
  const inc = CALL.incoming;
  if (!inc) return;
  dismissIncoming();
  await joinCall(inc.id, inc.chat, inc.kind);
}

function declineIncoming() {
  const inc = CALL.incoming;
  if (!inc) return;
  dismissIncoming();
  if (!inc.isGroup) sb.rpc('decline_call', { p_call: inc.id });
}

// ---------- สถานะสายและสตรีมของห้อง (ป้ายด้านบนแชท) + เหตุการณ์จากเซิร์ฟเวอร์ ----------
function callKeyOf(row) {
  return row.is_group ? row.chat_id : (row.started_by === currentUser.id ? row.chat_id : row.started_by);
}

function onCallChange(payload) {
  if (!currentUser) return;
  const row = payload.new;
  if (!row) return;
  const key = callKeyOf(row);
  const open = row.status === 'ringing' || row.status === 'active';
  if (open) CALL.open[key] = row;
  else {
    if (CALL.open[key] && CALL.open[key].id === row.id) delete CALL.open[key];
    delete CALL.streams[row.id];
  }

  if (payload.eventType === 'INSERT' && open && row.started_by !== currentUser.id) showIncoming(row);
  if (!open) {
    if (CALL.incoming && CALL.incoming.id === row.id) dismissIncoming();
    if (CALL.session && CALL.session.callId === row.id) remoteEnded();
  }
  updateCallBanner();
  if (activeChat) loadMessages(true);   // ให้ปุ่มบนการ์ดสาย (เข้าร่วม/โทรอีกครั้ง) ตรงกับสถานะ
}

function onStreamChange(payload) {
  if (!currentUser) return;
  const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
  if (!row || !row.call_id) return;
  const list = CALL.streams[row.call_id] || (CALL.streams[row.call_id] = []);
  const k = list.findIndex(x => x.user_id === row.user_id);
  if (payload.eventType === 'DELETE') { if (k >= 0) list.splice(k, 1); }
  else if (k < 0) list.push({ call_id: row.call_id, user_id: row.user_id });
  updateCallBanner();
  const s = CALL.session;
  if (s && s.callId === row.call_id) { updateShareButton(); renderCallStatus(); }
}

async function loadOpenCall(chat) {
  const { data, error } = await sb.rpc('open_call_of', { p_chat: chat.id, p_group: !!chat.isGroup });
  if (error) return;
  const row = (data || [])[0];
  if (row) {
    CALL.open[chat.id] = row;
    const st = await sb.from('call_streams').select('call_id, user_id').eq('call_id', row.id);
    if (!st.error) CALL.streams[row.id] = st.data || [];
  } else delete CALL.open[chat.id];
  updateCallBanner();
}

function streamerName(chat, uid) {
  if (uid === currentUser.id) return 'คุณ';
  return chat.isGroup ? groupSenderName(chat, uid) : nameOf(chat);
}

function updateStreamBadge() {
  const el = $('stream-badge');
  const c = activeChat;
  const row = c && CALL.open[c.id];
  const list = (row && CALL.streams[row.id]) || [];
  if (!c || !list.length) { el.classList.add('hidden-element'); return; }
  el.textContent = '🔴 ' + list.map(x => streamerName(c, x.user_id)).join(', ') + ' กำลังสตรีม';
  el.classList.remove('hidden-element');
}

function updateCallBanner() {
  const el = $('call-banner');
  const c = activeChat;
  const row = c && CALL.open[c.id];
  const inThis = CALL.session && c && CALL.session.chat.id === c.id;
  updateStreamBadge();
  if (!row || inThis) { el.classList.add('hidden-element'); return; }
  const streams = CALL.streams[row.id] || [];
  $('call-banner-text').textContent = streams.length
    ? '🔴 ' + streams.map(x => streamerName(c, x.user_id)).join(', ') + ' กำลังสตรีม'
    : (row.kind === 'video' ? '📹 ' : '📞 ') + (c.isGroup ? 'มีสายกลุ่มกำลังดำเนินอยู่' : 'มีสายกำลังดำเนินอยู่');
  $('call-banner-btn').textContent = streams.length ? 'เข้าชม' : 'เข้าร่วม';
  el.classList.remove('hidden-element');
}

// กันหน้าจอดับระหว่างสาย (ถ้าเบราว์เซอร์รองรับ)
async function acquireWake() {
  try { if (navigator.wakeLock && !CALL.wake) CALL.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ไม่เป็นไร */ }
}

function releaseWake() {
  try { if (CALL.wake) CALL.wake.release(); } catch (e) { /* ไม่เป็นไร */ }
  CALL.wake = null;
}

// เปิดแอปหรือกลับมาที่แอปตอนที่สายยังดังอยู่ (เช่น กดจากแจ้งเตือน) ให้ขึ้นหน้าจอรับสาย
async function checkRingingCalls() {
  if (!currentUser || CALL.session) return;
  const since = new Date(Date.now() - 55000).toISOString();
  const { data, error } = await sb.from('calls').select('*')
    .eq('status', 'ringing').gt('started_at', since).neq('started_by', currentUser.id)
    .order('started_at', { ascending: false }).limit(1);
  if (error || !data || !data.length) return;
  CALL.open[callKeyOf(data[0])] = data[0];
  showIncoming(data[0]);
}

function joinOpenCall() {
  const c = activeChat;
  const row = c && CALL.open[c.id];
  if (row) joinCall(row.id, c, row.kind);
}

// ==================== เฟส F1: ห้องลับ (เข้ารหัสข้อความปลายทาง 1 ต่อ 1) ====================
// หลักการ: ทุกเครื่องมีคู่กุญแจ ECDH P-256 (กุญแจส่วนตัวเก็บใน IndexedDB แบบดึงออกไม่ได้ ไม่เคยขึ้นเซิร์ฟเวอร์)
// ข้อความแต่ละก้อนเข้ารหัสด้วยกุญแจสุ่ม AES-256-GCM แล้วห่อกุญแจนั้นให้ "ทุกเครื่อง" ของทั้งสองฝ่าย (ECDH + HKDF + AES-GCM)
const SECRET_TEXT = '🔒 ข้อความที่เข้ารหัส';
const ECDH_ALG = { name: 'ECDH', namedCurve: 'P-256' };
const E2EE = { ready: null, priv: null, keyId: null, cache: {}, pending: [], queued: false };

const enc8 = s => new TextEncoder().encode(s);
const dec8 = b => new TextDecoder().decode(b);

function b64e(buf) {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64d(str) {
  const s = atob(str);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

async function deriveWrapKey(privKey, pubKey, info) {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pubKey }, privKey, 256);
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc8('darkchat-e2ee-salt-v1'), info: enc8(info) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// เข้ารหัสข้อความ plain (ออบเจกต์) ให้ทุกเครื่องใน recipients ([{ device_key, pub }])
async function e2eeEncrypt(plain, senderId, partnerId, recipients) {
  const cek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc8(`${senderId}|${partnerId}`) }, cek, enc8(JSON.stringify(plain)));
  const raw = await crypto.subtle.exportKey('raw', cek);
  const k = [];
  for (const r of recipients) {
    const pub = await crypto.subtle.importKey('jwk', r.pub, ECDH_ALG, true, []);
    const eph = await crypto.subtle.generateKey(ECDH_ALG, true, ['deriveBits']);   // กุญแจชั่วคราวใช้ครั้งเดียวต่อข้อความต่อเครื่อง
    const wk = await deriveWrapKey(eph.privateKey, pub, 'wrap:' + r.device_key);
    const wiv = crypto.getRandomValues(new Uint8Array(12));
    const w = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wiv, additionalData: enc8(r.device_key) }, wk, raw);
    const ep = await crypto.subtle.exportKey('jwk', eph.publicKey);
    k.push({ d: r.device_key, e: { x: ep.x, y: ep.y }, i: b64e(wiv), w: b64e(w) });
  }
  return { v: 1, i: b64e(iv), c: b64e(ct), k };
}

async function e2eeDecrypt(encObj, privKey, myDeviceKey, senderId, partnerId) {
  const entry = (encObj.k || []).find(x => x.d === myDeviceKey);
  if (!entry) throw new Error('no_entry');   // ข้อความนี้ส่งก่อนที่เครื่องนี้จะลงทะเบียนกุญแจ
  const eph = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: entry.e.x, y: entry.e.y, ext: true }, ECDH_ALG, true, []);
  const wk = await deriveWrapKey(privKey, eph, 'wrap:' + myDeviceKey);
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(entry.i), additionalData: enc8(myDeviceKey) }, wk, b64d(entry.w));
  const cek = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(encObj.i), additionalData: enc8(`${senderId}|${partnerId}`) }, cek, b64d(encObj.c));
  return JSON.parse(dec8(pt));
}

// รหัสความปลอดภัย (ใช้เทียบกับเพื่อนว่าตรงกัน ป้องกันการสวมกุญแจกลางทาง) = แฮชของกุญแจสาธารณะทุกเครื่องของสองฝ่าย
async function safetyCodeFor(meId, myKeys, partnerId, partnerKeys) {
  const part = (id, keys) => `${id}:` + keys.map(k => `${k.pub.x}.${k.pub.y}`).sort().join(',');
  const sides = [[meId, myKeys], [partnerId, partnerKeys]].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc8(sides.map(([id, ks]) => part(id, ks)).join('|'))));
  const groups = [];
  for (let i = 0; i < 12; i++) groups.push(String(((h[2 * i] << 8) | h[2 * i + 1]) % 100000).padStart(5, '0'));
  return groups.join(' ');
}

// ---------- กุญแจของเครื่องนี้ (เก็บใน IndexedDB) ----------
function idbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('darkchat-e2ee', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const q = db.transaction('keys').objectStore('keys').get(key);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}

async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function e2eeInit() {
  if (E2EE.ready) return E2EE.ready;
  E2EE.ready = (async () => {
    if (!window.crypto || !crypto.subtle || !window.indexedDB) throw new Error('unsupported');
    const kk = 'kp:' + currentUser.id;
    let kp = await idbGet(kk);
    if (!kp) { kp = await crypto.subtle.generateKey(ECDH_ALG, false, ['deriveBits']); await idbSet(kk, kp); }
    E2EE.priv = kp.privateKey;
    E2EE.keyId = deviceKey();
    const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const { error } = await sb.rpc('register_e2ee_key', { p_device_key: E2EE.keyId, p_pub: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } });
    if (error) throw error;
    return true;
  })().catch(e => { console.warn('e2ee init', e); E2EE.ready = null; return false; });
  return E2EE.ready;
}

async function fetchKeys(uid, force) {
  const c = E2EE.cache[uid];
  if (!force && c && c.exp > Date.now()) return c.keys;
  const { data, error } = await sb.from('e2ee_keys').select('device_key, pub').eq('user_id', uid).is('revoked_at', null);
  if (error) throw error;
  E2EE.cache[uid] = { keys: data || [], exp: Date.now() + 15000 };
  return E2EE.cache[uid].keys;
}

async function encryptPayload(partnerId, plain) {
  if (!(await e2eeInit())) throw new Error('unsupported');
  const me = currentUser.id;
  let mine = await fetchKeys(me);
  if (!mine.some(k => k.device_key === E2EE.keyId)) mine = await fetchKeys(me, true);
  const theirs = await fetchKeys(partnerId);
  if (!theirs.length) throw new Error('no_partner_key');
  return e2eeEncrypt(plain, me, partnerId, [...mine, ...theirs]);   // ผู้รับ + ทุกเครื่องของเราเอง (เครื่องอื่นของเราจะได้อ่านได้ด้วย)
}

async function decryptMsg(m) {
  try {
    if (!(await e2eeInit())) throw new Error('not ready');
    const obj = await e2eeDecrypt(m.enc, E2EE.priv, E2EE.keyId, m.encFrom, m.encTo);
    m.text = typeof obj.t === 'string' ? obj.t : '';
    m.sticker = obj.s || null;
    m.dec = true;
  } catch (e) {
    m.text = '🔒 ถอดรหัสไม่ได้ (ข้อความนี้ส่งก่อนที่เครื่องนี้จะเข้าร่วม หรือกุญแจเปลี่ยน)';
    m.decFail = true;
    m.dec = true;
  }
}

// ถอดรหัสแบบไม่บล็อกหน้าจอ แล้ววาดใหม่ครั้งเดียว
function queueDecrypt(chatId, msg) {
  E2EE.pending.push([chatId, msg]);
  if (E2EE.queued) return;
  E2EE.queued = true;
  setTimeout(async () => {
    E2EE.queued = false;
    const list = E2EE.pending.splice(0);
    await Promise.all(list.map(([, m]) => decryptMsg(m)));
    const touched = new Set(list.map(x => x[0]));
    if (activeChat && touched.has(activeChat.id)) loadMessages(true);
    loadChatList();
  }, 0);
}

// ---------- สถานะห้องลับ ----------
function isSecret(chatId) { return !!(state.secret && state.secret.has(chatId)); }

async function loadSecretRooms() {
  const { data, error } = await sb.from('secret_rooms').select('a, b');
  if (error) return;   // ยังไม่ได้รัน SQL ของรอบนี้
  const me = currentUser.id;
  state.secret = new Set((data || []).map(r => (r.a === me ? r.b : r.a)));
}

function onSecretChange() {
  loadSecretRooms().then(() => {
    loadChatList();
    if (activeChat) { applySecretUI(activeChat); loadMessages(true); }
  });
}

function verifiedKey() { return 'darkchat_e2ee_verified_' + currentUser.id; }
function getVerified() { try { return JSON.parse(localStorage.getItem(verifiedKey()) || '{}'); } catch (e) { return {}; } }

async function currentSafetyCode(chat) {
  const me = currentUser.id;
  const [mine, theirs] = await Promise.all([fetchKeys(me, true), fetchKeys(chat.id, true)]);
  return safetyCodeFor(me, mine, chat.id, theirs);
}

async function updateSecretBanner(chat) {
  const txt = $('secret-banner-text');
  txt.textContent = '🔒 ห้องลับ · เข้ารหัสปลายทาง';
  try {
    const code = await currentSafetyCode(chat);
    if (!activeChat || activeChat.id !== chat.id) return;
    const verified = getVerified()[chat.id];
    if (!verified) txt.textContent = '🔒 ห้องลับ · ยังไม่ได้ตรวจรหัสความปลอดภัย';
    else if (verified !== code) txt.textContent = '⚠️ ห้องลับ · รหัสความปลอดภัยเปลี่ยน (อาจเป็นเครื่องใหม่ของเพื่อน) ตรวจอีกครั้ง';
  } catch (e) { /* ไม่เป็นไร */ }
}

function applySecretUI(chat) {
  const sec = !!chat && !chat.isGroup && !chat.isSaved && isSecret(chat.id);
  $('chat-area').classList.toggle('secret-mode', sec);
  $('secret-banner').classList.toggle('hidden-element', !sec);
  if (sec) {
    $('message-input').placeholder = `พิมพ์ข้อความลับถึง ${nameOf(chat)}`;
    updateSecretBanner(chat);
  }
}

async function openSafety() {
  const c = activeChat;
  if (!c || !isSecret(c.id)) return;
  $('safety-code').textContent = 'กำลังคำนวณ…';
  $('safety-name').textContent = nameOf(c);
  openModal('safety-modal');
  try {
    const code = await currentSafetyCode(c);
    $('safety-code').textContent = code;
    $('safety-verified').classList.toggle('hidden-element', getVerified()[c.id] !== code);
  } catch (e) { $('safety-code').textContent = 'คำนวณไม่ได้ ลองใหม่อีกครั้ง'; }
}

function markSafetyVerified() {
  const c = activeChat;
  const code = $('safety-code').textContent;
  if (!c || !/^\d{5}( \d{5}){11}$/.test(code)) return;
  const all = getVerified();
  all[c.id] = code;
  try { localStorage.setItem(verifiedKey(), JSON.stringify(all)); } catch (e) { /* ไม่เป็นไร */ }
  closeModal('safety-modal');
  toast('บันทึกแล้วว่าตรวจรหัสความปลอดภัยกับเพื่อนแล้ว', 'success');
  updateSecretBanner(c);
}

async function enableSecretRoom() {
  const c = activeChat;
  if (!c || c.isGroup || c.isSaved) return;
  const ok = await confirmDialog('เปิดห้องลับ',
    'ข้อความที่ส่งหลังจากนี้ในห้องนี้จะเข้ารหัสปลายทาง เซิร์ฟเวอร์และเจ้าของระบบอ่านเนื้อหาไม่ได้\n\n' +
    'ข้อจำกัดของรอบนี้: ส่งได้เฉพาะข้อความและสติ๊กเกอร์ (ยังส่งรูป ไฟล์ เสียง การ์ด และตั้งเวลาส่งไม่ได้) แก้ไข/ปักหมุด/ส่งต่อข้อความไม่ได้ และข้อความเก่าก่อนเปิดห้องลับยังไม่เข้ารหัส\n\n' +
    'ถ้าล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่อง จะอ่านข้อความลับเก่าบนเครื่องนั้นไม่ได้ (กู้คืนไม่ได้)', 'เปิดห้องลับ');
  if (!ok) return;
  if (!(await e2eeInit())) return toast('เบราว์เซอร์นี้ยังเข้ารหัสไม่ได้ หรือสร้างกุญแจไม่สำเร็จ', 'error');
  const { error } = await sb.rpc('set_secret_room', { p_partner: c.id, p_on: true });
  if (error) return handleDbError(error);
  await loadSecretRooms();
  loadChatList();
  applySecretUI(c);
  toast('เปิดห้องลับแล้ว แนะนำให้ตรวจรหัสความปลอดภัยกับเพื่อน', 'success');
}

async function disableSecretRoom() {
  const c = activeChat;
  if (!c) return;
  const ok = await confirmDialog('ปิดห้องลับ', 'ข้อความต่อจากนี้จะไม่เข้ารหัสปลายทางแล้ว ข้อความลับเก่ายังอยู่ในแชทตามเดิม', 'ปิดห้องลับ', true);
  if (!ok) return;
  const { error } = await sb.rpc('set_secret_room', { p_partner: c.id, p_on: false });
  if (error) return handleDbError(error);
  await loadSecretRooms();
  loadChatList();
  applySecretUI(c);
}

// ค้นหาในห้องลับ: เซิร์ฟเวอร์อ่านเนื้อหาไม่ได้ จึงค้นเฉพาะข้อความที่ถอดรหัสแล้วในเครื่องนี้
function runSecretSearch(q) {
  const chat = activeChat;
  const box = $('smsg-list');
  box.innerHTML = '';
  box.appendChild(hintNode('ห้องลับ: ค้นได้เฉพาะข้อความที่โหลดและถอดรหัสไว้ในเครื่องนี้'));
  const needle = q.toLowerCase();
  const rows = (state.messages[chat.id] || [])
    .filter(m => m.dec && m.text && m.kind === 'text' && !social.hidden.has(m.id) && m.text.toLowerCase().includes(needle))
    .slice(-40).reverse();
  if (!rows.length) { box.appendChild(hintNode('ไม่พบข้อความที่ตรงกัน')); return; }
  rows.forEach(m => {
    const card = document.createElement('div');
    card.className = 'req-card tap';
    const head = document.createElement('div');
    head.className = 'hint';
    head.style.marginTop = '0';
    head.textContent = `${m.isMe ? 'คุณ' : nameOf(chat)} · ${dividerLabel(m.ts)}`;
    const body = document.createElement('div');
    body.className = 'pin-text';
    const at = m.text.toLowerCase().indexOf(needle);
    body.appendChild(document.createTextNode(m.text.slice(Math.max(0, at - 30), at)));
    const mark = document.createElement('mark');
    mark.textContent = m.text.slice(at, at + q.length);
    body.appendChild(mark);
    body.appendChild(document.createTextNode(m.text.slice(at + q.length, at + q.length + 80)));
    card.append(head, body);
    card.onclick = () => jumpToMessage(m);
    box.appendChild(card);
  });
}

// ==================== เฟส C: ความเสถียรของแชท ====================

// ---------- ส่งข้อความ: แสดงทันที + สถานะ กำลังส่ง/ส่งแล้ว/ส่งไม่สำเร็จ (กดส่งใหม่ได้) ----------
async function deliverMessage(chat, msg) {
  if (msg.status !== 'sending') {
    msg.status = 'sending';
    if (activeChat && activeChat.id === chat.id) loadMessages(true);
  }
  let secretEnc = null;
  if (!chat.isGroup && isSecret(chat.id)) {
    try { secretEnc = await encryptPayload(chat.id, { t: msg.text, s: msg.sticker || null }); }
    catch (e) {
      msg.status = 'failed';
      toast(e && e.message === 'no_partner_key'
        ? 'ห้องลับ: เพื่อนยังไม่มีกุญแจ (ให้เพื่อนเปิดแอปเวอร์ชันล่าสุดก่อน)'
        : 'ห้องลับ: เข้ารหัสไม่สำเร็จ ข้อความยังไม่ถูกส่ง', 'error');
      if (activeChat && activeChat.id === chat.id) loadMessages(true);
      return;
    }
  }
  const { data, error } = await sb.from('messages').insert({
    sender_id: currentUser.id,
    ...(chat.isGroup ? { group_id: chat.id } : { receiver_id: chat.id }),
    text: secretEnc ? SECRET_TEXT : msg.text,
    ...(secretEnc ? { enc: secretEnc } : {}),
    reply_to: msg.replyTo || null,
    ...(() => {
      const meta = {};
      if (chat.isGroup && ((msg.mentions && msg.mentions.length) || msg.mentionAll)) { meta.mentions = msg.mentions || []; meta.all = !!msg.mentionAll; }
      if (msg.sticker && !secretEnc) meta.sticker = msg.sticker;
      return Object.keys(meta).length ? { meta } : {};
    })(),
    ...(msg.ttl ? { ttl_seconds: msg.ttl } : {})
  }).select().single();

  if (error) {
    msg.status = 'failed';
    toast('ส่งข้อความไม่สำเร็จ: ' + thaiError(error), 'error');
  } else {
    // แทนข้อความชั่วคราวด้วยข้อความจริง (ถ้า Realtime ส่งมาก่อนแล้ว จะไม่ซ้ำ)
    state.messages[chat.id] = (state.messages[chat.id] || []).filter(m => m.id !== msg.id);
    const local = toLocal(data);
    if (secretEnc) { local.text = msg.text; local.sticker = msg.sticker || null; local.dec = true; }   // ข้อความของเราเอง: เก็บเนื้อหาจริงไว้แสดงได้ทันที
    addLocal(chat.id, local);
  }
  if (activeChat && activeChat.id === chat.id) loadMessages(true);
  loadChatList();
}

async function deleteMessage(msgId) {
  if (!activeChat) return;
  if (String(msgId).startsWith('tmp_')) {
    state.messages[activeChat.id] = (state.messages[activeChat.id] || []).filter(m => m.id !== msgId);
    loadMessages(true);
    loadChatList();
    return;
  }
  const target = (state.messages[activeChat.id] || []).find(m => m.id === msgId);
  const { error } = await sb.from('messages').delete().eq('id', msgId);
  if (error) return handleDbError(error);
  if (target && target.media) removeMediaFiles(target.media);
  state.messages[activeChat.id] = (state.messages[activeChat.id] || []).filter(m => m.id !== msgId);
  playSound('delete');
  loadMessages(true);
  loadChatList();
}

// ---------- สถานะอ่านแล้ว ----------
// ---------- โหลดประวัติย้อนหลังเป็นหน้าๆ ----------
function isHistoryDone(id) {
  return !!(state.historyAll || (state.history && state.history[id] && state.history[id].done));
}

async function loadOlder(chat, manual) {
  if (!chat || isHistoryDone(chat.id)) return;
  state.history = state.history || {};
  const h = state.history[chat.id] || (state.history[chat.id] = { loading: false, done: false });
  if (h.loading) return;
  h.loading = true;
  try {
    const me = currentUser.id;
    const list = state.messages[chat.id] || [];
    const oldest = list.find(m => !String(m.id).startsWith('tmp_'));
    const before = new Date((oldest ? oldest.ts : Date.now()) + 1).toISOString();

    let q = sb.from('messages').select('*').lt('created_at', before)
      .order('created_at', { ascending: false }).limit(50);
    q = chat.isGroup
      ? q.eq('group_id', chat.id)
      : q.or(`and(sender_id.eq.${me},receiver_id.eq.${chat.id}),and(sender_id.eq.${chat.id},receiver_id.eq.${me})`);
    const { data, error } = await q;
    if (error) return handleDbError(error);

    const rows = data || [];
    if (chat.isGroup && !chat.anonymous) {
      const senders = [...new Set(rows.map(r => r.sender_id).filter(id => id !== me))];
      if (senders.length) await ensureProfiles(senders);
    }

    const now = Date.now();
    let added = 0;
    rows.forEach(row => {
      const msg = toLocal(row);
      if (msg.expiresAt && msg.expiresAt <= now) return;
      if (social.cleared[chat.id] && msg.ts <= social.cleared[chat.id]) return;
      if (addLocal(chat.id, msg)) added++;
    });
    if (rows.length < 50) h.done = true;
    if (manual && !added && h.done) toast('ไม่มีข้อความเก่ากว่านี้แล้ว', 'info');

    if (activeChat && activeChat.id === chat.id) {
      const c = $('messages-container');
      const prevH = c.scrollHeight, prevTop = c.scrollTop;
      loadMessages();
      c.scrollTop = c.scrollHeight - prevH + prevTop; // คงตำแหน่งที่กำลังอ่านอยู่
    }
  } finally {
    h.loading = false;
  }
}

function onMessagesScroll() {
  const c = $('messages-container');
  const far = c.scrollHeight - c.scrollTop - c.clientHeight > 320;
  $('scroll-down-btn').classList.toggle('hidden-element', !far);
  if (c.scrollTop < 80 && activeChat) loadOlder(activeChat, false);
}

function scrollToLatest() {
  const c = $('messages-container');
  c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
}

function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'วันนี้';
  if (d.toDateString() === new Date(now - 86400000).toDateString()) return 'เมื่อวาน';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------- ชวนเพื่อนเข้ากลุ่ม: กลุ่มสาธารณะเข้าได้เลย / กลุ่มส่วนตัวรอผู้ดูแลอนุมัติ ----------
async function renderGroupInvites(g, isAdmin) {
  const wrap = $('gi-invites-wrap');
  if (!isAdmin) { wrap.classList.add('hidden-element'); return; }
  const gid = g.id;
  const { data, error } = await sb.rpc('list_group_invites', { p_group: gid });
  if (error || groupTargetId !== gid) return;
  if (!data || !data.length) { wrap.classList.add('hidden-element'); return; }

  $('gi-invites-count').textContent = `(${data.length})`;
  const box = $('gi-invites');
  box.innerHTML = '';
  data.forEach(inv => {
    const card = document.createElement('div');
    card.className = 'req-card';
    card.appendChild(personRow({ id: inv.user_id, nickname: inv.name, avatar: inv.avatar }, `ชวนโดย ${inv.by_name}`));
    const acts = document.createElement('div');
    acts.className = 'req-actions';
    acts.append(
      chip('อนุมัติ', () => respondGroupInvite(inv.id, true), 'primary'),
      chip('ปฏิเสธ', () => respondGroupInvite(inv.id, false))
    );
    card.appendChild(acts);
    box.appendChild(card);
  });
  wrap.classList.remove('hidden-element');
}

async function respondGroupInvite(id, approve) {
  const { error } = await sb.rpc('respond_group_invite', { p_invite: id, p_approve: approve });
  if (error) return handleDbError(error);
  toast(approve ? 'อนุมัติแล้ว สมาชิกใหม่เข้ากลุ่มแล้ว' : 'ปฏิเสธคำขอแล้ว', approve ? 'success' : 'info');
  try { await loadGroups(); } catch (e) { /* ไม่เป็นไร */ }
  renderGroupInfo();
  loadChatList();
}

async function onGroupInvite(payload) {
  if (!currentUser) return;
  const row = payload.new || {};
  const g = state.groups[row.group_id];
  if (payload.eventType === 'INSERT' && g && (g.role === 'owner' || g.role === 'admin') && row.invited_by !== currentUser.id) {
    toast(`มีคำขอเพิ่มสมาชิกรอการอนุมัติในกลุ่ม ${g.name}`, 'alert');
    playSound('receive');
  }
  if (!$('ginfo-modal').classList.contains('hidden-element') && groupTargetId) renderGroupInfo();
}

// ---------- ลืมรหัสผ่านทางอีเมล ----------
function cleanAppUrl() {
  return location.href.split('#')[0].split('?')[0].replace(/index\.html$/, '');
}

async function forgotPassword() {
  if (!sb) return;
  const email = $('login-email').value.trim();
  if (!email) return toast('กรอกอีเมลในช่องอีเมลก่อน แล้วกด "ลืมรหัสผ่าน?" อีกครั้ง', 'error');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: cleanAppUrl() });
  if (error) return toast(thaiError(error), 'error');
  toast('ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว (ตรวจกล่องสแปมด้วย)', 'success');
}

function openRecovery() {
  ['rc-new', 'rc-confirm'].forEach(id => { $(id).value = ''; });
  openModal('recovery-modal');
}

async function cancelRecovery() {
  closeModal('recovery-modal');
  history.replaceState(null, '', cleanAppUrl());
  try { await sb.auth.signOut(); } catch (e) { /* ไม่เป็นไร */ }
}

async function finishRecovery() {
  const pw = $('rc-new').value, again = $('rc-confirm').value;
  if (pw.length < 6) return toast('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร', 'error');
  if (pw !== again) return toast('รหัสผ่านทั้งสองช่องไม่ตรงกัน', 'error');

  const btn = $('rc-submit-btn');
  setBusy(btn, true, 'กำลังบันทึก...');
  const { error } = await sb.auth.updateUser({ password: pw });
  setBusy(btn, false);
  if (error) return toast('ตั้งรหัสผ่านไม่สำเร็จ: ' + thaiError(error), 'error');

  closeModal('recovery-modal');
  history.replaceState(null, '', cleanAppUrl());
  toast('ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว', 'success');
  const { data: { session } } = await sb.auth.getSession();
  if (session) startSession(session.user, true);
}

// ==================== กำลังพิมพ์ ====================
function handleTyping() {
  if (!activeChat || activeChat.isSaved || !presenceChannel || !currentUser) return;
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
function openModal(id) {
  const modal = $(id);
  const a = document.activeElement;
  // ถ้าหน้าต่างนี้ไม่มีช่องพิมพ์ ให้เก็บแป้นพิมพ์ก่อน จะได้ไม่ดันหน้าจอขึ้น
  if (a && a.matches && a.matches('textarea, input') && !modal.querySelector('input, textarea')) a.blur();
  modal.classList.remove('hidden-element');
}
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
  localStorage.setItem('darkchat_mode_v2', mode);
  document.querySelectorAll('.mode-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = mode === 'glass' ? glassColors()[1] : (getComputedStyle(document.body).getPropertyValue('--bg-main').trim() || '#08080d');
}

// ---------- สีพื้นหลังธีมกระจก (เลือกเองได้ 3 สี) ----------
const GLASS_DEFAULT = ['#38bdf8', '#6366f1', '#d946ef'];
const GLASS_PRESETS = [
  { name: 'ฟ้า น้ำเงิน ชมพู', c: ['#38bdf8', '#6366f1', '#d946ef'] },
  { name: 'พระอาทิตย์ตก', c: ['#fb923c', '#ec4899', '#7c3aed'] },
  { name: 'มหาสมุทร', c: ['#22d3ee', '#3b82f6', '#1e3a8a'] },
  { name: 'ออโรรา', c: ['#34d399', '#06b6d4', '#8b5cf6'] },
  { name: 'ลาเวนเดอร์', c: ['#c4b5fd', '#a78bfa', '#f0abfc'] }
];

function glassColors() {
  try {
    const c = JSON.parse(localStorage.getItem('darkchat_glass') || 'null');
    if (Array.isArray(c) && c.length === 3 && c.every(x => /^#[0-9a-f]{6}$/i.test(x))) return c;
  } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  return GLASS_DEFAULT.slice();
}

function applyGlassColors() {
  const c = glassColors();
  ['--g1', '--g2', '--g3'].forEach((k, i) => document.body.style.setProperty(k, c[i]));
  ['glass-c1', 'glass-c2', 'glass-c3'].forEach((id, i) => { const el = $(id); if (el) el.value = c[i]; });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && document.body.getAttribute('data-mode') === 'glass') meta.content = c[1];
}

function setGlassColors() {
  const c = ['glass-c1', 'glass-c2', 'glass-c3'].map(id => $(id).value);
  try { localStorage.setItem('darkchat_glass', JSON.stringify(c)); } catch (e) { /* ไม่เป็นไร */ }
  applyGlassColors();
}

function setGlassPreset(i) {
  try { localStorage.setItem('darkchat_glass', JSON.stringify(GLASS_PRESETS[i].c)); } catch (e) { /* ไม่เป็นไร */ }
  applyGlassColors();
}

function renderGlassPresets() {
  const box = $('glass-presets');
  if (!box) return;
  box.innerHTML = '';
  GLASS_PRESETS.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-chip';
    const sw = document.createElement('span');
    sw.className = 'glass-swatch';
    sw.style.background = `linear-gradient(90deg, ${p.c.join(', ')})`;
    b.append(sw, document.createTextNode(p.name));
    b.onclick = () => setGlassPreset(i);
    box.appendChild(b);
  });
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
let pin = { mode: null, buffer: '', first: '', user: null, onDone: null, onCancel: null, tries: 0, kind: 'app', key: '', who: null, chatId: null };
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

function showPin(mode, user, onDone, onCancel = null, opts = {}) {
  pin = {
    mode, buffer: '', first: '', user, onDone, onCancel, tries: 0,
    kind: opts.kind || 'app', key: opts.key || pinKey(user.id), who: opts.who || pinWho(user), chatId: opts.chatId || null
  };
  $('pin-error').textContent = '';
  renderPin();
  $('pin-screen').classList.remove('hidden-element');
}

function hidePin() { $('pin-screen').classList.add('hidden-element'); }

function renderPin() {
  const creating = pin.mode === 'create';
  const room = pin.kind === 'room';
  renderAvatar($('pin-avatar'), pin.who && pin.who.avatar, pin.who && pin.who.name);
  $('pin-avatar').classList.toggle('group-av', room && !!(pin.chatId && state.groups[pin.chatId]));
  $('pin-name').textContent = (pin.who && pin.who.name) || '';
  $('pin-title').textContent = creating
    ? (pin.first ? (room ? 'ยืนยันรหัสอีกครั้ง' : 'ยืนยัน PIN อีกครั้ง') : (room ? 'ตั้งรหัสห้อง 6 หลัก' : 'ตั้ง PIN 6 หลัก'))
    : (room ? 'ใส่รหัสห้อง' : 'ใส่ PIN เพื่อเข้าใช้งาน');
  $('pin-sub').textContent = creating
    ? (pin.first ? 'ใส่ซ้ำเพื่อยืนยัน' : (room ? 'ใช้เปิดห้องนี้' : 'ใช้ปลดล็อกแอปทุกครั้งที่เปิดใช้งาน'))
    : (room ? '' : 'ยินดีต้อนรับกลับ');
  $('pin-dots').querySelectorAll('i').forEach((dot, i) => dot.classList.toggle('on', i < pin.buffer.length));

  const sec = $('pin-secondary');
  if (pin.onCancel) { sec.textContent = 'ยกเลิก'; sec.classList.remove('hidden-element'); }
  else if (!creating) { sec.textContent = 'ลืม PIN?'; sec.classList.remove('hidden-element'); }
  else sec.classList.add('hidden-element');
  $('pin-logout').classList.toggle('hidden-element', !!pin.onCancel);
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
    await savePinKey(pin.key, code);
    const done = pin.onDone;
    hidePin();
    if (pin.kind !== 'room') toast('ตั้ง PIN เรียบร้อย', 'success');
    if (done) done();
    return;
  }

  // โหมดปลดล็อก
  if (await checkPinKey(pin.key, code)) {
    const done = pin.onDone;
    hidePin();
    if (done) done();
    return;
  }
  if (pin.kind === 'room') return roomCodeWrong();
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
// iOS: เมื่อแป้นพิมพ์เปิด ให้ความสูงของแอปเท่ากับพื้นที่ที่มองเห็นจริง หัวห้องจะอยู่ข้างบน ช่องพิมพ์อยู่เหนือแป้นพิมพ์
function setupViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    root.style.setProperty('--vvh', vv.height + 'px');
    root.style.setProperty('--vvt', vv.offsetTop + 'px');
    const kb = window.innerHeight - vv.height > 120;
    document.body.classList.toggle('kb-open', kb);
    if (kb) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

function setupGlobalListeners() {
  setupViewport();
  startIdleWatcher();
  startRealtimeWatchdog();
  $('call-overlay').addEventListener('click', resumeCallPlayback);
  $('call-overlay').addEventListener('click', onImmersiveTap);
  $('call-overlay').addEventListener('click', () => $('q-menu').classList.add('hidden-element'));
  // ผู้ใช้กด Esc / ออกจากเต็มจอด้วยวิธีของเบราว์เซอร์: ให้โหมดซ่อนปุ่มออกตามไปด้วย
  const syncFull = () => { if (CALL.immersive && !(document.fullscreenElement || document.webkitFullscreenElement) && immFullRequested()) setImmersive(false); };
  document.addEventListener('fullscreenchange', syncFull);
  document.addEventListener('webkitfullscreenchange', syncFull);
  if (!canShareScreen()) $('stream-btn').classList.add('hidden-element');   // มือถือแชร์หน้าจอไม่ได้ (เข้ามาดูได้)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkRingingCalls(); if (CALL.session) acquireWake(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && currentUser && Date.now() - lastDeviceCheck > 5 * 60 * 1000) registerThisDevice(); });
  setInterval(() => { if (activeChat && !document.hidden && document.querySelector('.card-live')) loadMessages(true); }, 30000); // รีเฟรชเวลาที่เหลือของตำแหน่งสด
  document.addEventListener('click', e => { if (!e.target.closest('#sticker-panel, #sticker-btn')) closeStickerPanel(); });
  $('sticker-panel').addEventListener('click', e => e.stopPropagation()); // กดอะไรในแผงสติ๊กเกอร์ต้องไม่ปิดแผง
  window.addEventListener('pagehide', saveDraftNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveDraftNow(); });
  const mic = $('mic-btn');
  mic.addEventListener('pointerdown', micDown);
  mic.addEventListener('pointermove', micMove);
  mic.addEventListener('pointerup', micUp);
  mic.addEventListener('pointercancel', micUp);
  mic.addEventListener('contextmenu', e => e.preventDefault());
  // กันบั๊กค้าง: ถ้านิ้วปล่อยแล้วแต่ปุ่มไม่ได้รับเหตุการณ์ ให้จับที่ระดับหน้าเว็บ
  ['pointerup', 'pointercancel', 'touchend', 'touchcancel'].forEach(t => document.addEventListener(t, () => { if (hold.down) micUp(); }, true));
  window.addEventListener('blur', () => { if (hold.down || hold.mr) hardResetHold(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && (hold.down || hold.mr)) hardResetHold(); });
  $('message-input').addEventListener('focus', () => {
    setTimeout(() => {
      window.scrollTo(0, 0);
      const c = $('messages-container');
      c.scrollTop = c.scrollHeight;
    }, 320);
  });
  $('messages-container').addEventListener('scroll', onMessagesScroll, { passive: true });
  // ปิดการซูมด้วยการบีบนิ้วบน iOS (การแตะสองครั้งปิดด้วย CSS touch-action)
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault()));

  // คอมพิวเตอร์: Enter = ส่ง, Shift+Enter = ขึ้นบรรทัดใหม่ / มือถือ: Enter = ขึ้นบรรทัดใหม่ ส่งด้วยปุ่มลูกศร
  $('message-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      $('send-btn').click();
    }
  });

  // ออกจากห้องแชทแบบง่าย: ปัดขวาที่หัวห้อง หรือปัดจากขอบซ้ายของจอ
  const area = $('chat-area');
  let backSwipe = null;
  area.addEventListener('pointerdown', e => {
    const r = area.getBoundingClientRect();
    backSwipe = (e.clientX - r.left < 26 || e.target.closest('.chat-header')) ? { x: e.clientX, y: e.clientY } : null;
  });
  area.addEventListener('pointerup', e => {
    if (!backSwipe) return;
    const dx = e.clientX - backSwipe.x, dy = Math.abs(e.clientY - backSwipe.y);
    backSwipe = null;
    if (dx > 80 && dy < 50 && activeChat) backToList();
  });
  area.addEventListener('pointercancel', () => { backSwipe = null; });
  document.addEventListener('keydown', e => {
    if (e.altKey && String(e.key).toLowerCase() === 'l' && !pinIsOpen()) { e.preventDefault(); return lockNow(); }
    if (pinIsOpen()) {
      if (/^\d$/.test(e.key)) pinPress(e.key);
      else if (e.key === 'Backspace') pinDelete();
      return;
    }
    if (!$('media-viewer').classList.contains('hidden-element')) {
      if (e.key === 'ArrowLeft') return galleryStep(-1);
      if (e.key === 'ArrowRight') return galleryStep(1);
    }
    if (e.key === 'Escape') {
      if (CALL.immersive) return setImmersive(false);
      if (!$('media-viewer').classList.contains('hidden-element')) return closeMediaViewer();
      if (sel.on) return exitSelectMode();
      if (!$('attach-menu').classList.contains('hidden-element')) return closeAttachMenu();
      if (!$('confirm-modal').classList.contains('hidden-element')) return answerConfirm(false);
      const openModals = document.querySelectorAll('.modal:not(.hidden-element):not(#recovery-modal)');
      if (openModals.length) { openModals.forEach(m => m.classList.add('hidden-element')); return; }
      if (composer.type) return clearComposerMode();
      if (activeChat) backToList();
    }
  });

  // คลิกที่อื่น = ปิดเมนูฟันเฟือง
  document.addEventListener('click', e => {
    if (!e.target.closest('#gear-wrap')) toggleGearMenu(false);
    if (!e.target.closest('#attach-menu, #plus-btn')) closeAttachMenu();
  });

  // กลับมาเปิดแอปหลังซ่อนนานเกินกำหนด ต้องใส่ PIN อีกครั้ง
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    touchLastSeen();
    if (currentUser && hiddenAt && Date.now() - hiddenAt > PIN_LOCK_AFTER_MS &&
        pinEnabled(currentUser.id) && hasPin(currentUser.id) && !pinIsOpen()) {
      lockNow(true);
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
  return { friendships: [], blocked: new Set(), muted: new Set(), hidden: new Set(), pinnedChats: new Map(), cleared: {}, profiles: {} };
}

const FRIEND_COLS = 'id, requester_id, addressee_id, status, created_at';
const PROFILE_COLS = 'id, nickname, username, avatar, email, search_id, last_seen_at';

async function loadSocial() {
  const [fr, bl, mu, cl, hd, cp] = await Promise.all([
    sb.from('friendships').select(FRIEND_COLS),
    sb.from('blocks').select('blocked_id'),
    sb.from('chat_mutes').select('partner_id'),
    sb.from('chat_clears').select('partner_id, cleared_at'),
    sb.from('hidden_messages').select('message_id').limit(5000),
    sb.from('chat_pins').select('chat_id, pinned_at')
  ]);
  const err = fr.error || bl.error || mu.error || cl.error || hd.error || cp.error;
  if (err) throw err;
  social.friendships = fr.data || [];
  social.blocked = new Set((bl.data || []).map(r => r.blocked_id));
  social.muted = new Set((mu.data || []).map(r => r.partner_id));
  social.hidden = new Set((hd.data || []).map(r => r.message_id));
  social.pinnedChats = new Map((cp.data || []).map(r => [r.chat_id, new Date(r.pinned_at).getTime()]));
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
  const blocked = !activeChat.isGroup && social.blocked.has(activeChat.id);
  $('message-input').disabled = blocked;
  $('send-btn').disabled = blocked;
  $('mic-btn').disabled = blocked;
  $('message-input').placeholder = blocked
    ? 'คุณบล็อกผู้ใช้นี้ไว้ ปลดบล็อกเพื่อส่งข้อความ'
    : (activeChat.isSaved ? 'จดข้อความไว้ที่นี่' : composerPlaceholder());
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
  if (!activeChat || activeChat.isGroup || activeChat.isSaved || !currentUser || bannerDismissed(activeChat.id)) { el.classList.add('hidden-element'); return; }
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
  const { data: fetched } = await sb.from('public_profiles').select(PROFILE_COLS).eq('id', id).maybeSingle();
  const data = fetched || profileOf(id);
  if (!data) return toast('ไม่พบข้อมูลผู้ใช้', 'error');
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
    if (label === 'ID' && value) {
      const cp = chip('คัดลอก', () => copyText(data.search_id));
      cp.style.marginLeft = '8px';
      row.appendChild(cp);
    }
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
function openPersonSheet(id, context, extra) {
  const info = friendInfo(id);
  const p = profileOf(id);
  const grp = context === 'group' && extra ? state.groups[extra] : null;
  const anon = !!(grp && grp.anonymous);
  $('person-title').textContent = anon ? groupSenderName(grp, id) : nameOf(p);
  const box = $('person-actions');
  box.innerHTML = '';
  const add = (label, fn, cls) => box.appendChild(actionBtn(label, () => { closeModal('person-sheet'); fn(); }, cls || 'secondary-btn'));

  if (!anon) add('ส่งข้อความ', () => openChatWith(id), 'primary-btn');
  if (!anon) add('ดูโปรไฟล์', () => openUserProfile(id));
  if (!anon && info.state === 'none') add('เพิ่มเป็นเพื่อน', () => sendFriendRequest(id));
  if (!anon && info.state === 'sent') add('ยกเลิกคำขอเป็นเพื่อน', () => cancelRequest(id));
  if (!anon && info.state === 'received') {
    add('ยอมรับคำขอเป็นเพื่อน', () => respondRequest(id, true));
    add('ปฏิเสธคำขอ', () => respondRequest(id, false));
  }
  if (!anon) add(social.muted.has(id) ? 'เปิดเสียงแจ้งเตือน' : 'ปิดเสียงแจ้งเตือน', () => toggleMute(id));
  add(social.blocked.has(id) ? 'ปลดบล็อก' : 'บล็อก', () => toggleBlock(id), 'secondary-btn danger');
  add('รายงาน', () => openReport(id), 'secondary-btn danger');
  // ลบเพื่อนได้เฉพาะจากหน้า "เพื่อนทั้งหมด"
  if (info.state === 'friends' && context === 'friends') add('ลบเพื่อน', () => removeFriendConfirm(id), 'secondary-btn danger');
  if (context === 'group' && extra && state.groups[extra] && id !== currentUser.id) {
    const g = state.groups[extra];
    const target = g.members.find(m => m.user_id === id);
    if (target) {
      if (g.role === 'owner') {
        add(target.role === 'admin' ? 'ยกเลิกสิทธิ์ผู้ดูแล' : 'ตั้งเป็นผู้ดูแลกลุ่ม',
            () => setGroupAdmin(extra, id, target.role !== 'admin'));
      }
      if (g.role === 'owner' || (g.role === 'admin' && target.role === 'member')) {
        add('นำออกจากกลุ่ม', () => removeGroupMember(extra, id), 'secondary-btn danger');
      }
    }
  }
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
  if (state.groups[id]) return clearGroupChat(id);
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
  if (!p || !p.isSaved) delete state.contacts[id]; // แชท "ข้อความที่บันทึกไว้" ไม่หายจากรายการ
  saveContacts();
  delete lastRead[id];
  saveLastRead();
  if (activeChat && activeChat.id === id) { activeChat = null; resetChatView(); backToList(); }
  loadChatList();
  toast('ลบข้อความเรียบร้อย', 'success');
}

function closeSwipe() {
  if (openSwipe) { openSwipe.style.transform = ''; openSwipe.classList.remove('swiped', 'right'); openSwipe = null; }
}

// ปัดรายการแชทไปทางซ้ายเพื่อเผยปุ่ม "ลบ" (รองรับทั้งนิ้วและเมาส์)
function attachSwipe(item, delBtn, profBtn, onTap, onDelete, onProfile, onPeek) {
  let startX = 0, startY = 0, dx = 0, dragging = false, moved = false, peeked = false, peekTimer = null;
  const offset = () => (item === openSwipe ? (item.classList.contains('right') ? 88 : -88) : 0);

  item.addEventListener('contextmenu', e => e.preventDefault());
  item.addEventListener('pointerdown', e => {
    if (e.button) return;
    startX = e.clientX; startY = e.clientY; dx = 0; dragging = true; moved = false; peeked = false;
    if (openSwipe && openSwipe !== item) closeSwipe();
    // ฟังก์ชันลับ: กดค้าง 6 วินาทีเพื่อแอบดูข้อความโดยไม่ขึ้นว่าอ่านแล้ว (ไม่มีสัญลักษณ์บอก)
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
      if (dragging && !moved) { peeked = true; dragging = false; onPeek(); }
    }, 6000);
  });
  item.addEventListener('pointermove', e => {
    if (!dragging) return;
    const x = e.clientX - startX, y = e.clientY - startY;
    if (!moved && Math.abs(x) > 8 && Math.abs(x) > Math.abs(y)) {
      moved = true;
      clearTimeout(peekTimer);
      item.setPointerCapture(e.pointerId);
      item.style.transition = 'none';
    } else if (!moved && Math.abs(y) > 10) {
      clearTimeout(peekTimer);
    }
    if (moved) {
      dx = Math.max(-110, Math.min(110, offset() + x));
      item.style.transform = `translateX(${dx}px)`;
    }
  });
  const end = () => {
    clearTimeout(peekTimer);
    if (!dragging) return;
    dragging = false;
    item.style.transition = '';
    if (!moved) return;
    item.classList.remove('right', 'swiped');
    if (dx < -44) { item.style.transform = 'translateX(-88px)'; item.classList.add('swiped'); openSwipe = item; }
    else if (dx > 44) { item.style.transform = 'translateX(88px)'; item.classList.add('swiped', 'right'); openSwipe = item; }
    else { item.style.transform = ''; if (openSwipe === item) openSwipe = null; }
  };
  item.addEventListener('pointerup', end);
  item.addEventListener('pointercancel', end);
  item.addEventListener('click', e => {
    if (peeked) { peeked = false; e.preventDefault(); return; }
    if (moved) { moved = false; e.preventDefault(); return; }
    if (openSwipe === item) { closeSwipe(); return; }
    onTap();
  });
  delBtn.onclick = () => { closeSwipe(); onDelete(); };
  profBtn.onclick = () => { closeSwipe(); onProfile(); };
}

// ==================== แชทกลุ่ม (เฟส B2) ====================
let groupModalMode = 'create';   // 'create' = สร้างกลุ่มใหม่, 'add' = เพิ่มสมาชิกเข้ากลุ่มเดิม
let groupTargetId = null;
let groupAvatarData = '';
const picker = { selected: new Set(), exclude: new Set(), token: 0, timer: null };

function isMuted(id) {
  return social.muted.has(id) || !!(state.groups[id] && state.groups[id].muted);
}

function allChats() {
  return [...Object.values(state.contacts), ...Object.values(state.groups || {})];
}

function hueOf(id) {
  let h = 0;
  for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

async function loadGroups() {
  const [g, m, a] = await Promise.all([
    sb.from('groups').select('id, name, avatar, created_by, kind, anonymous'),
    sb.from('group_members').select('group_id, user_id, role, muted, cleared_at, last_read_at'),
    sb.rpc('my_anon_members')
  ]);
  if (g.error) throw g.error;
  if (m.error) throw m.error;
  if (a.error) throw a.error;

  const me = currentUser.id;
  const next = {};
  (g.data || []).forEach(r => {
    next[r.id] = { id: r.id, isGroup: true, name: r.name, avatar: r.avatar || '👥', kind: r.kind, anonymous: !!r.anonymous, aliases: {}, role: 'member', muted: false, members: [] };
  });
  (m.data || []).forEach(r => {
    const x = next[r.group_id];
    if (!x) return;
    x.members.push({ user_id: r.user_id, role: r.role, readAt: r.last_read_at ? new Date(r.last_read_at).getTime() : null });
    if (r.user_id === me) {
      x.role = r.role;
      x.muted = r.muted;
      if (r.cleared_at) social.cleared[r.group_id] = new Date(r.cleared_at).getTime();
    }
  });
  (a.data || []).forEach(r => { if (next[r.group_id]) next[r.group_id].aliases[r.user_id] = r.nickname; });
  state.groups = next;
  if (activeChat && activeChat.isGroup) activeChat = next[activeChat.id] || null;
}

// ---------- ตัวเลือกสมาชิก (ใช้ทั้งตอนสร้างกลุ่มและเพิ่มสมาชิก) ----------
function openCreateGroup() {
  groupModalMode = 'create';
  groupTargetId = null;
  groupAvatarData = '';
  picker.selected = new Set();
  picker.exclude = new Set();
  $('gm-title').textContent = 'สร้างกลุ่มใหม่';
  $('gm-submit').textContent = 'สร้างกลุ่ม';
  $('gm-head').classList.remove('hidden-element');
  $('gm-name').value = '';
  $('gm-search').value = '';
  $('gm-anon').checked = false;
  $('gm-options').classList.remove('hidden-element');
  setGroupKind('private');
  onAnonToggle();
  renderAvatar($('gm-avatar'), '👥', 'ก');
  openModal('group-modal');
  renderPicker();
}

function openAddMembers() {
  const g = state.groups[groupTargetId];
  if (!g) return;
  groupModalMode = 'add';
  picker.selected = new Set();
  picker.exclude = new Set(g.members.map(m => m.user_id));
  $('gm-title').textContent = 'เพิ่มสมาชิก';
  $('gm-submit').textContent = 'เพิ่มสมาชิก';
  $('gm-head').classList.add('hidden-element');
  $('gm-options').classList.add('hidden-element');
  $('gm-search').value = '';
  openModal('group-modal');
  renderPicker();
}

function pickGroupAvatarFile() { document.getElementById('gm-file').click(); }

async function pickGroupAvatar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    groupAvatarData = await uploadAvatarImage(file, 256, 'g');
    renderAvatar($('gm-avatar'), groupAvatarData, 'ก');
  } catch (err) { toast(thaiError(err), 'error'); }
  input.value = '';
}

function pickerSearch() {
  clearTimeout(picker.timer);
  picker.timer = setTimeout(renderPicker, 300);
}

function updatePickerCount() {
  const n = picker.selected.size;
  $('gm-count').textContent = n ? `(เลือกแล้ว ${n} คน)` : '';
}

function pickerRow(p) {
  const row = personRow(p, p.search_id ? '@' + p.search_id : '');
  row.classList.add('tap');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'pick';
  box.checked = picker.selected.has(p.id);
  const toggle = () => {
    if (picker.selected.has(p.id)) picker.selected.delete(p.id); else picker.selected.add(p.id);
    box.checked = picker.selected.has(p.id);
    updatePickerCount();
  };
  box.onclick = e => { e.stopPropagation(); toggle(); };
  row.onclick = toggle;
  row.appendChild(box);
  return row;
}

async function renderPicker() {
  const token = ++picker.token;
  const box = $('gm-list');
  const q = $('gm-search').value.trim().replace(/[%_\\,()]/g, '');
  const ql = q.toLowerCase();
  const fIds = friendIds();

  const friends = (await ensureProfiles(fIds)).filter(p =>
    !picker.exclude.has(p.id) &&
    (!ql || nameOf(p).toLowerCase().includes(ql) || (p.search_id || '').toLowerCase().includes(ql)));

  let others = [];
  if (q.length >= 2) {
    const { data } = await sb.rpc('search_profiles', { q });
    others = (data || []).filter(p => !picker.exclude.has(p.id) && !fIds.includes(p.id));
    others.forEach(p => { if (!social.profiles[p.id]) social.profiles[p.id] = p; });
  }
  if (token !== picker.token) return;

  box.innerHTML = '';
  const section = (title, list) => {
    if (!list.length) return;
    const t = document.createElement('div');
    t.className = 'list-title';
    t.textContent = title;
    box.appendChild(t);
    list.forEach(p => box.appendChild(pickerRow(p)));
  };
  section('เพื่อน', friends);
  section('ผู้ใช้อื่น (ไม่ได้เป็นเพื่อนกัน)', others);
  if (!friends.length && !others.length) {
    box.appendChild(hintNode(q.length >= 2 ? 'ไม่พบรายชื่อ' : 'พิมพ์ชื่อหรือ ID เพื่อค้นหาผู้ใช้อื่น'));
  }
  updatePickerCount();
}

async function submitGroupModal() {
  const members = [...picker.selected];
  const btn = $('gm-submit');

  if (groupModalMode === 'create') {
    const name = $('gm-name').value.trim();
    if (!name) return toast('กรุณาตั้งชื่อกลุ่ม', 'error');
    setBusy(btn, true, 'กำลังสร้าง...');
    const { data, error } = await sb.rpc('create_group', {
      p_name: name, p_avatar: groupAvatarData, p_members: members,
      p_kind: groupKind, p_anonymous: $('gm-anon').checked
    });
    setBusy(btn, false);
    if (error) return handleDbError(error);
    try { await loadGroups(); } catch (e) { return handleDbError(e); }
    closeModal('group-modal');
    if (state.groups[data]) selectChat(state.groups[data]);
    loadChatList();
    toast('สร้างกลุ่มเรียบร้อย', 'success');
  } else {
    if (!members.length) return toast('เลือกสมาชิกที่จะเพิ่มก่อน', 'error');
    setBusy(btn, true, 'กำลังเพิ่ม...');
    const { data, error } = await sb.rpc('invite_to_group', { p_group: groupTargetId, p_users: members });
    setBusy(btn, false);
    if (error) return handleDbError(error);
    try { await loadGroups(); } catch (e) { return handleDbError(e); }
    closeModal('group-modal');
    renderGroupInfo();
    loadChatList();
    const added = (data && data.added) || 0, pending = (data && data.pending) || 0;
    if (added) toast(`เพิ่มสมาชิก ${added} คนแล้ว`, 'success');
    if (pending) toast(`ส่งคำขอให้ผู้ดูแลอนุมัติแล้ว ${pending} คน`, 'info');
    if (!added && !pending) toast('ไม่สามารถเพิ่มสมาชิกที่เลือกได้', 'error');
  }
}

// ---------- ข้อมูลกลุ่ม ----------
function openChatInfo() {
  if (!activeChat || activeChat.isSaved) return;
  if (activeChat.isGroup) openGroupInfo(activeChat.id);
  else openUserProfile(activeChat.id);
}

async function openGroupInfo(gid) {
  groupTargetId = gid;
  await renderGroupInfo();
  openModal('ginfo-modal');
}

async function renderGroupInfo() {
  const g = state.groups[groupTargetId];
  if (!g) return;
  const me = currentUser.id;
  const isAdmin = g.role === 'owner' || g.role === 'admin';

  // ข้อมูลของตัวเองแบบเต็ม (ไม่ผ่านการซ่อนตามสวิตช์)
  social.profiles[me] = { id: me, username: currentUser.username, nickname: currentUser.nickname, avatar: currentUser.avatar, search_id: currentUser.searchId };

  renderAvatar($('gi-avatar'), g.avatar, g.name);
  $('gi-name').textContent = g.name;
  $('gi-count').textContent = `สมาชิก ${g.members.length} คน`;
  fillGroupTags($('gi-tags'), g);
  renderAliasRow(g);
  $('gi-edit').classList.toggle('hidden-element', !isAdmin);
  $('gi-name-input').value = g.name;
  $('gi-add').classList.remove('hidden-element');
  $('gi-add').textContent = (g.kind === 'private' && !isAdmin) ? '+ ชวนเพื่อนเข้ากลุ่ม (รอผู้ดูแลอนุมัติ)' : '+ เพิ่มสมาชิก';
  renderGroupInvites(g, isAdmin);
  $('gi-muted').checked = !!g.muted;

  let byId;
  if (g.anonymous) {
    // กลุ่มไม่แสดงตัวตน: ใช้ชื่อเล่นอย่างเดียว ไม่ดึงโปรไฟล์จริงของใคร
    byId = Object.fromEntries(g.members.map(m => [m.user_id,
      { id: m.user_id, nickname: g.aliases[m.user_id] || (m.user_id === me ? (currentUser.nickname || 'ผู้ใช้') : 'ผู้ใช้') }]));
  } else {
    const profs = await ensureProfiles(g.members.map(m => m.user_id));
    byId = Object.fromEntries(profs.map(p => [p.id, p]));
  }
  const order = { owner: 0, admin: 1, member: 2 };
  const members = g.members.slice().sort((a, b) =>
    (order[a.role] - order[b.role]) || nameOf(byId[a.user_id]).localeCompare(nameOf(byId[b.user_id])));

  const box = $('gi-members');
  box.innerHTML = '';
  members.forEach(m => {
    const p = byId[m.user_id] || { id: m.user_id };
    const roleText = m.role === 'owner' ? 'เจ้าของกลุ่ม' : m.role === 'admin' ? 'ผู้ดูแล' : '';
    const row = personRow(p, [m.user_id === me ? 'คุณ' : '', roleText].filter(Boolean).join(' · '));
    if (m.user_id !== me) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'mini-btn ghost';
      more.textContent = '⋯';
      more.setAttribute('aria-label', 'ตัวเลือก');
      more.onclick = () => openPersonSheet(m.user_id, 'group', groupTargetId);
      row.appendChild(more);
    }
    box.appendChild(row);
  });
}

function giAvatarClick() {
  const g = state.groups[groupTargetId];
  if (!g) return;
  if (g.role === 'owner' || g.role === 'admin') { document.getElementById('gi-file').click(); return; }
  if (g.avatar && (g.avatar.startsWith('http') || g.avatar.startsWith('data:'))) {
    $('viewer-img').src = g.avatar;
    openModal('image-viewer');
  }
}

async function giChangeAvatar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const oldAvatar = state.groups[groupTargetId] && state.groups[groupTargetId].avatar;
    const avatar = await uploadAvatarImage(file, 256, 'g');
    const { error } = await sb.rpc('update_group', { p_group: groupTargetId, p_name: null, p_avatar: avatar });
    if (error) throw error;
    removeOldAvatar(oldAvatar);
    await loadGroups();
    renderGroupInfo();
    loadChatList();
    if (activeChat && activeChat.id === groupTargetId) selectChat(activeChat);
    toast('เปลี่ยนรูปกลุ่มแล้ว', 'success');
  } catch (err) { handleDbError(err); }
  input.value = '';
}

async function saveGroupName() {
  const name = $('gi-name-input').value.trim();
  if (!name) return toast('กรุณาตั้งชื่อกลุ่ม', 'error');
  const { error } = await sb.rpc('update_group', { p_group: groupTargetId, p_name: name, p_avatar: null });
  if (error) return handleDbError(error);
  await loadGroups();
  renderGroupInfo();
  loadChatList();
  if (activeChat && activeChat.id === groupTargetId) selectChat(activeChat);
  toast('เปลี่ยนชื่อกลุ่มแล้ว', 'success');
}

async function toggleGroupMute(checked) {
  const { error } = await sb.rpc('set_group_muted', { p_group: groupTargetId, p_muted: checked });
  if (error) { renderGroupInfo(); return handleDbError(error); }
  await loadGroups();
  toast(checked ? 'ปิดเสียงแจ้งเตือนกลุ่มแล้ว' : 'เปิดเสียงแจ้งเตือนกลุ่มแล้ว', 'success');
}

async function setGroupAdmin(gid, uid, admin) {
  const { error } = await sb.rpc('set_group_admin', { p_group: gid, p_user: uid, p_admin: admin });
  if (error) return handleDbError(error);
  await loadGroups();
  renderGroupInfo();
}

async function removeGroupMember(gid, uid) {
  const ok = await confirmDialog('นำออกจากกลุ่ม', `นำ ${groupSenderName(state.groups[gid], uid)} ออกจากกลุ่มนี้ใช่หรือไม่?`, 'นำออก', true);
  if (!ok) return;
  const { error } = await sb.rpc('remove_group_member', { p_group: gid, p_user: uid });
  if (error) return handleDbError(error);
  await loadGroups();
  renderGroupInfo();
  loadChatList();
}

async function leaveGroupConfirm() {
  const g = state.groups[groupTargetId];
  if (!g) return;
  const ok = await confirmDialog('ออกจากกลุ่ม',
    `ต้องการออกจากกลุ่ม "${g.name}" ใช่หรือไม่?\nคุณจะไม่เห็นข้อความของกลุ่มนี้อีก`, 'ออกจากกลุ่ม', true);
  if (!ok) return;
  const gid = groupTargetId;
  const { error } = await sb.rpc('leave_group', { p_group: gid });
  if (error) return handleDbError(error);
  closeModal('ginfo-modal');
  try { await loadGroups(); } catch (e) { return handleDbError(e); }
  if (activeChat && activeChat.id === gid) { activeChat = null; backToList(); }
  loadChatList();
  toast('ออกจากกลุ่มแล้ว', 'success');
}

// ลบข้อความทั้งกลุ่ม (เฉพาะฝั่งเรา ยังอยู่ในกลุ่มเหมือนเดิม)
async function clearGroupChat(id) {
  const g = state.groups[id];
  const ok = await confirmDialog('ลบข้อความทั้งหมดในกลุ่ม',
    `ลบข้อความทั้งหมดของกลุ่ม "${g ? g.name : ''}"?\nลบเฉพาะฝั่งคุณ สมาชิกคนอื่นยังเห็นข้อความเดิม\nและคุณยังอยู่ในกลุ่มเหมือนเดิม`, 'ลบข้อความ', true);
  if (!ok) return;
  const { error } = await sb.rpc('clear_group_chat', { p_group: id });
  if (error) return handleDbError(error);
  const last = lastMessageOf(id);
  social.cleared[id] = Math.max(Date.now(), last ? last.ts + 1 : 0);
  state.messages[id] = [];
  delete lastRead[id];
  saveLastRead();
  if (activeChat && activeChat.id === id) loadMessages();
  loadChatList();
  toast('ลบข้อความเรียบร้อย', 'success');
}

// สมาชิกในกลุ่มเปลี่ยนแปลง / ถูกเพิ่ม / ถูกนำออก (เรียลไทม์)
async function onGroupChange(payload) {
  if (!currentUser) return;
  // มีคนอ่านข้อความ: อัปเดตเฉพาะเวลาอ่าน ไม่ต้องโหลดกลุ่มทั้งหมดใหม่
  if (payload.eventType === 'UPDATE' && payload.new && payload.new.group_id && payload.new.user_id) {
    const g = state.groups[payload.new.group_id];
    const mem = g && g.members.find(m => m.user_id === payload.new.user_id);
    if (mem) {
      const isMe = payload.new.user_id === currentUser.id;
      if (payload.new.role === mem.role && (!isMe || payload.new.muted === g.muted)) {
        mem.readAt = payload.new.last_read_at ? new Date(payload.new.last_read_at).getTime() : null;
        if (activeChat && activeChat.id === g.id) loadMessages(true);
        return;
      }
    }
  }
  const wasActiveId = activeChat && activeChat.isGroup ? activeChat.id : null;
  const hadGroups = new Set(Object.keys(state.groups || {}));
  try { await loadGroups(); } catch (e) { return; }

  const row = payload.new || {};
  if (payload.eventType === 'INSERT' && row.user_id === currentUser.id && row.group_id &&
      !hadGroups.has(row.group_id) && state.groups[row.group_id] && state.groups[row.group_id].role !== 'owner') {
    toast(`คุณถูกเพิ่มเข้ากลุ่ม ${state.groups[row.group_id].name}`, 'alert');
    playSound('receive');
  }
  if (payload.eventType === 'DELETE' && payload.old && payload.old.user_id === currentUser.id) {
    toast('คุณไม่ได้อยู่ในกลุ่มนี้แล้ว', 'info');
  }

  if (wasActiveId && !state.groups[wasActiveId]) { activeChat = null; backToList(); }
  else if (wasActiveId) updateHeaderStatus();

  loadChatList();
  if (!$('ginfo-modal').classList.contains('hidden-element')) {
    if (state.groups[groupTargetId]) renderGroupInfo(); else closeModal('ginfo-modal');
  }
}

function previewText(chat, last) {
  if (isRoomLocked(chat.id)) return '🔒 ห้องนี้ถูกล็อก';
  if (!last) return chat.isGroup ? 'เริ่มต้นการสนทนาของกลุ่ม' : 'เริ่มต้นการสนทนา';
  if (last.kind === 'system') return msgLabel(last);
  if (isSecret(chat.id) && !chat.isGroup && last.kind === 'text') return '🔒 ' + (last.isMe ? 'คุณส่งข้อความลับ' : 'ข้อความลับ');
  if (chat.isGroup) return (last.isMe ? 'คุณ' : groupSenderName(chat, last.senderId)) + ': ' + msgLabel(last);
  return (last.isMe ? 'คุณ: ' : '') + msgLabel(last);
}

// ==================== ประเภทกลุ่ม / กลุ่มสาธารณะ / ไม่แสดงตัวตน (เฟส B3) ====================
let groupKind = 'private';
let searchTab = 'users';

// ชื่อที่แสดงของผู้ส่งในกลุ่ม: กลุ่มไม่แสดงตัวตนจะเห็นแค่ชื่อเล่น
function groupSenderName(g, uid) {
  if (g && g.anonymous) return g.aliases[uid] || 'สมาชิกนิรนาม';
  return nameOf(profileOf(uid));
}

function setGroupKind(kind) {
  groupKind = kind;
  $('gm-kind-private').classList.toggle('active', kind === 'private');
  $('gm-kind-public').classList.toggle('active', kind === 'public');
  $('gm-kind-hint').textContent = kind === 'private'
    ? 'ส่วนตัว: เข้าร่วมได้เฉพาะคนที่ถูกเชิญ'
    : 'สาธารณะ: ใครก็ค้นหากลุ่มเจอและเข้าร่วมเองได้';
}

function onAnonToggle() {
  $('gm-anon-hint').textContent = $('gm-anon').checked
    ? 'ทุกคนในกลุ่ม (รวมถึงคุณ) จะได้ชื่อสุ่มเฉพาะกลุ่มนี้ เปลี่ยนชื่อได้ภายหลังในข้อมูลกลุ่ม'
    : '';
}

function fillGroupTags(el, g) {
  el.innerHTML = '';
  const add = (text, cls) => {
    const t = document.createElement('span');
    t.className = 'tag-group ' + (cls || '');
    t.textContent = text;
    el.appendChild(t);
  };
  add(g.kind === 'public' ? 'กลุ่มสาธารณะ' : 'กลุ่มส่วนตัว', g.kind === 'public' ? 'tag-public' : 'tag-private');
  if (g.anonymous) add('ไม่แสดงตัวตน', 'tag-anon');
}

// ---------- ค้นหากลุ่มสาธารณะ (แท็บในหน้าเพิ่มเพื่อน) ----------
function setSearchTab(tab) {
  searchTab = tab;
  $('tab-users').classList.toggle('active', tab === 'users');
  $('tab-groups').classList.toggle('active', tab === 'groups');
  $('search-label').textContent = tab === 'users'
    ? 'ค้นหาด้วยชื่อผู้ใช้ ชื่อเล่น หรือ ID'
    : 'ค้นหากลุ่มสาธารณะด้วยชื่อกลุ่ม (เว้นว่างไว้เพื่อดูกลุ่มล่าสุด)';
  $('user-search-input').placeholder = tab === 'users' ? 'พิมพ์อย่างน้อย 2 ตัวอักษร' : 'ชื่อกลุ่ม';
  runUserSearch();
}

async function runGroupSearch() {
  const q = $('user-search-input').value.trim().replace(/[%_\\,()]/g, '');
  const token = ++searchToken;
  setUserHint('กำลังค้นหา...');
  const { data, error } = await sb.rpc('search_public_groups', { q });
  if (token !== searchToken) return;
  if (error) { setUserHint('ค้นหาไม่สำเร็จ'); return handleDbError(error); }
  if (!data || !data.length) return setUserHint('ไม่พบกลุ่มสาธารณะ');

  const box = $('user-search-results');
  box.innerHTML = '';
  data.forEach(g => {
    const row = document.createElement('div');
    row.className = 'user-row';
    const av = document.createElement('div');
    av.className = 'avatar group-av';
    renderAvatar(av, g.avatar || '👥', g.name);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = g.name;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = `${g.member_count} สมาชิก` + (g.anonymous ? ' · ไม่แสดงตัวตน' : '');
    name.appendChild(sub);
    const btn = document.createElement('button');
    btn.className = 'mini-btn';
    btn.textContent = g.joined ? 'เปิดกลุ่ม' : 'เข้าร่วม';
    btn.onclick = () => joinPublicGroup(g);
    row.append(av, name, btn);
    box.appendChild(row);
  });
}

async function joinPublicGroup(g) {
  if (state.groups[g.id]) { toggleSearchModal(false); selectChat(state.groups[g.id]); return; }
  if (g.anonymous) {
    const ok = await confirmDialog('เข้าร่วมกลุ่มไม่แสดงตัวตน',
      `ระบบจะตั้งชื่อสุ่มให้คุณเฉพาะในกลุ่มนี้ สมาชิกจะไม่เห็นรูป ชื่อผู้ใช้ อีเมล และ ID ของคุณ\nเข้าร่วมกลุ่ม "${g.name}" หรือไม่?`, 'เข้าร่วม');
    if (!ok) return;
  }
  const { error } = await sb.rpc('join_public_group', { p_group: g.id });
  if (error) return handleDbError(error);
  try { await loadGroups(); } catch (e) { return handleDbError(e); }
  toggleSearchModal(false);
  if (state.groups[g.id]) selectChat(state.groups[g.id]);
  loadChatList();
  toast('เข้าร่วมกลุ่มแล้ว', 'success');
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
