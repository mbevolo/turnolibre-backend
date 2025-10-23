const mongoose = require('mongoose');

const canchaSchema = new mongoose.Schema({
  nombre: String,
  deporte: String,
  precio: Number,
  horaDesde: String,
  horaHasta: String,
  diasDisponibles: [String],
  clubEmail: String,
  duracionTurno: { type: Number, default: 60 },
  nocturnoDesde: { type: Number, default: null }, // hora en formato 0-23
  precioNocturno: { type: Number, default: null }
});

module.exports = mongoose.models.Cancha || mongoose.model('Cancha', canchaSchema);
