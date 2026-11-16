// HUD + overlay screens (DOM). Layout follows GDD section 10.
import { MATCH, WEAPONS, EQUIPMENT, TEAM_NAME } from './config.js';
import { BOUNDS, SITES } from './map.js';
import { audio } from './audio.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtT = t => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const WICON = { ak: 'AK', m4: 'M4', pistol: 'P9', heavy: 'R50' };

export class HUD {
  constructor() {
    this.toastT = 0; this.centerT = 0; this.hitT = 0; this.shakeAmt = 0; this.flashAmt = 0; this.buyOpen = false; this.dmg = []; this.slowT = 0;
    this.radar = $('radar').getContext('2d'); this.radarBg = null;
    this.buildBuyMenu();
  }
  bindGame(game, player) { this.g = game; this.p = player; }
  show(id, on = true) { $(id).hidden = !on; }
  toast(msg, secs = 2.2) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); this.toastT = secs; }
  center(big, small, secs = 2) { $('centerBig').textContent = big; $('centerSmall').textContent = small || ''; $('centerMsg').classList.add('on'); this.centerT = secs; }
  hitmarker(head, downed) { const h = $('hitmarker'); h.className = 'on' + (head ? ' head' : '') + (downed ? ' downed' : ''); this.hitT = 0.18; }
  damageFrom(pos) { this.dmg.push({ pos: pos.clone(), t: 1.2 }); if (this.dmg.length > 6) this.dmg.shift(); }
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }
  flash(a) { this.flashAmt = Math.max(this.flashAmt, a); }

  feed(att, v, def, how, g) {
    const box = $('killfeed'), el = document.createElement('div'); el.className = 'kf';
    const nm = x => x ? `<b class="${x.team}${x.isPlayer ? ' me' : ''}">${esc(x.name)}</b>` : '';
    let mid = '', cls = '';
    if (how === 'rescue') { mid = '<i class="tag res">RESCUED</i>'; cls = 'rescue'; }
    else if (how === 'plant') mid = '<i class="tag gold">PLANTED THE EXPLOSIVE</i>';
    else if (how === 'defuse') mid = '<i class="tag gold">DEFUSED</i>';
    else if (how === 'down') { mid = `<i class="w">${def ? WICON[def.id] : 'FRAG'}</i><i class="tag down">DOWNED</i>`; cls = 'downed'; }
    else { const w = def ? WICON[def.id] : how === 'bledout' ? '' : 'BLAST'; const tags = { headshot: '<i class="tag hs">HEADSHOT</i>', 'finished-hs': '<i class="tag">FINISHED</i>', finished: '<i class="tag">FINISHED</i>', bledout: '<i class="tag down">BLED OUT</i>', catastrophic: '', second: '<i class="tag hs">NO SECOND CHANCE</i>' }; mid = (w ? `<i class="w">${w}</i>` : '') + (tags[how] || ''); }
    if ((att && att.isPlayer) || (v && v.isPlayer)) el.classList.add('mine');
    el.innerHTML = `${how === 'bledout' && !att ? '' : nm(att)} ${mid} ${nm(v)}`; if (cls) el.classList.add(cls); box.prepend(el);
    setTimeout(() => el.classList.add('fade'), 6000); setTimeout(() => el.remove(), 6800); while (box.children.length > 6) box.lastChild.remove();
  }
  roundStart(g) {
    this.show('summary', false); this.show('downedScreen', false); this.show('specLabel', false); $('deathInfo').hidden = true;
    const side = g.player.team; this.center(`ROUND ${g.roundNo}`, `${TEAM_NAME[side]} · buy phase — press B`, 2.4);
    if (this.p) this.p.specIdx = 0;
  }
  onPlayerDeath(killer, how) {
    const d = $('deathInfo'); d.hidden = false;
    d.innerHTML = killer && !killer.isPlayer ? `Eliminated by <b class="${killer.team}">${esc(killer.name)}</b> · ${{ headshot: 'lethal headshot', catastrophic: 'catastrophic damage', second: 'already rescued once this round', bledout: 'bled out', finished: 'finished while downed', 'finished-hs': 'finished while downed', roundend: 'round ended while downed' }[how] || ''}` : `You were eliminated${how === 'bledout' ? ' — bled out' : ''}`;
  }
  roundSummary(g) {
    const r = g.result, me = g.player, won = r.winSquad === 0; const box = $('summary');
    const mates = g.actors.filter(a => a.squad === 0); const mvp = g.actors.filter(a => a.squad === r.winSquad).sort((x, y) => (y.round.k * 100 + y.round.dmg + y.round.rescues * 80) - (x.round.k * 100 + x.round.dmg + x.round.rescues * 80))[0];
    box.innerHTML = `<div class="sumHead ${won ? 'win' : 'loss'}"><span>${won ? 'ROUND WON' : 'ROUND LOST'}</span><small>${esc(r.reason)}</small></div>
      <div class="sumScore"><b class="${g.sideOf(0)}">${g.score[0]}</b><i>—</i><b class="${g.sideOf(1)}">${g.score[1]}</b></div>
      <div class="sumGrid">
        <div><label>Your kills</label><b>${me.round.k}</b></div><div><label>Rescues</label><b>${me.round.rescues}</b></div><div><label>Damage</label><b>${Math.round(me.round.dmg)}</b></div><div><label>Earned</label><b class="gold">+$${me.round.earned}</b></div>
      </div>
      <div class="sumTeam">${mates.map(a => `<div class="${a.isPlayer ? 'me' : ''}"><span>${esc(a.name)}</span><span>${a.round.k}K · ${a.round.rescues}R · ${Math.round(a.round.dmg)} dmg</span><span class="gold">$${a.money}</span></div>`).join('')}</div>
      ${mvp ? `<div class="mvp">ROUND MVP · <b class="${mvp.team}">${esc(mvp.name)}</b> — ${mvp.round.k} kills, ${Math.round(mvp.round.dmg)} damage${mvp.round.rescues ? `, ${mvp.round.rescues} rescue` : ''}</div>` : ''}
      <div class="sumFoot">Next round in a few seconds · loss bonus now $${Math.min(MATCH.LOSS_MAX, MATCH.LOSS_BASE + MATCH.LOSS_STEP * Math.max(0, g.lossStreak[0] - 1))}${g.roundNo === MATCH.HALF_ROUNDS ? ' · <b>HALF-TIME: sides switch</b>' : ''}</div>`;
    box.hidden = false;
  }
  matchOver(g) {
    if (document.pointerLockElement) document.exitPointerLock();
    const won = g.score[0] > g.score[1], me = g.player; const box = $('matchOver');
    box.querySelector('.moHead').innerHTML = `<span class="${won ? 'win' : 'loss'}">${won ? 'VICTORY' : 'DEFEAT'}</span><div class="moScore">${g.score[0]} — ${g.score[1]}</div>`;
    box.querySelector('.moBoard').innerHTML = this.boardHTML(g);
    box.querySelector('.moStats').innerHTML = `Your match: <b>${me.stats.k}</b> kills · <b>${me.stats.d}</b> deaths · <b>${me.stats.rescues}</b> rescues · <b>${Math.round(me.stats.dmg)}</b> damage · <b>${me.stats.hs}</b> headshot kills`;
    this.show('summary', false); box.hidden = false; if (this.onMatchOver) this.onMatchOver(won);
  }
  boardHTML(g) {
    const row = a => `<tr class="${a.isPlayer ? 'me' : ''} ${a.state}"><td><i class="dot ${a.team}"></i>${esc(a.name)}</td><td class="st ${a.condition.toLowerCase()}">${a.condition}</td><td>${a.stats.k}</td><td>${a.stats.d}</td><td>${a.stats.a}</td><td>${a.stats.d ? (a.stats.k / a.stats.d).toFixed(2) : a.stats.k.toFixed(2)}</td><td>${a.stats.rescues}</td><td>${Math.round(a.stats.dmg)}</td><td>${a.squad === 0 ? '$' + a.money : '—'}</td></tr>`;
    const tbl = sq => { const side = g.sideOf(sq); const list = g.actors.filter(a => a.squad === sq).sort((x, y) => y.stats.k - x.stats.k || y.stats.dmg - x.stats.dmg); return `<div class="sbTeam ${side}"><div class="sbHead"><b>${sq === 0 ? 'YOUR TEAM' : 'ENEMY TEAM'}</b><span>${TEAM_NAME[side]}</span><em>${g.score[sq]}</em></div><table><thead><tr><th>Player</th><th>Status</th><th>K</th><th>D</th><th>A</th><th>K/D</th><th>Rescues</th><th>Damage</th><th>Money</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`; };
    return tbl(0) + tbl(1);
  }
  // ---------------------------------------------------------------- buy menu
  buildBuyMenu() {
    const cats = [['Rifles', ['ak', 'm4']], ['Pistols', ['pistol', 'heavy']], ['Protection', ['armor', 'helmet']], ['Medical', ['medkit', 'bandage', 'tourniquet']], ['Tactical', ['smoke', 'flash', 'frag']], ['Ammunition', ['resupply']]];
    const desc = { ak: '36 dmg · 600 rpm · one-tap headshot through helmet', m4: '33 dmg · 666 rpm · controllable spray', pistol: 'Free sidearm · 12 rounds', heavy: '53 dmg · 7 rounds · heavy recoil', armor: 'Vest: reduces chest & arm damage', helmet: 'Reduces head damage', medkit: 'Revive a downed teammate (6s) or heal +45', bandage: 'Stops light bleeding (2.5s)', tourniquet: 'Stops heavy limb bleeding (2s)', smoke: 'Blocks vision for 15s', flash: 'Blinds anyone looking at it', frag: 'Explodes after 1.7s · downs at close range', resupply: 'Refill all magazines of your weapons' };
    let key = 0; const keys = '1234567890-=['.split(''); this.buyKeys = {};
    $('buyGrid').innerHTML = cats.map(([c, items]) => `<div class="bcat"><h4>${c}</h4>${items.map(it => { const d = WEAPONS[it] || EQUIPMENT[it]; const k = keys[key++]; this.buyKeys[k] = it; return `<button class="bitem" data-item="${it}"><kbd>${k}</kbd><span class="bn">${d.name}</span><span class="bp">${d.price ? '$' + d.price : 'FREE'}</span><small>${desc[it]}</small><i class="owned">OWNED</i></button>`; }).join('')}</div>`).join('');
    $('buyGrid').addEventListener('click', e => { const b = e.target.closest('.bitem'); if (b) this.doBuy(b.dataset.item); });
    addEventListener('keydown', e => { if (this.buyOpen && this.buyKeys[e.key]) { e.preventDefault(); this.doBuy(this.buyKeys[e.key]); } });
  }
  doBuy(item) { const r = this.g.buy(this.g.player, item); if (r.ok) audio.buy(); else { audio.empty(); this.toast(r.msg); } this.refreshBuy(); }
  refreshBuy() {
    const a = this.g.player; $('buyMoney').textContent = '$' + a.money; $('buyTimer').textContent = this.g.phase === 'buy' || this.g.phase === 'prep' ? `Buy time ${fmtT(this.g.phase === 'buy' ? this.g.timer + MATCH.PREP_TIME : this.g.timer)}` : 'Buy phase over';
    for (const b of document.querySelectorAll('.bitem')) {
      const it = b.dataset.item, d = WEAPONS[it] || EQUIPMENT[it];
      const owned = WEAPONS[it] ? (a.primary && a.primary.id === it) || (a.secondary && a.secondary.id === it) : it === 'armor' ? a.armor >= 100 : it === 'helmet' ? a.helmet : ['smoke', 'flash', 'frag'].includes(it) ? a.nades[it] >= d.max : it === 'resupply' ? false : a[it] >= d.max;
      b.classList.toggle('isOwned', !!owned); b.classList.toggle('poor', !owned && a.money < d.price);
      const cnt = ['smoke', 'flash', 'frag'].includes(it) ? a.nades[it] : ['medkit', 'bandage', 'tourniquet'].includes(it) ? a[it] : 0; b.querySelector('.owned').textContent = cnt && !owned ? `x${cnt}` : 'OWNED'; b.classList.toggle('hasSome', !!cnt && !owned);
    }
  }
  setBuy(open) { this.buyOpen = open; $('buy').hidden = !open; if (open) this.refreshBuy(); }

  // ---------------------------------------------------------------- per-frame
  update(dt) {
    const g = this.g, a = g.player; if (!g || !a) return;
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('on'); }
    if (this.centerT > 0) { this.centerT -= dt; if (this.centerT <= 0) $('centerMsg').classList.remove('on'); }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) $('hitmarker').className = ''; }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5); this.flashAmt = Math.max(0, this.flashAmt - dt);
    $('flashOverlay').style.opacity = Math.min(1, this.flashAmt / 1.2).toFixed(3);
    // top center
    const s0 = g.sideOf(0), s1 = g.sideOf(1); $('scL').textContent = g.score[0]; $('scR').textContent = g.score[1]; $('scLName').textContent = 'YOU · ' + TEAM_NAME[s0]; $('scRName').textContent = TEAM_NAME[s1];
    $('scLbox').className = 'scbox ' + s0; $('scRbox').className = 'scbox ' + s1;
    const phaseName = { buy: 'BUY PHASE', prep: 'PREPARATION', live: '', post: 'ROUND OVER', over: 'MATCH OVER' }[g.phase];
    const b = g.bomb; let timer = g.timer, bombTxt = '';
    if (b.state === 'planted') { timer = b.timer; bombTxt = `EXPLOSIVE PLANTED · ${b.site}`; } else if (b.state === 'dropped') bombTxt = 'EXPLOSIVE DROPPED'; else if (b.state === 'defused') bombTxt = 'DEFUSED'; else if (b.state === 'exploded') bombTxt = 'DETONATED';
    $('timer').textContent = g.phase === 'post' || g.phase === 'over' ? '0:00' : fmtT(g.phase === 'buy' ? timer : timer); $('timer').classList.toggle('bomb', b.state === 'planted'); $('timer').classList.toggle('low', b.state !== 'planted' && g.phase === 'live' && g.timer < 15);
    $('roundNo').textContent = `ROUND ${g.roundNo} · FIRST TO ${MATCH.ROUNDS_TO_WIN}`; $('phase').textContent = bombTxt || phaseName;
    $('phase').className = b.state === 'planted' ? 'bomb' : '';
    this.slowT -= dt; if (this.slowT <= 0) { this.slowT = 0.1; this.slow(); }
    // crosshair
    const w = a.weapon; const gap = 4 + (w ? g.inaccuracy(a) * 900 : 6); const ch = $('crosshair'); ch.style.setProperty('--gap', Math.min(40, gap).toFixed(1) + 'px'); ch.hidden = a.state !== 'alive' || a.sprinting || this.buyOpen || !!a.action || !!a.reviving || !!a.dragging;
    // prompt + progress
    const pr = this.p.prompt(); const pe = $('prompt'), pb = $('progress');
    if (pr && pr.label) { pb.hidden = false; pb.querySelector('span').textContent = pr.label; pb.querySelector('i').style.width = (Math.min(1, pr.frac) * 100).toFixed(1) + '%'; pe.hidden = true; } else { pb.hidden = true; pe.hidden = !pr; if (pr) pe.textContent = pr.text; }
    // damage direction
    const dd = $('dmgDirs'); let html = ''; for (const d of this.dmg) { d.t -= dt; if (d.t <= 0) continue; const ang = Math.atan2(-(d.pos.x - a.pos.x), -(d.pos.z - a.pos.z)) - a.yaw; html += `<i style="transform:rotate(${(-ang * 180 / Math.PI).toFixed(1)}deg);opacity:${Math.min(1, d.t).toFixed(2)}"></i>`; } this.dmg = this.dmg.filter(d => d.t > 0); dd.innerHTML = html;
    // vignette / downed
    const low = a.state === 'alive' && a.hp < 35 ? (1 - a.hp / 35) * 0.7 + 0.15 : 0; $('vignette').style.opacity = a.state === 'downed' ? 0.95 : low.toFixed(2);
    const dn = a.state === 'downed'; $('downedScreen').hidden = !dn;
    if (dn) { $('bleedTimer').textContent = Math.max(0, a.bleedout).toFixed(1); $('bleedBar').style.width = (Math.max(0, a.bleedout) / MATCH.BLEEDOUT * 100).toFixed(1) + '%'; $('downedStatus').textContent = a.revivedBy ? `${a.revivedBy.name} is reviving you…` : a.draggedBy ? `${a.draggedBy.name} is dragging you to cover` : a.rescuer && a.rescuer.state === 'alive' ? `${a.rescuer.name} is coming to help` : 'Crawl to cover [WASD] · [F] call for help'; if (Math.floor(g.time * 1.2) !== this.hb) { this.hb = Math.floor(g.time * 1.2); audio.heartbeat(); } }
    $('specLabel').hidden = a.state !== 'dead' || g.phase === 'over'; if (a.state === 'dead') { const t = this.p.specTarget; $('specName').textContent = t ? `${t.name} · ${t.condition} · ${g.area(t)}` : 'No teammates left'; }
    this.drawRadar();
  }
  slow() { // 10 Hz parts
    const g = this.g, a = g.player, w = a.weapon;
    $('hpNum').textContent = Math.max(0, Math.ceil(a.state === 'downed' ? 0 : a.hp)); $('hpBar').style.width = Math.max(0, a.hp) + '%'; $('hpBar').className = a.hp < 35 ? 'crit' : a.hp < 70 ? 'wound' : '';
    $('armorNum').textContent = Math.ceil(a.armor); $('armorBox').classList.toggle('none', a.armor <= 0); $('helmetBox').classList.toggle('none', !a.helmet);
    const cond = a.condition; $('cond').textContent = cond.toUpperCase(); $('cond').className = cond.toLowerCase();
    for (const z of ['head', 'chest', 'larm', 'rarm', 'lleg', 'rleg']) document.getElementById('bd-' + z).classList.toggle('hurt', !!(a.inj && a.inj[z]));
    $('body').classList.toggle('bleeding', !!a.bleed); const bl = $('bleedWarn'); bl.hidden = !a.bleed || a.state !== 'alive'; bl.textContent = a.bleed === 2 ? `HEAVY BLEEDING −${a.bleedRate}/s · [V] TOURNIQUET` : `BLEEDING −${a.bleedRate}/s · [X] BANDAGE`;
    const injTxt = []; if (a.legHurt) injTxt.push('LEG: slowed, no sprint'); if (a.armHurt) injTxt.push('ARM: recoil + sway'); if (a.revived) injTxt.push('RESCUED — no second chance'); $('injText').textContent = injTxt.join(' · ');
    // weapon panel
    if (a.slot === 3 && a.nadeKind) { $('wName').textContent = EQUIPMENT[a.nadeKind].name.toUpperCase(); $('mag').textContent = a.nades[a.nadeKind]; $('magCap').textContent = 'LMB throw · RMB lob'; $('mags').innerHTML = ''; }
    else if (w) { $('wName').textContent = w.def.name; $('mag').textContent = w.mag; $('mag').classList.toggle('low', w.mag <= w.def.mag * 0.25); $('magCap').textContent = a.reloadT > 0 ? 'RELOADING…' : `/ ${w.def.mag}`; $('mags').innerHTML = w.reserve.length ? w.reserve.map(m => `<i title="${m}"><b style="height:${(m / w.def.mag * 100).toFixed(0)}%"></b></i>`).join('') + `<span>${w.reserve.length} MAG${w.reserve.length > 1 ? 'S' : ''}</span>` : '<span class="out">NO SPARE MAGS</span>'; }
    const eq = [['frag', 'FRAG', a.nades.frag], ['smoke', 'SMOKE', a.nades.smoke], ['flash', 'FLASH', a.nades.flash], ['med', 'MEDKIT [H]', a.medkit], ['band', 'BANDAGE [X]', a.bandage], ['tq', 'TOURNIQUET [V]', a.tourniquet]];
    $('equip').innerHTML = eq.map(([k, n, c]) => `<span class="eq ${c ? '' : 'zero'} ${a.slot === 3 && a.nadeKind === k ? 'sel' : ''}">${n}${c > 1 ? ' ×' + c : ''}</span>`).join('') + (a.hasBomb ? '<span class="eq bombEq">EXPLOSIVE</span>' : '');
    $('slots').innerHTML = [[1, a.primary ? a.primary.def.short : '—'], [2, a.secondary.def.short], [3, 'NADES']].map(([s, n]) => `<span class="${a.slot === s ? 'sel' : ''}">${s} ${n}</span>`).join('');
    $('money').textContent = '$' + a.money; $('area').textContent = g.area(a).toUpperCase();
    // team status
    const mates = g.actors.filter(x => x.squad === 0);
    $('teamList').innerHTML = mates.map(x => { const c = x.condition; const hp = x.state === 'alive' ? Math.max(0, x.hp) : 0; return `<div class="tm ${c.toLowerCase()} ${x.isPlayer ? 'me' : ''}"><div class="tmTop"><b>${esc(x.name)}</b><span>${c === 'Downed' ? 'DOWNED ' + Math.max(0, x.bleedout).toFixed(0) + 's' : c.toUpperCase()}</span></div><div class="tmBar"><i style="width:${hp}%"></i></div><div class="tmBot">${x.state !== 'dead' ? `${x.primary ? x.primary.def.short : x.secondary.def.short}${x.medkit ? ' · MED' : ''}${x.hasBomb ? ' · BOMB' : ''} · ${esc(g.area(x))}` : 'OUT'}</div></div>`; }).join('');
    // alive pips
    const pip = sq => g.actors.filter(x => x.squad === sq).map(x => `<i class="${x.state === 'dead' ? 'dead' : x.state === 'downed' ? 'down' : ''}"></i>`).join('');
    $('pipsL').innerHTML = pip(0); $('pipsR').innerHTML = pip(1);
    // scoreboard
    const tabHeld = this.p.held('Tab'); $('scoreboard').hidden = !tabHeld || g.phase === 'over'; if (tabHeld) $('scoreboard').innerHTML = `<div class="sbTitle">WAREHOUSE 01 · OPERATIONS · ROUND ${g.roundNo}</div>` + this.boardHTML(g);
    if (this.buyOpen) this.refreshBuy();
    $('buyHint').hidden = !(g.phase === 'buy' || g.phase === 'prep') || this.buyOpen || a.state !== 'alive';
  }
  drawRadar() {
    const g = this.g, c = this.radar, S = 200, sc = S / 88, me = g.player; const toX = x => (x - BOUNDS.x0) * sc, toY = z => (z - BOUNDS.z0) * sc * (S / (80 * sc)) * (80 / 88);
    const ty = z => (z - BOUNDS.z0) * sc + (S - 80 * sc) / 2;
    if (!this.radarBg) {
      const off = document.createElement('canvas'); off.width = off.height = S; const o = off.getContext('2d'); o.fillStyle = 'rgba(23,26,29,.82)'; o.fillRect(0, 0, S, S);
      o.fillStyle = 'rgba(213,166,74,.14)'; for (const s of Object.values(SITES)) { o.fillRect(toX(s.x0), ty(s.z0), (s.x1 - s.x0) * sc, (s.z1 - s.z0) * sc); }
      o.fillStyle = '#5d6772'; for (const k of g.map.colliders) { if (k.kind === 'floor' || k.barrier || k.max[1] < 0.9 || k.min[1] > 2) continue; o.fillRect(toX(k.min[0]), ty(k.min[2]), Math.max(1, (k.max[0] - k.min[0]) * sc), Math.max(1, (k.max[2] - k.min[2]) * sc)); }
      o.font = '900 16px "NSC Display", sans-serif'; o.fillStyle = 'rgba(213,166,74,.9)'; o.textAlign = 'center'; for (const s of Object.values(SITES)) o.fillText(s.name, toX(s.cx), ty(s.cz) + 6);
      this.radarBg = off;
    }
    c.clearRect(0, 0, S, S); c.drawImage(this.radarBg, 0, 0);
    const b = g.bomb; if (b.state === 'dropped' || b.state === 'planted') { c.fillStyle = b.state === 'planted' && Math.floor(g.time * 4) % 2 ? '#ff4040' : '#d5a64a'; c.fillRect(toX(b.pos.x) - 3, ty(b.pos.z) - 3, 6, 6); }
    for (const x of g.actors) {
      if (x.state === 'dead') continue; const mine = x.squad === 0; const seen = mine || g.actors.some(o => o.squad === 0 && o.brain && o.brain.target === x) || (x.lastShotSeen && g.time - x.lastShot < 0.6 && false);
      if (!seen) continue; const px = toX(x.pos.x), py = ty(x.pos.z);
      c.fillStyle = x.team === 'atk' ? '#e58a2e' : '#3f8fe0'; if (x.state === 'downed') c.fillStyle = '#d8433b';
      if (x.isPlayer) { c.save(); c.translate(px, py); c.rotate(-x.yaw); c.fillStyle = '#e7e9eb'; c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 4); c.lineTo(0, 2); c.lineTo(-4, 4); c.closePath(); c.fill(); c.restore(); continue; }
      c.beginPath(); c.arc(px, py, mine ? 3 : 3.2, 0, 7); c.fill(); if (!mine) { c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke(); }
      if (x.hasBomb) { c.strokeStyle = '#d5a64a'; c.lineWidth = 1.5; c.beginPath(); c.arc(px, py, 5.5, 0, 7); c.stroke(); }
    }
    if (g.pingT > 0) { c.strokeStyle = '#d5a64a'; c.lineWidth = 2; c.beginPath(); c.arc(toX(g.pingMesh.position.x), ty(g.pingMesh.position.z), 5 + Math.sin(g.time * 8) * 2, 0, 7); c.stroke(); }
  }
}
