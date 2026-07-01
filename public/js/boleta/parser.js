// Parser de boletas: filtra ruido, arma filas espaciales desde bbox y extrae ítems + total.
import { quitarAcentos, hoyISO, parseMontoCL } from '../util.js';
import { resolverMatch } from './ean.js';

const BOLETA_IGNORAR  = /\b(rut|boleta|electronica|sii|cencosud|retail|s\.?a\.?|avenida|avda|av|kennedy|alcalde|infante|condes|poniente|direccion|metropolitana|maipu|sub\s*total|neto|iva|descuentos?|total|debito|credito|vuelto|puntos|nombre|saldo|esta\s+compra|revisa|www|condiciones|terminos|acumul)\b/i;
// ruido de footer/totales que el OCR pega a otras palabras (sin word-boundary): captura
// "NESCUENTOS" (DESCUENTOS mal leído), "puntoscencostd", URLs de puntos, etc.
const BOLETA_IGNORAR2 = /escuent|cencos|puntos|w{2,}\.|\.c[lo]\b|sub\s*total|t\.?\s*debito|vuelto|kennedy|alcalde|infante/i;
const BOLETA_DESCUENTO = /(ofertas?|imbatible|descuento|promo|dcto)/i;
const esLineaIgnorada = l => BOLETA_IGNORAR.test(l) || BOLETA_IGNORAR2.test(l);

// cantidad + unidad desde la descripción (750GR, 1KG, 12 UN…)
export function cantidadUnidadDesc(desc) {
    const n = quitarAcentos(desc.toLowerCase());
    let m;
    if ((m = n.match(/(\d+(?:[.,]\d+)?)\s*kg\b/)))         return { cantidad: parseFloat(m[1].replace(',', '.')), unidad: 'kg' };
    if ((m = n.match(/(\d+(?:[.,]\d+)?)\s*(?:gr|g)\b/)))   return { cantidad: parseFloat(m[1].replace(',', '.')), unidad: 'g' };
    if ((m = n.match(/(\d+(?:[.,]\d+)?)\s*ml\b/)))         return { cantidad: parseFloat(m[1].replace(',', '.')), unidad: 'ml' };
    if ((m = n.match(/(\d+(?:[.,]\d+)?)\s*l\b/)))          return { cantidad: parseFloat(m[1].replace(',', '.')), unidad: 'l' };
    if ((m = n.match(/(\d+)\s*(?:un|u|uds?|unidades?)\b/))) return { cantidad: parseInt(m[1]), unidad: 'unidad' };
    return { cantidad: 1, unidad: 'unidad' };
}

export function limpiarNombreBoleta(desc) {
    return desc
        .replace(/\b\d+\s*(kg|gr|g|ml|l|un|u|uds?|unidades?)\b/gi, ' ') // tokens de tamaño
        .replace(/\b\d{1,6}\b/g, ' ')   // números sueltos restantes (incl. dígitos de miles partidos)
        .replace(/[^\wáéíóúñÁÉÍÓÚÑ\s./%-]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function aplicarDescuento(items, linea) {
    const md = linea.match(/-\s*\d{1,3}(?:[.,\s]\s*\d{3})*/);
    if (md && items.length) {
        const desc = Math.abs(parseMontoCL(md[0]));
        const it = items[items.length - 1];
        it.precio = Math.max(0, it.precio - desc);
        it.descuento = (it.descuento || 0) + desc;
    }
}

export function parseBoleta(texto) {
    const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
    const items = [];
    for (const linea of lineas) {
        // descuentos (aplican al último ítem)
        if (BOLETA_DESCUENTO.test(linea)) { aplicarDescuento(items, linea); continue; }
        if (esLineaIgnorada(linea)) continue;
        // línea de precio por peso ("0,424 KG X $1.990") → no es un ítem propio
        if (/\bkg\s*x\b|\bx\s*\$/i.test(linea)) continue;

        const eanM = linea.match(/\b(\d{12,13})\b/);
        const ean = eanM ? eanM[1] : null;

        // antes se exigía EAN: si el OCR manchaba 1 dígito del código perdíamos el
        // ítem completo. Ahora aceptamos líneas sin EAN, pero con guardas para no
        // colar totales/basura (BOLETA_IGNORAR ya filtró total/subtotal/iva/etc.):
        //   - debe tener letras (un nombre de producto, no solo números)
        //   - quedan marcadas "nuevo" para revisión manual.
        if (!ean && !/[a-záéíóúñ]{3,}/i.test(linea)) continue;

        // candidatos a precio: montos con miles (6.790 / 6 790 / 6, 757) o enteros 3-6 dígitos (844)
        const precios = linea.match(/-?\d{1,3}(?:[.,\s]\s*\d{3})+|\b\d{3,6}\b/g);
        if (!precios) continue;
        let precio = null;
        for (let i = precios.length - 1; i >= 0; i--) {
            if (ean && precios[i].replace(/[^\d]/g, '') === ean) continue;
            const v = parseMontoCL(precios[i]);
            if (v && v > 0 && v < 1000000) { precio = v; break; }
        }
        if (precio == null) continue;

        // descripción: quitar EAN y montos con miles; extraer cantidad/unidad ANTES de limpiar
        let desc = linea;
        if (ean) desc = desc.replace(ean, ' ');
        desc = desc.replace(/-?\d{1,3}(?:[.,\s]\s*\d{3})+/g, ' ');
        const { cantidad, unidad } = cantidadUnidadDesc(desc);
        const nombre = limpiarNombreBoleta(desc);
        if (nombre.length < 2) continue;

        // match: EAN válido/corregido primero (indexador), luego nombre
        const m = resolverMatch(ean, nombre);
        items.push({ ...m, nombreRaw: nombre, cantidad, unidad, precio, descuento: 0, fecha: hoyISO(), conf: null });
    }
    return items;
}

// ── Parse espacial por columnas (usa cajas/bbox de Tesseract) ──────────
// aplana blocks→...→words y agrupa en filas por solapamiento vertical
export function filasDesdeBlocks(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return [];
    const words = [];
    const walk = node => {
        if (!node) return;
        if (Array.isArray(node.words)) for (const w of node.words) {
            const t = (w.text || '').trim();
            if (t && w.bbox) words.push({ text: t, conf: w.confidence ?? 0, bbox: w.bbox });
        }
        for (const key of ['blocks', 'paragraphs', 'lines', 'children']) {
            if (Array.isArray(node[key])) for (const c of node[key]) walk(c);
        }
    };
    for (const bl of blocks) walk(bl);
    if (!words.length) return [];

    // altura mediana de palabra → tolerancia de fila
    const alturas = words.map(w => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
    const hMed = alturas[alturas.length >> 1] || 12;
    const tol = hMed * 0.6;

    words.sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1));
    const filas = [];
    for (const w of words) {
        const cy = (w.bbox.y0 + w.bbox.y1) / 2;
        let fila = filas.find(f => Math.abs(f.cy - cy) <= tol);
        if (!fila) { fila = { cy, words: [] }; filas.push(fila); }
        fila.words.push(w);
        // centro-y promedio ponderado para estabilizar la agrupación
        fila.cy = fila.words.reduce((s, x) => s + (x.bbox.y0 + x.bbox.y1) / 2, 0) / fila.words.length;
    }
    for (const f of filas) f.words.sort((a, b) => a.bbox.x0 - b.bbox.x0); // izquierda→derecha
    return filas;
}

export function parseBoletaWords(filas) {
    const items = [];
    for (const fila of filas) {
        const linea = fila.words.map(w => w.text).join(' ');
        if (BOLETA_DESCUENTO.test(linea)) { aplicarDescuento(items, linea); continue; }
        if (esLineaIgnorada(linea)) continue;
        if (/\bkg\s*x\b|\bx\s*\$/i.test(linea)) continue;

        // EAN: token (o tokens contiguos) de 12-13 dígitos
        const eanM = linea.match(/\b(\d{12,13})\b/);
        const ean = eanM ? eanM[1] : null;
        if (!ean && !/[a-záéíóúñ]{3,}/i.test(linea)) continue;

        // precio: el clúster numérico más a la derecha que sea monto plausible y no el EAN.
        // recorre las words de derecha a izquierda buscando tokens numéricos.
        let precio = null, precioX = Infinity;
        for (let i = fila.words.length - 1; i >= 0; i--) {
            const t = fila.words[i].text;
            if (!/\d/.test(t)) continue;
            const soloNum = t.replace(/[^\d]/g, '');
            if (ean && soloNum === ean) continue;
            if (!/^-?\$?\d{1,3}(?:[.,\s]?\d{3})*$|^-?\$?\d{3,6}$/.test(t)) continue;
            const v = parseMontoCL(t);
            if (v && v > 0 && v < 1000000) { precio = v; precioX = fila.words[i].bbox.x0; break; }
        }
        // respaldo: regex sobre la línea aplanada (por si el precio quedó partido en 2 words)
        if (precio == null) {
            const precios = linea.match(/-?\d{1,3}(?:[.,\s]\s*\d{3})+|\b\d{3,6}\b/g);
            if (precios) for (let i = precios.length - 1; i >= 0; i--) {
                if (ean && precios[i].replace(/[^\d]/g, '') === ean) continue;
                const v = parseMontoCL(precios[i]);
                if (v && v > 0 && v < 1000000) { precio = v; break; }
            }
        }
        if (precio == null) continue;

        // nombre: tokens de texto (con letras) a la izquierda del precio, sin el EAN
        const nombreTokens = fila.words
            .filter(w => w.bbox.x0 < precioX && w.text.replace(/[^\d]/g, '') !== ean)
            .map(w => w.text).join(' ');
        let desc = nombreTokens || linea;
        if (ean) desc = desc.replace(ean, ' ');
        desc = desc.replace(/-?\d{1,3}(?:[.,\s]\s*\d{3})+/g, ' ');
        const { cantidad, unidad } = cantidadUnidadDesc(desc);
        const nombre = limpiarNombreBoleta(desc);
        if (nombre.length < 2) continue;

        const conf = Math.round(fila.words.reduce((s, w) => s + w.conf, 0) / fila.words.length);
        const m = resolverMatch(ean, nombre);
        items.push({ ...m, nombreRaw: nombre, cantidad, unidad, precio, descuento: 0, fecha: hoyISO(), conf });
    }
    return items;
}

// lee el TOTAL impreso (no SUB TOTAL) para cuadrar contra la suma de ítems
export function detectarTotal(texto) {
    const lineas = texto.split('\n');
    let total = null;
    for (const l of lineas) {
        if (!/\btotal\b/i.test(l)) continue;
        if (/sub\s*total/i.test(l)) continue;
        const montos = l.match(/\d{1,3}(?:[.,\s]\s*\d{3})+|\b\d{3,6}\b/g);
        if (montos) { const v = parseMontoCL(montos[montos.length - 1]); if (v && v > 0) total = v; }
    }
    return total;
}
