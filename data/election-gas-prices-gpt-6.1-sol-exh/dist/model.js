export const TANK = 14.5;
export function electionDate(year) {
  const monday = new Date(Date.UTC(year, 10, 1));
  monday.setUTCDate(1 + (8 - monday.getUTCDay()) % 7);
  monday.setUTCDate(monday.getUTCDate() + 1);
  return monday.toISOString().slice(0, 10);
}
export function observation(series, target, allowCarry = false) {
  if (Number.isFinite(series[target])) return { value: series[target], month: target, estimated: false };
  if (!allowCarry) return { value: null, month: null, estimated: false };
  const date = Object.keys(series).filter(x => x <= target).sort().at(-1);
  return date ? { value: series[date], month: date, estimated: true } : { value: null, month: null, estimated: false };
}
export function makeRows(data) {
  const obs = data.observations;
  return Array.from({length: 49}, (_, i) => {
    const year = 1978 + i, target = `${year}-11-01`;
    const values = Object.fromEntries(Object.entries(obs).map(([key, s]) => [key, observation(s, target, year === 2026)]));
    return { year, date: electionDate(year), election: year % 4 === 0 ? 'Presidential' : year % 2 === 0 ? 'Midterm' : 'Off-year',
      price: values.gas.value, wage: values.wage.value, cpiDfw: values.cpiDfw.value, cpiUs: values.cpiUs.value,
      preliminary: Object.values(values).some(v => v.estimated), inputs: values };
  });
}
export function adjustedPrice(row, adjustment, base, cpi = 'cpiDfw') {
  if (row.price === null) return null;
  if (adjustment === 'nominal') return row.price;
  const key = adjustment === 'inflation' ? cpi : 'wage';
  return row[key] && base[key] ? row.price * base[key] / row[key] : null;
}
export function metricValue(row, metric, adjustment, base, cpi) {
  if (metric === 'minutes' || metric === 'tankMinutes') return row.price && row.wage ? 60 * row.price / row.wage * (metric === 'tankMinutes' ? TANK : 1) : null;
  if (metric === 'gallons') return row.price && row.wage ? row.wage / row.price : null;
  const value = adjustedPrice(row, adjustment, base, cpi);
  return value === null ? null : value * (metric === 'fillup' ? TANK : 1);
}
