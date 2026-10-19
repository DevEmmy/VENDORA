// Local checks never send credentials to an external service. This denylist
// catches common choices; it does not claim exhaustive breach detection.
const common = new Set(`password password1 password123 password1234 12345678 123456789 1234567890
qwerty123 qwertyuiop qwerty12345 11111111 00000000 123123123 123456abc abc12345 abcdefgh
iloveyou sunshine princess football baseball basketball welcome welcome1 welcome123
letmein1 letmein123 admin123 admin1234 administrator passw0rd password! password123!
changeme trustno1 dragon123 michael1 monkey123 superman computer whatever`.split(/\s+/));

export function passwordProblem(value: string): string | null {
  if ([...value].length < 8 || [...value].length > 128) return 'Password must contain 8–128 characters';
  if (common.has(value.toLowerCase().trim())) return 'Choose a less common password';
  return null;
}
