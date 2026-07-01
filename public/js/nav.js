// Navegación dashboard ↔ secciones.
import { cerrarDropdown } from './insumos.js';
import { abrirRecetaEnCalc } from './calculadora.js';

export function openSection(id) {
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('sectionsWrapper').classList.add('visible');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.getElementById('backBtn').style.display = 'block';
    cerrarDropdown();
    if (id === 'calculadora') abrirRecetaEnCalc();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function goBack() {
    document.getElementById('dashboard').style.display = 'grid';
    document.getElementById('sectionsWrapper').classList.remove('visible');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('backBtn').style.display = 'none';
}
