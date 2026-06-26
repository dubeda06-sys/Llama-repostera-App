const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Ruta para la base de datos local (archivo JSON)
const DB_PATH = path.join(__dirname, '..', 'db.json');

// Función para leer la base de datos
function leerDB() {
    if (!fs.existsSync(DB_PATH)) {
        return { insumos: [], compras: [], recetas: [] };
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
}

// Función para guardar en la base de datos
function guardarDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Rutas de la API

// Obtener todos los insumos
app.get('/api/insumos', (req, res) => {
    const db = leerDB();
    res.json(db.insumos);
});

// Agregar un insumo
app.post('/api/insumos', (req, res) => {
    const db = leerDB();
    const nuevoInsumo = {
        id: Date.now(),
        nombre: req.body.nombre,
        unidad: req.body.unidad,
        fechaCreacion: new Date().toISOString()
    };
    db.insumos.push(nuevoInsumo);
    guardarDB(db);
    res.json(nuevoInsumo);
});

// Eliminar un insumo
app.delete('/api/insumos/:id', (req, res) => {
    const db = leerDB();
    db.insumos = db.insumos.filter(i => i.id !== parseInt(req.params.id));
    guardarDB(db);
    res.json({ success: true });
});

// Obtener todas las compras
app.get('/api/compras', (req, res) => {
    const db = leerDB();
    res.json(db.compras);
});

// Agregar una compra
app.post('/api/compras', (req, res) => {
    const db = leerDB();
    const nuevaCompra = {
        id: Date.now(),
        insumoId: req.body.insumoId,
        cantidad: req.body.cantidad,
        precio: req.body.precio,
        fecha: req.body.fecha,
        fechaRegistro: new Date().toISOString()
    };
    db.compras.push(nuevaCompra);
    guardarDB(db);
    res.json(nuevaCompra);
});

// Eliminar una compra
app.delete('/api/compras/:id', (req, res) => {
    const db = leerDB();
    db.compras = db.compras.filter(c => c.id !== parseInt(req.params.id));
    guardarDB(db);
    res.json({ success: true });
});

// Obtener todas las recetas
app.get('/api/recetas', (req, res) => {
    const db = leerDB();
    res.json(db.recetas);
});

// Agregar una receta
app.post('/api/recetas', (req, res) => {
    const db = leerDB();
    const nuevaReceta = {
        id: Date.now(),
        nombre: req.body.nombre,
        porciones: req.body.porciones,
        ingredientes: req.body.ingredientes,
        fechaCreacion: new Date().toISOString()
    };
    db.recetas.push(nuevaReceta);
    guardarDB(db);
    res.json(nuevaReceta);
});

// Eliminar una receta
app.delete('/api/recetas/:id', (req, res) => {
    const db = leerDB();
    db.recetas = db.recetas.filter(r => r.id !== parseInt(req.params.id));
    guardarDB(db);
    res.json({ success: true });
});

// Servir el frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`\n🧁 Servidor de Repostería corriendo en http://localhost:${PORT}`);
    console.log('Presiona Ctrl+C para detener\n');
});
