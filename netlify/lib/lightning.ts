interface LnurlMeta {
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
  tag: string;
}

export interface LnInvoice {
  pr: string;
  payment_hash?: string;
  verify?: string;
  routes?: unknown[];
}

export async function fetchLnurlInvoice(
  lnAddress: string,
  sats: number,
): Promise<LnInvoice> {
  const [user, domain] = lnAddress.split("@");
  if (!user || !domain) {
    throw new Error(`Invalid Lightning address: ${lnAddress}`);
  }

  const metaRes = await fetch(
    `https://${domain}/.well-known/lnurlp/${user}`,
  );
  if (!metaRes.ok) {
    throw new Error(`LNURL meta fetch failed: ${metaRes.status}`);
  }
  const meta = (await metaRes.json()) as LnurlMeta;

  const millisats = sats * 1000;
  if (millisats < meta.minSendable || millisats > meta.maxSendable) {
    throw new Error(
      `Amount ${millisats} msat outside range (${meta.minSendable}-${meta.maxSendable})`,
    );
  }

  const sep = meta.callback.includes("?") ? "&" : "?";
  const cbUrl = `${meta.callback}${sep}amount=${millisats}`;
  const cbRes = await fetch(cbUrl);
  if (!cbRes.ok) {
    throw new Error(`LNURL callback failed: ${cbRes.status}`);
  }
  const invoice = (await cbRes.json()) as LnInvoice;
  if (!invoice.pr) {
    throw new Error("LNURL callback returned no payment request");
  }
  return invoice;
}

export async function usdToSats(usd: number): Promise<number> {
  try {
    const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    if (!res.ok) throw new Error(`Coinbase ${res.status}`);
    const data = (await res.json()) as { data?: { amount?: string } };
    const priceStr = data.data?.amount;
    if (!priceStr) throw new Error("Coinbase: missing amount");
    const price = parseFloat(priceStr);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("Coinbase: invalid price");
    }
    return Math.round((usd / price) * 100_000_000);
  } catch (err) {
    console.warn("usdToSats failed, using fallback:", err);
    return Math.round((usd / 60_000) * 100_000_000);
  }
}
