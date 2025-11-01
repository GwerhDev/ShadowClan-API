const mongoose = require("mongoose");

const clanSchema = new mongoose.Schema({
  name: { type: String, required: true },
  status: { type: String, required: false, default: 'unclaimed' },
  member: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Character', required: false }],
  officer: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Character', required: false }],
  leader: { type: mongoose.Schema.Types.ObjectId, ref: 'Character', required: false },
});

module.exports = mongoose.model('Clan', clanSchema);