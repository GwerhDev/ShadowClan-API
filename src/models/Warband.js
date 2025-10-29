const mongoose = require("mongoose");

const warbandSchema = new mongoose.Schema({
  name: { type: String, required: true },
  leader: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false }],
});

module.exports = mongoose.model('Warband', warbandSchema);
