// Compras: tabla, registro manual y núcleo compartido con el lector de boletas.
import { db, collection, addDoc, deleteDoc, updateDoc, doc } from './firebase.js';
import { state } from './state.js';
import { esc, toast, toastDeshacer, btnLoading, marcarError, numValido } from './util.js';
import { FACTORS } from './units.js';
import { actualizarContadores } from './render.js';
import { renderInsumos } from './insumos.js';
import { renderRecetas } from './recetas.js';
import { calcularPrecio } from './calculadora.js';
import { llamaHtml, celebrar } from './ui/llama.js';

// resumen de gastos: mes actual vs anterior + top 5 insumos del mes
function resumenComprasHtml() {
    const hoy = new Date();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const prev = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const mesAnterior = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

    let gastoActual = 0, gastoAnterior = 0;
    const porInsumo = new Map();
    for (const c of state.compras) {
        const mes = (c.fecha || '').slice(0, 7);
        const monto = parseFloat(c.precio) || 0;
        if (mes === mesActual) {
            gastoActual += monto;
            porInsumo.set(c.insumoId, (porInsumo.get(c.insumoId) || 0) + monto);
        } else if (mes === mesAnterior) gastoAnterior += monto;
    }
    if (!gastoActual && !gastoAnterior) return '';

    const cur = esc(state.currency);
    let comparacion = '';
    if (gastoAnterior > 0) {
        const pct = ((gastoActual - gastoAnterior) / gastoAnterior) * 100;
        const clase = pct > 1 ? 'ht-sube' : (pct < -1 ? 'ht-baja' : 'ht-igual');
        const flecha = pct > 1 ? '↑ +' : (pct < -1 ? '↓ ' : '= ');
        comparacion = `<span class="hist-tend ${clase}">${flecha}${Math.abs(pct).toFixed(0)}% vs mes anterior (${cur}${gastoAnterior.toLocaleString('es-CL')})</span>`;
    }

    const top = [...porInsumo.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    const maxTop = top.length ? top[0][1] : 0;
    const topHtml = top.map(([id, monto]) => {
        const ins = state.insumos.find(i => i.id === id);
        return `<div class="rg-fila">
            <span class="rg-nombre">${ins ? esc(ins.nombre) : '(eliminado)'}</span>
            <span class="rg-monto">${cur}${monto.toLocaleString('es-CL')}</span>
            <span class="rg-barra"><span style="width:${maxTop ? (monto / maxTop * 100).toFixed(0) : 0}%"></span></span>
        </div>`;
    }).join('');

    return `<div class="resumen-gastos">
        <div class="rg-head">🧮 Gasto de ${hoy.toLocaleDateString('es-CL', { month: 'long' })}: <strong>${cur}${gastoActual.toLocaleString('es-CL')}</strong> ${comparacion}</div>
        ${topHtml}
    </div>`;
}

export function renderCompras() {
    const el = document.getElementById('listaCompras');
    if (!state.compras.length) {
        el.innerHTML = llamaHtml(
            'Todavía no hay compras. Sácale una foto a tu boleta y <strong>yo la leo con mi súper vista</strong> 📷',
            { cta: { texto: '📷 Escanear boleta', onclick: "document.getElementById('boletaFile').click()" } }
        );
        return;
    }
    const sorted = [...state.compras].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    el.innerHTML = resumenComprasHtml() + `<div class="table-wrap"><table><thead><tr>
        <th>Fecha</th><th>Insumo</th><th>Cantidad</th><th>Precio</th><th></th>
    </tr></thead><tbody>
    ${sorted.map(c => {
        const ins = state.insumos.find(i => i.id === c.insumoId);
        return `<tr>
            <td>${new Date(c.fecha + 'T00:00').toLocaleDateString()}</td>
            <td>${ins ? esc(ins.nombre) : 'N/A'}</td>
            <td>${c.cantidad} ${esc(c.unidad || (ins ? ins.unidad : ''))}</td>
            <td>${esc(state.currency)}${parseFloat(c.precio).toFixed(2)}</td>
            <td><button class="btn btn-danger btn-sm" onclick="eliminarCompra('${c.id}')">🗑️</button></td>
        </tr>`;
    }).join('')}
    </tbody></table></div>`;
}

// núcleo reutilizable: registra una compra y reescribe el precio/unidadBase del insumo
export async function registrarCompraCore(insumoId, cantidad, unidad, precio, fecha) {
    const ref = await addDoc(collection(db, 'compras'), { insumoId, cantidad, unidad, precio, fecha, fechaRegistro: new Date().toISOString() });
    state.compras.push({ id: ref.id, insumoId, cantidad, unidad, precio, fecha });

    // Última compra reescribe el precio del insumo y fija unidadBase si no estaba
    const ins = state.insumos.find(i => i.id === insumoId);
    if (ins) {
        // unidadBase: g para masa, ml para volumen, unidad para contados
        const BASE_MAP = { g:'g', kg:'g', ml:'ml', l:'ml', unidad:'unidad' };
        const unidadBase = BASE_MAP[unidad] || unidad;
        // precio por unidadBase: total / cantidad_en_base_units
        const precioPorBase = precio / (cantidad * FACTORS[unidad]);
        const precioNuevo  = precioPorBase * FACTORS[unidadBase];
        await updateDoc(doc(db, 'insumos', insumoId), { precio: precioNuevo, unidadBase });
        ins.precio = precioNuevo;
        ins.unidadBase = unidadBase;
    }
}

export async function agregarCompra(btn) {
    const insumoId = document.getElementById('compraInsumo').value;
    const cantidad = parseFloat(document.getElementById('compraCantidad').value);
    const unidad   = document.getElementById('compraUnidad').value;
    const precio   = parseFloat(document.getElementById('compraPrecio').value);
    const fecha    = document.getElementById('compraFecha').value;
    // marcar el primer campo faltante en vez de solo un toast seco
    if (!insumoId)  { marcarError(document.getElementById('compraInsumo'));  return toast('Elige el insumo comprado', 'error'); }
    if (!numValido(cantidad, { min: 0.001 })) { marcarError(document.getElementById('compraCantidad')); return toast('Ingresa una cantidad válida', 'error'); }
    if (!numValido(precio, { min: 0.01 }))    { marcarError(document.getElementById('compraPrecio'));  return toast('Ingresa un precio válido', 'error'); }
    if (!fecha)     { marcarError(document.getElementById('compraFecha'));   return toast('Elige la fecha de compra', 'error'); }

    const done = btnLoading(btn, 'Registrando…');
    try {
        await registrarCompraCore(insumoId, cantidad, unidad, precio, fecha);
    } catch (e) {
        console.error(e);
        return toast('No se pudo registrar la compra — revisa tu conexión', 'error');
    } finally { done(); }

    document.getElementById('compraCantidad').value = '';
    document.getElementById('compraPrecio').value = '';
    renderCompras();
    renderInsumos();
    renderRecetas();
    calcularPrecio();
    actualizarContadores();
    toast('Compra registrada 🛒');
}

// borrado optimista con 5s para deshacer; el deleteDoc real corre al expirar el toast
export function eliminarCompra(id) {
    const idx = state.compras.findIndex(c => c.id === id);
    if (idx === -1) return;
    const compra = state.compras[idx];
    state.compras.splice(idx, 1);
    renderCompras();
    renderInsumos();
    actualizarContadores();
    toastDeshacer('Compra eliminada', {
        onDeshacer: () => {
            state.compras.splice(idx, 0, compra);
            renderCompras();
            renderInsumos();
            actualizarContadores();
        },
        onConfirmar: async () => {
            try { await deleteDoc(doc(db, 'compras', id)); }
            catch (e) { console.error(e); toast('No se pudo eliminar la compra — reaparecerá al recargar', 'error'); }
        }
    });
}
