// Match difuso de nombres de producto → insumo existente (boletas e importador de recetas).
// Similitud = Dice sobre bigramas + solape de tokens, con boost por contención de substring
// (así nada que calzaba antes deja de calzar).
import { state } from './state.js';
import { quitarAcentos } from './util.js';

const UMBRAL = 0.55;

function norm(s) { return quitarAcentos(String(s || '').toLowerCase()).replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim(); }

function bigramas(s) {
    const set = new Map();
    const t = s.replace(/\s+/g, ' ');
    for (let i = 0; i < t.length - 1; i++) {
        const bg = t.slice(i, i + 2);
        set.set(bg, (set.get(bg) || 0) + 1);
    }
    return set;
}

function dice(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const [bg, n] of a) inter += Math.min(n, b.get(bg) || 0);
    let ta = 0, tb = 0;
    for (const n of a.values()) ta += n;
    for (const n of b.values()) tb += n;
    return (2 * inter) / (ta + tb);
}

// solape de tokens: proporción de palabras (largo>2) de la consulta presentes en el candidato
function solapeTokens(qTokens, cTokens) {
    const utiles = qTokens.filter(t => t.length > 2);
    if (!utiles.length) return 0;
    const setC = new Set(cTokens);
    const hits = utiles.filter(t => setC.has(t)).length;
    return hits / utiles.length;
}

export function similitud(a, b) {
    const na = norm(a), nb = norm(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    let score = 0.7 * dice(bigramas(na), bigramas(nb)) + 0.3 * solapeTokens(na.split(' '), nb.split(' '));
    // contención (comportamiento antiguo): "LECHE ENTERA COLUN 1L" contiene "leche" → match fuerte
    if (na.includes(nb) || nb.includes(na)) score = Math.max(score, 0.9);
    // mejor par de tokens: rescata "MANTEQUILA SOPROLE" ↔ "Mantequilla" (typo) y
    // "AZUCAR GRANULADA IANSA" ↔ "Azúcar Blanca" (palabra clave compartida entre ruido)
    const ta = na.split(' ').filter(t => t.length >= 4);
    const tb = nb.split(' ').filter(t => t.length >= 4);
    let mejorTok = 0;
    for (const x of ta) for (const y of tb) {
        const d = (x === y) ? 1 : dice(bigramas(x), bigramas(y));
        if (d > mejorTok) mejorTok = d;
    }
    if (mejorTok >= 0.8) score = Math.max(score, 0.85 * mejorTok);
    return score;
}

// lista de candidatos ordenados por similitud (score ≥ UMBRAL)
export function matchInsumoScored(nombre) {
    if (!nombre) return [];
    return state.insumos
        .map(i => ({ insumo: i, score: similitud(nombre, i.nombre) }))
        .filter(x => x.score >= UMBRAL)
        .sort((a, b) => b.score - a.score);
}

// compat: mejor candidato o undefined (misma firma que el match antiguo)
export function matchInsumo(nombre) {
    return matchInsumoScored(nombre)[0]?.insumo;
}
