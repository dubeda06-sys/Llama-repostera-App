// Orquestador del lector de boletas — IA primero, OCR local de respaldo.
// Flujo normal: foto → Gemini (1 llamada, con reintento) → validar → preview.
// Degradado (sin internet / cuota / error IA): Tesseract con detección de orientación.
import { toast } from '../util.js';
import { b } from './state.js';
import { GEMINI_RETRIES, GEMINI_BACKOFF_MS, cuadreTol } from './config.js';
import { fileToImage, prepararCanvas } from './imagen.js';
import { ocrCanvas, detectarRotacion, detectarDeskew } from './tesseract.js';
import { filasDesdeBlocks, parseBoletaWords, parseBoleta, detectarTotal } from './parser.js';
import { extraerBoletaIA, validarResultadoIA } from './gemini.js';
import { mostrarCargaBoleta, ocultarCargaBoleta, renderBoletaPreview } from './preview.js';

const espera = ms => new Promise(r => setTimeout(r, ms));

export async function procesarBoleta(event) {
    const file = event.target.files[0];
    if (!file) return;
    document.getElementById('boletaPreview').innerHTML = '';
    document.getElementById('boletaRotar').style.display = 'none';
    try {
        mostrarCargaBoleta('Abriendo tu boleta…');
        b.img = await fileToImage(file);
        b.rot = 0; b.deskew = 0;

        // 1) IA primero: más precisa y ~10× más rápida que el OCR local en celular
        let ia = null;
        for (let intento = 1; intento <= GEMINI_RETRIES; intento++) {
            try {
                mostrarCargaBoleta(intento === 1
                    ? 'La llama lee tu boleta con su súper vista…'
                    : 'Mirando de nuevo, con más calma…');
                const res = await extraerBoletaIA(intento > 1);
                if (res.items.length) {
                    const v = validarResultadoIA(res.items, res.total, cuadreTol(res.total));
                    ia = { items: v.items, total: res.total, cuadra: v.cuadra };
                    if (v.cuadra !== false) break; // cuadra o no hay total → listo
                    // no cuadró: reintenta una vez con el prompt endurecido
                }
            } catch (e) {
                console.error(`IA boleta intento ${intento}:`, e);
            }
            if (intento < GEMINI_RETRIES) await espera(GEMINI_BACKOFF_MS);
        }
        if (ia && ia.items.length) {
            b.parsed = ia.items;
            b.total = ia.total;
            b.fuente = 'ia';
            renderBoletaPreview();
            ocultarCargaBoleta();
            return;
        }

        // 2) Respaldo: OCR local completo (Tesseract)
        if (!b.iaAvisoMostrado) {
            b.iaAvisoMostrado = true;
            toast('La llama IA no está disponible ahora — uso la lectura local (más lenta).', 'info');
        }
        if (typeof Tesseract === 'undefined') {
            ocultarCargaBoleta();
            return toast('No se pudo leer la boleta: sin IA y sin lector OCR (revisa tu conexión)', 'error');
        }
        mostrarCargaBoleta('Mirando bien la foto…');
        b.rot = await detectarRotacion(b.img);
        mostrarCargaBoleta('Enderezando la boleta…');
        b.deskew = await detectarDeskew(b.img, b.rot);
        await leerBoletaOCR();
        ocultarCargaBoleta();
    } catch (e) {
        console.error('Boleta error:', e);
        ocultarCargaBoleta();
        toast('No se pudo leer la boleta', 'error');
    }
}

// OCR local con la rotación actual → parse → preview (solo camino degradado)
async function leerBoletaOCR() {
    if (!b.img) return;
    const canvas = prepararCanvas(b.img, b.rot, 2400, true, b.deskew);
    mostrarCargaBoleta('Leyendo los productos…', 0);
    const data = await ocrCanvas(canvas, p => mostrarCargaBoleta('Leyendo los productos…', p));
    document.getElementById('boletaRotar').style.display = 'inline-block';
    // depuración: activar con localStorage.debugOCR = '1'
    if (localStorage.getItem('debugOCR')) console.log('OCR debug:', data.text, data.blocks);
    // parse espacial por columnas (bbox); si no hay cajas, fallback al parse de texto plano
    const filas = filasDesdeBlocks(data.blocks);
    b.parsed = filas.length ? parseBoletaWords(filas) : parseBoleta(data.text);
    b.total = detectarTotal(data.text);
    b.fuente = 'ocr';
    renderBoletaPreview();
}

// rotación manual: solo tiene sentido en el camino OCR (la IA endereza sola)
export function rotarBoleta() {
    if (!b.img || b.fuente !== 'ocr') return;
    b.rot = (b.rot + 90) % 360;
    b.deskew = 0; // el usuario corrige a mano la orientación gruesa
    document.getElementById('boletaPreview').innerHTML = '';
    leerBoletaOCR()
        .then(ocultarCargaBoleta)
        .catch(e => { console.error(e); ocultarCargaBoleta(); toast('Error al releer', 'error'); });
}
