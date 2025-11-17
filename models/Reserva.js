// models/Reserva.js
const mongoose = require('mongoose');

const ReservaSchema = new mongoose.Schema({
  canchaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cancha', required: true },
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
  fecha: { type: String, required: true },
  hora: { type: String, required: true },
  estado: { 
    type: String, 
    enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED'], 
    default: 'PENDING' 
  },
  codigoOTP: { type: String, default: null },
  expiresAt: { type: Date, required: true },
  emailContacto: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

ReservaSchema.index({ canchaId: 1, fecha: 1, hora: 1, estado: 1 });
ReservaSchema.index(
  { canchaId: 1, fecha: 1, hora: 1 },
  { unique: true, partialFilterExpression: { estado: 'CONFIRMED' } }
);

module.exports = mongoose.model('Reserva', ReservaSchema);
