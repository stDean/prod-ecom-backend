import { Router } from "express";
import { ProductCtrl } from "../controller/Product.c";

const router = Router();

router.post("/create", ProductCtrl.createProduct);
router.get("/", ProductCtrl.getProducts);
router.post("/search", ProductCtrl.searchProducts);
router
  .route("/:id")
  .get(ProductCtrl.getProductById)
  .patch(ProductCtrl.updateProduct)
  .delete(ProductCtrl.deleteProduct);

export default router;
