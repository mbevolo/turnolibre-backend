const express = require('express');
const router = express.Router();
const Turno = require('../models/Turno');
const Cancha = require('../models/Cancha');
const Club = require('../models/Club');

// ===============================
// 📊 Ruta: Estadísticas del club
// ===============================
router.get('/estadisticas-club', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Falta el email del club' });

    // Buscar el club por email
    const club = await Club.findOne({ email });
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });

    const clubId = club._id;

    // Obtener todas las canchas del club
    const canchas = await Cancha.find({ clubId });
    const canchasIds = canchas.map(c => c._id);

    // Obtener todos los turnos de esas canchas
    const turnos = await Turno.find({ canchaId: { $in: canchasIds } });

    // ===============================
    // 📊 Cálculos
    // ===============================

    // Total de reservas
    const totalReservas = turnos.length;

    // Reservas del mes actual
    const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const reservasMes = turnos.filter(t => new Date(t.fecha) >= inicioMes).length;

    // Ingresos estimados (sumando precioCancha)
    const ingresosMes = turnos
      .filter(t => new Date(t.fecha) >= inicioMes && t.precio)
      .reduce((acc, t) => acc + Number(t.precio), 0);

    // Agrupar reservas por cancha
    const reservasPorCancha = canchas.map(c => {
      const cantidad = turnos.filter(t => t.canchaId.toString() === c._id.toString()).length;
      return { nombre: c.nombre, cantidad };
    });

    // Cancha más usada
    const canchaMasUsada = reservasPorCancha.sort((a, b) => b.cantidad - a.cantidad)[0]?.nombre || '-';

    // Reservas por día (últimos 7 días)
    const hoy = new Date();
    const hace7Dias = new Date(hoy);
    hace7Dias.setDate(hoy.getDate() - 6);

    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const reservasPorDia = [];

    for (let i = 0; i < 7; i++) {
      const fecha = new Date(hace7Dias);
      fecha.setDate(hace7Dias.getDate() + i);
      const dia = diasSemana[fecha.getDay()];

      const cantidad = turnos.filter(t => {
        const fechaTurno = new Date(t.fecha);
        return (
          fechaTurno.getDate() === fecha.getDate() &&
          fechaTurno.getMonth() === fecha.getMonth() &&
          fechaTurno.getFullYear() === fecha.getFullYear()
        );
      }).length;

      reservasPorDia.push({ dia, cantidad });
    }

    // ===============================
    // 📦 Respuesta
    // ===============================
    res.json({
      totalReservas,
      reservasMes,
      ingresosMes,
      canchaMasUsada,
      reservasPorCancha,
      reservasPorDia
    });

  } catch (error) {
    console.error('❌ Error en /estadisticas-club:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas del club' });
  }
});

module.exports = router;
