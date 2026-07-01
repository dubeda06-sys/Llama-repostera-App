// Estado local compartido. Un solo objeto mutable: los módulos leen/escriben state.insumos etc.
const DEFAULT_SETTINGS = { moneda: '$', tarifaHora: 0, empaqueDefault: 0, indirectosDefault: 0, mermaDefault: 0, margenDefault: 50 };

export function getSettings() {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS }; // entorno de test (node)
    let s = {};
    try { s = JSON.parse(localStorage.getItem('settings')) || {}; } catch (e) { s = {}; }
    // migrar la moneda vieja si existe
    if (s.moneda == null && localStorage.getItem('currency')) s.moneda = localStorage.getItem('currency');
    return { ...DEFAULT_SETTINGS, ...s };
}

const settings = getSettings();

export const state = {
    insumos: [],
    compras: [],
    recetas: [],
    ingredientesTemp: [],
    editandoRecetaId: null,
    editIngredientes: [],
    settings,
    currency: settings.moneda
};
