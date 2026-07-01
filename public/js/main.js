// Punto de entrada: init de Firebase (primero, por App Check), auth, carga inicial y
// exports a window para los onclick inline de index.html.
import {
    db, auth, appCheck, googleProvider, getAppCheckToken,
    collection, getDocs,
    signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut
} from './firebase.js';
import { state } from './state.js';
import { toast } from './util.js';
import { openSection, goBack } from './nav.js';
import { renderAll } from './render.js';
import {
    normalizarInsumo, agregarInsumo, insumosTab, autoCodigo, eliminarInsumo,
    toggleBarras, lookupBarras, ligarBarras, eliminarBarras,
    iniciarEdicion, cancelarEdicion, guardarEdicion,
    filtrarSugeridos, mostrarSugeridos, seleccionarSugerido, renderInsumos
} from './insumos.js';
import { agregarCompra, eliminarCompra } from './compras.js';
import {
    agregarIngrediente, actualizarUnidadIngrediente, eliminarIngredienteTemp,
    guardarReceta, eliminarReceta, iniciarEdicionReceta, cancelarEdicionReceta,
    editActualizarUnidad, editAgregarIngrediente, editQuitarIngrediente, guardarEdicionReceta,
    toggleImport, interpretarReceta, limpiarImport, importEdit, importRematch, importQuitar, aplicarImport
} from './recetas.js';
import { calcularPrecio, abrirRecetaEnCalc, guardarCostosReceta } from './calculadora.js';
import { guardarConfig, cargarConfigEnUI } from './config.js';
import { procesarBoleta, rotarBoleta } from './boleta/index.js';
import { boletaEdit, boletaRematch, boletaQuitar, boletaFechaTodos, aplicarBoleta, boletaSel, boletaQuitarSel, boletaResaltar } from './boleta/preview.js';

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
    signOut(auth).then(() => { state.insumos = []; state.compras = []; state.recetas = []; });
}

// ── Firestore: carga inicial ──────────────────────────────────
async function cargarTodo() {
    const [si, sc, sr] = await Promise.all([
        getDocs(collection(db, 'insumos')),
        getDocs(collection(db, 'compras')),
        getDocs(collection(db, 'recetas'))
    ]);
    state.insumos = si.docs.map(d => normalizarInsumo({ id: d.id, ...d.data() }));
    state.compras = sc.docs.map(d => ({ id: d.id, ...d.data() }));
    state.recetas = sr.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
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
            // saludo con nombre en el header
            const saludo = document.getElementById('headerSaludo');
            const primerNombre = (user.displayName || '').split(' ')[0];
            if (saludo && primerNombre) saludo.textContent = `¡Hola, ${primerNombre}! Controla tus costos y maximiza tus ganancias 🦙`;
            // espera el token de App Check antes de leer Firestore (evita la carrera de arranque
            // que dejaría las primeras solicitudes sin verificar bajo enforcement)
            try { await getAppCheckToken(appCheck); } catch (e) { console.warn('App Check token aún no listo:', e); }
            cargarTodo();
        } else {
            loginScreen.style.display = 'flex';
            appRoot.style.display     = 'none';
            userInfo.style.display    = 'none';
            state.insumos = []; state.compras = []; state.recetas = [];
        }
    });
});

// ── Window exports ────────────────────────────────────────────
window.openSection         = openSection;
window.goBack              = goBack;
window.agregarInsumo       = agregarInsumo;
window.renderInsumos       = renderInsumos; // filtro de insumos (oninput) — faltaba en la versión anterior
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
window.boletaSel           = boletaSel;
window.boletaQuitarSel     = boletaQuitarSel;
window.boletaResaltar      = boletaResaltar;
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
