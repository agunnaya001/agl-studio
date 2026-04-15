import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Droplets,
  Wallet,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ArrowUpRight,
  Flame,
  Copy,
  Zap,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function apiFetch(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE_URL}/api${path}`, init);
  if (!r.ok) {
    const body = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(body.error ?? r.statusText);
  }
  return r.json();
}

export default function Liquidity() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [aglPerEth, setAglPerEth] = useState("1000000");
  const [aglAmountPerPool, setAglAmountPerPool] = useState("500000");
  const [launching, setLaunching] = useState(false);

  const { data: wallet, isLoading: walletLoading, refetch: refetchWallet } = useQuery({
    queryKey: ["liquidity-wallet"],
    queryFn: () => apiFetch("/liquidity/wallet"),
    refetchInterval: 30_000,
  });

  const { data: pools, isLoading: poolsLoading, refetch: refetchPools } = useQuery({
    queryKey: ["liquidity-pools"],
    queryFn: () => apiFetch("/liquidity/pools"),
    refetchInterval: 60_000,
  });

  const createPools = useMutation({
    mutationFn: () =>
      apiFetch("/liquidity/create-pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aglPerEth: Number(aglPerEth), aglAmountPerPool }),
      }),
    onSuccess: (data) => {
      toast({ title: "Liquidity Action Complete", description: "Check results below." });
      queryClient.invalidateQueries({ queryKey: ["liquidity-pools"] });
      queryClient.invalidateQueries({ queryKey: ["liquidity-wallet"] });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Transaction Failed", description: err.message });
    },
  });

  const handleLaunch = async () => {
    setLaunching(true);
    try {
      await createPools.mutateAsync();
    } finally {
      setLaunching(false);
    }
  };

  const copyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address);
      toast({ title: "Copied", description: "Wallet address copied to clipboard." });
    }
  };

  const ethPriceUSD = 3000;
  const aglPriceUSD = aglPerEth ? (ethPriceUSD / Number(aglPerEth)).toFixed(8) : "0";
  const marketCap = wallet?.agl?.formatted
    ? (parseFloat(wallet.agl.formatted.replace(/,/g, "")) * parseFloat(aglPriceUSD) * 1_000_000).toFixed(0)
    : "0";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border/50 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight uppercase text-primary flex items-center gap-3">
            <Droplets className="h-8 w-8" />
            Liquidity Manager
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Create Uniswap V3 pools and make AGL tradeable on Base mainnet.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-none border-primary/30 text-primary hover:bg-primary/10"
          onClick={() => { refetchWallet(); refetchPools(); }}
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Wallet Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-primary/20 bg-card/50 rounded-none col-span-full md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs tracking-widest text-primary flex items-center gap-2">
              <Wallet className="h-4 w-4" /> TREASURY WALLET
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 font-mono text-sm">
            {walletLoading ? (
              <Skeleton className="h-20 w-full bg-primary/5" />
            ) : wallet ? (
              <>
                <div className="flex items-center gap-2 bg-black/30 p-2 border border-border/40">
                  <code className="text-xs text-muted-foreground truncate flex-1">{wallet.address}</code>
                  <Button size="icon" variant="ghost" className="h-6 w-6 rounded-none" onClick={copyAddress}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ETH</span>
                    <span className={wallet.sufficientGas ? "text-primary" : "text-destructive font-bold"}>
                      {parseFloat(wallet.eth.formatted).toFixed(6)} ETH
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">AGL</span>
                    <span className="text-foreground">{parseFloat(wallet.agl.formatted).toLocaleString()} AGL</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">USDC</span>
                    <span className={parseFloat(wallet.usdc.formatted) > 0 ? "text-foreground" : "text-muted-foreground"}>
                      {parseFloat(wallet.usdc.formatted).toFixed(2)} USDC
                    </span>
                  </div>
                </div>
                {!wallet.sufficientGas && (
                  <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 p-3 text-destructive text-xs">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">LOW GAS</div>
                      <div className="text-destructive/80 mt-1">
                        Send at least <strong>0.02 ETH</strong> to this address to cover pool creation gas fees.
                      </div>
                    </div>
                  </div>
                )}
                {wallet.sufficientGas && (
                  <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 p-2 text-primary text-xs">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Gas OK — Ready to deploy</span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-destructive text-xs">Failed to load wallet data</div>
            )}
          </CardContent>
        </Card>

        {/* Pool Status Cards */}
        {poolsLoading ? (
          <>
            <Skeleton className="h-40 w-full bg-primary/5 rounded-none" />
            <Skeleton className="h-40 w-full bg-primary/5 rounded-none" />
          </>
        ) : pools ? (
          <>
            <PoolCard pool={pools.aglWeth} />
            <PoolCard pool={pools.aglUsdc} />
          </>
        ) : null}
      </div>

      {/* Launch Configuration */}
      <Card className="border-primary/20 bg-card/50 rounded-none">
        <CardHeader className="border-b border-primary/10">
          <CardTitle className="text-sm tracking-widest uppercase text-primary flex items-center gap-2">
            <Zap className="h-4 w-4" /> Pool Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs tracking-widest text-muted-foreground uppercase">AGL per ETH (Initial Price)</label>
                <Input
                  type="number"
                  value={aglPerEth}
                  onChange={(e) => setAglPerEth(e.target.value)}
                  className="rounded-none border-primary/30 bg-black/50 font-mono"
                  placeholder="e.g. 1000000"
                />
                <p className="text-xs text-muted-foreground">
                  1 AGL = {aglPriceUSD} ETH ≈ ${(parseFloat(aglPriceUSD) * ethPriceUSD).toFixed(8)} USD
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-xs tracking-widest text-muted-foreground uppercase">AGL Amount per Pool</label>
                <Input
                  type="text"
                  value={aglAmountPerPool}
                  onChange={(e) => setAglAmountPerPool(e.target.value)}
                  className="rounded-none border-primary/30 bg-black/50 font-mono"
                  placeholder="e.g. 500000"
                />
                <p className="text-xs text-muted-foreground">
                  Requires {(parseFloat(aglAmountPerPool || "0") / parseFloat(aglPerEth || "1")).toFixed(6)} ETH for AGL/WETH pool
                </p>
              </div>
            </div>
            <div className="space-y-4 bg-black/20 p-4 border border-primary/10 font-mono text-xs">
              <div className="text-primary text-xs tracking-widest uppercase mb-3">Estimated Parameters</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fee Tier</span>
                <span>1% (Volatile)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tick Range</span>
                <span>Full Range</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">AGL Price</span>
                <span>${(parseFloat(aglPriceUSD) * ethPriceUSD).toFixed(8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Implied Market Cap</span>
                <span>${parseInt(marketCap).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Network</span>
                <span className="text-primary">Base Mainnet</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Protocol</span>
                <span>Uniswap V3</span>
              </div>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <Button
              onClick={handleLaunch}
              disabled={launching || !wallet?.sufficientGas || createPools.isPending}
              className="rounded-none bg-primary text-primary-foreground hover:bg-primary/90 uppercase tracking-widest font-mono px-8"
            >
              {launching || createPools.isPending ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Deploying...</>
              ) : (
                <><Droplets className="h-4 w-4 mr-2" /> Deploy Liquidity Pools</>
              )}
            </Button>
            {!wallet?.sufficientGas && (
              <div className="flex items-center text-xs text-destructive font-mono">
                <AlertTriangle className="h-4 w-4 mr-1" />
                Fund wallet with ETH first
              </div>
            )}
          </div>

          {createPools.data && (
            <div className="mt-4 bg-black/40 border border-primary/20 p-4 font-mono text-xs space-y-2">
              <div className="text-primary tracking-widest uppercase mb-2">Deployment Results</div>
              <pre className="text-muted-foreground overflow-auto text-[10px]">
                {JSON.stringify(createPools.data, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual Links */}
      <Card className="border-border/30 bg-card/30 rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs tracking-widest text-muted-foreground uppercase">Manual Uniswap Links</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <a
            href={`https://app.uniswap.org/explore/tokens/base/0xEA1221B4d80A89BD8C75248Fae7c176BD1854698`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 border border-primary/30 text-primary px-3 py-2 text-xs font-mono hover:bg-primary/10 transition-colors"
          >
            <ArrowUpRight className="h-3 w-3" /> AGL on Uniswap
          </a>
          <a
            href={`https://app.uniswap.org/add/0xEA1221B4d80A89BD8C75248Fae7c176BD1854698/0x4200000000000000000000000000000000000006/10000?chain=base`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 border border-border/40 text-muted-foreground px-3 py-2 text-xs font-mono hover:bg-white/5 transition-colors"
          >
            <Droplets className="h-3 w-3" /> Add AGL/WETH Liquidity
          </a>
          <a
            href={`https://app.uniswap.org/add/0xEA1221B4d80A89BD8C75248Fae7c176BD1854698/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/10000?chain=base`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 border border-border/40 text-muted-foreground px-3 py-2 text-xs font-mono hover:bg-white/5 transition-colors"
          >
            <Droplets className="h-3 w-3" /> Add AGL/USDC Liquidity
          </a>
          <a
            href={`https://basescan.org/token/0xEA1221B4d80A89BD8C75248Fae7c176BD1854698`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 border border-border/40 text-muted-foreground px-3 py-2 text-xs font-mono hover:bg-white/5 transition-colors"
          >
            <ExternalLink className="h-3 w-3" /> Basescan
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function PoolCard({ pool }: { pool: any }) {
  return (
    <Card className={`border-primary/20 bg-card/50 rounded-none ${pool.exists && pool.hasLiquidity ? "border-l-4 border-l-primary" : ""}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs tracking-widest flex justify-between items-center">
          <span className="text-primary">{pool.pair}</span>
          <Badge
            variant="outline"
            className={`rounded-none text-[10px] uppercase ${
              pool.exists && pool.hasLiquidity
                ? "border-primary text-primary bg-primary/10"
                : pool.exists
                ? "border-yellow-500/50 text-yellow-400"
                : "border-destructive/40 text-destructive"
            }`}
          >
            {pool.exists && pool.hasLiquidity ? "LIVE" : pool.exists ? "EMPTY" : "NOT CREATED"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 font-mono text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Fee</span>
          <span>{pool.fee}</span>
        </div>
        {pool.exists && (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Liquidity</span>
              <span>{pool.liquidity === "0" ? "Empty" : parseFloat(pool.liquidity).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tick</span>
              <span>{pool.tick}</span>
            </div>
            <code className="block text-[10px] text-muted-foreground truncate bg-black/20 p-1">{pool.poolAddress}</code>
          </>
        )}
        <div className="flex gap-2 pt-1">
          <a
            href={pool.uniswapUrl}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-primary hover:underline text-[10px]"
          >
            <ExternalLink className="h-3 w-3" /> Uniswap
          </a>
          {pool.basescanUrl && (
            <a
              href={pool.basescanUrl}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-muted-foreground hover:underline text-[10px]"
            >
              <ExternalLink className="h-3 w-3" /> Basescan
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
