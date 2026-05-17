import { Router } from "express";
import { get3D66Status } from "../controllers/systemController.js";

const router = Router();

router.get("/system/3d66-status", get3D66Status);

export default router;
