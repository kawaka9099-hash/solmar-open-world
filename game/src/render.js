// Drawing only: the city, its people and cars, the HUD with its minimap, and the
// title, pause and wasted screens. The camera follows the player; the world is
// painted in a 1280x720 window, scaled to the browser window.
import {
  AVENUES, BEACH_X, DOCKS_Y, FONT, PALETTE, PLACES, ROAD_W, STREETS,
  VIEW, WATER_X, WORLD,
} from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_BUSTED = 'busted';

const MINIMAP = { x: VIEW.width - 216, y: 16, w: 200, h: 140 };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const fonts = new Map();
  let dpr = 1;

  function font(size, bold) {
    const key = `${size}:${bold ? 1 : 0}`;
    if (!fonts.has(key)) fonts.set(key, `${bold ? '700 ' : ''}${size}px ${FONT}`);
    return fonts.get(key);
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  }

  function text(value, x, y, size, color, align, bold) {
    ctx.font = font(size, bold);
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, y);
  }

  function textShadowed(value, x, y, size, color, align, bold) {
    ctx.font = font(size, bold);
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(value, x + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Warmth of the light at this hour: [overlay colour, alpha, shadow length]. */
  function daylight(minutes) {
    const h = minutes / 60;
    if (h < 6 || h >= 21) return ['#0b1030', 0.34, 4];
    if (h < 9) return ['#ffb347', 0.08, 26];
    if (h < 16) return ['#fff3d6', 0.03, 12];
    if (h < 19) return ['#ff9a3c', 0.11, 22];
    return ['#7a5cff', 0.16, 16];
  }

  function drawGround(state, cam) {
    const city = state.city;
    const x0 = cam.x - VIEW.width / 2;
    const y0 = cam.y - VIEW.height / 2;
    // Base ground: warm pale paving across the whole city.
    ctx.fillStyle = '#d9c9a8';
    ctx.fillRect(x0, y0, VIEW.width, VIEW.height);
    // Parks.
    ctx.fillStyle = PALETTE.parkGreen;
    for (const pk of city.parks) ctx.fillRect(pk.x, pk.y, pk.w, pk.h);
    // Docklands: concrete apron at the south edge.
    ctx.fillStyle = '#9a938a';
    ctx.fillRect(x0, DOCKS_Y, VIEW.width, WORLD.height - DOCKS_Y);
    // Beach sand and sea.
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(Math.max(x0, BEACH_X), y0, VIEW.width, VIEW.height);
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(Math.max(x0, WATER_X), y0, VIEW.width, VIEW.height);
    // Wave lines on the water.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    const waveT = state.elapsed * 0.7;
    for (let wy = Math.floor(y0 / 46) * 46; wy < y0 + VIEW.height; wy += 46) {
      ctx.beginPath();
      for (let wx = WATER_X; wx < x0 + VIEW.width; wx += 26) {
        const yy = wy + Math.sin(wx * 0.02 + waveT + wy) * 4;
        if (wx === WATER_X) ctx.moveTo(wx, yy);
        else ctx.lineTo(wx, yy);
      }
      ctx.stroke();
    }
    // Sidewalks: pale bands along every road.
    ctx.fillStyle = PALETTE.sidewalk;
    for (const ax of AVENUES) {
      ctx.fillRect(ax - ROAD_W / 2 - 26, y0, ROAD_W + 52, VIEW.height);
    }
    for (const sy of STREETS) {
      ctx.fillRect(x0, sy - ROAD_W / 2 - 26, VIEW.width, ROAD_W + 52);
    }
    // Asphalt.
    ctx.fillStyle = PALETTE.asphalt;
    for (const ax of AVENUES) ctx.fillRect(ax - ROAD_W / 2, y0, ROAD_W, VIEW.height);
    for (const sy of STREETS) ctx.fillRect(x0, sy - ROAD_W / 2, VIEW.width, ROAD_W);
    // Centre dashes.
    ctx.strokeStyle = PALETTE.roadLine;
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 22]);
    for (const ax of AVENUES) {
      ctx.beginPath();
      ctx.moveTo(ax, y0);
      ctx.lineTo(ax, y0 + VIEW.height);
      ctx.stroke();
    }
    for (const sy of STREETS) {
      ctx.beginPath();
      ctx.moveTo(x0, sy);
      ctx.lineTo(x0 + VIEW.width, sy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Plaza del Sol: patterned paving + fountain.
    ctx.fillStyle = '#e6d9bd';
    ctx.fillRect(1640, 1300, 400, 280);
    ctx.strokeStyle = '#c9b48a';
    ctx.lineWidth = 2;
    ctx.strokeRect(1640, 1300, 400, 280);
    ctx.fillStyle = '#7fc4d8';
    ctx.beginPath();
    ctx.arc(1840, 1440, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a8e0ee';
    ctx.beginPath();
    ctx.arc(1840, 1440, 28, 0, Math.PI * 2);
    ctx.fill();
    // The Old Pier: wooden boards into the water at the south-west.
    ctx.fillStyle = '#8a6b4a';
    ctx.fillRect(600, DOCKS_Y, 80, 140);
    ctx.strokeStyle = '#6e5238';
    for (let py = DOCKS_Y + 12; py < DOCKS_Y + 140; py += 14) {
      ctx.beginPath();
      ctx.moveTo(600, py);
      ctx.lineTo(680, py);
      ctx.stroke();
    }
  }

  function drawBuildings(state, cam, shadowLen) {
    const city = state.city;
    const x0 = cam.x - VIEW.width / 2;
    const y0 = cam.y - VIEW.height / 2;
    for (const b of city.buildings) {
      if (b.x > x0 + VIEW.width || b.x + b.w < x0 || b.y > y0 + VIEW.height || b.y + b.h < y0) continue;
      const sh = shadowLen * b.height * 0.4;
      // Long sun shadow to the north-west.
      ctx.fillStyle = 'rgba(60,40,20,0.20)';
      ctx.fillRect(b.x - sh, b.y - sh * 0.6, b.w, b.h);
      // Walls and roof.
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(b.x, b.y, b.w, 6);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(b.x, b.y + b.h - 8, b.w, 8);
      // Windows.
      ctx.fillStyle = 'rgba(40,60,90,0.55)';
      for (let wx = b.x + 12; wx < b.x + b.w - 12; wx += 26) {
        for (let wy = b.y + 14; wy < b.y + b.h - 12; wy += 26) {
          ctx.fillRect(wx, wy, 12, 14);
        }
      }
      if (b.roof) {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 3;
        ctx.strokeRect(b.x + 8, b.y + 8, b.w - 16, b.h - 16);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(b.x + b.w / 2 - 12, b.y + b.h / 2 - 10, 24, 20);
      }
      if (b.hotel) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.font = font(15, true);
        ctx.textAlign = 'center';
        ctx.fillText('HOTEL', b.x + b.w / 2 + 1, b.y + 25);
        ctx.fillStyle = '#fff';
        ctx.fillText('HOTEL', b.x + b.w / 2, b.y + 24);
      }
    }
    // Named place labels, small and warm.
    ctx.font = font(13, true);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(60,40,20,0.75)';
    ctx.fillText("MARISOL'S GARAGE", PLACES.garage.x, PLACES.garage.y - 14);
    ctx.fillText('SOLMAR NATIONAL BANK', PLACES.bank.x, PLACES.bank.y - 14);
    ctx.fillText('HOTEL MIRAMAR', PLACES.hotel.x, PLACES.hotel.y - 14);
    ctx.fillText('OLD PIER', PLACES.pier.x, PLACES.pier.y - 14);
  }

  function drawPalm(p, t) {
    const sway = Math.sin(t * 0.8 + p.y * 0.01) * 2;
    ctx.strokeStyle = '#8a6b4a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(p.x + p.lean * 14, p.y - 16, p.x + p.lean * 20 + sway, p.y - 30 * p.s);
    ctx.stroke();
    const tx = p.x + p.lean * 20 + sway;
    const ty = p.y - 30 * p.s;
    ctx.strokeStyle = '#4e9b47';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + p.lean;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + Math.cos(a) * 12, ty + Math.sin(a) * 12 - 4, tx + Math.cos(a) * 22, ty + Math.sin(a) * 22 + 6);
      ctx.stroke();
    }
    ctx.fillStyle = '#7a5c2e';
    ctx.beginPath();
    ctx.arc(tx, ty, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCarShape(car, t) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(-22, -8, 46, 24, 6);
    ctx.fill();
    // Body.
    ctx.fillStyle = car.color;
    roundRect(-23, -11, 46, 22, 7);
    ctx.fill();
    // Roof and windows.
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    roundRect(-8, -9, 18, 18, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,40,70,0.7)';
    ctx.fillRect(8, -8, 6, 16);
    ctx.fillRect(-14, -8, 4, 16);
    // Headlights.
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(21, -8, 3, 4);
    ctx.fillRect(21, 4, 3, 4);
    // Taillights.
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(-23, -8, 3, 4);
    ctx.fillRect(-23, 4, 3, 4);
    if (car.kind === 'police') {
      ctx.fillStyle = '#1d3557';
      ctx.fillRect(-4, -11, 10, 22);
      ctx.fillStyle = '#fff';
      ctx.font = font(9, true);
      ctx.textAlign = 'center';
      ctx.fillText('PD', 1, 3);
      // Flashing light bar.
      const flash = Math.floor(t * 4 + (car.sirenPhase || 0)) % 2 === 0;
      ctx.fillStyle = flash ? '#ff3b30' : '#2f6df6';
      ctx.beginPath();
      ctx.arc(-2, -11, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = flash ? '#2f6df6' : '#ff3b30';
      ctx.beginPath();
      ctx.arc(6, -11, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (car.smoke) {
      ctx.fillStyle = 'rgba(120,120,120,0.5)';
      ctx.beginPath();
      ctx.arc(-10 + Math.sin(t * 3) * 4, -14 - (t % 1) * 10, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPerson(x, y, angle, shirt, skin, t, phase, scale) {
    const s = scale || 1;
    const bob = Math.sin(phase) * 2 * s;
    ctx.save();
    ctx.translate(x, y);
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 8 * s, 9 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body.
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.arc(0, 0, 8 * s, 0, Math.PI * 2);
    ctx.fill();
    // Head.
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * 3, Math.sin(angle) * 3 - 2 * s + bob * 0.3, 5.5 * s, 0, Math.PI * 2);
    ctx.fill();
    // Facing tick.
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * 8 * s, Math.sin(angle) * 8 * s);
    ctx.lineTo(Math.cos(angle) * 13 * s, Math.sin(angle) * 13 * s);
    ctx.stroke();
    ctx.restore();
  }

  function drawMarker(state, t) {
    const m = state.missions.target();
    if (!m) return;
    const pulse = 1 + Math.sin(t * 4) * 0.15;
    const r = 26 * pulse;
    ctx.save();
    ctx.translate(m.x, m.y);
    // Beam of light.
    ctx.fillStyle = 'rgba(255,210,62,0.18)';
    ctx.fillRect(-6, -160, 12, 160);
    // Pulsing diamond.
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffd23e';
    ctx.strokeStyle = '#7a5c00';
    ctx.lineWidth = 2;
    ctx.fillRect(-r / 2, -r / 2, r, r);
    ctx.strokeRect(-r / 2, -r / 2, r, r);
    ctx.restore();
    ctx.fillStyle = '#7a5c00';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawOffscreenArrow(state, cam) {
    const m = state.missions.target();
    if (!m) return;
    const x0 = cam.x - VIEW.width / 2;
    const y0 = cam.y - VIEW.height / 2;
    if (m.x > x0 && m.x < x0 + VIEW.width && m.y > y0 && m.y < y0 + VIEW.height) return;
    const cx = VIEW.width / 2;
    const cy = VIEW.height / 2;
    const angle = Math.atan2(m.y - cam.y, m.x - cam.x);
    const ax = cx + Math.cos(angle) * 300;
    const ay = cy + Math.sin(angle) * 210;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);
    ctx.fillStyle = '#ffd23e';
    ctx.strokeStyle = '#7a5c00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-10, -12);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    const dist = Math.round(Math.hypot(m.x - state.player.x, m.y - state.player.y) / 10) * 10;
    text(`${dist}m`, ax, ay - 18, 14, '#ffd23e', 'center', true);
  }

  function drawMinimap(state) {
    const sx = MINIMAP.w / WORLD.width;
    const sy = MINIMAP.h / WORLD.height;
    ctx.save();
    ctx.fillStyle = 'rgba(10,10,12,0.72)';
    roundRect(MINIMAP.x - 6, MINIMAP.y - 6, MINIMAP.w + 12, MINIMAP.h + 12, 8);
    ctx.fill();
    ctx.beginPath();
    roundRect(MINIMAP.x, MINIMAP.y, MINIMAP.w, MINIMAP.h, 4);
    ctx.clip();
    // Sea and sand.
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(MINIMAP.x, MINIMAP.y, MINIMAP.w, MINIMAP.h);
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(MINIMAP.x + BEACH_X * sx, MINIMAP.y, MINIMAP.w - BEACH_X * sx, MINIMAP.h);
    // City ground.
    ctx.fillStyle = '#8a7a5c';
    ctx.fillRect(MINIMAP.x, MINIMAP.y, BEACH_X * sx, MINIMAP.h);
    // Roads.
    ctx.strokeStyle = '#d8d2c4';
    ctx.lineWidth = 2;
    for (const ax of AVENUES) {
      ctx.beginPath();
      ctx.moveTo(MINIMAP.x + ax * sx, MINIMAP.y);
      ctx.lineTo(MINIMAP.x + ax * sx, MINIMAP.y + MINIMAP.h);
      ctx.stroke();
    }
    for (const sy2 of STREETS) {
      ctx.beginPath();
      ctx.moveTo(MINIMAP.x, MINIMAP.y + sy2 * sy);
      ctx.lineTo(MINIMAP.x + MINIMAP.w, MINIMAP.y + sy2 * sy);
      ctx.stroke();
    }
    // Buildings as small blocks, so the minimap reads as a city, not a grid.
    ctx.fillStyle = 'rgba(60,45,30,0.55)';
    for (const b of state.city.buildings) {
      ctx.fillRect(MINIMAP.x + b.x * sx, MINIMAP.y + b.y * sy, Math.max(2, b.w * sx), Math.max(2, b.h * sy));
    }
    // Mission marker.
    const m = state.missions.target();
    if (m) {
      const pulse = 1 + Math.sin(state.elapsed * 5) * 0.3;
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.arc(MINIMAP.x + m.x * sx, MINIMAP.y + m.y * sy, 4 * pulse + 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Police: flashing blue/red dots.
    const flash = Math.floor(state.elapsed * 4) % 2 === 0;
    for (const car of state.police.police) {
      ctx.fillStyle = flash ? '#ff3b30' : '#2f6df6';
      ctx.beginPath();
      ctx.arc(MINIMAP.x + car.x * sx, MINIMAP.y + car.y * sy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow, big and white with a dark edge.
    const p = state.player;
    ctx.save();
    ctx.translate(MINIMAP.x + p.x * sx, MINIMAP.y + p.y * sy);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundRect(MINIMAP.x - 6, MINIMAP.y - 6, MINIMAP.w + 12, MINIMAP.h + 12, 8);
    ctx.stroke();
  }

  function drawHud(state, extras) {
    const p = state.player;
    ctx.textBaseline = 'alphabetic';
    // Cash + health, top left.
    ctx.fillStyle = PALETTE.hudPanel;
    roundRect(14, 12, 250, 62, 10);
    ctx.fill();
    textShadowed(`$${state.cash.toLocaleString('en-US')}`, 28, 40, 26, '#7dff8a', 'left', true);
    // Health bar.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(28, 50, 180, 12, 6);
    ctx.fill();
    ctx.fillStyle = p.health > 40 ? '#4ade80' : '#ef4444';
    roundRect(28, 50, 180 * Math.max(0, p.health / 100), 12, 6);
    ctx.fill();
    text('HP', 212, 61, 12, PALETTE.text, 'left', true);
    // Wanted stars, top centre.
    const stars = state.wanted;
    ctx.fillStyle = PALETTE.hudPanel;
    roundRect(VIEW.width / 2 - 100, 12, 200, 34, 10);
    ctx.fill();
    for (let i = 0; i < 5; i += 1) {
      ctx.font = font(22, true);
      ctx.textAlign = 'center';
      ctx.fillStyle = i < stars ? PALETTE.star : 'rgba(255,255,255,0.25)';
      ctx.fillText('★', VIEW.width / 2 - 80 + i * 40, 37);
    }
    // Clock under the stars.
    const hh = Math.floor(state.clockMinutes / 60);
    const mm = Math.floor(state.clockMinutes % 60);
    const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    textShadowed(clock, VIEW.width / 2, 66, 16, PALETTE.text, 'center', true);
    // Objective panel, left under the cash.
    const m = state.missions;
    ctx.fillStyle = PALETTE.hudPanel;
    roundRect(14, 84, 300, 64, 10);
    ctx.fill();
    textShadowed(m.title(), 26, 106, 15, PALETTE.hudAccent, 'left', true);
    text(m.objective(), 26, 130, 14, PALETTE.text, 'left');
    if (m.timer > 0) {
      textShadowed(`${Math.ceil(m.timer)}s`, 300, 106, 20, m.timer < 15 ? '#ff6b6b' : '#fff', 'right', true);
    }
    if (m.currentStep() && m.currentStep().kind === 'grab' && m.grabTimer > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(26, 138, 276, 8, 4);
      ctx.fill();
      ctx.fillStyle = '#ffd23e';
      roundRect(26, 138, 276 * Math.min(1, m.grabTimer / 3), 8, 4);
      ctx.fill();
    }
    // Minimap.
    drawMinimap(state);
    // Speed + ammo, bottom right.
    if (p.car) {
      const kmh = Math.round(Math.abs(p.car.speed) * 0.24);
      textShadowed(`${kmh}`, VIEW.width - 24, VIEW.height - 44, 44, '#fff', 'right', true);
      textShadowed('km/h', VIEW.width - 24, VIEW.height - 22, 14, PALETTE.muted, 'right', true);
    }
    if (p.hasPistol && !p.car) {
      textShadowed(`Pistol  ${p.ammo}`, VIEW.width - 24, VIEW.height - 24, 18, '#fff', 'right', true);
    }
    // Centre message.
    if (state.messageTimer > 0 && state.message) {
      ctx.font = font(20, true);
      ctx.textAlign = 'center';
      const w = ctx.measureText(state.message).width + 36;
      ctx.fillStyle = PALETTE.hudPanel;
      roundRect(VIEW.width / 2 - w / 2, 96, w, 38, 10);
      ctx.fill();
      text(state.message, VIEW.width / 2, 122, 20, '#fff', 'center', true);
    }
    // Bust progress.
    if (state.bustProgress > 0) {
      ctx.fillStyle = PALETTE.hudPanel;
      roundRect(VIEW.width / 2 - 110, 150, 220, 30, 8);
      ctx.fill();
      text('BUSTED?', VIEW.width / 2, 171, 15, '#ff6b6b', 'center', true);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(VIEW.width / 2 - 100, 178, 200, 8, 4);
      ctx.fill();
      ctx.fillStyle = '#ff6b6b';
      roundRect(VIEW.width / 2 - 100, 178, 200 * state.bustProgress, 8, 4);
      ctx.fill();
    }
    // Controls hint, bottom left, fades after a while.
    if (extras.hintSeconds > 0) {
      const alpha = Math.min(1, extras.hintSeconds);
      ctx.globalAlpha = alpha;
      textShadowed('WASD move / drive   •   E enter & steal car   •   Click shoot   •   V punch   •   Shift run   •   P pause   •   M mute', 16, VIEW.height - 16, 13, PALETTE.muted, 'left');
      ctx.globalAlpha = 1;
    }
    if (extras.muted) textShadowed('MUTED', VIEW.width - 24, 200, 14, PALETTE.muted, 'right', true);
  }

  function drawPanel(title, lines, prompt, accent, yTop) {
    const width = 640;
    const height = 150 + lines.length * 30 + 70;
    const x = (VIEW.width - width) / 2;
    const y = yTop !== undefined ? yTop : (VIEW.height - height) / 2;
    ctx.fillStyle = 'rgba(12,10,9,0.82)';
    roundRect(x, y, width, height, 16);
    ctx.fill();
    ctx.strokeStyle = accent || PALETTE.hudAccent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundRect(x, y, width, height, 16);
    ctx.stroke();
    ctx.textBaseline = 'alphabetic';
    text(title, VIEW.width / 2, y + 66, 44, accent || PALETTE.hudAccent, 'center', true);
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], VIEW.width / 2, y + 116 + i * 30, 17, PALETTE.text, 'center');
    }
    text(prompt, VIEW.width / 2, y + height - 30, 18, PALETTE.hudAccent, 'center', true);
  }

  function drawTitle(state, extras) {
    // The city itself is the backdrop, camera drifting over the plaza.
    drawWorld(state, { x: 1840 + Math.sin(state.elapsed * 0.05) * 120, y: 1440 });
    ctx.fillStyle = 'rgba(10,8,6,0.45)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    textShadowed('SOLMAR', VIEW.width / 2, 118, 76, '#ffb347', 'center', true);
    textShadowed('A sun-soaked open-world crime story', VIEW.width / 2, 152, 22, PALETTE.text, 'center');
    const lines = [
      'You are Danny Reyes, a wheelman fresh out of the Solmar docks.',
      'Fixer Marisol Vega has six jobs for you — if you can drive,',
      'steal, shoot and vanish well enough to earn them.',
      '',
      'WASD move & drive  •  E steal / enter car  •  Click shoot  •  V punch',
      'Shift run  •  Space handbrake  •  P pause  •  M mute',
    ];
    drawPanel('Six jobs. One city.', lines, extras.hasSave ? 'Press Enter — Start new game, or C to Continue' : 'Press Enter or click to start', '#ffb347', 180);
  }

  /** Paint the world (ground, buildings, people, cars, marker, light) at a camera centre. */
  function drawWorld(state, cam) {
    const [tint, tintAlpha, shadowLen] = daylight(state.clockMinutes);
    const x0 = cam.x - VIEW.width / 2;
    const y0 = cam.y - VIEW.height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW.width, VIEW.height);
    ctx.clip();
    ctx.translate(-x0, -y0);
    drawGround(state, cam);
    drawBuildings(state, cam, shadowLen);
    const city = state.city;
    const t = state.elapsed;
    for (const palm of city.palms) {
      if (palm.x > x0 - 40 && palm.x < x0 + VIEW.width + 40 && palm.y > y0 - 40 && palm.y < y0 + VIEW.height + 40) drawPalm(palm, t);
    }
    // Pickups.
    for (const pk of state.combat.pickups) {
      if (pk.timer > 0) continue;
      ctx.save();
      ctx.translate(pk.x, pk.y + Math.sin(t * 3 + pk.x) * 2);
      ctx.fillStyle = pk.kind === 'health' ? '#fff' : '#ffd23e';
      roundRect(-11, -11, 22, 22, 5);
      ctx.fill();
      ctx.strokeStyle = '#7a5c00';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (pk.kind === 'health') {
        ctx.fillStyle = '#e63946';
        ctx.fillRect(-2.5, -7, 5, 14);
        ctx.fillRect(-7, -2.5, 14, 5);
      } else {
        ctx.fillStyle = '#7a5c00';
        ctx.font = font(11, true);
        ctx.textAlign = 'center';
        ctx.fillText('AMMO', 0, 4);
      }
      ctx.restore();
    }
    // Getaway boat on the beach.
    ctx.save();
    ctx.translate(PLACES.boat.x, PLACES.boat.y);
    ctx.rotate(-0.4);
    ctx.fillStyle = '#fff';
    roundRect(-34, -12, 68, 24, 12);
    ctx.fill();
    ctx.fillStyle = '#2f6df6';
    ctx.fillRect(-10, -8, 20, 16);
    ctx.restore();
    // Cars (traffic, parked, police, player's).
    for (const car of state.entities.cars) drawCarShape(car, t);
    for (const car of state.police.police) drawCarShape(car, t);
    // Pedestrians.
    for (const ped of state.peds) {
      drawPerson(ped.x, ped.y, ped.angle, ped.shirt, ped.skin, t, ped.walkPhase, 1);
    }
    // Thugs.
    for (const e of state.combat.enemies) {
      drawPerson(e.x, e.y, e.angle, '#c1121f', '#e0ac69', t, t * 6, 1.1);
      if (e.hitFlash > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(e.x, e.y, 12, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // The player on foot (in a car, the car is the player). A white ring keeps
    // the player findable at a glance among the pedestrians.
    const p = state.player;
    if (!p.car) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
      ctx.stroke();
      drawPerson(p.x, p.y, p.angle, '#2f6df6', '#e0ac69', t, p.moving ? t * 10 : 0, 1.15);
      if (p.hasPistol) {
        // Pistol in hand, pointing where the player aims.
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(p.angle) * 10, p.y + Math.sin(p.angle) * 10);
        ctx.lineTo(p.x + Math.cos(p.angle) * 20, p.y + Math.sin(p.angle) * 20);
        ctx.stroke();
      }
      if (state.combat.muzzle > 0) {
        ctx.fillStyle = '#ffe066';
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(p.angle) * 26, p.y + Math.sin(p.angle) * 26, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      if (p.meleeSwing > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 34, p.angle - 0.8, p.angle + 0.8);
        ctx.stroke();
      }
    }
    // Bullets.
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = 3;
    for (const b of state.combat.bullets) {
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    drawMarker(state, t);
    ctx.restore();
    // Daylight tint + vignette over everything.
    ctx.fillStyle = tint;
    ctx.globalAlpha = tintAlpha;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    ctx.globalAlpha = 1;
    const grad = ctx.createRadialGradient(
      VIEW.width / 2, VIEW.height / 2, VIEW.height * 0.45,
      VIEW.width / 2, VIEW.height / 2, VIEW.height * 0.85,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    drawOffscreenArrow(state, cam);
  }

  function draw(state, screen, extras) {
    const scale = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#0b0a09';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    const p = state.player;
    const cam = {
      x: clamp(p.x, VIEW.width / 2, WORLD.width - VIEW.width / 2),
      y: clamp(p.y, VIEW.height / 2, WORLD.height - VIEW.height / 2),
    };
    if (screen === SCREEN_TITLE) {
      drawTitle(state, extras);
      return;
    }
    drawWorld(state, cam);
    if (screen === SCREEN_PLAY) {
      drawHud(state, extras);
      return;
    }
    drawHud(state, extras);
    if (screen === SCREEN_PAUSED) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
      drawPanel('Paused', [
        'The city waits for you.',
        'S — save game      M — mute      P — resume',
      ], 'Press P to keep driving', '#fff');
    } else if (screen === SCREEN_OVER) {
      ctx.fillStyle = 'rgba(120,0,0,0.35)';
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
      drawPanel('WASTED', [
        'The Solmar docks will remember you.',
        'The hospital patched you up — for a price.',
      ], 'Press Enter to get back out there', '#ff6b6b');
    } else if (screen === SCREEN_BUSTED) {
      ctx.fillStyle = 'rgba(0,0,80,0.35)';
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
      drawPanel('BUSTED', [
        'The Solmar PD caught up with you.',
        'Fines paid. The heat is off — for now.',
      ], 'Press Enter to get back out there', '#7aa2ff');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, resize };
}
