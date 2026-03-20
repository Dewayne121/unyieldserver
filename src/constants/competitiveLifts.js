const COMPETITIVE_LIFTS = [
  {
    id: 'bench_press',
    label: 'Bench Press',
    aliases: ['bench_press', 'bench press'],
  },
  {
    id: 'deadlift',
    label: 'Deadlift',
    aliases: ['deadlift'],
  },
  {
    id: 'squat',
    label: 'Squat',
    aliases: ['squat'],
  },
];

const normalize = (value) => String(value || '').trim().toLowerCase();

const resolveCompetitiveLiftId = (value) => {
  const normalized = normalize(value);
  if (!normalized) return null;

  for (const lift of COMPETITIVE_LIFTS) {
    if (lift.aliases.some((alias) => normalize(alias) === normalized)) {
      return lift.id;
    }
  }

  return null;
};

const getCompetitiveLiftById = (id) =>
  COMPETITIVE_LIFTS.find((lift) => lift.id === id) || null;

const getCompetitiveLiftByIdOrName = (value) => {
  const id = resolveCompetitiveLiftId(value);
  return id ? getCompetitiveLiftById(id) : null;
};

const getCompetitiveLiftLabel = (value) => {
  const lift = getCompetitiveLiftByIdOrName(value);
  return lift ? lift.label : null;
};

const getCompetitiveLiftWorkoutAliases = (value) => {
  const lift = getCompetitiveLiftByIdOrName(value);
  if (!lift) return [];
  // Workouts may store either IDs or display names
  return Array.from(new Set([lift.id, lift.label]));
};

module.exports = {
  COMPETITIVE_LIFTS,
  resolveCompetitiveLiftId,
  getCompetitiveLiftById,
  getCompetitiveLiftByIdOrName,
  getCompetitiveLiftLabel,
  getCompetitiveLiftWorkoutAliases,
};
