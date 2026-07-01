// Configuración: moneda y defaults ponderables (localStorage).
import { state } from './state.js';
import { toast } from './util.js';
import { renderInsumos } from './insumos.js';
import { renderCompras } from './compras.js';
import { renderRecetas } from './recetas.js';
import { calcularPrecio } from './calculadora.js';

export function guardarConfig() {
    const moneda = document.getElementById('configMoneda').value.trim() || '$';
    state.settings = {
        moneda,
        tarifaHora:       parseFloat(document.getElementById('configTarifaHora').value) || 0,
        empaqueDefault:   parseFloat(document.getElementById('configEmpaque').value) || 0,
        indirectosDefault:parseFloat(document.getElementById('configIndirectos').value) || 0,
        mermaDefault:     parseFloat(document.getElementById('configMerma').value) || 0,
        margenDefault:    parseFloat(document.getElementById('configMargen').value) || 0
    };
    state.currency = moneda;
    localStorage.setItem('settings', JSON.stringify(state.settings));
    localStorage.setItem('currency', moneda); // retrocompat
    const msg = document.getElementById('configMsg');
    msg.style.display = 'block';
    setTimeout(() => msg.style.display = 'none', 2000);
    toast('Configuración guardada');
    renderInsumos(); renderCompras(); renderRecetas(); calcularPrecio();
}

export function cargarConfigEnUI() {
    document.getElementById('configMoneda').value      = state.settings.moneda;
    document.getElementById('configTarifaHora').value  = state.settings.tarifaHora      || '';
    document.getElementById('configEmpaque').value     = state.settings.empaqueDefault  || '';
    document.getElementById('configIndirectos').value  = state.settings.indirectosDefault || '';
    document.getElementById('configMerma').value       = state.settings.mermaDefault    || '';
    document.getElementById('configMargen').value      = state.settings.margenDefault   || '';
}
