const mongoose = require('mongoose');

const clubSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  telefono: { type: String, required: true },
  passwordHash: { type: String, required: true },
  latitud: Number,
  longitud: Number,
  provincia: { type: String, required: true },   // ✅ Agregado
  localidad: { type: String, required: true },   // ✅ Agregado
  mercadoPagoAccessToken: String,
  destacado: { type: Boolean, default: false },
  destacadoHasta: { type: Date, default: null },
  idUltimaTransaccion: { type: String, default: null },
  activo: { type: Boolean, default: true },
  // === Recuperación de contraseña ===
  resetToken: { type: String, default: null },
  resetTokenExp: { type: Date, default: null },
  // === Verificación de email ===
  emailVerificado: { type: Boolean, default: false },
  tokenVerificacion: { type: String, default: null },
  tokenVerificacionExpira: { type: Date, default: null },

  
});

module.exports = mongoose.models.Club || mongoose.model('Club', clubSchema);
