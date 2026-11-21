// Solmar — game/src/hud.js
// The HUD for Solmar: money, health and ammo panels, the wanted stars, the
// mission card, a live minimap, toasts, the crosshair and the menu screens.
//
// Display rule, learned the hard way: the page stylesheet hides the toast,
// the crosshair and every menu screen with an ID selector (display: none).
// An inline display of '' loses to that, so overlays shown that way stay
// invisible forever. Every show/hide here sets an explicit value —
// 'flex' or 'block' to show, 'none' to hide — never an empty string.

import { clamp } from './util.js';

function el(id) {
  return document.getElementById(id);
}

export class HUD {
  constructor() {
    this.missionCard = el('mission-card');
    this.missionTitle = el('mission-title');
    this.missionObjective = el('mission-objective');
    this.missionDistance = el('mission-distance');
    this.wantedStars = el('wanted-stars');
    this.money = el('hud-money');
    this.healthBar = el('hud-health-bar');
    this.healthNum = el('hud-health-num');
    this.ammo = el('hud-ammo');
    this.minimap = el('minimap');
    this.mapCtx = this.minimap ? this.minimap.getContext('2d') : null;
    this.speed = el('hud-speed');
    this.crosshair = el('crosshair');
    this.toastEl = el('toast');
    this.controlsHelp = el('controls-help');
    this.screens = {
      start: el('start-screen'),
      pause: el('pause-screen'),
      busted: el('busted-screen'),
      wasted: el('wasted-screen'),
    };
    this._toastTimer = 0;
    this._mode = 'menu';
  }

  setMode(mode) {
    this._mode = mode;
    this.setCrosshair(mode === 'playing');
    if (this.controlsHelp) {
      this.controlsHelp.style.display = mode === 'playing' ? 'block' : 'none';
    }
  }

  // Show one menu screen ('start' | 'pause' | 'busted' | 'wasted') or none.
  showScreen(name) {
    for (const [key, node] of Object.entries(this.screens)) {
      if (!node) continue;
      node.style.display = key === name ? 'flex' : 'none';
    }
    if (name) this.setCrosshair(false);
  }

  setCrosshair(on) {
    if (!this.crosshair) return;
    this.crosshair.style.display = on ? 'block' : 'none';
  }

  toast(text, ms = 3500) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.style.display = 'block';
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toastEl.style.display = 'none';
    }, ms);
  }

  setMoney(n) {
    if (this.money) this.money.textContent = '$' + String(Math.floor(n));
  }

  setHealth(hp) {
    const v = clamp(Math.round(hp), 0, 100);
    if (this.healthBar) this.healthBar.style.width = v + '%';
    if (this.healthNum) this.healthNum.textContent = String(v);
  }

  setAmmo(mag, reserve) {
    if (this.ammo) this.ammo.textContent = `PISTOL — ${mag} IN MAG · ${reserve} RESERVE`;
  }

  setWanted(stars) {
    if (!this.wantedStars) return;
    const lit = clamp(Math.round(stars), 0, 5);
    this.wantedStars.textContent = '★'.repeat(lit) + '☆'.repeat(5 - lit);
  }

  setSpeed(ms) {
    if (this.speed) this.speed.textContent = String(Math.round(ms * 3.6));
  }

  setMission(title, objective, distanceM) {
    if (this.missionTitle) this.missionTitle.textContent = title;
    if (this.missionObjective) this.missionObjective.textContent = objective;
    if (this.missionDistance) {
      this.missionDistance.textContent = distanceM === null || distanceM === undefined
        ? ''
        : Math.round(distanceM) + ' m';
    }
  }

  // Live minimap. view = { player: {x, z, heading}, mission: {x, z}|null,
  // police: [{x, z}], enemies: [{x, z}], traffic: [{x, z}] }.
  drawMinimap(city, view) {
    if (!this.mapCtx || !this.minimap) return;
    const ctx = this.mapCtx;
    const W = this.minimap.width || 180;
    const H = this.minimap.height || 180;
    if (this.minimap.width !== W) this.minimap.width = W;
    if (this.minimap.height !== H) this.minimap.height = H;
    const b = city.bounds;
    const sx = W / (b.maxX - b.minX);
    const sz = H / (b.maxZ - b.minZ);
    const X = (x) => (x - b.minX) * sx;
    const Z = (z) => (z - b.minZ) * sz;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1c2733';
    ctx.fillRect(0, 0, W, H);
    // Marina water along the south edge.
    ctx.fillStyle = '#2a6a9a';
    ctx.fillRect(0, Z(b.maxZ) - 8, W, 8);
    // Roads.
    ctx.strokeStyle = '#5a6a7a';
    ctx.lineWidth = 4;
    for (const road of city.roads || []) {
      ctx.beginPath();
      if (road.axis === 'x') {
        ctx.moveTo(X(road.x - road.length / 2), Z(road.z));
        ctx.lineTo(X(road.x + road.length / 2), Z(road.z));
      } else {
        ctx.moveTo(X(road.x), Z(road.z - road.length / 2));
        ctx.lineTo(X(road.x), Z(road.z + road.length / 2));
      }
      ctx.stroke();
    }
    // Landmarks.
    for (const [name, lm] of Object.entries(city.landmarks || {})) {
      ctx.fillStyle = name === 'safehouse' ? '#e8b820' : '#8ec9e8';
      ctx.beginPath();
      ctx.arc(X(lm.x), Z(lm.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Traffic.
    ctx.fillStyle = '#9aa8b8';
    for (const t of view.traffic || []) {
      ctx.fillRect(X(t.x) - 1, Z(t.z) - 1, 2, 2);
    }
    // Enemies.
    ctx.fillStyle = '#ff8030';
    for (const e of view.enemies || []) {
      ctx.beginPath();
      ctx.arc(X(e.x), Z(e.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Police.
    ctx.fillStyle = '#ff4040';
    for (const p of view.police || []) {
      ctx.beginPath();
      ctx.arc(X(p.x), Z(p.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Mission target ring.
    if (view.mission) {
      ctx.strokeStyle = '#e8b820';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(view.mission.x), Z(view.mission.z), 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Player arrow.
    if (view.player) {
      const px = X(view.player.x);
      const pz = Z(view.player.z);
      const a = view.player.heading || 0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(px + Math.sin(a) * 6, pz + Math.cos(a) * 6);
      ctx.lineTo(px + Math.sin(a + 2.5) * 5, pz + Math.cos(a + 2.5) * 5);
      ctx.lineTo(px + Math.sin(a - 2.5) * 5, pz + Math.cos(a - 2.5) * 5);
      ctx.closePath();
      ctx.fill();
    }
  }
}
