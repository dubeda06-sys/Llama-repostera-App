// Insumos: CRUD, emojis, tarjetas, códigos de barra y sugeridos.
import { db, collection, addDoc, deleteDoc, updateDoc, doc } from './firebase.js';
import { state } from './state.js';
import { esc, toast, confirmar, quitarAcentos, btnLoading, marcarError, numValido } from './util.js';
import { actualizarSelects, actualizarContadores } from './render.js';
import { renderRecetas } from './recetas.js';
import { calcularPrecio } from './calculadora.js';
import { llamaHtml } from './ui/llama.js';

// SKU correlativo: 3 primeras letras del nombre + número, evita colisiones
export function sugerirCodigo(nombre) {
    const base = (nombre || '')
        .normalize('NFD')
        .replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3) || 'INS';
    const usados = new Set(state.insumos.map(i => (i.codigo || '').toUpperCase()));
    let n = 1, codigo;
    do { codigo = `${base}-${String(n).padStart(2, '0')}`; n++; } while (usados.has(codigo));
    return codigo;
}

export function autoCodigo() {
    const cod = document.getElementById('insumoCodigo');
    const nombre = document.getElementById('insumoNombre').value.trim();
    // solo autosugerir si el usuario no escribió un código manual
    if (!cod.dataset.manual) cod.value = nombre ? sugerirCodigo(nombre) : '';
}

// ── Ingredientes sugeridos ────────────────────────────────────
const SUGERIDOS = [
    { nombre: 'Harina de Trigo',   unidad: 'g',      emoji: '🌾' },
    { nombre: 'Azúcar Blanca',     unidad: 'g',      emoji: '🍬' },
    { nombre: 'Mantequilla',       unidad: 'g',      emoji: '🧈' },
    { nombre: 'Huevos',            unidad: 'unidad', emoji: '🥚' },
    { nombre: 'Leche',             unidad: 'ml',     emoji: '🥛' },
    { nombre: 'Cacao en Polvo',    unidad: 'g',      emoji: '🍫' },
    { nombre: 'Polvo de Hornear',  unidad: 'g',      emoji: '🍰' },
    { nombre: 'Vainilla',          unidad: 'ml',     emoji: '🌿' },
    { nombre: 'Sal',               unidad: 'g',      emoji: '🧂' },
    { nombre: 'Crema de Leche',    unidad: 'ml',     emoji: '🥄' },
    { nombre: 'Queso Crema',       unidad: 'g',      emoji: '🧀' },
    { nombre: 'Limones',           unidad: 'unidad', emoji: '🍋' },
    { nombre: 'Naranja',           unidad: 'unidad', emoji: '🍊' },
    { nombre: 'Fresas',            unidad: 'g',      emoji: '🍓' },
    { nombre: 'Chocolate',         unidad: 'g',      emoji: '🍫' },
    { nombre: 'Nueces',            unidad: 'g',      emoji: '🌰' },
    { nombre: 'Almendras',         unidad: 'g',      emoji: '🥜' },
    { nombre: 'Canela',            unidad: 'g',      emoji: '🌿' },
    { nombre: 'Miel',              unidad: 'g',      emoji: '🍯' },
    { nombre: 'Gelatina',          unidad: 'g',      emoji: '🍮' },
    { nombre: 'Levadura',          unidad: 'g',      emoji: '🫙' },
    { nombre: 'Aceite Vegetal',    unidad: 'ml',     emoji: '🫙' },
    { nombre: 'Yogur',             unidad: 'g',      emoji: '🥛' },
    { nombre: 'Maicena',           unidad: 'g',      emoji: '🌾' },
    { nombre: 'Coco Rallado',      unidad: 'g',      emoji: '🥥' },
    { nombre: 'Mermelada',         unidad: 'g',      emoji: '🍓' },
    { nombre: 'Colorante',         unidad: 'ml',     emoji: '🎨' },
    { nombre: 'Esencia de Naranja',unidad: 'ml',     emoji: '🍊' },
];

// Retrocompat: codigoBarras (string) → codigosBarras (array)
export function normalizarInsumo(ins) {
    if (!Array.isArray(ins.codigosBarras)) {
        ins.codigosBarras = ins.codigoBarras ? [ins.codigoBarras] : [];
    }
    return ins;
}

export function getEmoji(nombre) {
    const n = nombre.toLowerCase();
    if (n.includes('harina') || n.includes('maicena')) return '🌾';
    if (n.includes('azúcar') || n.includes('azucar')) return '🍬';
    if (n.includes('mantequilla')) return '🧈';
    if (n.includes('huevo')) return '🥚';
    if (n.includes('leche') || n.includes('yogur')) return '🥛';
    if (n.includes('cacao') || n.includes('chocolate')) return '🍫';
    if (n.includes('polvo') || n.includes('levadura')) return '🍰';
    if (n.includes('vainilla') || n.includes('canela')) return '🌿';
    if (n.includes('sal')) return '🧂';
    if (n.includes('crema')) return '🥄';
    if (n.includes('queso')) return '🧀';
    if (n.includes('limon') || n.includes('limón')) return '🍋';
    if (n.includes('naranja')) return '🍊';
    if (n.includes('fresa')) return '🍓';
    if (n.includes('nuez')) return '🌰';
    if (n.includes('almendra')) return '🥜';
    if (n.includes('miel')) return '🍯';
    if (n.includes('gelatina')) return '🍮';
    if (n.includes('coco')) return '🥥';
    return '📦';
}

export function precioInsumo(id) {
    const ins = state.insumos.find(i => i.id === id);
    return (ins && ins.precio != null) ? ins.precio : 0;
}

// pestañas Ver / Ingresar de la sección Insumos
export function insumosTab(which) {
    const ver = document.getElementById('insumosVer');
    const ing = document.getElementById('insumosIngresar');
    const vBtn = document.getElementById('insTabVerBtn');
    const iBtn = document.getElementById('insTabIngresarBtn');
    const verActivo = which !== 'ingresar';
    ver.style.display = verActivo ? 'block' : 'none';
    ing.style.display = verActivo ? 'none' : 'block';
    vBtn.classList.toggle('active', verActivo);
    iBtn.classList.toggle('active', !verActivo);
    if (!verActivo) setTimeout(() => { const n = document.getElementById('insumoNombre'); if (n) n.focus(); }, 50);
}

export function tienePrecioInsumo(ins) { return ins.precio != null && ins.unidadBase; }

// tarjeta de un insumo (vista + edición)
function insumoCardHtml(ins) {
    const tieneprecio = tienePrecioInsumo(ins);
    const emoji  = getEmoji(ins.nombre);
        const codigo = ins.codigo || '—';
        const barras = ins.codigosBarras || [];
        const barrasHtml = barras.length
            ? `<span style="color:#adb5bd; font-size:11px; margin-left:8px;">🔖 ${barras.length}</span>` : '';
        return `
        <div class="insumo-card ${tieneprecio ? 'ins-con-precio' : 'ins-sin-precio'}" id="card-${ins.id}">
            <div class="insumo-card-view" id="view-${ins.id}">
                <div class="insumo-info">
                    <span class="insumo-emoji">${emoji}</span>
                    <div class="insumo-details">
                        <h3><span class="codigo-tag">${esc(codigo)}</span> ${esc(ins.nombre)}${barrasHtml}</h3>
                        <p>${tieneprecio
                            ? `<span class="price-tag">${esc(state.currency)}${ins.precio.toFixed(2)}/${esc(ins.unidadBase)}</span>`
                            : `<span style="color:#adb5bd;font-size:12px;">Sin precio — registra una compra</span>`}
                        </p>
                    </div>
                </div>
                <div class="insumo-actions">
                    <button class="btn btn-edit" onclick="iniciarEdicion('${ins.id}')">✏️ Editar</button>
                    <button class="btn btn-danger" onclick="eliminarInsumo('${ins.id}')" title="Eliminar">🗑️</button>
                </div>
            </div>
            <div class="insumo-card-edit" id="edit-${ins.id}">
                <div class="edit-row">
                    <input type="text" id="eCodigo-${ins.id}" value="${esc(ins.codigo || '')}" placeholder="Código" maxlength="12">
                    <input type="text" id="eNombre-${ins.id}" value="${esc(ins.nombre)}" placeholder="Nombre">
                    <input type="number" id="ePrecio-${ins.id}" value="${tieneprecio ? ins.precio : ''}" placeholder="Precio manual" step="0.01" min="0">
                    <button class="btn btn-success btn-sm" onclick="guardarEdicion('${ins.id}')">✓</button>
                    <button class="btn btn-edit btn-sm" onclick="cancelarEdicion('${ins.id}')">✕</button>
                </div>
                ${barras.length ? `<div style="margin-top:8px;">${barras.map(b => `<span class="barcode-chip">${esc(b)}</span>`).join('')}<span style="font-size:11px; color:#adb5bd; margin-left:6px;">(edita códigos en el módulo 🔖)</span></div>` : ''}
            </div>
        </div>`;
}

export function renderInsumos() {
    const el = document.getElementById('listaInsumos');
    if (!el) return;
    if (!state.insumos.length) {
        el.innerHTML = llamaHtml(
            '¡Hola! Aún no tienes insumos. Escanea tu primera boleta y <strong>yo hago el resto</strong> 🧾 — o agrega uno a mano.',
            { cta: { texto: '➕ Agregar mi primer insumo', onclick: "insumosTab('ingresar')" } }
        );
        return;
    }
    // filtro de texto (nombre o código)
    const q = quitarAcentos((document.getElementById('filtrarInsumo')?.value || '').toLowerCase().trim());
    const lista = q
        ? state.insumos.filter(i => quitarAcentos((i.nombre + ' ' + (i.codigo || '')).toLowerCase()).includes(q))
        : state.insumos;
    if (!lista.length) {
        el.innerHTML = '<p style="color:#adb5bd;font-size:13px;padding:20px;text-align:center;">Sin resultados para tu filtro.</p>';
        return;
    }
    const ordenar = arr => arr.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const conPrecio = ordenar(lista.filter(tienePrecioInsumo));
    const sinPrecio = ordenar(lista.filter(i => !tienePrecioInsumo(i)));

    const grupo = (titulo, color, icono, arr, nota) => !arr.length ? '' : `
        <div class="insumo-grupo">
            <div class="insumo-grupo-head" style="border-left:4px solid ${color};">
                <span>${icono} ${titulo}</span>
                <span class="insumo-grupo-count" style="background:${color};">${arr.length}</span>
            </div>
            ${nota ? `<p class="insumo-grupo-nota">${nota}</p>` : ''}
            <div class="insumo-grid">${arr.map(insumoCardHtml).join('')}</div>
        </div>`;

    el.innerHTML =
        grupo('Con precio', '#37b24d', '💲', conPrecio) +
        grupo('Sin precio', '#f59f00', '🏷️', sinPrecio, 'Estos aún no tienen costo. Registra una compra (o escanea una boleta) para que tomen precio.');
}

export async function agregarInsumo(btn) {
    const nombreEl = document.getElementById('insumoNombre');
    const nombre = nombreEl.value.trim();
    const codigoBarras = document.getElementById('insumoBarras').value.trim();
    let codigo = document.getElementById('insumoCodigo').value.trim().toUpperCase();
    if (!nombre) { marcarError(nombreEl); return toast('Ingresa el nombre del insumo', 'error'); }
    if (nombre.length > 200) { marcarError(nombreEl); return toast('Nombre demasiado largo', 'error'); }
    if (!codigo) codigo = sugerirCodigo(nombre);
    if (codigoBarras && barrasDuplicado(codigoBarras)) { marcarError(document.getElementById('insumoBarras')); return toast('Ese código de barras ya está ligado a otro producto', 'error'); }
    const datos = { codigo, nombre, codigosBarras: codigoBarras ? [codigoBarras] : [], precio: null, unidadBase: null, fechaCreacion: new Date().toISOString() };

    // UI optimista: pintar ya con id temporal, persistir después, revertir si falla
    const tempId = 'tmp-' + Date.now();
    state.insumos.push({ id: tempId, ...datos });
    const codEl = document.getElementById('insumoCodigo');
    nombreEl.value = '';
    document.getElementById('insumoBarras').value = '';
    codEl.value = ''; codEl.dataset.manual = '';
    renderInsumos();
    renderBarras();
    actualizarSelects();
    actualizarContadores();
    toast(`"${nombre}" agregado`);

    try {
        const ref = await addDoc(collection(db, 'insumos'), datos);
        const ins = state.insumos.find(i => i.id === tempId);
        if (ins) ins.id = ref.id;
        renderInsumos();
        actualizarSelects();
    } catch (e) {
        console.error(e);
        state.insumos = state.insumos.filter(i => i.id !== tempId);
        renderInsumos();
        renderBarras();
        actualizarSelects();
        actualizarContadores();
        toast(`No se pudo guardar "${nombre}" — revisa tu conexión`, 'error');
    }
}

export async function eliminarInsumo(id) {
    // avisar qué recetas quedan cojas antes de borrar (hoy quedaban huérfanas en silencio)
    const usadas = state.recetas
        .filter(r => (r.ingredientes || []).some(ing => ing.insumoId === id))
        .map(r => r.nombre);
    const extra = usadas.length
        ? ` OJO: se usa en ${usadas.length === 1 ? 'la receta' : 'las recetas'} "${usadas.join('", "')}" — quedará(n) sin costo.`
        : '';
    if (!(await confirmar('¿Eliminar este insumo? Esta acción no se puede deshacer.' + extra))) return;
    await deleteDoc(doc(db, 'insumos', id));
    state.insumos = state.insumos.filter(i => i.id !== id);
    renderInsumos();
    actualizarSelects();
    actualizarContadores();
}

export function iniciarEdicion(id) {
    document.getElementById(`view-${id}`).classList.add('hidden');
    document.getElementById(`edit-${id}`).classList.add('visible');
}

export function cancelarEdicion(id) {
    document.getElementById(`view-${id}`).classList.remove('hidden');
    document.getElementById(`edit-${id}`).classList.remove('visible');
}

export async function guardarEdicion(id) {
    const codigo = document.getElementById(`eCodigo-${id}`).value.trim().toUpperCase();
    const nombre = document.getElementById(`eNombre-${id}`).value.trim();
    const precioRaw = document.getElementById(`ePrecio-${id}`).value.trim();
    if (!nombre || nombre.length > 200) return;
    const ins = state.insumos.find(i => i.id === id);
    const precio = precioRaw === '' ? null : parseFloat(precioRaw);
    if (precio !== null && !numValido(precio, { min: 0 })) return toast('Precio inválido', 'error');
    const datos = {
        codigo: codigo || sugerirCodigo(nombre),
        nombre,
        precio,
        // preservar unidadBase — solo compras la cambian
        unidadBase: ins.unidadBase || null
    };
    await updateDoc(doc(db, 'insumos', id), datos);
    const idx = state.insumos.findIndex(i => i.id === id);
    state.insumos[idx] = { ...state.insumos[idx], ...datos };
    renderInsumos();
    renderRecetas();
    renderBarras();
    actualizarSelects();
    calcularPrecio();
}

// ── Módulo códigos de barra ───────────────────────────────────
export function barrasDuplicado(codigo, exceptoId) {
    return state.insumos.some(i => i.id !== exceptoId && (i.codigosBarras || []).includes(codigo));
}

export function insumoPorBarras(codigo) {
    return state.insumos.find(i => (i.codigosBarras || []).includes(codigo));
}

export function toggleBarras() {
    const body = document.getElementById('barrasBody');
    const chev = document.getElementById('barrasChevron');
    const open = body.classList.toggle('open');
    chev.style.transform = open ? 'rotate(180deg)' : 'rotate(0)';
    document.getElementById('barrasHeader')?.setAttribute('aria-expanded', String(open));
}

// feedback al escribir/escanear: ¿ya está ligado?
export function lookupBarras(codigo) {
    const out = document.getElementById('barrasLookup');
    codigo = codigo.trim();
    if (!codigo) { out.innerHTML = ''; return; }
    const ins = insumoPorBarras(codigo);
    if (ins) {
        out.innerHTML = `<span style="color:#28a745;">✓ Ya ligado a <strong>${esc(ins.nombre)}</strong> ${ins.codigo ? '['+esc(ins.codigo)+']' : ''}</span>`;
    } else {
        out.innerHTML = `<span style="color:#6c757d;">Código nuevo — elige un producto y presiona Ligar</span>`;
    }
}

export async function ligarBarras(btn) {
    const codigoEl = document.getElementById('barrasCodigo');
    const codigo = codigoEl.value.trim();
    const insumoId = document.getElementById('barrasInsumo').value;
    if (!codigo) { marcarError(codigoEl); return toast('Escanea o escribe un código de barras', 'error'); }
    if (!insumoId) { marcarError(document.getElementById('barrasInsumo')); return toast('Selecciona el producto a ligar', 'error'); }
    if (barrasDuplicado(codigo)) {
        const ya = insumoPorBarras(codigo);
        marcarError(codigoEl);
        return toast(`Ese código ya está ligado a "${ya.nombre}"`, 'error');
    }
    const ins = state.insumos.find(i => i.id === insumoId);
    const nuevos = [...(ins.codigosBarras || []), codigo];
    const done = btnLoading(btn, 'Ligando…');
    try {
        await updateDoc(doc(db, 'insumos', insumoId), { codigosBarras: nuevos });
    } catch (e) {
        console.error(e);
        return toast('No se pudo ligar el código — revisa tu conexión', 'error');
    } finally { done(); }
    ins.codigosBarras = nuevos;
    document.getElementById('barrasCodigo').value = '';
    document.getElementById('barrasLookup').innerHTML = '';
    renderBarras();
    renderInsumos();
    toast('Código de barras ligado');
}

export async function eliminarBarras(insumoId, codigo) {
    const ins = state.insumos.find(i => i.id === insumoId);
    if (!ins) return;
    const nuevos = (ins.codigosBarras || []).filter(b => b !== codigo);
    await updateDoc(doc(db, 'insumos', insumoId), { codigosBarras: nuevos });
    ins.codigosBarras = nuevos;
    renderBarras();
    renderInsumos();
}

export function renderBarras() {
    const el = document.getElementById('listaBarras');
    if (!el) return;
    const conBarras = state.insumos.filter(i => (i.codigosBarras || []).length);
    if (!conBarras.length) {
        el.innerHTML = '<p style="color:#adb5bd; font-size:13px; text-align:center; padding:12px;">Aún no hay códigos ligados</p>';
        return;
    }
    el.innerHTML = conBarras.map(ins => `
        <div class="barras-row">
            <div>
                <strong style="font-size:14px;">${getEmoji(ins.nombre)} ${esc(ins.nombre)}</strong>
                ${ins.codigo ? `<span class="codigo-tag" style="margin-left:6px;">${esc(ins.codigo)}</span>` : ''}
                <div style="margin-top:6px;">
                    ${ins.codigosBarras.map(b => `
                        <span class="barcode-chip">${esc(b)}
                            <button onclick="eliminarBarras('${ins.id}',${JSON.stringify(b)})" title="Quitar">✕</button>
                        </span>`).join('')}
                </div>
            </div>
        </div>
    `).join('');
}

// ── Búsqueda / sugeridos ──────────────────────────────────────
let _sugMatches = [];   // matches visibles del dropdown
let _sugActivo = -1;    // índice resaltado con el teclado

export function filtrarSugeridos(query) {
    const drop = document.getElementById('sugeridosDropdown');
    _sugActivo = -1;
    if (!query.trim()) { drop.style.display = 'none'; _sugMatches = []; return; }
    const existentes = new Set(state.insumos.map(i => i.nombre.toLowerCase()));
    _sugMatches = SUGERIDOS.filter(s =>
        s.nombre.toLowerCase().includes(query.toLowerCase()) &&
        !existentes.has(s.nombre.toLowerCase())
    );
    if (!_sugMatches.length) { drop.style.display = 'none'; return; }
    drop.innerHTML = _sugMatches.map((s, i) => `
        <div class="sugerido-item" data-idx="${i}" role="option" onclick="seleccionarSugerido('${s.nombre}','${s.unidad}')">
            <span class="si-emoji">${s.emoji}</span>
            <div>
                <div class="si-nombre">${s.nombre}</div>
                <div class="si-unidad">${s.unidad}</div>
            </div>
        </div>
    `).join('');
    drop.style.display = 'block';
}

// navegación con teclado en el dropdown: flechas + Enter + Escape
function sugTeclado(e) {
    const drop = document.getElementById('sugeridosDropdown');
    if (!drop || drop.style.display === 'none' || !_sugMatches.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        _sugActivo = e.key === 'ArrowDown'
            ? (_sugActivo + 1) % _sugMatches.length
            : (_sugActivo - 1 + _sugMatches.length) % _sugMatches.length;
        drop.querySelectorAll('.sugerido-item').forEach((el, i) => el.classList.toggle('sug-activo', i === _sugActivo));
        drop.querySelector('.sug-activo')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && _sugActivo >= 0) {
        e.preventDefault();
        const s = _sugMatches[_sugActivo];
        seleccionarSugerido(s.nombre, s.unidad);
    } else if (e.key === 'Escape') {
        cerrarDropdown();
    }
}

export function mostrarSugeridos() {
    const q = document.getElementById('buscarInsumo').value;
    if (q.trim()) filtrarSugeridos(q);
}

export function seleccionarSugerido(nombre, unidad) {
    document.getElementById('insumoNombre').value = nombre;
    document.getElementById('buscarInsumo').value = '';
    cerrarDropdown();
    agregarInsumo();
}

export function cerrarDropdown() {
    document.getElementById('sugeridosDropdown').style.display = 'none';
}

document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrapper')) cerrarDropdown();
});

// wiring del teclado (los módulos corren con el DOM ya parseado)
document.getElementById('buscarInsumo')?.addEventListener('keydown', sugTeclado);
