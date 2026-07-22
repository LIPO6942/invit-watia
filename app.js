'use strict';

/* ═══════════════════════════════════════════════════════════════════
   WEDDING INVITATION — app.js
   ─────────────────────────────────────────────────────────────────
   Modules:
   0. Firebase Init + URL Config Loader  ← reads ?inv= / ?b= / ?c=
   1. Envelope Open
   2. Intro Petals
   3. Heart Analog Clock
   4. Countdown Section Petals
   5. Countdown Timer
   6. Timeline Reveal (Intersection Observer)
   7. Leaflet Map Modal
   8. Audio Ambiance (Web Audio API)
═══════════════════════════════════════════════════════════════════ */

let _weddingDateTime = '2026-07-12T15:30:00';
let _currentRole = null; // 'groom' | 'bride' or null
let _roleWishes = [];
let _resolvedGuestName = null;
let _resolvedGuestType = null;

// Weather forecast params — updated from cfg when config loads
let _weatherLat = 35.6327;   // Teboulba default
let _weatherLon = 10.9418;
let _weatherDate = null;      // will be set from cfg.wd (YYYY-MM-DD)
let _weatherLocation = null;  // city name from first event

/* ──────────────────────────────────────────────
   Firebase config (shared with admin.html)
──────────────────────────────────────────────── */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAkG8p5RSk7HwmHGWB4Cf0EIEFYdICYSek",
  authDomain:        "invit-outia.firebaseapp.com",
  projectId:         "invit-outia",
  storageBucket:     "invit-outia.firebasestorage.app",
  messagingSenderId: "6331758985",
  appId:             "1:6331758985:web:a4e9154e3f99c3fb840958",
  measurementId:     "G-H23DLD87RM"
};

let _fbApp = null, _db = null;
function initFirebase() {
  if (_fbApp) return;
  _fbApp = firebase.initializeApp(FIREBASE_CONFIG);
  _db    = firebase.firestore();
}

/* ────────────────────────────────────────────────
   0. URL CONFIG LOADER
   Priority: ?inv= (Firebase slug) → ?b= (JSONBlob) → ?c= (base64)
──────────────────────────────────────────────── */

function fromB64(str) {
  return decodeURIComponent(
    Array.from(atob(str), c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  );
}

function applyConfigToDOM(cfg) {
  const groomDisplay = cfg.ga;
  const brideDisplay = cfg.ba;
  const envTitle = brideDisplay ? `وطية ${brideDisplay}` : 'وطية رانية';

  const MAP = {
    groomAr:          groomDisplay,
    brideAr:          brideDisplay,
    groomNameDisplay: groomDisplay,
    brideNameDisplay: brideDisplay,
    envHeaderTitle:   envTitle,
    groomFather: cfg.gf,
    groomMother: cfg.gm,
    brideFather: cfg.bf,
    brideMother: cfg.bm,
  };
  Object.entries(MAP).forEach(([key, val]) => {
    if (!val) return;
    document.querySelectorAll(`[data-cfg="${key}"]`).forEach(el => {
      el.textContent = val;
    });
  });

  // Always Arabic
  applyLanguage('ar');

  // Set page title dynamically (Watia: bride name only)
  if (brideDisplay) {
    document.title = `دعوة وطية - ${brideDisplay}`;
  }

  // Initialize Photo Stack Widget
  if (typeof initPhotoStack === 'function') {
    initPhotoStack(cfg);
  }
}

function checkRoleView() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'groom' || view === 'bride') {
    _currentRole = view;

    // Show the private mailbox button
    const mbToggle = document.getElementById('mailbox-toggle');
    if (mbToggle) mbToggle.style.display = 'flex';

    // Hide the guestbook — the couple cannot send wishes to themselves
    const gbSection = document.getElementById('guestbook-section');
    if (gbSection) gbSection.style.display = 'none';

    // Show the dedicated bride/groom inscription on the envelope
    const roleLabel = document.getElementById('role-inscription-banner');
    if (roleLabel) roleLabel.style.display = 'flex';
    // Text will be set after language is applied in applyLanguage()
    window._pendingRoleView = view;
  }
}

function processWishesForRole(dataWishes) {
  if (dataWishes && Array.isArray(dataWishes)) {
    const wishes = [...dataWishes];
    wishes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (_currentRole === 'groom') {
      _roleWishes = wishes.filter(w => w.target === 'groom' || w.target === 'both' || !w.target);
    } else if (_currentRole === 'bride') {
      _roleWishes = wishes.filter(w => w.target === 'bride' || w.target === 'both' || !w.target);
    }
    
    const badge = document.getElementById('mailbox-badge');
    if (badge) {
      badge.textContent = _roleWishes.length;
    }
  }
}

function loadConfigFromURL() {
  checkRoleView();
  const params  = new URLSearchParams(window.location.search);
  const invSlug = params.get('inv');   // Firebase personalized slug
  const blobId  = params.get('b');     // JSONBlob ID (legacy)
  let   encoded = params.get('c');     // base64 (legacy)

  if (invSlug) {
    /* ── Firebase path ── */
    initFirebase();
    watchRsvpCounter();
    _db.collection('invitations').doc(invSlug).get()
      .then(doc => {
        if (!doc.exists) {
          console.warn('[InvitApp] Invitation not found:', invSlug);
          return;
        }
        const data     = doc.data();
        const cfg      = data.config;
        const count    = data.count || 0;
        const pack     = data.pack  || 9999;

        /* Guest links (with ?guest= or ?gid=) get unlimited views — no pack check, no count increment */
        const hasGuestLink = !!(params.get('guest') || params.get('gid'));
        // Removed: pack limits the number of added guests, not public view clicks

        /* Process wishes for Groom/Bride private inbox */
        processWishesForRole(data.wishes);

        /* Apply config */
        if (cfg.wd) _weddingDateTime = cfg.wd;
        applyConfigToDOM(cfg);
        applyMusicFromConfig(cfg);
        if (cfg.ev && cfg.ev.length) rebuildTimelineFromConfig(cfg.ev);
        extractWeatherParamsFromConfig(cfg);
        loadWeatherForecast();
        
        // Apply theme color
        if (cfg.th && cfg.th !== 'gold') {
          document.body.classList.add('theme-' + cfg.th);
        }
        
        // Apply saved Day/Night mode preference
        const savedMode = localStorage.getItem('invitThemeMode');
        if (savedMode === 'night') {
          document.body.classList.add('night-mode');
        } else {
          document.body.classList.remove('night-mode');
        }

        applyEnvelopeDesign(cfg);

        /* Atomic counter increment — only for generic (non-guest-specific) links */
        if (!hasGuestLink) {
          _db.collection('invitations').doc(invSlug).update({
            count: firebase.firestore.FieldValue.increment(1)
          }).catch(e => console.warn('[InvitApp] Counter increment failed:', e));
        }
      })
      .catch(err => console.warn('[InvitApp] Firebase fetch failed:', err));

  } else if (blobId) {
    /* ── JSONBlob fallback ── */
    fetch(`https://jsonblob.com/api/jsonBlob/${blobId}`, { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : Promise.reject('blob 404'))
      .then(data => {
        const cfg   = data.config;
        const count = (data.count || 0) + 1;
        const pack  = data.pack || cfg.ps || 9999;
        // Removed count > pack check

        /* Process wishes for Groom/Bride private inbox */
        processWishesForRole(data.wishes);

        if (cfg.wd) _weddingDateTime = cfg.wd;
        applyConfigToDOM(cfg);
        if (cfg.ev && cfg.ev.length) rebuildTimelineFromConfig(cfg.ev);
        extractWeatherParamsFromConfig(cfg);
        loadWeatherForecast();

        if (cfg.th && cfg.th !== 'gold') document.body.classList.add('theme-' + cfg.th);
        applyEnvelopeDesign(cfg);
        fetch(`https://jsonblob.com/api/jsonBlob/${blobId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, count })
        }).catch(() => {});
      })
      .catch(e => console.warn('[InvitApp] JSONBlob fetch failed:', e));

  } else if (encoded) {
    /* ── Base64 fallback ── */
    encoded = encoded.replace(/ /g, '+');
    let cfg;
    try { cfg = JSON.parse(fromB64(encoded)); }
    catch (e) { console.warn('[InvitApp] base64 decode failed:', e); return; }
    if (cfg.wd) _weddingDateTime = cfg.wd;
    applyConfigToDOM(cfg);
    if (cfg.ev && cfg.ev.length) rebuildTimelineFromConfig(cfg.ev);
    extractWeatherParamsFromConfig(cfg);
    loadWeatherForecast();

    if (cfg.th && cfg.th !== 'gold') document.body.classList.add('theme-' + cfg.th);
    applyEnvelopeDesign(cfg);
    // Removed count-api check

  } else {
    // ── localStorage fallback (local testing) ──
    const raw = localStorage.getItem('watiaAdminConfig');
    if (raw) {
      try {
        const cfg = JSON.parse(raw);
        if (cfg.wd) _weddingDateTime = cfg.wd;
        applyConfigToDOM(cfg);
        if (cfg.ev && cfg.ev.length) rebuildTimelineFromConfig(cfg.ev);
        extractWeatherParamsFromConfig(cfg);
        loadWeatherForecast();

        
        // Apply theme color
        if (cfg.th && cfg.th !== 'gold') {
          document.body.classList.add('theme-' + cfg.th);
        }
        applyEnvelopeDesign(cfg);
      } catch (e) {}
    }
  }
}


/**
 * Rebuilds the #timeline div from the ev[] array in config.
 */
function getTimelineIcon(eventName) {
  const name = (eventName || '').toLowerCase();
  
  if (name.includes('عقد') || name.includes('💍') || name.includes('mariage') || name.includes('alliance') || name.includes('signature') || name.includes('ceremony')) {
    return `<svg class="timeline-custom-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="26" cy="38" r="14" />
      <circle cx="42" cy="28" r="14" />
      <path d="M42,10 C41,8 39,8 38,9 C37,10 37,12 39,14 L42,17 L45,14 C47,12 47,10 46,9 C45,8 43,8 42,10 Z" fill="#2c2c2c" stroke="#2c2c2c" stroke-width="1" />
    </svg>`;
  }
  
  if (name.includes('استقبال') || name.includes('ضيوف') || name.includes('reception') || name.includes('cocktail') || name.includes('سهرة') || name.includes('party') || name.includes('🏡') || name.includes('dinner') || name.includes('عشاء') || name.includes('مأدبة')) {
    return `<svg class="timeline-custom-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16,14 L48,14 L32,38 Z" />
      <line x1="32" y1="38" x2="32" y2="54" />
      <line x1="20" y1="54" x2="44" y2="54" />
      <circle cx="48" cy="14" r="6" fill="none" />
      <line x1="48" y1="8" x2="48" y2="20" />
      <line x1="42" y1="14" x2="54" y2="14" />
      <line x1="21" y1="22" x2="43" y2="22" />
    </svg>`;
  }
  
  if (name.includes('تصوير') || name.includes('جلسة') || name.includes('photo') || name.includes('camera') || name.includes('📷')) {
    return `<svg class="timeline-custom-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="10" y="20" width="44" height="30" rx="4" />
      <path d="M22,20 L24,14 L40,14 L42,20" />
      <circle cx="48" cy="26" r="2" fill="currentColor" />
      <circle cx="32" cy="35" r="10" />
      <circle cx="32" cy="35" r="5" />
    </svg>`;
  }
  
  // Fallback calendar
  return `<svg class="timeline-custom-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="12" y="14" width="40" height="40" rx="4" />
    <line x1="12" y1="24" x2="52" y2="24" />
    <line x1="22" y1="10" x2="22" y2="18" />
    <line x1="42" y1="10" x2="42" y2="18" />
  </svg>`;
}

function formatTo24h(timeStr, ampmStr) {
  if (!timeStr) return '';
  const ampm = (ampmStr || '').trim().toUpperCase();
  if (ampm !== 'AM' && ampm !== 'PM') {
    return timeStr;
  }
  const parts = timeStr.split(':');
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1] || '00';
  if (isNaN(hours)) return timeStr;
  if (ampm === 'PM' && hours < 12) {
    hours += 12;
  } else if (ampm === 'AM' && hours === 12) {
    hours = 0;
  }
  const hoursFormatted = hours.toString().padStart(2, '0');
  const minutesFormatted = minutes.toString().padStart(2, '0');
  return `${hoursFormatted}:${minutesFormatted}`;
}

function rebuildTimelineFromConfig(events) {
  const timeline = document.getElementById('timeline');
  if (!timeline) return;
  const pinLabel = 'الموقع';
  const pinIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  timeline.innerHTML = events.map((ev, i) => {
    const isEven  = i % 2 === 0;
    const evName  = ev.n || '';
    const iconHTML = getTimelineIcon(ev.n);
    const infoHTML = `
      <span class="tl-date">${ev.d||''}</span>
      <div class="tl-event font-amiri">${evName}</div>
      <div class="tl-location">${ev.l||''}</div>
      <div class="tl-time">${formatTo24h(ev.t, ev.a)}</div>
      <button class="tl-location-btn" onclick="openMap(this)">${pinIcon}<span>${pinLabel}</span></button>`;
    return `
      <div class="timeline-item"
           data-location="${ev.l||''}"
           data-lat="${ev.la||''}"
           data-lng="${ev.lo||""}">
        <div class="tl-left-cell">${isEven ? infoHTML : iconHTML}</div>
        <div class="tl-dot-wrapper"><div class="tl-dot"></div></div>
        <div class="tl-right-cell">${isEven ? iconHTML : infoHTML}</div>
      </div>`;
  }).join('');
  // Re-attach observers after rebuild
  initTimelineReveal();
}

/**
 * Pack expiry: hit CountAPI, show expired overlay if over limit.
 */
function checkAndIncrementPack(linkId, packSize) {
  fetch(`https://api.countapi.xyz/hit/wedding-inv-2026/link-${linkId}`)
    .then(r => r.json())
    .then(data => { if ((data.value || 0) > packSize) showPackExpired(); })
    .catch(() => {}); // fail-open
}

function showPackExpired() {
  const overlay = document.getElementById('pack-expired-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
  }
}

/* ────────────────────────────────────────────────
   1. ENVELOPE OPEN
──────────────────────────────────────────────── */
function startWeddingMusic() {
  const audio = document.getElementById('wedding-audio');
  const btn = document.getElementById('music-toggle');
  if (!audio) return;
  
  audio.volume = 0.4;
  audio.play().then(() => {
    if (btn) btn.classList.remove('paused');
  }).catch(err => {
    console.warn("Audio autoplay blocked or failed. User needs to toggle manually.", err);
    if (btn) btn.classList.add('paused');
  });
}

window.toggleMusic = function() {
  const audio = document.getElementById('wedding-audio');
  const btn = document.getElementById('music-toggle');
  if (!audio || !btn) return;
  
  if (audio.paused) {
    audio.play().then(() => {
      btn.classList.remove('paused');
    }).catch(e => {
      console.warn("Failed to play audio:", e);
    });
  } else {
    audio.pause();
    btn.classList.add('paused');
  }
};

window.openEnvelopeNow = function() {
  const inv = document.getElementById('invitation');
  if (!inv || inv.classList.contains('open')) return;

  // 1. Start the panel slide immediately (2.4s theatrical animation)
  document.body.classList.add('env-open');

  // 2. Delay revealing the content until panels are well into opening
  //    (~1.3s in: panels are ~54% open, no blank white space visible)
  setTimeout(() => {
    inv.classList.add('open');
  }, 1300);

  // Play the actual wedding march MP3 song
  startWeddingMusic();

  setTimeout(() => {
    spawnPetals();
    startHeartClock();
  }, 900);
};

// Secret admin shortcut: triple-tap the closing section to go to admin
(function secretAdminTap() {
  let tapCount = 0, tapTimer = null;
  document.addEventListener('click', e => {
    const closing = document.getElementById('closing-section');
    if (closing && closing.contains(e.target)) {
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 1800);
      if (tapCount >= 5) {
        window.location.href = 'admin.html';
      }
    }
  });
})();

/* ────────────────────────────────────────────────
   2. INTRO PETALS (Hero section)
──────────────────────────────────────────────── */
function spawnPetals() {
  const layer = document.getElementById('petals');
  if (!layer) return;
  layer.innerHTML = ''; // Reset container

  const starSymbols = ['✦', '✧', '★', '•', '❖', '·', '✦'];
  const goldColors  = [
    '#ffe58f', '#d4af37', '#ffd700', '#fff8d0',
    '#f5e6c0', '#c9930c', '#ffffff', '#e8dec9'
  ];

  // Spawn 32 Golden Stardust & Sparkle particles
  for (let i = 0; i < 32; i++) {
    const p = document.createElement('div');
    const isStar = Math.random() > 0.35;
    
    const symbol   = starSymbols[Math.floor(Math.random() * starSymbols.length)];
    const color    = goldColors[Math.floor(Math.random() * goldColors.length)];
    const size     = isStar ? (Math.random() * 12 + 10) : (Math.random() * 8 + 4);
    const duration = Math.random() * 8 + 7; // 7s to 15s
    const delay    = Math.random() * 10;
    const driftX   = (Math.random() - 0.5) * 90;

    if (isStar) {
      p.className = 'stardust-star';
      p.textContent = symbol;
      p.style.cssText = [
        `position: absolute`,
        `left: ${Math.random() * 100}%`,
        `font-size: ${size}px`,
        `color: ${color}`,
        `text-shadow: 0 0 10px ${color}, 0 0 20px #ffd700`,
        `animation: stardustRise ${duration}s ease-in-out infinite ${delay}s`,
        `--drift-x: ${driftX}px`,
        `pointer-events: none`,
        `will-change: transform, opacity`
      ].join(';');
    } else {
      p.className = 'petal';
      const r = Math.floor(Math.random() * 50);
      p.style.cssText = [
        `position: absolute`,
        `left: ${Math.random() * 100}%`,
        `width: ${size}px`,
        `height: ${size}px`,
        `background: ${color}`,
        `border-radius: ${r}%`,
        `box-shadow: 0 0 8px ${color}, 0 0 16px rgba(255,215,0,0.8)`,
        `animation: stardustRise ${duration}s ease-in-out infinite ${delay}s`,
        `--drift-x: ${driftX}px`,
        `pointer-events: none`,
        `will-change: transform, opacity`
      ].join(';');
    }
    layer.appendChild(p);
  }
}

/* ────────────────────────────────────────────────
   3. HEART ANALOG CLOCK
──────────────────────────────────────────────── */
function startHeartClock() {
  const cx = 130, cy = 122, r = 64;
  const tickG = document.getElementById('hcTicks');
  const dotG  = document.getElementById('hcDots');
  if (!tickG || !dotG) return;

  // Build 60 tick marks
  for (let i = 0; i < 60; i++) {
    const ang    = (i / 60) * 2 * Math.PI - Math.PI / 2;
    const isHour = i % 5 === 0;
    const r1     = isHour ? r - 11 : r - 6;
    const x1 = cx + r * Math.cos(ang),  y1 = cy + r * Math.sin(ang);
    const x2 = cx + r1 * Math.cos(ang), y2 = cy + r1 * Math.sin(ang);
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', x1.toFixed(2)); ln.setAttribute('y1', y1.toFixed(2));
    ln.setAttribute('x2', x2.toFixed(2)); ln.setAttribute('y2', y2.toFixed(2));
    ln.setAttribute('stroke-width', isHour ? '2.2' : '1');
    ln.setAttribute('opacity',      isHour ? '1'   : '0.4');
    tickG.appendChild(ln);
  }

  // Build 12 hour dots
  for (let j = 0; j < 12; j++) {
    const ang = (j / 12) * 2 * Math.PI - Math.PI / 2;
    const rd  = r - 20;
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', (cx + rd * Math.cos(ang)).toFixed(2));
    dot.setAttribute('cy', (cy + rd * Math.sin(ang)).toFixed(2));
    dot.setAttribute('r',  '2.8');
    dot.setAttribute('fill', '#c9a84c');
    dotG.appendChild(dot);
  }

  function rotateHand(id, deg) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('transform', `rotate(${deg} ${cx} ${cy})`);
  }

  function setLive() {
    const now = new Date();
    const ms  = now.getMilliseconds();
    const s   = now.getSeconds()  + ms / 1000;
    const m   = now.getMinutes()  + s  / 60;
    const h   = (now.getHours() % 12) + m / 60;
    rotateHand('hcSHand', s * 6);
    rotateHand('hcMHand', m * 6);
    rotateHand('hcHHand', h * 30);
  }

  // Smooth entry sweep
  const now = new Date();
  const ms  = now.getMilliseconds();
  const s   = now.getSeconds()  + ms / 1000;
  const m   = now.getMinutes()  + s  / 60;
  const h   = (now.getHours() % 12) + m / 60;
  const tS  = s * 6, tM = m * 6, tH = h * 30;
  const dur = 1800, t0 = performance.now();

  (function sweep(ts) {
    const progress = Math.min((ts - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    rotateHand('hcSHand', ease * tS);
    rotateHand('hcMHand', ease * tM);
    rotateHand('hcHHand', ease * tH);
    if (progress < 1) requestAnimationFrame(sweep);
    else setInterval(setLive, 50);
  })(t0);

  // Trigger on scroll into view (for when envelope was already open)
  const sec = document.getElementById('countdown-section');
  if (sec) {
    new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) startHeartClock._started || (startHeartClock._started = true);
    }, { threshold: 0.3 }).observe(sec);
  }
}
startHeartClock._started = false;

/* ────────────────────────────────────────────────
   4. COUNTDOWN SECTION PETALS
──────────────────────────────────────────────── */
(function spawnCountdownPetals() {
  const container = document.getElementById('cdPetals');
  const section   = document.getElementById('countdown-section');
  if (!container || !section) return;
  const colors  = ['#c9a84c','#e8cc7a','#f5e6c0','#d4a96a','#fff8ee','#b8973a'];
  let   spawned = false;

  new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !spawned) {
      spawned = true;
      for (let i = 0; i < 26; i++) {
        const p  = document.createElement('div');
        p.className = 'cd-petal';
        const sz = 6 + Math.random() * 9;
        const r1 = Math.floor(Math.random() * 30 + 40);
        const r2 = Math.floor(Math.random() * 30 + 40);
        p.style.cssText = [
          `width:${sz}px`,
          `height:${sz * 1.5}px`,
          `left:${Math.random() * 100}%`,
          `top:-5%`,
          `background:${colors[Math.floor(Math.random() * colors.length)]}`,
          `animation-duration:${6 + Math.random() * 8}s`,
          `animation-delay:${Math.random() * 8}s`,
          `border-radius:${r1}% 0 ${r2}% 0`,
        ].join(';');
        container.appendChild(p);
      }
    }
  }, { threshold: 0.1 }).observe(section);
})();

/* ────────────────────────────────────────────────
   5. COUNTDOWN TIMER — Slot Machine
   Uses _weddingDateTime (overridden by URL config)
──────────────────────────────────────────────── */
(function initCountdown() {
  function getTargetDate() { return new Date(_weddingDateTime); }
  function pad(n) { return String(Math.max(0, n)).padStart(2, '0'); }

  const slots = {
    d: document.getElementById('cd-days'),
    h: document.getElementById('cd-hours'),
    m: document.getElementById('cd-mins'),
    s: document.getElementById('cd-secs'),
  };
  const prev = { d: null, h: null, m: null, s: null };

  /**
   * Slot-machine animation: number glides up & blurs out,
   * then snaps to bottom and glides smoothly back to center.
   * The text is swapped while the element is invisible (middle of keyframe).
   */
  function slotUpdate(el, newStr) {
    if (!el || el.textContent === newStr) return;
    // Swap text at the invisible midpoint (38% through the 0.52s animation = ~197ms)
    setTimeout(() => { el.textContent = newStr; }, 200);
    el.classList.remove('ticking');
    void el.offsetWidth; // force reflow to restart
    el.classList.add('ticking');
    el.addEventListener('animationend', () => el.classList.remove('ticking'), { once: true });
  }

  function tick() {
    const diff = Math.max(0, getTargetDate().getTime() - Date.now());
    const vals = {
      d: Math.floor(diff / 86400000),
      h: Math.floor((diff % 86400000) / 3600000),
      m: Math.floor((diff % 3600000)  / 60000),
      s: Math.floor((diff % 60000)    / 1000),
    };
    Object.keys(slots).forEach(k => {
      const str = pad(vals[k]);
      if (prev[k] !== str) {
        slotUpdate(slots[k], str);
        prev[k] = str;
      }
    });
  }

  // Init: display immediately without animation
  (function initDisplay() {
    const diff = Math.max(0, getTargetDate().getTime() - Date.now());
    const vals = {
      d: Math.floor(diff / 86400000),
      h: Math.floor((diff % 86400000) / 3600000),
      m: Math.floor((diff % 3600000)  / 60000),
      s: Math.floor((diff % 60000)    / 1000),
    };
    Object.keys(slots).forEach(k => {
      const str = pad(vals[k]);
      if (slots[k]) slots[k].textContent = str;
      prev[k] = str;
    });
  })();

  setInterval(tick, 1000);
})();

/* ────────────────────────────────────────────────
   5b. CLOCK TICKING SOUND (Web Audio API)
   Plays a soft mechanical tick every second only when the
   countdown section is visible. Runs independently of the
   background wedding music (separate AudioContext).
──────────────────────────────────────────────── */
(function initClockTick() {
  const section = document.getElementById('countdown-section');
  if (!section) return;

  let tickCtx    = null; // AudioContext created on first user gesture
  let tickTimer  = null; // setInterval handle
  let isVisible  = false;

  /** Synthesize a short mechanical click using Web Audio API */
  function playTick() {
    if (!tickCtx) return;
    try {
      // Brief band-pass filtered noise burst = clock tick
      const bufSize = tickCtx.sampleRate * 0.025; // 25ms
      const buffer  = tickCtx.createBuffer(1, bufSize, tickCtx.sampleRate);
      const data    = buffer.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        // White noise, decaying exponentially
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 6);
      }

      const source  = tickCtx.createBufferSource();
      source.buffer = buffer;

      // Band-pass filter: 1800Hz center → crisp mechanical click
      const bpf = tickCtx.createBiquadFilter();
      bpf.type            = 'bandpass';
      bpf.frequency.value = 1800;
      bpf.Q.value         = 0.9;

      // Gain: subtle — won't overpower the music
      const gainNode = tickCtx.createGain();
      gainNode.gain.value = 0.18;

      source.connect(bpf);
      bpf.connect(gainNode);
      gainNode.connect(tickCtx.destination);
      source.start();
    } catch (e) { /* silent fail */ }
  }

  function startTicking() {
    if (tickTimer) return;
    // Create AudioContext only after a user gesture (autoplay policy)
    if (!tickCtx) {
      try { tickCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    }
    if (tickCtx.state === 'suspended') tickCtx.resume();
    playTick(); // immediate first tick
    tickTimer = setInterval(playTick, 1000);
  }

  function stopTicking() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (tickCtx && tickCtx.state === 'running') tickCtx.suspend();
  }

  // Watch visibility of the countdown section
  new IntersectionObserver(entries => {
    isVisible = entries[0].isIntersecting;
    if (isVisible) startTicking();
    else           stopTicking();
  }, { threshold: 0.3 }).observe(section);

  // If the user hasn't interacted yet, wait for the first interaction
  // (required by browser autoplay policy)
  function onFirstInteraction() {
    if (isVisible && !tickCtx) startTicking();
    document.removeEventListener('click',      onFirstInteraction);
    document.removeEventListener('touchstart', onFirstInteraction);
  }
  document.addEventListener('click',      onFirstInteraction, { once: true });
  document.addEventListener('touchstart', onFirstInteraction, { once: true });
})();

/* ────────────────────────────────────────────────
   6. TIMELINE REVEAL (Intersection Observer)
──────────────────────────────────────────────── */
function initTimelineReveal() {
  const items = document.querySelectorAll('.timeline-item');
  items.forEach(item => {
    new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) entries[0].target.classList.add('visible');
    }, { threshold: 0.18 }).observe(item);
  });
}



/* ────────────────────────────────────────────────
   7. LEAFLET MAP MODAL
──────────────────────────────────────────────── */
let leafMap = null, leafMarker = null;
let currentLat = null, currentLng = null;

window.openMap = function(btn) {
  const item      = btn.closest('.timeline-item');
  const addr      = item.dataset.location || '';
  const lat       = item.dataset.lat;
  const lng       = item.dataset.lng;
  const eventName = item.querySelector('.tl-event')?.textContent || 'الموقع';

  currentLat = lat ? parseFloat(lat) : null;
  currentLng = lng ? parseFloat(lng) : null;

  document.getElementById('modal-event-title').textContent = eventName;
  document.getElementById('modal-address').textContent     = addr;

  const modal = document.getElementById('map-modal');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (!currentLat || !currentLng) return;

  setTimeout(() => {
    const mapEl = document.getElementById('leaflet-map');
    if (!leafMap) {
      leafMap = L.map('leaflet-map', { zoomControl: true, scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19,
      }).addTo(leafMap);
    }
    leafMap.setView([currentLat, currentLng], 17);
    if (leafMarker) leafMap.removeLayer(leafMarker);
    const icon = L.divIcon({
      html: '<div style="font-size:32px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">📍</div>',
      className: '', iconSize: [32, 32], iconAnchor: [16, 32],
    });
    leafMarker = L.marker([currentLat, currentLng], { icon }).addTo(leafMap);
    leafMarker.bindPopup(`<strong>${eventName}</strong><br><small>${addr}</small>`).openPopup();
    leafMap.invalidateSize();
  }, 160);
};

window.closeMap = function() {
  document.getElementById('map-modal').classList.remove('open');
  document.body.style.overflow = '';
};

window.openInMaps = function() {
  if (currentLat && currentLng) {
    window.open(`https://maps.google.com/?q=${currentLat},${currentLng}`, '_blank');
  }
};

// Swipe-down to close map sheet
(function() {
  const sheet = document.querySelector('.map-sheet');
  if (!sheet) return;
  let startY = 0;
  sheet.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchend', e => {
    if (e.changedTouches[0].clientY - startY > 80) window.closeMap();
  }, { passive: true });
})();

/* ────────────────────────────────────────────────
   8. WEB AUDIO AMBIANCE
──────────────────────────────────────────────── */
let audioCtx = null;

function playCrackSound() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // White noise burst (wax crack simulation)
    const buf  = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.4, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.5) * 0.5;
    }
    const src  = audioCtx.createBufferSource();
    src.buffer = buf;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.3;
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.start();
    setTimeout(startAmbience, 600);
  } catch (e) {
    // Graceful degradation
  }
}

function startAmbience() {
  if (!audioCtx) return;
  const chords = [
    [261.63, 329.63, 392,    493.88],  // Cmaj9
    [220,    261.63, 329.63, 392   ],  // Am9
    [174.61, 220,    261.63, 349.23],  // Fmaj7
    [196,    246.94, 293.66, 369.99],  // Gadd4
  ];
  let idx = 0;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1400;
  filter.connect(audioCtx.destination);

  function playChord() {
    chords[idx++ % chords.length].forEach(freq => {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.04, audioCtx.currentTime + 1.5);
      gain.gain.linearRampToValueAtTime(0,    audioCtx.currentTime + 4.5);
      osc.connect(gain);
      gain.connect(filter);
      osc.start();
      osc.stop(audioCtx.currentTime + 5);
    });
    setTimeout(playChord, 5000);
  }
  playChord();
}

// Resume audio after browser autoplay policy blocks
document.addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}, { once: false });

/* ────────────────────────────────────────────────
   3D TILT EFFECT ON ENVELOPE
   ──────────────────────────────────────────────── */
function init3DTilt() {
  // Disabled to keep envelope static/fixed and prevent rendering bugs on mobile screens
}

/* ────────────────────────────────────────────────
   GUESTBOOK / WISHES SYSTEM
   ──────────────────────────────────────────────── */
window.submitWish = function() {
  const nameInput = document.getElementById('gb-name');
  const messageInput = document.getElementById('gb-message');
  const recipientSelect = document.getElementById('gb-recipient');
  const rsvpSelect = document.getElementById('gb-rsvp');
  if (!nameInput || !messageInput) return;

  const name = nameInput.value.trim();
  const msg = messageInput.value.trim();
  const recipient = recipientSelect ? recipientSelect.value : 'both';
  
  if (rsvpSelect && rsvpSelect.value === "") {
    alert('الرجاء تحديد تأكيد الحضور الخاص بك 🌹');
    return;
  }
  
  if (!name || (!msg && !window._recordedVoiceData)) {
    alert('الرجاء كتابة الاسم أو تسجيل رسالة صوتية وتأكيد الحضور 🌹');
    return;
  }

  let rsvpVal = rsvpSelect ? rsvpSelect.value : '';
  let guestCount = 0;
  if (rsvpSelect) {
    const selectedOpt = rsvpSelect.options[rsvpSelect.selectedIndex];
    if (selectedOpt) {
      guestCount = Number(selectedOpt.getAttribute('data-count') || 0);
    }
  }
  const isConfirmed = rsvpVal !== '' && rsvpVal !== 'sorry_0';

  const params = new URLSearchParams(window.location.search);
  const invSlug = params.get('inv');

  const wishPayload = {
    name: name,
    message: msg || (window._recordedVoiceData ? '🎤 [رسالة صوتية]' : ''),
    target: recipient,
    timestamp: new Date().toISOString()
  };
  if (window._recordedVoiceData) {
    wishPayload.audioData = window._recordedVoiceData;
    wishPayload.voice = window._recordedVoiceData;
  }

  if (!invSlug) {
    // Local preview fallback
    allWishes.unshift(wishPayload);
    renderWishesScroller();
    nameInput.value = '';
    messageInput.value = '';
    if (rsvpSelect) rsvpSelect.value = '';
    if (window.resetVoiceRecording) window.resetVoiceRecording();
    alert('تم إرسال ردك بنجاح (معاينة محلية) ✨');
    return;
  }

  initFirebase();
  
  const gidRaw = params.get('gid') || params.get('guest');
  const guestKey = gidRaw || ('anon_' + Math.random().toString(36).substr(2, 9));

  const newWish = {
    name: name,
    message: msg || (window._recordedVoiceData ? '🎤 [رسالة صوتية]' : ''),
    target: recipient,
    timestamp: new Date().toISOString()
  };
  if (window._recordedVoiceData) {
    newWish.audioData = window._recordedVoiceData;
    newWish.voice = window._recordedVoiceData;
  }

  const updateData = {
    wishes: firebase.firestore.FieldValue.arrayUnion(newWish)
  };

  updateData["rsvps." + guestKey] = {
    confirmed: isConfirmed,
    count: guestCount,
    name: name,
    timestamp: new Date().toISOString()
  };

  updateData.rsvpConfirmed = isConfirmed;
  updateData.rsvpCount = guestCount;
  updateData.rsvpGuestName = name;

  _db.collection('invitations').doc(invSlug).update(updateData)
  .then(() => {
    nameInput.value = '';
    messageInput.value = '';
    if (rsvpSelect) rsvpSelect.value = '';
    if (window.resetVoiceRecording) window.resetVoiceRecording();
    alert('شكراً لك! تم إرسال ردك وتأكيد حضورك ✨');
    
    // Add real-time update to _roleWishes if this wish matches the current role view
    if (_currentRole === 'groom' && (recipient === 'groom' || recipient === 'both')) {
      _roleWishes.unshift(newWish);
    } else if (_currentRole === 'bride' && (recipient === 'bride' || recipient === 'both')) {
      _roleWishes.unshift(newWish);
    }
    const badge = document.getElementById('mailbox-badge');
    if (badge) badge.textContent = _roleWishes.length;

    loadAllWishes();
  })
  .catch(err => {
    console.error('Failed to submit wish:', err);
    alert('عذراً، حدث خطأ أثناء إرسال التهنئة. الرجاء المحاولة مرة أخرى.');
  });
};

window.openWishesWall = function() {
  const overlay = document.getElementById('wishes-wall-overlay');
  const titleEl = document.getElementById('wishes-wall-title');
  const subtitleEl = document.getElementById('wishes-wall-subtitle');
  const listEl = document.getElementById('wishes-wall-list');
  if (!overlay || !listEl) return;

  overlay.style.display = 'flex';

  if (titleEl) {
    titleEl.textContent = _currentRole === 'groom' ? 'صندوق تهاني العريس 🤵' : 'صندوق تهاني العروسة 👰';
  }
  if (subtitleEl) {
    subtitleEl.textContent = `${_roleWishes.length} رسالة وصلت إليك من ضيوفك`;
  }

  if (_roleWishes.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center;color:var(--brown-light);padding:40px 20px;font-style:italic;direction:rtl;">
        <div style="font-size:2.5rem;margin-bottom:10px;">💌</div>
        <div style="font-size:1rem;color:var(--brown-mid);">لا توجد رسائل موجهة لك بعد</div>
        <div style="font-size:0.8rem;color:var(--brown-light);margin-top:6px;">سيُبلَّغك حين يرسل ضيفك تهنئته</div>
      </div>`;
    return;
  }

  listEl.innerHTML = _roleWishes.map((w, idx) => {
    const dateStr = w.timestamp ? new Date(w.timestamp).toLocaleString('ar-TN') : '';
    const hasText  = w.message && w.message.trim() !== '';
    const hasAudio = w.audioData && w.audioData.trim() !== '';

    const textBlock = hasText ? `
      <div class="wishes-wall-msg" style="margin-bottom:${hasAudio ? '10px' : '0'};white-space:pre-wrap;">"${w.message}"</div>
    ` : '';

    const audioBlock = hasAudio ? `
      <div class="wishes-wall-audio-block">
        <div style="display:flex;align-items:center;gap:8px;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.25);border-radius:12px;padding:8px 12px;">
          <span style="font-size:1.2rem;">🎙️</span>
          <div style="flex:1;">
            <div style="font-size:0.72rem;color:var(--brown-light);margin-bottom:4px;">رسالة صوتية</div>
            <audio controls style="width:100%;height:28px;border-radius:6px;accent-color:var(--gold);"
                   src="${w.audioData}" preload="none">
            </audio>
          </div>
        </div>
      </div>
    ` : '';

    return `
      <div class="wishes-wall-card" style="animation-delay:${idx * 0.06}s">
        <div class="wishes-wall-guest">
          <span>👤 ${w.name}</span>
          <span style="font-size:0.7rem;background:rgba(201,168,76,0.15);color:var(--brown);padding:2px 8px;border-radius:10px;white-space:nowrap;">
            ${hasAudio && hasText ? '💌🎙️ نص + صوت' : hasAudio ? '🎙️ رسالة صوتية' : '💌 رسالة نصية'}
          </span>
        </div>
        ${textBlock}
        ${audioBlock}
        <div class="wishes-wall-date">📅 ${dateStr}</div>
      </div>
    `;
  }).join('');
};

window.closeWishesWall = function() {
  const overlay = document.getElementById('wishes-wall-overlay');
  if (overlay) overlay.style.display = 'none';
};

/* 🎙️ Voice Recording Functions (MediaRecorder API with 30s limit) */
window._recordedVoiceData = null;
let _mediaRecorder = null;
let _audioChunks = [];
let _voiceTimerInterval = null;
let _voiceSeconds = 0;

window.handleVoiceFileSelect = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onloadend = () => {
    window._recordedVoiceData = reader.result;
    const preview = document.getElementById('voiceAudioPreview');
    if (preview) preview.src = reader.result;
    document.getElementById('voiceControlsInitial').style.display = 'none';
    document.getElementById('voiceControlsActive').style.display = 'none';
    document.getElementById('voicePreviewBox').style.display = 'block';
  };
  reader.readAsDataURL(file);
};

window.startVoiceRecording = async function() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const fileInput = document.getElementById('voiceFileInput');
      if (fileInput) {
        fileInput.click();
      } else {
        alert('عذراً، متصفحك لا يدعم تسجيل الصوت.');
      }
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _audioChunks = [];
    _mediaRecorder = new MediaRecorder(stream);

    _mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) _audioChunks.push(e.data);
    };

    _mediaRecorder.onstop = () => {
      const audioBlob = new Blob(_audioChunks, { type: _mediaRecorder.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = () => {
        window._recordedVoiceData = reader.result;
        const preview = document.getElementById('voiceAudioPreview');
        if (preview) preview.src = reader.result;
        document.getElementById('voiceControlsActive').style.display = 'none';
        document.getElementById('voicePreviewBox').style.display = 'block';
      };
      reader.readAsDataURL(audioBlob);
      stream.getTracks().forEach(track => track.stop());
    };

    _mediaRecorder.start();

    document.getElementById('voiceControlsInitial').style.display = 'none';
    document.getElementById('voiceControlsActive').style.display = 'block';
    document.getElementById('voicePreviewBox').style.display = 'none';

    _voiceSeconds = 0;
    const timerEl = document.getElementById('voiceTimer');
    if (timerEl) timerEl.textContent = '00:00 / 00:30';

    clearInterval(_voiceTimerInterval);
    _voiceTimerInterval = setInterval(() => {
      _voiceSeconds++;
      const secs = _voiceSeconds < 10 ? '0' + _voiceSeconds : _voiceSeconds;
      if (timerEl) timerEl.textContent = `00:${secs} / 00:30`;

      if (_voiceSeconds >= 30) {
        window.stopVoiceRecording();
      }
    }, 1000);

  } catch (err) {
    console.error('Error accessing microphone:', err);
    alert('تعذر الوصول إلى الميكروفون. يرجى السماح بالإذن لتسجيل الرسالة الصوتية.');
  }
};

window.stopVoiceRecording = function() {
  clearInterval(_voiceTimerInterval);
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    _mediaRecorder.stop();
  }
};

window.resetVoiceRecording = function() {
  clearInterval(_voiceTimerInterval);
  window._recordedVoiceData = null;
  _audioChunks = [];
  const preview = document.getElementById('voiceAudioPreview');
  if (preview) preview.src = '';
  document.getElementById('voiceControlsInitial').style.display = 'block';
  document.getElementById('voiceControlsActive').style.display = 'none';
  document.getElementById('voicePreviewBox').style.display = 'none';
  const timerEl = document.getElementById('voiceTimer');
  if (timerEl) timerEl.textContent = '00:00 / 00:30';
};

let allWishes = [];
let wishesInterval = null;

function loadAllWishes() {
  initFirebase();
  _db.collection('invitations').get()
    .then(snapshot => {
      let wishes = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (doc.id !== 'settings' && data.wishes && Array.isArray(data.wishes)) {
          data.wishes.forEach(w => {
            wishes.push(w);
          });
        }
      });

      // Sort by date descending
      wishes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      allWishes = wishes;
      renderWishesScroller();
    })
    .catch(err => console.error('Failed to load wishes:', err));
}

function renderWishesScroller() {
  const scroller = document.getElementById('wishes-scroller');
  if (!scroller) return;

  if (allWishes.length === 0) {
    scroller.innerHTML = `<div style="padding: 20px; font-style: italic; color: var(--brown-light); text-align: center;">كن أول من يكتب تهنئة للعروسين 🌹</div>`;
    return;
  }

  scroller.innerHTML = allWishes.map(w => `
    <div class="wish-item">
      <div style="font-weight: bold; color: var(--brown); font-size: 0.95rem; margin-bottom: 4px;">👤 ${w.name}</div>
      <div style="color: var(--brown-mid); font-size: 0.85rem; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">"${w.message}"</div>
    </div>
  `).join('');

  clearInterval(wishesInterval);
  if (allWishes.length <= 1) return;

  let index = 0;
  wishesInterval = setInterval(() => {
    index = (index + 1) % allWishes.length;
    scroller.style.top = `-${index * 132}px`;
  }, 4000);
}

/* ────────────────────────────────────────────────
   BOOTSTRAP — runs once DOM is ready
   ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // 1. Read URL config and apply to DOM (names, dates, events)
  loadConfigFromURL();

  // 2. Init timeline reveal for default (non-config) items
  initTimelineReveal();

  // 3. Init 3D Tilt Effect on envelope
  init3DTilt();

  // 4. Load Guestbook wishes
  loadAllWishes();

  // 5. Apply nominative guest name if present in URL
  readAndApplyGuestParam();

  // 6. Load premium weather forecast widget
  loadWeatherForecast();
});

/* ────────────────────────────────────────────────
   ENVELOPE DESIGN — applies motif & seal from config
   ──────────────────────────────────────────────── */
let _sealApplied = false; // Flag to prevent seal from being changed multiple times

function applyEnvelopeDesign(cfg) {
  if (!cfg) return;

  // ── Motif (ep: 'floral' | 'vintage' | 'minimalist' | 'nature' | 'arabesque' | 'zellige' | 'door' | 'calligraphy') ──
  const pattern        = cfg.ep || 'vintage';
  const showFloral     = pattern === 'floral';
  const showVintage    = pattern === 'vintage';
  const showMinimalist = pattern === 'minimalist';
  const showNature     = pattern === 'nature';
  const showArabesque  = pattern === 'arabesque';
  const showZellige    = pattern === 'zellige' || pattern === 'crown';
  const showDoor       = pattern === 'door' || pattern === 'porte';
  const showCalligraphy = pattern === 'calligraphy';
  const showAmazigh    = pattern === 'amazigh';

  document.querySelectorAll('.panel-branches').forEach(el => {
    el.style.display = showFloral ? '' : 'none';
  });
  document.querySelectorAll('.panel-vintage').forEach(el => {
    el.style.display = showVintage ? 'block' : 'none';
  });
  document.querySelectorAll('.panel-minimalist').forEach(el => {
    el.style.display = showMinimalist ? 'block' : 'none';
  });
  document.querySelectorAll('.panel-nature').forEach(el => {
    el.style.display = showNature ? 'block' : 'none';
  });
  document.querySelectorAll('.panel-arabesque').forEach(el => {
    el.style.display = showArabesque ? 'block' : 'none';
  });
  document.querySelectorAll('.panel-zellige').forEach(el => {
    el.style.display = showZellige ? 'block' : 'none';
  });
  document.querySelectorAll('.panel-door').forEach(el => {
    el.style.display = showDoor ? 'block' : 'none';
  });
  document.querySelectorAll('.panel-calligraphy').forEach(el => {
    el.style.display = showCalligraphy ? 'block' : 'none';
  });
  document.querySelectorAll('.panel-amazigh').forEach(el => {
    el.style.display = showAmazigh ? 'block' : 'none';
  });

  const invitationEl = document.getElementById('invitation');
  if (invitationEl) {
    if (showMinimalist) {
      invitationEl.classList.add('pattern-minimalist-active');
    } else {
      invitationEl.classList.remove('pattern-minimalist-active');
    }
    if (showZellige) {
      invitationEl.classList.add('pattern-zellige-active');
    } else {
      invitationEl.classList.remove('pattern-zellige-active');
    }
    if (showDoor) {
      invitationEl.classList.add('pattern-door-active');
    } else {
      invitationEl.classList.remove('pattern-door-active');
    }
    if (showCalligraphy) {
      invitationEl.classList.add('pattern-calligraphy-active');
    } else {
      invitationEl.classList.remove('pattern-calligraphy-active');
    }
    if (showAmazigh) {
      invitationEl.classList.add('pattern-amazigh-active');
    } else {
      invitationEl.classList.remove('pattern-amazigh-active');
    }
  }

  // Update seal circular text for door theme
  if (showDoor) {
    const sealTextPath = document.querySelector('#sealCirclePath ~ text textPath');
    if (sealTextPath) {
      sealTextPath.textContent = 'افتح الباب ✦ اضغط لفتح الباب ✦ ';
    }
  }

  // Apply nature green panel background when nature theme is active
  const panels = document.querySelectorAll('.env-panel');
  panels.forEach(p => {
    if (showNature) {
      p.classList.add('panel-nature-theme');
    } else {
      p.classList.remove('panel-nature-theme');
    }
  });

  // ── Hall Photo Background (hp) ──
  const hallPhoto = cfg.hp || 'watia_hall_bg';
  const heroBg = document.querySelector('.hero-bg-parallax');
  if (heroBg) {
    heroBg.style.backgroundImage = `url('assets/${hallPhoto}.png')`;
    if (hallPhoto === 'hall_bridal_entrance') {
      heroBg.classList.add('bg-bridal-entrance');
    } else {
      heroBg.classList.remove('bg-bridal-entrance');
    }
  }

  // ── Closing Photo (cp): which hall image shows in closing section ──
  const closingImg = document.querySelector('.closing-easel-photo');
  if (closingImg) {
    const closingPhoto = cfg.cp || 'watia_closing_board';
    closingImg.src = `assets/${closingPhoto}.png`;
  }

  // ── Seal symbol (es: 'heart' | 'rings' | 'monogram' | 'bismillah' | 'lock') ──
  // Only apply seal once to prevent it from changing after initial load
  if (!_sealApplied) {
    let seal = cfg.es;
    if (!seal) {
      if (showDoor) seal = 'lock';
      else if (showAmazigh) seal = 'amazigh';
      else if (showZellige) seal = 'zellige';
      else seal = 'heart';
    }
    const sealImg = document.getElementById('seal-3d-img');
    const sealMonoText = document.getElementById('seal-3d-monogram-text');

    if (sealImg) {
      if (seal === 'monogram') {
        sealImg.src = 'assets/monogram_wax_seal_bg.png?v=25';
        if (sealMonoText) {
          sealMonoText.style.display = 'flex';
          let initials = '';
          if (cfg.si) {
            initials = cfg.si;
          } else {
            const groomName = cfg.ga || '';
            const brideName = cfg.ba || '';
            const g = groomName.trim().charAt(0).toUpperCase();
            const b = brideName.trim().charAt(0).toUpperCase();
            initials = g && b ? `${g} & ${b}` : 'م & م';
          }

          // Dynamically adjust font-family for 3D look
          const hasLatin = /[a-zA-Z]/.test(initials);
          if (hasLatin) {
            sealMonoText.style.fontFamily = "'Playfair Display', serif";
            sealMonoText.style.fontSize = "1.5rem";
          } else {
            sealMonoText.style.fontFamily = "'Amiri', serif";
            sealMonoText.style.fontSize = "1.75rem";
          }

          // Parse and render initials with individual spans for perfect centering
          sealMonoText.innerHTML = '';
          
          let parts = [];
          if (initials.includes('&')) {
            parts = initials.split('&').map(p => p.trim());
            if (parts.length === 2) {
              parts = [parts[0], '&', parts[1]];
            }
          } else if (initials.includes('و')) {
            parts = initials.split('و').map(p => p.trim());
            if (parts.length === 2) {
              parts = [parts[0], 'و', parts[1]];
            }
          }
          
          if (parts.length === 3) {
            const span1 = document.createElement('span');
            span1.textContent = parts[0];
            span1.className = 'mono-letter';
            
            const spanConnector = document.createElement('span');
            spanConnector.textContent = parts[1];
            spanConnector.className = 'mono-connector';
            
            const span2 = document.createElement('span');
            span2.textContent = parts[2];
            span2.className = 'mono-letter';
            
            // Arabic is RTL, Latin is LTR. Row-reverse ensures correct order
            if (!hasLatin) {
              sealMonoText.style.flexDirection = 'row-reverse';
            } else {
              sealMonoText.style.flexDirection = 'row';
            }
            
            sealMonoText.appendChild(span1);
            sealMonoText.appendChild(spanConnector);
            sealMonoText.appendChild(span2);
          } else {
            const singleSpan = document.createElement('span');
            singleSpan.textContent = initials;
            singleSpan.className = 'mono-letter';
            sealMonoText.style.flexDirection = 'row';
            sealMonoText.appendChild(singleSpan);
          }
        }
      } else if (seal === 'lock') {
        sealImg.src = 'assets/lock_wax_seal.png?v=25';
        if (sealMonoText) {
          sealMonoText.style.display = 'flex';
          const brideName = (cfg.ba || 'العروسة').trim();
          sealMonoText.style.fontFamily = "'Amiri', serif";
          sealMonoText.style.fontSize = brideName.length > 10 ? "1.2rem" : "1.6rem";
          sealMonoText.style.flexDirection = 'row';
          sealMonoText.innerHTML = '';

          const nameSpan = document.createElement('span');
          nameSpan.textContent = brideName;
          nameSpan.className = 'mono-letter lock-bride-name';
          sealMonoText.appendChild(nameSpan);
        }
      } else if (seal === 'amazigh' || seal === 'zellige') {
        sealImg.src = seal === 'amazigh' ? 'assets/amazigh_wax_seal.png?v=25' : 'assets/zellige_wax_seal.png?v=25';
        if (sealMonoText) {
          sealMonoText.style.display = 'flex';
          sealMonoText.style.flexDirection = 'column';
          sealMonoText.style.justifyContent = 'flex-end';
          sealMonoText.style.alignItems = 'center';
          const brideName = (cfg.ba || 'العروسة').trim();
          sealMonoText.innerHTML = `
            <div class="seal-sub-engraved-wrapper">
              <div class="seal-sub-line"></div>
              <span class="seal-sub-bride-name">${brideName}</span>
            </div>
          `;
        }
      } else {
        sealImg.src = `assets/${seal}_wax_seal.png?v=25`;
        if (sealMonoText) {
          sealMonoText.style.display = 'none';
        }
      }
    }
    sealImg.style.opacity = '1';
    _sealApplied = true; // Mark seal as applied to prevent future changes
  }

  // Sync Day/Night mode icon
  if (typeof initDayNightModeIcon === 'function') {
    initDayNightModeIcon();
  }
}

/* ────────────────────────────────────────────────
   TRANSLATION & LOCALIZATION SYSTEM
   ──────────────────────────────────────────────── */
const TRANSLATIONS = {
  ar: {
    basmala: 'بسم الله الرحمان الرحيم',
    invite_title: 'تتشرف عائلة',
    mr: 'السيد',
    mrs: 'والسيدة',
    and: 'و',
    invite_desc: 'بدعوتكم لحضور حفل وطية ابنتهما',
    and_char: '&',
    scroll_hint: 'اسحب للأسفل',
    countdown_title: 'العد التنازلي',
    countdown_subtitle: 'لحظات تفصلنا عن اللقاء',
    days: 'يوم',
    hours: 'ساعة',
    mins: 'دقيقة',
    secs: 'ثانية',
    program_title: 'برنامج الحفل',
    location_btn: 'الموقع',
    guestbook_title: 'دفتر التهاني',
    guestbook_subtitle: 'شاركونا فرحتنا بكلمة طيبة للعروسة',
    gb_name_placeholder: 'اسمك الكريم',
    gb_rsvp_label: '🗳️ تأكيد الحضور (RSVP) :',
    gb_msg_placeholder: 'أكتب تهنئتك هنا...',
    gb_submit: 'إرسال التهنئة ✨',
    gb_sug_label: '💡 اقتراحات جاهزة للتهنئة:',
    closing_tagline: 'يسعدنا مشاركتكم هذه الفرحة',
    closing_to: 'إلى',
    closing_easel_header: 'وطية مبروكة',
    open_maps: 'افتح في خرائط جوجل',
    weather_title: 'حالة الطقس ليوم الحفل',
    weather_location: 'طبلبة، تونس',
    weather_humidity: 'الرطوبة',
    weather_wind: 'الرياح',
    weather_season_avg: 'معدل طقس صيفي مثالي ☀️',
    photo_stack_title: 'ألبوم صوري',
    photo_stack_subtitle: 'لحظات فرحتي',
    photo_stack_next: 'الصورة التالية',
  },
};

/* ────────────────────────────────────────────────
   GUEST NOMINATIVE BANNER
   Supports two modes:
   • New short URL: ?inv=slug&gid=XXXX  → Firestore lookup by guest id
   • Legacy URL:    ?guest=NAME&gt=TYPE → direct application (backward compat)
──────────────────────────────────────────────── */

/** Apply banner data once name + type are resolved */
function _applyGuestBanner(guestName, guestType) {
  _resolvedGuestName = guestName;
  _resolvedGuestType = guestType;

  let title = '';
  let name = guestName;
  let isLtr = false;
  switch (guestType) {
    case 'ar_couple':          title = 'إلى السيد'; name = `${guestName} وحرمه`; break;
    case 'ar_couple_children': title = 'إلى السيد'; name = `${guestName} وحرمه وأبنائه`; break;
    case 'ar_man':             title = 'إلى السيد'; name = guestName; break;
    case 'ar_woman':           title = 'إلى السيدة'; name = guestName; break;
    case 'ar_friend_m':        title = 'إلى عْشيري'; name = guestName; break;
    case 'ar_friend_f':        title = 'إلى عْشيرتي'; name = guestName; break;
    default:                   title = 'إلى السيد'; name = `${guestName} وحرمه`;
  }

  const banner  = document.getElementById('guestNameBanner');
  const titleEl = document.getElementById('guestCardTitle');
  const labelEl = document.getElementById('guestBannerLabel');
  if (!banner) return;

  if (titleEl) titleEl.textContent = title;
  if (labelEl) labelEl.textContent = name;
  banner.style.display = 'flex';
  if (isLtr) banner.classList.add('ltr');

  // Update browser tab title
  const fullSalutation = `${title} ${name}`;
  document.title = `${fullSalutation} — ${document.title}`;

  // Pre-fill guestbook name field
  const gbNameInput = document.getElementById('gb-name');
  if (gbNameInput) gbNameInput.value = name;

  // ── Closing section: show personalised guest address ──
  const closingAddr  = document.getElementById('closingGuestAddress');
  const closingGName = document.getElementById('closingGuestName');
  if (closingAddr && closingGName) {
    closingGName.textContent = name;
    closingAddr.style.display = 'flex';
  }

  // Update personalized invitation description text
  _updatePersonalizedInviteDesc();
}

/** Updates the invitation description text dynamically for personalized guests */
function _updatePersonalizedInviteDesc() {
  if (!_resolvedGuestName) return;
  const inviteDescEl = document.querySelector('[data-tr="invite_desc"]');
  if (!inviteDescEl) return;

  const guestName = _resolvedGuestName;
  const guestType = _resolvedGuestType || 'ar_couple';
  
  let title = '';
  let name = guestName;
  switch (guestType) {
    case 'ar_couple':          title = 'إلى السيد'; name = `${guestName} وحرمه`; break;
    case 'ar_couple_children': title = 'إلى السيد'; name = `${guestName} وحرمه وأبنائه`; break;
    case 'ar_man':             title = 'إلى السيد'; name = guestName; break;
    case 'ar_woman':           title = 'إلى السيدة'; name = guestName; break;
    case 'ar_friend_m':        title = 'إلى عْشيري'; name = guestName; break;
    case 'ar_friend_f':        title = 'إلى عْشيرتي'; name = guestName; break;
    default:                   title = 'إلى السيد'; name = `${guestName} وحرمه`;
  }

  const cleanTitle = title.replace('إلى ', '').trim();
  const titlePrefix = cleanTitle ? cleanTitle + ' ' : '';
  inviteDescEl.innerHTML = `بدعوة <span class="invite-guest-name">${titlePrefix}${name}</span> لحضور حفل وطية`;
}

function readAndApplyGuestParam() {
  const params   = new URLSearchParams(window.location.search);
  const gidRaw   = params.get('gid');    // new short-link format
  const guestRaw = params.get('guest');  // legacy format

  if (gidRaw) {
    /* ── New short link: resolve guest by id from Firestore ── */
    const invSlug = params.get('inv');
    if (!invSlug) return;
    initFirebase();
    _db.collection('invitations').doc(invSlug).get()
      .then(doc => {
        if (!doc.exists) return;
        const guests = doc.data().guests || [];
        const guestIdx  = guests.findIndex(g => g.id === gidRaw);
        if (guestIdx === -1) return;
        const guest = guests[guestIdx];
        _applyGuestBanner(guest.name, guest.type || 'ar_couple');

        // Increment views counter
        guests[guestIdx].views = (guests[guestIdx].views || 0) + 1;
        _db.collection('invitations').doc(invSlug).update({
          guests: guests
        }).catch(err => console.warn('[InvitApp] Failed to update guest view count:', err));
      })
      .catch(e => console.warn('[InvitApp] gid lookup failed:', e));

  } else if (guestRaw) {
    /* ── Legacy long link: guest name + type in URL ── */
    const guestName = decodeURIComponent(guestRaw.replace(/\+/g, ' '));
    const guestType = params.get('gt') || 'ar_couple';
    _applyGuestBanner(guestName, guestType);
  }
}

/* ────────────────────────────────────────────────
   MUSIC FROM CONFIG
   Reads cfg.mu and switches the <audio> src accordingly.
   Supported keys: 'wedding_march' | 'ziad_gharsa' | 'mabrouk_ramy_ayach'
──────────────────────────────────────────────── */
function applyMusicFromConfig(cfg) {
  if (!cfg || !cfg.mu) return;
  const MUSIC_MAP = {
    'wedding_march':      'assets/wedding_march.mp3',
    'ziad_gharsa':        'assets/ziad_gharsa.mp3',
    'mabrouk_ramy_ayach': 'assets/mabrouk_ramy_ayach.mp3',
  };
  const src = MUSIC_MAP[cfg.mu];
  if (!src) return;
  const audio = document.getElementById('wedding-audio');
  if (!audio) return;
  if (audio.getAttribute('src') === src) return; // already correct, nothing to do
  const wasPlaying = !audio.paused;
  audio.src = src;
  audio.load();
  if (wasPlaying) audio.play().catch(() => {});
}

const SUGGESTIONS = {
  ar: [
    "ألف مبروك للعروسين الجميلين! أتمنى لكما حياة مليئة بالحب والسعادة والهناء 💖",
    "بارك الله لكما وبارك عليكما وجمع بينكما في خير. زواج سعيد وعمر مديد بالرفاه والبنين 💍",
    "فرحتنا كبيرة بكما اليوم! تمنياتنا لكما برحلة زوجية سعيدة مليئة بالتفاهم والمودة والرحمة ✨",
    "أحر التهاني وأجمل التبريكات بمناسبة هذا الزواج الميمون. دامت بيوتكم عامرة بالأفراح والمسرات 🌹",
    "بكل الحب والود نهنئكما بزفافكما السعيد. أتمنى لكما مستقبلاً مشرقاً وحياة مشتركة مليئة بالبركة 💑"
  ],
  fr: [
    "Toutes nos félicitations pour votre mariage ! Nous vous souhaitons une vie remplie d'amour et de bonheur. 💖",
    "Que ce jour unique soit le début d'une merveilleuse aventure pleine de joie, de complicité et de tendresse. 💍",
    "Meilleurs vœux de bonheur pour ce nouveau chapitre de votre vie. Que votre amour grandisse jour après jour. ✨",
    "Félicitations aux magnifiques mariés ! Que votre foyer soit béni et toujours rempli d'harmonie et de paix. 🌹",
    "Avec tout notre amour, nous vous souhaitons une vie commune merveilleuse, parsemée de rires et de beaux projets. 💑"
  ]
};

function renderSuggestions(lang) {
  const container = document.getElementById('gb-suggestions-list');
  if (!container) return;
  const list = SUGGESTIONS[lang] || SUGGESTIONS.ar;
  container.innerHTML = list.map(text => {
    const escaped = text.replace(/'/g, "\\'");
    return `<div class="suggestion-pill" onclick="selectSuggestion('${escaped}')" title="${text}">${text}</div>`;
  }).join('');
}

window.selectSuggestion = function(text) {
  const textarea = document.getElementById('gb-message');
  if (textarea) {
    textarea.value = text;
    textarea.focus();
  }
};

function applyLanguage(lang) {
  _currentLang = 'ar';
  const dict = TRANSLATIONS.ar;

  // Set html properties — always RTL Arabic
  document.documentElement.lang = 'ar';
  document.documentElement.dir = 'rtl';
  document.body.classList.add('lang-ar');
  document.body.classList.remove('lang-fr');

  // Translate static texts
  document.querySelectorAll('[data-tr]').forEach(el => {
    const key = el.getAttribute('data-tr');
    if (dict[key]) {
      el.textContent = dict[key];
    }
  });

  // Translate placeholders
  document.querySelectorAll('[data-tr-placeholder]').forEach(el => {
    const key = el.getAttribute('data-tr-placeholder');
    if (dict[key]) {
      el.setAttribute('placeholder', dict[key]);
    }
  });

  // Update circular text path around wax seal
  const circularText = document.querySelector('.seal-text-svg textPath');
  if (circularText) {
    circularText.textContent = 'اضغط لفتح الدعوة ✦ اضغط لفتح الدعوة ✦';
  }

  // Render suggestion pills
  renderSuggestions('ar');

  // Render RSVP select options
  renderRsvpOptions('ar');

  // Render Recipient select options
  renderRecipientOptions('ar');

  // Apply dedicated role inscription for groom/bride private view
  if (window._pendingRoleView) {
    const roleLabel  = document.getElementById('role-inscription-banner');
    const roleTitleEl = document.getElementById('role-inscription-title');
    const roleSubEl   = document.getElementById('role-inscription-sub');
    if (roleLabel && roleTitleEl && roleSubEl) {
      const isGroom = window._pendingRoleView === 'groom';
      roleLabel.classList.remove('ltr');
      roleTitleEl.textContent = 'دعوة خاصة';
      roleSubEl.textContent = isGroom ? 'بالعريس للتذكار' : 'بالعروسة للتذكار';
      roleLabel.style.display = 'flex';
    }
  }

  // If a guest was already resolved, re-apply the personalized invite description
  if (typeof _updatePersonalizedInviteDesc === 'function') {
    _updatePersonalizedInviteDesc();
  }
}

/* ────────────────────────────────────────────────
   Day/Night Theme mode helper & toggle
   ──────────────────────────────────────────────── */
function initDayNightModeIcon() {
  const isNight = document.body.classList.contains('night-mode');
  const sunIcon = document.querySelector('.sun-icon');
  const moonIcon = document.querySelector('.moon-icon');
  if (sunIcon && moonIcon) {
    if (isNight) {
      sunIcon.style.display = 'block';
      moonIcon.style.display = 'none';
    } else {
      sunIcon.style.display = 'none';
      moonIcon.style.display = 'block';
    }
  }
}

window.toggleDayNightMode = function() {
  const body    = document.body;
  const btn     = document.getElementById('day-night-toggle');
  const sunIcon  = document.querySelector('.sun-icon');
  const moonIcon = document.querySelector('.moon-icon');

  // Trigger icon spin animation
  if (btn) {
    btn.classList.add('transitioning');
    setTimeout(() => btn.classList.remove('transitioning'), 460);
  }

  // Short delay so spin starts before mode switches
  setTimeout(() => {
    const isNight = body.classList.toggle('night-mode');

    if (sunIcon && moonIcon) {
      if (isNight) {
        sunIcon.style.display  = 'block';
        moonIcon.style.display = 'none';
        localStorage.setItem('invitThemeMode', 'night');
      } else {
        sunIcon.style.display  = 'none';
        moonIcon.style.display = 'block';
        localStorage.setItem('invitThemeMode', 'day');
      }
    }
  }, 220); // halfway through the spin, swap icons
};

/* ────────────────────────────────────────────────
   RSVP DYNAMIC SYSTEM & REAL-TIME COUNTER
   ──────────────────────────────────────────────── */
let _currentLang = 'ar';

const RSVP_OPTIONS = {
  ar: [
    { value: "", text: "👉 اختر تأكيد الحضور والتواجد" },
    { value: "both_1", text: "أؤكد حضوري بمفردي 👤", count: 1 },
    { value: "wife_2", text: "أؤكد حضوري مع زوجتي 💑 (+1)", count: 2 },
    { value: "husband_2", text: "أؤكد حضوري مع زوجي 💑 (+1)", count: 2 },
    { value: "family_3", text: "أؤكد حضورنا مع العائلة 👨‍👩‍👧 (+2)", count: 3 },
    { value: "family_4", text: "أؤكد حضورنا مع العائلة 👨‍👩‍👧‍👦 (+3)", count: 4 },
    { value: "sorry_0", text: "أعتذر عن الحضور 🌹", count: 0 }
  ],
  fr: [
    { value: "", text: "👉 Sélectionnez votre réponse RSVP" },
    { value: "both_1", text: "Je confirme ma présence (Seul/Seule) 👤", count: 1 },
    { value: "wife_2", text: "Je confirme ma présence avec ma femme 💑 (+1)", count: 2 },
    { value: "husband_2", text: "Je confirme ma présence avec mon mari 💑 (+1)", count: 2 },
    { value: "family_3", text: "Je confirme notre présence avec ma famille 👨‍👩‍👧 (+2)", count: 3 },
    { value: "family_4", text: "Je confirme notre présence avec ma famille 👨‍👩‍👧‍👦 (+3)", count: 4 },
    { value: "sorry_0", text: "Je m'excuse, je ne pourrai pas être présent 🌹", count: 0 }
  ]
};

function renderRsvpOptions(lang) {
  const selectEl = document.getElementById('gb-rsvp');
  if (!selectEl) return;
  const list = RSVP_OPTIONS[lang] || RSVP_OPTIONS.ar;
  selectEl.innerHTML = list.map(opt => {
    return `<option value="${opt.value}" data-count="${opt.count || 0}">${opt.text}</option>`;
  }).join('');
}

const RECIPIENT_OPTIONS = {
  ar: [
    { value: "both", text: "إلى: العرايس معاً 💑" },
    { value: "groom", text: "إلى: العريس 🤵" },
    { value: "bride", text: "إلى: العروسة 👰" }
  ],
  fr: [
    { value: "both", text: "Aux mariés ensemble 💑" },
    { value: "groom", text: "Au marié 🤵" },
    { value: "bride", text: "À la mariée 👰" }
  ]
};

function renderRecipientOptions(lang) {
  const selectEl = document.getElementById('gb-recipient');
  if (!selectEl) return;
  const list = RECIPIENT_OPTIONS[lang] || RECIPIENT_OPTIONS.ar;
  const currentVal = selectEl.value;
  selectEl.innerHTML = list.map(opt => {
    return `<option value="${opt.value}" ${opt.value === currentVal ? 'selected' : ''}>${opt.text}</option>`;
  }).join('');
}

window.onRsvpSelectChange = function() {
  const rsvpSelect = document.getElementById('gb-rsvp');
  const messageInput = document.getElementById('gb-message');
  if (!rsvpSelect || !messageInput) return;
  
  const selectedOpt = rsvpSelect.options[rsvpSelect.selectedIndex];
  if (selectedOpt && selectedOpt.value !== "") {
    messageInput.value = selectedOpt.text;
  } else {
    messageInput.value = "";
  }
};

let _confirmedInvitations = [];

function watchRsvpCounter() {
  const params = new URLSearchParams(window.location.search);
  const invSlug = params.get('inv');
  if (!invSlug) return;

  initFirebase();
  _db.collection('invitations').doc(invSlug).onSnapshot(doc => {
    if (!doc.exists) return;
    const data = doc.data();
    
    // 1. Process wishes in real-time for the couple's inbox!
    if (_currentRole === 'groom' || _currentRole === 'bride') {
      processWishesForRole(data.wishes);
    }
    
    // 2. Sum up RSVPs in real-time!
    const rsvps = data.rsvps || {};
    let totalConfirmed = 0;
    _confirmedInvitations = [];
    
    Object.keys(rsvps).forEach(key => {
      const rsvp = rsvps[key];
      if (rsvp.confirmed) {
        const count = Number(rsvp.count || 1);
        totalConfirmed += count;
        _confirmedInvitations.push({
          id: key,
          guestName: rsvp.name || 'عام',
          rsvpCount: count
        });
      }
    });
    
    const badge = document.getElementById('admin-rsvp-counter');
    if (badge && (_currentRole === 'groom' || _currentRole === 'bride')) {
      const countEl = document.getElementById('rsvp-count-num');
      if (countEl) countEl.textContent = totalConfirmed;
      badge.style.display = 'flex';
      badge.style.cursor = 'pointer';
      badge.onclick = openRsvpList;
    } else if (badge) {
      badge.style.display = 'none';
    }
  }, err => console.warn('[InvitApp] Failed to watch RSVP counter:', err));
}

window.openRsvpList = function() {
  const overlay = document.getElementById('rsvp-list-overlay');
  const scrollList = document.getElementById('rsvp-guests-scroll-list');
  const totalPopup = document.getElementById('rsvp-total-popup');
  if (!overlay || !scrollList) return;
  
  let totalCount = 0;
  
  if (_confirmedInvitations.length === 0) {
    scrollList.innerHTML = `
      <div style="text-align:center; color:var(--brown-mid); font-size:0.9rem; padding:20px;">
        لا يوجد حضور مؤكد بعد 🌹
      </div>`;
    totalPopup.textContent = '0';
  } else {
    scrollList.innerHTML = _confirmedInvitations.map(inv => {
      totalCount += inv.rsvpCount;
      
      return `
        <div style="background:rgba(201,168,76,0.06); border:1px solid rgba(201,168,76,0.15); border-radius:10px; padding:12px 14px; display:flex; justify-content:space-between; align-items:center; width:100%; text-align:right;">
          <strong style="color:var(--brown); font-size:1.05rem;">👤 ${inv.guestName}</strong>
          <span style="background:linear-gradient(135deg, #FCF6BA 0%, #c9a84c 50%, #8a6010 100%); color:#1a1000; font-size:0.75rem; font-weight:bold; padding:2px 8px; border-radius:12px;">+${inv.rsvpCount}</span>
        </div>
      `;
    }).join('');
    totalPopup.textContent = totalCount;
  }
  
  overlay.style.display = 'flex';
};

window.closeRsvpList = function() {
  const overlay = document.getElementById('rsvp-list-overlay');
  if (overlay) overlay.style.display = 'none';
};

/* ────────────────────────────────────────────────
   WEATHER FORECAST WIDGET — Open-Meteo (Dynamic)
   Reads lat/lon from first event in cfg.ev, date from cfg.wd.
   Falls back to Teboulba defaults if no config available.
   ──────────────────────────────────────────────── */

/**
 * Extracts weather-relevant params from config and updates globals.
 * Called every time a config is applied to DOM.
 */
function extractWeatherParamsFromConfig(cfg) {
  if (!cfg) return;

  // ── Date: from cfg.wd (format: "YYYY-MM-DDTHH:mm:ss") ──
  if (cfg.wd) {
    _weatherDate = cfg.wd.split('T')[0]; // keep only YYYY-MM-DD
  }

  // ── Coordinates: from first active event with valid lat/lng ──
  if (cfg.ev && cfg.ev.length) {
    const firstWithCoords = cfg.ev.find(e => e.la && e.lo && parseFloat(e.la) && parseFloat(e.lo));
    if (firstWithCoords) {
      _weatherLat = parseFloat(firstWithCoords.la);
      _weatherLon = parseFloat(firstWithCoords.lo);
      _weatherLocation = firstWithCoords.l || null;
    }
  }

  // ── Update location label in the weather card ──
  if (_weatherLocation) {
    document.querySelectorAll('[data-tr="weather_location"]').forEach(el => {
      el.textContent = _weatherLocation;
    });
  }
}

/**
 * Shared WMO code → description/icon mapper
 */
function _weatherCodeToDesc(code) {
  if (code === 0)                  return { ar: 'صافي ومشمس',    fr: 'Ensoleillé',               icon: '☀️' };
  if (code >= 1  && code <= 3)     return { ar: 'غائم جزئياً',   fr: 'Partiellement nuageux',     icon: '⛅' };
  if (code >= 45 && code <= 48)    return { ar: 'ضباب كثيف',     fr: 'Brouillard',                icon: '🌫️' };
  if (code >= 51 && code <= 67)    return { ar: 'أمطار خفيفة',   fr: 'Pluie légère',              icon: '🌧️' };
  if (code >= 71 && code <= 86)    return { ar: 'تساقط ثلوج',    fr: 'Neige',                     icon: '❄️' };
  if (code >= 95)                  return { ar: 'عواصف رعدية',   fr: 'Orageux',                   icon: '⛈️' };
  return                                   { ar: 'غائم',          fr: 'Nuageux',                   icon: '☁️' };
}

function _applyWeatherToDOM(temp, humidity, wind, code) {
  const { ar, icon } = _weatherCodeToDesc(code);

  const tempVal    = document.getElementById('weather-temp-val');
  const descText   = document.getElementById('weather-desc-text');
  const humidityEl = document.getElementById('weather-humidity-val');
  const windEl     = document.getElementById('weather-wind-val');
  const iconGlow   = document.querySelector('.weather-icon-glow');
  const card       = document.querySelector('.weather-glass-card');

  if (tempVal)    tempVal.textContent    = `${temp}°C`;
  if (descText)   descText.textContent   = `${ar} ${icon}`;
  if (humidityEl) humidityEl.textContent = `${humidity}%`;
  if (windEl)     windEl.textContent     = `${wind} km/h`;
  if (iconGlow)   iconGlow.textContent   = icon;
  if (card)       card.classList.remove('weather-skeleton');
}

function loadWeatherForecast() {
  const lat  = _weatherLat;
  const lon  = _weatherLon;

  // Determine if we should use daily forecast (future) or current conditions
  const today    = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const wDate    = _weatherDate || today;
  const isFuture = wDate > today;

  let url;
  if (isFuture) {
    // Forecast: ask for the specific wedding date daily data
    url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + `&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_sum,windspeed_10m_max,precipitation_probability_max`
        + `&start_date=${wDate}&end_date=${wDate}&timezone=auto`;
  } else {
    // Past date or today: use current conditions
    url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`;
  }

  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (isFuture) {
        // Daily forecast response
        if (!data || !data.daily) throw new Error('No daily data');
        const d = data.daily;
        const tempMax  = Math.round(d.temperature_2m_max[0]);
        const tempMin  = Math.round(d.temperature_2m_min[0]);
        const tempAvg  = Math.round((tempMax + tempMin) / 2);
        const code     = d.weathercode[0];
        const wind     = Math.round(d.windspeed_10m_max[0]);
        const precProb = d.precipitation_probability_max ? Math.round(d.precipitation_probability_max[0]) : null;

        // Show single average temperature — clean, no min/max confusion
        const tempVal = document.getElementById('weather-temp-val');
        if (tempVal) {
          tempVal.textContent = `${tempAvg}°C`;
        }

        // Rain probability in the humidity slot
        const humidityEl = document.getElementById('weather-humidity-val');
        if (humidityEl) humidityEl.textContent = precProb !== null ? `${precProb}%` : '--';

        const windEl = document.getElementById('weather-wind-val');
        if (windEl) windEl.textContent = `${wind} km/h`;

        const { ar, icon } = _weatherCodeToDesc(code);
        const descText  = document.getElementById('weather-desc-text');
        if (descText)   descText.textContent = `${ar} ${icon}`;
        const iconGlow  = document.querySelector('.weather-icon-glow');
        if (iconGlow)   iconGlow.textContent = icon;
        const card = document.querySelector('.weather-glass-card');
        if (card) card.classList.remove('weather-skeleton');

        // Short label for rain probability (fits in one line)
        document.querySelectorAll('[data-tr="weather_humidity"]').forEach(el => {
          el.textContent = 'مطر';
        });

      } else {
        // Current conditions response
        if (!data || !data.current) throw new Error('No current data');
        const c = data.current;
        _applyWeatherToDOM(
          Math.round(c.temperature_2m),
          Math.round(c.relative_humidity_2m),
          Math.round(c.wind_speed_10m),
          c.weather_code
        );
      }
    })
    .catch(err => {
      console.warn('[InvitApp] Weather API failed, using seasonal fallback:', err);
      // Seasonal fallback based on month of wedding date
      const month = _weatherDate ? parseInt(_weatherDate.split('-')[1]) : new Date().getMonth() + 1;
      const isSummer = month >= 5 && month <= 9;
      const fallbackTemp = isSummer ? '31°C' : '18°C';
      const fallbackDesc = isSummer
        ? 'صيفي مشمس وجميل ☀️'
        : 'معتدل وجميل 🌤️';

      const tempVal    = document.getElementById('weather-temp-val');
      const descText   = document.getElementById('weather-desc-text');
      const humidityEl = document.getElementById('weather-humidity-val');
      const windEl     = document.getElementById('weather-wind-val');
      const iconGlow   = document.querySelector('.weather-icon-glow');
      const card       = document.querySelector('.weather-glass-card');

      if (tempVal)    tempVal.textContent    = fallbackTemp;
      if (descText)   descText.textContent   = fallbackDesc;
      if (humidityEl) humidityEl.textContent = isSummer ? '52%' : '65%';
      if (windEl)     windEl.textContent     = isSummer ? '14 km/h' : '18 km/h';
      if (iconGlow)   iconGlow.textContent   = isSummer ? '☀️' : '🌤️';
      if (card)       card.classList.remove('weather-skeleton');
    });
}

/* ────────────────────────────────────────────────
   PHOTO STACK WIDGET LOGIC
   ──────────────────────────────────────────────── */
function initPhotoStack(cfg) {
  const section = document.getElementById('photo-stack-section');
  const wrapper = document.getElementById('photo-stack-cards-wrapper');
  const widget  = document.getElementById('photo-stack-widget');

  if (!section || !wrapper || !widget) return;

  // 1. Must be globally enabled
  const isEnabled = cfg.features && cfg.features.photoStack === true;
  if (!isEnabled) {
    section.style.display = 'none';
    wrapper.innerHTML = '';
    return;
  }

  // 2. Determine which photos to show based on ?gid= or ?view= in URL
  const params   = new URLSearchParams(window.location.search);
  const gid      = params.get('gid') || params.get('guest') || null;
  const view     = params.get('view') || null;

  let rawPhotos = null;

  if (gid) {
    // Sub-guest link: ONLY show photos specifically assigned to this guest
    const perGuest = cfg.features.guestPhotos;
    if (perGuest && Array.isArray(perGuest[gid]) && perGuest[gid].length > 0) {
      rawPhotos = perGuest[gid];
    }
  } else if (view === 'groom' || view === 'bride') {
    // Groom/Bride view: look up guestPhotos['groom'] or guestPhotos['bride']
    const perGuest = cfg.features.guestPhotos;
    if (perGuest && Array.isArray(perGuest[view]) && perGuest[view].length > 0) {
      rawPhotos = perGuest[view];
    } else {
      rawPhotos = [
        { url: 'assets/default_couple_1.jpg', caption: '💍 فرحتنا اكتملت' },
        { url: 'assets/default_couple_2.jpg', caption: '✨ ليلة العمر' },
        { url: 'assets/default_couple_3.jpg', caption: '❤️ حب أبدي' }
      ];
    }
  } else {
    // General link (no gid, no view): use global photoStackPhotos
    if (Array.isArray(cfg.features.photoStackPhotos) && cfg.features.photoStackPhotos.length > 0) {
      rawPhotos = cfg.features.photoStackPhotos;
    } else {
      rawPhotos = [
        { url: 'assets/default_wedding_general.jpg', caption: '💍 فرحتنا اكتملت' },
        { url: 'assets/default_wedding_general.jpg', caption: '✨ ليلة العمر' },
        { url: 'assets/default_wedding_general.jpg', caption: '❤️ حب أبدي' }
      ];
    }
  }

  if (!rawPhotos || rawPhotos.length === 0) {
    section.style.display = 'none';
    wrapper.innerHTML = '';
    return;
  }

  // 3. Normalise photo objects
  const photos = rawPhotos.map(p => {
    if (typeof p === 'string')  return { url: p.trim(), caption: '' };
    if (p && typeof p === 'object' && p.url) return { url: p.url.trim(), caption: p.caption || '' };
    return null;
  }).filter(p => p && p.url !== '');

  if (photos.length === 0) {
    section.style.display = 'none';
    wrapper.innerHTML = '';
    return;
  }
  
  // Show section
  section.style.display = 'flex';
  
  // 3. Set Theme
  let theme = cfg.features.photoStackTheme || 'floral';
  if (theme === 'emerald') theme = 'royal';
  if (theme !== 'floral' && theme !== 'vintage' && theme !== 'royal') {
    theme = 'floral';
  }
  widget.setAttribute('data-theme', theme);
  
  // 4. Render cards
  wrapper.innerHTML = '';
  const numPhotos = photos.length;
  let activeIndex = 0;
  
  const cardElements = photos.map((photo, index) => {
    const card = document.createElement('div');
    card.className = 'photo-card-item';
    
    // Frame
    const frame = document.createElement('div');
    frame.className = 'card-frame';
    
    // Medallion
    const medallion = document.createElement('div');
    medallion.className = 'card-medallion';
    medallion.innerHTML = `
      <svg class="medallion-icon" viewBox="0 0 64 64">
        <path d="M12 44 L18 20 L28 32 L32 16 L36 32 L42 20 L48 44 Z" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="12" cy="18" r="2.5" fill="currentColor"/>
        <circle cx="32" cy="14" r="2.5" fill="currentColor"/>
        <circle cx="48" cy="18" r="2.5" fill="currentColor"/>
      </svg>
    `;
    frame.appendChild(medallion);
    
    // Corner Filigrees
    const corners = ['tl', 'tr', 'bl', 'br'];
    corners.forEach(pos => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', `corner-filigree corner-${pos}`);
      svg.setAttribute('viewBox', '0 0 40 40');
      svg.innerHTML = `
        <path d="M 5,5 L 20,5 M 5,5 L 5,20" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>
        <circle cx="10" cy="10" r="2" fill="currentColor"/>
      `;
      frame.appendChild(svg);
    });
    
    // Image wrapper
    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'card-image-wrapper';
    
    const img = document.createElement('img');
    img.className = 'card-photo';
    img.alt = photo.caption || 'Wedding Photo';
    img.loading = 'lazy';
    img.src = photo.url;
    
    // Fallback on error
    img.onerror = function() {
      console.warn('[InvitApp] Photo Stack image failed to load:', photo.url);
      imgWrapper.style.background = 'rgba(201,168,76,0.06)';
      imgWrapper.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100%; color:var(--gold); font-family:sans-serif; text-align:center; padding:15px; box-sizing:border-box;">
          <span style="font-size:2rem; margin-bottom:8px;">❤️</span>
          <span class="font-amiri" style="font-size:1.1rem; color:var(--gold-light);">M & M</span>
        </div>
      `;
    };
    
    imgWrapper.appendChild(img);
    frame.appendChild(imgWrapper);
    
    // Caption
    if (photo.caption) {
      const caption = document.createElement('div');
      caption.className = 'card-caption';
      caption.textContent = photo.caption;
      frame.appendChild(caption);
    }
    
    card.appendChild(frame);
    
    // Vintage light paper grain overlay
    const grain = document.createElement('div');
    grain.className = 'grain-overlay';
    card.appendChild(grain);
    
    wrapper.appendChild(card);
    return card;
  });
  
  // 5. Update Positions
  function updatePositions() {
    cardElements.forEach((card, index) => {
      card.classList.remove('card-top', 'card-mid', 'card-back', 'card-hidden');
      
      let diff = (index - activeIndex + numPhotos) % numPhotos;
      
      if (numPhotos === 1) {
        card.classList.add('card-top');
        card.removeAttribute('role');
        card.removeAttribute('tabindex');
        card.removeAttribute('aria-label');
      } else if (numPhotos === 2) {
        if (diff === 0) {
          card.classList.add('card-top');
          card.setAttribute('role', 'button');
          card.setAttribute('tabindex', '0');
          card.setAttribute('aria-label', TRANSLATIONS[_currentLang || 'ar'].photo_stack_next || 'Photo suivante');
        } else {
          card.classList.add('card-mid');
          card.removeAttribute('role');
          card.removeAttribute('tabindex');
          card.removeAttribute('aria-label');
        }
      } else {
        if (diff === 0) {
          card.classList.add('card-top');
          card.setAttribute('role', 'button');
          card.setAttribute('tabindex', '0');
          card.setAttribute('aria-label', TRANSLATIONS[_currentLang || 'ar'].photo_stack_next || 'Photo suivante');
        } else if (diff === 1) {
          card.classList.add('card-mid');
          card.removeAttribute('role');
          card.removeAttribute('tabindex');
          card.removeAttribute('aria-label');
        } else if (diff === 2) {
          card.classList.add('card-back');
          card.removeAttribute('role');
          card.removeAttribute('tabindex');
          card.removeAttribute('aria-label');
        } else {
          card.classList.add('card-hidden');
          card.removeAttribute('role');
          card.removeAttribute('tabindex');
          card.removeAttribute('aria-label');
        }
      }
    });
  }
  
  // 6. Interactive Event listeners
  if (numPhotos > 1) {
    const handleNextCard = (e) => {
      const card = e.target.closest('.photo-card-item');
      if (card && card.classList.contains('card-top')) {
        activeIndex = (activeIndex + 1) % numPhotos;
        updatePositions();
      }
    };
    
    wrapper.addEventListener('click', handleNextCard);
    
    wrapper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('.photo-card-item');
        if (card && card.classList.contains('card-top')) {
          e.preventDefault();
          activeIndex = (activeIndex + 1) % numPhotos;
          updatePositions();
        }
      }
    });
  }
  
  updatePositions();
}