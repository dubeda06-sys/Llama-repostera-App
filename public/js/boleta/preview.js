// Preview editable de la boleta, overlay de carga con la llama y registro final en Firestore.
import { db, collection, addDoc, updateDoc, doc } from '../firebase.js';
import { state } from '../state.js';
import { esc, toast, confirmar, hoyISO, btnLoading, numValido } from '../util.js';
import { celebrar } from '../ui/llama.js';
import { b } from './state.js';
import { CONF_MIN, cuadreTol } from './config.js';
import { resolverMatch } from './ean.js';
import { sugerirCodigo, barrasDuplicado, renderInsumos, renderBarras } from '../insumos.js';
import { registrarCompraCore, renderCompras } from '../compras.js';
import { actualizarSelects, actualizarContadores } from '../render.js';
import { renderRecetas } from '../recetas.js';
import { calcularPrecio } from '../calculadora.js';

export function setBoletaProgress(html) {
    const el = document.getElementById('boletaProgress');
    if (el) el.innerHTML = html;
}

// ── Ventana de carga: la llama repostera "pensando" mientras lee la boleta ──
function overlayCargaBoleta() {
    let el = document.getElementById('boletaCarga');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'boletaCarga';
    el.className = 'boleta-carga';
    el.hidden = true;
    el.innerHTML = `
        <div class="bc-card">
            <div class="bc-llama-wrap">
                <div class="bc-bubble"><span></span><span></span><span></span></div>
                <img class="bc-llama" src="img/anim/loader/llama.png" alt="La llama pensando">
            </div>
            <div class="bc-title">La llama está pensando…</div>
            <div class="bc-status" id="bcStatus"></div>
            <div class="bc-bar"><div class="bc-bar-fill" id="bcBarFill"></div></div>
            <div class="bc-pct" id="bcPct"></div>
        </div>`;
    document.body.appendChild(el);
    return el;
}

// estado = texto bajo el título; pct = 0..1 (null → barra indeterminada)
export function mostrarCargaBoleta(estado, pct = null) {
    const el = overlayCargaBoleta();
    el.hidden = false;
    const st = document.getElementById('bcStatus');
    const fill = document.getElementById('bcBarFill');
    const pc = document.getElementById('bcPct');
    if (st) st.textContent = estado || '';
    if (pct == null) {
        if (fill) { fill.classList.add('indet'); fill.style.width = ''; }
        if (pc) pc.textContent = '';
    } else {
        const v = Math.round(pct * 100);
        if (fill) { fill.classList.remove('indet'); fill.style.width = v + '%'; }
        if (pc) pc.textContent = v + '%';
    }
}

export function ocultarCargaBoleta() {
    const el = document.getElementById('boletaCarga');
    if (el) el.hidden = true;
}

function badgeMatchBoleta(r) {
    const chip = (bg, txt) => `<span class="bp-chip" style="--accent-chip:${bg};">${txt}</span>`;
    if (r.matchSource === 'ean')    return chip('#37b24d', r.eanCorregido ? '✓ código ✎' : '✓ código');
    if (r.matchSource === 'nombre') return chip('#f59f00', 'por nombre');
    return chip('#adb5bd', 'nuevo');
}

// nota de transparencia cuando el EAN fue corregido: qué se leyó y qué quedó
function eanCorregidoHtml(r) {
    if (!r.eanCorregido || !r.eanOriginal || r.eanOriginal === r.ean) return '';
    return `<div class="bp-ean-nota">✎ Leí <s>…${esc(String(r.eanOriginal).slice(-4))}</s>, lo corregí a <strong>…${esc(String(r.ean).slice(-4))}</strong> (dígito verificador)</div>`;
}

function sumaParsed() {
    return b.parsed.reduce((s, r) => s + (parseFloat(r.precio) || 0), 0);
}

// banda de cuadre: compara la suma de ítems con el TOTAL impreso en la boleta
function cuadreBoletaHtml(suma) {
    if (!b.total) return '';
    const dif = b.total - suma;
    const cuadra = Math.abs(dif) <= cuadreTol(b.total);
    const cur = esc(state.currency);
    if (cuadra) {
        return `<div class="bp-cuadre bp-cuadre-ok">✓ Cuadra con el total de la boleta (${cur}${b.total.toLocaleString('es-CL')})</div>`;
    }
    const signo = dif > 0 ? 'faltan' : 'sobran';
    return `<div class="bp-cuadre bp-cuadre-off">⚠ No cuadra con la boleta: total impreso ${cur}${b.total.toLocaleString('es-CL')}, suma actual ${cur}${suma.toLocaleString('es-CL')} (${signo} ${cur}${Math.abs(dif).toLocaleString('es-CL')}). Revisa los precios en ámbar.</div>`;
}

// chips resumen por tipo de match; tocar un chip resalta sus filas
function chipsResumenHtml() {
    const cuenta = { ean: 0, nombre: 0, nuevo: 0 };
    for (const r of b.parsed) cuenta[r.matchSource === 'ean' ? 'ean' : r.matchSource === 'nombre' ? 'nombre' : 'nuevo']++;
    const chip = (n, txt, tipo, bg) => !n ? '' :
        `<button class="chip-resumen" style="background:${bg};" onclick="boletaResaltar('${tipo}')">${txt}: ${n}</button>`;
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
        ${chip(cuenta.ean, '✓ por código', 'ean', '#37b24d')}
        ${chip(cuenta.nombre, '≈ por nombre', 'nombre', '#f59f00')}
        ${chip(cuenta.nuevo, '➕ nuevos', 'nuevo', '#868e96')}
    </div>`;
}

// barra sticky inferior: suma vs total + registrar, siempre visible en celular
function stickyBarHtml(suma) {
    const cur = esc(state.currency);
    const totalTxt = b.total ? ` / Boleta ${cur}${b.total.toLocaleString('es-CL')}` : '';
    const sel = b.parsed.filter(r => r._sel).length;
    return `<div class="boleta-sticky" id="boletaSticky">
        <div class="bs-suma" id="bsSuma">Suma ${cur}${suma.toLocaleString('es-CL')}${totalTxt}</div>
        ${sel ? `<button class="btn btn-danger btn-sm" onclick="boletaQuitarSel()">🗑 Quitar ${sel}</button>` : ''}
        <button class="btn btn-success" onclick="aplicarBoleta(this)">✓ Registrar ${b.parsed.length}</button>
    </div>`;
}

// refresco liviano tras editar un precio: banda de cuadre + sticky, sin re-render completo
function actualizarCuadreVivo() {
    const suma = sumaParsed();
    const banda = document.getElementById('cuadreBand');
    if (banda) banda.innerHTML = cuadreBoletaHtml(suma);
    const sticky = document.getElementById('boletaSticky');
    if (sticky) sticky.outerHTML = stickyBarHtml(suma);
}

// opciones del select de insumo con los mejores candidatos arriba ("★ sugerido")
function opcionesInsumoHtml(r) {
    const cand = new Set(r.candidatos || []);
    const sugeridos = state.insumos.filter(i => cand.has(i.id));
    const resto = state.insumos.filter(i => !cand.has(i.id));
    const opt = (ins, star) => `<option value="${ins.id}" ${ins.id === r.insumoId ? 'selected' : ''}>${star ? '★ ' : ''}${esc(ins.nombre)}</option>`;
    return `<option value="__new__" ${!r.insumoId ? 'selected' : ''}>➕ Crear "${esc(r.nombreRaw)}"</option>` +
        sugeridos.map(i => opt(i, true)).join('') +
        resto.map(i => opt(i, false)).join('');
}

export function renderBoletaPreview() {
    const el = document.getElementById('boletaPreview');
    if (!b.parsed.length) {
        el.innerHTML = `<div class="bp-vacio">
            <img src="img/anim/loader/llama.png" alt="">
            <p>¡Uy! No pude leer productos en esa foto. Prueba con una foto más nítida, plana y con buena luz — ¡yo pongo la súper vista! 🦙</p>
        </div>`;
        return;
    }
    const total = sumaParsed();
    const fuenteHtml = b.fuente === 'ia'
        ? `<div class="bp-fuente bp-fuente-ia">✨ Leída por la llama IA — revisa y registra</div>`
        : `<div class="bp-fuente bp-fuente-ocr">🔍 Lectura local (la IA no estaba disponible) — revisa con más cuidado</div>`;
    el.innerHTML =
        `<div class="bp-cabecera">🧾 <strong>${b.parsed.length}</strong> productos detectados · total ${esc(state.currency)}${total.toLocaleString('es-CL')} — revisa, corrige y registra:</div>
         ${fuenteHtml}
         ${chipsResumenHtml()}
         <div id="cuadreBand">${cuadreBoletaHtml(total)}</div>
         <div class="bp-fecha-row">
            <label>Fecha de compra</label>
            <input type="date" id="boletaFecha" value="${b.parsed[0] ? b.parsed[0].fecha : hoyISO()}" onchange="boletaFechaTodos(this.value)">
         </div>` +
        b.parsed.map((r, i) => {
            const dudoso = r.sospechoso || (r.conf != null && r.conf < CONF_MIN);
            const pBorde = r.precio <= 0 ? '#dc3545' : (dudoso ? '#f59f00' : '#e9ecef');
            const pTitle = r.precio <= 0 ? '⚠ No se leyó bien el precio — corrígelo'
                : r.sospechoso ? '⚠ Precio inusual comparado con el resto — verifícalo'
                : (r.conf != null && r.conf < CONF_MIN ? '⚠ Lectura de baja confianza — verifica el precio' : 'Precio total pagado');
            return `
        <div class="boleta-item ${dudoso ? 'bi-dudoso' : ''}" data-match="${r.matchSource || 'nuevo'}" id="bitem-${i}">
            <div class="bi-head">
                <input type="checkbox" class="bi-check" ${r._sel ? 'checked' : ''} onchange="boletaSel(${i},this.checked)" title="Seleccionar" aria-label="Seleccionar producto">
                <span class="bi-badge" title="${r.ean || 'sin código de barras'}">${badgeMatchBoleta(r)}</span>
                <input class="bi-nombre" type="text" value="${esc(r.nombreRaw || '')}" oninput="boletaEdit(${i},'nombreRaw',this.value)" onchange="boletaRematch(${i})" placeholder="Producto">
                <button class="bi-del" onclick="boletaQuitar(${i})" title="Quitar producto">✕</button>
            </div>
            ${eanCorregidoHtml(r)}
            <div class="bi-grid">
                <label class="bi-f">Cantidad
                    <input type="number" value="${r.cantidad}" step="0.001" inputmode="decimal" oninput="boletaEdit(${i},'cantidad',this.value)">
                </label>
                <label class="bi-f">Unidad
                    <select onchange="boletaEdit(${i},'unidad',this.value)">
                        ${['g', 'kg', 'ml', 'l', 'unidad'].map(u => `<option value="${u}" ${u === r.unidad ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>
                </label>
                <label class="bi-f">${dudoso || r.precio <= 0 ? '⚠ ' : ''}Precio total
                    <input type="number" value="${r.precio}" step="1" inputmode="numeric" title="${pTitle}" style="border-color:${pBorde};" aria-invalid="${r.precio <= 0}" oninput="boletaEdit(${i},'precio',this.value)">
                </label>
            </div>
            <label class="bi-f bi-insumo">¿Qué insumo es?
                <select onchange="boletaEdit(${i},'insumoId',this.value)">${opcionesInsumoHtml(r)}</select>
            </label>
        </div>`;
        }).join('') +
        `<p class="bp-nota">Los productos nuevos se crean con su código de barras (EAN); los existentes quedan ligados a ese EAN para reconocerse solos en la próxima boleta.</p>` +
        stickyBarHtml(total);
}

export function boletaFechaTodos(v) { b.parsed.forEach(r => r.fecha = v); }

export function boletaEdit(i, campo, valor) {
    if (campo === 'cantidad' || campo === 'precio') {
        b.parsed[i][campo] = parseFloat(valor) || 0;
        if (campo === 'precio') actualizarCuadreVivo(); // cuadre en vivo sin perder el foco
    }
    else if (campo === 'insumoId') b.parsed[i].insumoId = (valor === '__new__') ? null : valor;
    else b.parsed[i][campo] = valor;
}

export function boletaRematch(i) {
    const r = b.parsed[i];
    const m = resolverMatch(r.ean, (r.nombreRaw || '').trim());
    Object.assign(r, m); // ean, eanOriginal, eanOk, eanCorregido, insumoId, matchSource, candidatos
    renderBoletaPreview();
}

export function boletaQuitar(i) { b.parsed.splice(i, 1); renderBoletaPreview(); }

export function boletaSel(i, checked) {
    b.parsed[i]._sel = !!checked;
    actualizarCuadreVivo(); // refresca el botón "Quitar N" del sticky
}

export function boletaQuitarSel() {
    b.parsed = b.parsed.filter(r => !r._sel);
    renderBoletaPreview();
}

// resalta las filas de un tipo de match (chip resumen tocado)
export function boletaResaltar(tipo) {
    document.querySelectorAll('.boleta-item').forEach(el => {
        el.classList.toggle('bi-resaltado', el.dataset.match === tipo);
    });
    setTimeout(() => document.querySelectorAll('.bi-resaltado').forEach(el => el.classList.remove('bi-resaltado')), 2500);
}

export async function aplicarBoleta(btn) {
    if (!b.parsed.length) return;
    if (!(await confirmar(`¿Registrar ${b.parsed.length} compras de la boleta?`))) return;
    const done = btnLoading(btn, 'Registrando…');
    try {
    const nuevos = {}; // clave (ean|nombre) → id, evita duplicar creaciones
    let ok = 0;
    for (const r of b.parsed) {
        if (!numValido(r.cantidad, { min: 0.001 }) || !numValido(r.precio, { min: 0.01 })) continue;
        const eanUse = (r.ean && r.eanOk) ? r.ean : null; // solo EAN válidos
        let insumoId = r.insumoId;
        if (!insumoId) {
            const clave = (eanUse || r.nombreRaw.toLowerCase());
            if (nuevos[clave]) insumoId = nuevos[clave];
            else {
                const codigo = sugerirCodigo(r.nombreRaw);
                const datos = { codigo, nombre: r.nombreRaw, codigosBarras: eanUse ? [eanUse] : [], precio: null, unidadBase: null, fechaCreacion: new Date().toISOString() };
                const ref = await addDoc(collection(db, 'insumos'), datos);
                state.insumos.push({ id: ref.id, ...datos });
                insumoId = ref.id;
                nuevos[clave] = insumoId;
            }
        } else if (eanUse) {
            // auto-indexar: ligar EAN válido al insumo existente si aún no lo tiene
            const ins = state.insumos.find(x => x.id === insumoId);
            if (ins && !(ins.codigosBarras || []).includes(eanUse) && !barrasDuplicado(eanUse, insumoId)) {
                const nb = [...(ins.codigosBarras || []), eanUse];
                await updateDoc(doc(db, 'insumos', insumoId), { codigosBarras: nb });
                ins.codigosBarras = nb;
            }
        }
        await registrarCompraCore(insumoId, r.cantidad, r.unidad, r.precio, r.fecha || hoyISO());
        ok++;
    }
    b.parsed = [];
    b.img = null; b.rot = 0; b.deskew = 0; b.total = null; b.fuente = 'ia';
    document.getElementById('boletaPreview').innerHTML = '';
    document.getElementById('boletaProgress').innerHTML = '';
    document.getElementById('boletaRotar').style.display = 'none';
    const fi = document.getElementById('boletaFile'); if (fi) fi.value = '';
    renderCompras(); renderInsumos(); renderBarras(); actualizarSelects(); actualizarContadores(); calcularPrecio(); renderRecetas();
    celebrar(`¡${ok} compras registradas desde la boleta! 🎉`);
    } catch (e) {
        console.error(e);
        toast('Algo falló registrando la boleta — revisa tu conexión e inténtalo de nuevo', 'error');
    } finally { done(); }
}
