const mongoose = require('mongoose');

const usuarioSchema = new mongoose.Schema({
  nombre: String,
  apellido: String,
  telefono: String,
  email: { type: String, required: true, unique: true },

  // Compatibilidad con versiones previas
  password: { type: String },
  passwordHash: { type: String },

  activo: { type: Boolean, default: true },

  // === Verificación de email ===
  emailVerificado: { type: Boolean, default: false },
  tokenVerificacion: { type: String, default: null },
  tokenVerificacionExpira: { type: Date, default: null },

  // === Recuperación de contraseña ===
  resetToken: { type: String, default: null },
  resetTokenExp: { type: Date, default: null },
});

module.exports = mongoose.models.Usuario || mongoose.model('Usuario', usuarioSchema);
