const mongoose = require("mongoose");
const Warband = require("./Warband");

const characterSchema = new mongoose.Schema({
  name: { type: String, required: true },
  status: { type: String, required: false, default: 'unclaimed' },
  memberStatus: { type: String, required: false, default: 'activo' },
  resonance: { type: Number, required: false },
  currentClass: { type: String, required: false },

  clan: { type: mongoose.Schema.Types.ObjectId, ref: 'Clan', required: false },
});

module.exports = mongoose.model('Character', characterSchema);
