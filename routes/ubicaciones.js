const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const ubicacionesPath = path.join(__dirname, '../data/ubicaciones.json');

router.get('/', (req, res) => {
    try {
        const rawData = fs.readFileSync(ubicacionesPath);
        const ubicaciones = JSON.parse(rawData);
        res.json(ubicaciones);
    } catch (error) {
        console.error('Error al leer ubicaciones:', error);
        res.status(500).json({ error: 'Error al leer las ubicaciones' });
    }
});

module.exports = router;
