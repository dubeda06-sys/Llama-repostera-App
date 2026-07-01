// Smoke test de los módulos puros (sin DOM ni Firebase): node tools/test-parser.mjs
import { parseMontoCL, quitarAcentos, esc } from '../public/js/util.js';
import { normUnidad, costoUso, unidadesCompatibles, FACTORS } from '../public/js/units.js';

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

if (fallas) { console.error(`\n${fallas} fallas`); process.exit(1); }
console.log('\nTodo OK');
