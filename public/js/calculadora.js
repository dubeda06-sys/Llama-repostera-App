// Calculadora de precios: costo por receta (5 capas) y comparación con competencia.
import { db, updateDoc, doc } from './firebase.js';
import { state } from './state.js';
import { esc } from './util.js';
import { costoUso, FAMILY } from './units.js';
import { renderRecetas } from './recetas.js';

export function calcularCostoReceta(receta) {
    return receta.ingredientes.reduce((total, ing) => {
        const ins = state.insumos.find(i => i.id === ing.insumoId);
        const c = costoUso(ins, ing.cantidad, ing.unidad);
        return total + (c || 0); // null (incompatible) o 0 (sin precio) → 0
    }, 0);
}

// lista de problemas que impiden costear bien una receta
export function avisosReceta(receta) {
    const av = [];
    receta.ingredientes.forEach(ing => {
        const ins = state.insumos.find(i => i.id === ing.insumoId);
        if (!ins) { av.push(`${esc(ing.nombre)}: insumo eliminado`); return; }
        if (ins.precio == null) av.push(`${esc(ing.nombre)}: sin precio`);
        else if (ins.unidadBase && FAMILY[ing.unidad] !== FAMILY[ins.unidadBase]) av.push(`${esc(ing.nombre)}: unidad incompatible (${esc(ing.unidad)} vs ${esc(ins.unidadBase)})`);
    });
    return av;
}

// prellena inputs de la calculadora desde la receta o desde los defaults de Config
export function abrirRecetaEnCalc() {
    const recetaId = document.getElementById('calcReceta').value;
    const cont = document.getElementById('calcInputs');
    if (!recetaId) { cont.style.display = 'none'; document.getElementById('resultadoCalculo').innerHTML = ''; return; }
    const r = state.recetas.find(x => x.id === recetaId);
    if (!r) return;
    const c = r.costos || {};
    document.getElementById('calcHoras').value       = c.horas      != null ? c.horas      : '';
    document.getElementById('calcEmpaque').value     = c.empaque    != null ? c.empaque    : (state.settings.empaqueDefault    || '');
    document.getElementById('calcIndirectos').value  = c.indirectos != null ? c.indirectos : (state.settings.indirectosDefault || '');
    document.getElementById('calcMerma').value       = c.merma      != null ? c.merma      : (state.settings.mermaDefault      || '');
    document.getElementById('calcMargen').value      = c.margen     != null ? c.margen     : (state.settings.margenDefault     || '');
    document.getElementById('calcCompetencia').value = c.competencia != null ? c.competencia : '';
    cont.style.display = 'block';
    calcularPrecio();
}

export function calcularPrecio() {
    const recetaId = document.getElementById('calcReceta').value;
    const el       = document.getElementById('resultadoCalculo');
    if (!recetaId) { el.innerHTML = ''; return; }
    const receta   = state.recetas.find(r => r.id === recetaId);
    if (!receta)   { el.innerHTML = ''; return; }

    const horas       = parseFloat(document.getElementById('calcHoras').value) || 0;
    const empaque     = parseFloat(document.getElementById('calcEmpaque').value) || 0;
    const indirectos  = parseFloat(document.getElementById('calcIndirectos').value) || 0;
    const merma       = parseFloat(document.getElementById('calcMerma').value) || 0;
    const margen      = parseFloat(document.getElementById('calcMargen').value) || 0;
    const competencia = parseFloat(document.getElementById('calcCompetencia').value) || 0;

    // 5 capas
    const materiaPrima = calcularCostoReceta(receta);
    const manoObra     = horas * (state.settings.tarifaHora || 0);
    const costoBase    = materiaPrima + manoObra + empaque + indirectos;
    const conMerma     = costoBase * (1 + merma / 100);
    const precioVenta  = conMerma * (1 + margen / 100);
    const porciones    = receta.porciones || 1;
    const porPorcion   = precioVenta / porciones;
    const gananciaNeta = precioVenta - conMerma;

    const avisos = avisosReceta(receta);
    const avisoHtml = avisos.length
        ? `<div class="calc-aviso">⚠️ Costo incompleto — ${avisos.join(' · ')}</div>`
        : '';

    const cur = state.currency;
    const row = (label, val, extra='') => `<div class="cost-item"><span>${label}</span><span>${esc(cur)}${val.toFixed(2)}${extra}</span></div>`;

    // comparación competencia
    let compHtml = '';
    if (competencia > 0) {
        const costoUnit = conMerma / porciones;
        let msg, color;
        if (competencia < costoUnit) {
            msg = `⚠️ La competencia (${esc(cur)}${competencia.toFixed(2)}) cobra MENOS que tu costo (${esc(cur)}${costoUnit.toFixed(2)}). Revisa tus costos o no entres a ese precio.`;
            color = '#dc3545';
        } else if (competencia < porPorcion) {
            const sugMargen = ((competencia / costoUnit) - 1) * 100;
            msg = `ℹ️ Tu sugerido (${esc(cur)}${porPorcion.toFixed(2)}) está sobre la competencia (${esc(cur)}${competencia.toFixed(2)}). Aún ganas: a precio competencia tu margen sería ~${sugMargen.toFixed(0)}%.`;
            color = '#fd7e14';
        } else {
            msg = `✓ Tu sugerido (${esc(cur)}${porPorcion.toFixed(2)}) está bajo la competencia (${esc(cur)}${competencia.toFixed(2)}). Margen para subir precio.`;
            color = '#28a745';
        }
        compHtml = `<div class="calc-comp" style="--comp-color:${color};">${msg}</div>`;
    }

    el.innerHTML = avisoHtml + `
        <div class="cost-summary">
            <h3>💰 ${esc(receta.nombre)}</h3>
            ${row('🥣 Materia prima', materiaPrima)}
            ${row('👩‍🍳 Mano de obra', manoObra, horas ? ` <small>(${horas}h)</small>` : '')}
            ${row('📦 Empaque', empaque)}
            ${row('⚡ Indirectos', indirectos)}
            <div class="cost-item"><span>Subtotal</span><span>${esc(cur)}${costoBase.toFixed(2)}</span></div>
            ${merma ? row(`🗑️ Merma (${merma}%)`, conMerma - costoBase) : ''}
            <div class="cost-item total-cost"><span>Costo real</span><span>${esc(cur)}${conMerma.toFixed(2)}</span></div>
            ${row(`📈 Ganancia (${margen}%)`, gananciaNeta)}
            <div class="cost-item"><span>Porciones</span><span>${porciones}</span></div>
        </div>
        <div class="profit-result" style="margin-top:16px;">
            Precio de venta: ${esc(cur)}${precioVenta.toFixed(2)}
            <br><small style="font-weight:400;">Por porción: ${esc(cur)}${porPorcion.toFixed(2)}</small>
        </div>` + compHtml;
}

export async function guardarCostosReceta() {
    const recetaId = document.getElementById('calcReceta').value;
    if (!recetaId) return;
    const costos = {
        horas:       parseFloat(document.getElementById('calcHoras').value) || 0,
        empaque:     parseFloat(document.getElementById('calcEmpaque').value) || 0,
        indirectos:  parseFloat(document.getElementById('calcIndirectos').value) || 0,
        merma:       parseFloat(document.getElementById('calcMerma').value) || 0,
        margen:      parseFloat(document.getElementById('calcMargen').value) || 0,
        competencia: parseFloat(document.getElementById('calcCompetencia').value) || 0
    };
    await updateDoc(doc(db, 'recetas', recetaId), { costos });
    const idx = state.recetas.findIndex(r => r.id === recetaId);
    state.recetas[idx] = { ...state.recetas[idx], costos };
    const msg = document.getElementById('calcGuardadoMsg');
    msg.style.display = 'inline';
    setTimeout(() => msg.style.display = 'none', 2000);
    renderRecetas();
}
