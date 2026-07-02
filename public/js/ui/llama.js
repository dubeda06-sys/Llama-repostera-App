// La llama mascota: globos de diálogo reusables para empty states, avisos y saludos.
import { esc } from '../util.js';

// bloque de llama con globo de diálogo. opts.cta = { texto, onclick } (onclick = string inline, mensaje/texto = HTML literal del código, nunca datos de usuario)
export function llamaHtml(mensaje, opts = {}) {
    const cta = opts.cta ? `<button class="es-cta" onclick="${esc(opts.cta.onclick)}">${esc(opts.cta.texto)}</button>` : '';
    return `<div class="llama-empty">
        <div class="le-bubble">${mensaje}</div>
        <img class="le-img" src="img/anim/loader/llama.png" alt="La llama repostera">
        ${cta}
    </div>`;
}

// chispitas CSS-only para celebraciones (ocultas bajo prefers-reduced-motion)
export function chispitasHtml() {
    let s = '';
    for (let i = 0; i < 12; i++) s += `<span class="chispa chispa-${i}"></span>`;
    return `<span class="chispas" aria-hidden="true">${s}</span>`;
}

// ── Hints de primera visita por sección ──────────────────────
const HINTS = {
    insumos:     'Aquí viven tus <strong>ingredientes</strong>. Los que tienen precio lo toman solos de tus compras 💲',
    compras:     'Registra compras a mano o <strong>escanéame la boleta</strong> — yo leo los precios con mi súper vista 📷',
    recetas:     'Arma tus recetas con los insumos y sabrás <strong>cuánto te cuesta</strong> cada una. También puedes pegar la receta en texto y yo la interpreto ✨',
    calculadora: 'Elige una receta y te sugiero el <strong>precio de venta</strong> con tu mano de obra, merma y margen 💰'
};

// muestra un globo de la llama la primera vez que se abre una sección
export function mostrarHint(seccion) {
    const texto = HINTS[seccion];
    if (!texto) return;
    if (localStorage.getItem('hint_' + seccion)) return;
    const cont = document.getElementById(seccion);
    if (!cont || cont.querySelector('.llama-hint')) return;
    const el = document.createElement('div');
    el.className = 'llama-hint';
    el.innerHTML = `
        <img src="img/anim/loader/llama.png" alt="">
        <div class="lh-texto">${texto}</div>
        <button class="lh-ok">¡Entendido!</button>`;
    el.querySelector('.lh-ok').onclick = () => {
        localStorage.setItem('hint_' + seccion, '1');
        el.remove();
    };
    const titulo = cont.querySelector('.section-title');
    if (titulo) titulo.after(el); else cont.prepend(el);
}

// toast de celebración: mini llama + chispitas
export function celebrar(msg) {
    const host = document.getElementById('toastHost');
    const el = document.createElement('div');
    el.className = 'toast toast-celebra';
    el.innerHTML = `${chispitasHtml()}<img class="tc-llama" src="img/anim/loader/llama.png" alt=""> <span>${esc(msg)}</span>`;
    host.appendChild(el);
    setTimeout(() => {
        el.classList.add('toast-out');
        setTimeout(() => el.remove(), 320);
    }, 3800);
}
