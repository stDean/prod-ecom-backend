import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

export const getId = (req: Request, res: Response): number | null => {
  const id = parseInt(req.params.id);
  return isNaN(id)
    ? (res
        .status(StatusCodes.BAD_REQUEST)
        .json({ message: "Invalid product ID" }),
      null)
    : id;
};
