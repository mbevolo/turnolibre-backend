// models/config.js
const mongoose = require('mongoose');
const ConfigSchema = new mongoose.Schema({
    precioDestacado: { type: Number, default: 4999 },
    diasDestacado: { type: Number, default: 30 }
});
module.exports = mongoose.model('config', ConfigSchema);
