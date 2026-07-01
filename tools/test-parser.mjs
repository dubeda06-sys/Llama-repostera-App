// Smoke test de los módulos puros (sin DOM ni Firebase): node tools/test-parser.mjs
import { parseMontoCL, quitarAcentos, esc } from '../public/js/util.js';
import { normUnidad, costoUso, unidadesCompatibles, FACTORS } from '../public/js/units.js';
import { similitud, matchInsumo, matchInsumoScored } from '../public/js/match.js';
import { state } from '../public/js/state.js';
import { cuadreTol } from '../public/js/boleta/config.js';

let fallas = 0;
function eq(actual, esperado, msg) {
    const ok = JSON.stringify(actual) === JSON.stringify(esperado);
    if (!ok) { fallas++; console.error(`FALLA ${msg}: esperaba ${JSON.stringify(esperado)}, obtuve ${JSON.stringify(actual)}`); }
    else console.log(`ok  ${msg}`);
}

// parseMontoCL: formato chileno
eq(parseMontoCL('6.790'), 6790, 'parseMontoCL 6.790');
eq(parseMontoCL('-1.800'), -1800, 'parseMontoCL -1.800');
eq(parseMontoCL('$12.345'), 12345, 'parseMontoCL $12.345');
eq(parseMontoCL('abc'), null, 'parseMontoCL basura');

// quitarAcentos
eq(quitarAcentos('AZÚCAR Flor Ñuñoa'), 'azucar flor nunoa', 'quitarAcentos');

// esc
eq(esc(`<b>"x"&'y'</b>`), '&lt;b&gt;&quot;x&quot;&amp;&#x27;y&#x27;&lt;/b&gt;', 'esc XSS');

// normUnidad
eq(normUnidad('GR'), 'g', 'normUnidad GR');
eq(normUnidad('cc'), 'ml', 'normUnidad cc');
eq(normUnidad('Litros'), 'l', 'normUnidad Litros');
eq(normUnidad('???'), 'unidad', 'normUnidad fallback');

// costoUso: insumo a $1200/kg, usar 300 g → $360
eq(costoUso({ precio: 1200, unidadBase: 'kg' }, 300, 'g'), 360, 'costoUso 300g de kg');
eq(costoUso({ precio: 1200, unidadBase: 'kg' }, 1, 'l'), null, 'costoUso unidad incompatible');
eq(costoUso({ precio: null, unidadBase: 'kg' }, 300, 'g'), 0, 'costoUso sin precio');

// unidadesCompatibles
eq(unidadesCompatibles({ unidadBase: 'g' }).sort(), ['g', 'kg'], 'compatibles masa');
eq(unidadesCompatibles({ unidadBase: 'ml' }).sort(), ['l', 'ml'], 'compatibles volumen');
eq(unidadesCompatibles(null).sort(), Object.keys(FACTORS).sort(), 'compatibles sin base');

// match difuso
state.insumos = [
    { id: 'a', nombre: 'Leche' },
    { id: 'b', nombre: 'Harina de Trigo' },
    { id: 'c', nombre: 'Azúcar Blanca' },
    { id: 'd', nombre: 'Mantequilla' },
];
eq(matchInsumo('LECHE ENTERA COLUN 1L')?.id, 'a', 'fuzzy: leche entera → Leche (contención)');
eq(matchInsumo('HARINA TRIGO SELECTA 1KG')?.id, 'b', 'fuzzy: harina trigo → Harina de Trigo');
eq(matchInsumo('AZUCAR GRANULADA IANSA')?.id, 'c', 'fuzzy: azucar sin acento → Azúcar Blanca');
eq(matchInsumo('MANTEQUILA SOPROLE 250G')?.id, 'd', 'fuzzy: typo mantequila → Mantequilla');
eq(matchInsumo('DETERGENTE OMO 3KG'), undefined, 'fuzzy: sin match no inventa');
eq(matchInsumoScored('harina').length >= 1, true, 'scored: devuelve candidatos');

// cuadreTol adaptativa
eq(cuadreTol(5000), 50, 'cuadreTol boleta chica = 50');
eq(cuadreTol(100000), 500, 'cuadreTol 100k = 500 (0,5%)');
eq(cuadreTol(null), 50, 'cuadreTol sin total = 50');

if (fallas) { console.error(`\n${fallas} fallas`); process.exit(1); }
console.log('\nTodo OK');
