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

/* ──────────────────────────────────────────────
   Firebase config (shared with admin.html)
──────────────────────────────────────────────── */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDiX0BwIT9wQKnlNHk0ADLgtI5eOUwF-1E",
  authDomain:        "invit-mar.firebaseapp.com",
  projectId:         "invit-mar",
  storageBucket:     "invit-mar.firebasestorage.app",
  messagingSenderId: "654872438284",
  appId:             "1:654872438284:web:c11d6f3cdff82bf35ff029"
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

/**
 * Maps compact config keys → data-cfg attribute values.
 */
function applyConfigToDOM(cfg) {
  const isFr = cfg.la === 'fr';

  // The big animated names shown in the intro show the OPPOSITE language name
  // (French when invitation is in Arabic, Arabic when in French) — bilingual elegance
  const groomDisplay = isFr ? cfg.ga : (cfg.gf2 || cfg.ga);
  const brideDisplay = isFr ? cfg.ba : (cfg.bf2 || cfg.ba);

  const MAP = {
    groomAr:          isFr ? (cfg.gf2 || cfg.ga) : cfg.ga,
    brideAr:          isFr ? (cfg.bf2 || cfg.ba) : cfg.ba,
    groomNameDisplay: groomDisplay,  // shown in the big animated names + envelope banner
    brideNameDisplay: brideDisplay,
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

  // Apply language translations
  applyLanguage(cfg.la || 'ar');

  // Set page title dynamically
  const groom = MAP.groomAr || cfg.ga;
  const bride = MAP.brideAr || cfg.ba;
  if (groom && bride) {
    document.title = isFr ? `Mariage de ${groom} & ${bride}` : `حفل زفاف ${groom} و ${bride}`;
  }
}

function checkRoleView() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'groom' || view === 'bride') {
    _currentRole = view;
    const mbToggle = document.getElementById('mailbox-toggle');
    if (mbToggle) {
      mbToggle.style.display = 'flex';
    }
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
    _db.collection('invitations').doc(invSlug).get()
      .then(doc => {
        if (!doc.exists) {
          console.warn('[InvitApp] Invitation not found:', invSlug);
          return;
        }
        const data  = doc.data();
        const cfg   = data.config;
        const count = data.count || 0;
        const pack  = data.pack  || 9999;

        if (count >= pack) {
          showPackExpired();
          return;
        }

        /* Process wishes for Groom/Bride private inbox */
        processWishesForRole(data.wishes);

        /* Apply config */
        if (cfg.wd) _weddingDateTime = cfg.wd;
        applyConfigToDOM(cfg);
        if (cfg.ev && cfg.ev.length) rebuildTimelineFromConfig(cfg.ev);
        
        // Apply theme color
        if (cfg.th && cfg.th !== 'gold') {
          document.body.classList.add('theme-' + cfg.th);
        }
        applyEnvelopeDesign(cfg);

        /* Atomic counter increment */
        _db.collection('invitations').doc(invSlug).update({
          count: firebase.firestore.FieldValue.increment(1)
        }).catch(e => console.warn('[InvitApp] Counter increment failed:', e));
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
        if (count > pack) { showPackExpired(); return; }

        /* Process wishes for Groom/Bride private inbox */
        processWishesForRole(data.wishes);

        if (cfg.wd) _weddingDateTime = cfg.wd;
        applyConfigToDOM(cfg);
        if (cfg.ev && cfg.ev.length) rebuildTimelineFromConfig(cfg.ev);
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
    if (cfg.th && cfg.th !== 'gold') document.body.classList.add('theme-' + cfg.th);
    applyEnvelopeDesign(cfg);
    if (cfg.id && cfg.ps) checkAndIncrementPack(cfg.id, cfg.ps);

  } else {
    // ── localStorage fallback (local testing) ──
    const raw = localStorage.getItem('weddingAdminConfig');
    if (raw) {
      try {
        const cfg = JSON.parse(raw);
        if (cfg.wd) _weddingDateTime = cfg.wd;
        applyConfigToDOM(cfg);
        if (cfg.ev && cfg.ev.length) rebuildTimelineFromConfig(cfg.ev);
        
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
function rebuildTimelineFromConfig(events) {
  const timeline = document.getElementById('timeline');
  if (!timeline) return;
  const pinIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  timeline.innerHTML = events.map((ev, i) => {
    const isEven  = i % 2 === 0;
    const iconSVG = `<svg class="tl-icon-svg" viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="none" stroke="url(#g1)" stroke-width="1.5"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="26" fill="#c9a84c">${ev.e||'🎉'}</text></svg>`;
    const infoHTML = `
      <span class="tl-date">${ev.d||''}</span>
      <div class="tl-event font-amiri">${ev.n||''}</div>
      <div class="tl-location">${ev.l||''}</div>
      <div class="tl-time">${ev.t||''} <span class="tl-ampm">${ev.a||''}</span></div>
      <button class="tl-location-btn" onclick="openMap(this)">${pinIcon}<span>الموقع</span></button>`;
    return `
      <div class="timeline-item"
           data-location="${ev.l||''}"
           data-lat="${ev.la||''}"
           data-lng="${ev.lo||""}">
        <div class="tl-left-cell">${isEven ? infoHTML : iconSVG}</div>
        <div class="tl-dot-wrapper"><div class="tl-dot"></div></div>
        <div class="tl-right-cell">${isEven ? iconSVG : infoHTML}</div>
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
  inv.classList.add('open');
  document.body.classList.add('env-open');
  
  // Play the actual wedding march MP3 song
  startWeddingMusic();
  
  setTimeout(() => {
    spawnPetals();
    startHeartClock();
  }, 800);
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
  const colors = [
    '#e8cc7a','#f5e6c0','#c9a84c',
    '#fff8d0','#d4a960','#f5dca0',
    '#faf0d0','#dbb86a'
  ];
  for (let i = 0; i < 22; i++) {
    const p    = document.createElement('div');
    p.className = 'petal';
    const size  = Math.random() * 8 + 5;
    const r1    = Math.floor(Math.random() * 40 + 30);
    const r2    = Math.floor(Math.random() * 40 + 30);
    p.style.cssText = [
      `width:${size}px`,
      `height:${size * 1.5}px`,
      `left:${Math.random() * 100}%`,
      `background:${colors[Math.floor(Math.random() * colors.length)]}`,
      `animation-duration:${Math.random() * 8 + 7}s`,
      `animation-delay:${Math.random() * 12}s`,
      `border-radius:${r1}% 0 ${r2}% 0`,
    ].join(';');
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
   5. COUNTDOWN TIMER
   Uses _weddingDateTime (overridden by URL config)
──────────────────────────────────────────────── */
(function initCountdown() {
  function getTargetDate() {
    return new Date(_weddingDateTime);
  }

  const els = {
    d: document.getElementById('cd-days'),
    h: document.getElementById('cd-hours'),
    m: document.getElementById('cd-mins'),
    s: document.getElementById('cd-secs'),
  };

  function pad(n) { return String(Math.max(0, n)).padStart(2, '0'); }

  function flipUpdate(el, newVal) {
    if (!el) return;
    const str = pad(newVal);
    if (el.textContent === str) return;
    el.style.transition = 'transform 0.1s ease';
    el.style.transform  = 'scale(0.85)';
    setTimeout(() => {
      el.textContent    = str;
      el.style.transform = 'scale(1)';
    }, 100);
  }

  function tick() {
    const diff  = Math.max(0, getTargetDate().getTime() - Date.now());
    const days  = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins  = Math.floor((diff % 3600000)  / 60000);
    const secs  = Math.floor((diff % 60000)    / 1000);
    flipUpdate(els.d, days);
    flipUpdate(els.h, hours);
    flipUpdate(els.m, mins);
    flipUpdate(els.s, secs);
  }

  tick();
  setInterval(tick, 1000);
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
  if (!nameInput || !messageInput) return;

  const name = nameInput.value.trim();
  const msg = messageInput.value.trim();
  const recipient = recipientSelect ? recipientSelect.value : 'both';
  if (!name || !msg) {
    alert('الرجاء كتابة الاسم والتهنئة 🌹');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const invSlug = params.get('inv');

  if (!invSlug) {
    // Local preview fallback
    const localWish = { name, message: msg, target: recipient, timestamp: new Date().toISOString() };
    allWishes.unshift(localWish);
    renderWishesScroller();
    nameInput.value = '';
    messageInput.value = '';
    alert('تم إرسال تهنئتك بنجاح (معاينة محلية) ✨');
    return;
  }

  initFirebase();
  _db.collection('invitations').doc(invSlug).update({
    wishes: firebase.firestore.FieldValue.arrayUnion({
      name: name,
      message: msg,
      target: recipient,
      timestamp: new Date().toISOString()
    })
  })
  .then(() => {
    nameInput.value = '';
    messageInput.value = '';
    alert('شكراً لك! تم إرسال تهنئتك بنجاح للعروسين ✨');
    
    // Add real-time update to _roleWishes if this wish matches the current role view
    const newWish = { name, message: msg, target: recipient, timestamp: new Date().toISOString() };
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
  const listEl = document.getElementById('wishes-wall-list');
  if (!overlay || !listEl) return;

  overlay.style.display = 'flex';
  
  if (titleEl) {
    titleEl.textContent = _currentRole === 'groom' ? 'صندوق تهاني العريس 🤵' : 'صندوق تهاني العروسة 👰';
  }

  if (_roleWishes.length === 0) {
    listEl.innerHTML = `<div style="text-align:center;color:var(--brown-light);padding:40px;font-style:italic">لا توجد رسائل موجهة لك بعد 💌</div>`;
    return;
  }

  listEl.innerHTML = _roleWishes.map(w => {
    const targetLabel = w.target === 'groom' ? '🤵 خاص بالعريس' : w.target === 'bride' ? '👰 خاص بالعروسة' : '💑 للعروسين';
    const dateStr = w.timestamp ? new Date(w.timestamp).toLocaleString('ar-TN') : '';
    return `
      <div class="wishes-wall-card">
        <div class="wishes-wall-guest">
          <span>👤 ${w.name}</span>
          <span style="font-size:0.7rem;background:rgba(201,168,76,0.15);color:var(--brown);padding:2px 8px;border-radius:10px">${targetLabel}</span>
        </div>
        <div class="wishes-wall-msg">"${w.message}"</div>
        <div class="wishes-wall-date">📅 ${dateStr}</div>
      </div>
    `;
  }).join('');
};

window.closeWishesWall = function() {
  const overlay = document.getElementById('wishes-wall-overlay');
  if (overlay) overlay.style.display = 'none';
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
});

/* ────────────────────────────────────────────────
   ENVELOPE DESIGN — applies motif & seal from config
   ──────────────────────────────────────────────── */
function applyEnvelopeDesign(cfg) {
  if (!cfg) return;

  // ── Motif (ep: 'floral' | 'vintage') ──
  const pattern = cfg.ep || 'floral';
  const showFloral  = pattern === 'floral';
  const showVintage = pattern === 'vintage';

  document.querySelectorAll('.panel-branches').forEach(el => {
    el.style.display = showFloral ? '' : 'none';
  });
  document.querySelectorAll('.panel-vintage').forEach(el => {
    // Vintage SVGs have display:none inline style — toggle it properly
    el.style.display = showVintage ? 'block' : 'none';
  });

  // ── Seal symbol (es: 'heart' | 'rings' | 'monogram' | 'bismillah') ──
  const seal = cfg.es || 'heart';
  const sealImg = document.getElementById('seal-3d-img');
  const sealMonoText = document.getElementById('seal-3d-monogram-text');

  if (sealImg) {
    if (seal === 'monogram') {
      sealImg.src = 'assets/monogram_wax_seal_bg.png';
      if (sealMonoText) {
        sealMonoText.style.display = 'flex';
        const isFr = cfg.la === 'fr';
        const groomName = isFr ? (cfg.gf2 || cfg.ga) : cfg.ga;
        const brideName = isFr ? (cfg.bf2 || cfg.ba) : cfg.ba;
        const g = (groomName || '').trim().charAt(0).toUpperCase();
        const b = (brideName || '').trim().charAt(0).toUpperCase();
        sealMonoText.textContent = g && b ? `${g} & ${b}` : 'M & M';
      }
    } else {
      sealImg.src = `assets/${seal}_wax_seal.png`;
      if (sealMonoText) {
        sealMonoText.style.display = 'none';
      }
    }
  }
}

/* ────────────────────────────────────────────────
   TRANSLATION & LOCALIZATION SYSTEM
   ──────────────────────────────────────────────── */
const TRANSLATIONS = {
  ar: {
    basmala: 'بارك الله لهما وبارك عليهما وجمع بينهما في خير',
    invite_title: 'تتشرف عائلتا',
    mr: 'السيد',
    mrs: 'والسيدة',
    and: 'و',
    invite_desc: 'بدعوتكم لحضور حفل زفاف نجليهما',
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
    guestbook_subtitle: 'شاركونا فرحتنا بكلمة طيبة للعروسين',
    gb_name_placeholder: 'اسمك الكريم',
    gb_msg_placeholder: 'أكتب تهنئتك هنا...',
    gb_submit: 'إرسال التهنئة ✨',
    closing_tagline: 'يسعدنا مشاركتكم هذه الفرحة',
  },
  fr: {
    basmala: 'Que Dieu les bénisse, les comble de bonheur et les réunisse.',
    invite_title: 'Les familles',
    mr: 'M.',
    mrs: 'et Mme',
    and: 'et',
    invite_desc: 'ont l\'honneur de vous inviter au mariage de leurs enfants',
    and_char: '&',
    scroll_hint: 'Faites défiler vers le bas',
    countdown_title: 'Compte à rebours',
    countdown_subtitle: 'Quelques instants nous séparent de ce grand jour',
    days: 'Jours',
    hours: 'Heures',
    mins: 'Minutes',
    secs: 'Secondes',
    program_title: 'Programme de la Fête',
    location_btn: 'Localisation',
    guestbook_title: 'Livre d\'or',
    guestbook_subtitle: 'Laissez un message de félicitations aux mariés',
    gb_name_placeholder: 'Votre Nom',
    gb_msg_placeholder: 'Écrivez votre message ici...',
    gb_submit: 'Envoyer les félicitations ✨',
    closing_tagline: 'Nous sommes honorés de partager ce moment avec vous',
  }
};

function applyLanguage(lang) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.ar;
  const isFr = lang === 'fr';

  // Set html properties
  document.documentElement.lang = lang;
  document.documentElement.dir = isFr ? 'ltr' : 'rtl';

  // Apply language class to body
  if (isFr) {
    document.body.classList.add('lang-fr');
    document.body.classList.remove('lang-ar');
  } else {
    document.body.classList.add('lang-ar');
    document.body.classList.remove('lang-fr');
  }

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
    circularText.textContent = isFr
      ? 'Cliquez pour ouvrir l\'invitation ✦ Cliquez pour ouvrir ✦'
      : 'اضغط لفتح الدعوة ✦ اضغط لفتح الدعوة ✦';
  }
}

