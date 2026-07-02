// Utilidades compartidas: escape XSS, toasts, modal de confirmación, helpers de texto/fecha/moneda.

export function esc(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

export function toast(msg, tipo = 'ok') {
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

// modal de confirmación (async) — con focus trap y restauración de foco al cerrar
export function confirmar(msg) {
    return new Promise(resolve => {
        const overlay = document.getElementById('modalOverlay');
        const cancelBtn = document.getElementById('modalCancel');
        const okBtn = document.getElementById('modalConfirm');
        const previoFoco = document.activeElement;
        document.getElementById('modalMsg').textContent = msg;
        overlay.classList.add('open');
        cancelBtn.focus();

        const cerrar = (valor) => {
            overlay.classList.remove('open');
            document.removeEventListener('keydown', onKeydown);
            previoFoco?.focus?.();
            resolve(valor);
        };
        const cancelar = () => cerrar(false);
        const aceptar  = () => cerrar(true);

        const onKeydown = e => {
            if (e.key === 'Escape') { e.preventDefault(); cancelar(); return; }
            if (e.key !== 'Tab') return;
            // cicla el foco entre los 2 únicos botones del modal
            e.preventDefault();
            (document.activeElement === cancelBtn ? okBtn : cancelBtn).focus();
        };

        cancelBtn.onclick = cancelar;
        okBtn.onclick = aceptar;
        overlay.onclick = e => { if (e.target === overlay) cancelar(); };
        document.addEventListener('keydown', onKeydown);
    });
}

export function quitarAcentos(s) { return s.toLowerCase().replace(/[áàäâ]/g,'a').replace(/[éèëê]/g,'e').replace(/[íìïî]/g,'i').replace(/[óòöô]/g,'o').replace(/[úùüû]/g,'u').replace(/ñ/g,'n'); }

export function hoyISO() { return new Date().toISOString().slice(0, 10); }

// número chileno → entero (6.790 → 6790, -1.800 → -1800)
export function parseMontoCL(s) {
    const neg = /-/.test(s);
    const n = parseInt(s.replace(/[^\d]/g, ''), 10);
    if (isNaN(n)) return null;
    return neg ? -n : n;
}

// deshabilita un botón mientras corre una operación async; devuelve fn para restaurar
export function btnLoading(btn, texto = 'Guardando…') {
    if (!btn) return () => {};
    const prev = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span> ${texto}`;
    return () => { btn.disabled = false; btn.innerHTML = prev; };
}

// valida un número finito dentro de rango antes de guardarlo en Firestore
export function numValido(n, { min = 0, max = 1e9 } = {}) {
    return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}

// marca visualmente un input con error y le da foco
export function marcarError(el) {
    if (!el) return;
    el.classList.add('campo-error');
    el.setAttribute('aria-invalid', 'true');
    el.focus();
    setTimeout(() => { el.classList.remove('campo-error'); el.removeAttribute('aria-invalid'); }, 2500);
}
