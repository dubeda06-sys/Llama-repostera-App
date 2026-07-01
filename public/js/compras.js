// Compras: tabla, registro manual y núcleo compartido con el lector de boletas.
import { db, collection, addDoc, deleteDoc, updateDoc, doc } from './firebase.js';
import { state } from './state.js';
import { esc, toast, confirmar } from './util.js';
import { FACTORS } from './units.js';
import { actualizarContadores } from './render.js';
import { renderInsumos } from './insumos.js';
import { renderRecetas } from './recetas.js';
import { calcularPrecio } from './calculadora.js';

export function renderCompras() {
    const el = document.getElementById('listaCompras');
    if (!state.compras.length) {
        el.innerHTML = '<div class="empty-state" style="margin-top:20px;"><div class="es-icon">🛒</div><p>No hay compras registradas</p></div>';
        return;
    }
    const sorted = [...state.compras].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    el.innerHTML = `<div class="table-wrap"><table><thead><tr>
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

export async function agregarCompra() {
    const insumoId = document.getElementById('compraInsumo').value;
    const cantidad = parseFloat(document.getElementById('compraCantidad').value);
    const unidad   = document.getElementById('compraUnidad').value;
    const precio   = parseFloat(document.getElementById('compraPrecio').value);
    const fecha    = document.getElementById('compraFecha').value;
    if (!insumoId || !cantidad || !precio || !fecha) return toast('Completa todos los campos', 'error');

    await registrarCompraCore(insumoId, cantidad, unidad, precio, fecha);

    document.getElementById('compraCantidad').value = '';
    document.getElementById('compraPrecio').value = '';
    renderCompras();
    renderInsumos();
    renderRecetas();
    calcularPrecio();
    actualizarContadores();
    toast('Compra registrada');
}

export async function eliminarCompra(id) {
    if (!(await confirmar('¿Eliminar esta compra?'))) return;
    await deleteDoc(doc(db, 'compras', id));
    state.compras = state.compras.filter(c => c.id !== id);
    renderCompras();
    renderInsumos();
    actualizarContadores();
}
