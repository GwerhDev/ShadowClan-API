const mongoose = require("mongoose");

const characterSchema = new mongoose.Schema({
  name: { type: String, required: true },
  warband: { type: mongoose.Schema.Types.ObjectId, ref: 'Warband', required: false },
});

module.exports = mongoose.model('Character', characterSchema);
