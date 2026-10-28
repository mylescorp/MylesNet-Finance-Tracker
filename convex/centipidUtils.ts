export function isIgnoredCentipidEvent(event: string) {
  return /fail|refund|cancel|expir|revers|declin|pending/.test(event.toLowerCase());
}
