const mongoose = require('mongoose');

const clanPostSchema = new mongoose.Schema({
  clan:    { type: mongoose.Schema.Types.ObjectId, ref: 'Clan',      required: true },
  author:  { type: mongoose.Schema.Types.ObjectId, ref: 'Character', required: true },
  content: { type: String, required: false, default: '', maxlength: 1000 },
  source:  { type: String, enum: ['general', 'shadow_war'], default: 'general' },
}, { timestamps: true });

module.exports = mongoose.model('ClanPost', clanPostSchema);
