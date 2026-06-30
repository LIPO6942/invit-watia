'use strict';

/* ═══════════════════════════════════════════════════════════════════
   WEDDING INVITATION — app.js
   ─────────────────────────────────────────────────────────────────
   Modules:
   0. URL Config Loader  ← reads ?c= param, applies to DOM, tracks pack
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

/* ────────────────────────────────────────────────
   0. URL CONFIG LOADER
   Reads ?c=BASE64 → JSON (compact keys) → applies to DOM
   Runs after DOMContentLoaded so all elements are available
──────────────────────────────────────────────── */

function fromB64(str) {
  // Unicode-safe base64 decode (mirrors admin toB64)
  return decodeURIComponent(
    Array.from(atob(str), c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  );
}

/**
 * Maps compact config keys → data-cfg attribute values.
 * Compact key schema (must match admin.html buildConfig):
 *   ga=groomAr  ba=brideAr  gf=groomFather  gm=groomMother
 *   bf=brideFather  bm=brideMother  wd=weddingDate  wdd=weddingDateDisplay
 */
function applyConfigToDOM(cfg) {
  const MAP = {
    groomAr:     cfg.ga,
    brideAr:     cfg.ba,
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
}

function loadConfigFromURL() {
  const params  = new URLSearchParams(window.location.search);
  const encoded = params.get('c');

  let cfg;
  if (encoded) {
    try {
      cfg = JSON.parse(fromB64(encoded));
    } catch (e) {
      console.warn('[InvitApp] Could not parse config from URL:', e);
      return;
    }
  } else {
    // Local testing fallback: read directly from localStorage if present
    const raw = localStorage.getItem('weddingAdminConfig');
    if (raw) {
      try {
        cfg = JSON.parse(raw);
      } catch (e) {}
    }
  }

  if (!cfg) return;

  // Override wedding date for countdown
  if (cfg.wd) _weddingDateTime = cfg.wd;

  // Apply text values immediately
  applyConfigToDOM(cfg);

  // Rebuild timeline if events provided
  if (cfg.ev && cfg.ev.length) rebuildTimelineFromConfig(cfg.ev);

  // Pack expiry check (only run on guest URL hits)
  if (encoded && cfg.id && cfg.ps) {
    checkAndIncrementPack(cfg.id, cfg.ps);
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
window.openEnvelopeNow = function() {
  const inv = document.getElementById('invitation');
  if (!inv || inv.classList.contains('open')) return;
  inv.classList.add('open');
  playCrackSound();
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
   BOOTSTRAP — runs once DOM is ready
──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // 1. Read URL config and apply to DOM (names, dates, events)
  loadConfigFromURL();

  // 2. Init timeline reveal for default (non-config) items
  initTimelineReveal();
});

