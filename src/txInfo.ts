const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58bytes(s: string): number[] {
  const out: number[] = [];
  for (const c of s) {
    let carry = A.indexOf(c);
    for (let i = 0; i < out.length; i++) { carry += out[i] * 58; out[i] = carry & 255; carry >>= 8; }
    while (carry > 0) { out.push(carry & 255); carry >>= 8; }
  }
  for (const c of s) { if (c === "1") out.push(0); else break; }
  return out.reverse();
}
const short = (a: string) => a.slice(0, 6) + "..." + a.slice(-4);

export function parseTransfer(res: any, me: string): any {
  try {
    const msg = res.transaction.message;
    const ix = msg.instructions[0];
    const keys: string[] = msg.accountKeys;
    if (keys[ix.programIdIndex] !== "11111111111111111111111111111111") return null;
    const b = b58bytes(ix.data);
    const kind = b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24);
    if (b.length < 12 || kind !== 2) return null;
    let lam = 0;
    for (let i = 11; i >= 4; i--) lam = lam * 256 + b[i];
    const from = keys[ix.accounts[0]], to = keys[ix.accounts[1]];
    const out = from === me;
    return { label: out ? "Sent" : "Received", sign: out ? "-" : "+", amount: lam / 1e9, other: short(out ? to : from), from, to };
  } catch { return null; }
}
