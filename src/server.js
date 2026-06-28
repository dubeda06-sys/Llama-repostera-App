const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
    console.log(`\n🧁 Servidor de Repostería corriendo en http://localhost:${PORT}`);
    console.log('Presiona Ctrl+C para detener\n');
});
