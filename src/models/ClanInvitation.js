const mongoose = require("mongoose");

const clanInvitationSchema = new mongoose.Schema({
  clan:              { type: mongoose.Schema.Types.ObjectId, ref: 'Clan',      required: true },
  character:         { type: mongoose.Schema.Types.ObjectId, ref: 'Character', required: true },
  invitedByUser:     { type: mongoose.Schema.Types.ObjectId, ref: 'User',      required: true },
  role:              { type: String, enum: ['officer', 'member'], default: 'member' },
  proposedClass:     { type: String, default: null },
  proposedResonance: { type: Number, default: null },
  status:            { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
}, { timestamps: true });

module.exports = mongoose.model('ClanInvitation', clanInvitationSchema);
