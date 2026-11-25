// Fabrique moteur/bbx-ecoute.js à partir des sources de BBX Hero.
// Utilisation : node moteur/fabriquer.js <dossier bbx-hero-src> [version]
//   ex. node moteur/fabriquer.js ../bbx-hero-src v61
// Le fichier produit est le SEUL fichier à déposer sur GitHub (dossier moteur/) pour mettre à jour l'écoute dans BBX Classroom.
const fs = require('fs'), path = require('path');
const src = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'bbx-hero-src'));
const lire = f => fs.readFileSync(path.join(src, f), 'utf8');
let version = process.argv[3];
if(!version){ try{ const m = lire('template.html').match(/const VERSION = '([^']+)'/); version = m ? m[1] : '?'; }catch(e){ version = '?'; } }
const api = fs.readFileSync(path.join(__dirname, 'ecoute-api.js'), 'utf8');
const jour = new Date().toISOString().slice(0, 10);
const out = `/* ===== BBX ÉCOUTE ${version} (${jour}) : moteur de reconnaissance de BBX Hero, partagé avec BBX Classroom =====
   Fichier FABRIQUÉ par moteur/fabriquer.js : ne pas le modifier à la main.
   Contient : ry-engine.js (analyse du rythme), hero-core.js (détecteur et juge en direct), sndmodel.json (modèle des sons), ecoute-api.js.
   Mise à jour : refaire ce fichier depuis BBX Hero, puis le déposer dans le dossier moteur/ du dépôt GitHub. */
(function(){
'use strict';
${lire('ry-engine.js')}
${lire('hero-core.js')}
const SMODEL = ${lire('sndmodel.json').trim()};
${api}
window.BBX_ECOUTE = Object.freeze({ api:ECOUTE_API, version:${JSON.stringify(version)}, date:${JSON.stringify(jour)}, RY, HERO, SMODEL,
  soundGuess, sndSame, sndKnown, sonEntendu, calLire, calEcrire, latence, micOpen, calibrer, note, Ecoute, sonsDevoir });
})();
`;
try{ new Function(out); }catch(e){ console.error('ERREUR de syntaxe :', e.message); process.exit(1); }
const dest = path.join(__dirname, 'bbx-ecoute.js');
fs.writeFileSync(dest, out);
console.log('moteur/bbx-ecoute.js', version, out.length, 'octets');
