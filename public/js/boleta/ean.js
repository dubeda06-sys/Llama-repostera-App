// Códigos de barras: validación EAN-13, corrección por confusiones de OCR y match a insumo.
import { insumoPorBarras } from '../insumos.js';
import { matchInsumo } from '../match.js';

// valida dígito verificador EAN-13 (descarta lecturas OCR erróneas)
export function validarEAN(code) {
    if (!/^\d{13}$/.test(code)) return code && code.length === 12; // UPC-12: acepta sin validar
    const dig = code.split('').map(Number);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += dig[i] * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    return check === dig[12];
}

// confusiones típicas de OCR entre dígitos (bidireccional)
const OCR_DIGIT_CONF = { '0':['8','6','9'], '8':['0','6','3'], '6':['8','5','0'], '5':['6','9','2'], '9':['0','5'], '1':['7'], '7':['1','2'], '3':['8'], '2':['7','5'] };

// si el EAN no valida el dígito verificador, intenta corregir UN dígito por sus confusiones de OCR.
// devuelve { ean, insumo } — prioriza el candidato que ya esté ligado a un insumo (recupera el indexado).
export function corregirEAN(ean) {
    if (!ean || !/^\d{12,13}$/.test(ean)) return null;
    let validoSinMatch = null;
    for (let i = 0; i < ean.length; i++) {
        const alts = OCR_DIGIT_CONF[ean[i]];
        if (!alts) continue;
        for (const a of alts) {
            const cand = ean.slice(0, i) + a + ean.slice(i + 1);
            if (!validarEAN(cand)) continue;
            const ins = insumoPorBarras(cand);
            if (ins) return { ean: cand, insumo: ins };   // mejor caso: calza con insumo conocido
            if (!validoSinMatch) validoSinMatch = cand;   // respaldo: válido pero sin match
        }
    }
    return validoSinMatch ? { ean: validoSinMatch, insumo: null } : null;
}

// resuelve el match de un ítem a partir de su EAN crudo y nombre.
// devuelve { ean, eanOk, eanCorregido, insumoId, matchSource }
export function resolverMatch(eanRaw, nombre) {
    let ean = eanRaw, eanCorregido = false;
    let eanOk = ean ? validarEAN(ean) : false;
    let insumo = eanOk ? insumoPorBarras(ean) : null;
    // EAN no válido → intentar corrección por confusión OCR
    if (ean && !eanOk) {
        const fix = corregirEAN(ean);
        if (fix) { ean = fix.ean; eanOk = true; eanCorregido = true; insumo = fix.insumo; }
    }
    let matchSource = insumo ? 'ean' : null;
    if (!insumo && nombre) { insumo = matchInsumo(nombre); if (insumo) matchSource = 'nombre'; }
    return { ean, eanOk, eanCorregido, insumoId: insumo ? insumo.id : null, matchSource };
}
