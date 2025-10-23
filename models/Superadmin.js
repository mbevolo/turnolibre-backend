const mongoose = require('mongoose');

const superadminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true }, // Contraseña encriptada
  nombre: { type: String, required: true }
});

module.exports = mongoose.model('Superadmin', superadminSchema);
