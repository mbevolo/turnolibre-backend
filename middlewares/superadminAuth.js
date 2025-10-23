const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('Falta JWT_SECRET en .env');

module.exports = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ ok: false, msg: 'Falta token' });

  try {
    const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
    if (decoded.rol !== 'superadmin') throw new Error('No autorizado');
    req.superadmin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ ok: false, msg: 'Token inválido' });
  }
};
