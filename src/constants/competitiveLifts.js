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
    aliases: ['squat', 'back squat'],
  },
  {
    id: 'barbell_row',
    label: 'Barbell Row',
    aliases: ['barbell_row', 'barbell row'],
  },
  {
    id: 'overhead_press',
    label: 'Overhead Press',
    aliases: ['overhead_press', 'overhead press'],
  },
  {
    id: 'hip_thrust',
    label: 'Hip Thrust',
    aliases: ['hip_thrust', 'hip thrust'],
  },
  {
    id: 'lat_pulldown',
    label: 'Lat Pulldown',
    aliases: ['lat_pulldown', 'lat pulldown'],
  },
  {
    id: 'pullups',
    label: 'Pull-ups',
    aliases: ['pullups', 'pull-ups', 'pull ups'],
  },
  {
    id: 'pushups',
    label: 'Pushups',
    aliases: ['pushups', 'push-ups', 'push ups'],
  },
  {
    id: 'plank',
    label: 'Plank',
    aliases: ['plank'],
  },
  {
    id: 'bodyweight_squat',
    label: 'Bodyweight Squat',
    aliases: ['bodyweight_squat', 'bodyweight squat'],
  },
  {
    id: 'goblet_squat',
    label: 'Goblet Squat',
    aliases: ['goblet_squat', 'goblet squat'],
  },
  {
    id: 'romanian_deadlift',
    label: 'Romanian Deadlift',
    aliases: ['romanian_deadlift', 'romanian deadlift'],
  },
  {
    id: 'incline_pushup',
    label: 'Incline Push Up',
    aliases: ['incline_pushup', 'incline push up', 'incline push-up'],
  },
  {
    id: 'step_ups',
    label: 'Step Ups',
    aliases: ['step_ups', 'step ups', 'step-ups'],
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
