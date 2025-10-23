// @ts-nocheck

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Superadmin = require('../models/Superadmin');
const Club = require('../models/Club');
const Usuario = require('../models/Usuario'); // <--- IMPORTANTE, arriba
const superadminAuth = require('../middlewares/superadminAuth');
const Turno = require('../models/Turno');
const router = express.Router();
const Config = require('../models/config');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('Falta JWT_SECRET en .env');

// Registrar primer superadmin (usalo UNA vez)
router.post('/register', async (req, res) => {
  try {
    const { email, password, nombre } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const newSuperadmin = new Superadmin({ email, passwordHash, nombre });
    await newSuperadmin.save();
    res.status(201).json({ ok: true, msg: 'Superadmin creado' });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Login superadmin
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const superadmin = await Superadmin.findOne({ email });
    if (!superadmin) return res.status(400).json({ ok: false, msg: 'Usuario o contraseña incorrectos' });

    const valid = await bcrypt.compare(password, superadmin.passwordHash);
    if (!valid) return res.status(400).json({ ok: false, msg: 'Usuario o contraseña incorrectos' });

    // Genera token (puede ser JWT simple)
    const token = jwt.sign({ id: superadmin._id, rol: 'superadmin' }, JWT_SECRET, { expiresIn: '1d' });

    res.json({ ok: true, token, nombre: superadmin.nombre });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Listado de clubes solo para superadmin (PROTEGIDO)
router.get('/clubes', superadminAuth, async (req, res) => {
  try {
    const clubes = await Club.find();
    res.json({ ok: true, clubes });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Listado de usuarios solo para superadmin (PROTEGIDO)
router.get('/usuarios', superadminAuth, async (req, res) => {
  try {
    const usuarios = await Usuario.find();
    res.json({ ok: true, usuarios });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Listado de reservas solo para superadmin (PROTEGIDO)
router.get('/reservas', superadminAuth, async (req, res) => {
  try {
    const reservas = await Turno.find();
    res.json({ ok: true, reservas });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Listado de pagos (reservas pagadas) solo para superadmin
router.get('/pagos', superadminAuth, async (req, res) => {
  try {
    const pagos = await Turno.find({ pagado: true });
    res.json({ ok: true, pagos });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Listado de clubes destacados (solo para superadmin)
router.get('/destacados', superadminAuth, async (req, res) => {
  try {
    // Trae todos los clubes que tienen destacado en true
    const destacados = await Club.find({ destacado: true });
    res.json({ ok: true, destacados });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Quitar destacado a un club (solo para superadmin)
router.post('/quitar-destacado', superadminAuth, async (req, res) => {
  try {
    const { email } = req.body;
    const club = await Club.findOne({ email });
    if (!club) return res.status(404).json({ ok: false, msg: 'Club no encontrado' });

    club.destacado = false;
    club.destacadoHasta = null;
    await club.save();

    res.json({ ok: true, msg: 'Destacado quitado correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Obtener configuraciones globales
router.get('/configuraciones', superadminAuth, async (req, res) => {
  try {
    let config = await Config.findOne();
    if (!config) {
      config = await Config.create({}); // Usa los valores por defecto la primera vez
    }
    res.json({ ok: true, config });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Actualizar configuraciones globales
router.put('/configuraciones', superadminAuth, async (req, res) => {
  try {
    let config = await Config.findOne();
    if (!config) config = await Config.create({});
    const { precioDestacado, diasDestacado } = req.body;
    if (precioDestacado !== undefined) config.precioDestacado = precioDestacado;
    if (diasDestacado !== undefined) config.diasDestacado = diasDestacado;
    await config.save();
    res.json({ ok: true, config });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Editar club (solo superadmin)
router.put('/clubes/:id', superadminAuth, async (req, res) => {
  try {
    const { nombre, email, telefono, activo } = req.body;
    const club = await Club.findByIdAndUpdate(
      req.params.id,
      { nombre, email, telefono, activo },
      { new: true }
    );
    if (!club) return res.status(404).json({ ok: false, msg: 'Club no encontrado' });
    res.json({ ok: true, club });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Suspender (activar/desactivar) club
router.patch('/clubes/:id/suspender', superadminAuth, async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ ok: false, msg: 'Club no encontrado' });
    club.activo = !club.activo;
    await club.save();
    res.json({ ok: true, club });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Eliminar club
router.delete('/clubes/:id', superadminAuth, async (req, res) => {
  try {
    await Club.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Editar usuario (solo superadmin)
router.put('/usuarios/:id', superadminAuth, async (req, res) => {
  try {
    const { nombre, apellido, email, telefono } = req.body;
    const usuario = await Usuario.findByIdAndUpdate(
      req.params.id,
      { nombre, apellido, email, telefono },
      { new: true }
    );
    if (!usuario) return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
    res.json({ ok: true, usuario });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Suspender (activar/desactivar) usuario
router.patch('/usuarios/:id/suspender', superadminAuth, async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
    usuario.activo = usuario.activo === false ? true : false; // alterna entre true y false
    await usuario.save();
    res.json({ ok: true, usuario });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Eliminar usuario
router.delete('/usuarios/:id', superadminAuth, async (req, res) => {
  try {
    await Usuario.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});
// Editar reserva
router.put('/reservas/:id', superadminAuth, async (req, res) => {
  try {
    const { deporte, fecha, club, hora, precio, usuarioReservado, emailReservado, pagado } = req.body;
    const turno = await Turno.findByIdAndUpdate(
      req.params.id,
      { deporte, fecha, club, hora, precio, usuarioReservado, emailReservado, pagado },
      { new: true }
    );
    if (!turno) return res.status(404).json({ ok: false, msg: 'Reserva no encontrada' });
    res.json({ ok: true, turno });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Cancelar reserva (libera turno)
router.patch('/reservas/:id/cancelar', superadminAuth, async (req, res) => {
  try {
    const turno = await Turno.findById(req.params.id);
    if (!turno) return res.status(404).json({ ok: false, msg: 'Reserva no encontrada' });
    turno.usuarioReservado = null;
    turno.emailReservado = null;
    turno.pagado = false;
    await turno.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Marcar reserva como pagada
router.patch('/reservas/:id/pagado', superadminAuth, async (req, res) => {
  try {
    const turno = await Turno.findByIdAndUpdate(req.params.id, { pagado: true }, { new: true });
    if (!turno) return res.status(404).json({ ok: false, msg: 'Reserva no encontrada' });
    res.json({ ok: true, turno });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});


module.exports = router;
