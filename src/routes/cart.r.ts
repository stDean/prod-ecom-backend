import { Router } from "express";
import { CartCtrl } from "../controller/Cart.c";

const router = Router();

router
  .route("/items")
  .post(CartCtrl.addCartItem)
  .get(CartCtrl.retrieveCartItems);

router.delete("/", CartCtrl.clearCart);
router.get("/total", CartCtrl.getCartTotal);
router.post("/merge", CartCtrl.mergeCarts);

router
  .route("/items/:productId")
  .patch(CartCtrl.updateCartItem)
  .delete(CartCtrl.removeCartItem);

export default router;
