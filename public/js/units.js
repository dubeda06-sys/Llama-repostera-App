// Conversión de unidades: familias masa/volumen/unidad y costo por uso.
import { quitarAcentos } from './util.js';

export const FACTORS = { g:1, kg:1000, ml:1, l:1000, unidad:1 };
export const FAMILY  = { g:'masa', kg:'masa', ml:'vol', l:'vol', unidad:'unidad' };

// unidades compatibles con el unidadBase del insumo (misma familia)
export function unidadesCompatibles(insumo) {
    const base = insumo && insumo.unidadBase;
    if (!base) return Object.keys(FACTORS); // sin compras: todas las opciones
    const fam = FAMILY[base];
    return Object.keys(FACTORS).filter(u => FAMILY[u] === fam);
}

// costo de usar `cantidad` en `unidadUso` de un insumo con precio por su unidadBase
// devuelve: number (ok), null (unidad incompatible), 0 (sin precio / sin compras)
export function costoUso(insumo, cantidad, unidadUso) {
    if (insumo == null || insumo.precio == null || !insumo.unidadBase) return 0;
    if (FAMILY[unidadUso] !== FAMILY[insumo.unidadBase]) return null;
    const precioPorBase = insumo.precio / FACTORS[insumo.unidadBase];
    return cantidad * FACTORS[unidadUso] * precioPorBase;
}

// [regex sobre texto normalizado, unidad destino, factor a aplicar a la cantidad]
export const UNIDAD_MAP = [
    { re: /\b(kilogramos?|kilos?|kgs?)\b/, u: 'kg', f: 1 },
    { re: /\b(gramos?|grs?|gr|g)\b/,       u: 'g',  f: 1 },
    { re: /\b(mililitros?|mls?|cc)\b/,     u: 'ml', f: 1 },
    { re: /\b(litros?|lts?|lt|l)\b/,       u: 'l',  f: 1 },
    { re: /\b(tazas?)\b/,                  u: 'ml', f: 240 },
    { re: /\b(cucharaditas?|cdtas?|cdita)\b/, u: 'ml', f: 5 },
    { re: /\b(cucharadas?|cdas?|cda)\b/,   u: 'ml', f: 15 },
    { re: /\b(pizcas?)\b/,                 u: 'g',  f: 0.5 },
    { re: /\b(unidades?|piezas?|uds?)\b/,  u: 'unidad', f: 1 },
];

const UNIDAD_IA = { g:'g', gr:'g', gramo:'g', gramos:'g', kg:'kg', kilo:'kg', kilos:'kg', ml:'ml', cc:'ml', l:'l', lt:'l', litro:'l', litros:'l', un:'unidad', u:'unidad', unidad:'unidad', unidades:'unidad' };
export function normUnidad(u) {
    const k = quitarAcentos(String(u || '').toLowerCase().trim());
    return UNIDAD_IA[k] || 'unidad';
}
