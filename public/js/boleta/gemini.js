// IA de visión (Gemini via Firebase AI Logic, instancia v12 separada) para leer boletas.
import { initializeApp as initAiApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-ai.js';
import { initializeAppCheck as initAiAppCheck, ReCaptchaV3Provider as ReCaptchaV3ProviderAi, getToken as getAiAppCheckToken } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app-check.js';
import { firebaseConfig, APP_CHECK_SITE_KEY } from '../firebase.js';
import { hoyISO } from '../util.js';
import { normUnidad } from '../units.js';
import { boletaParaIA } from './imagen.js';
import { resolverMatch } from './ean.js';

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

const PROMPT_BOLETA_IA = `Eres un extractor de boletas de supermercado chilenas (Líder, Jumbo, Santa Isabel, Unimarc, Tottus, almacenes). Mira la foto y devuelve SOLO los productos comprados.
Reglas:
- NO incluyas totales, subtotales, IVA, neto, descuentos resumidos, dirección, RUT ni puntos.
- Precios en pesos chilenos como ENTEROS (el punto separa miles, no hay decimales): "1.290" = 1290.
- Para cada producto da el precio FINAL pagado de esa línea: si justo debajo hay un descuento ("SANTAS OFERTAS", "CARRO IMBATIBLE", "AHORRO", monto negativo, etc.) réstalo del precio bruto.
- Producto pesable: una línea como "0,424 KG X $1.990" NO es un producto propio, es el detalle de peso del producto anterior. En ese caso cantidad = 0.424, unidad = "kg" del producto anterior.
- Multi-compra: "3 X $990" significa cantidad 3 del mismo producto con precio total de la línea.
- Incluye el código de barras (ean) si está impreso en la línea; si no, déjalo vacío. NO lo inventes.
- cantidad y unidad: "750GR" → cantidad 750, unidad "g"; "1KG" → 1, "kg"; "12 UN" → 12, "unidad"; si no se ve, cantidad 1, unidad "unidad". Unidades válidas: g, kg, ml, l, unidad.
- Devuelve además "total" = el TOTAL impreso de la boleta (entero). Si dice "TOTAL A PAGAR" o "MONTO CANCELADO", ese es el total.
- No inventes productos: si una línea no se lee, omítela.`;

const PROMPT_REINTENTO = `
IMPORTANTE: este es un segundo intento porque la primera lectura no cuadró. Revisa DOS VECES cada precio dígito por dígito y verifica que la suma de los productos se acerque al TOTAL impreso.`;

export async function extraerBoletaIA(esReintento = false) {
    const model = await getGemini();
    const data = boletaParaIA();
    const result = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data } },
        PROMPT_BOLETA_IA + (esReintento ? PROMPT_REINTENTO : '')
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

// Validación anti-alucinación del resultado de la IA. No descarta nada: sanea rangos y
// marca ítems sospechosos (r.sospechoso) para resaltarlos en el preview.
// devuelve { items, cuadra }
export function validarResultadoIA(items, total, tolerancia) {
    const limpios = items.filter(r =>
        Number.isFinite(r.precio) && r.precio > 0 && r.precio < 1000000 &&
        Number.isFinite(r.cantidad) && r.cantidad > 0
    );
    // precio fuera de rango vs el resto de la boleta → sospechoso (posible dígito alucinado)
    const precios = limpios.map(r => r.precio).sort((a, b) => a - b);
    const mediana = precios.length ? precios[precios.length >> 1] : 0;
    for (const r of limpios) {
        r.sospechoso = mediana > 0 && r.precio > mediana * 3;
    }
    // filas idénticas repetidas (mismo nombre+ean+precio+cantidad) → sospechosas, no se borran:
    // una compra puede repetir producto legítimamente, pero la IA a veces duplica líneas.
    const vistos = new Map();
    for (const r of limpios) {
        const clave = [r.nombreRaw, r.ean || '', r.precio, r.cantidad].join('|');
        if (vistos.has(clave)) { r.sospechoso = true; vistos.get(clave).sospechoso = true; }
        else vistos.set(clave, r);
    }
    const suma = limpios.reduce((s, r) => s + r.precio, 0);
    const cuadra = total ? Math.abs(total - suma) <= tolerancia : null;
    return { items: limpios, cuadra };
}
