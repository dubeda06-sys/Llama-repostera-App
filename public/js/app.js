import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, getDocs, addDoc, deleteDoc, updateDoc, doc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const firebaseConfig = {
    apiKey: "AIzaSyCiRD6oqLCxcqf8jNL5lf2CJVqzslpYIsE",
    authDomain: "llama-repostera-app.firebaseapp.com",
    projectId: "llama-repostera-app",
    storageBucket: "llama-repostera-app.firebasestorage.app",
    messagingSenderId: "1068969810874",
    appId: "1:1068969810874:web:90b68af4eec3ab4598db83"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const googleProvider = new GoogleAuthProvider();

// ── Estado local ──────────────────────────────────────────────
let insumos = [], compras = [], recetas = [];
let ingredientesTemp = [];
let editingId = null;
let editandoRecetaId = null;
let editIngredientes  = [];

// ── XSS escape ───────────────────────────────────────────────
function esc(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// ── Auth ─────────────────────────────────────────────────────
function signInGoogle() {
    signInWithPopup(auth, googleProvider)
        .catch(err => toast('Error al iniciar sesión: ' + err.message, 'error'));
}

function logout() {
    signOut(auth).then(() => { insumos = []; compras = []; recetas = []; });
}

// ── Toast ────────────────────────────────────────────────────
function toast(msg, tipo = 'ok') {
    const host = document.getElementById('toastHost');
    const el = document.createElement('div');
    el.className = `toast toast-${tipo}`;
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => {
        el.classList.add('toast-out');
        setTimeout(() => el.remove(), 320);
    }, 3200);
}

// ── Modal de confirmación (async) ────────────────────────────
function confirmar(msg) {
    return new Promise(resolve => {
        const overlay = document.getElementById('modalOverlay');
        document.getElementById('modalMsg').textContent = msg;
        overlay.classList.add('open');
        const cancelar = () => { overlay.classList.remove('open'); resolve(false); };
        const aceptar  = () => { overlay.classList.remove('open'); resolve(true);  };
        document.getElementById('modalCancel').onclick  = cancelar;
        document.getElementById('modalConfirm').onclick = aceptar;
        overlay.onclick = e => { if (e.target === overlay) cancelar(); };
    });
}

// ── Configuración (defaults ponderables) ──────────────────────
const DEFAULT_SETTINGS = { moneda: '$', tarifaHora: 0, empaqueDefault: 0, indirectosDefault: 0, mermaDefault: 0, margenDefault: 50 };
function getSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('settings')) || {}; } catch (e) { s = {}; }
    // migrar la moneda vieja si existe
    if (s.moneda == null && localStorage.getItem('currency')) s.moneda = localStorage.getItem('currency');
    return { ...DEFAULT_SETTINGS, ...s };
}
let settings = getSettings();
let currency = settings.moneda;

// ── Conversión de unidades ────────────────────────────────────
const FACTORS = { g:1, kg:1000, ml:1, l:1000, unidad:1 };
const FAMILY  = { g:'masa', kg:'masa', ml:'vol', l:'vol', unidad:'unidad' };

// unidades compatibles con el unidadBase del insumo (misma familia)
function unidadesCompatibles(insumo) {
    const base = insumo && insumo.unidadBase;
    if (!base) return Object.keys(FACTORS); // sin compras: todas las opciones
    const fam = FAMILY[base];
    return Object.keys(FACTORS).filter(u => FAMILY[u] === fam);
}

// costo de usar `cantidad` en `unidadUso` de un insumo con precio por su unidadBase
// devuelve: number (ok), null (unidad incompatible), 0 (sin precio / sin compras)
function costoUso(insumo, cantidad, unidadUso) {
    if (insumo == null || insumo.precio == null || !insumo.unidadBase) return 0;
    if (FAMILY[unidadUso] !== FAMILY[insumo.unidadBase]) return null;
    const precioPorBase = insumo.precio / FACTORS[insumo.unidadBase];
    return cantidad * FACTORS[unidadUso] * precioPorBase;
}

// SKU correlativo: 3 primeras letras del nombre + número, evita colisiones
function sugerirCodigo(nombre) {
    const base = (nombre || '')
        .normalize('NFD')
        .replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3) || 'INS';
    const usados = new Set(insumos.map(i => (i.codigo || '').toUpperCase()));
    let n = 1, codigo;
    do { codigo = `${base}-${String(n).padStart(2, '0')}`; n++; } while (usados.has(codigo));
    return codigo;
}

function autoCodigo() {
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

// ── Navegación ────────────────────────────────────────────────
function openSection(id) {
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('sectionsWrapper').classList.add('visible');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.getElementById('backBtn').style.display = 'block';
    cerrarDropdown();
    if (id === 'calculadora') abrirRecetaEnCalc();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goBack() {
    document.getElementById('dashboard').style.display = 'grid';
    document.getElementById('sectionsWrapper').classList.remove('visible');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('backBtn').style.display = 'none';
}

// ── Firestore: carga inicial ──────────────────────────────────
async function cargarTodo() {
    const [si, sc, sr] = await Promise.all([
        getDocs(collection(db, 'insumos')),
        getDocs(collection(db, 'compras')),
        getDocs(collection(db, 'recetas'))
    ]);
    insumos  = si.docs.map(d => normalizarInsumo({ id: d.id, ...d.data() }));
    compras  = sc.docs.map(d => ({ id: d.id, ...d.data() }));
    recetas  = sr.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
}

// Retrocompat: codigoBarras (string) → codigosBarras (array)
function normalizarInsumo(ins) {
    if (!Array.isArray(ins.codigosBarras)) {
        ins.codigosBarras = ins.codigoBarras ? [ins.codigoBarras] : [];
    }
    return ins;
}

function renderAll() {
    renderInsumos();
    renderCompras();
    renderRecetas();
    renderBarras();
    actualizarSelects();
    actualizarContadores();
}

// ── Insumos ───────────────────────────────────────────────────
function getEmoji(nombre) {
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

function precioInsumo(id) {
    const ins = insumos.find(i => i.id === id);
    return (ins && ins.precio != null) ? ins.precio : 0;
}

function renderInsumos() {
    const el = document.getElementById('listaInsumos');
    if (!insumos.length) {
        el.innerHTML = '<div class="empty-state"><div class="es-icon">📦</div><p>No hay insumos registrados</p><button class="es-cta" onclick="document.getElementById(\'insumoNombre\').focus()">+ Agregar primer insumo</button></div>';
        return;
    }
    el.innerHTML = insumos.map(ins => {
        const tieneprecio = ins.precio != null && ins.unidadBase;
        const emoji  = getEmoji(ins.nombre);
        const codigo = ins.codigo || '—';
        const barras = ins.codigosBarras || [];
        const barrasHtml = barras.length
            ? `<span style="color:#adb5bd; font-size:11px; margin-left:8px;">🔖 ${barras.length}</span>` : '';
        return `
        <div class="insumo-card" id="card-${ins.id}">
            <div class="insumo-card-view" id="view-${ins.id}">
                <div class="insumo-info">
                    <span class="insumo-emoji">${emoji}</span>
                    <div class="insumo-details">
                        <h3><span class="codigo-tag">${esc(codigo)}</span> ${esc(ins.nombre)}${barrasHtml}</h3>
                        <p>${tieneprecio
                            ? `<span class="price-tag">${esc(currency)}${ins.precio.toFixed(2)}/${esc(ins.unidadBase)}</span>`
                            : `<span style="color:#adb5bd;font-size:12px;">Sin precio — registra una compra</span>`}
                        </p>
                    </div>
                </div>
                <div class="insumo-actions">
                    <button class="btn btn-edit btn-sm" onclick="iniciarEdicion('${ins.id}')">✏️ Editar</button>
                    <button class="btn btn-danger btn-sm" onclick="eliminarInsumo('${ins.id}')">🗑️</button>
                </div>
            </div>
            <div class="insumo-card-edit" id="edit-${ins.id}">
                <div class="edit-row">
                    <input type="text" id="eCodigo-${ins.id}" value="${esc(ins.codigo || '')}" placeholder="Código" maxlength="12">
                    <input type="text" id="eNombre-${ins.id}" value="${esc(ins.nombre)}" placeholder="Nombre">
                    <input type="number" id="ePrecio-${ins.id}" value="${tieneprecio ? ins.precio : ''}" placeholder="Precio manual" step="0.01" min="0" style="width:110px;">
                    <button class="btn btn-success btn-sm" onclick="guardarEdicion('${ins.id}')">✓</button>
                    <button class="btn btn-edit btn-sm" onclick="cancelarEdicion('${ins.id}')">✕</button>
                </div>
                ${barras.length ? `<div style="margin-top:8px;">${barras.map(b => `<span class="barcode-chip">${esc(b)}</span>`).join('')}<span style="font-size:11px; color:#adb5bd; margin-left:6px;">(edita códigos en el módulo 🔖)</span></div>` : ''}
            </div>
        </div>`;
    }).join('');
}

async function agregarInsumo() {
    const nombre = document.getElementById('insumoNombre').value.trim();
    const codigoBarras = document.getElementById('insumoBarras').value.trim();
    let codigo = document.getElementById('insumoCodigo').value.trim().toUpperCase();
    if (!nombre) return toast('Ingresa el nombre del insumo', 'error');
    if (!codigo) codigo = sugerirCodigo(nombre);
    if (codigoBarras && barrasDuplicado(codigoBarras)) return toast('Ese código de barras ya está ligado a otro producto', 'error');
    const datos = { codigo, nombre, codigosBarras: codigoBarras ? [codigoBarras] : [], precio: null, unidadBase: null, fechaCreacion: new Date().toISOString() };
    const ref = await addDoc(collection(db, 'insumos'), datos);
    insumos.push({ id: ref.id, ...datos });
    const codEl = document.getElementById('insumoCodigo');
    document.getElementById('insumoNombre').value = '';
    document.getElementById('insumoBarras').value = '';
    codEl.value = ''; codEl.dataset.manual = '';
    renderInsumos();
    renderBarras();
    actualizarSelects();
    actualizarContadores();
    toast(`"${nombre}" agregado`);
}

async function eliminarInsumo(id) {
    if (!(await confirmar('¿Eliminar este insumo? Esta acción no se puede deshacer.'))) return;
    await deleteDoc(doc(db, 'insumos', id));
    insumos = insumos.filter(i => i.id !== id);
    renderInsumos();
    actualizarSelects();
    actualizarContadores();
}

function iniciarEdicion(id) {
    document.getElementById(`view-${id}`).classList.add('hidden');
    document.getElementById(`edit-${id}`).classList.add('visible');
}

function cancelarEdicion(id) {
    document.getElementById(`view-${id}`).classList.remove('hidden');
    document.getElementById(`edit-${id}`).classList.remove('visible');
}

async function guardarEdicion(id) {
    const codigo = document.getElementById(`eCodigo-${id}`).value.trim().toUpperCase();
    const nombre = document.getElementById(`eNombre-${id}`).value.trim();
    const precioRaw = document.getElementById(`ePrecio-${id}`).value.trim();
    if (!nombre) return;
    const ins = insumos.find(i => i.id === id);
    const precio = precioRaw === '' ? null : parseFloat(precioRaw);
    const datos = {
        codigo: codigo || sugerirCodigo(nombre),
        nombre,
        precio,
        // preservar unidadBase — solo compras la cambian
        unidadBase: ins.unidadBase || null
    };
    await updateDoc(doc(db, 'insumos', id), datos);
    const idx = insumos.findIndex(i => i.id === id);
    insumos[idx] = { ...insumos[idx], ...datos };
    renderInsumos();
    renderRecetas();
    renderBarras();
    actualizarSelects();
    calcularPrecio();
}

// ── Módulo códigos de barra ───────────────────────────────────
function barrasDuplicado(codigo, exceptoId) {
    return insumos.some(i => i.id !== exceptoId && (i.codigosBarras || []).includes(codigo));
}

function insumoPorBarras(codigo) {
    return insumos.find(i => (i.codigosBarras || []).includes(codigo));
}

function toggleBarras() {
    const body = document.getElementById('barrasBody');
    const chev = document.getElementById('barrasChevron');
    const open = body.classList.toggle('open');
    chev.style.transform = open ? 'rotate(180deg)' : 'rotate(0)';
}

// feedback al escribir/escanear: ¿ya está ligado?
function lookupBarras(codigo) {
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

async function ligarBarras() {
    const codigo = document.getElementById('barrasCodigo').value.trim();
    const insumoId = document.getElementById('barrasInsumo').value;
    if (!codigo) return toast('Escanea o escribe un código de barras', 'error');
    if (!insumoId) return toast('Selecciona el producto a ligar', 'error');
    if (barrasDuplicado(codigo)) {
        const ya = insumoPorBarras(codigo);
        return toast(`Ese código ya está ligado a "${ya.nombre}"`, 'error');
    }
    const ins = insumos.find(i => i.id === insumoId);
    const nuevos = [...(ins.codigosBarras || []), codigo];
    await updateDoc(doc(db, 'insumos', insumoId), { codigosBarras: nuevos });
    ins.codigosBarras = nuevos;
    document.getElementById('barrasCodigo').value = '';
    document.getElementById('barrasLookup').innerHTML = '';
    renderBarras();
    renderInsumos();
    toast('Código de barras ligado');
}

async function eliminarBarras(insumoId, codigo) {
    const ins = insumos.find(i => i.id === insumoId);
    if (!ins) return;
    const nuevos = (ins.codigosBarras || []).filter(b => b !== codigo);
    await updateDoc(doc(db, 'insumos', insumoId), { codigosBarras: nuevos });
    ins.codigosBarras = nuevos;
    renderBarras();
    renderInsumos();
}

function renderBarras() {
    const el = document.getElementById('listaBarras');
    if (!el) return;
    const conBarras = insumos.filter(i => (i.codigosBarras || []).length);
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
function filtrarSugeridos(query) {
    const drop = document.getElementById('sugeridosDropdown');
    if (!query.trim()) { drop.style.display = 'none'; return; }
    const existentes = new Set(insumos.map(i => i.nombre.toLowerCase()));
    const matches = SUGERIDOS.filter(s =>
        s.nombre.toLowerCase().includes(query.toLowerCase()) &&
        !existentes.has(s.nombre.toLowerCase())
    );
    if (!matches.length) { drop.style.display = 'none'; return; }
    drop.innerHTML = matches.map(s => `
        <div class="sugerido-item" onclick="seleccionarSugerido('${s.nombre}','${s.unidad}')">
            <span class="si-emoji">${s.emoji}</span>
            <div>
                <div class="si-nombre">${s.nombre}</div>
                <div class="si-unidad">${s.unidad}</div>
            </div>
        </div>
    `).join('');
    drop.style.display = 'block';
}

function mostrarSugeridos() {
    const q = document.getElementById('buscarInsumo').value;
    if (q.trim()) filtrarSugeridos(q);
}

function seleccionarSugerido(nombre, unidad) {
    document.getElementById('insumoNombre').value = nombre;
    document.getElementById('buscarInsumo').value = '';
    cerrarDropdown();
    agregarInsumo();
}

function cerrarDropdown() {
    document.getElementById('sugeridosDropdown').style.display = 'none';
}

document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrapper')) cerrarDropdown();
});

// ── Compras ───────────────────────────────────────────────────
function renderCompras() {
    const el = document.getElementById('listaCompras');
    if (!compras.length) {
        el.innerHTML = '<div class="empty-state" style="margin-top:20px;"><div class="es-icon">🛒</div><p>No hay compras registradas</p></div>';
        return;
    }
    const sorted = [...compras].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    el.innerHTML = `<div class="table-wrap"><table><thead><tr>
        <th>Fecha</th><th>Insumo</th><th>Cantidad</th><th>Precio</th><th></th>
    </tr></thead><tbody>
    ${sorted.map(c => {
        const ins = insumos.find(i => i.id === c.insumoId);
        return `<tr>
            <td>${new Date(c.fecha + 'T00:00').toLocaleDateString()}</td>
            <td>${ins ? esc(ins.nombre) : 'N/A'}</td>
            <td>${c.cantidad} ${esc(c.unidad || (ins ? ins.unidad : ''))}</td>
            <td>${esc(currency)}${parseFloat(c.precio).toFixed(2)}</td>
            <td><button class="btn btn-danger btn-sm" onclick="eliminarCompra('${c.id}')">🗑️</button></td>
        </tr>`;
    }).join('')}
    </tbody></table></div>`;
}

async function agregarCompra() {
    const insumoId = document.getElementById('compraInsumo').value;
    const cantidad = parseFloat(document.getElementById('compraCantidad').value);
    const unidad   = document.getElementById('compraUnidad').value;
    const precio   = parseFloat(document.getElementById('compraPrecio').value);
    const fecha    = document.getElementById('compraFecha').value;
    if (!insumoId || !cantidad || !precio || !fecha) return toast('Completa todos los campos', 'error');

    const ref = await addDoc(collection(db, 'compras'), { insumoId, cantidad, unidad, precio, fecha, fechaRegistro: new Date().toISOString() });
    compras.push({ id: ref.id, insumoId, cantidad, unidad, precio, fecha });

    // Última compra reescribe el precio del insumo y fija unidadBase si no estaba
    const ins = insumos.find(i => i.id === insumoId);
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

    document.getElementById('compraCantidad').value = '';
    document.getElementById('compraPrecio').value = '';
    renderCompras();
    renderInsumos();
    renderRecetas();
    calcularPrecio();
    actualizarContadores();
    toast('Compra registrada');
}

async function eliminarCompra(id) {
    if (!(await confirmar('¿Eliminar esta compra?'))) return;
    await deleteDoc(doc(db, 'compras', id));
    compras = compras.filter(c => c.id !== id);
    renderCompras();
    renderInsumos();
    actualizarContadores();
}

function procesarBoleta(event) {
    const file = event.target.files[0];
    if (file) toast('Escaneo en desarrollo — ingresa los datos manualmente', 'info');
}

// ── Recetas ───────────────────────────────────────────────────
function renderRecetas() {
    const el = document.getElementById('listaRecetas');
    if (!recetas.length) {
        el.innerHTML = '<div class="empty-state"><div class="es-icon">📖</div><p>No hay recetas guardadas</p><button class="es-cta" onclick="document.getElementById(\'recetaNombre\').focus()">+ Crear primera receta</button></div>';
        return;
    }
    el.innerHTML = recetas.map(r => {
        const costo = calcularCostoReceta(r);
        const avisos = avisosReceta(r);
        const avisoHtml = avisos.length
            ? `<p style="color:#dc3545; font-size:12px; margin-top:6px;">⚠️ ${avisos.join(' · ')}</p>`
            : '';

        if (editandoRecetaId === r.id) {
            const ingHtml = editIngredientes.length
                ? editIngredientes.map((ing, idx) => `
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
                                ${insumos.map(i => `<option value="${i.id}">${i.codigo ? '['+esc(i.codigo)+'] ' : ''}${esc(i.nombre)}</option>`).join('')}
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
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div style="flex:1; min-width:0;">
                    <h3 style="color:#343a40;">${esc(r.nombre)}</h3>
                    <p style="color:#6c757d; font-size:13px; margin-top:4px;">${r.porciones} porciones · ${r.ingredientes.length} ingredientes</p>
                    <span class="price-tag" style="margin-top:8px; display:inline-block;">Costo: ${esc(currency)}${costo.toFixed(2)}</span>
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
function actualizarUnidadIngrediente() {
    const insumoId = document.getElementById('ingredienteInsumo').value;
    const sel = document.getElementById('ingredienteUnidad');
    const ins = insumos.find(i => i.id === insumoId);
    if (!ins) { sel.innerHTML = ''; return; }
    const defaultUnit = ins.unidadBase || 'g';
    const opts = unidadesCompatibles(ins);
    sel.innerHTML = opts.map(u => `<option value="${u}" ${u===defaultUnit?'selected':''}>${u}</option>`).join('');
}

function agregarIngrediente() {
    const insumoId = document.getElementById('ingredienteInsumo').value;
    const cantidad = parseFloat(document.getElementById('ingredienteCantidad').value);
    const unidad   = document.getElementById('ingredienteUnidad').value;
    if (!insumoId || !cantidad) return toast('Selecciona insumo e ingresa cantidad', 'error');
    if (ingredientesTemp.find(i => i.insumoId === insumoId)) return toast('Ingrediente ya agregado', 'error');
    const ins = insumos.find(i => i.id === insumoId);
    ingredientesTemp.push({ insumoId, codigo: ins.codigo || '', nombre: ins.nombre, unidad: unidad || ins.unidad, cantidad });
    document.getElementById('ingredienteCantidad').value = '';
    renderIngredientesTemp();
}

function eliminarIngredienteTemp(idx) {
    ingredientesTemp.splice(idx, 1);
    renderIngredientesTemp();
}

function renderIngredientesTemp() {
    const el = document.getElementById('ingredientesReceta');
    if (!ingredientesTemp.length) { el.innerHTML = ''; return; }
    el.innerHTML = ingredientesTemp.map((ing, i) => `
        <div class="ingredient-item">
            <span><strong>${esc(ing.nombre)}</strong> — ${ing.cantidad} ${esc(ing.unidad)}</span>
            <button class="btn btn-danger btn-sm" onclick="eliminarIngredienteTemp(${i})">✕</button>
        </div>
    `).join('');
}

async function guardarReceta() {
    const nombre    = document.getElementById('recetaNombre').value.trim();
    const porciones = parseInt(document.getElementById('recetaPorciones').value);
    if (!nombre) return toast('Ingresa el nombre de la receta', 'error');
    if (!ingredientesTemp.length) return toast('Agrega al menos un ingrediente', 'error');
    const costos = {
        horas: 0,
        empaque:    settings.empaqueDefault    || 0,
        indirectos: settings.indirectosDefault || 0,
        merma:      settings.mermaDefault      || 0,
        margen:     settings.margenDefault     || 0,
        competencia: 0
    };
    const ref = await addDoc(collection(db, 'recetas'), { nombre, porciones, ingredientes: [...ingredientesTemp], costos, fechaCreacion: new Date().toISOString() });
    recetas.push({ id: ref.id, nombre, porciones, ingredientes: [...ingredientesTemp], costos });
    document.getElementById('recetaNombre').value = '';
    document.getElementById('recetaPorciones').value = '1';
    ingredientesTemp = [];
    renderIngredientesTemp();
    renderRecetas();
    actualizarContadores();
    actualizarCalcSelect();
    toast(`Receta "${nombre}" guardada`);
}

async function eliminarReceta(id) {
    if (!(await confirmar('¿Eliminar esta receta?'))) return;
    await deleteDoc(doc(db, 'recetas', id));
    recetas = recetas.filter(r => r.id !== id);
    renderRecetas();
    actualizarContadores();
    actualizarCalcSelect();
}

// ── Edición inline de recetas ─────────────────────────────────
function iniciarEdicionReceta(id) {
    const r = recetas.find(x => x.id === id);
    if (!r) return;
    editandoRecetaId = id;
    editIngredientes = r.ingredientes.map(i => ({ ...i }));
    renderRecetas();
}

function cancelarEdicionReceta() {
    editandoRecetaId = null;
    editIngredientes = [];
    renderRecetas();
}

function editActualizarUnidad() {
    const insumoId = document.getElementById('editIngInsumo')?.value;
    const unitSel  = document.getElementById('editIngUnidad');
    if (!unitSel) return;
    const ins = insumos.find(i => i.id === insumoId);
    if (!ins) { unitSel.innerHTML = ''; return; }
    const base = ins.unidadBase || 'g';
    const opts = unidadesCompatibles(ins);
    unitSel.innerHTML = opts.map(u => `<option value="${u}" ${u===base?'selected':''}>${u}</option>`).join('');
}

function editAgregarIngrediente() {
    const insumoId = document.getElementById('editIngInsumo').value;
    const cantidad = parseFloat(document.getElementById('editIngCantidad').value);
    const unidad   = document.getElementById('editIngUnidad').value;
    if (!insumoId || !cantidad) return toast('Selecciona insumo e ingresa cantidad', 'error');
    if (editIngredientes.find(i => i.insumoId === insumoId)) return toast('Ingrediente ya en la receta', 'error');
    const ins = insumos.find(i => i.id === insumoId);
    editIngredientes.push({ insumoId, codigo: ins.codigo || '', nombre: ins.nombre, unidad, cantidad });
    renderRecetas();
}

function editQuitarIngrediente(idx) {
    editIngredientes.splice(idx, 1);
    renderRecetas();
}

async function guardarEdicionReceta(id) {
    const nombre    = document.getElementById('editRecetaNombre').value.trim();
    const porciones = parseInt(document.getElementById('editRecetaPorciones').value) || 1;
    if (!nombre)                  return toast('Ingresa el nombre de la receta', 'error');
    if (!editIngredientes.length) return toast('Agrega al menos un ingrediente', 'error');
    await updateDoc(doc(db, 'recetas', id), { nombre, porciones, ingredientes: editIngredientes });
    const idx = recetas.findIndex(r => r.id === id);
    recetas[idx] = { ...recetas[idx], nombre, porciones, ingredientes: [...editIngredientes] };
    editandoRecetaId = null;
    editIngredientes = [];
    renderRecetas();
    actualizarCalcSelect();
    toast(`"${nombre}" actualizada`);
}

// ── Importador de recetas (texto → ingredientes) ──────────────
let importParsed = [];
let importNombre = '', importPorciones = null;

function quitarAcentos(s) { return s.toLowerCase().replace(/[áàäâ]/g,'a').replace(/[éèëê]/g,'e').replace(/[íìïî]/g,'i').replace(/[óòöô]/g,'o').replace(/[úùüû]/g,'u').replace(/ñ/g,'n'); }

// [regex sobre texto normalizado, unidad destino, factor a aplicar a la cantidad]
const UNIDAD_MAP = [
    { re: /\b(kilogramos?|kilos?|kgs?)\b/, u: 'kg', f: 1 },
    { re: /\b(gramos?|grs?|gr|g)\b/,       u: 'g',  f: 1 },
    { re: /\b(mililitros?|mls?|cc)\b/,     u: 'ml', f: 1 },
    { re: /\b(litros?|lts?|lt|l)\b/,       u: 'l',  f: 1 },
    { re: /\b(tazas?)\b/,                  u: 'ml', f: 240 },
    { re: /\b(cucharaditas?|cdtas?|cdita)\b/, u: 'ml', f: 5 },
    { re: /\b(cucharadas?|cdas?|cda)\b/,   u: 'ml', f: 15 },
    { re: /\b(pizcas?)\b/,                 u: 'g',  f: 0.5 },
    { re: /\b(unidades?|piezas?|uds?)\b/,  u: 'unidad', f: 1 },
];

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

function matchInsumo(nombre) {
    const n = quitarAcentos(nombre.toLowerCase());
    return insumos.find(i => {
        const ni = quitarAcentos(i.nombre.toLowerCase());
        if (n.includes(ni) || ni.includes(n)) return true;
        return n.split(' ').some(w => w.length > 3 && ni.includes(w));
    });
}

function interpretarReceta() {
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
                ${insumos.map(ins => `<option value="${ins.id}" ${ins.id===r.insumoId?'selected':''}>${esc(ins.nombre)}</option>`).join('')}
            </select>
            <button class="btn btn-danger btn-sm" onclick="importQuitar(${i})">✕</button>
        </div>`).join('') +
        `<p style="font-size:11px; color:#adb5bd; margin-top:6px;">El texto del nombre se usa para crear el insumo nuevo. Al editarlo, la app vuelve a buscar coincidencias.</p>` +
        `<button class="btn btn-success" style="margin-top:8px;" onclick="aplicarImport()">✓ Cargar a la receta</button>`;
}

function importEdit(i, campo, valor) {
    if (campo === 'cantidad') importParsed[i].cantidad = parseFloat(valor) || 0;
    else if (campo === 'insumoId') importParsed[i].insumoId = (valor === '__new__') ? null : valor;
    else importParsed[i][campo] = valor;
}

// al editar el nombre, re-buscar coincidencia con insumos y refrescar la fila
function importRematch(i) {
    const r = importParsed[i];
    const nombre = (r.nombreRaw || '').trim();
    if (!nombre) { r.insumoId = null; renderImportPreview(); return; }
    const match = matchInsumo(nombre);
    r.insumoId = match ? match.id : null;
    renderImportPreview();
}

function importQuitar(i) { importParsed.splice(i, 1); renderImportPreview(); }

async function aplicarImport() {
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
                insumos.push({ id: ref.id, ...datos });
                insumoId = ref.id;
                nuevosCreados[clave] = insumoId;
            }
        }
        if (ingredientesTemp.find(x => x.insumoId === insumoId)) continue; // ya está
        const ins = insumos.find(x => x.id === insumoId);
        ingredientesTemp.push({ insumoId, codigo: ins.codigo || '', nombre: ins.nombre, unidad: r.unidad, cantidad: r.cantidad });
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

function toggleImport() {
    const body = document.getElementById('importBody');
    const chev = document.getElementById('importChevron');
    const open = body.classList.toggle('open');
    chev.style.transform = open ? 'rotate(180deg)' : 'rotate(0)';
}

function limpiarImport() {
    document.getElementById('importTexto').value = '';
    document.getElementById('importPreview').innerHTML = '';
    importParsed = []; importNombre = ''; importPorciones = null;
}

// ── Calculadora ───────────────────────────────────────────────
function calcularCostoReceta(receta) {
    return receta.ingredientes.reduce((total, ing) => {
        const ins = insumos.find(i => i.id === ing.insumoId);
        const c = costoUso(ins, ing.cantidad, ing.unidad);
        return total + (c || 0); // null (incompatible) o 0 (sin precio) → 0
    }, 0);
}

// lista de problemas que impiden costear bien una receta
function avisosReceta(receta) {
    const av = [];
    receta.ingredientes.forEach(ing => {
        const ins = insumos.find(i => i.id === ing.insumoId);
        if (!ins) { av.push(`${esc(ing.nombre)}: insumo eliminado`); return; }
        if (ins.precio == null) av.push(`${esc(ing.nombre)}: sin precio`);
        else if (ins.unidadBase && FAMILY[ing.unidad] !== FAMILY[ins.unidadBase]) av.push(`${esc(ing.nombre)}: unidad incompatible (${esc(ing.unidad)} vs ${esc(ins.unidadBase)})`);
    });
    return av;
}

// prellena inputs de la calculadora desde la receta o desde los defaults de Config
function abrirRecetaEnCalc() {
    const recetaId = document.getElementById('calcReceta').value;
    const cont = document.getElementById('calcInputs');
    if (!recetaId) { cont.style.display = 'none'; document.getElementById('resultadoCalculo').innerHTML = ''; return; }
    const r = recetas.find(x => x.id === recetaId);
    if (!r) return;
    const c = r.costos || {};
    document.getElementById('calcHoras').value       = c.horas      != null ? c.horas      : '';
    document.getElementById('calcEmpaque').value     = c.empaque    != null ? c.empaque    : (settings.empaqueDefault    || '');
    document.getElementById('calcIndirectos').value  = c.indirectos != null ? c.indirectos : (settings.indirectosDefault || '');
    document.getElementById('calcMerma').value       = c.merma      != null ? c.merma      : (settings.mermaDefault      || '');
    document.getElementById('calcMargen').value      = c.margen     != null ? c.margen     : (settings.margenDefault     || '');
    document.getElementById('calcCompetencia').value = c.competencia != null ? c.competencia : '';
    cont.style.display = 'block';
    calcularPrecio();
}

function calcularPrecio() {
    const recetaId = document.getElementById('calcReceta').value;
    const el       = document.getElementById('resultadoCalculo');
    if (!recetaId) { el.innerHTML = ''; return; }
    const receta   = recetas.find(r => r.id === recetaId);
    if (!receta)   { el.innerHTML = ''; return; }

    const horas       = parseFloat(document.getElementById('calcHoras').value) || 0;
    const empaque     = parseFloat(document.getElementById('calcEmpaque').value) || 0;
    const indirectos  = parseFloat(document.getElementById('calcIndirectos').value) || 0;
    const merma       = parseFloat(document.getElementById('calcMerma').value) || 0;
    const margen      = parseFloat(document.getElementById('calcMargen').value) || 0;
    const competencia = parseFloat(document.getElementById('calcCompetencia').value) || 0;

    // 5 capas
    const materiaPrima = calcularCostoReceta(receta);
    const manoObra     = horas * (settings.tarifaHora || 0);
    const costoBase    = materiaPrima + manoObra + empaque + indirectos;
    const conMerma     = costoBase * (1 + merma / 100);
    const precioVenta  = conMerma * (1 + margen / 100);
    const porciones    = receta.porciones || 1;
    const porPorcion   = precioVenta / porciones;
    const gananciaNeta = precioVenta - conMerma;

    const avisos = avisosReceta(receta);
    const avisoHtml = avisos.length
        ? `<div style="background:#fff3cd; color:#856404; padding:12px 16px; border-radius:10px; margin-bottom:14px; font-size:13px;">⚠️ Costo incompleto — ${avisos.join(' · ')}</div>`
        : '';

    const row = (label, val, extra='') => `<div class="cost-item"><span>${label}</span><span>${esc(currency)}${val.toFixed(2)}${extra}</span></div>`;

    // comparación competencia
    let compHtml = '';
    if (competencia > 0) {
        const costoUnit = conMerma / porciones;
        let msg, color;
        if (competencia < costoUnit) {
            msg = `⚠️ La competencia (${esc(currency)}${competencia.toFixed(2)}) cobra MENOS que tu costo (${esc(currency)}${costoUnit.toFixed(2)}). Revisa tus costos o no entres a ese precio.`;
            color = '#dc3545';
        } else if (competencia < porPorcion) {
            const sugMargen = ((competencia / costoUnit) - 1) * 100;
            msg = `ℹ️ Tu sugerido (${esc(currency)}${porPorcion.toFixed(2)}) está sobre la competencia (${esc(currency)}${competencia.toFixed(2)}). Aún ganas: a precio competencia tu margen sería ~${sugMargen.toFixed(0)}%.`;
            color = '#fd7e14';
        } else {
            msg = `✓ Tu sugerido (${esc(currency)}${porPorcion.toFixed(2)}) está bajo la competencia (${esc(currency)}${competencia.toFixed(2)}). Margen para subir precio.`;
            color = '#28a745';
        }
        compHtml = `<div style="background:white; border:2px solid ${color}; color:${color}; padding:12px 16px; border-radius:10px; margin-top:14px; font-size:13px;">${msg}</div>`;
    }

    el.innerHTML = avisoHtml + `
        <div class="cost-summary">
            <h3>💰 ${esc(receta.nombre)}</h3>
            ${row('🥣 Materia prima', materiaPrima)}
            ${row('👩‍🍳 Mano de obra', manoObra, horas ? ` <small>(${horas}h)</small>` : '')}
            ${row('📦 Empaque', empaque)}
            ${row('⚡ Indirectos', indirectos)}
            <div class="cost-item"><span>Subtotal</span><span>${esc(currency)}${costoBase.toFixed(2)}</span></div>
            ${merma ? row(`🗑️ Merma (${merma}%)`, conMerma - costoBase) : ''}
            <div class="cost-item total-cost"><span>Costo real</span><span>${esc(currency)}${conMerma.toFixed(2)}</span></div>
            ${row(`📈 Ganancia (${margen}%)`, gananciaNeta)}
            <div class="cost-item"><span>Porciones</span><span>${porciones}</span></div>
        </div>
        <div class="profit-result" style="margin-top:16px;">
            Precio de venta: ${esc(currency)}${precioVenta.toFixed(2)}
            <br><small style="font-weight:400;">Por porción: ${esc(currency)}${porPorcion.toFixed(2)}</small>
        </div>` + compHtml;
}

async function guardarCostosReceta() {
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
    const idx = recetas.findIndex(r => r.id === recetaId);
    recetas[idx] = { ...recetas[idx], costos };
    const msg = document.getElementById('calcGuardadoMsg');
    msg.style.display = 'inline';
    setTimeout(() => msg.style.display = 'none', 2000);
    renderRecetas();
}

// ── Selects y contadores ──────────────────────────────────────
function actualizarSelects() {
    const opts = '<option value="">Selecciona un insumo</option>' +
        insumos.map(i => `<option value="${i.id}">${i.codigo ? '['+esc(i.codigo)+'] ' : ''}${esc(i.nombre)}${i.unidadBase ? ' ('+esc(i.unidadBase)+')' : ''}</option>`).join('');
    document.getElementById('compraInsumo').innerHTML = opts;
    document.getElementById('ingredienteInsumo').innerHTML = opts;
    const barrasSel = document.getElementById('barrasInsumo');
    if (barrasSel) barrasSel.innerHTML = '<option value="">Selecciona un insumo</option>' +
        insumos.map(i => `<option value="${i.id}">${i.codigo ? '['+esc(i.codigo)+'] ' : ''}${esc(i.nombre)}</option>`).join('');
    actualizarUnidadIngrediente();
    actualizarCalcSelect();
}

function actualizarCalcSelect() {
    document.getElementById('calcReceta').innerHTML =
        '<option value="">Selecciona una receta</option>' +
        recetas.map(r => `<option value="${r.id}">${esc(r.nombre)}</option>`).join('');
}

function actualizarContadores() {
    document.getElementById('countInsumos').textContent = insumos.length;
    document.getElementById('countCompras').textContent = compras.length;
    document.getElementById('countRecetas').textContent = recetas.length;
}

// ── Config ────────────────────────────────────────────────────
function guardarConfig() {
    const moneda = document.getElementById('configMoneda').value.trim() || '$';
    settings = {
        moneda,
        tarifaHora:       parseFloat(document.getElementById('configTarifaHora').value) || 0,
        empaqueDefault:   parseFloat(document.getElementById('configEmpaque').value) || 0,
        indirectosDefault:parseFloat(document.getElementById('configIndirectos').value) || 0,
        mermaDefault:     parseFloat(document.getElementById('configMerma').value) || 0,
        margenDefault:    parseFloat(document.getElementById('configMargen').value) || 0
    };
    currency = moneda;
    localStorage.setItem('settings', JSON.stringify(settings));
    localStorage.setItem('currency', moneda); // retrocompat
    const msg = document.getElementById('configMsg');
    msg.style.display = 'block';
    setTimeout(() => msg.style.display = 'none', 2000);
    toast('Configuración guardada');
    renderInsumos(); renderCompras(); renderRecetas(); calcularPrecio();
}

function cargarConfigEnUI() {
    document.getElementById('configMoneda').value      = settings.moneda;
    document.getElementById('configTarifaHora').value  = settings.tarifaHora      || '';
    document.getElementById('configEmpaque').value     = settings.empaqueDefault  || '';
    document.getElementById('configIndirectos').value  = settings.indirectosDefault || '';
    document.getElementById('configMerma').value       = settings.mermaDefault    || '';
    document.getElementById('configMargen').value      = settings.margenDefault   || '';
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('compraFecha').valueAsDate = new Date();
    cargarConfigEnUI();

    const cod = document.getElementById('insumoCodigo');
    if (cod) cod.addEventListener('input', () => { cod.dataset.manual = cod.value ? '1' : ''; });

    const EMAILS_PERMITIDOS = ['dubeda06@gmail.com', 'claudia.jarap01@gmail.com'];

    onAuthStateChanged(auth, async user => {
        const loginScreen = document.getElementById('loginScreen');
        const appRoot     = document.getElementById('appRoot');
        const userInfo    = document.getElementById('userInfo');
        const userName    = document.getElementById('userName');
        if (user) {
            if (!EMAILS_PERMITIDOS.includes(user.email)) {
                await signOut(auth);
                loginScreen.style.display = 'flex';
                appRoot.style.display     = 'none';
                userInfo.style.display    = 'none';
                toast('Acceso no autorizado: ' + user.email, 'error');
                return;
            }
            loginScreen.style.display = 'none';
            appRoot.style.display     = 'block';
            userInfo.style.display    = 'flex';
            if (userName) userName.textContent = user.displayName || user.email || '';
            cargarTodo();
        } else {
            loginScreen.style.display = 'flex';
            appRoot.style.display     = 'none';
            userInfo.style.display    = 'none';
            insumos = []; compras = []; recetas = [];
        }
    });
});

// ── Window exports ────────────────────────────────────────────
window.openSection         = openSection;
window.goBack              = goBack;
window.agregarInsumo       = agregarInsumo;
window.autoCodigo          = autoCodigo;
window.eliminarInsumo      = eliminarInsumo;
window.toggleBarras        = toggleBarras;
window.lookupBarras        = lookupBarras;
window.ligarBarras         = ligarBarras;
window.eliminarBarras      = eliminarBarras;
window.iniciarEdicion      = iniciarEdicion;
window.cancelarEdicion     = cancelarEdicion;
window.guardarEdicion      = guardarEdicion;
window.filtrarSugeridos    = filtrarSugeridos;
window.mostrarSugeridos    = mostrarSugeridos;
window.seleccionarSugerido = seleccionarSugerido;
window.procesarBoleta      = procesarBoleta;
window.agregarCompra       = agregarCompra;
window.eliminarCompra      = eliminarCompra;
window.agregarIngrediente  = agregarIngrediente;
window.actualizarUnidadIngrediente = actualizarUnidadIngrediente;
window.eliminarIngredienteTemp = eliminarIngredienteTemp;
window.guardarReceta       = guardarReceta;
window.eliminarReceta          = eliminarReceta;
window.iniciarEdicionReceta    = iniciarEdicionReceta;
window.cancelarEdicionReceta   = cancelarEdicionReceta;
window.editActualizarUnidad    = editActualizarUnidad;
window.editAgregarIngrediente  = editAgregarIngrediente;
window.editQuitarIngrediente   = editQuitarIngrediente;
window.guardarEdicionReceta    = guardarEdicionReceta;
window.toggleImport        = toggleImport;
window.interpretarReceta   = interpretarReceta;
window.limpiarImport       = limpiarImport;
window.importEdit          = importEdit;
window.importRematch       = importRematch;
window.importQuitar        = importQuitar;
window.aplicarImport       = aplicarImport;
window.calcularPrecio      = calcularPrecio;
window.abrirRecetaEnCalc   = abrirRecetaEnCalc;
window.guardarCostosReceta = guardarCostosReceta;
window.guardarConfig       = guardarConfig;
window.signInGoogle        = signInGoogle;
window.logout              = logout;