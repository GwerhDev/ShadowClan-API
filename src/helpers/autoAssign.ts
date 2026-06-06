interface Member { _id: string | object; currentClass?: string; score?: number }
type Role = 'frontline' | 'support' | 'damage'

const CLASS_ROLE: Record<string, Role> = {
  crusader:    'frontline',
  bloodknight: 'frontline',
  monk:        'support',
  necromancer: 'support',
  druid:       'support',
  demonhunter: 'damage',
  wizard:      'damage',
  tempest:     'damage',
  barbarian:   'damage',
}

function roleOf(m: Member): Role {
  return CLASS_ROLE[m.currentClass ?? ''] ?? 'damage'
}

// For each member (sorted by score desc) assign to the group that has:
//   (a) remaining capacity
//   (b) fewest members of the same role → promotes class diversity
//   tie-break: fewest of the exact same class
//   tie-break: lowest total score accumulated → promotes score balance
function greedyFill(pool: Member[], sizes: number[]): Member[][] {
  const groups: Member[][] = sizes.map(() => [])
  for (const m of pool) {
    let best = -1; let bestScore = -Infinity
    for (let g = 0; g < sizes.length; g++) {
      if (groups[g].length >= sizes[g]) continue
      const sameRole  = groups[g].filter(x => roleOf(x) === roleOf(m)).length
      const sameClass = groups[g].filter(x => x.currentClass === m.currentClass).length
      const totalSc   = groups[g].reduce((s, x) => s + (x.score ?? 0), 0)
      const s = -sameRole * 100 - sameClass * 50 - totalSc * 0.001
      if (s > bestScore) { bestScore = s; best = g }
    }
    if (best >= 0) groups[best].push(m)
  }
  return groups
}

// ── Accursed Tower: group1=4, group2=4, group3=2 ──────────────────────────────
export function autoAssignAT(members: Member[]) {
  const pool = [...members].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10)
  const [g1, g2, g3] = greedyFill(pool, [4, 4, 2])
  const ids = (g: Member[]) => g.map(m => String(m._id))
  return { group1: ids(g1), group2: ids(g2), group3: ids(g3) }
}

// ── Shadow War: 4 tiers × 3 matches × 2 groups × 4 slots ─────────────────────
// Standard competitive strategy: best 24 → exalted (8 pts/match, 3×8=24=win)
// Each tier gets the next best 24 by score. Empty slots remain when fewer members.
export function autoAssignSW(members: Member[]) {
  const sorted = [...members].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const TIER_SIZE = 24 // 3 matches × 2 groups × 4 slots
  const tierNames = ['exalted', 'eminent', 'famed', 'proud'] as const
  const result: Record<string, any[]> = {}

  for (let t = 0; t < 4; t++) {
    const tierPool = sorted.slice(t * TIER_SIZE, (t + 1) * TIER_SIZE)
    // 6 slots for this tier (3 matches × 2 groups), each holds 4 members
    // Slots 0-2 = group1 of each match, slots 3-5 = group2 of each match.
    // greedyFill fills earlier slots first when scores tie, so group1s are
    // saturated before anyone is placed in group2.
    const slots = greedyFill(tierPool, Array(6).fill(4))
    const ids = (g: Member[]) => g.map(m => String(m._id))
    result[tierNames[t]] = [0, 1, 2].map(i => ({
      group1: { character: ids(slots[i]) },
      group2: { character: ids(slots[i + 3]) },
    }))
  }
  return result
}
