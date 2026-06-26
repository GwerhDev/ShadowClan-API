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
  warlock:     'damage',
}

function roleOf(m: Member): Role {
  return CLASS_ROLE[m.currentClass ?? ''] ?? 'damage'
}

// For each member (sorted by score desc) assign to the group that has:
//   (a) remaining capacity
//   (b) fewest members of the same role → promotes class diversity
//   tie-break: fewest of the exact same class
//   tie-break: lowest total score accumulated → promotes score balance
// preExisting: members already occupying each group (counted toward capacity and diversity)
function greedyFill(pool: Member[], sizes: number[], preExisting?: Member[][]): Member[][] {
  const groups: Member[][] = sizes.map((_, i) => [...(preExisting?.[i] ?? [])])
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
//
// If existingBattle is provided, already-assigned members are preserved and only
// empty slots are filled with the remaining unassigned pool (partial fill mode).
export function autoAssignSW(members: Member[], existingBattle?: Record<string, any[]>) {
  const tierNames = ['exalted', 'eminent', 'famed', 'proud'] as const
  const result: Record<string, any[]> = {}
  const ids = (g: Member[]) => g.map(m => String(m._id))

  if (!existingBattle) {
    // Full replace: original behavior
    const sorted = [...members].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    const TIER_SIZE = 24
    for (let t = 0; t < 4; t++) {
      const tierPool = sorted.slice(t * TIER_SIZE, (t + 1) * TIER_SIZE)
      const slots = greedyFill(tierPool, Array(6).fill(4))
      result[tierNames[t]] = [0, 1, 2].map(i => ({
        group1: { character: ids(slots[i]) },
        group2: { character: ids(slots[i + 3]) },
      }))
    }
    return result
  }

  // Partial fill: respect existing assignments, fill only empty slots
  const memberMap = new Map(members.map(m => [String(m._id), m]))

  // Collect all already-assigned IDs across the entire formation
  const assignedIds = new Set<string>()
  for (const tier of tierNames) {
    for (const match of (existingBattle[tier] ?? [])) {
      for (const char of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
        if (char) assignedIds.add(String(typeof char === 'object' ? (char._id ?? char) : char))
      }
    }
  }

  // Pool = unassigned members sorted by score desc
  const pool = members
    .filter(m => !assignedIds.has(String(m._id)))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  let poolIdx = 0

  const toMember = (char: any): Member | null => {
    if (!char) return null
    const id = String(typeof char === 'object' ? (char._id ?? char) : char)
    return memberMap.get(id) ?? null
  }

  for (const tier of tierNames) {
    const existingMatches = existingBattle[tier] ?? []
    result[tier] = [0, 1, 2].map(i => {
      const match = existingMatches[i] ?? {}
      const g1Existing = (match.group1?.character ?? []).map(toMember).filter(Boolean) as Member[]
      const g2Existing = (match.group2?.character ?? []).map(toMember).filter(Boolean) as Member[]
      const totalEmpty = Math.max(0, 4 - g1Existing.length) + Math.max(0, 4 - g2Existing.length)

      const fillPool = pool.slice(poolIdx, poolIdx + totalEmpty)
      poolIdx += totalEmpty

      const filled = greedyFill(fillPool, [4, 4], [g1Existing, g2Existing])
      return {
        group1: { character: ids(filled[0]) },
        group2: { character: ids(filled[1]) },
      }
    })
  }

  return result
}
