# 🦙🧁 Llama Repostera

PWA para gestionar los costos de un emprendimiento de repostería: insumos, compras, recetas y calculadora de precios. Con lector de boletas por IA.

**App en producción:** Firebase Hosting (proyecto `llama-repostera-app`).

## Características

- **Insumos**: catálogo de ingredientes con unidades, emojis y códigos de barras vinculados.
- **Compras**: registro de compras manual o **escaneando la boleta** (foto → Gemini IA, con OCR local Tesseract.js de respaldo).
- **Recetas**: recetas con ingredientes, porciones e importador desde texto.
- **Calculadora**: precio de venta sugerido con materia prima, mano de obra, empaque, costos indirectos, merma y margen.
- **PWA instalable**: funciona como app en el celular.

## Stack

- Frontend: HTML + CSS + JavaScript vanilla (módulos ES, sin build step).
- Hosting: Firebase Hosting.
- Datos: Cloud Firestore (reglas: solo cuentas dueñas con email verificado).
- Auth: Google Sign-In + App Check (reCAPTCHA v3).
- IA: Gemini 2.5 Flash vía Firebase AI Logic para leer boletas.

## Desarrollo local

Requiere [Firebase CLI](https://firebase.google.com/docs/cli) logueado en el proyecto.

```bash
npm run serve    # emulador de hosting en http://localhost:5000
npm run deploy   # deploy a producción
```

> Nota App Check en localhost: antes de cargar la app, en la consola del navegador ejecuta
> `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` y registra el token generado en
> Firebase Console → App Check → Manage debug tokens.

## Estructura

```
public/
├── index.html        # SPA (login + dashboard + secciones)
├── css/app.css       # estilos y animaciones de la llama
├── js/               # módulos ES (main.js = entrada)
├── sw.js             # service worker (PWA)
├── manifest.json
└── img/              # personaje llama, iconos, banners
firestore.rules       # seguridad Firestore
firebase.json         # config hosting
tools/                # utilidades de desarrollo
```
