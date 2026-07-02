// Escáner de códigos de barra con la cámara, usando la API nativa BarcodeDetector
// (Chrome/Edge en Android y escritorio). Sin librerías: si el navegador no la
// soporta, los botones 📷 simplemente no se muestran y queda el tipeo manual.
import { toast } from './util.js';

export const scannerSoportado = 'BarcodeDetector' in window;

let stream = null;   // MediaStream activo (para apagar la cámara SIEMPRE al salir)
let loopId = null;

function overlayScanner() {
    let el = document.getElementById('scannerOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'scannerOverlay';
    el.className = 'scanner-overlay';
    el.hidden = true;
    el.innerHTML = `
        <div class="so-card">
            <video id="scannerVideo" autoplay playsinline muted></video>
            <div class="so-marco" aria-hidden="true"></div>
            <p class="so-texto">Apunta al código de barras 🦙</p>
            <button type="button" class="btn btn-edit" id="scannerCancelar">✕ Cancelar</button>
        </div>`;
    document.body.appendChild(el);
    return el;
}

function cerrarScanner() {
    if (loopId) { clearInterval(loopId); loopId = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    const el = document.getElementById('scannerOverlay');
    if (el) el.hidden = true;
    document.removeEventListener('keydown', onEsc);
}

function onEsc(e) { if (e.key === 'Escape') cerrarScanner(); }

// abre la cámara y, al leer un código, lo escribe en el input y dispara su evento input
export async function escanearBarras(inputId) {
    if (!scannerSoportado) return toast('Tu navegador no soporta el escáner — escribe el código a mano', 'info');
    const overlay = overlayScanner();
    const video = document.getElementById('scannerVideo');
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }, audio: false
        });
    } catch (e) {
        console.warn('Cámara no disponible:', e);
        return toast('No pude abrir la cámara — revisa el permiso en el navegador', 'error');
    }
    video.srcObject = stream;
    overlay.hidden = false;
    document.getElementById('scannerCancelar').onclick = cerrarScanner;
    overlay.onclick = e => { if (e.target === overlay) cerrarScanner(); };
    document.addEventListener('keydown', onEsc);

    const detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']
    });
    loopId = setInterval(async () => {
        if (!stream || video.readyState < 2) return;
        try {
            const codigos = await detector.detect(video);
            if (!codigos.length) return;
            const valor = codigos[0].rawValue;
            if (!valor) return;
            cerrarScanner();
            if (navigator.vibrate) navigator.vibrate(80);
            const input = document.getElementById(inputId);
            if (input) {
                input.value = valor;
                input.dispatchEvent(new Event('input', { bubbles: true })); // corre lookupBarras etc.
                input.focus();
            }
            toast(`Código leído: ${valor} ✓`);
        } catch (e) {
            // detect() puede fallar en frames sueltos; se ignora y reintenta
        }
    }, 200);
}
