import { Schema, model } from 'mongoose';
import type { IClanMembership } from '../types';

const clanMembershipSchema = new Schema<IClanMembership>({
  clan:            { type: Schema.Types.ObjectId, ref: 'Clan', required: true },
  character:       { type: Schema.Types.ObjectId, ref: 'Character', required: true },
  role:            { type: String, enum: ['leader', 'officer', 'member'], default: 'member' },
  // Ausente en registros "backfill" (salida cerrada sin haber tenido un ingreso
  // registrado — típicamente membresías previas a esta feature).
  joinedAt:        { type: Date },
  leftAt:          { type: Date },
  expulsionReason: { type: String },
  removedBy:       { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

clanMembershipSchema.index({ character: 1, leftAt: 1 });
clanMembershipSchema.index({ clan: 1, leftAt: 1 });

export default model<IClanMembership>('ClanMembership', clanMembershipSchema);
