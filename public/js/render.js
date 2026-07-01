// Render global: refresco masivo + selects y contadores compartidos.
import { state } from './state.js';
import { esc } from './util.js';
import { renderInsumos, renderBarras } from './insumos.js';
import { renderCompras } from './compras.js';
import { renderRecetas, actualizarUnidadIngrediente } from './recetas.js';

export function renderAll() {
    renderInsumos();
    renderCompras();
    renderRecetas();
    renderBarras();
    actualizarSelects();
    actualizarContadores();
}

export function actualizarSelects() {
    const opts = '<option value="">Selecciona un insumo</option>' +
        state.insumos.map(i => `<option value="${i.id}">${i.codigo ? '['+esc(i.codigo)+'] ' : ''}${esc(i.nombre)}${i.unidadBase ? ' ('+esc(i.unidadBase)+')' : ''}</option>`).join('');
    document.getElementById('compraInsumo').innerHTML = opts;
    document.getElementById('ingredienteInsumo').innerHTML = opts;
    const barrasSel = document.getElementById('barrasInsumo');
    if (barrasSel) barrasSel.innerHTML = '<option value="">Selecciona un insumo</option>' +
        state.insumos.map(i => `<option value="${i.id}">${i.codigo ? '['+esc(i.codigo)+'] ' : ''}${esc(i.nombre)}</option>`).join('');
    actualizarUnidadIngrediente();
    actualizarCalcSelect();
}

export function actualizarCalcSelect() {
    document.getElementById('calcReceta').innerHTML =
        '<option value="">Selecciona una receta</option>' +
        state.recetas.map(r => `<option value="${r.id}">${esc(r.nombre)}</option>`).join('');
}

export function actualizarContadores() {
    document.getElementById('countInsumos').textContent = state.insumos.length;
    document.getElementById('countCompras').textContent = state.compras.length;
    document.getElementById('countRecetas').textContent = state.recetas.length;
}
