/**
 * A suggested batch/reference value: the current date and time as a prefix the
 * user edits from, never a value they must invent. `DIG-20261118-1437` sorts
 * by when the batch happened and stays unique to the minute.
 */
export function suggestedBatchRef(prefix = 'DIG'): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${prefix}-${date}-${time}`;
}
