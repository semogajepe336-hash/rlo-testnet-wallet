const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SYS = "11111111111111111111111111111111";
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
function u64(b: number[], from: number): number {
  let v = 0;
  for (let i = from + 7; i >= from; i--) v = v * 256 + b[i];
  return v;
}
function allIx(res: any): any[] {
  const inner = (res.meta?.innerInstructions || []).flatMap((x: any) => x.instruction ? [x.instruction] : (x.instructions || []));
  return [...res.transaction.message.instructions, ...inner];
}

export function parseTransfer(res: any, me: string): any {
  try {
    const msg = res.transaction.message;
    const ix = msg.instructions[0];
    const keys: string[] = msg.accountKeys;
    if (keys[ix.programIdIndex] !== SYS) return null;
    const b = b58bytes(ix.data);
    const kind = b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24);
    if (b.length < 12 || kind !== 2) return null;
    const amount = u64(b, 4) / 1e9;
    const from = keys[ix.accounts[0]], to = keys[ix.accounts[1]];
    const out = from === me;
    const sign = out ? "-" : "+";
    return { label: out ? "Sent" : "Received", sign, amount, other: short(out ? to : from), from, to, legs: [{ sign, amount, sym: "RIALO" }] };
  } catch { return null; }
}

export function parseSwap(res: any, me: string): any {
  try {
    const keys: string[] = res.transaction.message.accountKeys;
    const legs: any[] = [];
    for (const ix of allIx(res)) {
      const prog = keys[ix.programIdIndex];
      const b = b58bytes(ix.data);
      if (prog === SYS && b.length >= 12 && (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) === 2) {
        legs.push({ sign: keys[ix.accounts[0]] === me ? "-" : "+", amount: u64(b, 4) / 1e9, sym: "RIALO" });
      } else if (prog.startsWith("Token") && b[0] === 12 && b.length >= 10) {
        legs.push({ sign: keys[ix.accounts[3]] === me ? "-" : "+", amount: u64(b, 1) / Math.pow(10, b[9]), sym: "TEST" });
      }
    }
    if (legs.length < 2) return null;
    legs.sort((a, c) => (a.sign === "-" ? 0 : 1) - (c.sign === "-" ? 0 : 1));
    return { label: "Swap", other: legs[0].sym + " → " + legs[1].sym, legs };
  } catch { return null; }
}
