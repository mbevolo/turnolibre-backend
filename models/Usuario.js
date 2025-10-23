const mongoose = require('mongoose');

const usuarioSchema = new mongoose.Schema({
  nombre: String,
  apellido: String,
  telefono: String,
  email: { type: String, required: true, unique: true },
  // Si antes guardabas la contraseña en "password", mantenemos compatibilidad:
  password: { type: String },          // opcional (legacy)
  passwordHash: { type: String },      // recomendado
  activo: { type: Boolean, default: true },

  // === Campos estandarizados para verificación de email ===
  emailVerified: { type: Boolean, default: false },
  emailVerifyToken: { type: String, default: null },
  emailVerifyExpires: { type: Date, default: null },
});

module.exports = mongoose.models.Usuario || mongoose.model('Usuario', usuarioSchema);
