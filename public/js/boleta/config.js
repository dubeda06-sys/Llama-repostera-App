// Umbrales del lector de boletas, centralizados.
export const CONF_MIN = 70;        // confianza OCR mínima por fila antes de dudar
export const GEMINI_RETRIES = 2;   // intentos de la IA antes de degradar a OCR local
export const GEMINI_BACKOFF_MS = 1500; // espera entre reintentos de la IA

// tolerancia de cuadre contra el TOTAL impreso: escala con el tamaño de la boleta
// (mínimo $50 por redondeos; 0,5% en boletas grandes)
export function cuadreTol(total) {
    return Math.max(50, Math.round((Number(total) || 0) * 0.005));
}
