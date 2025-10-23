const mongoose = require('mongoose');

const paymentEventSchema = new mongoose.Schema({
  paymentId: { type: String, required: true, unique: true },
  processedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.PaymentEvent || mongoose.model('PaymentEvent', paymentEventSchema);
