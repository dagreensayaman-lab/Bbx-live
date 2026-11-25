/* ===== BBX ÉCOUTE v61 (2026-11-25) : moteur de reconnaissance de BBX Hero, partagé avec BBX Classroom =====
   Fichier FABRIQUÉ par moteur/fabriquer.js : ne pas le modifier à la main.
   Contient : ry-engine.js (analyse du rythme), hero-core.js (détecteur et juge en direct), sndmodel.json (modèle des sons), ecoute-api.js.
   Mise à jour : refaire ce fichier depuis BBX Hero, puis le déposer dans le dossier moteur/ du dépôt GitHub. */
(function(){
'use strict';
/* ===== RYTHME : moteur d'analyse rythmique (partagé app + labo) ===== */
// Entrée : signal mono (Float32Array), sampleRate, et ce que l'élève devait jouer (pat + bpm).
// Sortie : sons détectés (onsets), placement sur la grille (ok / oubliés / en trop), décalage, régularité, sons confondus.
const RY = (() => {
  const V = 2;
  // Familles de sons (pour repérer un K à la place d'un P) : grave = lèvres/kick, aigu = hi-hat, medium = snares
  const FAM = { grave:['B','P','Bf','Bm','Bo','Pu','Bh','Bb'], aigu:['Ts','T','L','S','Tss','Ch','Tk','St','H','Tch','Sh','Ss'], medium:['K','Pch','Pf','Kch','Psh','Ks','Kt','Kh','Ksh','Pff','Cl','Fsh','Spt'] };
  const FAMOF = {}; Object.entries(FAM).forEach(([f, l]) => l.forEach(n => { FAMOF[n.toLowerCase()] = f; }));
  const FAM_LAB = { grave:'grave', aigu:'aigu', medium:'medium' };
  // sons qui durent (inspirés, charleys ouverts, tout son noté avec ~)
  const LONG = new Set(['k~', 'ts', 'ts~', 'th~', 'tss', 'sh', 's', 'ss', 'pf', 'psh']);
  const isLong = tok => { const k = String(tok || '').toLowerCase(); return LONG.has(k) || k.endsWith('~'); };
  function famOf(tok){
    const t = String(tok || '').trim(); if(!t || t === '.' || t === '-') return null;
    const k = t.toLowerCase(); if(FAMOF[k]) return FAMOF[k];
    if(/^[bp]$/i.test(t) || /^b/i.test(t)) return 'grave';
    if(/^(t|s|ts)/i.test(t)) return 'aigu';
    if(/^k/i.test(t)) return 'medium';
    return null;
  }
  function fft(re, im){
    const n = re.length;
    for(let i = 1, j = 0; i < n; i++){ let b = n >> 1; for(; j & b; b >>= 1) j ^= b; j ^= b; if(i < j){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for(let len = 2; len <= n; len <<= 1){ const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
      for(let i = 0; i < n; i += len){ let cr = 1, ci = 0;
        for(let k = 0; k < h; k++){ const p = i + k, q = p + h, vr = re[q] * cr - im[q] * ci, vi = re[q] * ci + im[q] * cr; re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
  }
  const HANN = {}; const hann = n => HANN[n] || (HANN[n] = Float32Array.from({ length:n }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (n - 1))));
  const pct = (a, p) => { if(!a.length) return 0; const s = Array.from(a).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const std = a => { if(a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
  const median = a => pct(a, .5);
  // Caractéristiques d'un son à partir de l'instant s (≈ 43 ms)
  function features(x, sr, s){
    const N = 2048, w = hann(N), re = new Float32Array(N), im = new Float32Array(N);
    for(let i = 0; i < N; i++){ const v = x[s + i]; re[i] = v === undefined ? 0 : v * w[i]; }
    fft(re, im);
    let tot = 0, cen = 0, low = 0, high = 0, clk = 0; const bf = sr / N;
    const near = f => { for(const c of [1000, 3000, 5000, 1500, 4500, 7500]) if(Math.abs(f - c) <= 45) return true; return false; };
    const P = new Float32Array(N / 2);
    for(let k = 1; k < N / 2; k++){ const f = k * bf, e = re[k] * re[k] + im[k] * im[k]; P[k] = e; tot += e; cen += f * e; if(f < 250) low += e; if(f > 4000) high += e; if(near(f)) clk += e; }
    // tonalité du clic (pic étroit à 1000 ou 1500 Hz par rapport aux fréquences voisines) : repère le clic même mélangé à un son
    let ton = 0, tf = 0; for(const fc of [1000, 1500]){ const kc = Math.round(fc / bf); let pk = 0, nb = 0, nn = 0; for(let k = kc - 1; k <= kc + 1; k++) pk = Math.max(pk, P[k]); for(let k = kc - 14; k <= kc + 14; k++){ if(Math.abs(k - kc) < 4) continue; nb += P[k]; nn++; } const tv = pk / (nb / nn + 1e-12); if(tv > ton){ ton = tv; tf = fc; } }
    let pk = 0; const L = Math.min(x.length, s + Math.round(.03 * sr)); for(let i = s; i < L; i++){ const a = Math.abs(x[i]); if(a > pk) pk = a; }
    tot = tot || 1e-12;
    return { c:Math.round(cen / tot), lo:+(low / tot).toFixed(3), hi:+(high / tot).toFixed(3), clk:+(clk / tot).toFixed(3), ton:Math.round(Math.min(999, ton)), tf, db:+(20 * Math.log10(pk || 1e-6)).toFixed(1) };
  }
  // Détection des attaques (flux spectral + seuil adaptatif + affinage à l'échantillon près)
  function onsets(x, sr, o){
    o = o || {};
    const N = sr > 32000 ? 1024 : 512, H = N >> 2, w = hann(N), F = Math.max(0, Math.floor((x.length - N) / H) + 1);
    // Détection en 3 bandes (grave / medium / aigu), chacune à son propre niveau :
    // un charley doux à côté d'un kick fort reste visible dans les aigus
    const NB = 3, edges = [30, 250, 3000, sr / 2], bk = edges.map(fr => Math.min(N / 2, Math.max(1, Math.round(fr * N / sr))));
    const fluxB = Array.from({ length:NB }, () => new Float32Array(F)), engB = Array.from({ length:NB }, () => new Float32Array(F)), rms = new Float32Array(F);
    let prev = new Float32Array(N / 2); const re = new Float32Array(N), im = new Float32Array(N);
    for(let f = 0; f < F; f++){ const o0 = f * H; let e = 0;
      for(let i = 0; i < N; i++){ const v = x[o0 + i]; e += v * v; re[i] = v * w[i]; im[i] = 0; }
      rms[f] = Math.sqrt(e / N); fft(re, im);
      const cur = new Float32Array(N / 2);
      for(let bnd = 0; bnd < NB; bnd++){ let fl = 0, en = 0;
        for(let k = bk[bnd]; k < bk[bnd + 1]; k++){ const p2 = re[k] * re[k] + im[k] * im[k], m = Math.log(1 + 1000 * Math.sqrt(p2)); cur[k] = m; en += p2; const d = m - prev[k]; if(d > 0) fl += d; }
        fluxB[bnd][f] = fl; engB[bnd][f] = Math.sqrt(en); }
      prev = cur; }
    const flux = new Float32Array(F), who = new Uint8Array(F), gB = [];
    for(let bnd = 0; bnd < NB; bnd++){ const q = pct(fluxB[bnd], .99) || 1, e = engB[bnd], emax = pct(e, .995) || 1e-9, efl = pct(e, .1);
      gB.push(Math.max(efl * 3, emax * Math.pow(10, -(o.dynDb || 40) / 20)));
      for(let f = 0; f < F; f++){ const v = fluxB[bnd][f] / q; if(v > flux[f]){ flux[f] = v; who[f] = bnd; } } }
    const p99 = pct(flux, .99) || 1, rmax = pct(rms, .995) || 1e-6, floor = pct(rms, .1);
    const gate = Math.max(floor * 2.5, rmax * Math.pow(10, -(o.dynDb2 || 55) / 20), 0.0004);
    const W = Math.max(3, Math.round(.15 * sr / H)), delta = (o.sens != null ? o.sens : .07) * p99;
    const peaks = [];
    for(let f = 1; f < F - 1; f++){
      if(flux[f] < flux[f - 1] || flux[f] <= flux[f + 1]) continue;
      const loc = []; for(let j = Math.max(0, f - W); j <= Math.min(F - 1, f + W); j++) loc.push(flux[j]);
      const thr = median(loc) * 1.4 + delta, bnd = who[f], eb = engB[bnd];
      const r2 = Math.max(rms[f], rms[Math.min(F - 1, f + 1)], rms[Math.min(F - 1, f + 2)]), e2 = Math.max(eb[f], eb[Math.min(F - 1, f + 1)], eb[Math.min(F - 1, f + 2)]);
      if(flux[f] > thr && r2 > gate && e2 > gB[bnd]) peaks.push({ f, v:flux[f] });
    }
    // enveloppe fine (1 ms) pour dater l'attaque précisément
    const m1 = Math.max(1, Math.round(.001 * sr)), cs = new Float64Array(x.length + 1);
    for(let i = 0; i < x.length; i++) cs[i + 1] = cs[i] + Math.abs(x[i]);
    const env = i => (cs[Math.min(x.length, i + m1)] - cs[Math.max(0, i)]) / m1, lag = Math.max(1, Math.round(.002 * sr));
    let all = peaks.map(p => {
      const s0 = Math.max(lag, p.f * H - H), s1 = Math.min(x.length - m1 - 1, p.f * H + N);
      let md = 0; const d = []; for(let i = s0; i < s1; i++){ const v = env(i) - env(i - lag); d.push(v); if(v > md) md = v; }
      let k = 0; while(k < d.length && d[k] < .5 * md) k++;
      const s = Math.max(0, s0 + k - (lag >> 1));
      return { t:s / sr, s, v:p.v, str:+(p.v / p99).toFixed(2), ...features(x, sr, s) };
    });
    if(o.drop) all = all.filter(z => !o.drop(z));
    // un seul son par 45 ms : on garde le plus fort
    const out = [];
    all.forEach(p => { const l = out[out.length - 1]; if(l && p.t - l.t < .045){ if(p.v > l.v) out[out.length - 1] = p; } else out.push(p); });
    // fin d'un son fort (souffle, résonance) prise pour une attaque : beaucoup plus faible et juste après → on l'ignore
    return out.filter((o, i) => !out.slice(Math.max(0, i - 3), i).some(p => o.t - p.t < .16 && o.db < p.db - 22 && o.str < .8));
  }
  // Soustraction du clic : le clic du haut-parleur est toujours le même → on en fait un modèle (moyenne des clics seuls) et on l'enlève à chaque temps
  function unclick(x, sr, ons, clk, spb){
    const p0 = ons.filter(o => o.ton >= 100 && clk.onGrid(o)), late = o => { let e = 0; for(let i = o.s + Math.round(.02 * sr); i < Math.min(x.length, o.s + Math.round(.08 * sr)); i++) e += x[i] * x[i]; return e; };
    const el = p0.map(late), alone = p0.filter((o, i) => { const same = p0.map((q, j) => q.tf === o.tf ? el[j] : Infinity), emin = Math.min(...same); return el[i] <= 2.5 * emin + 1e-9; }); // clics sans son juste après (par type de clic : le 1er temps est plus fort)
    const pure = alone.length >= 2 ? alone : p0; if(pure.length < 2) return null;
    const ks = pure.map(o => Math.round((o.t - clk.c0) / spb)), n = pure.length;
    let a = clk.c0, b = spb; const uk = new Set(ks);
    if(uk.size >= 3){ const mk = mean(ks), mt = mean(pure.map(o => o.t)); let sxy = 0, sxx = 0; ks.forEach((k, i) => { sxy += (k - mk) * (pure[i].t - mt); sxx += (k - mk) * (k - mk); }); b = sxy / sxx; a = mt - b * mk; if(Math.abs(b / spb - 1) > .01){ b = spb; a = clk.c0; } }
    const pre = Math.round(.004 * sr), L = Math.round(.06 * sr) + pre, at = k => Math.round((a + b * k) * sr) - pre;
    const corr = (T, s0) => { let c = 0; for(let i = 0; i < L; i += 2) c += T[i] * (x[s0 + i] || 0); return c; };
    const tpl = {}, acc = {};
    [1000, 1500].forEach(f => { const g = pure.map((o, i) => ({ o, k:ks[i] })).filter(z => z.o.tf === f); if(!g.length) return;
      // médiane échantillon par échantillon : un son de l'élève qui tombe juste après un clic ne pollue pas le modèle
      const ref = Float32Array.from({ length:L }, (_, i) => x[at(g[0].k) + i] || 0), st = g.map(z => { let s0 = at(z.k), bl = 0, bc = -1e9; for(let l = -4; l <= 4; l++){ const c = corr(ref, s0 + l); if(c > bc){ bc = c; bl = l; } } return s0 + bl; });
      const T = new Float32Array(L), col = new Float32Array(st.length);
      for(let i = 0; i < L; i++){ st.forEach((s0, j) => { col[j] = x[s0 + i] || 0; }); T[i] = median(col); }
      const tp = Math.round(.006 * sr); for(let i = 0; i < tp; i++) T[L - 1 - i] *= i / tp; // fondu en fin de modèle
      tpl[f] = T; g.forEach(z => { const m = ((z.k % 4) + 4) % 4; acc[f] = acc[f] || [0, 0, 0, 0]; acc[f][m]++; }); });
    // temps forts (1500 Hz tous les 4 temps) : on retrouve leur place
    const acPh = tpl[1500] && tpl[1000] ? acc[1500].indexOf(Math.max(...acc[1500])) : -1;
    const y = Float32Array.from(x), k0 = Math.ceil((-a) / b), k1 = Math.floor((x.length / sr - a) / b);
    for(let k = k0; k <= k1; k++){
      const f = acPh < 0 ? (tpl[1000] ? 1000 : 1500) : (((k % 4) + 4) % 4 === acPh ? 1500 : 1000), T = tpl[f]; if(!T) continue;
      let s0 = at(k), bl = 0, bc = -1e9; for(let l = -3; l <= 3; l++){ const c = corr(T, s0 + l); if(c > bc){ bc = c; bl = l; } } s0 += bl;
      if(bc < .35 * (T.E || (T.E = T.reduce((q, v, i) => i % 2 ? q : q + v * v, 0)))) continue; // pas de clic à cet endroit (avant le début / après la fin du clic)
      for(let i = 0; i < L; i++){ const j = s0 + i; if(j >= 0 && j < y.length) y[j] -= T[i]; }
    }
    return y;
  }
  const CLICK_F = [1000, 3000, 5000, 7000, 9000, 11000, 13000, 15000, 1500, 4500, 7500, 10500, 13500];
  // Filtre coupe-bande (enlève le clic du métronome : 1000/1500 Hz et harmoniques) avant de chercher les sons
  function notch(x, sr, freqs){
    let y = Float32Array.from(x);
    freqs.forEach(f => { if(f >= sr / 2) return; const w = 2 * Math.PI * f / sr, q = 6, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al, b0 = 1 / a0, b1 = -2 * c / a0, b2 = 1 / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for(let i = 0; i < y.length; i++){ const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; y[i] = v; } });
    return y;
  }
  // Clic du métronome entendu dans l'enregistrement (haut-parleur) : sert de repère exact, puis on l'enlève
  function findClicks(ons, bpm){
    if(!bpm) return { c0:null, ons };
    const spb = 60 / bpm, cd = (a, b) => { const d = Math.abs(a - b) % spb; return Math.min(d, spb - d); };
    // phase la plus fréquente (± 8 ms), puis moyenne du groupe : d'abord avec les clics seuls (sans son par-dessus), sinon avec tous les sons « tonaux »
    const tryC = (cand, minN) => {
      if(cand.length < minN) return null;
      const ph = cand.map(o => ((o.t % spb) + spb) % spb);
      let bi = 0, bn = 0; ph.forEach((p, i) => { const n = ph.filter(q => cd(p, q) < .008).length; if(n > bn){ bn = n; bi = i; } });
      const grp = ph.filter(q => cd(ph[bi], q) < .008); if(grp.length < minN || grp.length / cand.length < .5) return null;
      const c0 = ph[bi] + mean(grp.map(q => { let d = q - ph[bi]; if(d > spb / 2) d -= spb; if(d < -spb / 2) d += spb; return d; }));
      return { c0:((c0 % spb) + spb) % spb, R:+(grp.length / cand.length).toFixed(2), n:grp.length };
    };
    const first = l => l.filter((o, i) => !l.slice(0, i).some(q => o.t - q.t < .045 && o.t > q.t)); // un clic = sa 1re attaque (pas la suite du même clic)
    const r = tryC(first(ons.filter(o => o.ton >= 100)), 3) || tryC(first(ons.filter(o => o.ton >= 12)), 4);
    if(!r) return { c0:null, ons };
    // position par rapport au clic (s) : négatif = avant, positif = après
    const rel = o => { let d = ((o.t - r.c0) % spb + spb) % spb; if(d > spb / 2) d -= spb; return d; };
    return { ...r, rel, onGrid:(o, tol) => Math.abs(rel(o)) < (tol || .015) };
  }
  // Grille attendue : phrases (div, tok) mises bout à bout, en temps (beats)
  function grid(pat){
    const cells = []; let b = 0;
    (pat || []).forEach((p, pi) => { const st = 1 / (+p.div || 2); String(p.tok || '').trim().split(/\s+/).filter(Boolean).forEach(t => { cells.push({ i:cells.length, b, tok:t, st, ph:pi, fam:famOf(t), ev:t !== '.' && t !== '-' }); b += st; }); });
    return { cells, ev:cells.filter(c => c.ev), P:b };
  }
  // Placement des sons sur la grille + statistiques
  function match(ons, bpm, pat, o){
    o = o || {};
    const spb = 60 / bpm, G = grid(pat), ev = G.ev, P = G.P;
    if(!ev.length || !ons.length || !P) return null;
    const minSt = Math.min(...G.cells.map(c => c.st)), tolS = c => Math.min(.42 * c.st * spb, .11), beats = ons.map(x => x.t / spb);
    const evb = ev.map(e => e.b), near = pos => { // événement le plus proche (avec bouclage de la phrase)
      let lo = 0, hi = evb.length; while(lo < hi){ const m = (lo + hi) >> 1; if(evb[m] < pos) lo = m + 1; else hi = m; }
      const cs = [[lo % ev.length, lo >= ev.length ? P : 0], [(lo - 1 + ev.length) % ev.length, lo - 1 < 0 ? -P : 0]];
      let best = null; cs.forEach(([j, sh]) => { const d = pos - (evb[j] + sh); if(!best || Math.abs(d) < Math.abs(best.d)) best = { e:ev[j], d }; }); return best;
    };
    const c0b = o.c0 != null ? o.c0 / spb : null, dmax = .12 / spb;
    // un seul son compte par case attendue (le plus proche) ; les autres comptent comme « en trop »
    const score = phi => { const bestW = new Map(); let s = 0, n0 = 0;
      for(const b of beats){ const pos = ((b - phi) % P + P) % P, n = near(pos), tb = tolS(n.e) / spb;
        if(Math.abs(n.d) < tb){ const key = Math.round((b - phi - n.d - n.e.b) / P) + ':' + n.e.i, w = 1 - .5 * (n.d / tb) * (n.d / tb), o = bestW.get(key); if(o == null) bestW.set(key, w); else { bestW.set(key, Math.max(o, w)); n0++; } }
        else n0++; }
      bestW.forEach(w => { s += w; }); return s - .3 * n0; };
    const res = Math.min(.02, minSt / 8), cands = [];
    for(let phi = 0; phi < P; phi += res){
      if(c0b != null){ const r = (((phi - c0b) % minSt) + minSt) % minSt; if(Math.min(r, minSt - r) > dmax) continue; }
      if(o.start != null){ const r = (((phi - o.start / spb) % P) + P) % P; if(Math.min(r, P - r) > dmax) continue; } // début de la phrase connu (exercice guidé)
      cands.push({ phi, s:score(phi) });
    }
    if(!cands.length) return null;
    const bestS = Math.max(...cands.map(c => c.s));
    // à égalité de placement (phrases répétitives), on garde celui où les familles de sons se séparent le mieux
    const tops = cands.filter(c => c.s >= bestS - .6).sort((a, b) => b.s - a.s), pick = [];
    const sepB = Math.min(minSt / 2, .05 / spb); // deux calages à plus de 50 ms l'un de l'autre sont comparés (attaque / souffle d'un son long)
    tops.forEach(c => { if(!pick.some(p => Math.abs(p.phi - c.phi) < sepB || Math.abs(Math.abs(p.phi - c.phi) - P) < sepB)) pick.push(c); });
    let best = null;
    pick.slice(0, 12).forEach(c => { const r = assign(c.phi); r.sep = famSep(r);
      // un son long (attaque + souffle) : il faut caler la grille sur l'attaque, pas sur le souffle → pénalité si un « son en trop » précède de peu un son long réussi
      const pre = r.extra.filter(x => r.hits.some(h => isLong(h.e.tok) && h.o.t > x.o.t && h.o.t - x.o.t < .16)).length;
      const dSt = o.start != null ? Math.min(Math.abs((((c.phi - o.start / spb) % P) + P) % P), P - Math.abs((((c.phi - o.start / spb) % P) + P) % P)) / dmax : 0;
      r.key = r.hits.length - .5 * (r.miss.length + r.extra.length) + .8 * r.sep - 1.2 * pre - .5 * dSt; if(!best || r.key > best.key + 1e-9) best = r; });
    // affinage : on recentre sur les sons réussis
    if(best.hits.length >= 3 && c0b == null){ const dm = mean(best.hits.map(h => h.d)); best = assign(best.phi + dm / spb); }
    function assign(phi){
      // exercice guidé : on ne compte que les tours demandés (pas le décompte, pas après la fin)
      const b0 = o.start != null ? o.start / spb : beats[0], b1 = o.start != null && o.cycles ? o.start / spb + o.cycles * P - minSt / 2 : beats[beats.length - 1], inst = [];
      for(let k = Math.floor((b0 - phi) / P) - 1; k <= Math.ceil((b1 - phi) / P); k++)
        ev.forEach(e => { const tb = phi + k * P + e.b, tl = tolS(e) / spb; if(tb >= b0 - tl && tb <= b1 + tl) inst.push({ e, k, tb }); });
      const pairs = [];
      inst.forEach((it, a) => { const tl = tolS(it.e) / spb, cand = []; beats.forEach((b, j) => { const d = b - it.tb; if(Math.abs(d) < tl) cand.push({ a, j, d }); });
        // dans une même case, le vrai son est le plus fort : un petit bruit juste avant (respiration…) ne doit pas prendre sa place
        const mx = Math.max(-200, ...cand.map(c => ons[c.j].db)); cand.forEach(c => { c.k = Math.abs(c.d) / tl + Math.max(0, mx - ons[c.j].db) / 8; pairs.push(c); }); });
      pairs.sort((x, y) => x.k - y.k);
      const ua = new Set(), uj = new Set(), hits = [];
      pairs.forEach(p => { if(ua.has(p.a) || uj.has(p.j)) return; ua.add(p.a); uj.add(p.j); hits.push({ e:inst[p.a].e, k:inst[p.a].k, o:ons[p.j], d:p.d * spb }); });
      const miss = inst.filter((_, a) => !ua.has(a)).map(it => ({ e:it.e, k:it.k, t:it.tb * spb }));
      const extra = ons.filter((_, j) => !uj.has(j)).map(x => { const pos = ((x.t / spb - phi) % P + P) % P; let c = G.cells[0], bd = 1e9; G.cells.forEach(cc => { const d = Math.min(Math.abs(pos - cc.b), P - Math.abs(pos - cc.b)); if(d < bd){ bd = d; c = cc; } }); return { o:x, cell:c }; });
      return { phi, hits, miss, extra };
    }
    // Sons longs (inward K~, charleys ouverts Ts / Ts~ / Th~…) : le souffle qui suit l'attaque peut ressembler à une 2e attaque.
    // Un « son en trop » qui arrive juste après un son long, avec le même timbre et pas plus fort, est la queue de ce son.
    // bruits très faibles (souffle, frottement, reste de clic) : bien plus faibles que les sons joués → pas des sons « en trop »
    if(best.hits.length >= 4){ const hd = best.hits.map(h => h.o.db).sort((p, q) => p - q), thrX = Math.min(median(hd) - 20, hd[Math.floor(hd.length * .1)] - 8);
      best.noise = best.extra.filter(x => x.o.db < thrX).length; best.extra = best.extra.filter(x => x.o.db >= thrX); }
    const tails = [];
    best.extra = best.extra.filter(x => { const t = x.o.t;
      const h = best.hits.filter(z => z.o.t < t && t - z.o.t < .4).sort((p, q) => q.o.t - p.o.t)[0]; if(!h || !isLong(h.e.tok)) return true;
      const same = Math.abs(Math.log2(Math.max(60, x.o.c) / Math.max(60, h.o.c))) < 1 && x.o.db <= h.o.db + 1.5;
      if(same){ tails.push(x); return false; } return true; });
    // Queue de n'importe quel son : souffle après un P, « h » après un K, « sss » après un Ts… (peu après, nettement plus faible)
    best.extra = best.extra.filter(x => { const t = x.o.t, h = best.hits.filter(z => z.o.t < t && t - z.o.t < .3).sort((p, q) => q.o.t - p.o.t)[0]; if(!h) return true;
      if(String(h.e.tok).length === 1 && t - h.o.t > .55 * ((h.e.st || minSt) * spb) && !((x.o.lo || 0) > .85 && x.o.c < 220) && (x.o.c > 2.5 * Math.max(60, h.o.c) || (x.o.db > h.o.db - 9 && Math.abs(Math.log2(Math.max(60, x.o.c) / Math.max(60, h.o.c))) > 1.3))) return true; // dans la case suivante avec un autre timbre : un vrai son (ex. un Ts ajouté après un K), pas la queue
      const dt = t - h.o.t, rumble = x.o.lo > .85 && x.o.c < 220 && x.o.db <= h.o.db + 1; // souffle grave d'une plosive (P, B…) dans le micro
      const part2 = dt < .14 && x.o.db <= h.o.db + 4; // 2e partie d'un son composé : P-ch, F-sh, K-h, P-f… (juste après, à peu près aussi fort)
      if(x.o.db < h.o.db - (dt < .15 ? 6 : 9) || rumble || part2){ tails.push(x); return false; } return true; });
    // v2 (données de la collecte, 25.10) — 1re partie d'un son en 2 temps (le P de P-ch, le t de Ts, le k de K…) : juste AVANT le son trouvé, dans la même case
    { const cellS = c => (c && c.st ? c.st : minSt) * spb;
      best.extra = best.extra.filter(x => { const h = best.hits.filter(z => z.o.t > x.o.t && z.o.t - x.o.t < Math.min(.13, .45 * cellS(z.e)) && (!x.cell || x.cell === z.e)).sort((p, q) => p.o.t - q.o.t)[0];
        if(h && x.o.db <= h.o.db + 6){ tails.push(x); return false; } return true; }); }
    // grondement isolé (souffle, cogne sur le micro ou la table) : très grave et bien plus faible que les sons joués
    if(best.hits.length >= 4){ const md = median(best.hits.map(h => h.o.db));
      best.extra = best.extra.filter(x => { if((x.o.lo || 0) > .9 && x.o.c < 260 && x.o.db < md - 15){ best.noise = (best.noise || 0) + 1; return false; } return true; });
      // « son » trouvé dans une case mais presque inaudible et pas du bon registre : ce n'est pas l'élève → la case est un oubli
      const keep = []; best.hits.forEach(h => { const f = famOf(h.e.tok), rumble = (h.o.lo || 0) > .9 && h.o.c < 260, clickish = (h.o.ton || 0) >= 60 && h.o.db < md - 10, faint = h.o.db < md - 26 || (h.o.db < md - 18 && rumble && f !== 'grave') || clickish; // clickish : reste du clic (son pur) bien plus faible que les sons joués
        if(faint){ best.miss.push({ e:h.e, k:h.k, t:h.o.t }); best.noise = (best.noise || 0) + 1; } else keep.push(h); }); best.hits = keep; }
    // décalage par rapport au clic (seulement si on a un repère exact)
    let off = null;
    if(c0b != null && best.hits.length >= 3){ const r = (((best.phi - c0b) % minSt) + minSt) % minSt, sh = (r > minSt / 2 ? r - minSt : r) * spb; off = Math.round((sh + median(best.hits.map(h => h.d)) - (o.lat || 0)) * 1000); }
    // sons confondus (relatif à l'enregistrement : chaque famille comparée aux autres)
    const fam = famCheck(best);
    const cells = G.cells.map(c => { const h = best.hits.filter(x => x.e === c), m = best.miss.filter(x => x.e === c).length, x = best.extra.filter(z => z.cell === c).length, f = fam.bad.filter(z => z.e === c);
      return c.ev ? { h:h.length, m, x, r:h.length ? Math.round(mean(h.map(z => z.d)) * 1000) : 0, f:f.length, fh:f.length ? f[0].heard : '' } : { x }; });
    const nh = best.hits.length, nm = best.miss.length, nx = best.extra.length, ds = best.hits.map(h => h.d * 1000);
    const cyc = o.cycles || Math.max(1, Math.round((ons[ons.length - 1].t - ons[0].t) / (P * spb)));
    return { v:V, pct:Math.round(100 * nh / Math.max(1, nh + nm + nx)), hits:nh, miss:nm, extra:nx, reg:Math.round(std(ds)), off, anc:c0b != null, sons:fam.pct, sep:+fam.sep.toFixed(2), conf:fam.bad.length,
      cells, cyc, queues:tails.length, phi:+(best.phi * spb).toFixed(3), _best:best };
  }
  function famVecs(hits){ return hits.filter(h => h.e.fam).map(h => ({ h, f:h.e.fam, v:[Math.log2(Math.max(60, h.o.c)), h.o.lo * 3, h.o.hi * 3] })); }
  function famStats(V){
    const by = {}; V.forEach(x => (by[x.f] = by[x.f] || []).push(x)); const fs = Object.keys(by).filter(f => by[f].length >= 3); if(fs.length < 2) return null;
    const cen = {}; fs.forEach(f => { cen[f] = [0, 1, 2].map(d => median(by[f].map(x => x.v[d]))); });
    const sd = [0, 1, 2].map(d => Math.max(.08, mean(fs.map(f => std(by[f].map(x => x.v[d])))))) ;
    const dist = (a, b) => Math.sqrt([0, 1, 2].reduce((s, d) => s + ((a[d] - b[d]) / sd[d]) ** 2, 0));
    let sep = 1e9; fs.forEach(a => fs.forEach(b => { if(a < b) sep = Math.min(sep, dist(cen[a], cen[b])); }));
    return { by, fs, cen, sd, dist, sep };
  }
  function famSep(r){ const s = famStats(famVecs(r.hits)); return s ? Math.min(s.sep, 6) : 0; }
  function famCheck(r){
    const V = famVecs(r.hits), s = famStats(V); if(!s || s.sep < 1.2) return { pct:null, sep:s ? s.sep : 0, bad:[] };
    const bad = [];
    V.forEach(x => { if(!s.cen[x.f]) return; let nf = x.f, nd = s.dist(x.v, s.cen[x.f]); s.fs.forEach(f => { const d = s.dist(x.v, s.cen[f]); if(d < nd - .6){ nd = d; nf = f; } }); if(nf !== x.f) bad.push({ e:x.h.e, heard:nf, o:x.h.o }); });
    const n = V.filter(x => s.cen[x.f]).length;
    return { pct:Math.round(100 * (n - bad.length) / Math.max(1, n)), sep:s.sep, bad };
  }
  // Qualité du son (régularité du volume et du timbre) : indicatif
  // list : [{ o, k }] (k = son attendu) ; la régularité se mesure son par son, puis on fait la moyenne
  function quality(list){
    const l = list.filter(z => z && z.o); if(l.length < 3) return null;
    const by = {}; l.forEach(z => (by[z.k || '?'] = by[z.k || '?'] || []).push(z.o)); const gs = Object.values(by).filter(g => g.length >= 3); if(!gs.length) return null;
    const w = gs.reduce((s, g) => s + g.length, 0), avg = f => gs.reduce((s, g) => s + f(g) * g.length, 0) / w;
    return { niv:Math.round(median(l.map(z => z.o.db))), regDb:+avg(g => std(g.map(o => o.db))).toFixed(1), regSt:+avg(g => std(g.map(o => 12 * Math.log2(Math.max(60, o.c))))).toFixed(1), n:l.length };
  }
  // Tout-en-un. opt : { bpm, pat:[{div, tok}], libre:bool (devoir « son » : un son par temps ou demi-temps, sans oubli compté), c0, lat }
  function analyze(x, sr, opt){
    opt = opt || {}; const t0 = Date.now();
    let ons = onsets(x, sr, opt), clk = { c0:null };
    if(opt.bpm && opt.clicks !== false){ clk = findClicks(ons, opt.bpm);
      if(clk.c0 != null || opt.c0 != null){ // clic entendu : on le filtre, puis on recherche les sons
        const y = notch(unclick(x, sr, ons, clk, 60 / opt.bpm) || x, sr, CLICK_F), W = Math.round(.015 * sr), en = (a, i) => { let e = 0; for(let k = i; k < Math.min(a.length, i + W); k++) e += a[k] * a[k]; return e; };
        const pc = clk.rel ? ons.filter(o => o.ton >= 100 && clk.onGrid(o)).map(o => en(x, o.s)) : [], clickE = pc.length >= 2 ? median(pc) : 0;
        // un « son » qui n'est presque que du clic (l'énergie disparaît avec le filtre) et tombe sur le clic → ce n'est pas l'élève
        ons = onsets(y, sr, { ...opt, drop:z => { const e = en(y, z.s), f = features(x, sr, z.s), r = e / (en(x, z.s) + 1e-12); z.nr = +r.toFixed(2); z.ton = f.ton; if(!clk.rel) return false; const d = clk.rel(z);
          if(d > -.015 && d < .06 && r < .1) return true; // reste du clic
          if(Math.abs(d) >= .015) return false;
          const quiet = clickE ? e < .35 * clickE : (r < .35 || (z.c > 7000 && f.ton >= 8 && z.db < -6)); // presque rien en dehors du clic
          if(!quiet) return false;
          // un son commence peut-être juste après le clic : on cherche son attaque dans les 60 ms
          const W2 = Math.round(.06 * sr); let e2 = 0; for(let k = z.s; k < Math.min(y.length, z.s + W2); k++) e2 += y[k] * y[k];
          if(e2 < (clickE ? (opt.cdelay != null ? .4 : .15) * clickE : 4 * e)) return true;
          const lag = Math.round(.002 * sr), m1 = Math.round(.001 * sr), env = i => { let v = 0; for(let k = i; k < i + m1; k++) v += Math.abs(y[k] || 0); return v / m1; };
          let bi = z.s, bv = -1; for(let i = z.s + Math.round(.004 * sr); i < z.s + W2; i += 2){ const v = env(i) - env(i - lag); if(v > bv){ bv = v; bi = i; } }
          let k = z.s + Math.round(.004 * sr); while(k < bi && env(k) - env(k - lag) < .5 * bv) k += 2;
          Object.assign(z, features(y, sr, k), { s:k, t:k / sr, re:1 }); return false;
        } }); } }
    // clic mélangé numériquement dans le fichier (enregistrement relu plus tard) : ses restes et son pré-écho autour du temps ne sont pas des sons
    if(opt.cdelay != null && clk.rel) ons = ons.filter(o => { const d = clk.rel(o); return !(d > -.04 && d < .02 && (o.ton >= 8 || o.db < -30)); });
    const c0 = opt.c0 != null ? opt.c0 : clk.c0 != null ? clk.c0 + (opt.cdelay || 0) : null; // cdelay : clic mélangé numériquement dans le fichier (pas de retard), le micro arrive après
    let m = null;
    let start = opt.start != null ? opt.start : null;
    if(start != null && opt.bpm && opt.pat){ const spb = 60 / opt.bpm, P = grid(opt.pat).P * spb;
      if(c0 != null && opt.c0 == null) start = c0 + Math.round((start - c0) / spb) * spb; // calé sur le clic entendu
      const g = grid(opt.pat), lastSt = (g.cells.length ? g.cells[g.cells.length - 1].st : .5) * spb, end = start + (opt.cycles || 1) * P;
      ons = ons.filter(o => o.t > start - .2 && o.t < end - lastSt / 2 + .07); } // après la dernière case, ce qui suit (respiration, bruit) n'est plus la phrase
    if(opt.bpm && opt.pat && opt.pat.length) m = match(ons, opt.bpm, opt.pat, { c0, lat:opt.lat, start, cycles:opt.cycles });
    else if(opt.bpm && opt.libre && ons.length >= 3){ const tok = opt.son || 'X'; m = match(ons, opt.bpm, [{ div:2, tok:tok + ' ' + tok }], { c0, lat:opt.lat }); if(m){ m.libre = true; m.pct = Math.round(100 * m.hits / Math.max(1, m.hits + m.extra)); m.miss = 0; } }
    const q = quality(m ? m._best.hits.map(h => ({ o:h.o, k:h.e.tok })) : ons.map(o => ({ o, k:'?' })));
    const out = { v:V, n:ons.length, dur:+(x.length / sr).toFixed(1), clic:c0 != null, ms:Date.now() - t0, q };
    if(m){ const { _best, ...rest } = m; Object.assign(out, rest); out._best = _best; }
    out._ons = ons; return out;
  }
  // Version légère à stocker (Firebase)
  function compact(a){
    if(!a) return null; const r = { v:a.v, n:a.n, dur:a.dur };
    ['pct', 'hits', 'miss', 'extra', 'reg', 'off', 'sons', 'conf', 'cyc'].forEach(k => { if(a[k] != null) r[k] = a[k]; });
    if(a.libre) r.libre = true; if(a.clic) r.clic = true; if(a.q) r.q = a.q;
    if(a.cells) r.cells = a.cells.map(c => c.h == null ? (c.x ? 'x' + c.x : '') : [c.h, c.m, c.x, c.r, c.f, c.fh ? c.fh[0] : ''].join(','));
    return r;
  }
  const cellOf = s => { if(!s || s[0] === 'x') return { x:s ? +s.slice(1) : 0 }; const [h, m, x, r, f, fh] = String(s).split(','); return { h:+h, m:+m, x:+x, r:+r, f:+f, fh:{ g:'grave', a:'aigu', m:'medium' }[fh] || '' }; };
  // Décodage d'un enregistrement (Blob, ArrayBuffer ou data URL) en signal mono
  async function decode(src, ctx){
    let buf = src;
    if(typeof src === 'string') buf = await (await fetch(src)).arrayBuffer();
    else if(src && src.arrayBuffer) buf = await src.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext, c = ctx || new AC();
    const ab = await new Promise((ok, ko) => { const p = c.decodeAudioData(buf.slice ? buf.slice(0) : buf, ok, ko); if(p && p.then) p.then(ok, ko); });
    const ch = ab.numberOfChannels, n = ab.length, x = new Float32Array(n), chans = [];
    for(let k = 0; k < ch; k++){ const d = ab.getChannelData(k); chans.push(Float32Array.from(d)); for(let i = 0; i < n; i++) x[i] += d[i] / ch; }
    return { x, sr:ab.sampleRate, chans };
  }
  return { V, FAM, FAM_LAB, famOf, isLong, onsets, notch, features, findClicks, grid, match, analyze, compact, cellOf, decode, quality, fft };
})();
/* ===== fin RYTHME ===== */

/* ===== HERO CORE : détection temps réel + juge + outils (dépend de RY) ===== */
const HERO = (() => {
  const LANES = ['grave', 'medium', 'aigu'];
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const std = a => { if(a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
  const pct = (a, p) => { if(!a.length) return 0; const s = Array.from(a).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
  const median = a => pct(a, .5);
  const HANN = {}; const hann = n => HANN[n] || (HANN[n] = Float32Array.from({ length:n }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (n - 1))));

  // piste d'un son : famille du moteur, + Fsh / Spt (snares) que le moteur ne connaît pas / classe mal
  /* intensité (v56) : « P+ » = fort, « P- » = faible, « P » = normal. Le « - » seul reste un silence. */
  function stripInt(t){ t = String(t == null ? '' : t); return t.length > 1 ? t.replace(/[+-]$/, '') : t; }
  function intOf(t){ t = String(t == null ? '' : t); if(t.length < 2) return null; const c = t[t.length - 1]; return c === '+' ? 2 : c === '-' ? 0 : null; }
  function laneOf(tok){
    tok = stripInt(tok); const k = String(tok || '').toLowerCase();
    if(k === 'fsh' || k === 'spt') return 'medium';
    return RY.famOf(tok) || 'medium';
  }

  // Notes d'une phrase : pat = [{div, tok}], le décompte (4 temps) est inclus dans rel
  // fenêtres [Parfait, Bien] en secondes selon le niveau : plus on monte, plus c'est exigeant
  const LEVELS = { 1:[.055, .11], 2:[.04, .09], 3:[.03, .07], 4:[.085, .17], 5:[.05, .11] }; // 4 et 5 : Beatbox Adventure niv 1 (débutant, très indulgent) et niv 2
  function buildNotes(pat, bpm, cycles, niv){
    const ints = []; let anyInt = false; // intensités demandées (par case) ; sans aucune marque + / - la phrase se joue comme avant
    pat = (pat || []).map(p => ({ div:p.div, tok:String(p.tok || '').trim().split(/\s+/).filter(Boolean).map(t => { const v = intOf(t); ints.push(v); if(v != null) anyInt = true; return stripInt(t); }).join(' ') }));
    const spb = 60 / bpm, G = RY.grid(pat), notes = [], L = LEVELS[niv] || LEVELS[1];
    for(let c = 0; c < cycles; c++) G.ev.forEach(e => {
      const beat = 4 + c * G.P + e.b;
      notes.push({ i:notes.length, cyc:c, cell:e.i, tok:e.tok, int:anyInt ? (ints[e.i] == null ? 1 : ints[e.i]) : undefined, lane:laneOf(e.tok), long:RY.isLong(e.tok), beat, rel:beat * spb, W:Math.min(.42 * e.st * spb, L[1]), P:Math.min(L[0], .5 * Math.min(.42 * e.st * spb, L[1])) });
    });
    return { notes, cells:G.cells, P:G.P, spb, endBeat:4 + cycles * G.P };
  }

  // ---------- Détecteur d'attaques en flux continu (même principe que RY.onsets, mais causal) ----------
  class LiveDetector {
    constructor(sr, refs, o){
      o = o || {}; this.sr = sr; this.refs = refs;
      this.N = sr > 32000 ? 1024 : 512; this.H = this.N >> 2; this.w = hann(this.N);
      this.re = new Float32Array(this.N); this.im = new Float32Array(this.N);
      const edges = [30, 250, 3000, sr / 2]; this.bk = edges.map(fr => Math.min(this.N / 2, Math.max(1, Math.round(fr * this.N / sr))));
      this.ring = new Float32Array(1 << 17); this.mask = (1 << 17) - 1; this.n = 0; this.f0 = null; this.f = 0;
      this.prev = new Float32Array(this.N / 2); this.cur = new Float32Array(this.N / 2);
      this.fl = new Float32Array(64); this.who = new Uint8Array(64); this.rms = new Float32Array(64); this.eng = [0, 1, 2].map(() => new Float32Array(64));
      this.q0 = refs.q.slice(); this.q = refs.q.slice(); this.decay = Math.pow(.5, this.H / sr / 8); // le niveau de référence suit la voix (demi-vie 8 s)
      this.W = Math.max(3, Math.round(.15 * sr / this.H)); this.sens = o.sens != null ? o.sens : .07;
      const dyn = o.dynDb || 38, dyn2 = o.dynDb2 || 55;
      this.gate = Math.max(refs.floor * 2.5, refs.rmax * Math.pow(10, -dyn2 / 20), 0.0004);
      this.gB = refs.emax.map((e, b) => Math.max(refs.efl[b] * 3, e * Math.pow(10, -dyn / 20)));
      this.pend = []; this.recent = []; this.onOnset = o.onOnset || null; this.out = [];
      this.col = o.collect ? { F:[[], [], []], E:[[], [], []], R:[] } : null;
      this.peak = 0;
    }
    // d : bloc mono ; frame : indice (horloge audio) de son premier échantillon
    feed(d, frame){
      if(this.f0 == null) this.f0 = frame;
      const exp = this.f0 + this.n;
      if(frame > exp && frame - exp < 48000){ for(let i = 0; i < frame - exp; i++) this.ring[(this.n + i) & this.mask] = 0; this.n += frame - exp; } // bloc perdu : on comble
      for(let i = 0; i < d.length; i++){ const v = d[i]; this.ring[(this.n + i) & this.mask] = v; const a = v < 0 ? -v : v; if(a > this.peak) this.peak = a; }
      this.n += d.length;
      while(this.f * this.H + this.N <= this.n){ this._frame(this.f); this.f++; }
      while(this.pend.length && this.pend[0].s + 2048 <= this.n) this._final(this.pend.shift());
    }
    // tout ce qui est plus ancien est définitivement décidé (secondes, horloge audio)
    settled(){ return this.f0 == null ? 0 : (this.f0 + this.n - 2048) / this.sr; }
    frontier(){ return this.f0 == null ? 0 : (this.f0 + this.n) / this.sr; }
    _frame(f){
      const N = this.N, H = this.H, o0 = f * H, re = this.re, im = this.im, w = this.w, ring = this.ring, mask = this.mask; let e = 0;
      for(let i = 0; i < N; i++){ const v = ring[(o0 + i) & mask]; e += v * v; re[i] = v * w[i]; im[i] = 0; }
      const rms = Math.sqrt(e / N); RY.fft(re, im);
      const cur = this.cur, prev = this.prev, fb = [0, 0, 0], eb = [0, 0, 0];
      for(let b = 0; b < 3; b++){ let fl = 0, en = 0;
        for(let k = this.bk[b]; k < this.bk[b + 1]; k++){ const p2 = re[k] * re[k] + im[k] * im[k], m = Math.log(1 + 1000 * Math.sqrt(p2)); cur[k] = m; en += p2; if(f > 0){ const d = m - prev[k]; if(d > 0) fl += d; } }
        fb[b] = fl; eb[b] = Math.sqrt(en); }
      this.cur = prev; this.prev = cur;
      if(this.col){ for(let b = 0; b < 3; b++){ this.col.F[b].push(fb[b]); this.col.E[b].push(eb[b]); } this.col.R.push(rms); }
      let best = 0, wb = 0;
      for(let b = 0; b < 3; b++){ const v = fb[b] / this.q[b]; if(v > best){ best = v; wb = b; }
        let q = Math.max(this.q0[b] * .4, this.q[b] * this.decay); if(fb[b] > q) q += .3 * (fb[b] - q); this.q[b] = q; }
      const ix = f & 63; this.fl[ix] = best; this.who[ix] = wb; this.rms[ix] = rms; for(let b = 0; b < 3; b++) this.eng[b][ix] = eb[b];
      // pic au cadre précédent (il faut voir le cadre suivant pour savoir que c'était un pic)
      const p = f - 1; if(p < 2) return;
      const ip = p & 63, i0 = (p - 1) & 63, i2 = f & 63;
      if(this.fl[ip] < this.fl[i0] || this.fl[ip] <= this.fl[i2]) return;
      const loc = []; for(let j = Math.max(0, p - this.W); j <= f; j++) loc.push(this.fl[j & 63]);
      const thr = median(loc) * 1.4 + this.sens, bnd = this.who[ip];
      const r2 = Math.max(this.rms[ip], this.rms[i2]), e2 = Math.max(this.eng[bnd][ip], this.eng[bnd][i2]);
      if(this.fl[ip] > thr && r2 > this.gate && e2 > this.gB[bnd]) this._peak(p, this.fl[ip], bnd);
    }
    _peak(p, v, bnd){
      const sr = this.sr, H = this.H, N = this.N, m1 = Math.max(1, Math.round(.001 * sr)), lag = Math.max(1, Math.round(.002 * sr));
      const s0 = Math.max(lag, p * H - H), s1 = Math.min(this.n - m1 - 1, p * H + N); if(s1 <= s0) return;
      const base = s0 - lag, len = s1 + m1 - base + 1, cs = new Float64Array(len + 1);
      for(let i = 0; i < len; i++) cs[i + 1] = cs[i] + Math.abs(this.ring[(base + i) & this.mask]);
      const env = i => (cs[i - base + m1] - cs[i - base]) / m1, d = []; let md = 0;
      for(let i = s0; i < s1; i++){ const x = env(i) - env(i - lag); d.push(x); if(x > md) md = x; }
      let k = 0; while(k < d.length && d[k] < .5 * md) k++;
      const s = Math.max(0, s0 + k - (lag >> 1));
      this.pend.push({ s, str:v, band:bnd });
    }
    _final(p){
      const x = new Float32Array(2048); for(let i = 0; i < 2048; i++) x[i] = this.ring[(p.s + i) & this.mask];
      const ft = RY.features(x, this.sr, 0), z = { t:(this.f0 + p.s) / this.sr, s:p.s, str:+p.str.toFixed(2), band:p.band, ...ft };
      const l = this.recent[this.recent.length - 1];
      if(l && z.t - l.t < .045) return; // un seul son par 45 ms (le premier : c'est l'attaque)
      if(this.recent.slice(-3).some(q => z.t - q.t < .16 && z.db < q.db - 22 && z.str < .8)) return; // fin d'un son fort
      this.recent.push(z); if(this.recent.length > 6) this.recent.shift();
      this.out.push(z); if(this.onOnset) this.onOnset(z);
    }
    // niveaux de référence à partir d'un enregistrement de test (silence + quelques sons)
    static calibrate(x, sr){
      const D = new LiveDetector(sr, { q:[1, 1, 1], emax:[1, 1, 1], efl:[0, 0, 0], floor:0, rmax:1 }, { collect:true });
      for(let i = 0; i < x.length; i += 128) D.feed(x.subarray(i, Math.min(x.length, i + 128)), i);
      const C = D.col;
      return { q:C.F.map(a => pct(a, .99) || 1), emax:C.E.map(a => pct(a, .995) || 1e-9), efl:C.E.map(a => pct(a, .1)), floor:pct(C.R, .1), rmax:pct(C.R, .995) || 1e-6, sr };
    }
    // rejoue un enregistrement comme si c'était un flux (tests, bilan de calibration)
    static run(x, sr, refs, o){
      const D = new LiveDetector(sr, refs, o); for(let i = 0; i < x.length; i += 128) D.feed(x.subarray(i, Math.min(x.length, i + 128)), i);
      D.feed(new Float32Array(2400), x.length); return D.out;
    }
  }

  // ---------- Juge : place chaque attaque sur une note, score, combo, vie ----------
  class Judge {
    // notes : de buildNotes ; T0 : heure (horloge audio) du 1er clic ; lat : latence totale (s)
    constructor(notes, T0, lat, o){
      o = o || {}; this.notes = notes; this.T0 = T0; this.lat = lat;
      notes.forEach(n => { n.tc = T0 + n.rel; n.t = n.tc + lat; n.state = 0; n.res = null; });
      this.boss = !!o.boss; this.lifeK = o.lifeK || 1; this.soft = !!o.soft; this.strict = !!o.strict; this.lifeDie = !!o.lifeDie; this.first = notes.length ? notes[0].t : 0; this.last = notes.length ? notes[notes.length - 1].t : 0;
      this.score = 0; this.combo = 0; this.maxCombo = 0; this.life = 100; this.dead = false; this.ip = 0; this.charge = 0; this.zaps = 0; this.maxCharged = 0;
      this.cnt = { perfect:0, good:0, miss:0, wrong:0, extra:0 }; this.learned = {}; this.log = []; this.lastHit = null; this.hitDb = []; this.by = {};
      if(o.fp) Object.keys(o.fp).forEach(f => { this.by[f] = o.fp[f].slice(); });
      this.lvl = typeof o.lvl === 'number' ? o.lvl : null; // niveau (dB) de tes vrais sons au test de calibration
      this.cint = o.cint || null; this.dyn = notes.some(n => n.int != null); this.icnt = { ok:0, hi:0, lo:0 }; // intensité : niveaux calibrés par famille {w, n, s} = faible / normal / fort
      this.gLog = this.by.grave && this.by.grave.length ? median(this.by.grave.map(v => v[0])) : Math.log2(300); // centre (log2 Hz) de ton kick
    }
    // niveau de référence des vrais sons : calibration + sons joués jusque-là
    ref(){ const h = this.hitDb.slice(-16); if(this.lvl == null) return h.length >= 4 ? median(h) : -20; return median(Array(6).fill(this.lvl).concat(h)); }
    // bruit de fond / grondement : bien plus faible que tes vrais sons, ou très grave (sous ton kick) et faible. Ne doit jamais prendre la place d'une case.
    // niveaux (dB) d'un son faible / normal / fort pour une famille : calibration « Intensité », sinon écarts moyens autour du niveau normal
    lev(lane){ const I = this.cint && this.cint[lane] || {}, n = I.n != null ? I.n : this.lvl != null ? this.lvl : -20; return { w:Math.min(I.w != null ? I.w : n - 9, n - 5), n, s:Math.max(I.s != null ? I.s : n + 5, n + 4) }; }
    icls(lane, db){ const L = this.lev(lane); return db >= (L.n + L.s) / 2 ? 2 : db <= (L.w + L.n) / 2 ? 0 : 1; }
    _weak(z){ if(this.dyn){ const mw = Math.min(...['grave', 'medium', 'aigu'].map(l => this.lev(l).w)); return z.db < mw - 9 || (Math.log2(Math.max(60, z.c)) < this.gLog - 1 && z.lo > .85 && z.db < mw - 3); }
      const r = this.ref(); if(z.db < r - 14) return true; return Math.log2(Math.max(60, z.c)) < this.gLog - 1 && z.lo > .85 && z.db < r - 8; }
    mult(){ const c = this.combo; return (c >= 50 ? 4 : c >= 25 ? 3 : c >= 10 ? 2 : 1) + (this.charge >= 100 ? 1 : 0); } // barre pleine (électrique) : +1 au multiplicateur
    // barre électrique : +10 par Parfait, « Bien » = neutre, toute erreur (raté, mauvais son, son en trop) la remet à zéro
    _err(){ if(this.charge >= 100) this.zaps++; this.charge = 0; }
    vec(z){ return [Math.log2(Math.max(60, z.c)), z.lo * 3, z.hi * 3]; }
    stats(){
      const fs = Object.keys(this.by).filter(f => this.by[f].length >= 3); if(fs.length < 2) return null;
      const cen = {}; fs.forEach(f => { cen[f] = [0, 1, 2].map(d => median(this.by[f].map(v => v[d]))); });
      const sd = [0, 1, 2].map(d => Math.max(.08, mean(fs.map(f => std(this.by[f].map(v => v[d]))))));
      const dist = (a, b) => Math.sqrt([0, 1, 2].reduce((s, d) => s + ((a[d] - b[d]) / sd[d]) ** 2, 0));
      let sep = 1e9; fs.forEach(a => fs.forEach(b => { if(a < b) sep = Math.min(sep, dist(cen[a], cen[b])); }));
      return { fs, cen, dist, sep };
    }
    _life(dv){ if(this.boss) dv = dv > 0 ? 0 : dv * 1.5; if(dv < 0 && this.lifeK) dv *= this.lifeK; this.life = Math.max(0, Math.min(100, this.life + dv)); if(this.lifeDie && this.life <= 0) this.dead = true; }
    // queue d'un son déjà compté (souffle d'un P, « h » d'un K, fin d'un Ts…) : à ignorer, comme dans RY.match
    _tail(z){
      const h = this.lastHit; if(!h || z.t - h.z.t > .4) return false; const dt = z.t - h.z.t;
      if(h.note.long && Math.abs(Math.log2(Math.max(60, z.c) / Math.max(60, h.z.c))) < 1 && z.db <= h.z.db + 1.5) return true;
      if(dt > .3) return false;
      const rumble = z.lo > .85 && z.c < 220 && z.db <= h.z.db + 1, part2 = dt < .14 && z.db <= h.z.db + 4;
      return z.db < h.z.db - (dt < .15 ? 6 : 9) || rumble || part2;
    }
    _noise(z){ if(this.hitDb.length < 4) return false; const s = this.hitDb.slice().sort((a, b) => a - b); return z.db < Math.min(median(s) - 20, s[Math.floor(s.length * .1)] - 8); }
    recant(n, tok){ if(!n || n.state !== 1) return false; const gr = n.grade; this.cnt[gr] = Math.max(0, (this.cnt[gr] || 0) - 1); this.cnt.wrong++; this.score = Math.max(0, this.score - (gr === 'perfect' ? 100 : 60)); n.state = 3; n.grade = 'wrong'; n.heardTok = tok; this.combo = 0; this._life(-10); this._err(); return true; }
    onset(z){
      const ev = []; if(this.dead) return ev;
      if(z.t < this.first - .25){ z.verdict = 'pre'; this.log.push(z); return ev; }
      if(this._weak(z)){ z.verdict = 'noise'; this.log.push(z); return ev; }
      if(this.notes.length && z.t > this.last + .3){ z.verdict = 'post'; this.log.push(z); return ev; } // après la dernière note : fin de partie, rien n'est jugé
      let best = null, bk = 1e9;
      for(let j = this.ip; j < this.notes.length; j++){ const n = this.notes[j]; if(n.t - n.W > z.t) break; if(n.state !== 0) continue; const d = z.t - n.t; if(Math.abs(d) < n.W && Math.abs(d) / n.W < bk){ bk = Math.abs(d) / n.W; best = n; } }
      if(best){
        const d = z.t - best.t; let heard = null;
        if(this.strict && /^(p|b|k|t|ts)$/i.test(String(best.tok || ''))){ const S = this.stats(), v = this.vec(z); /* « mauvais son » seulement pour les sons du test de calibration (P, K, T/Ts) : L, Pch, Pf, Fsh, Spt, K~… n'ont pas de référence */ if(S && S.sep >= 1.2 && S.cen[best.lane]){
          // début de partie : tes sons « de jeu » ne ressemblent pas encore exactement à ceux du test (plus fort, plus pressé…) → on est plus tolérant tant que la case n'a pas été apprise en jeu
          const nh = (this.learned[best.lane] || 0), mg = nh < 4 ? 2.4 : 1, BAND = { grave:0, medium:1, aigu:2 };
          let nd = S.dist(v, S.cen[best.lane]), nf = best.lane; S.fs.forEach(f => { const dd = S.dist(v, S.cen[f]); if(dd < nd - mg){ nd = dd; nf = f; } });
          if(nf !== best.lane && !(z.band === BAND[best.lane] && nd > 0 && S.dist(v, S.cen[best.lane]) - nd < mg + 1.2)) heard = nf; } }
        // son très faible (souffle, bruit de bouche, queue d'un autre son) tombé dans la fenêtre d'une note : on ne le juge pas « mauvais son »
        if(heard && !this.dyn && this.hitDb.length >= 4 && z.db < median(this.hitDb.slice(-16)) - 12){ z.verdict = 'noise'; this.log.push(z); return ev; }
        // intensité : on compare la force entendue à celle demandée (fort / normal / faible) pour cette famille
        let ih = null, ic = null; if(best.int != null && !heard){ ic = this.icls(best.lane, z.db); z.ic = ic; if(ic !== best.int) ih = ic > best.int ? 'fort' : 'faible'; else this.icnt.ok++; }
        const far = ih != null && Math.abs(ic - best.int) >= 2 && !this.soft; // fort au lieu de faible (ou l'inverse) : compté faux, sauf niveau débutant
        best.res = { d, z, heard }; this.lastHit = { note:best, z }; this.hitDb.push(z.db); z.verdict = heard ? 'wrong' : 'hit'; z.note = best.i;
        if(ih){ this.icnt[ih === 'fort' ? 'hi' : 'lo']++; best.ihint = ih; }
        if(far){ best.state = 3; this.cnt.wrong++; this.combo = 0; this._life(-10); this._err(); best.grade = 'wrong'; ev.push({ type:'wrong', note:best, d, z, heard:null, ihint:ih }); }
        else if(heard){ best.state = 3; this.cnt.wrong++; this.combo = 0; this._life(-10); this._err(); ev.push({ type:'wrong', note:best, d, z, heard }); }
        else {
          best.state = 1; this.learned[best.lane] = (this.learned[best.lane] || 0) + 1; (this.by[best.lane] = this.by[best.lane] || []).push(this.vec(z)); if(this.by[best.lane].length > 30) this.by[best.lane].shift();
          const perfect = Math.abs(d) <= (best.P != null ? best.P : .5 * best.W) && !ih, m = this.mult(); this.combo++; if(this.combo > this.maxCombo) this.maxCombo = this.combo;
          this.score += (perfect ? 100 : 60) * m; this.cnt[perfect ? 'perfect' : 'good']++; this._life(perfect ? 1.5 : .75);
          if(perfect){ this.charge = Math.min(100, this.charge + 10); if(this.charge >= 100) this.maxCharged++; } best.grade = perfect ? 'perfect' : 'good'; ev.push({ type:best.grade, note:best, d, z, ihint:ih });
        }
      } else if(this._tail(z)) z.verdict = 'tail';
      else if(this._noise(z)) z.verdict = 'noise';
      else if(this.soft && z.db < this.ref() - 9) z.verdict = 'noise'; // niveau débutant : un son faible hors case (souffle, queue de son) n'est pas une erreur
      else { z.verdict = 'extra'; this.cnt.extra++; this._life(-5); this._err(); ev.push({ type:'extra', z }); }
      this.log.push(z); return ev;
    }
    // appelé régulièrement avec detector.settled() : les cases dont la fenêtre est passée sont ratées
    advance(settled){
      const ev = [];
      while(this.ip < this.notes.length && this.notes[this.ip].state !== 0) this.ip++;
      for(let j = this.ip; j < this.notes.length; j++){ const n = this.notes[j]; if(n.t + n.W >= settled) break; if(n.state !== 0) continue;
        n.state = 2; this.cnt.miss++; this.combo = 0; this._life(-10); this._err(); ev.push({ type:'miss', note:n }); }
      return ev;
    }
    accuracy(){ const h = this.cnt.perfect + this.cnt.good, t = h + this.cnt.miss + this.cnt.wrong + this.cnt.extra; return t ? Math.round(100 * h / t) : 0; }
  }

  // ---------- divers ----------
  function toWav(x, sr){
    const n = x.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), W = (o, s) => { for(let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    W(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); W(8, 'WAVE'); W(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); W(36, 'data'); v.setUint32(40, n * 2, true);
    for(let i = 0; i < n; i++){ const s = Math.max(-1, Math.min(1, x[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return b;
  }
  // empreintes d'un test de sons : { grave:[vec…], medium:[…], aigu:[…] } à partir des attaques qui tombent dans chaque fenêtre
  function fingerprints(ons, wins){
    const fp = {}, cnt = {}, dbs = [];
    wins.forEach(w => { let l = ons.filter(o => o.t >= w.t0 && o.t < w.t1); if(!l.length){ cnt[w.lane] = 0; return; }
      const mx = Math.max(...l.map(o => o.db)); l = l.filter(o => o.db >= mx - 14).slice(0, 6); cnt[w.lane] = l.length;
      fp[w.lane] = l.map(o => [Math.log2(Math.max(60, o.c)), o.lo * 3, o.hi * 3]); dbs.push(...l.map(o => o.db)); });
    return { fp, cnt, lvl:dbs.length ? median(dbs) : null };
  }
  // essaie 3 réglages de sensibilité sur le test de sons et garde le premier qui entend ~4 sons par famille
  const TUNES = [{ sens:.07, dynDb:38 }, { sens:.04, dynDb:44 }, { sens:.025, dynDb:50 }];
  function tune(x, sr, wins){
    const refs = LiveDetector.calibrate(x, sr); let best = null;
    TUNES.forEach((t, i) => { if(best && best.dev === 0) return;
      const o = { sens:t.sens, dynDb:t.dynDb, dynDb2:t.dynDb + 17 }, ons = LiveDetector.run(x, sr, refs, o), raw = {};
      wins.forEach(w => { raw[w.lane] = ons.filter(z => z.t >= w.t0 && z.t < w.t1).length; });
      const dev = wins.reduce((a, w) => a + (raw[w.lane] < 4 ? (4 - raw[w.lane]) * 2 : Math.max(0, raw[w.lane] - 6)), 0);
      if(!best || dev < best.dev) best = { o, refs, ons, raw, dev, idx:i }; });
    return best;
  }
  // Vérifie le son de chaque case réussie de l'analyse finale contre les sons du test de calibration (référence absolue).
  // RY.analyze compare les familles entre elles dans la prise : si tout est joué pareil (que des kicks), il ne voit aucune confusion.
  function crossCheck(a, fp){
    if(!a || !a._best || !fp) return null;
    const J = new Judge([], 0, 0, { fp }), S = J.stats(); if(!S || S.sep < 1.2) return null;
    const bad = [];
    a._best.hits.forEach(h => { const lane = laneOf(h.e.tok); if(!S.cen[lane]) return; const v = J.vec(h.o); let nd = S.dist(v, S.cen[lane]), nf = lane;
      S.fs.forEach(f => { const d = S.dist(v, S.cen[f]); if(d < nd - 1){ nd = d; nf = f; } }); if(nf !== lane) bad.push({ cell:h.e.i, heard:nf }); });
    return bad;
  }

  // ---------- Hauteur de note (humming / basse / chœurs) : YIN en flux, sur un signal ramené à ~11 kHz ----------
  class PitchTracker {
    constructor(sr, o){ o = o || {}; this.sr = sr; this.D = Math.max(1, Math.round(sr / 11025)); this.sd = sr / this.D; this.W = 512; this.tmin = Math.floor(this.sd / 800); this.tmax = Math.ceil(this.sd / 38); this.hop = Math.round(this.sd * .01);
      this.buf = new Float32Array(1 << 14); this.mask = (1 << 14) - 1; this.n = 0; this.acc = 0; this.k = 0; this.f0 = null; this.next = this.W + this.tmax; this.gate = o.gate != null ? o.gate : .006; this.out = []; this.onFrame = o.onFrame || null; this.d = new Float32Array(this.tmax + 2); this.c = new Float32Array(this.tmax + 2); this.s = 0; }
    feed(d, frame){
      if(this.f0 == null){ this.f0 = frame; }
      for(let i = 0; i < d.length; i++){ this.acc += d[i]; if(++this.k === this.D){ this.buf[this.n & this.mask] = this.acc / this.D; this.n++; this.acc = 0; this.k = 0; } }
      while(this.n >= this.next){ this._frame(this.next); this.next += this.hop; }
    }
    _frame(end){ // fenêtre = [end - W - tmax, end)
      const W = this.W, tmax = this.tmax, b = this.buf, m = this.mask, o = end - W - tmax; let e = 0;
      for(let j = 0; j < W; j++){ const v = b[(o + tmax + j) & m]; e += v * v; } const rms = Math.sqrt(e / W);
      const t = (this.f0 + (end - W / 2) * this.D) / this.sr; // centre de la fenêtre de comparaison, horloge audio (s)
      let f = 0, conf = 1;
      if(rms > this.gate){ const d = this.d, c = this.c; let cs = 0; c[0] = 1;
        for(let tau = 1; tau <= tmax; tau++){ let sum = 0; for(let j = 0; j < W; j++){ const a = b[(o + tmax + j) & m] - b[(o + tmax + j - tau) & m]; sum += a * a; } d[tau] = sum; cs += sum; c[tau] = cs > 1e-12 ? sum * tau / cs : 1; }
        let tau = this.tmin; while(tau < tmax){ if(c[tau] < .16){ while(tau + 1 < tmax && c[tau + 1] < c[tau]) tau++; break; } tau++; }
        if(tau >= tmax){ let mn = 9, mt = 0; for(let q = this.tmin; q < tmax; q++){ if(c[q] < mn){ mn = c[q]; mt = q; } } if(mn < .34){ for(let q = this.tmin; q < tmax; q++){ if(c[q] <= mn + .05 && c[q] <= c[q - 1] && c[q] <= (c[q + 1] != null ? c[q + 1] : 9)){ mt = q; break; } } tau = mt; } }
        if(tau < tmax && c[tau] < .34){ const a = c[tau - 1], bb = c[tau], cc = c[tau + 1] != null ? c[tau + 1] : bb, den = a - 2 * bb + cc, sh = den ? .5 * (a - cc) / den : 0; f = this.sd / (tau + Math.max(-1, Math.min(1, sh))); conf = c[tau]; } }
      const fr = { t, f, rms, conf, m:f > 0 ? 69 + 12 * Math.log2(f / 440) : null }; this.out.push(fr); if(this.onFrame) this.onFrame(fr);
    }
  }
  const circ = (a, b) => { let d = ((a - b) % 12 + 12) % 12; return d > 6 ? 12 - d : d; }; // distance en demi-tons, octave ignorée
  // notes (rythme + hauteur) d'une boucle audio de référence — calculées à l'ouverture, jamais stockées en clair
  function stemNotes(x, sr, bpm){
    const T = new PitchTracker(sr, { gate:.004 }); for(let i = 0; i < x.length; i += 512) T.feed(x.subarray(i, Math.min(x.length, i + 512)), i); T.feed(new Float32Array(sr / 5), x.length);
    const fr = T.out.map(f => ({ t:f.t, m:f.m })), segs = []; let cur = null, gap = 0;
    fr.forEach(f => { if(f.m == null){ if(cur && ++gap > 3){ segs.push(cur); cur = null; } return; } gap = 0;
      if(cur && circ(f.m, cur.m) < .8){ cur.n++; cur.m += (f.m - cur.m) / cur.n; cur.t1 = f.t; } else { if(cur) segs.push(cur); cur = { t0:f.t, t1:f.t, m:f.m, n:1 }; } });
    if(cur) segs.push(cur);
    const spb = 60 / bpm, keep = segs.filter(g => g.n >= 6).map(g => ({ b:Math.max(0, Math.round((g.t0 - .045) / spb * 4) / 4), e:g.t1 / spb, m:g.m }));
    const out = []; keep.forEach((g, i) => { if(out.length && g.b <= out[out.length - 1].b) return; out.push({ beat:g.b, m:g.m, e:g.e, snd:Math.max(.1, g.e - g.b) }); });
    out.forEach((g, i) => { const nx = out[i + 1] ? out[i + 1].beat : Math.max(g.beat + .25, Math.ceil(g.e * 4) / 4); g.dur = Math.max(.25, Math.min(nx - g.beat, g.e - g.beat + .3)); });
    // petites notes collées (doubles croches, glissés, ornements) = un seul geste : un seul bloc, qui accepte chacune des hauteurs qui le composent
    const merged = []; out.forEach(g => { const p = merged[merged.length - 1]; if(p && g.dur <= .25 && p.last <= .25 && Math.abs(p.beat + p.dur - g.beat) < .01){ p.dur += g.dur; p.snd += g.snd; p.ms.push(g.m); p.last = g.dur; } else merged.push(Object.assign({}, g, { ms:[g.m], last:g.dur })); });
    merged.forEach(p => { p.n = p.ms.length; if(p.n > 1) p.m = p.ms.reduce((a, b) => a + b, 0) / p.n; delete p.last; if(p.n === 1) delete p.ms; }); return merged;
  }
  // juge « hauteur » : même interface que Judge (score, vie, combo, barre électrique), mais une note est réussie si tu tiens la bonne hauteur (octave libre)
  class PitchJudge extends Judge {
    constructor(notes, T0, lat, o){ super(notes, T0, lat, o); this.tolP = (o && o.tolP) || .45; this.tolG = (o && o.tolG) || .75; this.cur = null; this.fr = 0; this.voiced = []; this.last = null;
      notes.forEach(n => { n.sec = n.durB * n.spb; n.expF = Math.max(4, Math.min(n.sec, n.sndB != null ? n.sndB * n.spb + .06 : n.sec) * 100 * .85); n.hP = 0; n.hG = 0; n.tot = 0; n.pitch = true; n.dsum = 0; n.dn = 0; n.first = null; n.lastHit = null; n.cov = 0; }); }
    onset(z){ z.verdict = 'pitch'; this.log.push(z); return []; }
    frame(f){ this.fr++; const ok = f.m != null && f.conf < .36; if(ok){ this.cur = { m:f.m, t:f.t }; this.voiced.push([+f.t.toFixed(3), +f.m.toFixed(2), +f.rms.toFixed(4)]); }
      for(let j = this.ip; j < this.notes.length; j++){ const n = this.notes[j]; if(n.t - .05 > f.t) break; if(n.state !== 0) continue; const a = n.t - .05, b = n.t + n.sec + .08; if(f.t < a || f.t > b) continue; n.tot++;
        if(ok){ let dv = ((f.m - n.m) % 12 + 12) % 12; if(dv > 6) dv -= 12; if(n.ms){ for(const q of n.ms){ let e = ((f.m - q) % 12 + 12) % 12; if(e > 6) e -= 12; if(Math.abs(e) < Math.abs(dv)) dv = e; } } const d = Math.abs(dv); if(d <= this.tolG){ n.hG++; n.dsum += dv; n.dn++; if(n.first == null) n.first = f.t; n.lastHit = f.t; if(d <= this.tolP) n.hP++; } } n.cov = Math.min(1, n.hG / n.expF); } }
    advance(settled){ const ev = [];
      while(this.ip < this.notes.length && this.notes[this.ip].state !== 0) this.ip++;
      for(let j = this.ip; j < this.notes.length; j++){ const n = this.notes[j]; if(n.t + n.sec + .14 >= settled) break; if(n.state !== 0) continue;
        const exp = n.expF, cov = Math.min(1, n.hG / exp), acc = n.hG ? n.hP / n.hG : 0, late = n.first == null ? 0 : n.first - n.t; n.cov = cov; n.late = late; n.dev = n.dn ? n.dsum / n.dn : null;
        const hit = ev.push.bind(ev);
        if(n.hG < 3){ n.state = 2; n.grade = 'miss'; this.cnt.miss++; this.combo = 0; this._life(-10); this._err(); hit({ type:'miss', note:n }); }
        else if(cov >= .8 && acc >= .5 && late <= .14){ n.state = 1; n.grade = 'perfect'; this.combo++; this.cnt.perfect++; this.score += 100 * this.mult(); this._life(1.5); this.charge = Math.min(100, this.charge + 10); if(this.charge >= 100) this.maxCharged++; if(this.combo > this.maxCombo) this.maxCombo = this.combo; hit({ type:'perfect', note:n, d:0 }); }
        else if(cov >= .45){ n.state = 1; n.grade = 'good'; this.combo++; this.cnt.good++; this.score += 60 * this.mult(); this._life(.75); if(this.combo > this.maxCombo) this.maxCombo = this.combo; hit({ type:'good', note:n, d:0 }); }
        else { n.state = 1; n.grade = 'short'; this.combo++; this.cnt.good++; this.score += 25 * this.mult(); this._life(0); if(this.combo > this.maxCombo) this.maxCombo = this.combo; hit({ type:'good', note:n, d:0 }); }
        n.res = { m:+n.m.toFixed(2), sec:+n.sec.toFixed(2), cov:+cov.toFixed(2), acc:+acc.toFixed(2), late:+late.toFixed(3), dev:n.dev == null ? null : +n.dev.toFixed(2), hG:n.hG, hP:n.hP, tot:n.tot, g:n.grade }; }
      return ev; }
  }


  // ---------- empreinte d'un son (forme d'onde) : 2 spectres en 16 bandes + enveloppe + durée. Sert à apprendre à distinguer les caisses claires (K / K~ / Pch / Pf / Fsh / Spt…) ----------
  function soundVec(x, sr, i0){
    const N = 1024, nb = 16, lo = 100, hi = Math.min(12000, sr / 2 * .95), edges = []; for(let i = 0; i <= nb; i++) edges.push(lo * Math.pow(hi / lo, i / nb));
    const spec = st => { const re = new Float32Array(N), im = new Float32Array(N); for(let i = 0; i < N; i++){ const v = x[st + i] || 0; re[i] = v * (.5 - .5 * Math.cos(2 * Math.PI * i / N)); } RY.fft(re, im);
      const e = new Float32Array(nb); for(let k = 1; k < N / 2; k++){ const f = k * sr / N; if(f < lo || f >= hi) continue; let b = 0; while(b < nb - 1 && f >= edges[b + 1]) b++; e[b] += re[k] * re[k] + im[k] * im[k]; } return Array.from(e, v => 10 * Math.log10(v + 1e-12)); };
    const a0 = Math.max(0, i0 - Math.round(.004 * sr)), A = spec(a0), B = spec(i0 + Math.round(.03 * sr)), ref = Math.max.apply(null, A);
    const rms = (s0, s1) => { let e = 0, n = 0; for(let i = Math.max(0, i0 + s0); i < Math.min(x.length, i0 + s1); i++){ e += x[i] * x[i]; n++; } return n ? Math.sqrt(e / n) : 0; };
    const ms = v => Math.round(v * sr / 1000), pk = Math.max(1e-6, rms(0, ms(30))), db = v => 20 * Math.log10(Math.max(1e-6, v) / pk);
    const env = [db(rms(0, ms(10))), db(rms(ms(10), ms(30))), db(rms(ms(30), ms(60))), db(rms(ms(60), ms(120)))];
    let z = 0, n30 = ms(30); for(let i = 1; i < n30; i++){ const p = x[i0 + i - 1] || 0, q = x[i0 + i] || 0; if((p >= 0) !== (q >= 0)) z++; }
    let dur = 300; for(let t = 5; t < 300; t += 5){ if(db(rms(ms(t), ms(t + 5))) < -20){ dur = t; break; } }
    return A.map(v => v - ref).concat(B.map(v => v - ref), env, [z / n30 * 100, dur]).map(v => +v.toFixed(1)); }

  return { stripInt, intOf, soundVec, PitchTracker, PitchJudge, stemNotes, circ, LEVELS, crossCheck, tune, LANES, laneOf, buildNotes, LiveDetector, Judge, toWav, fingerprints, median, mean, std, pct };
})();

const SMODEL = {"v": 1, "labels": ["Fsh", "K", "K~", "L", "P", "Pch", "Pf", "Spt", "T", "Th~", "Ts", "Ts~"], "mean": [-145.36849, -25.10651, -12.78866, -12.08947, -17.15279, -14.88189, -12.80153, -17.12318, -18.41502, -17.20025, -15.07308, -14.49152, -12.45756, -14.21979, -13.45877, -15.05955, -145.36849, -31.00443, -21.5857, -22.30676, -25.96828, -24.4655, -22.8034, -27.09152, -28.445, -24.67329, -21.33649, -20.56261, -18.3076, -19.35435, -19.56161, -21.9857, -1.10838, -1.03244, -8.0201, -17.90349, 14.70274, 91.82456], "scale": [9.0416, 15.88031, 13.09433, 10.83813, 8.68013, 7.67907, 7.51645, 7.2558, 7.92633, 8.27277, 9.5013, 10.23726, 7.80626, 8.50846, 9.06549, 10.02601, 9.0416, 17.20018, 17.55459, 15.4964, 13.55535, 12.95658, 12.7436, 13.30682, 14.1817, 15.66994, 17.56854, 18.33305, 16.90218, 16.37713, 16.36554, 16.87807, 5.56434, 2.61509, 7.73023, 10.2472, 12.08198, 65.77046], "coef": [[-0.3964, -3.6387, -0.2419, 1.8941, 1.3254, -1.2329, -2.7278, -1.615, -1.8662, 1.1797, 4.2553, 1.8593, -0.8377, -1.6279, -0.4797, 2.3892, -0.3964, -3.3082, 6.949, 6.3566, -1.5941, -0.8935, -2.1094, -2.6642, -4.9538, -3.6378, 0.6636, 5.7336, 5.5743, -0.0871, -1.7455, -4.9222, -1.3659, 0.3667, 2.2804, 6.3964, 2.6222, 2.3876], [-1.3626, -2.9436, 0.3874, -0.5705, -0.2499, 0.4597, -0.2998, -1.3136, 1.4821, 1.7347, -0.3153, 4.2689, 0.9198, -1.0413, 1.2407, -4.447, -1.3626, 1.0681, 2.4768, 0.3025, 0.2802, -0.1701, -0.5133, -1.0598, -0.5132, -2.1969, 5.9564, 6.6485, 0.4104, -0.6369, -0.1164, -2.0331, 0.8604, -2.2944, -0.2634, -2.4491, -1.5284, -1.1546], [-2.0159, -4.1469, 1.179, 0.2984, -0.6373, -0.2085, -0.0861, -1.1503, 1.6347, 2.4968, 0.2275, 3.1177, 1.5483, -0.9619, 0.3806, -3.7202, -2.0159, 1.6824, 2.9897, 0.7989, 0.5882, -0.3806, -1.1924, -0.8701, -0.732, -2.7156, 3.7537, 7.6509, 2.5289, 2.2645, -1.4532, -3.7654, 0.8591, -1.2944, -3.1786, 2.9078, -1.5798, 3.7061], [1.8048, -1.3829, -3.7524, -2.3824, -0.3815, 0.4539, 6.3789, 3.8795, 1.5918, -3.188, -7.977, -13.34, 5.4247, 3.1249, 1.5087, 0.9414, 1.8048, -1.1591, -3.8027, -5.5732, -0.1218, 0.1675, 6.5172, 3.262, 1.9319, -1.4686, -2.9901, -8.6473, -1.1493, 3.9699, 2.8843, -1.4645, -1.8388, -4.5554, -2.4704, -2.4542, -8.5116, -1.3693], [0.6105, 5.2956, -0.8198, 0.1429, 0.2842, -0.0448, -0.5974, -0.1225, 0.287, -0.1218, -0.1164, 1.3724, -0.8535, -0.6042, -0.7444, -0.7493, 0.6105, 3.0841, 2.1787, 1.1823, -0.2648, 0.1281, 0.2051, 1.2964, 2.0818, -1.4111, -0.5812, -0.5901, -2.5499, -3.8148, -2.85, -3.4249, -0.5233, -1.5387, 0.644, -0.8695, -2.3935, -1.3514], [-1.8447, -1.7164, 2.0417, -1.4966, -0.7014, 1.1659, 0.5665, -0.7776, -0.6857, 0.2684, 0.6749, 1.7839, -0.8644, -0.746, -0.6966, -2.2475, -1.8447, 1.6509, 3.0554, 0.7911, 0.699, -1.1983, -1.9487, -2.7992, -2.5634, -0.0781, 6.0112, 5.7605, 0.0819, -1.5529, -0.4335, 2.0657, -0.0608, 0.1288, -0.8249, 2.0967, -2.8148, 0.2069], [-1.264, -1.7069, 3.118, -2.2384, -0.0935, 0.6756, -0.348, 0.7543, -0.3942, 0.4157, 0.6946, 1.355, -0.2896, -0.4999, -2.0478, -0.2119, -1.264, 2.1159, 3.6489, 0.1959, 0.9727, -0.0737, -0.8688, -0.2115, -1.2053, -0.0138, -0.0808, -0.2772, -1.5171, -0.9663, 0.4275, 3.6824, 0.183, 0.8077, 0.3242, 0.5582, -2.1891, 0.8605], [-0.6998, -3.9211, -3.4992, -1.9668, 1.5232, 1.5032, 0.8848, 0.2972, 1.7344, 0.8542, 4.5184, -1.3475, -0.0929, -0.9048, -1.0437, 0.0404, -0.6998, -3.9085, -5.5979, -1.3488, 0.3148, 1.7887, 1.2572, 2.6002, 4.1186, 4.3013, 3.4422, 0.8895, -1.0319, -4.4345, -2.8775, 2.3357, 2.9504, 1.1055, 2.1687, 0.0758, -5.8763, -2.411], [0.8864, 0.0309, 1.7857, 1.3377, -0.8887, -0.4894, -0.7977, -0.0119, -1.4617, -1.0873, -0.6682, -0.4041, 0.3949, 1.3018, 1.3742, 2.059, 0.8864, -1.6574, -2.0651, -1.1066, 0.4837, 0.1171, -0.6768, -1.8797, -1.8685, 3.8756, -2.778, -1.845, 2.3022, 1.7712, 2.2044, 3.0363, 0.4034, 2.4203, -0.581, -3.3686, 7.3383, -1.6791], [0.9374, -2.2431, 1.4894, 3.094, 0.2254, -1.3664, -0.503, -0.1073, -2.2298, -0.4499, 0.539, -0.9286, -3.0156, -0.7629, 1.2434, 3.8386, 0.9374, -3.257, -4.7502, -0.5394, -0.7488, -0.269, -0.7532, 0.2716, -1.6982, 0.9332, -2.9226, -2.6363, 0.8369, 5.8693, 4.0076, 3.7554, -1.5311, 3.1407, -3.3652, 4.3536, 9.4316, 9.0671], [0.1231, -0.3049, 1.5643, 0.8496, -0.6751, -1.1515, -0.837, -0.0199, -0.718, 0.15, -0.1499, 0.7125, -0.7586, 1.4238, 0.0614, 2.323, 0.1231, -2.346, -2.8535, -0.9947, -0.4056, -0.5004, -0.9935, -1.4822, -2.0449, -0.004, -5.252, -5.7184, 1.7458, 7.3992, 5.3833, 5.6496, 0.7593, 3.4145, 4.2706, -0.8324, 8.3184, -2.2138], [0.2129, -1.6116, 0.788, 1.6108, 0.0876, -0.8711, -1.1537, -0.1914, -1.0658, -0.2509, -0.2537, -0.0132, -1.4036, 1.8245, -0.011, 2.7306, 0.2129, -3.038, -4.8149, -0.1828, -0.7776, -0.6507, -1.5296, -0.9933, -2.1248, -0.2444, -4.6241, -4.2633, 1.0799, 7.6835, 5.78, 4.9156, -1.5427, 3.3214, -0.7259, 5.469, 6.0005, 6.7822]], "icpt": [-27.8074, -14.0231, -19.3716, -69.63, -14.9064, -14.5846, -9.8405, -28.768, -17.4194, -38.8971, -26.696, -36.254], "groups": [["K", "K~"], ["Pch", "Pf"], ["Ts", "Ts~", "Th~"]], "thr": 0.8, "n": 3209};
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

window.BBX_ECOUTE = Object.freeze({ api:ECOUTE_API, version:"v61", date:"2026-11-25", RY, HERO, SMODEL,
  soundGuess, sndSame, sndKnown, sonEntendu, calLire, calEcrire, latence, micOpen, calibrer, note, Ecoute, sonsDevoir });
})();
