import { z } from "zod";
import { WagerTransactionKind } from "../../../domain/models/wager-transaction.entity";

export const MoneySchema = z.object({
  amount: z
    .string()
    .regex(/^-?\d+(\.\d{1,2})?$/, "Amount must be a decimal string with at most 2 decimal places")
    .refine((val) => !/[eE]/.test(val), "Scientific notation is not allowed"),
  currency: z.string().length(3, "Currency must be a 3-letter ISO code"),
});

export const CreateWalletSchema = z.object({
  playerId: z.string().min(1, "playerId is required"),
  initialBalance: MoneySchema,
});

export const SubmitTransactionSchema = z.object({
  providerId: z.string().min(1, "providerId is required"),
  externalTransactionId: z.string().min(1, "externalTransactionId is required"),
  playerId: z.string().min(1, "playerId is required"),
  walletId: z.string().uuid("walletId must be a valid UUID"),
  roundId: z.string().min(1, "roundId is required"),
  gameId: z.string().min(1, "gameId is required"),
  kind: z.nativeEnum(WagerTransactionKind, {
    errorMap: () => ({ message: "kind must be one of BET, WIN, LOSS, REFUND, ROLLBACK" }),
  }),
  money: MoneySchema,
  referenceExternalTransactionId: z.string().optional(),
});
