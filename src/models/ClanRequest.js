const mongoose = require("mongoose");

const clanRequestSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User',      required: true },
  character: { type: mongoose.Schema.Types.ObjectId, ref: 'Character', required: true },
  clan:      { type: mongoose.Schema.Types.ObjectId, ref: 'Clan',      required: true },
  status:    { type: String, default: 'pending' }, // pending | accepted | rejected
}, { timestamps: true });

module.exports = mongoose.model('ClanRequest', clanRequestSchema);
