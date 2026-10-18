import { model } from 'mongoose';
import type { IShadowWar } from '../types';
import { shadowWarSchema } from './ShadowWar';

// Vigilia de Espadas (Vigil of Blades): los 3 primeros clanes del ranking contra los
// Inmortales, domingos a las 20:00 (server) durante las 3 primeras semanas del ciclo.
// Misma estructura que una Guerra Sombría (4 salas × 3 partidas × 2 grupos), pero en su
// propia colección para que nunca entre en las estadísticas/asistencia de Guerra Sombría.
// La abren líderes y oficiales cuando el clan clasifica (la app no lleva el ranking).
export default model<IShadowWar>('VigilOfBlades', shadowWarSchema.clone(), 'vigilsofblades');
