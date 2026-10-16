import { Schema, model, type Types } from 'mongoose';

/**
 * Sesión de un dispositivo (refresh token). Solo se guarda el hash SHA-256 del token.
 * Vence a los 3 días del último uso; cada refresh rota el token y extiende `expiresAt`.
 */
export interface ISession {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  tokenHash: string;
  /** Hash del token anterior, aceptado durante una ventana corta (refrescos concurrentes). */
  prevTokenHash?: string | null;
  prevValidUntil?: Date | null;
  expiresAt: Date;
  lastUsedAt: Date;
  userAgent?: string;
  ip?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>({
  user:           { type: Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash:      { type: String, required: true },
  prevTokenHash:  { type: String, default: null },
  prevValidUntil: { type: Date, default: null },
  expiresAt:      { type: Date, required: true },
  lastUsedAt:     { type: Date, required: true },
  userAgent:      { type: String },
  ip:             { type: String },
}, { timestamps: true });

sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ prevTokenHash: 1 }, { sparse: true });
sessionSchema.index({ user: 1 });
// MongoDB elimina las sesiones vencidas automáticamente.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Colección propia: `sessions` la usa connect-mongo (express-session del login OAuth).
export default model<ISession>('Session', sessionSchema, 'authsessions');
