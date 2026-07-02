// Recetas: CRUD, edición inline, ingredientes temporales e importador desde texto.
import { db, collection, addDoc, deleteDoc, updateDoc, doc } from './firebase.js';
import { state } from './state.js';
import { esc, toast, confirmar, quitarAcentos, btnLoading, marcarError, numValido } from './util.js';
import { unidadesCompatibles, UNIDAD_MAP } from './units.js';
import { matchInsumo } from './match.js';
import { sugerirCodigo, renderInsumos } from './insumos.js';
import { actualizarSelects, actualizarContadores, actualizarCalcSelect } from './render.js';
import { calcularCostoReceta, avisosReceta } from './calculadora.js';
import { llamaHtml, celebrar } from './ui/llama.js';

// icono de repostería fiel al tipo de receta. Devuelve el SLUG de un SVG en
// img/icons/ (set fluent-emoji-flat de Iconify). Orden = de lo más específico a lo
// genérico; el primero que matchea gana, así el tipo estructural pesa más que el sabor.
function iconReceta(nombre) {
    const n = quitarAcentos(nombre || '');
    const has = (...ws) => ws.some(w => n.includes(w));
    if (has('cheesecake', 'tarta de queso', 'torta de queso')) return 'shortcake';
    if (has('pan de pascua', 'brazo de reina', 'pionono', 'enrollado')) return 'birthday-cake';
    if (has('pie', 'tarta', 'tartaleta', 'kuchen', 'quiche')) return 'pie';
    if (has('cupcake', 'muffin', 'magdalena', 'ponque individual')) return 'cupcake';
    if (has('galleta', 'cookie', 'alfajor', 'macaron', 'calzones rotos', 'masa seca')) return 'cookie';
    if (has('dona', 'donut', 'berlin', 'picaron', 'sopaipilla')) return 'doughnut';
    if (has('croissant', 'medialuna', 'cuernito', 'cacho')) return 'croissant';
    if (has('bagel')) return 'bagel';
    if (has('pretzel')) return 'pretzel';
    if (has('baguette', 'marraqueta')) return 'baguette-bread';
    if (has('flan', 'pudin', 'leche asada', 'creme', 'natilla', 'panna', 'custard')) return 'custard';
    if (has('helado', 'sorbete', 'semifrio')) return 'soft-ice-cream';
    if (has('waffle', 'wafle')) return 'waffle';
    if (has('panqueque', 'pancake', 'tortita', 'crepe')) return 'pancakes';
    if (has('empanada', 'empanadita')) return 'dumpling';
    if (has('mousse', 'merengue', 'suspiro')) return 'fish-cake-with-swirl';
    if (has('brownie', 'trufa', 'bombon', 'ganache')) return 'chocolate-bar';
    if (has('torta', 'cake', 'pastel', 'bizcocho', 'bizcochuelo', 'ponque', 'queque')) return 'birthday-cake';
    if (has('pan ', 'amasado', 'hallulla', 'brioche', 'bollo', 'trenza')) return 'bread';
    if (has('chocolate')) return 'chocolate-bar'; // sabor, solo si no hay tipo estructural
    return 'cupcake'; // fallback genérico de repostería
}

export function renderRecetas() {
    const el = document.getElementById('listaRecetas');
    if (!state.recetas.length) {
        el.innerHTML = llamaHtml(
            'Sin recetas todavía… ¿partimos con tu <strong>torta estrella</strong>? 🎂 También puedes pegar una receta en texto y yo la interpreto.',
            { cta: { texto: '✨ Crear mi primera receta', onclick: "document.getElementById('recetaNombre').focus()" } }
        );
        return;
    }
    el.innerHTML = state.recetas.map(r => {
        const costo = calcularCostoReceta(r);
        const avisos = avisosReceta(r);
        const avisoHtml = avisos.length
            ? `<p style="color:#dc3545; font-size:12px; margin-top:6px;">⚠️ ${avisos.join(' · ')}</p>`
            : '';

        if (state.editandoRecetaId === r.id) {
            const ingHtml = state.editIngredientes.length
                ? state.editIngredientes.map((ing, idx) => `
                    <div class="ingredient-item">
                        <span><strong>${esc(ing.nombre)}</strong> — ${ing.cantidad} ${esc(ing.unidad)}</span>
                        <button class="btn btn-danger btn-sm" onclick="editQuitarIngrediente(${idx})">✕</button>
                    </div>`).join('')
                : '<p style="color:#adb5bd; font-size:13px; padding:6px 0;">Sin ingredientes</p>';
            return `
            <div style="background:#fff8f8; border-radius:14px; padding:18px; margin-bottom:12px; border:2px solid #f5576c;">
                <p style="font-size:12px; font-weight:700; color:#f5576c; text-transform:uppercase; letter-spacing:.5px; margin-bottom:14px;">✏️ Editando receta</p>
                <div class="grid-receta-top" style="margin-bottom:14px;">
                    <div>
                        <label>Nombre de la receta</label>
                        <input type="text" id="editRecetaNombre" value="${esc(r.nombre)}" placeholder="Nombre">
                    </div>
                    <div>
                        <label>Porciones</label>
                        <input type="number" id="editRecetaPorciones" value="${r.porciones}" min="1" style="width:100px;">
                    </div>
                </div>
                <h5 style="margin-bottom:8px; font-size:13px; color:#495057;">Ingredientes</h5>
                <div>${ingHtml}</div>
                <div style="background:white; border:2px solid #e9ecef; padding:12px; border-radius:10px; margin:10px 0;">
                    <div class="grid-ingrediente">
                        <div>
                            <label style="font-size:12px;">Insumo</label>
                            <select id="editIngInsumo" onchange="editActualizarUnidad()">
                                <option value="">Selecciona</option>
                                ${state.insumos.map(i => `<option value="${i.id}">${i.codigo ? '['+esc(i.codigo)+'] ' : ''}${esc(i.nombre)}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label style="font-size:12px;">Cantidad</label>
                            <input type="number" id="editIngCantidad" placeholder="200" step="0.01" style="width:90px;">
                        </div>
                        <div>
                            <label style="font-size:12px;">Unidad</label>
                            <select id="editIngUnidad" style="width:80px;"></select>
                        </div>
                        <div>
                            <label>&nbsp;</label>
                            <button class="btn btn-primary btn-sm" onclick="editAgregarIngrediente()">+ Add</button>
                        </div>
                    </div>
                </div>
                <div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;">
                    <button class="btn btn-success" onclick="guardarEdicionReceta('${r.id}')">✓ Guardar cambios</button>
                    <button class="btn btn-edit" onclick="cancelarEdicionReceta()">Cancelar</button>
                </div>
            </div>`;
        }

        return `<div style="background:#f8f9fa; border-radius:14px; padding:18px; margin-bottom:12px; border-left:4px solid #667eea;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:14px;">
                <div class="receta-emoji" title="${esc(r.nombre)}"><img src="img/icons/${iconReceta(r.nombre)}.svg" alt="" loading="lazy" onerror="this.style.display='none'"></div>
                <div style="flex:1; min-width:0;">
                    <h3 style="color:#343a40;">${esc(r.nombre)}</h3>
                    <p style="color:#6c757d; font-size:13px; margin-top:4px;">${r.porciones} porciones · ${r.ingredientes.length} ingredientes</p>
                    <span class="price-tag" style="margin-top:8px; display:inline-block;">Costo: ${esc(state.currency)}${costo.toFixed(2)}</span>
                    ${avisoHtml}
                </div>
                <div style="display:flex; gap:8px; margin-left:12px; flex-shrink:0;">
                    <button class="btn btn-edit btn-sm" onclick="iniciarEdicionReceta('${r.id}')">✏️ Editar</button>
                    <button class="btn btn-danger btn-sm" onclick="eliminarReceta('${r.id}')">🗑️</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

// pobla el selector de unidad según la familia del insumo elegido
export function actualizarUnidadIngrediente() {
    const insumoId = document.getElementById('ingredienteInsumo').value;
    const sel = document.getElementById('ingredienteUnidad');
    const ins = state.insumos.find(i => i.id === insumoId);
    if (!ins) { sel.innerHTML = ''; return; }
    const defaultUnit = ins.unidadBase || 'g';
    const opts = unidadesCompatibles(ins);
    sel.innerHTML = opts.map(u => `<option value="${u}" ${u===defaultUnit?'selected':''}>${u}</option>`).join('');
}

export function agregarIngrediente() {
    const insumoId = document.getElementById('ingredienteInsumo').value;
    const cantidad = parseFloat(document.getElementById('ingredienteCantidad').value);
    const unidad   = document.getElementById('ingredienteUnidad').value;
    if (!insumoId) { marcarError(document.getElementById('ingredienteInsumo')); return toast('Selecciona el insumo', 'error'); }
    if (!numValido(cantidad, { min: 0.001 })) { marcarError(document.getElementById('ingredienteCantidad')); return toast('Ingresa una cantidad válida', 'error'); }
    if (state.ingredientesTemp.find(i => i.insumoId === insumoId)) return toast('Ingrediente ya agregado', 'error');
    const ins = state.insumos.find(i => i.id === insumoId);
    state.ingredientesTemp.push({ insumoId, codigo: ins.codigo || '', nombre: ins.nombre, unidad: unidad || ins.unidad, cantidad });
    document.getElementById('ingredienteCantidad').value = '';
    renderIngredientesTemp();
}

export function eliminarIngredienteTemp(idx) {
    state.ingredientesTemp.splice(idx, 1);
    renderIngredientesTemp();
}

export function renderIngredientesTemp() {
    const el = document.getElementById('ingredientesReceta');
    if (!state.ingredientesTemp.length) { el.innerHTML = ''; return; }
    el.innerHTML = state.ingredientesTemp.map((ing, i) => `
        <div class="ingredient-item">
            <span><strong>${esc(ing.nombre)}</strong> — ${ing.cantidad} ${esc(ing.unidad)}</span>
            <button class="btn btn-danger btn-sm" onclick="eliminarIngredienteTemp(${i})">✕</button>
        </div>
    `).join('');
}

export async function guardarReceta(btn) {
    const nombreEl  = document.getElementById('recetaNombre');
    const nombre    = nombreEl.value.trim();
    const porciones = parseInt(document.getElementById('recetaPorciones').value);
    if (!nombre || nombre.length > 200) { marcarError(nombreEl); return toast('Ingresa un nombre de receta válido', 'error'); }
    if (!numValido(porciones, { min: 1, max: 100000 })) { marcarError(document.getElementById('recetaPorciones')); return toast('Ingresa porciones válidas', 'error'); }
    if (!state.ingredientesTemp.length) return toast('Agrega al menos un ingrediente', 'error');
    const costos = {
        horas: 0,
        empaque:    state.settings.empaqueDefault    || 0,
        indirectos: state.settings.indirectosDefault || 0,
        merma:      state.settings.mermaDefault      || 0,
        margen:     state.settings.margenDefault     || 0,
        competencia: 0
    };
    const done = btnLoading(btn, 'Guardando…');
    try {
        const ref = await addDoc(collection(db, 'recetas'), { nombre, porciones, ingredientes: [...state.ingredientesTemp], costos, fechaCreacion: new Date().toISOString() });
        state.recetas.push({ id: ref.id, nombre, porciones, ingredientes: [...state.ingredientesTemp], costos });
    } catch (e) {
        console.error(e);
        return toast('No se pudo guardar la receta — revisa tu conexión', 'error');
    } finally { done(); }
    nombreEl.value = '';
    document.getElementById('recetaPorciones').value = '1';
    state.ingredientesTemp = [];
    renderIngredientesTemp();
    renderRecetas();
    actualizarContadores();
    actualizarCalcSelect();
    celebrar(`¡Receta "${nombre}" guardada! 🎂`);
}

export async function eliminarReceta(id) {
    if (!(await confirmar('¿Eliminar esta receta?'))) return;
    await deleteDoc(doc(db, 'recetas', id));
    state.recetas = state.recetas.filter(r => r.id !== id);
    renderRecetas();
    actualizarContadores();
    actualizarCalcSelect();
}

// ── Edición inline de recetas ─────────────────────────────────
export function iniciarEdicionReceta(id) {
    const r = state.recetas.find(x => x.id === id);
    if (!r) return;
    state.editandoRecetaId = id;
    state.editIngredientes = r.ingredientes.map(i => ({ ...i }));
    renderRecetas();
}

export function cancelarEdicionReceta() {
    state.editandoRecetaId = null;
    state.editIngredientes = [];
    renderRecetas();
}

export function editActualizarUnidad() {
    const insumoId = document.getElementById('editIngInsumo')?.value;
    const unitSel  = document.getElementById('editIngUnidad');
    if (!unitSel) return;
    const ins = state.insumos.find(i => i.id === insumoId);
    if (!ins) { unitSel.innerHTML = ''; return; }
    const base = ins.unidadBase || 'g';
    const opts = unidadesCompatibles(ins);
    unitSel.innerHTML = opts.map(u => `<option value="${u}" ${u===base?'selected':''}>${u}</option>`).join('');
}

export function editAgregarIngrediente() {
    const insumoId = document.getElementById('editIngInsumo').value;
    const cantidad = parseFloat(document.getElementById('editIngCantidad').value);
    const unidad   = document.getElementById('editIngUnidad').value;
    if (!insumoId || !numValido(cantidad, { min: 0.001 })) return toast('Selecciona insumo e ingresa una cantidad válida', 'error');
    if (state.editIngredientes.find(i => i.insumoId === insumoId)) return toast('Ingrediente ya en la receta', 'error');
    const ins = state.insumos.find(i => i.id === insumoId);
    state.editIngredientes.push({ insumoId, codigo: ins.codigo || '', nombre: ins.nombre, unidad, cantidad });
    renderRecetas();
}

export function editQuitarIngrediente(idx) {
    state.editIngredientes.splice(idx, 1);
    renderRecetas();
}

export async function guardarEdicionReceta(id) {
    const nombre    = document.getElementById('editRecetaNombre').value.trim();
    const porciones = parseInt(document.getElementById('editRecetaPorciones').value) || 1;
    if (!nombre || nombre.length > 200)             return toast('Ingresa un nombre de receta válido', 'error');
    if (!numValido(porciones, { min: 1, max: 100000 })) return toast('Ingresa porciones válidas', 'error');
    if (!state.editIngredientes.length) return toast('Agrega al menos un ingrediente', 'error');
    await updateDoc(doc(db, 'recetas', id), { nombre, porciones, ingredientes: state.editIngredientes });
    const idx = state.recetas.findIndex(r => r.id === id);
    state.recetas[idx] = { ...state.recetas[idx], nombre, porciones, ingredientes: [...state.editIngredientes] };
    state.editandoRecetaId = null;
    state.editIngredientes = [];
    renderRecetas();
    actualizarCalcSelect();
    toast(`"${nombre}" actualizada`);
}

// ── Importador de recetas (texto → ingredientes) ──────────────
let importParsed = [];
let importNombre = '', importPorciones = null;

function parseLinea(linea) {
    let s = linea.trim().replace(/^[-•*·▪◦●•▪●]+\s*/, '');
    if (!s || s.length < 2) return null;
    s = s.replace(/½/g,'0.5').replace(/¼/g,'0.25').replace(/¾/g,'0.75')
         .replace(/⅓/g,'0.33').replace(/⅔/g,'0.67').replace(/⅛/g,'0.125');
    const m = s.match(/(\d+\s*\/\s*\d+|\d+[.,]?\d*)/);
    if (!m) return null; // sin cantidad → no es línea de ingrediente
    let qty;
    const raw = m[1];
    if (raw.includes('/')) { const [a,b] = raw.split('/').map(x => parseFloat(x)); qty = b ? a/b : a; }
    else qty = parseFloat(raw.replace(',', '.'));
    if (!qty || qty <= 0) return null;
    const resto = (s.slice(0, m.index) + ' ' + s.slice(m.index + raw.length)).trim();
    const norm = quitarAcentos(resto.toLowerCase());
    let unidad = 'unidad', factor = 1, unitWord = null;
    for (const e of UNIDAD_MAP) { const um = norm.match(e.re); if (um) { unidad = e.u; factor = e.f; unitWord = um[1]; break; } }
    let nombre = resto;
    if (unitWord) nombre = nombre.replace(new RegExp('\\b' + unitWord + '\\b', 'i'), '');
    nombre = nombre.replace(/^\s*(de|del|de la)\s+/i, '').replace(/\s{2,}/g, ' ')
                   .replace(/[().]+/g, ' ').trim();
    if (!nombre) return null;
    return { cantidad: Math.round(qty * factor * 100) / 100, unidad, nombreRaw: nombre, insumoId: matchInsumo(nombre)?.id || null };
}

export function interpretarReceta() {
    const texto = document.getElementById('importTexto').value;
    if (!texto.trim()) return toast('Pega una receta primero', 'error');
    const lineas = texto.split('\n');
    importParsed = [];
    importNombre = ''; importPorciones = null;
    lineas.forEach(linea => {
        // ¿línea de porciones/título? (tiene número + palabra de rendimiento) → no es ingrediente
        const mp = quitarAcentos(linea.toLowerCase()).match(/(\d+)\s*(porciones?|porcion|rinde|raciones?|rendimiento)\b/);
        if (mp) {
            if (!importPorciones) importPorciones = parseInt(mp[1]);
            if (!importNombre) {
                const t = linea.replace(/\(?\s*\d+\s*(porciones?|porcion|raciones?)\s*\)?/i, '').replace(/[():]+/g, '').trim();
                if (t.length > 3 && !/^\d/.test(t)) importNombre = t;
            }
            return;
        }
        const ing = parseLinea(linea);
        if (ing) importParsed.push(ing);
        else if (!importNombre && linea.trim().length > 3 && !/\d/.test(linea)) importNombre = linea.trim().replace(/[():]+/g, '').trim();
    });
    renderImportPreview();
}

function renderImportPreview() {
    const el = document.getElementById('importPreview');
    if (!importParsed.length) {
        el.innerHTML = '<p style="color:#dc3545; font-size:13px;">No se detectaron ingredientes. Usa una línea por ingrediente con su cantidad (ej: "200 g de harina").</p>';
        return;
    }
    const cabecera = (importNombre || importPorciones)
        ? `<div style="font-size:13px; color:#495057; margin-bottom:8px;">${importNombre ? '📌 <strong>'+esc(importNombre)+'</strong>' : ''} ${importPorciones ? '· '+importPorciones+' porciones' : ''}</div>`
        : '';
    el.innerHTML = cabecera + `<div style="font-size:13px; color:#6c757d; margin-bottom:8px;">${importParsed.length} ingredientes — revisa, corrige el texto y ajusta:</div>` +
        importParsed.map((r, i) => `
        <div style="display:grid; grid-template-columns:1.3fr 70px 80px 1.2fr auto; gap:8px; align-items:center; margin-bottom:6px;">
            <input type="text" value="${esc(r.nombreRaw || '')}" placeholder="Nombre"
                oninput="importEdit(${i},'nombreRaw',this.value)" onchange="importRematch(${i})"
                style="padding:7px; border:2px solid #e9ecef; border-radius:8px;">
            <input type="number" value="${r.cantidad}" step="0.01" oninput="importEdit(${i},'cantidad',this.value)" style="padding:7px; border:2px solid #e9ecef; border-radius:8px;">
            <select onchange="importEdit(${i},'unidad',this.value)" style="padding:7px; border:2px solid #e9ecef; border-radius:8px;">
                ${['g','kg','ml','l','unidad'].map(u => `<option value="${u}" ${u===r.unidad?'selected':''}>${u}</option>`).join('')}
            </select>
            <select onchange="importEdit(${i},'insumoId',this.value)" style="padding:7px; border:2px solid #e9ecef; border-radius:8px;">
                <option value="__new__" ${!r.insumoId?'selected':''}>➕ Crear "${esc(r.nombreRaw)}"</option>
                ${state.insumos.map(ins => `<option value="${ins.id}" ${ins.id===r.insumoId?'selected':''}>${esc(ins.nombre)}</option>`).join('')}
            </select>
            <button class="btn btn-danger btn-sm" onclick="importQuitar(${i})">✕</button>
        </div>`).join('') +
        `<p style="font-size:11px; color:#adb5bd; margin-top:6px;">El texto del nombre se usa para crear el insumo nuevo. Al editarlo, la app vuelve a buscar coincidencias.</p>` +
        `<button class="btn btn-success" style="margin-top:8px;" onclick="aplicarImport()">✓ Cargar a la receta</button>`;
}

export function importEdit(i, campo, valor) {
    if (campo === 'cantidad') importParsed[i].cantidad = parseFloat(valor) || 0;
    else if (campo === 'insumoId') importParsed[i].insumoId = (valor === '__new__') ? null : valor;
    else importParsed[i][campo] = valor;
}

// al editar el nombre, re-buscar coincidencia con insumos y refrescar la fila
export function importRematch(i) {
    const r = importParsed[i];
    const nombre = (r.nombreRaw || '').trim();
    if (!nombre) { r.insumoId = null; renderImportPreview(); return; }
    const match = matchInsumo(nombre);
    r.insumoId = match ? match.id : null;
    renderImportPreview();
}

export function importQuitar(i) { importParsed.splice(i, 1); renderImportPreview(); }

export async function aplicarImport() {
    if (!importParsed.length) return;
    const nuevosCreados = {}; // nombreRaw(lower) → id, para no duplicar
    for (const r of importParsed) {
        let insumoId = r.insumoId;
        if (!insumoId) {
            const clave = r.nombreRaw.toLowerCase();
            if (nuevosCreados[clave]) insumoId = nuevosCreados[clave];
            else {
                const codigo = sugerirCodigo(r.nombreRaw);
                const datos = { codigo, nombre: r.nombreRaw, codigosBarras: [], precio: null, unidadBase: null, fechaCreacion: new Date().toISOString() };
                const ref = await addDoc(collection(db, 'insumos'), datos);
                state.insumos.push({ id: ref.id, ...datos });
                insumoId = ref.id;
                nuevosCreados[clave] = insumoId;
            }
        }
        if (state.ingredientesTemp.find(x => x.insumoId === insumoId)) continue; // ya está
        const ins = state.insumos.find(x => x.id === insumoId);
        state.ingredientesTemp.push({ insumoId, codigo: ins.codigo || '', nombre: ins.nombre, unidad: r.unidad, cantidad: r.cantidad });
    }
    // nombre y porciones si están vacíos
    if (importNombre && !document.getElementById('recetaNombre').value.trim())
        document.getElementById('recetaNombre').value = importNombre;
    if (importPorciones) document.getElementById('recetaPorciones').value = importPorciones;

    renderIngredientesTemp();
    renderInsumos();
    actualizarSelects();
    actualizarContadores();
    limpiarImport();
    toast('Ingredientes cargados — revisa, costea y guarda la receta', 'ok');
}

export function toggleImport() {
    const body = document.getElementById('importBody');
    const chev = document.getElementById('importChevron');
    const open = body.classList.toggle('open');
    chev.style.transform = open ? 'rotate(180deg)' : 'rotate(0)';
    document.getElementById('importHeader')?.setAttribute('aria-expanded', String(open));
}

export function limpiarImport() {
    document.getElementById('importTexto').value = '';
    document.getElementById('importPreview').innerHTML = '';
    importParsed = []; importNombre = ''; importPorciones = null;
}
