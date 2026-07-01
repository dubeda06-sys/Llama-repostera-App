// Match de nombres de producto → insumo existente (usado por boletas e importador de recetas).
import { state } from './state.js';
import { quitarAcentos } from './util.js';

export function matchInsumo(nombre) {
    const n = quitarAcentos(nombre.toLowerCase());
    return state.insumos.find(i => {
        const ni = quitarAcentos(i.nombre.toLowerCase());
        if (n.includes(ni) || ni.includes(n)) return true;
        return n.split(' ').some(w => w.length > 3 && ni.includes(w));
    });
}
