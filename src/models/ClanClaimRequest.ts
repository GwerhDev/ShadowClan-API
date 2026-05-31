import { Schema, model } from 'mongoose';

const schema = new Schema({
  user:          { type: Schema.Types.ObjectId, ref: 'User',      required: true },
  character:     { type: Schema.Types.ObjectId, ref: 'Character', required: true },
  clan:          { type: Schema.Types.ObjectId, ref: 'Clan',      required: true },
  requestedRole: { type: String, enum: ['leader', 'officer'], required: true },
  status:        { type: String, default: 'pending' },
}, { timestamps: true });

export default model('ClanClaimRequest', schema);
