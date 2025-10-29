const mongoose = require("mongoose");

const crestSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  type: { type: String, required: true },
  quantity: { type: Number, required: true },
  legendaryFound: { type: Boolean, default: false, required: false },

  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  character: { type: mongoose.Schema.Types.ObjectId, ref: 'Character', required: false },
});

module.exports = mongoose.model('Crest', crestSchema);
