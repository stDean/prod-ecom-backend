import { Router } from "express";
import { ProductCtrl } from "../controller/Product.c";
import { searchLimiter } from "../middleware/rateLimit.m";

const router = Router();

router.post("/create", ProductCtrl.createProduct);
router.get("/", ProductCtrl.getProducts);
router.route("/search").get(searchLimiter, ProductCtrl.searchProducts);
router
  .route("/:id")
  .get(ProductCtrl.getProductById)
  .patch(ProductCtrl.updateProduct)
  .delete(ProductCtrl.deleteProduct);

export default router;
