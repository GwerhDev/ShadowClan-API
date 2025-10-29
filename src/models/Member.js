const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema({
  class: { type: String, required: false },
  whatsapp: { type: String, required: false },
  character: { type: String, required: true },
  battletag: { type: String, required: false },
  resonance: { type: Number, required: false },
  characters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Character', required: false }],
});

module.exports = mongoose.model('Member', memberSchema);