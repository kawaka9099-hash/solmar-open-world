// Solmar — game/src/hud.js
// Everything drawn on top of the 3D view: the money/health/ammo panel, the
// wanted stars, the mission card, the live minimap, toasts, the crosshair,
// and the menu / pause / busted / wasted screens. It only talks to the DOM
// — the game hands it one plain "view" object per frame and it paints that,
// so no game logic lives here.
//
// Visibility is set with explicit display values, never with an empty
// string: the stylesheet hides the toast, the crosshair and the pause /
// busted / wasted screens with ID selectors, and an empty inline display
// falls back to those rules — the element would stay hidden. An inline
// 'flex' or 'block' outranks the ID rule and actually shows it.
//
// The minimap is a top-down drawing of the city: road lines, the marina
// water at the south edge, landmark dots, the player as a white arrow, the
// current objective as a pulsing yellow ring, police in blue and enemies
// in red.

import { CONFIG } from './config.js';
import { clamp, formatMoney, formatSpeed, formatDistance } from './util.js';

function el(id) {
  return document.getElementById(id);
}

export class HUD {
  constructor() {
    this.moneyEl = el('hud-money');
    this.healthBarEl = el('hud-health-bar');
    this.healthNumEl = el('hud-health-num');
    this.ammoEl = el('hud-ammo');
    this.speedEl = el('hud-speed');
    this.wantedEl = el('wanted-stars');
    this.wantedPanelEl = el('wanted-panel');
    this.missionCardEl = el('mission-card');
    this.missionTitleEl = el('mission-title');
    this.missionObjectiveEl = el('mission-objective');
    this.missionDistanceEl = el('mission-distance');
    this.minimapEl = el('minimap');
    this.minimapCtx = this.minimapEl ? this.minimapEl.getContext('2d') : null;
    this.toastEl = el('toast');
    this.crosshairEl = el('crosshair');
    this.startScreenEl = el('start-screen');
    this.pauseScreenEl = el('pause-screen');
    this.bustedScreenEl = el('busted-screen');
    this.wastedScreenEl = el('wasted-screen');
    this.startButtonEl = el('start-button');
    this._toastTimer = 0;
    this._time = 0;
    if (this.toastEl) this.toastEl.style.opacity = '0';
  }

  // Which overlay screen is showing. 'playing' hides them all. The
  // overlays are flex containers, so the visible one gets 'flex' — an
  // empty value would lose to the stylesheet's ID rule that hides them.
  showScreen(name) {
    const screens = {
      menu: this.startScreenEl,
      paused: this.pauseScreenEl,
      busted: this.bustedScreenEl,
      wasted: this.wastedScreenEl,
    };
    for (const [key, node] of Object.entries(screens)) {
      if (node) node.style.display = key === name ? 'flex' : 'none';
    }
  }

  setStartButtonLabel(text) {
    if (this.startButtonEl) this.startButtonEl.textContent = text;
  }

  showToast(text, ms = 3600) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.style.display = 'block';
    this.toastEl.style.opacity = '1';
    window.clearTimeout(this._toastTimer);
    this._toastTimer = window.setTimeout(() => {
      this.toastEl.style.opacity = '0';
    }, ms);
  }

  // One frame of HUD state. `view` is built by the Game each tick:
  // { money, health, maxHealth, ammoMag, ammoReserve, reloading, speedMs,
  //   wantedStars, driving, mission: { title, objective, distance } | null,
  //   freeRoamHint, player: { x, z, heading }, target: { x, z } | null,
  //   police: [{x,z}], enemies: [{x,z}], traffic: [{x,z}], city }
  update(view, dt) {
    this._time += dt;
    if (this.moneyEl) this.moneyEl.textContent = formatMoney(view.money);
    if (this.healthBarEl) {
      const pct = clamp((view.health / Math.max(1, view.maxHealth)) * 100, 0, 100);
      this.healthBarEl.style.width = pct + '%';
      this.healthBarEl.style.background = pct > 50 ? '#37c978' : pct > 25 ? '#e8b820' : '#e04040';
    }
    if (this.healthNumEl) this.healthNumEl.textContent = String(Math.max(0, Math.ceil(view.health)));
    if (this.ammoEl) {
      this.ammoEl.textContent = view.reloading
        ? 'RELOADING…'
        : 'PISTOL — ' + view.ammoMag + ' IN MAG · ' + view.ammoReserve + ' RESERVE';
    }
    if (this.speedEl) this.speedEl.textContent = formatSpeed(view.speedMs);
    if (this.wantedEl) {
      const stars = clamp(Math.round(view.wantedStars), 0, 5);
      if (this.wantedEl.children.length > 0) {
        // The markup holds one child per star; light the earned ones.
        for (let i = 0; i < this.wantedEl.children.length; i++) {
          this.wantedEl.children[i].className = i < stars ? 'lit' : '';
        }
      } else {
        this.wantedEl.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
      }
    }
    if (this.wantedPanelEl) {
      this.wantedPanelEl.style.opacity = view.wantedStars > 0 ? '1' : '0.55';
    }
    if (this.crosshairEl) {
      this.crosshairEl.style.display = view.crosshairVisible ? 'block' : 'none';
    }
    if (view.mission) {
      if (this.missionTitleEl) this.missionTitleEl.textContent = view.mission.title;
      if (this.missionObjectiveEl) this.missionObjectiveEl.textContent = view.mission.objective;
      if (this.missionDistanceEl) {
        this.missionDistanceEl.textContent =
          typeof view.mission.distance === 'number'
            ? formatDistance(view.mission.distance)
            : '';
      }
      if (this.missionCardEl) this.missionCardEl.style.display = 'block';
    } else {
      if (this.missionTitleEl) this.missionTitleEl.textContent = 'FREE ROAM — SOLMAR';
      if (this.missionObjectiveEl) this.missionObjectiveEl.textContent = view.freeRoamHint;
      if (this.missionDistanceEl) this.missionDistanceEl.textContent = '';
      if (this.missionCardEl) this.missionCardEl.style.display = 'block';
    }
    this._drawMinimap(view);
  }

  _drawMinimap(view) {
    const ctx = this.minimapCtx;
    const canvas = this.minimapEl;
    const city = view.city;
    if (!ctx || !canvas || !city) return;
    const size = CONFIG.hud.minimapSize;
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;
    const bounds = city.bounds;
    const spanX = bounds.maxX - bounds.minX;
    const spanZ = bounds.maxZ - bounds.minZ;
    const span = Math.max(spanX, spanZ);
    const scale = size / span;
    const toX = (x) => (x - bounds.minX) * scale;
    const toY = (z) => (z - bounds.minZ) * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#101c26';
    ctx.fillRect(0, 0, size, size);

    // Marina water along the south edge (positive z, past the last road).
    const waterTop = toY(bounds.maxZ - 26);
    ctx.fillStyle = '#2a6f9e';
    ctx.fillRect(0, waterTop, size, size - waterTop);

    // Roads: one line per road centre line, in both directions.
    ctx.strokeStyle = '#5a6a78';
    ctx.lineWidth = Math.max(2, 14 * scale);
    ctx.beginPath();
    for (const c of city.roadLines) {
      ctx.moveTo(toX(c), 0);
      ctx.lineTo(toX(c), size);
      ctx.moveTo(0, toY(c));
      ctx.lineTo(size, toY(c));
    }
    ctx.stroke();

    // Landmarks.
    const landmarkColors = {
      spawn: '#ffffff',
      marina: '#58b8e8',
      docks: '#e88030',
      bank: '#e8c820',
      safehouse: '#37c978',
      hospital: '#e04040',
    };
    for (const [name, point] of Object.entries(city.landmarks)) {
      ctx.fillStyle = landmarkColors[name] || '#cccccc';
      ctx.beginPath();
      ctx.arc(toX(point.x), toY(point.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    const dot = (x, z, color, radius) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(toX(x), toY(z), radius, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const car of view.traffic || []) dot(car.x, car.z, '#9aa8b5', 2);
    for (const cop of view.police || []) dot(cop.x, cop.z, '#3a80ff', 3);
    for (const foe of view.enemies || []) dot(foe.x, foe.z, '#ff4040', 3);

    // Mission target: a pulsing yellow ring.
    if (view.target) {
      const pulse = 5 + 2.5 * Math.sin(this._time * 4);
      ctx.strokeStyle = '#ffd820';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(toX(view.target.x), toY(view.target.z), pulse, 0, Math.PI * 2);
      ctx.stroke();
      dot(view.target.x, view.target.z, '#ffd820', 2.5);
    }

    // Player: a white arrow pointing along the heading.
    if (view.player) {
      const px = toX(view.player.x);
      const py = toY(view.player.z);
      const heading = view.player.heading || 0;
      ctx.save();
      ctx.translate(px, py);
      // Canvas y grows downward while world z grows south, so a north
      // pointing arrow must be rotated by PI minus the heading.
      ctx.rotate(Math.PI - heading);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
