const jwt = require("jsonwebtoken");

module.exports = function authClub(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Token requerido" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.clubId = decoded.clubId;      // ✅ clubId REAL del token
    req.clubEmail = decoded.email;
    next();
  } catch (err) {
    console.error("Error verificando token club:", err);
    return res.status(401).json({ error: "Token inválido" });
  }
};
