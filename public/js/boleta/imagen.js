// Preprocesado de imagen de boleta: carga, binarización y canvas para OCR / JPEG para IA.
import { b } from './state.js';

// carga la foto respetando la orientación EXIF (las fotos de cámara suelen venir "acostadas"
// en los bytes y solo el EXIF dice cómo pararlas). Fallback al <img> clásico si el navegador
// no soporta createImageBitmap con opciones.
export async function fileToImage(file) {
    try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }
}

// dimensiones de HTMLImageElement o ImageBitmap
function dimsDe(img) {
    return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
}

// umbral de Otsu sobre un histograma de grises (d ya en gris: r=g=b)
export function otsuThreshold(px) {
    const hist = new Array(256).fill(0);
    let total = 0;
    for (let i = 0; i < px.length; i += 4) { hist[px[i]]++; total++; }
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, maxVar = -1, thr = 127;
    for (let t = 0; t < 256; t++) {
        wB += hist[t]; if (!wB) continue;
        const wF = total - wB; if (!wF) break;
        sumB += t * hist[t];
        const mB = sumB / wB, mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > maxVar) { maxVar = between; thr = t; }
    }
    return thr;
}

// umbral local de Sauvola sobre el canal gris (r=g=b) usando imágenes integrales (O(n)).
// Mucho mejor que Otsu global en papel térmico con luz despareja (zonas quemadas/lavadas).
//   T(x,y) = media * (1 + k * (std/128 - 1))
export function sauvolaBinarize(px, w, h, win = 15, k = 0.34) {
    const r = win >> 1;
    const W = w + 1;
    const integ   = new Float64Array(W * (h + 1)); // suma de valores
    const integSq = new Float64Array(W * (h + 1)); // suma de cuadrados
    for (let y = 0; y < h; y++) {
        let rowSum = 0, rowSqSum = 0;
        for (let x = 0; x < w; x++) {
            const v = px[(y * w + x) * 4];
            rowSum += v; rowSqSum += v * v;
            const idx = (y + 1) * W + (x + 1);
            integ[idx]   = integ[y * W + (x + 1)]   + rowSum;
            integSq[idx] = integSq[y * W + (x + 1)] + rowSqSum;
        }
    }
    for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
            const area = (x1 - x0 + 1) * (y1 - y0 + 1);
            const A = (y1 + 1) * W + (x1 + 1), B = (y1 + 1) * W + x0;
            const C = y0 * W + (x1 + 1),       D = y0 * W + x0;
            const sum   = integ[A]   - integ[B]   - integ[C]   + integ[D];
            const sqSum = integSq[A] - integSq[B] - integSq[C] + integSq[D];
            const mean  = sum / area;
            const variance = sqSum / area - mean * mean;
            const std = variance > 0 ? Math.sqrt(variance) : 0;
            const T = mean * (1 + k * (std / 128 - 1));
            const o = (y * w + x) * 4;
            const val = px[o] > T ? 255 : 0;
            px[o] = px[o + 1] = px[o + 2] = val;
        }
    }
}

// dibuja la imagen rotada + grises + contraste + (opcional) binarización local → canvas para OCR
// targetMax = lado mayor deseado en px (acota tamaño para velocidad/memoria)
// extraDeg = inclinación fina adicional (deskew) en grados, se suma a rot
export function prepararCanvas(img, rot, targetMax = 2400, binarizar = false, extraDeg = 0) {
    const rad = (rot + extraDeg) * Math.PI / 180;
    const swap = (rot === 90 || rot === 270);
    const { w, h } = dimsDe(img);
    const baseW = swap ? h : w, baseH = swap ? w : h;
    const scale = targetMax / Math.max(baseW, baseH);
    const cw = Math.round(baseW * scale);
    const ch = Math.round(baseH * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate(rad);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -w / 2, -h / 2);
    ctx.restore();
    const d = ctx.getImageData(0, 0, cw, ch);
    const px = d.data;
    // grises + contraste
    const contrast = 1.45, intercept = 128 * (1 - contrast);
    for (let i = 0; i < px.length; i += 4) {
        let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        g = g * contrast + intercept;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        px[i] = px[i + 1] = px[i + 2] = g;
    }
    // binarización local Sauvola (gran mejora en papel térmico con luz despareja)
    if (binarizar) sauvolaBinarize(px, cw, ch);
    ctx.putImageData(d, 0, 0);
    return canvas;
}

// JPEG base64 de la boleta (color, enderezada, sin binarizar) para la IA de visión
export function boletaParaIA(maxLado = 1500) {
    const img = b.img;
    const rot = b.rot, extra = b.deskew;
    const swap = (rot === 90 || rot === 270);
    const { w, h } = dimsDe(img);
    const baseW = swap ? h : w, baseH = swap ? w : h;
    const scale = Math.min(1, maxLado / Math.max(baseW, baseH));
    const cw = Math.round(baseW * scale), ch = Math.round(baseH * scale);
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((rot + extra) * Math.PI / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -w / 2, -h / 2);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1]; // sin el prefijo data:
}
