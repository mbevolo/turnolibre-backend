require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const mercadopago = require('mercadopago');
const cron = require('node-cron');
const Config = require('./models/config');
const superadminRoutes = require('./routes/superadmin');
const Club = require('./models/Club');
const Turno = require('./models/Turno');
const Usuario = require('./models/Usuario');
const Cancha = require('./models/Cancha');
const ubicacionesRoute = require('./routes/ubicaciones');
const { celebrate, Joi, Segments, errors } = require('celebrate');
const PaymentEvent = require('./models/PaymentEvent');
const crypto = require('crypto');
const { sendMail } = require('./utils/email');
const clubRoutes = require("./routes/club");
const statsRoutes = require("./routes/stats");

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
const compression = require("compression");
app.use(compression());

// ============================================
// 🚦 Límite de peticiones (rate limit)
// ============================================
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300,                 // hasta 300 requests por IP en 15 min
  standardHeaders: true,    // info en headers RateLimit-*
  legacyHeaders: false,     // desactiva X-RateLimit-*
});

app.use(apiLimiter);


// ============================================
// 🎯 CORS SEGURO Y COMPATIBLE CON VERZEL + CLOUDFLARE
// ============================================
const allowedOrigins = [
  "https://turnolibre.com.ar",
  "https://www.turnolibre.com.ar",
  "https://turnolibre-frontend.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// ============================================
// 📌 BODY PARSER
// ============================================
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ============================================
// 📍 Rutas principales
// ============================================
app.use("/api/club", clubRoutes);
app.use("/api/stats", statsRoutes);
app.use('/ubicaciones', ubicacionesRoute);
app.use('/superadmin', superadminRoutes);


// ============================================
// MercadoPago
// ============================================
mercadopago.configure({ access_token: process.env.MP_ACCESS_TOKEN });

// ============================================
// Rate limit
// ============================================
const sensitiveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.post('/login', sensitiveLimiter);
app.use('/login-club', sensitiveLimiter);
app.use('/api/mercadopago', sensitiveLimiter);

// ============================================
// MongoDB
// ============================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🟢 Conectado a MongoDB Atlas'))
  .catch(err => console.error('🔴 Error de conexión a MongoDB', err));

// ===============================
// 📧 SISTEMA DE RESERVAS
// ===============================
const Reserva = require('./models/Reserva');

// ===============================
// Crear reserva pendiente y enviar email de confirmación
// ===============================
try {
    const { canchaId, fecha, hora, usuarioId, email } = req.body;

    if (!canchaId || !fecha || !hora || !email) {
      return res.status(400).json({ error: 'Faltan datos obligatorios.' });
    }

    // obtenemos teléfono del usuario logueado (B)
    let usuarioTelefono = null;
    if (usuarioId) {
      const usuario = await Usuario.findById(usuarioId);
      if (usuario && usuario.telefono) {
        usuarioTelefono = usuario.telefono; // ✔ guardamos el teléfono en la reserva
      }
    }

    // Código de verificación + expiración
    const codigoOTP = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); // 10 minutos

    const reserva = new Reserva({
      canchaId,
      fecha,
      hora,
      usuarioId,
      emailContacto: email,
      usuarioTelefono,     // 👈 AGREGADO
      estado: 'PENDING',
      codigoOTP,
      expiresAt
    });

    await reserva.save();

    const link = `${process.env.FRONT_URL}/confirmar-reserva.html?id=${reserva._id}&code=${codigoOTP}`;

    await sendMail(
      email,
      'Confirmá tu reserva en TurnoLibre',
      `
        <h2>Confirmación de reserva</h2>
        <p>Hacé clic en el siguiente enlace para confirmar tu reserva:</p>
        <p><a href="${link}" target="_blank">${link}</a></p>
        <p>El enlace vence en 10 minutos.</p>
      `
    );

    res.json({ mensaje: 'Te enviamos un email para confirmar tu reserva.', reservaId: reserva._id });
} catch (error) {
    console.error('❌ Error en /reservas/hold:', error);
    res.status(500).json({ error: 'Error al crear reserva pendiente.' });
}


// ===============================
// Reenviar correo de confirmación (por email)
// ===============================
app.post('/reservas/reenviar-confirmacion', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Falta el email.' });

    const reserva = await Reserva.findOne({
      emailContacto: email,
      estado: 'PENDING'
    }).sort({ createdAt: -1 });

    if (!reserva)
      return res.status(404).json({ error: 'No hay reservas pendientes para este email.' });

    if (new Date() > reserva.expiresAt) {
      return res.status(400).json({ error: 'El enlace anterior expiró. Volvé a reservar.' });
    }

    const link = `${process.env.FRONT_URL}/confirmar-reserva.html?id=${reserva._id}&code=${reserva.codigoOTP}`;

    await sendMail(
      email,
      'Reenvío de confirmación de reserva - TurnoLibre',
      `
        <h2>Reenvío de confirmación</h2>
        <p>Hacé clic en el siguiente enlace para confirmar tu reserva:</p>
        <p><a href="${link}" target="_blank">${link}</a></p>
        <p>Recordá que el enlace vence en 10 minutos desde que se creó la reserva.</p>
      `
    );

    console.log(`📧 Reenviado email de confirmación a ${email}`);
    res.json({ mensaje: 'Te reenviamos el correo de confirmación.' });
  } catch (error) {
    console.error('❌ Error en /reservas/reenviar-confirmacion:', error);
    res.status(500).json({ error: 'Error al reenviar el correo.' });
  }
});

// ===============================
// Confirmar reserva desde el enlace
// ===============================
app.get('/reservas/confirmar/:id/:code', async (req, res) => {
  try {
    const { id, code } = req.params;

    // Traigo la reserva y, si tiene usuarioId, lo lleno
    const reserva = await Reserva.findById(id).populate('usuarioId');

    if (!reserva) return res.send('❌ Reserva no encontrada.');
    if (reserva.estado !== 'PENDING') return res.send('⚠️ Esta reserva ya fue confirmada o expirada.');
    if (new Date() > reserva.expiresAt) return res.send('⏰ El enlace ha expirado.');
    if (reserva.codigoOTP !== code) return res.send('❌ Código inválido.');

    // Busco la cancha
    const cancha = await Cancha.findById(reserva.canchaId);
    if (!cancha) return res.send('⚠️ Cancha no encontrada para esta reserva.');

    // Calculo precio real (incluyendo nocturno si corresponde)
    let precioTurno = cancha.precio;
    if (reserva.fecha && reserva.hora) {
      const [Y, M, D] = reserva.fecha.split('-').map(Number);
      const [h, mm] = reserva.hora.split(':').map(Number);
      const inicio = new Date(Y, M - 1, D, h, mm, 0, 0);
      precioTurno = calcularPrecioTurno(cancha, inicio);
    }

    // Armo el teléfono, si lo tengo
    let telefono = null;

    if (reserva.usuarioTelefono) {
      telefono = String(reserva.usuarioTelefono);
    } else if (reserva.usuarioId && reserva.usuarioId.telefono) {
      telefono = String(reserva.usuarioId.telefono);
    }

    if (telefono) {
      // dejo solo dígitos
      telefono = telefono.replace(/\D/g, '');
      // saco 0 inicial
      if (telefono.startsWith('0')) telefono = telefono.slice(1);
      // fuerzo 549 adelante
      if (!telefono.startsWith('549')) telefono = '549' + telefono;
    }

    // Marco la reserva como confirmada
    reserva.estado = 'CONFIRMED';
    reserva.codigoOTP = null;
    await reserva.save();

    // Creo el turno definitivo
    const nuevoTurno = new Turno({
      deporte: cancha.deporte,
      fecha: reserva.fecha,
      hora: reserva.hora,
      club: cancha.clubEmail,
      precio: precioTurno,
      usuarioReservado: reserva.emailContacto,  // de momento usamos el mail como identificador visible
      emailReservado: reserva.emailContacto,
      telefonoReservado: telefono || null,
      usuarioId: reserva.usuarioId ? reserva.usuarioId._id : null,
      pagado: false,
      canchaId: cancha._id
    });

    await nuevoTurno.save();

    console.log(`✅ Turno creado para ${reserva.emailContacto} en cancha ${cancha.nombre}`);
    res.send('✅ ¡Reserva confirmada y registrada correctamente! Te esperamos en la cancha.');
  } catch (error) {
    console.error('❌ Error en /reservas/confirmar:', error);
    res.send('Error al confirmar y registrar reserva.');
  }
});


// ===============================
// Reenviar correo por ID
// ===============================
app.post('/reservas/:id/reenviar', async (req, res) => {
  try {
    const reserva = await Reserva.findById(req.params.id);
    if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada.' });

    if (reserva.estado !== 'PENDING') {
      return res.status(400).json({ error: 'Solo se pueden reenviar reservas pendientes.' });
    }

    // renovamos OTP y expiración
    reserva.expiresAt = new Date(Date.now() + 10 * 60000);
    reserva.codigoOTP = Math.floor(100000 + Math.random() * 900000).toString();
    await reserva.save();

    const link = `${process.env.FRONT_URL}/confirmar-reserva.html?id=${reserva._id}&code=${reserva.codigoOTP}`;

    await sendMail(
      reserva.emailContacto,
      'Reenvío: confirmá tu reserva en TurnoLibre',
      `
        <h2>Confirmación de reserva</h2>
        <p>Hacé clic en el siguiente enlace para confirmar tu reserva:</p>
        <p><a href="${link}" target="_blank">${link}</a></p>
        <p>El enlace vence en 10 minutos.</p>
      `
    );

    console.log(`📩 Reenviado email de confirmación a ${reserva.emailContacto}`);
    res.json({ mensaje: 'Correo reenviado correctamente.' });
  } catch (error) {
    console.error('❌ Error en /reservas/:id/reenviar:', error);
    res.status(500).json({ error: 'Error al reenviar correo de confirmación.' });
  }
});

// ===============================
// CRON destaque
// ===============================
cron.schedule('*/5 * * * *', async () => {
  console.log("CRON corriendo...");
  try {
    const now = new Date();
    const clubesVencidos = await Club.find({
      destacado: true,
      destacadoHasta: { $lt: now }
    });
    for (let club of clubesVencidos) {
      club.destacado = false;
      club.destacadoHasta = null;
      await club.save();
      console.log(`⏰ Club ${club.nombre} perdió el destaque automáticamente`);
    }
  } catch (error) {
    console.error('❌ Error en tarea automática de destaque:', error);
  }
});

// ===============================
// CRON expiración de reservas
// ===============================
cron.schedule('*/2 * * * *', async () => {
  try {
    const ahora = new Date();
    const expiradas = await Reserva.updateMany(
      { estado: 'PENDING', expiresAt: { $lt: ahora } },
      { $set: { estado: 'EXPIRED' } }
    );

    if (expiradas.modifiedCount > 0) {
      console.log(`⏰ ${expiradas.modifiedCount} reservas pendientes expiraron automáticamente.`);
    }
  } catch (error) {
    console.error('❌ Error en CRON de expiración de reservas:', error);
  }
});

// ===============================
// Helpers
// ===============================
function quitarAcentos(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function getDiaNombre(fecha) {
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return dias[new Date(fecha).getDay()];
}

// Precio nocturno
function calcularPrecioTurno(cancha, inicioTurnoDate) {
  const hora = inicioTurnoDate.getHours();
  if (cancha.nocturnoDesde !== null && typeof cancha.nocturnoDesde === 'number') {
    if (hora >= cancha.nocturnoDesde) {
      if (typeof cancha.precioNocturno === 'number' && !Number.isNaN(cancha.precioNocturno)) {
        return cancha.precioNocturno;
      }
    }
  }
  return cancha.precio;
}

// ===============================
// Reservas por email usuario
// ===============================
app.get('/reservas-usuario/:email', async (req, res) => {
  try {
    const email = req.params.email.trim();

    const reservasConfirmadas = await Turno.find({
      emailReservado: { $regex: new RegExp(`^${email}$`, 'i') }
    });

    const reservasPendientes = await Reserva.find({
      emailContacto: { $regex: new RegExp(`^${email}$`, 'i') },
      estado: 'PENDING'
    });

    const reservasConNombreClub = await Promise.all([
      ...reservasConfirmadas.map(async (r) => {
        const club = await Club.findOne({ email: r.club });
        return {
          ...r.toObject(),
          nombreClub: club?.nombre || 'Club desconocido',
          tipo: 'CONFIRMED'
        };
      }),
      ...reservasPendientes.map(async (r) => {
        const cancha = await Cancha.findById(r.canchaId);
        const club = cancha ? await Club.findOne({ email: cancha.clubEmail }) : null;
        return {
          ...r.toObject(),
          nombreClub: club?.nombre || 'Club desconocido',
          tipo: 'PENDING'
        };
      })
    ]);

    res.json(reservasConNombreClub);
  } catch (error) {
    console.error('Error en /reservas-usuario:', error);
    res.status(500).json({ error: 'Error al obtener reservas del usuario' });
  }
});

// ===============================
// Guardar access token MP
// ===============================
app.put('/club/:email/access-token', async (req, res) => {
  try {
    const { accessToken } = req.body;
    await Club.findOneAndUpdate({ email: req.params.email }, { mercadoPagoAccessToken: accessToken });
    res.json({ mensaje: 'Access Token guardado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar Access Token' });
  }
});

// ===============================
// Reservar turno
// ===============================

function normalizarTelefono(tel) {
  if (!tel) return null;

  let numero = String(tel).replace(/\D/g, ''); // dejar solo números

  if (numero.startsWith("0")) numero = numero.slice(1);

  // si empieza con 54 pero no con 549 → convertir a 549
  if (numero.startsWith("54") && !numero.startsWith("549")) {
    numero = "9" + numero.slice(2);
  }

  // si todavía no empieza con 549 → agregarlo
  if (!numero.startsWith("549")) {
    numero = "549" + numero;
  }

  return numero;
}

app.post(
  '/reservar-turno',
  celebrate({
    [Segments.BODY]: Joi.object({
      deporte: Joi.string().max(40).required(),
      fecha: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      club: Joi.string().max(100).required(),
      hora: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
      precio: Joi.number().min(0).required(),
      usuarioReservado: Joi.string().max(100).required(),
      emailReservado: Joi.string().email().required(),
      metodoPago: Joi.string().valid('online', 'efectivo').required(),
      canchaId: Joi.string().required(),
      telefonoReservado: Joi.string().min(6).max(30).required(),

    })
  }),
  async (req, res) => {
    console.log('📦 Body recibido en /reservar-turno:', req.body);
    const { deporte, fecha, club, hora, usuarioReservado, emailReservado, metodoPago, canchaId } = req.body;

    try {
      const usuario = await Usuario.findOne({ email: emailReservado });
      const cancha = await Cancha.findById(canchaId);
      if (!cancha) return res.status(404).json({ error: 'Cancha no encontrada' });

      const [Y, M, D] = fecha.split('-').map(Number);
      const [h, mm] = hora.split(':').map(Number);
      const inicioReserva = new Date(Y, M - 1, D, h, mm, 0, 0);
      const precioCalculado = calcularPrecioTurno(cancha, inicioReserva);

      const turnoExistente = await Turno.findOne({ deporte, fecha, hora, club, canchaId });

      let turno;
      if (turnoExistente) {
        turnoExistente.usuarioReservado = usuarioReservado;
        turnoExistente.emailReservado = emailReservado;
        turnoExistente.pagado = false;
        turnoExistente.precio = precioCalculado;
        await turnoExistente.save();
        turno = turnoExistente;
      } else {
        turno = new Turno({
          deporte, fecha, club, hora,
          precio: precioCalculado,
          usuarioReservado, emailReservado,
          usuarioId: usuario?._id,
          telefonoReservado: normalizarTelefono(
  req.body.telefonoReservado || usuario?.telefono || null
),

          pagado: false, canchaId
        });
        await turno.save();
      }

      if (metodoPago === 'online') {
        const clubData = await Club.findOne({ email: club });
        if (!clubData || !clubData.mercadoPagoAccessToken) {
          return res.status(400).json({ error: 'El club no tiene configurado su Access Token' });
        }

        mercadopago.configure({ access_token: clubData.mercadoPagoAccessToken });

        const preference = {
          items: [{
            title: `Reserva de cancha - ${deporte}`,
            quantity: 1,
            currency_id: 'ARS',
            unit_price: precioCalculado
          }],
          notification_url: 'https://localhost:3000/api/mercadopago/webhook',
          external_reference: turno._id.toString()
        };

        const response = await mercadopago.preferences.create(preference);
        return res.json({ mensaje: 'Turno reservado. Link de pago generado.', pagoUrl: response.body.init_point });
      }

      if (metodoPago === 'efectivo') {
        return res.json({ mensaje: 'Turno reservado. Pago pendiente en efectivo.' });
      }

    } catch (error) {
      console.error('❌ Error en /reservar-turno:', error);
      res.status(500).json({ error: 'Error al reservar turno' });
    }
  }
);

// ===============================
// Webhook MercadoPago (reservas)
// ===============================
app.post('/api/mercadopago/webhook', async (req, res) => {
  try {
    const paymentId = req.query.id || req.body?.data?.id;
    if (!paymentId) return res.sendStatus(200);

    const yaExiste = await PaymentEvent.findOne({ paymentId });
    if (yaExiste) return res.sendStatus(200);

    await PaymentEvent.create({ paymentId });

    const resp = await mercadopago.payment.findById(paymentId);
    const payment = resp?.body || {};
    const status = payment.status;
    const externalRef = payment.external_reference;

    if (!externalRef) return res.sendStatus(200);

    let turno = null;
    try { turno = await Turno.findById(externalRef); } catch (_) {}
    if (!turno && paymentId) {
      turno = await Turno.findOne({ pagoId: paymentId }).catch(() => null);
    }
    if (!turno) return res.sendStatus(200);

    if (status === 'approved') {
      if (!turno.pagado) {
        turno.pagado = true;
        turno.fechaPago = new Date();
        turno.pagoId = paymentId;
        turno.pagoMetodo = payment.payment_method?.type || payment.payment_type_id || 'mercadopago';
        await turno.save();
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error procesando webhook MP:', error);
    return res.sendStatus(500);
  }
});

// ===============================
// Registro club
// ===============================
app.post('/registro-club', async (req, res) => {
  const {
    email,
    password,
    nombre,
    telefono,
    direccion,
    latitud,
    longitud,
    provincia,
    localidad
  } = req.body;

  if (!password || password.length < 6 || !/\d/.test(password) || !/[A-Za-z]/.test(password)) {
    return res.status(400).json({
      error: 'La contraseña debe tener al menos 6 caracteres e incluir una letra y un número.'
    });
  }

  if (
    !email || !password || !nombre || !telefono ||
    !provincia || !localidad ||
    latitud === undefined || longitud === undefined ||
    latitud === null || longitud === null ||
    Number.isNaN(Number(latitud)) || Number.isNaN(Number(longitud))
  ) {
    return res
      .status(400)
      .json({ error: 'Faltan campos obligatorios para registrar el club' });
  }

  try {
    const existe = await Club.findOne({ email });
    if (existe)
      return res.status(400).json({ error: 'El club ya está registrado' });

    const hash = await bcrypt.hash(password, 10);

    const latNum = parseFloat(latitud);
    const lonNum = parseFloat(longitud);

    const nuevoClub = new Club({
      email,
      passwordHash: hash,
      nombre,
      telefono,
      direccion,
      latitud: latNum,
      longitud: lonNum,
      provincia,
      localidad
    });

    await nuevoClub.save();

    res.json({ mensaje: 'Club registrado correctamente' });
  } catch (error) {
    console.error('❌ Error en /registro-club:', error);
    res.status(500).json({ error: 'Error al registrar club' });
  }
});

// ===============================
// Login club
// ===============================
const jwt = require('jsonwebtoken');

app.post('/login-club', async (req, res) => {
  const { email, password } = req.body;

  try {
    console.log('📩 Datos recibidos:', { email, password });

    const club = await Club.findOne({ email });
    if (!club) return res.status(400).json({ error: 'Club no encontrado' });

    const match = await bcrypt.compare(password, club.passwordHash);
    if (!match) return res.status(401).json({ error: 'Contraseña incorrecta' });

    const token = jwt.sign(
      { clubId: club._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      mensaje: 'Login exitoso',
      token,
      clubId: club._id,
      nombre: club.nombre,
      email: club.email
    });

  } catch (error) {
    console.error('❌ Error en /login-club:', error);
    res.status(500).json({ error: 'Error al iniciar sesión del club' });
  }
});

// ===============================
// Obtener club por email
// ===============================
app.get('/club/:email', async (req, res) => {
  try {
    const club = await Club.findOne({ email: req.params.email });
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });
    res.json(club);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener club' });
  }
});

// ===============================
// Editar ubicación club (lat/lng)
// ===============================
app.put('/editar-ubicacion-club', async (req, res) => {
  const { email, latitud, longitud } = req.body;
  try {
    await Club.findOneAndUpdate({ email }, { latitud, longitud });
    res.json({ mensaje: 'Ubicación actualizada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar ubicación' });
  }
});

// ===============================
// Obtener canchas de un club
// ===============================
app.get('/canchas/:clubEmail', async (req, res) => {
  try {
    const canchas = await Cancha.find({ clubEmail: req.params.clubEmail });
    res.json(canchas);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener canchas' });
  }
});

// ===============================
// Crear cancha
// ===============================
app.post('/canchas', async (req, res) => {
  const {
    nombre, deporte, precio, horaDesde, horaHasta,
    diasDisponibles, clubEmail, duracionTurno,
    nocturnoDesde, precioNocturno
  } = req.body;

  if (!nombre || !deporte || !precio || !horaDesde || !horaHasta || !clubEmail) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para crear la cancha.' });
  }

  if (isNaN(precio) || Number(precio) <= 0) {
    return res.status(400).json({ error: 'El precio debe ser un número mayor que 0.' });
  }

  const desde = parseInt(horaDesde.split(':')[0]);
  const hasta = parseInt(horaHasta.split(':')[0]);
  if (hasta <= desde) {
    return res.status(400).json({ error: 'El horario "Hasta" debe ser mayor que el horario "Desde".' });
  }

  try {
    const nuevaCancha = new Cancha({
      nombre,
      deporte,
      precio,
      horaDesde,
      horaHasta,
      diasDisponibles: Array.isArray(diasDisponibles) ? diasDisponibles : [],
      clubEmail,
      duracionTurno: Number(duracionTurno) || 60,
      nocturnoDesde: (nocturnoDesde === '' || nocturnoDesde === null || nocturnoDesde === undefined) ? null : Number(nocturnoDesde),
      precioNocturno: (precioNocturno === '' || precioNocturno === null || precioNocturno === undefined) ? null : Number(precioNocturno)
    });

    await nuevaCancha.save();
    res.json({ mensaje: 'Cancha agregada correctamente' });
  } catch (error) {
    console.error('❌ Error al agregar cancha:', error);
    res.status(500).json({ error: 'Error al agregar cancha' });
  }
});

// ===============================
// Editar cancha
// ===============================
app.put('/canchas/:id', async (req, res) => {
  try {
    const {
      nombre, deporte, precio, horaDesde, horaHasta,
      diasDisponibles, clubEmail, duracionTurno,
      nocturnoDesde, precioNocturno
    } = req.body;

    if (!nombre || !deporte || !precio || !horaDesde || !horaHasta || !clubEmail) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para actualizar la cancha.' });
    }

    if (isNaN(precio) || Number(precio) <= 0) {
      return res.status(400).json({ error: 'El precio debe ser un número mayor que 0.' });
    }

    const desde = parseInt(horaDesde.split(':')[0]);
    const hasta = parseInt(horaHasta.split(':')[0]);
    if (hasta <= desde) {
      return res.status(400).json({ error: 'El horario "Hasta" debe ser mayor que el horario "Desde".' });
    }

    const update = {
      nombre,
      deporte,
      precio,
      horaDesde,
      horaHasta,
      diasDisponibles: Array.isArray(diasDisponibles) ? diasDisponibles : [],
      clubEmail,
      duracionTurno: Number(duracionTurno) || 60,
      nocturnoDesde: (nocturnoDesde === '' || nocturnoDesde === null) ? null : Number(nocturnoDesde),
      precioNocturno: (precioNocturno === '' || precioNocturno === null) ? null : Number(precioNocturno)
    };

    await Cancha.findByIdAndUpdate(req.params.id, update);
    res.json({ mensaje: 'Cancha actualizada correctamente' });
  } catch (error) {
    console.error('❌ Error al actualizar cancha:', error);
    res.status(500).json({ error: 'Error al actualizar cancha' });
  }
});

// ===============================
// Eliminar cancha
// ===============================
app.delete('/canchas/:id', async (req, res) => {
  try {
    await Cancha.findByIdAndDelete(req.params.id);
    res.json({ mensaje: 'Cancha eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar cancha' });
  }
});

// ===============================
// Obtener todos los turnos
// ===============================
app.get('/turnos', async (req, res) => {
  try {
    const turnos = await Turno.find();
    res.json(turnos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener turnos' });
  }
});

// ===============================
// Editar turno
// ===============================
app.put('/turnos/:id', async (req, res) => {
  try {
    await Turno.findByIdAndUpdate(req.params.id, req.body);
    res.json({ mensaje: 'Turno actualizado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar turno' });
  }
});

// ===============================
// Cancelar un turno confirmado
// ===============================
app.patch('/turnos/:id/cancelar', async (req, res) => {
  try {
    await Turno.findByIdAndUpdate(req.params.id, {
      usuarioReservado: null,
      emailReservado: null,
      pagado: false
    });
    res.json({ mensaje: 'Reserva cancelada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al cancelar reserva' });
  }
});

// ===============================
// Generación de turnos semanales
// ===============================
app.get('/turnos-generados', async (req, res) => {
  try {
    let canchas = await Cancha.find();
    const turnosReservados = await Turno.find();
    const { provincia, localidad } = req.query;

    if (provincia || localidad) {
      const filtro = {};
      if (provincia) filtro.provincia = provincia;
      if (localidad) filtro.localidad = localidad;

      const clubes = await Club.find(filtro);
      const emailsClubes = clubes.map(c => c.email);
      canchas = canchas.filter(cancha => emailsClubes.includes(cancha.clubEmail));
    }

    let fechaBase = req.query.fecha;
    let baseDate;

    if (fechaBase) {
      const [y, m, d] = fechaBase.split('-').map(Number);
      baseDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    } else {
      baseDate = new Date();
    }

    let monday = new Date(baseDate);
    const dayNum = (monday.getDay() + 6) % 7; // lunes=0
    monday.setDate(monday.getDate() - dayNum);
    monday.setHours(0, 0, 0, 0);

    const dias = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday.getTime());
      d.setDate(d.getDate() + i);
      return isNaN(d.getTime()) ? null : d;
    }).filter(d => d !== null);

    const todosTurnos = [];

    for (const cancha of canchas) {
      const clubInfo = await Club.findOne({ email: cancha.clubEmail });

      for (const d of dias) {
        const fechaStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const diaNombre = quitarAcentos(getDiaNombre(d).toLowerCase().trim());
        const diasDisponibles = (cancha.diasDisponibles || [])
          .map(x => quitarAcentos(String(x).toLowerCase().trim()));

        if (diasDisponibles.includes(diaNombre)) {

          const duracion = Number(cancha.duracionTurno) || 60;

          const [dH, dM = 0] = cancha.horaDesde.split(':').map(Number);
          const [hH, hM = 0] = cancha.horaHasta.split(':').map(Number);

          const desdeMin = dH * 60 + dM;
          const hastaMin = hH * 60 + hM;

          for (let m = desdeMin; m + duracion <= hastaMin; m += duracion) {
            const h = Math.floor(m / 60);
            const min = m % 60;
            const hora = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

            const inicioDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, min, 0, 0);
            const precioCalculado = calcularPrecioTurno(cancha, inicioDate);

            const reservado = turnosReservados.find(t =>
              t.deporte === cancha.deporte &&
              (t.club === cancha.clubEmail || t.club === cancha.nombre) &&
              t.fecha === fechaStr &&
              t.hora === hora &&
              (t.canchaId ?? '') === cancha._id.toString()
            );

            todosTurnos.push({
              canchaId: cancha._id,
              nombreCancha: cancha.nombre,
              deporte: cancha.deporte,
              club: cancha.clubEmail,
              fecha: fechaStr,
              hora,
              precio: precioCalculado,
              usuarioReservado: reservado ? reservado.usuarioReservado : null,
              emailReservado: reservado ? reservado.emailReservado : null,
              pagado: reservado ? reservado.pagado : false,
              realId: reservado ? reservado._id : null,
              latitud: clubInfo ? clubInfo.latitud : null,
              longitud: clubInfo ? clubInfo.longitud : null,
              duracionTurno: cancha.duracionTurno || 60
            });
          }
        }
      }
    }

    res.json(todosTurnos);

  } catch (error) {
    console.error('❌ Error en /turnos-generados:', error);
    res.status(500).json({ error: 'Error al generar turnos' });
  }
});

// ===============================
// Obtener reservas del club (ordenadas)
// ===============================
app.get('/reservas/:clubEmail', async (req, res) => {
  try {
    const clubEmail = req.params.clubEmail;
    const club = await Club.findOne({ email: clubEmail });
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });

    const pipeline = [
      {
        $match: {
          $or: [{ club: clubEmail }, { club: club.nombre }],
          usuarioReservado: { $ne: null },
        },
      },
      {
        $addFields: {
          _fechaStr: { $ifNull: ["$fecha", ""] },
          _horaStr: {
            $let: {
              vars: { h: { $ifNull: ["$hora", "00:00"] } },
              in: {
                $cond: [
                  { $regexMatch: { input: "$$h", regex: /^[0-2]\d:[0-5]\d$/ } },
                  "$$h",
                  {
                    $let: {
                      vars: { p: { $split: ["$$h", ":"] } },
                      in: {
                        $concat: [
                          { $ifNull: [{ $arrayElemAt: ["$$p", 0] }, "00"] },
                          ":",
                          { $ifNull: [{ $arrayElemAt: ["$$p", 1] }, "00"] }
                        ]
                      }
                    }
                  }
                ]
              }
            }
          },
        },
      },
      {
        $addFields: {
          _isISO: { $regexMatch: { input: "$_fechaStr", regex: /^\d{4}-\d{2}-\d{2}$/ } },
          _fechaParts: {
            $cond: [
              { $regexMatch: { input: "$_fechaStr", regex: /^\d{4}-\d{2}-\d{2}$/ } },
              { $split: ["$_fechaStr", "-"] },
              { $split: ["$_fechaStr", "/"] }
            ]
          },
          _horaParts: { $split: ["$_horaStr", ":"] }
        },
      },
      {
        $addFields: {
          _year: {
            $cond: [
              "$_isISO",
              { $toInt: { $arrayElemAt: ["$_fechaParts", 0] } },
              { $toInt: { $arrayElemAt: ["$_fechaParts", 2] } }
            ]
          },
          _month: { $toInt: { $arrayElemAt: ["$_fechaParts", 1] } },
          _day: {
            $cond: [
              "$_isISO",
              { $toInt: { $arrayElemAt: ["$_fechaParts", 2] } },
              { $toInt: { $arrayElemAt: ["$_fechaParts", 0] } }
            ]
          },
          _hour: { $toInt: { $ifNull: [{ $arrayElemAt: ["$_horaParts", 0] }, 0] } },
          _minute: { $toInt: { $ifNull: [{ $arrayElemAt: ["$_horaParts", 1] }, 0] } },
        },
      },
      {
        $addFields: {
          fechaHoraOrden: {
            $dateFromParts: {
              year: "$_year",
              month: "$_month",
              day: "$_day",
              hour: "$_hour",
              minute: "$_minute",
              timezone: "America/Argentina/Buenos_Aires",
            }
          }
        }
      },
      { $sort: { fechaHoraOrden: 1 } },
      {
        $lookup: {
          from: "usuarios",
          localField: "usuarioId",
          foreignField: "_id",
          as: "usuarioDoc",
        },
      },
      { $unwind: { path: "$usuarioDoc", preserveNullAndEmptyArrays: true } },
    ];

    const reservasOrdenadas = await Turno.aggregate(pipeline);

    const canchas = await Cancha.find({ clubEmail: clubEmail });

    const reservasConNombre = reservasOrdenadas.map((r) => {
      const canchaMatch = canchas.find(
        (c) => c._id.equals(r.canchaId) || c._id.toString() === String(r.canchaId)
      );

      return {
        ...r,
        nombreCancha: canchaMatch ? canchaMatch.nombre : "Sin nombre",
        usuario: r.usuarioDoc
          ? {
              nombre: r.usuarioDoc.nombre,
              apellido: r.usuarioDoc.apellido,
              email: r.usuarioDoc.email,
              telefono: r.usuarioDoc.telefono,
              _id: r.usuarioDoc._id,
            }
          : null,
        usuarioNombre: r.usuarioDoc ? r.usuarioDoc.nombre : "",
        usuarioApellido: r.usuarioDoc ? r.usuarioDoc.apellido : "",
        usuarioEmail: r.usuarioDoc ? r.usuarioDoc.email : "",
     usuarioTelefono:
  r.usuarioDoc?.telefono ||
  r.telefonoReservado ||
  null,
};
    });

    res.json(reservasConNombre);

  } catch (error) {
    console.error('Error al obtener reservas:', error);
    res.status(500).json({ error: 'Error al obtener reservas' });
  }
});

// ===============================
// Registro usuario + email verificación
// ===============================
app.post('/registrar', async (req, res) => {
  const { nombre, apellido, telefono, email, password } = req.body;
  try {
    if (!email || !password || !nombre || !apellido) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    if (!password || password.length < 6 || !/\d/.test(password) || !/[A-Za-z]/.test(password)) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 6 caracteres e incluir una letra y un número.'
      });
    }

    const existe = await Usuario.findOne({ email });
    if (existe) return res.status(400).json({ error: 'El usuario ya existe' });

    const tel = String(telefono || '').replace(/\D/g, '');
    const telefonoNormalizado = tel.startsWith('549') ? tel : ('549' + tel);

    const hash = await bcrypt.hash(password, 10);

    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const nuevoUsuario = new Usuario({
      nombre,
      apellido,
      telefono: telefonoNormalizado,
      email,
      password: hash,
      emailVerificado: false,
      tokenVerificacion: token,
      tokenVerificacionExpira: expira
    });

    await nuevoUsuario.save();

    const link = `${process.env.APP_BASE_URL}/verificar-email?token=${token}&tipo=usuario`;

    await sendMail(
      email,
      'Verificá tu email en TurnoLibre',
      `
        <h2>¡Bienvenido/a a TurnoLibre!</h2>
        <p>Para activar tu cuenta, verificá tu email haciendo clic en el botón:</p>
        <p><a href="${link}" style="padding:10px 16px;background:#2c7be5;color:white;border-radius:6px;">Verificar mi email</a></p>
        <p>Si no funciona, copiá este enlace:<br>${link}</p>
        <small>Este enlace vence en 24 horas.</small>
      `
    );

    return res.json({ mensaje: 'Usuario registrado. Revisa tu email para verificar la cuenta.' });

  } catch (error) {
    console.error('❌ Error en /registrar:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// ===============================
// Login usuario
// ===============================
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Faltan credenciales' });
    }

    const usuario = await Usuario.findOne({ email });
    if (!usuario) return res.status(400).json({ error: 'Usuario no encontrado' });

    const hash = usuario.passwordHash || usuario.password;
    if (!hash) return res.status(500).json({ error: 'Usuario sin contraseña configurada' });

    const match = await bcrypt.compare(password, hash);
    if (!match) return res.status(401).json({ error: 'Contraseña incorrecta' });

    const verified = Boolean(usuario.emailVerified ?? usuario.emailVerificado ?? false);
    if (!verified) {
      return res.status(403).json({ error: 'Debes verificar tu email antes de iniciar sesión' });
    }

    return res.json({ mensaje: 'Login exitoso' });

  } catch (error) {
    console.error('❌ Error al iniciar sesión:', error);
    return res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// ===============================
// Reenviar verificación email
// ===============================
app.post('/reenviar-verificacion', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Falta email' });

    const user = await Usuario.findOne({ email });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.emailVerified) return res.json({ ok: true, mensaje: 'Ya estaba verificado' });

    const token = crypto.randomBytes(24).toString('hex');
    user.emailVerifyToken = token;
    user.emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    const verifyLink = `${process.env.APP_BASE_URL}/verificar-email?token=${token}`;

    await sendMail(
      email,
      'Verificá tu email - TurnoLibre',
      `
        <p>Hola ${user.nombre || ''},</p>
        <p>Confirmá tu correo haciendo click aquí:</p>
        <p><a href="${verifyLink}">${verifyLink}</a></p>
      `
    );

    return res.json({ ok: true });

  } catch (e) {
    console.error('POST /reenviar-verificacion', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ===============================
// Obtener usuario por email
// ===============================
app.get('/usuario/:email', async (req, res) => {
  try {
    const usuario = await Usuario.findOne({ email: req.params.email }, { password: 0 });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(usuario);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

// ===============================
// Generar link de pago para reservas
// ===============================
app.post('/generar-link-pago/:reservaId', async (req, res) => {
  try {
    const reserva = await Turno.findById(req.params.reservaId);
    if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

    const club = await Club.findOne({ email: reserva.club });
    if (!club || !club.mercadoPagoAccessToken) {
      return res.status(400).json({ error: 'El club no tiene configurado su Access Token' });
    }

    mercadopago.configure({
      access_token: club.mercadoPagoAccessToken
    });

    const preference = {
      items: [{
        title: `Reserva de cancha - ${reserva.deporte}`,
        quantity: 1,
        currency_id: 'ARS',
        unit_price: reserva.precio
      }],
      notification_url: 'https://localhost:3000/api/mercadopago/webhook',
      external_reference: reserva._id.toString()
    };

    const response = await mercadopago.preferences.create(preference);
    res.json({ pagoUrl: response.body.init_point });

  } catch (error) {
    console.error('Error generando link de pago:', error);
    res.status(500).json({ error: 'Error generando link de pago' });
  }
});

// ===============================
// Obtener reserva por ID
// ===============================
app.get('/reserva/:id', async (req, res) => {
  try {
    const reserva = await Turno.findById(req.params.id).populate('usuarioId');
    if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
    res.json(reserva);
  } catch (error) {
    console.error('❌ Error en /reserva/:id:', error);
    res.status(500).json({ error: 'Error al obtener reserva' });
  }
});

// ===============================
// Editar usuario
// ===============================
app.put('/usuario/:email', async (req, res) => {
  try {
    const { nombre, apellido, telefono } = req.body;
    await Usuario.findOneAndUpdate(
      { email: req.params.email },
      { nombre, apellido, telefono },
      { new: true }
    );
    res.json({ mensaje: 'Datos actualizados correctamente' });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// ===============================
// PAGO DE DESTACADO
// ===============================
app.post('/club/:email/destacar-pago', async (req, res) => {
  try {
    const clubEmail = req.params.email;
    const club = await Club.findOne({ email: clubEmail });
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });

    let config = await Config.findOne();
    if (!config) config = await Config.create({});

    mercadopago.configure({
      access_token: process.env.MP_ACCESS_TOKEN
    });

    const preference = {
      items: [{
        title: `Destacar club "${club.nombre}" por ${config.diasDestacado} días`,
        quantity: 1,
        currency_id: 'ARS',
        unit_price: config.precioDestacado
      }],
      notification_url: 'https://localhost:3000/api/mercadopago/destacado-webhook',
      external_reference: clubEmail,
      back_urls: {
        success: 'https://localhost:3000/panel-club.html',
        failure: 'https://localhost:3000/panel-club.html'
      },
      auto_return: 'approved'
    };

    const response = await mercadopago.preferences.create(preference);

    res.json({ pagoUrl: response.body.init_point });

  } catch (error) {
    console.error('❌ Error generando link de pago de destaque:', error);
    res.status(500).json({ error: 'No se pudo generar el link de pago' });
  }
});

// ===============================
// Webhook de destacado
// ===============================
app.post('/api/mercadopago/destacado-webhook', async (req, res) => {
  try {
    const paymentId = req.query.id || req.body?.data?.id;
    if (!paymentId) return res.sendStatus(200);

    const yaExiste = await PaymentEvent.findOne({ paymentId });
    if (yaExiste) return res.sendStatus(200);

    await PaymentEvent.create({ paymentId });

    const resp = await mercadopago.payment.findById(paymentId);
    const pago = resp?.body || {};
    const status = pago.status;
    const clubEmail = pago.external_reference;

    if (!clubEmail) return res.sendStatus(200);

    if (status === 'approved') {
      const dias = 30;
      const fechaVencimiento = new Date();
      fechaVencimiento.setDate(fechaVencimiento.getDate() + dias);

      await Club.findOneAndUpdate(
        { email: clubEmail },
        {
          destacado: true,
          destacadoHasta: fechaVencimiento,
          idUltimaTransaccion: paymentId
        }
      );

      console.log(`✅ Club ${clubEmail} destacado hasta ${fechaVencimiento.toLocaleDateString('es-AR')}`);
    }

    return res.sendStatus(200);

  } catch (error) {
    console.error('❌ Error en webhook de destacado:', error);
    return res.sendStatus(500);
  }
});

// ===============================
// Config destacado
// ===============================
app.get('/configuracion-destacado', async (req, res) => {
  let config = await Config.findOne();
  if (!config) config = await Config.create({});
  res.json({
    precioDestacado: config.precioDestacado,
    diasDestacado: config.diasDestacado
  });
});

// ===============================
// Listado de clubes
// ===============================
app.get('/clubes', async (req, res) => {
  try {
    const { provincia, localidad, q } = req.query;

    const filter = {};
    if (provincia) filter.provincia = provincia;
    if (localidad) filter.localidad = localidad;
    if (q) filter.nombre = { $regex: q, $options: 'i' };

    const projection = {
      email: 1,
      nombre: 1,
      provincia: 1,
      localidad: 1,
      destacado: 1,
      destacadoHasta: 1,
      latitud: 1,
      longitud: 1,
      _id: 0
    };

    const clubes = await Club.find(filter, projection).sort({ destacado: -1, nombre: 1 });
    res.json(clubes);
  } catch (error) {
    console.error('❌ Error en GET /clubes:', error);
    res.status(500).json({ error: 'Error al obtener clubes' });
  }
});

// ===============================
// Marcar pagado manual
// ===============================
app.patch('/turnos/:id/marcar-pagado', async (req, res) => {
  try {
    await Turno.findByIdAndUpdate(req.params.id, { pagado: true });
    res.json({ mensaje: 'Turno marcado como pagado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al marcar como pagado' });
  }
});

// ===============================
// Recuperar contraseña (usuario)
// ===============================
app.post('/recuperar', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Falta el email.' });

    const usuario = await Usuario.findOne({ email });
    if (!usuario) return res.status(404).json({ error: 'No existe un usuario con ese email.' });

    const token = crypto.randomBytes(32).toString('hex');
    usuario.resetToken = token;
    usuario.resetTokenExp = new Date(Date.now() + 3600000);
    await usuario.save();

    const link = `${process.env.APP_BASE_URL}/reset.html?token=${token}&tipo=usuario`;

    await sendMail(
      usuario.email,
      'Recuperar contraseña - TurnoLibre',
      `
        <h2>Recuperación de contraseña</h2>
        <p>Hacé clic en el siguiente enlace para restablecer tu contraseña:</p>
        <p><a href="${link}" target="_blank">${link}</a></p>
        <p>Este enlace vence en 1 hora.</p>
      `
    );

    res.json({ mensaje: 'Correo de recuperación enviado correctamente.' });

  } catch (error) {
    console.error('❌ Error en /recuperar:', error);
    res.status(500).json({ error: 'Error al procesar la recuperación.' });
  }
});

// ===============================
// Reset contraseña (usuario)
// ===============================
app.post('/reset', async (req, res) => {
  try {
    const { token, nuevaPassword } = req.body;
    if (!token || !nuevaPassword)
      return res.status(400).json({ error: 'Faltan datos.' });

    const usuario = await Usuario.findOne({
      resetToken: token,
      resetTokenExp: { $gt: Date.now() }
    });

    if (!usuario) return res.status(400).json({ error: 'Token inválido o expirado.' });

    if (nuevaPassword.length < 6 || !/\d/.test(nuevaPassword) || !/[A-Za-z]/.test(nuevaPassword)) {
      return res.status(400).json({
        error: 'La nueva contraseña debe tener al menos 6 caracteres e incluir una letra y un número.'
      });
    }

    const hash = await bcrypt.hash(nuevaPassword, 10);
    usuario.password = hash;
    usuario.resetToken = undefined;
    usuario.resetTokenExp = undefined;
    await usuario.save();

    res.json({ mensaje: 'Contraseña actualizada correctamente.' });

  } catch (error) {
    console.error('❌ Error en /reset:', error);
    res.status(500).json({ error: 'Error al restablecer contraseña.' });
  }
});

// ===============================
// Recuperar contraseña (club)
// ===============================
app.post('/recuperar-club', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Falta el email.' });

    const club = await Club.findOne({ email });
    if (!club) return res.status(404).json({ error: 'No existe un club con ese email.' });

    const token = crypto.randomBytes(32).toString('hex');
    club.resetToken = token;
    club.resetTokenExp = new Date(Date.now() + 3600000);
    await club.save();

    const link = `${process.env.APP_BASE_URL}/reset.html?token=${token}&tipo=club`;

    await sendMail(
      club.email,
      'Recuperar contraseña - TurnoLibre (Club)',
      `
        <h2>Recuperación de contraseña</h2>
        <p>Hacé clic en el siguiente enlace para restablecer tu contraseña del club:</p>
        <p><a href="${link}" target="_blank">${link}</a></p>
        <p>Este enlace vence en 1 hora.</p>
      `
    );

    res.json({ mensaje: 'Correo de recuperación enviado correctamente al club.' });

  } catch (error) {
    console.error('❌ Error en /recuperar-club:', error);
    res.status(500).json({ error: 'Error al procesar la recuperación del club.' });
  }
});

// ===============================
// Reset club
// ===============================
app.post('/reset-club', async (req, res) => {
  try {
    const { token, nuevaPassword } = req.body;
    if (!token || !nuevaPassword)
      return res.status(400).json({ error: 'Faltan datos.' });

    const club = await Club.findOne({
      resetToken: token,
      resetTokenExp: { $gt: Date.now() }
    });

    if (!club) return res.status(400).json({ error: 'Token inválido o expirado.' });

    if (nuevaPassword.length < 6 || !/\d/.test(nuevaPassword) || !/[A-Za-z]/.test(nuevaPassword)) {
      return res.status(400).json({
        error: 'La nueva contraseña debe tener al menos 6 caracteres e incluir una letra y un número.'
      });
    }

    const hash = await bcrypt.hash(nuevaPassword, 10);
    club.passwordHash = hash;
    club.resetToken = undefined;
    club.resetTokenExp = undefined;
    await club.save();

    res.json({ mensaje: 'Contraseña del club actualizada correctamente.' });

  } catch (error) {
    console.error('❌ Error en /reset-club:', error);
    res.status(500).json({ error: 'Error al restablecer contraseña del club.' });
  }
});

// ===============================
// Verificar email
// ===============================
app.get('/verificar-email', async (req, res) => {
  try {
    const { token, tipo } = req.query;

    if (!token) return res.status(400).send('Falta el token.');
    if (!tipo) return res.status(400).send('Falta el tipo.');

    const Modelo = tipo === 'club' ? Club : Usuario;

    const entidad = await Modelo.findOne({
      tokenVerificacion: token,
      tokenVerificacionExpira: { $gt: new Date() }
    });

    if (!entidad) {
      return res.status(400).send('Token inválido o vencido.');
    }

    entidad.emailVerificado = true;
    entidad.tokenVerificacion = undefined;
    entidad.tokenVerificacionExpira = undefined;
    await entidad.save();

    const redirectUrl =
      tipo === 'club'
        ? `${process.env.FRONT_URL}/login-club.html?verified=1`
        : `${process.env.FRONT_URL}/login.html?verified=1`;

    return res.redirect(redirectUrl);

  } catch (error) {
    console.error('❌ Error en /verificar-email:', error);
    res.status(500).send('Error interno al verificar email.');
  }
});

// ===============================
// Iniciar servidor
// ===============================
const PORT = process.env.PORT || 3000;

app.use(errors());

app.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`));
