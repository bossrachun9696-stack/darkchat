// =====================================================================
// DarkChat: ระบบส่วนขยาย (Extensions)
// โหลดต่อจาก app.js (ใน index.html) ไม่ต้องแก้ app.js
// ต้องรัน supabase-extensions.sql ก่อน
// =====================================================================
(function () {
  'use strict';

  const EXT = {
    list: [],            // ส่วนขยายทั้งหมดพร้อมสถานะของฉัน (จาก ext_catalog)
    loaded: false,
    ready: true,         // false = ยังไม่ได้รัน SQL
    roomKey: null,
    roomExt: [],         // ext_id ที่อยู่ในห้องที่เปิดอยู่
    tab: 'all',
    channel: null,
    adminReqs: []
  };
  window.EXT = EXT;

  // จอมือถือแคบ: โชว์ไอคอนน้อยลงเพื่อไม่ให้ชื่อห้องถูกบีบ ที่เหลือรวมไว้ในปุ่ม +N
  const maxIcons = () => (window.matchMedia('(max-width: 760px)').matches ? 1 : 3);
  const ERR = {
    ext_locked: 'ส่วนขยายนี้ต้องซื้อหรือทดลองใช้ก่อน',
    not_in_room: 'คุณไม่ได้อยู่ในห้องนี้',
    room_ext_full: 'ห้องนี้มีส่วนขยายครบ 12 ตัวแล้ว เอาตัวที่ไม่ใช้ออกก่อน',
    trial_used: 'คุณทดลองใช้ส่วนขยายนี้ไปแล้ว',
    no_trial: 'ส่วนขยายนี้ไม่มีให้ทดลองใช้',
    ext_is_free: 'ส่วนขยายนี้ใช้ฟรีอยู่แล้ว',
    already_owned: 'คุณซื้อส่วนขยายนี้แล้ว',
    admin_no_need: 'คุณเป็นแอดมิน ใช้ได้ทุกส่วนขยายอยู่แล้ว',
    too_many_requests: 'ส่งคำขอซื้อบ่อยเกินไป ลองใหม่พรุ่งนี้',
    not_admin: 'เฉพาะแอดมินเท่านั้น',
    bad_link: 'ลิงก์ต้องขึ้นต้นด้วย https://',
    icon_too_big: 'รูปไอคอนใหญ่เกินไป',
    ext_not_found: 'ไม่พบส่วนขยายนี้ (อาจถูกปิดไปแล้ว)',
    no_open_request: 'คำขอนี้ถูกจัดการไปแล้ว',
    qr_too_big: 'รูป QR ใหญ่เกินไป',
    room_not_supported: 'เชื่อมสมุดบ้านได้เฉพาะแชทกลุ่มและแชทสองคน',
    not_in_family: 'คุณไม่ได้เป็นสมาชิกบ้านนี้ในสมุดบ้าน',
    ledger_ext_missing: 'ยังไม่มีส่วนขยายชนิดสมุดบ้าน ให้แอดมินตั้งชนิดในหน้าแก้ไขส่วนขยาย',
    post_failed: 'ส่งข้อความเข้าห้องไม่ได้'
  };

  function extErr(error) {
    const msg = (error && error.message) || '';
    for (const k in ERR) if (msg.includes(k)) return toast(ERR[k], 'error');
    if (/post_failed/.test(msg)) return toast('ส่งข้อความเข้าห้องไม่ได้: ' + msg.replace(/^.*post_failed:\s*/, ''), 'error');
    if (/ext_ledger|ext_room_mute/.test(msg) && /Could not find the function|does not exist/i.test(msg)) {
      return toast('ยังไม่ได้ตั้งค่าการเชื่อมสมุดบ้าน: รันไฟล์ supabase-ledger.sql ใน SQL Editor ก่อน', 'error');
    }
    if (/ext_catalog|room_extensions|ext_room|Could not find the function|does not exist/i.test(msg)) {
      return toast('ยังไม่ได้ตั้งค่าระบบส่วนขยาย: รันไฟล์ supabase-extensions.sql ใน SQL Editor ก่อน', 'error');
    }
    handleDbError(error);
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const isAdmin = () => typeof isAdminUser === 'function' && isAdminUser();
  const byId = id => EXT.list.find(e => e.id === id);

  function daysLeft(iso) {
    if (!iso) return null;
    return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
  }

  // ---------- คีย์ของห้อง (ทั้งสองฝั่งของแชทสองคนต้องได้คีย์เดียวกัน) ----------
  function roomKeyOf(c) {
    if (!c || !currentUser) return null;
    const me = currentUser.id;
    if (c.isGroup) return 'g:' + c.id;
    if (c.isSaved || c.id === me) return 'u:' + me;
    return 'd:' + [me, c.id].sort().join(':');
  }

  // ---------- โหลดข้อมูล ----------
  async function loadCatalog() {
    const { data, error } = await sb.rpc('ext_catalog');
    if (error) {
      EXT.ready = !/Could not find the function|does not exist/i.test(error.message || '');
      EXT.list = [];
      return;
    }
    EXT.ready = true;
    EXT.loaded = true;
    EXT.list = data || [];
  }

  async function loadRoom() {
    const c = typeof activeChat !== 'undefined' ? activeChat : null;
    EXT.roomKey = roomKeyOf(c);
    EXT.roomExt = [];
    if (!EXT.roomKey || !EXT.ready) { renderHeaderIcons(); return; }
    const key = EXT.roomKey;
    const { data, error } = await sb.from('room_extensions').select('ext_id, created_at').eq('room_key', key).order('created_at');
    if (key !== EXT.roomKey) return;   // เปลี่ยนห้องไปแล้วระหว่างรอ
    EXT.roomExt = error ? [] : (data || []).map(r => r.ext_id);
    renderHeaderIcons();
  }

  async function refreshAll() {
    await loadCatalog();
    await loadRoom();
    if (isOpen('ext-modal')) renderStore();
  }

  function isOpen(id) { const m = $(id); return m && !m.classList.contains('hidden-element'); }

  // ---------- ไอคอนส่วนขยายบนหัวห้องแชท (ต่อจากปุ่ม ⋮) ----------
  function headerBox() {
    let box = $('ext-room-icons');
    if (box) return box;
    const actions = document.querySelector('.chat-header-actions');
    if (!actions) return null;
    box = el('div', 'ext-room-icons');
    box.id = 'ext-room-icons';
    actions.appendChild(box);   // อยู่ถัดจากปุ่ม ⋮ (ปุ่มสุดท้ายของแถบ)
    return box;
  }

  function iconNode(e, cls) {
    const n = el('span', cls || 'ext-ico-img');
    const icon = (e && e.icon) || '';
    if (/^(https:|data:image\/)/.test(icon)) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = icon;
      n.appendChild(img);
    } else {
      n.textContent = icon || '🧩';
    }
    return n;
  }

  function renderHeaderIcons() {
    const box = headerBox();
    if (!box) return;
    box.innerHTML = '';
    const items = EXT.roomExt.map(byId).filter(Boolean);
    if (!items.length || !EXT.roomKey) { box.classList.add('hidden-element'); return; }
    box.classList.remove('hidden-element');
    items.slice(0, maxIcons()).forEach(e => {
      const b = el('button', 'icon-btn ext-ico' + (e.can_use ? '' : ' locked'));
      b.type = 'button';
      b.title = e.name + (e.can_use ? '' : ' (ต้องซื้อหรือทดลองใช้)');
      b.setAttribute('aria-label', 'ส่วนขยาย ' + e.name);
      b.appendChild(iconNode(e));
      if (!e.can_use) b.appendChild(el('span', 'ext-lock', '🔒'));
      b.onclick = () => launch(e.id);
      box.appendChild(b);
    });
    if (items.length > maxIcons()) {
      const more = el('button', 'icon-btn ext-ico ext-more', '+' + (items.length - maxIcons()));
      more.type = 'button';
      more.title = 'ส่วนขยายอื่นในห้องนี้';
      more.onclick = openRoomExtSheet;
      box.appendChild(more);
    }
  }

  // ---------- เปิดใช้ส่วนขยาย ----------
  function launch(id) {
    const e = byId(id);
    if (!e) return toast('ไม่พบส่วนขยายนี้', 'error');
    if (!e.can_use) return openPaywall(id);
    let url;
    try { url = new URL(e.link); } catch (x) { return toast('ลิงก์ส่วนขยายไม่ถูกต้อง', 'error'); }
    if (url.protocol !== 'https:') return toast('ลิงก์ส่วนขยายไม่ถูกต้อง', 'error');
    window.open(url.href, '_blank', 'noopener');
  }

  // ---------- แจ้งเตือนส่วนขยายเสียเงิน ----------
  function ensureModal(id, cls) {
    let m = $(id);
    if (m) return m;
    m = el('div', 'modal hidden-element');
    m.id = id;
    m.onclick = ev => { if (ev.target === m) closeModal(id); };
    const c = el('div', 'modal-content ' + (cls || ''));
    c.id = id + '-body';
    m.appendChild(c);
    document.body.appendChild(m);
    return m;
  }

  function openPaywall(id) {
    const e = byId(id);
    if (!e) return;
    ensureModal('ext-pay-modal', 'confirm-box ext-pay');
    const body = $('ext-pay-modal-body');
    body.innerHTML = '';
    const head = el('div', 'ext-pay-head');
    head.appendChild(iconNode(e, 'ext-big-icon'));
    head.appendChild(el('h3', '', e.name));
    body.appendChild(head);
    const expired = e.trial_used && !e.can_use;
    body.appendChild(el('div', 'ext-pay-badge', expired ? '⏰ หมดเวลาทดลองใช้แล้ว' : '🔒 ส่วนขยายแบบเสียเงิน'));
    if (e.description) body.appendChild(el('p', 'ext-desc', e.description));
    body.appendChild(el('div', 'ext-price', '฿' + Number(e.price || 0).toLocaleString('th-TH') + ' · ซื้อครั้งเดียวใช้ได้ตลอด'));
    const st = el('div', 'stack');
    if (!e.trial_used && e.trial_days > 0) {
      st.appendChild(actionBtn(`🎁 ทดลองใช้ฟรี ${e.trial_days} วัน`, () => startTrial(e.id, true), 'primary-btn'));
    }
    if (e.pending_request) {
      st.appendChild(el('div', 'hint', 'ส่งคำขอซื้อแล้ว รอแอดมินตรวจสลิปและเปิดให้'));
      st.appendChild(actionBtn('🧾 ส่งสลิปให้แอดมิน', () => sendSlipToAdmin(e), 'secondary-btn'));
    } else {
      st.appendChild(actionBtn(`🛒 ซื้อ ฿${e.price}`, () => buy(e.id), e.trial_used ? 'primary-btn' : 'secondary-btn'));
    }
    st.appendChild(actionBtn('ปิด', () => closeModal('ext-pay-modal')));
    body.appendChild(st);
    openModal('ext-pay-modal');
  }

  async function startTrial(id, launchAfter) {
    const e = byId(id);
    if (!e) return;
    const ok = await confirmDialog('ทดลองใช้ฟรี', `เริ่มทดลองใช้ ${e.name} ฟรี ${e.trial_days} วัน?\nทดลองได้ครั้งเดียว นับจากวันนี้`, 'เริ่มทดลอง');
    if (!ok) return;
    const { data, error } = await sb.rpc('ext_start_trial', { p_ext: id });
    if (error) return extErr(error);
    toast(`เริ่มทดลองใช้ ${e.name} แล้ว ใช้ได้ถึง ${fmtDate(data)}`, 'success');
    closeModal('ext-pay-modal');
    await refreshAll();
    if (launchAfter) launch(id);
  }

  function fmtDate(iso) {
    try {
      return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
    } catch (x) { return ''; }
  }

  // ---------- ซื้อ (ส่งคำขอผ่านน้องโบ๊ะบ๊ะ แล้วโอนนอกแอป) ----------
  async function buy(id) {
    const e = byId(id);
    if (!e) return;
    const ok = await confirmDialog('ขอซื้อส่วนขยาย', `🧩 ${e.name}\nราคา ฿${e.price} (ซื้อครั้งเดียวใช้ได้ตลอด)\n\nน้องโบ๊ะบ๊ะจะส่งคำขอให้แอดมินและบอกวิธีโอนเงิน`, 'ขอซื้อ');
    if (!ok) return;
    const { data, error } = await sb.rpc('ext_request_purchase', { p_ext: id });
    if (error) return extErr(error);
    closeModal('ext-pay-modal');
    await refreshAll();
    EXT.lastAdminId = data && data.admin_id;
    await loadAdminId();
    if (data && data.msg_ok && data.admin_id) {   // ส่งการ์ดคำขอเข้าแชทกับแอดมินแล้ว: พาไปดูวิธีชำระเงินในแชทนั้นเลย
      closeModal('ext-modal');
      closeModal('ext-room-modal');
      await openChatById(data.admin_id);
      toast('ส่งคำขอซื้อให้แอดมินแล้ว ✅ ดูวิธีชำระเงินในการ์ด โอนแล้วกด "🧾 ส่งสลิป" ในการ์ดได้เลย', 'success');
      return;
    }
    boSay(`ขอซื้อส่วนขยาย ${e.name} ฿${e.price}`,
      `ส่งคำขอซื้อส่วนขยาย "${e.name}" (฿${data.price}) ให้แอดมินแล้วครับ ✅\n\n` +
      (data.pay_info ? `วิธีชำระเงิน:\n${data.pay_info}\n\n` : 'แอดมินจะแจ้งวิธีชำระเงินให้ทางข้อความครับ\n\n') +
      'โอนเสร็จแล้ว เปิดหน้า 🧩 ส่วนขยาย แล้วกด "🧾 ส่งสลิปให้แอดมิน" ที่ส่วนขยายนี้ ระบบจะเปิดแชทกับแอดมินให้ส่งรูปสลิป แอดมินตรวจแล้วจะเปิดใช้งานให้ครับ');
  }

  // ให้น้องโบ๊ะบ๊ะพูดในแชทของน้อง (ข้อความในเครื่อง ไม่เรียก AI)
  function boSay(userText, botText) {
    if (typeof bo === 'undefined' || !bo || !Array.isArray(bo.msgs)) { toast(botText, 'success'); return; }
    if (userText) bo.msgs.push({ role: 'user', text: userText });
    bo.msgs.push({ role: 'model', local: true, text: botText });
    try { saveBoHistory(); } catch (x) { /* ไม่เป็นไร */ }
    closeModal('ext-modal');
    openModal('bo-modal');
    try { if (typeof hideBoBubble === 'function') hideBoBubble(false); renderBoChat(); } catch (x) { /* ไม่เป็นไร */ }
  }

  async function sendSlipToAdmin(e) {
    let adminId = EXT.lastAdminId || EXT.adminId;
    if (!adminId) {   // เครื่องนี้ยังไม่รู้ไอดีแอดมิน: ถามจากคำขอซื้อที่มีอยู่ (ไม่สร้างคำขอซ้ำ)
      const { data } = await sb.rpc('ext_request_purchase', { p_ext: e.id });
      if (data && data.admin_id) { EXT.lastAdminId = data.admin_id; await loadAdminId(); adminId = data.admin_id; }
    }
    closeModal('ext-pay-modal');
    closeModal('ext-modal');
    if (!adminId) return toast('ยังไม่พบบัญชีแอดมิน ให้แอดมินเปิดหน้าส่วนขยายสักครั้งก่อน', 'error');
    openChatById(adminId).then(() => {
      const box = $('message-input');
      if (box && !box.value) {
        box.value = `ขอซื้อส่วนขยาย "${e.name}" ฿${e.price} แนบสลิปการโอนครับ`;
        box.dispatchEvent(new Event('input', { bubbles: true }));
      }
      toast('กดปุ่ม + แล้วเลือกรูปสลิปเพื่อส่งให้แอดมิน', 'info');
    });
  }

  async function cancelRequest(e) {
    const ok = await confirmDialog('ยกเลิกคำขอซื้อ', `ยกเลิกคำขอซื้อ ${e.name}? (ถ้าโอนเงินไปแล้ว โปรดติดต่อแอดมิน)`, 'ยกเลิกคำขอ', true);
    if (!ok) return;
    const { error } = await sb.rpc('ext_cancel_purchase', { p_request: e.pending_request });
    if (error) return extErr(error);
    await refreshAll();
  }

  // ---------- หน้าร้านส่วนขยาย ----------
  async function openExtStore(focusAi) {
    if (typeof toggleGearMenu === 'function') toggleGearMenu(false);
    ensureModal('ext-modal', 'ext-panel');
    openModal('ext-modal');
    renderStore(true);
    await loadCatalog();
    if (isAdmin()) {
      sb.rpc('ext_admin_register').then(() => {}, () => {});
      await loadAdminRequests();
    }
    await loadAdminId();
    renderStore();
    if (focusAi) setTimeout(() => { const i = $('ext-ai-input'); if (i) i.focus(); }, 50);
  }

  async function loadAdminId() {
    // ไอดีแอดมินได้มาจากคำขอซื้อ (ext_request_purchase) จึงเก็บไว้ในเครื่องด้วย
    try { EXT.adminId = EXT.adminId || localStorage.getItem('darkchat_ext_admin') || null; } catch (x) { /* ไม่เป็นไร */ }
    if (EXT.lastAdminId) {
      EXT.adminId = EXT.lastAdminId;
      try { localStorage.setItem('darkchat_ext_admin', EXT.adminId); } catch (x) { /* ไม่เป็นไร */ }
    }
  }

  function renderStore(loading) {
    const body = $('ext-modal-body');
    if (!body) return;
    body.innerHTML = '';

    const top = el('div', 'ext-top');
    top.appendChild(el('h3', '', '🧩 ส่วนขยาย'));
    if (isAdmin()) {
      const add = el('button', 'icon-btn ext-add', '+');
      add.type = 'button';
      add.title = 'เพิ่มส่วนขยาย';
      add.setAttribute('aria-label', 'เพิ่มส่วนขยาย');
      add.onclick = () => openEditor(null);
      top.appendChild(add);
    }
    const x = el('button', 'icon-btn', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'ปิด');
    x.onclick = () => closeModal('ext-modal');
    top.appendChild(x);
    body.appendChild(top);

    if (!EXT.ready) {
      body.appendChild(hintNode('ยังไม่ได้ตั้งค่าระบบส่วนขยาย: รันไฟล์ supabase-extensions.sql ใน SQL Editor ของ Supabase ก่อน'));
      return;
    }
    if (loading && !EXT.loaded) { body.appendChild(hintNode('กำลังโหลด…')); return; }

    // ผู้ช่วยเลือกส่วนขยาย
    const ai = el('div', 'ext-ai');
    const aiHead = el('div', 'ext-ai-head');
    const av = el('div', 'bo-mini');
    const im = document.createElement('img');
    im.className = 'bo-img';
    im.alt = '';
    const boImg = document.querySelector('#bo-btn .bo-img');
    if (boImg && boImg.src && !boImg.classList.contains('failed')) im.src = boImg.src; else im.classList.add('failed');
    av.append(im, el('span', 'bo-fallback', '🤖'));
    aiHead.append(av, el('strong', '', 'น้องโบ๊ะบ๊ะช่วยเลือกให้'));
    ai.appendChild(aiHead);
    const form = document.createElement('form');
    form.className = 'inline-form';
    const inp = document.createElement('input');
    inp.id = 'ext-ai-input';
    inp.className = 'plain-input';
    inp.placeholder = 'อยากได้ส่วนขยายแบบไหน เช่น สั่งอาหาร จดรายจ่าย';
    inp.maxLength = 80;
    inp.autocomplete = 'off';
    const go = el('button', 'mini-btn', 'แนะนำ');
    go.type = 'submit';
    form.append(inp, go);
    const out = el('div', 'ext-ai-out');
    out.id = 'ext-ai-out';
    form.onsubmit = ev => { ev.preventDefault(); recommend(inp.value, out); };
    ai.append(form, out);
    body.appendChild(ai);

    // แท็บ
    const tabs = el('div', 'segmented ext-tabs');
    [['all', 'ทั้งหมด'], ['free', 'ฟรี'], ['paid', 'เสียเงิน'], ['mine', 'ของฉัน']].forEach(([k, t]) => {
      const b = el('button', EXT.tab === k ? 'active' : '', t);
      b.type = 'button';
      b.onclick = () => { EXT.tab = k; renderStore(); };
      tabs.appendChild(b);
    });
    body.appendChild(tabs);

    const list = el('div', 'ext-list');
    const rows = EXT.list.filter(e => {
      if (EXT.tab === 'free') return e.is_free;
      if (EXT.tab === 'paid') return !e.is_free;
      if (EXT.tab === 'mine') return !e.is_free && (e.license_kind || e.pending_request);
      return true;
    });
    if (!rows.length) {
      list.appendChild(hintNode(EXT.list.length ? 'ไม่มีส่วนขยายในหมวดนี้' : (isAdmin() ? 'ยังไม่มีส่วนขยาย กดปุ่ม + เพื่อเพิ่มตัวแรก' : 'ยังไม่มีส่วนขยาย')));
    }
    rows.forEach(e => list.appendChild(extCard(e)));
    body.appendChild(list);

    if (isAdmin()) { body.appendChild(adminBlock()); body.appendChild(adminPayBlock()); }

    const note = el('div', 'hint ext-note', 'ส่วนขยายเสียเงินทุกตัวทดลองใช้ฟรีได้ 1 ครั้ง ซื้อแล้วใช้ได้ตลอด ชำระเงินด้วยการโอน แล้วแอดมินตรวจสลิปและเปิดให้ เพิ่มส่วนขยายเข้าห้องแชทได้จากปุ่ม ⋮ ในห้อง');
    body.appendChild(note);
  }

  function statusText(e) {
    if (!e.active) return { t: 'ซ่อนอยู่', c: 'off' };
    if (e.is_free) return { t: 'ฟรี', c: 'free' };
    if (isAdmin()) return { t: 'แอดมิน · ฿' + e.price, c: 'own' };
    if (e.license_kind === 'paid' || e.license_kind === 'granted') return { t: 'ซื้อแล้ว', c: 'own' };
    if (e.license_kind === 'trial' && e.can_use) return { t: `ทดลองเหลือ ${daysLeft(e.expires_at)} วัน`, c: 'trial' };
    if (e.pending_request) return { t: 'รอแอดมินตรวจ', c: 'wait' };
    if (e.license_kind === 'trial') return { t: 'หมดเวลาทดลอง · ฿' + e.price, c: 'paid' };
    return { t: '฿' + e.price, c: 'paid' };
  }

  function extCard(e) {
    const card = el('div', 'ext-card' + (e.active ? '' : ' hidden-ext'));
    const head = el('div', 'ext-card-head');
    head.appendChild(iconNode(e, 'ext-card-icon'));
    const info = el('div', 'ext-card-info');
    info.appendChild(el('strong', '', e.name));
    const st = statusText(e);
    info.appendChild(el('span', 'ext-badge ' + st.c, st.t));
    head.appendChild(info);
    card.appendChild(head);
    if (e.description) card.appendChild(el('div', 'ext-desc', e.description));

    const acts = el('div', 'ext-acts');
    if (e.can_use) {
      const open = chip2('เปิด', () => launch(e.id));
      open.className = 'chip primary';
      acts.appendChild(open);
    } else if (!e.is_free) {
      if (!e.trial_used && e.trial_days > 0) {
        const t = chip2(`🎁 ทดลองฟรี ${e.trial_days} วัน`, () => startTrial(e.id, false));
        t.className = 'chip primary';
        acts.appendChild(t);
      }
    }
    if (!e.is_free && !isAdmin() && !(e.license_kind === 'paid' || e.license_kind === 'granted')) {
      if (e.pending_request) {
        acts.appendChild(chip2('🧾 ส่งสลิปให้แอดมิน', () => sendSlipToAdmin(e)));
        const c = chip2('ยกเลิกคำขอ', () => cancelRequest(e));
        c.classList.add('danger');
        acts.appendChild(c);
      } else {
        acts.appendChild(chip2(`🛒 ซื้อ ฿${e.price}`, () => buy(e.id)));
      }
    }
    if (activeChat && e.can_use && EXT.roomKey && !EXT.roomExt.includes(e.id)) {
      acts.appendChild(chip2('➕ เพิ่มเข้าห้องนี้', () => addToRoom(e.id)));
    }
    if (isAdmin()) acts.appendChild(chip2('✏️ แก้ไข', () => openEditor(e.id)));
    card.appendChild(acts);
    return card;
  }

  // ---------- ผู้ช่วยแนะนำ (ไม่ใช้ AI ภายนอก: เทียบคำกับชื่อและรายละเอียด) ----------
  function recommend(q, out) {
    out.innerHTML = '';
    const words = String(q || '').toLowerCase().split(/[\s,]+/).filter(w => w.length >= 2);
    const pool = EXT.list.filter(e => e.active);
    if (!pool.length) { out.appendChild(el('div', 'hint', 'ตอนนี้ยังไม่มีส่วนขยายให้เลือกครับ')); return; }
    // ภาษาไทยไม่เว้นวรรค: เทียบเป็นชิ้นละ 3 ตัวอักษรด้วย เช่น "จดรายจ่าย" จะเจอ "บันทึกรายรับรายจ่าย"
    const grams = w => { const a = [...w]; const out = []; for (let i = 0; i + 3 <= a.length; i++) out.push(a.slice(i, i + 3).join('')); return out.length ? out : [w]; };
    let scored = pool.map(e => {
      const name = e.name.toLowerCase();
      const hay = (name + ' ' + (e.description || '')).toLowerCase();
      let s = 0;
      words.forEach(w => {
        if (hay.includes(w)) { s += name.includes(w) ? 3 : 2; return; }
        const g = grams(w);
        const hit = g.filter(x => hay.includes(x)).length / g.length;
        if (hit >= 0.35) s += hit * (g.some(x => name.includes(x)) ? 2 : 1.5);
      });
      return { e, s };
    });
    let top = scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
    let lead = 'น้องคิดว่าตัวนี้น่าจะตรงกับที่ต้องการครับ';
    if (!words.length || !top.length) {
      top = scored.sort((a, b) => (b.e.can_use - a.e.can_use) || (a.e.is_free - b.e.is_free)).slice(0, 3);
      lead = words.length ? 'ยังไม่เจอตัวที่ตรงเป๊ะครับ ลองดูตัวที่น่าสนใจพวกนี้' : 'ตัวที่น้องแนะนำครับ';
    }
    out.appendChild(el('div', 'ext-ai-lead', lead));
    top.forEach(({ e }) => {
      const row = el('div', 'ext-ai-row');
      row.appendChild(iconNode(e, 'ext-mini-icon'));
      const t = el('div', 'ext-ai-text');
      t.appendChild(el('strong', '', e.name + ' · ' + statusText(e).t));
      const why = e.description ? e.description.slice(0, 120) + (e.description.length > 120 ? '…' : '') : '';
      if (why) t.appendChild(el('span', '', why));
      row.appendChild(t);
      const b = e.can_use ? chip2('เปิด', () => launch(e.id)) : chip2('ดู', () => openPaywall(e.id));
      b.className = 'chip primary';
      row.appendChild(b);
      out.appendChild(row);
    });
  }

  // ---------- ส่วนขยายในห้องแชท ----------
  async function addToRoom(id) {
    const key = EXT.roomKey;
    if (!key) return toast('เปิดห้องแชทก่อน', 'error');
    const { error } = await sb.rpc('ext_room_add', { p_room: key, p_ext: id });
    if (error) return extErr(error);
    const e = byId(id);
    toast(`เพิ่ม ${e ? e.name : 'ส่วนขยาย'} เข้าห้องแล้ว กดไอคอนบนหัวห้องเพื่อเปิด`, 'success');
    await loadRoom();
    if (isOpen('ext-modal')) renderStore();
  }

  async function removeFromRoom(id) {
    const key = EXT.roomKey;
    const e = byId(id);
    const ok = await confirmDialog('เอาส่วนขยายออก', `เอา ${e ? e.name : 'ส่วนขยายนี้'} ออกจากห้องนี้? (ทุกคนในห้องจะไม่เห็นไอคอนนี้แล้ว)`, 'เอาออก', true);
    if (!ok) return;
    const { error } = await sb.rpc('ext_room_remove', { p_room: key, p_ext: id });
    if (error) return extErr(error);
    await loadRoom();
  }

  function openRoomExtSheet() {
    ensureModal('ext-room-modal', 'confirm-box');
    const body = $('ext-room-modal-body');
    body.innerHTML = '';
    body.appendChild(el('h3', '', '🧩 ส่วนขยายของห้องนี้'));
    const st = el('div', 'stack');
    const inRoom = EXT.roomExt.map(byId).filter(Boolean);
    if (inRoom.length) {
      inRoom.forEach(e => {
        const row = el('div', 'ext-room-row');
        row.appendChild(iconNode(e, 'ext-mini-icon'));
        row.appendChild(el('span', 'ext-room-name', e.name + (e.can_use ? '' : ' 🔒')));
        const o = chip2('เปิด', () => { closeModal('ext-room-modal'); launch(e.id); });
        o.className = 'chip primary';
        const r = chip2('เอาออก', () => { closeModal('ext-room-modal'); removeFromRoom(e.id); });
        r.classList.add('danger');
        row.append(o, r);
        st.appendChild(row);
      });
    } else {
      st.appendChild(el('div', 'hint', 'ห้องนี้ยังไม่มีส่วนขยาย'));
    }
    const usable = EXT.list.filter(e => e.active && e.can_use && !EXT.roomExt.includes(e.id));
    if (usable.length) {
      st.appendChild(el('div', 'list-title', 'เพิ่มเข้าห้อง (ฟรี และที่ซื้อแล้ว)'));
      usable.forEach(e => {
        const row = el('div', 'ext-room-row');
        row.appendChild(iconNode(e, 'ext-mini-icon'));
        row.appendChild(el('span', 'ext-room-name', e.name));
        const a = chip2('➕ เพิ่ม', () => { closeModal('ext-room-modal'); addToRoom(e.id); });
        a.className = 'chip primary';
        row.appendChild(a);
        st.appendChild(row);
      });
    }
    st.appendChild(actionBtn('🛒 ไปที่ร้านส่วนขยาย', () => { closeModal('ext-room-modal'); openExtStore(); }));
    st.appendChild(actionBtn('ปิด', () => closeModal('ext-room-modal')));
    body.appendChild(st);
    openModal('ext-room-modal');
  }

  // ---------- สมุดบ้าน: เชื่อมบ้านกับห้อง / ตั้งค่าแจ้งเตือน ----------
  const ledgerExt = () => EXT.list.find(e => e.kind === 'ledger' && e.active);

  async function linkLedger() {
    const key = EXT.roomKey;
    if (!key || !/^(g|d):/.test(key)) return toast('เชื่อมสมุดบ้านได้เฉพาะแชทกลุ่มและแชทสองคน', 'error');
    const L = ledgerExt();
    if (!L) return toast('ยังไม่มีส่วนขยายสมุดบ้านในร้าน', 'error');
    if (!L.can_use) return openPaywall(L.id);
    const { data, error } = await sb.rpc('ext_ledger_my_families');
    if (error) return extErr(error);
    if (!data || !data.length) return toast('คุณยังไม่มีบ้านในสมุดบ้าน: เปิดสมุดบ้านแล้วสร้างหรือเข้าร่วมบ้านก่อน (ใช้อีเมลเดียวกับ DarkChat)', 'error');
    const pick = async f => {
      const ok = await confirmDialog('เชื่อมสมุดบ้านกับห้องนี้',
        `เชื่อมบ้าน "${f.name}" กับห้องนี้?\n\nทุกคนในห้องจะเห็น:\n• แจ้งเตือนเมื่อมีคนแก้ไขรายรับรายจ่าย\n• สรุปประจำวันเวลา 20:00\n• เตือนบิลที่ยังไม่จ่ายก่อนครบกำหนด 3 วัน\n\nปิดหรือเลือกเฉพาะบางอย่างได้ที่ ⋮ > ส่วนขยาย > ตั้งค่าแจ้งเตือนส่วนขยาย`, 'เชื่อม');
      if (!ok) return;
      const { error: e2 } = await sb.rpc('ext_ledger_link', { p_room: key, p_family: f.id });
      if (e2) return extErr(e2);
      toast('เชื่อมสมุดบ้านกับห้องนี้แล้ว', 'success');
      await loadRoom();
    };
    if (data.length === 1) return pick(data[0]);
    ensureModal('ext-pick-modal', 'confirm-box');
    const body = $('ext-pick-modal-body');
    body.innerHTML = '';
    body.appendChild(el('h3', '', 'เลือกบ้านที่จะเชื่อม'));
    const st = el('div', 'stack');
    data.forEach(f => st.appendChild(actionBtn('🏠 ' + f.name, () => { closeModal('ext-pick-modal'); pick(f); })));
    st.appendChild(actionBtn('ยกเลิก', () => closeModal('ext-pick-modal')));
    body.appendChild(st);
    openModal('ext-pick-modal');
  }

  function switchRow(title, hint, checked, onChange) {
    const row = el('div', 'set-row');
    const t = el('div');
    t.appendChild(el('strong', '', title));
    if (hint) t.appendChild(el('span', 'hint', hint));
    const sw = el('label', 'switch');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!checked;
    cb.onchange = async () => { cb.disabled = true; const ok = await onChange(cb.checked); cb.disabled = false; if (ok === false) cb.checked = !cb.checked; };
    sw.append(cb, el('span', 'slider'));
    row.append(t, sw);
    return row;
  }

  async function openExtNotify() {
    const key = EXT.roomKey;
    if (!key) return;
    ensureModal('ext-notify-modal', '');
    const body = $('ext-notify-modal-body');
    body.innerHTML = '';
    body.appendChild(el('h3', '', '🔔 แจ้งเตือนส่วนขยายของห้องนี้'));
    body.appendChild(hintNode('กำลังโหลด…'));
    openModal('ext-notify-modal');
    const { data, error } = await sb.rpc('ext_ledger_room_info', { p_room: key });
    body.innerHTML = '';
    body.appendChild(el('h3', '', '🔔 แจ้งเตือนส่วนขยายของห้องนี้'));
    if (error) { closeModal('ext-notify-modal'); return extErr(error); }
    const info = data || { mute_all: false, links: [] };
    body.appendChild(switchRow('ปิดการแจ้งเตือนส่วนขยายทั้งหมด', 'ส่วนขยายจะไม่ส่งข้อความเข้าห้องนี้ (มีผลกับทุกคนในห้อง)', info.mute_all, async v => {
      const { error: e } = await sb.rpc('ext_room_mute', { p_room: key, p_mute: v });
      if (e) { extErr(e); return false; }
      toast(v ? 'ปิดการแจ้งเตือนส่วนขยายของห้องนี้แล้ว' : 'เปิดการแจ้งเตือนส่วนขยายแล้ว', 'success');
      return true;
    }));
    if (!info.links.length) {
      body.appendChild(el('div', 'hint', 'ห้องนี้ยังไม่ได้เชื่อมกับสมุดบ้าน'));
      if (!/^(g|d):/.test(key)) body.appendChild(el('div', 'hint', 'เชื่อมสมุดบ้านได้เฉพาะแชทกลุ่มและแชทสองคน'));
      else if (ledgerExt()) body.appendChild(actionBtn('🏠 เชื่อมสมุดบ้านกับห้องนี้', () => { closeModal('ext-notify-modal'); linkLedger(); }, 'secondary-btn'));
      else body.appendChild(el('div', 'hint', isAdmin()
        ? '⚠️ ยังไม่มีส่วนขยายชนิดสมุดบ้าน: เปิด 🧩 ส่วนขยาย > สมุดบ้าน > ✏️ แก้ไข เลือกชนิด "🏠 สมุดบ้าน (เชื่อมข้อมูล)" แล้วบันทึก'
        : '⚠️ ยังไม่มีส่วนขยายสมุดบ้านในร้าน ให้แอดมินตั้งค่าก่อน'));
    }
    info.links.forEach(l => {
      body.appendChild(el('div', 'list-title', '🏠 สมุดบ้าน · ' + l.family_name));
      const set = (field, v) => sb.rpc('ext_ledger_set', { p_room: key, p_family: l.family_id,
        p_edits: field === 'e' ? v : null, p_summary: field === 's' ? v : null, p_bills: field === 'b' ? v : null })
        .then(({ error: e }) => { if (e) { extErr(e); return false; } return true; });
      body.appendChild(switchRow('แจ้งเมื่อมีคนแก้ไขรายรับรายจ่าย', 'เพิ่ม แก้ ลบรายการ และติ๊กจ่ายบิล', l.notify_edits, v => set('e', v)));
      body.appendChild(switchRow('สรุปประจำวัน 20:00', 'ใช้อะไรไปบ้าง เงินเหลือเท่าไหร่ บิลที่ยังไม่จ่าย', l.daily_summary, v => set('s', v)));
      body.appendChild(switchRow('เตือนบิลที่ยังไม่จ่าย', 'เริ่มเตือนก่อนครบกำหนด 3 วัน ยิ่งใกล้ยิ่งถี่ วันครบกำหนดเตือนทุกชั่วโมง', l.bill_reminders, v => set('b', v)));
      const un = actionBtn('ยกเลิกการเชื่อมบ้านนี้', async () => {
        const ok = await confirmDialog('ยกเลิกการเชื่อม', `ยกเลิกการเชื่อมบ้าน "${l.family_name}" กับห้องนี้?\nห้องนี้จะไม่ได้รับแจ้งเตือน สรุป และการเตือนบิลจากบ้านนี้อีก`, 'ยกเลิกการเชื่อม', true);
        if (!ok) return;
        const { error: e } = await sb.rpc('ext_ledger_unlink', { p_room: key, p_family: l.family_id });
        if (e) return extErr(e);
        toast('ยกเลิกการเชื่อมแล้ว', 'info');
        openExtNotify();
      }, 'secondary-btn danger');
      un.style.marginTop = '8px';
      body.appendChild(un);
    });
    const close = actionBtn('ปิด', () => closeModal('ext-notify-modal'), 'primary-btn');
    close.style.marginTop = '16px';
    body.appendChild(close);
  }

  // ---------- การ์ดคำขอซื้อส่วนขยายในแชท (ผู้ซื้อเห็นวิธีชำระเงิน / แอดมินกดอนุมัติ) ----------
  let payInfoCache = null;
  async function getPayInfo(force) {
    if (payInfoCache && !force) return payInfoCache;
    const { data } = await sb.rpc('ext_pay_info');
    payInfoCache = data || { text: '', qr: '' };
    return payInfoCache;
  }
  const STATUS_TXT = { requested: 'รอชำระเงิน', approved: 'เปิดใช้งานแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิกแล้ว' };

  function viewImage(src) {
    const img = $('viewer-img');
    if (!img) return window.open(src, '_blank', 'noopener');
    img.src = src;
    openModal('image-viewer');
  }

  function buildPurchaseCard(m) {
    const meta = m.rmeta || {};
    const st = meta.status || 'requested';
    const card = el('div', 'ext-msg ext-buy st-' + st);
    const head = el('div', 'ext-msg-head');
    head.appendChild(el('strong', '', '🧩 คำขอซื้อส่วนขยาย'));
    head.appendChild(el('span', 'ext-buy-status', meta.status_text || STATUS_TXT[st] || ''));
    card.appendChild(head);
    card.appendChild(el('div', 'ext-buy-info', `${meta.buyer || 'ผู้ใช้'} · ${meta.ext_name || ''} · ฿${meta.price ?? ''}`));
    if (st === 'requested') {
      const pay = el('div', 'ext-buy-pay');
      pay.appendChild(el('div', 'ext-buy-pay-title', '💳 วิธีชำระเงิน'));
      const txt = el('div', 'ext-buy-pay-text', 'กำลังโหลด…');
      pay.appendChild(txt);
      card.appendChild(pay);
      getPayInfo().then(info => {
        txt.textContent = info.text || 'แอดมินจะแจ้งวิธีชำระเงินในแชทนี้';
        if (info.qr && /^data:image\//.test(info.qr)) {
          const q = document.createElement('img');
          q.className = 'ext-buy-qr';
          q.alt = 'QR สำหรับชำระเงิน';
          q.src = info.qr;
          q.onclick = () => viewImage(info.qr);
          pay.appendChild(q);
          pay.appendChild(el('div', 'hint', 'แตะรูปเพื่อขยาย กดค้างเพื่อบันทึกรูป'));
        }
      }, () => { txt.textContent = 'แอดมินจะแจ้งวิธีชำระเงินในแชทนี้'; });
      const acts = el('div', 'ext-msg-acts');
      if (m.isMe) {
        const slip = chip2('🧾 ส่งสลิป', () => {
          if (typeof attachPick === 'function') attachPick('media-input'); else toast('กดปุ่ม + แล้วเลือกรูปสลิป', 'info');
        });
        slip.className = 'chip primary';
        acts.appendChild(slip);
        const c = chip2('ยกเลิกคำขอ', async () => {
          const ok = await confirmDialog('ยกเลิกคำขอซื้อ', `ยกเลิกคำขอซื้อ ${meta.ext_name || ''}? (ถ้าโอนเงินไปแล้ว ทักแอดมินในแชทนี้)`, 'ยกเลิกคำขอ', true);
          if (!ok) return;
          const { error } = await sb.rpc('ext_cancel_purchase', { p_request: meta.request_id });
          if (error) return extErr(error);
          toast('ยกเลิกคำขอแล้ว', 'info');
          refreshAll();
        });
        c.classList.add('danger');
        acts.appendChild(c);
      } else if (isAdmin()) {
        const ok = chip2('✅ อนุมัติ (ตรวจสลิปแล้ว)', () => decide({ id: meta.request_id, ext_name: meta.ext_name, nickname: meta.buyer }, true));
        ok.className = 'chip primary';
        const no = chip2('ไม่อนุมัติ', () => decide({ id: meta.request_id, ext_name: meta.ext_name, nickname: meta.buyer }, false));
        no.classList.add('danger');
        acts.append(ok, no);
      }
      card.appendChild(acts);
    }
    return card;
  }

  function buildResultCard(m) {
    const meta = m.rmeta || {};
    const card = el('div', 'ext-msg ' + (meta.approved ? 'ext-ok' : 'ext-no'));
    card.appendChild(el('div', 'ext-msg-body', m.text || ''));
    if (meta.approved && !m.isMe) {
      const a = el('div', 'ext-msg-acts');
      const o = chip2('🧩 ไปที่ส่วนขยาย', () => openExtStore());
      o.className = 'chip primary';
      a.appendChild(o);
      card.appendChild(a);
    }
    return card;
  }

  // ---------- ข้อความจากส่วนขยาย (kind = 'ext') แสดงเป็นการ์ด ----------
  function upgradeExtMessages(root) {
    if (typeof findMessage !== 'function') return;
    root.querySelectorAll('.msg-row[data-id]:not([data-ext-done])').forEach(row => {
      row.dataset.extDone = '1';
      let m = null;
      try { m = findMessage(row.dataset.id); } catch (x) { m = null; }
      if (!m || m.kind !== 'ext') return;
      const meta = m.rmeta || {};
      if (meta.ext === 'purchase' || meta.ext === 'purchase_result') {
        let c;
        try { c = meta.ext === 'purchase' ? buildPurchaseCard(m) : buildResultCard(m); } catch (x) { console.error('ext card', x); return; }
        c.dataset.id = m.id;
        row.replaceWith(c);
        return;
      }
      const card = el('div', 'ext-msg ext-msg-' + (meta.type || 'info'));
      card.dataset.id = m.id;
      const head = el('div', 'ext-msg-head');
      const L = ledgerExt();
      head.appendChild(iconNode(L || { icon: '🏠' }, 'ext-mini-icon'));
      head.appendChild(el('strong', '', meta.ext === 'ledger' ? 'สมุดบ้าน' : 'ส่วนขยาย'));
      const tm = el('span', 'ext-msg-time', typeof fmtClock === 'function' ? fmtClock(m.ts) : '');
      head.appendChild(tm);
      card.appendChild(head);
      card.appendChild(el('div', 'ext-msg-body', String(m.text || '').replace(/^(🏠|📌) สมุดบ้าน: /, '$1 ')));
      if (meta.ext === 'ledger' && L && L.can_use) {
        const a = el('div', 'ext-msg-acts');
        const o = chip2('เปิดสมุดบ้าน', () => launch(L.id));
        o.className = 'chip primary';
        a.appendChild(o);
        card.appendChild(a);
      }
      row.replaceWith(card);
    });
  }

  function watchMessages() {
    const box = $('messages-container');
    if (!box || box.dataset.extWatch) return;
    box.dataset.extWatch = '1';
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => upgradeExtMessages(box), 0); }).observe(box, { childList: true, subtree: true });
    upgradeExtMessages(box);
  }

  // ---------- แอดมิน: เพิ่ม/แก้ไขส่วนขยาย ----------
  let editId = null;
  let editIcon = '';

  function openEditor(id) {
    if (!isAdmin()) return;
    const e = id ? byId(id) : null;
    editId = id;
    editIcon = e ? e.icon : '';
    ensureModal('ext-edit-modal', '');
    const body = $('ext-edit-modal-body');
    body.innerHTML = '';
    body.appendChild(el('h3', '', e ? 'แก้ไขส่วนขยาย' : 'เพิ่มส่วนขยาย'));

    const pick = el('button', 'ext-icon-pick');
    pick.type = 'button';
    pick.id = 'ext-icon-preview';
    pick.title = 'แตะเพื่อเลือกรูป';
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    file.onchange = () => pickIcon(file);
    pick.onclick = () => file.click();
    const ph = el('div', 'pf-head');
    ph.append(pick, file, el('span', 'hint', 'แตะเพื่อใส่รูปไอคอน (หรือพิมพ์อีโมจิในช่องด้านล่าง)'));
    body.appendChild(ph);
    renderIconPreview();

    const field = (label, node) => {
      const g = el('div', 'input-group');
      const l = el('label', '', label);
      g.append(l, node);
      body.appendChild(g);
      return node;
    };
    const mk = (tag, attrs) => { const n = document.createElement(tag); Object.assign(n, attrs); return n; };
    const emoji = field('อีโมจิแทนรูป (ไม่บังคับ)', mk('input', { id: 'ext-f-emoji', maxLength: 4, placeholder: 'เช่น 🍽', value: (e && !/^(https:|data:)/.test(e.icon)) ? e.icon : '' }));
    emoji.oninput = () => { if (emoji.value.trim()) { editIcon = emoji.value.trim(); renderIconPreview(); } };
    field('ชื่อส่วนขยาย', mk('input', { id: 'ext-f-name', maxLength: 40, value: e ? e.name : '', placeholder: 'เช่น สั่งอาหาร' }));
    field('ลิงก์ส่วนขยาย', mk('input', { id: 'ext-f-link', type: 'url', value: e ? e.link : '', placeholder: 'https://...' }));
    field('รายละเอียด (น้องโบ๊ะบ๊ะใช้อธิบายและแนะนำให้ลูกค้า)', mk('textarea', { id: 'ext-f-desc', rows: 3, maxLength: 600, value: e ? e.description : '' }));

    const seg = el('div', 'segmented');
    const bFree = el('button', '', 'ฟรี');
    const bPaid = el('button', '', 'เสียเงิน');
    [bFree, bPaid].forEach(b => { b.type = 'button'; });
    seg.append(bFree, bPaid);
    body.appendChild(seg);
    const paidBox = el('div', 'ext-paid-box');
    const price = mk('input', { id: 'ext-f-price', type: 'number', min: 0, max: 100000, inputMode: 'numeric', value: e ? e.price : 49 });
    const trial = mk('input', { id: 'ext-f-trial', type: 'number', min: 0, max: 365, inputMode: 'numeric', value: e ? e.trial_days : 30 });
    const g1 = el('div', 'input-group'); g1.append(el('label', '', 'ราคา (บาท) ซื้อครั้งเดียวใช้ได้ตลอด'), price);
    const g2 = el('div', 'input-group'); g2.append(el('label', '', 'ทดลองใช้ฟรี (วัน)'), trial);
    paidBox.append(g1, g2);
    body.appendChild(paidBox);
    let free = e ? e.is_free : false;
    const setFree = v => { free = v; bFree.classList.toggle('active', v); bPaid.classList.toggle('active', !v); paidBox.classList.toggle('hidden-element', v); };
    bFree.onclick = () => setFree(true);
    bPaid.onclick = () => setFree(false);
    setFree(free);

    // ชนิดส่วนขยาย: ลิงก์ทั่วไป / สมุดบ้าน (เชื่อมข้อมูลกับห้องแชทได้)
    let kind = (e && e.kind) || 'link';
    const kseg = el('div', 'segmented');
    const kLink = el('button', '', '🔗 ลิงก์ทั่วไป');
    const kLedger = el('button', '', '🏠 สมุดบ้าน (เชื่อมข้อมูล)');
    [kLink, kLedger].forEach(b => { b.type = 'button'; });
    kseg.append(kLink, kLedger);
    const kHint = el('span', 'hint', '');
    const setKind = v => { kind = v; kLink.classList.toggle('active', v === 'link'); kLedger.classList.toggle('active', v === 'ledger');
      kHint.textContent = v === 'ledger' ? 'ห้องที่เพิ่มส่วนขยายนี้ เชื่อมกับบ้านในสมุดบ้านได้: แจ้งเตือนเมื่อแก้ไข สรุป 20:00 และเตือนบิล' : 'กดไอคอนแล้วเปิดลิงก์'; };
    kLink.onclick = () => setKind('link');
    kLedger.onclick = () => setKind('ledger');
    setKind(kind);
    body.append(el('div', 'list-title', 'ชนิดส่วนขยาย'), kseg, kHint);

    let active = e ? e.active : true;
    const row = el('div', 'set-row');
    const lw = el('div');
    lw.append(el('strong', '', 'แสดงในร้าน'), el('span', 'hint', 'ปิด = ซ่อนจากผู้ใช้ (ข้อมูลและการซื้อยังอยู่)'));
    const sw = el('label', 'switch');
    const cb = mk('input', { type: 'checkbox', checked: active });
    cb.onchange = () => { active = cb.checked; };
    sw.append(cb, el('span', 'slider'));
    row.append(lw, sw);
    body.appendChild(row);

    const actions = el('div', 'modal-actions');
    if (e) {
      const del = actionBtn('ลบ', () => deleteExt(e), 'secondary-btn danger');
      actions.appendChild(del);
    }
    actions.appendChild(actionBtn('ยกเลิก', () => closeModal('ext-edit-modal')));
    const save = actionBtn('บันทึก', () => saveExt({ free, active, save, kind }), 'primary-btn');
    actions.appendChild(save);
    body.appendChild(actions);
    openModal('ext-edit-modal');
  }

  function renderIconPreview() {
    const p = $('ext-icon-preview');
    if (!p) return;
    p.innerHTML = '';
    p.appendChild(iconNode({ icon: editIcon }, 'ext-big-icon'));
  }

  // ย่อรูปเป็น 128x128 เก็บเป็นข้อมูลในตาราง (เหมือนรูปโปรไฟล์)
  function pickIcon(input) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (!(f.type || '').startsWith('image/')) return toast('เลือกได้เฉพาะไฟล์รูปภาพ', 'error');
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const S = 128;
      const c = document.createElement('canvas');
      c.width = S; c.height = S;
      const ctx = c.getContext('2d');
      const r = Math.max(S / img.width, S / img.height);
      const w = img.width * r, h = img.height * r;
      ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      URL.revokeObjectURL(url);
      editIcon = c.toDataURL('image/png');
      if (editIcon.length > 150000) editIcon = c.toDataURL('image/jpeg', 0.85);
      const em = $('ext-f-emoji');
      if (em) em.value = '';
      renderIconPreview();
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('เปิดรูปนี้ไม่ได้', 'error'); };
    img.src = url;
  }

  async function saveExt({ free, active, save, kind }) {
    const name = $('ext-f-name').value.trim();
    const link = $('ext-f-link').value.trim();
    const desc = $('ext-f-desc').value.trim();
    const price = parseInt($('ext-f-price').value, 10) || 0;
    const trial = Math.max(0, Math.min(365, parseInt($('ext-f-trial').value, 10) || 0));
    if (!name) return toast('ใส่ชื่อส่วนขยายก่อน', 'error');
    if (!/^https:\/\//i.test(link)) return toast('ลิงก์ต้องขึ้นต้นด้วย https://', 'error');
    if (!free && price <= 0) return toast('ส่วนขยายเสียเงินต้องตั้งราคามากกว่า 0', 'error');
    if (typeof setBusy === 'function') setBusy(save, true, 'กำลังบันทึก…');
    const { data: newId, error } = await sb.rpc('ext_admin_save', {
      p_id: editId, p_name: name, p_icon: editIcon || '🧩', p_link: link, p_description: desc,
      p_is_free: free, p_price: free ? 0 : price, p_trial_days: trial, p_active: active
    });
    if (!error && kind) {
      const { error: kErr } = await sb.rpc('ext_admin_set_kind', { p_id: newId || editId, p_kind: kind });
      if (kErr && kind === 'ledger') toast('บันทึกแล้ว แต่ตั้งชนิดสมุดบ้านไม่ได้: รัน supabase-ledger.sql ก่อน', 'error');
    }
    if (typeof setBusy === 'function') setBusy(save, false);
    if (error) return extErr(error);
    toast(editId ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มส่วนขยายแล้ว', 'success');
    closeModal('ext-edit-modal');
    await refreshAll();
  }

  async function deleteExt(e) {
    const ok = await confirmDialog('ลบส่วนขยาย', `ลบ ${e.name} ถาวร?\nสิทธิ์ที่ซื้อไปแล้วและไอคอนในทุกห้องจะหายไปด้วย ถ้าแค่อยากซ่อน ให้ปิด "แสดงในร้าน" แทน`, 'ลบถาวร', true);
    if (!ok) return;
    const { error } = await sb.rpc('ext_admin_delete', { p_id: e.id });
    if (error) return extErr(error);
    toast('ลบส่วนขยายแล้ว', 'info');
    closeModal('ext-edit-modal');
    await refreshAll();
  }

  // ---------- แอดมิน: คำขอซื้อ ----------
  async function loadAdminRequests() {
    const { data, error } = await sb.rpc('ext_admin_requests');
    EXT.adminReqs = error ? [] : (data || []);
  }

  function adminPayBlock() {
    const box = el('div', 'ext-admin');
    box.appendChild(el('div', 'list-title', '💳 วิธีชำระเงินที่ผู้ซื้อเห็นในการ์ด'));
    const ta = document.createElement('textarea');
    ta.className = 'plain-input ext-pay-text';
    ta.rows = 3;
    ta.maxLength = 1000;
    ta.placeholder = 'เช่น พร้อมเพย์ 08x-xxx-xxxx ชื่อบัญชี ... (ใช้ข้อความเดียวกับแพ็กเกจ)';
    const prev = el('div', 'ext-qr-prev');
    let qr = null;   // null = ไม่เปลี่ยน
    const showQr = src => { prev.innerHTML = ''; if (src) { const i = document.createElement('img'); i.src = src; i.className = 'ext-buy-qr'; prev.appendChild(i); } else prev.appendChild(el('span', 'hint', 'ยังไม่มีรูป QR')); };
    getPayInfo(true).then(info => { ta.value = info.text || ''; showQr(info.qr); });
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
    file.onchange = () => {
      const f = file.files && file.files[0]; file.value = '';
      if (!f) return;
      const url = URL.createObjectURL(f), img = new Image();
      img.onload = () => {
        const S = Math.min(700, Math.max(img.width, img.height)), r = S / Math.max(img.width, img.height);
        const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        qr = c.toDataURL('image/jpeg', 0.9);
        showQr(qr);
      };
      img.onerror = () => { URL.revokeObjectURL(url); toast('เปิดรูปนี้ไม่ได้', 'error'); };
      img.src = url;
    };
    const row = el('div', 'ext-acts');
    row.appendChild(chip2('🖼 เลือกรูป QR', () => file.click()));
    const rm = chip2('ลบรูป QR', () => { qr = ''; showQr(''); });
    rm.classList.add('danger');
    row.appendChild(rm);
    const save = chip2('💾 บันทึก', async () => {
      const { error: e1 } = await sb.rpc('admin_set_pay_info', { p_text: ta.value });
      if (e1) return extErr(e1);
      if (qr !== null) {
        const { error: e2 } = await sb.rpc('ext_admin_set_pay', { p_text: null, p_qr: qr });
        if (e2) return extErr(e2);
      }
      payInfoCache = null;
      toast('บันทึกวิธีชำระเงินแล้ว', 'success');
    });
    save.className = 'chip primary';
    row.appendChild(save);
    box.append(ta, prev, file, row);
    return box;
  }

  function adminBlock() {
    const box = el('div', 'ext-admin');
    box.appendChild(el('div', 'list-title', `🛠 คำขอซื้อส่วนขยายที่รออยู่ (${EXT.adminReqs.length})`));
    if (!EXT.adminReqs.length) box.appendChild(el('div', 'hint', 'ไม่มีคำขอที่รออยู่'));
    EXT.adminReqs.forEach(r => {
      const card = el('div', 'req-card');
      card.appendChild(el('strong', '', r.nickname || r.username || 'ผู้ใช้'));
      card.appendChild(el('div', 'hint', `${r.ext_name} · ฿${r.price} · ${fmtDate(r.created_at)}`));
      const acts = el('div', 'req-actions');
      acts.appendChild(chip2('คุยกับผู้ซื้อ (ดูสลิป)', () => { closeModal('ext-modal'); closeModal('settings-modal'); openChatById(r.user_id); }));
      const ok = chip2('✅ อนุมัติ (ตรวจสลิปแล้ว)', () => decide(r, true));
      ok.className = 'chip primary';
      acts.appendChild(ok);
      const no = chip2('ไม่อนุมัติ', () => decide(r, false));
      no.classList.add('danger');
      acts.appendChild(no);
      card.appendChild(acts);
      box.appendChild(card);
    });
    return box;
  }

  async function decide(r, approve) {
    const ok = await confirmDialog(approve ? 'อนุมัติคำขอซื้อ' : 'ไม่อนุมัติ',
      approve ? `เปิด ${r.ext_name} ให้ ${r.nickname || r.username} ใช้ได้ตลอด\nตรวจสลิปแล้วใช่ไหม?` : `ปฏิเสธคำขอซื้อ ${r.ext_name} ของ ${r.nickname || r.username}?`,
      approve ? 'อนุมัติ' : 'ไม่อนุมัติ', !approve);
    if (!ok) return;
    const { error } = await sb.rpc('ext_admin_decide', { p_request: r.id, p_approve: approve });
    if (error) return extErr(error);
    toast(approve ? 'อนุมัติแล้ว ผู้ซื้อใช้ส่วนขยายได้ทันที และได้ข้อความแจ้งในแชท' : 'ปฏิเสธคำขอแล้ว และแจ้งผู้ซื้อในแชทแล้ว', approve ? 'success' : 'info');
    await loadAdminRequests();
    if (isOpen('ext-modal')) renderStore();
  }

  // ---------- เรียลไทม์ ----------
  function subscribe() {
    if (EXT.channel) { try { sb.removeChannel(EXT.channel); } catch (x) { /* ไม่เป็นไร */ } }
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(refreshAll, 400); };
    EXT.channel = sb.channel('ext-' + currentUser.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_extensions' }, p => {
        const k = (p.new && p.new.room_key) || (p.old && p.old.room_key);
        if (!k || k === EXT.roomKey) loadRoom();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'extensions' }, later)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ext_licenses' }, p => {
        later();
        const n = p.new || {};
        if (p.eventType !== 'DELETE' && n.user_id === currentUser.id && n.kind === 'paid') {
          const e = byId(n.ext_id);
          toast(`🎉 แอดมินเปิดใช้งาน ${e ? e.name : 'ส่วนขยาย'} ให้แล้ว`, 'success');
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ext_purchases' }, async p => {
        if (isAdmin()) {
          if (p.eventType === 'INSERT') toast('🧩 มีคำขอซื้อส่วนขยายใหม่', 'alert');
          await loadAdminRequests();
        }
        later();
      })
      .subscribe();
  }

  // ---------- ต่อเข้ากับแอปเดิม (ห่อฟังก์ชันเดิม ไม่แก้ app.js) ----------
  function wrap(name, after) {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      const r = orig.apply(this, arguments);
      const run = () => { try { after.apply(this, arguments); } catch (x) { console.error('ext', name, x); } };
      if (r && typeof r.then === 'function') r.then(run, () => {});
      else run();
      return r;
    };
  }

  async function onEnter() {
    if (!currentUser) return;
    injectStatic();
    watchMessages();
    await loadCatalog();
    if (!EXT.ready) return;
    try { EXT.adminId = localStorage.getItem('darkchat_ext_admin') || null; } catch (x) { /* ไม่เป็นไร */ }
    subscribe();
    await loadRoom();
  }

  // ปุ่มเพิ่มเติมในหน้าจอเดิม
  function injectStatic() {
    const tools = document.querySelector('.bo-tools');
    if (tools && !$('bo-ext-btn')) {
      const b = el('button', 'chip', '🧩 ส่วนขยาย');
      b.type = 'button';
      b.id = 'bo-ext-btn';
      b.onclick = () => openExtStore(true);
      tools.appendChild(b);
    }
    const ag = $('set-admin-group');
    if (ag && !$('ext-admin-btn')) {
      const st = ag.querySelector('.stack') || ag;
      const b = actionBtn('🧩 จัดการส่วนขยาย: เพิ่ม · แก้ไข · คำขอซื้อ', () => { closeModal('settings-modal'); openExtStore(); });
      b.id = 'ext-admin-btn';
      st.appendChild(b);
    }
  }

  wrap('enterApp', onEnter);
  wrap('selectChat', () => { loadRoom(); });
  wrap('backToList', () => { EXT.roomKey = null; EXT.roomExt = []; renderHeaderIcons(); });

  // เมนู ⋮ ของห้อง: เพิ่มหมวด "ส่วนขยาย"
  wrap('openRoomMenu', () => {
    const c = activeChat;
    const box = $('room-menu-actions');
    if (!c || !box || !EXT.ready) return;
    const det = el('details', 'menu-group');
    det.open = true;
    det.appendChild(el('summary', '', '🧩 ส่วนขยาย'));
    const body = el('div', 'menu-group-body');
    const go = (label, fn, cls) => body.appendChild(actionBtn(label, () => { closeModal('room-menu'); fn(); }, cls || 'secondary-btn'));
    const inRoom = EXT.roomExt.map(byId).filter(Boolean);
    const usable = EXT.list.filter(e => e.active && e.can_use && !EXT.roomExt.includes(e.id));
    usable.forEach(e => go(`➕ เพิ่ม ${e.name} เข้าห้อง`, () => addToRoom(e.id)));
    if (inRoom.length) go(`จัดการส่วนขยายในห้อง (${inRoom.length})`, openRoomExtSheet);
    const L = ledgerExt();
    if (L && EXT.roomKey && /^(g|d):/.test(EXT.roomKey)) go(L.can_use ? '🏠 เชื่อมสมุดบ้านกับห้องนี้' : '🔒 เชื่อมสมุดบ้านกับห้องนี้ (ต้องซื้อหรือทดลองใช้)', linkLedger);
    go('🔔 ตั้งค่าแจ้งเตือนส่วนขยาย', openExtNotify);
    go(usable.length ? '🛒 ร้านส่วนขยาย (ซื้อเพิ่ม)' : '🛒 ร้านส่วนขยาย', () => openExtStore());
    det.appendChild(body);
    const closeBtn = box.lastElementChild;   // ปุ่ม "ปิด" อยู่ท้ายสุด
    box.insertBefore(det, closeBtn);
  });

  window.openExtStore = openExtStore;
  window.openRoomExtSheet = openRoomExtSheet;
  window.openExtNotify = openExtNotify;

  // เผื่อสคริปต์นี้โหลดหลังจากล็อกอินไปแล้ว
  if (typeof currentUser !== 'undefined' && currentUser) onEnter();
})();
