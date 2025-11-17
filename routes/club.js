// routes/club.js
const express = require("express");
const router = express.Router();
const Club = require("../models/Club");
const authClub = require("../middlewares/authClub");

// ✅ GET /api/club/me
// Devuelve los datos del club autenticado usando SOLO el token
router.get("/me", authClub, async (req, res) => {
  try {
    const club = await Club.findById(req.clubId).lean();

    if (!club) {
      return res.status(404).json({ error: "Club no encontrado" });
    }

    res.json(club);

  } catch (error) {
    console.error("Error en GET /api/club/me:", error);
    res.status(500).json({ error: "Error obteniendo datos del club" });
  }
});

module.exports = router;
