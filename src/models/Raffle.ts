import { Schema, model } from 'mongoose';
import type { IRaffle } from '../types';

// Historial de sorteos de un clan. Uno o más premios sorteados en orden; los ganadores los
// elige el servidor y quien gana un premio sale del bombo para los siguientes.
const raffleSchema = new Schema<IRaffle>({
  clan: { type: Schema.Types.ObjectId, ref: 'Clan', required: true },
  criteria: {
    range:        { type: String, enum: ['30', '60', '90', 'cycle'], required: true },
    cycle:        { type: Schema.Types.ObjectId, ref: 'Cycle', default: null },
    since:        { type: Date, required: true },
    until:        { type: Date, required: true },
    includeStaff: { type: Boolean, default: false },
    rules: [{
      _id:      false,
      activity: { type: String, enum: ['shadow_war', 'vigil_of_blades'], required: true },
      mode:     { type: String, enum: ['count', 'percent'], required: true },
      min:      { type: Number, required: true },
    }],
  },
  participants: [{
    _id:       false,
    character: { type: Schema.Types.ObjectId, ref: 'Character', required: true },
    name:      { type: String, required: true },
  }],
  draws: [{
    _id:              false,
    prize:            { type: Schema.Types.ObjectId, ref: 'Prize', required: true },
    prizeName:        { type: String, required: true },
    prizeDescription: { type: String, default: '' },
    winner: {
      character: { type: Schema.Types.ObjectId, ref: 'Character', required: true },
      name:      { type: String, required: true },
    },
    winnerAcknowledged: { type: Boolean, default: false },
  }],
  drawnBy:          { type: Schema.Types.ObjectId, ref: 'User', required: true },
  drawnByCharacter: { type: Schema.Types.ObjectId, ref: 'Character', default: null },
}, { timestamps: true });

raffleSchema.index({ clan: 1, createdAt: -1 });
raffleSchema.index({ 'draws.winner.character': 1, 'draws.winnerAcknowledged': 1 });
raffleSchema.index({ 'draws.prize': 1 });

export default model<IRaffle>('Raffle', raffleSchema);
