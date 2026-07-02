// Respaldo de datos: el plan Spark no tiene backups automáticos, así que
// este módulo permite descargar todo (JSON) o las compras (CSV para Excel).
import { state } from './state.js';
import { toast, hoyISO } from './util.js';

function descargar(nombre, contenido, tipo) {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// respaldo completo: insumos + compras + recetas + settings
export function exportarRespaldoJSON() {
    const datos = {
        app: 'llama-repostera',
        version: 1,
        fecha: new Date().toISOString(),
        insumos: state.insumos,
        compras: state.compras,
        recetas: state.recetas,
        settings: state.settings
    };
    descargar(`llama-repostera-respaldo-${hoyISO()}.json`,
        JSON.stringify(datos, null, 2), 'application/json');
    toast('Respaldo descargado 💾');
}

// CSV de compras para Excel es-CL: separador ; y BOM UTF-8 (acentos)
export function exportarComprasCSV() {
    if (!state.compras.length) return toast('No hay compras que exportar', 'info');
    const campo = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const filas = [['Fecha', 'Insumo', 'Cantidad', 'Unidad', 'Precio'].join(';')];
    const ordenadas = [...state.compras].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    for (const c of ordenadas) {
        const ins = state.insumos.find(i => i.id === c.insumoId);
        filas.push([
            campo(c.fecha),
            campo(ins ? ins.nombre : '(insumo eliminado)'),
            campo(c.cantidad),
            campo(c.unidad || ''),
            campo(c.precio)
        ].join(';'));
    }
    descargar(`llama-repostera-compras-${hoyISO()}.csv`,
        String.fromCharCode(0xFEFF) + filas.join('\r\n'), 'text/csv;charset=utf-8'); // BOM UTF-8 para Excel
    toast('Compras exportadas a CSV 📊');
}
