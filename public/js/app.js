import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, getDocs, addDoc, deleteDoc, updateDoc, doc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
// Firebase AI Logic (Gemini) — instancia v12 separada, sólo para el respaldo de IA del lector de boletas
import { initializeApp as initAiApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-ai.js';
// App Check (reCAPTCHA v3): verifica que las llamadas vengan de esta app real (protege datos y cuota de IA)
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js';
import { initializeAppCheck as initAiAppCheck, ReCaptchaV3Provider as ReCaptchaV3ProviderAi, getToken as getAiAppCheckToken } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app-check.js';

const firebaseConfig = {
    apiKey: "AIzaSyCiRD6oqLCxcqf8jNL5lf2CJVqzslpYIsE",
    authDomain: "llama-repostera-app.firebaseapp.com",
    projectId: "llama-repostera-app",
    storageBucket: "llama-repostera-app.firebasestorage.app",
    messagingSenderId: "1068969810874",
    appId: "1:1068969810874:web:90b68af4eec3ab4598db83"
};

const firebaseApp = initializeApp(firebaseConfig);

// App Check — clave de sitio reCAPTCHA v3 (pública). Debe inicializarse antes de usar Firestore/IA.
const APP_CHECK_SITE_KEY = '6LeLIT0tAAAAAHO0Knz6sBMTrxgg4xs64Lt1UDhA';
const appCheck = initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true
});

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
// ¿la app corre instalada (standalone)? Ahí el popup de Google suele fallar → usamos redirect.
function esStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function signInGoogle() {
    if (esStandalone()) {
        signInWithRedirect(auth, googleProvider)
            .catch(err => toast('Error al iniciar sesión: ' + err.message, 'error'));
        return;
    }
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

// pestañas Ver / Ingresar de la sección Insumos
function insumosTab(which) {
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

function tienePrecioInsumo(ins) { return ins.precio != null && ins.unidadBase; }

// tarjeta de un insumo (vista + edición)
function insumoCardHtml(ins) {
    const tieneprecio = tienePrecioInsumo(ins);
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
}

function renderInsumos() {
    const el = document.getElementById('listaInsumos');
    if (!el) return;
    if (!insumos.length) {
        el.innerHTML = '<div class="empty-state"><div class="es-icon">📦</div><p>No hay insumos registrados</p><button class="es-cta" onclick="insumosTab(\'ingresar\')">+ Agregar primer insumo</button></div>';
        return;
    }
    // filtro de texto (nombre o código)
    const q = quitarAcentos((document.getElementById('filtrarInsumo')?.value || '').toLowerCase().trim());
    const lista = q
        ? insumos.filter(i => quitarAcentos((i.nombre + ' ' + (i.codigo || '')).toLowerCase()).includes(q))
        : insumos;
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
            ${arr.map(insumoCardHtml).join('')}
        </div>`;

    el.innerHTML =
        grupo('Con precio', '#37b24d', '💲', conPrecio) +
        grupo('Sin precio', '#f59f00', '🏷️', sinPrecio, 'Estos aún no tienen costo. Registra una compra (o escanea una boleta) para que tomen precio.');
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

// núcleo reutilizable: registra una compra y reescribe el precio/unidadBase del insumo
async function registrarCompraCore(insumoId, cantidad, unidad, precio, fecha) {
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
}

async function agregarCompra() {
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

async function eliminarCompra(id) {
    if (!(await confirmar('¿Eliminar esta compra?'))) return;
    await deleteDoc(doc(db, 'compras', id));
    compras = compras.filter(c => c.id !== id);
    renderCompras();
    renderInsumos();
    actualizarContadores();
}

// ── Interpretador de boletas (OCR cliente con Tesseract.js) ───
let boletaImg = null;   // HTMLImageElement original
let boletaRot = 0;      // rotación aplicada (0/90/180/270)
let boletaDeskew = 0;   // inclinación residual fina en grados (deskew)
let boletaParsed = [];
let boletaTotal = null; // TOTAL impreso en la boleta (para cuadre)
let boletaFuente = 'ocr'; // 'ocr' (Tesseract) | 'ia' (Gemini afinó el resultado)
let _iaAvisoMostrado = false; // evita repetir el aviso "IA no disponible"

function hoyISO() { return new Date().toISOString().slice(0, 10); }

function fileToImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

// umbral de Otsu sobre un histograma de grises (d ya en gris: r=g=b)
function otsuThreshold(px) {
    const hist = new Array(256).fill(0);
    let total = 0;
    for (let i = 0; i < px.length; i += 4) { hist[px[i]]++; total++; }
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, maxVar = -1, thr = 127;
    for (let t = 0; t < 256; t++) {
        wB += hist[t]; if (!wB) continue;
        const wF = total - wB; if (!wF) break;
        sumB += t * hist[t];
        const mB = sumB / wB, mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > maxVar) { maxVar = between; thr = t; }
    }
    return thr;
}

// umbral local de Sauvola sobre el canal gris (r=g=b) usando imágenes integrales (O(n)).
// Mucho mejor que Otsu global en papel térmico con luz despareja (zonas quemadas/lavadas).
//   T(x,y) = media * (1 + k * (std/128 - 1))
function sauvolaBinarize(px, w, h, win = 15, k = 0.34) {
    const r = win >> 1;
    const W = w + 1;
    const integ   = new Float64Array(W * (h + 1)); // suma de valores
    const integSq = new Float64Array(W * (h + 1)); // suma de cuadrados
    for (let y = 0; y < h; y++) {
        let rowSum = 0, rowSqSum = 0;
        for (let x = 0; x < w; x++) {
            const v = px[(y * w + x) * 4];
            rowSum += v; rowSqSum += v * v;
            const idx = (y + 1) * W + (x + 1);
            integ[idx]   = integ[y * W + (x + 1)]   + rowSum;
            integSq[idx] = integSq[y * W + (x + 1)] + rowSqSum;
        }
    }
    for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
            const area = (x1 - x0 + 1) * (y1 - y0 + 1);
            const A = (y1 + 1) * W + (x1 + 1), B = (y1 + 1) * W + x0;
            const C = y0 * W + (x1 + 1),       D = y0 * W + x0;
            const sum   = integ[A]   - integ[B]   - integ[C]   + integ[D];
            const sqSum = integSq[A] - integSq[B] - integSq[C] + integSq[D];
            const mean  = sum / area;
            const variance = sqSum / area - mean * mean;
            const std = variance > 0 ? Math.sqrt(variance) : 0;
            const T = mean * (1 + k * (std / 128 - 1));
            const o = (y * w + x) * 4;
            const val = px[o] > T ? 255 : 0;
            px[o] = px[o + 1] = px[o + 2] = val;
        }
    }
}

// dibuja la imagen rotada + grises + contraste + (opcional) binarización local → canvas para OCR
// targetMax = lado mayor deseado en px (acota tamaño para velocidad/memoria)
// extraDeg = inclinación fina adicional (deskew) en grados, se suma a rot
function prepararCanvas(img, rot, targetMax = 2400, binarizar = false, extraDeg = 0) {
    const rad = (rot + extraDeg) * Math.PI / 180;
    const swap = (rot === 90 || rot === 270);
    const w = img.naturalWidth, h = img.naturalHeight;
    const baseW = swap ? h : w, baseH = swap ? w : h;
    const scale = targetMax / Math.max(baseW, baseH);
    const cw = Math.round(baseW * scale);
    const ch = Math.round(baseH * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate(rad);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -w / 2, -h / 2);
    ctx.restore();
    const d = ctx.getImageData(0, 0, cw, ch);
    const px = d.data;
    // grises + contraste
    const contrast = 1.45, intercept = 128 * (1 - contrast);
    for (let i = 0; i < px.length; i += 4) {
        let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        g = g * contrast + intercept;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        px[i] = px[i + 1] = px[i + 2] = g;
    }
    // binarización local Sauvola (gran mejora en papel térmico con luz despareja)
    if (binarizar) sauvolaBinarize(px, cw, ch);
    ctx.putImageData(d, 0, 0);
    return canvas;
}

function setBoletaProgress(html) {
    const el = document.getElementById('boletaProgress');
    if (el) el.innerHTML = html;
}

function barraProgreso(p) {
    const pct = Math.round(p * 100);
    return `<div style="font-size:13px;color:#6c757d;margin-bottom:6px;">🔍 Leyendo boleta… ${pct}%</div>
        <div style="height:8px;background:#e9ecef;border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:#4fa8d8;transition:width .2s;"></div>
        </div>`;
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
function mostrarCargaBoleta(estado, pct = null) {
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

function ocultarCargaBoleta() {
    const el = document.getElementById('boletaCarga');
    if (el) el.hidden = true;
}

let _tessWorker = null;
let _tessOnProgress = null;

async function getTessWorker() {
    if (_tessWorker) return _tessWorker;
    _tessWorker = await Tesseract.createWorker('spa', 1, {
        logger: m => { if (m.status === 'recognizing text' && _tessOnProgress) _tessOnProgress(m.progress); }
    });
    // PSM 6 = bloque uniforme (mejor para boletas en columna); conserva espacios entre palabras
    await _tessWorker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    return _tessWorker;
}

async function ocrCanvas(canvas, onProgress) {
    const worker = await getTessWorker();
    _tessOnProgress = onProgress || null;
    // { blocks: true } → cajas (bbox) y confianza por palabra (parse espacial por columnas)
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    _tessOnProgress = null;
    return data; // { text, confidence, blocks, ... }
}

// elige orientación con OCR rápido (reducido) en 0/90/180/270 por mayor confianza
async function detectarRotacion(img) {
    let best = { rot: 0, conf: -1 };
    for (const rot of [0, 90, 180, 270]) {
        try {
            const data = await ocrCanvas(prepararCanvas(img, rot, 1000, true));
            if (data.confidence > best.conf) best = { rot, conf: data.confidence };
        } catch (e) { /* ignora rotación fallida */ }
    }
    return best.rot;
}

// inclinación residual fina: prueba pequeños ángulos por mayor confianza (imagen reducida)
async function detectarDeskew(img, rot) {
    let best = { deg: 0, conf: -1 };
    for (const deg of [0, -2, 2, -4, 4]) {
        try {
            const data = await ocrCanvas(prepararCanvas(img, rot, 1000, true, deg));
            if (data.confidence > best.conf) best = { deg, conf: data.confidence };
        } catch (e) { /* ignora */ }
    }
    return best.deg;
}

async function procesarBoleta(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (typeof Tesseract === 'undefined') return toast('No se pudo cargar el lector OCR (revisa tu conexión)', 'error');
    document.getElementById('boletaPreview').innerHTML = '';
    document.getElementById('boletaRotar').style.display = 'none';
    try {
        mostrarCargaBoleta('Abriendo tu boleta…');
        boletaImg = await fileToImage(file);
        mostrarCargaBoleta('Mirando bien la foto…');
        boletaRot = await detectarRotacion(boletaImg);
        mostrarCargaBoleta('Enderezando la boleta…');
        boletaDeskew = await detectarDeskew(boletaImg, boletaRot);
        await leerBoleta();
        ocultarCargaBoleta();
    } catch (e) {
        console.error('Boleta OCR error:', e);
        ocultarCargaBoleta();
        toast('No se pudo leer la boleta', 'error');
    }
}

// OCR completo con la rotación actual → parse → preview
async function leerBoleta() {
    if (!boletaImg) return;
    const canvas = prepararCanvas(boletaImg, boletaRot, 2400, true, boletaDeskew);
    mostrarCargaBoleta('Leyendo los productos…', 0);
    const data = await ocrCanvas(canvas, p => mostrarCargaBoleta('Leyendo los productos…', p));
    document.getElementById('boletaRotar').style.display = 'inline-block';
    // depuración temporal
    window.__ocrText = data.text; window.__ocrBlocks = data.blocks;
    // parse espacial por columnas (bbox); si no hay cajas, fallback al parse de texto plano
    const filas = filasDesdeBlocks(data.blocks);
    boletaParsed = filas.length ? parseBoletaWords(filas) : parseBoleta(data.text);
    boletaTotal = detectarTotal(data.text);
    boletaFuente = 'ocr';
    // híbrido: si Tesseract no cuadra, la llama afina con visión IA (Gemini)
    if (boletaNecesitaIA()) {
        try {
            mostrarCargaBoleta('La llama afina con su súper vista…');
            const ia = await extraerBoletaIA();
            if (ia.items.length) {
                boletaParsed = ia.items;
                if (ia.total) boletaTotal = ia.total;
                boletaFuente = 'ia';
            }
        } catch (e) {
            console.error('IA boleta error:', e);
            if (!_iaAvisoMostrado) {
                _iaAvisoMostrado = true;
                toast('La IA no está disponible (actívala en Firebase). Sigo con la lectura básica.', 'error');
            }
        }
    }
    renderBoletaPreview();
}

function rotarBoleta() {
    if (!boletaImg) return;
    boletaRot = (boletaRot + 90) % 360;
    boletaDeskew = 0; // el usuario corrige a mano la orientación gruesa
    document.getElementById('boletaPreview').innerHTML = '';
    leerBoleta()
        .then(ocultarCargaBoleta)
        .catch(e => { console.error(e); ocultarCargaBoleta(); toast('Error al releer', 'error'); });
}

// valida dígito verificador EAN-13 (descarta lecturas OCR erróneas)
function validarEAN(code) {
    if (!/^\d{13}$/.test(code)) return code && code.length === 12; // UPC-12: acepta sin validar
    const dig = code.split('').map(Number);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += dig[i] * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    return check === dig[12];
}

// confusiones típicas de OCR entre dígitos (bidireccional)
const OCR_DIGIT_CONF = { '0':['8','6','9'], '8':['0','6','3'], '6':['8','5','0'], '5':['6','9','2'], '9':['0','5'], '1':['7'], '7':['1','2'], '3':['8'], '2':['7','5'] };

// si el EAN no valida el dígito verificador, intenta corregir UN dígito por sus confusiones de OCR.
// devuelve { ean, matchInsumo } — prioriza el candidato que ya esté ligado a un insumo (recupera el indexado).
function corregirEAN(ean) {
    if (!ean || !/^\d{12,13}$/.test(ean)) return null;
    let validoSinMatch = null;
    for (let i = 0; i < ean.length; i++) {
        const alts = OCR_DIGIT_CONF[ean[i]];
        if (!alts) continue;
        for (const a of alts) {
            const cand = ean.slice(0, i) + a + ean.slice(i + 1);
            if (!validarEAN(cand)) continue;
            const ins = insumoPorBarras(cand);
            if (ins) return { ean: cand, insumo: ins };   // mejor caso: calza con insumo conocido
            if (!validoSinMatch) validoSinMatch = cand;   // respaldo: válido pero sin match
        }
    }
    return validoSinMatch ? { ean: validoSinMatch, insumo: null } : null;
}

// resuelve el match de un ítem a partir de su EAN crudo y nombre.
// devuelve { ean, eanOk, eanCorregido, insumoId, matchSource }
function resolverMatch(eanRaw, nombre) {
    let ean = eanRaw, eanCorregido = false;
    let eanOk = ean ? validarEAN(ean) : false;
    let insumo = eanOk ? insumoPorBarras(ean) : null;
    // EAN no válido → intentar corrección por confusión OCR
    if (ean && !eanOk) {
        const fix = corregirEAN(ean);
        if (fix) { ean = fix.ean; eanOk = true; eanCorregido = true; insumo = fix.insumo; }
    }
    let matchSource = insumo ? 'ean' : null;
    if (!insumo && nombre) { insumo = matchInsumo(nombre); if (insumo) matchSource = 'nombre'; }
    return { ean, eanOk, eanCorregido, insumoId: insumo ? insumo.id : null, matchSource };
}

// número chileno → entero (6.790 → 6790, -1.800 → -1800)
function parseMontoCL(s) {
    const neg = /-/.test(s);
    const n = parseInt(s.replace(/[^\d]/g, ''), 10);
    if (isNaN(n)) return null;
    return neg ? -n : n;
}

const BOLETA_IGNORAR  = /\b(rut|boleta|electronica|sii|cencosud|retail|s\.?a\.?|avenida|avda|av|kennedy|alcalde|infante|condes|poniente|direccion|metropolitana|maipu|sub\s*total|neto|iva|descuentos?|total|debito|credito|vuelto|puntos|nombre|saldo|esta\s+compra|revisa|www|condiciones|terminos|acumul)\b/i;
// ruido de footer/totales que el OCR pega a otras palabras (sin word-boundary): captura
// "NESCUENTOS" (DESCUENTOS mal leído), "puntoscencostd", URLs de puntos, etc.
const BOLETA_IGNORAR2 = /escuent|cencos|puntos|w{2,}\.|\.c[lo]\b|sub\s*total|t\.?\s*debito|vuelto|kennedy|alcalde|infante/i;
const BOLETA_DESCUENTO = /(ofertas?|imbatible|descuento|promo|dcto)/i;
const esLineaIgnorada = l => BOLETA_IGNORAR.test(l) || BOLETA_IGNORAR2.test(l);

// cantidad + unidad desde la descripción (750GR, 1KG, 12 UN…)
function cantidadUnidadDesc(desc) {
    const n = quitarAcentos(desc.toLowerCase());
    let m;
    if ((m = n.match(/(\d+(?:[.,]\d+)?)\s*kg\b/)))         return { cantidad: parseFloat(m[1].replace(',', '.')), unidad: 'kg' };
    if ((m = n.match(/(\d+(?:[.,]\d+)?)\s*(?:gr|g)\b/)))   return { cantidad: parseFloat(m[1].replace(',', '.')), unidad: 'g' };
    if ((m = n.match(/(\d+(?:[.,]\d+)?)\s*ml\b/)))         return { cantidad: parseFloat(m[1].replace(',', '.')), unidad: 'ml' };
    if ((m = n.match(/(\d+(?:[.,]\d+)?)\s*l\b/)))          return { cantidad: parseFloat(m[1].replace(',', '.')), unidad: 'l' };
    if ((m = n.match(/(\d+)\s*(?:un|u|uds?|unidades?)\b/))) return { cantidad: parseInt(m[1]), unidad: 'unidad' };
    return { cantidad: 1, unidad: 'unidad' };
}

function limpiarNombreBoleta(desc) {
    return desc
        .replace(/\b\d+\s*(kg|gr|g|ml|l|un|u|uds?|unidades?)\b/gi, ' ') // tokens de tamaño
        .replace(/\b\d{1,6}\b/g, ' ')   // números sueltos restantes (incl. dígitos de miles partidos)
        .replace(/[^\wáéíóúñÁÉÍÓÚÑ\s./%-]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function aplicarDescuento(items, linea) {
    const md = linea.match(/-\s*\d{1,3}(?:[.,\s]\s*\d{3})*/);
    if (md && items.length) {
        const desc = Math.abs(parseMontoCL(md[0]));
        const it = items[items.length - 1];
        it.precio = Math.max(0, it.precio - desc);
        it.descuento = (it.descuento || 0) + desc;
    }
}

function parseBoleta(texto) {
    const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
    const items = [];
    for (const linea of lineas) {
        // descuentos (aplican al último ítem)
        if (BOLETA_DESCUENTO.test(linea)) { aplicarDescuento(items, linea); continue; }
        if (esLineaIgnorada(linea)) continue;
        // línea de precio por peso ("0,424 KG X $1.990") → no es un ítem propio
        if (/\bkg\s*x\b|\bx\s*\$/i.test(linea)) continue;

        const eanM = linea.match(/\b(\d{12,13})\b/);
        const ean = eanM ? eanM[1] : null;

        // antes se exigía EAN: si el OCR manchaba 1 dígito del código perdíamos el
        // ítem completo. Ahora aceptamos líneas sin EAN, pero con guardas para no
        // colar totales/basura (BOLETA_IGNORAR ya filtró total/subtotal/iva/etc.):
        //   - debe tener letras (un nombre de producto, no solo números)
        //   - quedan marcadas "nuevo" para revisión manual.
        if (!ean && !/[a-záéíóúñ]{3,}/i.test(linea)) continue;

        // candidatos a precio: montos con miles (6.790 / 6 790 / 6, 757) o enteros 3-6 dígitos (844)
        const precios = linea.match(/-?\d{1,3}(?:[.,\s]\s*\d{3})+|\b\d{3,6}\b/g);
        if (!precios) continue;
        let precio = null;
        for (let i = precios.length - 1; i >= 0; i--) {
            if (ean && precios[i].replace(/[^\d]/g, '') === ean) continue;
            const v = parseMontoCL(precios[i]);
            if (v && v > 0 && v < 1000000) { precio = v; break; }
        }
        if (precio == null) continue;

        // descripción: quitar EAN y montos con miles; extraer cantidad/unidad ANTES de limpiar
        let desc = linea;
        if (ean) desc = desc.replace(ean, ' ');
        desc = desc.replace(/-?\d{1,3}(?:[.,\s]\s*\d{3})+/g, ' ');
        const { cantidad, unidad } = cantidadUnidadDesc(desc);
        const nombre = limpiarNombreBoleta(desc);
        if (nombre.length < 2) continue;

        // match: EAN válido/corregido primero (indexador), luego nombre
        const m = resolverMatch(ean, nombre);
        items.push({ ...m, nombreRaw: nombre, cantidad, unidad, precio, descuento: 0, fecha: hoyISO(), conf: null });
    }
    return items;
}

// ── Parse espacial por columnas (usa cajas/bbox de Tesseract) ──────────
// aplana blocks→...→words y agrupa en filas por solapamiento vertical
function filasDesdeBlocks(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return [];
    const words = [];
    const walk = node => {
        if (!node) return;
        if (Array.isArray(node.words)) for (const w of node.words) {
            const t = (w.text || '').trim();
            if (t && w.bbox) words.push({ text: t, conf: w.confidence ?? 0, bbox: w.bbox });
        }
        for (const key of ['blocks', 'paragraphs', 'lines', 'children']) {
            if (Array.isArray(node[key])) for (const c of node[key]) walk(c);
        }
    };
    for (const b of blocks) walk(b);
    if (!words.length) return [];

    // altura mediana de palabra → tolerancia de fila
    const alturas = words.map(w => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
    const hMed = alturas[alturas.length >> 1] || 12;
    const tol = hMed * 0.6;

    words.sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1));
    const filas = [];
    for (const w of words) {
        const cy = (w.bbox.y0 + w.bbox.y1) / 2;
        let fila = filas.find(f => Math.abs(f.cy - cy) <= tol);
        if (!fila) { fila = { cy, words: [] }; filas.push(fila); }
        fila.words.push(w);
        // centro-y promedio ponderado para estabilizar la agrupación
        fila.cy = fila.words.reduce((s, x) => s + (x.bbox.y0 + x.bbox.y1) / 2, 0) / fila.words.length;
    }
    for (const f of filas) f.words.sort((a, b) => a.bbox.x0 - b.bbox.x0); // izquierda→derecha
    return filas;
}

function parseBoletaWords(filas) {
    const items = [];
    for (const fila of filas) {
        const linea = fila.words.map(w => w.text).join(' ');
        if (BOLETA_DESCUENTO.test(linea)) { aplicarDescuento(items, linea); continue; }
        if (esLineaIgnorada(linea)) continue;
        if (/\bkg\s*x\b|\bx\s*\$/i.test(linea)) continue;

        // EAN: token (o tokens contiguos) de 12-13 dígitos
        const eanM = linea.match(/\b(\d{12,13})\b/);
        const ean = eanM ? eanM[1] : null;
        if (!ean && !/[a-záéíóúñ]{3,}/i.test(linea)) continue;

        // precio: el clúster numérico más a la derecha que sea monto plausible y no el EAN.
        // recorre las words de derecha a izquierda buscando tokens numéricos.
        let precio = null, precioX = Infinity;
        for (let i = fila.words.length - 1; i >= 0; i--) {
            const t = fila.words[i].text;
            if (!/\d/.test(t)) continue;
            const soloNum = t.replace(/[^\d]/g, '');
            if (ean && soloNum === ean) continue;
            if (!/^-?\$?\d{1,3}(?:[.,\s]?\d{3})*$|^-?\$?\d{3,6}$/.test(t)) continue;
            const v = parseMontoCL(t);
            if (v && v > 0 && v < 1000000) { precio = v; precioX = fila.words[i].bbox.x0; break; }
        }
        // respaldo: regex sobre la línea aplanada (por si el precio quedó partido en 2 words)
        if (precio == null) {
            const precios = linea.match(/-?\d{1,3}(?:[.,\s]\s*\d{3})+|\b\d{3,6}\b/g);
            if (precios) for (let i = precios.length - 1; i >= 0; i--) {
                if (ean && precios[i].replace(/[^\d]/g, '') === ean) continue;
                const v = parseMontoCL(precios[i]);
                if (v && v > 0 && v < 1000000) { precio = v; break; }
            }
        }
        if (precio == null) continue;

        // nombre: tokens de texto (con letras) a la izquierda del precio, sin el EAN
        const nombreTokens = fila.words
            .filter(w => w.bbox.x0 < precioX && w.text.replace(/[^\d]/g, '') !== ean)
            .map(w => w.text).join(' ');
        let desc = nombreTokens || linea;
        if (ean) desc = desc.replace(ean, ' ');
        desc = desc.replace(/-?\d{1,3}(?:[.,\s]\s*\d{3})+/g, ' ');
        const { cantidad, unidad } = cantidadUnidadDesc(desc);
        const nombre = limpiarNombreBoleta(desc);
        if (nombre.length < 2) continue;

        const conf = Math.round(fila.words.reduce((s, w) => s + w.conf, 0) / fila.words.length);
        const m = resolverMatch(ean, nombre);
        items.push({ ...m, nombreRaw: nombre, cantidad, unidad, precio, descuento: 0, fecha: hoyISO(), conf });
    }
    return items;
}

// lee el TOTAL impreso (no SUB TOTAL) para cuadrar contra la suma de ítems
function detectarTotal(texto) {
    const lineas = texto.split('\n');
    let total = null;
    for (const l of lineas) {
        if (!/\btotal\b/i.test(l)) continue;
        if (/sub\s*total/i.test(l)) continue;
        const montos = l.match(/\d{1,3}(?:[.,\s]\s*\d{3})+|\b\d{3,6}\b/g);
        if (montos) { const v = parseMontoCL(montos[montos.length - 1]); if (v && v > 0) total = v; }
    }
    return total;
}

// ── Respaldo de IA (híbrido): si Tesseract no cuadra, la llama "afina" con visión ──
let _geminiModel = null;
let _aiAppCheck = null;
async function getGemini() {
    if (_geminiModel) {
        // asegura token App Check fresco antes de cada uso (necesario con enforcement de AI Logic)
        if (_aiAppCheck) { try { await getAiAppCheckToken(_aiAppCheck); } catch (e) { console.warn('App Check IA:', e); } }
        return _geminiModel;
    }
    const aiApp = initAiApp(firebaseConfig, 'llama-ai');           // instancia separada (no choca con la v10)
    _aiAppCheck = initAiAppCheck(aiApp, {                           // App Check también en la instancia de IA
        provider: new ReCaptchaV3ProviderAi(APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true
    });
    try { await getAiAppCheckToken(_aiAppCheck); } catch (e) { console.warn('App Check IA:', e); } // espera el token
    const ai = getAI(aiApp, { backend: new GoogleAIBackend() });   // Gemini Developer API (capa gratis)
    const schema = Schema.object({ properties: {
        productos: Schema.array({ items: Schema.object({
            properties: {
                nombre:   Schema.string(),
                ean:      Schema.string(),
                cantidad: Schema.number(),
                unidad:   Schema.string(),
                precio:   Schema.number()
            },
            optionalProperties: ['ean']
        }) }),
        total: Schema.number()
    }, optionalProperties: ['total'] });
    _geminiModel = getGenerativeModel(ai, {
        model: 'gemini-2.5-flash',
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema }
    });
    return _geminiModel;
}

// JPEG base64 de la boleta (color, enderezada, sin binarizar) para la IA de visión
function boletaParaIA(maxLado = 1500) {
    const img = boletaImg;
    const rot = boletaRot, extra = boletaDeskew;
    const swap = (rot === 90 || rot === 270);
    const w = img.naturalWidth, h = img.naturalHeight;
    const baseW = swap ? h : w, baseH = swap ? w : h;
    const scale = Math.min(1, maxLado / Math.max(baseW, baseH));
    const cw = Math.round(baseW * scale), ch = Math.round(baseH * scale);
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((rot + extra) * Math.PI / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -w / 2, -h / 2);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1]; // sin el prefijo data:
}

const UNIDAD_IA = { g:'g', gr:'g', gramo:'g', gramos:'g', kg:'kg', kilo:'kg', kilos:'kg', ml:'ml', cc:'ml', l:'l', lt:'l', litro:'l', litros:'l', un:'unidad', u:'unidad', unidad:'unidad', unidades:'unidad' };
function normUnidad(u) {
    const k = quitarAcentos(String(u || '').toLowerCase().trim());
    return UNIDAD_IA[k] || 'unidad';
}

const PROMPT_BOLETA_IA = `Eres un extractor de boletas de supermercado chilenas. Mira la foto y devuelve SOLO los productos comprados.
Reglas:
- NO incluyas totales, subtotales, IVA, neto, descuentos resumidos, dirección, RUT ni puntos.
- Precios en pesos chilenos como ENTEROS (el punto separa miles, no hay decimales): "1.290" = 1290.
- Para cada producto da el precio FINAL pagado de esa línea: si justo debajo hay un descuento ("SANTAS OFERTAS", "CARRO IMBATIBLE", etc.) réstalo del precio bruto.
- Incluye el código de barras (ean) si está impreso en la línea; si no, déjalo vacío.
- cantidad y unidad: "750GR" → cantidad 750, unidad "g"; "1KG" → 1, "kg"; "12 UN" → 12, "unidad"; si no se ve, cantidad 1, unidad "unidad". Unidades válidas: g, kg, ml, l, unidad.
- Devuelve además "total" = el TOTAL impreso de la boleta (entero).`;

async function extraerBoletaIA() {
    const model = await getGemini();
    const data = boletaParaIA();
    const result = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data } },
        PROMPT_BOLETA_IA
    ]);
    const obj = JSON.parse(result.response.text());
    const productos = Array.isArray(obj.productos) ? obj.productos : [];
    const items = productos.map(p => {
        const ean = p.ean ? String(p.ean).replace(/\D/g, '') : null;
        const nombre = String(p.nombre || '').trim();
        const m = resolverMatch(ean && ean.length >= 12 ? ean : null, nombre);
        return {
            ...m,
            nombreRaw: nombre,
            cantidad: Number(p.cantidad) > 0 ? Number(p.cantidad) : 1,
            unidad: normUnidad(p.unidad),
            precio: Math.round(Number(p.precio)) || 0,
            descuento: 0, fecha: hoyISO(), conf: 99, fuente: 'ia'
        };
    }).filter(it => it.nombreRaw.length >= 2);
    return { items, total: Number(obj.total) > 0 ? Math.round(Number(obj.total)) : null };
}

// ¿el resultado de Tesseract amerita afinar con IA? (no cuadra, baja confianza o vacío)
function boletaNecesitaIA() {
    if (!boletaParsed.length) return true;
    const suma = boletaParsed.reduce((s, r) => s + (Number(r.precio) || 0), 0);
    if (boletaTotal && Math.abs(boletaTotal - suma) > 50) return true;      // no cuadra con el total
    if (boletaParsed.some(r => r.precio <= 0)) return true;                  // precio no leído
    const bajas = boletaParsed.filter(r => r.conf != null && r.conf < 70).length;
    if (bajas >= 2) return true;                                            // varias filas dudosas
    return false;
}

function badgeMatchBoleta(r) {
    const chip = (bg, txt) => `<span style="background:${bg};color:#fff;font-size:10px;padding:3px 7px;border-radius:8px;white-space:nowrap;">${txt}</span>`;
    if (r.matchSource === 'ean')    return chip('#37b24d', r.eanCorregido ? '✓ código ✎' : '✓ código');
    if (r.matchSource === 'nombre') return chip('#f59f00', 'por nombre');
    return chip('#adb5bd', 'nuevo');
}

// banda de cuadre: compara la suma de ítems con el TOTAL impreso en la boleta
function cuadreBoletaHtml(suma) {
    if (!boletaTotal) return '';
    const dif = boletaTotal - suma;
    const cuadra = Math.abs(dif) <= 50; // tolerancia de redondeo
    const cur = esc(currency);
    if (cuadra) {
        return `<div style="font-size:12.5px;color:#2b8a3e;background:#ebfbee;border:1px solid #b2f2bb;border-radius:8px;padding:7px 10px;margin-bottom:12px;">✓ Cuadra con el total de la boleta (${cur}${boletaTotal.toLocaleString('es-CL')})</div>`;
    }
    const signo = dif > 0 ? 'faltan' : 'sobran';
    return `<div style="font-size:12.5px;color:#a26312;background:#fff9db;border:1px solid #ffe066;border-radius:8px;padding:7px 10px;margin-bottom:12px;">⚠ No cuadra con la boleta: total impreso ${cur}${boletaTotal.toLocaleString('es-CL')}, suma actual ${cur}${suma.toLocaleString('es-CL')} (${signo} ${cur}${Math.abs(dif).toLocaleString('es-CL')}). Revisa los precios en ámbar.</div>`;
}

function renderBoletaPreview() {
    const el = document.getElementById('boletaPreview');
    if (!boletaParsed.length) {
        el.innerHTML = '<p style="color:#dc3545;font-size:13px;">No se detectaron productos. Prueba "🔄 Rotar 90°" o sube una foto más nítida y plana.</p>';
        return;
    }
    const total = boletaParsed.reduce((s, r) => s + (parseFloat(r.precio) || 0), 0);
    const cuadre = cuadreBoletaHtml(total);
    const fuenteHtml = boletaFuente === 'ia'
        ? `<div style="font-size:12px;color:#5f3dc4;background:#f3f0ff;border:1px solid #d0bfff;border-radius:8px;padding:6px 10px;margin-bottom:10px;display:inline-block;">✨ Afinado por la llama IA (la lectura básica no cuadraba)</div>`
        : '';
    el.innerHTML =
        `<div style="font-size:13px;color:#495057;margin-bottom:10px;">🧾 <strong>${boletaParsed.length}</strong> productos detectados · total ${esc(currency)}${total.toLocaleString('es-CL')} — revisa, corrige y registra:</div>
         ${fuenteHtml}
         ${cuadre}
         <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
            <label style="font-size:13px;color:#6c757d;">Fecha de compra</label>
            <input type="date" id="boletaFecha" value="${boletaParsed[0] ? boletaParsed[0].fecha : hoyISO()}" onchange="boletaFechaTodos(this.value)" style="padding:6px 10px;border:2px solid #e9ecef;border-radius:8px;">
         </div>` +
        boletaParsed.map((r, i) => {
            const pBorde = r.precio <= 0 ? '#dc3545' : (r.conf != null && r.conf < 70 ? '#f59f00' : '#e9ecef');
            const pTitle = r.precio <= 0 ? '⚠ No se leyó bien el precio — corrígelo' : (r.conf != null && r.conf < 70 ? '⚠ Lectura de baja confianza — verifica el precio' : 'Precio total pagado');
            return `
        <div class="boleta-item">
            <div class="bi-head">
                <span class="bi-badge" title="${r.ean || 'sin código de barras'}">${badgeMatchBoleta(r)}</span>
                <input class="bi-nombre" type="text" value="${esc(r.nombreRaw || '')}" oninput="boletaEdit(${i},'nombreRaw',this.value)" onchange="boletaRematch(${i})" placeholder="Producto">
                <button class="bi-del" onclick="boletaQuitar(${i})" title="Quitar producto">✕</button>
            </div>
            <div class="bi-grid">
                <label class="bi-f">Cantidad
                    <input type="number" value="${r.cantidad}" step="0.001" inputmode="decimal" oninput="boletaEdit(${i},'cantidad',this.value)">
                </label>
                <label class="bi-f">Unidad
                    <select onchange="boletaEdit(${i},'unidad',this.value)">
                        ${['g', 'kg', 'ml', 'l', 'unidad'].map(u => `<option value="${u}" ${u === r.unidad ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>
                </label>
                <label class="bi-f">Precio total
                    <input type="number" value="${r.precio}" step="1" inputmode="numeric" title="${pTitle}" style="border-color:${pBorde};" oninput="boletaEdit(${i},'precio',this.value)">
                </label>
            </div>
            <label class="bi-f bi-insumo">¿Qué insumo es?
                <select onchange="boletaEdit(${i},'insumoId',this.value)">
                    <option value="__new__" ${!r.insumoId ? 'selected' : ''}>➕ Crear "${esc(r.nombreRaw)}"</option>
                    ${insumos.map(ins => `<option value="${ins.id}" ${ins.id === r.insumoId ? 'selected' : ''}>${esc(ins.nombre)}</option>`).join('')}
                </select>
            </label>
        </div>`;
        }).join('') +
        `<p style="font-size:11px;color:#adb5bd;margin:8px 0;">Los productos nuevos se crean con su código de barras (EAN); los existentes quedan ligados a ese EAN para reconocerse solos en la próxima boleta.</p>
         <button class="btn btn-success" style="margin-top:6px;" onclick="aplicarBoleta()">✓ Registrar ${boletaParsed.length} compras</button>`;
}

function boletaFechaTodos(v) { boletaParsed.forEach(r => r.fecha = v); }

function boletaEdit(i, campo, valor) {
    if (campo === 'cantidad' || campo === 'precio') boletaParsed[i][campo] = parseFloat(valor) || 0;
    else if (campo === 'insumoId') boletaParsed[i].insumoId = (valor === '__new__') ? null : valor;
    else boletaParsed[i][campo] = valor;
}

function boletaRematch(i) {
    const r = boletaParsed[i];
    const m = resolverMatch(r.ean, (r.nombreRaw || '').trim());
    Object.assign(r, m); // ean, eanOk, eanCorregido, insumoId, matchSource
    renderBoletaPreview();
}

function boletaQuitar(i) { boletaParsed.splice(i, 1); renderBoletaPreview(); }

async function aplicarBoleta() {
    if (!boletaParsed.length) return;
    if (!(await confirmar(`¿Registrar ${boletaParsed.length} compras de la boleta?`))) return;
    const nuevos = {}; // clave (ean|nombre) → id, evita duplicar creaciones
    let ok = 0;
    for (const r of boletaParsed) {
        if (!r.cantidad || !r.precio) continue;
        const eanUse = (r.ean && r.eanOk) ? r.ean : null; // solo EAN válidos
        let insumoId = r.insumoId;
        if (!insumoId) {
            const clave = (eanUse || r.nombreRaw.toLowerCase());
            if (nuevos[clave]) insumoId = nuevos[clave];
            else {
                const codigo = sugerirCodigo(r.nombreRaw);
                const datos = { codigo, nombre: r.nombreRaw, codigosBarras: eanUse ? [eanUse] : [], precio: null, unidadBase: null, fechaCreacion: new Date().toISOString() };
                const ref = await addDoc(collection(db, 'insumos'), datos);
                insumos.push({ id: ref.id, ...datos });
                insumoId = ref.id;
                nuevos[clave] = insumoId;
            }
        } else if (eanUse) {
            // auto-indexar: ligar EAN válido al insumo existente si aún no lo tiene
            const ins = insumos.find(x => x.id === insumoId);
            if (ins && !(ins.codigosBarras || []).includes(eanUse) && !barrasDuplicado(eanUse, insumoId)) {
                const nb = [...(ins.codigosBarras || []), eanUse];
                await updateDoc(doc(db, 'insumos', insumoId), { codigosBarras: nb });
                ins.codigosBarras = nb;
            }
        }
        await registrarCompraCore(insumoId, r.cantidad, r.unidad, r.precio, r.fecha || hoyISO());
        ok++;
    }
    boletaParsed = [];
    boletaImg = null; boletaRot = 0; boletaDeskew = 0; boletaTotal = null; boletaFuente = 'ocr';
    document.getElementById('boletaPreview').innerHTML = '';
    document.getElementById('boletaProgress').innerHTML = '';
    document.getElementById('boletaRotar').style.display = 'none';
    const fi = document.getElementById('boletaFile'); if (fi) fi.value = '';
    renderCompras(); renderInsumos(); renderBarras(); actualizarSelects(); actualizarContadores(); calcularPrecio(); renderRecetas();
    toast(`${ok} compras registradas desde la boleta`);
}

// ── Recetas ───────────────────────────────────────────────────
// icono de repostería fiel al tipo de receta. Devuelve el SLUG de un SVG en
// img/icons/ (set fluent-emoji-flat de Iconify, descargado offline por
// tools/fetch_icons.sh). Orden = de lo más específico a lo genérico; el primero
// que matchea gana, así el tipo estructural pesa más que el sabor (chocolate).
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
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:14px;">
                <div class="receta-emoji" title="${esc(r.nombre)}"><img src="img/icons/${iconReceta(r.nombre)}.svg" alt="" loading="lazy" onerror="this.style.display='none'"></div>
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

    // completa el login por redirect (cuando corre instalada); onAuthStateChanged hace el resto
    getRedirectResult(auth).catch(err => {
        if (err && err.code !== 'auth/no-auth-event') toast('Error al iniciar sesión: ' + err.message, 'error');
    });

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
            // espera el token de App Check antes de leer Firestore (evita la carrera de arranque
            // que dejaría las primeras solicitudes sin verificar bajo enforcement)
            try { await getAppCheckToken(appCheck); } catch (e) { console.warn('App Check token aún no listo:', e); }
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
window.insumosTab          = insumosTab;
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
window.rotarBoleta         = rotarBoleta;
window.boletaEdit          = boletaEdit;
window.boletaRematch       = boletaRematch;
window.boletaQuitar        = boletaQuitar;
window.boletaFechaTodos    = boletaFechaTodos;
window.aplicarBoleta       = aplicarBoleta;
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