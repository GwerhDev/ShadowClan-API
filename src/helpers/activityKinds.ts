import type { Model } from 'mongoose';
import ShadowWar from '../models/ShadowWar';
import VigilOfBlades from '../models/VigilOfBlades';
import type { IShadowWar } from '../types';

/**
 * Tipos de instancia con formación de Guerra Sombría (4 salas × 3 partidas × 2 grupos).
 * Los controladores de gestión/públicos y la asistencia se construyen a partir de esta
 * configuración, así Guerra Sombría y Vigilia de Espadas comparten toda la lógica.
 */
export type SWKind = 'shadow_war' | 'vigil_of_blades';

export interface SWKindConfig {
  kind: SWKind;
  Model: Model<IShadowWar>;
  /** Mensaje 404. */
  notFound: string;
  /** Eventos de socket y nombre del campo con el id en el payload. */
  events: { updated: string; assigned: string; idKey: string };
  /** `source` del post automático "llamado a las armas" en el feed. */
  postSource: 'shadow_war' | 'vigil_of_blades';
}

export const SHADOW_WAR: SWKindConfig = {
  kind: 'shadow_war',
  Model: ShadowWar,
  notFound: 'Shadow War not found',
  events: { updated: 'shadowwar:updated', assigned: 'shadowwar:assigned', idKey: 'shadowWarId' },
  postSource: 'shadow_war',
};

export const VIGIL_OF_BLADES: SWKindConfig = {
  kind: 'vigil_of_blades',
  Model: VigilOfBlades,
  notFound: 'Vigilia de Espadas no encontrada.',
  events: { updated: 'vigil:updated', assigned: 'vigil:assigned', idKey: 'vigilId' },
  postSource: 'vigil_of_blades',
};

export const SW_KINDS: Record<SWKind, SWKindConfig> = {
  shadow_war: SHADOW_WAR,
  vigil_of_blades: VIGIL_OF_BLADES,
};
