// La llama mascota: globos de diálogo reusables para empty states, avisos y saludos.
import { esc } from '../util.js';

// bloque de llama con globo de diálogo. opts.cta = { texto, onclick } (onclick = string inline)
export function llamaHtml(mensaje, opts = {}) {
    const cta = opts.cta ? `<button class="es-cta" onclick="${opts.cta.onclick}">${opts.cta.texto}</button>` : '';
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
