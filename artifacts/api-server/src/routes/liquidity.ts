import { Router } from "express";
import {
  getWalletBalances,
  getPoolStatus,
  approveToken,
  createAndSeedPool,
  AGL_ADDRESS,
  WETH_ADDRESS,
  USDC_ADDRESS,
  UNISWAP_V3_POSITION_MANAGER,
  UNISWAP_V3_FACTORY,
  FEE_HIGH,
  type Address,
} from "../lib/liquidity.js";
import { db } from "@workspace/db";
import { cacheMetaTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

// GET /liquidity/wallet  — wallet balances + gas check
router.get("/wallet", async (_req, res) => {
  try {
    const balances = await getWalletBalances();
    res.json(balances);
  } catch (err) {
    console.error("Wallet balance error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /liquidity/pools  — status of both AGL pools
router.get("/pools", async (_req, res) => {
  try {
    const [aglEth, aglUsdc] = await Promise.all([
      getPoolStatus(AGL_ADDRESS, WETH_ADDRESS, FEE_HIGH),
      getPoolStatus(AGL_ADDRESS, USDC_ADDRESS, FEE_HIGH),
    ]);

    const cached = await db.select().from(cacheMetaTable).where(eq(cacheMetaTable.key, "liquidityStatus")).limit(1);
    const cachedData = cached[0] ? JSON.parse(cached[0].value) : null;

    res.json({
      aglWeth: {
        ...aglEth,
        pair: "AGL/WETH",
        fee: "1%",
        uniswapUrl: aglEth.exists && aglEth.poolAddress
          ? `https://app.uniswap.org/explore/pools/base/${aglEth.poolAddress}`
          : `https://app.uniswap.org/add/${AGL_ADDRESS}/${WETH_ADDRESS}/10000?chain=base`,
        basescanUrl: aglEth.exists && aglEth.poolAddress
          ? `https://basescan.org/address/${aglEth.poolAddress}`
          : null,
      },
      aglUsdc: {
        ...aglUsdc,
        pair: "AGL/USDC",
        fee: "1%",
        uniswapUrl: aglUsdc.exists && aglUsdc.poolAddress
          ? `https://app.uniswap.org/explore/pools/base/${aglUsdc.poolAddress}`
          : `https://app.uniswap.org/add/${AGL_ADDRESS}/${USDC_ADDRESS}/10000?chain=base`,
        basescanUrl: aglUsdc.exists && aglUsdc.poolAddress
          ? `https://basescan.org/address/${aglUsdc.poolAddress}`
          : null,
      },
      lastAction: cachedData,
    });
  } catch (err) {
    console.error("Pool status error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /liquidity/create-pools  — create both pools and seed liquidity
// Body: { aglPerEth: number, aglAmount: string, ethAmount: string, usdcAmount?: string }
router.post("/create-pools", async (req, res) => {
  try {
    const balances = await getWalletBalances();

    if (!balances.sufficientGas) {
      res.status(400).json({
        error: "Insufficient ETH for gas. Send at least 0.01 ETH to " + balances.address,
        currentEth: balances.eth.formatted,
        required: "0.01 ETH minimum (0.02 ETH recommended)",
        walletAddress: balances.address,
      });
      return;
    }

    const { aglPerEth = 1000000, aglAmountPerPool = "1000000" } = req.body;

    const ethAmount = (parseFloat(aglAmountPerPool) / aglPerEth).toFixed(8);
    const usdcPerAgl = 0.000002; // approximate: if 1 ETH = 1M AGL and 1 ETH = $3000, then 1 AGL = $0.000003
    const ethPriceUSD = 3000;
    const aglPriceUSD = ethPriceUSD / aglPerEth;
    const usdcAmount = (parseFloat(aglAmountPerPool) * aglPriceUSD).toFixed(6);

    const results: Record<string, unknown> = {};

    // Approve AGL for position manager
    await approveToken(AGL_ADDRESS, UNISWAP_V3_POSITION_MANAGER, BigInt("999999999999999999999999999999"));

    // Pool 1: AGL/WETH
    try {
      const aglEthStatus = await getPoolStatus(AGL_ADDRESS, WETH_ADDRESS, FEE_HIGH);
      if (!aglEthStatus.exists) {
        const r = await createAndSeedPool({
          token0: AGL_ADDRESS,
          token1: WETH_ADDRESS,
          fee: FEE_HIGH,
          price: 1 / aglPerEth, // price of AGL in ETH
          token0Decimals: 18,
          token1Decimals: 18,
          amount0Human: aglAmountPerPool,
          amount1Human: ethAmount,
        });
        results.aglWeth = { status: "created", ...r };
      } else {
        results.aglWeth = { status: "already_exists", poolAddress: aglEthStatus.poolAddress };
      }
    } catch (err) {
      results.aglWeth = { status: "error", error: (err as Error).message };
    }

    // Pool 2: AGL/USDC (only if we have USDC)
    if (parseFloat(balances.usdc.formatted) > 0) {
      try {
        const aglUsdcStatus = await getPoolStatus(AGL_ADDRESS, USDC_ADDRESS, FEE_HIGH);
        if (!aglUsdcStatus.exists) {
          await approveToken(USDC_ADDRESS, UNISWAP_V3_POSITION_MANAGER, BigInt("999999999999999999999999999999"));
          const r = await createAndSeedPool({
            token0: AGL_ADDRESS,
            token1: USDC_ADDRESS,
            fee: FEE_HIGH,
            price: aglPriceUSD,
            token0Decimals: 18,
            token1Decimals: 6,
            amount0Human: aglAmountPerPool,
            amount1Human: usdcAmount,
          });
          results.aglUsdc = { status: "created", ...r };
        } else {
          results.aglUsdc = { status: "already_exists", poolAddress: aglUsdcStatus.poolAddress };
        }
      } catch (err) {
        results.aglUsdc = { status: "error", error: (err as Error).message };
      }
    } else {
      results.aglUsdc = { status: "skipped", reason: "No USDC in wallet. Fund with USDC or swap after AGL/WETH pool is live." };
    }

    const logEntry = { ...results, executedAt: new Date().toISOString() };
    await db
      .insert(cacheMetaTable)
      .values({ key: "liquidityStatus", value: JSON.stringify(logEntry) })
      .onConflictDoUpdate({ target: cacheMetaTable.key, set: { value: JSON.stringify(logEntry), updatedAt: new Date() } });

    res.json({ success: true, results });
  } catch (err) {
    console.error("Create pools error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /liquidity/approve  — standalone approve token
router.post("/approve", async (req, res) => {
  try {
    const { token, amount } = req.body;
    const tokenAddr = token === "AGL" ? AGL_ADDRESS : token === "USDC" ? USDC_ADDRESS : (token as Address);
    const result = await approveToken(tokenAddr, UNISWAP_V3_POSITION_MANAGER, BigInt(amount ?? "999999999999999999999999999999"));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
