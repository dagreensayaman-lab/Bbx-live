/* ===== BBX ÉCOUTE : ce que les autres pages (BBX Classroom…) utilisent du moteur de BBX Hero =====
   Ce morceau est assemblé avec ry-engine.js, hero-core.js et sndmodel.json par moteur/fabriquer.js.
   Propriétaire : BBX Hero. Les pages qui chargent moteur/bbx-ecoute.js ne copient rien : elles lisent window.BBX_ECOUTE.
   API = 1 : si un jour l'interface change de façon incompatible, on passe à 2 et les anciennes pages gardent leur copie de secours. */
const ECOUTE_API = 1;
// true : quand le modèle de sons est SÛR d'avoir entendu un autre son, la note ne compte pas dans le « temps validé ».
// Le modèle est appris sur la voix de Marc : si le temps validé des élèves paraît trop bas, passer à false ici (un seul endroit, BBX Hero).
const VETO_SON = true;

// ---------- reconnaissance du son exact (modèle LDA appris sur les sons de Marc, expérimental) ----------
function soundGuess(sv){ const M = SMODEL, z = sv.map((v, i) => (v - M.mean[i]) / (M.scale[i] || 1)), s = M.coef.map((w, c) => w.reduce((a, x, i) => a + x * z[i], M.icpt[c])), mx = Math.max.apply(null, s), e = s.map(v => Math.exp(v - mx)), Z = e.reduce((a, b) => a + b, 0), p = e.map(v => v / Z), bi = p.indexOf(Math.max.apply(null, p)); return { tok:M.labels[bi], p:p[bi], all:p }; }
const sndSame = (a, b) => a === b || SMODEL.groups.some(g => g.includes(a) && g.includes(b));
const sndKnown = tok => SMODEL.labels.includes(HERO.stripInt(tok));
// le son d'une attaque : x = signal, i0 = indice de l'attaque. null si le modèle ne connaît pas le son attendu
function sonEntendu(x, sr, i0){ try{ const g = soundGuess(HERO.soundVec(x, sr, i0)); return { tok:g.tok, p:+g.p.toFixed(2), sur:g.p >= SMODEL.thr }; }catch(e){ return null; } }

// ---------- réglages enregistrés par BBX Hero (même adresse = même stockage) ----------
const lsGet = (k, d) => { try{ const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; }catch(e){ return d; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
// calibration des sons (test silence + P, K, Ts) : valable 12 h comme dans le jeu (micro, casque, pièce changent)
function calLire(maxH){ const c = lsGet('bbx-hero-cal', null); if(!c || !c.refs) return null; return Date.now() - (c.t || 0) < (maxH || 12) * 3600e3 ? c : null; }
function calEcrire(c){ lsSet('bbx-hero-cal', c); }
// latence micro (labo / jeu) + réglage fin du casque, en ms. ok:false = jamais mesurée
function latence(){ const l = lsGet('bbx-rylat', null), adj = +lsGet('bbx-hero-adj', 0) || 0; return l && l.ms ? { ms:l.ms + adj, ok:true } : { ms:adj, ok:false }; }

// ---------- micro : flux continu (AudioWorklet), même code que le jeu ----------
const WK = `class R extends AudioWorkletProcessor{process(i){const c=i[0];if(c&&c[0]){const m=new Float32Array(c[0].length);for(let k=0;k<c.length;k++){const d=c[k];for(let j=0;j<d.length;j++)m[j]+=d[j]/c.length;}this.port.postMessage({f:currentFrame,d:m},[m.buffer]);}return true;}}registerProcessor('rec-ry',R);`;
const WK_OK = new WeakSet();
async function micOpen(ac, onBlock){
  if(!WK_OK.has(ac)){
    try{ await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([WK], { type:'application/javascript' }))); }
    catch(e){ await ac.audioWorklet.addModule('data:application/javascript;base64,' + btoa(WK)); }
    WK_OK.add(ac); }
  const st = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false } });
  const src = ac.createMediaStreamSource(st), node = new AudioWorkletNode(ac, 'rec-ry'), mute = ac.createGain(); mute.gain.value = 0;
  src.connect(node); node.connect(mute); mute.connect(ac.destination);
  node.port.onmessage = e => onBlock(e.data.d, e.data.f);
  return { stream:st, close(){ try{ src.disconnect(); node.disconnect(); }catch(e){} st.getTracks().forEach(t => t.stop()); } };
}

// ---------- test de sons (le même que la calibration du jeu, sans l'écran) ----------
// x, sr : la prise ; wins : [{ lane:'grave'|'medium'|'aigu', t0, t1 }] en secondes depuis le début de la prise
function calibrer(x, sr, wins, peak){
  const T = HERO.tune(x, sr, wins), F = HERO.fingerprints(T.ons, wins);
  const J = new HERO.Judge([], 0, 0, { fp:F.fp }), S = J.stats(), sep = S ? +S.sep.toFixed(2) : null;
  const cnt = {}; wins.forEach(w => { cnt[w.lane] = Math.min(4, F.cnt[w.lane] || 0); });
  const good = wins.every(w => (F.cnt[w.lane] || 0) >= 3), weak = wins.every(w => (F.cnt[w.lane] || 0) >= 2);
  return { cal:{ refs:T.refs, det:T.o, fp:F.fp, lvl:F.lvl, t:Date.now(), sr, sep, src:'classroom' }, cnt, raw:T.raw, good, weak, sep, clip:(peak || 0) > .97, familles:sep != null && sep >= 1.2 };
}

// ---------- fenêtres de jugement pour un niveau de cours (1 débutant, 2 intermédiaire, 3 avancé) ----------
// 1 = Beatbox Adventure niv 1 (Parfait ±85 ms, Bien ±170 ms) · 2 = Adventure niv 2 (±50 / ±110) · 3 = strict (±30 / ±70)
const NIV = { 1:4, 2:5, 3:3 };
function note(tok, t, caseS, niv){
  const L = HERO.LEVELS[NIV[niv] || 4], W = Math.min(.42 * caseS, L[1]);
  return { tok:HERO.stripInt(tok), lane:HERO.laneOf(tok), long:RY.isLong(tok), rel:t, W, P:Math.min(L[0], .5 * W), dur:caseS };
}

// ---------- écoute en direct ----------
// Une écoute = le micro + le détecteur du jeu. Le cours lui donne des « tranches » (un palier de Tabata, un tour « à vous ») :
// les notes attendues avec leur heure sur l'horloge audio (heure du clic entendu). Chaque tranche a son juge.
// Rien n'est enregistré ni envoyé : il ne reste que des compteurs.
class Ecoute {
  constructor(ac, cal, o){
    o = o || {}; this.ac = ac; this.cal = cal; this.sr = ac.sampleRate; this.lat = (o.latMs != null ? o.latMs : latence().ms) / 1000; this.latOk = o.latOk != null ? o.latOk : latence().ok;
    this.onEv = o.onEvent || null; this.niv = o.niv || 1; this.strict = !!(cal && cal.sep != null && cal.sep >= 1.2);
    this.ringN = 1 << 18; this.ring = new Float32Array(this.ringN); this.n = 0; this.f0 = null; // ≈ 5 s de son, seulement pour reconnaître le son juste après l'attaque
    this.J = null; this.tr = null; this.pend = []; this.clics = []; this.leak = 0; this.niveau = 0;
    this.tot = this._vide();
  }
  _vide(){ return { n:0, hits:0, perfect:0, miss:0, wrong:0, extra:0, ds:[], sons:{}, sec:0, tranches:0 }; }
  async start(){
    if(this.cal && this.cal.sr && this.cal.sr !== this.sr) throw new Error('freq');
    this.D = new HERO.LiveDetector(this.sr, this.cal.refs, Object.assign({}, this.cal.det || {}, { onOnset:z => this._onset(z) }));
    this.mic = await micOpen(this.ac, (d, f) => { if(this.f0 == null) this.f0 = f; this._keep(d, f); let p = 0; for(let i = 0; i < d.length; i++){ const a = d[i] < 0 ? -d[i] : d[i]; if(a > p) p = a; } this.niveau = Math.max(p, this.niveau * .9); this.D.feed(d, f); });
    const t = Date.now(); while(this.f0 == null && Date.now() - t < 2500) await new Promise(r => setTimeout(r, 20));
    if(this.f0 == null){ this.stop(); throw new Error('silence'); }
    return this;
  }
  _keep(d, f){ const m = this.ringN - 1; for(let i = 0; i < d.length; i++) this.ring[(f - this.f0 + i) & m] = d[i]; this.n = f - this.f0 + d.length; }
  _slice(t, len){ const i0 = Math.round(t * this.sr) - this.f0, m = this.ringN - 1, pre = Math.round(.01 * this.sr), x = new Float32Array(len + pre); if(i0 - pre < this.n - this.ringN + 1) return null; for(let i = 0; i < x.length; i++) x[i] = this.ring[(i0 - pre + i) & m]; return { x, i0:pre }; }
  // notes : [{ tok, t (heure audio du clic, s), dur (durée d'une case, s) }], dur : durée de la tranche (s), cle : nom libre
  tranche(notes, o){
    this.finTranche();
    o = o || {}; const N = notes.map(n => note(n.tok, n.t, n.dur, this.niv));
    this.J = new HERO.Judge(N, 0, this.lat, { strict:this.strict, soft:this.niv <= 1, fp:this.cal.fp, lvl:this.cal.lvl, lifeK:0 });
    this.tr = { cle:o.cle || '', debut:o.debut != null ? o.debut : (N[0] ? N[0].rel : 0), fin:o.fin != null ? o.fin : (N.length ? N[N.length - 1].rel + N[N.length - 1].W + .3 : 0), slot:N.length ? (o.dur || 0) / N.length : 0 };
    this.tot.tranches++; this.tot.n += N.length; this.tot.sec += o.dur || 0;
    N.forEach(n => { const s = this._son(n.tok); s.n++; });
  }
  // clics joués sans note attendue (décompte, repos, tour du prof) : si le micro les entend, le casque manque
  clicsSansNote(ts){ this.clics = this.clics.filter(t => t > this.ac.currentTime - 2).concat(ts); }
  _son(tok){ return this.tot.sons[tok] || (this.tot.sons[tok] = { n:0, ok:0, perfect:0, snd:0, sndN:0, sec:0 }); }
  _onset(z){
    const tc = z.t - this.lat; if(this.clics.some(c => Math.abs(tc - c) < .03)){ this.leak++; this._emit({ type:'leak', n:this.leak }); }
    const J = this.J; if(!J || z.t < this.tr.debut - .25 + this.lat || z.t > this.tr.fin + this.lat) return;
    J.onset(z).forEach(e => this._ev(e));
  }
  _ev(e){
    const T = this.tot;
    if(e.type === 'perfect' || e.type === 'good'){ T.hits++; if(e.type === 'perfect') T.perfect++; T.ds.push(Math.round(e.d * 1000)); const s = this._son(e.note.tok); s.ok++; if(e.type === 'perfect') s.perfect++; s.sec += this.tr.slot;
      if(sndKnown(e.note.tok)) this.pend.push({ z:e.z, note:e.note, s, slot:this.tr.slot }); }
    else if(e.type === 'miss') T.miss++;
    else if(e.type === 'wrong') T.wrong++;
    else if(e.type === 'extra') T.extra++;
    this._emit(e);
  }
  _emit(e){ if(this.onEv) try{ this.onEv(e); }catch(x){ console.warn(x); } }
  // à appeler souvent (≈ 20 fois par seconde) : notes ratées, son reconnu, fin de tranche
  tick(){
    if(!this.D) return;
    if(this.J) this.J.advance(this.D.settled()).forEach(e => this._ev(e));
    const now = this.D.frontier();
    while(this.pend.length && now >= this.pend[0].z.t + .36){ const p = this.pend.shift(), sl = this._slice(p.z.t, Math.round(.32 * this.sr)); if(!sl) continue;
      const g = sonEntendu(sl.x, this.sr, sl.i0); if(!g) continue; p.s.sndN++; const ok = sndSame(g.tok, p.note.tok); if(ok) p.s.snd++; else if(g.sur && VETO_SON) p.s.sec = Math.max(0, p.s.sec - p.slot); /* le modèle est sûr d'avoir entendu un autre son : ce temps n'est pas validé */ this._emit({ type:'son', note:p.note, entendu:g.tok, p:g.p, ok }); }
    if(this.J && this.tr && this.D.settled() > this.tr.fin + this.lat + .1) this.finTranche();
  }
  finTranche(){ if(!this.J) return; this.J.advance(1e9).forEach(e => this._ev(e)); this.J = null; this._emit({ type:'tranche', cle:this.tr && this.tr.cle }); }
  // bilan (petit objet, prêt à envoyer) ; remise à zéro si raz
  bilan(raz){
    const T = this.tot, nh = T.hits, tt = nh + T.miss + T.wrong + T.extra, ds = T.ds.slice().sort((a, b) => a - b);
    const med = ds.length ? ds[ds.length >> 1] : null, m = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0, reg = ds.length > 2 ? Math.round(Math.sqrt(ds.reduce((a, b) => a + (b - m) * (b - m), 0) / (ds.length - 1))) : null;
    const sons = {}; Object.entries(T.sons).forEach(([k, s]) => { if(s.n) sons[k.replace(/[.#$\[\]\/~]/g, c => c === '~' ? '_' : '')] = { tok:k, n:s.n, ok:s.ok, pf:s.perfect, snd:s.sndN ? s.snd : null, sndN:s.sndN || null, sec:Math.round(s.sec * 10) / 10 }; });
    const sndN = Object.values(T.sons).reduce((a, s) => a + s.sndN, 0), snd = Object.values(T.sons).reduce((a, s) => a + s.snd, 0);
    const out = { v:ECOUTE_API, src:'live', n:T.n, pct:tt ? Math.round(100 * nh / tt) : null, hits:nh, parfait:T.perfect, miss:T.miss, faux:T.wrong, extra:T.extra,
      off:this.latOk && med != null ? med : null, offBrut:med, reg, son:sndN ? Math.round(100 * snd / sndN) : null, parSon:sons, sec:Math.round(T.sec), fam:this.strict, latOk:this.latOk, fuite:this.leak >= 3, niv:this.niv };
    if(raz){ this.tot = this._vide(); this.leak = 0; }
    return out;
  }
  stop(){ this.finTranche(); try{ this.mic && this.mic.close(); }catch(e){} this.mic = null; this.D = null; }
}

// ---------- devoirs : après RY.analyze, vérifier le son de chaque case réussie ----------
// a = résultat complet de RY.analyze (avec _best), x / sr = le signal analysé, dur = durée de la prise (s)
function sonsDevoir(a, x, sr, dur){
  if(!a || !a._best) return null;
  const hits = a._best.hits || [], miss = a._best.miss || [], sons = {}, cal = calLire(24 * 30);
  const S = k => sons[k] || (sons[k] = { tok:k, n:0, ok:0, snd:0, sndN:0, fam:0, sec:0 });
  const bad = cal && cal.fp ? (HERO.crossCheck(a, cal.fp) || []) : [], badSet = new Set(bad.map(b => b.cell + '|' + b.heard));
  hits.forEach(h => { const tok = HERO.stripInt(h.e.tok); S(tok).n++; });
  miss.forEach(m => { const tok = HERO.stripInt((m.e || m).tok || '?'); if(tok && tok !== '?') S(tok).n++; });
  const slot = Object.values(sons).reduce((a2, s) => a2 + s.n, 0); const per = slot ? (dur || 0) / slot : 0;
  hits.forEach(h => { const tok = HERO.stripInt(h.e.tok), s = S(tok); let ok = true;
    if(bad.some(b => b.cell === h.e.i)) { s.fam++; ok = false; }
    if(sndKnown(tok)){ const g = sonEntendu(x, sr, Math.round(h.o.t * sr)); if(g){ s.sndN++; if(sndSame(g.tok, tok)) s.snd++; else if(g.sur && VETO_SON) ok = false; } } // modèle sûr d'un autre son : pas validé
    if(ok){ s.ok++; s.sec += per; } });
  const out = {}; Object.entries(sons).forEach(([k, s]) => { out[k.replace(/[.#$\[\]\/~]/g, c => c === '~' ? '_' : '')] = { tok:k, n:s.n, ok:s.ok, snd:s.sndN ? s.snd : null, sndN:s.sndN || null, fam:s.fam || null, sec:Math.round(s.sec * 10) / 10 }; });
  const sndN = Object.values(sons).reduce((a2, s) => a2 + s.sndN, 0), snd = Object.values(sons).reduce((a2, s) => a2 + s.snd, 0);
  return { parSon:out, son:sndN ? Math.round(100 * snd / sndN) : null };
}
