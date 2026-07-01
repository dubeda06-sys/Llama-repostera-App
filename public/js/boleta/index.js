// Orquestador del lector de boletas: foto → orientación → OCR → parse → (IA si no cuadra) → preview.
import { toast } from '../util.js';
import { b } from './state.js';
import { CONF_MIN, cuadreTol } from './config.js';
import { fileToImage, prepararCanvas } from './imagen.js';
import { ocrCanvas, detectarRotacion, detectarDeskew } from './tesseract.js';
import { filasDesdeBlocks, parseBoletaWords, parseBoleta, detectarTotal } from './parser.js';
import { extraerBoletaIA } from './gemini.js';
import { mostrarCargaBoleta, ocultarCargaBoleta, renderBoletaPreview } from './preview.js';

export async function procesarBoleta(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (typeof Tesseract === 'undefined') return toast('No se pudo cargar el lector OCR (revisa tu conexión)', 'error');
    document.getElementById('boletaPreview').innerHTML = '';
    document.getElementById('boletaRotar').style.display = 'none';
    try {
        mostrarCargaBoleta('Abriendo tu boleta…');
        b.img = await fileToImage(file);
        mostrarCargaBoleta('Mirando bien la foto…');
        b.rot = await detectarRotacion(b.img);
        mostrarCargaBoleta('Enderezando la boleta…');
        b.deskew = await detectarDeskew(b.img, b.rot);
        await leerBoleta();
        ocultarCargaBoleta();
    } catch (e) {
        console.error('Boleta OCR error:', e);
        ocultarCargaBoleta();
        toast('No se pudo leer la boleta', 'error');
    }
}

// OCR completo con la rotación actual → parse → preview
async function leerBoleta() {
    if (!b.img) return;
    const canvas = prepararCanvas(b.img, b.rot, 2400, true, b.deskew);
    mostrarCargaBoleta('Leyendo los productos…', 0);
    const data = await ocrCanvas(canvas, p => mostrarCargaBoleta('Leyendo los productos…', p));
    document.getElementById('boletaRotar').style.display = 'inline-block';
    // depuración temporal
    window.__ocrText = data.text; window.__ocrBlocks = data.blocks;
    // parse espacial por columnas (bbox); si no hay cajas, fallback al parse de texto plano
    const filas = filasDesdeBlocks(data.blocks);
    b.parsed = filas.length ? parseBoletaWords(filas) : parseBoleta(data.text);
    b.total = detectarTotal(data.text);
    b.fuente = 'ocr';
    // híbrido: si Tesseract no cuadra, la llama afina con visión IA (Gemini)
    if (boletaNecesitaIA()) {
        try {
            mostrarCargaBoleta('La llama afina con su súper vista…');
            const ia = await extraerBoletaIA();
            if (ia.items.length) {
                b.parsed = ia.items;
                if (ia.total) b.total = ia.total;
                b.fuente = 'ia';
            }
        } catch (e) {
            console.error('IA boleta error:', e);
            if (!b.iaAvisoMostrado) {
                b.iaAvisoMostrado = true;
                toast('La IA no está disponible (actívala en Firebase). Sigo con la lectura básica.', 'error');
            }
        }
    }
    renderBoletaPreview();
}

export function rotarBoleta() {
    if (!b.img) return;
    b.rot = (b.rot + 90) % 360;
    b.deskew = 0; // el usuario corrige a mano la orientación gruesa
    document.getElementById('boletaPreview').innerHTML = '';
    leerBoleta()
        .then(ocultarCargaBoleta)
        .catch(e => { console.error(e); ocultarCargaBoleta(); toast('Error al releer', 'error'); });
}

// ¿el resultado de Tesseract amerita afinar con IA? (no cuadra, baja confianza o vacío)
function boletaNecesitaIA() {
    if (!b.parsed.length) return true;
    const suma = b.parsed.reduce((s, r) => s + (Number(r.precio) || 0), 0);
    if (b.total && Math.abs(b.total - suma) > cuadreTol(b.total)) return true; // no cuadra con el total
    if (b.parsed.some(r => r.precio <= 0)) return true;                        // precio no leído
    const bajas = b.parsed.filter(r => r.conf != null && r.conf < CONF_MIN).length;
    if (bajas >= 2) return true;                                               // varias filas dudosas
    return false;
}
