import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tokenRouter from "./token";
import indexerRouter from "./indexer";
import aiRouter from "./ai";
import stakingRouter from "./staking";
import daoRouter from "./dao";
import liquidityRouter from "./liquidity";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tokenRouter);
router.use("/indexer", indexerRouter);
router.use("/ai", aiRouter);
router.use("/staking", stakingRouter);
router.use("/dao", daoRouter);
router.use("/liquidity", liquidityRouter);

export default router;
