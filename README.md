# 🧁 Gestor de Repostería - Node.js

Aplicación web para gestionar costos de repostería, migrada a Node.js con Express.

## Características

- **Insumos**: Base de datos de ingredientes con unidades de medida
- **Compras**: Registro de compras con cálculo de costos (método FIFO)
- **Recetas**: Gestión de recetas con ingredientes y porciones
- **Calculadora**: Cálculo automático de precios de venta con margen de ganancia

## Requisitos

- [Node.js](https://nodejs.org/) (versión 14 o superior)

## Instalación en Windows

1. Copia la carpeta `reposteria-app` a tu escritorio o ubicación deseada
2. Haz doble clic en `iniciar.bat`

El script:
- Verifica que Node.js esté instalado
- Instala las dependencias automáticamente (si es necesario)
- Inicia el servidor
- Abre la aplicación en tu navegador predeterminado

## Instalación Manual

```bash
cd reposteria-app
npm install
npm start
```

Luego abre tu navegador en: http://localhost:3000

## Uso

### 1. Agregar Insumos
- Usa los botones rápidos para ingredientes comunes
- O ingresa un nombre personalizado y unidad de medida

### 2. Registrar Compras
- Selecciona un insumo
- Ingresa cantidad comprada y precio total
- La fecha se autocompleta pero puedes modificarla

### 3. Crear Recetas
- Ingresa el nombre de la receta y porciones
- Agrega ingredientes uno por uno
- Guarda la receta cuando termines

### 4. Calcular Precios
- Selecciona una receta
- Agrega costos adicionales (mano de obra, servicios, etc.)
- Define tu margen de ganancia deseado
- Obtén el precio de venta sugerido automáticamente

## Estructura del Proyecto

```
reposteria-app/
├── db.json           # Base de datos local (JSON)
├── iniciar.bat       # Script para Windows
├── package.json      # Configuración de Node.js
├── public/
│   └── index.html    # Frontend de la aplicación
└── src/
    └── server.js     # Servidor Express (API)
```

## API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /api/insumos | Obtener todos los insumos |
| POST | /api/insumos | Crear nuevo insumo |
| DELETE | /api/insumos/:id | Eliminar insumo |
| GET | /api/compras | Obtener todas las compras |
| POST | /api/compras | Registrar nueva compra |
| DELETE | /api/compras/:id | Eliminar compra |
| GET | /api/recetas | Obtener todas las recetas |
| POST | /api/recetas | Crear nueva receta |
| DELETE | /api/recetas/:id | Eliminar receta |

## Datos Persistentes

Los datos se guardan automáticamente en `db.json`. Puedes hacer copias de seguridad de este archivo para conservar tu información.

## Tecnologías

- **Backend**: Node.js + Express
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Base de Datos**: Archivo JSON local
- **CORS**: Habilitado para conexiones locales

---

¡Disfruta gestionando tu repostería! 🍰🧁🍪
