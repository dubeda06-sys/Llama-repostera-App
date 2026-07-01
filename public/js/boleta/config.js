// Umbrales del lector de boletas, centralizados.
export const CONF_MIN = 70;        // confianza OCR mínima por fila antes de dudar
export const GEMINI_RETRIES = 2;   // intentos de la IA antes de degradar a OCR local

// tolerancia de cuadre contra el TOTAL impreso
export function cuadreTol() { return 50; }
