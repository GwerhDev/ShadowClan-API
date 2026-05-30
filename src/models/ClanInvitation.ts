import { Schema, model } from 'mongoose';
import type { IClanInvitation } from '../types';

const clanInvitationSchema = new Schema<IClanInvitation>({
  clan:              { type: Schema.Types.ObjectId, ref: 'Clan',      required: true },
  character:         { type: Schema.Types.ObjectId, ref: 'Character', required: true },
  invitedByUser:     { type: Schema.Types.ObjectId, ref: 'User',      required: true },
  role:              { type: String, enum: ['officer', 'member'], default: 'member' },
  proposedClass:     { type: String, default: null },
  proposedResonance: { type: Number, default: null },
  status:            { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
}, { timestamps: true });

export default model<IClanInvitation>('ClanInvitation', clanInvitationSchema);
