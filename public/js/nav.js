// Navegación dashboard ↔ secciones, integrada con el historial del navegador:
// el botón atrás del teléfono (Android) vuelve al dashboard en vez de cerrar la PWA.
import { cerrarDropdown } from './insumos.js';
import { abrirRecetaEnCalc } from './calculadora.js';
import { mostrarHint } from './ui/llama.js';

// trabajo de DOM puro (sin tocar el historial)
function mostrarSeccion(id) {
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('sectionsWrapper').classList.add('visible');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.getElementById('backBtn').style.display = 'block';
    cerrarDropdown();
    if (id === 'calculadora') abrirRecetaEnCalc();
    mostrarHint(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // mueve el foco al título de la sección (lectores de pantalla y navegación con teclado)
    document.querySelector(`#${id} .section-title`)?.focus({ preventScroll: true });
}

function mostrarDashboard() {
    document.getElementById('dashboard').style.display = 'grid';
    document.getElementById('sectionsWrapper').classList.remove('visible');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('backBtn').style.display = 'none';
}

export function openSection(id) {
    mostrarSeccion(id);
    if (!(history.state && history.state.seccion === id)) {
        history.pushState({ seccion: id }, '', '');
    }
}

export function goBack() {
    // si nosotros pusimos la entrada en el historial, deshacerla (popstate hace el resto);
    // si no (carga directa), solo volver al dashboard
    if (history.state && history.state.seccion) history.back();
    else mostrarDashboard();
}

window.addEventListener('popstate', e => {
    if (e.state && e.state.seccion) mostrarSeccion(e.state.seccion);
    else mostrarDashboard();
});
