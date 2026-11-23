// Nine game hours in ten active minutes; a full day takes 26m40s.
export const CLOCK = Object.freeze({
  startHour: 16.5,
  trainingNightHour: 19.75, // 19:45 local solar time, just after sunset.
  hoursPerSecond: 9 / 600,
});
export const SKY_REBAKE_COS = Math.cos((0.35 * Math.PI) / 180);
