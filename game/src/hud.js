// Solmar's HUD: the DOM panels (wanted stars, cash, health, ammo,
// objective, prompts, speed), the live minimap canvas, mission cards,
// toasts, and the start / pause / end menus. No game logic lives here —
// game.js calls these methods and this file only touches the page.

import { formatMoney, formatTime } from './util.js';

function el(id) {
  return document.getElementById(id);
}

export class SolmarHud {
  constructor() {
    this.hud = el('hud');
    this.starsEl = el('wanted-stars');
    this.wantedEl = el('wanted');
    this.moneyNum = el('money-num');
    this.healthFill = el('health-fill');
    this.healthText = el('health-text');
    this.ammoEl = el('ammo');
    this.objectiveKicker = el('objective-kicker');
    this.objectiveText = el('objective-text');
    this.objectiveDist = el('objective-dist');
    this.promptEl = el('prompt');
    this.speedEl = el('speed');
    this.speedNum = el('speed-num');
    this.crosshair = el('crosshair');
    this.toastEl = el('toast');
    this.card = el('mission-card');
    this.cardKicker = el('mission-card-kicker');
    this.cardTitle = el('mission-card-title');
    this.cardSub = el('mission-card-sub');
    this.cardText = el('mission-card-text');
    this.bigCenter = el('big-center');
    this.bigTitle = el('big-center-title');
    this.bigSub = el('big-center-sub');
    this.damageEl = el('damage-flash');
    this.damageEl.style.transition = 'opacity 0.55s ease';
    this.mapCanvas = el('minimap');
    this.mapCtx = this.mapCanvas.getContext('2d');
    this.toastTimer = null;
    this.cardTimer = null;
    this.bigTimer = null;
    this.menu = el('menu');
    this.pauseEl = el('pause');
    this.endEl = el('end');
    this.continueBtn = el('btn-continue');
    this.saveNote = el('menu-save-note');
    this.pauseNote = el('pause-note');
  }

  showHud() { this.hud.classList.add('on'); }
  hideHud() { this.hud.classList.remove('on'); }

  setMoney(n) {
    this.moneyNum.textContent = formatMoney(n);
  }

  setHealth(h, max) {
    const pct = Math.max(0, Math.min(100, (h / max) * 100));
    this.healthFill.style.width = `${pct}%`;
    this.healthFill.classList.toggle('low', pct < 30);
    this.healthText.textContent = String(Math.ceil(h));
  }

  setAmmo(mag, reserve) {
    this.ammoEl.textContent = `PISTOL — ${mag} IN MAG · ${reserve} RESERVE`;
  }

  setWanted(stars) {
    let html = '';
    for (let i = 0; i < 5; i++) {
      html += i < stars ? '★' : '<span class="off">★</span>';
    }
    this.starsEl.innerHTML = html;
    this.wantedEl.classList.toggle('hot', stars > 0);
  }

  setObjectiveText(t) {
    this.objectiveText.textContent = t;
  }

  setObjectiveKicker(t) {
    this.objectiveKicker.textContent = t;
  }

  setObjectiveDist(d, timeLeft = null) {
    let s = '';
    if (d !== null && d !== undefined) s += `${d}m`;
    if (timeLeft !== null && timeLeft !== undefined) s += (s ? '  ·  ' : '') + formatTime(timeLeft);
    this.objectiveDist.textContent = s;
  }

  showObjective(def, step) {
    this.setObjectiveKicker(`MISSION ${def.id} — ${def.title.toUpperCase()}`);
    this.setObjectiveText(step.text);
  }

  showPrompt(html) {
    if (html) {
      this.promptEl.innerHTML = html;
      this.promptEl.classList.add('on');
    } else {
      this.promptEl.classList.remove('on');
    }
  }

  showSpeed(kmh) {
    if (kmh === null || kmh === undefined) {
      this.speedEl.classList.remove('on');
    } else {
      this.speedNum.textContent = String(Math.round(kmh));
      this.speedEl.classList.add('on');
    }
  }

  setCrosshair(on) {
    this.crosshair.classList.toggle('on', !!on);
  }

  toast(text, ms = 2600) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }

  showMissionCard(def) {
    this.cardKicker.textContent = `MISSION ${def.id} OF 6`;
    this.cardTitle.textContent = def.title;
    this.cardSub.textContent = def.sub;
    this.cardText.textContent = def.briefing;
    this.card.classList.add('on');
    if (this.cardTimer) clearTimeout(this.cardTimer);
    this.cardTimer = setTimeout(() => this.card.classList.remove('on'), 5200);
  }

  showBigCenter(title, sub, kind = 'good') {
    this.bigTitle.textContent = title;
    this.bigTitle.className = kind;
    this.bigSub.textContent = sub || '';
    this.bigCenter.classList.add('on');
    if (this.bigTimer) clearTimeout(this.bigTimer);
    this.bigTimer = setTimeout(() => this.bigCenter.classList.remove('on'), 3000);
  }

  hideBigCenter() {
    this.bigCenter.classList.remove('on');
  }

  flashDamage() {
    this.damageEl.style.opacity = '0.9';
    setTimeout(() => { this.damageEl.style.opacity = '0'; }, 70);
  }

  // ---- menus ---------------------------------------------------------------

  showMenu(saveInfo) {
    this.menu.classList.remove('hidden');
    this.pauseEl.classList.add('hidden');
    this.endEl.classList.add('hidden');
    if (saveInfo) {
      this.continueBtn.disabled = false;
      this.saveNote.textContent = `Saved game: $${formatMoney(saveInfo.money)} · Mission ${saveInfo.mission} · ${saveInfo.date}`;
    } else {
      this.continueBtn.disabled = true;
      this.saveNote.textContent = '';
    }
  }

  hideMenu() {
    this.menu.classList.add('hidden');
  }

  showPause(note = '') {
    this.pauseEl.classList.remove('hidden');
    this.pauseNote.textContent = note;
  }

  hidePause() {
    this.pauseEl.classList.add('hidden');
  }

  showEnd(title, text, kind = 'bad') {
    const titleEl = el('end-title');
    titleEl.textContent = title;
    titleEl.className = kind;
    el('end-text').textContent = text;
    this.endEl.classList.remove('hidden');
  }

  hideEnd() {
    this.endEl.classList.add('hidden');
  }

  // Wire the menu buttons to the game's callbacks.
  bindMenu(cbs) {
    el('btn-new').addEventListener('click', () => cbs.onNewGame());
    el('btn-continue').addEventListener('click', () => cbs.onContinue());
    el('btn-how').addEventListener('click', () => {
      el('howto').classList.toggle('on');
    });
    el('btn-resume').addEventListener('click', () => cbs.onResume());
    el('btn-save').addEventListener('click', () => cbs.onSave());
    el('btn-restart').addEventListener('click', () => cbs.onRestartMission());
    el('btn-quit').addEventListener('click', () => cbs.onQuitToMenu());
    el('btn-retry').addEventListener('click', () => cbs.onRetry());
    el('btn-end-menu').addEventListener('click', () => cbs.onQuitToMenu());
  }

  // ---- minimap ---------------------------------------------------------------

  // Player-centred map: roads, blocks, water, the mission blip, the player
  // arrow, traffic, police, pedestrians and enemies.
  drawMinimap(game) {
    const ctx = this.mapCtx;
    const S = 208;
    const half = S / 2;
    const range = 135; // world units from the player to the map edge
    const scale = half / range;
    const px = game.player.pos.x;
    const pz = game.player.pos.z;
    const toMapX = (wx) => half + (wx - px) * scale;
    const toMapY = (wz) => half + (wz - pz) * scale;

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#20262c';
    ctx.fillRect(0, 0, S, S);

    // Water (east of the beach).
    const waterX = toMapX(352);
    if (waterX < S) {
      ctx.fillStyle = '#2a7fa8';
      ctx.fillRect(Math.max(0, waterX), 0, S - Math.max(0, waterX), S);
    }
    // Sand strip.
    const sandX = toMapX(320);
    if (sandX < S && sandX > -40) {
      ctx.fillStyle = '#e6d3a3';
      ctx.fillRect(Math.max(0, sandX), 0, Math.min(S, toMapX(352)) - Math.max(0, sandX), S);
    }
    // Blocks.
    ctx.fillStyle = '#3a4148';
    for (let bx = -252; bx <= 252; bx += 72) {
      for (let bz = -252; bz <= 252; bz += 72) {
        const x = toMapX(bx - 28);
        const y = toMapY(bz - 28);
        if (x > S || y > S || x + 56 * scale < 0 || y + 56 * scale < 0) continue;
        ctx.fillRect(x, y, 56 * scale, 56 * scale);
      }
    }
    // Roads.
    ctx.strokeStyle = '#565e66';
    ctx.lineWidth = 16 * scale;
    for (const road of game.world.roads) {
      ctx.beginPath();
      if (road.axis === 'x') {
        ctx.moveTo(toMapX(-320), toMapY(road.at));
        ctx.lineTo(toMapX(320), toMapY(road.at));
      } else {
        ctx.moveTo(toMapX(road.at), toMapY(-320));
        ctx.lineTo(toMapX(road.at), toMapY(320));
      }
      ctx.stroke();
    }
    // Plaza.
    ctx.fillStyle = '#4a7a44';
    ctx.fillRect(toMapX(-28), toMapY(-28), 56 * scale, 56 * scale);

    // Mission blip: pulsing gold diamond.
    const blip = game.missions.blip();
    if (blip) {
      const bx = toMapX(blip.x);
      const by = toMapY(blip.z);
      const r = 5 + Math.sin(game.time * 5) * 1.6;
      ctx.fillStyle = '#ffb62e';
      ctx.beginPath();
      ctx.moveTo(bx, by - r);
      ctx.lineTo(bx + r, by);
      ctx.lineTo(bx, by + r);
      ctx.lineTo(bx - r, by);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,182,46,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Pedestrians as tiny grey dots.
    ctx.fillStyle = 'rgba(200,205,210,0.75)';
    for (const p of game.peds) {
      if (p.down) continue;
      const x = toMapX(p.pos.x);
      const y = toMapY(p.pos.z);
      if (x < 0 || y < 0 || x > S || y > S) continue;
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    // Enemies as red dots.
    ctx.fillStyle = '#ff5a4a';
    for (const e of game.enemies) {
      if (e.dead) continue;
      const x = toMapX(e.pos.x);
      const y = toMapY(e.pos.z);
      if (x < 0 || y < 0 || x > S || y > S) continue;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Traffic as yellow dots, police as blue dots.
    for (const car of game.allCars()) {
      const x = toMapX(car.pos.x);
      const y = toMapY(car.pos.z);
      if (x < 0 || y < 0 || x > S || y > S) continue;
      ctx.fillStyle = car.kind === 'police' ? '#4a90ff' : '#ffd24a';
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow (north-up map, arrow turns with the heading).
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(game.player.heading);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // View edge.
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }
}
