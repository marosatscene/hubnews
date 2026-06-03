function isDue(source, now = Date.now()) {
  if (!source.enabled) return false;
  if (!source.lastCheckedAt) return true;
  const lastChecked = new Date(source.lastCheckedAt).getTime();
  if (Number.isNaN(lastChecked)) return true;
  return now - lastChecked >= source.checkIntervalMinutes * 60 * 1000;
}

module.exports = { isDue };
