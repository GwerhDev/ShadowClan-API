const mongoose = require('mongoose');

const characterCreationRequestSchema = new mongoose.Schema({
  user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User',      required: true },
  name:         { type: String, required: true },
  currentClass: { type: String, required: true },
  resonance:    { type: Number },
  status:       { type: String, default: 'pending' }, // pending | accepted | rejected
}, { timestamps: true });

module.exports = mongoose.model('CharacterCreationRequest', characterCreationRequestSchema);
