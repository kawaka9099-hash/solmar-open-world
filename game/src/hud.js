// Solmar — game/src/hud.js
// Every DOM read and write for the HUD: money, health, ammo, speed, the
// wanted stars, the mission card, toasts, the crosshair, the four screens
// and the live minimap.
//
// The overlay bug the previous build hit: the stylesheet hides #toast,
// #crosshair, #pause-screen, #busted-screen and #wasted-screen with
// `display: none` on the ID selector, which beats an empty inline value.
// So showing anything here always sets an EXPLICIT display value
// ('block' for the toast and crosshair, 'flex' for the screens) — never
// display = ''.

import { CONFIG } from './config.js';
import { formatMoney, formatSpeed, formatDistance } from './util.js';

export class Hud {
  constructor(city) {
    this.city = city;
    const $ = (id) => document.getElementById(id);
    this.el = {
      missionTitle: $('mission-title'),
      missionObjective: $('mission-objective'),
      missionDistance: $('mission-distance'),
      wantedStars: $('wanted-stars'),
      money: $('hud-money'),
      healthBar: $('hud-health-bar'),
      healthNum: $('hud-health-num'),
      ammo: $('hud-ammo'),
      speed: $('hud-speed'),
      minimap: $('minimap'),
      toast: $('toast'),
      crosshair: $('crosshair'),
      startScreen: $('start-screen'),
      pauseScreen: $('pause-screen'),
      bustedScreen: $('busted-screen'),
      wastedScreen: $('wasted-screen'),
    };
    this.mapCtx = this.el.minimap ? this.el.minimap.getContext('2d') : null;
    this._toastTimer = null;
    this._screens = [this.el.startScreen, this.el.pauseScreen, this.el.bustedScreen, this.el.wastedScreen];
  }

  setMoney(n) {
    if (this.el.money) this.el.money.textContent = formatMoney(n);
  }

  setHealth(hp) {
    const v = Math.max(0, Math.min(100, Math.round(hp)));
    if (this.el.healthBar) this.el.healthBar.style.width = `${v}%`;
    if (this.el.healthNum) this.el.healthNum.textContent = String(v);
  }

  setAmmo(mag, reserve) {
    if (this.el.ammo) this.el.ammo.textContent = `PISTOL — ${mag} IN MAG · ${reserve} RESERVE`;
  }

  setSpeed(ms) {
    if (this.el.speed) this.el.speed.textContent = String(Math.round(formatSpeed(ms)));
  }

  setStars(level) {
    const stars = this.el.wantedStars ? this.el.wantedStars.children : [];
    for (let i = 0; i < stars.length; i++) {
      stars[i].className = i < level ? 'lit' : '';
    }
  }

  setMission(title, objective, distanceM = null) {
    if (this.el.missionTitle) this.el.missionTitle.textContent = title;
    if (this.el.missionObjective) this.el.missionObjective.textContent = objective;
    if (this.el.missionDistance) {
      this.el.missionDistance.textContent = distanceM === null ? '' : formatDistance(distanceM);
    }
  }

  toast(text, ms = 2600) {
    if (!this.el.toast) return;
    this.el.toast.textContent = text;
    // Explicit 'block': the stylesheet's #toast rule is display:none.
    this.el.toast.style.display = 'block';
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.el.toast.style.display = 'none';
    }, ms);
  }

  setCrosshair(visible) {
    if (!this.el.crosshair) return;
    // Explicit 'block': the stylesheet's #crosshair rule is display:none.
    this.el.crosshair.style.display = visible ? 'block' : 'none';
  }

  hideScreens() {
    for (const s of this._screens) if (s) s.style.display = 'none';
  }

  // name: 'start' | 'pause' | 'busted' | 'wasted' | null (hide all).
  // Screens are flex-column overlays, so showing one sets 'flex'.
  showScreen(name) {
    this.hideScreens();
    const map = {
      start: this.el.startScreen,
      pause: this.el.pauseScreen,
      busted: this.el.bustedScreen,
      wasted: this.el.wastedScreen,
    };
    const el = name ? map[name] : null;
    if (el) el.style.display = 'flex';
  }

  drawMinimap(data) {
    const ctx = this.mapCtx;
    if (!ctx || !this.city) return;
    const size = 190;
    const range = CONFIG.hud.minimapRange;
    const scale = size / range;
    const px = data.playerX;
    const pz = data.playerZ;
    const toX = (x) => size / 2 + (x - px) * scale;
    const toY = (z) => size / 2 + (z - pz) * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, size, size);

    // Water along the south edge (the marina, positive z).
    const bounds = this.city.bounds;
    const waterTop = toY(bounds.maxZ - 26);
    ctx.fillStyle = '#2f7fb8';
    ctx.fillRect(0, Math.max(0, waterTop), size, size);

    // Roads.
    ctx.strokeStyle = '#3a3b40';
    ctx.lineWidth = 7;
    for (const road of this.city.roads ?? []) {
      ctx.beginPath();
      if (road.axis === 'x') {
        ctx.moveTo(toX(road.x - road.length / 2), toY(road.z));
        ctx.lineTo(toX(road.x + road.length / 2), toY(road.z));
      } else {
        ctx.moveTo(toX(road.x), toY(road.z - road.length / 2));
        ctx.lineTo(toX(road.x), toY(road.z + road.length / 2));
      }
      ctx.stroke();
    }

    // Landmarks.
    const marks = this.city.landmarks ?? {};
    const dots = [
      [marks.spawn, '#ffffff'],
      [marks.marina, '#6db7ff'],
      [marks.docks, '#ff9a3d'],
      [marks.bank, '#5ad06a'],
      [marks.hospital, '#ffffff'],
    ];
    for (const [pt, color] of dots) {
      if (!pt) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(toX(pt.x), toY(pt.z), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Safehouse: a ring, so the job beacon is easy to spot.
    if (marks.safehouse) {
      ctx.strokeStyle = '#f2c230';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(toX(marks.safehouse.x), toY(marks.safehouse.z), 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Mission target: a pulsing yellow ring.
    if (data.mission) {
      const pulse = 6 + Math.sin(data.time * 4) * 2;
      ctx.strokeStyle = '#f2c230';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(toX(data.mission.x), toY(data.mission.z), pulse, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Traffic (pale), police (blue), enemies (red).
    const dot = (list, color, r) => {
      ctx.fillStyle = color;
      for (const p of list ?? []) {
        ctx.beginPath();
        ctx.arc(toX(p.x), toY(p.z), r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    dot(data.traffic, '#b9bec8', 1.8);
    dot(data.police, '#4d9fff', 2.6);
    dot(data.enemies, '#ff4030', 2.6);

    // Player: a white arrow in the facing direction.
    const fx = Math.sin(data.heading);
    const fz = Math.cos(data.heading);
    const cx = size / 2;
    const cy = size / 2;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + fx * 11, cy + fz * 11);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
