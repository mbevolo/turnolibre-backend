const express = require("express");
const router = express.Router();
const Turno = require("../models/Turno");
const Club = require("../models/Club");
const Cancha = require("../models/Cancha");
const authClub = require("../middlewares/authClub");

// =========================================
// 📊 Estadísticas del club (para estadisticas.html)
// =========================================
router.get("/overview", authClub, async (req, res) => {
  try {
    const clubId = req.clubId;
    const club = await Club.findById(clubId).lean();
    if (!club) return res.status(404).json({ error: "Club no encontrado" });

    const clubEmail = club.email;

    // ================================
// 📅 Rango del mes solicitado (por query) o mes actual
// ================================
const hoy = new Date();

// Si vienen parámetros de la URL, los usamos. Ejemplo: ?anio=2025&mes=11
const anio = Number(req.query.anio) || hoy.getFullYear();
const mes = Number(req.query.mes) || hoy.getMonth() + 1;

// Calcular primer y último día del mes solicitado
const inicioMes = new Date(anio, mes - 1, 1);
const finMes = new Date(anio, mes, 0); // último día del mes

    // 🔧 Convertidor de string (YYYY-MM-DD → Date)
    const parseFecha = str => {
      if (!str || typeof str !== "string") return null;
      const [y, m, d] = str.split("-").map(Number);
      return new Date(y, m - 1, d);
    };

    // Buscar turnos del club
    const turnos = await Turno.find({ club: clubEmail }).lean();

    // Filtrar por fechas del mes actual
    const turnosMes = turnos.filter(t => {
      const fecha = parseFecha(t.fecha);
      return fecha && fecha >= inicioMes && fecha <= finMes;
    });

    // ================================
    // KPIs
    // ================================
// 🔹 Cantidad total de reservas reales (pagadas o no)
const totalReservas = turnosMes.filter(t => t.usuarioReservado).length;

// 🔹 Calcular cantidad total de turnos posibles del mes según las canchas del club
const canchasClub = await Cancha.find({ clubEmail: clubEmail }).lean();
let totalTurnosPosibles = 0;

for (const cancha of canchasClub) {
  const diasDisponibles = cancha.diasDisponibles?.length || 7; // si no tiene, asumimos 7 días
  const horaDesde = parseInt(cancha.horaDesde.split(':')[0]);
  const horaHasta = parseInt(cancha.horaHasta.split(':')[0]);
  const duracion = cancha.duracionTurno || 60;

  // Cuántos turnos tiene por día esa cancha
  const turnosPorDia = Math.floor(((horaHasta - horaDesde) * 60) / duracion);

  // Total mensual aproximado (proporcional a los días del mes)
  totalTurnosPosibles += turnosPorDia * diasDisponibles * (finMes.getDate() / 7);
}

// 🔹 Calcular ocupación promedio realista
const ocupacionPromedio = totalTurnosPosibles > 0
  ? (totalReservas / totalTurnosPosibles) * 100
  : 0;

// 🔹 Calcular ingresos solo con turnos pagados
const turnosPagados = turnosMes.filter(t => t.pagado);
const ingresosMP = turnosPagados.reduce((acc, t) => acc + (t.precio || 0), 0);

// 🧩 Log de control (opcional)
console.log(`💡 Ocupación calculada: ${totalReservas}/${Math.round(totalTurnosPosibles)} turnos posibles → ${ocupacionPromedio.toFixed(2)}%`);

    // ================================
    // Reservas por día (1 al fin de mes)
    // ================================
    const reservasPorDia = [];
    const diasEnMes = finMes.getDate();

    for (let dia = 1; dia <= diasEnMes; dia++) {
      const fechaStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
      const count = turnosMes.filter(t => t.fecha === fechaStr && t.usuarioReservado).length;
      reservasPorDia.push({ dia: fechaStr, cantidad: count });
    }

    // ================================
    // Ingresos por deporte (solo pagados)
    // ================================
    const ingresosPorDeporte = {};
    turnosPagados.forEach(t => {
      const dep = t.deporte || "Otro";
      ingresosPorDeporte[dep] = (ingresosPorDeporte[dep] || 0) + (t.precio || 0);
    });

    // ================================
    // Horas pico (todas las reservas)
    // ================================
    const horasPico = [];
    for (let h = 0; h < 24; h++) {
      const hora = String(h).padStart(2, "0") + ":00";
      const cantidad = turnosMes.filter(t => t.hora === hora && t.usuarioReservado).length;
      horasPico.push({ hora, cantidad });
    }

    // ================================
    // Ocupación por cancha (todas las reservas)
    // ================================
    const ocupacionPorCancha = {};
    turnosMes.forEach(t => {
      if (t.canchaId && t.usuarioReservado) {
        ocupacionPorCancha[t.canchaId] = (ocupacionPorCancha[t.canchaId] || 0) + 1;
      }
    });

    const canchaIds = Object.keys(ocupacionPorCancha);
    const canchas = await Cancha.find({ _id: { $in: canchaIds } }).lean();

    const ocupacionLista = canchaIds.map(id => {
      const cancha = canchas.find(c => c._id.toString() === id);
      return {
        nombre: cancha ? cancha.nombre : "Cancha desconocida",
        cantidad: ocupacionPorCancha[id]
      };
    });

    // ================================
    // Logs de control (opcional)
    // ================================
    console.log("=== Fechas de turnos detectadas ===");
    turnosMes.forEach(t => console.log("➡️", t.fecha));
    console.log("===================================");
    console.log("=== Conteo de reservasPorDia ===");
    reservasPorDia.forEach(r => {
      if (r.cantidad > 0) console.log(r.dia, "=>", r.cantidad);
    });
    console.log("===============================");

    // ================================
    // Respuesta final
    // ================================
    res.json({
      totalReservas,
      ingresosMP,
      ocupacionPromedio,
      reservasPorDia,
      ingresosPorDeporte,
      horasPico,
      ocupacionPorCancha: ocupacionLista
    });

  } catch (err) {
    console.error("Error overview:", err);
    res.status(500).json({ error: "Error generando overview" });
  }
});

module.exports = router;
