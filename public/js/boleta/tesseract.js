// OCR local con Tesseract.js: worker singleton, reconocimiento y detección de orientación.
import { prepararCanvas } from './imagen.js';

let _tessWorker = null;
let _tessOnProgress = null;

async function getTessWorker() {
    if (_tessWorker) return _tessWorker;
    _tessWorker = await Tesseract.createWorker('spa', 1, {
        logger: m => { if (m.status === 'recognizing text' && _tessOnProgress) _tessOnProgress(m.progress); }
    });
    // PSM 6 = bloque uniforme (mejor para boletas en columna); conserva espacios entre palabras
    await _tessWorker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    return _tessWorker;
}

export async function ocrCanvas(canvas, onProgress) {
    const worker = await getTessWorker();
    _tessOnProgress = onProgress || null;
    // { blocks: true } → cajas (bbox) y confianza por palabra (parse espacial por columnas)
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    _tessOnProgress = null;
    return data; // { text, confidence, blocks, ... }
}

// elige orientación con OCR rápido (reducido) en 0/90/180/270 por mayor confianza
export async function detectarRotacion(img) {
    let best = { rot: 0, conf: -1 };
    for (const rot of [0, 90, 180, 270]) {
        try {
            const data = await ocrCanvas(prepararCanvas(img, rot, 1000, true));
            if (data.confidence > best.conf) best = { rot, conf: data.confidence };
        } catch (e) { /* ignora rotación fallida */ }
    }
    return best.rot;
}

// inclinación residual fina: prueba pequeños ángulos por mayor confianza (imagen reducida)
export async function detectarDeskew(img, rot) {
    let best = { deg: 0, conf: -1 };
    for (const deg of [0, -2, 2, -4, 4]) {
        try {
            const data = await ocrCanvas(prepararCanvas(img, rot, 1000, true, deg));
            if (data.confidence > best.conf) best = { deg, conf: data.confidence };
        } catch (e) { /* ignora */ }
    }
    return best.deg;
}
