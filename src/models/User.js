const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  battlenetId: { type: String, required: true },
  battletag: { type: String, required: true },
  provider: { type: String, required: true },
  status: { type: String, required: true },
  phone: { type: String, required: false },
  role: { type: String, required: true },

  member: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: false }],
  character: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Character', required: false }],
});

module.exports = mongoose.model('User', userSchema);