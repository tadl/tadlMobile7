/**
 * MeLCat identifies Evergreen patrons by their ILS record ID. Login usernames
 * can change locally when preferences sync; Aspen's own user ID is unrelated.
 */
export function melcatIdFromProfile(profile: unknown): string {
  if (!profile || typeof profile !== 'object') return '';

  const id = (profile as { unique_ils_id?: unknown }).unique_ils_id;
  if (typeof id === 'number') {
    return Number.isSafeInteger(id) && id > 0 ? String(id) : '';
  }
  if (typeof id !== 'string') return '';

  const value = id.trim();
  return /^[1-9]\d*$/.test(value) ? value : '';
}
